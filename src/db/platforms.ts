import { query, run } from './client';
import { Platform } from '../shared/types';
import { generateId, now } from '../shared/utils';

export function createPlatform(platform: Omit<Platform, 'created_at'>): Platform {
  const ts = now();
  run(
    `INSERT INTO platforms (id, name, description, created_at) VALUES (?, ?, ?, ?)`,
    [platform.id, platform.name, platform.description, ts]
  );
  return { ...platform, created_at: ts };
}

export function upsertPlatform(platform: Omit<Platform, 'created_at'>): Platform {
  const existing = getPlatformById(platform.id);
  if (existing) return existing;
  return createPlatform(platform);
}

export function getPlatformById(id: string): Platform | null {
  const rows = query<Platform>('SELECT * FROM platforms WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export function listPlatforms(): Platform[] {
  return query<Platform>('SELECT * FROM platforms ORDER BY id');
}
