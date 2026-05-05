import { getNextJobs, updateJobStatus, requeueJob, listJobsByTask, lockPendingJobs, completeJobs, unlockJobs } from '@scopai/core';
import { getTaskById, updateTaskStatus, updateTaskStats } from '@scopai/core';
import { updateTargetStatus, getTargetStats } from '@scopai/core';
import { getCommentById, listCommentsByIds } from '@scopai/core';
import { getPlatformById } from '@scopai/core';
import { getPostById, updatePost, listMediaFilesByPost } from '@scopai/core';
import { getStrategyById } from '@scopai/core';
import { insertStrategyResult } from '@scopai/core';
import { updateTaskStepStatus, listTaskSteps } from '@scopai/core';
import { upsertTaskPostStatus, getTaskPostStatus } from '@scopai/core';
import { normalizePostItem, getPlatformAdapter } from '@scopai/core';
import { fetchViaOpencli } from '@scopai/core';
import { syncWaitingMediaJobs, enqueueJobs } from '@scopai/core';
import { emitHook } from '@scopai/core';
import { importCommentsToDb, importMediaToDb, getDefaultFetchMediaTemplate } from '../daemon/handlers';

// Serialize browser-based opencli commands (xiaohongshu note, etc.) to prevent
// concurrent browser requests from cross-contaminating data
let browserFetchLock: Promise<unknown> = Promise.resolve();
import { buildJobsForPost } from '../daemon/scheduler';
import { analyzeWithStrategy, analyzeBatchWithStrategy } from './anthropic';
import { processCreatorSyncJob } from './creator-sync';
import { parseStrategyResult, parseBatchStrategyResult } from './parser';
import type { QueueJob, Comment } from '@scopai/core';
import { sleep, generateId, query } from '@scopai/core';
import { waitForJob } from '@scopai/core';
import {
  registerWorker,
  unregisterWorker,
  setWorkerActiveCount,
  isShuttingDown,
} from '@scopai/core';
import { config } from '@scopai/core';
import { getLogger } from '@scopai/core';
import { getPendingCreatorSyncJobs, checkpoint } from '@scopai/core';

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 30000;
const EXPONENTIAL_BACKOFF_FACTOR = 2;

export async function runConsumer(workerId: number): Promise<void> {
  const logger = getLogger();
  const concurrency = config.worker.concurrency ?? 1;
  logger.info(`[Worker-${workerId}] Consumer started, concurrency=${concurrency}`);

  registerWorker(workerId);
  const active = new Set<Promise<void>>();
  let buffer: QueueJob[] = [];
  let currentWaitMs = POLL_INTERVAL_MS;

  try {
    while (true) {
      setWorkerActiveCount(workerId, active.size);

      if (isShuttingDown()) {
        // Stop accepting new jobs; drain active jobs then exit
        if (active.size === 0) {
          logger.info(`[Worker-${workerId}] Graceful shutdown complete`);
          break;
        }
        await Promise.race(active);
        continue;
      }

      try {
        // Fill buffer with pending jobs up to the concurrency limit
        // Exclude 'prepare' jobs — those are handled by the dedicated prepare-consumer
        while (buffer.length === 0 && active.size < concurrency) {
          const need = concurrency - active.size;
          const jobs = await getNextJobs(need, ['post', 'comment', 'media']);
          if (jobs.length === 0) break;
          buffer.push(...jobs);
          currentWaitMs = POLL_INTERVAL_MS;
        }

        // Start new jobs until we hit the concurrency limit
        while (active.size < concurrency && buffer.length > 0) {
          const job = buffer.shift()!;
          const promise = processJobWithLifecycle(job, workerId).finally(() => {
            active.delete(promise);
          });
          active.add(promise);
        }

        // Poll creator sync jobs (independent pipeline)
        if (active.size < concurrency) {
          const need = concurrency - active.size;
          const creatorJobs = await getPendingCreatorSyncJobs(need);
          for (const cJob of creatorJobs) {
            const promise = processCreatorSyncJob(cJob, workerId).finally(() => {
              active.delete(promise);
            });
            active.add(promise);
          }
        }

        if (active.size > 0) {
          await Promise.race(active);
          continue;
        }

        // All jobs drained — checkpoint WAL before sleeping
        try {
          await checkpoint();
        } catch (e) {
          logger.warn(`[Worker-${workerId}] Checkpoint failed: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Nothing active and nothing in buffer → wait for notification or timeout
        logger.debug(`[Worker-${workerId}] Waiting for job (timeout ${currentWaitMs}ms)`);
        const gotNotify = await waitForJob(currentWaitMs);
        if (gotNotify) {
          currentWaitMs = POLL_INTERVAL_MS;
        } else {
          currentWaitMs = Math.min(currentWaitMs * EXPONENTIAL_BACKOFF_FACTOR, MAX_WAIT_MS);
        }
      } catch (err) {
        logger.error(`[Worker-${workerId}] Error in consumer loop: ${err instanceof Error ? err.message : String(err)}`);
        await sleep(POLL_INTERVAL_MS);
        currentWaitMs = POLL_INTERVAL_MS;
      }
    }
  } finally {
    unregisterWorker(workerId);
  }
}

export async function processJobWithLifecycle(job: QueueJob, workerId: number | string): Promise<void> {
  const logger = getLogger();
  logger.info(`[Worker-${workerId}] Processing job ${job.id} for task ${job.task_id}`);

  try {
    await processJob(job, workerId);
    await updateJobStatus(job.id, 'completed');
    if (job.target_type && job.target_id) {
      await updateTargetStatus(job.task_id, job.target_type, job.target_id, 'done');
    }
    await updateTaskStatsForTask(job.task_id);
    if (job.strategy_id) {
      await syncStepStats(job.task_id, job.strategy_id);
    }
    if (job.target_type === 'prepare') {
      const allJobs = await listJobsByTask(job.task_id);
      const prepareJobs = allJobs.filter(j => j.target_type === 'prepare');
      if (prepareJobs.every(j => j.status === 'completed' || j.status === 'failed')) {
        const task = await getTaskById(job.task_id);
        const doneCount = prepareJobs.filter(j => j.status === 'completed').length;
        const failedCount = prepareJobs.filter(j => j.status === 'failed').length;
        const hasFailed = failedCount > 0;
        emitHook(hasFailed ? 'PrepareDataFailed' : 'PrepareDataCompleted', {
          task_id: job.task_id,
          task_name: task?.name ?? undefined,
          stats: { total: prepareJobs.length, done: doneCount, failed: failedCount },
        });
      }
    }
    logger.info(`[Worker-${workerId}] Job ${job.id} completed`);
  } catch (err) {
    const error = String(err);
    const isRateLimit = /429|rate_limit|engine is currently overloaded/i.test(error);

    if (job.attempts < job.max_attempts) {
      logger.warn(`[Worker-${workerId}] Job ${job.id} failed, requeueing (attempt ${job.attempts}/${job.max_attempts}): ${error}`);
      await requeueJob(job.id, error);
      if (isRateLimit) {
        const backoffMs = (config.worker.retry_delay_ms ?? 2000) * Math.pow(2, job.attempts);
        await sleep(backoffMs);
      }
    } else {
      logger.error(`[Worker-${workerId}] Job ${job.id} failed permanently after ${job.attempts} attempts: ${error}`);
      await updateJobStatus(job.id, 'failed');
      if (job.target_type && job.target_id) {
        await updateTargetStatus(job.task_id, job.target_type, job.target_id, 'failed', error);
      }
      if (job.strategy_id) {
        await syncStepStats(job.task_id, job.strategy_id);
      }
    }
  }
}

async function processJob(job: QueueJob, workerId: number | string): Promise<void> {
  if (job.target_type === 'prepare') {
    await processPrepareJob(job, workerId);
    return;
  }

  const task = await getTaskById(job.task_id);
  if (!task) throw new Error(`Task ${job.task_id} not found`);

  if (!job.strategy_id) {
    throw new Error(`Job ${job.id} has no strategy_id — legacy analysis is no longer supported`);
  }

  await processStrategyJob(job, task, workerId);
}

async function processPrepareJob(job: QueueJob, workerId: number | string): Promise<void> {
  const logger = getLogger();
  const postId = job.target_id;
  const taskId = job.task_id;

  if (!postId) throw new Error(`Prepare job ${job.id} has no target_id`);

  const task = await getTaskById(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  // Parse CLI templates
  let cliTemplates: { fetch_note: string; fetch_comments?: string; fetch_media?: string } = { fetch_note: '' };
  if (task.cli_templates) {
    try {
      const raw = typeof task.cli_templates === 'string' ? task.cli_templates : JSON.stringify(task.cli_templates);
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') cliTemplates = parsed;
    } catch {
      throw new Error(`Task ${taskId} has invalid cli_templates`);
    }
  }

  const postMeta = await getPostById(postId);
  if (!postMeta) throw new Error(`Post ${postId} not found`);

  const platformId = postMeta.platform_id;

  // Resolve noteId (platform_post_id is set correctly at import time via extractNoteId)
  const noteId = postMeta.platform_post_id ?? undefined;
  let postUrl = postMeta.url ?? undefined;
  // xiaohongshu /search_result/ URLs have unreliable noteId mapping;
  // convert to /explore/ format so opencli note fetches the correct post
  if (postUrl && platformId === 'xhs') {
    postUrl = postUrl.replace('/search_result/', '/explore/');
  }
  const platformDir = getPlatformAdapter(platformId)?.directoryName ?? platformId.split('_')[0];
  const fetchVars: Record<string, string> = {
    post_id: postId,
    note_id: noteId ?? postUrl ?? postId,
    url: postUrl ?? noteId ?? postId,
    limit: '100',
    platform: platformDir,
    download_dir: config.paths.download_dir,
  };

  logger.info(`[Worker-${workerId}] Prepare job for post ${postId}, task ${taskId}`);

  // Mark as fetching
  await upsertTaskPostStatus(taskId, postId, { status: 'fetching' });

  // Step 1: fetch_note — enrich post details (serialized to prevent browser cross-contamination)
  const fetchNoteTemplate = cliTemplates.fetch_note || getPlatformAdapter(platformId)?.defaultTemplates.fetchNote || '';
  if (fetchNoteTemplate) {
    logger.info(`[Worker-${workerId}] Post ${postId}: Step 1 fetch_note`);
    const noteResult = await serializeBrowserFetch(() => fetchViaOpencli(fetchNoteTemplate, fetchVars));
    if (!noteResult.success) {
      throw new Error(`fetch_note failed for post ${postId}: ${noteResult.error ?? 'unknown'}`);
    }
    if (noteResult.data && noteResult.data.length > 0) {
      const noteData = normalizePostItem(noteResult.data, platformId);
      const existingPost = await getPostById(postId);
      // Guard against opencli returning data for a different post
      // (e.g. xiaohongshu /search_result/ URLs may redirect to a different note)
      const returnedNoteId = noteData.platform_post_id;
      const noteIdMismatch = returnedNoteId && returnedNoteId !== noteId;
      const titleMismatch = existingPost && noteData.title && existingPost.title &&
        noteData.title !== existingPost.title &&
        !noteData.title.includes(existingPost.title.slice(0, 10)) &&
        !existingPost.title.includes(noteData.title.slice(0, 10));
      if (noteIdMismatch || titleMismatch) {
        const reason = noteIdMismatch
          ? `noteId mismatch (expected ${noteId}, got ${returnedNoteId})`
          : `title mismatch (existing "${existingPost?.title}", got "${noteData.title}")`;
        logger.warn(`[Worker-${workerId}] Post ${postId}: fetch_note returned data for a different post (${reason}), skipping update and fixing URL`);
        // Fix the URL to point to the correct note using /explore/ format
        if (existingPost?.url && noteId && platformId === 'xhs') {
          const xsecMatch = existingPost.url.match(/[?&]xsec_token=[^&]+/);
          const xsecParam = xsecMatch ? xsecMatch[0].replace(/^[?&]/, '&') : '';
          const correctUrl = `https://www.xiaohongshu.com/explore/${noteId}${xsecParam ? `?${xsecParam.replace(/^&/, '')}` : ''}`;
          if (correctUrl !== existingPost.url) {
            await updatePost(postId, { url: correctUrl });
            logger.info(`[Worker-${workerId}] Post ${postId}: corrected URL to ${correctUrl}`);
          }
        }
      } else if (existingPost) {
        const updates: Parameters<typeof updatePost>[1] = {};
        if (noteData.title !== existingPost.title) updates.title = noteData.title;
        if (noteData.content !== existingPost.content) updates.content = noteData.content;
        if (noteData.author_id !== existingPost.author_id) updates.author_id = noteData.author_id;
        if (noteData.author_name !== existingPost.author_name) updates.author_name = noteData.author_name;
        if (noteData.author_url !== existingPost.author_url) updates.author_url = noteData.author_url;
        if (noteData.cover_url !== existingPost.cover_url) updates.cover_url = noteData.cover_url;
        if (noteData.post_type !== existingPost.post_type) updates.post_type = noteData.post_type as any;
        if (noteData.like_count !== existingPost.like_count) updates.like_count = noteData.like_count;
        if (noteData.collect_count !== existingPost.collect_count) updates.collect_count = noteData.collect_count;
        if (noteData.comment_count !== existingPost.comment_count) updates.comment_count = noteData.comment_count;
        if (noteData.share_count !== existingPost.share_count) updates.share_count = noteData.share_count;
        if (noteData.play_count !== existingPost.play_count) updates.play_count = noteData.play_count;
        if (JSON.stringify(noteData.tags) !== JSON.stringify(existingPost.tags)) updates.tags = noteData.tags as { name: string; url?: string }[] | null;
        if (JSON.stringify(noteData.media_files) !== JSON.stringify(existingPost.media_files)) updates.media_files = noteData.media_files as { type: 'image' | 'video' | 'audio'; url: string; local_path?: string }[] | null;
        if (noteData.published_at?.getTime() !== existingPost.published_at?.getTime()) updates.published_at = noteData.published_at;
        if (JSON.stringify(noteData.metadata) !== JSON.stringify(existingPost.metadata)) updates.metadata = noteData.metadata;
        await updatePost(postId, updates);
      }
    }
    logger.info(`[Worker-${workerId}] Post ${postId}: fetch_note done`);
  } else {
    logger.info(`[Worker-${workerId}] Post ${postId}: Step 1 fetch_note skipped (no template)`);
  }

  // Step 2: fetch_comments
  const currentStatus = await getTaskPostStatus(taskId, postId);
  const fetchCommentsTemplate = cliTemplates.fetch_comments || getPlatformAdapter(platformId)?.defaultTemplates.fetchComments || '';
  if (fetchCommentsTemplate) {
    if (!currentStatus?.comments_fetched) {
      logger.info(`[Worker-${workerId}] Post ${postId}: Step 2 fetch_comments`);
      const result = await serializeBrowserFetch(() => fetchViaOpencli(fetchCommentsTemplate, fetchVars));
      if (!result.success) {
        throw new Error(`fetch_comments failed for post ${postId}: ${result.error ?? 'unknown'}`);
      }
      const commentCount = await importCommentsToDb(result.data ?? [], postId, platformId);
      await upsertTaskPostStatus(taskId, postId, { comments_fetched: true, comments_count: commentCount });
      logger.info(`[Worker-${workerId}] Post ${postId}: imported ${commentCount} comments`);
    }
  } else {
    // No template — mark comments as done for this step
    if (!currentStatus?.comments_fetched) {
      await upsertTaskPostStatus(taskId, postId, { comments_fetched: true });
    }
    logger.info(`[Worker-${workerId}] Post ${postId}: Step 2 fetch_comments skipped (no template)`);
  }

  // Step 3: fetch_media
  const statusAfterComments = await getTaskPostStatus(taskId, postId);
  const fetchMediaTemplate = cliTemplates.fetch_media ?? getDefaultFetchMediaTemplate(platformId);
  if (fetchMediaTemplate) {
    if (!statusAfterComments?.media_fetched) {
      const result = await serializeBrowserFetch(() => fetchViaOpencli(fetchMediaTemplate, fetchVars));
      if (!result.success) {
        throw new Error(`fetch_media failed for post ${postId}: ${result.error ?? 'unknown'}`);
      }
      const mediaCount = await importMediaToDb(result.data ?? [], postId, platformId, noteId);
      await upsertTaskPostStatus(taskId, postId, { media_fetched: true, media_count: mediaCount });
      await syncWaitingMediaJobs(taskId, postId);
      logger.info(`[Worker-${workerId}] Post ${postId}: imported ${mediaCount} media files`);
      // Auto-set cover_url from first downloaded image if post lacks one
      if (mediaCount > 0) {
        const post = await getPostById(postId);
        if (post && !post.cover_url) {
          const mediaFiles = await listMediaFilesByPost(postId);
          const firstImage = mediaFiles.find(m => m.media_type === 'image');
          if (firstImage) {
            const coverUrl = firstImage.url || firstImage.local_path || '';
            if (coverUrl) {
              await updatePost(postId, { cover_url: coverUrl });
              logger.info(`[Worker-${workerId}] Post ${postId}: auto-set cover_url from first media file`);
            }
          }
        }
      }
    }
  } else {
    if (!statusAfterComments?.media_fetched) {
      await upsertTaskPostStatus(taskId, postId, { media_fetched: true });
    }
    logger.info(`[Worker-${workerId}] Post ${postId}: Step 3 fetch_media skipped (no template and no default for platform ${platformId})`);
  }

  // Mark as done
  await upsertTaskPostStatus(taskId, postId, { status: 'done' });
  logger.info(`[Worker-${workerId}] Post ${postId}: prepare done`);

  // Build analysis jobs for this post if task has strategies
  try {
    const { listTaskSteps } = await import('@scopai/core');
    const { getStrategyById } = await import('@scopai/core');
    const { listTaskTargets } = await import('@scopai/core');
    const { getExistingJobTargets } = await import('@scopai/core');
    const { createTaskTarget } = await import('@scopai/core');

    const steps = await listTaskSteps(taskId);
    const strategies = new Map();
    for (const step of steps) {
      if (step.strategy_id && !strategies.has(step.strategy_id)) {
        const strategy = await getStrategyById(step.strategy_id);
        if (strategy) strategies.set(step.strategy_id, strategy);
      }
    }

    // Only proceed if there are strategies
    if (strategies.size > 0) {
      let taskTargets = await listTaskTargets(taskId);
      const mediaStatus = await query<{ media_fetched: boolean }>(
        `SELECT media_fetched FROM task_post_status WHERE task_id = ? AND post_id = ?`,
        [taskId, postId],
      );
      const mediaReady = mediaStatus[0]?.media_fetched === true;
      const comments = await query<{ id: string }>(
        `SELECT id FROM comments WHERE post_id = ?`,
        [postId],
      );

      // Ensure comments are task targets for comment-level strategies
      const hasCommentStrategy = Array.from(strategies.values()).some((s: any) => s.target === 'comment');
      if (hasCommentStrategy && comments.length > 0) {
        const existingIds = new Set(taskTargets.map(t => t.target_id));
        for (const c of comments) {
          if (!existingIds.has(c.id)) {
            await createTaskTarget(taskId, 'comment', c.id);
            existingIds.add(c.id);
          }
        }
        taskTargets = await listTaskTargets(taskId);
      }

      const { jobs: analysisJobs, stepUpdates } = buildJobsForPost(
        taskId,
        postId,
        steps,
        strategies,
        taskTargets,
        await getExistingJobTargets(taskId, strategies.keys().next().value ?? ''),
        comments,
        mediaReady,
        generateId,
      );

      if (analysisJobs.length > 0) {
        await enqueueJobs(analysisJobs);
        for (const update of stepUpdates) {
          await updateTaskStepStatus(update.stepId, update.status, update.stats);
        }
        logger.info(`[Worker-${workerId}] Post ${postId}: enqueued ${analysisJobs.length} analysis jobs`);
      }
    }
  } catch (schedErr: unknown) {
    const msg = schedErr instanceof Error ? schedErr.message : String(schedErr);
    logger.error(`[Worker-${workerId}] Failed to enqueue analysis jobs for post ${postId}: ${msg}`);
    // Non-fatal: data preparation succeeded regardless
  }
}

async function resolveUpstreamResult(
  taskId: string,
  strategyId: string,
  targetId: string,
): Promise<Record<string, unknown> | null> {
  const { listTaskSteps } = await import('@scopai/core');
  const { getStrategyById } = await import('@scopai/core');
  const { getUpstreamResult } = await import('@scopai/core');

  const steps = await listTaskSteps(taskId);
  const currentStep = steps.find(s => s.strategy_id === strategyId);
  if (!currentStep || !currentStep.depends_on_step_id) return null;

  const upstreamStep = steps.find(s => s.id === currentStep.depends_on_step_id);
  if (!upstreamStep || !upstreamStep.strategy_id) return null;

  return getUpstreamResult(upstreamStep.strategy_id, taskId, targetId);
}

async function processStrategyJob(
  job: QueueJob,
  task: { id: string; name: string },
  workerId: number | string,
): Promise<void> {
  const logger = getLogger();
  if (!job.strategy_id) throw new Error('Job has no strategy_id');
  if (!job.target_id) throw new Error('Job has no target_id');

  const strategy = await getStrategyById(job.strategy_id);
  if (!strategy) throw new Error(`Strategy ${job.strategy_id} not found`);

  logger.info(`[Worker-${workerId}] Strategy ${strategy.id} (target=${strategy.target}, media=${strategy.needs_media?.enabled ?? false})`);

  // Resolve upstream result for secondary strategies
  let upstreamResult: Record<string, unknown> | null = null;
  if (strategy.depends_on) {
    upstreamResult = await resolveUpstreamResult(job.task_id, job.strategy_id!, job.target_id!);
  }

  if (strategy.target === 'post') {
    const post = await getPostById(job.target_id);
    if (!post) throw new Error(`Post ${job.target_id} not found`);

    logger.info(`[Worker-${workerId}] Calling analyzeWithStrategy for post ${post.id}, media=${strategy.needs_media?.enabled ?? false}`);
    const rawResponse = await analyzeWithStrategy(post, strategy, upstreamResult);
    logger.info(`[Worker-${workerId}] analyzeWithStrategy returned ${rawResponse.length} chars`);
    const parsed = parseStrategyResult(rawResponse, strategy.output_schema);

    const dynamicColumns = Object.keys(parsed.values);
    const schemaProperties = (strategy.output_schema.properties || {}) as Record<string, Record<string, unknown>>;
    const dynamicValues = dynamicColumns.map((k) => {
      const val = parsed.values[k];
      const def = schemaProperties[k];
      if (def?.type === 'array' && Array.isArray(val)) {
        const items = val.map((v: unknown) => {
          if (typeof v === 'string') return `'${String(v).replace(/'/g, "''")}'`;
          return String(v);
        });
        return `[${items.join(',')}]`;
      }
      if (def?.type === 'object' && val !== null && val !== undefined) {
        return JSON.stringify(val);
      }
      return val;
    });
    await insertStrategyResult(strategy.id, {
      task_id: task.id,
      target_type: 'post',
      target_id: job.target_id,
      post_id: job.target_id,
      strategy_version: strategy.version,
      raw_response: parsed.raw,
      error: null,
      analyzed_at: new Date(),
    }, dynamicColumns, dynamicValues);
  } else if (strategy.target === 'comment') {
    const comment = await getCommentById(job.target_id);
    if (!comment) throw new Error(`Comment ${job.target_id} not found`);

    // Batch analysis (not supported for secondary strategies — each comment may have different upstream results)
    if (strategy.batch_config?.enabled && strategy.batch_config.size > 1 && !strategy.depends_on) {
      await processCommentBatch(job, strategy, comment, task, workerId);
      return;
    }

    // Single comment analysis
    const rawResponse = await analyzeWithStrategy(comment, strategy, upstreamResult);
    const parsed = parseStrategyResult(rawResponse, strategy.output_schema);

    const dynamicColumns = Object.keys(parsed.values);
    const schemaProperties = (strategy.output_schema.properties || {}) as Record<string, Record<string, unknown>>;
    const dynamicValues = dynamicColumns.map((k) => {
      const val = parsed.values[k];
      const def = schemaProperties[k];
      if (def?.type === 'array' && Array.isArray(val)) {
        const items = val.map((v: unknown) => {
          if (typeof v === 'string') return `'${String(v).replace(/'/g, "''")}'`;
          return String(v);
        });
        return `[${items.join(',')}]`;
      }
      if (def?.type === 'object' && val !== null && val !== undefined) {
        return JSON.stringify(val);
      }
      return val;
    });

    await insertStrategyResult(strategy.id, {
      task_id: task.id,
      target_type: 'comment',
      target_id: job.target_id,
      post_id: comment.post_id,
      strategy_version: strategy.version,
      raw_response: parsed.raw,
      error: null,
      analyzed_at: new Date(),
    }, dynamicColumns, dynamicValues);
  } else {
    throw new Error(`Unknown strategy target: ${strategy.target}`);
  }
}

async function processCommentBatch(
  job: QueueJob,
  strategy: { id: string; version: string; batch_config: { enabled: boolean; size: number } | null; output_schema: Record<string, unknown> },
  seedComment: Comment,
  task: { id: string; name: string },
  workerId: number | string,
): Promise<void> {
  const logger = getLogger();
  const batchSize = Math.min(strategy.batch_config!.size, 20);
  const postId = seedComment.post_id;

  const allJobs = await listJobsByTask(job.task_id);
  const candidateIds = allJobs
    .filter(j =>
      j.strategy_id === strategy.id &&
      j.target_type === 'comment' &&
      j.status === 'pending' &&
      j.id !== job.id,
    )
    .slice(0, batchSize - 1)
    .map(j => j.target_id!)
    .filter(Boolean);

  // Lock the batch atomically
  const locked = await lockPendingJobs(job.task_id, strategy.id, candidateIds);
  const lockedTargetIds = locked.map(l => l.target_id);
  const lockedJobIds = locked.map(l => l.id);

  // Fetch all comments in batch
  const comments = await listCommentsByIds([seedComment.id, ...lockedTargetIds]);
  const ordered = [seedComment, ...comments.filter(c => c.id !== seedComment.id)];

  logger.info(`[Worker-${workerId}] Batch analyzing ${ordered.length} comments for post ${postId}`);

  try {
    const rawResponse = await analyzeBatchWithStrategy(ordered, strategy as any);
    const parsed = parseBatchStrategyResult(rawResponse, strategy.output_schema);

    if (parsed.values.length !== ordered.length) {
      throw new Error(`Batch result count mismatch: expected ${ordered.length}, got ${parsed.values.length}`);
    }

    const dynamicColumns = Object.keys(parsed.values[0] ?? {});
    const schemaProperties = (strategy.output_schema.properties || {}) as Record<string, Record<string, unknown>>;

    for (let i = 0; i < ordered.length; i++) {
      const comment = ordered[i];
      const values = parsed.values[i];
      const dynamicValues = dynamicColumns.map((k) => {
        const val = values[k];
        const def = schemaProperties[k];
        if (def?.type === 'array' && Array.isArray(val)) {
          const items = val.map((v: unknown) => {
            if (typeof v === 'string') return `'${String(v).replace(/'/g, "''")}'`;
            return String(v);
          });
          return `[${items.join(',')}]`;
        }
        if (def?.type === 'object' && val !== null && val !== undefined) {
          return JSON.stringify(val);
        }
        return val;
      });

      await insertStrategyResult(strategy.id, {
        task_id: task.id,
        target_type: 'comment',
        target_id: comment.id,
        post_id: comment.post_id,
        strategy_version: strategy.version,
        raw_response: values,
        error: null,
        analyzed_at: new Date(),
      }, dynamicColumns, dynamicValues);
    }

    // Mark other batch jobs as completed
    if (lockedJobIds.length > 0) {
      await completeJobs(lockedJobIds);
      for (const lid of lockedJobIds) {
        const lockedJob = allJobs.find(j => j.id === lid);
        if (lockedJob?.target_type && lockedJob?.target_id) {
          await updateTargetStatus(job.task_id, lockedJob.target_type, lockedJob.target_id, 'done');
        }
      }
      await updateTaskStatsForTask(job.task_id);
      if (job.strategy_id) {
        await syncStepStats(job.task_id, strategy.id);
      }
    }

    logger.info(`[Worker-${workerId}] Batch complete: ${ordered.length} comments analyzed`);
  } catch (err: unknown) {
    // Unlock other jobs so they can retry individually
    if (lockedJobIds.length > 0) {
      logger.warn(`[Worker-${workerId}] Unlocking ${lockedJobIds.length} jobs after batch failure`);
      await unlockJobs(lockedJobIds);
    }
    throw err;
  }
}

function serializeBrowserFetch<T>(fn: () => Promise<T>): Promise<T> {
  const next = browserFetchLock.then(() => fn(), () => fn());
  browserFetchLock = next.then(() => {}, () => {});
  return next;
}

async function updateTaskStatsForTask(taskId: string): Promise<void> {
  const stats = await getTargetStats(taskId);
  await updateTaskStats(taskId, { total: stats.total, done: stats.done, failed: stats.failed });

  if (stats.done + stats.failed >= stats.total && stats.total > 0) {
    await updateTaskStatus(taskId, 'completed');
  }
}

async function syncStepStats(taskId: string, strategyId: string): Promise<void> {
  const jobs = await listJobsByTask(taskId);
  const strategyJobs = jobs.filter(j => j.strategy_id === strategyId);
  const total = strategyJobs.length;
  const done = strategyJobs.filter(j => j.status === 'completed').length;
  const failed = strategyJobs.filter(j => j.status === 'failed').length;
  const steps = await listTaskSteps(taskId);
  const step = steps.find(s => s.strategy_id === strategyId);
  if (!step) return;

  let status: 'running' | 'completed' | 'failed' = 'running';
  if (done === total) status = 'completed';
  else if (failed > 0 && done + failed === total) status = 'failed';

  await updateTaskStepStatus(step.id, status, { total, done, failed });
}
