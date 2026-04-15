# Two-Phase Task Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-phase task execution pipeline (data preparation via opencli + LLM analysis via existing worker) with breakpoint recovery and dynamic CLI templates.

**Architecture:** Phase 1 (`task prepare-data`) reads task-bound posts, calls opencli per-post using agent-supplied templates to download comments/media, imports results into DuckDB, and tracks progress in a new `task_post_status` table for breakpoint recovery. Phase 2 reuses the existing `task start` → daemon/worker → Anthropic chain.

**Tech Stack:** TypeScript, DuckDB, commander CLI, opencli (external), Node.js `child_process`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/db/schema.sql` | Add `task_post_status` table + `cli_templates` column on `tasks` |
| Modify | `src/shared/types.ts` | Add `TaskPostStatus` type, add `cli_templates` to `Task` |
| Modify | `src/db/tasks.ts` | Add `updateTaskCliTemplates()` function |
| Create | `src/db/task-post-status.ts` | CRUD for `task_post_status` table |
| Create | `src/data-fetcher/opencli.ts` | Execute opencli commands with template variable substitution |
| Modify | `src/cli/task.ts` | Add `--cli-templates` to `create`, modify `start` to skip analyzed targets |
| Create | `src/cli/task-prepare.ts` | `task prepare-data` command implementation |
| Modify | `src/cli/index.ts` | Register `task-prepare` commands |

---

### Task 1: Schema + Types — Add `task_post_status` table and `cli_templates` column

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `task_post_status` table and `cli_templates` column to schema.sql**

Append to `src/db/schema.sql` after the `queue_jobs` table definition (before the indexes section):

```sql
CREATE TABLE IF NOT EXISTS task_post_status (
  task_id         TEXT NOT NULL REFERENCES tasks(id),
  post_id         TEXT NOT NULL,
  comments_fetched BOOLEAN DEFAULT FALSE,
  media_fetched   BOOLEAN DEFAULT FALSE,
  comments_count  INTEGER DEFAULT 0,
  media_count     INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','fetching','done','failed')),
  error           TEXT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (task_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_task_post_status_task ON task_post_status(task_id);
```

After the `tasks` table definition, add the `cli_templates` column migration:

```sql
-- Migration: add cli_templates to tasks (safe if already exists)
-- Applied via ALTER TABLE in runMigrations check
```

We handle the `ALTER TABLE` in code (see Task 4), so the schema.sql just documents the column. Add it as a comment for reference:

```sql
-- tasks.cli_templates: JSON string of opencli command templates
-- ALTER TABLE tasks ADD COLUMN cli_templates TEXT;
```

- [ ] **Step 2: Add `TaskPostStatus` type and extend `Task` in types.ts**

In `src/shared/types.ts`, add after the `TaskTarget` interface:

```typescript
export type TaskPostStatusValue = 'pending' | 'fetching' | 'done' | 'failed';

export interface TaskPostStatus {
  task_id: string;
  post_id: string;
  comments_fetched: boolean;
  media_fetched: boolean;
  comments_count: number;
  media_count: number;
  status: TaskPostStatusValue;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}
```

In the `Task` interface, add:

```typescript
export interface Task {
  id: string;
  name: string;
  description: string | null;
  template_id: string | null;
  cli_templates: string | null;  // JSON string: { fetch_comments?: string, fetch_media?: string }
  status: TaskStatus;
  stats: TaskStats | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.sql src/shared/types.ts
git commit -m "feat: add task_post_status table and cli_templates field"
```

---

### Task 2: DB Layer — `task-post-status.ts` CRUD module

**Files:**
- Create: `src/db/task-post-status.ts`

- [ ] **Step 1: Create the CRUD module**

Create `src/db/task-post-status.ts`:

```typescript
import { query, run } from './client';
import { TaskPostStatus } from '../shared/types';
import { now } from '../shared/utils';

export async function upsertTaskPostStatus(
  taskId: string,
  postId: string,
  updates: Partial<TaskPostStatus>,
): Promise<void> {
  const ts = now();
  await run(
    `INSERT INTO task_post_status (task_id, post_id, comments_fetched, media_fetched, comments_count, media_count, status, error, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_id, post_id) DO UPDATE SET
       comments_fetched = COALESCE(excluded.comments_fetched, task_post_status.comments_fetched),
       media_fetched = COALESCE(excluded.media_fetched, task_post_status.media_fetched),
       comments_count = COALESCE(excluded.comments_count, task_post_status.comments_count),
       media_count = COALESCE(excluded.media_count, task_post_status.media_count),
       status = COALESCE(excluded.status, task_post_status.status),
       error = COALESCE(excluded.error, task_post_status.error),
       updated_at = ?`,
    [
      taskId,
      postId,
      updates.comments_fetched ?? false,
      updates.media_fetched ?? false,
      updates.comments_count ?? 0,
      updates.media_count ?? 0,
      updates.status ?? 'pending',
      updates.error ?? null,
      ts,
      ts,
    ],
  );
}

export async function getTaskPostStatuses(taskId: string): Promise<TaskPostStatus[]> {
  return query<TaskPostStatus>('SELECT * FROM task_post_status WHERE task_id = ? ORDER BY post_id', [taskId]);
}

export async function getTaskPostStatus(taskId: string, postId: string): Promise<TaskPostStatus | null> {
  const rows = await query<TaskPostStatus>('SELECT * FROM task_post_status WHERE task_id = ? AND post_id = ?', [taskId, postId]);
  return rows[0] ?? null;
}

export async function getPendingPostIds(taskId: string): Promise<{ post_id: string; comments_fetched: boolean; media_fetched: boolean }[]> {
  return query(
    `SELECT post_id, comments_fetched, media_fetched FROM task_post_status
     WHERE task_id = ? AND (comments_fetched = FALSE OR media_fetched = FALSE)
     ORDER BY post_id`,
    [taskId],
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/task-post-status.ts
git commit -m "feat: add task_post_status CRUD module"
```

---

### Task 3: DB Layer — Update `tasks.ts` for `cli_templates`

**Files:**
- Modify: `src/db/tasks.ts`

- [ ] **Step 1: Add `updateTaskCliTemplates` function**

Append to `src/db/tasks.ts`:

```typescript
export async function updateTaskCliTemplates(id: string, cliTemplates: string | null): Promise<void> {
  const updatedAt = now();
  await run(
    `UPDATE tasks SET cli_templates = ?, updated_at = ? WHERE id = ?`,
    [cliTemplates, updatedAt, id],
  );
}
```

- [ ] **Step 2: Update `createTask` to include `cli_templates`**

Modify the `createTask` function in `src/db/tasks.ts`. Change the INSERT to include `cli_templates`:

```typescript
export async function createTask(task: Task): Promise<void> {
  await run(
    `INSERT INTO tasks (id, name, description, template_id, cli_templates, status, stats, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [task.id, task.name, task.description, task.template_id, task.cli_templates ?? null, task.status,
     task.stats ? JSON.stringify(task.stats) : null,
     task.created_at, task.updated_at, task.completed_at]
  );
}
```

Also update `getTaskById` to parse the `cli_templates` field if it comes back as a string from DuckDB. Since `Task.cli_templates` is `string | null` (JSON string stored as-is), no additional parsing is needed — it maps directly.

- [ ] **Step 3: Commit**

```bash
git add src/db/tasks.ts
git commit -m "feat: add cli_templates support to tasks CRUD"
```

---

### Task 4: Migration — Handle `ALTER TABLE tasks ADD COLUMN cli_templates`

**Files:**
- Modify: `src/db/migrate.ts`

- [ ] **Step 1: Add migration check to `runMigrations`**

Modify `src/db/migrate.ts`. After running the schema, check if the `cli_templates` column exists and add it if missing:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { exec, query } from './client';

function findSchemaPath(): string {
  const distSchema = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(distSchema)) return distSchema;

  const projectRoot = path.join(__dirname, '..', '..');
  const srcSchema = path.join(projectRoot, 'src', 'db', 'schema.sql');
  if (fs.existsSync(srcSchema)) return srcSchema;

  throw new Error(`schema.sql not found. Searched: ${distSchema}, ${srcSchema}`);
}

export async function runMigrations(): Promise<void> {
  const schemaPath = findSchemaPath();
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await exec(schema);

  // Migration: add cli_templates column to tasks if missing
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'tasks'"
  );
  const hasCliTemplates = columns.some(c => c.name === 'cli_templates');
  if (!hasCliTemplates) {
    await exec('ALTER TABLE tasks ADD COLUMN cli_templates TEXT');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/db/migrate.ts
git commit -m "feat: add migration for tasks.cli_templates column"
```

---

### Task 5: Data Fetcher — `opencli.ts` module

**Files:**
- Create: `src/data-fetcher/opencli.ts`

- [ ] **Step 1: Create the opencli data fetcher**

Create `src/data-fetcher/opencli.ts`:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface FetchResult {
  success: boolean;
  data?: unknown[];
  error?: string;
}

/**
 * Execute an opencli command with template variable substitution.
 *
 * @param template - CLI command template with {variable} placeholders
 * @param vars - Variable values to substitute into the template
 * @param timeoutMs - Command timeout in milliseconds (default: 120000)
 */
export async function fetchViaOpencli(
  template: string,
  vars: Record<string, string>,
  timeoutMs: number = 120000,
): Promise<FetchResult> {
  // Validate that required placeholders are filled
  const missingVars = extractPlaceholders(template).filter(v => !(v in vars));
  if (missingVars.length > 0) {
    return {
      success: false,
      error: `Missing template variables: ${missingVars.join(', ')}`,
    };
  }

  const command = substitutePlaceholders(template, vars);

  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024, // 50MB
    });

    if (stderr && !stdout) {
      return { success: false, error: stderr.trim() };
    }

    // Try to parse stdout as JSON array
    const trimmed = stdout.trim();
    if (!trimmed) {
      return { success: true, data: [] };
    }

    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      // Not JSON, return as single string item
      return { success: true, data: [trimmed] };
    }

    // If it's an object with a data/items field, extract it
    if (Array.isArray(data)) {
      return { success: true, data };
    }
    if (typeof data === 'object' && data !== null) {
      const arr = (data as Record<string, unknown>).data ?? (data as Record<string, unknown>).items ?? [data];
      return { success: true, data: Array.isArray(arr) ? arr : [arr] };
    }

    return { success: true, data: [data] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('timeout')) {
      return { success: false, error: `Command timed out after ${timeoutMs}ms: ${command}` };
    }
    return { success: false, error: message };
  }
}

/** Extract {variable} placeholders from a template string. */
function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{(\w+)\}/g) ?? [];
  return [...new Set(matches.map(m => m.slice(1, -1)))];
}

/** Substitute {variable} placeholders in a template string. */
function substitutePlaceholders(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return result;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/data-fetcher/opencli.ts
git commit -m "feat: add opencli data fetcher with template variable substitution"
```

---

### Task 6: CLI — Modify `task create` to accept `--cli-templates`

**Files:**
- Modify: `src/cli/task.ts`

- [ ] **Step 1: Add `--cli-templates` option to `task create`**

In `src/cli/task.ts`, modify the `task create` command. Find the `.option('--template <name>', 'Prompt template name')` line and add the new option after it:

```typescript
    .option('--template <name>', 'Prompt template name')
    .option('--cli-templates <json>', 'JSON string of opencli command templates')
    .action(async (opts: { name: string; description?: string; template?: string; cliTemplates?: string }) => {
```

Then in the action body, find the `await createTask({` block and add `cli_templates`:

```typescript
      const id = generateId();
      await createTask({
        id,
        name: opts.name,
        description: opts.description ?? null,
        template_id: templateId,
        cli_templates: opts.cliTemplates ?? null,
        status: 'pending',
        stats: { total: 0, done: 0, failed: 0 },
        created_at: now(),
        updated_at: now(),
        completed_at: null,
      });
```

Also update the output to show the cli_templates if provided:

```typescript
      if (opts.cliTemplates) console.log(`  CLI Templates: ${opts.cliTemplates}`);
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/task.ts
git commit -m "feat: add --cli-templates option to task create"
```

---

### Task 7: CLI — Modify `task start` to skip already-analyzed targets

**Files:**
- Modify: `src/cli/task.ts`

- [ ] **Step 1: Filter out already-analyzed targets in `task start`**

In `src/cli/task.ts`, find the `task start` command action. The current code enqueues jobs for all pending targets. We need to also exclude targets that already have analysis results.

Add an import at the top of the file:

```typescript
import { query } from '../db/client';
```

Before the job creation, add a filter to exclude targets that already have analysis results:

```typescript
      // Get comment IDs that already have analysis results for this task
      const analyzedCommentIds = new Set(
        (await query<{ comment_id: string }>(
          'SELECT DISTINCT comment_id FROM analysis_results_comments WHERE task_id = ?',
          [opts.taskId],
        )).map(r => r.comment_id),
      );

      // Get media IDs that already have analysis results for this task
      const analyzedMediaIds = new Set(
        (await query<{ media_id: string }>(
          'SELECT DISTINCT media_id FROM analysis_results_media WHERE task_id = ?',
          [opts.taskId],
        )).map(r => r.media_id),
      );

      // Filter pending targets to exclude already analyzed ones
      const targetsToProcess = stats.pending.filter(t => {
        if (t.target_type === 'comment' && analyzedCommentIds.has(t.target_id)) return false;
        if (t.target_type === 'post' && analyzedCommentIds.has(t.target_id)) return false;
        if (t.target_type === 'comment' && analyzedMediaIds.has(t.target_id)) return false;
        return true;
      });

      if (targetsToProcess.length === 0) {
        console.log(pc.yellow('All pending targets already have analysis results'));
        return;
      }
```

Then change `stats.pending.map(` to `targetsToProcess.map(` in the job creation:

```typescript
      const jobs = targetsToProcess.map(t => ({
```

Add output for skipped count:

```typescript
      const skipped = stats.pending.length - targetsToProcess.length;
      if (skipped > 0) {
        console.log(pc.dim(`  Skipped ${skipped} already-analyzed targets`));
      }
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/task.ts
git commit -m "feat: skip already-analyzed targets in task start"
```

---

### Task 8: CLI — Create `task prepare-data` command

**Files:**
- Create: `src/cli/task-prepare.ts`

- [ ] **Step 1: Create the prepare-data command**

Create `src/cli/task-prepare.ts`:

```typescript
import { Command } from 'commander';
import * as pc from 'picocolors';
import { getTaskById, updateTaskStatus } from '../db/tasks';
import { listTaskTargets } from '../db/task-targets';
import { getTaskPostStatuses, upsertTaskPostStatus, getPendingPostIds } from '../db/task-post-status';
import { fetchViaOpencli, FetchResult } from '../data-fetcher/opencli';
import { createComment } from '../db/comments';
import { createMediaFile } from '../db/media-files';
import { runMigrations } from '../db/migrate';
import { seedAll } from '../db/seed';
import { generateId, now } from '../shared/utils';

interface CliTemplates {
  fetch_comments?: string;
  fetch_media?: string;
}

export function taskPrepareCommands(program: Command): void {
  const task = program.command('task').description('Task management', { isDefault: false });

  task
    .command('prepare-data')
    .description('Download comments and media for task posts via opencli (resumable)')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      await runMigrations();
      await seedAll();

      const task = await getTaskById(opts.taskId);
      if (!task) {
        console.log(pc.red(`Task not found: ${opts.taskId}`));
        process.exit(1);
      }

      if (!task.cli_templates) {
        console.log(pc.red('Task has no CLI templates. Create the task with --cli-templates.'));
        process.exit(1);
      }

      let cliTemplates: CliTemplates;
      try {
        cliTemplates = JSON.parse(task.cli_templates);
      } catch {
        console.log(pc.red('Invalid cli_templates JSON in task'));
        process.exit(1);
      }

      // Validate templates have {post_id} placeholder
      if (cliTemplates.fetch_comments && !cliTemplates.fetch_comments.includes('{post_id}')) {
        console.log(pc.red('fetch_comments template must contain {post_id} placeholder'));
        process.exit(1);
      }
      if (cliTemplates.fetch_media && !cliTemplates.fetch_media.includes('{post_id}')) {
        console.log(pc.red('fetch_media template must contain {post_id} placeholder'));
        process.exit(1);
      }

      // Get all posts bound to this task
      const postTargets = (await listTaskTargets(opts.taskId)).filter(t => t.target_type === 'post');
      if (postTargets.length === 0) {
        console.log(pc.yellow('No posts bound to this task. Use task add-posts first.'));
        process.exit(1);
      }

      const postIds = postTargets.map(t => t.target_id);

      // Get task's platform_id from the first post (all posts should be same platform)
      const postsQuery = await import('../db/posts');
      const firstPost = await postsQuery.getPostById(postIds[0]);
      if (!firstPost) {
        console.log(pc.red(`Post not found: ${postIds[0]}`));
        process.exit(1);
      }
      const platformId = firstPost.platform_id;

      // Initialize status records for all posts
      for (const postId of postIds) {
        await upsertTaskPostStatus(opts.taskId, postId, { status: 'pending' });
      }

      // Get posts that still need fetching
      const pending = await getPendingPostIds(opts.taskId);

      if (pending.length === 0) {
        console.log(pc.green('All posts already processed. Nothing to do.'));
        return;
      }

      console.log(`Preparing data for ${pending.length}/${postIds.length} posts...\n`);

      let successCount = 0;
      let skipCount = postIds.length - pending.length;
      let failCount = 0;

      for (const item of pending) {
        const postId = item.post_id;
        const status = await getTaskPostStatus(opts.taskId, postId);
        if (!status) continue;

        console.log(pc.dim(`[${successCount + failCount + 1}/${postIds.length}] Processing post: ${postId.slice(0, 8)}...`));

        // Fetch comments if needed
        if (!item.comments_fetched && cliTemplates.fetch_comments) {
          await upsertTaskPostStatus(opts.taskId, postId, { status: 'fetching' });
          console.log('  Fetching comments...');

          const result = await fetchViaOpencli(cliTemplates.fetch_comments, { post_id: postId, limit: '100' });
          if (!result.success) {
            console.log(pc.red(`  Comments fetch failed: ${result.error}`));
            await upsertTaskPostStatus(opts.taskId, postId, { status: 'failed', error: result.error ?? 'unknown' });
            failCount++;
            continue;
          }

          const commentCount = await importCommentsToDb(result.data ?? [], opts.taskId, postId, platformId);
          await upsertTaskPostStatus(opts.taskId, postId, { comments_fetched: true, comments_count: commentCount });
          console.log(`  Comments imported: ${commentCount}`);
        } else if (!cliTemplates.fetch_comments) {
          console.log('  Comments: skipped (no template)');
        } else {
          console.log('  Comments: already fetched');
        }

        // Fetch media if needed
        if (!item.media_fetched && cliTemplates.fetch_media) {
          console.log('  Fetching media...');

          const result = await fetchViaOpencli(cliTemplates.fetch_media, { post_id: postId });
          if (!result.success) {
            console.log(pc.red(`  Media fetch failed: ${result.error}`));
            await upsertTaskPostStatus(opts.taskId, postId, { status: 'failed', error: result.error ?? 'unknown' });
            failCount++;
            continue;
          }

          const mediaCount = await importMediaToDb(result.data ?? [], postId, platformId);
          await upsertTaskPostStatus(opts.taskId, postId, { media_fetched: true, media_count: mediaCount });
          console.log(`  Media imported: ${mediaCount}`);
        } else if (!cliTemplates.fetch_media) {
          console.log('  Media: skipped (no template)');
        } else {
          console.log('  Media: already fetched');
        }

        // Mark post as done
        await upsertTaskPostStatus(opts.taskId, postId, { status: 'done' });
        successCount++;
      }

      // Update task status
      await updateTaskStatus(opts.taskId, 'pending');

      console.log(pc.dim('\n' + '─'.repeat(40)));
      console.log(pc.green(`\nData preparation complete:`));
      console.log(`  Success: ${successCount}`);
      console.log(`  Skipped (already done): ${skipCount}`);
      console.log(`  Failed: ${failCount}`);
      console.log();
    });
}

/** Import comment data from opencli output into DuckDB. */
async function importCommentsToDb(
  data: unknown[],
  taskId: string,
  postId: string,
  platformId: string,
): Promise<number> {
  let count = 0;
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    try {
      await createComment({
        post_id: postId,
        platform_id: platformId,
        platform_comment_id: (obj.platform_comment_id ?? obj.id ?? null) as string | null,
        parent_comment_id: (obj.parent_comment_id ?? null) as string | null,
        root_comment_id: (obj.root_comment_id ?? null) as string | null,
        depth: Number(obj.depth ?? 0),
        author_id: (obj.author_id ?? null) as string | null,
        author_name: (obj.author_name ?? obj.author ?? null) as string | null,
        content: (obj.content ?? obj.text ?? '') as string,
        like_count: Number(obj.like_count ?? 0),
        reply_count: Number(obj.reply_count ?? 0),
        published_at: obj.published_at ? new Date(obj.published_at as string) : null,
        metadata: (obj.metadata ?? obj) as Record<string, unknown> | null,
      });
      count++;
    } catch {
      // Skip duplicates (UNIQUE constraint)
    }
  }
  return count;
}

/** Import media data from opencli output into DuckDB. */
async function importMediaToDb(
  data: unknown[],
  postId: string,
  platformId: string,
): Promise<number> {
  let count = 0;
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    try {
      await createMediaFile({
        post_id: postId,
        comment_id: null,
        platform_id: platformId,
        media_type: (obj.media_type ?? obj.type ?? 'image') as 'image' | 'video' | 'audio',
        url: (obj.url ?? '') as string,
        local_path: (obj.local_path ?? obj.path ?? null) as string | null,
        width: obj.width ? Number(obj.width) : null,
        height: obj.height ? Number(obj.height) : null,
        duration_ms: obj.duration_ms ? Number(obj.duration_ms) : null,
        file_size: obj.file_size ? Number(obj.file_size) : null,
        downloaded_at: obj.downloaded_at ? new Date(obj.downloaded_at as string) : null,
      });
      count++;
    } catch {
      // Skip duplicates
    }
  }
  return count;
}
```

Note: `getPostById` exists in `src/db/posts.ts` and `createMediaFile` exists in `src/db/media-files.ts`. Both match the signatures used above.

- [ ] **Step 2: Commit**

```bash
git add src/cli/task-prepare.ts
git commit -m "feat: add task prepare-data command with breakpoint recovery"
```

---

### Task 9: CLI — Register `task-prepare` commands in index

**Files:**
- Modify: `src/cli/index.ts`

- [ ] **Step 1: Import and register task-prepare commands**

In `src/cli/index.ts`, add the import:

```typescript
import { taskPrepareCommands } from './task-prepare';
```

After `taskCommands(program);`, add:

```typescript
// Task prepare commands (prepare-data, etc.)
taskPrepareCommands(program);
```

Note: Since `taskCommands` already registers commands under `program.command('task')`, and `taskPrepareCommands` also registers under `program.command('task')`, Commander will merge the subcommands. Both modules call `program.command('task')` which returns the same Command instance.

- [ ] **Step 2: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: register task-prepare commands in CLI entry point"
```

---

### Task 10: Build + Verify

**Files:**
- All modified files

- [ ] **Step 1: Run TypeScript build**

```bash
pnpm build
```

Expected: No errors.

- [ ] **Step 2: Run lint check**

```bash
pnpm lint
```

Expected: No errors.

- [ ] **Step 3: Verify CLI help shows new command**

```bash
node dist/cli/index.js task prepare-data --help
```

Expected: Shows `--task-id <id>` option and description.

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "chore: build and verify two-phase task pipeline"
```
