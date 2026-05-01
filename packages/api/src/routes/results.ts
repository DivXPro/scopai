import { FastifyInstance } from 'fastify';
import { query } from '@scopai/core';

export default async function resultsRoutes(app: FastifyInstance) {
  app.get('/results/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { target = 'comment' } = request.query as Record<string, string>;

    const table = target === 'media' ? 'analysis_results_media' : 'analysis_results_comments';
    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM "${table}" WHERE id = ?`,
      [id],
    );
    if (rows.length === 0) {
      reply.code(404);
      throw new Error(`Result not found: ${id}`);
    }
    return rows[0];
  });
}
