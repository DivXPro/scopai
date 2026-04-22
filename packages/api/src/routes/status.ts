import { FastifyInstance } from 'fastify';
import { getDbPath, getQueueStats } from '@analyze-cli/core';

export default async function statusRoutes(app: FastifyInstance) {
  app.get('/status', async () => ({
    pid: process.pid,
    db_path: getDbPath(),
    queue_stats: await getQueueStats(),
    uptime: process.uptime(),
  }));
}
