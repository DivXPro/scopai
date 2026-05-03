import { FastifyInstance } from 'fastify';
import { createLabel, listLabels, deleteLabel } from '@scopai/core';

export default async function labelsRoutes(app: FastifyInstance) {
  app.get('/labels', async () => {
    return listLabels();
  });

  app.post('/labels', async (request, reply) => {
    const body = request.body as { name?: string; color?: string };
    if (!body.name) {
      reply.code(400);
      throw new Error('name is required');
    }
    return createLabel(body.name, body.color);
  });

  app.delete('/labels/:id', async (request) => {
    const { id } = request.params as { id: string };
    await deleteLabel(id);
    return { deleted: true };
  });
}
