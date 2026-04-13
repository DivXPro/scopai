import { query, run } from './client';
import { Post } from '../shared/types';
import { generateId, now } from '../shared/utils';

export function createPost(post: Omit<Post, 'id' | 'fetched_at'>): Post {
  const id = generateId();
  const ts = now();
  run(
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

export function listPosts(platformId?: string, limit = 50, offset = 0): Post[] {
  let sql = 'SELECT * FROM posts';
  const params: unknown[] = [];
  if (platformId) { sql += ' WHERE platform_id = ?'; params.push(platformId); }
  sql += ' ORDER BY fetched_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return query<Post>(sql, params);
}

export function getPostById(id: string): Post | null {
  const rows = query<Post>('SELECT * FROM posts WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export function searchPosts(platformId: string, queryText: string, limit = 50): Post[] {
  return query<Post>(
    `SELECT * FROM posts WHERE platform_id = ? AND content LIKE ? ORDER BY fetched_at DESC LIMIT ?`,
    [platformId, `%${queryText}%`, limit]
  );
}

export function queryPosts(platformId: string, whereClause: string, limit = 1000): Post[] {
  return query<Post>(
    `SELECT * FROM posts WHERE platform_id = ? AND ${whereClause} LIMIT ?`,
    [platformId, limit]
  );
}

export function countPosts(platformId?: string): number {
  const sql = platformId
    ? 'SELECT COUNT(*) as cnt FROM posts WHERE platform_id = ?'
    : 'SELECT COUNT(*) as cnt FROM posts';
  const params = platformId ? [platformId] : [];
  const rows = query<{ cnt: bigint }>(sql, params);
  return Number(rows[0]?.cnt ?? 0);
}
