# Streaming Analysis 设计文档

## 背景

当前任务流程中，数据准备（`task.prepareData`）和分析（`task.runAllSteps`）是两个完全解耦的阶段：

1. `prepareData` 拉取所有帖子的详情、评论、媒体元数据
2. 全部完成后任务状态变为 `pending`
3. 用户手动调用 `runAllSteps` 才开始分析

这导致大任务的总耗时 = 数据准备串行时间 + 分析串行时间，无法重叠。

## 目标

实现**流式分析**：单个帖子数据准备就绪后，立即为其触发分析 jobs，让数据准备和分析两个阶段并行执行，缩短总耗时。

## 架构设计

```
                    ┌─────────────────────────┐
                    │   CLI (task prepare)    │
                    └──────────┬──────────────┘
                               │ task.prepareData
                               ▼
┌──────────────────────────────────────────────────────────┐
│                      Daemon Process                      │
│  ┌──────────────┐     ┌──────────────────┐             │
│  │ runPrepare   │────▶│ Stream Scheduler │             │
│  │ DataAsync()  │     │ (新增模块)        │             │
│  └──────────────┘     └────────┬─────────┘             │
│                                │                         │
│                                ▼ enqueue jobs            │
│                       ┌──────────────────┐              │
│                       │   queue_jobs     │              │
│                       └────────┬─────────┘              │
│                                │                         │
│                                ▼                         │
│                       ┌──────────────────┐              │
│                       │ Analysis Worker  │              │
│                       └──────────────────┘              │
└──────────────────────────────────────────────────────────┘
```

## 组件设计

### 1. Stream Scheduler (`src/daemon/stream-scheduler.ts`)

**职责**：监听帖子数据就绪事件，为每个 step 自动创建 analysis jobs。

**核心接口**：

```typescript
export async function onPostReady(
  taskId: string,
  postId: string,
): Promise<{ enqueued: number; skipped: number }>
```

**处理逻辑**：
1. 获取 task 下所有 `pending` 状态的 steps
2. 对每个 step：
   - 加载 strategy，检查 `needs_media` 依赖是否满足
   - 解析需要分析的 targets（post / 其 comments）
   - 为每个 target 创建 `queue_job`（`status='pending'`）
3. 更新 step 的 `stats.total`（累加本次新增的 jobs 数量）

**媒体依赖检查**：
```typescript
// 若 strategy.needs_media 存在，需确认该帖子的媒体已全部下载
const mediaReady = !strategy.needs_media || await isPostMediaDownloaded(taskId, postId);
if (!mediaReady) continue; // 跳过，等媒体下载完成后再触发
```

### 2. `runPrepareDataAsync` 改造

在 `src/daemon/handlers.ts` 中，每处理完一个帖子后通知调度器：

```typescript
// 在帖子数据拉取完成后
await upsertTaskPostStatus(taskId, postId, { status: 'done' });

// 新增：触发流式调度
const { enqueueJobsForPost } = await import('./stream-scheduler');
await enqueueJobsForPost(taskId, postId).catch(err => {
  // 调度失败不影响数据准备继续，记录到 step error 中
  console.error(`[stream-scheduler] failed to enqueue for ${taskId}/${postId}:`, err);
});
```

### 3. `task.step.run` 行为调整

保留手动触发能力，但改为**仅对尚未 enqueue 的 targets 补漏**：

```typescript
// 过滤掉该 step 已存在 queue_jobs 的 targets
const existingTargets = await getExistingJobTargets(taskId, step.id);
const newTargets = relevantTargets.filter(t => !existingTargets.has(t.target_id));
```

这样用户仍可手动触发 `task.step.run`，调度器不会重复创建 jobs。

## 数据流

```
runPrepareDataAsync 处理帖子 P1:
  1. 拉取 fetch_note → UPDATE posts
  2. 拉取 fetch_comments → INSERT comments + UPDATE task_post_status
  3. 拉取 fetch_media → INSERT media_files + UPDATE task_post_status
  4. UPSERT task_post_status (P1, status='done')
     └── 触发 scheduler.onPostReady(taskId, postId)
         └── 遍历 task 的所有 pending steps:
             step.target='post' → 为 P1 创建 queue_job (status='pending')
             step.target='comment' → 为 P1 的所有 comments 创建 queue_jobs
             step.needs_media → 检查媒体下载状态，满足才创建
```

## 状态流转对比

| 阶段 | 当前（批量） | 新设计（流式） |
|------|-------------|--------------|
| 数据准备 | 全部帖子完成后统一 task.status=pending | 每帖完成即触发调度 |
| 分析触发 | 用户手动 `task.runAllSteps` | 自动由调度器驱动 |
| step 状态 | `pending → running → completed` | 相同，running 在第一个帖子就绪时触发 |
| 手动触发 | `task.step.run` 批量创建 | 保留，仅对未处理的帖子补漏 |

## Schema 变更

### queue_jobs 表新增 strategy_id 字段

```sql
ALTER TABLE queue_jobs ADD COLUMN strategy_id TEXT REFERENCES strategies(id);
```

**原因**：
- 当前 `task.step.run` 创建 jobs 时传入了 `strategy_id`，但表中没有该字段
- Stream Scheduler 需要 strategy_id 来确定如何为 step 创建 jobs
- 补全字段后，Analysis Worker 可直接通过 `queue_jobs.strategy_id` 加载 prompt

## 错误处理

| 场景 | 行为 |
|------|------|
| 帖子数据准备失败 | 不影响其他帖子，调度器跳过该帖 |
| step 级别失败 | `queue_job` 重试机制不变（max_attempts=3） |
| 调度器自身失败 | 记录到 `task_steps.error`，不影响数据准备继续 |
| 媒体未就绪 | 调度器跳过该 step，等 `syncWaitingMediaJobs` 触发后重试 |

## 兼容性保障

1. **旧 workflow 可用**：`task.runAllSteps` 仍可为所有 pending targets 批量创建 jobs
2. **防重复 enqueue**：`queue_jobs` 表的 `UNIQUE(task_id, target_type, target_id)` 约束
3. **step 唯一性**：`task_steps` 的 `UNIQUE(task_id, strategy_id)` 避免重复 steps

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/daemon/stream-scheduler.ts` | 新增 | 流式调度器核心模块 |
| `src/daemon/handlers.ts` | 修改 | 集成调度器调用，修复 queue_jobs strategy_id |
| `src/db/schema.sql` | 修改 | queue_jobs 表增加 strategy_id |
| `src/db/queue-jobs.ts` | 修改 | enqueueJob/enqueueJobs 支持 strategy_id |
| `src/cli/task-prepare.ts` | 修改 | CLI 数据准备完成后提示用户分析已自动启动 |

## 待决策

1. **是否默认开启流式分析？** 还是加配置项 `task.streaming_analysis = true`？
   - 建议默认开启，因为这是更优行为
2. **step stats 中 done/failed 如何更新？**
   - 由 Analysis Worker 在完成 job 时更新 step stats（当前行为）
