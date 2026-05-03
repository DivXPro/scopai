import { FastifyInstance } from 'fastify';
import {
  createTask, getTaskById, listTasks, countTasks, updateTaskStatus, updateTaskStats,
  listTaskSteps, listJobsByTask, listStrategyResultsByTask, getStrategyResultStats,
  getTargetStats,
  addTaskTargets, listTaskTargets,
  createTaskStep, getNextStepOrder, getTaskStepById, updateTaskStepStatus,
  enqueueJob, enqueueJobs, getExistingJobTargets, deleteJobsByTaskAndStrategy,
  deleteStrategyResultsByTaskAndStrategy,
  getStrategyById,
  generateId, now,
  getTaskPostStatuses,
  insertStrategyResult,
  listMediaFilesByPost, getPostById,
  query,
  checkpoint,
  getLogger,
} from '@scopai/core';
import type { QueueJob } from '@scopai/core';
import { getHandlers } from '../daemon/handlers';

export default async function tasksRoutes(app: FastifyInstance) {
  app.get('/tasks', async (request) => {
    const { status, query: searchQuery, limit = '50', offset = '0' } = request.query as Record<string, string>;
    const [items, total] = await Promise.all([
      listTasks(status, searchQuery, parseInt(limit, 10), parseInt(offset, 10)),
      countTasks(status, searchQuery),
    ]);
    return { items, total };
  });

  app.get('/tasks/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }

    const stats = await getTargetStats(id);
    const steps = await listTaskSteps(id);
    const jobs = await listJobsByTask(id);
    const postStatuses = await getTaskPostStatuses(id);

    const totalPosts = postStatuses.length;
    const commentsFetched = postStatuses.filter(p => p.comments_fetched).length;
    const mediaFetched = postStatuses.filter(p => p.media_fetched).length;
    const failedPosts = postStatuses.filter(p => p.status === 'failed').length;

    let dataPrepStatus: 'pending' | 'fetching' | 'done' | 'failed' = 'done';
    if (totalPosts === 0) {
      dataPrepStatus = 'pending';
    } else if (failedPosts > 0 && failedPosts === totalPosts) {
      dataPrepStatus = 'failed';
    } else if (postStatuses.some(p => p.status === 'fetching')) {
      dataPrepStatus = 'fetching';
    } else if (postStatuses.some(p => p.status === 'pending')) {
      dataPrepStatus = 'pending';
    }

    const stepDetails = steps.map(s => ({
      stepId: s.id,
      strategyId: s.strategy_id,
      name: s.name,
      status: s.status,
      stats: s.stats ?? { total: 0, done: 0, failed: 0 },
      stepOrder: s.step_order,
    }));

    const phase = dataPrepStatus !== 'done'
      ? 'dataPreparation'
      : stepDetails.some(s => s.status === 'pending' || s.status === 'running')
        ? 'analysis'
        : (task.status as string);

    const jobStats = {
      totalJobs: jobs.length,
      completedJobs: jobs.filter(j => j.status === 'completed').length,
      failedJobs: jobs.filter(j => j.status === 'failed').length,
      pendingJobs: jobs.filter(j => j.status === 'pending' || j.status === 'waiting_media').length,
    };

    const recentErrors = jobs
      .filter(j => j.status === 'failed' && j.error)
      .slice(0, 3)
      .map(j => ({
        target_type: j.target_type ?? 'unknown',
        target_id: j.target_id ?? '',
        error: j.error ?? '',
      }));

    return {
      ...task,
      ...stats,
      phase,
      phases: {
        dataPreparation: {
          status: dataPrepStatus,
          totalPosts,
          commentsFetched,
          mediaFetched,
          failedPosts,
        },
        steps: stepDetails,
        analysis: jobStats,
      },
      recentErrors,
      steps: steps.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        strategy_id: s.strategy_id,
        step_order: s.step_order,
        stats: s.stats,
      })),
      jobs: jobs.map((j) => ({
        id: j.id,
        target_type: j.target_type,
        target_id: j.target_id,
        status: j.status,
        attempts: j.attempts,
        error: j.error,
      })),
    };
  });

  app.get('/tasks/:id/results', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { strategy_id } = request.query as Record<string, string>;

    if (!strategy_id) {
      reply.code(400);
      throw new Error('strategy_id is required');
    }

    const results = await listStrategyResultsByTask(strategy_id, id, 100);
    const stats = await getStrategyResultStats(strategy_id, id);

    return { results, stats };
  });

  app.post('/tasks', async (request) => {
    const data = request.body as Record<string, unknown>;
    const id = (data.id as string) ?? generateId();
    const cliTemplates = data.cli_templates;
    const cliTemplatesStr = cliTemplates
      ? (typeof cliTemplates === 'string' ? cliTemplates : JSON.stringify(cliTemplates))
      : null;
    await createTask({
      id,
      name: data.name as string,
      description: (data.description ?? null) as string | null,
      cli_templates: cliTemplatesStr,
      status: 'pending',
      stats: { total: 0, done: 0, failed: 0 },
      created_at: now(),
      updated_at: now(),
      completed_at: null,
    });
    return { id };
  });

  app.post('/tasks/:id/start', async (request) => {
    const { id } = request.params as { id: string };
    await updateTaskStatus(id, 'running');
    return { status: 'running' };
  });

  app.post('/tasks/:id/pause', async (request) => {
    const { id } = request.params as { id: string };
    await updateTaskStatus(id, 'paused');
    return { status: 'paused' };
  });

  app.post('/tasks/:id/cancel', async (request) => {
    const { id } = request.params as { id: string };
    await updateTaskStatus(id, 'failed');
    return { status: 'cancelled' };
  });

  // --- Task action routes (enqueue jobs for async processing) ---

  app.post('/tasks/:id/prepare-data', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }

    const handlers = getHandlers();
    const result = await handlers['task.prepareData']({ task_id: id });
    return { ...(result as Record<string, unknown>), status: 'queued' };
  });

  app.post('/tasks/:id/add-posts', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const postIds = body.post_ids as string[] | undefined;

    if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
      reply.code(400);
      throw new Error('post_ids is required and must be a non-empty array');
    }

    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }

    const handlers = getHandlers();
    const result = await handlers['task.addTargets']({ task_id: id, target_type: 'post', target_ids: postIds });
    return result;
  });

  app.post('/tasks/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }

    await updateTaskStatus(id, 'running');
    return { taskId: id, status: 'running' };
  });

  app.post('/tasks/:id/steps', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const strategyId = body.strategy_id as string | undefined;
    const name = (body.name as string | undefined) ?? strategyId;
    const dependsOnStepId = body.depends_on_step_id as string | undefined;
    const order = body.order as number | undefined;

    if (!strategyId) {
      reply.code(400);
      throw new Error('strategy_id is required');
    }

    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }

    const strategy = await getStrategyById(strategyId);
    if (!strategy) {
      reply.code(400);
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    // Validate dependency
    if (strategy.depends_on) {
      if (!dependsOnStepId) {
        reply.code(400);
        throw new Error(`Strategy "${strategy.name}" requires depends_on_step_id (it depends on upstream results)`);
      }
      const upstreamStep = await getTaskStepById(dependsOnStepId);
      if (!upstreamStep) {
        reply.code(400);
        throw new Error(`Upstream step not found: ${dependsOnStepId}`);
      }
      if (upstreamStep.task_id !== id) {
        reply.code(400);
        throw new Error('Upstream step does not belong to this task');
      }
      if (!upstreamStep.strategy_id) {
        reply.code(400);
        throw new Error('Upstream step has no strategy');
      }
      const upstreamStrategy = await getStrategyById(upstreamStep.strategy_id);
      if (!upstreamStrategy) {
        reply.code(400);
        throw new Error(`Upstream strategy not found: ${upstreamStep.strategy_id}`);
      }
      if (upstreamStrategy.target !== strategy.depends_on) {
        reply.code(400);
        throw new Error(`Strategy depends_on="${strategy.depends_on}" but upstream strategy target="${upstreamStrategy.target}"`);
      }
    }

    const stepOrder = order ?? await getNextStepOrder(id);
    const step = await createTaskStep({
      task_id: id,
      strategy_id: strategyId,
      depends_on_step_id: dependsOnStepId ?? null,
      name: name!,
      step_order: stepOrder,
      status: 'pending',
      stats: { total: 0, done: 0, failed: 0 },
      error: null,
    });

    return { stepId: step.id, stepOrder: step.step_order };
  });

  app.post('/tasks/:id/steps/:stepId/run', async (request, reply) => {
    const { id, stepId } = request.params as { id: string; stepId: string };
    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }

    const step = await getTaskStepById(stepId);
    if (!step) {
      reply.code(404);
      throw new Error(`Step not found: ${stepId}`);
    }
    if (step.task_id !== id) {
      reply.code(400);
      throw new Error('Step does not belong to this task');
    }
    if (step.status === 'completed') {
      return { status: 'completed', enqueued: 0 };
    }
    if (step.status === 'skipped') {
      return { status: 'skipped', enqueued: 0 };
    }

    const strategy = await getStrategyById(step.strategy_id ?? '');
    if (!strategy) {
      reply.code(400);
      throw new Error(`Strategy not found: ${step.strategy_id}`);
    }

    const targets = await listTaskTargets(id);
    const relevantTargets = targets.filter(t => {
      if (strategy.target === 'post') return t.target_type === 'post';
      if (strategy.target === 'comment') return t.target_type === 'comment';
      return true;
    });

    if (relevantTargets.length === 0) {
      await updateTaskStepStatus(stepId, 'skipped', { total: 0, done: 0, failed: 0 });
      return { status: 'skipped', enqueued: 0 };
    }

    // Filter out targets already enqueued for this step
    const existingTargets = await getExistingJobTargets(id, strategy.id);
    const newTargets = relevantTargets.filter(t => !existingTargets.has(t.target_id));

    if (newTargets.length === 0) {
      if (step.status === 'pending') {
        await updateTaskStepStatus(stepId, 'running', { total: existingTargets.size, done: 0, failed: 0 });
      }
      return { status: 'running', enqueued: 0 };
    }

    const jobs: QueueJob[] = newTargets.map(t => ({
      id: generateId(),
      task_id: id,
      strategy_id: strategy.id,
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
    await updateTaskStepStatus(stepId, 'running', { total: newTargets.length, done: 0, failed: 0 });

    return { status: 'running', enqueued: jobs.length };
  });

  app.post('/tasks/:id/run-all-steps', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }

    const steps = await listTaskSteps(id);

    // Topological sort: steps with dependencies come after their upstream
    const stepMap = new Map(steps.map(s => [s.id, s]));
    const sorted = [...steps].sort((a, b) => {
      if (a.depends_on_step_id === b.id) return 1;
      if (b.depends_on_step_id === a.id) return -1;
      return a.step_order - b.step_order;
    });

    const pendingSteps = sorted.filter(s => s.status === 'pending' || s.status === 'failed');

    let completed = 0;
    let failed = 0;
    let skipped = 0;

    for (const step of pendingSteps) {
      if (step.depends_on_step_id) {
        const upstreamStep = stepMap.get(step.depends_on_step_id);
        if (upstreamStep && upstreamStep.status !== 'completed') {
          continue;
        }
      }

      try {
        // Inline the step.run logic to avoid circular route calls
        const strategy = await getStrategyById(step.strategy_id ?? '');
        if (!strategy) {
          await updateTaskStepStatus(step.id, 'failed', undefined, `Strategy not found: ${step.strategy_id}`);
          failed++;
          continue;
        }

        const targets = await listTaskTargets(id);
        const relevantTargets = targets.filter(t => {
          if (strategy.target === 'post') return t.target_type === 'post';
          if (strategy.target === 'comment') return t.target_type === 'comment';
          return true;
        });

        if (relevantTargets.length === 0) {
          await updateTaskStepStatus(step.id, 'skipped', { total: 0, done: 0, failed: 0 });
          skipped++;
          continue;
        }

        const existingTargets = await getExistingJobTargets(id, strategy.id);
        const newTargets = relevantTargets.filter(t => !existingTargets.has(t.target_id));

        if (newTargets.length === 0) {
          if (step.status === 'pending') {
            await updateTaskStepStatus(step.id, 'running', { total: existingTargets.size, done: 0, failed: 0 });
          }
          completed++;
          continue;
        }

        const jobs: QueueJob[] = newTargets.map(t => ({
          id: generateId(),
          task_id: id,
          strategy_id: strategy.id,
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
        await updateTaskStepStatus(step.id, 'running', { total: newTargets.length, done: 0, failed: 0 });
        completed++;
      } catch (err: unknown) {
        await updateTaskStepStatus(step.id, 'failed', undefined, err instanceof Error ? err.message : String(err));
        failed++;
      }
    }

    // Mark task completed if all steps are done
    const remaining = steps.filter(s => s.status === 'pending' || s.status === 'running');
    if (remaining.length === 0 && steps.every(s => s.status === 'completed' || s.status === 'skipped' || s.status === 'failed')) {
      await updateTaskStatus(id, 'completed');
    }

    return { completed, failed, skipped };
  });

  // --- Test-only: seed mock strategy results ---
  app.post('/tasks/:id/seed-results', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      reply.code(403);
      throw new Error('Not available in production');
    }

    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const strategyId = body.strategy_id as string | undefined;
    const results = body.results as Array<Record<string, unknown>> | undefined;

    if (!strategyId || !Array.isArray(results)) {
      reply.code(400);
      throw new Error('strategy_id and results are required');
    }

    const strategy = await getStrategyById(strategyId);
    if (!strategy) {
      reply.code(404);
      throw new Error(`Strategy not found: ${strategyId}`);
    }

    const outputSchema = strategy.output_schema as Record<string, unknown>;
    const properties = (outputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
    const dynamicColumns = Object.keys(properties);

    for (const result of results) {
      const dynamicValues = dynamicColumns.map(col => result[col]);
      await insertStrategyResult(strategyId, {
        task_id: id,
        target_type: (result.target_type as string) ?? 'post',
        target_id: (result.target_id as string) ?? '',
        post_id: (result.post_id as string) ?? null,
        strategy_version: (result.strategy_version as string) ?? '1.0.0',
        raw_response: (result.raw_response as Record<string, unknown>) ?? null,
        error: (result.error as string) ?? null,
        analyzed_at: new Date((result.analyzed_at as string) ?? new Date().toISOString()),
      }, dynamicColumns, dynamicValues);
    }

    return { inserted: results.length };
  });

  // --- List steps for a task ---
  app.get('/tasks/:id/steps', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }
    return listTaskSteps(id);
  });

  // --- Reset a task step ---
  app.post('/tasks/:id/steps/:stepId/reset', async (request, reply) => {
    const { id, stepId } = request.params as { id: string; stepId: string };
    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }

    const step = await getTaskStepById(stepId);
    if (!step) {
      reply.code(404);
      throw new Error(`Step not found: ${stepId}`);
    }
    if (step.task_id !== id) {
      reply.code(400);
      throw new Error('Step does not belong to this task');
    }

    // Clear old jobs and results so step run can recreate them
    if (step.strategy_id) {
      const deletedJobs = await deleteJobsByTaskAndStrategy(id, step.strategy_id);
      const deletedResults = await deleteStrategyResultsByTaskAndStrategy(id, step.strategy_id);
      getLogger().info(`[StepReset] Step ${stepId}: deleted ${deletedJobs} jobs, ${deletedResults} results for strategy ${step.strategy_id}`);
      if (deletedJobs > 0 || deletedResults > 0) {
        await checkpoint();
      }
    }

    await updateTaskStepStatus(stepId, 'pending', { total: 0, done: 0, failed: 0 });
    return { reset: true };
  });

  // --- Get media files for a task's posts ---
  app.get('/tasks/:id/media', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { post_id } = request.query as Record<string, string>;

    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }

    const targets = await listTaskTargets(id);
    const postTargets = targets.filter((t) => t.target_type === 'post');
    const postIds = postTargets.map((t) => t.target_id);

    if (post_id) {
      if (!postIds.includes(post_id)) {
        reply.code(400);
        throw new Error('Post not associated with this task');
      }
    }

    const relevantPostIds = post_id ? [post_id] : postIds;
    const posts: { post_id: string; title: string; media: unknown[] }[] = [];
    let totalMedia = 0;

    for (const pid of relevantPostIds) {
      const post = await getPostById(pid);
      if (!post) continue;
      const media = await listMediaFilesByPost(pid);
      totalMedia += media.length;
      posts.push({
        post_id: pid,
        title: post.title ?? post.content.slice(0, 50) ?? '(untitled)',
        media,
      });
    }

    return { posts, totalMedia, totalAnalyzed: 0 };
  });
}
