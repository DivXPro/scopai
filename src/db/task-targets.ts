import { query, run } from './client';
import { TaskTarget } from '../shared/types';
import { generateId, now } from '../shared/utils';

export async function createTaskTarget(taskId: string, targetType: 'post' | 'comment', targetId: string): Promise<TaskTarget> {
  const id = generateId();
  const ts = now();
  await run(
    `INSERT OR IGNORE INTO task_targets (id, task_id, target_type, target_id, status, error, created_at)
     VALUES (?, ?, ?, ?, 'pending', NULL, ?)`,
    [id, taskId, targetType, targetId, ts]
  );
  return { id, task_id: taskId, target_type: targetType, target_id: targetId, status: 'pending', error: null, created_at: ts };
}

export async function addTaskTargets(taskId: string, targetType: 'post' | 'comment', targetIds: string[]): Promise<void> {
  for (const targetId of targetIds) {
    await createTaskTarget(taskId, targetType, targetId);
  }
}

export async function listTaskTargets(taskId: string): Promise<TaskTarget[]> {
  return query<TaskTarget>('SELECT * FROM task_targets WHERE task_id = ?', [taskId]);
}

export async function updateTargetStatus(taskId: string, targetType: string, targetId: string, status: string, error?: string): Promise<void> {
  await run(
    `UPDATE task_targets SET status = ?, error = ? WHERE task_id = ? AND target_type = ? AND target_id = ?`,
    [status, error ?? null, taskId, targetType, targetId]
  );
}

export interface TargetStatsResult {
  total: number;
  done: number;
  failed: number;
  pending: { target_type: string; target_id: string }[];
}

export async function getTargetStats(taskId: string): Promise<TargetStatsResult> {
  const total = await query<{ cnt: bigint }>('SELECT COUNT(*) as cnt FROM task_targets WHERE task_id = ?', [taskId]);
  const done = await query<{ cnt: bigint }>('SELECT COUNT(*) as cnt FROM task_targets WHERE task_id = ? AND status = ?', [taskId, 'done']);
  const failed = await query<{ cnt: bigint }>('SELECT COUNT(*) as cnt FROM task_targets WHERE task_id = ? AND status = ?', [taskId, 'failed']);
  const pending = await query<{ target_type: string; target_id: string }>('SELECT target_type, target_id FROM task_targets WHERE task_id = ? AND status = ?', [taskId, 'pending']);
  return {
    total: Number(total[0]?.cnt ?? 0),
    done: Number(done[0]?.cnt ?? 0),
    failed: Number(failed[0]?.cnt ?? 0),
    pending,
  };
}
