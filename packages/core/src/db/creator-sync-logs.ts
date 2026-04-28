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

export async function listCreatorSyncLogs(creatorId: string, limit = 20): Promise<CreatorSyncLog[]> {
  return query<CreatorSyncLog>(
    'SELECT * FROM creator_sync_logs WHERE creator_id = ? ORDER BY started_at DESC LIMIT ?',
    [creatorId, limit],
  );
}
