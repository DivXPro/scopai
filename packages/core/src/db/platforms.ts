import { query, run } from './client';
import { Platform } from '../shared/types';
import { generateId, now } from '../shared/utils';

export async function createPlatform(platform: Omit<Platform, 'created_at'>): Promise<Platform> {
  const ts = now();
  await run(
    `INSERT INTO platforms (id, name, description, profile_fetch_template, posts_fetch_template, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [platform.id, platform.name, platform.description, platform.profile_fetch_template ?? null, platform.posts_fetch_template ?? null, ts]
  );
  return { ...platform, created_at: ts };
}

export async function upsertPlatform(platform: Omit<Platform, 'created_at'>): Promise<Platform> {
  const existing = await getPlatformById(platform.id);
  if (existing) return existing;
  return createPlatform(platform);
}

export async function getPlatformById(id: string): Promise<Platform | null> {
  const rows = await query<Platform>('SELECT * FROM platforms WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function listPlatforms(): Promise<Platform[]> {
  return query<Platform>('SELECT * FROM platforms ORDER BY id');
}

export async function updatePlatform(
  id: string,
  updates: Partial<Omit<Platform, 'id' | 'created_at'>>,
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }
  if (updates.profile_fetch_template !== undefined) {
    fields.push('profile_fetch_template = ?');
    values.push(updates.profile_fetch_template);
  }
  if (updates.posts_fetch_template !== undefined) {
    fields.push('posts_fetch_template = ?');
    values.push(updates.posts_fetch_template);
  }

  if (fields.length === 0) return;

  values.push(id);
  await run(`UPDATE platforms SET ${fields.join(', ')} WHERE id = ?`, values);
}
