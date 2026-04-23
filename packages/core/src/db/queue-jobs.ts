import { query, run } from './client';
import { QueueJob } from '../shared/types';
import { now } from '../shared/utils';
import { notifyJobAvailable } from '../shared/job-events';

export async function enqueueJob(job: QueueJob): Promise<void> {
  await run(
    `INSERT INTO queue_jobs (id, task_id, strategy_id, target_type, target_id, status, priority, attempts, max_attempts, error, created_at, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [job.id, job.task_id, job.strategy_id, job.target_type, job.target_id, job.status, job.priority, job.attempts, job.max_attempts, job.error, job.created_at, job.processed_at]
  );
}

export async function enqueueJobs(jobs: QueueJob[]): Promise<void> {
  if (jobs.length === 0) return;
  for (const job of jobs) {
    await enqueueJob(job);
  }
  notifyJobAvailable();
}

export async function getNextJob(): Promise<QueueJob | null> {
  const rows = await query<QueueJob>(
    `UPDATE queue_jobs
     SET status = 'processing', attempts = attempts + 1
     WHERE id = (
       SELECT id FROM queue_jobs WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1
     )
     RETURNING *`
  );
  return rows[0] ?? null;
}

export async function getNextJobs(limit: number): Promise<QueueJob[]> {
  const rows = await query<QueueJob>(
    `UPDATE queue_jobs
     SET status = 'processing', attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM queue_jobs WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT ?
     )
     RETURNING *`,
    [limit]
  );
  return rows;
}

export async function lockPendingJobs(
  taskId: string,
  strategyId: string,
  targetIds: string[],
): Promise<{ id: string; target_id: string }[]> {
  if (targetIds.length === 0) return [];
  const placeholders = targetIds.map(() => '?').join(',');
  const rows = await query<{ id: string; target_id: string }>(
    `UPDATE queue_jobs
     SET status = 'processing', attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM queue_jobs
       WHERE task_id = ? AND strategy_id = ? AND target_type = 'comment' AND status = 'pending'
         AND target_id IN (${placeholders})
       ORDER BY priority DESC, created_at ASC
     )
     RETURNING id, target_id`,
    [taskId, strategyId, ...targetIds],
  );
  return rows;
}

export async function updateJobStatus(jobId: string, status: string): Promise<void> {
  const processedAt = (status === 'completed' || status === 'failed') ? now() : null;
  await run(`UPDATE queue_jobs SET status = ?, processed_at = ? WHERE id = ?`, [status, processedAt, jobId]);
}

export async function completeJobs(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const placeholders = jobIds.map(() => '?').join(',');
  const processedAt = now();
  await run(
    `UPDATE queue_jobs SET status = 'completed', processed_at = ? WHERE id IN (${placeholders})`,
    [processedAt, ...jobIds],
  );
}

export async function unlockJobs(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const placeholders = jobIds.map(() => '?').join(',');
  await run(
    `UPDATE queue_jobs SET status = 'pending', processed_at = null WHERE id IN (${placeholders})`,
    jobIds,
  );
}

export async function requeueJob(jobId: string, error: string): Promise<void> {
  await run(`UPDATE queue_jobs SET status = 'pending', error = ?, processed_at = null WHERE id = ?`, [error, jobId]);
}

export async function recoverStalledJobs(taskId?: string): Promise<{ recovered: number; failed: number }> {
  const whereClause = taskId ? "task_id = ? AND status = 'processing'" : "status = 'processing'";
  const params = taskId ? [taskId] : [];

  const failedRows = await query<{ id: string }>(
    `UPDATE queue_jobs
     SET status = 'failed', error = 'max attempts exceeded after recovery', processed_at = ?
     WHERE ${whereClause} AND attempts >= max_attempts
     RETURNING id`,
    [now(), ...params],
  );

  const recoveredRows = await query<{ id: string }>(
    `UPDATE queue_jobs
     SET status = 'pending', processed_at = null
     WHERE ${whereClause} AND attempts < max_attempts
     RETURNING id`,
    params,
  );

  return { recovered: recoveredRows.length, failed: failedRows.length };
}

export async function listJobsByTask(taskId: string): Promise<QueueJob[]> {
  return query<QueueJob>('SELECT * FROM queue_jobs WHERE task_id = ? ORDER BY created_at', [taskId]);
}

export async function listRecentJobs(status?: string, limit = 50): Promise<QueueJob[]> {
  if (status) {
    return query<QueueJob>(
      'SELECT * FROM queue_jobs WHERE status = ? ORDER BY created_at DESC LIMIT ?',
      [status, limit],
    );
  }
  return query<QueueJob>('SELECT * FROM queue_jobs ORDER BY created_at DESC LIMIT ?', [limit]);
}

export async function getQueueStats(): Promise<{ pending: number; processing: number; completed: number; failed: number }> {
  const rows = await query<{ status: string; cnt: bigint }>(
    `SELECT status, COUNT(*) as cnt FROM queue_jobs GROUP BY status`
  );
  const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of rows) {
    if (row.status in stats) {
      (stats as Record<string, number>)[row.status] = Number(row.cnt);
    }
  }
  return stats;
}

export async function retryFailedJobs(taskId?: string): Promise<number> {
  const whereClause = taskId ? "task_id = ? AND status = 'failed'" : "status = 'failed'";
  const params = taskId ? [taskId] : [];
  await run(
    `UPDATE queue_jobs SET status = 'pending', attempts = 0, error = null, processed_at = null WHERE ${whereClause}`,
    params,
  );
  const rows = await query<{ cnt: bigint }>(
    `SELECT COUNT(*) as cnt FROM queue_jobs WHERE ${whereClause}`,
    params,
  );
  return Number(rows[0]?.cnt ?? 0);
}

export async function resetJobs(taskId?: string): Promise<number> {
  const whereClause = taskId ? "task_id = ? AND status != 'pending'" : "status != 'pending'";
  const params = taskId ? [taskId] : [];
  await run(
    `UPDATE queue_jobs SET status = 'pending', attempts = 0, error = null, processed_at = null WHERE ${whereClause}`,
    params,
  );
  const rows = await query<{ cnt: bigint }>(
    `SELECT COUNT(*) as cnt FROM queue_jobs WHERE ${whereClause}`,
    params,
  );
  return Number(rows[0]?.cnt ?? 0);
}

export async function syncWaitingMediaJobs(taskId: string, postId: string): Promise<number> {
  await run(
    `UPDATE queue_jobs
     SET status = 'pending'
     WHERE task_id = ? AND target_id = ? AND status = 'waiting_media'`,
    [taskId, postId]
  );
  // DuckDB run() may not return changes directly; query to confirm
  const rows = await query<{ cnt: bigint }>(
    `SELECT COUNT(*) as cnt FROM queue_jobs WHERE task_id = ? AND target_id = ? AND status = 'pending'`,
    [taskId, postId]
  );
  const count = Number(rows[0]?.cnt ?? 0);
  if (count > 0) notifyJobAvailable();
  return count;
}

export async function getExistingJobTargets(
  taskId: string,
  strategyId: string,
): Promise<Set<string>> {
  const rows = await query<{ target_id: string }>(
    `SELECT target_id FROM queue_jobs WHERE task_id = ? AND strategy_id = ?`,
    [taskId, strategyId],
  );
  return new Set(rows.map(r => r.target_id));
}
