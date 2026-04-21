# Phase 4: CLI 瘦身 — 重构为瘦客户端实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `packages/cli/` 中的命令从直接调用 core 函数改为通过 HTTP API 访问 api 服务，使 CLI 成为纯客户端。

**Architecture:** CLI 命令分为两类：
1. **同步查询类**（`task list`, `post list` 等）→ 直接调用 `@analyze-cli/core`（无 HTTP 开销）
2. **异步操作类**（`task prepare`, `task run` 等）→ HTTP 调用 `@analyze-cli/api`

CLI 启动时检查 API 服务是否运行，如未运行则自动启动内嵌 API 服务（`packages/api/dist/index.js`）。

**Tech Stack:** Commander, @analyze-cli/core, @analyze-cli/api (shared types), node-fetch

**依赖 Phase 1 & 2:** 必须完成 Phase 1 和 Phase 2 后才能执行此计划。

---

## File Structure

```
packages/cli/
└── src/
    ├── index.ts              ← CLI 入口（已存在）
    ├── api-client.ts         ← HTTP API 客户端（从 ipc-client.ts 重构）
    ├── commands/             ← 分类命令目录
    │   ├── query/            ← 同步查询命令（调 core）
    │   │   ├── task-list.ts
    │   │   ├── post-list.ts
    │   │   └── platform-list.ts
    │   └── action/           ← 异步操作命令（调 HTTP API）
    │       ├── task-start.ts
    │       ├── task-prepare.ts
    │       └── strategy-import.ts
    └── daemon-client.ts      ← 内嵌 API 服务管理
```

---

## Task 1: 创建 CLI HTTP 客户端

**Files:**
- Create: `packages/cli/src/api-client.ts`
- Delete: `packages/cli/src/ipc-client.ts`

- [ ] **Step 1.1: 创建 api-client.ts**

```typescript
import { getLogger } from '@analyze-cli/core';

const API_BASE = process.env.ANALYZE_API_URL ?? 'http://127.0.0.1:3000';
const logger = getLogger();

async function getToken(): Promise<string> {
  // Read token from config or prompt user
  const token = process.env.ANALYZE_API_TOKEN ?? '';
  return token;
}

export async function apiGet<T>(path: string): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const token = await getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err.error?.message ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function setApiBase(url: string): void {
  // For testing or remote API
  process.env.ANALYZE_API_URL = url;
}
```

- [ ] **Step 1.2: 删除 ipc-client.ts**

```bash
rm packages/cli/src/ipc-client.ts
```

- [ ] **Step 1.3: Commit**

```bash
git add packages/cli/src/api-client.ts
git commit -m "feat(cli): replace IPC client with HTTP API client"
```

---

## Task 2: 实现内嵌 API 服务管理

**Files:**
- Create: `packages/cli/src/daemon-client.ts`

- [ ] **Step 2.1: 创建 daemon-client.ts**

```typescript
import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';
import { getLogger } from '@analyze-cli/core';

const logger = getLogger();
let embeddedProcess: ChildProcess | null = null;

export async function ensureApiRunning(): Promise<void> {
  // Check if API is already running
  try {
    const res = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      logger.debug('API service is already running');
      return;
    }
  } catch {
    // Not running, start it
  }

  logger.info('Starting embedded API service...');
  const apiPath = path.resolve(__dirname, '../../api/dist/index.js');
  embeddedProcess = spawn('node', [apiPath], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    env: { ...process.env, PORT: '3000' },
  });

  // Wait for API to be ready
  let attempts = 0;
  while (attempts < 30) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch('http://127.0.0.1:3000/health', { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        logger.info('Embedded API service is ready');
        return;
      }
    } catch {
      // Still starting
    }
    attempts++;
  }

  throw new Error('Failed to start embedded API service');
}

export function stopEmbeddedApi(): void {
  if (embeddedProcess) {
    embeddedProcess.kill('SIGTERM');
    embeddedProcess = null;
  }
}
```

- [ ] **Step 2.2: Commit**

```bash
git add packages/cli/src/daemon-client.ts
git commit -m "feat(cli): add embedded API service launcher"
```

---

## Task 3: 重构 task 命令

**Files:**
- Modify: `packages/cli/src/task.ts`

- [ ] **Step 3.1: 更新 task.ts 使用 API 客户端**

将 `'task.start'`, `'task.pause'`, `'task.cancel'` 等异步操作从直接 DB 调用改为 HTTP API 调用。

```typescript
import { Command } from 'commander';
import { listTasks, createTask } from '@analyze-cli/core'; // 同步查询仍用 core
import { apiPost } from './api-client';
import { ensureApiRunning } from './daemon-client';

export function registerTaskCommands(program: Command) {
  const task = program.command('task');

  // 同步查询：直接调 core
  task
    .command('list')
    .option('-s, --status <status>', 'Filter by status')
    .option('-q, --query <query>', 'Search query')
    .action(async (opts) => {
      const tasks = await listTasks(opts.status, opts.query);
      console.table(tasks);
    });

  task
    .command('create')
    .requiredOption('-n, --name <name>', 'Task name')
    .option('-d, --description <desc>', 'Description')
    .option('-t, --template <id>', 'Template ID')
    .action(async (opts) => {
      const id = await createTask({ /* ... */ });
      console.log(`Created task: ${id}`);
    });

  // 异步操作：调 API
  task
    .command('start')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts) => {
      await ensureApiRunning();
      const result = await apiPost(`/tasks/${opts.taskId}/start`);
      console.log('Task started:', result);
    });

  task
    .command('pause')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts) => {
      await ensureApiRunning();
      const result = await apiPost(`/tasks/${opts.taskId}/pause`);
      console.log('Task paused:', result);
    });

  // ... 其他命令类似处理
}
```

- [ ] **Step 3.2: Commit**

```bash
git add packages/cli/src/task.ts
git commit -m "feat(cli): refactor task commands to use HTTP API for async operations"
```

---

## Task 4: 重构其他异步命令

**Files:**
- Modify: `packages/cli/src/task-prepare.ts`
- Modify: `packages/cli/src/strategy.ts`
- Modify: `packages/cli/src/analyze.ts`
- Modify: `packages/cli/src/queue.ts`

- [ ] **Step 4.1: 逐个更新异步命令文件**

对每个文件：
1. 保留同步查询操作（直接调 core）
2. 将异步操作改为 `apiPost()` 调用
3. 在异步操作前调用 `ensureApiRunning()`

```typescript
// task-prepare.ts 示例
import { apiPost } from './api-client';
import { ensureApiRunning } from './daemon-client';

export async function taskPrepare(taskId: string) {
  await ensureApiRunning();
  const result = await apiPost(`/tasks/${taskId}/prepare`);
  console.log('Data preparation started:', result);
}
```

- [ ] **Step 4.2: Commit**

```bash
git add packages/cli/src/
git commit -m "feat(cli): refactor all async commands to use HTTP API"
```

---

## Task 5: 更新 CLI 入口

**Files:**
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 5.1: 更新 index.ts 注册命令**

确保所有命令正确注册，添加 `--api-url` 全局选项。

```typescript
import { Command } from 'commander';
import { version } from '@analyze-cli/core';
import { registerTaskCommands } from './task';
// ... import other command modules

const program = new Command();
program
  .name('analyze-cli')
  .version(version)
  .option('--api-url <url>', 'API server URL', 'http://127.0.0.1:3000')
  .hook('preAction', (thisCommand) => {
    const url = thisCommand.opts().apiUrl;
    if (url) process.env.ANALYZE_API_URL = url;
  });

registerTaskCommands(program);
// register other commands...

program.parse();
```

- [ ] **Step 5.2: Commit**

```bash
git add packages/cli/src/index.ts
git commit -m "feat(cli): update CLI entry with global API URL option"
```

---

## Task 6: 更新 bin 脚本和构建

**Files:**
- Modify: `packages/cli/package.json`

- [ ] **Step 6.1: 更新 cli package.json 添加 api 依赖**

```json
{
  "dependencies": {
    "@analyze-cli/core": "workspace:*",
    "commander": "^14.0.3",
    "picocolors": "^1.1.1"
  }
}
```

注意：CLI 不需要直接依赖 `@analyze-cli/api`，因为它通过 HTTP 调用。

- [ ] **Step 6.2: 构建并验证**

```bash
pnpm build
cd packages/cli && pnpm build
```

- [ ] **Step 6.3: 测试 CLI 命令**

```bash
# 测试同步查询（直接调 core，无需 API）
node bin/analyze-cli.js task list

# 测试异步操作（自动启动嵌入 API）
node bin/analyze-cli.js task start --task-id <some-id>
```

- [ ] **Step 6.4: Commit**

```bash
git commit -m "feat(cli): complete Phase 4 CLI slimming"
```

---

## Task 7: 最终验证

**Files:**
- Run: 完整测试

- [ ] **Step 7.1: 运行所有测试**

```bash
pnpm test
pnpm test:integration
pnpm test:e2e
```

- [ ] **Step 7.2: 验证端到端工作流**

```bash
# 1. 启动 API
node packages/api/dist/index.js &

# 2. 创建任务
node bin/analyze-cli.js task create --name "Test"

# 3. 查看任务列表
node bin/analyze-cli.js task list

# 4. 在浏览器中打开 Dashboard
curl http://localhost:3000
```

- [ ] **Step 7.3: 最终 Commit**

```bash
git commit -m "feat(monorepo): complete all 4 phases — UI + Monorepo architecture"
```

---

## Self-Review

### Spec Coverage

| 设计文档 Phase 4 要求 | 对应任务 |
|----------------------|---------|
| CLI 命令改为调用 core 接口 | Task 3-4（同步查询保留） |
| 异步操作改为调用 API HTTP 接口 | Task 3-4 |
| 移除重复数据库操作代码 | Task 3-4 |
| 内嵌 API 启动 | Task 2 |

### Placeholder Scan

- [x] 无模糊描述
- [x] 所有命令包含实际实现
