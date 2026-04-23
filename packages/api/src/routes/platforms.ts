import { FastifyInstance } from 'fastify';
import { listPlatforms, createPlatform } from '@analyze-cli/core';

export default async function platformsRoutes(app: FastifyInstance) {
  app.get('/platforms', async () => listPlatforms());

  app.post('/platforms', async (request) => {
    const { id, name, description } = request.body as { id: string; name: string; description?: string };
    await createPlatform({ id, name, description: description ?? null });
    return { id };
  });
}
