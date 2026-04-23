import { FastifyInstance } from 'fastify';
import { retryFailedJobs, resetJobs, getQueueStats, listRecentJobs } from '@analyze-cli/core';

export default async function queueRoutes(app: FastifyInstance) {
  app.get('/queue', async (request) => {
    const { status } = request.query as Record<string, string>;
    const [stats, jobs] = await Promise.all([
      getQueueStats(),
      listRecentJobs(status || undefined, 50),
    ]);
    return { stats, jobs };
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
