import { query, run } from './client';
import { CreatorSyncSchedule } from '../shared/types';
import { generateId, now } from '../shared/utils';

export async function createCreatorSyncSchedule(
  data: Omit<CreatorSyncSchedule, 'id' | 'created_at' | 'updated_at'>,
): Promise<CreatorSyncSchedule> {
  const id = generateId();
  const ts = now();
  await run(
    `INSERT INTO creator_sync_schedules (id, creator_id, interval_minutes, time_window_start,
     time_window_end, max_retries, retry_interval_minutes, is_enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.creator_id,
      data.interval_minutes,
      data.time_window_start,
      data.time_window_end,
      data.max_retries,
      data.retry_interval_minutes,
      data.is_enabled,
      ts,
      ts,
    ],
  );
  return { ...data, id, created_at: ts, updated_at: ts };
}

export async function getCreatorSyncSchedule(creatorId: string): Promise<CreatorSyncSchedule | null> {
  const rows = await query<CreatorSyncSchedule>(
    'SELECT * FROM creator_sync_schedules WHERE creator_id = ?',
    [creatorId],
  );
  return rows[0] ?? null;
}

export async function updateCreatorSyncSchedule(
  creatorId: string,
  data: Partial<Omit<CreatorSyncSchedule, 'id' | 'creator_id' | 'created_at'>>,
): Promise<void> {
  const fields: string[] = [];
  const params: unknown[] = [];

  if (data.interval_minutes !== undefined) {
    fields.push('interval_minutes = ?');
    params.push(data.interval_minutes);
  }
  if (data.time_window_start !== undefined) {
    fields.push('time_window_start = ?');
    params.push(data.time_window_start);
  }
  if (data.time_window_end !== undefined) {
    fields.push('time_window_end = ?');
    params.push(data.time_window_end);
  }
  if (data.max_retries !== undefined) {
    fields.push('max_retries = ?');
    params.push(data.max_retries);
  }
  if (data.retry_interval_minutes !== undefined) {
    fields.push('retry_interval_minutes = ?');
    params.push(data.retry_interval_minutes);
  }
  if (data.is_enabled !== undefined) {
    fields.push('is_enabled = ?');
    params.push(data.is_enabled);
  }

  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  params.push(now());
  params.push(creatorId);

  await run(`UPDATE creator_sync_schedules SET ${fields.join(', ')} WHERE creator_id = ?`, params);
}

export async function listEnabledSyncSchedules(): Promise<CreatorSyncSchedule[]> {
  return query<CreatorSyncSchedule>(
    `SELECT s.* FROM creator_sync_schedules s
     JOIN creators c ON s.creator_id = c.id
     WHERE s.is_enabled = true AND c.status = 'active'`,
  );
}
