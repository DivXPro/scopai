import { query, run } from './client';
import { CreatorSyncJob } from '../shared/types';
import { generateId, now } from '../shared/utils';

export async function createCreatorSyncJob(
  data: Omit<
    CreatorSyncJob,
    | 'id'
    | 'status'
    | 'posts_imported'
    | 'posts_updated'
    | 'posts_skipped'
    | 'posts_failed'
    | 'cursor'
    | 'progress'
    | 'error'
    | 'created_at'
    | 'processed_at'
  >,
): Promise<CreatorSyncJob> {
  const id = generateId();
  const ts = now();
  await run(
    `INSERT INTO creator_sync_jobs (id, creator_id, sync_type, status, posts_imported, posts_updated,
     posts_skipped, posts_failed, cursor, progress, error, created_at, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.creator_id, data.sync_type, 'pending', 0, 0, 0, 0, null, null, null, ts, null],
  );
  return {
    id,
    creator_id: data.creator_id,
    sync_type: data.sync_type,
    status: 'pending',
    posts_imported: 0,
    posts_updated: 0,
    posts_skipped: 0,
    posts_failed: 0,
    cursor: null,
    progress: null,
    error: null,
    created_at: ts,
    processed_at: null,
  };
}

export async function getCreatorSyncJobById(id: string): Promise<CreatorSyncJob | null> {
  const rows = await query<CreatorSyncJob>('SELECT * FROM creator_sync_jobs WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function listCreatorSyncJobs(
  creatorId?: string,
  status?: string,
  limit = 50,
  offset = 0,
): Promise<CreatorSyncJob[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (creatorId) {
    conditions.push('creator_id = ?');
    params.push(creatorId);
  }
  if (status) {
    conditions.push('status = ?');
    params.push(status);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);
  return query<CreatorSyncJob>(
    `SELECT * FROM creator_sync_jobs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    params,
  );
}

export async function getPendingCreatorSyncJobs(limit = 10): Promise<CreatorSyncJob[]> {
  return query<CreatorSyncJob>(
    'SELECT * FROM creator_sync_jobs WHERE status = ? ORDER BY created_at ASC LIMIT ?',
    ['pending', limit],
  );
}

export async function hasPendingSyncJob(creatorId: string): Promise<boolean> {
  const rows = await query<{ cnt: bigint }>(
    'SELECT COUNT(*) as cnt FROM creator_sync_jobs WHERE creator_id = ? AND status = ?',
    [creatorId, 'pending'],
  );
  return Number(rows[0]?.cnt ?? 0) > 0;
}

export async function updateCreatorSyncJobStatus(
  id: string,
  status: CreatorSyncJob['status'],
  updates?: Partial<
    Pick<CreatorSyncJob, 'posts_imported' | 'posts_updated' | 'posts_skipped' | 'posts_failed' | 'cursor' | 'progress' | 'error'>
  >,
): Promise<void> {
  const fields: string[] = ['status = ?'];
  const params: unknown[] = [status];

  if (updates?.posts_imported !== undefined) {
    fields.push('posts_imported = ?');
    params.push(updates.posts_imported);
  }
  if (updates?.posts_updated !== undefined) {
    fields.push('posts_updated = ?');
    params.push(updates.posts_updated);
  }
  if (updates?.posts_skipped !== undefined) {
    fields.push('posts_skipped = ?');
    params.push(updates.posts_skipped);
  }
  if (updates?.posts_failed !== undefined) {
    fields.push('posts_failed = ?');
    params.push(updates.posts_failed);
  }
  if (updates?.cursor !== undefined) {
    fields.push('cursor = ?');
    params.push(updates.cursor);
  }
  if (updates?.progress !== undefined) {
    fields.push('progress = ?');
    params.push(updates.progress ? JSON.stringify(updates.progress) : null);
  }
  if (updates?.error !== undefined) {
    fields.push('error = ?');
    params.push(updates.error);
  }

  if (status === 'completed' || status === 'completed_with_errors' || status === 'failed') {
    fields.push('processed_at = ?');
    params.push(now());
  }

  params.push(id);
  await run(`UPDATE creator_sync_jobs SET ${fields.join(', ')} WHERE id = ?`, params);
}

export async function deleteCreatorSyncJob(id: string): Promise<void> {
  await run('DELETE FROM creator_sync_jobs WHERE id = ?', [id]);
}
