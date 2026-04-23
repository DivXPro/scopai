# Unified Process Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge daemon, API, worker, and scheduler into a single process, replacing IPC with HTTP REST for CLI communication.

**Architecture:** Single Node.js process running Fastify HTTP server + in-process workers + scheduler. CLI communicates via HTTP REST (same API as UI). Lock file replaces PID file for cross-platform process discovery.

**Tech Stack:** Fastify 5, DuckDB, Node.js 20+, TypeScript, tsup

---

## File Structure

### New Files
- `packages/core/src/shared/lock-file.ts` — Lock file read/write/validate logic
- `packages/cli/src/api-client.ts` — HTTP client replacing IPC client

### Modified Files
- `packages/api/src/index.ts` — Add worker startup, lock file, enhanced shutdown
- `packages/api/src/routes/tasks.ts` — Add prepare-data, add-posts, add-comments, resume, step endpoints
- `packages/api/src/routes/posts.ts` — Add import endpoint
- `packages/api/src/routes/strategies.ts` — Add import endpoint
- `packages/api/src/routes/index.ts` — Register new routes
- `packages/cli/src/daemon.ts` — Rewrite with lock file + HTTP
- `packages/cli/src/task.ts` — Switch daemonCall → apiPost/apiGet
- `packages/cli/src/task-prepare.ts` — Switch daemonCall → apiPost
- `packages/cli/src/post.ts` — Switch daemonCall → apiPost
- `packages/cli/src/comment.ts` — Switch daemonCall → apiPost
- `packages/cli/src/platform.ts` — Switch daemonCall → apiGet
- `packages/cli/src/strategy.ts` — Switch daemonCall → apiGet/apiPost
- `packages/cli/src/analyze.ts` — Switch daemonCall → apiPost
- `packages/cli/src/queue.ts` — Switch daemonCall → apiGet/apiPost
- `packages/cli/src/result.ts` — Switch daemonCall → apiGet
- `packages/cli/src/logs.ts` — Switch daemonCall → apiGet
- `packages/cli/src/template.ts` — Switch daemonCall → apiGet
- `packages/core/src/index.ts` — Export lock-file module
- `packages/core/src/shared/daemon-status.ts` — Replace PID logic with lock file

### Deleted Files
- `packages/api/src/worker/manager.ts` — No child process workers
- `packages/api/src/worker/index.ts` — No standalone worker entry
- `packages/cli/src/ipc-client.ts` — Replaced by api-client.ts

---

### Task 1: Create lock file module in core

**Files:**
- Create: `packages/core/src/shared/lock-file.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write lock file module**

```typescript
// packages/core/src/shared/lock-file.ts
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config/index';
import { expandPath } from '../shared/utils';

export interface LockFileData {
  port: number;
  pid: number;
  startedAt: string;
}

function getLockFilePath(): string {
  const dataDir = expandPath(config.database.path);
  return path.join(path.dirname(dataDir), 'api.lock');
}

export function readLockFile(): LockFileData | null {
  const lockPath = getLockFilePath();
  if (!fs.existsSync(lockPath)) return null;
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    return JSON.parse(raw) as LockFileData;
  } catch {
    return null;
  }
}

export function writeLockFile(data: LockFileData): void {
  const lockPath = getLockFilePath();
  fs.writeFileSync(lockPath, JSON.stringify(data, null, 2), 'utf-8');
}

export function removeLockFile(): void {
  const lockPath = getLockFilePath();
  try { fs.unlinkSync(lockPath); } catch {}
}

export async function isApiAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/status`);
    return res.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Export lock-file from core barrel**

Add to `packages/core/src/index.ts`:

```typescript
export { readLockFile, writeLockFile, removeLockFile, isApiAlive } from './shared/lock-file';
export type { LockFileData } from './shared/lock-file';
```

- [ ] **Step 3: Build and verify**

Run: `pnpm --filter @analyze-cli/core build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/shared/lock-file.ts packages/core/src/index.ts
git commit -m "feat(core): add lock file module for cross-platform process discovery"
```

---

### Task 2: Create CLI HTTP client

**Files:**
- Create: `packages/cli/src/api-client.ts`

- [ ] **Step 1: Write HTTP client**

```typescript
// packages/cli/src/api-client.ts
import { readLockFile, isApiAlive, type LockFileData } from '@analyze-cli/core';

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function getBaseUrl(lock: LockFileData): string {
  return `http://localhost:${lock.port}`;
}

async function requireLock(): Promise<LockFileData> {
  const lock = readLockFile();
  if (!lock) {
    throw new Error('Daemon is not running. Start it with: analyze-cli daemon start');
  }
  const alive = await isApiAlive(lock.port);
  if (!alive) {
    throw new Error('Daemon is not responding. Try: analyze-cli daemon restart');
  }
  return lock;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const lock = await requireLock();
  const res = await fetch(`${getBaseUrl(lock)}/api${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new ApiClientError(res.status, (body as Record<string, { message: string }>).error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const lock = await requireLock();
  const res = await fetch(`${getBaseUrl(lock)}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new ApiClientError(res.status, (errBody as Record<string, { message: string }>).error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  const lock = await requireLock();
  const res = await fetch(`${getBaseUrl(lock)}/api${path}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new ApiClientError(res.status, (errBody as Record<string, { message: string }>).error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/api-client.ts
git commit -m "feat(cli): add HTTP API client to replace IPC client"
```

---

### Task 3: Add missing API routes (task operations)

**Files:**
- Modify: `packages/api/src/routes/tasks.ts`

- [ ] **Step 1: Add task action routes**

The current `tasks.ts` only has GET endpoints. Add POST endpoints for task operations that the CLI needs. These call the same core functions that `handlers.ts` calls.

Read current `packages/api/src/routes/tasks.ts` first, then add these routes:

```typescript
// Add these imports at the top (alongside existing ones):
import {
  getTask,
  listTasks,
  getTaskSteps,
  getTaskResults,
  // New imports for action routes:
  createTask,
  updateTaskStatus,
  addStepToTask,
  updateStepStatus,
  getStepResults,
  addStepResults,
} from '@analyze-cli/core';

// Add these routes inside the function body:

// POST /tasks - create a new task
app.post('/tasks', async (request) => {
  const { name, platformId, strategyId, config } = request.body as {
    name?: string;
    platformId?: string;
    strategyId?: string;
    config?: Record<string, unknown>;
  };
  const task = await createTask({ name, platformId, strategyId, config });
  return task;
});

// POST /tasks/:id/prepare-data - prepare data for a task
app.post('/tasks/:id/prepare-data', async (request) => {
  const { id } = request.params as { id: string };
  const { platformId, query, limit, postIds } = request.body as {
    platformId?: string;
    query?: string;
    limit?: number;
    postIds?: string[];
  };
  const task = await getTask(id);
  if (!task) throw { statusCode: 404, message: 'Task not found' };

  // Enqueue a prepare-data job
  const { enqueueJob } = await import('@analyze-cli/core');
  const job = await enqueueJob({
    type: 'task.prepare-data',
    payload: { taskId: id, platformId: platformId ?? task.platform_id, query, limit, postIds },
  });
  return { jobId: job.id, taskId: id, status: 'queued' };
});

// POST /tasks/:id/add-posts - add posts to a task
app.post('/tasks/:id/add-posts', async (request) => {
  const { id } = request.params as { id: string };
  const { postIds } = request.body as { postIds: string[] };
  if (!postIds?.length) throw { statusCode: 400, message: 'postIds required' };

  const { enqueueJob } = await import('@analyze-cli/core');
  const job = await enqueueJob({
    type: 'task.add-targets',
    payload: { taskId: id, targetType: 'posts', targetIds: postIds },
  });
  return { jobId: job.id, taskId: id, status: 'queued' };
});

// POST /tasks/:id/add-comments - add comments to a task
app.post('/tasks/:id/add-comments', async (request) => {
  const { id } = request.params as { id: string };
  const { commentIds } = request.body as { commentIds: string[] };
  if (!commentIds?.length) throw { statusCode: 400, message: 'commentIds required' };

  const { enqueueJob } = await import('@analyze-cli/core');
  const job = await enqueueJob({
    type: 'task.add-targets',
    payload: { taskId: id, targetType: 'comments', targetIds: commentIds },
  });
  return { jobId: job.id, taskId: id, status: 'queued' };
});

// POST /tasks/:id/resume - resume a paused/failed task
app.post('/tasks/:id/resume', async (request) => {
  const { id } = request.params as { id: string };
  const task = await getTask(id);
  if (!task) throw { statusCode: 404, message: 'Task not found' };

  await updateTaskStatus(id, 'running');

  const { enqueueJob } = await import('@analyze-cli/core');
  const job = await enqueueJob({
    type: 'task.resume',
    payload: { taskId: id },
  });
  return { jobId: job.id, taskId: id, status: 'queued' };
});

// POST /tasks/:id/steps - add a step to a task
app.post('/tasks/:id/steps', async (request) => {
  const { id } = request.params as { id: string };
  const { type, config } = request.body as { type: string; config?: Record<string, unknown> };
  if (!type) throw { statusCode: 400, message: 'type required' };

  const step = await addStepToTask(id, { type, config });
  return step;
});

// POST /tasks/:id/steps/:stepId/run - run a specific step
app.post('/tasks/:id/steps/:stepId/run', async (request) => {
  const { id, stepId } = request.params as { id: string; stepId: string };

  const { enqueueJob } = await import('@analyze-cli/core');
  const job = await enqueueJob({
    type: 'task.run-step',
    payload: { taskId: id, stepId },
  });
  return { jobId: job.id, taskId: id, stepId, status: 'queued' };
});

// POST /tasks/:id/run-all-steps - run all pending steps
app.post('/tasks/:id/run-all-steps', async (request) => {
  const { id } = request.params as { id: string };
  const task = await getTask(id);
  if (!task) throw { statusCode: 404, message: 'Task not found' };

  const steps = await getTaskSteps(id);
  const pendingSteps = steps.filter((s: { status: string }) => s.status === 'pending');

  const { enqueueJob } = await import('@analyze-cli/core');
  const jobs = [];
  for (const step of pendingSteps) {
    const job = await enqueueJob({
      type: 'task.run-step',
      payload: { taskId: id, stepId: step.id },
    });
    jobs.push({ stepId: step.id, jobId: job.id });
  }
  return { taskId: id, jobs };
});
```

- [ ] **Step 2: Build and verify**

Run: `pnpm --filter @analyze-cli/api build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/tasks.ts
git commit -m "feat(api): add task action routes for prepare-data, add-targets, resume, steps"
```

---

### Task 4: Add missing API routes (import + analyze)

**Files:**
- Modify: `packages/api/src/routes/posts.ts`
- Modify: `packages/api/src/routes/strategies.ts`

- [ ] **Step 1: Add import endpoint to posts route**

Read current `packages/api/src/routes/posts.ts`, then add:

```typescript
// Add import at top:
// import { importPosts } from '@analyze-cli/core';

// Add route inside function body:
app.post('/posts/import', async (request) => {
  const { posts } = request.body as { posts: Record<string, unknown>[] };
  if (!posts?.length) throw { statusCode: 400, message: 'posts array required' };
  const result = await importPosts(posts);
  return result;
});
```

- [ ] **Step 2: Add import endpoint to strategies route**

Read current `packages/api/src/routes/strategies.ts`, then add:

```typescript
// Add import at top:
// import { importStrategy } from '@analyze-cli/core';

// Add route inside function body:
app.post('/strategies/import', async (request) => {
  const { strategy } = request.body as { strategy: Record<string, unknown> };
  if (!strategy) throw { statusCode: 400, message: 'strategy object required' };
  const result = await importStrategy(strategy);
  return result;
});
```

- [ ] **Step 3: Build and verify**

Run: `pnpm --filter @analyze-cli/api build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/posts.ts packages/api/src/routes/strategies.ts
git commit -m "feat(api): add import endpoints for posts and strategies"
```

---

### Task 5: Wire up workers in API process

**Files:**
- Modify: `packages/api/src/index.ts`

- [ ] **Step 1: Add worker startup and lock file to API entry point**

Read current `packages/api/src/index.ts`, then restructure to:

```typescript
import Fastify from 'fastify';
import { close as closeDb, migrateDb, seedDb, recoverStalledJobs, readLockFile, writeLockFile, removeLockFile, isApiAlive, requestShutdown, isShuttingDown, resetShutdown, registerWorker, unregisterWorker, setWorkerActiveCount } from '@analyze-cli/core';
import { setupAuth } from './auth.js';
import { runConsumer } from './worker/consumer.js';
import routes from './routes/index.js';
import { config } from '@analyze-cli/core';

const PORT = config.server?.port ?? 3000;
const WORKER_CONCURRENCY = config.worker?.concurrency ?? 2;

async function main() {
  // 1. DB init
  await migrateDb();
  await seedDb();
  await recoverStalledJobs();

  // 2. Check for stale lock file
  const existingLock = readLockFile();
  if (existingLock) {
    const alive = await isApiAlive(existingLock.port);
    if (alive) {
      console.error(`API already running on port ${existingLock.port}`);
      process.exit(1);
    }
    removeLockFile();
  }

  // 3. Fastify server
  const app = Fastify({ logger: false });

  await setupAuth(app);
  app.register(routes);

  await app.listen({ port: PORT, host: '127.0.0.1' });
  console.log(`API server listening on http://localhost:${PORT}`);

  // 4. Write lock file
  writeLockFile({
    port: PORT,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });

  // 5. Start in-process workers
  resetShutdown();
  for (let i = 0; i < WORKER_CONCURRENCY; i++) {
    registerWorker(i);
    runConsumer(i).catch((err) => {
      console.error(`[Worker-${i}] Fatal error:`, err);
    });
  }
  console.log(`Started ${WORKER_CONCURRENCY} workers`);

  // 6. Graceful shutdown
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received, shutting down...`);

    // Stop accepting new requests
    try { await app.close(); } catch {}

    // Signal workers to stop
    requestShutdown();

    // Wait for workers to drain (up to 30s)
    const drainStart = Date.now();
    while (Date.now() - drainStart < 30000) {
      // Workers check isShuttingDown() in their loop
      await new Promise((r) => setTimeout(r, 500));
    }

    // Cleanup
    try { await closeDb(); } catch {}
    removeLockFile();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  removeLockFile();
  process.exit(1);
});
```

- [ ] **Step 2: Build and verify**

Run: `pnpm --filter @analyze-cli/api build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/index.ts
git commit -m "feat(api): wire up in-process workers, lock file, and graceful shutdown"
```

---

### Task 6: Delete worker manager and standalone entry

**Files:**
- Delete: `packages/api/src/worker/manager.ts`
- Delete: `packages/api/src/worker/index.ts`

- [ ] **Step 1: Delete files**

```bash
rm packages/api/src/worker/manager.ts packages/api/src/worker/index.ts
```

- [ ] **Step 2: Check for any imports of these files**

Run: `grep -r "worker/manager\|worker/index" packages/ --include="*.ts"`
Expected: No remaining imports (if there are, update them)

- [ ] **Step 3: Build and verify**

Run: `pnpm --filter @analyze-cli/api build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add -A packages/api/src/worker/
git commit -m "chore(api): remove worker manager and standalone entry"
```

---

### Task 7: Rewrite CLI daemon command

**Files:**
- Modify: `packages/cli/src/daemon.ts`

- [ ] **Step 1: Rewrite daemon.ts to use lock file + HTTP**

Replace the entire file. The new version uses lock file for process discovery and HTTP for status checks:

```typescript
import { Command } from 'commander';
import { spawn } from 'child_process';
import * as path from 'path';
import { readLockFile, isApiAlive, removeLockFile } from '@analyze-cli/core';

const daemonCmd = new Command('daemon')
  .description('Manage the analyze-cli daemon');

daemonCmd
  .command('start')
  .description('Start the daemon')
  .option('-d, --detach', 'Run in background', true)
  .action(async (opts: { detach: boolean }) => {
    // Check if already running
    const lock = readLockFile();
    if (lock) {
      const alive = await isApiAlive(lock.port);
      if (alive) {
        console.log(`Daemon already running on port ${lock.port} (PID ${lock.pid})`);
        return;
      }
      removeLockFile();
    }

    // Spawn API process — resolve path from the monorepo root
    const monorepoRoot = require.resolve('@analyze-cli/core/package.json').replace('/packages/core/package.json', '');
    const apiDir = path.join(monorepoRoot, 'packages', 'api');
    const child = spawn('node', ['dist/index.js'], {
      cwd: apiDir,
      detached: opts.detach,
      stdio: opts.detach ? 'ignore' : 'inherit',
      env: { ...process.env },
    });

    if (opts.detach) {
      child.unref();
    }

    // Wait for API to be ready
    console.log('Starting daemon...');
    const start = Date.now();
    const timeout = 15000;
    while (Date.now() - start < timeout) {
      await new Promise((r) => setTimeout(r, 500));
      const newLock = readLockFile();
      if (newLock) {
        const alive = await isApiAlive(newLock.port);
        if (alive) {
          console.log(`Daemon started on port ${newLock.port} (PID ${newLock.pid})`);
          return;
        }
      }
    }
    console.error('Daemon failed to start within timeout');
    process.exit(1);
  });

daemonCmd
  .command('stop')
  .description('Stop the daemon')
  .action(async () => {
    const lock = readLockFile();
    if (!lock) {
      console.log('Daemon is not running');
      return;
    }
    const alive = await isApiAlive(lock.port);
    if (!alive) {
      removeLockFile();
      console.log('Daemon was not running (cleaned stale lock)');
      return;
    }
    process.kill(lock.pid, 'SIGTERM');
    console.log('Daemon stopping...');

    // Wait for lock file to be removed
    const start = Date.now();
    while (Date.now() - start < 10000) {
      await new Promise((r) => setTimeout(r, 500));
      if (!readLockFile()) {
        console.log('Daemon stopped');
        return;
      }
    }
    console.error('Daemon did not stop within timeout');
    process.exit(1);
  });

daemonCmd
  .command('status')
  .description('Check daemon status')
  .action(async () => {
    const lock = readLockFile();
    if (!lock) {
      console.log('Daemon is not running');
      return;
    }
    const alive = await isApiAlive(lock.port);
    if (alive) {
      const res = await fetch(`http://localhost:${lock.port}/api/status`);
      const status = await res.json();
      console.log(`Daemon running on port ${lock.port} (PID ${lock.pid})`);
      console.log(`Started: ${lock.startedAt}`);
      console.log(`Uptime: ${status.uptime ?? 'unknown'}`);
    } else {
      removeLockFile();
      console.log('Daemon is not running (cleaned stale lock)');
    }
  });

daemonCmd
  .command('restart')
  .description('Restart the daemon')
  .action(async () => {
    const lock = readLockFile();
    if (lock) {
      const alive = await isApiAlive(lock.port);
      if (alive) {
        process.kill(lock.pid, 'SIGTERM');
        // Wait for stop
        const start = Date.now();
        while (Date.now() - start < 10000) {
          await new Promise((r) => setTimeout(r, 500));
          if (!readLockFile()) break;
        }
      } else {
        removeLockFile();
      }
    }
    // Start again
    await daemonCmd.commands.find((c) => c.name() === 'start')?.parseAsync([], { from: 'user' });
  });

export default daemonCmd;
```

- [ ] **Step 2: Build and verify**

Run: `pnpm --filter @analyze-cli/cli build`
Expected: Build succeeds (may have type errors from removed ipc-client — fix in next task)

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/daemon.ts
git commit -m "feat(cli): rewrite daemon command with lock file + HTTP"
```

---

### Task 8: Migrate CLI commands from IPC to HTTP

**Files:**
- Modify: `packages/cli/src/task.ts`
- Modify: `packages/cli/src/task-prepare.ts`
- Modify: `packages/cli/src/post.ts`
- Modify: `packages/cli/src/comment.ts`
- Modify: `packages/cli/src/platform.ts`
- Modify: `packages/cli/src/strategy.ts`
- Modify: `packages/cli/src/analyze.ts`
- Modify: `packages/cli/src/queue.ts`
- Modify: `packages/cli/src/result.ts`
- Modify: `packages/cli/src/logs.ts`
- Modify: `packages/cli/src/template.ts`
- Delete: `packages/cli/src/ipc-client.ts`

- [ ] **Step 1: Delete IPC client**

```bash
rm packages/cli/src/ipc-client.ts
```

- [ ] **Step 2: Migrate each CLI command file**

For each file, the pattern is the same:
1. Replace `import { sendIpcRequest } from './ipc-client'` with `import { apiGet, apiPost } from './api-client'`
2. Replace `sendIpcRequest('method.name', params)` with `apiPost('/path', body)` or `apiGet('/path')`
3. Map IPC method names to REST paths using this table:

| IPC Method | HTTP Route |
|---|---|
| `task.list` | GET /tasks |
| `task.get` | GET /tasks/:id |
| `task.create` | POST /tasks |
| `task.prepareData` | POST /tasks/:id/prepare-data |
| `task.addTargets` | POST /tasks/:id/add-posts or /add-comments |
| `task.resume` | POST /tasks/:id/resume |
| `task.step.add` | POST /tasks/:id/steps |
| `task.step.run` | POST /tasks/:id/steps/:stepId/run |
| `task.runAllSteps` | POST /tasks/:id/run-all-steps |
| `task.delete` | DELETE /tasks/:id |
| `post.list` | GET /posts |
| `post.search` | GET /posts/search |
| `post.import` | POST /posts/import |
| `comment.list` | GET /comments |
| `comment.import` | POST /comments/import |
| `platform.list` | GET /platforms |
| `strategy.list` | GET /strategies |
| `strategy.get` | GET /strategies/:id |
| `strategy.import` | POST /strategies/import |
| `strategy.delete` | DELETE /strategies/:id |
| `analyze.run` | POST /analyze/run |
| `queue.stats` | GET /queue |
| `queue.retry` | POST /queue/retry |
| `queue.reset` | POST /queue/reset |
| `result.list` | GET /tasks/:id/results |
| `logs.list` | GET /logs |
| `template.list` | GET /templates |

For each file, read it first, then apply the transformation. Example for `task.ts`:

```typescript
// Before:
const result = await sendIpcRequest('task.list', { status, limit });

// After:
const result = await apiGet(`/tasks?status=${status}&limit=${limit}`);
```

```typescript
// Before:
const result = await sendIpcRequest('task.prepareData', { taskId, platformId, query, limit });

// After:
const result = await apiPost(`/tasks/${taskId}/prepare-data`, { platformId, query, limit });
```

- [ ] **Step 3: Build CLI and verify**

Run: `pnpm --filter @analyze-cli/cli build`
Expected: Build succeeds with no errors

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/
git commit -m "feat(cli): migrate all commands from IPC to HTTP API"
```

---

### Task 9: Update daemon-status module

**Files:**
- Modify: `packages/core/src/shared/daemon-status.ts`

- [ ] **Step 1: Replace PID-based logic with lock file**

Read current `packages/core/src/shared/daemon-status.ts`, then replace with lock file based implementation:

```typescript
// packages/core/src/shared/daemon-status.ts
import { readLockFile, isApiAlive, removeLockFile } from './lock-file';

export interface DaemonStatus {
  running: boolean;
  port?: number;
  pid?: number;
  startedAt?: string;
}

export async function getDaemonStatus(): Promise<DaemonStatus> {
  const lock = readLockFile();
  if (!lock) return { running: false };

  const alive = await isApiAlive(lock.port);
  if (!alive) {
    removeLockFile();
    return { running: false };
  }

  return {
    running: true,
    port: lock.port,
    pid: lock.pid,
    startedAt: lock.startedAt,
  };
}
```

- [ ] **Step 2: Build and verify**

Run: `pnpm --filter @analyze-cli/core build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/shared/daemon-status.ts
git commit -m "refactor(core): replace PID-based daemon status with lock file"
```

---

### Task 10: Integration test — full build and smoke test

**Files:**
- None (verification only)

- [ ] **Step 1: Full monorepo build**

Run: `pnpm build`
Expected: All 4 packages build successfully

- [ ] **Step 2: Start API and verify endpoints**

```bash
pnpm --filter @analyze-cli/api start &
sleep 3
curl -s http://localhost:3000/api/status | head
curl -s http://localhost:3000/api/tasks | head
curl -s http://localhost:3000/api/posts | head
curl -s http://localhost:3000/api/queue | head
curl -s http://localhost:3000/api/platforms | head
curl -s http://localhost:3000/api/strategies | head
kill %1
```

Expected: All endpoints return 200 with valid JSON

- [ ] **Step 3: Verify lock file created and cleaned**

```bash
# Start API
pnpm --filter @analyze-cli/api start &
sleep 3
# Check lock file exists
cat ~/.analyze-cli/api.lock
# Stop API
kill %1
sleep 2
# Check lock file removed
ls ~/.analyze-cli/api.lock 2>&1
```

Expected: Lock file created on start, removed on stop

- [ ] **Step 4: Run existing integration tests**

Run: `pnpm test:integration`
Expected: All tests pass

- [ ] **Step 5: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: integration test fixes for unified process architecture"
```

---

### Task 11: Clean up dead code

**Files:**
- Modify: `packages/cli/src/index.ts` — remove ipc-client import if present
- Check for any remaining references to deleted files

- [ ] **Step 1: Search for remaining references**

```bash
grep -r "ipc-client\|ipcClient\|sendIpcRequest\|worker/manager\|worker/index" packages/ --include="*.ts"
```

Expected: No results (all references migrated)

- [ ] **Step 2: Search for remaining PID file references**

```bash
grep -r "analyze-cli\.pid\|/tmp/analyze-cli" packages/ --include="*.ts"
```

Expected: No results (all replaced with lock file)

- [ ] **Step 3: Final full build**

Run: `pnpm build`
Expected: All 4 packages build successfully

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: clean up dead IPC and PID file references"
```
