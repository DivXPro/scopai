import { query, run } from '../db/client';
import { QueueJob } from '../shared/types';
import { generateId } from '../shared/utils';

export class BreeDuckDBAdapter {
  async insert(jobData: { name: string; data: unknown; priority?: number }): Promise<void> {
    const id = generateId();
    const data = jobData.data as { task_id: string; target_type?: string; target_id?: string };
    await run(
      `INSERT INTO queue_jobs (id, task_id, target_type, target_id, status, priority, attempts, max_attempts)
       VALUES (?, ?, ?, ?, 'pending', ?, 0, 3)`,
      [id, data.task_id, data.target_type ?? null, data.target_id ?? null, jobData.priority ?? 0]
    );
  }

  async remove(name: string): Promise<void> {
    await run(`DELETE FROM queue_jobs WHERE id = ?`, [name]);
  }

  async getNext(): Promise<{ name: string; data: unknown } | null> {
    const rows = await query<QueueJob>(
      `SELECT id, task_id, target_type, target_id FROM queue_jobs
       WHERE status = 'pending'
       ORDER BY priority DESC, created_at ASC
       LIMIT 1`
    );
    if (rows.length === 0) return null;
    const job = rows[0];
    await run(`UPDATE queue_jobs SET status = 'processing', attempts = attempts + 1 WHERE id = ?`, [job.id]);
    return { name: job.id, data: { task_id: job.task_id, target_type: job.target_type, target_id: job.target_id } };
  }

  async failed(name: string, error: string): Promise<void> {
    const jobs = await query<QueueJob>(`SELECT attempts, max_attempts FROM queue_jobs WHERE id = ?`, [name]);
    if (jobs.length === 0) return;
    if (jobs[0].attempts >= jobs[0].max_attempts) {
      await run(`UPDATE queue_jobs SET status = 'failed', error = ? WHERE id = ?`, [error, name]);
    } else {
      await run(`UPDATE queue_jobs SET status = 'pending', error = ? WHERE id = ?`, [error, name]);
    }
  }

  async success(name: string): Promise<void> {
    await run(`UPDATE queue_jobs SET status = 'completed', processed_at = CURRENT_TIMESTAMP WHERE id = ?`, [name]);
  }

  async stop(name: string): Promise<void> {
    await run(`UPDATE queue_jobs SET status = 'pending' WHERE id = ? AND status = 'processing'`, [name]);
  }

  async getStats(): Promise<{ pending: number; processing: number; completed: number; failed: number }> {
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
}
