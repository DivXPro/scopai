import { getNextJobs, updateJobStatus, requeueJob, listJobsByTask, lockPendingJobs, completeJobs, unlockJobs } from '../db/queue-jobs';
import { getTaskById, updateTaskStatus, updateTaskStats } from '../db/tasks';
import { updateTargetStatus, getTargetStats } from '../db/task-targets';
import { getCommentById, listCommentsByIds } from '../db/comments';
import { getMediaFileById } from '../db/media-files';
import { getPlatformById } from '../db/platforms';
import { getTemplateById } from '../db/templates';
import { getPostById } from '../db/posts';
import { getStrategyById } from '../db/strategies';
import { insertStrategyResult } from '../db/analysis-results';
import { updateTaskStepStatus, listTaskSteps } from '../db/task-steps';
import { analyzeComment, analyzeMedia, analyzeWithStrategy, analyzeBatchWithStrategy } from './anthropic';
import { parseCommentResult, parseMediaResult, parseStrategyResult, parseBatchStrategyResult } from './parser';
import { QueueJob, Comment } from '../shared/types';
import { sleep } from '../shared/utils';
import { waitForJob } from '../shared/job-events';
import {
  registerWorker,
  unregisterWorker,
  setWorkerActiveCount,
  isShuttingDown,
} from '../shared/shutdown';
import { config } from '../config';
import { getLogger } from '../shared/logger';

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
        while (buffer.length === 0 && active.size < concurrency) {
          const need = concurrency - active.size;
          const jobs = await getNextJobs(need);
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

        if (active.size > 0) {
          await Promise.race(active);
          continue;
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

async function processJobWithLifecycle(job: QueueJob, workerId: number): Promise<void> {
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

async function processJob(job: QueueJob, workerId: number): Promise<void> {
  const task = await getTaskById(job.task_id);
  if (!task) throw new Error(`Task ${job.task_id} not found`);

  if (job.strategy_id) {
    await processStrategyJob(job, task, workerId);
    return;
  }

  if (!task.template_id) throw new Error(`Task ${job.task_id} has no template`);
  const template = await getTemplateById(task.template_id);
  if (!template) throw new Error(`Template ${task.template_id} not found`);

  if (job.target_type === 'comment') {
    await processCommentJob(job, task, template);
  } else if (job.target_type === 'post') {
    throw new Error(`Unsupported target_type: ${job.target_type}`);
  } else if (job.target_type === 'media') {
    await processMediaJob(job, task, template);
  } else {
    throw new Error(`Unknown target_type: ${job.target_type}`);
  }
}

async function processCommentJob(
  job: QueueJob,
  task: { id: string; name: string },
  template: { id: string; name: string; template: string },
): Promise<void> {
  if (!job.target_id) throw new Error('Job has no target_id');

  const comment = await getCommentById(job.target_id);
  if (!comment) throw new Error(`Comment ${job.target_id} not found`);

  const platform = await getPlatformById(comment.platform_id);
  const platformName = platform?.name ?? 'unknown';

  const rawResponse = await analyzeComment(comment, platformName, {
    id: template.id,
    name: template.name,
    template: template.template,
    description: null,
    is_default: false,
    created_at: new Date(),
  });

  const parsed = parseCommentResult(rawResponse);

  await insertStrategyResult('legacy_comment', {
    task_id: task.id,
    target_type: 'comment',
    target_id: job.target_id,
    post_id: null,
    strategy_version: 'legacy',
    raw_response: parsed.raw,
    error: null,
    analyzed_at: new Date(),
  }, ['sentiment_label', 'sentiment_score', 'intent', 'risk_flagged', 'risk_level', 'risk_reason', 'topics', 'emotion_tags', 'keywords', 'summary'],
  [parsed.sentiment_label, parsed.sentiment_score, parsed.intent, parsed.risk_flagged, parsed.risk_level, parsed.risk_reason, parsed.topics, parsed.emotion_tags, parsed.keywords, parsed.summary]);
}

async function processMediaJob(
  job: QueueJob,
  task: { id: string; name: string },
  template: { id: string; name: string; template: string },
): Promise<void> {
  if (!job.target_id) throw new Error('Job has no target_id');

  const media = await getMediaFileById(job.target_id);
  if (!media) throw new Error(`Media file ${job.target_id} not found`);

  const platform = await getPlatformById(media.platform_id ?? '');
  const platformName = platform?.name ?? 'unknown';

  const rawResponse = await analyzeMedia(media, platformName, {
    id: template.id,
    name: template.name,
    template: template.template,
    description: null,
    is_default: false,
    created_at: new Date(),
  });

  const parsed = parseMediaResult(rawResponse);

  await insertStrategyResult('legacy_media', {
    task_id: task.id,
    target_type: 'media',
    target_id: job.target_id,
    post_id: null,
    strategy_version: 'legacy',
    raw_response: parsed.raw,
    error: null,
    analyzed_at: new Date(),
  }, ['media_type', 'content_type', 'description', 'ocr_text', 'sentiment_label', 'sentiment_score', 'risk_flagged', 'risk_level', 'risk_reason', 'objects', 'logos', 'faces'],
  [media.media_type, parsed.content_type, parsed.description, parsed.ocr_text, parsed.sentiment_label, parsed.sentiment_score, parsed.risk_flagged, parsed.risk_level, parsed.risk_reason, parsed.objects, parsed.logos, parsed.faces]);
}

async function resolveUpstreamResult(
  taskId: string,
  strategyId: string,
  targetId: string,
): Promise<Record<string, unknown> | null> {
  const { listTaskSteps } = await import('../db/task-steps');
  const { getStrategyById } = await import('../db/strategies');
  const { getUpstreamResult } = await import('../db/analysis-results');

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
  workerId: number,
): Promise<void> {
  if (!job.strategy_id) throw new Error('Job has no strategy_id');
  if (!job.target_id) throw new Error('Job has no target_id');

  const strategy = await getStrategyById(job.strategy_id);
  if (!strategy) throw new Error(`Strategy ${job.strategy_id} not found`);

  // Resolve upstream result for secondary strategies
  let upstreamResult: Record<string, unknown> | null = null;
  if (strategy.depends_on) {
    upstreamResult = await resolveUpstreamResult(job.task_id, job.strategy_id!, job.target_id!);
  }

  if (strategy.target === 'post') {
    const post = await getPostById(job.target_id);
    if (!post) throw new Error(`Post ${job.target_id} not found`);

    const rawResponse = await analyzeWithStrategy(post, strategy, upstreamResult);
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
  workerId: number,
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
