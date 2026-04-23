import { FastifyInstance } from 'fastify';

export async function setupAuth(app: FastifyInstance) {
  // Single-machine tool: reject non-localhost connections instead of token auth
  app.addHook('onRequest', async (request, reply) => {
    const remote = request.ip;
    if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
      reply.code(403);
      throw new Error('Access denied: only localhost connections allowed');
    }
  });
}
