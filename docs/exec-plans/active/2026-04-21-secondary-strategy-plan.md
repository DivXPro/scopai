# 二次分析策略 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a strategy to use another strategy's analysis results as input, enabling chained analysis workflows (e.g., score posts first, then judge risk level based on scores).

**Architecture:** Add `depends_on` and `include_original` fields to the Strategy type/schema for declaring dependency. Add `depends_on_step_id` to task_steps for runtime binding. When the worker processes a job for a strategy with `depends_on`, it queries the upstream strategy's result for the same target_id and injects it into the prompt via `{{upstream_result}}` placeholder. If `include_original` is true, also inject `{{original_content}}`.

**Tech Stack:** TypeScript, DuckDB SQL, Node.js test runner

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/shared/types.ts` | Add `depends_on`, `include_original` to Strategy; add `depends_on_step_id` to TaskStep |
| Modify | `src/db/schema.sql` | Add columns to `strategies` and `task_steps` tables |
| Modify | `src/db/migrate.ts` | Add migration for new columns |
| Modify | `src/db/strategies.ts` | Update `createStrategy`, `parseStrategyRow`, `validateStrategyJson`, `updateStrategy` |
| Modify | `src/db/task-steps.ts` | Update `createTaskStep` to include `depends_on_step_id` |
| Modify | `src/db/analysis-results.ts` | Add `getUpstreamResult` function to query a single upstream result |
| Modify | `src/worker/anthropic.ts` | Add `{{upstream_result}}` and `{{original_content}}` placeholder injection in `buildStrategyPrompt` and `buildCommentPrompt` |
| Modify | `src/worker/consumer.ts` | In `processStrategyJob`, resolve upstream result before calling analyze |
| Modify | `src/daemon/handlers.ts` | Update `task.step.add` handler with validation; update `task.step.list` to show dependency |
| Modify | `src/daemon/stream-scheduler.ts` | Skip secondary strategy steps in stream scheduler (they run after upstream completes) |
| Modify | `src/cli/task.ts` | Add `--depends-on-step-id` option to step add command |
| Modify | `test/integration/strategy-system.test.ts` | Add tests for secondary strategy flow |

---

### Task 1: Update TypeScript types

**Files:**
- Modify: `src/shared/types.ts:317-330` (Strategy interface)
- Modify: `src/shared/types.ts:138-149` (TaskStep interface)

- [ ] **Step 1: Add `depends_on` and `include_original` to Strategy interface**

In `src/shared/types.ts`, add two fields to the `Strategy` interface after `batch_config`:

```typescript
export interface Strategy {
  id: string;
  name: string;
  description: string | null;
  version: string;
  target: 'post' | 'comment';
  needs_media: NeedsMediaConfig | null;
  prompt: string;
  output_schema: Record<string, unknown>;
  batch_config: BatchConfig | null;
  depends_on: 'post' | 'comment' | null;
  include_original: boolean;
  file_path: string | null;
  created_at: Date;
  updated_at: Date;
}
```

- [ ] **Step 2: Add `depends_on_step_id` to TaskStep interface**

In `src/shared/types.ts`, add `depends_on_step_id` to the `TaskStep` interface after `strategy_id`:

```typescript
export interface TaskStep {
  id: string;
  task_id: string;
  strategy_id: string | null;
  depends_on_step_id: string | null;
  name: string;
  step_order: number;
  status: TaskStepStatus;
  stats: TaskStats | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(types): add depends_on, include_original to Strategy and depends_on_step_id to TaskStep"
```

---

### Task 2: Update database schema and migration

**Files:**
- Modify: `src/db/schema.sql:197-226`
- Modify: `src/db/migrate.ts:80-108`

- [ ] **Step 1: Add columns to schema.sql**

In `src/db/schema.sql`, add `depends_on` and `include_original` columns to the `strategies` table (after `batch_config`):

```sql
CREATE TABLE IF NOT EXISTS strategies (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    version         TEXT NOT NULL DEFAULT '1.0.0',
    target          TEXT NOT NULL CHECK(target IN ('post', 'comment')),
    needs_media     JSON,
    prompt          TEXT NOT NULL,
    output_schema   JSON NOT NULL,
    batch_config    JSON,
    depends_on      TEXT CHECK(depends_on IN ('post', 'comment') OR depends_on IS NULL),
    include_original BOOLEAN NOT NULL DEFAULT false,
    file_path       TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);
```

Add `depends_on_step_id` column to the `task_steps` table (after `strategy_id`):

```sql
CREATE TABLE IF NOT EXISTS task_steps (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    strategy_id     TEXT REFERENCES strategies(id),
    depends_on_step_id TEXT REFERENCES task_steps(id),
    name            TEXT NOT NULL,
    step_order      INTEGER NOT NULL DEFAULT 0,
    status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','skipped')),
    stats           JSON,
    error           TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(task_id, strategy_id)
);
```

- [ ] **Step 2: Add migration functions in migrate.ts**

Add two new migration functions after `migrateBatchConfigColumn`:

```typescript
async function migrateDependsOnColumns(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'strategies'"
  );
  if (!columns.some(c => c.name === 'depends_on')) {
    await exec("ALTER TABLE strategies ADD COLUMN depends_on TEXT CHECK(depends_on IN ('post', 'comment') OR depends_on IS NULL)");
  }
  if (!columns.some(c => c.name === 'include_original')) {
    await exec('ALTER TABLE strategies ADD COLUMN include_original BOOLEAN NOT NULL DEFAULT false');
  }
}

async function migrateTaskStepsDependsOn(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'task_steps'"
  );
  if (!columns.some(c => c.name === 'depends_on_step_id')) {
    await exec('ALTER TABLE task_steps ADD COLUMN depends_on_step_id TEXT REFERENCES task_steps(id)');
  }
}
```

Add calls in `runMigrations` after `migrateBatchConfigColumn()`:

```typescript
await migrateDependsOnColumns();
await migrateTaskStepsDependsOn();
```

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.sql src/db/migrate.ts
git commit -m "feat(db): add depends_on, include_original to strategies and depends_on_step_id to task_steps"
```

---

### Task 3: Update strategy CRUD and validation

**Files:**
- Modify: `src/db/strategies.ts:5-62` (createStrategy, parseStrategyRow)
- Modify: `src/db/strategies.ts:64-103` (validateStrategyJson)
- Modify: `src/db/strategies.ts:33-49` (updateStrategy)

- [ ] **Step 1: Update createStrategy to include new columns**

In `src/db/strategies.ts`, update the `createStrategy` INSERT to include `depends_on` and `include_original`:

```typescript
export async function createStrategy(strategy: Omit<Strategy, 'created_at' | 'updated_at'>): Promise<void> {
  const columnDefs = parseJsonSchemaToColumns(strategy.output_schema as Record<string, unknown>);
  await createStrategyResultTable(strategy.id, columnDefs);

  await run(
    `INSERT INTO strategies (id, name, description, version, target, needs_media, prompt, output_schema, batch_config, depends_on, include_original, file_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      strategy.id, strategy.name ?? null, strategy.description ?? null, strategy.version, strategy.target,
      strategy.needs_media != null ? JSON.stringify(strategy.needs_media) : null,
      strategy.prompt, JSON.stringify(strategy.output_schema),
      strategy.batch_config != null ? JSON.stringify(strategy.batch_config) : null,
      strategy.depends_on ?? null,
      strategy.include_original ?? false,
      strategy.file_path ?? null,
      now(), now(),
    ]
  );
}
```

- [ ] **Step 2: Update parseStrategyRow**

```typescript
function parseStrategyRow(row: Strategy): Strategy {
  return {
    ...row,
    needs_media: typeof row.needs_media === 'string' ? JSON.parse(row.needs_media) : row.needs_media,
    output_schema: typeof row.output_schema === 'string' ? JSON.parse(row.output_schema) : row.output_schema,
    batch_config: typeof row.batch_config === 'string' ? JSON.parse(row.batch_config) : row.batch_config,
    depends_on: (row as any).depends_on ?? null,
    include_original: (row as any).include_original ?? false,
  } as Strategy;
}
```

- [ ] **Step 3: Update validateStrategyJson to validate depends_on and include_original**

Add after the `batch_config` validation block (after line 92):

```typescript
if (obj.depends_on !== undefined && obj.depends_on !== null) {
  if (obj.depends_on !== 'post' && obj.depends_on !== 'comment') {
    return { valid: false, error: `Invalid depends_on: ${obj.depends_on}. Must be 'post' or 'comment'` };
  }
}
if (obj.include_original !== undefined && typeof obj.include_original !== 'boolean') {
  return { valid: false, error: 'include_original must be a boolean' };
}
```

- [ ] **Step 4: Update updateStrategy to support new fields**

Add to the `updateStrategy` function's `Pick` type and body:

```typescript
export async function updateStrategy(id: string, updates: Partial<Pick<Strategy, 'name' | 'description' | 'version' | 'prompt' | 'output_schema' | 'needs_media' | 'batch_config' | 'depends_on' | 'include_original' | 'file_path'>>): Promise<void> {
```

Add in the body after the `batch_config` update block:

```typescript
if (updates.depends_on !== undefined) { sets.push('depends_on = ?'); values.push(updates.depends_on ?? null); }
if (updates.include_original !== undefined) { sets.push('include_original = ?'); values.push(updates.include_original); }
```

- [ ] **Step 5: Commit**

```bash
git add src/db/strategies.ts
git commit -m "feat(db/strategies): support depends_on and include_original in CRUD and validation"
```

---

### Task 4: Update task-steps CRUD

**Files:**
- Modify: `src/db/task-steps.ts:5-27` (createTaskStep)
- Modify: `src/db/task-steps.ts:29-45` (listTaskSteps, getTaskStepById)

- [ ] **Step 1: Update createTaskStep to include depends_on_step_id**

```typescript
export async function createTaskStep(
  step: Omit<TaskStep, 'id' | 'created_at' | 'updated_at'>,
): Promise<TaskStep> {
  const id = generateId();
  const ts = now();
  await run(
    `INSERT INTO task_steps (id, task_id, strategy_id, depends_on_step_id, name, step_order, status, stats, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      step.task_id,
      step.strategy_id ?? null,
      step.depends_on_step_id ?? null,
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
```

- [ ] **Step 2: Update listTaskSteps and getTaskStepById to parse depends_on_step_id**

In `listTaskSteps`:

```typescript
export async function listTaskSteps(taskId: string): Promise<TaskStep[]> {
  const rows = await query<TaskStep>(
    'SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_order, created_at',
    [taskId],
  );
  return rows.map(r => ({
    ...r,
    depends_on_step_id: (r as any).depends_on_step_id ?? null,
    stats: typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats,
  }));
}
```

In `getTaskStepById`:

```typescript
export async function getTaskStepById(stepId: string): Promise<TaskStep | null> {
  const rows = await query<TaskStep>('SELECT * FROM task_steps WHERE id = ?', [stepId]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...r, depends_on_step_id: (r as any).depends_on_step_id ?? null, stats: typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/db/task-steps.ts
git commit -m "feat(db/task-steps): support depends_on_step_id in CRUD"
```

---

### Task 5: Add upstream result query function

**Files:**
- Modify: `src/db/analysis-results.ts`

- [ ] **Step 1: Add getUpstreamResult function**

Add after `getExistingResultIds`:

```typescript
export async function getUpstreamResult(
  strategyId: string,
  taskId: string,
  targetId: string,
): Promise<Record<string, unknown> | null> {
  const tableName = getStrategyResultTableName(strategyId);
  const rows = await query<{ raw_response: string | null }>(
    `SELECT raw_response FROM "${tableName}" WHERE task_id = ? AND target_id = ? LIMIT 1`,
    [taskId, targetId],
  );
  if (rows.length === 0 || !rows[0].raw_response) return null;
  try {
    return typeof rows[0].raw_response === 'string'
      ? JSON.parse(rows[0].raw_response)
      : (rows[0].raw_response as unknown as Record<string, unknown>);
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/analysis-results.ts
git commit -m "feat(db/analysis-results): add getUpstreamResult for querying upstream strategy results"
```

---

### Task 6: Update prompt building to support upstream result injection

**Files:**
- Modify: `src/worker/anthropic.ts:63-93` (buildCommentPrompt)
- Modify: `src/worker/anthropic.ts:193-227` (buildStrategyPrompt)

- [ ] **Step 1: Add upstreamResult and originalContent parameters to buildStrategyPrompt**

Update `buildStrategyPrompt` signature and body:

```typescript
export async function buildStrategyPrompt(
  target: Post,
  strategy: Strategy,
  upstreamResult?: Record<string, unknown> | null,
): Promise<string> {
  const platform = target.platform_id ? await getPlatformById(target.platform_id) : null;
  const vars: Record<string, string> = {
    content: target.content ?? '',
    title: target.title ?? '',
    author_name: target.author_name ?? '匿名',
    platform: platform?.name ?? 'unknown',
    published_at: target.published_at?.toISOString() ?? '未知',
    tags: target.tags ? JSON.stringify(target.tags) : '',
    media_urls: '',
    upstream_result: upstreamResult ? JSON.stringify(upstreamResult, null, 2) : '',
    original_content: strategy.include_original ? (target.content ?? '') : '',
  };

  if (strategy.needs_media?.enabled) {
    const mediaFiles = await listMediaFilesByPost(target.id);
    const filtered = filterMediaFiles(mediaFiles, strategy.needs_media);
    if (filtered.length > 0) {
      const lines = filtered.map((m, i) => {
        const path = m.local_path ?? m.url ?? '';
        return `[媒体 ${i + 1}] ${path}`;
      });
      vars.media_urls = '\n' + lines.join('\n') + '\n';
    }
  }

  let result = strategy.prompt;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  const schemaHint = buildSchemaHint(strategy.output_schema);
  if (schemaHint) {
    result += `\n\n${schemaHint}`;
  }
  return result;
}
```

- [ ] **Step 2: Add upstreamResult parameter to buildCommentPrompt**

Update `buildCommentPrompt` signature and body:

```typescript
export async function buildCommentPrompt(
  comment: Comment,
  strategy: Strategy,
  upstreamResult?: Record<string, unknown> | null,
): Promise<string> {
  const platform = comment.platform_id ? await getPlatformById(comment.platform_id) : null;

  let parentAuthor = '';
  if (comment.parent_comment_id) {
    const parent = await getCommentById(comment.parent_comment_id);
    parentAuthor = parent?.author_name ?? '';
  }

  const vars: Record<string, string> = {
    content: comment.content ?? '',
    author_name: comment.author_name ?? '匿名',
    platform: platform?.name ?? 'unknown',
    published_at: comment.published_at?.toISOString() ?? '未知',
    depth: String(comment.depth ?? 0),
    parent_author: parentAuthor,
    reply_count: String(comment.reply_count ?? 0),
    media_urls: '',
    upstream_result: upstreamResult ? JSON.stringify(upstreamResult, null, 2) : '',
    original_content: strategy.include_original ? (comment.content ?? '') : '',
  };

  let result = strategy.prompt;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  const schemaHint = buildSchemaHint(strategy.output_schema);
  if (schemaHint) {
    result += `\n\n${schemaHint}`;
  }
  return result;
}
```

- [ ] **Step 3: Update analyzeWithStrategy to pass upstreamResult**

```typescript
export async function analyzeWithStrategy(
  target: Post | Comment,
  strategy: Strategy,
  upstreamResult?: Record<string, unknown> | null,
): Promise<string> {
  const prompt = 'post_id' in target
    ? await buildCommentPrompt(target, strategy, upstreamResult)
    : await buildStrategyPrompt(target, strategy, upstreamResult);

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.max_tokens,
    temperature: config.anthropic.temperature,
    tools: [
      {
        name: 'output_analysis',
        description: 'Return the analysis result in the required JSON structure',
        input_schema: strategy.output_schema as any,
      },
    ],
    tool_choice: { type: 'tool', name: 'output_analysis' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(c => c.type === 'tool_use');
  if (toolUse && 'input' in toolUse) {
    return JSON.stringify(toolUse.input);
  }

  const text = response.content.find(c => c.type === 'text');
  return text && 'text' in text ? text.text : '';
}
```

- [ ] **Step 4: Commit**

```bash
git add src/worker/anthropic.ts
git commit -m "feat(worker/anthropic): support upstream_result and original_content placeholders in prompts"
```

---

### Task 7: Update consumer to resolve upstream results

**Files:**
- Modify: `src/worker/consumer.ts:234-324` (processStrategyJob)

- [ ] **Step 1: Add upstream result resolution in processStrategyJob**

At the top of `processStrategyJob`, after loading the strategy, add upstream result resolution:

```typescript
async function processStrategyJob(
  job: QueueJob,
  task: { id: string; name: string },
  workerId: number,
): Promise<void> {
  if (!job.strategy_id) throw new Error('Job has no strategy_id');
  if (!job.target_id) throw new Error('Job has no target_id');

  const strategy = await getStrategyById(job.strategy_id);
  if (!strategy) throw new Error(`Strategy ${job.strategy_id} not found`);

  // Resolve upstream result for secondary strategies
  let upstreamResult: Record<string, unknown> | null = null;
  if (strategy.depends_on) {
    upstreamResult = await resolveUpstreamResult(job.task_id, job.strategy_id, job.target_id);
  }

  if (strategy.target === 'post') {
    const post = await getPostById(job.target_id);
    if (!post) throw new Error(`Post ${job.target_id} not found`);

    const rawResponse = await analyzeWithStrategy(post, strategy, upstreamResult);
    // ... rest unchanged
```

Also update the single comment analysis call:

```typescript
    // Single comment analysis
    const rawResponse = await analyzeWithStrategy(comment, strategy, upstreamResult);
```

- [ ] **Step 2: Add resolveUpstreamResult helper function**

Add before `processStrategyJob`:

```typescript
async function resolveUpstreamResult(
  taskId: string,
  strategyId: string,
  targetId: string,
): Promise<Record<string, unknown> | null> {
  const { listTaskSteps } = await import('../db/task-steps');
  const { getStrategyById } = await import('../db/strategies');
  const { getUpstreamResult } = await import('../db/analysis-results');

  const steps = await listTaskSteps(taskId);
  const currentStep = steps.find(s => s.strategy_id === strategyId);
  if (!currentStep || !currentStep.depends_on_step_id) return null;

  const upstreamStep = steps.find(s => s.id === currentStep.depends_on_step_id);
  if (!upstreamStep || !upstreamStep.strategy_id) return null;

  return getUpstreamResult(upstreamStep.strategy_id, taskId, targetId);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/worker/consumer.ts
git commit -m "feat(worker/consumer): resolve upstream results for secondary strategy jobs"
```

---

### Task 8: Update daemon handlers

**Files:**
- Modify: `src/daemon/handlers.ts:471-492` (task.step.add handler)
- Modify: `src/daemon/handlers.ts:494-498` (task.step.list handler)

- [ ] **Step 1: Update task.step.add handler with depends_on_step_id and validation**

```typescript
async 'task.step.add'(params) {
  const taskId = params.task_id as string;
  const strategyId = params.strategy_id as string;
  const dependsOnStepId = params.depends_on_step_id as string | undefined;
  const name = (params.name as string | undefined) ?? strategyId;
  const { createTaskStep, getNextStepOrder, getTaskStepById } = await import('../db/task-steps');
  const { getStrategyById } = await import('../db/strategies');

  const strategy = await getStrategyById(strategyId);
  if (!strategy) throw new Error(`Strategy not found: ${strategyId}`);

  // Validate dependency
  if (strategy.depends_on) {
    if (!dependsOnStepId) {
      throw new Error(`Strategy "${strategy.name}" requires depends_on_step_id (it depends on upstream results)`);
    }
    const upstreamStep = await getTaskStepById(dependsOnStepId);
    if (!upstreamStep) throw new Error(`Upstream step not found: ${dependsOnStepId}`);
    if (upstreamStep.task_id !== taskId) throw new Error('Upstream step does not belong to this task');
    if (!upstreamStep.strategy_id) throw new Error('Upstream step has no strategy');

    const upstreamStrategy = await getStrategyById(upstreamStep.strategy_id);
    if (!upstreamStrategy) throw new Error(`Upstream strategy not found: ${upstreamStep.strategy_id}`);
    if (upstreamStrategy.target !== strategy.depends_on) {
      throw new Error(`Strategy depends_on="${strategy.depends_on}" but upstream strategy target="${upstreamStrategy.target}"`);
    }
  }

  const stepOrder = (params.order as number | undefined) ?? await getNextStepOrder(taskId);
  const step = await createTaskStep({
    task_id: taskId,
    strategy_id: strategyId,
    depends_on_step_id: dependsOnStepId ?? null,
    name,
    step_order: stepOrder,
    status: 'pending',
    stats: { total: 0, done: 0, failed: 0 },
    error: null,
  });
  return { stepId: step.id, stepOrder: step.step_order };
},
```

- [ ] **Step 2: Update task.step.list to include depends_on_step_id**

The `listTaskSteps` function already returns all columns. The `depends_on_step_id` will be included automatically after the TaskStep type update. No handler change needed.

- [ ] **Step 3: Update task.runAllSteps to respect dependency order**

In the `task.runAllSteps` handler, sort steps by dependency order. Replace the simple filter with a topological sort:

```typescript
async 'task.runAllSteps'(params) {
  const taskId = params.task_id as string;
  const { listTaskSteps, updateTaskStepStatus } = await import('../db/task-steps');
  const steps = await listTaskSteps(taskId);

  // Topological sort: steps with dependencies come after their upstream
  const stepMap = new Map(steps.map(s => [s.id, s]));
  const sorted = [...steps].sort((a, b) => {
    if (a.depends_on_step_id === b.id) return 1;
    if (b.depends_on_step_id === a.id) return -1;
    return a.step_order - b.step_order;
  });

  const pendingSteps = sorted.filter(s => s.status === 'pending' || s.status === 'failed');

  let completed = 0;
  let failed = 0;
  let skipped = 0;

  for (const step of pendingSteps) {
    // Wait for upstream step to complete if there's a dependency
    if (step.depends_on_step_id) {
      const upstreamStep = stepMap.get(step.depends_on_step_id);
      if (upstreamStep && upstreamStep.status !== 'completed') {
        // Skip for now; will be picked up after upstream completes
        continue;
      }
    }

    try {
      const result = await (this as any)['task.step.run']({ task_id: taskId, step_id: step.id });
      if (result.status === 'skipped') {
        skipped++;
      } else {
        completed++;
      }
    } catch (err: unknown) {
      await updateTaskStepStatus(step.id, 'failed', undefined, err instanceof Error ? err.message : String(err));
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

- [ ] **Step 4: Commit**

```bash
git add src/daemon/handlers.ts
git commit -m "feat(daemon): validate depends_on in step.add, sort by dependency in runAllSteps"
```

---

### Task 9: Update stream scheduler to skip secondary strategy steps

**Files:**
- Modify: `src/daemon/stream-scheduler.ts:36-102`

- [ ] **Step 1: Add depends_on_step_id to StepInfo and skip dependent steps**

Update `StepInfo` interface:

```typescript
export interface StepInfo {
  id: string;
  strategy_id: string | null;
  depends_on_step_id: string | null;
  status: string;
  stats?: { total: number; done: number; failed: number } | null;
}
```

In `buildJobsForPost`, add a skip condition for steps that depend on another step (they can't run until upstream completes):

```typescript
const pendingSteps = steps.filter(s =>
  (s.status === 'pending' || s.status === 'running') && !s.depends_on_step_id
);
```

Steps with `depends_on_step_id` are excluded from stream scheduling — they will be enqueued by `task.step.run` after the upstream step completes.

- [ ] **Step 2: Commit**

```bash
git add src/daemon/stream-scheduler.ts
git commit -m "feat(stream-scheduler): skip secondary strategy steps that depend on upstream"
```

---

### Task 10: Update CLI commands

**Files:**
- Modify: `src/cli/task.ts:224-239` (step add command)

- [ ] **Step 1: Add --depends-on-step-id option to step add command**

```typescript
stepCmd
  .command('add')
  .description('Add an analysis step to a task')
  .requiredOption('--task-id <id>', 'Task ID')
  .requiredOption('--strategy-id <id>', 'Strategy ID')
  .option('--depends-on-step-id <id>', 'Upstream step ID (for secondary strategies)')
  .option('--name <name>', 'Step name')
  .option('--order <n>', 'Step order (auto-increment if omitted)')
  .action(async (opts: { taskId: string; strategyId: string; dependsOnStepId?: string; name?: string; order?: string }) => {
    const result = await daemonCall('task.step.add', {
      task_id: opts.taskId,
      strategy_id: opts.strategyId,
      depends_on_step_id: opts.dependsOnStepId,
      name: opts.name,
      order: opts.order ? parseInt(opts.order, 10) : undefined,
    }) as { stepId: string; stepOrder: number };
    console.log(pc.green(`Step added: ${result.stepId} (order=${result.stepOrder})`));
  });
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/task.ts
git commit -m "feat(cli/task): add --depends-on-step-id option to step add command"
```

---

### Task 11: Add integration tests

**Files:**
- Modify: `test/integration/strategy-system.test.ts`

- [ ] **Step 1: Add test for secondary strategy schema migration**

```typescript
it('should have depends_on and include_original columns in strategies table', async () => {
  const rows = await query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'strategies' AND column_name IN ('depends_on', 'include_original')"
  );
  const columns = rows.map(r => r.column_name);
  assert.ok(columns.includes('depends_on'));
  assert.ok(columns.includes('include_original'));
});

it('should have depends_on_step_id column in task_steps table', async () => {
  const rows = await query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'task_steps' AND column_name = 'depends_on_step_id'"
  );
  assert.equal(rows.length, 1);
});
```

- [ ] **Step 2: Add test for strategy validation with depends_on**

```typescript
it('should validate depends_on field', async () => {
  const valid = validateStrategyJson({
    id: 'test-secondary',
    name: 'Secondary Strategy',
    version: '1.0.0',
    target: 'post',
    depends_on: 'post',
    include_original: true,
    prompt: 'Based on: {{upstream_result}}\n\nOriginal: {{original_content}}',
    output_schema: {
      type: 'object',
      properties: {
        risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
      },
      required: ['risk_level'],
    },
  });
  assert.equal(valid.valid, true);
});

it('should reject invalid depends_on value', async () => {
  const result = validateStrategyJson({
    id: 'test-bad-depends',
    name: 'Bad Depends',
    version: '1.0.0',
    target: 'post',
    depends_on: 'invalid',
    prompt: 'test',
    output_schema: { type: 'object', properties: { x: { type: 'string' } } },
  });
  assert.equal(result.valid, false);
  assert.ok(result.error?.includes('depends_on'));
});
```

- [ ] **Step 3: Add test for creating and querying secondary strategy**

```typescript
it('should create a secondary strategy with depends_on', async () => {
  await createStrategy({
    id: 'e2e-secondary-strategy',
    name: 'Risk Judgment',
    description: 'Judge risk based on scoring results',
    version: '1.0.0',
    target: 'post',
    needs_media: null,
    prompt: 'Based on scoring result:\n{{upstream_result}}\n\nJudge the risk level.',
    output_schema: {
      type: 'object',
      properties: {
        risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
        explanation: { type: 'string' },
      },
      required: ['risk_level', 'explanation'],
    },
    batch_config: null,
    depends_on: 'post',
    include_original: true,
    file_path: null,
  });

  const strategy = await getStrategyById('e2e-secondary-strategy');
  assert.ok(strategy);
  assert.equal(strategy.depends_on, 'post');
  assert.equal(strategy.include_original, true);
});
```

- [ ] **Step 4: Add test for step add with depends_on_step_id**

```typescript
it('should add step with depends_on_step_id', async () => {
  const { createTaskStep } = await import('../../dist/db/task-steps.js');
  const step = await createTaskStep({
    task_id: 'test-task',
    strategy_id: 'e2e-secondary-strategy',
    depends_on_step_id: null,
    name: 'Secondary step',
    step_order: 2,
    status: 'pending',
    stats: { total: 0, done: 0, failed: 0 },
    error: null,
  });
  assert.ok(step.id);
  assert.equal(step.depends_on_step_id, null);
});
```

- [ ] **Step 5: Commit**

```bash
git add test/integration/strategy-system.test.ts
git commit -m "test: add integration tests for secondary strategy depends_on and include_original"
```

---

### Task 12: Build and run tests

- [ ] **Step 1: Build the project**

```bash
npm run build
```

Expected: Build succeeds with no type errors.

- [ ] **Step 2: Run integration tests**

```bash
npx tsx test/integration/strategy-system.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Fix any issues found during testing**

If tests fail, fix the issues and re-run.

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during integration testing"
```
