import { FastifyInstance } from 'fastify';
import { retryFailedJobs, resetJobs, getQueueStats, listRecentJobs } from '@scopai/core';

export default async function queueRoutes(app: FastifyInstance) {
  app.get('/queue', async (request) => {
    const { status, limit = '50', offset = '0' } = request.query as Record<string, string>;
    const [stats, jobs] = await Promise.all([
      getQueueStats(),
      listRecentJobs(status || undefined, parseInt(limit, 10), parseInt(offset, 10)),
    ]);
    const total = stats.pending + stats.processing + stats.completed + stats.failed;
    return { stats, jobs, total };
  });

  app.post('/queue/retry', async () => {
    const retried = await retryFailedJobs();
    return { retried };
  });

  app.post('/queue/reset', async () => {
    const reset = await resetJobs();
    return { reset };
  });
}
