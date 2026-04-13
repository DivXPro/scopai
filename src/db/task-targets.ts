import { query, run } from './client';
import { TaskTarget, TaskStats } from '../shared/types';
import { generateId, now } from '../shared/utils';

export function createTaskTarget(taskId: string, targetType: 'post' | 'comment', targetId: string): TaskTarget {
  const id = generateId();
  const ts = now();
  run(
    `INSERT INTO task_targets (id, task_id, target_type, target_id, status, error, created_at)
     VALUES (?, ?, ?, ?, 'pending', NULL, ?)`,
    [id, taskId, targetType, targetId, ts]
  );
  return { id, task_id: taskId, target_type: targetType, target_id: targetId, status: 'pending', error: null, created_at: ts };
}

export function addTaskTargets(taskId: string, targetType: 'post' | 'comment', targetIds: string[]): void {
  for (const targetId of targetIds) {
    createTaskTarget(taskId, targetType, targetId);
  }
}

export function listTaskTargets(taskId: string): TaskTarget[] {
  return query<TaskTarget>('SELECT * FROM task_targets WHERE task_id = ?', [taskId]);
}

export function updateTargetStatus(taskId: string, targetType: string, targetId: string, status: string, error?: string): void {
  run(
    `UPDATE task_targets SET status = ?, error = ? WHERE task_id = ? AND target_type = ? AND target_id = ?`,
    [status, error ?? null, taskId, targetType, targetId]
  );
}

export interface TargetStatsResult extends TaskStats {
  pending: { target_type: string; target_id: string }[];
}

export function getTargetStats(taskId: string): TargetStatsResult {
  const total = query<{ cnt: bigint }>('SELECT COUNT(*) as cnt FROM task_targets WHERE task_id = ?', [taskId]);
  const done = query<{ cnt: bigint }>('SELECT COUNT(*) as cnt FROM task_targets WHERE task_id = ? AND status = ?', [taskId, 'done']);
  const failed = query<{ cnt: bigint }>('SELECT COUNT(*) as cnt FROM task_targets WHERE task_id = ? AND status = ?', [taskId, 'failed']);
  const pending = query<{ target_type: string; target_id: string }>('SELECT target_type, target_id FROM task_targets WHERE task_id = ? AND status = ?', [taskId, 'pending']);
  return {
    total: Number(total[0]?.cnt ?? 0),
    done: Number(done[0]?.cnt ?? 0),
    failed: Number(failed[0]?.cnt ?? 0),
    pending,
  };
}
