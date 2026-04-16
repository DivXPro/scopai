import * as fs from 'fs';
import * as path from 'path';
import { createPost, getPostById, listPosts, searchPosts } from '../db/posts';
import { createComment, listCommentsByPost } from '../db/comments';
import { createTask, getTaskById, listTasks, updateTaskStatus, updateTaskStats } from '../db/tasks';
import { addTaskTargets, getTargetStats, listTaskTargets } from '../db/task-targets';
import { upsertTaskPostStatus, getPendingPostIds } from '../db/task-post-status';
import { createMediaFile, listMediaFilesByPost } from '../db/media-files';
import { createPlatform, listPlatforms } from '../db/platforms';
import { createFieldMapping, listFieldMappings } from '../db/field-mappings';
import { createTemplate, listTemplates, getTemplateById, updateTemplate, setDefaultTemplate } from '../db/templates';
import { enqueueJobs, getQueueStats, syncWaitingMediaJobs } from '../db/queue-jobs';
import { getDbPath, query, run } from '../db/client';
import { generateId, now, parseImportFile } from '../shared/utils';
import { fetchViaOpencli } from '../data-fetcher/opencli';
import { createStrategy, getStrategyById, listStrategies, validateStrategyJson, updateStrategy, deleteStrategy, parseJsonSchemaToColumns, createStrategyResultTable, syncStrategyResultTable } from '../db/strategies';
import { getExistingResultIds } from '../db/analysis-results';
import { getTaskPostStatus } from '../db/task-post-status';
import { config } from '../config';
import type { QueueJob } from '../shared/types';

type Handler = (params: Record<string, unknown>) => Promise<unknown>;

const FIELD_NAME_MAP: Record<string, string> = {
  likes: 'like_count',
  collects: 'collect_count',
  comments: 'comment_count',
  shares: 'share_count',
  plays: 'play_count',
  note_id: 'platform_post_id',
};

function normalizeFieldValueArray(item: unknown): unknown {
  if (
    Array.isArray(item) &&
    item.length > 0 &&
    item.every(
      (i) =>
        typeof i === 'object' &&
        i !== null &&
        'field' in i &&
        'value' in i,
    )
  ) {
    const obj: Record<string, unknown> = {};
    for (const entry of item) {
      const rawField = (entry as Record<string, unknown>).field as string;
      const mappedField = FIELD_NAME_MAP[rawField] ?? rawField;
      obj[mappedField] = (entry as Record<string, unknown>).value;
    }
    return obj;
  }
  return item;
}

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

interface RawCommentItem {
  platform_comment_id?: string;
  id?: string;
  parent_comment_id?: string;
  root_comment_id?: string;
  depth?: number;
  author_id?: string;
  author_name?: string;
  author?: string;
  content?: string;
  like_count?: number;
  reply_count?: number;
  published_at?: string;
  metadata?: unknown;
}

export function getHandlers(): Record<string, Handler> {
  return {
    async 'post.import'(params) {
      const platformId = params.platform as string;
      const file = params.file as string;
      const taskId = (params.task_id as string | undefined) ?? undefined;
      let items: RawPostItem[];
      try {
        items = parseImportFile(file) as RawPostItem[];
      } catch (err: unknown) {
        throw new Error(`Failed to parse import file: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Support opencli xiaohongshu note field-value array format: [{field, value}, ...]
      const normalizedFirst = normalizeFieldValueArray(items);
      if (normalizedFirst !== items) {
        items = [normalizedFirst as RawPostItem];
      }

      let imported = 0;
      let skipped = 0;
      const postIds: string[] = [];

      for (const rawItem of items) {
        const item = normalizeFieldValueArray(rawItem) as RawPostItem;
        const platformPostId = item.platform_post_id ?? item.noteId ?? item.id ?? generateId();
        const existing = await query<{ id: string }>(
          'SELECT id FROM posts WHERE platform_id = ? AND platform_post_id = ?',
          [platformId, platformPostId],
        );

        let postId: string;
        try {
          if (existing.length > 0) {
            postId = existing[0].id;
            await run(
              `UPDATE posts SET
                title = ?, content = ?, author_id = ?, author_name = ?, author_url = ?,
                url = ?, cover_url = ?, post_type = ?, like_count = ?, collect_count = ?,
                comment_count = ?, share_count = ?, play_count = ?, score = ?, tags = ?,
                media_files = ?, published_at = ?, metadata = ?, fetched_at = ?
              WHERE id = ?`,
              [
                item.title ?? null,
                item.content ?? item.text ?? item.desc ?? '',
                item.author_id ?? null,
                item.author_name ?? item.author ?? null,
                item.author_url ?? null,
                item.url ?? null,
                item.cover_url ?? null,
                (item.post_type ?? item.type ?? null) as any,
                Number(item.like_count ?? 0),
                Number(item.collect_count ?? 0),
                Number(item.comment_count ?? 0),
                Number(item.share_count ?? 0),
                Number(item.play_count ?? 0),
                item.score ? Number(item.score) : null,
                item.tags ? JSON.stringify(item.tags) : null,
                item.media_files ? JSON.stringify(item.media_files) : null,
                item.published_at ? new Date(item.published_at) : null,
                item.metadata ? JSON.stringify(item.metadata) : null,
                now(),
                postId,
              ],
            );
            skipped++;
          } else {
            const post = await createPost({
              platform_id: platformId,
              platform_post_id: platformPostId,
              title: item.title ?? null,
              content: item.content ?? item.text ?? item.desc ?? '',
              author_id: item.author_id ?? null,
              author_name: item.author_name ?? item.author ?? null,
              author_url: item.author_url ?? null,
              url: item.url ?? null,
              cover_url: item.cover_url ?? null,
              post_type: (item.post_type ?? item.type ?? null) as any,
              like_count: Number(item.like_count ?? 0),
              collect_count: Number(item.collect_count ?? 0),
              comment_count: Number(item.comment_count ?? 0),
              share_count: Number(item.share_count ?? 0),
              play_count: Number(item.play_count ?? 0),
              score: item.score ? Number(item.score) : null,
              tags: item.tags as { name: string; url?: string }[] | null ?? null,
              media_files: item.media_files as { type: 'image' | 'video' | 'audio'; url: string; local_path?: string }[] | null ?? null,
              published_at: item.published_at ? new Date(item.published_at) : null,
              metadata: item.metadata as Record<string, unknown> | null ?? null,
            });
            postId = post.id;
            imported++;
          }
          postIds.push(postId);
        } catch (err: unknown) {
          throw new Error(`Failed to import post ${platformPostId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      if (taskId && postIds.length > 0) {
        const { addTaskTargets } = await import('../db/task-targets');
        const { upsertTaskPostStatus } = await import('../db/task-post-status');
        await addTaskTargets(taskId, 'post', postIds);
        for (const postId of postIds) {
          await upsertTaskPostStatus(taskId, postId, { status: 'pending' });
        }
      }

      return { imported, skipped, postIds };
    },

    async 'post.list'(params) {
      return listPosts(params.platform as string | undefined,
        Number(params.limit ?? 50), Number(params.offset ?? 0));
    },

    async 'post.search'(params) {
      return searchPosts(params.platform as string, params.query as string, Number(params.limit ?? 50));
    },

    async 'comment.import'(params) {
      const platformId = params.platform as string;
      const postId = params.post_id as string;
      const file = params.file as string;
      let items: RawCommentItem[];
      try {
        items = parseImportFile(file) as RawCommentItem[];
      } catch (err: unknown) {
        throw new Error(`Failed to parse import file: ${err instanceof Error ? err.message : String(err)}`);
      }
      let imported = 0;
      let skipped = 0;
      for (const item of items) {
        try {
          await createComment({
            post_id: postId,
            platform_id: platformId,
            platform_comment_id: item.platform_comment_id ?? item.id ?? null,
            parent_comment_id: item.parent_comment_id ?? null,
            root_comment_id: item.root_comment_id ?? null,
            depth: Number(item.depth ?? 0),
            author_id: item.author_id ?? null,
            author_name: item.author_name ?? item.author ?? null,
            content: item.content ?? '',
            like_count: Number(item.like_count ?? 0),
            reply_count: Number(item.reply_count ?? 0),
            published_at: item.published_at ? new Date(item.published_at) : null,
            metadata: item.metadata as Record<string, unknown> | null ?? null,
          });
          imported++;
        } catch {
          skipped++;
        }
      }
      return { imported, skipped };
    },

    async 'comment.list'(params) {
      return listCommentsByPost(params.post_id as string);
    },

    async 'task.create'(params) {
      const id = (params.id as string | undefined) ?? generateId();
      await createTask({
        id,
        name: params.name as string,
        description: (params.description ?? null) as string | null,
        template_id: (params.template_id ?? null) as string | null,
        cli_templates: (params.cli_templates ?? null) as string | null,
        status: 'pending',
        stats: { total: 0, done: 0, failed: 0 },
        created_at: now(),
        updated_at: now(),
        completed_at: null,
      });
      return { id };
    },

    async 'task.addTargets'(params) {
      const taskId = params.task_id as string;
      const targetType = params.target_type as 'post' | 'comment';
      const targetIds = params.target_ids as string[];
      await addTaskTargets(taskId, targetType, targetIds);
      return { added: targetIds.length };
    },

    async 'task.start'(params) {
      const taskId = params.task_id as string;
      await updateTaskStatus(taskId, 'running');
      const stats = await getTargetStats(taskId);
      await updateTaskStats(taskId, { total: stats.total, done: stats.done, failed: stats.failed });

      const task = await getTaskById(taskId);

      let totalEnqueued = 0;
      let mediaJobsCreated = 0;
      let targetsToProcess: { target_type: string; target_id: string }[] = [];

      if (task?.template_id) {
        // Skip already-analyzed comment targets
        const analyzedCommentIds = new Set(
          (await query<{ comment_id: string }>(
            'SELECT DISTINCT comment_id FROM analysis_results_comments WHERE task_id = ?',
            [taskId],
          )).map(r => r.comment_id),
        );
        targetsToProcess = stats.pending.filter(t => {
          if (t.target_type === 'comment' && analyzedCommentIds.has(t.target_id)) return false;
          return true;
        });

        if (targetsToProcess.length > 0) {
          const jobs = targetsToProcess.map(t => ({
            id: generateId(),
            task_id: taskId,
            strategy_id: null as string | null,
            target_type: t.target_type as 'post' | 'comment' | null,
            target_id: t.target_id,
            status: 'pending' as const,
            priority: 0,
            attempts: 0,
            max_attempts: 3,
            error: null,
            created_at: now(),
            processed_at: null,
          }));
          await enqueueJobs(jobs);
          totalEnqueued += jobs.length;
        }

        // Also enqueue media jobs for this task's posts
        mediaJobsCreated = await enqueueMediaJobsForTask(taskId);
        totalEnqueued += mediaJobsCreated;
      }

      return { enqueued: totalEnqueued, skipped: stats.pending.length - targetsToProcess.length, mediaJobs: mediaJobsCreated };
    },

    async 'task.pause'(params) {
      const taskId = params.task_id as string;
      await updateTaskStatus(taskId, 'paused');
      return { status: 'paused' };
    },

    async 'task.resume'(params) {
      const taskId = params.task_id as string;
      await updateTaskStatus(taskId, 'running');
      return { status: 'running' };
    },

    async 'task.cancel'(params) {
      const taskId = params.task_id as string;
      await updateTaskStatus(taskId, 'failed');
      return { status: 'cancelled' };
    },

    async 'task.results'(params) {
      const taskId = params.task_id as string;
      const { listAnalysisResults } = await import('../db/analysis-results');
      return listAnalysisResults(taskId);
    },

    async 'task.status'(params) {
      const taskId = params.task_id as string;
      const task = await getTaskById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);

      const stats = await getTargetStats(taskId);
      const { getTaskPostStatuses } = await import('../db/task-post-status');
      const { listTaskSteps } = await import('../db/task-steps');
      const { listJobsByTask } = await import('../db/queue-jobs');

      const postStatuses = await getTaskPostStatuses(taskId);
      const steps = await listTaskSteps(taskId);
      const jobs = await listJobsByTask(taskId);

      const totalPosts = postStatuses.length;
      const commentsFetched = postStatuses.filter(p => p.comments_fetched).length;
      const mediaFetched = postStatuses.filter(p => p.media_fetched).length;
      const failedPosts = postStatuses.filter(p => p.status === 'failed').length;

      let dataPrepStatus: 'pending' | 'fetching' | 'done' | 'failed' = 'done';
      if (totalPosts === 0) {
        dataPrepStatus = 'pending';
      } else if (failedPosts > 0 && failedPosts === totalPosts) {
        dataPrepStatus = 'failed';
      } else if (postStatuses.some(p => p.status === 'fetching')) {
        dataPrepStatus = 'fetching';
      } else if (postStatuses.some(p => !p.comments_fetched || !p.media_fetched)) {
        dataPrepStatus = 'pending';
      }

      const stepDetails = steps.map(s => ({
        stepId: s.id,
        strategyId: s.strategy_id,
        name: s.name,
        status: s.status,
        stats: s.stats ?? { total: 0, done: 0, failed: 0 },
        stepOrder: s.step_order,
      }));

      const phase = dataPrepStatus !== 'done'
        ? 'dataPreparation'
        : stepDetails.some(s => s.status === 'pending' || s.status === 'running')
          ? 'analysis'
          : (task.status as string);

      const jobStats = {
        totalJobs: jobs.length,
        completedJobs: jobs.filter(j => j.status === 'completed').length,
        failedJobs: jobs.filter(j => j.status === 'failed').length,
        pendingJobs: jobs.filter(j => j.status === 'pending' || j.status === 'waiting_media').length,
      };

      return {
        ...task,
        ...stats,
        phase,
        phases: {
          dataPreparation: {
            status: dataPrepStatus,
            totalPosts,
            commentsFetched,
            mediaFetched,
            failedPosts,
          },
          steps: stepDetails,
          analysis: jobStats,
        },
      };
    },

    async 'task.step.add'(params) {
      const taskId = params.task_id as string;
      const strategyId = params.strategy_id as string;
      const name = (params.name as string | undefined) ?? strategyId;
      const { createTaskStep, getNextStepOrder } = await import('../db/task-steps');
      const { getStrategyById } = await import('../db/strategies');

      const strategy = await getStrategyById(strategyId);
      if (!strategy) throw new Error(`Strategy not found: ${strategyId}`);

      const stepOrder = (params.order as number | undefined) ?? await getNextStepOrder(taskId);
      const step = await createTaskStep({
        task_id: taskId,
        strategy_id: strategyId,
        name,
        step_order: stepOrder,
        status: 'pending',
        stats: { total: 0, done: 0, failed: 0 },
        error: null,
      });
      return { stepId: step.id, stepOrder: step.step_order };
    },

    async 'task.step.list'(params) {
      const taskId = params.task_id as string;
      const { listTaskSteps } = await import('../db/task-steps');
      return listTaskSteps(taskId);
    },

    async 'task.step.run'(params) {
      const taskId = params.task_id as string;
      const stepId = params.step_id as string;
      const { getTaskStepById, updateTaskStepStatus } = await import('../db/task-steps');
      const { listTaskTargets } = await import('../db/task-targets');
      const { getStrategyById } = await import('../db/strategies');
      const { enqueueJobs } = await import('../db/queue-jobs');
      const { generateId } = await import('../shared/utils');

      const step = await getTaskStepById(stepId);
      if (!step) throw new Error(`Step not found: ${stepId}`);
      if (step.task_id !== taskId) throw new Error('Step does not belong to this task');
      if (step.status === 'completed') {
        return { status: 'completed', enqueued: 0 };
      }
      if (step.status === 'skipped') {
        return { status: 'skipped', enqueued: 0 };
      }

      const strategy = await getStrategyById(step.strategy_id ?? '');
      if (!strategy) throw new Error(`Strategy not found: ${step.strategy_id}`);

      const targets = await listTaskTargets(taskId);
      const relevantTargets = targets.filter(t => {
        if (strategy.target === 'post') return t.target_type === 'post';
        if (strategy.target === 'comment') return t.target_type === 'comment';
        return true;
      });

      if (relevantTargets.length === 0) {
        await updateTaskStepStatus(stepId, 'skipped', { total: 0, done: 0, failed: 0 });
        return { status: 'skipped', enqueued: 0 };
      }

      const jobs = relevantTargets.map(t => ({
        id: generateId(),
        task_id: taskId,
        strategy_id: strategy.id,
        target_type: strategy.target as 'post' | 'comment' | 'media',
        target_id: t.target_id,
        status: 'pending' as const,
        priority: 0,
        attempts: 0,
        max_attempts: 3,
        error: null,
        created_at: new Date(),
        processed_at: null,
      }));

      await enqueueJobs(jobs);
      await updateTaskStepStatus(stepId, 'running', { total: jobs.length, done: 0, failed: 0 });

      return { status: 'running', enqueued: jobs.length };
    },

    async 'task.runAllSteps'(params) {
      const taskId = params.task_id as string;
      const { listTaskSteps, updateTaskStepStatus } = await import('../db/task-steps');
      const steps = await listTaskSteps(taskId);
      const pendingSteps = steps.filter(s => s.status === 'pending' || s.status === 'failed');

      let completed = 0;
      let failed = 0;
      let skipped = 0;

      for (const step of pendingSteps) {
        try {
          const result = await (this as any)['task.step.run']({ task_id: taskId, step_id: step.id });
          if (result.status === 'skipped') {
            skipped++;
          } else {
            completed++;
          }
        } catch (err: unknown) {
          await updateTaskStepStatus(step.id, 'failed', undefined, err instanceof Error ? err.message : String(err));
          failed++;
        }
      }

      const remaining = steps.filter(s => s.status === 'pending' || s.status === 'running');
      if (remaining.length === 0 && steps.every(s => s.status === 'completed' || s.status === 'skipped' || s.status === 'failed')) {
        await updateTaskStatus(taskId, 'completed');
      }

      return { completed, failed, skipped };
    },

    async 'task.list'(params) {
      return listTasks(params.status as string | undefined);
    },

    async 'task.prepareData'(params) {
      const taskId = params.task_id as string;
      const task = await getTaskById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      if (!task.cli_templates) throw new Error('Task has no CLI templates');

      let cliTemplates: { fetch_note: string; fetch_comments?: string; fetch_media?: string };
      try {
        const parsed = JSON.parse(task.cli_templates);
        if (!parsed.fetch_note) {
          throw new Error('cli_templates must contain "fetch_note" — it is required to enrich post data before analysis');
        }
        cliTemplates = parsed;
      } catch (err: unknown) {
        throw new Error(`Invalid cli_templates: ${err instanceof Error ? err.message : String(err)}`);
      }

      const hasNotePlaceholder = (tpl: string) => tpl.includes('{post_id}') || tpl.includes('{note_id}');
      if (!hasNotePlaceholder(cliTemplates.fetch_note)) {
        throw new Error('fetch_note template must contain {post_id} or {note_id} placeholder');
      }
      if (cliTemplates.fetch_comments && !hasNotePlaceholder(cliTemplates.fetch_comments)) {
        throw new Error('fetch_comments template must contain {post_id} or {note_id} placeholder');
      }
      if (cliTemplates.fetch_media && !hasNotePlaceholder(cliTemplates.fetch_media)) {
        throw new Error('fetch_media template must contain {post_id} or {note_id} placeholder');
      }

      // Run data preparation asynchronously so the CLI can poll status
      runPrepareDataAsync(taskId, cliTemplates).catch(() => {});
      return { started: true };
    },

    async 'platform.list'() {
      return listPlatforms();
    },

    async 'platform.add'(params) {
      await createPlatform({
        id: params.id as string,
        name: params.name as string,
        description: (params.description ?? null) as string | null,
      });
      return { id: params.id };
    },

    async 'platform.mapping.list'(params) {
      return listFieldMappings(params.platform as string, params.entity as string);
    },

    async 'platform.mapping.add'(params) {
      await createFieldMapping({
        id: generateId(),
        platform_id: params.platform_id as string,
        entity_type: params.entity_type as 'post' | 'comment' | 'user',
        system_field: params.system_field as string,
        platform_field: params.platform_field as string,
        data_type: params.data_type as 'string' | 'number' | 'date' | 'boolean' | 'array' | 'json',
        is_required: (params.is_required ?? false) as boolean,
        transform_expr: (params.transform_expr ?? null) as string | null,
        description: (params.description ?? null) as string | null,
      });
      return { success: true };
    },

    async 'platform.mapping.import'(params) {
      const platformId = params.platform as string;
      const file = params.file as string;
      const items = readJsonLines<{
        entity_type: string; system_field: string; platform_field: string;
        data_type: string; is_required?: boolean; transform_expr?: string; description?: string;
      }>(file);
      let imported = 0;
      for (const item of items) {
        try {
          await createFieldMapping({
            id: generateId(),
            platform_id: platformId,
            entity_type: item.entity_type as 'post' | 'comment' | 'user',
            system_field: item.system_field,
            platform_field: item.platform_field,
            data_type: item.data_type as 'string' | 'number' | 'date' | 'boolean' | 'array' | 'json',
            is_required: item.is_required ?? false,
            transform_expr: item.transform_expr ?? null,
            description: item.description ?? null,
          });
          imported++;
        } catch {
          // ignore
        }
      }
      return { imported };
    },

    async 'template.list'() {
      return listTemplates();
    },

    async 'template.get'(params) {
      return getTemplateById(params.id as string);
    },

    async 'template.getByName'(params) {
      const { getTemplateByName } = await import('../db/templates');
      return getTemplateByName(params.name as string);
    },

    async 'template.add'(params) {
      const id = generateId();
      await createTemplate({
        id,
        name: params.name as string,
        description: (params.description ?? null) as string | null,
        template: params.template as string,
        is_default: (params.is_default ?? false) as boolean,
        created_at: now(),
      });
      if (params.is_default) {
        await setDefaultTemplate(id);
      }
      return { id };
    },

    async 'template.update'(params) {
      const id = params.id as string;
      const updates: Record<string, unknown> = {};
      if (params.name !== undefined) updates.name = params.name;
      if (params.template !== undefined) updates.template = params.template;
      if (params.description !== undefined) updates.description = params.description;
      if (Object.keys(updates).length === 0) return { updated: false };
      await updateTemplate(id, updates);
      return { updated: true };
    },

    async 'template.setDefault'(params) {
      await setDefaultTemplate(params.id as string);
      return { success: true };
    },

    async 'strategy.result.list'(params) {
      if (typeof params.task_id !== 'string') throw new Error('task_id is required');
      if (typeof params.strategy_id !== 'string') throw new Error('strategy_id is required');
      const { listStrategyResultsByTask } = await import('../db/analysis-results');
      return listStrategyResultsByTask(params.strategy_id as string, params.task_id as string, Number(params.limit ?? 100));
    },

    async 'strategy.result.stats'(params) {
      if (typeof params.task_id !== 'string') throw new Error('task_id is required');
      if (typeof params.strategy_id !== 'string') throw new Error('strategy_id is required');
      const { getStrategyResultStats } = await import('../db/analysis-results');
      return getStrategyResultStats(params.strategy_id as string, params.task_id as string);
    },

    async 'strategy.result.export'(params) {
      if (typeof params.task_id !== 'string') throw new Error('task_id is required');
      if (typeof params.strategy_id !== 'string') throw new Error('strategy_id is required');
      const { listStrategyResultsByTask } = await import('../db/analysis-results');
      const results = await listStrategyResultsByTask(params.strategy_id as string, params.task_id as string, 100000);
      const format = (params.format ?? 'json') as 'csv' | 'json';
      const allResults = results.map(r => {
        const rec = r as Record<string, unknown>;
        const flat: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(rec)) {
          if (typeof value === 'object' && value !== null) {
            flat[key] = JSON.stringify(value);
          } else {
            flat[key] = value;
          }
        }
        return flat;
      });

      let content: string;
      if (format === 'csv') {
        content = exportToCsv(allResults);
      } else {
        content = allResults.map(r => JSON.stringify(r)).join('\n') + '\n';
      }

      const outputPath = params.output as string | undefined;
      if (outputPath) {
        fs.writeFileSync(outputPath, content);
      }
      return { content, writtenTo: outputPath ?? null, count: allResults.length };
    },

    async 'result.media'(params) {
      const taskId = params.task_id as string;
      const postIdFilter = params.post_id as string | null;
      const postIds = postIdFilter
        ? [postIdFilter]
        : (await listTaskTargets(taskId))
            .filter(t => t.target_type === 'post')
            .map(t => t.target_id);

      if (postIds.length === 0) {
        return { posts: [], totalMedia: 0, totalAnalyzed: 0 };
      }

      const posts: { post_id: string; title: string; media: any[] }[] = [];
      let totalMedia = 0;
      let totalAnalyzed = 0;

      for (const postId of postIds) {
        const post = await getPostById(postId);
        if (!post) continue;

        const mediaFiles = await listMediaFilesByPost(postId);
        if (mediaFiles.length === 0) continue;

        const postTitle = post.title ?? post.content.slice(0, 40);
        const media: any[] = [];

        for (const m of mediaFiles) {
          totalMedia++;
          const analysisRows = await query(
            'SELECT * FROM analysis_results_media WHERE task_id = ? AND media_id = ?',
            [taskId, m.id],
          );
          if (analysisRows.length > 0) {
            totalAnalyzed++;
          }
          media.push({
            ...m,
            analysis: analysisRows[0] ?? null,
          });
        }

        posts.push({ post_id: postId, title: postTitle, media });
      }

      return { posts, totalMedia, totalAnalyzed };
    },

    async 'strategy.import'(params) {
      let data: unknown;
      if (typeof params.json === 'string') {
        try {
          data = JSON.parse(params.json as string);
        } catch {
          throw new Error('Invalid JSON string');
        }
      } else if (typeof params.file === 'string') {
        const filePath = params.file as string;
        if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
        const content = fs.readFileSync(filePath, 'utf-8');
        try {
          data = JSON.parse(content);
        } catch {
          throw new Error('Invalid JSON file');
        }
      } else {
        throw new Error('Either file or json is required');
      }
      const validation = validateStrategyJson(data);
      if (!validation.valid) throw new Error(validation.error);

      const obj = data as Record<string, unknown>;
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
        file_path: (typeof params.file === 'string' ? params.file : null) as string | null,
      };

      if (existing) {
        await updateStrategy(strategy.id, strategy);
      } else {
        await createStrategy(strategy);
      }
      return { imported: true, id: strategy.id };
    },

    async 'strategy.list'() {
      return listStrategies();
    },

    async 'strategy.show'(params) {
      if (typeof params.id !== 'string') throw new Error('id is required and must be a string');
      const strategy = await getStrategyById(params.id as string);
      if (!strategy) throw new Error(`Strategy not found: ${params.id}`);
      return strategy;
    },

    async 'strategy.delete'(params) {
      if (typeof params.id !== 'string') throw new Error('id is required and must be a string');
      const strategy = await getStrategyById(params.id as string);
      if (!strategy) throw new Error(`Strategy not found: ${params.id}`);
      await deleteStrategy(params.id as string);
      return { deleted: true };
    },

    async 'analyze.run'(params) {
      if (typeof params.task_id !== 'string') throw new Error('task_id is required and must be a string');
      if (typeof params.strategy !== 'string') throw new Error('strategy is required and must be a string');
      const taskId = params.task_id as string;
      const strategyId = params.strategy as string;
      const task = await getTaskById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      const strategy = await getStrategyById(strategyId);
      if (!strategy) throw new Error(`Strategy not found: ${strategyId}`);

      const targets = (await listTaskTargets(taskId)).filter(t => t.target_type === strategy.target);
      if (targets.length === 0) throw new Error('No matching targets for this strategy');

      const targetIds = targets.map(t => t.target_id);
      const existingIds = new Set(await getExistingResultIds(strategyId, taskId, strategy.target, targetIds));
      const newTargets = targets.filter(t => !existingIds.has(t.target_id));

      const jobs: QueueJob[] = [];
      for (const t of newTargets) {
        let status: 'pending' | 'waiting_media' = 'pending';
        if (strategy.needs_media?.enabled && strategy.target === 'post') {
          const postStatus = await getTaskPostStatus(taskId, t.target_id);
          if (!postStatus || !postStatus.media_fetched) {
            status = 'waiting_media';
          }
        }
        jobs.push({
          id: generateId(),
          task_id: taskId,
          strategy_id: strategyId,
          target_type: strategy.target,
          target_id: t.target_id,
          status,
          priority: 0,
          attempts: 0,
          max_attempts: 3,
          error: null,
          created_at: now(),
          processed_at: null,
        });
      }

      if (jobs.length > 0) {
        await enqueueJobs(jobs);
      }

      return { enqueued: jobs.length, skipped: targets.length - jobs.length };
    },

    async 'queue.retry'(params) {
      const taskId = (params.task_id as string | null) ?? undefined;
      const { retryFailedJobs } = await import('../db/queue-jobs');
      const retried = await retryFailedJobs(taskId);
      return { retried };
    },

    async 'queue.reset'(params) {
      const taskId = (params.task_id as string | null) ?? undefined;
      const { resetJobs } = await import('../db/queue-jobs');
      const reset = await resetJobs(taskId);
      return { reset };
    },

    async 'task.step.reset'(params) {
      const taskId = params.task_id as string;
      const stepId = params.step_id as string;
      const { getTaskStepById, updateTaskStepStatus } = await import('../db/task-steps');

      const step = await getTaskStepById(stepId);
      if (!step) throw new Error(`Step not found: ${stepId}`);
      if (step.task_id !== taskId) throw new Error('Step does not belong to this task');

      await updateTaskStepStatus(stepId, 'pending');

      if (step.strategy_id) {
        await run(
          `UPDATE queue_jobs SET status = 'pending', attempts = 0, error = null, processed_at = null WHERE task_id = ? AND strategy_id = ? AND status = 'failed'`,
          [taskId, step.strategy_id],
        );
      }

      return { reset: true };
    },

    async 'daemon.status'() {
      return {
        pid: process.pid,
        db_path: getDbPath(),
        queue_stats: await getQueueStats(),
      };
    },
  };
}

function readJsonLines<T>(filePath: string): T[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as T);
}

function exportToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    const values = headers.map(h => {
      const v = row[h];
      const str = v === null || v === undefined ? '' : String(v);
      if (str.includes(',') || str.includes('"')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    });
    lines.push(values.join(','));
  }
  return lines.join('\n') + '\n';
}

async function enqueueMediaJobsForTask(taskId: string): Promise<number> {
  const task = await getTaskById(taskId);
  if (!task?.template_id) return 0;

  const postTargets = await query<{ target_id: string }>(
    "SELECT target_id FROM task_targets WHERE task_id = ? AND target_type = 'post'",
    [taskId],
  );
  if (postTargets.length === 0) return 0;

  const postIds = postTargets.map(r => r.target_id);
  const placeholders = postIds.map(() => '?').join(',');
  const mediaFiles = await query<{ id: string; post_id: string }>(
    `SELECT id, post_id FROM media_files WHERE post_id IN (${placeholders})`,
    postIds,
  );
  if (mediaFiles.length === 0) return 0;

  const analyzedMediaIds = new Set(
    (await query<{ media_id: string }>(
      'SELECT DISTINCT media_id FROM analysis_results_media WHERE task_id = ?',
      [taskId],
    )).map(r => r.media_id),
  );

  const mediaToProcess = mediaFiles.filter(m => !analyzedMediaIds.has(m.id));
  if (mediaToProcess.length === 0) return 0;

  const mediaIds = mediaToProcess.map(m => m.id);
  const existingJobPlaceholders = mediaIds.map(() => '?').join(',');
  const existingJobs = await query<{ target_id: string }>(
    `SELECT target_id FROM queue_jobs WHERE task_id = ? AND target_type = 'media' AND target_id IN (${existingJobPlaceholders})`,
    [taskId, ...mediaIds],
  );
  const existingTargetIds = new Set(existingJobs.map(j => j.target_id));
  const newMediaJobs = mediaToProcess.filter(m => !existingTargetIds.has(m.id));

  if (newMediaJobs.length === 0) return 0;

  const jobs = newMediaJobs.map(m => ({
    id: generateId(),
    task_id: taskId,
    strategy_id: null as string | null,
    target_type: 'media' as const,
    target_id: m.id,
    status: 'pending' as const,
    priority: 0,
    attempts: 0,
    max_attempts: 3,
    error: null,
    created_at: now(),
    processed_at: null,
  }));

  await enqueueJobs(jobs);
  return jobs.length;
}

async function importCommentsToDb(
  data: unknown[],
  postId: string,
  platformId: string,
): Promise<number> {
  let count = 0;
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    try {
      await createComment({
        post_id: postId,
        platform_id: platformId,
        platform_comment_id: (obj.platform_comment_id ?? obj.id ?? null) as string | null,
        parent_comment_id: (obj.parent_comment_id ?? null) as string | null,
        root_comment_id: (obj.root_comment_id ?? null) as string | null,
        depth: Number(obj.depth ?? 0),
        author_id: (obj.author_id ?? null) as string | null,
        author_name: (obj.author_name ?? obj.author ?? null) as string | null,
        content: (obj.content ?? obj.text ?? '') as string,
        like_count: Number(obj.like_count ?? 0),
        reply_count: Number(obj.reply_count ?? 0),
        published_at: obj.published_at ? new Date(obj.published_at as string) : null,
        metadata: (obj.metadata ?? obj) as Record<string, unknown> | null,
      });
      count++;
    } catch (err: unknown) {
      if (!isDuplicateError(err)) {
        throw err;
      }
    }
  }
  return count;
}

async function importMediaToDb(
  data: unknown[],
  postId: string,
  platformId: string,
  noteId?: string,
): Promise<number> {
  const platform = platformId.includes('xhs') ? 'xhs' : platformId.split('_')[0];
  const downloadBase = noteId
    ? path.join(config.paths.download_dir, platform, noteId)
    : path.join(config.paths.download_dir, platform);

  let count = 0;
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    if (obj.status === 'failed') continue;

    const index = obj.index ?? count + 1;
    const mediaType = (obj.media_type ?? obj.type ?? 'image') as string;
    const ext = mediaType === 'video' ? 'mp4' : mediaType === 'audio' ? 'mp3' : 'jpg';
    const localPath = noteId ? `${downloadBase}/${noteId}_${index}.${ext}` : null;
    const url = (obj.url as string) || localPath || '';

    try {
      await createMediaFile({
        post_id: postId,
        comment_id: null,
        platform_id: platformId,
        media_type: mediaType as 'image' | 'video' | 'audio',
        url,
        local_path: localPath,
        width: obj.width ? Number(obj.width) : null,
        height: obj.height ? Number(obj.height) : null,
        duration_ms: obj.duration_ms ? Number(obj.duration_ms) : null,
        file_size: obj.file_size ? Number(obj.file_size) : null,
        downloaded_at: obj.status === 'success' ? now() : null,
      });
      count++;
    } catch (err: unknown) {
      if (!isDuplicateError(err)) {
        throw err;
      }
    }
  }
  return count;
}

async function createMediaQueueJobs(taskId: string, postId: string, mediaCount: number): Promise<void> {
  if (mediaCount === 0) return;
  const task = await getTaskById(taskId);
  if (!task?.template_id) return;
  const mediaFiles = await listMediaFilesByPost(postId);
  const recentCutoff = new Date(Date.now() - 60000);
  const recentMedia = mediaFiles.filter(m => new Date(m.created_at) >= recentCutoff);
  if (recentMedia.length === 0) return;

  const jobs = recentMedia.map(m => ({
    id: generateId(),
    task_id: taskId,
    strategy_id: null as string | null,
    target_type: 'media' as const,
    target_id: m.id,
    status: 'pending' as const,
    priority: 0,
    attempts: 0,
    max_attempts: 3,
    error: null,
    created_at: now(),
    processed_at: null,
  }));

  await enqueueJobs(jobs);
}

function isDuplicateError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate|unique|constraint/i.test(msg);
}

async function runPrepareDataAsync(
  taskId: string,
  cliTemplates: { fetch_note: string; fetch_comments?: string; fetch_media?: string },
): Promise<void> {
  const { listTaskTargets } = await import('../db/task-targets');
  const { getPostById } = await import('../db/posts');
  const postTargets = (await listTaskTargets(taskId)).filter(t => t.target_type === 'post');
  if (postTargets.length === 0) return;

  const postIds = postTargets.map(t => t.target_id);
  const firstPost = await getPostById(postIds[0]);
  if (!firstPost) return;
  const platformId = firstPost.platform_id;

  const pending = await getPendingPostIds(taskId);

  for (const item of pending) {
    const postId = item.post_id;
    const postMeta = await getPostById(postId);
    const noteId = (postMeta?.metadata as Record<string, unknown> | null)?.note_id as string | undefined
      ?? postMeta?.url
      ?? undefined;
    const fetchVars: Record<string, string> = {
      post_id: postId,
      note_id: noteId ?? postId,
      limit: '100',
      download_dir: config.paths.download_dir,
    };

    try {
      // Step 1: fetch_note — enrich post details (content, full stats, tags, etc.)
      {
        const noteResult = await fetchViaOpencli(cliTemplates.fetch_note, fetchVars);
        if (noteResult.success && noteResult.data && noteResult.data.length > 0) {
          const noteData = normalizeFieldValueArray(noteResult.data[0]) as RawPostItem;
          await run(
            `UPDATE posts SET
              title = COALESCE(?, title),
              content = COALESCE(?, content),
              author_id = COALESCE(?, author_id),
              author_name = COALESCE(?, author_name),
              author_url = COALESCE(?, author_url),
              cover_url = COALESCE(?, cover_url),
              post_type = COALESCE(?, post_type),
              like_count = COALESCE(?, like_count),
              collect_count = COALESCE(?, collect_count),
              comment_count = COALESCE(?, comment_count),
              share_count = COALESCE(?, share_count),
              play_count = COALESCE(?, play_count),
              tags = COALESCE(?, tags),
              media_files = COALESCE(?, media_files),
              published_at = COALESCE(?, published_at),
              metadata = COALESCE(?, metadata),
              fetched_at = ?
            WHERE id = ?`,
            [
              noteData.title ?? null,
              noteData.content ?? noteData.text ?? noteData.desc ?? null,
              noteData.author_id ?? null,
              noteData.author_name ?? noteData.author ?? null,
              noteData.author_url ?? null,
              noteData.cover_url ?? null,
              (noteData.post_type ?? noteData.type ?? null) as any,
              noteData.like_count != null ? Number(noteData.like_count) : null,
              noteData.collect_count != null ? Number(noteData.collect_count) : null,
              noteData.comment_count != null ? Number(noteData.comment_count) : null,
              noteData.share_count != null ? Number(noteData.share_count) : null,
              noteData.play_count != null ? Number(noteData.play_count) : null,
              noteData.tags ? JSON.stringify(noteData.tags) : null,
              noteData.media_files ? JSON.stringify(noteData.media_files) : null,
              noteData.published_at ? new Date(noteData.published_at) : null,
              noteData.metadata ? JSON.stringify(noteData.metadata) : null,
              now(),
              postId,
            ],
          );
        }
      }

      // Step 2: fetch_comments
      if (!item.comments_fetched && cliTemplates.fetch_comments) {
        await upsertTaskPostStatus(taskId, postId, { status: 'fetching' });
        const result = await fetchViaOpencli(cliTemplates.fetch_comments, fetchVars);
        if (!result.success) {
          await upsertTaskPostStatus(taskId, postId, { status: 'failed', error: result.error ?? 'unknown' });
          continue;
        }
        const commentCount = await importCommentsToDb(result.data ?? [], postId, platformId);
        await upsertTaskPostStatus(taskId, postId, { comments_fetched: true, comments_count: commentCount });
      }

      // Step 3: fetch_media
      if (!item.media_fetched && cliTemplates.fetch_media) {
        const result = await fetchViaOpencli(cliTemplates.fetch_media, fetchVars);
        if (!result.success) {
          await upsertTaskPostStatus(taskId, postId, { status: 'failed', error: result.error ?? 'unknown' });
          continue;
        }
        const mediaCount = await importMediaToDb(result.data ?? [], postId, platformId, noteId);
        await upsertTaskPostStatus(taskId, postId, { media_fetched: true, media_count: mediaCount });
        await createMediaQueueJobs(taskId, postId, mediaCount);
        await syncWaitingMediaJobs(taskId, postId);
      }

      await upsertTaskPostStatus(taskId, postId, { status: 'done' });
    } catch (err: unknown) {
      await upsertTaskPostStatus(taskId, postId, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
    }
  }

  await updateTaskStatus(taskId, 'pending');
}
