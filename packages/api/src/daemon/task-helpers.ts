import {
  getStrategyById,
  listTaskTargets,
  getExistingJobTargets,
  enqueueJobs,
  generateId,
  updateTaskStepStatus,
} from '@scopai/core';
import type { QueueJob, TaskStep } from '@scopai/core';

export interface EnqueueStepResult {
  status: 'running' | 'completed' | 'skipped';
  enqueued: number;
}

export async function enqueueStepJobs(
  taskId: string,
  step: TaskStep,
): Promise<EnqueueStepResult> {
  const strategy = await getStrategyById(step.strategy_id ?? '');
  if (!strategy) {
    throw new Error(`Strategy not found: ${step.strategy_id}`);
  }

  const targets = await listTaskTargets(taskId);
  const relevantTargets = targets.filter(t => t.target_type === strategy.target);

  if (relevantTargets.length === 0) {
    await updateTaskStepStatus(step.id, 'skipped', { total: 0, done: 0, failed: 0 });
    return { status: 'skipped', enqueued: 0 };
  }

  const existingTargets = await getExistingJobTargets(taskId, strategy.id);
  const newTargets = relevantTargets.filter(t => !existingTargets.has(t.target_id));

  if (newTargets.length === 0) {
    if (step.status === 'pending') {
      await updateTaskStepStatus(step.id, 'running', { total: existingTargets.size, done: 0, failed: 0 });
    }
    return { status: 'running', enqueued: 0 };
  }

  const jobs: QueueJob[] = newTargets.map(t => ({
    id: generateId(),
    task_id: taskId,
    strategy_id: strategy.id,
    target_type: strategy.target as 'post' | 'comment',
    target_id: t.target_id,
    status: 'pending',
    priority: 0,
    attempts: 0,
    max_attempts: 3,
    error: null,
    created_at: new Date(),
    processed_at: null,
  }));

  await enqueueJobs(jobs);
  await updateTaskStepStatus(step.id, 'running', { total: newTargets.length, done: 0, failed: 0 });

  return { status: 'running', enqueued: jobs.length };
}
