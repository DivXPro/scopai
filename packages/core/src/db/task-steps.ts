import { query, run } from './client';
import { TaskStep, TaskStats } from '../shared/types';
import { generateId, now } from '../shared/utils';

export async function createTaskStep(
  step: Omit<TaskStep, 'id' | 'created_at' | 'updated_at'>,
): Promise<TaskStep> {
  const id = generateId();
  const ts = now();
  await run(
    `INSERT INTO task_steps (id, task_id, strategy_id, depends_on_step_id, name, step_order, status, stats, error, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      step.task_id,
      step.strategy_id ?? null,
      step.depends_on_step_id ?? null,
      step.name,
      step.step_order,
      step.status,
      step.stats ? JSON.stringify(step.stats) : null,
      step.error ?? null,
      ts,
      ts,
    ],
  );
  return { ...step, id, created_at: ts, updated_at: ts };
}

export async function listTaskSteps(taskId: string): Promise<TaskStep[]> {
  const rows = await query<TaskStep>(
    'SELECT * FROM task_steps WHERE task_id = ? ORDER BY step_order, created_at',
    [taskId],
  );
  return rows.map(r => ({
    ...r,
    depends_on_step_id: (r as any).depends_on_step_id ?? null,
    stats: typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats,
  }));
}

export async function getTaskStepById(stepId: string): Promise<TaskStep | null> {
  const rows = await query<TaskStep>('SELECT * FROM task_steps WHERE id = ?', [stepId]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...r, depends_on_step_id: (r as any).depends_on_step_id ?? null, stats: typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats };
}

export async function updateTaskStepStatus(
  stepId: string,
  status: string,
  stats?: TaskStats,
  error?: string,
): Promise<void> {
  const ts = now();
  await run(
    `UPDATE task_steps SET status = ?, stats = ?, error = ?, updated_at = ? WHERE id = ?`,
    [status, stats ? JSON.stringify(stats) : null, error ?? null, ts, stepId],
  );
}

export async function getNextStepOrder(taskId: string): Promise<number> {
  const rows = await query<{ max_order: bigint }>(
    'SELECT MAX(step_order) as max_order FROM task_steps WHERE task_id = ?',
    [taskId],
  );
  return Number(rows[0]?.max_order ?? -1) + 1;
}
