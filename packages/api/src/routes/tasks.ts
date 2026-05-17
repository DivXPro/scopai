import { FastifyInstance } from 'fastify';
import {
  createTask, getTaskById, listTasks, countTasks, updateTaskStatus, updateTaskStats,
  listTaskSteps, listJobsByTask, listStrategyResultsByTask, getStrategyResultStats,
  getTargetStats,
  addTaskTargets, listTaskTargets,
  createTaskStep, getNextStepOrder, getTaskStepById, updateTaskStepStatus,
  deleteJobsByTaskAndStrategy,
  deleteStrategyResultsByTaskAndStrategy,
  getStrategyById,
  listDefaultStrategies,
  generateId, now,
  getTaskPostStatuses,
  insertStrategyResult,
  listMediaFilesByPost, getPostById,
  retryFailedJobs,
  notifyJobAvailable,
  query,
  checkpoint,
  getLogger,
  getRouterResultsByTask,
} from '@scopai/core';
import type { Strategy } from '@scopai/core';
import { enqueueStepJobs } from '../daemon/task-helpers';
import type { QueueJob } from '@scopai/core';
import { getHandlers } from '../daemon/handlers';

export default async function tasksRoutes(app: FastifyInstance) {
  app.get('/tasks', async (request) => {
    const { status, query: searchQuery, limit = '50', offset = '0' } = request.query as Record<string, string>;
    const [items, total] = await Promise.all([
      listTasks(status, searchQuery, parseInt(limit, 10), parseInt(offset, 10)),
      countTasks(status, searchQuery),
    ]);
    const parsedItems = items.map(t => ({
      ...t,
      stats: typeof t.stats === 'string' && t.stats
        ? JSON.parse(t.stats)
        : t.stats ?? { total: 0, done: 0, failed: 0 },
    }));
    return { items: parsedItems, total };
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

    // Fetch post titles and platform_ids for the matrix display
    const postIds = postStatuses.map(p => p.post_id);
    const postDetailsMap = new Map<string, { title: string | null; platform_id: string }>();
    if (postIds.length > 0) {
      const placeholders = postIds.map(() => '?').join(',');
      const posts = await query<{ id: string; title: string | null; platform_id: string }>(
        `SELECT id, title, platform_id FROM posts WHERE id IN (${placeholders})`,
        postIds,
      );
      for (const p of posts) {
        postDetailsMap.set(p.id, { title: p.title, platform_id: p.platform_id });
      }
    }

    const totalPosts = postStatuses.length;
    const donePosts = postStatuses.filter(p => p.status === 'done').length;
    const failedPosts = postStatuses.filter(p => p.status === 'failed').length;
    const fetchingPosts = postStatuses.filter(p => p.status === 'fetching').length;
    const pendingPosts = postStatuses.filter(p => p.status === 'pending').length;
    const commentsFetched = postStatuses.filter(p => p.comments_fetched).length;
    const mediaFetched = postStatuses.filter(p => p.media_fetched).length;

    let dataPrepStatus: 'pending' | 'fetching' | 'done' | 'failed' = 'done';
    if (totalPosts === 0) {
      dataPrepStatus = 'pending';
    } else if (failedPosts > 0 && failedPosts === totalPosts) {
      dataPrepStatus = 'failed';
    } else if (fetchingPosts > 0) {
      dataPrepStatus = 'fetching';
    } else if (pendingPosts > 0) {
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

    const jobStats = {
      totalJobs: jobs.length,
      completedJobs: jobs.filter(j => j.status === 'completed').length,
      failedJobs: jobs.filter(j => j.status === 'failed').length,
      pendingJobs: jobs.filter(j => j.status === 'pending' || j.status === 'waiting_media').length,
      processingJobs: jobs.filter(j => j.status === 'processing').length,
    };

    const recentErrors = jobs
      .filter(j => j.status === 'failed' && j.error)
      .slice(0, 3)
      .map(j => ({
        target_type: j.target_type ?? 'unknown',
        target_id: j.target_id ?? '',
        error: j.error ?? '',
      }));

    const taskStats = typeof task.stats === 'string' && task.stats
      ? JSON.parse(task.stats)
      : task.stats ?? { total: 0, done: 0, failed: 0 };

    // Compute strategy_stats if task has a router step
    const routerStep = steps.find(s => {
      const st = stepDetails.find(d => d.stepId === s.id);
      return st?.strategyId ? false : false; // placeholder, will resolve below
    });

    // Find router step by checking strategies
    let hasRouterStep = false;
    let routerStepId: string | null = null;
    for (const step of steps) {
      if (step.strategy_id) {
        const st = await getStrategyById(step.strategy_id);
        if (st?.is_router) {
          hasRouterStep = true;
          routerStepId = step.id;
          break;
        }
      }
    }

    let strategyStats: Array<{
      strategyId: string;
      strategyName: string;
      applicableCount: number;
      doneCount: number;
      processingCount: number;
      failedCount: number;
    }> = [];

    let routerResultsMap = new Map<string, { applicable: string[]; skipped: Array<{ strategy_id: string; reason: string }> }>();

    if (hasRouterStep && routerStepId) {
      const routerResults = await getRouterResultsByTask(id);
      for (const r of routerResults) {
        routerResultsMap.set(r.post_id, {
          applicable: r.applicable_strategy_ids,
          skipped: r.skipped_strategies,
        });
      }

      // Build per-strategy stats
      const strategyMap = new Map<string, { name: string; applicable: number; done: number; processing: number; failed: number }>();
      for (const step of steps) {
        if (!step.strategy_id) continue;
        const st = await getStrategyById(step.strategy_id);
        if (!st || st.is_router) continue;
        if (!strategyMap.has(st.id)) {
          strategyMap.set(st.id, { name: st.name, applicable: 0, done: 0, processing: 0, failed: 0 });
        }
      }

      for (const [postId, result] of routerResultsMap) {
        for (const sid of result.applicable) {
          const entry = strategyMap.get(sid);
          if (entry) entry.applicable++;
        }
      }

      // Cross-reference with jobs for done/processing/failed counts
      for (const job of jobs) {
        if (!job.strategy_id || job.target_type !== 'post') continue;
        const entry = strategyMap.get(job.strategy_id);
        if (!entry) continue;
        const postResult = routerResultsMap.get(job.target_id);
        if (!postResult?.applicable.includes(job.strategy_id)) continue;
        if (job.status === 'completed') entry.done++;
        else if (job.status === 'failed') entry.failed++;
        else if (job.status === 'processing' || job.status === 'pending') entry.processing++;
      }

      strategyStats = Array.from(strategyMap.entries()).map(([strategyId, data]) => ({
        strategyId,
        strategyName: data.name,
        applicableCount: data.applicable,
        doneCount: data.done,
        processingCount: data.processing,
        failedCount: data.failed,
      }));
    }

    return {
      ...task,
      stats: taskStats,
      ...stats,
      progress: {
        dataPreparation: {
          status: dataPrepStatus,
          totalPosts,
          donePosts,
          failedPosts,
          fetchingPosts,
          pendingPosts,
          commentsFetched,
          mediaFetched,
        },
        analysis: jobStats,
      },
      steps: stepDetails,
      strategyStats,
      recentErrors,
      postStatuses: postStatuses.map(p => {
        const postDetail = postDetailsMap.get(p.post_id);
        const routerResult = routerResultsMap.get(p.post_id);
        return {
          postId: p.post_id,
          status: p.status,
          commentsFetched: p.comments_fetched,
          mediaFetched: p.media_fetched,
          error: p.error,
          title: postDetail?.title ?? null,
          platformId: postDetail?.platform_id ?? '',
          routerStatus: routerResult ? 'routed' : (hasRouterStep ? 'pending' : null),
          routerApplicableCount: routerResult?.applicable.length ?? null,
        };
      }),
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
    const { strategy_id, limit = '100', offset = '0' } = request.query as Record<string, string>;

    if (!strategy_id) {
      reply.code(400);
      throw new Error('strategy_id is required');
    }

    const results = await listStrategyResultsByTask(strategy_id, id, parseInt(limit, 10), parseInt(offset, 10));
    const stats = await getStrategyResultStats(strategy_id, id);

    return { results, stats };
  });

  app.get('/tasks/:id/routing', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }

    const steps = await listTaskSteps(id);
    let routerStepId: string | null = null;
    let routerStrategyId: string | null = null;
    for (const step of steps) {
      if (step.strategy_id) {
        const st = await getStrategyById(step.strategy_id);
        if (st?.is_router) {
          routerStepId = step.id;
          routerStrategyId = st.id;
          break;
        }
      }
    }

    if (!routerStepId) {
      return {
        task_id: id,
        router_step_id: null,
        router_strategy_id: null,
        decisions: [],
      };
    }

    const routerResults = await getRouterResultsByTask(id);
    const strategyMap = new Map<string, string>();
    for (const step of steps) {
      if (step.strategy_id && !strategyMap.has(step.strategy_id)) {
        const st = await getStrategyById(step.strategy_id);
        if (st) strategyMap.set(step.strategy_id, st.name);
      }
    }

    const decisions = routerResults.map(r => ({
      post_id: r.post_id,
      applicable: r.applicable_strategy_ids.map(sid => ({
        strategy_id: sid,
        strategy_name: strategyMap.get(sid) ?? sid,
      })),
      skipped: r.skipped_strategies.map(s => ({
        strategy_id: s.strategy_id,
        strategy_name: strategyMap.get(s.strategy_id) ?? s.strategy_id,
        reason: s.reason,
      })),
      checks: r.checks,
      confidence: r.confidence,
    }));

    return {
      task_id: id,
      router_step_id: routerStepId,
      router_strategy_id: routerStrategyId,
      decisions,
    };
  });

  app.post('/tasks', async (request, reply) => {
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

    const stepIds: string[] = [];
    let order = 0;

    const routerStrategyId = data.router_strategy_id as string | undefined;
    if (routerStrategyId) {
      // Router mode: validate router strategy and create router step + candidate steps
      const routerStrategy = await getStrategyById(routerStrategyId);
      if (!routerStrategy) {
        reply.code(400);
        throw new Error(`Router strategy not found: ${routerStrategyId}`);
      }
      if (!routerStrategy.is_router) {
        reply.code(400);
        throw new Error(`Strategy ${routerStrategyId} is not a router strategy`);
      }

      // Create router step first
      const routerStep = await createTaskStep({
        task_id: id,
        strategy_id: routerStrategy.id,
        name: routerStrategy.name,
        step_order: order++,
        status: 'pending',
        stats: { total: 0, done: 0, failed: 0 },
        error: null,
      });
      stepIds.push(routerStep.id);

      // Resolve candidate strategies
      const candidateIds = data.candidate_strategy_ids as string[] | undefined;
      const candidates: Strategy[] = [];
      if (Array.isArray(candidateIds)) {
        for (const sid of candidateIds) {
          const s = await getStrategyById(sid);
          if (s && !s.is_router) candidates.push(s);
        }
      } else {
        // Default: all non-router default strategies
        const defaults = await listDefaultStrategies();
        for (const s of defaults) {
          if (!s.is_router) candidates.push(s);
        }
      }

      for (const s of candidates) {
        const step = await createTaskStep({
          task_id: id,
          strategy_id: s.id,
          name: s.name,
          step_order: order++,
          status: 'pending',
          stats: { total: 0, done: 0, failed: 0 },
          error: null,
        });
        stepIds.push(step.id);
      }
    } else {
      // step_strategy_ids 语义：
      //   - 字段缺失（undefined）→ 用所有 is_default=true 的策略
      //   - 字段是数组（含 []）→ 原样使用，未知 id 静默跳过
      const stepStrategyIds = data.step_strategy_ids;
      let strategies: Strategy[];
      if (Array.isArray(stepStrategyIds)) {
        strategies = [];
        for (const sid of stepStrategyIds as string[]) {
          const s = await getStrategyById(sid);
          if (s) strategies.push(s);
        }
      } else {
        strategies = await listDefaultStrategies();
      }

      for (const s of strategies) {
        const step = await createTaskStep({
          task_id: id,
          strategy_id: s.id,
          name: s.name,
          step_order: order++,
          status: 'pending',
          stats: { total: 0, done: 0, failed: 0 },
          error: null,
        });
        stepIds.push(step.id);
      }
    }

    return { id, step_ids: stepIds };
  });

  app.post('/tasks/:id/start', async (request) => {
    const { id } = request.params as { id: string };
    await updateTaskStatus(id, 'running');
    return { status: 'running' };
  });

  app.post('/tasks/:id/pause', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }
    if (task.status !== 'running') {
      reply.code(400);
      throw new Error(`Cannot pause task with status ${task.status}`);
    }
    await updateTaskStatus(id, 'paused');
    return { status: 'paused' };
  });

  app.post('/tasks/:id/cancel', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }
    await updateTaskStatus(id, 'cancelled');
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

  app.post('/tasks/:id/prepare-jobs/retry', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }

    const retried = await retryFailedJobs(id);
    if (retried > 0) {
      notifyJobAvailable();
    }

    return { retried };
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
    const name = (body.name as string | undefined) ?? strategy.name ?? strategyId;
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

    const stepOrder = order ?? await getNextStepOrder(id);
    const step = await createTaskStep({
      task_id: id,
      strategy_id: strategyId,
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

    return enqueueStepJobs(id, step);
  });

  app.post('/tasks/:id/run-all-steps', async (request, reply) => {
    const { id } = request.params as { id: string };
    const task = await getTaskById(id);
    if (!task) {
      reply.code(404);
      throw new Error(`Task not found: ${id}`);
    }

    const steps = await listTaskSteps(id);
    const pendingSteps = steps
      .filter(s => s.status === 'pending' || s.status === 'failed')
      .sort((a, b) => a.step_order - b.step_order);

    let completed = 0;
    let failed = 0;
    let skipped = 0;

    for (const step of pendingSteps) {
      try {
        const result = await enqueueStepJobs(id, step);
        if (result.status === 'skipped') {
          skipped++;
        } else {
          completed++;
        }
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
