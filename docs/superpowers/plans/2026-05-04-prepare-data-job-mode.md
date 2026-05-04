# Prepare-Data Job Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将数据准备阶段从串行直接执行改造为 job 模式，复用 queue_jobs 表和 consumer 框架，实现状态可见、失败可重试。

**Architecture:** 每个 pending post 创建一个 `target_type='prepare'` 的 job 入队到 queue_jobs 表。独立 prepare consumer 串行消费这些 job，执行 fetch_note → fetch_comments → fetch_media。失败 job 自动重试（max 3 次），UI 在 TaskDetail 页面展示数据准备进度。

**Tech Stack:** TypeScript, DuckDB, Fastify, React

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/core/src/shared/types.ts` | Modify | target_type 联合类型增加 'prepare' |
| `packages/core/src/db/queue-jobs.ts` | Modify | getNextJobs 增加 targetType 参数 |
| `packages/api/src/daemon/handlers.ts` | Modify | task.prepareData 改为创建 job；移除 runPrepareDataAsync |
| `packages/api/src/worker/prepare-consumer.ts` | Create | 独立 prepare consumer |
| `packages/api/src/worker/consumer.ts` | Modify | processJob 增加 prepare 分支 |
| `packages/api/src/index.ts` | Modify | 启动 prepare consumer |
| `packages/api/src/routes/tasks.ts` | Modify | 增加 prepare-jobs 端点 |
| `packages/ui/src/pages/TaskDetail.tsx` | Modify | 增加数据准备区域 |

---

### Task 1: 扩展 target_type 类型

**Files:**
- Modify: `packages/core/src/shared/types.ts`

- [ ] **Step 1: 修改 target_type 联合类型**

在 `QueueJob` 接口中找到 `target_type` 字段，将联合类型从 `'post' | 'comment' | 'media'` 扩展为 `'post' | 'comment' | 'media' | 'prepare'`。

```typescript
target_type: 'post' | 'comment' | 'media' | 'prepare';
```

- [ ] **Step 2: 验证构建**

Run: `pnpm build`
Expected: 编译通过，无类型错误

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/shared/types.ts
git commit -m "feat: extend target_type with 'prepare' for data preparation jobs"
```

---

### Task 2: getNextJobs 增加 targetType 参数

**Files:**
- Modify: `packages/core/src/db/queue-jobs.ts`

- [ ] **Step 1: 修改 getNextJobs 函数签名和 SQL**

在 `getNextJobs` 函数中增加 `targetType?: string` 参数。当 `targetType` 有值时，在 SQL WHERE 条件中追加 `AND target_type = ?`。

找到 `getNextJobs` 函数（约行 34-45），修改为：

```typescript
export async function getNextJobs(limit: number, targetType?: string): Promise<QueueJob[]> {
  if (targetType) {
    const rows = await query<QueueJob>(
      `UPDATE queue_jobs
       SET status = 'processing', attempts = attempts + 1
       WHERE id IN (
         SELECT id FROM queue_jobs WHERE status = 'pending' AND target_type = ? ORDER BY priority DESC, created_at ASC LIMIT ?
       )
       RETURNING *`,
      [targetType, limit]
    );
    return rows;
  }
  const rows = await query<QueueJob>(
    `UPDATE queue_jobs
     SET status = 'processing', attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM queue_jobs WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT ?
     )
     RETURNING *`,
    [limit]
  );
  return rows;
}
```

注意：项目使用 DuckDB 的 `?` 占位符语法，不是 `$param`。保持与现有代码风格一致。

- [ ] **Step 2: 验证构建**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/db/queue-jobs.ts
git commit -m "feat: add targetType filter to getNextJobs for prepare consumer"
```

---

### Task 3: 改造 task.prepareData handler 为创建 job

**Files:**
- Modify: `packages/api/src/daemon/handlers.ts`

- [ ] **Step 1: 修改 task.prepareData handler**

找到 `'task.prepareData'` handler（约行 516-551），替换为创建 prepare job 的逻辑：

```typescript
'task.prepareData': async (params: Record<string, unknown>) => {
  const taskId = params.task_id as string;
  if (!taskId) throw new Error('task_id is required');

  const task = await getTaskById(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (!task.cli_templates || Object.keys(task.cli_templates).length === 0) {
    throw new Error('Task has no CLI templates configured');
  }

  const pending = await getPendingPostIds(taskId);
  if (pending.length === 0) {
    return { started: false, jobCount: 0, message: 'No pending posts to prepare' };
  }

  const jobs: Omit<QueueJob, 'processed_at' | 'error'>[] = pending.map(item => ({
    id: generateId(),
    task_id: taskId,
    strategy_id: null,
    target_type: 'prepare' as const,
    target_id: item.post_id,
    status: 'pending' as const,
    priority: 0,
    attempts: 0,
    max_attempts: 3,
    created_at: now(),
  }));

  await enqueueJobs(jobs);
  notifyJobAvailable();

  return { started: true, jobCount: jobs.length };
},
```

需要确保在文件顶部 import 中加入 `enqueueJobs`、`notifyJobAvailable`、`generateId`、`now`（如果尚未导入）。检查现有 import 并补充。

- [ ] **Step 2: 验证构建**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/daemon/handlers.ts
git commit -m "feat: task.prepareData creates prepare jobs instead of direct execution"
```

---

### Task 4: 实现 processPrepareJob

**Files:**
- Modify: `packages/api/src/worker/consumer.ts`

- [ ] **Step 1: 在 consumer.ts 中增加 processPrepareJob 函数**

在 `processJob` 函数之前，添加 `processPrepareJob` 函数。该函数从 `runPrepareDataAsync` 中提取单个 post 的处理逻辑：

```typescript
async function processPrepareJob(job: QueueJob, workerId: number | string): Promise<void> {
  const postId = job.target_id;
  const taskId = job.task_id;

  const post = await getPostById(postId);
  if (!post) throw new Error(`Post ${postId} not found`);

  const task = await getTaskById(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const cliTemplates = task.cli_templates ?? {};
  const platformId = post.platform_id;
  const adapter = getPlatformAdapter(platformId);
  const platform = adapter?.directoryName ?? platformId.split('_')[0];
  const noteId = extractNoteId(post.url, platformId);
  const downloadDir = config.paths.download_dir;

  const fetchVars: Record<string, string> = {
    post_id: postId,
    note_id: noteId || '',
    url: post.url || '',
    platform,
    download_dir: downloadDir,
  };

  await upsertTaskPostStatus({
    task_id: taskId,
    post_id: postId,
    status: 'fetching',
    comments_fetched: false,
    media_fetched: false,
  });

  // Step 1: fetch_note
  if (cliTemplates.fetch_note) {
    const result = await fetchViaOpencli(cliTemplates.fetch_note, fetchVars);
    if (result.success && result.data) {
      const items = Array.isArray(result.data) ? result.data : [result.data];
      for (const item of items) {
        if (typeof item === 'object' && item !== null) {
          await normalizePostItem(postId, item as Record<string, unknown>, platformId);
          await updatePost(postId, { raw_data: item });
        }
      }
    } else if (!result.success) {
      throw new Error(`fetch_note failed: ${result.error || 'unknown error'}`);
    }
  }

  // Step 2: fetch_comments
  const currentStatus = await getTaskPostStatus(taskId, postId);
  if (!currentStatus?.comments_fetched) {
    if (cliTemplates.fetch_comments) {
      const result = await fetchViaOpencli(cliTemplates.fetch_comments, fetchVars);
      if (result.success && result.data) {
        const items = Array.isArray(result.data) ? result.data : [result.data];
        await importCommentsToDb(items, postId, platformId);
      } else if (!result.success) {
        throw new Error(`fetch_comments failed: ${result.error || 'unknown error'}`);
      }
    }
    await upsertTaskPostStatus({
      task_id: taskId,
      post_id: postId,
      comments_fetched: true,
    });
  }

  // Step 3: fetch_media
  const updatedStatus = await getTaskPostStatus(taskId, postId);
  if (!updatedStatus?.media_fetched) {
    if (cliTemplates.fetch_media) {
      const result = await fetchViaOpencli(cliTemplates.fetch_media, fetchVars);
      if (result.success && result.data) {
        const items = Array.isArray(result.data) ? result.data : [result.data];
        await importMediaToDb(items, postId, platformId, noteId);
        await syncWaitingMediaJobs();
      } else if (!result.success) {
        throw new Error(`fetch_media failed: ${result.error || 'unknown error'}`);
      }
    }
    await upsertTaskPostStatus({
      task_id: taskId,
      post_id: postId,
      media_fetched: true,
    });
  }

  // All steps done
  await upsertTaskPostStatus({
    task_id: taskId,
    post_id: postId,
    status: 'done',
  });

  // After prepare done, create analysis jobs for this post if task has strategies
  if (task.strategy_ids && task.strategy_ids.length > 0) {
    await buildJobsForPost(taskId, postId, task.strategy_ids);
  }
}
```

需要确认以下 import 在 consumer.ts 中可用（如不在则添加）：
- `getPostById` from `@scopai/core/db/posts`
- `getTaskById` from `@scopai/core/db/tasks`
- `upsertTaskPostStatus`, `getTaskPostStatus` from `@scopai/core/db/task-post-status`
- `getPlatformAdapter`, `extractNoteId` from `@scopai/core/platforms`
- `fetchViaOpencli` from `@scopai/core/data-fetcher/opencli`
- `normalizePostItem` from handlers.ts（需提取为独立导出函数）
- `importCommentsToDb`, `importMediaToDb` from handlers.ts（需提取为独立导出函数）
- `updatePost` from `@scopai/core/db/posts`
- `syncWaitingMediaJobs`, `buildJobsForPost` from `@scopai/core/db/queue-jobs`
- `config` from `@scopai/core/config`

- [ ] **Step 2: 从 handlers.ts 提取 normalizePostItem、importCommentsToDb、importMediaToDb 为导出函数**

在 `handlers.ts` 中，将 `normalizePostItem`、`importCommentsToDb`、`importMediaToDb` 三个函数从闭包内部提取为模块级导出函数。具体操作：

1. 找到这三个函数的定义位置
2. 移除函数内部的闭包依赖（如外层变量），改为参数传入
3. 添加 `export` 关键字

注意：如果这些函数依赖外层变量（如 `platformId`、`noteId`），需要将这些依赖作为参数传入。

- [ ] **Step 3: 修改 processJob 路由**

在 `processJob` 函数开头增加 prepare 分支：

```typescript
async function processJob(job: QueueJob, workerId: number | string): Promise<void> {
  if (job.target_type === 'prepare') {
    await processPrepareJob(job, workerId);
    return;
  }

  // 原有策略分析逻辑
  const task = await getTaskById(job.task_id);
  if (!task) throw new Error(`Task ${job.task_id} not found`);
  if (!job.strategy_id) throw new Error(`Job ${job.id} has no strategy_id`);
  await processStrategyJob(job, task, workerId);
}
```

- [ ] **Step 4: 验证构建**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/worker/consumer.ts packages/api/src/daemon/handlers.ts
git commit -m "feat: add processPrepareJob to consumer with prepare branch routing"
```

---

### Task 5: 创建独立 prepare consumer

**Files:**
- Create: `packages/api/src/worker/prepare-consumer.ts`
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: 创建 prepare-consumer.ts**

```typescript
import { getNextJobs, completeJob, failJob, requeueJob } from '@scopai/core/db/queue-jobs';
import { notifyJobAvailable } from '@scopai/core/db/queue-jobs';
import { processJob } from './consumer';
import type { QueueJob } from '@scopai/core/shared/types';
import { logger } from '@scopai/core/logger';

const POLL_INTERVAL_MS = 2000;

export async function runPrepareConsumer(workerId: number | string): Promise<void> {
  logger.info({ workerId }, 'Prepare consumer started');

  while (true) {
    try {
      const jobs = await getNextJobs(1, 'prepare');
      if (jobs.length === 0) {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }

      for (const job of jobs) {
        try {
          await processJob(job, workerId);
          await completeJob(job.id);
          logger.info({ jobId: job.id, postId: job.target_id }, 'Prepare job completed');
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          logger.error({ jobId: job.id, error: errorMsg }, 'Prepare job failed');

          if (job.attempts < job.max_attempts) {
            await requeueJob(job.id);
          } else {
            await failJob(job.id, errorMsg);
          }
        }
      }
    } catch (err) {
      logger.error({ workerId, error: err instanceof Error ? err.message : String(err) }, 'Prepare consumer error');
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}
```

注意：此 consumer 与 `runConsumer` 结构一致，但只认领 `target_type='prepare'` 的 job。`processJob` 内部会根据 `target_type` 路由到 `processPrepareJob`。

- [ ] **Step 2: 在 index.ts 中启动 prepare consumer**

找到 worker 启动逻辑（约行 60-80），在现有 worker 启动循环之前，增加 prepare consumer：

```typescript
// Start prepare consumer (1 worker, serial)
registerWorker('prepare');
workerPromises.push(runPrepareConsumer('prepare').catch(err => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Prepare consumer crashed');
}));

// Start analysis workers (N workers, concurrent)
for (let i = 0; i < WORKER_CONCURRENCY; i++) {
  registerWorker(i);
  workerPromises.push(runConsumer(i).catch(err => {
    logger.error({ workerId: i, error: err instanceof Error ? err.message : String(err) }, 'Worker crashed');
  }));
}
```

确保 `runPrepareConsumer` 和 `registerWorker` 已正确导入。

- [ ] **Step 3: 验证构建**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/worker/prepare-consumer.ts packages/api/src/index.ts
git commit -m "feat: add independent prepare consumer for data preparation jobs"
```

---

### Task 6: 移除 runPrepareDataAsync 和 prepareDataRunning

**Files:**
- Modify: `packages/api/src/daemon/handlers.ts`

- [ ] **Step 1: 移除 runPrepareDataAsync 函数**

在 `handlers.ts` 中找到并删除整个 `runPrepareDataAsync` 函数（约行 1092-1317）。此逻辑已迁移到 `processPrepareJob`。

- [ ] **Step 2: 移除 prepareDataRunning Set**

找到 `const prepareDataRunning = new Set<string>();` 声明（约行 1090）并删除。同时删除所有对 `prepareDataRunning` 的引用（在 task.prepareData handler 中的 add/delete/has 检查）。

- [ ] **Step 3: 验证构建**

Run: `pnpm build`
Expected: 编译通过，无未使用变量警告

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/daemon/handlers.ts
git commit -m "refactor: remove runPrepareDataAsync and prepareDataRunning — logic moved to processPrepareJob"
```

---

### Task 7: 增加 prepare-jobs API 端点

**Files:**
- Modify: `packages/api/src/routes/tasks.ts`

- [ ] **Step 1: 增加 GET /tasks/:id/prepare-jobs 端点**

在 tasks 路由文件中，找到其他 task 端点附近，添加：

```typescript
app.get<{ Params: { id: string } }>('/tasks/:id/prepare-jobs', async (request, reply) => {
  const { id } = request.params;

  const task = await getTaskById(id);
  if (!task) {
    reply.code(404);
    return { error: 'Task not found' };
  }

  // Get prepare jobs from queue_jobs
  const jobs = await all<QueueJob>(`
    SELECT j.*, p.title as post_title
    FROM queue_jobs j
    LEFT JOIN posts p ON p.id = j.target_id
    WHERE j.task_id = ? AND j.target_type = 'prepare'
    ORDER BY j.created_at ASC
  `, [id]);

  // Get sub-step status from task_post_status
  const postIds = jobs.map(j => j.target_id);
  const statuses = postIds.length > 0
    ? await all(`
        SELECT post_id, comments_fetched, media_fetched, status
        FROM task_post_status
        WHERE task_id = ?
      `, [id])
    : [];

  const statusMap = new Map(statuses.map((s: any) => [s.post_id, s]));

  const result = jobs.map(j => ({
    id: j.id,
    post_id: j.target_id,
    post_title: (j as any).post_title || null,
    status: j.status,
    attempts: j.attempts,
    max_attempts: j.max_attempts,
    error: j.error,
    created_at: j.created_at,
    processed_at: j.processed_at,
    comments_fetched: statusMap.get(j.target_id)?.comments_fetched ?? false,
    media_fetched: statusMap.get(j.target_id)?.media_fetched ?? false,
    step_status: statusMap.get(j.target_id)?.status ?? null,
  }));

  const summary = {
    total: result.length,
    completed: result.filter(j => j.status === 'completed').length,
    processing: result.filter(j => j.status === 'processing').length,
    pending: result.filter(j => j.status === 'pending').length,
    failed: result.filter(j => j.status === 'failed').length,
  };

  return { jobs: result, summary };
});
```

需要确保 `all` 从 `@scopai/core/db/client` 导入，`QueueJob` 从 `@scopai/core/shared/types` 导入。

- [ ] **Step 2: 增加 POST /tasks/:id/prepare-jobs/retry 端点**

```typescript
app.post<{ Params: { id: string } }>('/tasks/:id/prepare-jobs/retry', async (request, reply) => {
  const { id } = request.params;

  const task = await getTaskById(id);
  if (!task) {
    reply.code(404);
    return { error: 'Task not found' };
  }

  // Re-queue failed prepare jobs for this task
  const result = await run(`
    UPDATE queue_jobs
    SET status = 'pending', attempts = 0, error = NULL, processed_at = NULL
    WHERE task_id = ?
      AND target_type = 'prepare'
      AND status = 'failed'
  `, [id]);

  const retriedCount = (result as any).changes ?? 0;

  if (retriedCount > 0) {
    notifyJobAvailable();
  }

  return { retried: retriedCount };
});
```

需要确保 `run` 从 `@scopai/core/db/client` 导入，`notifyJobAvailable` 从 `@scopai/core/db/queue-jobs` 导入。

- [ ] **Step 3: 验证构建**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/tasks.ts
git commit -m "feat: add prepare-jobs API endpoints for status and retry"
```

---

### Task 8: TaskDetail 页面增加数据准备区域

**Files:**
- Modify: `packages/ui/src/pages/TaskDetail.tsx`

- [ ] **Step 1: 增加 prepare-jobs 数据获取**

在 TaskDetail 组件中，找到现有的数据获取逻辑（useEffect 或 React Query），增加 prepare-jobs 的获取：

```typescript
const [prepareJobs, setPrepareJobs] = useState<{ jobs: any[]; summary: any } | null>(null);

useEffect(() => {
  if (!task) return;
  const fetchPrepareJobs = async () => {
    try {
      const res = await fetch(`/api/tasks/${task.id}/prepare-jobs`);
      if (res.ok) {
        const data = await res.json();
        setPrepareJobs(data);
      }
    } catch {}
  };
  fetchPrepareJobs();
  const interval = setInterval(fetchPrepareJobs, 5000);
  return () => clearInterval(interval);
}, [task?.id]);
```

- [ ] **Step 2: 增加数据准备区域 UI**

在 TaskDetail 页面中，找到分析步骤列表之前的位置，添加数据准备区域：

```tsx
{/* Data Preparation Section */}
{prepareJobs && prepareJobs.summary.total > 0 && (
  <div className="border rounded-lg p-4 mb-4">
    <div className="flex items-center justify-between mb-3">
      <h3 className="font-semibold text-sm">数据准备</h3>
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>已完成 {prepareJobs.summary.completed}/{prepareJobs.summary.total}</span>
        {prepareJobs.summary.processing > 0 && <span className="text-blue-500">处理中 {prepareJobs.summary.processing}</span>}
        {prepareJobs.summary.failed > 0 && <span className="text-red-500">失败 {prepareJobs.summary.failed}</span>}
      </div>
    </div>

    {/* Progress bar */}
    <div className="w-full bg-slate-100 rounded-full h-1.5 mb-3">
      <div
        className="bg-emerald-500 h-1.5 rounded-full transition-all"
        style={{ width: `${(prepareJobs.summary.completed / prepareJobs.summary.total) * 100}%` }}
      />
    </div>

    {/* Failed jobs with retry */}
    {prepareJobs.summary.failed > 0 && (
      <button
        onClick={async () => {
          await fetch(`/api/tasks/${task.id}/prepare-jobs/retry`, { method: 'POST' });
        }}
        className="text-xs text-red-500 hover:text-red-700 underline mb-2"
      >
        重试失败项 ({prepareJobs.summary.failed})
      </button>
    )}

    {/* Job list (collapsible, show failed first) */}
    <details>
      <summary className="text-xs text-muted-foreground cursor-pointer">查看详情</summary>
      <div className="mt-2 space-y-1 max-h-60 overflow-y-auto">
        {prepareJobs.jobs
          .sort((a: any, b: any) => {
            const order: Record<string, number> = { failed: 0, processing: 1, pending: 2, completed: 3 };
            return (order[a.status] ?? 4) - (order[b.status] ?? 4);
          })
          .map((job: any) => (
            <div key={job.id} className={`flex items-center gap-2 text-xs py-1 px-2 rounded ${job.status === 'failed' ? 'bg-red-50' : ''}`}>
              <span>{job.status === 'completed' ? '✓' : job.status === 'failed' ? '✕' : job.status === 'processing' ? '⋯' : '○'}</span>
              <span className="truncate flex-1">{job.post_title || job.post_id}</span>
              <span className="text-muted-foreground">
                {job.comments_fetched ? '✓' : '○'}评 {job.media_fetched ? '✓' : '○'}媒
              </span>
              {job.error && <span className="text-red-400 truncate max-w-40" title={job.error}>{job.error}</span>}
            </div>
          ))}
      </div>
    </details>
  </div>
)}
```

- [ ] **Step 3: 验证构建**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/pages/TaskDetail.tsx
git commit -m "feat: add data preparation section to TaskDetail page"
```

---

### Task 9: 端到端验证

**Files:**
- None (testing only)

- [ ] **Step 1: 启动 API 服务**

Run: `node bin/scopai.js daemon start`
Expected: 服务启动，日志显示 "Prepare consumer started"

- [ ] **Step 2: 验证 prepare-data 创建 job**

通过 API 创建一个 task 并触发 prepare-data：

```bash
# 查看现有 task
curl -s http://localhost:3000/api/tasks | python3 -m json.tool | head -20

# 触发 prepare-data
curl -s -X POST http://localhost:3000/api/tasks/<task_id>/prepare-data | python3 -m json.tool
```

Expected: 返回 `{ "started": true, "jobCount": N }`

- [ ] **Step 3: 验证 prepare-jobs 端点**

```bash
curl -s http://localhost:3000/api/tasks/<task_id>/prepare-jobs | python3 -m json.tool
```

Expected: 返回 jobs 列表和 summary，status 从 pending → processing → completed

- [ ] **Step 4: 验证 UI 展示**

在浏览器中打开 TaskDetail 页面，确认数据准备区域显示正确。

- [ ] **Step 5: 验证重试**

```bash
# 重试失败的 prepare job
curl -s -X POST http://localhost:3000/api/tasks/<task_id>/prepare-jobs/retry | python3 -m json.tool
```

Expected: 返回 `{ "retried": N }`

- [ ] **Step 6: 运行 API e2e 测试**

Run: `pnpm --filter @scopai/api test:e2e`
Expected: 所有测试通过

- [ ] **Step 7: Commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address e2e test failures from prepare-data job mode"
```
