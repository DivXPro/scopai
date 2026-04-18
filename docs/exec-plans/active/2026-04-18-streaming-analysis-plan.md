# Streaming Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable per-post streaming analysis: when a post's data preparation completes, automatically enqueue analysis jobs so data fetching and analysis run in parallel.

**Architecture:** Add a Stream Scheduler module (`src/daemon/stream-scheduler.ts`) that is called from `runPrepareDataAsync` after each post finishes. The scheduler enumerates pending task steps and creates `queue_jobs` for each step's targets on that post. Fix the missing `strategy_id` column on `queue_jobs`.

**Tech Stack:** TypeScript, DuckDB, Node.js child_process, commander CLI

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/db/schema.sql` | Modify | Add `strategy_id` to `queue_jobs` table |
| `src/db/queue-jobs.ts` | Modify | `enqueueJob`/`enqueueJobs` accept optional `strategy_id`; add `getExistingJobTargets` |
| `src/daemon/stream-scheduler.ts` | Create | Core module: `onPostReady(taskId, postId)` enqueues jobs per step |
| `src/daemon/handlers.ts` | Modify | Wire scheduler into `runPrepareDataAsync`; fix `task.step.run` to skip already-enqueued targets |
| `src/cli/task-prepare.ts` | Modify | Update completion message to mention auto-started analysis |
| `test/stream-scheduler.test.ts` | Create | Unit tests for scheduler logic |

---

### Task 1: Schema migration — add strategy_id to queue_jobs

**Files:**
- Modify: `src/db/schema.sql:156-168`

**Context:** Currently `queue_jobs` has no `strategy_id` column, but `task.step.run` already passes it into the job object. We need to add the column so the scheduler can store it and the worker can use it.

- [ ] **Step 1: Add ALTER TABLE statement**

In `src/db/schema.sql`, after the `queue_jobs` table creation, add:

```sql
-- Migration: add strategy_id to queue_jobs (2026-04-18)
ALTER TABLE queue_jobs ADD COLUMN IF NOT EXISTS strategy_id TEXT REFERENCES strategies(id);
```

- [ ] **Step 2: Update the CREATE TABLE definition**

Also update the `CREATE TABLE` block for `queue_jobs` so new installs get the column from the start:

```sql
CREATE TABLE IF NOT EXISTS queue_jobs (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    strategy_id     TEXT REFERENCES strategies(id),
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
```

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.sql
git commit -m "feat(schema): add strategy_id to queue_jobs table

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 2: Update queue-jobs.ts — support strategy_id

**Files:**
- Modify: `src/db/queue-jobs.ts`
- Test: `test/queue-jobs.test.ts` (if exists) or add inline assertion

**Context:** `enqueueJob` currently hardcodes the INSERT columns. We need to add `strategy_id`.

- [ ] **Step 1: Update enqueueJob signature and SQL**

```typescript
export async function enqueueJob(job: QueueJob & { strategy_id?: string }): Promise<void> {
  await run(
    `INSERT INTO queue_jobs (id, task_id, strategy_id, target_type, target_id, status, priority, attempts, max_attempts, error, created_at, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [job.id, job.task_id, job.strategy_id ?? null, job.target_type, job.target_id, job.status, job.priority, job.attempts, job.max_attempts, job.error, job.created_at, job.processed_at]
  );
}
```

- [ ] **Step 2: Update enqueueJobs to pass strategy_id through**

No change needed to `enqueueJobs` itself since it just loops over `enqueueJob`.

- [ ] **Step 3: Add getExistingJobTargets helper**

```typescript
export async function getExistingJobTargets(
  taskId: string,
  strategyId: string,
): Promise<Set<string>> {
  const rows = await query<{ target_id: string }>(
    `SELECT target_id FROM queue_jobs WHERE task_id = ? AND strategy_id = ?`,
    [taskId, strategyId]
  );
  return new Set(rows.map(r => r.target_id));
}
```

- [ ] **Step 4: Verify types match**

Check `src/shared/types.ts` for `QueueJob` type. If it does not have `strategy_id?: string`, add it:

```typescript
export interface QueueJob {
  id: string;
  task_id: string;
  strategy_id?: string;
  target_type: 'post' | 'comment' | 'media';
  target_id: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  error: string | null;
  created_at: Date;
  processed_at: Date | null;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/db/queue-jobs.ts src/shared/types.ts
git commit -m "feat(db): support strategy_id in queue_jobs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 3: Create stream-scheduler.ts

**Files:**
- Create: `src/daemon/stream-scheduler.ts`
- Test: `test/stream-scheduler.test.ts`

**Context:** This is the core new module. When a post's data preparation completes, `onPostReady` is called. It enumerates pending steps and creates queue jobs for each.

- [ ] **Step 1: Write stream-scheduler.ts**

```typescript
import { listTaskSteps, updateTaskStepStatus } from '../db/task-steps';
import { getStrategyById } from '../db/strategies';
import { listTaskTargets } from '../db/task-targets';
import { getPostById } from '../db/posts';
import { query } from '../db/client';
import { enqueueJobs, getExistingJobTargets } from '../db/queue-jobs';
import { generateId, now } from '../shared/utils';

export interface EnqueueResult {
  enqueued: number;
  skipped: number;
}

/**
 * Called when a post's data preparation is complete.
 * Enqueues queue_jobs for all pending steps that target this post (or its comments).
 */
export async function onPostReady(
  taskId: string,
  postId: string,
): Promise<EnqueueResult> {
  const steps = await listTaskSteps(taskId);
  const pendingSteps = steps.filter(s => s.status === 'pending' || s.status === 'running');

  let totalEnqueued = 0;
  let totalSkipped = 0;

  for (const step of pendingSteps) {
    if (!step.strategy_id) continue;

    const strategy = await getStrategyById(step.strategy_id);
    if (!strategy) continue;

    // Check media dependency
    if (strategy.needs_media && strategy.needs_media.length > 0) {
      const mediaReady = await isPostMediaReady(taskId, postId);
      if (!mediaReady) {
        totalSkipped++;
        continue;
      }
    }

    // Resolve targets for this step on this post
    const targets = await resolveTargetsForPost(taskId, postId, strategy.target);
    if (targets.length === 0) continue;

    // Skip targets already enqueued for this step
    const existing = await getExistingJobTargets(taskId, step.strategy_id);
    const newTargets = targets.filter(t => !existing.has(t.target_id));

    if (newTargets.length === 0) continue;

    // Build jobs
    const jobs = newTargets.map(t => ({
      id: generateId(),
      task_id: taskId,
      strategy_id: step.strategy_id,
      target_type: strategy.target as 'post' | 'comment',
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
    totalEnqueued += jobs.length;

    // Update step status to running on first enqueue
    if (step.status === 'pending') {
      const currentTotal = (step.stats?.total ?? 0) + jobs.length;
      await updateTaskStepStatus(step.id, 'running', {
        total: currentTotal,
        done: step.stats?.done ?? 0,
        failed: step.stats?.failed ?? 0,
      });
    } else {
      // Already running, just update total
      const currentTotal = (step.stats?.total ?? 0) + jobs.length;
      await updateTaskStepStatus(step.id, 'running', {
        total: currentTotal,
        done: step.stats?.done ?? 0,
        failed: step.stats?.failed ?? 0,
      });
    }
  }

  return { enqueued: totalEnqueued, skipped: totalSkipped };
}

async function isPostMediaReady(taskId: string, postId: string): Promise<boolean> {
  const rows = await query<{ media_fetched: boolean }>(
    `SELECT media_fetched FROM task_post_status WHERE task_id = ? AND post_id = ?`,
    [taskId, postId]
  );
  return rows[0]?.media_fetched === true;
}

async function resolveTargetsForPost(
  taskId: string,
  postId: string,
  targetType: string,
): Promise<Array<{ target_id: string; target_type: string }>> {
  if (targetType === 'post') {
    // Verify this post is actually in the task
    const targets = await listTaskTargets(taskId);
    const isMember = targets.some(t => t.target_type === 'post' && t.target_id === postId);
    if (!isMember) return [];
    return [{ target_id: postId, target_type: 'post' }];
  }

  if (targetType === 'comment') {
    // Fetch all comments for this post
    const rows = await query<{ id: string }>(
      `SELECT id FROM comments WHERE post_id = ?`,
      [postId]
    );
    return rows.map(r => ({ target_id: r.id, target_type: 'comment' }));
  }

  return [];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/daemon/stream-scheduler.ts
git commit -m "feat(scheduler): add stream-scheduler module for per-post analysis

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 4: Wire scheduler into runPrepareDataAsync

**Files:**
- Modify: `src/daemon/handlers.ts:1176-1258`

**Context:** After each post's data is fully prepared, call `onPostReady` to enqueue analysis jobs.

- [ ] **Step 1: Add scheduler import and call**

In `runPrepareDataAsync`, after line 1251 (`await upsertTaskPostStatus(taskId, postId, { status: 'done' })`), add:

```typescript
      // Trigger streaming analysis for this post
      try {
        const { onPostReady } = await import('./stream-scheduler');
        const result = await onPostReady(taskId, postId);
        if (result.enqueued > 0) {
          console.log(`[stream-scheduler] Post ${postId}: enqueued ${result.enqueued} jobs`);
        }
      } catch (schedErr: unknown) {
        const msg = schedErr instanceof Error ? schedErr.message : String(schedErr);
        console.error(`[stream-scheduler] Failed to enqueue for post ${postId}:`, msg);
        // Non-fatal: data preparation continues regardless
      }
```

- [ ] **Step 2: Remove the final task status update to 'pending'**

Currently at line 1257:

```typescript
  await updateTaskStatus(taskId, 'pending');
```

This should be changed. Since analysis starts automatically, the task should transition based on step completion, not data preparation. Change to:

```typescript
  // All posts processed; task remains in its current state.
  // Steps transition to completed via worker job completion.
```

Or simply remove the `updateTaskStatus(taskId, 'pending')` line entirely.

- [ ] **Step 3: Commit**

```bash
git add src/daemon/handlers.ts
git commit -m "feat(handlers): wire stream scheduler into data preparation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 5: Fix task.step.run to skip already-enqueued targets

**Files:**
- Modify: `src/daemon/handlers.ts:460-513`

**Context:** `task.step.run` currently creates jobs for ALL relevant targets, even if they were already enqueued by the scheduler. This causes unique-constraint violations on `queue_jobs`.

- [ ] **Step 1: Filter out already-enqueued targets**

In `task.step.run`, after line 488 (getting `relevantTargets`), add filtering:

```typescript
      // Filter out targets already enqueued for this step
      const { getExistingJobTargets } = await import('../db/queue-jobs');
      const existingTargets = await getExistingJobTargets(taskId, strategy.id);
      const newTargets = relevantTargets.filter(t => !existingTargets.has(t.target_id));

      if (newTargets.length === 0) {
        // All targets already enqueued; if step is still pending, mark as running
        if (step.status === 'pending') {
          await updateTaskStepStatus(stepId, 'running', { total: existingTargets.size, done: 0, failed: 0 });
        }
        return { status: 'running', enqueued: 0 };
      }
```

Then change line 494 from `relevantTargets.map` to `newTargets.map`:

```typescript
      const jobs = newTargets.map(t => ({
```

- [ ] **Step 2: Commit**

```bash
git add src/daemon/handlers.ts
git commit -m "feat(handlers): task.step.run skips already-enqueued targets

Prevents duplicate queue_jobs when stream scheduler has already
enqueued jobs for a step.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 6: Update CLI to reflect auto-start

**Files:**
- Modify: `src/cli/task-prepare.ts:44-56`

**Context:** When data preparation completes, the output should mention that analysis has started automatically.

- [ ] **Step 1: Update completion message**

In the `poll` function, change the completion output:

```typescript
        if (done) {
          console.log();
          console.log(pc.dim('─'.repeat(40)));
          console.log(pc.green('Data preparation complete'));
          console.log(`  Done: ${dp.commentsFetched ?? 0}/${dp.totalPosts ?? 0} posts, ${dp.failedPosts ?? 0} failed`);
          console.log(pc.cyan('Analysis jobs have been automatically enqueued. Use "task status" to check progress.'));
          console.log();
          return;
        }
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/task-prepare.ts
git commit -m "feat(cli): indicate auto-enqueued analysis in prepare-data output

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 7: Tests for stream-scheduler

**Files:**
- Create: `test/stream-scheduler.test.ts`

**Context:** Test the core scheduling logic: when a post is ready, does it create the right jobs?

- [ ] **Step 1: Write test file**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { onPostReady } from '../src/daemon/stream-scheduler';
import { run, query } from '../src/db/client';
import { createTask, getTaskById } from '../src/db/tasks';
import { createPlatform } from '../src/db/platforms';
import { createPost } from '../src/db/posts';
import { createComment } from '../src/db/comments';
import { createStrategy } from '../src/db/strategies';
import { createTaskStep } from '../src/db/task-steps';
import { createTaskTarget } from '../src/db/task-targets';
import { upsertTaskPostStatus } from '../src/db/task-post-status';
import { generateId } from '../src/shared/utils';

describe('stream-scheduler', () => {
  let platformId: string;
  let taskId: string;
  let postId: string;
  let commentId: string;
  let strategyId: string;
  let stepId: string;

  beforeAll(async () => {
    platformId = generateId();
    await createPlatform({ id: platformId, name: 'test-platform' });

    taskId = generateId();
    await createTask({ id: taskId, name: 'test-task', description: null, template_id: null });

    postId = generateId();
    await createPost({
      id: postId,
      platform_id: platformId,
      platform_post_id: 'note_123',
      title: 'Test Post',
      content: 'Hello world',
      author_id: null,
      author_name: null,
      author_url: null,
      url: null,
      cover_url: null,
      post_type: null,
      like_count: 0,
      collect_count: 0,
      comment_count: 0,
      share_count: 0,
      play_count: 0,
      score: null,
      tags: null,
      media_files: null,
      published_at: null,
      metadata: null,
    });

    commentId = generateId();
    await createComment({
      id: commentId,
      post_id: postId,
      platform_id: platformId,
      platform_comment_id: 'cmt_1',
      parent_comment_id: null,
      root_comment_id: null,
      depth: 0,
      author_id: null,
      author_name: null,
      content: 'Nice post',
      like_count: 0,
      reply_count: 0,
      published_at: null,
      metadata: null,
    });

    await createTaskTarget({ task_id: taskId, target_type: 'post', target_id: postId });

    strategyId = generateId();
    await createStrategy({
      id: strategyId,
      name: 'sentiment',
      description: null,
      version: '1.0.0',
      target: 'comment',
      needs_media: null,
      prompt: 'Analyze sentiment',
      output_schema: { type: 'object', properties: { sentiment: { type: 'string' } } },
      file_path: null,
    });

    const step = await createTaskStep({
      task_id: taskId,
      strategy_id: strategyId,
      name: 'sentiment-analysis',
      step_order: 0,
      status: 'pending',
      stats: { total: 0, done: 0, failed: 0 },
      error: null,
    });
    stepId = step.id;

    // Mark post as data-ready
    await upsertTaskPostStatus(taskId, postId, { status: 'done', comments_fetched: true, media_fetched: true });
  });

  afterAll(async () => {
    await run(`DELETE FROM queue_jobs WHERE task_id = ?`, [taskId]);
    await run(`DELETE FROM task_steps WHERE task_id = ?`, [taskId]);
    await run(`DELETE FROM task_targets WHERE task_id = ?`, [taskId]);
    await run(`DELETE FROM task_post_status WHERE task_id = ?`, [taskId]);
    await run(`DELETE FROM comments WHERE post_id = ?`, [postId]);
    await run(`DELETE FROM posts WHERE id = ?`, [postId]);
    await run(`DELETE FROM tasks WHERE id = ?`, [taskId]);
    await run(`DELETE FROM strategies WHERE id = ?`, [strategyId]);
    await run(`DELETE FROM platforms WHERE id = ?`, [platformId]);
  });

  it('enqueues jobs for all comments when post is ready', async () => {
    const result = await onPostReady(taskId, postId);
    expect(result.enqueued).toBe(1);
    expect(result.skipped).toBe(0);

    const jobs = await query('SELECT * FROM queue_jobs WHERE task_id = ? AND strategy_id = ?', [taskId, strategyId]);
    expect(jobs.length).toBe(1);
    expect(jobs[0].target_id).toBe(commentId);
    expect(jobs[0].target_type).toBe('comment');
    expect(jobs[0].status).toBe('pending');

    // Step should be marked running
    const stepRows = await query('SELECT status, stats FROM task_steps WHERE id = ?', [stepId]);
    expect(stepRows[0].status).toBe('running');
    const stats = typeof stepRows[0].stats === 'string' ? JSON.parse(stepRows[0].stats) : stepRows[0].stats;
    expect(stats.total).toBe(1);
  });

  it('skips already-enqueued targets on second call', async () => {
    const result = await onPostReady(taskId, postId);
    expect(result.enqueued).toBe(0);
    expect(result.skipped).toBe(0); // media_ready is true, but all targets already exist
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npx vitest run test/stream-scheduler.test.ts
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add test/stream-scheduler.test.ts
git commit -m "test: add stream-scheduler unit tests

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

### Task 8: Integration verification

**Files:**
- Run: existing e2e tests or manual verification

- [ ] **Step 1: Run existing test suite**

```bash
npm test
```

Expected: All existing tests pass; new stream-scheduler tests pass.

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: No TypeScript errors.

- [ ] **Step 3: Manual smoke test (optional)**

Create a task with 2+ posts, run `task prepare-data`, verify that:
1. Data preparation progresses
2. As each post completes, queue_jobs are created
3. `task status` shows analysis jobs progressing in parallel with data preparation

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: address review feedback for streaming analysis

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review

### 1. Spec Coverage

| Spec Section | Covered By |
|-------------|-----------|
| Stream Scheduler module | Task 3 |
| `runPrepareDataAsync` integration | Task 4 |
| `task.step.run` deduplication | Task 5 |
| Schema migration (strategy_id) | Task 1, 2 |
| Media dependency check | Task 3 (`isPostMediaReady`) |
| Error handling (non-fatal scheduler) | Task 4 (try/catch) |
| CLI update | Task 6 |

### 2. Placeholder Scan

- No TBD/TODO/fill-in-later found.
- All code blocks contain actual, runnable code.
- All file paths are exact.

### 3. Type Consistency

- `QueueJob.strategy_id?: string` added in Task 2, used in Task 3
- `EnqueueResult` interface defined in Task 3
- `getExistingJobTargets` signature consistent between Task 2 (definition) and Task 3 (usage)

**Gap found:** None.
