import { query, run } from './client';
import { Post } from '../shared/types';
import { generateId, now } from '../shared/utils';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { config } from '../config';
import { listStrategies, getStrategyResultTableName } from './strategies';

function parsePost(row: Record<string, unknown>): Post {
  return {
    ...row,
    cover_local_path: (row.cover_local_path as string | null) ?? null,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : row.tags,
    media_files: typeof row.media_files === 'string' ? JSON.parse(row.media_files) : row.media_files,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
  } as Post;
}

function parsePosts(rows: Record<string, unknown>[]): Post[] {
  return rows.map(parsePost);
}

export async function createPost(post: Omit<Post, 'id' | 'fetched_at'>): Promise<Post> {
  const id = generateId();
  const ts = now();
  await run(
    `INSERT INTO posts (id, platform_id, platform_post_id, title, content, author_id, author_name,
     author_url, url, cover_url, cover_local_path, post_type, like_count, collect_count, comment_count,
     share_count, play_count, score, tags, media_files, published_at, fetched_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, post.platform_id, post.platform_post_id, post.title, post.content, post.author_id,
     post.author_name, post.author_url, post.url, post.cover_url, post.cover_local_path ?? null, post.post_type, post.like_count,
     post.collect_count, post.comment_count, post.share_count, post.play_count, post.score,
     post.tags ? JSON.stringify(post.tags) : null,
     post.media_files ? JSON.stringify(post.media_files) : null,
     post.published_at, ts, post.metadata ? JSON.stringify(post.metadata) : null]
  );
  return { ...post, id, fetched_at: ts };
}

export async function listPosts(platformId?: string, limit = 50, offset = 0): Promise<Post[]> {
  let sql = 'SELECT * FROM posts';
  const params: unknown[] = [];
  if (platformId) { sql += ' WHERE platform_id = ?'; params.push(platformId); }
  sql += ' ORDER BY fetched_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return parsePosts(await query<Record<string, unknown>>(sql, params));
}

export async function getPostById(id: string): Promise<Post | null> {
  const rows = await query<Record<string, unknown>>('SELECT * FROM posts WHERE id = ?', [id]);
  return rows[0] ? parsePost(rows[0]) : null;
}

export async function getPostByPlatformPostId(platformPostId: string, platformId?: string): Promise<Post | null> {
  let sql = 'SELECT * FROM posts WHERE platform_post_id = ?';
  const params: unknown[] = [platformPostId];
  if (platformId) {
    sql += ' AND platform_id = ?';
    params.push(platformId);
  }
  const rows = await query<Record<string, unknown>>(sql, params);
  return rows[0] ? parsePost(rows[0]) : null;
}

export async function searchPosts(platformId: string, queryText: string, limit = 50, offset = 0): Promise<Post[]> {
  if (platformId) {
    return parsePosts(await query<Record<string, unknown>>(
      `SELECT * FROM posts WHERE platform_id = ? AND content LIKE ? ORDER BY fetched_at DESC LIMIT ? OFFSET ?`,
      [platformId, `%${queryText}%`, limit, offset]
    ));
  }
  return parsePosts(await query<Record<string, unknown>>(
    `SELECT * FROM posts WHERE content LIKE ? ORDER BY fetched_at DESC LIMIT ? OFFSET ?`,
    [`%${queryText}%`, limit, offset]
  ));
}

export async function queryPosts(platformId: string, whereClause: string, limit = 1000): Promise<Post[]> {
  return parsePosts(await query<Record<string, unknown>>(
    `SELECT * FROM posts WHERE platform_id = ? AND ${whereClause} LIMIT ?`,
    [platformId, limit]
  ));
}

export async function listPostsByAuthor(platformId: string, authorId: string, limit = 50, offset = 0): Promise<Post[]> {
  return parsePosts(await query<Record<string, unknown>>(
    `SELECT * FROM posts WHERE platform_id = ? AND author_id = ? ORDER BY fetched_at DESC LIMIT ? OFFSET ?`,
    [platformId, authorId, limit, offset]
  ));
}

export async function countPostsByAuthor(platformId: string, authorId: string): Promise<number> {
  const rows = await query<{ cnt: bigint }>(
    'SELECT COUNT(*) as cnt FROM posts WHERE platform_id = ? AND author_id = ?',
    [platformId, authorId]
  );
  return Number(rows[0]?.cnt ?? 0);
}

export async function countPosts(platformId?: string): Promise<number> {
  const sql = platformId
    ? 'SELECT COUNT(*) as cnt FROM posts WHERE platform_id = ?'
    : 'SELECT COUNT(*) as cnt FROM posts';
  const params = platformId ? [platformId] : [];
  const rows = await query<{ cnt: bigint }>(sql, params);
  return Number(rows[0]?.cnt ?? 0);
}

export async function updatePost(id: string, updates: Partial<Omit<Post, 'id' | 'fetched_at'>>): Promise<void> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (updates.platform_id !== undefined) { fields.push('platform_id = ?'); params.push(updates.platform_id); }
  if (updates.platform_post_id !== undefined) { fields.push('platform_post_id = ?'); params.push(updates.platform_post_id); }
  if (updates.title !== undefined) { fields.push('title = ?'); params.push(updates.title); }
  if (updates.content !== undefined) { fields.push('content = ?'); params.push(updates.content); }
  if (updates.author_id !== undefined) { fields.push('author_id = ?'); params.push(updates.author_id); }
  if (updates.author_name !== undefined) { fields.push('author_name = ?'); params.push(updates.author_name); }
  if (updates.author_url !== undefined) { fields.push('author_url = ?'); params.push(updates.author_url); }
  if (updates.url !== undefined) { fields.push('url = ?'); params.push(updates.url); }
  if (updates.cover_url !== undefined) { fields.push('cover_url = ?'); params.push(updates.cover_url); }
  if (updates.cover_local_path !== undefined) { fields.push('cover_local_path = ?'); params.push(updates.cover_local_path); }
  if (updates.post_type !== undefined) { fields.push('post_type = ?'); params.push(updates.post_type); }
  if (updates.like_count !== undefined) { fields.push('like_count = ?'); params.push(updates.like_count); }
  if (updates.collect_count !== undefined) { fields.push('collect_count = ?'); params.push(updates.collect_count); }
  if (updates.comment_count !== undefined) { fields.push('comment_count = ?'); params.push(updates.comment_count); }
  if (updates.share_count !== undefined) { fields.push('share_count = ?'); params.push(updates.share_count); }
  if (updates.play_count !== undefined) { fields.push('play_count = ?'); params.push(updates.play_count); }
  if (updates.score !== undefined) { fields.push('score = ?'); params.push(updates.score); }
  if (updates.tags !== undefined) { fields.push('tags = ?'); params.push(updates.tags ? JSON.stringify(updates.tags) : null); }
  if (updates.media_files !== undefined) { fields.push('media_files = ?'); params.push(updates.media_files ? JSON.stringify(updates.media_files) : null); }
  if (updates.published_at !== undefined) { fields.push('published_at = ?'); params.push(updates.published_at); }
  if (updates.metadata !== undefined) { fields.push('metadata = ?'); params.push(updates.metadata ? JSON.stringify(updates.metadata) : null); }
  if (updates.is_starred !== undefined) { fields.push('is_starred = ?'); params.push(updates.is_starred); }

  if (fields.length === 0) return;

  // DuckDB internally switches to DELETE+INSERT when UPDATE touches too many
  // columns on rows with FK references, causing FK violations. Batch updates
  // to stay under the threshold (empirically: max 8 SET columns incl. fetched_at).
  const MAX_SET_COLUMNS = 7;
  if (fields.length > MAX_SET_COLUMNS) {
    const batch1 = fields.slice(0, MAX_SET_COLUMNS);
    const params1 = [...params.slice(0, MAX_SET_COLUMNS), now(), id];
    await run(`UPDATE posts SET ${batch1.join(', ')}, fetched_at = ? WHERE id = ?`, params1);

    const batch2 = fields.slice(MAX_SET_COLUMNS);
    const params2 = [...params.slice(MAX_SET_COLUMNS), now(), id];
    await run(`UPDATE posts SET ${batch2.join(', ')}, fetched_at = ? WHERE id = ?`, params2);
  } else {
    fields.push('fetched_at = ?');
    params.push(now());
    params.push(id);
    await run(`UPDATE posts SET ${fields.join(', ')} WHERE id = ?`, params);
  }
}

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

  // DuckDB has a known FK limitation: within a transaction, deleting a parent
  // row fails even when child rows were deleted in the same transaction.
  // Since our db client serializes all writes via withLock on a single
  // connection, we can safely cascade without an explicit transaction.
  // Delete child tables first (media_files before comments because
  // media_files.comment_id references comments.id).
  await run('DELETE FROM post_labels WHERE post_id = ?', [postId]);
  await run('DELETE FROM media_files WHERE post_id = ?', [postId]);
  await run('DELETE FROM comments WHERE post_id = ?', [postId]);
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

  // Clean up disk files after successful DB deletion
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
