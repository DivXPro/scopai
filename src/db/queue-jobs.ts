import { query, run } from './client';
import { QueueJob } from '../shared/types';
import { now } from '../shared/utils';

export async function enqueueJob(job: QueueJob): Promise<void> {
  await run(
    `INSERT INTO queue_jobs (id, task_id, target_type, target_id, status, priority, attempts, max_attempts, error, created_at, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [job.id, job.task_id, job.target_type, job.target_id, job.status, job.priority, job.attempts, job.max_attempts, job.error, job.created_at, job.processed_at]
  );
}

export async function enqueueJobs(jobs: QueueJob[]): Promise<void> {
  for (const job of jobs) {
    await enqueueJob(job);
  }
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

export async function updateJobStatus(jobId: string, status: string): Promise<void> {
  const processedAt = (status === 'completed' || status === 'failed') ? now() : null;
  await run(`UPDATE queue_jobs SET status = ?, processed_at = ? WHERE id = ?`, [status, processedAt, jobId]);
}

export async function listJobsByTask(taskId: string): Promise<QueueJob[]> {
  return query<QueueJob>('SELECT * FROM queue_jobs WHERE task_id = ? ORDER BY created_at', [taskId]);
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
  return Number(rows[0]?.cnt ?? 0);
}
