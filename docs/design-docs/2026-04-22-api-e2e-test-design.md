# API E2E 测试模块设计

## 目标

为 `packages/api` 添加完整的端到端测试，启动真实 Fastify 服务器 + DuckDB，用 HTTP 请求覆盖所有路由。

## 架构

- **测试框架**: Node 内置 `node:test` + `node:assert`（strict mode），零额外依赖
- **运行方式**: `node --test --experimental-strip-types 'test/e2e/*.test.ts'`
- **服务器生命周期**: 每个测试套件启动真实 Fastify 服务器（随机端口）+ 临时 DuckDB 文件，套件结束后关闭并清理
- **测试间共享 DB**: 同一文件内的测试共享 DB 实例（避免反复创建 DuckDB 文件导致过慢）

## 目录结构

```
packages/api/
  test/
    e2e/
      helpers.ts          # startServer / stopServer / fetchApi
      health.test.ts      # GET /health
      status.test.ts      # GET /api/status
      platforms.test.ts    # GET /api/platforms
      posts.test.ts       # GET/POST /api/posts 及子路由
      strategies.test.ts  # GET/POST/DELETE /api/strategies
      tasks.test.ts       # /api/tasks 全部路由
      queue.test.ts       # /api/queue 及操作路由
```

## 服务器启动流程

1. 创建临时目录，设置 `ANALYZE_CLI_DB_PATH` 指向临时 DB 文件
2. 加载 core 配置，执行 `migrate()` + `seedPlatforms()`
3. 构建 Fastify app（复用 `packages/api/src/index.ts` 中的 `buildApp` 逻辑），监听 `port: 0`
4. 返回 `{ port, cleanup }` 供测试使用

## helpers.ts API

```typescript
interface TestContext {
  port: number;
  cleanup: () => Promise<void>;
}

function startServer(): Promise<TestContext>
function stopServer(ctx: TestContext): Promise<void>
function fetchApi(port: number, path: string, options?: RequestInit): Promise<Response>
```

## 测试覆盖

### health.test.ts
- `GET /health` → 200, `{ ok: true }`

### status.test.ts
- `GET /api/status` → 200, 包含 `pid`, `db_path`, `queue_stats`, `uptime`

### platforms.test.ts
- `GET /api/platforms` → 200, 返回种子平台列表（11 条）

### posts.test.ts
- `GET /api/posts` → 200, 空列表
- `POST /api/posts/import` → 批量导入帖子
- `GET /api/posts/:id/comments` → 获取帖子评论
- 分页参数测试

### strategies.test.ts
- `GET /api/strategies` → 200, 空列表
- `POST /api/strategies` → 创建策略
- `POST /api/strategies/import` → 批量导入
- `DELETE /api/strategies/:id` → 删除策略
- 404 测试（删除不存在的策略）

### tasks.test.ts
- `GET /api/tasks` → 200
- `POST /api/tasks` → 创建任务
- `GET /api/tasks/:id` → 获取任务详情
- `POST /api/tasks/:id/prepare-data` → 准备数据
- `POST /api/tasks/:id/add-posts` → 添加帖子
- `POST /api/tasks/:id/add-comments` → 添加评论
- `POST /api/tasks/:id/resume` → 恢复任务
- `POST /api/tasks/:id/steps` → 创建步骤
- `POST /api/tasks/:id/steps/:stepId/run` → 运行步骤
- `POST /api/tasks/:id/run-all-steps` → 运行所有步骤
- `GET /api/tasks/:id/results` → 获取分析结果
- 404 测试（获取不存在的任务）

### queue.test.ts
- `GET /api/queue` → 200, 队列统计
- `POST /api/queue/retry` → 重试失败任务
- `POST /api/queue/reset` → 重置队列

## npm script

```json
{
  "scripts": {
    "test:e2e": "node --test --experimental-strip-types 'test/e2e/*.test.ts'"
  }
}
```

## 设计决策

- **真实服务器而非 inject()**: 能发现网络层、路由注册、CORS 等集成问题
- **共享 DB 而非每测试隔离**: DuckDB 文件创建开销大，共享 + 测试顺序执行更实际
- **Node 内置 test runner**: 与项目现有 e2e 测试一致，零依赖
- **不测试 worker/scheduler**: e2e 聚焦 API 路由正确性，worker 逻辑由单元测试覆盖
