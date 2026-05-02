import { query, run } from './client';
import { Creator } from '../shared/types';
import { generateId, now } from '../shared/utils';

export async function createCreator(
  creator: Omit<Creator, 'id' | 'created_at' | 'updated_at' | 'last_synced_at'>,
): Promise<Creator> {
  const id = generateId();
  const ts = now();
  await run(
    `INSERT INTO creators (id, platform_id, platform_author_id, author_name,
     bio, avatar_url, homepage_url, follower_count, following_count, post_count,
     status, created_at, updated_at, last_synced_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      creator.platform_id,
      creator.platform_author_id,
      creator.author_name,
      creator.bio,
      creator.avatar_url,
      creator.homepage_url,
      creator.follower_count,
      creator.following_count,
      creator.post_count,
      creator.status,
      ts,
      ts,
      null,
      creator.metadata ? JSON.stringify(creator.metadata) : null,
    ],
  );
  return { ...creator, id, created_at: ts, updated_at: ts, last_synced_at: null };
}

export async function getCreatorById(id: string): Promise<Creator | null> {
  const rows = await query<Creator>('SELECT * FROM creators WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function getCreatorByPlatformAuthorId(
  platformId: string,
  platformAuthorId: string,
): Promise<Creator | null> {
  const rows = await query<Creator>(
    'SELECT * FROM creators WHERE platform_id = ? AND platform_author_id = ?',
    [platformId, platformAuthorId],
  );
  return rows[0] ?? null;
}

export async function listCreators(
  platformId?: string,
  status?: string,
  limit = 50,
  offset = 0,
): Promise<Creator[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (platformId) {
    conditions.push('platform_id = ?');
    params.push(platformId);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);
  return query<Creator>(
    `SELECT * FROM creators ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    params,
  );
}

export async function countCreators(platformId?: string, status?: string): Promise<number> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (platformId) {
    conditions.push('platform_id = ?');
    params.push(platformId);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await query<{ cnt: bigint }>(`SELECT COUNT(*) as cnt FROM creators ${where}`, params);
  return Number(rows[0]?.cnt ?? 0);
}

export async function updateCreator(
  id: string,
  updates: Partial<Omit<Creator, 'id' | 'created_at'>>,
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.platform_id !== undefined) {
    fields.push('platform_id = ?');
    values.push(updates.platform_id);
  }
  if (updates.platform_author_id !== undefined) {
    fields.push('platform_author_id = ?');
    values.push(updates.platform_author_id);
  }
  if (updates.author_name !== undefined) {
    fields.push('author_name = ?');
    values.push(updates.author_name);
  }
  if (updates.bio !== undefined) {
    fields.push('bio = ?');
    values.push(updates.bio);
  }
  if (updates.avatar_url !== undefined) {
    fields.push('avatar_url = ?');
    values.push(updates.avatar_url);
  }
  if (updates.homepage_url !== undefined) {
    fields.push('homepage_url = ?');
    values.push(updates.homepage_url);
  }
  if (updates.follower_count !== undefined) {
    fields.push('follower_count = ?');
    values.push(updates.follower_count);
  }
  if (updates.following_count !== undefined) {
    fields.push('following_count = ?');
    values.push(updates.following_count);
  }
  if (updates.post_count !== undefined) {
    fields.push('post_count = ?');
    values.push(updates.post_count);
  }
  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.last_synced_at !== undefined) {
    fields.push('last_synced_at = ?');
    values.push(updates.last_synced_at);
  }
  if (updates.metadata !== undefined) {
    fields.push('metadata = ?');
    values.push(updates.metadata ? JSON.stringify(updates.metadata) : null);
  }

  if (fields.length === 0) return;

  fields.push('updated_at = ?');
  values.push(now());
  values.push(id);

  await run(`UPDATE creators SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function updateCreatorStatus(id: string, status: Creator['status']): Promise<void> {
  await run(`UPDATE creators SET status = ?, updated_at = ? WHERE id = ?`, [status, now(), id]);
}

export async function updateCreatorLastSynced(id: string, ts = now()): Promise<void> {
  await run(`UPDATE creators SET last_synced_at = ?, updated_at = ? WHERE id = ?`, [ts, now(), id]);
}

export async function deleteCreator(id: string): Promise<void> {
  await run(`DELETE FROM creators WHERE id = ?`, [id]);
}
