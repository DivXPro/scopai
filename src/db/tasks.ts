import { query, run } from './client';
import { Task, TaskStats } from '../shared/types';
import { now } from '../shared/utils';

export function createTask(task: Task): Task {
  run(
    `INSERT INTO tasks (id, name, description, template_id, status, stats, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [task.id, task.name, task.description, task.template_id, task.status,
     task.stats ? JSON.stringify(task.stats) : null,
     task.created_at, task.updated_at, task.completed_at]
  );
  return task;
}

export function getTaskById(id: string): Task | null {
  const rows = query<Task>('SELECT * FROM tasks WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export function listTasks(status?: string): Task[] {
  const sql = status ? 'SELECT * FROM tasks WHERE status = ? ORDER BY created_at DESC' : 'SELECT * FROM tasks ORDER BY created_at DESC';
  const params = status ? [status] : [];
  return query<Task>(sql, params);
}

export function updateTaskStatus(id: string, status: string): void {
  const updatedAt = now();
  const completedAt = (status === 'completed' || status === 'failed') ? now() : null;
  run(
    `UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?`,
    [status, updatedAt, completedAt, id]
  );
}

export function updateTaskStats(id: string, stats: TaskStats): void {
  const updatedAt = now();
  run(
    `UPDATE tasks SET stats = ?, updated_at = ? WHERE id = ?`,
    [JSON.stringify(stats), updatedAt, id]
  );
}
