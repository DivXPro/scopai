import { query, run } from './client';
import { CreatorSyncLog } from '../shared/types';
import { generateId, now } from '../shared/utils';

export async function createCreatorSyncLog(
  data: Omit<CreatorSyncLog, 'id' | 'started_at'>,
): Promise<CreatorSyncLog> {
  const id = generateId();
  const ts = now();
  await run(
    `INSERT INTO creator_sync_logs (id, creator_id, job_id, sync_type, status, result_summary,
     started_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.creator_id,
      data.job_id,
      data.sync_type,
      data.status,
      data.result_summary ? JSON.stringify(data.result_summary) : null,
      ts,
      data.completed_at,
    ],
  );
  return { ...data, id, started_at: ts };
}

export async function getCreatorSyncLogById(id: string): Promise<CreatorSyncLog | null> {
  const rows = await query<CreatorSyncLog>('SELECT * FROM creator_sync_logs WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function listCreatorSyncLogs(
  creatorId?: string,
  limit = 20,
  offset = 0,
): Promise<CreatorSyncLog[]> {
  if (creatorId) {
    return query<CreatorSyncLog>(
      'SELECT * FROM creator_sync_logs WHERE creator_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?',
      [creatorId, limit, offset],
    );
  }
  return query<CreatorSyncLog>(
    'SELECT * FROM creator_sync_logs ORDER BY started_at DESC LIMIT ? OFFSET ?',
    [limit, offset],
  );
}

export async function listCreatorSyncLogsByJob(jobId: string): Promise<CreatorSyncLog[]> {
  return query<CreatorSyncLog>(
    'SELECT * FROM creator_sync_logs WHERE job_id = ? ORDER BY started_at DESC',
    [jobId],
  );
}

export async function updateCreatorSyncLog(
  id: string,
  updates: Partial<Omit<CreatorSyncLog, 'id' | 'started_at'>>,
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) {
    fields.push('status = ?');
    values.push(updates.status);
  }
  if (updates.result_summary !== undefined) {
    fields.push('result_summary = ?');
    values.push(updates.result_summary ? JSON.stringify(updates.result_summary) : null);
  }
  if (updates.completed_at !== undefined) {
    fields.push('completed_at = ?');
    values.push(updates.completed_at);
  }

  if (fields.length === 0) return;
  values.push(id);

  await run(`UPDATE creator_sync_logs SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function deleteCreatorSyncLog(id: string): Promise<void> {
  await run('DELETE FROM creator_sync_logs WHERE id = ?', [id]);
}
