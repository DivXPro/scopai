import { query, run } from './client';
import { QueueJob } from '../shared/types';
import { now } from '../shared/utils';

export function enqueueJob(job: QueueJob): void {
  run(
    `INSERT INTO queue_jobs (id, task_id, target_type, target_id, status, priority, attempts, max_attempts, error, created_at, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [job.id, job.task_id, job.target_type, job.target_id, job.status, job.priority, job.attempts, job.max_attempts, job.error, job.created_at, job.processed_at]
  );
}

export function enqueueJobs(jobs: QueueJob[]): void {
  for (const job of jobs) {
    enqueueJob(job);
  }
}

export function getNextJob(): QueueJob | null {
  const rows = query<QueueJob>(
    `SELECT * FROM queue_jobs WHERE status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 1`
  );
  if (rows.length === 0) return null;
  run(`UPDATE queue_jobs SET status = 'processing', attempts = attempts + 1 WHERE id = ?`, [rows[0].id]);
  return rows[0];
}

export function updateJobStatus(jobId: string, status: string): void {
  const processedAt = (status === 'completed' || status === 'failed') ? now() : null;
  run(`UPDATE queue_jobs SET status = ?, processed_at = ? WHERE id = ?`, [status, processedAt, jobId]);
}

export function listJobsByTask(taskId: string): QueueJob[] {
  return query<QueueJob>('SELECT * FROM queue_jobs WHERE task_id = ? ORDER BY created_at', [taskId]);
}
