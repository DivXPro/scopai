import { FastifyInstance } from 'fastify';
import {
  listStrategies, getStrategyById, createStrategy, updateStrategy, deleteStrategy,
  validateStrategyJson, parseJsonSchemaToColumns, createStrategyResultTable, syncStrategyResultTable,
} from '@analyze-cli/core';

export default async function strategiesRoutes(app: FastifyInstance) {
  app.get('/strategies', async () => listStrategies());

  app.get('/strategies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const strategy = await getStrategyById(id);
    if (!strategy) { reply.code(404); throw new Error('Strategy not found'); }
    return strategy;
  });

  app.post('/strategies/import', async (request, reply) => {
    const data = request.body as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') {
      reply.code(400);
      throw new Error('strategy object is required');
    }

    const validation = validateStrategyJson(data);
    if (!validation.valid) {
      throw new Error(`Invalid strategy: ${validation.error}`);
    }

    const obj = data;
    const existing = await getStrategyById(obj.id as string);
    if (existing && existing.version === obj.version) {
      return { imported: false, reason: 'same version already exists' };
    }

    const outputSchema = obj.output_schema as Record<string, unknown>;
    const columnDefs = parseJsonSchemaToColumns(outputSchema);
    await createStrategyResultTable(obj.id as string, columnDefs);
    await syncStrategyResultTable(obj.id as string, columnDefs);

    const strategy = {
      id: obj.id as string,
      name: obj.name as string,
      description: (obj.description ?? null) as string | null,
      version: (obj.version ?? '1.0.0') as string,
      target: obj.target as 'post' | 'comment',
      needs_media: (obj.needs_media ?? { enabled: false }) as any,
      prompt: obj.prompt as string,
      output_schema: obj.output_schema as any,
      batch_config: (obj.batch_config ?? null) as any,
      depends_on: (obj.depends_on ?? null) as 'post' | 'comment' | null,
      include_original: (obj.include_original ?? false) as boolean,
      file_path: null,
    };

    if (existing) {
      await updateStrategy(strategy.id, strategy);
    } else {
      await createStrategy(strategy);
    }

    return { imported: true, id: strategy.id };
  });

  app.post('/strategies', async (request) => {
    const data = request.body as Record<string, unknown>;
    const validation = validateStrategyJson(data);
    if (!validation.valid) {
      throw new Error(`Invalid strategy: ${validation.error}`);
    }

    const obj = data;
    const outputSchema = obj.output_schema as Record<string, unknown>;
    const columnDefs = parseJsonSchemaToColumns(outputSchema);
    await createStrategyResultTable(obj.id as string, columnDefs);
    await syncStrategyResultTable(obj.id as string, columnDefs);

    await createStrategy({
      id: obj.id as string,
      name: obj.name as string,
      description: (obj.description ?? null) as string | null,
      version: (obj.version ?? '1.0.0') as string,
      target: obj.target as 'post' | 'comment',
      needs_media: (obj.needs_media ?? { enabled: false }) as any,
      prompt: obj.prompt as string,
      output_schema: obj.output_schema as any,
      batch_config: (obj.batch_config ?? null) as any,
      depends_on: (obj.depends_on ?? null) as 'post' | 'comment' | null,
      include_original: (obj.include_original ?? false) as boolean,
      file_path: null,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return { imported: true, id: obj.id };
  });

  app.delete('/strategies/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const existing = await getStrategyById(id);
    if (!existing) { reply.code(404); throw new Error('Strategy not found'); }
    await deleteStrategy(id);
    return { deleted: true };
  });
}
