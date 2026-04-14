# 测试文件存放规范

> 本文档定义 `analyze-cli` 项目中所有测试相关文件的存放位置和命名规则。

## 目录结构

```
analyze-cli/
├── test/                          # 测试代码（.ts 文件）
│   ├── opencli.test.ts
│   ├── import-offline.test.ts
│   ├── prepare-data-offline.test.ts
│   ├── prepare-data.test.ts
│   ├── task-post-status.test.ts
│   ├── xhs-shanghai-food.test.ts
│   └── report.ts                  # 报告生成器
│
├── test-data/                     # 测试数据（所有数据文件）
│   ├── README.md                  # 本目录说明
│   ├── mock/                      # 离线模拟数据（不依赖网络）
│   │   ├── xhs_posts.jsonl
│   │   ├── xhs_comments_post1.jsonl
│   │   └── xhs_comments_post2.jsonl
│   ├── real/                      # 真实平台数据（通过 opencli 获取）
│   │   ├── xhs/                   # 小红书真实数据
│   │   │   ├── search_shanghai_food.json
│   │   │   ├── comments_68835071.json
│   │   │   └── media_68835071.json
│   │   └── hackernews/            # HackerNews 公开 API 数据
│   │       └── top_stories.json
│   └── reports/                   # 测试报告
│       ├── test-report.json
│       └── test-report.md
│
└── downloads/                     # 下载的媒体文件（按平台分子目录）
    ├── xhs/                       # 小红书媒体
    │   └── 68835071000000001c0358d3/
    │       ├── 68835071000000001c0358d3_1.jpg
    │       └── ...
    └── weibo/                     # 微博媒体（示例）
        └── ...
```

## 分类规则

### 1. 测试代码 → `test/`

| 内容 | 说明 |
|------|------|
| `*.test.ts` | 测试用例代码 |
| `report.ts` | 报告生成器 |

**规则**：只放 `.ts` 源码文件，不放任何数据或报告。

### 2. 离线模拟数据 → `test-data/mock/`

| 文件 | 说明 |
|------|------|
| `xhs_posts.jsonl` | 小红书帖子模拟数据 |
| `xhs_comments_post1.jsonl` | 帖子 1 的评论模拟数据 |
| `xhs_comments_post2.jsonl` | 帖子 2 的评论模拟数据 |

**规则**：
- 手动编写或从真实数据脱敏得到的模拟数据
- 格式为 JSONL（每行一个 JSON 对象）
- 不依赖网络即可运行测试
- **必须提交到 git**

### 3. 真实平台数据 → `test-data/real/`

| 路径 | 说明 |
|------|------|
| `test-data/real/xhs/` | 小红书通过 opencli 获取的 JSON 数据 |
| `test-data/real/hackernews/` | HackerNews 公开 API 数据 |

**规则**：
- 通过 `opencli` 命令实时获取
- 以平台名作为子目录（`xhs/`、`hackernews/`、`devto/`）
- 文件名包含数据标识（如 note ID、帖子标题关键词）
- **不提交到 git**（通过 `.gitignore` 排除）

### 4. 下载的媒体文件 → `downloads/<platform>/`

| 路径 | 说明 |
|------|------|
| `downloads/xhs/` | 小红书下载的图片和视频 |
| `downloads/weibo/` | 微博下载的媒体文件 |

**规则**：
- opencli 下载命令通过 `--output downloads/<platform>` 指定路径
- 每个 note/帖子一个子目录（以 ID 命名）
- **不提交到 git**（通过 `.gitignore` 排除）

**CLI 模板示例**：
```json
{
  "fetch_media": "opencli xiaohongshu download {note_id} --output downloads/xhs -f json"
}
```

### 5. 测试报告 → `test-data/reports/`

| 文件 | 说明 |
|------|------|
| `test-report.json` | 结构化 JSON 报告 |
| `test-report.md` | 人类可读 Markdown 报告 |

**规则**：
- 由 `test/report.ts` 自动生成
- 每次运行覆盖更新
- **不提交到 git**（通过 `.gitignore` 排除）

## .gitignore 规则

```gitignore
# 测试运行时生成的数据
test-data/real/
test-data/reports/

# 下载的媒体文件
downloads/
```

## 命名约定

### 数据文件

```
{类型}_{标识}.{格式}

示例：
search_shanghai_food.json          # 搜索 "上海美食" 的结果
comments_68835071.json             # note ID 68835071 的评论
media_68835071.json                # note ID 68835071 的媒体信息
top_stories.json                   # HackerNews 热榜
```

### 媒体文件

```
downloads/<platform>/<note_id>/<note_id>_<index>.<ext>

示例：
downloads/xhs/68835071000000001c0358d3/68835071000000001c0358d3_1.jpg
downloads/xhs/68835071000000001c0358d3/68835071000000001c0358d3_2.mp4
```

### 报告文件

```
test-report.{json,md}              # 默认报告（最新一次运行）
test-report-{date}.{json,md}       # 历史报告（可选存档）
```

## 使用流程

### 离线测试（无需网络）

```bash
pnpm test:offline
# 使用 test-data/mock/ 中的数据
```

### 在线测试（需要网络 + opencli）

```bash
pnpm test:integration
pnpm test:xhs
# 实时调用 opencli 获取真实数据
# 媒体文件下载到 downloads/<platform>/
```

### 生成报告

```bash
node --experimental-strip-types test/report.ts
# 输出到 test-data/reports/test-report.{json,md}
```

### 保存真实数据供离线复用

```bash
# 1. 运行在线测试获取真实数据
pnpm test:xhs

# 2. 从 DuckDB 导出数据作为新的 mock 数据
duckdb ~/.analyze-cli/data.duckdb \
  "COPY (SELECT * FROM posts WHERE platform_id LIKE 'xhs_%') TO 'test-data/mock/xhs_posts_export.jsonl' (FORMAT JSON);"

# 3. 复制到 mock 目录供离线测试使用
cp test-data/mock/xhs_posts_export.jsonl test-data/mock/
```
