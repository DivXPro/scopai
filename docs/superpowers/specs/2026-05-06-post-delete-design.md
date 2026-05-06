# 帖子删除功能设计

## 背景

当前系统支持帖子的导入、展示、分析，但**没有任何删除能力**。帖子在数据库中累积了评论、媒体文件、标签、分析结果等大量关联数据，占用 DB 和磁盘空间，且用户没有清理手段。

同时，数据库中 `comments`、`media_files`、`post_labels` 三张表通过 `REFERENCES posts(id)` 内联约束限制了帖子直接删除，DuckDB 会在 DELETE 时校验外键。`task_post_status`、`task_targets`、`queue_jobs` 以及策略动态结果表也有 `post_id` 关联字段，但无 FK 约束，会残留孤儿行。

## 目标

实现帖子删除功能，连带清理所有关联数据：

1. **数据库级联**：评论、媒体文件元数据、标签、任务状态、任务目标、队列任务、策略分析结果
2. **磁盘清理**：下载的媒体文件（图片/视频）
3. **三层入口**：CLI 命令、API 路由、Web UI 删除按钮
4. **删除确认**：防止误操作

## 方案：应用层显式级联删除（事务包裹）

不改动 schema，在单事务内按依赖顺序逐表 DELETE，事务提交后同步清理磁盘文件。

### 选择理由

- 最安全：事务回滚保证 DB 一致性
- 不改 schema：不引入 migration 风险，不改已有 FK 约束
- 路径安全：磁盘删除前做白名单校验
- 与现有代码风格一致（`creators.ts` 硬删、`media.ts` 路径校验）

## 详细设计

### 1. Core DB 层

**文件**：`packages/core/src/db/posts.ts`

新增 `deletePostById(db, postId)`：

1. **预查媒体路径**：`SELECT local_path FROM media_files WHERE post_id = ?`
2. **开启事务** `BEGIN TRANSACTION`
3. **按依赖顺序删除**（子表 → 父表）：
   - `DELETE FROM post_labels WHERE post_id = ?`
   - `DELETE FROM comments WHERE post_id = ?`
   - `DELETE FROM media_files WHERE post_id = ?`
   - `DELETE FROM task_post_status WHERE post_id = ?`
   - `DELETE FROM task_targets WHERE target_type = 'post' AND target_id = ?`
   - `DELETE FROM queue_jobs WHERE target_type = 'post' AND target_id = ?`
   - 遍历所有策略：`DELETE FROM strategy_{id} WHERE post_id = ?`
   - `DELETE FROM posts WHERE id = ?`（最后，检查 `changes === 0` 则抛错）
4. **提交** `COMMIT`
5. **磁盘清理**：遍历预查的 `local_path`，`isInsideRoot` 校验后 `fs.unlink`，失败只 warn 不影响整体成功

异常时 `ROLLBACK`，抛出原始错误。

### 2. API 路由

**文件**：`packages/api/src/routes/posts.ts`

在 `GET /posts/:id` 之后插入：

```
DELETE /posts/:id
```

- 先用 `getPostById` 检查存在性，不存在则 404
- 调用 `deletePostById(db, id)`
- 返回 `{ success: true, deleted: id }`

复用现有 `DELETE /posts/:id/labels/:labelId` 的 404 处理范式。

### 3. CLI 命令

**文件**：`packages/cli/src/post.ts`

新增子命令 `post delete --id <id>`：

- `requiredOption('--id <id>')`
- 交互确认：`Are you sure you want to delete post {id}? (y/N)`
- 确认后调用 `apiDelete(`/posts/${opts.id}`)`
- 成功/失败分别 green/red 输出
- 取消时 gray 输出

复用现有 `apiDelete`（`api-client.ts` 已 import）。

### 4. UI 删除入口

**文件**：`packages/ui/src/pages/PostLibrary.tsx`

在 `MediaFilesModal` 底部操作栏（星标按钮旁）增加红色"删除帖子"按钮：

- `variant="destructive"`
- onClick 触发 `confirm('确认删除帖子？此操作不可恢复，将同时删除评论、媒体文件和分析数据。')`
- 确认后调用 `apiDelete(`/api/posts/${post.id}`)`
- 成功后关闭 modal 并刷新列表

`apiDelete` 已在 `api/client.ts` 导出。

### 5. 错误处理与边界

| 场景 | 处理 |
|---|---|
| **并发删除** | 第二次 `getPostById` 返回 404，幂等安全 |
| **磁盘文件已不存在** | 警告日志，不影响整体删除成功 |
| **路径安全** | `isInsideRoot(path, [mediaDir, downloadDir])` 校验，防止路径遍历攻击 |
| **策略结果表不存在** | 某些策略可能从未产生过结果表，`DELETE FROM strategy_x` 时忽略"表不存在"错误 |
| **事务失败** | `ROLLBACK`，所有 DB 变更回滚，磁盘文件不执行删除 |

### 6. 测试

**API e2e**（`packages/api/test/e2e/posts.test.ts`）：

- 正常删除：import → DELETE 200 → GET 404
- 重复删除：第二次 DELETE 404
- 级联验证：带 media/comments/labels 的帖子删除后，关联表记录为空，磁盘文件不存在

## 影响面

- `packages/core/src/db/posts.ts`：新增 `deletePostById`
- `packages/api/src/routes/posts.ts`：新增 DELETE 路由
- `packages/cli/src/post.ts`：新增 `delete` 子命令
- `packages/ui/src/pages/PostLibrary.tsx`：新增删除按钮
- `packages/api/test/e2e/posts.test.ts`：新增 e2e 用例
