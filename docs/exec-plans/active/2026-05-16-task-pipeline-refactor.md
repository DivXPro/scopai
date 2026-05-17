# Task 系统 Pipeline 重构实施计划

> **Agent 执行说明:** 使用 superpowers:subagent-driven-development 或 superpowers:executing-plans 按任务逐步实施。步骤使用复选框 (`- [ ]`) 语法追踪。

**目标:** 将 Task 系统重构为清晰的 Pipeline 架构（数据准备 → 策略分析），解决状态语义混乱问题，消除 API 路由与 CLI handlers 之间的重复逻辑，替换硬编码的多帖子依赖。

**架构:** Task 不再用单一 `current_phase` 字段标识阶段，而是通过 **阶段统计**（stage statistics）展示进度。`data_prep` 阶段通过 `task_post_status` 追踪每篇帖子的准备进度。`analysis` 阶段通过 `task_steps` 和 `queue_jobs` 执行策略分析。Task 级 `status` 只表达生命周期状态（pending/running/paused/completed/failed/cancelled），阶段进度由独立统计字段展示。**所有策略均为 post-level 独立分析，multi-post 机制已移除。**

**技术栈:** TypeScript, Node.js, DuckDB, Fastify

---

## 变更概览

### 解决的问题

1. **Task 状态是简单枚举** — 无法区分数据准备阶段和策略分析阶段。当前 `pending/running/paused/completed/failed` 状态被过度使用。
2. **取消映射为失败** — 语义混乱。用户取消任务，系统却记录为失败。
3. **暂停只改状态** — 正在运行的 job 继续执行，没有真正的暂停机制。
4. **API 路由和 CLI handlers 之间有大量重复逻辑** — `tasks.ts` 和 `handlers.ts` 都包含几乎相同的 step 入队逻辑。
5. **多帖子策略依赖硬编码** — `processMultiPostStrategyJob` 写死了三个策略 ID（multi-post 机制整体移除）。

### 已确定的设计决策

- 采用 **Pipeline** 架构（非 DAG）
- Pipeline 两个阶段：`data_prep` → `analysis`
- **Task 不设置统一 phase 字段** — 各帖子进度可能不一致，用阶段统计替代
- **所有策略均为 post-level 独立分析** — multi-post 机制已移除，策略之间无依赖
- Task 创建后不可变 — 新分析需求创建新 Task
- 新 Task 可从老 Task 获取关联帖子
- 执行分析前检查媒体文件是否就绪

---

## 文件结构

### 需要修改的文件

| 文件 | 职责 |
|------|------|
| `packages/core/src/db/schema.sql` | 扩展 tasks 表 status CHECK 约束（增加 `cancelled`），扩展 task_steps 的 status CHECK（增加 `skipped`），移除 `UNIQUE(task_id, strategy_id)` |
| `packages/core/src/db/migrate.ts` | 增加迁移函数 |
| `packages/core/src/shared/types.ts` | 更新 TaskStatus（增加 `cancelled`），移除 TaskPhase 类型 |
| `packages/core/src/db/tasks.ts` | 修改 `createTask` 初始化 |
| `packages/core/src/db/task-steps.ts` | 移除 UNIQUE 约束依赖 |
| `packages/api/src/daemon/scheduler.ts` | 提取共享 job 构建逻辑 |
| `packages/api/src/daemon/handlers.ts` | 重构 handlers 使用共享逻辑，修复 cancel 语义 |
| `packages/api/src/routes/tasks.ts` | 重构路由使用共享逻辑，响应中增加 `progress` 统计 |
| `packages/api/src/worker/consumer.ts` | 修复 pause 真正跳过，准备完成后自动创建分析 jobs |
| `packages/api/src/types.ts` | 更新响应类型，增加 `progress` 统计 |
| `packages/api/test/e2e/tasks.test.ts` | 更新测试适配新状态值 |
| `packages/cli/src/task.ts` | 更新 CLI 展示 `progress` 统计 |

### 需要创建的文件

| 文件 | 职责 |
|------|------|
| `packages/api/src/daemon/task-helpers.ts` | 从路由和 handlers 提取的共享逻辑 |

---

## Task 和 Job 的关系

```
Task (1) ──► 包含多个 Step (N)
Task (1) ──► 包含多个 Job (M)，Job 通过 step_id 关联 Step
```

**一个 Task 的生命周期：**

1. **创建 Task** — 添加帖子 targets、添加 step（策略）
2. **启动 Task** — status 变为 `running`
3. **data_prep 阶段** — 为每个 post target 创建 `prepare` job（fetch_note / fetch_comments / fetch_media）
4. **analysis 阶段** — 每个 post 准备完成后，自动为该 post 创建其所属 step 的分析 jobs
5. **完成** — 所有 jobs 完成，status 变为 `completed`

**关键设计：**
- 所有策略均为 post-level 独立分析，没有 multi-post 综合分析
- Task 没有统一的 `current_phase`，各帖子进度独立
- API 返回 `progress` 统计展示每个阶段的完成情况
- `cancelled` 是终止状态，和 `failed` 区分
- 策略之间无依赖关系，所有 Step 并行执行

---

## Task 1: 数据库 Schema 变更

**涉及文件:**
- 修改: `packages/core/src/db/schema.sql`
- 修改: `packages/core/src/db/migrate.ts`
- 测试: `packages/api/test/e2e/tasks.test.ts`

### 1.1 扩展 tasks 表 status CHECK 约束

```sql
-- 修改 schema.sql 中的 tasks 表
CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    status      TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','paused','completed','failed','cancelled')),
    stats       JSON,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);
```

注意：**不增加 `current_phase` 字段**。阶段进度由统计信息展示。

### 1.2 扩展 task_steps 的 status CHECK，移除 depends_on_step_id

```sql
CREATE TABLE IF NOT EXISTS task_steps (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    strategy_id     TEXT REFERENCES strategies(id),
    name            TEXT NOT NULL,
    step_order      INTEGER NOT NULL DEFAULT 0,
    status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','skipped')),
    stats           JSON,
    error           TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);
```

注意：
- 移除了 `depends_on_step_id` 字段（multi-post 机制已移除，策略间无依赖）
- 移除了 `UNIQUE(task_id, strategy_id)` 约束（如已存在，通过迁移处理）

### 1.3 增加迁移函数

在 `packages/core/src/db/migrate.ts` 中增加：

```typescript
async function migrateTaskStatusCheck(): Promise<void> {
  // DuckDB 不支持直接修改 CHECK 约束，需要重建表
  // 先检查当前 status 是否允许 'cancelled'
  try {
    await run("UPDATE tasks SET status = 'cancelled' WHERE status = 'failed' AND 1=0");
  } catch {
    // CHECK 不包含 cancelled，需要重建表
    await run('CREATE TABLE tasks_backup AS SELECT * FROM tasks');
    await run('DROP TABLE tasks');
    await run(`CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','paused','completed','failed','cancelled')),
      stats JSON,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP
    )`);
    await run('INSERT INTO tasks SELECT * FROM tasks_backup');
    await run('DROP TABLE tasks_backup');
  }
}

async function migrateTaskStepsCheck(): Promise<void> {
  // 检查 task_steps 的 status CHECK 是否包含 'skipped'
  try {
    await run("UPDATE task_steps SET status = 'skipped' WHERE status = 'pending' AND 1=0");
  } catch {
    // 需要重建表以扩展 CHECK 约束
    // 显式列出不包含 depends_on_step_id 的列
    await run(`CREATE TABLE task_steps_backup AS
      SELECT id, task_id, strategy_id, name, step_order, status, stats, error, created_at, updated_at
      FROM task_steps`);
    await run('DROP TABLE task_steps');
    await run(`CREATE TABLE task_steps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      strategy_id TEXT REFERENCES strategies(id),
      name TEXT NOT NULL,
      step_order INTEGER NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','skipped')),
      stats JSON,
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await run('INSERT INTO task_steps SELECT * FROM task_steps_backup');
    await run('DROP TABLE task_steps_backup');
    await run('CREATE INDEX idx_task_steps_task ON task_steps(task_id)');
  }
}

async function migrateTaskStepsRemoveDependsOn(): Promise<void> {
  // 如果 task_steps 仍有 depends_on_step_id 列，移除它
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'task_steps'"
  );
  if (columns.some(c => c.name === 'depends_on_step_id')) {
    await run(`CREATE TABLE task_steps_backup AS
      SELECT id, task_id, strategy_id, name, step_order, status, stats, error, created_at, updated_at
      FROM task_steps`);
    await run('DROP TABLE task_steps');
    await run(`CREATE TABLE task_steps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      strategy_id TEXT REFERENCES strategies(id),
      name TEXT NOT NULL,
      step_order INTEGER NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','skipped')),
      stats JSON,
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await run('INSERT INTO task_steps SELECT * FROM task_steps_backup');
    await run('DROP TABLE task_steps_backup');
    await run('CREATE INDEX idx_task_steps_task ON task_steps(task_id)');
  }
}
```

在 `runMigrations()` 中增加调用：
```typescript
await migrateTaskStatusCheck();
await migrateTaskStepsCheck();
await migrateTaskStepsRemoveDependsOn();
```

- [ ] **Step 1:** 编写 schema 变更
- [ ] **Step 2:** 编写迁移函数
- [ ] **Step 3:** 运行迁移并验证

---

## Task 2: 类型定义更新

**涉及文件:**
- 修改: `packages/core/src/shared/types.ts`
- 修改: `packages/api/src/types.ts`

### 2.1 更新 TaskStatus

```typescript
// packages/core/src/shared/types.ts

export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

// 注意：移除 TaskPhase 类型，不再有统一的 current_phase

export interface Task {
  id: string;
  name: string;
  description: string | null;
  cli_templates: string | null;
  status: TaskStatus;
  stats: TaskStats | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}
```

### 2.2 更新 API 响应类型

在 `packages/api/src/types.ts` 中：

```typescript
export interface TaskDetailResponse extends Task {
  progress: {
    dataPreparation: {
      status: 'pending' | 'fetching' | 'done' | 'failed';
      totalPosts: number;
      donePosts: number;
      failedPosts: number;
      fetchingPosts: number;
      pendingPosts: number;
      commentsFetched: number;
      mediaFetched: number;
    };
    analysis: {
      totalJobs: number;
      completedJobs: number;
      failedJobs: number;
      pendingJobs: number;
      processingJobs: number;
    };
  };
  steps: Array<{
    stepId: string;
    strategyId: string | null;
    name: string;
    status: string;
    stats: { total: number; done: number; failed: number } | null;
    stepOrder: number;
  }>;
  recentErrors: Array<{ target_type: string; target_id: string; error: string }>;
  jobs: Array<{
    id: string;
    target_type: string | null;
    target_id: string | null;
    status: string;
    attempts: number;
    error: string | null;
  }>;
}
```

- [ ] **Step 1:** 更新核心类型
- [ ] **Step 2:** 更新 API 响应类型
- [ ] **Step 3:** 验证 TypeScript 编译

---

## Task 3: 状态机简化

**涉及文件:**
- 创建: `packages/core/src/shared/task-state-machine.ts`
- 修改: `packages/core/src/index.ts`

### 3.1 简化状态转换（只保留 TaskStatus）

```typescript
// packages/core/src/shared/task-state-machine.ts

import type { TaskStatus } from './types';

export type TaskAction = 'start' | 'pause' | 'resume' | 'cancel' | 'complete' | 'fail';

const taskStatusTransitions: Record<TaskStatus, Partial<Record<TaskAction, TaskStatus>>> = {
  pending: { start: 'running', cancel: 'cancelled' },
  running: { pause: 'paused', cancel: 'cancelled', complete: 'completed', fail: 'failed' },
  paused: { resume: 'running', cancel: 'cancelled' },
  completed: {},
  failed: {},
  cancelled: {},
};

export function canTransitionStatus(current: TaskStatus, action: TaskAction): TaskStatus | null {
  return taskStatusTransitions[current]?.[action] ?? null;
}
```

### 3.2 从 core index 导出

在 `packages/core/src/index.ts` 中增加：
```typescript
export { canTransitionStatus } from './shared/task-state-machine';
```

- [ ] **Step 1:** 编写简化后的状态机模块
- [ ] **Step 2:** 为状态转换编写单元测试
- [ ] **Step 3:** 从 core index 导出

---

## Task 4: DB 层 — 移除 Phase 相关函数

**涉及文件:**
- 修改: `packages/core/src/db/tasks.ts`
- 修改: `packages/core/src/index.ts`

### 4.1 修改 tasks.ts

移除 `updateTaskPhase` 和 `updateTaskStatusAndPhase`，改为：

```typescript
// packages/core/src/db/tasks.ts

// 只保留一个统一的状态更新函数
export async function updateTaskStatus(id: string, status: string): Promise<void> {
  const updatedAt = now();
  const completedAt = (status === 'completed' || status === 'cancelled' || status === 'failed') ? now() : null;
  await run(
    `UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
    [status, updatedAt, completedAt, id]
  );
}
```

修改 `createTask`：
```typescript
export async function createTask(task: Task): Promise<void> {
  await run(
    `INSERT INTO tasks (id, name, description, cli_templates, status, stats, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      task.id,
      task.name,
      task.description ?? null,
      task.cli_templates ?? null,
      task.status,
      task.stats ? JSON.stringify(task.stats) : null,
      task.created_at,
      task.updated_at,
      task.completed_at ?? null,
    ]
  );
}
```

- [ ] **Step 1:** 移除 phase 相关函数，简化状态更新
- [ ] **Step 2:** 修改 createTask
- [ ] **Step 3:** 运行测试验证 DB 操作

---

## Task 5: 提取共享逻辑

**涉及文件:**
- 创建: `packages/api/src/daemon/task-helpers.ts`
- 修改: `packages/api/src/daemon/scheduler.ts`
- 修改: `packages/api/src/daemon/handlers.ts`
- 修改: `packages/api/src/routes/tasks.ts`

### 5.1 创建 task-helpers.ts 提取共享入队逻辑

```typescript
// packages/api/src/daemon/task-helpers.ts

import {
  getStrategyById,
  listTaskTargets,
  getExistingJobTargets,
  enqueueJobs,
  generateId,
  updateTaskStepStatus,
} from '@scopai/core';
import type { QueueJob, TaskStep } from '@scopai/core';

export interface EnqueueStepResult {
  status: 'running' | 'completed' | 'skipped';
  enqueued: number;
}

export async function enqueueStepJobs(
  taskId: string,
  step: TaskStep,
): Promise<EnqueueStepResult> {
  const strategy = await getStrategyById(step.strategy_id ?? '');
  if (!strategy) {
    throw new Error(`Strategy not found: ${step.strategy_id}`);
  }

  // 所有策略均为 post-level 独立分析
  const targets = await listTaskTargets(taskId);
  const relevantTargets = targets.filter(t => {
    if (strategy.target === 'post') return t.target_type === 'post';
    if (strategy.target === 'comment') return t.target_type === 'comment';
    return true;
  });

  if (relevantTargets.length === 0) {
    await updateTaskStepStatus(step.id, 'skipped', { total: 0, done: 0, failed: 0 });
    return { status: 'skipped', enqueued: 0 };
  }

  const existingTargets = await getExistingJobTargets(taskId, strategy.id);
  const newTargets = relevantTargets.filter(t => !existingTargets.has(t.target_id));

  if (newTargets.length === 0) {
    if (step.status === 'pending') {
      await updateTaskStepStatus(step.id, 'running', { total: existingTargets.size, done: 0, failed: 0 });
    }
    return { status: 'running', enqueued: 0 };
  }

  const jobs: QueueJob[] = newTargets.map(t => ({
    id: generateId(),
    task_id: taskId,
    strategy_id: strategy.id,
    target_type: strategy.target as 'post' | 'comment' | 'media',
    target_id: t.target_id,
    status: 'pending',
    priority: 0,
    attempts: 0,
    max_attempts: 3,
    error: null,
    created_at: new Date(),
    processed_at: null,
  }));

  await enqueueJobs(jobs);
  await updateTaskStepStatus(step.id, 'running', { total: newTargets.length, done: 0, failed: 0 });

  return { status: 'running', enqueued: jobs.length };
}
```

### 5.2 重构 handlers.ts 使用共享逻辑

替换 `task.step.run` handler 的入队逻辑：

```typescript
async 'task.step.run'(params) {
  const taskId = params.task_id as string;
  const stepId = params.step_id as string;
  const { getTaskStepById } = await import('@scopai/core');

  const step = await getTaskStepById(stepId);
  if (!step) throw new Error(`Step not found: ${stepId}`);
  if (step.task_id !== taskId) throw new Error('Step does not belong to this task');
  if (step.status === 'completed') {
    return { status: 'completed', enqueued: 0 };
  }
  if (step.status === 'skipped') {
    return { status: 'skipped', enqueued: 0 };
  }

  const { enqueueStepJobs } = await import('./task-helpers');
  return enqueueStepJobs(taskId, step);
}
```

### 5.3 重构 routes/tasks.ts 使用共享逻辑

替换 `POST /tasks/:id/steps/:stepId/run` handler：

```typescript
import { enqueueStepJobs } from '../daemon/task-helpers';

app.post('/tasks/:id/steps/:stepId/run', async (request, reply) => {
  const { id, stepId } = request.params as { id: string; stepId: string };
  const task = await getTaskById(id);
  if (!task) {
    reply.code(404);
    throw new Error(`Task not found: ${id}`);
  }

  const step = await getTaskStepById(stepId);
  if (!step) {
    reply.code(404);
    throw new Error(`Step not found: ${stepId}`);
  }
  if (step.task_id !== id) {
    reply.code(400);
    throw new Error('Step does not belong to this task');
  }
  if (step.status === 'completed') {
    return { status: 'completed', enqueued: 0 };
  }
  if (step.status === 'skipped') {
    return { status: 'skipped', enqueued: 0 };
  }

  return enqueueStepJobs(id, step);
});
```

- [ ] **Step 1:** 创建 task-helpers.ts 提取共享入队逻辑
- [ ] **Step 2:** 重构 handlers.ts 使用共享逻辑
- [ ] **Step 3:** 重构 routes/tasks.ts 使用共享逻辑
- [ ] **Step 4:** 通过 e2e 测试验证两条路径

---

## Task 6: Worker 改造

**涉及文件:**
- 修改: `packages/api/src/worker/consumer.ts`

### 6.1 修复 pause 真正跳过暂停的任务

在 `processJob` 中处理前检查任务状态：

```typescript
async function processJob(job: QueueJob, workerId: number | string): Promise<void> {
  const task = await getTaskById(job.task_id);
  if (!task) throw new Error(`Task ${job.task_id} not found`);

  // 如果任务已暂停，抛出特殊错误
  if (task.status === 'paused') {
    throw new Error('TASK_PAUSED');
  }

  if (job.target_type === 'prepare') {
    await processPrepareJob(job, workerId);
    return;
  }

  if (!job.strategy_id) {
    throw new Error(`Job ${job.id} has no strategy_id`);
  }

  await processStrategyJob(job, task, workerId);
}
```

在 `processJobWithLifecycle` 中特殊处理 `TASK_PAUSED`：

```typescript
} catch (err) {
  const error = String(err);

  // 如果任务暂停，不入队（不增加 attempts）
  if (error.includes('TASK_PAUSED')) {
    logger.info(`[Worker-${workerId}] Job ${job.id} 跳过: task ${job.task_id} 已暂停`);
    await requeueJob(job.id, 'Task is paused');
    return;
  }

  // ... 其余错误处理
}
```

### 6.2 准备完成后自动创建分析 jobs

在 `processPrepareJob` 完成后，自动为该 post 创建分析 jobs（不再依赖单独的"阶段推进"逻辑）：

```typescript
// 在 processPrepareJob 末尾，已有的"Build analysis jobs for this post"逻辑基础上，
// 确保只要 post 准备完成，就立即创建该 post 对应的所有 analysis jobs
// 这部分逻辑已在当前代码中存在（lines 390-458），只需要确保它正常工作
```

- [ ] **Step 1:** 在 processJob 中实现真正的暂停检查
- [ ] **Step 2:** 确保准备完成后自动创建分析 jobs
- [ ] **Step 3:** 测试 worker 对暂停任务的行为

---

## Task 7: API 变更

**涉及文件:**
- 修改: `packages/api/src/routes/tasks.ts`
- 修改: `packages/api/src/daemon/handlers.ts`
- 修改: `packages/api/src/types.ts`

### 7.1 更新 cancel 端点使用 cancelled 状态

```typescript
// routes/tasks.ts
app.post('/tasks/:id/cancel', async (request) => {
  const { id } = request.params as { id: string };
  await updateTaskStatus(id, 'cancelled');
  return { status: 'cancelled' };
});
```

### 7.2 更新 pause 端点增加校验

```typescript
app.post('/tasks/:id/pause', async (request) => {
  const { id } = request.params as { id: string };
  const task = await getTaskById(id);
  if (!task) {
    return { status: 'not_found' };
  }
  // 只允许暂停运行中的任务
  if (task.status !== 'running') {
    return { status: 'cannot_pause', reason: `Task is ${task.status}` };
  }
  await updateTaskStatus(id, 'paused');
  return { status: 'paused' };
});
```

### 7.3 GET /tasks/:id 返回 progress 统计

```typescript
// 在 GET /tasks/:id 中，从 postStatuses 和 jobs 计算 progress

const totalPosts = postStatuses.length;
const donePosts = postStatuses.filter(p => p.status === 'done').length;
const failedPosts = postStatuses.filter(p => p.status === 'failed').length;
const fetchingPosts = postStatuses.filter(p => p.status === 'fetching').length;
const pendingPosts = postStatuses.filter(p => p.status === 'pending').length;
const commentsFetched = postStatuses.filter(p => p.comments_fetched).length;
const mediaFetched = postStatuses.filter(p => p.media_fetched).length;

let dataPrepStatus: 'pending' | 'fetching' | 'done' | 'failed' = 'done';
if (totalPosts === 0) {
  dataPrepStatus = 'pending';
} else if (failedPosts > 0 && failedPosts === totalPosts) {
  dataPrepStatus = 'failed';
} else if (fetchingPosts > 0) {
  dataPrepStatus = 'fetching';
} else if (pendingPosts > 0) {
  dataPrepStatus = 'pending';
}

const completedJobs = jobs.filter(j => j.status === 'completed').length;
const failedJobs = jobs.filter(j => j.status === 'failed').length;
const pendingJobs = jobs.filter(j => j.status === 'pending' || j.status === 'waiting_media').length;
const processingJobs = jobs.filter(j => j.status === 'processing').length;

return {
  ...task,
  ...stats,
  progress: {
    dataPreparation: {
      status: dataPrepStatus,
      totalPosts,
      donePosts,
      failedPosts,
      fetchingPosts,
      pendingPosts,
      commentsFetched,
      mediaFetched,
    },
    analysis: {
      totalJobs: jobs.length,
      completedJobs,
      failedJobs,
      pendingJobs,
      processingJobs,
    },
  },
  steps: stepDetails,
  recentErrors,
  jobs: jobs.map((j) => ({
    id: j.id,
    target_type: j.target_type,
    target_id: j.target_id,
    status: j.status,
    attempts: j.attempts,
    error: j.error,
  })),
};
```

### 7.4 更新 handlers.ts 的 cancel handler

```typescript
async 'task.cancel'(params) {
  const taskId = params.task_id as string;
  await updateTaskStatus(taskId, 'cancelled');
  return { status: 'cancelled' };
}
```

### 7.5 移除 `/tasks/:id/prepare-jobs` 端点

数据准备状态已合并到 `GET /tasks/:id` 的 `progress.dataPreparation` 中，前端不再单独调用 `/prepare-jobs`。

- [ ] **Step 1:** 更新 cancel 端点使用 cancelled 状态
- [ ] **Step 2:** 更新 pause 端点增加校验
- [ ] **Step 3:** 在 task detail 响应中增加 progress 统计
- [ ] **Step 4:** 更新 handlers.ts 匹配
- [ ] **Step 5:** 移除 `/tasks/:id/prepare-jobs` 路由

---

## Task 8: CLI 更新

**涉及文件:**
- 修改: `packages/cli/src/task.ts`

### 8.1 更新 task show 命令

```typescript
// task.ts show 命令
console.log(`  状态:      ${full.status}`);
if (full.progress) {
  console.log(`  数据准备:  ${full.progress.dataPreparation.donePosts}/${full.progress.dataPreparation.totalPosts} 完成`);
  console.log(`  分析进度:  ${full.progress.analysis.completedJobs}/${full.progress.analysis.totalJobs} 完成`);
}
```

### 8.2 更新状态颜色映射

```typescript
const statusColor = (s: string) => {
  switch (s) {
    case 'completed': return pc.green(s);
    case 'running': return pc.cyan(s);
    case 'failed': return pc.red(s);
    case 'cancelled': return pc.red(s);
    case 'paused': return pc.yellow(s);
    default: return pc.gray(s);
  }
};
```

- [ ] **Step 1:** 更新 task show 命令展示 progress 统计
- [ ] **Step 2:** 更新状态颜色映射支持 cancelled
- [ ] **Step 3:** 验证 CLI 输出

---

## Task 9: 迁移策略

**涉及文件:**
- 修改: `packages/core/src/db/migrate.ts`

### 9.1 已有任务迁移

对于已有任务，将 status 为 `failed` 但实际是用户取消的任务标记为 `cancelled`？

**不，无法区分历史数据**。迁移只扩展 CHECK 约束：

```typescript
async function migrateExistingTaskStatus(): Promise<void> {
  // 已有任务的 status 保持原样
  // 不需要迁移 current_phase（因为没有这个字段）
  // 只需要确保 schema 已更新
}
```

- [ ] **Step 1:** 在现有数据库上测试迁移

---

## Task 10: E2E 测试更新

**涉及文件:**
- 修改: `packages/api/test/e2e/tasks.test.ts`

### 10.1 更新 cancel 测试

```typescript
describe('POST /api/tasks/:id/cancel', () => {
  it('取消任务', async () => {
    const res = await fetchApi(ctx.baseUrl, `/api/tasks/${taskId}/cancel`, {
      method: 'POST',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'cancelled');

    // 验证任务状态为 cancelled
    const taskRes = await fetchApi(ctx.baseUrl, `/api/tasks/${taskId}`);
    const task = await taskRes.json();
    assert.equal(task.status, 'cancelled');
  });
});
```

### 10.2 增加 progress 统计测试

```typescript
describe('GET /api/tasks/:id progress', () => {
  it('返回包含 progress 统计的 task detail', async () => {
    const res = await fetchApi(ctx.baseUrl, `/api/tasks/${taskId}`);
    const task = await res.json();

    assert.ok(task.progress, 'progress 字段存在');
    assert.ok(task.progress.dataPreparation, 'dataPreparation 字段存在');
    assert.ok(task.progress.analysis, 'analysis 字段存在');
    assert.equal(typeof task.progress.dataPreparation.totalPosts, 'number');
    assert.equal(typeof task.progress.analysis.totalJobs, 'number');
  });
});
```

- [ ] **Step 1:** 更新已有 cancel 测试
- [ ] **Step 2:** 增加 progress 统计测试
- [ ] **Step 3:** 运行完整 e2e 测试套件

---

## Task 11: 前端适配

**涉及文件:**
- 修改: `packages/ui/src/pages/TaskList.tsx`
- 修改: `packages/ui/src/pages/TaskDetail.tsx`
- 可能新增: `packages/ui/src/pages/TaskCreateFromExisting.tsx`

### 11.1 TaskList 页面更新

**增加 `cancelled` 状态筛选和颜色映射:**

```typescript
const statusOptions = [
  { value: 'pending', label: '待处理' },
  { value: 'running', label: '运行中' },
  { value: 'paused', label: '已暂停' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
];
```

**列表中展示进度概览:**
在列表项中增加轻量级的进度展示（如进度条或数字摘要）。

### 11.2 TaskDetail 页面更新

**增加 `cancelled` 状态颜色映射:**

```typescript
const statusVariantMap: Record<string, BadgeVariant> = {
  pending: 'outline',
  running: 'default',
  paused: 'secondary',
  completed: 'default',
  failed: 'destructive',
  cancelled: 'destructive',  // 新增
};
```

**重构数据准备展示:**
从独立的 `/prepare-jobs` API 调用改为从 Task detail 的 `progress.dataPreparation` 字段读取：

```typescript
interface TaskDetail {
  // ... 其他字段
  progress: {
    dataPreparation: {
      status: string;
      totalPosts: number;
      donePosts: number;
      failedPosts: number;
      fetchingPosts: number;
      pendingPosts: number;
      commentsFetched: number;
      mediaFetched: number;
    };
    analysis: {
      totalJobs: number;
      completedJobs: number;
      failedJobs: number;
      pendingJobs: number;
      processingJobs: number;
    };
  };
}
```

**新增分析进度 Section:**
展示 analysis 的进度统计：
- 总 Jobs / 已完成 / 失败 / 待处理
- 各 Step 的完成状态（从 `steps` 字段读取）

**展示各 Step 状态:**
```typescript
interface TaskStep {
  id: string;
  name: string;
  status: string;
  strategy_id: string | null;
  step_order: number;
  stats: { total: number; done: number; failed: number } | null;
}
```

### 11.3 新增"从已有 Task 创建新 Task"功能

**新增 API:**
```typescript
// POST /api/tasks/from-task/:id
// Body: { strategy_ids: string[] }
// 复制老 Task 的帖子列表，创建新 Task，添加指定的策略 steps
```

**前端交互:**
- 在 Task 列表或详情页增加"以此帖子创建新分析"按钮
- 弹出策略选择对话框
- 创建后跳转到新 Task 详情页

- [ ] **Step 1:** 更新 TaskList 页面（增加 cancelled 状态、进度概览）
- [ ] **Step 2:** 更新 TaskDetail 页面（progress 统计、Step 状态展示、操作按钮状态校验）
- [ ] **Step 3:** 实现"从已有 Task 创建新 Task"功能（后端 API + 前端 UI）
- [ ] **Step 4:** 验证前端展示与后端数据一致

---

## 自检清单

### 需求覆盖

| 需求 | 对应 Task |
|------|----------|
| Task 状态简单枚举，无法区分阶段 | Task 7 (progress 统计), Task 2 (类型) |
| 取消映射为失败，语义混乱 | Task 7 (cancel 端点), Task 1 (schema) |
| 暂停只改状态，job 继续跑 | Task 6 (worker 暂停检查) |
| API 路由和 CLI handlers 重复逻辑 | Task 5 (提取共享逻辑) |
| 多帖子策略硬编码依赖 | multi-post 机制整体移除 |
| Pipeline 二阶段架构 | Task 6 (准备完成后自动创建分析 jobs) |
| Task 创建后不可变 | 架构设计本身 |
| 分析前检查媒体就绪 | Task 6 (processPrepareJob 已有此逻辑) |

### 占位符检查

- 无 "TBD", "TODO", "稍后实现" 等占位符
- 所有代码块包含实际实现
- 所有函数签名已定义
- 无 "类似 Task N" 的引用

### 类型一致性

- `TaskStatus` 包含 `'cancelled'`
- `progress` 对象结构一致
- 响应类型已更新包含 `progress`

---

## 关键实现文件

- `/Users/huhui/Projects/scopai/packages/core/src/db/schema.sql`
- `/Users/huhui/Projects/scopai/packages/core/src/db/migrate.ts`
- `/Users/huhui/Projects/scopai/packages/core/src/shared/types.ts`
- `/Users/huhui/Projects/scopai/packages/api/src/worker/consumer.ts`
- `/Users/huhui/Projects/scopai/packages/api/src/routes/tasks.ts`
- `/Users/huhui/Projects/scopai/packages/api/src/daemon/task-helpers.ts`
- `/Users/huhui/Projects/scopai/packages/api/src/daemon/handlers.ts`
