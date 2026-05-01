import { FastifyInstance } from 'fastify';
import {
  listStrategies, getStrategyById, createStrategy, updateStrategy, deleteStrategy,
  validateStrategyJson, parseJsonSchemaToColumns, createStrategyResultTable, syncStrategyResultTable,
  getStrategyResultStats, runAggregate, getFullStats, listStrategyResultsByTask,
} from '@scopai/core';

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

  app.get('/strategies/:id/stats', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { task_id } = request.query as Record<string, string>;
    if (!task_id) {
      reply.code(400);
      throw new Error('task_id is required');
    }
    const strategy = await getStrategyById(id);
    if (!strategy) {
      reply.code(404);
      throw new Error('Strategy not found');
    }
    return getStrategyResultStats(id, task_id);
  });

  app.get('/strategies/:id/full-stats', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { task_id } = request.query as Record<string, string>;
    if (!task_id) {
      reply.code(400);
      throw new Error('task_id is required');
    }
    const strategy = await getStrategyById(id);
    if (!strategy) {
      reply.code(404);
      throw new Error('Strategy not found');
    }
    return getFullStats(id, task_id);
  });

  app.post('/strategies/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const taskId = body.task_id as string;
    const format = (body.format as string) ?? 'json';
    const output = body.output as string | undefined;

    if (!taskId) {
      reply.code(400);
      throw new Error('task_id is required');
    }

    const strategy = await getStrategyById(id);
    if (!strategy) {
      reply.code(404);
      throw new Error('Strategy not found');
    }

    const results = await listStrategyResultsByTask(id, taskId, 10000);
    let content: string;
    if (format === 'csv') {
      if (results.length === 0) {
        content = '';
      } else {
        const keys = Object.keys(results[0]);
        const lines = [keys.join(',')];
        for (const row of results) {
          const values = keys.map((k) => {
            const v = (row as Record<string, unknown>)[k];
            const str = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
            if (str.includes(',') || str.includes('"')) return '"' + str.replace(/"/g, '""') + '"';
            return str;
          });
          lines.push(values.join(','));
        }
        content = lines.join('\n') + '\n';
      }
    } else {
      content = JSON.stringify(results, null, 2) + '\n';
    }

    if (output) {
      const fs = await import('fs');
      fs.writeFileSync(output, content);
    }

    return { content, writtenTo: output ?? null, count: results.length };
  });

  app.post('/strategies/:id/aggregate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const taskId = body.task_id as string;
    const field = body.field as string;
    const agg = (body.agg as 'count' | 'sum' | 'avg' | 'min' | 'max') ?? 'count';
    const jsonKey = body.json_key as string | undefined;
    const having = body.having as string | undefined;
    const limit = typeof body.limit === 'number' ? body.limit : 50;

    if (!taskId) {
      reply.code(400);
      throw new Error('task_id is required');
    }
    if (!field) {
      reply.code(400);
      throw new Error('field is required');
    }

    const strategy = await getStrategyById(id);
    if (!strategy) {
      reply.code(404);
      throw new Error('Strategy not found');
    }

    return runAggregate(id, taskId, { field, aggFn: agg, jsonKey, having, limit });
  });
}
