# E2E 测试套件设计文档

## 背景与目标

`scopai` 目前已有 11 个集成测试文件（约 3000 行），覆盖数据导入、策略系统、队列任务等模块，但缺少覆盖完整用户工作流的端到端测试。本设计旨在建立一套真实链路的 E2E 测试，验证从 CLI 命令 → 数据库 → Daemon → Worker → LLM 的完整链路。

## 设计原则

- **真实链路优先**：数据库用真实 DuckDB，LLM 走真实 Anthropic API，数据获取走真实 OpenCLI
- **完全隔离**：每个测试用例使用独立 `RUN_ID`，数据库记录全部带前缀，互不干扰
- **确定性断言**：LLM 返回使用宽松匹配（字段存在、类型正确），避免精确字符串比较
- **合理超时**：数据准备 60s，策略分析 120s，daemon 操作 30s

## 目录结构

```
test/
├── e2e/                          # 新增：端到端测试
│   ├── fixtures/
│   │   ├── posts/                # 预设帖子 JSON
│   │   ├── strategies/           # 预设策略 JSON
│   │   └── llm-responses/        # (可选) 录制响应
│   ├── helpers/
│   │   ├── db.ts                 # 数据库隔离 + cleanup
│   │   ├── cli.ts                # CLI 命令执行封装
│   │   ├── daemon.ts             # daemon 生命周期管理
│   │   └── assertions.ts         # 常用断言
│   ├── import-and-prepare/       # 导入 → 数据准备 E2E
│   ├── strategy-workflow/        # 策略 + 任务步骤 E2E
│   ├── queue-recovery/           # 队列重试恢复 E2E
│   └── daemon-lifecycle/         # daemon 生命周期 E2E
├── integration/                  # 现有测试迁移到此
│   ├── comment-analysis.test.ts
│   ├── import-offline.test.ts
│   ├── import-recorded-xhs.test.ts
│   ├── opencli.test.ts
│   ├── prepare-data-offline.test.ts
│   ├── prepare-data.test.ts
│   ├── queue-jobs.test.ts
│   ├── stream-scheduler.test.ts
│   ├── strategy-system.test.ts
│   ├── task-post-status.test.ts
│   └── xhs-shanghai-food.test.ts
└── unit/                         # (未来) 单元测试
```

## 测试隔离策略

每个 E2E 测试文件遵循以下模式：

```ts
const RUN_ID = `e2e_${Date.now()}_${suiteName}`;
const RUN_PLATFORM = `${RUN_ID}_platform`;
const RUN_TASK = `${RUN_ID}_task`;

describe('suite', { timeout: 120000 }, () => {
  before(async () => {
    closeDb();
    await runMigrations();
    await seedAll();
  });

  after(async () => {
    // 清理所有带 RUN_ID 前缀的数据
    await cleanupByPrefix(RUN_ID);
    await stopDaemonIfRunning();
  });
});
```

## Helpers 设计

### `helpers/db.ts`

```ts
export async function cleanupDb(): Promise<void>
export async function seedDb(): Promise<void>
export async function queryDb(sql: string, params?: unknown[]): Promise<unknown[]>
export async function cleanupByPrefix(prefix: string): Promise<void>
```

### `helpers/cli.ts`

```ts
export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function runCli(args: string[], options?: { env?: Record<string, string> }): Promise<CliResult>
export function extractId(stdout: string): string  // 从 CLI 输出提取 ID
```

环境变量自动注入：
- `TEST_DB_PATH` — 指向临时测试数据库
- `ANALYZE_CLI_HOME` — 指向临时配置目录

### `helpers/daemon.ts`

```ts
export interface DaemonProcess {
  pid: number;
  kill(signal?: string): Promise<void>;
}

export async function startDaemon(): Promise<DaemonProcess>
export async function stopDaemon(): Promise<void>
export async function isDaemonRunning(): Promise<boolean>
export async function waitForJobStatus(
  taskId: string,
  status: string,
  options?: { timeout?: number; interval?: number }
): Promise<void>
```

### `helpers/assertions.ts`

```ts
export async function pollUntil<T>(
  fetch: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: { timeout: number; interval: number }
): Promise<T>

export async function ensureDataPrepared(taskId: string): Promise<void>
export async function setupTaskWithStrategy(): Promise<{ taskId: string; strategyId: string }>
```

## E2E 模块设计

### import-and-prepare

验证链路：注册平台 → 导入帖子 → 数据准备 → 验证 `task_post_status`

**用例 1：基本导入 + 数据准备**
1. `platform add` 注册平台
2. `post import` 导入帖子
3. `task create` 创建任务
4. `task add-posts` 添加帖子到任务
5. `task prepare-data` 执行数据准备
6. 轮询等待 `dataPreparation: done`
7. 断言 `task_post_status` 中 `comments_fetched=true`, `media_fetched=true`
8. 断言 `comments` 和 `media_files` 表有数据

**用例 2：部分失败恢复**
- 模拟 `fetch_comments` 成功但 `fetch_media` 失败（通过 fixture 控制）
- 验证 `task_post_status` 部分状态
- 重新运行 `prepare-data` 后验证最终完成

### strategy-workflow

验证链路：创建策略 → 创建任务 → 添加步骤 → 运行 → 验证结果

**用例 1：单策略单步骤完整流程**
1. `strategy import` 创建策略（使用 fixtures/strategies/sentiment.json）
2. `task create` 创建任务
3. `task add-posts` 添加帖子
4. 确保数据准备完成
5. `task step add` 添加策略步骤
6. `task run-all-steps` 运行
7. 轮询等待 `analysis: done`
8. 断言 `strategy_result_{strategy_id}` 表有数据，字段类型正确
9. `task export-results` 验证 CLI 输出包含结果

**用例 2：多步骤顺序执行**
- 步骤 1：情感分析（`needs_media: false`）
- 步骤 2：图片内容分析（`needs_media: true`）
- 验证步骤 2 等待媒体下载，两个结果表都有数据

**用例 3：策略验证失败**
- 导入无效策略 JSON（缺少必填字段）
- 验证 CLI 非零退出码 + 错误信息

### queue-recovery

验证 worker 异常中断后的重试行为，以及 CLI 重置命令。

**用例 1：worker 中断后自动重试**
1. 创建任务 + 添加步骤
2. 启动 daemon + worker
3. 运行步骤触发 `queue_jobs`
4. 在 worker 处理中途 kill daemon
5. 验证 `queue_jobs` 状态为 `processing`（stalled），`attempts=1`
6. 重新启动 daemon + worker
7. 验证 stalled job 被回收，`attempts > 1` 或状态变为 `done`
8. 验证结果表有数据

**用例 2：queue CLI 重置失败任务**
1. 用无效策略触发 LLM 解析失败
2. 验证 `queue_jobs` 状态为 `failed`
3. `queue reset --task-id` 重置
4. 验证状态变为 `pending`，`attempts=0`

### daemon-lifecycle

验证 daemon 的启动、停止、状态查询、版本检查。

**用例 1：启动 → 状态查询 → 停止**
1. 确认 daemon 未运行
2. `daemon start` 启动
3. `daemon status` 验证包含 `running` 和 `version`
4. `daemon stop` 停止
5. `daemon status` 验证 `not running`

**用例 2：重复启动报错**
1. 启动 daemon
2. 再次 `daemon start`
3. 验证非零退出码 + `already running`
4. 清理停止

**用例 3：版本信息包含在状态输出中**
1. 启动 daemon
2. `daemon status` 输出匹配 `/version:\s*v?\d+\.\d+\.\d+/`
3. 停止

## Fixtures

### `fixtures/posts/sample-xhs.json`

```json
{
  "platform": "xhs_e2e",
  "posts": [
    {
      "id": "post_001",
      "title": "上海美食探店",
      "content": "今天去了一家超棒的餐厅...",
      "author": "foodie_01",
      "url": "https://www.xiaohongshu.com/discovery/item/post_001"
    }
  ]
}
```

### `fixtures/strategies/sentiment.json`

```json
{
  "name": "情感分析",
  "description": "分析评论情感倾向",
  "prompt": "分析以下评论的情感倾向（积极/消极/中性），返回 JSON：{ \"sentiment\": string, \"confidence\": number }",
  "output_schema": {
    "sentiment": "VARCHAR",
    "confidence": "DOUBLE"
  },
  "needs_media": false
}
```

### `fixtures/strategies/media-analysis.json`

```json
{
  "name": "图片内容分析",
  "description": "分析帖子图片内容",
  "prompt": "分析以下帖子的图片内容，返回 JSON：{ \"main_subject\": string, \"visual_quality\": string }",
  "output_schema": {
    "main_subject": "VARCHAR",
    "visual_quality": "VARCHAR"
  },
  "needs_media": true
}
```

## package.json 脚本更新

```json
{
  "test": "node --test --test-concurrency=1 --experimental-strip-types 'test/**/*.test.ts'",
  "test:integration": "node --test --test-concurrency=1 --experimental-strip-types 'test/integration/*.test.ts'",
  "test:e2e": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/**/*.test.ts'",
  "test:e2e:import": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/import-and-prepare/*.test.ts'",
  "test:e2e:strategy": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/strategy-workflow/*.test.ts'",
  "test:e2e:queue": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/queue-recovery/*.test.ts'",
  "test:e2e:daemon": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/daemon-lifecycle/*.test.ts'"
}
```

## 执行顺序

1. **先迁移现有测试**：将 `test/*.test.ts` 移动到 `test/integration/`
2. **构建 helpers**：`db.ts` → `cli.ts` → `daemon.ts` → `assertions.ts`
3. **逐个模块实现**：`import-and-prepare` → `strategy-workflow` → `queue-recovery` → `daemon-lifecycle`
4. **验证全部通过**：`npm run test:e2e`
5. **更新 CI**：确保 E2E 测试在 CI 中运行（跳过需要真实 API key 的场景时使用 `--test-skip`）
