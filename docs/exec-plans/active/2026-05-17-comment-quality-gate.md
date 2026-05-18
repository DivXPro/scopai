# 评论质量门控实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现评论质量门控策略，规则预筛 + LLM 批量精分，对评论做 shallow/signal/insight 三分，作为下游评论分析策略的前置过滤器。

**Architecture:** 不新增表结构，不修改 Comment 实体。规则预筛在 scheduler 构建 job 时计算（需要 comment content），LLM 精分复用现有 `target: 'comment'` + `batch_config` 管道。下游过滤通过恢复 `depends_on` → `{{upstream_result}}` 链路实现：下游策略拿到上游 gate 分类后自行判断是否跳过。评论分析与内容分析作为两个独立 Task 运行。

**Pre-verified:** 本轮已对 `buildJobsForPost`、`resolveTargetsForPost`、`analyzeBatchWithStrategy`、`parseBatchStrategyResult`、`processStrategyJob`、`processCommentBatch`、`StepInfo`/`TaskStep` 类型、`createTaskStep`、`insertStrategyResult` 的当前实际代码做了交叉验证，所有修订基于真实代码现状。

**Tech Stack:** TypeScript, Node.js 20+, DuckDB, Fastify, pnpm monorepo

---

## 文件结构映射

### 新增文件

| 文件 | 职责 |
|------|------|
| `packages/core/src/shared/comment-shallow-patterns.ts` | 浅层评论规则模板库（正则 + 字符串匹配） |
| `packages/core/src/shared/comment-filter.ts` | 规则预筛函数，isDefinitelyShallow / hasContentSignal |
| `packages/core/src/strategies/built-in/comment-quality-gate.json` | comment-quality-gate 策略定义 |

### 修改文件

| 文件 | 修改点 |
|------|--------|
| `packages/core/src/index.ts` | 导出 comment-filter 模块 |
| `packages/core/src/shared/types.ts` | TaskStep 添加 `depends_on_step_id` 字段 |
| `packages/core/src/db/task-steps.ts` | `createTaskStep` 支持 `depends_on_step_id` |
| `packages/core/src/strategies/seed-built-in.ts` | 导入 comment-quality-gate 种子策略 |
| `packages/api/src/daemon/scheduler.ts` | `StepInfo` 添加 `depends_on_step_id`；`buildJobsForPost` 的 comments 参数改为含 content；`resolveTargetsForPost` 增加规则预筛 |
| `packages/api/src/worker/anthropic.ts` | `analyzeBatchWithStrategy` 改为使用 strategy.prompt 模板替换 `{{batch_items}}` |
| `packages/api/src/worker/consumer.ts` | 恢复 `depends_on` → `{{upstream_result}}` 链路；processCommentBatch 排除 index 字段；comments 查询含 content |

---

## Task 1: 浅层评论规则模板库 + 过滤函数

**Files:**
- Create: `packages/core/src/shared/comment-shallow-patterns.ts`
- Create: `packages/core/src/shared/comment-filter.ts`
- Modify: `packages/core/src/index.ts`
- Test: `pnpm build`

- [ ] **Step 1: 创建 comment-shallow-patterns.ts**

```typescript
// 纯互动附和 — 正则匹配（去除 emoji/标点后的纯文本全匹配）
export const PURE_INTERACTION_PATTERNS: string[] = [
  '^[哈嘿呵嘻啧哇哦嗯啊]+$',
  '^(hh|233|666|草|卧槽|牛逼|牛批)+$',
  '^[！!]*$',
];

// 模板化附和 — 精确匹配（去除首尾空格 emoji 标点后）
export const TEMPLATE_ECHOES: Set<string> = new Set([
  '学到了', '收藏了', '已阅', '先赞后看', '说得好',
  '支持', '加油', '顶', '打卡', '沙发', '前排', '第一',
  '学习了', 'mark', '码住', '先马后看', '感谢分享',
  '厉害', '太强了', '太厉害了', '牛', '6', '赞',
  '优秀', '喜欢', '爱了', '绝了', 'yyds',
]);

// 有效字符数阈值（去除 emoji/标点/@mention/#话题 后）
export const MIN_MEANINGFUL_CHARS = 4;

// 反向信号：含以下模式 → 大概率不是 shallow，规则层不要杀
export const NOT_SHALLOW_SIGNALS: RegExp[] = [
  /[\?？]/,
  /但是|不过|可是|然而/,
  /我觉得|个人认为|不同意|有道理但/,
];
export const NOT_SHALLOW_MIN_SENTENCES = 3;
export const NOT_SHALLOW_MIN_CHARS = 50;
```

- [ ] **Step 2: 创建 comment-filter.ts**

```typescript
import {
  PURE_INTERACTION_PATTERNS, TEMPLATE_ECHOES, MIN_MEANINGFUL_CHARS,
  NOT_SHALLOW_SIGNALS, NOT_SHALLOW_MIN_SENTENCES, NOT_SHALLOW_MIN_CHARS,
} from './comment-shallow-patterns';

export function isDefinitelyShallow(content: string): boolean {
  if (!content) return true;
  const trimmed = content.trim();
  if (trimmed.length === 0) return true;

  const cleaned = stripNonContent(trimmed);
  if (cleaned.length === 0) return true;
  if (TEMPLATE_ECHOES.has(cleaned)) return true;
  for (const pat of PURE_INTERACTION_PATTERNS) {
    if (new RegExp(pat, 'i').test(cleaned)) return true;
  }
  if (cleaned.length < MIN_MEANINGFUL_CHARS) return true;
  return false;
}

export function hasContentSignal(content: string): boolean {
  if (!content) return false;
  const trimmed = content.trim();
  const sentences = trimmed.split(/[。！？.!?\n]+/).filter(s => s.trim().length > 0);
  if (sentences.length >= NOT_SHALLOW_MIN_SENTENCES) return true;
  for (const regex of NOT_SHALLOW_SIGNALS) {
    if (regex.test(trimmed)) return true;
  }
  const cleaned = stripNonContent(trimmed);
  if (cleaned.length >= NOT_SHALLOW_MIN_CHARS) return true;
  return false;
}

function stripNonContent(text: string): string {
  return text
    .replace(/@\S+/g, '')
    .replace(/#\S+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, '')
    .trim();
}
```

- [ ] **Step 3: 在 packages/core/src/index.ts 中导出**

```typescript
export * from './shared/comment-filter';
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/shared/comment-shallow-patterns.ts packages/core/src/shared/comment-filter.ts packages/core/src/index.ts
git commit -m "feat(core): add comment shallow pattern library and rule-based pre-filter"
```

---

## Task 2: 补充 `depends_on_step_id` 到类型和 CRUD

**背景**：DB 中 `task_steps` 表已有 `depends_on_step_id` 列（migration 已执行），但 TypeScript 类型 `TaskStep` 和 scheduler 的 `StepInfo` 都没有此字段，`createTaskStep` 的 INSERT 也不包含它。需要补齐这条链路。

**Files:**
- Modify: `packages/core/src/shared/types.ts`
- Modify: `packages/core/src/db/task-steps.ts`
- Modify: `packages/api/src/daemon/scheduler.ts`
- Test: `pnpm build`

- [ ] **Step 1: TaskStep 类型添加 depends_on_step_id**

在 `packages/core/src/shared/types.ts` 的 `TaskStep` 接口中，`strategy_id` 后添加：

```typescript
export interface TaskStep {
  id: string;
  task_id: string;
  strategy_id: string | null;
  depends_on_step_id: string | null;   // ← 新增
  name: string;
  step_order: number;
  status: TaskStepStatus;
  stats: TaskStats | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}
```

- [ ] **Step 2: createTaskStep 支持 depends_on_step_id**

修改 `packages/core/src/db/task-steps.ts` 中 `createTaskStep` 的 INSERT：

```typescript
export async function createTaskStep(
  step: Omit<TaskStep, 'id' | 'created_at' | 'updated_at'>,
): Promise<TaskStep> {
  const id = generateId();
  const ts = now();
  await run(
    `INSERT INTO task_steps (id, task_id, strategy_id, depends_on_step_id, name, step_order, status, stats, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      step.task_id,
      step.strategy_id ?? null,
      step.depends_on_step_id ?? null,   // ← 新增
      step.name,
      step.step_order,
      step.status,
      step.stats ? JSON.stringify(step.stats) : null,
      step.error ?? null,
      ts, ts,
    ],
  );
  return { ...step, id, created_at: ts, updated_at: ts };
}
```

`listTaskSteps` 和 `getTaskStepById` 使用 `SELECT *`，已能返回 `depends_on_step_id`，无需修改。

- [ ] **Step 3: StepInfo 类型添加 depends_on_step_id**

修改 `packages/api/src/daemon/scheduler.ts` 中的 `StepInfo`：

```typescript
export interface StepInfo {
  id: string;
  strategy_id: string | null;
  depends_on_step_id: string | null;   // ← 新增
  status: string;
  stats?: { total: number; done: number; failed: number } | null;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/shared/types.ts packages/core/src/db/task-steps.ts packages/api/src/daemon/scheduler.ts
git commit -m "feat: add depends_on_step_id to TaskStep, StepInfo types and createTaskStep"
```

---

## Task 3: comment-quality-gate 策略定义 + 种子导入

**Files:**
- Create: `packages/core/src/strategies/built-in/comment-quality-gate.json`
- Modify: `packages/core/src/strategies/seed-built-in.ts`
- Test: `pnpm build`

- [ ] **Step 1: 创建 comment-quality-gate.json**

```json
{
  "id": "comment-quality-gate",
  "name": "评论质量门控",
  "description": "判断评论是否包含新增信息，分为 shallow/signal/insight 三类",
  "version": "1.0.0",
  "target": "comment",
  "needs_media": { "enabled": false },
  "is_router": false,
  "routing": null,
  "batch_config": { "enabled": true, "size": 20, "max_batch_size": 30 },
  "depends_on": null,
  "include_original": false,
  "is_default": false,
  "prompt": "你是一个内容质量分类器。判断每条评论是否包含【新增信息】。\n\n分类标准：\n\nshallow — 读完评论后，没有获得任何新信息：纯附和（\"说得好\"）、纯互动（\"哈哈哈\"）、无意义表情标点\n\nsignal — 评论包含至少一个可被解读的信息点：明确态度/偏好、一个问题、简短但具体的反馈\n\ninsight — 评论包含结构化信息增量：个人经验/亲身经历、推理过程/反驳理由、3 句以上有逻辑关联的话、原文未覆盖的新角度\n\n判断原则：\n- 只以评论内容本身做判断，忽略作者名、点赞数\n- 边界样本倾向判为 signal（宁可多留，不要漏杀）\n- 既有附和又有独立信息的，以独立信息为准\n- 每条评论独立判断\n\n返回 JSON 数组，元素顺序与输入评论一致：\n[{ \"class\": \"shallow\" }, { \"class\": \"signal\" }, { \"class\": \"insight\" }]\n\n待分类评论：\n{{batch_items}}",
  "output_schema": {
    "type": "object",
    "properties": {
      "class": {
        "type": "string",
        "title": "质量分类",
        "enum": ["shallow", "signal", "insight"]
      }
    }
  }
}
```

**注意**：`output_schema.properties` 中**没有 `index`**——`index` 是批量结果的内置排序字段，由 `analyzeBatchWithStrategy` 自动注入到批量 wrapper 中，不由策略声明。只保留 `class` 一个字段，它会被建为 `TEXT` 列存入结果表，方便下游 `WHERE class IN ('signal', 'insight')` 查询。

- [ ] **Step 2: 修改 seed-built-in.ts**

```typescript
import commentQualityGateJson from './built-in/comment-quality-gate.json';

// 在 BUILT_IN_STRATEGIES 数组中追加 commentQualityGateJson
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/strategies/built-in/comment-quality-gate.json packages/core/src/strategies/seed-built-in.ts
git commit -m "feat(strategies): add comment-quality-gate built-in strategy"
```

---

## Task 4: 重构 `analyzeBatchWithStrategy` — 使用策略 prompt 模板

**当前问题**：`analyzeBatchWithStrategy` 完全忽略 `strategy.prompt`，自己从头构建 prompt。需要改为从 `strategy.prompt` 中读取模板，替换 `{{batch_items}}` 后再调用 LLM。

**Files:**
- Modify: `packages/api/src/worker/anthropic.ts`
- Test: `pnpm build`

- [ ] **Step 1: 重构 analyzeBatchWithStrategy**

将当前逻辑（自建 prompt → 自建 batch schema wrapper）改为基于策略定义：

```typescript
export async function analyzeBatchWithStrategy(
  comments: Comment[],
  strategy: Strategy,
): Promise<string> {
  // 构建纯文本批量输入（每条评论仅 [评论 N] + 内容，无元数据）
  const lines = comments.map((c, i) =>
    `[评论 ${i + 1}]\n${c.content ?? '(无内容)'}`
  );
  const batchText = lines.join('\n\n');

  // 用 strategy.prompt 作为模板，替换 {{batch_items}}
  let prompt = strategy.prompt;
  prompt = prompt.replace(/\{\{batch_items\}\}/g, batchText);

  // 构建批量 wrapper schema：将 strategy.output_schema 包裹在 { results: [...] } 中
  const batchSchema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: strategy.output_schema,
      },
    },
    required: ["results"],
  };

  return callLLM(prompt, [], batchSchema);
}
```

**关键变化**：
- 不再拼接 `作者:`、`深度:` 等元数据（仅 `[评论 N]` + 内容），prompt 设计里 quality-gate 明确说了"只以评论内容本身做判断"
- `batchSchema` 保持 `{ results: [{...}] }` 包裹结构，`parseBatchStrategyResult`（`parser.ts:93`）已经能正确处理
- 移除原来 prompt 末尾的 `JSON.stringify({ results: [strategy.output_schema] })` 格式提示——已有 `callLLM` 的 tool_use 机制自动处理 structured output

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/worker/anthropic.ts
git commit -m "feat(worker/anthropic): use strategy.prompt template with {{batch_items}} in batch analysis"
```

---

## Task 5: Scheduler — comments 含 content + 规则预筛

**当前问题**：
1. `buildJobsForPost` 的 `comments` 参数类型是 `{ id: string }[]`，无 `content`
2. 所有调用方的查询都是 `SELECT id FROM comments`
3. 规则预筛需要 `content` 才能运行

**Files:**
- Modify: `packages/api/src/daemon/scheduler.ts`
- Modify: `packages/api/src/worker/consumer.ts`（两处调用方）
- Test: `pnpm build`

- [ ] **Step 1: buildJobsForPost + resolveTargetsForPost 改造**

修改 `scheduler.ts`：

```typescript
import { isDefinitelyShallow, hasContentSignal } from '@scopai/core';

// comments 类型从 { id: string }[] 改为含 content
export function buildJobsForPost(
  taskId: string,
  postId: string,
  steps: StepInfo[],
  strategies: Map<string, StrategyInfo>,
  taskTargets: TargetInfo[],
  existingTargets: Set<string>,
  comments: { id: string; content: string }[],   // ← content 新增
  mediaReady: boolean,
  generateIdFn: () => string,
  postMediaTypes: string[] = [],
  routerResults?: Map<string, Set<string>>,
): { jobs: QueueJob[]; stepUpdates: StepUpdate[] } {
  // ... 循环内 resolveTargetsForPost 调用不变，其内部自动使用 content
}

function resolveTargetsForPost(
  postId: string,
  targetType: string,
  taskTargets: TargetInfo[],
  comments: { id: string; content: string }[],   // ← content 新增
): Array<{ target_id: string; target_type: string }> {
  if (targetType === 'post') {
    const isMember = taskTargets.some(t => t.target_type === 'post' && t.target_id === postId);
    if (!isMember) return [];
    return [{ target_id: postId, target_type: 'post' }];
  }

  if (targetType === 'comment') {
    return comments
      .filter(c => {
        // Stage 0 规则预筛：确定是 shallow 且无反信号 → 跳过
        if (isDefinitelyShallow(c.content)) {
          return hasContentSignal(c.content);  // 反信号抢救
        }
        return true;  // 非确定 shallow → 保留
      })
      .map(c => ({ target_id: c.id, target_type: 'comment' }));
  }

  return [];
}
```

- [ ] **Step 2: 修改 processPrepareJob 中的 comments 查询**

`consumer.ts` 中 `processPrepareJob`（约 line 437）的两处调用：

```typescript
// 原：const comments = await query<{ id: string }>(`SELECT id FROM comments WHERE post_id = ?`, [postId]);
// 改为：
const comments = await query<{ id: string; content: string }>(
  `SELECT id, content FROM comments WHERE post_id = ?`,
  [postId],
);
```

- [ ] **Step 3: 修改 processRouterJob 中的 comments 查询**

`consumer.ts` 中 `processRouterJob`（约 line 939）同样修改为 `SELECT id, content`。

- [ ] **Step 4: 修改测试文件中的 comments 查询**

`test/integration/stream-scheduler.test.ts` 中三处 `SELECT id FROM comments` 改为 `SELECT id, content FROM comments`。

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/daemon/scheduler.ts packages/api/src/worker/consumer.ts test/integration/stream-scheduler.test.ts
git commit -m "feat(scheduler): add comment content to buildJobsForPost, apply rule-based shallow pre-filter"
```

---

## Task 6: Scheduler 层 gate 结果过滤 + 下游批量触发

**设计决策**：不使用 `depends_on` → `{{upstream_result}}` 链路做下游过滤。理由：
- 有 `depends_on` 的策略不能走批量（`consumer.ts:611`），下游会退化为逐条调用
- gate 结果 `{class:"signal"}` 对下游情感/意图分析没有实际参考价值，注入 prompt 无意义
- 替代方案：在 scheduler 构建 job 时直接查 gate 表，跳过 `class='shallow'` 的 target。下游策略无 `depends_on`，保持 `batch_config` 可用

**整体流程**：
```
Post 数据准备完成
  → buildJobsForPost (gateFilter.results 为空)
    → 仅为 quality-gate 创建 comment jobs（下游 comment 步骤因 gate 未跑被跳过）
  → Worker 批量执行 quality-gate → 结果写入策略结果表
  → processCommentBatch 完成后调用 triggerDownstreamJobs
    → 重新调用 buildJobsForPost (gateFilter.results 已填充)
      → 查询 gate 结果表，过滤 class='shallow'，为下游 comment 策略批量创建 jobs
```

**Files:**
- Modify: `packages/api/src/daemon/scheduler.ts`
- Modify: `packages/api/src/worker/consumer.ts`
- Test: `pnpm build`

- [ ] **Step 1: scheduler.ts — 新增 GateFilterContext 类型 + buildJobsForPost 签名扩展**

```typescript
export interface GateFilterContext {
  enabled: boolean;              // true = task 中有 quality-gate step
  strategyId: string;            // gate 策略的 id
  results: Map<string, string>;  // comment_id → class（空 Map = gate 尚未运行）
}

export function buildJobsForPost(
  taskId: string,
  postId: string,
  steps: StepInfo[],
  strategies: Map<string, StrategyInfo>,
  taskTargets: TargetInfo[],
  existingTargets: Set<string>,
  comments: { id: string; content: string }[],
  mediaReady: boolean,
  generateIdFn: () => string,
  postMediaTypes: string[] = [],
  routerResults?: Map<string, Set<string>>,
  gateFilter?: GateFilterContext | null,   // ← 新增
): { jobs: QueueJob[]; stepUpdates: StepUpdate[] }
```

- [ ] **Step 2: scheduler.ts — buildJobsForPost 内部增加 gate 过滤逻辑**

在 `resolveTargetsForPost` 之后、创建 jobs 之前插入：

```typescript
let finalTargets = targets;

// Gate filtering: downstream comment steps skip targets where gate class='shallow'
if (
  strategy.target === 'comment' &&
  step.strategy_id !== gateFilter?.strategyId &&
  gateFilter?.enabled
) {
  if (gateFilter.results.size === 0) {
    continue; // Gate 尚未运行 → 跳过此 step，等 gate 完成后由 trigger 重新调度
  }
  finalTargets = targets.filter(t => {
    const cls = gateFilter.results.get(t.target_id);
    return cls === 'signal' || cls === 'insight';
  });
}
```

注意：gate 步骤本身（`step.strategy_id === gateFilter.strategyId`）不被过滤——它必须正常创建 job。

- [ ] **Step 3: scheduler.ts — 新增导出函数 computeGateFilter**

供 consumer 和 prepare/router job 调用方计算 gateFilter 参数：

```typescript
export async function computeGateFilter(
  taskId: string,
  postId: string,
  steps: StepInfo[],
): Promise<GateFilterContext | null> {
  const GATE_STRATEGY_ID = 'comment-quality-gate';
  const gateStep = steps.find(s => s.strategy_id === GATE_STRATEGY_ID);
  if (!gateStep) return null;

  const tableName = getStrategyResultTableName(GATE_STRATEGY_ID);
  const rows = await query<{ target_id: string; class: string }>(
    `SELECT target_id, class FROM "${tableName}" WHERE task_id = ? AND post_id = ? AND class IN ('signal', 'insight')`,
    [taskId, postId],
  );
  // 注意：只查询 signal + insight，shallow 不需要出现在 results 中
  return {
    enabled: true,
    strategyId: GATE_STRATEGY_ID,
    results: new Map(rows.map(r => [r.target_id, r.class])),
  };
}
```

当 gate 尚未运行（无结果行）时，`results` 为空 Map → `buildJobsForPost` 中逻辑会 `continue` 跳过下游 comment 步骤。

- [ ] **Step 4: consumer.ts — processCommentBatch 完成后触发下游**

在 `processCommentBatch` 末尾（`syncStepStats` 之后）添加：

```typescript
// Trigger downstream comment strategy jobs for this post
try {
  await triggerDownstreamJobs(job.task_id, seedComment.post_id, strategy.id);
} catch (triggerErr: unknown) {
  logger.warn(`[Worker-${workerId}] Failed to trigger downstream jobs for post ${seedComment.post_id}: ${
    triggerErr instanceof Error ? triggerErr.message : String(triggerErr)
  }`);
}
```

新增 `triggerDownstreamJobs` 辅助函数：

```typescript
async function triggerDownstreamJobs(
  taskId: string,
  postId: string,
  gateStrategyId: string,
): Promise<void> {
  const { listTaskSteps, listTaskTargets, getExistingJobTargets, enqueueJobs, updateTaskStepStatus } =
    await import('@scopai/core');
  const { getStrategyById } = await import('@scopai/core');
  const { listMediaFilesByPost } = await import('@scopai/core');

  const steps = await listTaskSteps(taskId);
  const strategies = new Map<string, any>();
  for (const step of steps) {
    if (step.strategy_id && !strategies.has(step.strategy_id)) {
      const s = await getStrategyById(step.strategy_id);
      if (s) strategies.set(step.strategy_id, s);
    }
  }

  // 检查是否还有 pending gate jobs
  const pendingGateJobs = await query<{ cnt: bigint }>(
    `SELECT COUNT(*) as cnt FROM queue_jobs
     WHERE task_id = ? AND strategy_id = ? AND target_type = 'comment'
       AND status IN ('pending', 'processing')`,
    [taskId, gateStrategyId],
  );
  // gate 还在跑 → 不触发下游（等最后一次 batch 完成时自然触发）
  // 即使提前触发也无害——buildJobsForPost 的 existingTargets 会去重

  const taskTargets = await listTaskTargets(taskId);
  const mediaStatus = await query<{ media_fetched: boolean }>(
    `SELECT media_fetched FROM task_post_status WHERE task_id = ? AND post_id = ?`,
    [taskId, postId],
  );
  const mediaReady = mediaStatus[0]?.media_fetched === true;

  let postMediaTypes: string[] = [];
  if (mediaReady) {
    const mediaFiles = await listMediaFilesByPost(postId);
    postMediaTypes = Array.from(new Set(mediaFiles.map(m => m.media_type)));
  }

  const comments = await query<{ id: string; content: string }>(
    `SELECT id, content FROM comments WHERE post_id = ?`, [postId],
  );

  const { buildJobsForPost, computeGateFilter } = await import('../daemon/scheduler');
  const gateFilter = await computeGateFilter(taskId, postId, steps);

  const { jobs: downstreamJobs, stepUpdates } = buildJobsForPost(
    taskId, postId, steps, strategies, taskTargets,
    await getExistingJobTargets(taskId, strategies.keys().next().value ?? ''),
    comments, mediaReady, generateId, postMediaTypes,
    undefined, gateFilter,
  );

  if (downstreamJobs.length > 0) {
    await enqueueJobs(downstreamJobs);
    for (const update of stepUpdates) {
      await updateTaskStepStatus(update.stepId, update.status, update.stats);
    }
  }
}
```

- [ ] **Step 5: consumer.ts — processPrepareJob 和 processRouterJob 中传入 gateFilter**

在两处 `buildJobsForPost` 调用前，增加 `computeGateFilter` 调用：

```typescript
const gateFilter = await computeGateFilter(taskId, postId, steps);

const { jobs: analysisJobs, stepUpdates } = buildJobsForPost(
  taskId, postId, steps, strategies, taskTargets,
  await getExistingJobTargets(taskId, strategies.keys().next().value ?? ''),
  comments, mediaReady, generateId, postMediaTypes,
  undefined,  // routerResults
  gateFilter, // ← 新增
);
```

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/daemon/scheduler.ts packages/api/src/worker/consumer.ts
git commit -m "feat(scheduler): add gate result filtering for downstream comment strategies with batch support"
```

---

## Task 7: Worker — 批量结果存储排除 index 字段

**当前问题**：quality-gate 的 LLM 返回 `[{class: "signal"}, ...]`，由 `analyzeBatchWithStrategy` 的 batch wrapper 包裹为 `{results: [{class: "signal"}, ...]}`。`parseBatchStrategyResult` 已能正确解包。但需确认 `class` 字段的 DuckDB 类型为 `TEXT`（由 `jsonSchemaTypeToDuckDb` 的 `type: 'string'` → `TEXT` 处理），且 `processCommentBatch` 不会多写 `index` 列。

**Files:**
- Modify: `packages/api/src/worker/consumer.ts`（如果需要排除 index）
- Test: `pnpm build`

- [ ] **Step 1: 验证 parseBatchStrategyResult 对 quality-gate 的兼容性**

`parser.ts` 中 `parseBatchStrategyResult` 逻辑：

```
results = obj.results ?? obj.data ?? obj.items ?? obj
→ 对 batch wrapper {results: [...]}，取 obj.results
→ coerceJsonSchemaValue 对每个结果项按 output_schema.properties 做字段提取和类型校验
→ class 字段的 def.type='string', def.enum=[...] → TEXT 列
```

**无需修改 parser**。batch wrapper 保证了 `{ results: [...] }` 格式。

- [ ] **Step 2: 排除 index 字段**

quality-gate 的 `output_schema.properties` 已不包含 `index`（Task 3 已从 JSON 中移除）。`analyzeBatchWithStrategy` 的 batch wrapper 会对每个结果应用 strategy 的 output_schema，LLM 被 tool_use 约束按 `{class: "..."}` 格式返回。不会出现 `index` 列。

**无需额外排除逻辑**。`index` 由 `analyzeBatchWithStrategy` 内部根据 `comments.map((c, i) => ...)` 的序号管理，不作为策略输出字段。

- [ ] **Step 3: Commit**

本 Task 实质无代码改动——以上两步为验证项。如有 lint/type 问题在此提交修复。

---

## Task 8: 测试

**Files:**
- Create: `test/unit/comment-filter.test.ts`
- Create: `test/unit/comment-quality-gate-prompt.test.ts`

- [ ] **Step 1: 创建 comment-filter 单元测试**

```typescript
import assert from 'node:assert';
import { describe, it } from 'node:test';
import { isDefinitelyShallow, hasContentSignal } from '@scopai/core';

describe('isDefinitelyShallow', () => {
  it('empty or whitespace → true', () => {
    assert.equal(isDefinitelyShallow(''), true);
    assert.equal(isDefinitelyShallow('   '), true);
  });
  it('template echoes → true', () => {
    assert.equal(isDefinitelyShallow('学到了'), true);
    assert.equal(isDefinitelyShallow('支持'), true);
  });
  it('pure interaction → true', () => {
    assert.equal(isDefinitelyShallow('哈哈哈哈'), true);
    assert.equal(isDefinitelyShallow('666'), true);
  });
  it('short chars → true', () => {
    assert.equal(isDefinitelyShallow('好'), true);
  });
  it('substantial content → false', () => {
    assert.equal(isDefinitelyShallow('这个配色不太合适，建议用冷色调'), false);
    assert.equal(isDefinitelyShallow('请问在哪里买的？'), false);
  });
});

describe('hasContentSignal', () => {
  it('questions → true', () => {
    assert.equal(hasContentSignal('这个怎么用？'), true);
  });
  it('transitional → true', () => {
    assert.equal(hasContentSignal('说得对，但是有个问题'), true);
  });
  it('multi-sentence → true', () => {
    assert.equal(hasContentSignal('说得对。我也觉得。确实如此。'), true);
  });
  it('pure echo → false', () => {
    assert.equal(hasContentSignal('支持'), false);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
pnpm test
pnpm --filter @scopai/api test:e2e
```

- [ ] **Step 3: Commit**

```bash
git add test/unit/
git commit -m "test: add unit tests for comment filter and quality gate prompt"
```

---

## Task 9: Build 最终验证

- [ ] **Step 1: 全量 build**

```bash
pnpm build
```

- [ ] **Step 2: 运行全套测试**

```bash
pnpm test && pnpm --filter @scopai/api test:e2e
```

- [ ] **Step 3: 修复问题并提交**

---

## Spec Coverage Checklist

| 设计文档章节 | 对应任务 |
|-------------|---------|
| Stage 0 规则预筛 — 浅层模板库 | Task 1 |
| Stage 0 规则预筛 — isDefinitelyShallow / hasContentSignal | Task 1 |
| Stage 0 规则预筛 — 在 resolveTargetsForPost 中应用 | Task 5 |
| Stage 1 LLM 批量精分 — 策略 JSON 定义（含 batch_config） | Task 3 |
| Stage 1 LLM 批量精分 — analyzeBatchWithStrategy 使用 strategy.prompt | Task 4 |
| 下游过滤 — scheduler 层 gate 结果过滤 + 批量触发 | Task 6 |
| 下游保持批量 — 不走 depends_on，下游策略可用 batch_config | Task 6 |
| depends_on_step_id 类型补齐（DB 列已有，类型层补齐） | Task 2 |
| comments 查询含 content（全量调用方修改） | Task 5 |
| 规则库独立可扩展 | Task 1 |
| 单元测试 | Task 8 |

## 批量覆盖对比

| 策略 | depends_on | 批量？ | 100 条评论的 LLM 调用次数 |
|------|-----------|--------|--------------------------|
| comment-quality-gate | null | 20/批 | ~2 次（30÷20，规则滤掉 70 条） |
| comment-sentiment（下游） | null | 20/批 | ~2 次（仅 30 条 signal+insight） |
| comment-intent（下游） | null | 20/批 | ~2 次 |
| **合计** | | | **~6 次 LLM 调用** |

对比 depends_on 方案（下游逐条 30+30=60 次），gate 过滤方案节省 10 倍下游调用量。

## 未涉及的修改（有意的设计决策）

| 项目 | 原因 |
|------|------|
| 不修改 Comment 表结构 | 过滤结果是"观点"，数据是"事实" |
| 不修改 API 路由 | quality-gate 复用现有 strategy import + task step 机制 |
| 不修改 CLI | 复用现有 strategy import 命令 |
| 不修改 UI | 后续独立讨论 Task 页面是否适配纯评论分析 Task |
| 不新增数据库表 | 复用现有策略结果表（动态 schema） |
| 不在导入时过滤评论 | 评论全量入库，过滤在 scheduler 层做 |
