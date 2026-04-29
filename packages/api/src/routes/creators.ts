import { FastifyInstance } from 'fastify';
import {
  createCreator,
  getCreatorById,
  listCreators,
  countCreators,
  updateCreatorStatus,
  getCreatorByPlatformAuthorId,
  createCreatorFieldMapping,
  listCreatorFieldMappings,
  deleteCreatorFieldMapping,
  createCreatorSyncJob,
  hasPendingSyncJob,
  getCreatorSyncScheduleByCreatorId,
  createCreatorSyncSchedule,
  updateCreatorSyncSchedule,
  deleteCreatorSyncSchedule,
  listCreatorSyncLogs,
  listPosts,
} from '@scopai/core';

export default async function creatorsRoutes(app: FastifyInstance) {
  app.post('/creators', async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const platformId = String(body.platform_id ?? '');
    const authorId = String(body.platform_author_id ?? '');

    if (!platformId || !authorId) {
      reply.code(400);
      throw new Error('platform_id and platform_author_id are required');
    }

    const existing = await getCreatorByPlatformAuthorId(platformId, authorId);
    if (existing) {
      reply.code(409);
      throw new Error('Creator already subscribed');
    }

    const creator = await createCreator({
      platform_id: platformId,
      platform_author_id: authorId,
      author_name: body.author_name ? String(body.author_name) : null,
      display_name: null,
      bio: null,
      avatar_url: null,
      homepage_url: null,
      follower_count: 0,
      following_count: 0,
      post_count: 0,
      status: 'active',
      metadata: null,
    });

    await createCreatorSyncSchedule({
      creator_id: creator.id,
      interval_minutes: 60,
      time_window_start: null,
      time_window_end: null,
      max_retries: 3,
      retry_interval_minutes: 30,
      is_enabled: true,
    });

    reply.code(201);
    return creator;
  });

  app.get('/creators', async (request) => {
    const { platform, status, limit = '50', offset = '0' } = request.query as Record<string, string>;
    const parsedLimit = parseInt(limit, 10);
    const parsedOffset = parseInt(offset, 10);
    const creators = await listCreators(platform || undefined, status || undefined, parsedLimit, parsedOffset);
    const total = await countCreators(platform || undefined, status || undefined);
    return { items: creators, total };
  });

  app.get('/creators/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const creator = await getCreatorById(id);
    if (!creator) {
      reply.code(404);
      throw new Error('Creator not found');
    }
    return creator;
  });

  app.post('/creators/:id/sync', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as Record<string, unknown>) ?? {};
    const syncType = (body.sync_type as 'initial' | 'periodic') ?? 'periodic';

    const creator = await getCreatorById(id);
    if (!creator) {
      reply.code(404);
      return { error: 'Creator not found' };
    }
    if (creator.status === 'unsubscribed') {
      reply.code(400);
      return { error: 'Cannot sync unsubscribed creator' };
    }

    const hasPending = await hasPendingSyncJob(id);
    if (hasPending) {
      reply.code(409);
      return { error: 'Sync already in progress for this creator' };
    }

    const job = await createCreatorSyncJob({ creator_id: id, sync_type: syncType });
    reply.code(202);
    return { job_id: job.id, status: 'pending' };
  });

  app.post('/creators/:id/sync-profile', async (request, reply) => {
    const { id } = request.params as { id: string };

    const creator = await getCreatorById(id);
    if (!creator) {
      reply.code(404);
      return { error: 'Creator not found' };
    }
    if (creator.status === 'unsubscribed') {
      reply.code(400);
      return { error: 'Cannot sync unsubscribed creator' };
    }

    const hasPending = await hasPendingSyncJob(id);
    if (hasPending) {
      reply.code(409);
      return { error: 'Sync already in progress for this creator' };
    }

    const job = await createCreatorSyncJob({ creator_id: id, sync_type: 'profile_sync' });
    reply.code(202);
    return { job_id: job.id, status: 'pending', type: 'profile_sync' };
  });

  app.delete('/creators/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const creator = await getCreatorById(id);
    if (!creator) {
      reply.code(404);
      throw new Error('Creator not found');
    }
    // Remove sync schedule first to avoid FK constraint violation
    const schedule = await getCreatorSyncScheduleByCreatorId(id);
    if (schedule) {
      await deleteCreatorSyncSchedule(schedule.id);
    }
    await updateCreatorStatus(id, 'unsubscribed');
    reply.code(204);
    reply.send();
  });

  app.post('/creators/:id/pause', async (request, reply) => {
    const { id } = request.params as { id: string };
    await updateCreatorStatus(id, 'paused');
    reply.code(200);
    return { status: 'paused' };
  });

  app.post('/creators/:id/resume', async (request, reply) => {
    const { id } = request.params as { id: string };
    await updateCreatorStatus(id, 'active');
    reply.code(200);
    return { status: 'active' };
  });

  app.get('/creators/:id/posts', async (request) => {
    const { id } = request.params as { id: string };
    const { limit = '50', offset = '0' } = request.query as Record<string, string>;
    const creator = await getCreatorById(id);
    if (!creator) return { items: [], total: 0 };

    const posts = await listPosts(creator.platform_id, parseInt(limit, 10), parseInt(offset, 10));
    const filtered = posts.filter((p) => p.author_id === creator.platform_author_id);
    return { items: filtered, total: filtered.length };
  });

  app.get('/creators/:id/sync-logs', async (request) => {
    const { id } = request.params as { id: string };
    const { limit = '20' } = request.query as Record<string, string>;
    return listCreatorSyncLogs(id, parseInt(limit, 10));
  });

  app.get('/creators/:id/sync-schedule', async (request, reply) => {
    const { id } = request.params as { id: string };
    const schedule = await getCreatorSyncScheduleByCreatorId(id);
    if (!schedule) {
      reply.code(404);
      throw new Error('Schedule not found');
    }
    return schedule;
  });

  app.post('/creators/:id/sync-schedule', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const schedule = await getCreatorSyncScheduleByCreatorId(id);
    if (!schedule) {
      reply.code(404);
      throw new Error('Schedule not found');
    }
    await updateCreatorSyncSchedule(schedule.id, {
      interval_minutes: body.interval_minutes !== undefined ? Number(body.interval_minutes) : undefined,
      time_window_start: body.time_window_start !== undefined ? String(body.time_window_start) : undefined,
      time_window_end: body.time_window_end !== undefined ? String(body.time_window_end) : undefined,
      max_retries: body.max_retries !== undefined ? Number(body.max_retries) : undefined,
      retry_interval_minutes: body.retry_interval_minutes !== undefined ? Number(body.retry_interval_minutes) : undefined,
      is_enabled: body.is_enabled !== undefined ? Boolean(body.is_enabled) : undefined,
    });
    return getCreatorSyncScheduleByCreatorId(id);
  });

  app.get('/platforms/:id/creator-mappings', async (request) => {
    const { id } = request.params as { id: string };
    return listCreatorFieldMappings(id);
  });

  app.post('/platforms/:id/creator-mappings', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const mapping = await createCreatorFieldMapping({
      platform_id: id,
      entity_type: 'creator',
      system_field: String(body.system_field ?? ''),
      platform_field: String(body.platform_field ?? ''),
      data_type: (body.data_type as 'string' | 'number' | 'date' | 'boolean' | 'array' | 'json') ?? 'string',
      is_required: Boolean(body.is_required),
      transform_expr: body.transform_expr ? String(body.transform_expr) : null,
      description: body.description ? String(body.description) : null,
    });

    reply.code(201);
    return mapping;
  });
}
