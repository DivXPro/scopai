# analyze-cli 使用指南

## 工具简介

`analyze-cli` 是一款 AI 驱动的社交媒体内容分析 CLI 工具。它支持导入帖子与评论数据，通过 Anthropic 大模型进行批量分析，并导出结构化结果。

**核心流程：**
```
导入数据 → 创建模板 → 装配任务 → 启动分析 → 查看/导出结果
```

## 环境准备

### 1. 确认 opencli 可用（重要）

**在操作本工具之前，请先阅读 `opencli` skill 的相关文档，确认 `opencli` 已在当前环境正确安装并可用。**

`analyze-cli` 依赖 `opencli` 进行外部数据抓取（如评论、媒体下载）。如果 `opencli` 未配置好，后续 `task prepare-data` 等命令将无法执行。

```bash
# 快速验证 opencli 是否可用
opencli --help
```

### 2. 安装依赖

```bash
pnpm install
```

### 3. 编译

```bash
pnpm build
```

### 4. 确认 CLI 可用

```bash
node ./bin/analyze-cli.js --help
```

## opencli 命令模板说明

**创建任务时，必须传入正确的 `opencli` 命令调用模板。**

如果你的分析流程需要 `task prepare-data` 自动抓取评论或媒体文件，请在 `task create` 时通过 `--cli-templates` 参数传入 JSON 格式的模板。模板中需包含 `{post_id}` 或 `{note_id}` 占位符，例如：

```bash
analyze-cli task create \
  --name "xhs情感分析" \
  --template sentiment-topics \
  --cli-templates '{"fetch_comments":"opencli xhs comments --post-id {post_id} -f json","fetch_media":"opencli xhs media --post-id {post_id} -f json"}'
```

模板变量说明：
- `{post_id}` / `{note_id}`：运行时会被替换为实际帖子 ID
- `{limit}`：可选，抓取数量限制

## 快速开始

### 第一步：导入帖子数据

帖子文件支持 **JSON 数组**（`.json`，推荐）和 **JSONL**（`.jsonl`）格式。

```bash
analyze-cli post import --platform xhs --file ./test-data/mock/xhs_posts.json
```

导入后查看：

```bash
analyze-cli post list --platform xhs --limit 20
```

### 第二步：导入评论数据

```bash
analyze-cli comment import --platform xhs --post-id <post-id> --file ./test-data/mock/xhs_comments.json
```

查看评论：

```bash
analyze-cli comment list --post-id <post-id> --limit 50
```

### 第三步：查看分析模板

```bash
analyze-cli template list
```

### 第四步：创建分析任务

```bash
analyze-cli task create --name "xhs情感分析" --template sentiment-topics
```

### 第五步：绑定分析目标

绑定帖子：

```bash
analyze-cli task add-posts --task-id <task-id> --post-ids <post-id-1>,<post-id-2>
```

绑定评论：

```bash
analyze-cli task add-comments --task-id <task-id> --comment-ids <comment-id-1>,<comment-id-2>
```

### 第六步：启动 Daemon 并执行任务

检查 daemon 状态：

```bash
analyze-cli daemon status
```

启动 daemon（如未运行）：

```bash
analyze-cli daemon start
```

启动任务：

```bash
analyze-cli task start --task-id <task-id>
```

查看进度：

```bash
analyze-cli task status --task-id <task-id>
```

### 第七步：查看和导出结果

查看统计：

```bash
analyze-cli result stats --task-id <task-id>
```

导出为 JSON：

```bash
analyze-cli result export --task-id <task-id> --format json --output ./results.json
```

导出为 CSV：

```bash
analyze-cli result export --task-id <task-id> --format csv --output ./results.csv
```

## 数据文件格式

### 帖子导入文件（JSON 数组，推荐）

```json
[
  {
    "noteId": "abc123",
    "displayTitle": "标题",
    "desc": "正文内容",
    "user": { "userId": "u1", "nickname": "用户昵称" },
    "interactInfo": { "likedCount": 100, "collectedCount": 10, "commentCount": 5 },
    "type": "text",
    "lastUpdateTime": "2025-04-10T10:30:00.000Z"
  }
]
```

### 帖子导入文件（JSONL）

每行一个 JSON 对象：

```jsonl
{"noteId": "abc123", "displayTitle": "标题", "desc": "正文内容", ...}
{"noteId": "def456", "displayTitle": "标题2", "desc": "正文内容2", ...}
```

### 评论导入文件

与帖子类似，每行一个 JSON 对象（JSONL）或 JSON 数组（`.json`）：

```json
[
  {
    "id": "cmt001",
    "content": "评论内容",
    "user": { "userId": "u2", "nickname": "评论者" },
    "likeCount": 10,
    "publishedAt": "2025-04-10T11:00:00.000Z"
  }
]
```

## 常用命令速查

| 命令 | 说明 |
|------|------|
| `post import --platform <id> --file <path>` | 导入帖子 |
| `post list --platform <id>` | 列出帖子 |
| `post search --platform <id> --query <keyword>` | 搜索帖子 |
| `comment import --platform <id> --post-id <id> --file <path>` | 导入评论 |
| `comment list --post-id <id>` | 列出评论 |
| `template list` | 查看模板 |
| `task create --name <name> [--template <name>]` | 创建任务 |
| `task add-posts --task-id <id> --post-ids <ids>` | 绑定帖子 |
| `task add-comments --task-id <id> --comment-ids <ids>` | 绑定评论 |
| `task start --task-id <id>` | 启动分析任务 |
| `task status --task-id <id>` | 查看任务进度 |
| `task list` | 列出所有任务 |
| `daemon status` | 查看 daemon 状态 |
| `daemon start` | 启动 daemon |
| `daemon stop` | 停止 daemon |
| `result stats --task-id <id>` | 查看结果统计 |
| `result export --task-id <id> --format <json/csv> --output <path>` | 导出结果 |

## 注意事项

- **opencli 是前置依赖**：使用 `analyze-cli` 前请确保 `opencli` 已正确安装，并熟悉其基本用法。
- **必须传入正确的 opencli 命令模板**：需要 `prepare-data` 自动抓数据时，`task create` 的 `--cli-templates` 必须包含有效的 `opencli` 命令，且带有 `{post_id}` 或 `{note_id}` 占位符。
- **数据文件格式**：默认优先使用 `.json`（JSON 数组），`.jsonl` 也继续支持。
- **平台 ID**：导入时请确保 `--platform` 与实际数据源一致，便于后续检索。
- **任务启动前务必启动 daemon**，否则任务无法被 worker 消费。
- **结果导出**：JSON 格式便于二次处理，CSV 格式便于在表格软件中查看。
- 所有数据存储在本地 DuckDB 文件中（默认 `~/.analyze-cli/data.duckdb`）。
