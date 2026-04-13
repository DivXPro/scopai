import { query, run } from './client';
import { Platform } from '../shared/types';
import { generateId, now } from '../shared/utils';

export async function createPlatform(platform: Omit<Platform, 'created_at'>): Promise<Platform> {
  const ts = now();
  await run(
    `INSERT INTO platforms (id, name, description, created_at) VALUES (?, ?, ?, ?)`,
    [platform.id, platform.name, platform.description, ts]
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
