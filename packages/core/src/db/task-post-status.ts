import { query, run } from './client';
import { TaskPostStatus } from '../shared/types';
import { now } from '../shared/utils';

export async function upsertTaskPostStatus(
  taskId: string,
  postId: string,
  updates: Partial<TaskPostStatus>,
): Promise<void> {
  const ts = now();
  // For INSERT: use defaults when value not provided
  // For UPDATE: COALESCE preserves existing values when null is passed
  // For error field: use CASE to distinguish "not provided" (undefined) from "explicitly clear" (null)
  const provided = {
    comments_fetched: updates.comments_fetched === undefined ? null : updates.comments_fetched,
    media_fetched: updates.media_fetched === undefined ? null : updates.media_fetched,
    comments_count: updates.comments_count === undefined ? null : updates.comments_count,
    media_count: updates.media_count === undefined ? null : updates.media_count,
    status: updates.status === undefined ? null : updates.status,
    error: updates.error === undefined ? null : updates.error,
    error_set: updates.error === undefined ? 0 : 1,
  };
  await run(
    `INSERT INTO task_post_status (task_id, post_id, comments_fetched, media_fetched, comments_count, media_count, status, error, updated_at)
     VALUES (?, ?, COALESCE(?, FALSE), COALESCE(?, FALSE), COALESCE(?, 0), COALESCE(?, 0), COALESCE(?, 'pending'), ?, ?)
     ON CONFLICT(task_id, post_id) DO UPDATE SET
       comments_fetched = COALESCE(?, COALESCE(task_post_status.comments_fetched, FALSE)),
       media_fetched = COALESCE(?, COALESCE(task_post_status.media_fetched, FALSE)),
       comments_count = COALESCE(?, COALESCE(task_post_status.comments_count, 0)),
       media_count = COALESCE(?, COALESCE(task_post_status.media_count, 0)),
       status = COALESCE(?, COALESCE(task_post_status.status, 'pending')),
       error = CASE WHEN ? = 1 THEN ? ELSE task_post_status.error END,
       updated_at = ?`,
    [
      // INSERT values
      taskId, postId,
      provided.comments_fetched, provided.media_fetched,
      provided.comments_count, provided.media_count,
      provided.status, provided.error, ts,
      // UPDATE values
      provided.comments_fetched, provided.media_fetched,
      provided.comments_count, provided.media_count,
      provided.status, provided.error_set, provided.error, ts,
    ],
  );
}

export async function getTaskPostStatuses(taskId: string): Promise<TaskPostStatus[]> {
  return query<TaskPostStatus>('SELECT * FROM task_post_status WHERE task_id = ? ORDER BY post_id', [taskId]);
}

export async function getTaskPostStatus(taskId: string, postId: string): Promise<TaskPostStatus | null> {
  const rows = await query<TaskPostStatus>('SELECT * FROM task_post_status WHERE task_id = ? AND post_id = ?', [taskId, postId]);
  return rows[0] ?? null;
}

export async function getPendingPostIds(taskId: string): Promise<{ post_id: string; comments_fetched: boolean; media_fetched: boolean }[]> {
  return query(
    `SELECT post_id, comments_fetched, media_fetched FROM task_post_status
     WHERE task_id = ? AND status IN ('pending', 'fetching')
     ORDER BY post_id`,
    [taskId],
  );
}
