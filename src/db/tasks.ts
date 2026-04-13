import { query, run } from './client';
import { Task, TaskStats } from '../shared/types';
import { now } from '../shared/utils';

export async function createTask(task: Task): Promise<void> {
  await run(
    `INSERT INTO tasks (id, name, description, template_id, status, stats, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [task.id, task.name, task.description, task.template_id, task.status,
     task.stats ? JSON.stringify(task.stats) : null,
     task.created_at, task.updated_at, task.completed_at]
  );
}

export async function getTaskById(id: string): Promise<Task | null> {
  const rows = await query<Task>('SELECT * FROM tasks WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function listTasks(status?: string): Promise<Task[]> {
  const sql = status ? 'SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC' : 'SELECT * FROM tasks ORDER BY created_at DESC';
  const params = status ? [status] : [];
  return query<Task>(sql, params);
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
