import { FastifyInstance } from 'fastify';
import { listPlatforms, createPlatform, getPlatformById, listFieldMappings, getMappingsForPlatform } from '@scopai/core';

export default async function platformsRoutes(app: FastifyInstance) {
  app.get('/platforms', async () => listPlatforms());

  app.post('/platforms', async (request) => {
    const { id, name, description } = request.body as { id: string; name: string; description?: string };
    const existing = await getPlatformById(id);
    if (existing) {
      return { id: existing.id, existed: true };
    }
    await createPlatform({ id, name, description: description ?? null });
    return { id, existed: false };
  });

  app.get('/platforms/:id/mappings', async (request) => {
    const { id } = request.params as { id: string };
    const { entity } = request.query as Record<string, string>;
    if (entity) {
      return getMappingsForPlatform(id, entity);
    }
    return listFieldMappings(id);
  });
}
