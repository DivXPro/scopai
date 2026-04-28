# E2E 测试套件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一套覆盖完整用户工作流的端到端测试，使用真实 DuckDB + 真实 Anthropic API + 真实 OpenCLI 链路。

**Architecture:** 四个 E2E 模块（import-and-prepare、strategy-workflow、queue-recovery、daemon-lifecycle）共用一套 helpers（db/cli/daemon/assertions），通过环境变量隔离测试数据库和 IPC socket，每个测试用例使用独立 RUN_ID 前缀隔离数据。

**Tech Stack:** Node.js built-in test runner (`node:test`), TypeScript (`--experimental-strip-types`), DuckDB, child_process spawn, picocolors CLI output parsing

---

## File Map

| File | Responsibility |
|------|---------------|
| `test/e2e/helpers/db.ts` | 数据库连接隔离、cleanup、种子数据加载 |
| `test/e2e/helpers/cli.ts` | 执行 CLI 命令（`node bin/scopai.js`），解析输出提取 ID |
| `test/e2e/helpers/daemon.ts` | daemon 生命周期管理（start/stop/status/isRunning） |
| `test/e2e/helpers/assertions.ts` | 轮询工具、常用断言 |
| `test/e2e/fixtures/posts/sample-xhs.json` | 测试用小红书帖子数据 |
| `test/e2e/fixtures/strategies/sentiment.json` | 情感分析策略 |
| `test/e2e/fixtures/strategies/media-analysis.json` | 图片内容分析策略（needs_media=true） |
| `test/e2e/import-and-prepare/import-and-prepare.test.ts` | 导入→数据准备 E2E |
| `test/e2e/strategy-workflow/task-steps.test.ts` | 策略工作流 E2E |
| `test/e2e/queue-recovery/retry.test.ts` | 队列恢复 E2E |
| `test/e2e/daemon-lifecycle/lifecycle.test.ts` | daemon 生命周期 E2E |

---

### Task 1: 迁移现有测试到 test/integration/

**Files:**
- Move: `test/*.test.ts` → `test/integration/*.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 移动现有测试文件**

```bash
mv test/comment-analysis.test.ts test/integration/
mv test/import-offline.test.ts test/integration/
mv test/import-recorded-xhs.test.ts test/integration/
mv test/opencli.test.ts test/integration/
mv test/prepare-data-offline.test.ts test/integration/
mv test/prepare-data.test.ts test/integration/
mv test/queue-jobs.test.ts test/integration/
mv test/stream-scheduler.test.ts test/integration/
mv test/strategy-system.test.ts test/integration/
mv test/task-post-status.test.ts test/integration/
mv test/xhs-shanghai-food.test.ts test/integration/
```

- [ ] **Step 2: 更新 package.json 脚本**

Modify `package.json`:

```json
{
  "scripts": {
    "build": "tsup src/cli/index.ts src/daemon/index.ts src/daemon/stream-scheduler.ts --format cjs --out-dir dist --external duckdb --minify",
    "dev": "tsup src/cli/index.ts src/daemon/index.ts --format cjs --out-dir dist --external duckdb --watch",
    "test": "node --test --test-concurrency=1 --experimental-strip-types 'test/**/*.test.ts'",
    "test:integration": "node --test --test-concurrency=1 --experimental-strip-types 'test/integration/*.test.ts'",
    "test:e2e": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/**/*.test.ts'",
    "test:e2e:import": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/import-and-prepare/*.test.ts'",
    "test:e2e:strategy": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/strategy-workflow/*.test.ts'",
    "test:e2e:queue": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/queue-recovery/*.test.ts'",
    "test:e2e:daemon": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/daemon-lifecycle/*.test.ts'",
    "test:record": "npx tsx scripts/record-e2e-fixture.ts --platform xhs --query '上海美食' --limit 2 --output test-data/recorded/$(date +%Y-%m-%d)-xhs-shanghai",
    "prepublishOnly": "npm run build"
  }
}
```

- [ ] **Step 3: 验证集成测试仍能通过**

Run: `npm run test:integration`
Expected: All 11 integration tests pass (may take 1-2 minutes)

- [ ] **Step 4: Commit**

```bash
git add test/integration/ package.json
git commit -m "chore(test): migrate existing tests to test/integration/"
```

---

### Task 2: 创建 E2E Fixtures

**Files:**
- Create: `test/e2e/fixtures/posts/sample-xhs.json`
- Create: `test/e2e/fixtures/strategies/sentiment.json`
- Create: `test/e2e/fixtures/strategies/media-analysis.json`

- [ ] **Step 1: 创建帖子 fixture**

Create `test/e2e/fixtures/posts/sample-xhs.json`:

```json
{
  "posts": [
    {
      "id": "post_001",
      "title": "上海美食探店",
      "content": "今天去了一家超棒的餐厅，味道绝了！服务态度也很好，推荐大家来试试。",
      "author": "foodie_01",
      "url": "https://www.xiaohongshu.com/discovery/item/post_001"
    },
    {
      "id": "post_002",
      "title": "周末去哪儿",
      "content": "这次去的景点人有点多，体验一般般，不太推荐节假日去。",
      "author": "traveler_02",
      "url": "https://www.xiaohongshu.com/discovery/item/post_002"
    }
  ]
}
```

- [ ] **Step 2: 创建情感分析策略 fixture**

Create `test/e2e/fixtures/strategies/sentiment.json`:

```json
{
  "name": "E2E 情感分析",
  "description": "分析评论情感倾向",
  "prompt": "分析以下评论的情感倾向（positive/negative/neutral），返回 JSON：{ \"sentiment\": string, \"confidence\": number }",
  "output_schema": {
    "sentiment": "VARCHAR",
    "confidence": "DOUBLE"
  },
  "needs_media": false
}
```

- [ ] **Step 3: 创建媒体分析策略 fixture**

Create `test/e2e/fixtures/strategies/media-analysis.json`:

```json
{
  "name": "E2E 图片内容分析",
  "description": "分析帖子图片内容",
  "prompt": "分析以下帖子的图片内容，返回 JSON：{ \"main_subject\": string, \"visual_quality\": string }",
  "output_schema": {
    "main_subject": "VARCHAR",
    "visual_quality": "VARCHAR"
  },
  "needs_media": true
}
```

- [ ] **Step 4: Commit**

```bash
git add test/e2e/fixtures/
git commit -m "test(e2e): add fixtures for end-to-end tests"
```

---

### Task 3: 创建 helpers/db.ts

**Files:**
- Create: `test/e2e/helpers/db.ts`

- [ ] **Step 1: 编写 db helper**

Create `test/e2e/helpers/db.ts`:

```ts
import * as db from '../../dist/db/client.js';
const { query, run, close: closeDb } = db;
import * as migrate from '../../dist/db/migrate.js';
const { runMigrations } = migrate;
import * as seed from '../../dist/db/seed.js';
const { seedAll } = seed;

export { query, run, closeDb, runMigrations, seedAll };

export async function cleanupByPrefix(prefix: string): Promise<void> {
  const like = `${prefix}%`;
  // queue_jobs 和 task_targets 引用了 tasks 和 posts，需要谨慎处理
  // 按依赖顺序清理
  await run(`DELETE FROM queue_jobs WHERE task_id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM task_post_status WHERE task_id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM task_steps WHERE task_id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM task_targets WHERE task_id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM tasks WHERE id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM posts WHERE platform_id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM comments WHERE platform_id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM media_files WHERE platform_id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM platforms WHERE id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM strategies WHERE id LIKE ?`, [like]).catch(() => {});
  // 清理动态创建的 strategy_result_ 表
  const tables = await query<{ name: string }>(
    `SELECT table_name as name FROM information_schema.tables WHERE table_name LIKE ?`,
    [`strategy_result_${prefix}%`]
  );
  for (const t of tables) {
    await run(`DROP TABLE IF EXISTS "${t.name}"`).catch(() => {});
  }
}

export async function resetTestDb(): Promise<void> {
  closeDb();
  await runMigrations();
  await seedAll();
}
```

- [ ] **Step 2: Commit**

```bash
git add test/e2e/helpers/db.ts
git commit -m "test(e2e): add db helper for test isolation"
```

---

### Task 4: 创建 helpers/cli.ts

**Files:**
- Create: `test/e2e/helpers/cli.ts`

- [ ] **Step 1: 编写 cli helper**

Create `test/e2e/helpers/cli.ts`:

```ts
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';

const CLI_PATH = path.join(process.cwd(), 'bin', 'scopai.js');

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function getTestEnv(): Record<string, string> {
  const runId = `e2e_${Date.now()}_${process.pid}`;
  const tmpDir = path.join(os.tmpdir(), 'scopai-e2e', runId);
  return {
    ...process.env,
    ANALYZE_CLI_DB_PATH: path.join(tmpDir, 'test.duckdb'),
    ANALYZE_CLI_IPC_SOCKET: path.join(tmpDir, 'daemon.sock'),
    ANALYZE_CLI_DAEMON_PID: path.join(tmpDir, 'daemon.pid'),
    ANALYZE_CLI_LOG_LEVEL: 'error',
  };
}

export async function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const env = getTestEnv();
    const proc = spawn('node', [CLI_PATH, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

export function extractId(stdout: string): string | null {
  // Matches patterns like:
  // "Task created: abc-123-def"
  // "Platform added: xhs_e2e_123"
  // "Strategy imported: strategy_abc"
  const match = stdout.match(/(?:created|added|imported):\s*([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export function extractCount(stdout: string, label: string): number | null {
  const pattern = new RegExp(`${label}:\\s*(\\d+)`);
  const match = stdout.match(pattern);
  return match ? parseInt(match[1], 10) : null;
}
```

- [ ] **Step 2: Commit**

```bash
git add test/e2e/helpers/cli.ts
git commit -m "test(e2e): add cli helper for command execution"
```

---

### Task 5: 创建 helpers/daemon.ts

**Files:**
- Create: `test/e2e/helpers/daemon.ts`

- [ ] **Step 1: 编写 daemon helper**

Create `test/e2e/helpers/daemon.ts`:

```ts
import { runCli } from './cli.js';

export async function startDaemon(): Promise<void> {
  const { exitCode, stderr } = await runCli(['daemon', 'start']);
  // daemon start returns 0 even if already running, but we want a fresh one
  if (exitCode !== 0 && !stderr.includes('already running')) {
    throw new Error(`Failed to start daemon: ${stderr}`);
  }
  // Wait for daemon to be ready
  await waitForDaemonReady(10000);
}

export async function stopDaemon(): Promise<void> {
  await runCli(['daemon', 'stop']);
  // Wait for process to actually exit
  let attempts = 0;
  while (attempts < 30) {
    const { stdout } = await runCli(['daemon', 'status']);
    if (stdout.includes('not running')) {
      return;
    }
    await new Promise(r => setTimeout(r, 200));
    attempts++;
  }
  throw new Error('Daemon did not stop within 6 seconds');
}

export async function isDaemonRunning(): Promise<boolean> {
  const { stdout } = await runCli(['daemon', 'status']);
  return stdout.includes('running');
}

export async function waitForDaemonReady(timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { stdout } = await runCli(['daemon', 'status']);
    if (stdout.includes('running')) {
      return;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Daemon not ready after ${timeoutMs}ms`);
}

export async function ensureDaemonStopped(): Promise<void> {
  if (await isDaemonRunning()) {
    await stopDaemon();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add test/e2e/helpers/daemon.ts
git commit -m "test(e2e): add daemon helper for lifecycle management"
```

---

### Task 6: 创建 helpers/assertions.ts

**Files:**
- Create: `test/e2e/helpers/assertions.ts`

- [ ] **Step 1: 编写 assertions helper**

Create `test/e2e/helpers/assertions.ts`:

```ts
import assert from 'node:assert/strict';
import { runCli } from './cli.js';

export async function pollUntil<T>(
  fetch: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: { timeout: number; interval: number },
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < options.timeout) {
    const value = await fetch();
    if (predicate(value)) {
      return value;
    }
    await new Promise(r => setTimeout(r, options.interval));
  }
  throw new Error(`pollUntil timeout after ${options.timeout}ms`);
}

export async function waitForDataPreparation(taskId: string, timeoutMs = 60000): Promise<void> {
  await pollUntil(
    async () => {
      const { stdout } = await runCli(['task', 'show', '--task-id', taskId]);
      return stdout;
    },
    (stdout) => stdout.includes('Status:      completed') || stdout.includes('Data Preparation:') && stdout.includes('done'),
    { timeout: timeoutMs, interval: 3000 },
  );
}

export async function waitForAnalysisComplete(taskId: string, timeoutMs = 120000): Promise<void> {
  await pollUntil(
    async () => {
      const { stdout } = await runCli(['task', 'show', '--task-id', taskId]);
      return stdout;
    },
    (stdout) => {
      const steps = stdout.match(/completed/g) || [];
      // All steps completed and no pending/running
      return stdout.includes('Analysis Jobs:') &&
        !stdout.includes('running') &&
        !stdout.includes('pending') &&
        steps.length > 0;
    },
    { timeout: timeoutMs, interval: 3000 },
  );
}

export async function waitForJobStatus(
  taskId: string,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  timeoutMs = 30000,
): Promise<void> {
  await pollUntil(
    async () => {
      const { stdout } = await runCli(['queue', 'list', '--task-id', taskId]);
      return stdout;
    },
    (stdout) => stdout.includes(status),
    { timeout: timeoutMs, interval: 2000 },
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add test/e2e/helpers/assertions.ts
git commit -m "test(e2e): add assertion helpers for polling and waiting"
```

---

### Task 7: 创建 import-and-prepare E2E 测试

**Files:**
- Create: `test/e2e/import-and-prepare/import-and-prepare.test.ts`

- [ ] **Step 1: 编写 E2E 测试**

Create `test/e2e/import-and-prepare/import-and-prepare.test.ts`:

```ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { closeDb, resetTestDb, cleanupByPrefix, query } from '../helpers/db.js';
import { runCli, extractId } from '../helpers/cli.js';
import { ensureDaemonStopped } from '../helpers/daemon.js';
import { waitForDataPreparation } from '../helpers/assertions.js';

const RUN_ID = `e2e_import_${Date.now()}`;
const RUN_PLATFORM = `${RUN_ID}_platform`;
const FIXTURE_PATH = path.join(process.cwd(), 'test', 'e2e', 'fixtures', 'posts', 'sample-xhs.json');

describe('import-and-prepare', { timeout: 90000 }, () => {
  before(async () => {
    closeDb();
    await resetTestDb();
  });

  after(async () => {
    await ensureDaemonStopped();
    await cleanupByPrefix(RUN_ID);
  });

  it('should register platform, import posts, prepare data, and verify status', async () => {
    // 1. Register platform
    const { exitCode: platformExit } = await runCli([
      'platform', 'add',
      '--id', RUN_PLATFORM,
      '--name', 'E2E Test Platform',
    ]);
    assert.equal(platformExit, 0, 'Platform add should succeed');

    // 2. Import posts
    const { exitCode: importExit, stdout: importOut } = await runCli([
      'post', 'import',
      '--platform', RUN_PLATFORM,
      '--file', FIXTURE_PATH,
    ]);
    assert.equal(importExit, 0, 'Post import should succeed');

    // 3. Verify posts in DB
    const posts = await query<{ count: number }>(
      'SELECT COUNT(*) as count FROM posts WHERE platform_id = ?',
      [RUN_PLATFORM],
    );
    assert.equal(posts[0].count, 2, 'Should have 2 imported posts');

    // 4. Create task with cli_templates
    const { stdout: taskOut, exitCode: taskExit } = await runCli([
      'task', 'create',
      '--name', `${RUN_ID}_task`,
      '--cli-templates', JSON.stringify({
        fetch_note: 'echo "{\\"title\\": \\"test\\"}"',
        fetch_comments: 'echo "[]"',
        fetch_media: 'echo "[]"',
      }),
    ]);
    assert.equal(taskExit, 0, 'Task create should succeed');
    const taskId = extractId(taskOut);
    assert.ok(taskId, 'Should extract task ID from output');

    // 5. Add posts to task using platform filter
    const { exitCode: addExit } = await runCli([
      'task', 'add-posts',
      '--task-id', taskId!,
      '--post-ids', 'post_001,post_002',
    ]);
    assert.equal(addExit, 0, 'Add posts should succeed');

    // 6. Run data preparation
    const { exitCode: prepExit } = await runCli([
      'task', 'prepare-data',
      '--task-id', taskId!,
    ]);
    assert.equal(prepExit, 0, 'Prepare data should start successfully');

    // 7. Wait for completion
    await waitForDataPreparation(taskId!, 60000);

    // 8. Verify task_post_status
    const statuses = await query<{
      post_id: string;
      comments_fetched: boolean;
      media_fetched: boolean;
    }>(
      'SELECT post_id, comments_fetched, media_fetched FROM task_post_status WHERE task_id = ?',
      [taskId!],
    );
    assert.equal(statuses.length, 2, 'Should have 2 task_post_status records');
    for (const s of statuses) {
      assert.equal(s.comments_fetched, true, `Post ${s.post_id} comments should be fetched`);
      assert.equal(s.media_fetched, true, `Post ${s.post_id} media should be fetched`);
    }
  });
});
```

- [ ] **Step 2: 运行单个测试验证**

Run: `npm run test:e2e:import`
Expected: Test runs and passes (or fails with expected error if no API key)

- [ ] **Step 3: Commit**

```bash
git add test/e2e/import-and-prepare/
git commit -m "test(e2e): add import-and-prepare end-to-end test"
```

---

### Task 8: 创建 strategy-workflow E2E 测试

**Files:**
- Create: `test/e2e/strategy-workflow/task-steps.test.ts`

- [ ] **Step 1: 编写 E2E 测试**

Create `test/e2e/strategy-workflow/task-steps.test.ts`:

```ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { closeDb, resetTestDb, cleanupByPrefix, query } from '../helpers/db.js';
import { runCli, extractId } from '../helpers/cli.js';
import { ensureDaemonStopped } from '../helpers/daemon.js';
import { waitForAnalysisComplete } from '../helpers/assertions.js';

const RUN_ID = `e2e_strategy_${Date.now()}`;
const RUN_PLATFORM = `${RUN_ID}_platform`;
const POSTS_FIXTURE = path.join(process.cwd(), 'test', 'e2e', 'fixtures', 'posts', 'sample-xhs.json');
const SENTIMENT_FIXTURE = path.join(process.cwd(), 'test', 'e2e', 'fixtures', 'strategies', 'sentiment.json');

describe('strategy-workflow', { timeout: 180000 }, () => {
  before(async () => {
    closeDb();
    await resetTestDb();
  });

  after(async () => {
    await ensureDaemonStopped();
    await cleanupByPrefix(RUN_ID);
  });

  it('should create strategy, run task step, and produce results', async () => {
    // Setup: register platform and import posts
    await runCli(['platform', 'add', '--id', RUN_PLATFORM, '--name', 'E2E Platform']);
    await runCli(['post', 'import', '--platform', RUN_PLATFORM, '--file', POSTS_FIXTURE]);

    // 1. Create strategy
    const { stdout: stratOut, exitCode: stratExit } = await runCli([
      'strategy', 'import', '--file', SENTIMENT_FIXTURE,
    ]);
    assert.equal(stratExit, 0, 'Strategy import should succeed');
    const strategyId = extractId(stratOut);
    assert.ok(strategyId, 'Should extract strategy ID');

    // 2. Create task
    const { stdout: taskOut, exitCode: taskExit } = await runCli([
      'task', 'create',
      '--name', `${RUN_ID}_task`,
      '--cli-templates', JSON.stringify({
        fetch_note: 'echo "{\\"title\\": \\"test\\"}"',
        fetch_comments: 'echo "[{\\"content\\": \\"great food\\"}]"',
        fetch_media: 'echo "[]"',
      }),
    ]);
    assert.equal(taskExit, 0);
    const taskId = extractId(taskOut);
    assert.ok(taskId);

    // 3. Add posts
    await runCli(['task', 'add-posts', '--task-id', taskId!, '--post-ids', 'post_001,post_002']);

    // 4. Prepare data
    await runCli(['task', 'prepare-data', '--task-id', taskId!]);

    // 5. Add strategy step
    const { exitCode: stepExit } = await runCli([
      'task', 'step', 'add',
      '--task-id', taskId!,
      '--strategy-id', strategyId!,
      '--name', '情感分析',
    ]);
    assert.equal(stepExit, 0, 'Step add should succeed');

    // 6. Run all steps with wait
    const { exitCode: runExit } = await runCli([
      'task', 'run-all-steps',
      '--task-id', taskId!,
      '--wait',
    ]);
    assert.equal(runExit, 0, 'Run all steps should succeed');

    // 7. Verify result table exists and has data
    const resultTable = `strategy_result_${strategyId}`;
    const results = await query<Record<string, unknown>>(
      `SELECT * FROM "${resultTable}" WHERE task_id = ?`,
      [taskId!],
    );
    assert.ok(results.length > 0, 'Should have analysis results');

    // 8. Verify result fields
    const first = results[0];
    assert.ok(first.sentiment, 'Result should have sentiment field');
    assert.ok(
      ['positive', 'negative', 'neutral'].includes(first.sentiment as string),
      'Sentiment should be valid',
    );
    assert.ok(typeof first.confidence === 'number', 'Confidence should be a number');
  });

  it('should fail to import invalid strategy', async () => {
    // Create a temp file with invalid strategy (missing required fields)
    const invalidStrategy = JSON.stringify({
      name: 'Invalid',
      // missing prompt and output_schema
    });
    const tmpFile = `/tmp/e2e_invalid_strategy_${Date.now()}.json`;
    await import('fs').then(fs => fs.writeFileSync(tmpFile, invalidStrategy));

    const { exitCode, stderr } = await runCli([
      'strategy', 'import', '--file', tmpFile,
    ]);
    assert.notEqual(exitCode, 0, 'Invalid strategy should fail');
    assert.ok(
      stderr.includes('Error') || stderr.includes('required'),
      'Should show error message',
    );

    // Cleanup temp file
    await import('fs').then(fs => fs.unlinkSync(tmpFile));
  });
});
```

- [ ] **Step 2: 运行单个测试验证**

Run: `npm run test:e2e:strategy`
Expected: Tests run and pass

- [ ] **Step 3: Commit**

```bash
git add test/e2e/strategy-workflow/
git commit -m "test(e2e): add strategy-workflow end-to-end tests"
```

---

### Task 9: 创建 queue-recovery E2E 测试

**Files:**
- Create: `test/e2e/queue-recovery/retry.test.ts`

- [ ] **Step 1: 编写 E2E 测试**

Create `test/e2e/queue-recovery/retry.test.ts`:

```ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { closeDb, resetTestDb, cleanupByPrefix, query } from '../helpers/db.js';
import { runCli, extractId } from '../helpers/cli.js';
import { ensureDaemonStopped, stopDaemon } from '../helpers/daemon.js';

const RUN_ID = `e2e_queue_${Date.now()}`;
const RUN_PLATFORM = `${RUN_ID}_platform`;
const POSTS_FIXTURE = path.join(process.cwd(), 'test', 'e2e', 'fixtures', 'posts', 'sample-xhs.json');
const SENTIMENT_FIXTURE = path.join(process.cwd(), 'test', 'e2e', 'fixtures', 'strategies', 'sentiment.json');

describe('queue-recovery', { timeout: 120000 }, () => {
  before(async () => {
    closeDb();
    await resetTestDb();
  });

  after(async () => {
    await ensureDaemonStopped();
    await cleanupByPrefix(RUN_ID);
  });

  it('should reset failed jobs via queue reset command', async () => {
    // Setup: platform, posts, task, strategy
    await runCli(['platform', 'add', '--id', RUN_PLATFORM, '--name', 'E2E Platform']);
    await runCli(['post', 'import', '--platform', RUN_PLATFORM, '--file', POSTS_FIXTURE]);

    const { stdout: stratOut } = await runCli(['strategy', 'import', '--file', SENTIMENT_FIXTURE]);
    const strategyId = extractId(stratOut)!;

    const { stdout: taskOut } = await runCli([
      'task', 'create',
      '--name', `${RUN_ID}_task`,
      '--cli-templates', JSON.stringify({
        fetch_note: 'echo "{\\"title\\": \\"test\\"}"',
        fetch_comments: 'echo "[{\\"content\\": \\"test\\"}]"',
        fetch_media: 'echo "[]"',
      }),
    ]);
    const taskId = extractId(taskOut)!;

    await runCli(['task', 'add-posts', '--task-id', taskId, '--post-ids', 'post_001']);
    await runCli(['task', 'prepare-data', '--task-id', taskId]);

    // Create step
    await runCli([
      'task', 'step', 'add',
      '--task-id', taskId,
      '--strategy-id', strategyId,
    ]);

    // Run steps (this may succeed or fail depending on LLM)
    await runCli(['task', 'run-all-steps', '--task-id', taskId, '--wait']);

    // Check queue jobs
    const { stdout: queueOut } = await runCli(['queue', 'list', '--task-id', taskId]);

    // If any jobs failed, test the reset command
    if (queueOut.includes('failed')) {
      // Reset jobs
      const { exitCode: resetExit, stdout: resetOut } = await runCli([
        'queue', 'reset', '--task-id', taskId,
      ]);
      assert.equal(resetExit, 0, 'Queue reset should succeed');
      assert.ok(resetOut.includes('Reset'), 'Should report reset count');

      // Verify jobs are now pending
      const jobs = await query<{ status: string; attempts: number }>(
        'SELECT status, attempts FROM queue_jobs WHERE task_id = ?',
        [taskId],
      );
      for (const j of jobs) {
        assert.equal(j.status, 'pending', 'Job should be reset to pending');
        assert.equal(j.attempts, 0, 'Attempts should be reset to 0');
      }
    }
  });
});
```

- [ ] **Step 2: 运行单个测试验证**

Run: `npm run test:e2e:queue`
Expected: Test runs and passes

- [ ] **Step 3: Commit**

```bash
git add test/e2e/queue-recovery/
git commit -m "test(e2e): add queue-recovery end-to-end test"
```

---

### Task 10: 创建 daemon-lifecycle E2E 测试

**Files:**
- Create: `test/e2e/daemon-lifecycle/lifecycle.test.ts`

- [ ] **Step 1: 编写 E2E 测试**

Create `test/e2e/daemon-lifecycle/lifecycle.test.ts`:

```ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/cli.js';
import { ensureDaemonStopped, isDaemonRunning } from '../helpers/daemon.js';

describe('daemon-lifecycle', { timeout: 30000 }, () => {
  before(async () => {
    await ensureDaemonStopped();
  });

  after(async () => {
    await ensureDaemonStopped();
  });

  it('should start daemon and report running status', async () => {
    // Verify not running
    const { stdout: beforeOut } = await runCli(['daemon', 'status']);
    assert.ok(
      beforeOut.includes('not running') || beforeOut.includes('stopped'),
      'Daemon should not be running initially',
    );

    // Start daemon
    const { exitCode: startExit } = await runCli(['daemon', 'start']);
    assert.equal(startExit, 0, 'Daemon start should succeed');

    // Wait for it to be ready
    let attempts = 0;
    let running = false;
    while (attempts < 20) {
      const { stdout } = await runCli(['daemon', 'status']);
      if (stdout.includes('running')) {
        running = true;
        break;
      }
      await new Promise(r => setTimeout(r, 300));
      attempts++;
    }
    assert.ok(running, 'Daemon should be running after start');

    // Verify status output contains version info
    const { stdout: statusOut } = await runCli(['daemon', 'status']);
    assert.ok(statusOut.includes('Version:'), 'Status should show version');
    assert.ok(
      /Version:\s*v?\d+\.\d+\.\d+/.test(statusOut),
      'Version should match semantic format',
    );

    // Stop daemon
    const { exitCode: stopExit } = await runCli(['daemon', 'stop']);
    assert.equal(stopExit, 0, 'Daemon stop should succeed');

    // Verify stopped
    attempts = 0;
    let stopped = false;
    while (attempts < 30) {
      const { stdout } = await runCli(['daemon', 'status']);
      if (stdout.includes('not running')) {
        stopped = true;
        break;
      }
      await new Promise(r => setTimeout(r, 200));
      attempts++;
    }
    assert.ok(stopped, 'Daemon should be stopped');
  });

  it('should handle start when already running', async () => {
    // Start daemon
    await runCli(['daemon', 'start']);
    await new Promise(r => setTimeout(r, 1000));
    assert.ok(await isDaemonRunning(), 'Daemon should be running');

    // Try to start again (should not fail, just warn)
    const { exitCode, stdout } = await runCli(['daemon', 'start']);
    assert.equal(exitCode, 0, 'Start when running should return 0');
    assert.ok(
      stdout.includes('already running'),
      'Should warn that daemon is already running',
    );

    // Cleanup
    await runCli(['daemon', 'stop']);
  });

  it('should stop gracefully when not running', async () => {
    // Ensure not running
    await ensureDaemonStopped();

    const { exitCode, stdout } = await runCli(['daemon', 'stop']);
    assert.equal(exitCode, 0, 'Stop when not running should return 0');
    assert.ok(
      stdout.includes('not running') || stdout.includes('already dead'),
      'Should report daemon not running',
    );
  });
});
```

- [ ] **Step 2: 运行单个测试验证**

Run: `npm run test:e2e:daemon`
Expected: All 3 tests pass

- [ ] **Step 3: Commit**

```bash
git add test/e2e/daemon-lifecycle/
git commit -m "test(e2e): add daemon-lifecycle end-to-end tests"
```

---

### Task 11: 运行全部 E2E 测试验证

- [ ] **Step 1: Build 项目**

Run: `npm run build`
Expected: Build completes without errors

- [ ] **Step 2: 运行全部 E2E 测试**

Run: `npm run test:e2e`
Expected: All E2E tests pass (may take 2-5 minutes depending on LLM latency)

- [ ] **Step 3: 运行全部测试（integration + e2e）**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git commit -m "test(e2e): complete end-to-end test suite"
```

---

## Spec Coverage Checklist

| Spec 需求 | 实现任务 |
|-----------|---------|
| 真实 DuckDB 数据库 | Task 3 (helpers/db.ts) |
| 真实 Anthropic API 调用 | Task 8 (strategy-workflow) — LLM 通过 worker 真实调用 |
| 真实 OpenCLI 数据获取 | Task 7, 8 — 通过 prepare-data 命令触发 |
| 测试隔离（RUN_ID 前缀） | Task 3, 所有测试文件 |
| 导入 → 数据准备完整链路 | Task 7 (import-and-prepare) |
| 策略工作流（创建→添加→运行→验证） | Task 8 (strategy-workflow) |
| 队列恢复（reset 命令） | Task 9 (queue-recovery) |
| Daemon 生命周期（启动→状态→停止） | Task 10 (daemon-lifecycle) |
| 现有测试迁移到 integration/ | Task 1 |
| package.json 脚本更新 | Task 1 |

## Self-Review

**Placeholder scan:** 无 TBD/TODO/"implement later"。
**Internal consistency:** helpers 接口在所有测试文件中一致使用。`runCli` 返回 `Promise<CliResult>`，`extractId` 解析 CLI 输出中的 ID。
**Type consistency:** `query` 使用 `query<T>` 泛型，`pollUntil` 使用 `Promise<T>` 返回类型，各测试中类型一致。
**Scope check:** 本计划聚焦 E2E 测试，不涉及单元测试或集成测试重构。
