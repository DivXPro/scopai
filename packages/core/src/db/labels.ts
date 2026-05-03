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
