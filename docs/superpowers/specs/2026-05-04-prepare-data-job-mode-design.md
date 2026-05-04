# 数据准备阶段 Job 模式改造设计

## 背景

当前数据准备阶段（prepare-data）通过 `runPrepareDataAsync` 串行遍历所有 pending post，逐个执行 fetch_note → fetch_comments → fetch_media。状态追踪依赖 `task_post_status` 表，但存在以下问题：

- 失败后无自动重试，只能手动重新触发整个 prepare-data
- Web UI 没有数据准备状态的展示
- 无法单独重试某个失败帖子
- 与分析阶段的 job 模式不统一

## 目标

将数据准备阶段改造为 job 模式，复用现有 `queue_jobs` 表和 consumer 框架，实现：

1. 每个 pending post 创建一个 `target_type='prepare'` 的 job
2. 独立 consumer 串行消费 prepare job
3. 失败 job 自动重试（max_attempts=3），支持手动重试
4. TaskDetail 页面展示数据准备进度和状态

## 方案：复用 queue_jobs 表

在现有 `queue_jobs` 表中增加 `target_type='prepare'`，复用 job 状态机、重试逻辑和事件通知。

### 选择理由

- 复用现有状态机（pending → processing → completed/failed）、requeueJob、retryFailedJobs
- API 路由和事件通知天然可用
- 不需要新建表和重复实现状态管理
- 与分析 job 统一展示入口

### 类型扩展

`target_type` 扩展为 `'post' | 'comment' | 'media' | 'prepare'`。

`strategy_id` 对 prepare job 为 null。

## 详细设计

### 1. Job 创建与入队

改造 `task.prepareData` handler：

```
输入: task_id
流程:
  1. 校验 task 存在且 cli_templates 非空
  2. 获取 pending post 列表 (getPendingPostIds)
  3. 为每个 post 创建 prepare job:
     - id: generateId()
     - task_id: taskId
     - strategy_id: null
     - target_type: 'prepare'
     - target_id: postId
     - status: 'pending'
     - priority: 0
     - attempts: 0
     - max_attempts: 3
  4. enqueueJobs(jobs) → notifyJobAvailable()
  5. 返回 { started: true, jobCount: jobs.length }
```

移除 `runPrepareDataAsync` 函数和 `prepareDataRunning` 并发控制 Set。

### 2. Consumer 处理分支

#### processJob 路由

```typescript
async function processJob(job, workerId) {
  if (job.target_type === 'prepare') {
    await processPrepareJob(job, workerId);
    return;
  }
  // 原有策略分析逻辑不变
  await processStrategyJob(job, task, workerId);
}
```

#### processPrepareJob 逻辑

从 `runPrepareDataAsync` 中提取单个 post 的处理逻辑：

```
输入: job (target_type='prepare', target_id=postId)
流程:
  1. 获取 post 元数据和 task 的 cli_templates
  2. 构造 fetchVars (post_id, note_id, url, platform, download_dir)
  3. 标记 task_post_status: status='fetching'
  4. Step 1: fetch_note
     - 如果 cliTemplates.fetch_note 存在 → fetchViaOpencli
     - 成功 → normalizePostItem + updatePost
     - 失败 → 抛出异常（consumer 会 requeueJob）
     - 无模板 → 跳过
  5. Step 2: fetch_comments
     - 如果 !comments_fetched 且 cliTemplates.fetch_comments 存在 → fetchViaOpencli
     - 成功 → importCommentsToDb + upsertTaskPostStatus({ comments_fetched: true })
     - 失败 → 抛出异常
     - 无模板 → upsertTaskPostStatus({ comments_fetched: true })
  6. Step 3: fetch_media
     - 如果 !media_fetched 且有 fetch_media 模板 → fetchViaOpencli
     - 成功 → importMediaToDb + upsertTaskPostStatus({ media_fetched: true }) + syncWaitingMediaJobs
     - 失败 → 抛出异常
     - 无模板 → upsertTaskPostStatus({ media_fetched: true })
  7. 全部完成 → upsertTaskPostStatus({ status: 'done' }) + buildJobsForPost
```

**关键变化：** fetch_comments/fetch_media 失败时抛出异常而非继续执行。`comments_fetched`/`media_fetched` 标志在 task_post_status 中持久化，job 重试时自动跳过已完成子步骤。

#### 独立 prepare consumer

在 `index.ts` 中启动独立的 prepare consumer：

```typescript
// 1 个 prepare worker（串行）
registerWorker('prepare');
workerPromises.push(runPrepareConsumer('prepare').catch(...));

// N 个 analysis worker（并发）
for (let i = 0; i < WORKER_CONCURRENCY; i++) {
  registerWorker(i);
  workerPromises.push(runConsumer(i).catch(...));
}
```

`runPrepareConsumer` 与 `runConsumer` 结构相同，但 `getNextJobs` 只认领 `target_type='prepare'` 的 job。实现方式：`getNextJobs` 增加 `targetType?: string` 参数，在 SQL WHERE 条件中追加 `AND target_type = $targetType`。分析 consumer 调用 `getNextJobs(need)`（无 targetType 过滤，认领所有非 prepare job），prepare consumer 调用 `getNextJobs(1, 'prepare')`。

### 3. 重试与恢复

**自动重试：** 复用现有 consumer 生命周期——prepare job 失败后 `requeueJob`（attempts 不重置），最多 3 次。

**手动重试：**
- `POST /api/queue/retry` — 重试所有 failed job（含 prepare job）
- `POST /api/tasks/:id/prepare-data` — 为当前 pending 的 post 创建新 job（断点续传）

**启动恢复：** `recoverStalledJobs()` 已覆盖所有 target_type，prepare job 的残留 processing 状态会被恢复。

**子步骤断点续传：** `comments_fetched`/`media_fetched` 在 task_post_status 中持久化，job 重试时跳过已完成子步骤。

### 4. UI 展示

#### TaskDetail 页面增加"数据准备"区域

在分析步骤列表上方，增加可折叠区域：

```
┌─────────────────────────────────────────┐
│ 数据准备                    ▼ 展开      │
├─────────────────────────────────────────┤
│ ● 已完成 8/10  ○ 处理中 1  ✕ 失败 1    │
│                                         │
│ [重试失败项]                             │
│                                         │
│ 帖子列表（失败项高亮）：                  │
│ ✓ 帖子标题1  note✓ comments✓ media✓    │
│ ✓ 帖子标题2  note✓ comments✓ media✓    │
│ ⋯ 帖子标题9  处理中...                  │
│ ✕ 帖子标题10  note✓ media✗ 错误信息     │
└─────────────────────────────────────────┘
```

#### API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tasks/:id/prepare-jobs` | 返回该任务下所有 prepare job 列表（含 post 标题、子步骤状态、错误信息） |
| POST | `/api/tasks/:id/prepare-jobs/retry` | 重试该任务下失败的 prepare job |

#### 数据来源

从 `queue_jobs`（target_type='prepare'）+ `task_post_status` 联合查询，组装完整展示信息。

### 5. 需要改动的文件

| 文件 | 改动 |
|------|------|
| `packages/core/src/shared/types.ts` | target_type 扩展增加 'prepare' |
| `packages/core/src/db/queue-jobs.ts` | getNextJobs 增加 targetType 参数 |
| `packages/api/src/daemon/handlers.ts` | task.prepareData 改为创建 job；移除 runPrepareDataAsync |
| `packages/api/src/worker/consumer.ts` | processJob 增加 prepare 分支；新增 processPrepareJob |
| `packages/api/src/worker/prepare-consumer.ts` | 新文件：独立 prepare consumer |
| `packages/api/src/index.ts` | 启动 prepare consumer |
| `packages/api/src/routes/tasks.ts` | 增加 prepare-jobs 相关端点 |
| `packages/ui/src/pages/TaskDetail.tsx` | 增加数据准备区域 |

### 6. 不在范围内

- 数据准备并发执行（当前技术限制只能串行）
- QueueMonitor 页面展示 prepare job（在 TaskDetail 中展示即可）
- CLI task-prepare 轮询逻辑改造（保持现有行为，job 入队后 CLI 可轮询 task 状态）