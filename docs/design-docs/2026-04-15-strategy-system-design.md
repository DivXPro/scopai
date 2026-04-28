# 分析套路系统设计

## 背景

现有系统对帖子/评论/媒体的 AI 分析是固定 Schema 的（情感、风险、关键词等），不同分析维度共享同一套输出结构。用户希望：

1. 支持多种「分析套路」，每种套路有不同的提示词和输出结构
2. 套路可动态增加，不改代码
3. 分析时通过 CLI 参数选择套路
4. 支持对已有帖子追加新套路分析
5. 套路可同时利用帖子文字和媒体附件
6. 逐步迁移到新套路体系，旧表保留共存

## 核心设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 套路定义格式 | JSON 文件 | 用户指定：灵活、声明式 |
| 套路存储 | 数据库 + 策略文件 | 导入时写入 `strategies` 表 |
| 数据存储 | 混合：数值列 + JSON 字段 | 用户指定：便于统计 + 灵活扩展 |
| 向后兼容 | 共存，逐步迁移 | 新套路系统为主线，旧表保留 |
| 媒体附件处理 | 套路声明式（`needs_media`） | 自动注入，无需改提示词 |
| 追加分析 | Task 和套路正交 | 同一 Task 可跑多个套路 |
| 套路加载时机 | 显式 `strategy import` 命令 | 用户手动导入，可预览验证 |

## 1. 套路定义文件格式

放在项目目录下 `strategies/` 目录，JSON 格式。

### 1.1 文件结构

```json
{
  "id": "replicability-v1",
  "name": "可复刻性分析",
  "description": "判断商品推广类帖子是否可以让小团队复刻",
  "version": "1.0.0",
  "target": "post",
  "needs_media": {
    "enabled": true,
    "media_types": ["image", "video"],
    "max_media": 5,
    "mode": "all"
  },
  "prompt": "你是一个内容分析专家，请分析以下帖子的可复刻性...\n\n帖子内容：\n{{content}}\n\n作者：{{author_name}}\n平台：{{platform}}\n发布于：{{published_at}}\n\n{{#if media_urls}}\n配图/视频：\n{{#each media_urls}}\n{{this}}\n{{/each}}\n{{/if}}",
  "output_schema": {
    "columns": [
      {
        "name": "replicate_score",
        "type": "number",
        "label": "综合可复刻性得分",
        "min": 1,
        "max": 5
      },
      {
        "name": "product_signal_score",
        "type": "number",
        "label": "产品信号得分",
        "min": 1,
        "max": 5
      },
      {
        "name": "content_complexity_score",
        "type": "number",
        "label": "内容复杂度得分",
        "min": 1,
        "max": 5
      },
      {
        "name": "barrier_level",
        "type": "enum",
        "label": "壁垒等级",
        "enum_values": ["low", "medium", "high"]
      }
    ],
    "json_fields": [
      {
        "name": "product_signals",
        "type": "array",
        "label": "产品信号标签列表",
        "items_label": "信号"
      },
      {
        "name": "content_signals",
        "type": "array",
        "label": "内容生产信号标签列表",
        "items_label": "信号"
      },
      {
        "name": "platform_signals",
        "type": "array",
        "label": "流量机制信号标签列表",
        "items_label": "信号"
      },
      {
        "name": "recommendation",
        "type": "enum",
        "label": "复刻建议",
        "enum_values": ["high", "medium", "low"]
      },
      {
        "name": "quick_verdict",
        "type": "string",
        "label": "一句话判断"
      }
    ]
  }
}
```

### 1.2 模板变量与媒体注入

提示词中可使用的变量：

| 变量 | 说明 |
|------|------|
| `{{content}}` | 帖子正文内容 |
| `{{title}}` | 帖子标题（可能为空） |
| `{{author_name}}` | 作者名称 |
| `{{platform}}` | 平台名称 |
| `{{published_at}}` | 发布时间 |
| `{{media_urls}}` | 媒体文件列表字符串（当 `needs_media.enabled=true` 时自动注入） |
| `{{tags}}` | 标签列表 |

**媒体注入说明**：
- 现有代码的 `fillTemplate` 只支持简单字符串替换，不兼容 Handlebars 条件/循环语法。
- 媒体文件列表会预先格式化为一段文本（如 `\n[配图 1] /path/to/img.jpg\n[配图 2] /path/to/img2.jpg\n`），直接替换 `{{media_urls}}`。
- 若帖子无媒体或过滤后为空，则注入空字符串。
- **优先使用 `local_path`**，若不存在则 fallback 到 `url`。

### 1.3 支持的 target 类型

| target | 说明 |
|--------|------|
| `post` | 帖子分析 |
| `comment` | 评论分析 |

> `needs_media.enabled` 控制帖子分析时是否自动加载关联的媒体文件，不再单独设 `post_with_media` target。这样 `target` 与 `analysis_results.target_type` 完全对齐，避免概念混淆。

## 2. 数据库设计

### 2.1 新增表

```sql
-- 套路定义表
CREATE TABLE IF NOT EXISTS strategies (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    version         TEXT NOT NULL DEFAULT '1.0.0',
    target          TEXT NOT NULL CHECK(target IN ('post', 'comment')),
    needs_media     JSON,  -- 序列化 needs_media 配置
    prompt          TEXT NOT NULL,
    output_schema   JSON NOT NULL,  -- columns + json_fields
    file_path       TEXT,  -- 来源文件路径
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

-- 统一分析结果表
CREATE TABLE IF NOT EXISTS analysis_results (
    id              TEXT PRIMARY KEY,
    task_id         TEXT REFERENCES tasks(id),
    strategy_id     TEXT REFERENCES strategies(id),
    strategy_version TEXT NOT NULL, -- 执行时策略的版本号，防止后续更新导致统计口径不一致
    target_type     TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
    target_id       TEXT NOT NULL,
    post_id         TEXT REFERENCES posts(id), -- 冗余字段，方便评论分析结果按帖子聚合
    columns         JSON NOT NULL,  -- 数值列结果
    json_fields     JSON NOT NULL,  -- JSON 字段结果
    raw_response    JSON,
    error           TEXT,
    analyzed_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE(task_id, strategy_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_results_task ON analysis_results(task_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_strategy ON analysis_results(strategy_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_target ON analysis_results(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_post ON analysis_results(post_id);

-- queue_jobs 扩展：支持策略与媒体等待状态
CREATE TABLE IF NOT EXISTS queue_jobs (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    strategy_id     TEXT REFERENCES strategies(id), -- 新套路系统的策略 ID
    target_type     TEXT,
    target_id       TEXT,
    status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','waiting_media','processing','completed','failed')),
    priority        INTEGER DEFAULT 0,
    attempts        INTEGER DEFAULT 0,
    max_attempts    INTEGER DEFAULT 3,
    error           TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    processed_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_queue_jobs_status ON queue_jobs(status);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_strategy ON queue_jobs(strategy_id);
```

### 2.2 动态解析器（Dynamic Parser）

新套路系统不再使用硬编码的 `parseCommentResult` / `parseMediaResult`，而是基于 `output_schema` 动态解析：

1. **字段匹配**：AI 返回的 JSON key 与 `output_schema.columns` 和 `json_fields` 的 `name` 严格匹配（大小写敏感）。
2. **缺失字段处理**：
   - `number` 类型缺失 → `null`
   - `enum` 类型缺失 → `null`
   - `array` 类型缺失 → `[]`
   - `string` 类型缺失 → `null`
3. **类型校验与转换**：
   - `number`：若 AI 返回字符串形式的数字（如 `"4.5"`），自动 `parseFloat`
   - `enum`：校验值是否在 `enum_values` 范围内，不在则 `null`
   - `array`：若不是数组则包装成单元素数组 `[value]`，无法转换则 `[]`
   - `string`：强制 `String()` 转换
4. **容错**：AI 返回非 JSON 时，先尝试用正则提取 `{}` 内内容；若仍失败，整条记录标记 `error`。

### 2.3 动态列映射

`output_schema.columns` 中的每个字段在数据库中实际存储为：

- `analysis_results.columns` JSON 中存储（运行时动态）
- SQLite 不支持 ALTER TABLE ADD COLUMN 动态扩展，用 JSON 列模拟

统计查询时，通过 JSON 路径提取：
```sql
SELECT json_extract(columns, '$.replicate_score') as score FROM analysis_results WHERE strategy_id = 'replicability-v1'
```

### 2.4 与旧表的关系

| 旧表 | 状态 | 说明 |
|------|------|------|
| `analysis_results_comments` | 保留共存 | 现有评论分析结果 |
| `analysis_results_media` | 保留共存 | 现有媒体分析结果 |
| `prompt_templates` | 逐步迁移 | 套路文件替代模板定义 |

## 3. CLI 接口设计

### 3.1 套路管理命令

```bash
# 查看所有已导入的套路
scopai strategy list

# 导入单个套路文件
scopai strategy import ./strategies/replicability-v1.json

# 导入整个目录
scopai strategy import-all ./strategies/

# 查看套路详情
scopai strategy show replicability-v1

# 删除套路（仅删除记录，不删文件）
scopai strategy remove replicability-v1
```

### 3.2 分析命令

> **与旧命令的关系**：`task start` 继续支持旧模板系统（基于 `prompt_templates`）。新套路系统使用独立的 `analyze` 命令，避免用户混淆。

```bash
# 创建分析任务并运行（指定套路）
scopai analyze run --task-id xxx --strategy replicability-v1

# 追加分析（已有 task 上加新套路）
scopai analyze append --task-id xxx --strategy replicability-v1

# 对单个帖子追加分析（自动创建临时 task）
scopai analyze append --post-id xxx --strategy replicability-v1

# 批量追加分析（多个帖子 + 多个套路）
scopai analyze append --task-id xxx --strategy replicability-v1,sentiment-v1

# 手动同步 waiting_media 状态的 jobs（通常在 task prepare-data 后执行）
scopai analyze sync --task-id xxx
```

### 3.3 结果查看命令

```bash
# 查看某策略的分析结果统计
scopai result stats --strategy replicability-v1

# 导出分析结果
scopai result export --task-id xxx --strategy replicability-v1 --format json
```

## 4. 执行流程

### 4.1 套路导入流程

```
strategy import ./strategies/replicability-v1.json
  ↓
读取 JSON 文件
  ↓
校验 schema 完整性（id, name, target, prompt, output_schema 必须有）
  ↓
检查 strategies 表是否已有该 id
  ↓
  ├─ 已存在且版本相同 → 跳过
  ├─ 已存在但版本更新 → 更新记录
  └─ 不存在 → INSERT 新记录
  ↓
输出：套路「可复刻性分析」(replicability-v1) 导入成功
```

### 4.2 分析执行流程

```
analyze run --task-id xxx --strategy replicability-v1
  ↓
加载套路定义 from strategies 表
  ↓
根据 target 类型获取待分析实体：
  ├─ target=post → posts 表
  └─ target=comment → comments 表
  ↓
检查是否已有该 (task_id, strategy_id, target_id) 的结果 → 跳过已分析的
  ↓
确定 job 初始状态：
  ├─ needs_media.enabled = false → status = pending
  └─ needs_media.enabled = true
       ├─ 检查 task_post_status.media_fetched = true → status = pending
       └─ task_post_status.media_fetched = false → status = waiting_media
  ↓
构建提示词：
  ├─ 填充 {{content}}, {{author_name}} 等变量
  └─ 若 needs_media.enabled=true，注入格式化后的 media_urls（优先 local_path）
  ↓
调用 AI 分析（仅 pending 的 jobs 会被 Worker 消费）
  ↓
解析输出，按 output_schema 动态拆分到 columns + json_fields
  ↓
写入 analysis_results 表
```

### 4.3 媒体附件注入逻辑

当 `needs_media.enabled=true` 时：

1. 根据 `needs_media.media_types` 过滤：`["image"]` → 只取图片
2. 根据 `needs_media.max_media` 限制数量
3. 根据 `needs_media.mode` 选择：
   - `"all"`：取所有媒体
   - `"first_n"`：取前 N 个
   - `"best_quality"`：按 width × height 排序取最大的
4. **优先使用 `local_path`**，若不存在则 fallback 到 `url`
5. 将媒体文件列表格式化为一段文本，替换 `{{media_urls}}` 占位符

### 4.4 媒体就绪控制机制（Waiting Media）

核心问题：若套路需要媒体文件，但 `task prepare-data` 尚未完成下载，分析 Job 不能直接入队执行。

**解决方案**：

1. **`queue_jobs.status` 新增 `waiting_media` 状态**
2. **`analyze run/append` 创建 jobs 时自动判断**：
   - 查询 `task_post_status` 表，确认该帖子 `media_fetched` 是否为 `true`
   - `true` → job `status = pending`（Worker 可正常消费）
   - `false` → job `status = waiting_media`（Worker 跳过）
3. **`task prepare-data` 完成后自动唤醒**：
   - 每个帖子完成媒体下载后，执行 `syncWaitingMediaJobs(taskId, postId)`
   - 将 `queue_jobs` 中该 `task_id + target_id(post_id) + status = waiting_media` 的记录更新为 `pending`
4. **手动同步兜底**：
   - `scopai analyze sync --task-id xxx` 可手动扫描并唤醒所有 `waiting_media` 的 jobs

**为什么不用 Task 绑定策略？**
- 保持 Task（分析范围）和 Strategy（分析方法）正交
- `task prepare-data` 不需要知道未来会用什么策略分析
- 只要有 `waiting_media` 的 job 关联到该 post，prepare-data 完成后就能自动唤醒

## 5. 输出结构示例

套路 `replicability-v1` 的 AI 返回：

```json
{
  "replicate_score": 3.5,
  "product_signal_score": 4.0,
  "content_complexity_score": 3.0,
  "barrier_level": "medium",
  "product_signals": ["标品", "客单价低", "可在1688找到同款"],
  "content_signals": ["手机实拍", "生活场景", "无特效"],
  "platform_signals": ["强情绪钩子", "蹭热点话题"],
  "recommendation": "medium",
  "quick_verdict": "产品门槛低，但内容制作需要一定创意能力"
}
```

存入数据库后：

```sql
-- columns 字段
{ "replicate_score": 3.5, "product_signal_score": 4.0, "content_complexity_score": 3.0, "barrier_level": "medium" }

-- json_fields 字段
{ "product_signals": [...], "content_signals": [...], "platform_signals": [...], "recommendation": "medium", "quick_verdict": "..." }
```

## 6. 实现优先级

### P0（核心闭环）
1. `strategies` 表 + CRUD 操作
2. `strategy import` 命令（JSON 解析 + 校验）
3. `analysis_results` 表
4. `analyze run` 命令（post 类型套路）
5. Worker 支持新套路分析

### P1（媒体支持）
6. `needs_media` 注入逻辑与 `waiting_media` 状态流转
7. `analyze sync` 命令

### P2（追加分析）
8. `analyze append` 命令
9. 统计查询支持（JSON 路径提取）

### P3（工具链）
10. `strategy list/show/remove` 命令
11. 结果导出功能
12. 套路文件模板示例

## 7. 待验证假设

- [ ] 套路 JSON schema 能否覆盖所有常见分析维度（分数、标签、枚举、文本）
- [ ] JSON 列存储的数值字段，统计查询性能是否可接受（可加 SQLite expression index 优化）
- [ ] `needs_media` 的多图注入是否对主流 AI 模型友好（图像数量限制）
- [ ] `waiting_media` 机制在批量任务场景下是否稳定（大量 jobs 的状态转换性能）
