# Agent Skill 原子化任务与子任务系统实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 analyze-cli 中引入 `task_steps` 子任务表，修复 `prepare-data` 断点续传，升级 `task status` 聚合返回，新增 CLI 子任务命令，修改 `post import` 支持 upsert 与自动绑定 task，最终创建 Claude Code Custom Skill。

**Architecture:** 新增 `task_steps` 数据表及 CRUD 模块；`src/daemon/handlers.ts` 中修复数据准备逻辑并扩展 task 相关 handlers；`src/cli/task.ts` 和 `src/cli/post.ts` 新增 CLI 子命令；最后以 Markdown 形式定义 Custom Skill 暴露给 Agent。

**Tech Stack:** TypeScript, Node 20, DuckDB, Commander, Claude Code Custom Skill (Markdown)

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/db/schema.sql` | 新增 `task_steps` 表定义 |
| `src/db/migrate.ts` | 增加 `task_steps` 自动迁移逻辑 |
| `src/db/task-steps.ts` | `task_steps` 的 CRUD 操作 |
| `src/shared/types.ts` | 新增 `TaskStep`、`TaskStepStatus` 类型 |
| `src/daemon/handlers.ts` | 修复 `task.prepareData`；扩展 `task.status` 聚合；新增 `task.step.add`、`task.step.run`、`task.runAllSteps` handlers |
| `src/cli/task.ts` | 新增 `task step add/list/run`、`task run-all-steps`、`task results` CLI 命令 |
| `src/cli/post.ts` | `post import` 增加 `--task-id` 选项，重复帖子改 upsert |
| `.claude/skills/analyze-cli/skill.md` | Custom Skill Markdown 定义 |

---

### Task 1: 新增 task_steps 表、迁移逻辑与类型定义

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/migrate.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: 在 schema.sql 末尾追加 task_steps 表定义**

在 `src/db/schema.sql` 最后（`CREATE INDEX...` 之后）插入：

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
    updated_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(task_id, strategy_id)
);

CREATE INDEX IF NOT EXISTS idx_task_steps_task ON task_steps(task_id);
```

- [ ] **Step 2: 在 migrate.ts 中增加 task_steps 迁移函数**

在 `src/db/migrate.ts` 的 `runMigrations` 函数调用链末尾追加一个迁移函数调用：

```typescript
async function migrateTaskStepsTable(): Promise<void> {
  const hasTaskSteps = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'task_steps'"
  );
  if (hasTaskSteps.length === 0) {
    await exec(`CREATE TABLE task_steps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      strategy_id TEXT REFERENCES strategies(id),
      name TEXT NOT NULL,
      step_order INTEGER NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','skipped')),
      stats JSON,
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(task_id, strategy_id)
    )`);
    await exec('CREATE INDEX idx_task_steps_task ON task_steps(task_id)');
  }
}
```

并在 `runMigrations` 中添加：

```typescript
export async function runMigrations(): Promise<void> {
  const schemaPath = findSchemaPath();
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await exec(schema);

  await migrateCliTemplates();
  await migrateStrategiesTable();
  await migrateQueueJobsStrategyId();
  await migrateTaskStepsTable();

  // ... existing migration
}
```

- [ ] **Step 3: 在 types.ts 中新增 TaskStep 相关类型**

在 `src/shared/types.ts` 的 `TaskStats` 接口之后插入：

```typescript
export type TaskStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface TaskStep {
  id: string;
  task_id: string;
  strategy_id: string | null;
  name: string;
  step_order: number;
  status: TaskStepStatus;
  stats: TaskStats | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}
```

- [ ] **Step 4: 运行构建并测试迁移**

Run:
```bash
npm run build
node -e "require('./dist/db/migrate.js').runMigrations().then(() => console.log('Migrations OK')).catch(e => { console.error(e); process.exit(1); })"
```

Expected: `Migrations OK`（即使 task_steps 表已存在也应正常）。

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.sql src/db/migrate.ts src/shared/types.ts
git commit -m "feat(db): add task_steps table, migration and types"
```

---

### Task 2: 实现 task-steps CRUD 模块

**Files:**
- Create: `src/db/task-steps.ts`

- [ ] **Step 1: 编写 task-steps.ts CRUD 模块**

创建 `src/db/task-steps.ts`：

```typescript
import { query, run } from './client';
import { TaskStep, TaskStats } from '../shared/types';
import { generateId, now } from '../shared/utils';

export async function createTaskStep(
  step: Omit<TaskStep, 'id' | 'created_at' | 'updated_at'>,
): Promise<TaskStep> {
  const id = generateId();
  const ts = now();
  await run(
    `INSERT INTO task_steps (id, task_id, strategy_id, name, step_order, status, stats, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      step.task_id,
      step.strategy_id ?? null,
      step.name,
      step.step_order,
      step.status,
      step.stats ? JSON.stringify(step.stats) : null,
      step.error ?? null,
      ts,
      ts,
    ],
  );
  return { ...step, id, created_at: ts, updated_at: ts };
}

export async function listTaskSteps(taskId: string): Promise<TaskStep[]> {
  const rows = await query<TaskStep>(
    'SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_order, created_at',
    [taskId],
  );
  return rows.map(r => ({
    ...r,
    stats: typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats,
  }));
}

export async function getTaskStepById(stepId: string): Promise<TaskStep | null> {
  const rows = await query<TaskStep>('SELECT * FROM task_steps WHERE id = ?', [stepId]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...r, stats: typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats };
}

export async function updateTaskStepStatus(
  stepId: string,
  status: string,
  stats?: TaskStats,
  error?: string,
): Promise<void> {
  const ts = now();
  await run(
    `UPDATE task_steps SET status = ?, stats = ?, error = ?, updated_at = ? WHERE id = ?`,
    [status, stats ? JSON.stringify(stats) : null, error ?? null, ts, stepId],
  );
}

export async function getNextStepOrder(taskId: string): Promise<number> {
  const rows = await query<{ max_order: bigint }>(
    'SELECT MAX(step_order) as max_order FROM task_steps WHERE task_id = ?',
    [taskId],
  );
  return Number(rows[0]?.max_order ?? -1) + 1;
}
```

- [ ] **Step 2: 运行构建确保无类型错误**

Run:
```bash
npm run build
```

Expected: 无编译错误。

- [ ] **Step 3: Commit**

```bash
git add src/db/task-steps.ts
git commit -m "feat(db): add task-steps CRUD module"
```

---

### Task 3: 修复 task.prepareData 断点续传

**Files:**
- Modify: `src/daemon/handlers.ts`

- [ ] **Step 1: 删除重置所有 post 为 pending 的代码**

找到 `src/daemon/handlers.ts` 中 `task.prepareData` handler 里的这段代码并删除：

```typescript
for (const postId of postIds) {
  await upsertTaskPostStatus(taskId, postId, { status: 'pending' });
}
```

- [ ] **Step 2: 修改 getPendingPostIds 只查询未完成的记录**

当前 `getPendingPostIds` 的 SQL 是：

```sql
SELECT post_id, comments_fetched, media_fetched FROM task_post_status
WHERE task_id = ? AND (comments_fetched = FALSE OR media_fetched = FALSE)
ORDER BY post_id
```

这已经基本正确，但缺少 `status = 'failed'` 的情况（当 comments_fetched/media_fetched 都是 TRUE 但 status 是 failed 时不会恢复）。

修改为在 `src/db/task-post-status.ts` 中：

```typescript
export async function getPendingPostIds(taskId: string): Promise<{ post_id: string; comments_fetched: boolean; media_fetched: boolean }[]> {
  return query(
    `SELECT post_id, comments_fetched, media_fetched FROM task_post_status
     WHERE task_id = ? AND (comments_fetched = FALSE OR media_fetched = FALSE OR status = 'failed')
     ORDER BY post_id`,
    [taskId],
  );
}
```

- [ ] **Step 3: 运行离线测试确保 prepare-data 相关逻辑无回归**

Run:
```bash
npm run build
node --test --experimental-strip-types test/import-offline.test.ts
```

Expected: 12/12 pass。

- [ ] **Step 4: Commit**

```bash
git add src/daemon/handlers.ts src/db/task-post-status.ts
git commit -m "fix(daemon): resume prepare-data from interruption without resetting all posts"
```

---

### Task 4: 升级 task.status 聚合返回结构

**Files:**
- Modify: `src/daemon/handlers.ts`
- Modify: `src/cli/task.ts`

- [ ] **Step 1: 在 handlers.ts 中重构 task.status handler**

将 `src/daemon/handlers.ts` 中的 `task.status` handler 替换为以下实现（保留原有 handler 签名，只改函数体）：

```typescript
async 'task.status'(params) {
  const taskId = params.task_id as string;
  const task = await getTaskById(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);

  const stats = await getTargetStats(taskId);
  const { getTaskPostStatuses } = await import('../db/task-post-status');
  const { listTaskSteps } = await import('../db/task-steps');
  const { listJobsByTask } = await import('../db/queue-jobs');

  const postStatuses = await getTaskPostStatuses(taskId);
  const steps = await listTaskSteps(taskId);
  const jobs = await listJobsByTask(taskId);

  const totalPosts = postStatuses.length;
  const commentsFetched = postStatuses.filter(p => p.comments_fetched).length;
  const mediaFetched = postStatuses.filter(p => p.media_fetched).length;
  const failedPosts = postStatuses.filter(p => p.status === 'failed').length;

  let dataPrepStatus: 'pending' | 'fetching' | 'done' | 'failed' = 'done';
  if (totalPosts === 0) {
    dataPrepStatus = 'pending';
  } else if (failedPosts > 0 && failedPosts === totalPosts) {
    dataPrepStatus = 'failed';
  } else if (postStatuses.some(p => p.status === 'fetching')) {
    dataPrepStatus = 'fetching';
  } else if (postStatuses.some(p => !p.comments_fetched || !p.media_fetched)) {
    dataPrepStatus = 'pending';
  }

  const stepDetails = steps.map(s => ({
    stepId: s.id,
    strategyId: s.strategy_id,
    name: s.name,
    status: s.status,
    stats: s.stats ?? { total: 0, done: 0, failed: 0 },
    stepOrder: s.step_order,
  }));

  const phase = dataPrepStatus !== 'done'
    ? 'dataPreparation'
    : stepDetails.some(s => s.status === 'pending' || s.status === 'running')
      ? 'analysis'
      : (task.status as string);

  const jobStats = {
    totalJobs: jobs.length,
    completedJobs: jobs.filter(j => j.status === 'completed').length,
    failedJobs: jobs.filter(j => j.status === 'failed').length,
    pendingJobs: jobs.filter(j => j.status === 'pending' || j.status === 'waiting_media').length,
  };

  return {
    ...task,
    ...stats,
    phase,
    phases: {
      dataPreparation: {
        status: dataPrepStatus,
        totalPosts,
        commentsFetched,
        mediaFetched,
        failedPosts,
      },
      steps: stepDetails,
      analysis: jobStats,
    },
  };
},
```

- [ ] **Step 2: 升级 CLI task status 输出格式**

修改 `src/cli/task.ts` 中 `task status` 命令的 action：

```typescript
.action(async (opts: { taskId: string }) => {
  const full = await daemonCall('task.status', { task_id: opts.taskId }) as Record<string, any>;
  if (!full.id) {
    console.log(pc.red(`Task not found: ${opts.taskId}`));
    process.exit(1);
  }
  console.log(pc.bold(`\nTask: ${full.name}`));
  console.log(`  ID:          ${full.id}`);
  console.log(`  Status:      ${full.status}`);
  console.log(`  Phase:       ${full.phase}`);
  console.log(`  Created:     ${full.created_at}`);
  if (full.completed_at) console.log(`  Completed:   ${full.completed_at}`);

  console.log(`\n  Data Preparation:`);
  const dp = full.phases?.dataPreparation ?? {};
  console.log(`    Status:          ${dp.status ?? 'N/A'}`);
  console.log(`    Total Posts:     ${dp.totalPosts ?? 0}`);
  console.log(`    Comments Fetched:${dp.commentsFetched ?? 0}`);
  console.log(`    Media Fetched:   ${dp.mediaFetched ?? 0}`);
  console.log(`    Failed Posts:    ${dp.failedPosts ?? 0}`);

  console.log(`\n  Steps:`);
  const steps = full.phases?.steps ?? [];
  if (steps.length === 0) {
    console.log(`    (No steps added)`);
  } else {
    for (const s of steps) {
      const st = s.status;
      const color = st === 'completed' ? pc.green : st === 'running' ? pc.cyan : st === 'failed' ? pc.red : pc.gray;
      console.log(`    [${s.stepOrder}] ${s.name} (${s.strategyId}) - ${color(st)}`);
      if (s.stats) {
        console.log(`        Progress: ${s.stats.done}/${s.stats.total} done, ${s.stats.failed} failed`);
      }
    }
  }

  console.log(`\n  Analysis Jobs:`);
  const aj = full.phases?.analysis ?? {};
  console.log(`    Total:     ${aj.totalJobs ?? 0}`);
  console.log(`    Completed: ${aj.completedJobs ?? 0}`);
  console.log(`    Failed:    ${aj.failedJobs ?? 0}`);
  console.log(`    Pending:   ${aj.pendingJobs ?? 0}`);
  console.log();
});
```

- [ ] **Step 3: 构建并验证命令输出**

Run:
```bash
npm run build
node dist/cli/index.js task status --task-id nonexistent
```

Expected: `Task not found: nonexistent`（验证编译通过且命令可执行）。

- [ ] **Step 4: Commit**

```bash
git add src/daemon/handlers.ts src/cli/task.ts
git commit -m "feat(task): enrich task status with phases, steps and analysis jobs"
```

---

### Task 5: 修改 post import 支持 --task-id 和 upsert

**Files:**
- Modify: `src/cli/post.ts`
- Modify: `src/daemon/handlers.ts`

- [ ] **Step 1: 修改 post import CLI 命令增加 --task-id 选项**

在 `src/cli/post.ts` 中：

```typescript
post
  .command('import')
  .description('Import posts from a JSON or JSONL file')
  .requiredOption('--platform <id>', 'Platform ID')
  .option('--file <path>', 'Path to JSON or JSONL file')
  .option('--task-id <id>', 'Bind imported posts to a task')
  .action(async (opts: { platform: string; file?: string; taskId?: string }) => {
```

并在 daemonCall 中传入 taskId：

```typescript
const result = await daemonCall('post.import', {
  platform: opts.platform,
  file: opts.file,
  task_id: opts.taskId,
}) as { imported: number; skipped: number; postIds?: string[] };
```

- [ ] **Step 2: 在 daemon handlers 中修改 post.import 为 upsert 并自动绑定 task**

将 `src/daemon/handlers.ts` 中的 `post.import` handler 替换为：

```typescript
async 'post.import'(params) {
  const platformId = params.platform as string;
  const file = params.file as string;
  const taskId = (params.task_id as string | undefined) ?? undefined;
  let items: RawPostItem[];
  try {
    items = parseImportFile(file) as RawPostItem[];
  } catch (err: unknown) {
    throw new Error(`Failed to parse import file: ${err instanceof Error ? err.message : String(err)}`);
  }

  let imported = 0;
  let skipped = 0;
  const postIds: string[] = [];

  for (const item of items) {
    const platformPostId = item.platform_post_id ?? item.noteId ?? item.id ?? generateId();
    const existing = await query<{ id: string }>(
      'SELECT id FROM posts WHERE platform_id = ? AND platform_post_id = ?',
      [platformId, platformPostId],
    );

    let postId: string;
    try {
      if (existing.length > 0) {
        postId = existing[0].id;
        await run(
          `UPDATE posts SET
            title = ?, content = ?, author_id = ?, author_name = ?, author_url = ?,
            url = ?, cover_url = ?, post_type = ?, like_count = ?, collect_count = ?,
            comment_count = ?, share_count = ?, play_count = ?, score = ?, tags = ?,
            media_files = ?, published_at = ?, metadata = ?, fetched_at = ?
          WHERE id = ?`,
          [
            item.title ?? null,
            item.content ?? item.text ?? item.desc ?? '',
            item.author_id ?? null,
            item.author_name ?? item.author ?? null,
            item.author_url ?? null,
            item.url ?? null,
            item.cover_url ?? null,
            (item.post_type ?? item.type ?? null) as any,
            Number(item.like_count ?? 0),
            Number(item.collect_count ?? 0),
            Number(item.comment_count ?? 0),
            Number(item.share_count ?? 0),
            Number(item.play_count ?? 0),
            item.score ? Number(item.score) : null,
            item.tags ? JSON.stringify(item.tags) : null,
            item.media_files ? JSON.stringify(item.media_files) : null,
            item.published_at ? new Date(item.published_at) : null,
            item.metadata ? JSON.stringify(item.metadata) : null,
            now(),
            postId,
          ],
        );
        skipped++;
      } else {
        const post = await createPost({
          platform_id: platformId,
          platform_post_id: platformPostId,
          title: item.title ?? null,
          content: item.content ?? item.text ?? item.desc ?? '',
          author_id: item.author_id ?? null,
          author_name: item.author_name ?? item.author ?? null,
          author_url: item.author_url ?? null,
          url: item.url ?? null,
          cover_url: item.cover_url ?? null,
          post_type: (item.post_type ?? item.type ?? null) as any,
          like_count: Number(item.like_count ?? 0),
          collect_count: Number(item.collect_count ?? 0),
          comment_count: Number(item.comment_count ?? 0),
          share_count: Number(item.share_count ?? 0),
          play_count: Number(item.play_count ?? 0),
          score: item.score ? Number(item.score) : null,
          tags: item.tags as { name: string; url?: string }[] | null ?? null,
          media_files: item.media_files as { type: 'image' | 'video' | 'audio'; url: string; local_path?: string }[] | null ?? null,
          published_at: item.published_at ? new Date(item.published_at) : null,
          metadata: item.metadata as Record<string, unknown> | null ?? null,
        });
        postId = post.id;
        imported++;
      }
      postIds.push(postId);
    } catch (err: unknown) {
      throw new Error(`Failed to import post ${platformPostId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (taskId && postIds.length > 0) {
    const { addTaskTargets } = await import('../db/task-targets');
    const { upsertTaskPostStatus } = await import('../db/task-post-status');
    await addTaskTargets(taskId, 'post', postIds);
    for (const postId of postIds) {
      await upsertTaskPostStatus(taskId, postId, { status: 'pending' });
    }
  }

  return { imported, skipped, postIds };
},
```

- [ ] **Step 3: 构建并运行现有离线测试确保无回归**

Run:
```bash
npm run build
node --test --experimental-strip-types test/import-offline.test.ts
```

Expected: 12/12 pass（upsert 行为不应破坏已有 fixture 导入）。

- [ ] **Step 4: Commit**

```bash
git add src/cli/post.ts src/daemon/handlers.ts
git commit -m "feat(post): support --task-id binding and upsert on duplicate platform_post_id"
```

---

### Task 6: 新增 task step 相关 CLI 命令

**Files:**
- Modify: `src/cli/task.ts`

- [ ] **Step 1: 在 task.ts 中新增 step 子命令和 run-all-steps 命令**

在 `src/cli/task.ts` 的 `taskCommands` 函数末尾（`task.status` 之后）插入以下命令注册：

```typescript
  const stepCmd = task.command('step').description('Task step management');

  stepCmd
    .command('add')
    .description('Add an analysis step to a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--strategy-id <id>', 'Strategy ID')
    .option('--name <name>', 'Step name')
    .option('--order <n>', 'Step order (auto-increment if omitted)')
    .action(async (opts: { taskId: string; strategyId: string; name?: string; order?: string }) => {
      const result = await daemonCall('task.step.add', {
        task_id: opts.taskId,
        strategy_id: opts.strategyId,
        name: opts.name,
        order: opts.order ? parseInt(opts.order, 10) : undefined,
      }) as { stepId: string; stepOrder: number };
      console.log(pc.green(`Step added: ${result.stepId} (order=${result.stepOrder})`));
    });

  stepCmd
    .command('list')
    .alias('ls')
    .description('List steps for a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      const steps = await daemonCall('task.step.list', { task_id: opts.taskId }) as any[];
      if (steps.length === 0) {
        console.log(pc.yellow('No steps found'));
        return;
      }
      console.log(pc.bold(`\nSteps for task ${opts.taskId.slice(0, 8)}:`));
      console.log(pc.dim('─'.repeat(70)));
      for (const s of steps) {
        const statusColor = s.status === 'completed' ? pc.green : s.status === 'running' ? pc.cyan : s.status === 'failed' ? pc.red : pc.gray;
        console.log(`  [${s.step_order}] ${statusColor(s.status.padEnd(10))} ${pc.cyan(s.strategy_id?.slice(0, 16) ?? '-')} ${s.name}`);
      }
      console.log(pc.dim('─'.repeat(70)));
      console.log(`Total: ${steps.length}\n`);
    });

  stepCmd
    .command('run')
    .description('Run a specific task step')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--step-id <id>', 'Step ID')
    .action(async (opts: { taskId: string; stepId: string }) => {
      const result = await daemonCall('task.step.run', {
        task_id: opts.taskId,
        step_id: opts.stepId,
      }) as { enqueued: number; status: string };
      console.log(pc.green(`Step status: ${result.status}`));
      if (result.enqueued > 0) {
        console.log(`  Enqueued ${result.enqueued} jobs`);
      }
    });

  task
    .command('run-all-steps')
    .description('Run all pending/failed steps for a task in order')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      const result = await daemonCall('task.runAllSteps', { task_id: opts.taskId }) as {
        completed: number;
        failed: number;
        skipped: number;
      };
      console.log(pc.green('All steps processed'));
      console.log(`  Completed: ${result.completed}`);
      console.log(`  Failed:    ${result.failed}`);
      console.log(`  Skipped:   ${result.skipped}`);
    });

  task
    .command('results')
    .description('Show analysis results for a completed task')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      const full = await daemonCall('task.status', { task_id: opts.taskId }) as Record<string, any>;
      if (!full.id) {
        console.log(pc.red(`Task not found: ${opts.taskId}`));
        process.exit(1);
      }
      const { listAnalysisResults } = await import('../db/analysis-results');
      const results = await listAnalysisResults(opts.taskId);
      console.log(pc.bold(`\nAnalysis results for task ${opts.taskId.slice(0, 8)}:`));
      console.log(`  Total result records: ${results.length}`);
      for (const r of results.slice(0, 5)) {
        console.log(`  - ${r.target_type} ${r.target_id?.slice(0, 8) ?? '-'}: ${JSON.stringify(r.summary ?? r.raw_response ?? {}).slice(0, 80)}`);
      }
      if (results.length > 5) {
        console.log(pc.dim(`  ... and ${results.length - 5} more`));
      }
      console.log();
    });
```

- [ ] **Step 2: 新增 analysis-results DB 查询辅助函数**

创建 `src/db/analysis-results.ts`：

```typescript
import { query } from './client';
import { AnalysisResult } from '../shared/types';

export async function listAnalysisResults(taskId: string): Promise<AnalysisResult[]> {
  const commentRows = await query<AnalysisResult>(
    `SELECT * FROM analysis_results_comments WHERE task_id = ? ORDER BY analyzed_at DESC`,
    [taskId],
  );
  const mediaRows = await query<AnalysisResult>(
    `SELECT * FROM analysis_results_media WHERE task_id = ? ORDER BY analyzed_at DESC`,
    [taskId],
  );
  return [
    ...commentRows.map(r => ({ ...r, target_type: 'comment' })),
    ...mediaRows.map(r => ({ ...r, target_type: 'media' })),
  ] as AnalysisResult[];
}
```

在 `src/shared/types.ts` 中追加 `AnalysisResult` 通用接口（如果尚未存在）：

```typescript
export interface AnalysisResult {
  id: string;
  task_id: string;
  target_type: string;
  target_id: string | null;
  summary: string | null;
  raw_response: Record<string, unknown> | null;
  analyzed_at: Date;
}
```

- [ ] **Step 3: 构建并验证 CLI 命令列表**

Run:
```bash
npm run build
node dist/cli/index.js task --help
```

Expected: 输出中包含 `step`、`run-all-steps`、`results` 子命令。

- [ ] **Step 4: Commit**

```bash
git add src/cli/task.ts src/db/analysis-results.ts src/shared/types.ts
git commit -m "feat(cli): add task step add/list/run, run-all-steps and results commands"
```

---

### Task 7: 在 daemon handlers 中实现 task step 相关 handlers

**Files:**
- Modify: `src/daemon/handlers.ts`

- [ ] **Step 1: 在 handlers 对象中插入新 handlers**

在 `src/daemon/handlers.ts` 的 `getHandlers()` 返回对象中，紧接 `task.status` 之后插入：

```typescript
async 'task.step.add'(params) {
  const taskId = params.task_id as string;
  const strategyId = params.strategy_id as string;
  const name = (params.name as string | undefined) ?? strategyId;
  const { createTaskStep, getNextStepOrder } = await import('../db/task-steps');
  const { getStrategyById } = await import('../db/strategies');

  const strategy = await getStrategyById(strategyId);
  if (!strategy) throw new Error(`Strategy not found: ${strategyId}`);

  const stepOrder = (params.order as number | undefined) ?? await getNextStepOrder(taskId);
  const step = await createTaskStep({
    task_id: taskId,
    strategy_id: strategyId,
    name,
    step_order: stepOrder,
    status: 'pending',
    stats: { total: 0, done: 0, failed: 0 },
    error: null,
  });
  return { stepId: step.id, stepOrder: step.step_order };
},

async 'task.step.list'(params) {
  const taskId = params.task_id as string;
  const { listTaskSteps } = await import('../db/task-steps');
  return listTaskSteps(taskId);
},

async 'task.step.run'(params) {
  const taskId = params.task_id as string;
  const stepId = params.step_id as string;
  const { getTaskStepById, updateTaskStepStatus } = await import('../db/task-steps');
  const { listTaskTargets } = await import('../db/task-targets');
  const { getStrategyById } = await import('../db/strategies');
  const { enqueueJobs } = await import('../db/queue-jobs');
  const { generateId } = await import('../shared/utils');

  const step = await getTaskStepById(stepId);
  if (!step) throw new Error(`Step not found: ${stepId}`);
  if (step.task_id !== taskId) throw new Error('Step does not belong to this task');
  if (step.status === 'completed') {
    return { status: 'completed', enqueued: 0 };
  }
  if (step.status === 'skipped') {
    return { status: 'skipped', enqueued: 0 };
  }

  const strategy = await getStrategyById(step.strategy_id ?? '');
  if (!strategy) throw new Error(`Strategy not found: ${step.strategy_id}`);

  const targets = await listTaskTargets(taskId);
  const relevantTargets = targets.filter(t => {
    if (strategy.target === 'post') return t.target_type === 'post';
    if (strategy.target === 'comment') return t.target_type === 'comment';
    return true;
  });

  if (relevantTargets.length === 0) {
    await updateTaskStepStatus(stepId, 'skipped', { total: 0, done: 0, failed: 0 });
    return { status: 'skipped', enqueued: 0 };
  }

  const jobs = relevantTargets.map(t => ({
    id: generateId(),
    task_id: taskId,
    strategy_id: strategy.id,
    target_type: strategy.target as 'post' | 'comment' | 'media',
    target_id: t.target_id,
    status: 'pending' as const,
    priority: 0,
    attempts: 0,
    max_attempts: 3,
    error: null,
    created_at: new Date(),
    processed_at: null,
  }));

  await enqueueJobs(jobs);
  await updateTaskStepStatus(stepId, 'running', { total: jobs.length, done: 0, failed: 0 });

  return { status: 'running', enqueued: jobs.length };
},

async 'task.runAllSteps'(params) {
  const taskId = params.task_id as string;
  const { listTaskSteps, updateTaskStepStatus } = await import('../db/task-steps');
  const steps = await listTaskSteps(taskId);
  const pendingSteps = steps.filter(s => s.status === 'pending' || s.status === 'failed');

  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const step of pendingSteps) {
    try {
      const result = await (this as any)['task.step.run']({ task_id: taskId, step_id: step.id });
      if (result.status === 'skipped') {
        skipped++;
      } else {
        completed++;
      }
    } catch (err: unknown) {
      await updateTaskStepStatus(stepId, 'failed', undefined, err instanceof Error ? err.message : String(err));
      failed++;
    }
  }

  const remaining = steps.filter(s => s.status === 'pending' || s.status === 'running');
  if (remaining.length === 0 && steps.every(s => s.status === 'completed' || s.status === 'skipped' || s.status === 'failed')) {
    await updateTaskStatus(taskId, 'completed');
  }

  return { completed, failed, skipped };
},
```

- [ ] **Step 2: 确保 worker 完成 job 后更新 task_steps stats**

需要修改 `src/worker/consumer.ts`（或现有的 job 完成回调），在 job 完成后更新对应 step 的 `stats`。由于 `queue_jobs` 表已有 `strategy_id` 字段，可以通过 `task_id + strategy_id` 找到 `task_steps` 记录并更新进度。

在 `src/worker/consumer.ts` 中，找到 job 处理完成后的位置，添加：

```typescript
import { updateTaskStepStatus } from '../db/task-steps';
import { listJobsByTask } from '../db/queue-jobs';

async function syncStepStats(taskId: string, strategyId: string): Promise<void> {
  const jobs = await listJobsByTask(taskId);
  const strategyJobs = jobs.filter(j => j.strategy_id === strategyId);
  const total = strategyJobs.length;
  const done = strategyJobs.filter(j => j.status === 'completed').length;
  const failed = strategyJobs.filter(j => j.status === 'failed').length;
  const { listTaskSteps } = await import('../db/task-steps');
  const steps = await listTaskSteps(taskId);
  const step = steps.find(s => s.strategy_id === strategyId);
  if (!step) return;

  let status: 'running' | 'completed' | 'failed' = 'running';
  if (done === total) status = 'completed';
  else if (failed > 0 && done + failed === total) status = 'failed';

  await updateTaskStepStatus(step.id, status, { total, done, failed });
}
```

然后在 job 成功和失败处理的末尾分别调用 `syncStepStats(job.task_id, job.strategy_id ?? '')`。

- [ ] **Step 3: 构建并运行离线测试**

Run:
```bash
npm run build
node --test --experimental-strip-types test/import-offline.test.ts
```

Expected: 12/12 pass。

- [ ] **Step 4: Commit**

```bash
git add src/daemon/handlers.ts src/worker/consumer.ts
git commit -m "feat(daemon): implement task step add, list, run and run-all handlers with step stats sync"
```

---

### Task 8: 创建 Claude Code Custom Skill

**Files:**
- Create: `.claude/skills/analyze-cli/skill.md`

- [ ] **Step 1: 编写 skill.md**

创建 `.claude/skills/analyze-cli/skill.md`：

```markdown
---
name: analyze-cli
description: Social media data analysis CLI — search, import, download comments/media, and run multi-step strategy analysis.
type: tool-use
---

# analyze-cli Skill

You are an agent that operates the `analyze-cli` command-line tool for social media content analysis.

## Capabilities

Use the tools below to help the user complete data gathering and analysis workflows.

### 1. search_posts
Search for posts on a platform via OpenCLI.
- Command: `opencli xiaohongshu search {query} --limit {limit} -f json`
- When to use: the user wants to discover posts before importing.

### 2. add_platform
Register a platform if it does not already exist.
- Command: `analyze-cli platform add --id {id} --name {name}`
- When to use: before importing posts for a new platform.

### 3. import_posts
Import posts from a JSON/JSONL file and optionally bind them to a task.
- Command: `analyze-cli post import --platform {id} --file {path} [--task-id {task_id}]`
- When to use: after search results have been saved to a file.
- Duplicate posts (same platform_id + platform_post_id) are updated, not skipped.

### 4. create_task
Create an analysis task.
- Command: `analyze-cli task create --name {name} [--cli-templates '{"fetch_comments":"...","fetch_media":"..."}']`
- When to use: before adding analysis steps or binding posts.

### 5. add_step_to_task
Add a strategy-based analysis step to a task.
- Command: `analyze-cli task step add --task-id {task_id} --strategy-id {strategy_id} [--name {name}] [--order {n}]`
- When to use: the user wants to analyze data with a specific strategy (sentiment-topics, risk-detection, etc.).

### 6. prepare_task_data
Download comments and media for all posts bound to a task.
- Command: `analyze-cli task prepare-data --task-id {task_id}`
- When to use: after posts have been imported and bound to the task.
- This command is resumable; interrupted runs will continue from unfinished posts.

### 7. run_task_step
Run a single task step.
- Command: `analyze-cli task step run --task-id {task_id} --step-id {step_id}`
- When to use: the user wants to execute one specific strategy step.

### 8. run_all_steps
Run all pending/failed steps for a task in order.
- Command: `analyze-cli task run-all-steps --task-id {task_id}`
- When to use: the user wants to start the full analysis pipeline after data preparation.

### 9. get_task_status
Check the current status of a task, including data-preparation progress and each step's progress.
- Command: `analyze-cli task status --task-id {task_id}`
- When to use: after starting analysis to monitor progress.
- Read the `phase` field (`dataPreparation` or `analysis`) and the `phases` object to report progress.

### 10. get_task_results
Show analysis results for a completed task.
- Command: `analyze-cli task results --task-id {task_id}`
- When to use: after the task status shows `completed`.

## Workflow Guidance

1. If the user asks to "analyze" platform content, start with `search_posts` → `add_platform` → `create_task` → `import_posts` (with `--task-id`).
2. Then `add_step_to_task` for each strategy they need.
3. Run `prepare_task_data` to fetch comments and media.
4. Run `run_all_steps` to start the analysis pipeline.
5. Poll `get_task_status` periodically and report progress:
   - phase = `dataPreparation`: report `commentsFetched / totalPosts` and `mediaFetched / totalPosts`.
   - phase = `analysis`: for each running step, report `done / total` from its `stats`.
   - status = `completed`: proceed to `get_task_results`.
6. If a step or data-preparation fails, report the error and ask if the user wants to retry.
```

- [ ] **Step 2: Commit**

```bash
git add .claude/skills/analyze-cli/skill.md
git commit -m "feat(skill): add Claude Code custom skill for analyze-cli"
```

---

## Spec 覆盖度检查

| Spec 要求 | 对应 Task |
|-----------|-----------|
| 新增 `task_steps` 表 | Task 1 |
| `task_steps` CRUD | Task 2 |
| `prepare-data` 断点续传 | Task 3 |
| `task.status` 聚合升级 | Task 4 |
| `post import` upsert + `--task-id` | Task 5 |
| CLI 新增 step/run-all-steps/results 命令 | Task 6 |
| Daemon handlers 新增 step 相关逻辑 | Task 7 |
| Custom Skill markdown | Task 8 |

## Placeholder 扫描

- 无 TBD/TODO ✅
- 所有代码块完整 ✅
- 所有命令带预期输出 ✅

## 类型一致性

- `TaskStep` 与 `task_steps` 表结构一致 ✅
- `task.status` 返回值中的 `phases` 结构与 CLI 消费端一致 ✅
- `post.import` 返回 `{ imported, skipped, postIds }` 与 CLI 打印端一致 ✅
