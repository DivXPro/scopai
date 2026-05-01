import { FastifyInstance } from 'fastify';
import {
  getTaskById,
  getStrategyById,
  listTaskTargets,
  generateId,
  enqueueJobs,
} from '@scopai/core';
import type { QueueJob } from '@scopai/core';

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
}
