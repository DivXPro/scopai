import {
  getStrategyById,
  listTaskTargets,
  getExistingJobTargets,
  enqueueJobs,
  generateId,
  updateTaskStepStatus,
  listMediaFilesByPost,
} from '@scopai/core';
import type { QueueJob, TaskStep } from '@scopai/core';

export interface EnqueueStepResult {
  status: 'running' | 'completed' | 'skipped';
  enqueued: number;
}

export async function enqueueStepJobs(
  taskId: string,
  step: TaskStep,
  routerContext?: { routerStepId: string; routerResults?: Map<string, Set<string>> },
): Promise<EnqueueStepResult> {
  const strategy = await getStrategyById(step.strategy_id ?? '');
  if (!strategy) {
    throw new Error(`Strategy not found: ${step.strategy_id}`);
  }

  const targets = await listTaskTargets(taskId);
  let relevantTargets = targets.filter(t => t.target_type === strategy.target);

  // Router filtering: if router results exist and this is a post-level strategy,
  // only keep targets where the strategy is applicable
  if (routerContext?.routerResults && strategy.target === 'post') {
    relevantTargets = relevantTargets.filter(t => {
      const applicableSet = routerContext.routerResults!.get(t.target_id);
      return applicableSet?.has(strategy.id) ?? false;
    });
  }

  // Media-type routing: if the strategy demands specific media types,
  // filter out post targets whose available media doesn't intersect.
  // This is what keeps an image-only strategy from running on a video-only
  // post (and vice versa).
  const requiredMediaTypes = strategy.needs_media?.enabled
    ? strategy.needs_media.media_types ?? []
    : [];
  if (
    strategy.target === 'post' &&
    requiredMediaTypes.length > 0 &&
    relevantTargets.length > 0
  ) {
    const required = new Set(requiredMediaTypes);
    const filtered: typeof relevantTargets = [];
    for (const t of relevantTargets) {
      const mediaFiles = await listMediaFilesByPost(t.target_id);
      const has = mediaFiles.some((m) => required.has(m.media_type));
      if (has) filtered.push(t);
    }
    relevantTargets = filtered;
  }

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
