import type { QueueJob } from '@scopai/core';

export interface EnqueueResult {
  enqueued: number;
  skipped: number;
}

export interface StepInfo {
  id: string;
  strategy_id: string | null;
  depends_on_step_id: string | null;
  status: string;
  stats?: { total: number; done: number; failed: number } | null;
}

export interface StrategyInfo {
  id: string;
  target: 'post' | 'comment';
  needs_media?: { enabled: boolean } | null;
}

export interface TargetInfo {
  target_id: string;
  target_type: string;
}

export interface StepUpdate {
  stepId: string;
  status: string;
  stats: { total: number; done: number; failed: number };
}

/**
 * Pure logic: builds queue_jobs for a single post given already-resolved data.
 * No database access — all inputs are passed as arguments.
 */
export function buildJobsForPost(
  taskId: string,
  postId: string,
  steps: StepInfo[],
  strategies: Map<string, StrategyInfo>,
  taskTargets: TargetInfo[],
  existingTargets: Set<string>,
  comments: { id: string }[],
  mediaReady: boolean,
  generateIdFn: () => string,
): { jobs: QueueJob[]; stepUpdates: StepUpdate[] } {
  const pendingSteps = steps.filter(s =>
    (s.status === 'pending' || s.status === 'running') && !s.depends_on_step_id
  );
  const jobs: QueueJob[] = [];
  const stepUpdates: StepUpdate[] = [];

  for (const step of pendingSteps) {
    if (!step.strategy_id) continue;

    const strategy = strategies.get(step.strategy_id);
    if (!strategy) continue;

    // Check media dependency
    if (strategy.needs_media && strategy.needs_media.enabled && !mediaReady) {
      continue;
    }

    // Resolve targets for this step on this post
    const targets = resolveTargetsForPost(postId, strategy.target, taskTargets, comments);
    if (targets.length === 0) continue;

    // Skip targets already enqueued for this step
    const newTargets = targets.filter(t => !existingTargets.has(t.target_id));
    if (newTargets.length === 0) continue;

    // Build jobs
    const newJobs = newTargets.map(t => ({
      id: generateIdFn(),
      task_id: taskId,
      strategy_id: step.strategy_id,
      target_type: strategy.target as 'post' | 'comment',
      target_id: t.target_id,
      status: 'pending' as const,
      priority: 0,
      attempts: 0,
      max_attempts: 3,
      error: null,
      created_at: new Date(),
      processed_at: null,
    }));

    jobs.push(...newJobs);

    // Update step stats
    const currentTotal = (step.stats?.total ?? 0) + newJobs.length;
    stepUpdates.push({
      stepId: step.id,
      status: step.status === 'pending' ? 'running' : step.status,
      stats: {
        total: currentTotal,
        done: step.stats?.done ?? 0,
        failed: step.stats?.failed ?? 0,
      },
    });
  }

  return { jobs, stepUpdates };
}

function resolveTargetsForPost(
  postId: string,
  targetType: string,
  taskTargets: TargetInfo[],
  comments: { id: string }[],
): Array<{ target_id: string; target_type: string }> {
  if (targetType === 'post') {
    const isMember = taskTargets.some(t => t.target_type === 'post' && t.target_id === postId);
    if (!isMember) return [];
    return [{ target_id: postId, target_type: 'post' }];
  }

  if (targetType === 'comment') {
    return comments.map(c => ({ target_id: c.id, target_type: 'comment' }));
  }

  return [];
}
