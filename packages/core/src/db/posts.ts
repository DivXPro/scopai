import { query, run } from './client';
import { Post } from '../shared/types';
import { generateId, now } from '../shared/utils';

export async function createPost(post: Omit<Post, 'id' | 'fetched_at'>): Promise<Post> {
  const id = generateId();
  const ts = now();
  await run(
    `INSERT INTO posts (id, platform_id, platform_post_id, title, content, author_id, author_name,
     author_url, url, cover_url, post_type, like_count, collect_count, comment_count,
     share_count, play_count, score, tags, media_files, published_at, fetched_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, post.platform_id, post.platform_post_id, post.title, post.content, post.author_id,
     post.author_name, post.author_url, post.url, post.cover_url, post.post_type, post.like_count,
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
  return query<Post>(sql, params);
}

export async function getPostById(id: string): Promise<Post | null> {
  const rows = await query<Post>('SELECT * FROM posts WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function getPostByPlatformPostId(platformPostId: string, platformId?: string): Promise<Post | null> {
  let sql = 'SELECT * FROM posts WHERE platform_post_id = ?';
  const params: unknown[] = [platformPostId];
  if (platformId) {
    sql += ' AND platform_id = ?';
    params.push(platformId);
  }
  const rows = await query<Post>(sql, params);
  return rows[0] ?? null;
}

export async function searchPosts(platformId: string, queryText: string, limit = 50, offset = 0): Promise<Post[]> {
  if (platformId) {
    return query<Post>(
      `SELECT * FROM posts WHERE platform_id = ? AND content LIKE ? ORDER BY fetched_at DESC LIMIT ? OFFSET ?`,
      [platformId, `%${queryText}%`, limit, offset]
    );
  }
  return query<Post>(
    `SELECT * FROM posts WHERE content LIKE ? ORDER BY fetched_at DESC LIMIT ? OFFSET ?`,
    [`%${queryText}%`, limit, offset]
  );
}

export async function queryPosts(platformId: string, whereClause: string, limit = 1000): Promise<Post[]> {
  return query<Post>(
    `SELECT * FROM posts WHERE platform_id = ? AND ${whereClause} LIMIT ?`,
    [platformId, limit]
  );
}

export async function listPostsByAuthor(platformId: string, authorId: string, limit = 50, offset = 0): Promise<Post[]> {
  return query<Post>(
    `SELECT * FROM posts WHERE platform_id = ? AND author_id = ? ORDER BY fetched_at DESC LIMIT ? OFFSET ?`,
    [platformId, authorId, limit, offset]
  );
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
