import { FastifyInstance } from 'fastify';
import {
  listTemplates,
  createTemplate,
  getTemplateById,
  updateTemplate,
  generateId, now,
} from '@scopai/core';

export default async function templatesRoutes(app: FastifyInstance) {
  app.get('/templates', async (request) => {
    const { name } = request.query as Record<string, string>;
    const templates = await listTemplates();
    if (name) {
      return templates.filter((t) => t.name === name);
    }
    return templates;
  });

  app.post('/templates', async (request, reply) => {
    const data = request.body as Record<string, unknown>;
    const id = (data.id as string) ?? generateId();
    await createTemplate({
      id,
      name: data.name as string,
      description: (data.description ?? null) as string | null,
      template: (data.content ?? '') as string,
      is_default: (data.is_default ?? false) as boolean,
      created_at: now(),
    });
    return { id };
  });

  app.get('/templates/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const template = await getTemplateById(id);
    if (!template) {
      reply.code(404);
      throw new Error(`Template not found: ${id}`);
    }
    return template;
  });

  app.post('/templates/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = request.body as Record<string, unknown>;
    const existing = await getTemplateById(id);
    if (!existing) {
      reply.code(404);
      throw new Error(`Template not found: ${id}`);
    }
    await updateTemplate(id, {
      name: data.name as string | undefined,
      description: data.description as string | undefined,
      template: data.content as string | undefined,
      is_default: data.is_default as boolean | undefined,
    });
    return { updated: true };
  });
}
