# 动态策略路由实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现动态路由分析策略，让系统按内容特征决定哪些下游策略参与分析。

**Architecture:** Router 是特殊 Strategy（`is_router: true`），复用现有策略导入、结果存储、Worker 执行链路。数据准备完成后，Worker 对每个 Post 执行 Router，缓存结果，然后 Scheduler 按路由结果选择性生成分析 Job。

**Tech Stack:** TypeScript, Node.js 20+, DuckDB, Fastify, React 19 + Vite, pnpm monorepo

---

## 文件结构映射

### 新建文件

| 文件 | 职责 |
|------|------|
| `packages/core/src/db/router-results.ts` | Router 结果 CRUD（insert/get/exists/list） |
| `packages/core/src/strategies/built-in/content-strategy-router.json` | Router 策略定义（prompt + output_schema） |
| `packages/ui/src/components/StrategyStats.tsx` | 策略覆盖统计表格组件 |

### 修改文件

| 文件 | 职责 |
|------|------|
| `packages/core/src/db/schema.sql` | strategies 表加 `is_router`/`routing`，新建 `router_results` 表 |
| `packages/core/src/db/migrate.ts` | 添加 migration 函数 |
| `packages/core/src/shared/types.ts` | Strategy 类型扩展 `is_router`/`routing` |
| `packages/core/src/db/strategies.ts` | CRUD 支持新字段，validateStrategyJson 扩展 |
| `packages/core/src/strategies/seed-built-in.ts` | 支持 `is_router`/`routing` 字段的种子导入 |
| `packages/core/src/index.ts` | 导出 router-results 模块 |
| `packages/core/src/strategies/built-in/*.json` | 4 个内置策略添加 `routing` 字段 |
| `packages/api/src/worker/consumer.ts` | 新增 `processRouterJob`，prepare 完成后触发路由 |
| `packages/api/src/worker/anthropic.ts` | 新增 `analyzeRouter`（无 media 的轻量 LLM 调用） |
| `packages/api/src/daemon/scheduler.ts` | `buildJobsForPost` 支持 `routerResults` 过滤 |
| `packages/api/src/daemon/task-helpers.ts` | `enqueueStepJobs` 支持路由上下文 |
| `packages/api/src/routes/tasks.ts` | POST /tasks 支持 router，GET /tasks/:id 扩展，新增 /routing |
| `packages/ui/src/components/PipelineMatrix.tsx` | 条件渲染：3 列（路由模式）或 N+1 列（传统模式） |
| `packages/ui/src/components/TaskTimeline.tsx` | 条件渲染：3 阶段或 N 阶段 |
| `packages/ui/src/pages/TaskDetail.tsx` | 布局重组，条件渲染 StrategyStats |
| `packages/cli/src/analyze.ts` | 新增 `--auto-route` 选项 |

---

## Task 1: Schema Migration

**Files:**
- Modify: `packages/core/src/db/schema.sql`
- Modify: `packages/core/src/db/migrate.ts`
- Test: `pnpm build` passes

- [ ] **Step 1: 修改 schema.sql — strategies 表加字段**

在 `packages/core/src/db/schema.sql` 的 `strategies` 表定义中，在 `file_path` 列之后添加：

```sql
    is_router       BOOLEAN DEFAULT FALSE,
    routing         JSON,
```

- [ ] **Step 2: 修改 schema.sql — 新建 router_results 表**

在 schema.sql 末尾添加：

```sql
CREATE TABLE IF NOT EXISTS router_results (
    id              TEXT PRIMARY KEY,
    router_step_id  TEXT NOT NULL,
    strategy_id     TEXT NOT NULL,
    task_id         TEXT NOT NULL,
    post_id         TEXT NOT NULL,
    applicable_strategy_ids JSON NOT NULL,
    skipped_strategies      JSON NOT NULL,
    checks          JSON NOT NULL,
    confidence      REAL NOT NULL,
    created_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(router_step_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_router_results_task ON router_results(task_id);
CREATE INDEX IF NOT EXISTS idx_router_results_step ON router_results(router_step_id);
```

- [ ] **Step 3: 修改 migrate.ts — 添加 migration 函数**

在 `packages/core/src/db/migrate.ts` 中添加两个 migration 函数：

```typescript
async function migrateRouterColumns(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'strategies'"
  );
  if (!columns.some(c => c.name === 'is_router')) {
    await exec('ALTER TABLE strategies ADD COLUMN is_router BOOLEAN DEFAULT FALSE');
  }
  if (!columns.some(c => c.name === 'routing')) {
    await exec('ALTER TABLE strategies ADD COLUMN routing JSON');
  }
}

async function migrateRouterResultsTable(): Promise<void> {
  const hasTable = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'router_results'"
  );
  if (hasTable.length === 0) {
    await exec(`CREATE TABLE router_results (
      id TEXT PRIMARY KEY,
      router_step_id TEXT NOT NULL,
      strategy_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      applicable_strategy_ids JSON NOT NULL,
      skipped_strategies JSON NOT NULL,
      checks JSON NOT NULL,
      confidence REAL NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(router_step_id, post_id)
    )`);
    await exec('CREATE INDEX idx_router_results_task ON router_results(task_id)');
    await exec('CREATE INDEX idx_router_results_step ON router_results(router_step_id)');
  }
}
```

并在 `runMigrations()` 末尾添加调用：

```typescript
  await migrateRouterColumns();
  await migrateRouterResultsTable();
```

- [ ] **Step 4: Build 验证**

Run: `pnpm build`
Expected: 成功通过

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/schema.sql packages/core/src/db/migrate.ts
git commit -m "feat(db): add is_router/routing columns and router_results table"
```

---

## Task 2: Strategy 类型扩展 + CRUD 支持

**Files:**
- Modify: `packages/core/src/shared/types.ts`
- Modify: `packages/core/src/db/strategies.ts`
- Test: `pnpm build`

- [ ] **Step 1: 扩展 Strategy 类型**

在 `packages/core/src/shared/types.ts` 中添加：

```typescript
export interface RoutingCheck {
  id: string;
  question: string;
  evidence_field?: string;
  kind: 'boolean' | 'text' | 'enum';
  enum_values?: string[];
}

export interface RoutingConfig {
  availability?: {
    requires_media?: Record<string, number>;
    requires_text?: {
      min_sentences?: number;
      min_chars?: number;
    };
    requires_data?: string[];
  };
  applicability_checks: RoutingCheck[];
  boundary_false_positives: string[];
}
```

在 `Strategy` 接口中添加：

```typescript
  is_router: boolean;
  routing: RoutingConfig | null;
```

- [ ] **Step 2: 修改 strategies.ts — createStrategy 支持新字段**

修改 SQL INSERT 添加 `is_router` 和 `routing` 列及对应参数。

- [ ] **Step 3: 修改 strategies.ts — updateStrategy 支持新字段**

添加 `is_router` 和 `routing` 的更新逻辑。

- [ ] **Step 4: 修改 strategies.ts — parseStrategyRow 解析新字段**

添加 `is_router` 和 `routing` 的 JSON 解析。

- [ ] **Step 5: 修改 strategies.ts — validateStrategyJson 支持 routing**

添加 `is_router` boolean 校验和 `routing` 对象结构校验（applicability_checks 数组、boundary_false_positives 数组）。

- [ ] **Step 6: Build 验证**

Run: `pnpm build`
Expected: 成功通过

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/shared/types.ts packages/core/src/db/strategies.ts
git commit -m "feat(core): Strategy type and CRUD support for is_router and routing"
```

---

## Task 3: 新建 Router 策略 + 内置策略补 routing

**Files:**
- Create: `packages/core/src/strategies/built-in/content-strategy-router.json`
- Modify: 4 个内置策略 JSON 文件
- Modify: `packages/core/src/strategies/seed-built-in.ts`
- Test: `pnpm build`

- [ ] **Step 1: 创建 content-strategy-router.json**

创建 Router 策略 JSON，包含：
- `id`: `content-strategy-router`
- `is_router`: `true`
- `prompt`: 动态模板（含 `strategy_list_with_checks` 占位符）
- `output_schema`: `{ decisions: [{ strategy_id, applicable, confidence, checks, rejection_reason }] }`

- [ ] **Step 2: 给 4 个内置策略添加 routing 字段**

按设计文档附录 A 的完整配置，给每个策略添加 `routing` 对象。

- [ ] **Step 3: 修改 seed-built-in.ts**

在 strategy 对象构建中添加 `is_router` 和 `routing` 字段。

- [ ] **Step 4: Build 验证**

Run: `pnpm build`
Expected: 成功通过

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/strategies/
git commit -m "feat(strategies): add routing to built-in strategies and content-strategy-router"
```

---

## Task 4: Router Results CRUD

**Files:**
- Create: `packages/core/src/db/router-results.ts`
- Modify: `packages/core/src/index.ts`
- Test: `pnpm build`

- [ ] **Step 1: 创建 router-results.ts**

实现 `RouterResult` 接口和以下函数：
- `createRouterResult(result)` — 插入记录
- `getRouterResultsByTask(taskId)` — 按任务查询
- `getRouterResultsByStep(stepId)` — 按 step 查询
- `hasRouterResultForPost(stepId, postId)` — 检查是否存在
- `getRouterResultByPost(stepId, postId)` — 查询单条

所有 JSON 字段（applicable_strategy_ids, skipped_strategies, checks）需要做 parse/stringify 转换。

- [ ] **Step 2: 导出 router-results 模块**

在 `packages/core/src/index.ts` 中添加 `export * from './db/router-results';`

- [ ] **Step 3: Build 验证**

Run: `pnpm build`
Expected: 成功通过

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/db/router-results.ts packages/core/src/index.ts
git commit -m "feat(core): add router-results CRUD module"
```

---

## Task 5: Worker 新增 processRouterJob

**Files:**
- Modify: `packages/api/src/worker/anthropic.ts`
- Modify: `packages/api/src/worker/consumer.ts`
- Test: `pnpm build`

- [ ] **Step 1: 在 anthropic.ts 中新增 analyzeRouter**

添加 `analyzeRouter(post, candidateStrategies)` 函数：
- 收集帖子的 media 数量（image/video）
- 动态组装 prompt：遍历 candidateStrategies，注入每个策略的 `routing.applicability_checks` 和 `routing.boundary_false_positives`
- 调用 `callLLM(prompt, [], outputSchema)`（无 media blocks，轻量调用）
- 返回 LLM 原始响应字符串

- [ ] **Step 2: 在 consumer.ts 中新增 processRouterJob**

在 `processJob` 中添加策略类型判断：如果 `strategy.is_router === true`，调用 `processRouterJob`。

`processRouterJob` 逻辑：
1. 获取 Post 内容和候选策略列表
2. 检查是否已有路由结果（去重）
3. 调用 `analyzeRouter`
4. 解析 LLM 返回的 JSON，提取 `decisions` 数组
5. 应用硬判据过滤（availability.requires_media / requires_text）
6. 将结果写入 `router_results` 表
7. 调用 `buildJobsForPost` 生成分析 Jobs（传入 routerResults 参数）
8. 更新 Router Step 的 stats

- [ ] **Step 3: 修改 processPrepareJob**

在 prepare 完成后的 job 生成逻辑中：
- 如果任务有 Router Step，生成 Router Job（target_type='post'，strategy_id=routerStrategy.id）
- 如果无 Router Step，保持现有逻辑直接生成分析 Jobs

- [ ] **Step 4: Build 验证**

Run: `pnpm build`
Expected: 成功通过

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/worker/consumer.ts packages/api/src/worker/anthropic.ts
git commit -m "feat(worker): add processRouterJob and router-aware prepare flow"
```

---

## Task 6: Scheduler 支持路由过滤

**Files:**
- Modify: `packages/api/src/daemon/scheduler.ts`
- Modify: `packages/api/src/daemon/task-helpers.ts`
- Test: `pnpm build`

- [ ] **Step 1: 修改 buildJobsForPost**

添加可选参数 `routerResults?: Map<string, Set<string>>`。

在循环中，在 `resolveTargetsForPost` 之后添加：

```typescript
    if (routerResults) {
      const applicableSet = routerResults.get(postId);
      if (applicableSet && !applicableSet.has(step.strategy_id)) {
        continue;
      }
    }
```

- [ ] **Step 2: 修改 enqueueStepJobs**

添加可选参数 `routerContext?: { routerStepId: string; routerResults?: Map<string, Set<string>> }`。

如果 `routerContext.routerResults` 存在且策略 target 为 post，过滤 targets：

```typescript
  if (routerContext?.routerResults && strategy.target === 'post') {
    finalTargets = relevantTargets.filter(t => {
      const applicableSet = routerContext.routerResults!.get(t.target_id);
      return applicableSet?.has(strategy.id) ?? false;
    });
  }
```

- [ ] **Step 3: Build 验证**

Run: `pnpm build`
Expected: 成功通过

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/daemon/scheduler.ts packages/api/src/daemon/task-helpers.ts
git commit -m "feat(scheduler): buildJobsForPost and enqueueStepJobs support router filtering"
```

---

## Task 7: API POST /tasks 支持 router_strategy_id

**Files:**
- Modify: `packages/api/src/routes/tasks.ts`
- Test: `pnpm build`

- [ ] **Step 1: 修改 POST /tasks**

解析请求体中的 `router_strategy_id` 和 `candidate_strategy_ids`：
- 如果传了 `router_strategy_id`：
  - 验证策略存在且 `is_router === true`
  - 使用 `candidate_strategy_ids` 或默认非 router 默认策略作为候选
  - 先创建 Router Step，再创建候选策略的 Steps
- 如果不传 `router_strategy_id`：保持现有逻辑

- [ ] **Step 2: Build 验证**

Run: `pnpm build`
Expected: 成功通过

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/tasks.ts
git commit -m "feat(api): POST /tasks supports router_strategy_id and candidate_strategy_ids"
```

---

## Task 8: API GET /tasks/:id 扩展 + 新增 /routing

**Files:**
- Modify: `packages/api/src/routes/tasks.ts`
- Test: `pnpm build`

- [ ] **Step 1: 修改 GET /tasks/:id**

在响应中新增 `strategy_stats` 和扩展的 `postStatuses`：
- 如果任务有 Router Step，计算每个策略的 applicable_count / done_count / processing_count / failed_count
- 在 postStatuses 中增加 `routerStatus`、`routerApplicableCount`、`routerDecisions`
- 如果无 Router Step，保持向后兼容（strategy_stats 为空数组）

- [ ] **Step 2: 新增 GET /api/tasks/:id/routing**

返回路由决策矩阵：
```typescript
{
  task_id: string,
  router_step_id: string | null,
  decisions: [
    {
      post_id: string,
      applicable: [{ strategy_id, strategy_name, confidence, checks }],
      skipped: [{ strategy_id, reason, checks }]
    }
  ]
}
```

- [ ] **Step 3: Build 验证**

Run: `pnpm build`
Expected: 成功通过

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/tasks.ts
git commit -m "feat(api): GET /tasks/:id extended with strategy_stats and routing endpoint"
```

---

## Task 9: UI PipelineMatrix 条件渲染

**Files:**
- Modify: `packages/ui/src/pages/TaskDetail.tsx`
- Test: 浏览器验证

- [ ] **Step 1: 修改 TaskDetail 中的 matrix 渲染逻辑**

根据 `strategy_stats` 是否存在决定渲染模式：

**路由模式**（有 strategy_stats）：
- columns: `[数据准备, 路由, 分析进度]`
- rows: 每个 post 显示 dataPrepStatus / routerStatus / analysisProgress
- analysisProgress 显示 `done/applicable`，状态映射：全部完成=completed，部分完成=processing，未开始=pending，无适用=skipped

**传统模式**（无 strategy_stats）：
- 保持现有 N+1 列逻辑不变

- [ ] **Step 2: Build 验证**

Run: `pnpm --filter @scopai/ui build`
Expected: 成功通过

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/pages/TaskDetail.tsx
git commit -m "feat(ui): PipelineMatrix conditional rendering for router mode"
```

---

## Task 10: UI TaskTimeline 条件渲染 + StrategyStats

**Files:**
- Create: `packages/ui/src/components/StrategyStats.tsx`
- Modify: `packages/ui/src/pages/TaskDetail.tsx`
- Test: 浏览器验证

- [ ] **Step 1: 创建 StrategyStats 组件**

渲染策略覆盖统计表格：
- 列：策略名 / 适用 / 已完成 / 进行中 / 失败
- 数据来自 API 的 `strategy_stats`

- [ ] **Step 2: 修改 TaskDetail 中的 phases 构建**

**路由模式**：固定 3 阶段
- 阶段1: 数据准备（使用 dataPreparation stats）
- 阶段2: 内容路由（使用 Router Step stats）
- 阶段3: 策略分析（聚合所有分析 Job 的进度）

**传统模式**：保持现有 N 阶段逻辑

- [ ] **Step 3: 在 TaskDetail JSX 中插入 StrategyStats**

在 `TaskTimeline` 和 `PipelineMatrix` 之间插入：

```tsx
{hasRouterStep && task.strategy_stats && (
  <StrategyStats stats={task.strategy_stats} />
)}
```

- [ ] **Step 4: Build 验证**

Run: `pnpm --filter @scopai/ui build`
Expected: 成功通过

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/StrategyStats.tsx packages/ui/src/pages/TaskDetail.tsx
git commit -m "feat(ui): StrategyStats component and conditional TaskTimeline"
```

---

## Task 11: CLI 支持 --auto-route

**Files:**
- Modify: `packages/cli/src/analyze.ts`
- Test: `pnpm build`

- [ ] **Step 1: 修改 analyze submit 命令**

添加 `--auto-route` 选项：
- 当启用时，在请求体中发送 `router_strategy_id: 'content-strategy-router'`
- 同时发送 `candidate_strategy_ids: [opts.strategyId]`

- [ ] **Step 2: Build 验证**

Run: `pnpm build`
Expected: 成功通过

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/analyze.ts
git commit -m "feat(cli): analyze submit --auto-route option"
```

---

## Task 12: 测试

**Files:**
- Create: `test/unit/router-strategy.test.ts`
- Create: `test/integration/dynamic-routing.test.ts`
- Modify: `packages/api/test/e2e/tasks.test.ts`
- Test: `pnpm test` + `pnpm --filter @scopai/api test:e2e`

- [ ] **Step 1: 创建 Router 策略单元测试**

测试 `validateStrategyJson`：
- 接受带 routing 的有效策略
- 拒绝 invalid check kind
- 拒绝非数组的 boundary_false_positives

- [ ] **Step 2: 创建动态路由集成测试**

测试：
- `content-strategy-router` 被正确种子导入（is_router=true）
- 4 个内置策略都有 routing 配置

- [ ] **Step 3: 添加 API e2e 测试**

在 `tasks.test.ts` 中添加：
- `POST /api/tasks` 带 `router_strategy_id` 创建任务，验证 step_ids 包含 Router + 候选策略
- `GET /api/tasks/:id` 验证 `strategy_stats` 为空数组（非 router 任务）
- `GET /api/tasks/:id/routing` 返回空 decisions（无 router 的任务）

- [ ] **Step 4: 运行测试**

Run: `pnpm test`
Run: `pnpm --filter @scopai/api test:e2e`
Expected: 所有测试通过

- [ ] **Step 5: Commit**

```bash
git add test/ packages/api/test/e2e/tasks.test.ts
git commit -m "test: router strategy unit tests, integration tests, and API e2e tests"
```

---

## Spec Coverage Checklist

| 设计文档章节 | 对应任务 |
|-------------|---------|
| 1.1 strategies 表加 is_router/routing | Task 1, Task 2 |
| 1.2 task_steps 表（无变更） | N/A |
| 1.3 router_results 表 | Task 1, Task 4 |
| 2. 4 个内置策略补 routing | Task 3 |
| 2. content-strategy-router 策略 | Task 3 |
| 3.1 整体流程 | Task 5 |
| 3.2 Scheduler buildJobsForPost | Task 6 |
| 3.3 Worker processRouterJob | Task 5 |
| 4.1 POST /api/tasks | Task 7 |
| 4.2 GET /api/tasks/:id | Task 8 |
| 4.3 GET /api/tasks/:id/routing | Task 8 |
| 5.1 PipelineMatrix | Task 9 |
| 5.2 TaskTimeline | Task 10 |
| 5.3 StrategyStats | Task 10 |
| 5.4 TaskDetail 布局 | Task 9, Task 10 |
| 6. CLI --auto-route | Task 11 |
| 6. 测试 | Task 12 |

---

## Placeholder Scan

- [x] 无 TBD/TODO
- [x] 无 "implement later"
- [x] 无 "add appropriate error handling" 等模糊描述
- [x] 每个任务都有明确的文件和步骤
- [x] 类型名称一致（RouterResult, RoutingConfig 等）
