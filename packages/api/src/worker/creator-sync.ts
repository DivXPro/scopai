import {
  getCreatorById,
  getPlatformById,
  listCreatorFieldMappings,
  updateCreatorSyncJobStatus,
  updateCreatorLastSynced,
  createCreatorSyncLog,
  createPost,
  getPostByPlatformPostId,
  updatePost,
  fetchViaOpencli,
  updateCreator,
  parseChineseNumber,
  getPlatformAdapter,
  POST_FIELD_MAP,
} from '@scopai/core';
import type { CreatorSyncJob } from '@scopai/core';
import { getLogger } from '@scopai/core';

interface RawPostItem {
  platform_post_id?: string;
  noteId?: string;
  id?: string;
  title?: string;
  content?: string;
  text?: string;
  desc?: string;
  author_id?: string;
  author_name?: string;
  author?: string;
  author_url?: string;
  url?: string;
  cover_url?: string;
  post_type?: string;
  type?: string;
  likes?: string;
  like_count?: number;
  collect_count?: number;
  comment_count?: number;
  share_count?: number;
  play_count?: number;
  score?: number;
  tags?: unknown;
  media_files?: unknown;
  published_at?: string;
  metadata?: unknown;
}

interface RawProfileItem {
  userId?: string;
  name?: string;
  avatar?: string;
  followers?: string | number;
  following?: string | number;
  ip?: string;
  redId?: string;
  bio?: string;
}

function normalizeRawPost(
  raw: Record<string, unknown>,
  mappings: Array<{ platform_field: string; system_field: string }>,
): RawPostItem {
  const result: Record<string, unknown> = {};
  for (const mapping of mappings) {
    const rawValue = raw[mapping.platform_field];
    if (rawValue !== undefined) {
      const systemField = POST_FIELD_MAP[mapping.system_field] ?? mapping.system_field;
      result[systemField] = rawValue;
    }
  }
  for (const key of Object.keys(raw)) {
    const mapped = POST_FIELD_MAP[key] ?? key;
    if (result[mapped] === undefined) {
      result[mapped] = raw[key];
    }
  }
  return result as RawPostItem;
}

async function fetchProfile(
  platformId: string,
  authorId: string,
): Promise<{ template: string; vars: Record<string, string> } | null> {
  const platform = await getPlatformById(platformId);
  if (!platform) return null;
  if (!platform.profile_fetch_template) return null;
  return {
    template: platform.profile_fetch_template,
    vars: { author_id: authorId },
  };
}

async function fetchPosts(
  platformId: string,
  authorId: string,
  since?: Date,
): Promise<{ template: string; vars: Record<string, string> } | null> {
  const platform = await getPlatformById(platformId);
  if (!platform) return null;
  if (!platform.posts_fetch_template) return null;
  const vars: Record<string, string> = { author_id: authorId };
  if (since) vars.since = since.toISOString();
  return {
    template: platform.posts_fetch_template,
    vars,
  };
}

export async function processCreatorProfileSyncJob(job: CreatorSyncJob, workerId: number): Promise<void> {
  const logger = getLogger();
  logger.info(`[Worker-${workerId}] Processing creator profile sync job ${job.id}`);

  await updateCreatorSyncJobStatus(job.id, 'processing');
  const startedAt = Date.now();

  let profileUpdated = false;
  let profileError: string | null = null;

  try {
    const creator = await getCreatorById(job.creator_id);
    if (!creator) throw new Error(`Creator ${job.creator_id} not found`);
    if (creator.status === 'unsubscribed') throw new Error('Creator is unsubscribed');

    const fetchConfig = await fetchProfile(creator.platform_id, creator.platform_author_id);
    if (!fetchConfig) {
      logger.warn(`[Worker-${workerId}] No profile_fetch_template for platform ${creator.platform_id}, skipping profile sync`);
      await updateCreatorSyncJobStatus(job.id, 'completed', { posts_imported: 0, posts_updated: 0, posts_skipped: 0, posts_failed: 0 });
      await createCreatorSyncLog({
        creator_id: creator.id,
        job_id: job.id,
        sync_type: 'profile_sync',
        status: 'success',
        result_summary: { profile_updated: false, reason: 'no_template_configured', duration_ms: Date.now() - startedAt },
        completed_at: new Date(),
      });
      return;
    }

    const result = await fetchViaOpencli(fetchConfig.template, fetchConfig.vars, 60000);
    if (!result.success || !result.data) {
      throw new Error(result.error ?? 'Failed to fetch creator profile');
    }

    const rawItems = result.data;
    if (rawItems.length === 0) {
      throw new Error('Empty profile response');
    }

    const raw = rawItems[0] as Record<string, unknown>;
    const profile: Parameters<typeof updateCreator>[1] = {};

    // Use adapter's profileFieldMap to normalize, then extract known fields
    const adapter = getPlatformAdapter(creator.platform_id);
    const profileFieldMap = adapter?.profileFieldMap;
    if (profileFieldMap) {
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(raw)) {
        const mapped = profileFieldMap[key] ?? key;
        if (normalized[mapped] === undefined) {
          normalized[mapped] = raw[key];
        }
      }
      if (normalized.author_name) profile.author_name = String(normalized.author_name);
      if (normalized.avatar_url) profile.avatar_url = String(normalized.avatar_url);
      if (normalized.follower_count !== undefined) {
        const v = normalized.follower_count;
        profile.follower_count = typeof v === 'string' ? parseInt(v, 10) : Number(v);
      }
      if (normalized.following_count !== undefined) {
        const v = normalized.following_count;
        profile.following_count = typeof v === 'string' ? parseInt(v, 10) : Number(v);
      }
      if (normalized.bio) profile.bio = String(normalized.bio);
      // Platform-specific homepage URL construction
      if (creator.platform_id === 'xhs' && normalized.platform_creator_id) {
        profile.homepage_url = `https://www.xiaohongshu.com/user/profile/${normalized.platform_creator_id}`;
      }
      if (creator.platform_id === 'douyin' && normalized.platform_creator_id) {
        profile.homepage_url = `https://www.douyin.com/user/${normalized.platform_creator_id}`;
      }
    } else {
      // Fallback: legacy hardcoded mapping (for platforms without profileFieldMap)
      const rawProfile = raw as RawProfileItem;
      if (rawProfile.name) profile.author_name = rawProfile.name;
      if (rawProfile.avatar) profile.avatar_url = rawProfile.avatar;
      if (rawProfile.followers !== undefined) {
        profile.follower_count = typeof rawProfile.followers === 'string' ? parseInt(rawProfile.followers, 10) : rawProfile.followers;
      }
      if (rawProfile.following !== undefined) {
        profile.following_count = typeof rawProfile.following === 'string' ? parseInt(rawProfile.following, 10) : rawProfile.following;
      }
      if (rawProfile.redId) profile.homepage_url = `https://www.xiaohongshu.com/user/profile/${rawProfile.redId}`;
      if (rawProfile.bio) profile.bio = rawProfile.bio;
    }

    if (Object.keys(profile).length > 0) {
      await updateCreator(creator.id, profile);
      profileUpdated = true;
      logger.info(`[Worker-${workerId}] Updated creator profile: ${Object.keys(profile).join(', ')}`);
    }

    await updateCreatorLastSynced(creator.id);
    await updateCreatorSyncJobStatus(job.id, 'completed', {
      posts_imported: 0,
      posts_updated: 0,
      posts_skipped: 0,
      posts_failed: 0,
    });
    await createCreatorSyncLog({
      creator_id: creator.id,
      job_id: job.id,
      sync_type: 'profile_sync',
      status: 'success',
      result_summary: { profile_updated: profileUpdated, duration_ms: Date.now() - startedAt },
      completed_at: new Date(),
    });

    logger.info(`[Worker-${workerId}] Creator profile sync completed: profile_updated=${profileUpdated}`);
  } catch (err: unknown) {
    profileError = (err as Error).message;
    logger.error(`[Worker-${workerId}] Creator profile sync failed: ${profileError}`);

    await updateCreatorSyncJobStatus(job.id, 'failed', { error: profileError });
    await createCreatorSyncLog({
      creator_id: job.creator_id,
      job_id: job.id,
      sync_type: 'profile_sync',
      status: 'failed',
      result_summary: { profile_updated: false, error: profileError, duration_ms: Date.now() - startedAt },
      completed_at: new Date(),
    });
  }
}

export async function processCreatorSyncJob(job: CreatorSyncJob, workerId: number): Promise<void> {
  const logger = getLogger();
  logger.info(`[Worker-${workerId}] Processing creator sync job ${job.id} (type: ${job.sync_type})`);

  // If this is a profile_sync job, delegate to the dedicated handler
  if (job.sync_type === 'profile_sync') {
    await processCreatorProfileSyncJob(job, workerId);
    return;
  }

  await updateCreatorSyncJobStatus(job.id, 'processing');
  const startedAt = Date.now();

  let imported = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const creator = await getCreatorById(job.creator_id);
    if (!creator) throw new Error(`Creator ${job.creator_id} not found`);
    if (creator.status === 'unsubscribed') throw new Error('Creator is unsubscribed');

    const platform = await getPlatformById(creator.platform_id);
    if (!platform) throw new Error(`Platform ${creator.platform_id} not found`);

    // Try to get posts_fetch_template from platform, fallback to adapter default
    const adapterDefault = getPlatformAdapter(platform.id)?.creatorTemplates?.postsFetch ?? '';
    let postsTemplate = platform.posts_fetch_template || adapterDefault;

    const mappings = await listCreatorFieldMappings(creator.platform_id);

    const vars: Record<string, string> = {
      author_id: creator.platform_author_id,
    };

    if (job.sync_type === 'periodic' && creator.last_synced_at) {
      vars.since = creator.last_synced_at.toISOString();
    }

    const fetchResult = await fetchViaOpencli(postsTemplate, vars, 120000);
    if (!fetchResult.success || !fetchResult.data) {
      throw new Error(fetchResult.error ?? 'Failed to fetch creator posts');
    }

    const rawPosts = fetchResult.data;
    logger.info(`[Worker-${workerId}] Fetched ${rawPosts.length} raw posts for creator ${creator.id}`);

    for (const rawItem of rawPosts) {
      if (typeof rawItem !== 'object' || rawItem === null) {
        failed++;
        continue;
      }

      try {
        const item = normalizeRawPost(rawItem as Record<string, unknown>, mappings);
        const platformPostId = item.platform_post_id ?? item.noteId ?? item.id;
        if (!platformPostId) {
          failed++;
          continue;
        }

        const existing = await getPostByPlatformPostId(platformPostId, creator.platform_id);

        if (existing) {
          await updatePost(existing.id, {
            title: item.title ?? null,
            content: item.content ?? item.text ?? item.desc ?? existing.content,
            author_id: item.author_id ?? creator.platform_author_id,
            author_name: item.author_name ?? item.author ?? creator.author_name,
            author_url: item.author_url ?? null,
            url: item.url ?? null,
            cover_url: item.cover_url ?? null,
            post_type: (item.post_type ?? item.type ?? existing.post_type) as any,
            like_count: parseChineseNumber(item.likes) ?? item.like_count ?? 0,
            collect_count: Number(item.collect_count ?? 0),
            comment_count: Number(item.comment_count ?? 0),
            share_count: Number(item.share_count ?? 0),
            play_count: Number(item.play_count ?? 0),
            score: item.score ? Number(item.score) : null,
            tags: (item.tags as { name: string; url?: string }[] | null) ?? null,
            media_files: (item.media_files as { type: 'image' | 'video' | 'audio'; url: string; local_path?: string }[] | null) ?? null,
            published_at: item.published_at ? new Date(item.published_at) : null,
            metadata: (item.metadata as Record<string, unknown> | null) ?? null,
          });
          updated++;
        } else {
          await createPost({
            platform_id: creator.platform_id,
            platform_post_id: platformPostId,
            title: item.title ?? null,
            content: item.content ?? item.text ?? item.desc ?? '',
            author_id: item.author_id ?? creator.platform_author_id,
            author_name: item.author_name ?? item.author ?? creator.author_name,
            author_url: item.author_url ?? null,
            url: item.url ?? null,
            cover_url: item.cover_url ?? null,
            post_type: (item.post_type ?? item.type ?? null) as any,
            like_count: parseChineseNumber(item.likes) ?? item.like_count ?? 0,
            collect_count: Number(item.collect_count ?? 0),
            comment_count: Number(item.comment_count ?? 0),
            share_count: Number(item.share_count ?? 0),
            play_count: Number(item.play_count ?? 0),
            score: item.score ? Number(item.score) : null,
            tags: (item.tags as { name: string; url?: string }[] | null) ?? null,
            media_files: (item.media_files as { type: 'image' | 'video' | 'audio'; url: string; local_path?: string }[] | null) ?? null,
            published_at: item.published_at ? new Date(item.published_at) : null,
            metadata: (item.metadata as Record<string, unknown> | null) ?? null,
          });
          imported++;
        }
      } catch (itemErr: unknown) {
        logger.error(`[Worker-${workerId}] Failed to process post: ${(itemErr as Error).message}`);
        failed++;
      }
    }

    await updateCreatorLastSynced(creator.id);

    const status = failed > 0 ? 'completed_with_errors' : 'completed';
    await updateCreatorSyncJobStatus(job.id, status, {
      posts_imported: imported,
      posts_updated: updated,
      posts_skipped: skipped,
      posts_failed: failed,
    });

    await createCreatorSyncLog({
      creator_id: creator.id,
      job_id: job.id,
      sync_type: job.sync_type,
      status: failed > 0 ? 'partial' : 'success',
      result_summary: { imported, updated, skipped, failed, duration_ms: Date.now() - startedAt },
      completed_at: new Date(),
    });

    logger.info(`[Worker-${workerId}] Creator sync completed: imported=${imported}, updated=${updated}, failed=${failed}`);
  } catch (err: unknown) {
    const errMsg = (err as Error).message;
    logger.error(`[Worker-${workerId}] Creator sync failed: ${errMsg}`);

    await updateCreatorSyncJobStatus(job.id, 'failed', { error: errMsg });
    await createCreatorSyncLog({
      creator_id: job.creator_id,
      job_id: job.id,
      sync_type: job.sync_type,
      status: 'failed',
      result_summary: { imported, updated, skipped, failed, error: errMsg, duration_ms: Date.now() - startedAt },
      completed_at: new Date(),
    });
  }
}