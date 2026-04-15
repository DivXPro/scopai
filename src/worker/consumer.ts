import { getNextJob, updateJobStatus } from '../db/queue-jobs';
import { getTaskById, updateTaskStatus, updateTaskStats } from '../db/tasks';
import { getTargetStats, updateTargetStatus } from '../db/task-targets';
import { getCommentById } from '../db/comments';
import { getMediaFileById } from '../db/media-files';
import { getPlatformById } from '../db/platforms';
import { getTemplateById } from '../db/templates';
import { getPostById } from '../db/posts';
import { getStrategyById } from '../db/strategies';
import { createAnalysisResultComment, createAnalysisResultMedia, createAnalysisResult } from '../db/analysis-results';
import { analyzeComment, analyzeMedia, analyzeWithStrategy } from './anthropic';
import { parseCommentResult, parseMediaResult, parseStrategyResult } from './parser';
import { QueueJob } from '../shared/types';
import { sleep } from '../shared/utils';

const POLL_INTERVAL_MS = 2000;

export async function runConsumer(workerId: number): Promise<void> {
  console.log(`[Worker-${workerId}] Consumer started, polling every ${POLL_INTERVAL_MS}ms`);

  while (true) {
    try {
      const job = await getNextJob();
      if (!job) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      console.log(`[Worker-${workerId}] Processing job ${job.id} for task ${job.task_id}`);

      try {
        await processJob(job);
        await updateJobStatus(job.id, 'completed');
        if (job.target_type && job.target_id) {
          await updateTargetStatus(job.task_id, job.target_type, job.target_id, 'done');
        }
        await updateTaskStatsForTask(job.task_id);
        console.log(`[Worker-${workerId}] Job ${job.id} completed`);
      } catch (err) {
        const error = String(err);
        console.error(`[Worker-${workerId}] Job ${job.id} failed:`, error);
        await updateJobStatus(job.id, 'failed');
        if (job.target_type && job.target_id) {
          await updateTargetStatus(job.task_id, job.target_type, job.target_id, 'failed', error);
        }
      }
    } catch (err) {
      console.error(`[Worker-${workerId}] Error in consumer loop:`, err);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

async function processJob(job: QueueJob): Promise<void> {
  const task = await getTaskById(job.task_id);
  if (!task) throw new Error(`Task ${job.task_id} not found`);

  if (job.strategy_id) {
    await processStrategyJob(job, task);
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

  await createAnalysisResultComment({
    task_id: task.id,
    comment_id: job.target_id,
    sentiment_label: parsed.sentiment_label,
    sentiment_score: parsed.sentiment_score,
    intent: parsed.intent,
    risk_flagged: parsed.risk_flagged,
    risk_level: parsed.risk_level,
    risk_reason: parsed.risk_reason,
    topics: parsed.topics,
    emotion_tags: parsed.emotion_tags,
    keywords: parsed.keywords,
    summary: parsed.summary,
    raw_response: parsed.raw,
    error: null,
    analyzed_at: new Date(),
  });
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

  await createAnalysisResultMedia({
    task_id: task.id,
    media_id: job.target_id,
    media_type: media.media_type,
    content_type: parsed.content_type,
    description: parsed.description,
    ocr_text: parsed.ocr_text,
    sentiment_label: parsed.sentiment_label,
    sentiment_score: parsed.sentiment_score,
    risk_flagged: parsed.risk_flagged,
    risk_level: parsed.risk_level,
    risk_reason: parsed.risk_reason,
    objects: parsed.objects,
    logos: parsed.logos,
    faces: parsed.faces,
    raw_response: parsed.raw,
    error: null,
    analyzed_at: new Date(),
  });
}

async function processStrategyJob(
  job: QueueJob,
  task: { id: string; name: string },
): Promise<void> {
  if (!job.strategy_id) throw new Error('Job has no strategy_id');
  if (!job.target_id) throw new Error('Job has no target_id');

  const strategy = await getStrategyById(job.strategy_id);
  if (!strategy) throw new Error(`Strategy ${job.strategy_id} not found`);

  if (strategy.target === 'post') {
    const post = await getPostById(job.target_id);
    if (!post) throw new Error(`Post ${job.target_id} not found`);

    const rawResponse = await analyzeWithStrategy(post, strategy);
    const parsed = parseStrategyResult(rawResponse, strategy.output_schema);

    await createAnalysisResult({
      task_id: task.id,
      strategy_id: strategy.id,
      strategy_version: strategy.version,
      target_type: 'post',
      target_id: job.target_id,
      post_id: job.target_id,
      columns: parsed.columns,
      json_fields: parsed.json_fields,
      raw_response: parsed.raw,
      error: null,
      analyzed_at: new Date(),
    });
  } else if (strategy.target === 'comment') {
    // P2 scope; for now throw
    throw new Error('Comment-level strategy analysis not yet implemented');
  } else {
    throw new Error(`Unknown strategy target: ${strategy.target}`);
  }
}

async function updateTaskStatsForTask(taskId: string): Promise<void> {
  const stats = await getTargetStats(taskId);
  await updateTaskStats(taskId, { total: stats.total, done: stats.done, failed: stats.failed });

  if (stats.done + stats.failed >= stats.total && stats.total > 0) {
    await updateTaskStatus(taskId, 'completed');
  }
}
