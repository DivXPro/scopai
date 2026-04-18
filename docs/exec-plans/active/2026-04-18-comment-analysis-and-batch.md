# Comment 级策略分析与 Worker 软批量分析实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 comment 级策略分析（修复 `not yet implemented`），并在 worker 层面引入软批量分析机制，使同一 post 下的多条评论可聚合为单次 API 调用。

**Architecture:** 保持 `queue_jobs` 1:1 表结构不变，worker 取到一个 comment job 后自动拉取同 post 的其他 pending comment jobs 组成 batch 统一分析。Comment 分析采用扁平化策略（所有 depth 独立分析，通过 `{{depth}}`/`{{parent_author}}` 变量传递上下文）。

**Tech Stack:** TypeScript, DuckDB, Anthropic API (Claude), Node.js child_process IPC

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/shared/types.ts` | 扩展 `Strategy` 类型增加 `batch_config` 字段 |
| `src/db/strategies.ts` | `validateStrategyJson` 支持 `batch_config` 验证 |
| `src/db/comments.ts` | 新增 `listCommentsByIds(ids)` 用于 batch 拉取 |
| `src/db/queue-jobs.ts` | 新增 `lockPendingJobs(taskId, strategyId, postId, limit)` 原子锁定 batch |
| `src/worker/anthropic.ts` | 扩展 `buildStrategyPrompt` 支持 Comment；新增 `analyzeBatchWithStrategy` |
| `src/worker/parser.ts` | 新增 `parseBatchStrategyResult` 解析批量响应数组 |
| `src/worker/consumer.ts` | 实现 `processStrategyJob` 的 comment 分支；集成 batch 扩展逻辑 |
| `src/daemon/stream-scheduler.ts` | `buildJobsForPost` 中 comment target 分支 |
| `test/comment-analysis.test.ts` | Comment 分析和 batch 分析的集成测试 |

---

## Task 1: 扩展类型与验证 — 支持 batch_config

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/db/strategies.ts`
- Test: `test/comment-analysis.test.ts` (validate strategy JSON)

- [ ] **Step 1: 扩展 Strategy 类型**

```typescript
// src/shared/types.ts
export interface Strategy {
  id: string;
  name: string;
  description: string | null;
  version: string;
  target: 'post' | 'comment';
  needs_media: { enabled: boolean; media_types?: string[]; max_media?: number; mode?: string } | null;
  prompt: string;
  output_schema: Record<string, unknown>;
  batch_config: { enabled: boolean; size: number } | null;
  file_path: string | null;
  created_at: Date;
  updated_at: Date;
}
```

- [ ] **Step 2: 验证 batch_config**

```typescript
// src/db/strategies.ts — 在 validateStrategyJson 中添加
function validateBatchConfig(obj: unknown): { valid: boolean; error?: string } {
  if (obj === null || obj === undefined) return { valid: true };
  if (typeof obj !== 'object') return { valid: false, error: 'batch_config must be an object' };
  const bc = obj as Record<string, unknown>;
  if (typeof bc.enabled !== 'boolean') return { valid: false, error: 'batch_config.enabled must be boolean' };
  if (bc.size !== undefined) {
    if (typeof bc.size !== 'number' || bc.size < 1 || bc.size > 100 || !Number.isInteger(bc.size)) {
      return { valid: false, error: 'batch_config.size must be an integer between 1 and 100' };
    }
  }
  return { valid: true };
}
```

在 `validateStrategyJson` 中调用：`if (obj.batch_config) { const v = validateBatchConfig(obj.batch_config); if (!v.valid) return v; }`

- [ ] **Step 3: 写测试验证 batch_config 校验**

```typescript
// test/comment-analysis.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateStrategyJson } from '../dist/db/strategies.js';

describe('Strategy batch_config validation', () => {
  it('should accept valid batch_config', () => {
    const result = validateStrategyJson({
      id: 'test-batch', name: 'Test', version: '1.0.0', target: 'comment',
      prompt: 'Analyze {{content}}', output_schema: { type: 'object', properties: { score: { type: 'number' } } },
      batch_config: { enabled: true, size: 10 },
    });
    assert.strictEqual(result.valid, true);
  });

  it('should reject invalid batch_config.size', () => {
    const result = validateStrategyJson({
      id: 'test-batch', name: 'Test', version: '1.0.0', target: 'comment',
      prompt: 'Analyze {{content}}', output_schema: { type: 'object', properties: { score: { type: 'number' } } },
      batch_config: { enabled: true, size: 200 },
    });
    assert.strictEqual(result.valid, false);
    assert.ok(result.error?.includes('size'));
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
node --test --experimental-strip-types test/comment-analysis.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/db/strategies.ts test/comment-analysis.test.ts
git commit -m "feat(strategy): add batch_config field with validation"
```

---

## Task 2: DB 层 — 新增 comment batch 查询和 job 锁定

**Files:**
- Modify: `src/db/comments.ts`
- Modify: `src/db/queue-jobs.ts`

- [ ] **Step 1: 新增 `listCommentsByIds`**

```typescript
// src/db/comments.ts
export async function listCommentsByIds(ids: string[]): Promise<Comment[]> {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await query<Comment>(
    `SELECT * FROM comments WHERE id IN (${placeholders})`,
    ids,
  );
  return rows;
}
```

- [ ] **Step 2: 新增 `lockPendingJobs` 原子批量更新**

```typescript
// src/db/queue-jobs.ts
export async function lockPendingJobs(
  taskId: string,
  strategyId: string,
  targetIds: string[],
): Promise<{ id: string; target_id: string }[]> {
  if (targetIds.length === 0) return [];
  const placeholders = targetIds.map(() => '?').join(',');
  // Atomically lock jobs that are still pending
  const locked = await query<{ id: string; target_id: string }>(
    `UPDATE queue_jobs
     SET status = 'processing'
     WHERE task_id = ? AND strategy_id = ? AND target_type = 'comment'
       AND status = 'pending' AND target_id IN (${placeholders})
     RETURNING id, target_id`,
    [taskId, strategyId, ...targetIds],
  );
  return locked;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/db/comments.ts src/db/queue-jobs.ts
git commit -m "feat(db): add listCommentsByIds and lockPendingJobs for batching"
```

---

## Task 3: Prompt Builder — 支持 Comment 单条和批量

**Files:**
- Modify: `src/worker/anthropic.ts`

- [ ] **Step 1: 新增 `buildCommentPrompt` 函数**

```typescript
// src/worker/anthropic.ts
import { Comment } from '../shared/types';
import { getCommentById } from '../db/comments';

export async function buildCommentPrompt(comment: Comment, strategy: Strategy): Promise<string> {
  const platform = comment.platform_id ? await getPlatformById(comment.platform_id) : null;

  // Fetch parent comment author if available
  let parentAuthor = '';
  if (comment.parent_comment_id) {
    const parent = await getCommentById(comment.parent_comment_id);
    parentAuthor = parent?.author_name ?? '';
  }

  const vars: Record<string, string> = {
    content: comment.content ?? '',
    author_name: comment.author_name ?? '匿名',
    platform: platform?.name ?? 'unknown',
    published_at: comment.published_at?.toISOString() ?? '未知',
    depth: String(comment.depth ?? 0),
    parent_author: parentAuthor,
    reply_count: String(comment.reply_count ?? 0),
    media_urls: '',
  };

  let result = strategy.prompt;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }

  const schemaHint = buildSchemaHint(strategy.output_schema);
  if (schemaHint) {
    result += `\n\n${schemaHint}`;
  }
  return result;
}
```

- [ ] **Step 2: 修改 `analyzeWithStrategy` 支持 Comment**

```typescript
// src/worker/anthropic.ts
export async function analyzeWithStrategy(
  target: Post | Comment,
  strategy: Strategy,
): Promise<string> {
  const prompt = 'content' in target && 'post_id' in target
    ? await buildCommentPrompt(target as Comment, strategy)
    : await buildStrategyPrompt(target as Post, strategy);

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.max_tokens,
    temperature: config.anthropic.temperature,
    tools: [
      {
        name: 'output_analysis',
        description: 'Return the analysis result in the required JSON structure',
        input_schema: strategy.output_schema as any,
      },
    ],
    tool_choice: { type: 'tool', name: 'output_analysis' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(c => c.type === 'tool_use');
  if (toolUse && 'input' in toolUse) {
    return JSON.stringify(toolUse.input);
  }
  const text = response.content.find(c => c.type === 'text');
  return text && 'text' in text ? text.text : '';
}
```

- [ ] **Step 3: 新增 `analyzeBatchWithStrategy`**

```typescript
// src/worker/anthropic.ts
export async function analyzeBatchWithStrategy(
  comments: Comment[],
  strategy: Strategy,
): Promise<string> {
  const platform = comments[0]?.platform_id
    ? await getPlatformById(comments[0].platform_id)
    : null;

  const lines = comments.map((c, i) => {
    const parts = [
      `\n[评论 ${i + 1}]`,
      `作者: ${c.author_name ?? '匿名'}`,
      `内容: ${c.content ?? ''}`,
      `深度: ${c.depth ?? 0}`,
    ];
    return parts.join('\n');
  });

  const batchSchema = {
    type: 'object',
    properties: {
      results: {
        type: 'array',
        items: strategy.output_schema,
        description: `分析结果数组，长度必须为 ${comments.length}，顺序与输入评论一致`,
      },
    },
    required: ['results'],
  };

  let prompt = `请分析以下 ${comments.length} 条评论，逐条返回分析结果。\n\n`;
  prompt += lines.join('\n');
  prompt += `\n\n请严格按以下 JSON 格式返回，results 数组长度必须为 ${comments.length}，顺序与上方评论编号一致：`;
  prompt += `\n${JSON.stringify({ results: [strategy.output_schema] }, null, 2)}`;
  prompt += `\n\n${buildSchemaHint(strategy.output_schema) ?? ''}`;

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.max_tokens,
    temperature: config.anthropic.temperature,
    tools: [
      {
        name: 'output_analysis',
        description: 'Return batch analysis results as an array',
        input_schema: batchSchema as any,
      },
    ],
    tool_choice: { type: 'tool', name: 'output_analysis' },
    messages: [{ role: 'user', content: prompt }],
  });

  const toolUse = response.content.find(c => c.type === 'tool_use');
  if (toolUse && 'input' in toolUse) {
    return JSON.stringify(toolUse.input);
  }
  const text = response.content.find(c => c.type === 'text');
  return text && 'text' in text ? text.text : '';
}
```

- [ ] **Step 4: Commit**

```bash
git add src/worker/anthropic.ts
git commit -m "feat(worker): add comment prompt builder and batch analysis"
```

---

## Task 4: Parser — 批量结果解析

**Files:**
- Modify: `src/worker/parser.ts`

- [ ] **Step 1: 新增 `parseBatchStrategyResult`**

```typescript
// src/worker/parser.ts
export function parseBatchStrategyResult(
  raw: string,
  outputSchema: Record<string, unknown>,
): { values: Record<string, unknown>[]; raw: Record<string, unknown> } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in batch response: ${raw.slice(0, 200)}`);
  }

  const obj = data as Record<string, unknown>;
  const results = obj.results ?? obj.data ?? obj.items ?? obj;
  if (!Array.isArray(results)) {
    throw new Error('Batch response must contain a results array');
  }

  const properties = (outputSchema.properties || {}) as Record<string, Record<string, unknown>>;
  const parsed: Record<string, unknown>[] = [];

  for (const item of results) {
    const row: Record<string, unknown> = {};
    for (const key of Object.keys(properties)) {
      row[key] = (item as Record<string, unknown>)?.[key] ?? null;
    }
    parsed.push(row);
  }

  return { values: parsed, raw: obj };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/worker/parser.ts
git commit -m "feat(parser): add batch strategy result parser"
```

---

## Task 5: Worker Consumer — 实现 Comment 分支和 Batch 逻辑

**Files:**
- Modify: `src/worker/consumer.ts`

- [ ] **Step 1: 实现 `processStrategyJob` 的 comment 分支（单条模式）**

替换 `src/worker/consumer.ts:271-273`：

```typescript
} else if (strategy.target === 'comment') {
  const comment = await getCommentById(job.target_id);
  if (!comment) throw new Error(`Comment ${job.target_id} not found`);

  // Batch analysis
  if (strategy.batch_config?.enabled && strategy.batch_config.size > 1) {
    await processCommentBatch(job, strategy, comment, workerId);
    return;
  }

  // Single comment analysis
  const rawResponse = await analyzeWithStrategy(comment, strategy);
  const parsed = parseStrategyResult(rawResponse, strategy.output_schema);

  const dynamicColumns = Object.keys(parsed.values);
  const dynamicValues = Object.values(parsed.values);

  await insertStrategyResult(strategy.id, {
    task_id: task.id,
    target_type: 'comment',
    target_id: job.target_id,
    post_id: comment.post_id,
    strategy_version: strategy.version,
    raw_response: parsed.raw,
    error: null,
    analyzed_at: new Date(),
  }, dynamicColumns, dynamicValues);
}
```

- [ ] **Step 2: 新增 `processCommentBatch` 函数**

```typescript
// src/worker/consumer.ts
async function processCommentBatch(
  job: QueueJob,
  strategy: Strategy,
  seedComment: Comment,
  workerId: number,
): Promise<void> {
  const logger = getLogger();
  const batchSize = Math.min(strategy.batch_config!.size, 20);
  const postId = seedComment.post_id;

  // Find other pending comment jobs for same task+strategy+post
  const { lockPendingJobs, listJobsByTask } = await import('../db/queue-jobs');
  const { listCommentsByIds } = await import('../db/comments');

  const allJobs = await listJobsByTask(job.task_id);
  const candidateIds = allJobs
    .filter(j =>
      j.strategy_id === strategy.id &&
      j.target_type === 'comment' &&
      j.status === 'pending' &&
      j.id !== job.id,
    )
    .slice(0, batchSize - 1)
    .map(j => j.target_id!)
    .filter(Boolean);

  // Lock the batch atomically
  const locked = await lockPendingJobs(job.task_id, strategy.id, candidateIds);
  const lockedIds = locked.map(l => l.target_id);

  // Fetch all comments in batch
  const comments = await listCommentsByIds([seedComment.id, ...lockedIds]);
  const ordered = [seedComment, ...comments.filter(c => c.id !== seedComment.id)];

  logger.info(`[Worker-${workerId}] Batch analyzing ${ordered.length} comments for post ${postId}`);

  try {
    const rawResponse = await analyzeBatchWithStrategy(ordered, strategy);
    const parsed = parseBatchStrategyResult(rawResponse, strategy.output_schema);

    if (parsed.values.length !== ordered.length) {
      throw new Error(`Batch result count mismatch: expected ${ordered.length}, got ${parsed.values.length}`);
    }

    const dynamicColumns = Object.keys(parsed.values[0] ?? {});

    for (let i = 0; i < ordered.length; i++) {
      const comment = ordered[i];
      const values = parsed.values[i];
      const schemaProperties = (strategy.output_schema.properties || {}) as Record<string, Record<string, unknown>>;
      const dynamicValues = dynamicColumns.map((k) => {
        const val = values[k];
        const def = schemaProperties[k];
        if (def?.type === 'array' && Array.isArray(val)) {
          const items = val.map((v: unknown) => {
            if (typeof v === 'string') return `'${String(v).replace(/'/g, "''")}'`;
            return String(v);
          });
          return `[${items.join(',')}]`;
        }
        return val;
      });

      await insertStrategyResult(strategy.id, {
        task_id: task.id,
        target_type: 'comment',
        target_id: comment.id,
        post_id: comment.post_id,
        strategy_version: strategy.version,
        raw_response: values,
        error: null,
        analyzed_at: new Date(),
      }, dynamicColumns, dynamicValues);
    }

    logger.info(`[Worker-${workerId}] Batch complete: ${ordered.length} comments analyzed`);
  } catch (err: unknown) {
    // Batch failed — unlock other jobs so they can retry individually
    logger.error(`[Worker-${workerId}] Batch failed for post ${postId}: ${err instanceof Error ? err.message : String(err)}`);
    throw err; // Let processJobWithLifecycle handle retry for the seed job
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/worker/consumer.ts
git commit -m "feat(worker): implement comment strategy analysis with batching"
```

---

## Task 6: Stream Scheduler — 为 Comment 策略创建 Targets

**Files:**
- Modify: `src/daemon/stream-scheduler.ts`

- [ ] **Step 1: 在 `buildJobsForPost` 中新增 comment 分支**

```typescript
// In buildJobsForPost, after the post/media branches, add:
} else if (strategy.target === 'comment') {
  // Ensure comments are added as task targets
  const commentRows = await query<{ id: string }>(
    'SELECT id FROM comments WHERE post_id = ?',
    [postId],
  );
  for (const c of commentRows) {
    if (!taskTargetIds.has(c.id)) {
      const newTarget = { id: generateId(), task_id: taskId, target_type: 'comment' as const, target_id: c.id, status: 'pending' as const, created_at: now() };
      await run(
        'INSERT INTO task_targets (id, task_id, target_type, target_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [newTarget.id, newTarget.task_id, newTarget.target_type, newTarget.target_id, newTarget.status, newTarget.created_at],
      );
      taskTargetIds.add(c.id);
    }
  }

  // Build jobs for each comment
  const commentIds = commentRows.map(c => c.id);
  for (const cid of commentIds) {
    const jobId = generateId();
    const status = mediaReady ? 'pending' : 'waiting_media';
    jobs.push({ id: jobId, task_id: taskId, strategy_id: strategy.id, target_type: 'comment', target_id: cid, status, ... });
  }
  stepUpdates.push({ stepId: step.id, status: 'running', stats: { total: commentIds.length, done: 0, failed: 0 } });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/daemon/stream-scheduler.ts
git commit -m "feat(scheduler): enqueue comment targets and jobs for comment strategies"
```

---

## Task 7: 集成测试

**Files:**
- Create: `test/comment-analysis.test.ts`

- [ ] **Step 1: 写集成测试**

```typescript
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../dist/db/client.js';
const { query, run, close: closeDb } = db;
import * as migrate from '../dist/db/migrate.js';
const { runMigrations } = migrate;
import * as seed from '../dist/db/seed.js';
const { seedAll } = seed;
import * as platforms from '../dist/db/platforms.js';
const { createPlatform } = platforms;
import * as posts from '../dist/db/posts.js';
const { createPost } = posts;
import * as comments from '../dist/db/comments.js';
const { createComment, listCommentsByIds } = comments;
import * as tasks from '../dist/db/tasks.js';
const { createTask } = tasks;
import * as taskTargets from '../dist/db/task-targets.js';
const { addTaskTargets } = taskTargets;
import * as taskSteps from '../dist/db/task-steps.js';
const { createTaskStep } = taskSteps;
import * as strategies from '../dist/db/strategies.js';
const { validateStrategyJson, createStrategy, createStrategyResultTable } = strategies;
import * as utils from '../dist/shared/utils.js';
const { generateId } = utils;

const RUN_ID = `comment_${Date.now()}`;

describe('Comment strategy analysis', { timeout: 30000 }, () => {
  let platformId: string;
  let postId: string;
  let commentIds: string[];
  let taskId: string;
  let strategyId: string;

  before(async () => {
    closeDb();
    await runMigrations();
    await seedAll();

    platformId = `${RUN_ID}_platform`;
    await createPlatform({ id: platformId, name: `Test (${RUN_ID})` });

    const post = await createPost({
      platform_id: platformId,
      platform_post_id: 'note123',
      title: 'Test Post',
      content: 'Test content',
      author_name: 'Author',
      tags: null,
      media_files: null,
    });
    postId = post.id;

    commentIds = [];
    for (let i = 0; i < 5; i++) {
      const c = await createComment({
        post_id: postId,
        platform_id: platformId,
        content: `Comment ${i + 1}`,
        author_name: `User${i + 1}`,
        depth: i % 2, // mix of top-level and replies
      });
      commentIds.push(c.id);
    }

    taskId = `${RUN_ID}_task`;
    await createTask({
      id: taskId, name: 'Comment Analysis Test', description: null,
      template_id: null, cli_templates: null, status: 'pending',
      stats: { total: 0, done: 0, failed: 0 },
      created_at: new Date(), updated_at: new Date(), completed_at: null,
    });

    await addTaskTargets(taskId, 'post', [postId]);

    strategyId = `${RUN_ID}_sentiment`;
    const strategyJson = {
      id: strategyId, name: 'Comment Sentiment', version: '1.0.0', target: 'comment',
      prompt: 'Analyze sentiment of: {{content}} by {{author_name}} (depth={{depth}})',
      output_schema: { type: 'object', properties: { sentiment: { type: 'string' } } },
      batch_config: { enabled: true, size: 3 },
    };
    const validation = validateStrategyJson(strategyJson);
    assert.strictEqual(validation.valid, true, validation.error);
    await createStrategyResultTable(strategyId, [{ name: 'sentiment', type: 'TEXT' }]);
    await createStrategy({
      ...strategyJson,
      description: null,
      needs_media: { enabled: false },
      file_path: null,
    });

    await createTaskStep({
      task_id: taskId, strategy_id: strategyId, name: 'Sentiment',
      step_order: 0, status: 'pending', stats: { total: 0, done: 0, failed: 0 }, error: null,
    });
  });

  it('should list comments by ids', async () => {
    const result = await listCommentsByIds(commentIds.slice(0, 2));
    assert.strictEqual(result.length, 2);
  });

  it('should build comment prompt with depth and parent context', async () => {
    const { buildCommentPrompt } = await import('../dist/worker/anthropic.js');
    const { getCommentById } = await import('../dist/db/comments.js');
    const comment = await getCommentById(commentIds[0]);
    assert.ok(comment);
    const prompt = await buildCommentPrompt(comment!, {
      id: strategyId, name: 'Test', prompt: '{{content}} depth={{depth}} parent={{parent_author}}',
      output_schema: { type: 'object', properties: {} },
      target: 'comment', version: '1.0.0', needs_media: null,
      batch_config: null, file_path: null,
      description: null, created_at: new Date(), updated_at: new Date(),
    });
    assert.ok(prompt.includes('depth=0') || prompt.includes('depth=1'));
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
node --test --test-concurrency=1 --experimental-strip-types test/comment-analysis.test.ts
```

Expected: 前两个测试 PASS（第三个需要 mock Anthropic API，可后续补充）

- [ ] **Step 3: Commit**

```bash
git add test/comment-analysis.test.ts
git commit -m "test(comment): add integration tests for comment analysis"
```

---

## Task 8: 构建验证

- [ ] **Step 1: Build**

```bash
npm run build
```

Expected: 0 errors, 0 warnings

- [ ] **Step 2: Commit**

```bash
git commit -m "build: verify comment analysis compiles cleanly"
```

---

## Verification Checklist

- [ ] `validateStrategyJson` 接受带 `batch_config` 的 comment 策略
- [ ] `buildCommentPrompt` 正确填充 `{{content}}`、`{{depth}}`、`{{parent_author}}` 等变量
- [ ] `analyzeBatchWithStrategy` 生成包含多条评论的 prompt 和数组返回 schema
- [ ] `parseBatchStrategyResult` 正确解析数组响应为多条记录
- [ ] Worker 处理 comment job 时：单条模式走单条流程，batch 模式走批量流程
- [ ] Stream scheduler 为 comment 策略正确创建 task targets 和 queue jobs
- [ ] `lockPendingJobs` 原子锁定同 batch 的其他 jobs
- [ ] Batch 失败时，seed job 正常进入 retry 流程，其他 jobs 保持 pending
- [ ] `npm run build` 无错误
- [ ] 离线测试通过（mock 数据，不涉及 Anthropic API）

---

## Rollback Plan

如需回滚：
1. `git revert` 最后一批 commit
2. `npm run build` 确认编译通过
3. `analyze-cli daemon restart` 重启 daemon
