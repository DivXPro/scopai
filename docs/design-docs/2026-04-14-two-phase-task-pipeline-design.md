# 两阶段任务流水线设计

> 日期：2026-04-14
> 状态：设计中

## 目标

在现有 `scopai` 架构之上，实现一个端到端的任务执行流水线：

1. Agent 输入任务指令（含帖子 IDs + opencli 调用模板）
2. 阶段一（数据准备）：遍历帖子，调用 opencli 下载媒体/评论，导入 DuckDB
3. 阶段二（LLM 分析）：复用 daemon/worker 链路完成分析
4. 支持任务中断后断点恢复，避免数据重复下载

## 架构

```
┌─────────────────────────────────────────────────────┐
│  Agent 输入                                          │
│  - task create（名称、模板、CLI 模板）               │
│  - task add-posts（帖子 IDs）                        │
│  - task prepare-data（触发数据准备）                 │
│  - task start（触发 LLM 分析，已有）                 │
└──────────────────┬──────────────────────────────────┘
                   │
         ▼
┌─────────────────────────────────────┐
│  Phase 1: task prepare-data         │
│  - 读取 task 绑定的帖子 IDs          │
│  - 遍历每个帖子                      │
│    a. 检查 task_post_status 状态     │
│    b. 若未下载 → 调 opencli 下载     │
│    c. 将媒体/评论导入 DuckDB         │
│    d. 更新 task_post_status          │
│  - 完成后生成统计报告                │
└──────────────────┬──────────────────┘
                   │
         ▼
┌─────────────────────────────────────┐
│  Phase 2: task start（已有链路）     │
│  - 为未分析的目标创建 queue_job      │
│  - daemon/worker 轮询执行            │
│  - 调 Anthropic → 写回分析结果      │
└─────────────────────────────────────┘
```

## 数据模型

### 新增表：`task_post_status`

记录每个 task 中每个帖子的数据准备进度，用于断点恢复。

```sql
CREATE TABLE task_post_status (
  task_id VARCHAR NOT NULL,
  post_id VARCHAR NOT NULL,
  comments_fetched BOOLEAN DEFAULT FALSE,
  media_fetched BOOLEAN DEFAULT FALSE,
  comments_count INTEGER DEFAULT 0,
  media_count INTEGER DEFAULT 0,
  status VARCHAR DEFAULT 'pending',  -- pending | fetching | done | failed
  error VARCHAR,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (task_id, post_id)
);
```

| 字段 | 说明 |
|------|------|
| `comments_fetched` | 评论是否已下载并导入 |
| `media_fetched` | 媒体是否已下载并导入 |
| `comments_count` | 已导入的评论数 |
| `media_count` | 已导入的媒体数 |
| `status` | 帖子整体状态 |
| `error` | 失败时的错误信息 |

### 扩展表：`tasks`

在 `tasks` 表中新增 `cli_templates` 字段，存储 Agent 传入的 opencli 调用模板。

```sql
ALTER TABLE tasks ADD COLUMN cli_templates VARCHAR;
```

`cli_templates` 为 JSON 字符串，格式：

```json
{
  "fetch_comments": "opencli weibo comments --post-id {post_id} --limit {limit} -f json",
  "fetch_media": "opencli weibo download --post-id {post_id} -f json"
}
```

如果某个帖子不需要某种数据，对应模板可以省略。

## 模块变更

### 1. 新增 `src/cli/task-prepare.ts`（`task prepare-data` 命令）

**命令签名：**

```
scopai task prepare-data --task-id <taskId> [--concurrency N] [--retry]
```

**执行流程：**

1. 读取 task 信息（含 `cli_templates`）
2. 查询 task 绑定的所有帖子 IDs
3. 遍历帖子：
   - 读取/创建 `task_post_status` 记录
   - 如果 `comments_fetched == false` 且模板中有 `fetch_comments`：
     - 执行 `opencli` 命令（替换 `{post_id}` 占位符）
     - 解析输出，调用 `comment import` 逻辑导入 DB
     - 更新 `task_post_status.comments_fetched = true`
   - 如果 `media_fetched == false` 且模板中有 `fetch_media`：
     - 执行 `opencli` 命令
     - 解析输出，调用 `media import` 逻辑导入 DB
     - 更新 `task_post_status.media_fetched = true`
4. 输出统计（成功/跳过/失败的帖子数）

**断点恢复：**

- 执行前先读 `task_post_status`，跳过 `comments_fetched` 或 `media_fetched` 已为 `true` 的记录
- 中断后重新执行只处理未完成的部分

### 2. 修改 `src/cli/task.ts`

- 在 `task create` 中新增 `--cli-templates` 参数
- 在 `task start` 中过滤已分析过的目标，避免重复创建 queue_job

### 3. 新增 `src/data-fetcher/opencli.ts`

负责：
- 接收 CLI 模板字符串和占位符值
- 替换占位符后执行 `opencli` 命令
- 解析 JSON 输出并返回结构化数据

```typescript
export interface FetchResult {
  success: boolean;
  data?: unknown[];
  error?: string;
}

export async function fetchViaOpencli(
  template: string,
  vars: Record<string, string>,
): Promise<FetchResult>;
```

### 4. 修改 `src/db/tasks.ts`

- 新增 `updateTaskPostStatus()` 函数
- 新增 `getTaskPostStatuses()` 函数

### 5. 修改 `src/shared/types.ts`

- 新增 `TaskPostStatus` 类型定义
- 扩展 `Task` 类型，增加 `cli_templates` 字段

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| opencli 命令超时 | 标记 `status = 'failed'`，记录 error，继续处理下一个帖子 |
| opencli 返回空数据 | 视为正常，标记 fetched = true，count = 0 |
| 数据导入失败 | 标记 `status = 'failed'`，记录 error |
| 重复执行 prepare-data | 通过 task_post_status 跳过已完成部分 |
| 模板中缺少占位符 | 运行时报错并中止整个 task |

## CLI 使用示例

```bash
# 1. 创建任务，传入 opencli 调用模板
scopai task create \
  --name "微博舆情分析" \
  --template sentiment_analysis \
  --cli-templates '{"fetch_comments":"opencli weibo comments --post-id {post_id} --limit 100 -f json","fetch_media":"opencli weibo download --post-id {post_id} -f json"}'

# 2. 绑定帖子 IDs
scopai task add-posts --task-id <taskId> --post-ids "p1,p2,p3"

# 3. 执行数据准备（可重复执行，自动断点恢复）
scopai task prepare-data --task-id <taskId>

# 4. 启动 LLM 分析
scopai task start --task-id <taskId>

# 5. 查看进度
scopai task status --task-id <taskId>

# 6. 导出结果
scopai result export --task-id <taskId> --format json --output result.json
```

## 不变的部分

以下模块和流程不做修改：

- `src/daemon/` — daemon 和 worker pool 逻辑不变
- `src/worker/` — consumer、anthropic、parser 逻辑不变
- `src/db/queue-jobs.ts` — 队列 CRUD 不变
- `src/db/comments.ts`、`src/db/media-files.ts` — 导入逻辑不变，只新增调用方
