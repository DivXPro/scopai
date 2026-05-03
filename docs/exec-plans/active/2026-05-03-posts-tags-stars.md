# Posts 标签与加星功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为帖子增加用户自定义标签（labels 表 + post_labels 关联表）和加星（is_starred 字段）功能，支持 API/CLI/UI 全链路操作和筛选。

**Architecture:** 数据层新增 labels 和 post_labels 两张表 + posts 表加 is_starred 列；core 层提供 CRUD 函数；API 层新增标签路由和帖子标签/星标路由；CLI 新增 label 命令组和 post star/tag 子命令；UI 在 PostLibrary 中增加星标和标签交互。

**Tech Stack:** TypeScript, DuckDB, Fastify, Commander, React + HeroUI

---

### Task 1: Schema — 新增 labels 和 post_labels 表 + is_starred 列

**Files:**
- Modify: `packages/core/src/db/schema.sql`
- Modify: `packages/core/src/db/migrate.ts`

- [ ] **Step 1: 在 schema.sql 末尾添加 labels 和 post_labels 建表语句**

在 `packages/core/src/db/schema.sql` 末尾追加：

```sql
CREATE TABLE IF NOT EXISTS labels (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    color      TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS post_labels (
    post_id    TEXT NOT NULL REFERENCES posts(id),
    label_id   TEXT NOT NULL REFERENCES labels(id),
    PRIMARY KEY (post_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_post_labels_label ON post_labels(label_id);
```

- [ ] **Step 2: 在 schema.sql 的 posts 表定义中添加 is_starred 列**

在 `packages/core/src/db/schema.sql` 的 posts 表中，`metadata JSON` 行之后添加：

```sql
    is_starred  BOOLEAN DEFAULT false,
```

- [ ] **Step 3: 在 migrate.ts 中添加迁移函数**

在 `packages/core/src/db/migrate.ts` 中添加两个迁移函数：

```typescript
async function migrateIsStarredColumn(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'posts'"
  );
  if (!columns.some(c => c.name === 'is_starred')) {
    await exec('ALTER TABLE posts ADD COLUMN is_starred BOOLEAN DEFAULT false');
  }
}

async function migrateLabelsTables(): Promise<void> {
  const hasLabels = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'labels'"
  );
  if (hasLabels.length === 0) {
    await exec(`CREATE TABLE labels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await exec(`CREATE TABLE post_labels (
      post_id TEXT NOT NULL REFERENCES posts(id),
      label_id TEXT NOT NULL REFERENCES labels(id),
      PRIMARY KEY (post_id, label_id)
    )`);
    await exec('CREATE INDEX idx_post_labels_label ON post_labels(label_id)');
  }
}
```

在 `runMigrations()` 中调用：

```typescript
await migrateIsStarredColumn();
await migrateLabelsTables();
```

- [ ] **Step 4: 构建验证**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/schema.sql packages/core/src/db/migrate.ts
git commit -m "feat(core): add labels, post_labels tables and is_starred column"
```

---

### Task 2: Types — 新增 Label 类型，Post 接口加 is_starred

**Files:**
- Modify: `packages/core/src/shared/types.ts`

- [ ] **Step 1: 在 types.ts 中添加 Label 接口和 Post.is_starred**

在 `packages/core/src/shared/types.ts` 的 `Tag` 接口之后添加：

```typescript
export interface Label {
  id: string;
  name: string;
  color: string | null;
  created_at: Date;
}
```

在 `Post` 接口中，`metadata` 行之后添加：

```typescript
  is_starred: boolean;
```

- [ ] **Step 2: 构建验证**

Run: `pnpm build`
Expected: 编译通过（可能有 updatePost 相关的类型错误，下一步修复）

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/shared/types.ts
git commit -m "feat(core): add Label type and Post.is_starred field"
```

---

### Task 3: Core DB — labels 和 post_labels CRUD 函数

**Files:**
- Create: `packages/core/src/db/labels.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/db/posts.ts`

- [ ] **Step 1: 创建 labels.ts**

创建 `packages/core/src/db/labels.ts`：

```typescript
import { query, run } from './client';
import { Label } from '../shared/types';
import { generateId, now } from '../shared/utils';

export async function createLabel(name: string, color?: string): Promise<Label> {
  const id = generateId();
  const ts = now();
  await run(
    'INSERT OR IGNORE INTO labels (id, name, color, created_at) VALUES (?, ?, ?, ?)',
    [id, name, color ?? null, ts]
  );
  const rows = await query<Label>('SELECT * FROM labels WHERE name = ?', [name]);
  return rows[0]!;
}

export async function getLabelById(id: string): Promise<Label | null> {
  const rows = await query<Label>('SELECT * FROM labels WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function getLabelByName(name: string): Promise<Label | null> {
  const rows = await query<Label>('SELECT * FROM labels WHERE name = ?', [name]);
  return rows[0] ?? null;
}

export async function getOrCreateLabel(name: string, color?: string): Promise<Label> {
  const existing = await getLabelByName(name);
  if (existing) return existing;
  return createLabel(name, color);
}

export async function listLabels(): Promise<(Label & { post_count: number })[]> {
  return query<Label & { post_count: number }>(
    `SELECT l.*, COUNT(pl.post_id) as post_count
     FROM labels l LEFT JOIN post_labels pl ON l.id = pl.label_id
     GROUP BY l.id ORDER BY l.name`
  );
}

export async function deleteLabel(id: string): Promise<void> {
  await run('DELETE FROM post_labels WHERE label_id = ?', [id]);
  await run('DELETE FROM labels WHERE id = ?', [id]);
}

export async function addPostLabel(postId: string, labelId: string): Promise<void> {
  await run('INSERT OR IGNORE INTO post_labels (post_id, label_id) VALUES (?, ?)', [postId, labelId]);
}

export async function removePostLabel(postId: string, labelId: string): Promise<void> {
  await run('DELETE FROM post_labels WHERE post_id = ? AND label_id = ?', [postId, labelId]);
}

export async function getPostLabels(postId: string): Promise<Label[]> {
  return query<Label>(
    `SELECT l.* FROM labels l JOIN post_labels pl ON l.id = pl.label_id WHERE pl.post_id = ? ORDER BY l.name`,
    [postId]
  );
}

export async function listPostsByLabel(labelId: string, limit = 50, offset = 0): Promise<string[]> {
  const rows = await query<{ post_id: string }>(
    'SELECT post_id FROM post_labels WHERE label_id = ? ORDER BY post_id LIMIT ? OFFSET ?',
    [labelId, limit, offset]
  );
  return rows.map(r => r.post_id);
}

export async function setPostStarred(postId: string, starred: boolean): Promise<void> {
  await run('UPDATE posts SET is_starred = ? WHERE id = ?', [starred, postId]);
}

export async function listStarredPostIds(limit = 50, offset = 0): Promise<string[]> {
  const rows = await query<{ id: string }>(
    'SELECT id FROM posts WHERE is_starred = true ORDER BY fetched_at DESC LIMIT ? OFFSET ?',
    [limit, offset]
  );
  return rows.map(r => r.id);
}
```

- [ ] **Step 2: 在 core/index.ts 中导出 labels 模块**

在 `packages/core/src/index.ts` 的 `export * from './db/analysis-results';` 行之后添加：

```typescript
export * from './db/labels';
```

- [ ] **Step 3: 在 posts.ts 的 updatePost 中添加 is_starred 字段处理**

在 `packages/core/src/db/posts.ts` 的 `updatePost` 函数中，`metadata` 字段处理行之后添加：

```typescript
  if (updates.is_starred !== undefined) { fields.push('is_starred = ?'); params.push(updates.is_starred); }
```

- [ ] **Step 4: 构建验证**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/db/labels.ts packages/core/src/index.ts packages/core/src/db/posts.ts
git commit -m "feat(core): add labels CRUD functions and post star/label operations"
```

---

### Task 4: API — 标签路由和帖子标签/星标路由

**Files:**
- Create: `packages/api/src/routes/labels.ts`
- Modify: `packages/api/src/routes/posts.ts`
- Modify: `packages/api/src/routes/index.ts`
- Modify: `packages/api/src/types.ts`

- [ ] **Step 1: 创建 labels 路由**

创建 `packages/api/src/routes/labels.ts`：

```typescript
import { FastifyInstance } from 'fastify';
import { createLabel, listLabels, deleteLabel } from '@scopai/core';

export default async function labelsRoutes(app: FastifyInstance) {
  app.get('/labels', async () => {
    return listLabels();
  });

  app.post('/labels', async (request, reply) => {
    const body = request.body as { name?: string; color?: string };
    if (!body.name) {
      reply.code(400);
      throw new Error('name is required');
    }
    return createLabel(body.name, body.color);
  });

  app.delete('/labels/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    await deleteLabel(id);
    return { deleted: true };
  });
}
```

- [ ] **Step 2: 在 posts 路由中添加标签和星标端点，以及列表过滤**

在 `packages/api/src/routes/posts.ts` 中：

1. 在 import 中添加 `getOrCreateLabel, addPostLabel, removePostLabel, getPostLabels, setPostStarred, listPostsByLabel, listStarredPostIds`

2. 修改 `GET /posts` 路由，添加 `starred` 和 `label` 查询参数支持：

```typescript
app.get('/posts', async (request) => {
  const { platform, limit = '50', offset = '0', query: searchQuery, starred, label } = request.query as Record<string, string>;
  const parsedLimit = parseInt(limit, 10);
  const parsedOffset = parseInt(offset, 10);

  let items;
  if (starred === 'true') {
    const ids = await listStarredPostIds(parsedLimit, parsedOffset);
    items = await Promise.all(ids.map(id => getPostById(id))).then(r => r.filter(Boolean) as Post[]);
  } else if (label) {
    const labelRow = await getLabelByName(label);
    if (!labelRow) {
      items = [];
    } else {
      const ids = await listPostsByLabel(labelRow.id, parsedLimit, parsedOffset);
      items = await Promise.all(ids.map(id => getPostById(id))).then(r => r.filter(Boolean) as Post[]);
    }
  } else if (searchQuery) {
    items = await searchPosts(platform || '', searchQuery, parsedLimit, parsedOffset);
  } else {
    items = await listPosts(platform || undefined, parsedLimit, parsedOffset);
  }

  const itemsWithExtras = await Promise.all(
    items.map(async (post) => ({
      ...post,
      labels: await getPostLabels(post.id),
      analysis_count: await countPostAnalysisResults(post.id),
      media_count: await countMediaFilesByPost(post.id),
    })),
  );
  return { posts: itemsWithExtras, total: await countPosts(platform || undefined) };
});
```

注意：需要在 import 中额外添加 `getLabelByName`。

3. 在文件末尾（`export default` 函数内）添加新路由：

```typescript
app.post('/posts/:id/labels', async (request, reply) => {
  const { id: postId } = request.params as { id: string };
  const body = request.body as { label_id?: string; label_name?: string; label_names?: string[] };

  if (body.label_names && Array.isArray(body.label_names)) {
    for (const name of body.label_names) {
      const label = await getOrCreateLabel(name);
      await addPostLabel(postId, label.id);
    }
    return { added: body.label_names.length };
  }

  if (body.label_name) {
    const label = await getOrCreateLabel(body.label_name);
    await addPostLabel(postId, label.id);
    return { added: 1 };
  }

  if (body.label_id) {
    await addPostLabel(postId, body.label_id);
    return { added: 1 };
  }

  reply.code(400);
  throw new Error('label_id, label_name, or label_names is required');
});

app.delete('/posts/:id/labels/:labelId', async (request) => {
  const { id: postId, labelId } = request.params as { id: string; labelId: string };
  await removePostLabel(postId, labelId);
  return { removed: true };
});

app.post('/posts/:id/star', async (request) => {
  const { id: postId } = request.params as { id: string };
  const body = request.body as { starred?: boolean };
  const starred = body.starred ?? true;
  await setPostStarred(postId, starred);
  return { starred };
});
```

- [ ] **Step 3: 注册 labels 路由**

在 `packages/api/src/routes/index.ts` 中：

1. 添加 import：`import labelsRoutes from './labels';`
2. 添加注册：`await app.register(labelsRoutes, { prefix: '/api' });`

- [ ] **Step 4: 在 api types.ts 中添加响应类型**

在 `packages/api/src/types.ts` 中添加：

```typescript
export interface LabelResponse {
  id: string;
  name: string;
  color: string | null;
  created_at: string;
  post_count?: number;
}
```

- [ ] **Step 5: 构建验证**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/labels.ts packages/api/src/routes/posts.ts packages/api/src/routes/index.ts packages/api/src/types.ts
git commit -m "feat(api): add labels routes and post star/label endpoints with filtering"
```

---

### Task 5: CLI — label 命令组和 post star/tag 子命令

**Files:**
- Create: `packages/cli/src/label.ts`
- Modify: `packages/cli/src/post.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: 创建 label.ts**

创建 `packages/cli/src/label.ts`：

```typescript
import { Command } from 'commander';
import * as pc from 'picocolors';
import { apiGet, apiPost, apiDelete } from './api-client';

export function labelCommands(program: Command): void {
  const label = program.command('label').description('Label management');

  label
    .command('list')
    .description('List all labels')
    .action(async () => {
      const labels = await apiGet<any[]>('/labels');
      if (labels.length === 0) {
        console.log(pc.yellow('No labels found'));
        return;
      }
      console.log(pc.bold('\nLabels:'));
      for (const l of labels) {
        const colorDot = l.color ? ` (${l.color})` : '';
        console.log(`  ${pc.green(l.id.slice(0, 8))} ${pc.cyan(l.name)}${colorDot} — ${l.post_count ?? 0} posts`);
      }
      console.log();
    });

  label
    .command('create')
    .description('Create a label')
    .requiredOption('--name <name>', 'Label name')
    .option('--color <hex>', 'Label color (e.g. #FF5733)')
    .action(async (opts: { name: string; color?: string }) => {
      const result = await apiPost('/labels', { name: opts.name, color: opts.color });
      console.log(pc.green(`Label created: ${result.name} (${result.id})`));
    });

  label
    .command('delete')
    .description('Delete a label')
    .requiredOption('--id <id>', 'Label ID')
    .action(async (opts: { id: string }) => {
      await apiDelete(`/labels/${opts.id}`);
      console.log(pc.green(`Label deleted`));
    });
}
```

- [ ] **Step 2: 在 post.ts 中添加 star/unstar/tag/untag 子命令**

在 `packages/cli/src/post.ts` 的 `postCommands` 函数中，`search` 命令之后添加：

```typescript
post
  .command('star <post-id>')
  .description('Star a post')
  .action(async (postId: string) => {
    await apiPost(`/posts/${postId}/star`, { starred: true });
    console.log(pc.green(`Post ${postId} starred`));
  });

post
  .command('unstar <post-id>')
  .description('Unstar a post')
  .action(async (postId: string) => {
    await apiPost(`/posts/${postId}/star`, { starred: false });
    console.log(pc.green(`Post ${postId} unstarred`));
  });

post
  .command('tag <post-id>')
  .description('Add labels to a post')
  .requiredOption('--labels <names>', 'Comma-separated label names')
  .action(async (postId: string, opts: { labels: string }) => {
    const names = opts.labels.split(',').map(s => s.trim());
    const result = await apiPost(`/posts/${postId}/labels`, { label_names: names });
    console.log(pc.green(`Added ${result.added} label(s) to post ${postId}`));
  });

post
  .command('untag <post-id>')
  .description('Remove a label from a post')
  .requiredOption('--label-id <id>', 'Label ID to remove')
  .action(async (postId: string, opts: { labelId: string }) => {
    await apiDelete(`/posts/${postId}/labels/${opts.labelId}`);
    console.log(pc.green(`Label removed from post ${postId}`));
  });
```

修改 `post list` 命令，添加 `--starred` 和 `--label` 选项：

```typescript
post
  .command('list')
  .alias('ls')
  .description('List posts')
  .option('--platform <id>', 'Filter by platform')
  .option('--starred', 'Show only starred posts')
  .option('--label <name>', 'Filter by label name')
  .option('--limit <n>', 'Max results', '50')
  .option('--offset <n>', 'Offset', '0')
  .action(async (opts: { platform?: string; starred?: boolean; label?: string; limit: string; offset: string }) => {
    const params = new URLSearchParams();
    if (opts.platform) params.set('platform', opts.platform);
    if (opts.starred) params.set('starred', 'true');
    if (opts.label) params.set('label', opts.label);
    params.set('limit', opts.limit);
    params.set('offset', opts.offset);
    const result = await apiGet<ListPostsResponse>('/posts?' + params.toString());
    const posts = result.posts ?? (result as any);
    const total = (result as any).total ?? posts.length;
    if (posts.length === 0) {
      console.log(pc.yellow('No posts found'));
      return;
    }
    console.log(pc.bold(`\nPosts (${total} total):`));
    console.log(pc.dim('─'.repeat(80)));
    for (const p of posts) {
      const title = p.title ?? (p.content ?? '').slice(0, 40);
      const star = p.is_starred ? '★ ' : '  ';
      const labels = (p.labels && p.labels.length > 0) ? ` [${p.labels.map((l: any) => l.name).join(', ')}]` : '';
      console.log(`  ${star}${pc.green(p.id.slice(0, 8))} ${pc.cyan(p.platform_id)} ${title}${labels}`);
      console.log(`    Likes: ${p.like_count} | Comments: ${p.comment_count} | ${p.published_at ?? 'N/A'}`);
    }
    console.log(pc.dim('─'.repeat(80)));
    console.log(`Showing ${posts.length} of ${total}\n`);
  });
```

- [ ] **Step 3: 在 index.ts 中注册 label 命令**

在 `packages/cli/src/index.ts` 中：

1. 添加 import：`import { labelCommands } from './label';`
2. 在 `creatorCommands(program);` 行之后添加：`labelCommands(program);`

- [ ] **Step 4: 构建验证**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/label.ts packages/cli/src/post.ts packages/cli/src/index.ts
git commit -m "feat(cli): add label commands and post star/tag subcommands"
```

---

### Task 6: E2E 测试

**Files:**
- Create: `packages/api/test/e2e/labels.test.ts`

- [ ] **Step 1: 创建 labels e2e 测试**

创建 `packages/api/test/e2e/labels.test.ts`：

```typescript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fetchApi } from './helpers';
import type { TestContext } from './helpers';

let ctx: TestContext;

const SAMPLE_PLATFORM = { id: 'test-platform', name: 'Test Platform' };

describe('Labels routes', () => {
  before(async () => {
    ctx = await startServer();
    await fetchApi(ctx.baseUrl, '/api/platforms', {
      method: 'POST',
      body: JSON.stringify(SAMPLE_PLATFORM),
    });
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('POST /api/labels', () => {
    it('creates a label', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/labels', {
        method: 'POST',
        body: JSON.stringify({ name: '高价值', color: '#FF5733' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.name, '高价值');
      assert.equal(body.color, '#FF5733');
    });

    it('rejects missing name', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/labels', {
        method: 'POST',
        body: JSON.stringify({ color: '#000' }),
      });
      assert.equal(res.status, 400);
    });
  });

  describe('GET /api/labels', () => {
    it('lists labels with post_count', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/labels');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body));
      assert.ok(body.length >= 1);
      assert.equal(body[0].name, '高价值');
    });
  });

  describe('DELETE /api/labels/:id', () => {
    it('deletes a label', async () => {
      const createRes = await fetchApi(ctx.baseUrl, '/api/labels', {
        method: 'POST',
        body: JSON.stringify({ name: 'to-delete' }),
      });
      const created = await createRes.json();
      const res = await fetchApi(ctx.baseUrl, `/api/labels/${created.id}`, {
        method: 'DELETE',
      });
      assert.equal(res.status, 200);
    });
  });
});

describe('Post star and labels', () => {
  let postId: string;

  before(async () => {
    ctx = await startServer();
    await fetchApi(ctx.baseUrl, '/api/platforms', {
      method: 'POST',
      body: JSON.stringify(SAMPLE_PLATFORM),
    });
    // Create a test post
    const res = await fetchApi(ctx.baseUrl, '/api/posts/import', {
      method: 'POST',
      body: JSON.stringify({
        posts: [{ platform_id: SAMPLE_PLATFORM.id, platform_post_id: 'star-test-1', content: 'Test' }],
      }),
    });
    const body = await res.json();
    postId = body.postIds[0];
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('POST /api/posts/:id/star', () => {
    it('stars a post', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/star`, {
        method: 'POST',
        body: JSON.stringify({ starred: true }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.starred, true);
    });

    it('unstars a post', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/star`, {
        method: 'POST',
        body: JSON.stringify({ starred: false }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.starred, false);
    });
  });

  describe('POST /api/posts/:id/labels', () => {
    it('adds labels by name (auto-create)', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/labels`, {
        method: 'POST',
        body: JSON.stringify({ label_names: ['高价值', '待跟进'] }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.added, 2);
    });

    it('adds label by label_name', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/labels`, {
        method: 'POST',
        body: JSON.stringify({ label_name: '推荐' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.added, 1);
    });
  });

  describe('GET /api/posts with filters', () => {
    it('filters by starred=true', async () => {
      // Star the post first
      await fetchApi(ctx.baseUrl, `/api/posts/${postId}/star`, {
        method: 'POST',
        body: JSON.stringify({ starred: true }),
      });
      const res = await fetchApi(ctx.baseUrl, '/api/posts?starred=true&limit=10');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.posts.length >= 1);
      assert.equal(body.posts[0].is_starred, true);
    });

    it('filters by label name', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/posts?label=高价值&limit=10');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.posts.length >= 1);
    });

    it('returns labels in post objects', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/posts?limit=10');
      assert.equal(res.status, 200);
      const body = await res.json();
      const post = body.posts.find((p: any) => p.id === postId);
      assert.ok(post, 'should find the test post');
      assert.ok(Array.isArray(post.labels), 'should have labels array');
      assert.ok(post.labels.length >= 2, 'should have at least 2 labels');
    });
  });

  describe('DELETE /api/posts/:id/labels/:labelId', () => {
    it('removes a label from a post', async () => {
      // Get label id
      const labelsRes = await fetchApi(ctx.baseUrl, '/api/labels');
      const labels = await labelsRes.json();
      const label = labels.find((l: any) => l.name === '推荐');
      assert.ok(label, 'should find the label');
      const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/labels/${label.id}`, {
        method: 'DELETE',
      });
      assert.equal(res.status, 200);
    });
  });
});
```

- [ ] **Step 2: 运行 e2e 测试**

Run: `pnpm --filter @scopai/api test:e2e`
Expected: 所有测试通过（包括新增的标签和星标测试）

- [ ] **Step 3: Commit**

```bash
git add packages/api/test/e2e/labels.test.ts
git commit -m "test(api): add e2e tests for labels and post star/label features"
```

---

### Task 7: UI — PostLibrary 星标和标签交互

**Files:**
- Modify: `packages/ui/src/pages/PostLibrary.tsx`
- Modify: `packages/ui/src/api/client.ts` (if apiDelete not already exported)

- [ ] **Step 1: 在 PostLibrary.tsx 的 Post 接口中添加 is_starred 和 labels 字段**

在 `packages/ui/src/pages/PostLibrary.tsx` 的 `Post` 接口中添加：

```typescript
  is_starred: boolean;
  labels?: { id: string; name: string; color?: string | null }[];
```

- [ ] **Step 2: 在 PostCard 中添加星标图标**

在 PostCard 组件的标题区域，添加一个可点击的星标图标：

```tsx
<button
  onClick={async (e) => {
    e.stopPropagation();
    await apiPost(`/api/posts/${post.id}/star`, { starred: !post.is_starred });
    fetchPosts(); // refresh
  }}
  className={`text-lg ${post.is_starred ? 'text-yellow-500' : 'text-on-surface-variant/30'}`}
>
  ★
</button>
```

- [ ] **Step 3: 在 PostCard 中显示标签 badge**

在 PostCard 的内容区域，添加标签显示：

```tsx
{post.labels && post.labels.length > 0 && (
  <div className="flex flex-wrap gap-1 mt-1">
    {post.labels.map(l => (
      <span key={l.id} className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
        {l.name}
      </span>
    ))}
  </div>
)}
```

- [ ] **Step 4: 激活"更多筛选"按钮，添加标签和加星筛选**

将现有的静态"更多筛选"按钮改为功能按钮，展开后显示标签列表和加星开关。具体实现根据现有组件库（HeroUI）选择合适的 Popover/Checkbox 组件。

- [ ] **Step 5: 确保 apiDelete 已从 client.ts 导出**

检查 `packages/ui/src/api/client.ts` 是否导出 `apiDelete`。如果没有，添加：

```typescript
export async function apiDelete<T = void>(path: string): Promise<T> {
  return apiRequest<T>(path, { method: 'DELETE' });
}
```

- [ ] **Step 6: 构建验证**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/pages/PostLibrary.tsx packages/ui/src/api/client.ts
git commit -m "feat(ui): add star and label display/filter to PostLibrary"
```

---

### Task 8: SKILL.md 更新

**Files:**
- Modify: `skills/SKILL.md`

- [ ] **Step 1: 在 SKILL.md 中添加标签和星标命令**

在 Phase 5 Results & Management 表格末尾添加：

```
| 20 | **star_post** | `scopai post star <post-id>` | Star a post for quick access. |
| 21 | **unstar_post** | `scopai post unstar <post-id>` | Remove star from a post. |
| 22 | **tag_post** | `scopai post tag <post-id> --labels 高价值,待跟进` | Add labels to a post (auto-creates labels). |
| 23 | **untag_post** | `scopai post untag <post-id> --label-id <id>` | Remove a label from a post. |
| 24 | **list_labels** | `scopai label list` | List all labels with post counts. |
| 25 | **create_label** | `scopai label create --name <name> [--color <hex>]` | Create a label. |
| 26 | **delete_label** | `scopai label delete --id <id>` | Delete a label and its post associations. |
```

在 `post list` 描述中添加 `--starred` 和 `--label` 过滤说明。

- [ ] **Step 2: Commit**

```bash
git add skills/SKILL.md
git commit -m "docs: add star and label commands to SKILL.md"
```
