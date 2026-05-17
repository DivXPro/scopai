# 二次创作参考策略与 MCP 增强实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 4 个预置创作分析策略、search_index 全文检索表、multi-post 策略系统扩展、以及 MCP Server 创作参考工具增强。

**Architecture:** 在现有策略分析基础设施上叠加创作参考能力。前 3 个策略分析单条帖子的文案/视觉/话题要素，第 4 个策略（multi-post）融合多条参考生成创作简报。所有分析结果同步写入 `search_index` 支持模糊检索。MCP Server 新增工具暴露创作参考工作流。

**Tech Stack:** TypeScript, DuckDB, Fastify, @modelcontextprotocol/sdk, Anthropic/OpenAI API

---

## 文件结构映射

### 新增文件

| 文件 | 职责 |
|------|------|
| `packages/core/src/db/search-index.ts` | search_index 表的 CRUD 操作 + 文本聚合工具函数 |
| `packages/core/src/strategies/built-in/creative-copy-deconstruct.json` | 文案解构策略定义 |
| `packages/core/src/strategies/built-in/creative-visual-style.json` | 视觉风格策略定义 |
| `packages/core/src/strategies/built-in/creative-topic-angle.json` | 话题角度策略定义 |
| `packages/core/src/strategies/built-in/creative-brief.json` | 综合创作简报策略定义（target=multi-post） |
| `packages/api/src/routes/search.ts` | `/api/search` 全文检索路由 |

### 修改文件

| 文件 | 修改点 |
|------|--------|
| `packages/core/src/db/schema.sql` | 新增 search_index 表；修改 task_targets CHECK 约束支持 multi-post |
| `packages/core/src/db/migrate.ts` | 添加 search_index 表 migration；添加 CHECK 约束扩展 migration |
| `packages/core/src/db/strategies.ts` | validateStrategyJson 支持 multi-post target |
| `packages/core/src/shared/types.ts` | Strategy.target 类型扩展 |
| `packages/core/src/index.ts` | 导出 search-index 模块 |
| `packages/api/src/worker/consumer.ts` | processStrategyJob 支持 multi-post；分析完成后同步 search_index |
| `packages/api/src/worker/anthropic.ts` | 新增 analyzeMultiPostWithStrategy 函数 |
| `packages/api/src/routes/posts.ts` | 新增 `/posts/:id/reference` 路由 |
| `packages/api/src/routes/index.ts` | 注册 search 路由 |
| `packages/cli/src/mcp-server.ts` | 增强 search_posts；新增 get_post_reference、generate_creative_brief |

---

## Task 1: 数据库 Schema 与 Migration

**Files:**
- Modify: `packages/core/src/db/schema.sql`
- Modify: `packages/core/src/db/migrate.ts`

### Step 1: 修改 schema.sql

在 schema.sql 的索引创建段落后添加 search_index 表：

```sql
CREATE TABLE IF NOT EXISTS search_index (
    post_id          TEXT NOT NULL,
    source_type      TEXT NOT NULL,
    searchable_text  TEXT NOT NULL,
    weight           REAL DEFAULT 1.0,
    updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_index_post ON search_index(post_id);
CREATE INDEX IF NOT EXISTS idx_search_index_type ON search_index(source_type);
```

修改 task_targets 表的 CHECK 约束（约 line 102）：
```sql
target_type TEXT NOT NULL CHECK(target_type IN ('post','comment','multi-post')),
```

修改 strategies 表的 CHECK 约束（约 line 153）：
```sql
target TEXT NOT NULL CHECK(target IN ('post','comment','multi-post')),
```

### Step 2: 修改 migrate.ts

添加 migration 函数：
```typescript
async function migrateSearchIndexTable(): Promise<void> {
  const hasTable = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'search_index'"
  );
  if (hasTable.length === 0) {
    await exec(`CREATE TABLE search_index (...)`);
    await exec('CREATE INDEX idx_search_index_post ON search_index(post_id)');
    await exec('CREATE INDEX idx_search_index_type ON search_index(source_type)');
  }
}

async function migrateTargetTypeCheck(): Promise<void> {
  // Migrate task_targets table
  try {
    await exec(`INSERT INTO task_targets (id, task_id, target_type, target_id) SELECT 'check-migrate-multi-post', 'check-trigger', 'multi-post', 'check-trigger'`);
    await exec("DELETE FROM task_targets WHERE id = 'check-migrate-multi-post'");
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('CHECK constraint') || msg.includes('task_targets')) {
      await exec('CREATE TABLE task_targets_backup AS SELECT * FROM task_targets');
      await exec('DROP TABLE task_targets');
      await exec(`CREATE TABLE task_targets (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id),
        target_type TEXT NOT NULL CHECK(target_type IN ('post','comment','multi-post')),
        target_id TEXT NOT NULL, status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),
        error TEXT, created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(task_id, target_type, target_id)
      )`);
      await exec('INSERT INTO task_targets SELECT * FROM task_targets_backup');
      await exec('DROP TABLE task_targets_backup');
      await exec('CREATE INDEX idx_task_targets_task ON task_targets(task_id)');
    }
  }

  // Migrate strategies table
  try {
    await exec(`INSERT INTO strategies (id, name, version, target, prompt, output_schema) SELECT 'check-migrate-strat', 'check', '1.0.0', 'multi-post', 'check', '{}' `);
    await exec("DELETE FROM strategies WHERE id = 'check-migrate-strat'");
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes('CHECK constraint') || msg.includes('strategies')) {
      await exec('CREATE TABLE strategies_backup AS SELECT * FROM strategies');
      await exec('DROP TABLE strategies');
      await exec(`CREATE TABLE strategies (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
        version TEXT NOT NULL DEFAULT '1.0.0',
        target TEXT NOT NULL CHECK(target IN ('post','comment','multi-post')),
        needs_media JSON, prompt TEXT NOT NULL, output_schema JSON NOT NULL,
        batch_config JSON, depends_on TEXT, include_original BOOLEAN DEFAULT false,
        file_path TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
      )`);
      await exec('INSERT INTO strategies SELECT * FROM strategies_backup');
      await exec('DROP TABLE strategies_backup');
    }
  }
}
```

在 runMigrations 中添加调用。

### Step 3: 在帖子导入时同步写入 search_index

在 `packages/api/src/routes/posts.ts` 的 `/posts/import` 路由中，导入完成后（`return { imported, skipped, postIds }` 之前）添加：

```typescript
// 同步写入 search_index
const { insertSearchIndex } = await import('@scopai/core');
for (const postId of postIds) {
  const importedPost = await getPostById(postId);
  if (importedPost) {
    const searchableText = [
      importedPost.title,
      importedPost.content,
      importedPost.author_name,
    ].filter(Boolean).join(' ');
    if (searchableText) {
      await insertSearchIndex(postId, 'post_content', searchableText, 1.0);
    }
  }
}
```

### Step 4: Commit

```bash
git add packages/core/src/db/schema.sql packages/core/src/db/migrate.ts packages/api/src/routes/posts.ts
git commit -m "feat(db): add search_index table, expand CHECK constraints, sync post content"
```

---

## Task 2: search_index CRUD 模块

**Files:**
- Create: `packages/core/src/db/search-index.ts`
- Modify: `packages/core/src/index.ts`

### Step 1: 创建 search-index.ts

```typescript
import { query, run } from './client';

export async function insertSearchIndex(postId: string, sourceType: string, searchableText: string, weight = 1.0): Promise<void> {
  await run(`INSERT INTO search_index (post_id, source_type, searchable_text, weight, updated_at) VALUES (?, ?, ?, ?, NOW())`, [postId, sourceType, searchableText, weight]);
}

export async function searchPostsByQueryWithPostJoin(queryText: string, limit = 5): Promise<Array<{post_id: string; title: string | null; content: string; author_name: string | null; platform_id: string; matched_snippet: string}>> {
  const likePattern = `%${queryText}%`;
  return query(`SELECT DISTINCT s.post_id, p.title, p.content, p.author_name, p.platform_id, s.searchable_text as matched_snippet FROM search_index s JOIN posts p ON s.post_id = p.id WHERE s.searchable_text LIKE ? ORDER BY s.weight DESC LIMIT ?`, [likePattern, limit]);
}

export function buildSearchableText(data: unknown): string {
  const texts: string[] = [];
  function extract(value: unknown) {
    if (typeof value === 'string') texts.push(value);
    else if (Array.isArray(value)) value.forEach(extract);
    else if (value && typeof value === 'object') Object.values(value).forEach(extract);
  }
  extract(data);
  return texts.join(' ');
}
```

### Step 2: 在 core/src/index.ts 导出

```typescript
export * from './db/search-index';
```

### Step 3: Commit

---

## Task 3: 策略验证扩展

**Files:**
- Modify: `packages/core/src/db/strategies.ts`
- Modify: `packages/core/src/shared/types.ts`

### Step 1: 修改 validateStrategyJson

```typescript
if (obj.target !== 'post' && obj.target !== 'comment' && obj.target !== 'multi-post') {
  return { valid: false, error: `Invalid target: ${obj.target}. Must be 'post', 'comment', or 'multi-post'` };
}
```

### Step 2: 修改 Strategy 类型

```typescript
target: 'post' | 'comment' | 'multi-post';
```

### Step 3: Commit

---

## Task 4: 预置策略 JSON 文件

**Files:**
- Create: `packages/core/src/strategies/built-in/*.json` (4 files)

### Step 1: 创建目录和 4 个策略 JSON

```bash
mkdir -p packages/core/src/strategies/built-in
```

创建 creative-copy-deconstruct.json、creative-visual-style.json、creative-topic-angle.json、creative-brief.json（内容见设计文档）。

### Step 2: Commit

---

## Task 5: Worker 扩展 — multi-post 支持

**Files:**
- Modify: `packages/api/src/worker/consumer.ts`
- Modify: `packages/api/src/worker/anthropic.ts`

### Step 1: 修改 consumer.ts

在 processStrategyJob 中添加 multi-post 分支：
```typescript
} else if (strategy.target === 'multi-post') {
  await processMultiPostStrategyJob(job, task, strategy, workerId);
}
```

添加 processMultiPostStrategyJob 函数：
- 获取 task 的所有 post targets
- 查询每个 post 的前序策略分析结果
- 组装 prompt，调用 analyzeMultiPostWithStrategy
- 写入结果表和 search_index

修改 target_id 检查（允许 multi-post job 没有 target_id）：
```typescript
if (!job.target_id && strategy.target !== 'multi-post') {
  throw new Error('Job has no target_id');
}
```

### Step 2: multi-post job 的创建机制

multi-post 策略的 job 不能通过 `buildJobsForPost` 创建（因为那是按单个 post 创建的）。需要在 `run_task_analysis` 中单独处理。

修改 `packages/api/src/routes/tasks.ts`（或分析任务启动的对应路由），在 `run_task_analysis` 处理中添加：

```typescript
// 检查是否有 multi-post 策略的 step
const { listTaskSteps } = await import('@scopai/core');
const { enqueueJobs } = await import('@scopai/core');
const { generateId } = await import('@scopai/core');

const steps = await listTaskSteps(taskId);
const multiPostStep = steps.find(s => {
  const strategy = strategies.get(s.strategy_id);
  return strategy?.target === 'multi-post';
});

if (multiPostStep) {
  // 创建 multi-post job（target_type=null 跳过 updateTargetStatus）
  await enqueueJobs([{
    id: generateId(),
    task_id: taskId,
    strategy_id: multiPostStep.strategy_id,
    target_type: null,
    target_id: null,
    status: 'pending',
    priority: 0,
    attempts: 0,
    max_attempts: 3,
  }]);
}
```

注意：`enqueueJobs` 函数需要支持 `target_type=null` 的 job。检查 `enqueueJobs` 的实现，确保它不会拒绝 null target_type。

### Step 3: 修改 anthropic.ts

添加 analyzeMultiPostWithStrategy 函数：

```typescript
export async function analyzeMultiPostWithStrategy(
  promptText: string,
  strategy: Strategy,
): Promise<string> {
  return callLLM(promptText, [], strategy.output_schema);
}
```

注意：`callLLM` 需要在当前模块作用域内可访问（确保它已在 anthropic.ts 中定义且在同一作用域）。

### Step 4: Commit

---

## Task 6: Worker 扩展 — search_index 同步

**Files:**
- Modify: `packages/api/src/worker/consumer.ts`

### Step 1: 在 post 分析完成后同步 search_index

在 insertStrategyResult 之后添加：
```typescript
const { insertSearchIndex, buildSearchableText } = await import('@scopai/core');
const searchableText = buildSearchableText(parsed.values);
if (searchableText) {
  const sourceType = strategy.id === 'creative-copy-deconstruct' ? 'brief_copy' : strategy.id === 'creative-visual-style' ? 'brief_visual' : strategy.id === 'creative-topic-angle' ? 'brief_topic' : 'brief_other';
  await insertSearchIndex(post.id, sourceType, searchableText);
}
```

### Step 2: Commit

---

## Task 7: 后端 API — /api/search

**Files:**
- Create: `packages/api/src/routes/search.ts`
- Modify: `packages/api/src/routes/index.ts`

### Step 1: 创建 search.ts

```typescript
import { FastifyInstance } from 'fastify';
import { searchPostsByQueryWithPostJoin } from '@scopai/core';

export default async function searchRoutes(app: FastifyInstance) {
  app.get('/search', async (request) => {
    const { query: queryText, limit = '5' } = request.query as Record<string, string>;
    if (!queryText) return { posts: [], total: 0 };
    const results = await searchPostsByQueryWithPostJoin(queryText, parseInt(limit, 10));
    return { posts: results.map(r => ({ post_id: r.post_id, title: r.title, content: r.content?.substring(0, 200), author_name: r.author_name, platform_id: r.platform_id, reference_summary: r.matched_snippet?.substring(0, 300) })), total: results.length };
  });
}
```

### Step 2: 注册路由

### Step 3: Commit

---

## Task 8: 后端 API — /api/posts/:id/reference

**Files:**
- Modify: `packages/api/src/routes/posts.ts`

### Step 1: 添加 /posts/:id/reference 路由

查询各策略结果表，提取动态列数据，组装返回。

### Step 2: Commit

---

## Task 9: MCP Server 增强

**Files:**
- Modify: `packages/cli/src/mcp-server.ts`

### Step 1: 增强 search_posts

替换为查 /search API 的实现。

### Step 2: 新增 get_post_reference

调用 /posts/:post_id/reference。

### Step 3: 新增 generate_creative_brief

创建任务 -> 添加帖子 -> 添加策略步骤 -> 启动分析 -> 返回 task_id。

### Step 4: Commit

---

## Task 10: 集成测试

**Files:**
- Create: `test/integration/search-index.test.ts`

### Step 1: 创建测试

测试 insertSearchIndex、searchPostsByQuery、buildSearchableText。

### Step 2: 运行测试

```bash
pnpm test test/integration/search-index.test.ts
pnpm --filter @scopai/api test:e2e
```

### Step 3: Commit
