# Unified Process Architecture: Merge Daemon + API + Worker

**Date**: 2026-04-22
**Status**: Draft

## Problem

Current architecture has two separate processes accessing the same DuckDB file:

1. **Old daemon** (IPC server + worker + scheduler) — code migrated to `packages/api/src/` but not wired up
2. **New API** (Fastify HTTP server) — only serves HTTP routes, no workers

This causes:
- **DuckDB concurrent write corruption** — two processes writing WAL simultaneously
- **Broken IPC path** — CLI imports `sendIpcRequest` from `../../../src/daemon/ipc-server` which no longer exists
- **job-events notification broken** — `notifyJobAvailable()` is process-local, doesn't work across child process boundary
- **Dual handler paths** — IPC handlers (30+ methods) and HTTP routes (basic CRUD) overlap with no integration

## Decision

Merge daemon, API, task scheduling, and worker into a **single process**.

Rationale:
- Single-machine tool — process isolation has no practical benefit
- Eliminates DuckDB concurrent write issue entirely
- job-events notification works naturally in-process
- Simpler deployment: one process, one startup command, one log stream

## Architecture

### Process Structure

Single process entry point: `packages/api/src/index.ts`

```
Startup sequence:
1. Load config
2. Run DB migration + seed
3. Recover stalled jobs
4. Start Fastify HTTP server (TCP)
5. Register REST routes (CLI + UI shared)
6. Start N in-process workers (runConsumer)
7. Write lock file (~/.scopai/api.lock)
8. Register graceful shutdown handlers
```

### Communication: HTTP REST (no IPC)

CLI communicates with the API process via HTTP REST — the same API that the UI uses.

- No Unix socket, no JSON-RPC, no IPC
- Cross-platform compatible (Windows + Unix)
- Single API surface for CLI and UI

Long tasks (e.g., `task.prepare-data`):
- HTTP POST triggers the task, returns immediately with task ID
- CLI internally polls GET `/api/tasks/:id` until completion
- User experience remains blocking from CLI perspective

### Lock File Mechanism (replaces PID file)

```
Path: ~/.scopai/api.lock
Content: {"port":3000,"startedAt":"2026-04-22T10:00:00Z","pid":12345}
```

- API process writes lock file on startup, deletes on exit
- CLI reads lock file to discover API port
- Process liveness check: HTTP GET `/api/status` (not signal-based, cross-platform)
- Stale lock cleanup: lock exists but HTTP unreachable → delete lock → treat as not running

| Command | Behavior |
|---------|----------|
| `daemon start` | Check lock → if alive, reuse; if stale, delete and restart → poll `/api/status` until ready |
| `daemon stop` | Read lock → SIGTERM → wait for lock file deletion or timeout |
| `daemon status` | Read lock → GET `/api/status` → display status |

### Worker Management

- `runConsumer(workerId)` runs in-process (not child process)
- Worker count: `config.worker.concurrency` (default 2)
- `notifyJobAvailable()` works naturally (process-local EventEmitter)
- Delete `manager.ts` and `worker/index.ts` (no longer needed)

### HTTP Routes Expansion

Current routes cover basic CRUD. Need to add endpoints matching IPC handler functionality:

| New/Extended Route | Original IPC Method |
|---|---|
| POST /api/tasks/:id/prepare-data | task.prepareData |
| POST /api/tasks/:id/add-posts | task.addTargets (posts) |
| POST /api/tasks/:id/add-comments | task.addTargets (comments) |
| POST /api/tasks/:id/resume | task.resume |
| POST /api/tasks/:id/steps | task.step.add |
| POST /api/tasks/:id/steps/:stepId/run | task.step.run |
| POST /api/tasks/:id/run-all-steps | task.runAllSteps |
| POST /api/posts/import | post.import |
| POST /api/comments/import | comment.import |
| POST /api/strategies/import | strategy.import |
| POST /api/analyze/run | analyze.run |

### Graceful Shutdown

```
SIGINT/SIGTERM received:
1. Stop accepting new HTTP requests (app.close())
2. requestShutdown() → workers stop picking new jobs
3. Wait for in-progress jobs to drain (timeout 30s)
4. CHECKPOINT
5. Close DB
6. Delete lock file
7. process.exit(0)
```

### CLI HTTP Client

Replace `ipc-client.ts` with `api-client.ts`:

```typescript
async function getApiBaseUrl(): Promise<string> {
  const lock = readLockFile();
  if (!lock) throw new Error('Daemon not running. Run: scopai daemon start');
  return `http://localhost:${lock.port}`;
}

async function apiGet<T>(path: string): Promise<T> {
  const base = await getApiBaseUrl();
  const res = await fetch(`${base}/api${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const base = await getApiBaseUrl();
  const res = await fetch(`${base}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
```

All CLI commands change from `daemonCall(method, params)` to `apiGet/apiPost(path, body)`.

## Code Changes

### Files to Modify

| File | Change |
|------|--------|
| `packages/api/src/index.ts` | Add worker startup, lock file write, enhanced shutdown |
| `packages/api/src/routes/*.ts` | Add missing endpoints from IPC handlers |
| `packages/cli/src/daemon.ts` | Rewrite to use lock file + HTTP instead of IPC |
| `packages/cli/src/ipc-client.ts` | Replace with `api-client.ts` |
| `packages/cli/src/task.ts` | Switch from daemonCall to apiGet/apiPost |
| `packages/cli/src/post.ts` | Same |
| `packages/cli/src/comment.ts` | Same |
| `packages/cli/src/platform.ts` | Same |
| `packages/cli/src/strategy.ts` | Same |
| `packages/cli/src/analyze.ts` | Same |
| `packages/cli/src/queue.ts` | Same |
| `packages/cli/src/result.ts` | Same |
| `packages/core/src/shared/daemon-status.ts` | Replace PID file with lock file mechanism |

### Files to Delete

| File | Reason |
|------|--------|
| `packages/api/src/worker/manager.ts` | No child process workers |
| `packages/api/src/worker/index.ts` | No standalone worker entry |
| `packages/cli/src/ipc-client.ts` | Replaced by api-client.ts |

### Files to Keep Unchanged

| File | Reason |
|------|--------|
| `packages/api/src/worker/consumer.ts` | Core worker loop, runs in-process |
| `packages/api/src/worker/anthropic.ts` | Anthropic API integration |
| `packages/api/src/worker/parser.ts` | Response parsing |
| `packages/api/src/daemon/handlers.ts` | Business logic reference (will be gradually migrated to routes) |
| `packages/api/src/daemon/scheduler.ts` | Job scheduling logic |
| `packages/core/src/db/*` | All DB modules |
| `packages/core/src/shared/job-events.ts` | Process-local events, works in-process |
| `packages/core/src/shared/shutdown.ts` | Shutdown coordination, works in-process |

## Migration Strategy for handlers.ts

`handlers.ts` is 1549 lines with 30+ methods. Rather than one big rewrite:

1. **Phase 1**: Wire up workers in API process, add lock file, rewrite CLI to use HTTP
2. **Phase 2**: Migrate handler functions to route files one group at a time (task handlers → tasks.ts, post handlers → posts.ts, etc.)
3. **Phase 3**: Delete handlers.ts once all methods have route equivalents

This keeps each change small and testable.
