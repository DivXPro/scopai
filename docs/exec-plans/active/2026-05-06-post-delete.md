# 帖子删除功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现帖子级联删除功能，连带清理评论、媒体文件元数据、标签、任务状态、任务目标、队列任务、策略分析结果及磁盘媒体文件。

**Architecture:** 应用层显式级联删除，单事务包裹全部 DB 操作，事务提交后同步清理磁盘文件。不改 schema，不引入 ON DELETE CASCADE。

**Tech Stack:** TypeScript, DuckDB, Fastify, Commander.js, React 19 + HeroUI

---

## File Structure

| 文件 | 动作 | 职责 |
|------|------|------|
| `packages/core/src/db/posts.ts` | 修改 | 新增 `deletePostById`（事务级联 + 磁盘清理） |
| `packages/api/src/routes/posts.ts` | 修改 | 新增 `DELETE /posts/:id` 路由 |
| `packages/cli/src/post.ts` | 修改 | 新增 `post delete --id` 子命令（含确认交互） |
| `packages/ui/src/pages/PostLibrary.tsx` | 修改 | 在 `MediaFilesModal` 底部操作栏添加删除按钮 |
| `packages/api/test/e2e/posts.test.ts` | 修改 | 新增 DELETE 路由 e2e 测试（正常删除 + 重复删除 + 级联验证） |

---

## Task 1: Write failing e2e test for DELETE /posts/:id

**Files:**
- Modify: `packages/api/test/e2e/posts.test.ts`

- [ ] **Step 1: 在 posts.test.ts 末尾添加 DELETE 测试 suite**

在文件末尾（line 131 `});` 之后）添加：

```typescript
  describe('DELETE /api/posts/:id', () => {
    it('deletes a post and returns 200', async () => {
      const importRes = await fetchApi(ctx.baseUrl, '/api/posts/import', {
        method: 'POST',
        body: JSON.stringify({
          posts: [
            {
              platform_id: 'xhs',
              platform_post_id: 'post-to-delete',
              title: 'Post To Delete',
              content: 'Will be deleted',
            },
          ],
        }),
      });
      const importBody = await importRes.json();
      const postId = importBody.postIds[0];

      const deleteRes = await fetchApi(ctx.baseUrl, `/api/posts/${postId}`, {
        method: 'DELETE',
      });
      assert.equal(deleteRes.status, 200);
      const deleteBody = await deleteRes.json();
      assert.equal(deleteBody.success, true);
      assert.equal(deleteBody.deleted, postId);

      const getRes = await fetchApi(ctx.baseUrl, `/api/posts/${postId}`);
      assert.equal(getRes.status, 404);
    });

    it('returns 404 for non-existent post', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/posts/non-existent-id', {
        method: 'DELETE',
      });
      assert.equal(res.status, 404);
    });
  });
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @scopai/api test:e2e`

Expected: FAIL — `DELETE /api/posts/:id` 返回 404（路由不存在）

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/api/test/e2e/posts.test.ts
git commit -m "test(e2e): add failing tests for post deletion

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Implement deletePostById in core DB layer

**Files:**
- Modify: `packages/core/src/db/posts.ts`

- [ ] **Step 1: 在 posts.ts 顶部添加导入**

在现有导入之后添加：

```typescript
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { config } from '../config';
import { listStrategies, getStrategyResultTableName } from './strategies';
```

- [ ] **Step 2: 在文件末尾（updatePost 之后）添加 deletePostById 函数**

```typescript
function isInsideAllowedRoots(absPath: string, roots: string[]): boolean {
  for (const rootAbs of roots) {
    if (!rootAbs) continue;
    const root = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
    if (absPath === rootAbs || absPath.startsWith(root)) return true;
  }
  return false;
}

export async function deletePostById(postId: string): Promise<void> {
  const post = await getPostById(postId);
  if (!post) {
    throw new Error(`Post ${postId} not found`);
  }

  // Pre-collect media file paths and strategies outside transaction
  const mediaRows = await query<{ local_path: string | null }>(
    'SELECT local_path FROM media_files WHERE post_id = ?',
    [postId],
  );
  const mediaPaths = mediaRows.map((r) => r.local_path).filter((p): p is string => Boolean(p));

  const strategies = await listStrategies();

  // Transaction-based cascade delete (child tables first)
  await run('BEGIN TRANSACTION');
  try {
    await run('DELETE FROM post_labels WHERE post_id = ?', [postId]);
    await run('DELETE FROM comments WHERE post_id = ?', [postId]);
    await run('DELETE FROM media_files WHERE post_id = ?', [postId]);
    await run('DELETE FROM task_post_status WHERE post_id = ?', [postId]);
    await run(`DELETE FROM task_targets WHERE target_type = 'post' AND target_id = ?`, [postId]);
    await run(`DELETE FROM queue_jobs WHERE target_type = 'post' AND target_id = ?`, [postId]);

    for (const strategy of strategies) {
      const tableName = getStrategyResultTableName(strategy.id);
      try {
        await run(`DELETE FROM "${tableName}" WHERE post_id = ?`, [postId]);
      } catch {
        // Strategy result table may not exist yet, ignore
      }
    }

    await run('DELETE FROM posts WHERE id = ?', [postId]);
    await run('COMMIT');
  } catch (err) {
    await run('ROLLBACK').catch(() => {});
    throw err;
  }

  // Clean up disk files after successful transaction
  const allowedRoots = [config.paths.media_dir, config.paths.download_dir]
    .filter((r): r is string => Boolean(r))
    .map((r) => path.resolve(r));

  for (const filePath of mediaPaths) {
    const absPath = path.resolve(filePath);
    if (isInsideAllowedRoots(absPath, allowedRoots)) {
      try {
        await fs.unlink(absPath);
      } catch {
        // File may not exist or may be already deleted, ignore
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/db/posts.ts
git commit -m "feat(core): add deletePostById with transaction cascade and disk cleanup

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Add DELETE /posts/:id API route

**Files:**
- Modify: `packages/api/src/routes/posts.ts`

- [ ] **Step 1: 在导入列表中添加 deletePostById**

找到这行：
```typescript
  getOrCreateLabel, addPostLabel, removePostLabel, getPostLabels,
```

在其前面添加 `deletePostById,`：

```typescript
import {
  listPosts, searchPosts, listCommentsByPost, listMediaFilesByPost,
  getPostAnalysisResults, getPostById, countPosts, createComment,
  countPostAnalysisResults, countMediaFilesByPost,
  deletePostById,
  getOrCreateLabel, addPostLabel, removePostLabel, getPostLabels,
  setPostStarred, listPostsByLabel, listStarredPostIds, getLabelByName,
} from '@scopai/core';
```

- [ ] **Step 2: 在 GET /posts/:id 之后插入 DELETE 路由**

在 `app.get('/posts/:id', ...)`（line 164-172）之后、`app.get('/posts/:id/comments', ...)`（line 174）之前插入：

```typescript
  app.delete('/posts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = await getPostById(id);
    if (!post) {
      reply.code(404);
      throw new Error(`Post not found: ${id}`);
    }
    await deletePostById(id);
    return { success: true, deleted: id };
  });
```

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/posts.ts
git commit -m "feat(api): add DELETE /posts/:id route

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Run e2e tests to verify core + API

- [ ] **Step 1: 运行 e2e 测试**

Run: `pnpm --filter @scopai/api test:e2e`

Expected: PASS — 所有现有测试通过 + 新增 DELETE 测试通过

- [ ] **Step 2: 如有失败则修复**

常见失败原因：
- `deletePostById` 导入路径错误（检查是否从 `@scopai/core` 正确导出）
- DuckDB 事务语法问题（检查 BEGIN TRANSACTION / COMMIT / ROLLBACK）
- `isInsideAllowedRoots` 路径匹配问题

---

## Task 5: Add CLI post delete command

**Files:**
- Modify: `packages/cli/src/post.ts`

- [ ] **Step 1: 在 post.ts 末尾（untag 命令之后）添加 delete 子命令**

在 line 196 `});` 之后、line 197 `}` 之前插入：

```typescript

  post
    .command('delete')
    .description('Delete a post and all associated data')
    .requiredOption('--id <id>', 'Post ID')
    .action(async (opts: { id: string }) => {
      process.stdout.write(pc.yellow(`Are you sure you want to delete post ${opts.id}? (y/N) `));
      const answer = await new Promise<string>((resolve) => {
        process.stdin.once('data', (data) => resolve(data.toString().trim().toLowerCase()));
      });
      if (answer !== 'y') {
        console.log(pc.gray('Cancelled.'));
        return;
      }
      try {
        await apiDelete<{ success: boolean; deleted: string }>(`/posts/${opts.id}`);
        console.log(pc.green(`Post ${opts.id} deleted.`));
      } catch (err: unknown) {
        console.error(pc.red(`Failed: ${(err as Error).message}`));
        process.exit(1);
      }
    });
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/src/post.ts
git commit -m "feat(cli): add post delete command with confirmation prompt

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Add UI delete button in MediaFilesModal

**Files:**
- Modify: `packages/ui/src/pages/PostLibrary.tsx`

- [ ] **Step 1: 在 MediaFilesModal 组件签名中添加 onDelete prop**

找到 line 416：
```typescript
function MediaFilesModal({ post, onClose, onToggleStar }: { post: Post; onClose: () => void; onToggleStar: (postId: string, currentStarred: boolean) => void }) {
```

修改为：
```typescript
function MediaFilesModal({ post, onClose, onToggleStar, onDelete }: { post: Post; onClose: () => void; onToggleStar: (postId: string, currentStarred: boolean) => void; onDelete: (postId: string) => void }) {
```

- [ ] **Step 2: 在底部操作栏添加删除按钮**

找到 line 636-648 的底部操作栏：
```tsx
                {/* 底部操作栏 */}
                <div className="shrink-0 border-t border-slate-200 p-3 flex items-center justify-between bg-white">
                  <button
                    onClick={() => onToggleStar(post.id, post.is_starred)}
                    ...
                  </button>
                </div>
```

修改为（在 `</div>` 闭合标签前添加删除按钮）：

```tsx
                {/* 底部操作栏 */}
                <div className="shrink-0 border-t border-slate-200 p-3 flex items-center justify-between bg-white">
                  <button
                    onClick={() => onToggleStar(post.id, post.is_starred)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:bg-slate-50"
                  >
                    <span className={post.is_starred ? 'text-yellow-500 text-lg' : 'text-gray-400 text-lg'}>
                      {post.is_starred ? '★' : '☆'}
                    </span>
                    <span className={post.is_starred ? 'text-slate-900' : 'text-slate-500'}>
                      {post.is_starred ? '已星标' : '星标'}
                    </span>
                  </button>
                  <Button
                    color="danger"
                    variant="flat"
                    size="sm"
                    onPress={() => {
                      if (!confirm('确认删除帖子？此操作不可恢复，将同时删除评论、媒体文件和分析数据。')) return;
                      onDelete(post.id);
                    }}
                  >
                    删除帖子
                  </Button>
                </div>
```

- [ ] **Step 3: 在 PostLibrary 主组件中添加 handleDeletePost 回调**

在 `toggleStar` 回调附近（查找 `const toggleStar = useCallback`）添加 `handleDeletePost`：

```typescript
  const handleDeletePost = useCallback(async (postId: string) => {
    try {
      await apiDelete(`/api/posts/${postId}`);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
      setTotal((prev) => Math.max(0, prev - 1));
      setViewingMediaPostId(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败');
    }
  }, []);
```

- [ ] **Step 4: 将 onDelete prop 传给 MediaFilesModal**

找到 line 1186-1190：
```tsx
        <MediaFilesModal
          post={posts.find((p) => p.id === viewingMediaPostId)!}
          onClose={() => setViewingMediaPostId(null)}
          onToggleStar={toggleStar}
        />
```

修改为：
```tsx
        <MediaFilesModal
          post={posts.find((p) => p.id === viewingMediaPostId)!}
          onClose={() => setViewingMediaPostId(null)}
          onToggleStar={toggleStar}
          onDelete={handleDeletePost}
        />
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/pages/PostLibrary.tsx
git commit -m "feat(ui): add delete post button in MediaFilesModal

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Add comprehensive cascade e2e test

**Files:**
- Modify: `packages/api/test/e2e/posts.test.ts`

- [ ] **Step 1: 在现有的 DELETE test suite 中添加级联验证测试**

在 Task 1 添加的 DELETE suite 中，在 "returns 404 for non-existent post" 测试之后添加：

```typescript
    it('cascades deletion to comments and media', async () => {
      const importRes = await fetchApi(ctx.baseUrl, '/api/posts/import', {
        method: 'POST',
        body: JSON.stringify({
          posts: [
            {
              platform_id: 'xhs',
              platform_post_id: 'post-with-comments',
              title: 'Post With Comments',
              content: 'Content',
            },
          ],
        }),
      });
      const importBody = await importRes.json();
      const postId = importBody.postIds[0];

      // Import a comment
      await fetchApi(ctx.baseUrl, `/api/posts/${postId}/comments/import`, {
        method: 'POST',
        body: JSON.stringify({
          platform: 'xhs',
          comments: [
            {
              platform_comment_id: 'comment-1',
              content: 'Nice post',
              author_name: 'user1',
            },
          ],
        }),
      });

      // Delete the post
      const deleteRes = await fetchApi(ctx.baseUrl, `/api/posts/${postId}`, {
        method: 'DELETE',
      });
      assert.equal(deleteRes.status, 200);

      // Post should be gone
      const getRes = await fetchApi(ctx.baseUrl, `/api/posts/${postId}`);
      assert.equal(getRes.status, 404);

      // Comments should be gone
      const commentsRes = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/comments`);
      assert.equal(commentsRes.status, 200);
      const commentsBody = await commentsRes.json();
      assert.equal(Array.isArray(commentsBody) ? commentsBody.length : commentsBody.comments?.length, 0);

      // Media should be empty
      const mediaRes = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/media`);
      assert.equal(mediaRes.status, 200);
      const mediaBody = await mediaRes.json();
      assert.equal(Array.isArray(mediaBody) ? mediaBody.length : mediaBody.length, 0);
    });
```

- [ ] **Step 2: 运行 e2e 测试确认通过**

Run: `pnpm --filter @scopai/api test:e2e`

Expected: PASS — 所有测试通过，包括级联验证

- [ ] **Step 3: Commit**

```bash
git add packages/api/test/e2e/posts.test.ts
git commit -m "test(e2e): add cascade deletion verification test

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Build and final verification

- [ ] **Step 1: 构建整个项目**

Run: `pnpm build`

Expected: 无 TypeScript 编译错误

- [ ] **Step 2: 运行 API e2e 测试全量验证**

Run: `pnpm --filter @scopai/api test:e2e`

Expected: 全部通过

- [ ] **Step 3: 运行 CLI 快速验证（可选）**

确保 daemon 已启动后：
```bash
# 导入一个测试帖子
scopai post import --platform xhs --file /path/to/test-post.json
# 列出帖子获取 ID
scopai post list --platform xhs --limit 1
# 删除帖子（输入 n 取消，输入 y 确认）
scopai post delete --id <post-id>
```

- [ ] **Step 4: 最终 commit（如需）**

```bash
git commit -m "feat: implement post deletion with cascade cleanup

- Transaction-based cascade delete for comments, media_files, labels,
  task_post_status, task_targets, queue_jobs, and strategy result tables
- Synchronous disk file cleanup with path safety validation
- API route DELETE /posts/:id
- CLI command post delete --id with confirmation prompt
- UI delete button in MediaFilesModal with confirm dialog
- E2E tests for deletion and cascade verification

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review

### 1. Spec coverage check

| Spec 要求 | 对应 Task |
|-----------|----------|
| Core DB: `deletePostById` 事务级联删除 | Task 2 |
| Core DB: 磁盘文件清理 + 路径安全 | Task 2 |
| API: `DELETE /posts/:id` 路由 | Task 3 |
| CLI: `post delete --id` + 确认交互 | Task 5 |
| UI: `MediaFilesModal` 删除按钮 + confirm | Task 6 |
| 测试: 正常删除 + 404 + 级联验证 | Task 1, 7 |
| 错误处理: 并发删除幂等 | Task 3 (getPostById 检查) |
| 错误处理: 磁盘文件不存在忽略 | Task 2 (catch + ignore) |
| 错误处理: 策略表不存在忽略 | Task 2 (catch + ignore) |
| 错误处理: 事务失败回滚 | Task 2 (ROLLBACK) |

**覆盖完整，无遗漏。**

### 2. Placeholder scan

- 无 "TBD", "TODO", "implement later"
- 所有代码块包含完整可运行代码
- 所有命令包含精确执行路径和预期输出

### 3. Type consistency check

| 类型/签名 | 定义位置 | 使用位置 |
|-----------|---------|---------|
| `deletePostById(postId: string): Promise<void>` | Task 2 (core) | Task 3 (API import), Task 4 (测试) |
| `DELETE /posts/:id` → `{ success: true, deleted: id }` | Task 3 (API) | Task 1 (e2e 断言), Task 5 (CLI) |
| `apiDelete<T>(path: string): Promise<T>` | 现有代码 | Task 5 (CLI), Task 6 (UI) |
| `MediaFilesModal` props: `onDelete: (postId: string) => void` | Task 6 (UI) | Task 6 (PostLibrary 回调) |

**类型一致。**

### 4. 已知限制

- 空媒体目录（如 `~/.scopai/downloads/xhs/noteId/`）在文件删除后不会被清理，可能残留空目录
- `queue_jobs` 中 `target_type='comment'` 的 job 不会被级联删除（这些 comment 的 job 关联的是 comment ID 而非 post ID）
- 以上限制不影响核心功能，如需处理可作为后续优化
