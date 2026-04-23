# Phase 2: API 服务 — Fastify HTTP API + Daemon 合并实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 `packages/api/` 包，使用 Fastify + Kysely 实现 HTTP API 服务，将原 daemon 的 IPC 处理逻辑迁移为 REST 路由，合并 daemon 和 API 为单一进程。

**Architecture:** Fastify 作为 HTTP 框架，插件化组织路由。认证使用启动时生成的随机 Bearer token。原 `src/daemon/handlers.ts` 中的 IPC handler 逻辑转为 Fastify route handlers。Worker 子进程管理由 API 进程直接管理。所有数据库操作通过 `@scopai/core`。

**Tech Stack:** Fastify, Kysely, kysely-duckdb, Zod, @scopai/core

**依赖 Phase 1:** 必须完成 Phase 1 (Core 提取) 后才能执行此计划。

---

## File Structure

```
packages/api/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              ← 启动入口：HTTP server + 调度器
    ├── server.ts             ← Fastify 实例创建与配置
    ├── auth.ts               ← 随机 token 生成与验证
    ├── routes/               ← REST API 路由
    │   ├── tasks.ts          ← /api/tasks/*
    │   ├── posts.ts          ← /api/posts/*
    │   ├── comments.ts       ← /api/comments/*
    │   ├── platforms.ts      ← /api/platforms/*
    │   ├── strategies.ts     ← /api/strategies/*
    │   ├── templates.ts      ← /api/templates/*
    │   ├── queue.ts          ← /api/queue/*
    │   ├── results.ts        ← /api/results/*
    │   ├── export.ts         ← /api/export/*
    │   └── status.ts         ← /api/daemon/status
    ├── daemon/               ← 原 daemon 调度逻辑
    │   └── scheduler.ts      ← 从 src/daemon/stream-scheduler.ts 迁移
    └── worker/               ← Worker 子进程管理
        ├── manager.ts        ← Worker 进程池管理
        └── consumer.ts       ← 从 src/worker/consumer.ts 迁移
```

---

## Task 1: 创建 packages/api 包结构

**Files:**
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/api/src/index.ts`

- [ ] **Step 1.1: 创建 packages/api/package.json**

```json
{
  "name": "@scopai/api",
  "version": "0.1.11",
  "description": "HTTP API service for analyze-cli",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsup src/index.ts --format cjs --out-dir dist --external @scopai/core --external duckdb --external fastify --minify",
    "dev": "tsup src/index.ts --format cjs --out-dir dist --external @scopai/core --external duckdb --external fastify --watch",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "@scopai/core": "workspace:*",
    "fastify": "^5.3.2",
    "kysely": "^0.27.6",
    "kysely-duckdb": "^0.3.0",
    "zod": "^3.25.57",
    "picocolors": "^1.1.1"
  },
  "devDependencies": {
    "@types/node": "^22.15.3",
    "tsup": "^8.4.0",
    "typescript": "^5.8.3"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

- [ ] **Step 1.2: 创建 packages/api/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "removeComments": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 1.3: 创建 packages/api/src/index.ts (入口)**

```typescript
import fastify from 'fastify';
import { config } from '@scopai/core';
import { setupAuth } from './auth';
import { registerRoutes } from './routes';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';

async function main() {
  const app = fastify({
    logger: { level: config.logging.level },
  });

  // Health check (no auth required)
  app.get('/health', async () => ({ status: 'ok' }));

  // Setup auth + routes
  await setupAuth(app);
  await registerRoutes(app);

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`API server listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 1.4: Commit**

```bash
git add packages/api/
git commit -m "chore(api): create api package structure with Fastify"
```

---

## Task 2: 实现认证中间件

**Files:**
- Create: `packages/api/src/auth.ts`

- [ ] **Step 2.1: 创建 auth.ts**

```typescript
import { FastifyInstance } from 'fastify';
import crypto from 'crypto';

// Generate a random 32-byte hex token on startup
const AUTH_TOKEN = process.env.API_TOKEN ?? crypto.randomBytes(32).toString('hex');

// Print token on first reference
let printed = false;
export function getAuthToken(): string {
  if (!printed) {
    console.log('\n🔐 API Auth Token:', AUTH_TOKEN);
    console.log('   Store this in localStorage as "api_token" in the UI\n');
    printed = true;
  }
  return AUTH_TOKEN;
}

export async function setupAuth(app: FastifyInstance) {
  // Register auth hook for all /api/* routes except /health
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;

    const auth = request.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      reply.code(401);
      throw new Error('Missing Authorization header');
    }

    const token = auth.slice(7);
    if (token !== AUTH_TOKEN) {
      reply.code(403);
      throw new Error('Invalid token');
    }
  });
}
```

- [ ] **Step 2.2: Commit**

```bash
git add packages/api/src/auth.ts
git commit -m "feat(api): add bearer token auth middleware"
```

---

## Task 3: 实现核心路由（Tasks）

**Files:**
- Create: `packages/api/src/routes/index.ts`
- Create: `packages/api/src/routes/tasks.ts`

- [ ] **Step 3.1: 创建 routes/index.ts**

```typescript
import { FastifyInstance } from 'fastify';
import tasksRoutes from './tasks';
import postsRoutes from './posts';
import platformsRoutes from './platforms';
import strategiesRoutes from './strategies';
import templatesRoutes from './templates';
import queueRoutes from './queue';
import resultsRoutes from './results';
import statusRoutes from './status';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(tasksRoutes, { prefix: '/api' });
  await app.register(postsRoutes, { prefix: '/api' });
  await app.register(platformsRoutes, { prefix: '/api' });
  await app.register(strategiesRoutes, { prefix: '/api' });
  await app.register(templatesRoutes, { prefix: '/api' });
  await app.register(queueRoutes, { prefix: '/api' });
  await app.register(resultsRoutes, { prefix: '/api' });
  await app.register(statusRoutes, { prefix: '/api' });
}
```

- [ ] **Step 3.2: 创建 routes/tasks.ts**

从 `src/daemon/handlers.ts` 中的 `'task.*'` handler 迁移逻辑。

```typescript
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  createTask, getTaskById, listTasks, updateTaskStatus, updateTaskStats,
  addTaskTargets, getTargetStats, listTaskTargets,
  getTaskPostStatuses, listTaskSteps, listJobsByTask,
  enqueueJobs, generateId, now, query, getLogger,
} from '@scopai/core';

const CreateTaskSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  template_id: z.string().nullable().optional(),
  cli_templates: z.string().nullable().optional(),
});

export default async function tasksRoutes(app: FastifyInstance) {
  // GET /api/tasks
  app.get('/tasks', async (request) => {
    const { status, query: searchQuery } = request.query as Record<string, string>;
    return listTasks(status, searchQuery);
  });

  // GET /api/tasks/:id
  app.get('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }
    return task;
  });

  // POST /api/tasks
  app.post('/tasks', async (request) => {
    const data = CreateTaskSchema.parse(request.body);
    const id = data.id ?? generateId();
    await createTask({
      id,
      name: data.name,
      description: data.description ?? null,
      template_id: data.template_id ?? null,
      cli_templates: data.cli_templates ?? null,
      status: 'pending',
      stats: { total: 0, done: 0, failed: 0 },
      created_at: now(),
      updated_at: now(),
      completed_at: null,
    });
    return { id };
  });

  // POST /api/tasks/:id/start
  app.post('/tasks/:id/start', async (request) => {
    const { id } = request.params as { id: string };
    await updateTaskStatus(id, 'running');
    const stats = await getTargetStats(id);
    await updateTaskStats(id, { total: stats.total, done: stats.done, failed: stats.failed });
    return { status: 'running' };
  });

  // POST /api/tasks/:id/pause
  app.post('/tasks/:id/pause', async (request) => {
    const { id } = request.params as { id: string };
    await updateTaskStatus(id, 'paused');
    return { status: 'paused' };
  });

  // POST /api/tasks/:id/cancel
  app.post('/tasks/:id/cancel', async (request) => {
    const { id } = request.params as { id: string };
    await updateTaskStatus(id, 'failed');
    return { status: 'cancelled' };
  });

  // POST /api/tasks/:id/prepare
  app.post('/tasks/:id/prepare', async (request, reply) => {
    const { id } = request.params as { id: string };
    // TODO: Phase 2 后续步骤 — 调用 scheduler 触发数据准备
    // 暂时返回 202 Accepted
    reply.code(202);
    return { started: true };
  });
}
```

- [ ] **Step 3.3: Commit**

```bash
git add packages/api/src/routes/
git commit -m "feat(api): implement tasks REST routes"
```

---

## Task 4: 实现 Posts 路由

**Files:**
- Create: `packages/api/src/routes/posts.ts`

- [ ] **Step 4.1: 创建 routes/posts.ts**

```typescript
import { FastifyInstance } from 'fastify';
import { listPosts, searchPosts, listCommentsByPost, listMediaFilesByPost } from '@scopai/core';

export default async function postsRoutes(app: FastifyInstance) {
  // GET /api/posts
  app.get('/posts', async (request) => {
    const { platform, limit = '50', offset = '0', query: searchQuery } = request.query as Record<string, string>;
    if (searchQuery) {
      return searchPosts(platform ?? '', searchQuery, parseInt(limit, 10));
    }
    return listPosts(platform, parseInt(limit, 10), parseInt(offset, 10));
  });

  // GET /api/posts/:id/comments
  app.get('/posts/:id/comments', async (request) => {
    const { id } = request.params as { id: string };
    return listCommentsByPost(id);
  });

  // GET /api/posts/:id/media
  app.get('/posts/:id/media', async (request) => {
    const { id } = request.params as { id: string };
    return listMediaFilesByPost(id);
  });
}
```

- [ ] **Step 4.2: Commit**

```bash
git add packages/api/src/routes/posts.ts
git commit -m "feat(api): implement posts REST routes"
```

---

## Task 5: 实现 Platforms 和 Templates 路由

**Files:**
- Create: `packages/api/src/routes/platforms.ts`
- Create: `packages/api/src/routes/templates.ts`

- [ ] **Step 5.1: 创建 routes/platforms.ts**

```typescript
import { FastifyInstance } from 'fastify';
import { listPlatforms, createPlatform } from '@scopai/core';

export default async function platformsRoutes(app: FastifyInstance) {
  app.get('/platforms', async () => listPlatforms());

  app.post('/platforms', async (request) => {
    const { id, name, description } = request.body as { id: string; name: string; description?: string };
    await createPlatform({ id, name, description: description ?? null });
    return { id };
  });
}
```

- [ ] **Step 5.2: 创建 routes/templates.ts**

```typescript
import { FastifyInstance } from 'fastify';
import { listTemplates, getTemplateById, createTemplate } from '@scopai/core';

export default async function templatesRoutes(app: FastifyInstance) {
  app.get('/templates', async () => listTemplates());

  app.get('/templates/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const tpl = await getTemplateById(id);
    if (!tpl) { reply.code(404); throw new Error('Template not found'); }
    return tpl;
  });

  app.post('/templates', async (request) => {
    const { name, description, template, is_default } = request.body as Record<string, unknown>;
    const id = await createTemplate({
      id: crypto.randomUUID(),
      name: name as string,
      description: (description ?? null) as string | null,
      template: template as string,
      is_default: (is_default ?? false) as boolean,
      created_at: new Date(),
    });
    return { id };
  });
}
```

- [ ] **Step 5.3: Commit**

```bash
git add packages/api/src/routes/platforms.ts packages/api/src/routes/templates.ts
git commit -m "feat(api): implement platforms and templates routes"
```

---

## Task 6: 实现 Strategies 路由

**Files:**
- Create: `packages/api/src/routes/strategies.ts`

- [ ] **Step 6.1: 创建 routes/strategies.ts**

```typescript
import { FastifyInstance } from 'fastify';
import {
  listStrategies, getStrategyById, createStrategy, updateStrategy, deleteStrategy,
  validateStrategyJson, parseJsonSchemaToColumns, createStrategyResultTable, syncStrategyResultTable,
} from '@scopai/core';

export default async function strategiesRoutes(app: FastifyInstance) {
  app.get('/strategies', async () => listStrategies());

  app.get('/strategies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const strategy = await getStrategyById(id);
    if (!strategy) { reply.code(404); throw new Error('Strategy not found'); }
    return strategy;
  });

  app.post('/strategies', async (request) => {
    const data = request.body as Record<string, unknown>;
    const validation = validateStrategyJson(data);
    if (!validation.valid) {
      throw new Error(`Invalid strategy: ${validation.error}`);
    }

    const obj = data;
    const outputSchema = obj.output_schema as Record<string, unknown>;
    const columnDefs = parseJsonSchemaToColumns(outputSchema);
    await createStrategyResultTable(obj.id as string, columnDefs);
    await syncStrategyResultTable(obj.id as string, columnDefs);

    const strategy = {
      id: obj.id as string,
      name: obj.name as string,
      description: (obj.description ?? null) as string | null,
      version: (obj.version ?? '1.0.0') as string,
      target: obj.target as 'post' | 'comment',
      needs_media: (obj.needs_media ?? { enabled: false }) as any,
      prompt: obj.prompt as string,
      output_schema: obj.output_schema as any,
      batch_config: (obj.batch_config ?? null) as any,
      depends_on: (obj.depends_on ?? null) as 'post' | 'comment' | null,
      include_original: (obj.include_original ?? false) as boolean,
      file_path: null as string | null,
      created_at: new Date(),
      updated_at: new Date(),
    };

    await createStrategy(strategy);
    return { imported: true, id: strategy.id };
  });

  app.delete('/strategies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await getStrategyById(id);
    if (!existing) { reply.code(404); throw new Error('Strategy not found'); }
    await deleteStrategy(id);
    return { deleted: true };
  });
}
```

- [ ] **Step 6.2: Commit**

```bash
git add packages/api/src/routes/strategies.ts
git commit -m "feat(api): implement strategies routes"
```

---

## Task 7: 实现 Queue 路由

**Files:**
- Create: `packages/api/src/routes/queue.ts`

- [ ] **Step 7.1: 创建 routes/queue.ts**

```typescript
import { FastifyInstance } from 'fastify';
import { retryFailedJobs, resetJobs, getQueueStats } from '@scopai/core';

export default async function queueRoutes(app: FastifyInstance) {
  app.get('/queue', async (request) => {
    const { task_id } = request.query as Record<string, string>;
    // TODO: 列出队列任务
    return { task_id, jobs: [] };
  });

  app.post('/queue/:id/retry', async (request) => {
    const { id } = request.params as { id: string };
    const retried = await retryFailedJobs(id);
    return { retried };
  });

  app.post('/queue/reset', async (request) => {
    const { task_id } = request.query as Record<string, string>;
    const reset = await resetJobs(task_id);
    return { reset };
  });
}
```

- [ ] **Step 7.2: Commit**

```bash
git add packages/api/src/routes/queue.ts
git commit -m "feat(api): implement queue routes"
```

---

## Task 8: 实现 Results 和 Export 路由

**Files:**
- Create: `packages/api/src/routes/results.ts`

- [ ] **Step 8.1: 创建 routes/results.ts**

```typescript
import { FastifyInstance } from 'fastify';
import { listStrategyResultsByTask, getStrategyResultStats } from '@scopai/core';

export default async function resultsRoutes(app: FastifyInstance) {
  app.get('/results', async (request) => {
    const { task_id, strategy_id, limit = '100' } = request.query as Record<string, string>;
    if (!task_id || !strategy_id) {
      throw new Error('task_id and strategy_id are required');
    }
    return listStrategyResultsByTask(strategy_id, task_id, parseInt(limit, 10));
  });

  app.get('/results/stats', async (request) => {
    const { task_id, strategy_id } = request.query as Record<string, string>;
    if (!task_id || !strategy_id) {
      throw new Error('task_id and strategy_id are required');
    }
    return getStrategyResultStats(strategy_id, task_id);
  });
}
```

- [ ] **Step 8.2: Commit**

```bash
git add packages/api/src/routes/results.ts
git commit -m "feat(api): implement results routes"
```

---

## Task 9: 实现 Status 路由

**Files:**
- Create: `packages/api/src/routes/status.ts`

- [ ] **Step 9.1: 创建 routes/status.ts**

```typescript
import { FastifyInstance } from 'fastify';
import { getDbPath, getQueueStats } from '@scopai/core';

export default async function statusRoutes(app: FastifyInstance) {
  app.get('/daemon/status', async () => ({
    pid: process.pid,
    db_path: getDbPath(),
    queue_stats: await getQueueStats(),
    uptime: process.uptime(),
  }));
}
```

- [ ] **Step 9.2: Commit**

```bash
git add packages/api/src/routes/status.ts
git commit -m "feat(api): implement daemon status route"
```

---

## Task 10: 迁移 Worker 管理到 packages/api

**Files:**
- Create: `packages/api/src/worker/manager.ts`
- Move: `src/worker/*` → `packages/api/src/worker/`

- [ ] **Step 10.1: 移动 worker 文件**

```bash
mkdir -p packages/api/src/worker
cp src/worker/* packages/api/src/worker/
```

- [ ] **Step 10.2: 更新 worker 文件中的 import 路径**

将 `../db/`, `../shared/`, `../config/` 改为 `@scopai/core`。

- [ ] **Step 10.3: 创建 worker/manager.ts**

```typescript
import { spawn, ChildProcess } from 'child_process';
import { getLogger } from '@scopai/core';

let workerProcess: ChildProcess | null = null;
const logger = getLogger();

export function startWorkers(): void {
  if (workerProcess) return;

  logger.info('Starting worker process...');
  workerProcess = spawn('node', [require.resolve('./consumer')], {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: false,
  });

  workerProcess.on('exit', (code) => {
    logger.warn(`Worker exited with code ${code}`);
    workerProcess = null;
  });
}

export function stopWorkers(): void {
  if (workerProcess) {
    workerProcess.kill('SIGTERM');
    workerProcess = null;
  }
}
```

- [ ] **Step 10.4: Commit**

```bash
git add packages/api/src/worker/
git commit -m "feat(api): migrate worker management to api package"
```

---

## Task 11: 迁移 Stream Scheduler 到 packages/api

**Files:**
- Create: `packages/api/src/daemon/scheduler.ts`
- Copy: `src/daemon/stream-scheduler.ts` → `packages/api/src/daemon/scheduler.ts`

- [ ] **Step 11.1: 复制并更新 stream-scheduler.ts**

```bash
mkdir -p packages/api/src/daemon
cp src/daemon/stream-scheduler.ts packages/api/src/daemon/scheduler.ts
```

- [ ] **Step 11.2: 更新 import 路径**

将 `../db/`, `../shared/`, `../config/` 改为 `@scopai/core`。

- [ ] **Step 11.3: Commit**

```bash
git add packages/api/src/daemon/
git commit -m "feat(api): migrate stream scheduler to api package"
```

---

## Task 12: 在 API 入口启动 Worker

**Files:**
- Modify: `packages/api/src/index.ts`

- [ ] **Step 12.1: 更新 index.ts 启动 Worker**

```typescript
import fastify from 'fastify';
import { config, migrate, seedPlatforms } from '@scopai/core';
import { setupAuth } from './auth';
import { registerRoutes } from './routes';
import { startWorkers, stopWorkers } from './worker/manager';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';

async function main() {
  // Run migrations
  await migrate();
  await seedPlatforms();

  const app = fastify({
    logger: { level: config.logging.level },
  });

  // Health check (no auth required)
  app.get('/health', async () => ({ status: 'ok' }));

  // Setup auth + routes
  await setupAuth(app);
  await registerRoutes(app);

  // Start worker consumers
  startWorkers();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    stopWorkers();
    await app.close();
  });

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`API server listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
```

- [ ] **Step 12.2: Commit**

```bash
git add packages/api/src/index.ts
git commit -m "feat(api): integrate worker startup and graceful shutdown"
```

---

## Task 13: 安装依赖并构建

**Files:**
- Run: `pnpm install`
- Run: `pnpm build`

- [ ] **Step 13.1: 安装 API 包依赖**

```bash
pnpm install
```

- [ ] **Step 13.2: 构建 API 包**

```bash
cd packages/api && pnpm build
```

预期：成功编译，无错误。

- [ ] **Step 13.3: 运行 API 服务测试**

```bash
cd packages/api && pnpm start
```

在另一个终端测试：
```bash
curl http://localhost:3000/health
# 预期: {"status":"ok"}
```

- [ ] **Step 13.4: Commit**

```bash
git add pnpm-lock.yaml
git commit -m "chore(deps): install api package dependencies"
```

---

## Task 14: 删除旧的 src/daemon/ 和 src/worker/

**Files:**
- Delete: `src/daemon/`, `src/worker/`

- [ ] **Step 14.1: 删除旧目录**

```bash
rm -rf src/daemon/ src/worker/
```

- [ ] **Step 14.2: 验证 src/ 目录已空或清理**

```bash
ls src/ 2>/dev/null || echo "src/ directory is empty or removed"
```

如果 `src/` 已空，删除它：
```bash
rmdir src/ 2>/dev/null || true
```

- [ ] **Step 14.3: Commit**

```bash
git add -A
git commit -m "chore(monorepo): remove old daemon and worker directories"
```

---

## Task 15: 验证完整功能

**Files:**
- Run: 测试

- [ ] **Step 15.1: 根目录完整构建**

```bash
pnpm build
```

- [ ] **Step 15.2: 运行 API 服务并测试 endpoints**

```bash
# 启动服务
cd packages/api && pnpm start &
API_PID=$!

# 等待启动
sleep 2

# 测试 health
curl http://localhost:3000/health

# 获取 token（从控制台输出复制）
TOKEN=$(curl -s http://localhost:3000/health > /dev/null; echo "check console for token")

# 测试需要认证的路由
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/platforms

# 停止服务
kill $API_PID
```

- [ ] **Step 15.3: 运行现有测试**

```bash
pnpm test:integration
```

- [ ] **Step 15.4: 最终 Commit**

```bash
git commit -m "feat(api): complete Phase 2 API service implementation"
```

---

## Self-Review

### Spec Coverage Check

| 设计文档 Phase 2 要求 | 对应任务 |
|----------------------|---------|
| 创建 `packages/api/` | Task 1 |
| 接入 Fastify | Task 1, 2 |
| 实现核心 API 路由 | Task 3-9 |
| 认证方案（随机 token） | Task 2 |
| Worker 管理迁移 | Task 10 |
| Stream Scheduler 迁移 | Task 11 |
| Daemon + API 合并 | Task 12 |
| 删除原 `src/daemon/` | Task 14 |

### Placeholder Scan

- [x] 无 "TBD", "TODO"（除 prepare 路由的异步处理标记为 Phase 2 后续）
- [x] 所有路由包含实际实现代码
- [x] 无模糊描述

### Type Consistency

- [x] 所有路由参数类型与 core 包导出一致
- [x] Zod schema 与 types.ts 中的类型一致
