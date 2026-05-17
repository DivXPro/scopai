# Cover Image 本地存储实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 worker prepare-data 流程中自动将帖子 cover image 下载到本地存储，UI 优先使用本地文件避免 URL 过期。

**Architecture:** 给 `posts` 表新增 `cover_local_path` 字段；在 worker `fetch_media` 步骤后追加纯 HTTP cover 下载逻辑；新增 `/api/posts/:id/cover` 路由服务本地文件；UI 中 `<img>` 优先请求本地端点，fallback 到原始 URL。

**Tech Stack:** TypeScript, Node.js 20+ (native fetch), DuckDB, Fastify, React

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `packages/core/src/db/schema.sql` | posts 表增加 `cover_local_path` 字段 |
| `packages/core/src/db/migrate.ts` | 新增迁移函数 `migrateCoverLocalPathColumn` |
| `packages/core/src/shared/types.ts` | `Post` 接口增加 `cover_local_path` |
| `packages/core/src/db/posts.ts` | `parsePost`/`createPost`/`updatePost` 支持新字段 |
| `packages/core/src/shared/media-download.ts` | 新增 `downloadImage` 工具函数 |
| `packages/api/src/worker/consumer.ts` | Step 3 后追加 cover 下载逻辑 |
| `packages/api/src/routes/posts.ts` | 新增 `GET /posts/:id/cover` 路由 |
| `packages/ui/src/pages/PostLibrary.tsx` | `img src` 优先本地、fallback 原始 URL |

---

## Task 1: 数据库 Schema 与迁移

**Files:**
- Modify: `packages/core/src/db/schema.sql`
- Modify: `packages/core/src/db/migrate.ts`
- Modify: `packages/core/src/shared/types.ts`
- Modify: `packages/core/src/db/posts.ts`

- [ ] **Step 1: schema.sql 增加字段**

在 `posts` 表定义中 `cover_url` 行之后增加：

```sql
    cover_local_path    TEXT,
```

- [ ] **Step 2: migrate.ts 增加迁移函数**

在 `migrateIsStarredColumn` 之后、 `migrateLabelsTables` 之前新增：

```typescript
async function migrateCoverLocalPathColumn(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'posts'"
  );
  if (!columns.some(c => c.name === 'cover_local_path')) {
    await exec('ALTER TABLE posts ADD COLUMN cover_local_path TEXT');
  }
}
```

在 `runMigrations` 中 `migrateLabelsTables()` 之前插入调用：

```typescript
  await migrateCoverLocalPathColumn();
```

- [ ] **Step 3: types.ts Post 接口增加字段**

在 `Post` 接口中 `cover_url` 之后增加：

```typescript
  cover_local_path: string | null;
```

- [ ] **Step 4: posts.ts 支持新字段**

在 `parsePost` 函数中增加：

```typescript
    cover_local_path: row.cover_local_path as string | null ?? null,
```

在 `createPost` 的 INSERT 语句中：
- 列列表 `cover_url` 之后增加 `cover_local_path`
- VALUES 对应位置增加 `post.cover_local_path`
- 参数数组对应位置增加 `post.cover_local_path`

在 `updatePost` 的字段更新链中，在 `cover_url` 之后增加：

```typescript
  if (updates.cover_local_path !== undefined) { fields.push('cover_local_path = ?'); params.push(updates.cover_local_path); }
```

- [ ] **Step 5: 验证类型编译**

Run: `pnpm build`
Expected: 编译通过（无 `cover_local_path` 相关类型错误）

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db/schema.sql packages/core/src/db/migrate.ts packages/core/src/shared/types.ts packages/core/src/db/posts.ts
git commit -m "feat(db): add cover_local_path column to posts table"
```

---

## Task 2: 下载工具函数

**Files:**
- Create: `packages/core/src/shared/media-download.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 创建下载工具**

`packages/core/src/shared/media-download.ts`:

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function downloadImage(url: string, destPath: string): Promise<string> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }

  const dir = path.dirname(destPath);
  await fs.mkdir(dir, { recursive: true });

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destPath, buffer);

  return destPath;
}
```

- [ ] **Step 2: 导出工具函数**

在 `packages/core/src/index.ts` 中增加导出：

```typescript
export { downloadImage } from './shared/media-download';
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/shared/media-download.ts packages/core/src/index.ts
git commit -m "feat(core): add downloadImage utility for HTTP image fetching"
```

---

## Task 3: Worker Cover 下载逻辑

**Files:**
- Modify: `packages/api/src/worker/consumer.ts`

- [ ] **Step 1: 导入下载工具**

在 consumer.ts 的 import 区块增加：

```typescript
import { downloadImage } from '@scopai/core';
```

- [ ] **Step 2: 在 fetch_media 后追加 cover 下载**

在 Step 3 `fetch_media` 的代码块末尾（`Auto-set cover_url from first downloaded image` 逻辑之后，`} else {` 之前），增加：

```typescript
      // Download cover image to local storage if post has cover_url but no local backup
      const postAfterMedia = await getPostById(postId);
      if (postAfterMedia?.cover_url && !postAfterMedia.cover_local_path) {
        try {
          const coverDir = path.join(config.paths.download_dir, platformDir, noteId ?? postId);
          const coverPath = path.join(coverDir, 'cover.jpg');
          await downloadImage(postAfterMedia.cover_url, coverPath);
          await updatePost(postId, { cover_local_path: coverPath });
          logger.info(`[Worker-${workerId}] Post ${postId}: downloaded cover image to ${coverPath}`);
        } catch (coverErr: unknown) {
          const msg = coverErr instanceof Error ? coverErr.message : String(coverErr);
          logger.warn(`[Worker-${workerId}] Post ${postId}: failed to download cover image: ${msg}`);
          // Non-fatal: cover download failure should not block the prepare job
        }
      }
```

注意这段代码要放在 `if (fetchMediaTemplate) { ... }` 的闭合大括号之前，即 media 下载成功后的同一个分支内。

- [ ] **Step 3: 验证编译**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/worker/consumer.ts
git commit -m "feat(worker): download cover image to local storage after fetch_media"
```

---

## Task 4: API Cover 文件服务路由

**Files:**
- Modify: `packages/api/src/routes/posts.ts`
- Modify: `packages/api/src/routes/index.ts`

- [ ] **Step 1: 新增 /posts/:id/cover 路由**

在 `packages/api/src/routes/posts.ts` 中，在 `app.get('/posts/:id/analysis', ...)` 之前或之后，增加：

```typescript
  app.get('/posts/:id/cover', async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = await getPostById(id);
    if (!post || !post.cover_local_path) {
      reply.code(404);
      return { error: 'Cover not found' };
    }

    const abs = path.resolve(post.cover_local_path);
    const allowedRoots = [config.paths.media_dir, config.paths.download_dir]
      .filter((r): r is string => Boolean(r))
      .map((r) => path.resolve(r));

    if (!allowedRoots.some((root) => {
      const rootPrefixed = root.endsWith(path.sep) ? root : root + path.sep;
      return abs === root || abs.startsWith(rootPrefixed);
    })) {
      reply.code(403);
      return { error: 'Forbidden path' };
    }

    const { existsSync, createReadStream, statSync } = await import('node:fs');
    if (!existsSync(abs)) {
      reply.code(404);
      return { error: 'Cover file missing on disk' };
    }

    const stat = statSync(abs);
    const mimeByExt: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    };
    const ext = path.extname(abs).toLowerCase();
    const mime = mimeByExt[ext] ?? 'image/jpeg';

    reply.header('Content-Type', mime);
    reply.header('Content-Length', String(stat.size));
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(createReadStream(abs));
  });
```

同时在文件顶部 import 中增加 `path` 和 `config`：

```typescript
import * as path from 'node:path';
```

确认 `config` 已在 import 列表中（从 `@scopai/core`）。

- [ ] **Step 2: 确认路由已注册**

检查 `packages/api/src/routes/index.ts` 中 `postsRoutes` 是否已注册（应该是已注册的）。

- [ ] **Step 3: 验证编译**

Run: `pnpm build`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add packages/api/src/routes/posts.ts
git commit -m "feat(api): add /posts/:id/cover endpoint for local cover image serving"
```

---

## Task 5: UI 优先使用本地 Cover

**Files:**
- Modify: `packages/ui/src/pages/PostLibrary.tsx`

- [ ] **Step 1: 修改 Post 类型定义**

在 `PostLibrary.tsx` 中本地定义的 Post 类型（或接口）中，在 `cover_url` 之后增加：

```typescript
  cover_local_path: string | null;
```

- [ ] **Step 2: 修改 img src 逻辑**

找到：

```tsx
        {post.cover_url ? (
          <div className="relative rounded-lg overflow-hidden mb-4 aspect-[4/3] cursor-pointer" onClick={() => onViewMedia(post.id)}>
            <img
              src={post.cover_url}
```

改为优先使用本地 cover 端点：

```tsx
        {post.cover_url || post.cover_local_path ? (
          <div className="relative rounded-lg overflow-hidden mb-4 aspect-[4/3] cursor-pointer" onClick={() => onViewMedia(post.id)}>
            <img
              src={post.cover_local_path ? `/api/posts/${post.id}/cover` : post.cover_url!}
```

同时修改条件判断：原来 `post.cover_url ? (` 改为 `(post.cover_url || post.cover_local_path) ? (`

- [ ] **Step 3: 验证 UI 编译**

Run: `pnpm --filter @scopai/ui build`
Expected: 编译通过

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/pages/PostLibrary.tsx
git commit -m "feat(ui): prefer local cover image endpoint over remote URL"
```

---

## Task 6: 集成验证

- [ ] **Step 1: 运行 API e2e 测试**

Run: `pnpm --filter @scopai/api test:e2e`
Expected: 全部通过（46 tests），无回归

- [ ] **Step 2: 运行根级测试**

Run: `pnpm test`
Expected: 全部通过

- [ ] **Step 3: 端到端手动验证（可选）**

1. 启动 API server: `pnpm --filter @scopai/api dev`
2. 启动 UI dev server: `pnpm --filter @scopai/ui dev`
3. 导入一个带 cover_url 的帖子
4. 触发 task prepare-data，观察 worker 日志中 `downloaded cover image to ...`
5. 在 PostLibrary 中确认 cover 图片正常显示
6. 检查 `download_dir/{platform}/{noteId}/cover.jpg` 文件存在

---

## Self-Review

**Spec coverage check:**
- [x] Schema 变更 — Task 1
- [x] 类型更新 — Task 1
- [x] CRUD 支持 — Task 1
- [x] HTTP 下载工具 — Task 2
- [x] Worker 下载逻辑 — Task 3
- [x] API 文件服务 — Task 4
- [x] UI 优先本地 — Task 5
- [x] 测试验证 — Task 6

**Placeholder scan:** 无 TBD/TODO/占位符。

**Type consistency:** `cover_local_path` 统一为 `string | null`，在 Post 接口、parsePost、createPost、updatePost、UI 类型中一致。

**Scope check:** 本计划聚焦 cover 本地存储，不涉及 media_files 表改造、不涉及其他平台字段变更。
