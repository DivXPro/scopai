import { FastifyInstance } from 'fastify';
import {
  getTaskById,
  createTask,
  getStrategyById,
  getPostById,
  listTaskTargets,
  listTaskSteps,
  createTaskStep,
  createTaskTarget,
  enqueueJobs,
  getExistingJobTargets,
  deleteJobsByTaskAndStrategy,
  countMediaFilesByPost,
  generateId,
  now,
  updateTaskStepStatus,
  deleteStrategyResultsByTaskAndStrategy,
} from '@scopai/core';
import type { QueueJob, Task } from '@scopai/core';

export default async function analyzeRoutes(app: FastifyInstance) {
  app.post('/analyze/run', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const taskId = body.task_id as string;
    const strategyId = body.strategy_id as string;

    if (!taskId || !strategyId) {
      reply.code(400);
      throw new Error('task_id and strategy_id are required');
    }

    const task = await getTaskById(taskId);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${taskId}`);
    }

    const strategy = await getStrategyById(strategyId);
    if (!strategy) {
      reply.code(404);
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    const targets = await listTaskTargets(taskId);
    const relevantTargets = targets.filter((t) => {
      if (strategy.target === 'post') return t.target_type === 'post';
      if (strategy.target === 'comment') return t.target_type === 'comment';
      return true;
    });

    if (relevantTargets.length === 0) {
      return { enqueued: 0, skipped: 0 };
    }

    const jobs: QueueJob[] = relevantTargets.map((t) => ({
      id: generateId(),
      task_id: taskId,
      strategy_id: strategyId,
      target_type: strategy.target as 'post' | 'comment' | 'media',
      target_id: t.target_id,
      status: 'pending' as const,
      priority: 0,
      attempts: 0,
      max_attempts: 3,
      error: null,
      created_at: new Date(),
      processed_at: null,
    }));

    await enqueueJobs(jobs);
    return { enqueued: jobs.length, skipped: 0 };
  });

  app.post('/analyze/submit', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const strategyId = body.strategy_id as string;
    const taskId = body.task_id as string | undefined;
    const postIds = (body.post_ids as string[] | undefined) ?? [];
    const commentIds = (body.comment_ids as string[] | undefined) ?? [];
    const force = (body.force as boolean | undefined) ?? false;

    if (!strategyId) {
      reply.code(400);
      throw new Error('strategy_id is required');
    }

    const strategy = await getStrategyById(strategyId);
    if (!strategy) {
      reply.code(404);
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    // Determine targets based on strategy.target
    const targets: Array<{ target_type: 'post' | 'comment'; target_id: string }> = [];
    if (strategy.target === 'post') {
      if (postIds.length === 0) {
        reply.code(400);
        throw new Error('post_ids are required for post-target strategies');
      }
      for (const id of postIds) targets.push({ target_type: 'post', target_id: id });
    } else {
      if (commentIds.length === 0) {
        reply.code(400);
        throw new Error('comment_ids are required for comment-target strategies');
      }
      for (const id of commentIds) targets.push({ target_type: 'comment', target_id: id });
    }

    // Create or reuse task
    let task: Task;
    if (taskId) {
      const existing = await getTaskById(taskId);
      if (!existing) {
        reply.code(404);
        throw new Error(`Task not found: ${taskId}`);
      }
      task = existing;
    } else {
      const id = generateId();
      const ts = now();
      await createTask({
        id,
        name: `策略分析 - ${strategy.name}`,
        description: null,
        cli_templates: null,
        status: 'pending',
        stats: { total: 0, done: 0, failed: 0 },
        created_at: ts,
        updated_at: ts,
        completed_at: null,
      });
      task = (await getTaskById(id))!;
    }

    // Ensure step exists for this strategy
    const steps = await listTaskSteps(task.id);
    let step = steps.find(s => s.strategy_id === strategyId);
    if (!step) {
      step = await createTaskStep({
        task_id: task.id,
        strategy_id: strategyId,
        depends_on_step_id: null,
        name: strategy.name,
        step_order: steps.length,
        status: 'pending',
        stats: null,
        error: null,
      });
    }

    // Register task_targets (idempotent via INSERT OR IGNORE)
    for (const t of targets) {
      await createTaskTarget(task.id, t.target_type, t.target_id);
    }

    // Deduplicate against existing jobs (any status = already handled or in progress)
    const existingJobTargets = await getExistingJobTargets(task.id, strategyId);

    if (force) {
      // Delete old results so re-analysis can succeed (UNIQUE constraint on result table)
      await deleteStrategyResultsByTaskAndStrategy(task.id, strategyId);
      // Also delete old completed/failed jobs so they can be re-enqueued
      await deleteJobsByTaskAndStrategy(task.id, strategyId);
      // All targets are eligible for re-analysis
      var newTargets = targets;
    } else {
      // Skip targets that already have jobs in queue (any status)
      var newTargets = targets.filter(t => !existingJobTargets.has(t.target_id));
    }

    if (newTargets.length === 0) {
      return { task_id: task.id, enqueued: 0, skipped: targets.length };
    }

    // Check media readiness for post targets when strategy needs media
    if (strategy.target === 'post' && strategy.needs_media?.enabled) {
      const mediaReady: typeof targets = [];
      const mediaSkipped: typeof targets = [];
      for (const t of newTargets) {
        const post = await getPostById(t.target_id);
        if (!post) { mediaSkipped.push(t); continue; }
        const downloadedCount = await countMediaFilesByPost(t.target_id);
        const rawMedia = post.media_files;
        const mediaArr = Array.isArray(rawMedia) ? rawMedia : (typeof rawMedia === 'string' ? JSON.parse(rawMedia) : null);
        const expectedCount = Array.isArray(mediaArr) ? mediaArr.length : 0;
        if (downloadedCount > 0 || expectedCount === 0) {
          mediaReady.push(t);
        } else {
          mediaSkipped.push(t);
        }
      }
      newTargets = mediaReady;
      if (mediaSkipped.length > 0) {
        // Re-register skipped targets so they can be submitted later after media download
        // (they were already registered above, so no action needed)
      }
    }

    if (newTargets.length === 0) {
      return { task_id: task.id, enqueued: 0, skipped: targets.length };
    }

    // Enqueue jobs
    const jobs: QueueJob[] = newTargets.map(t => ({
      id: generateId(),
      task_id: task.id,
      strategy_id: strategyId,
      target_type: t.target_type as 'post' | 'comment' | 'media',
      target_id: t.target_id,
      status: 'pending' as const,
      priority: 0,
      attempts: 0,
      max_attempts: 3,
      error: null,
      created_at: new Date(),
      processed_at: null,
    }));

    await enqueueJobs(jobs);

    // Update step status to running
    const allJobsCount = existingJobTargets.size + newTargets.length;
    await updateTaskStepStatus(step.id, 'running', { total: allJobsCount, done: 0, failed: 0 });

    return { task_id: task.id, enqueued: newTargets.length, skipped: targets.length - newTargets.length };
  });
}
