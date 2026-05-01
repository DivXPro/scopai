import { FastifyInstance } from 'fastify';
import tasksRoutes from './tasks';
import postsRoutes from './posts';
import platformsRoutes from './platforms';
import strategiesRoutes from './strategies';
import queueRoutes from './queue';
import statusRoutes from './status';
import creatorsRoutes from './creators';
import templatesRoutes from './templates';
import resultsRoutes from './results';
import analyzeRoutes from './analyze';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(tasksRoutes, { prefix: '/api' });
  await app.register(postsRoutes, { prefix: '/api' });
  await app.register(platformsRoutes, { prefix: '/api' });
  await app.register(strategiesRoutes, { prefix: '/api' });
  await app.register(queueRoutes, { prefix: '/api' });
  await app.register(statusRoutes, { prefix: '/api' });
  await app.register(creatorsRoutes, { prefix: '/api' });
  await app.register(templatesRoutes, { prefix: '/api' });
  await app.register(resultsRoutes, { prefix: '/api' });
  await app.register(analyzeRoutes, { prefix: '/api' });
}
