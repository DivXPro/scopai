import { FastifyInstance } from 'fastify';
import { searchPostsByQueryWithPostJoin } from '@scopai/core';

export default async function searchRoutes(app: FastifyInstance) {
  app.get('/search', async (request) => {
    const { query: queryText, limit = '5' } = request.query as Record<string, string>;
    if (!queryText) return { posts: [], total: 0 };
    const results = await searchPostsByQueryWithPostJoin(queryText, parseInt(limit, 10));
    return {
      posts: results.map(r => ({
        post_id: r.post_id,
        title: r.title,
        content: r.content?.substring(0, 200),
        author_name: r.author_name,
        platform_id: r.platform_id,
        reference_summary: r.matched_snippet?.substring(0, 300),
      })),
      total: results.length,
    };
  });
}
