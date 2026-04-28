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

export async function getCreatorSyncScheduleById(id: string): Promise<CreatorSyncSchedule | null> {
  const rows = await query<CreatorSyncSchedule>(
    'SELECT * FROM creator_sync_schedules WHERE id = ?',
    [id],
  );
  return rows[0] ?? null;
}

export async function getCreatorSyncScheduleByCreatorId(
  creatorId: string,
): Promise<CreatorSyncSchedule | null> {
  const rows = await query<CreatorSyncSchedule>(
    'SELECT * FROM creator_sync_schedules WHERE creator_id = ?',
    [creatorId],
  );
  return rows[0] ?? null;
}

export async function listCreatorSyncSchedules(isEnabled?: boolean): Promise<CreatorSyncSchedule[]> {
  if (isEnabled !== undefined) {
    return query<CreatorSyncSchedule>(
      'SELECT * FROM creator_sync_schedules WHERE is_enabled = ? ORDER BY created_at',
      [isEnabled],
    );
  }
  return query<CreatorSyncSchedule>('SELECT * FROM creator_sync_schedules ORDER BY created_at');
}

export async function updateCreatorSyncSchedule(
  id: string,
  updates: Partial<Omit<CreatorSyncSchedule, 'id' | 'created_at'>>,
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.creator_id !== undefined) {
    fields.push('creator_id = ?');
    values.push(updates.creator_id);
  }
  if (updates.interval_minutes !== undefined) {
    fields.push('interval_minutes = ?');
    values.push(updates.interval_minutes);
  }
  if (updates.time_window_start !== undefined) {
    fields.push('time_window_start = ?');
    values.push(updates.time_window_start);
  }
  if (updates.time_window_end !== undefined) {
    fields.push('time_window_end = ?');
    values.push(updates.time_window_end);
  }
  if (updates.max_retries !== undefined) {
    fields.push('max_retries = ?');
    values.push(updates.max_retries);
  }
  if (updates.retry_interval_minutes !== undefined) {
    fields.push('retry_interval_minutes = ?');
    values.push(updates.retry_interval_minutes);
  }
  if (updates.is_enabled !== undefined) {
    fields.push('is_enabled = ?');
    values.push(updates.is_enabled);
  }

  if (fields.length === 0) return;
  fields.push('updated_at = ?');
  values.push(now());
  values.push(id);

  await run(`UPDATE creator_sync_schedules SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function enableCreatorSyncSchedule(id: string): Promise<void> {
  await run(`UPDATE creator_sync_schedules SET is_enabled = true, updated_at = ? WHERE id = ?`, [
    now(),
    id,
  ]);
}

export async function disableCreatorSyncSchedule(id: string): Promise<void> {
  await run(`UPDATE creator_sync_schedules SET is_enabled = false, updated_at = ? WHERE id = ?`, [
    now(),
    id,
  ]);
}

export async function deleteCreatorSyncSchedule(id: string): Promise<void> {
  await run('DELETE FROM creator_sync_schedules WHERE id = ?', [id]);
}
