import { query, run } from './client';
import { Task, TaskStats } from '../shared/types';
import { now } from '../shared/utils';

export async function createTask(task: Task): Promise<void> {
  await run(
    `INSERT INTO tasks (id, name, description, cli_templates, status, stats, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [task.id, task.name, task.description, task.cli_templates ?? null, task.status,
     task.stats ? JSON.stringify(task.stats) : null,
     task.created_at, task.updated_at, task.completed_at]
  );
}

export async function getTaskById(id: string): Promise<Task | null> {
  const rows = await query<Task>('SELECT * FROM tasks WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function listTasks(status?: string, queryText?: string, limit = 100, offset = 0): Promise<Task[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) { conditions.push('status = ?'); params.push(status); }
  if (queryText) { conditions.push('name ILIKE ?'); params.push(`%${queryText}%`); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);
  return query<Task>(`SELECT * FROM tasks ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, params);
}

export async function countTasks(status?: string, queryText?: string): Promise<number> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (status) { conditions.push('status = ?'); params.push(status); }
  if (queryText) { conditions.push('name ILIKE ?'); params.push(`%${queryText}%`); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await query<{ cnt: bigint }>(`SELECT COUNT(*) as cnt FROM tasks ${where}`, params);
  return Number(rows[0]?.cnt ?? 0);
}

export async function updateTaskStatus(id: string, status: string): Promise<void> {
  const updatedAt = now();
  const completedAt = (status === 'completed' || status === 'failed') ? now() : null;
  await run(
    `UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
    [status, updatedAt, completedAt, id]
  );
}

export async function updateTaskStats(id: string, stats: TaskStats): Promise<void> {
  const updatedAt = now();
  await run(
    `UPDATE tasks SET stats = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(stats), updatedAt, id]
  );
}

export async function updateTaskCliTemplates(id: string, cliTemplates: string | null): Promise<void> {
  const updatedAt = now();
  await run(
    `UPDATE tasks SET cli_templates = ?, updated_at = ? WHERE id = ?`,
    [cliTemplates, updatedAt, id],
  );
}
