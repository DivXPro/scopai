import { query, run } from './client';
import { Comment } from '../shared/types';
import { generateId, now } from '../shared/utils';

export async function createComment(comment: Omit<Comment, 'id' | 'fetched_at'>): Promise<Comment> {
  const id = generateId();
  const ts = now();
  await run(
    `INSERT INTO comments (id, post_id, platform_id, platform_comment_id, parent_comment_id, root_comment_id,
     depth, author_id, author_name, content, like_count, reply_count, published_at, fetched_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, comment.post_id, comment.platform_id, comment.platform_comment_id, comment.parent_comment_id,
     comment.root_comment_id, comment.depth, comment.author_id, comment.author_name, comment.content,
     comment.like_count, comment.reply_count, comment.published_at, ts,
     comment.metadata ? JSON.stringify(comment.metadata) : null]
  );
  return { ...comment, id, fetched_at: ts };
}

export async function listCommentsByPost(postId: string, limit = 100): Promise<Comment[]> {
  return query<Comment>(
    'SELECT * FROM comments WHERE post_id = ? ORDER BY published_at ASC LIMIT ?',
    [postId, limit]
  );
}

export async function getCommentById(id: string): Promise<Comment | null> {
  const rows = await query<Comment>('SELECT * FROM comments WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function countComments(postId?: string): Promise<number> {
  const sql = postId
    ? 'SELECT COUNT(*) as cnt FROM comments WHERE post_id = ?'
    : 'SELECT COUNT(*) as cnt FROM comments';
  const params = postId ? [postId] : [];
  const rows = await query<{ cnt: bigint }>(sql, params);
  return Number(rows[0]?.cnt ?? 0);
}
