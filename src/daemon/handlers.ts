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
import { getDbPath, query } from '../db/client';
import { generateId, now, parseImportFile } from '../shared/utils';
import { fetchViaOpencli } from '../data-fetcher/opencli';
import { createStrategy, getStrategyById, listStrategies, validateStrategyJson, updateStrategy, parseJsonSchemaToColumns, createStrategyResultTable, syncStrategyResultTable } from '../db/strategies';
import { getExistingResultIds } from '../db/analysis-results';
import { getTaskPostStatus } from '../db/task-post-status';
import type { QueueJob } from '../shared/types';

type Handler = (params: Record<string, unknown>) => Promise<unknown>;

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
      let items: RawPostItem[];
      try {
        items = parseImportFile(file) as RawPostItem[];
      } catch (err: unknown) {
        throw new Error(`Failed to parse import file: ${err instanceof Error ? err.message : String(err)}`);
      }
      let imported = 0;
      let skipped = 0;
      const postIds: string[] = [];
      for (const item of items) {
        try {
          const post = await createPost({
            platform_id: platformId,
            platform_post_id: item.platform_post_id ?? item.noteId ?? item.id ?? generateId(),
            title: item.title ?? null,
            content: item.content ?? item.text ?? item.desc ?? '',
            author_id: item.author_id ?? null,
            author_name: item.author_name ?? item.author ?? null,
            author_url: item.author_url ?? null,
            url: item.url ?? null,
            cover_url: item.cover_url ?? null,
            post_type: (item.post_type ?? item.type ?? null) as 'text' | 'image' | 'video' | 'audio' | 'article' | 'carousel' | 'mixed' | null,
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
          imported++;
          postIds.push(post.id);
        } catch {
          skipped++;
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
      const id = generateId();
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

      // Skip already-analyzed comment targets
      const analyzedCommentIds = new Set(
        (await query<{ comment_id: string }>(
          'SELECT DISTINCT comment_id FROM analysis_results_comments WHERE task_id = ?',
          [taskId],
        )).map(r => r.comment_id),
      );
      const targetsToProcess = stats.pending.filter(t => {
        if (t.target_type === 'comment' && analyzedCommentIds.has(t.target_id)) return false;
        return true;
      });

      let totalEnqueued = 0;
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
      const mediaJobsCreated = await enqueueMediaJobsForTask(taskId);
      totalEnqueued += mediaJobsCreated;

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

    async 'task.status'(params) {
      const taskId = params.task_id as string;
      const task = await getTaskById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      const stats = await getTargetStats(taskId);
      return { ...task, ...stats };
    },

    async 'task.list'(params) {
      return listTasks(params.status as string | undefined);
    },

    async 'task.prepareData'(params) {
      const taskId = params.task_id as string;
      const task = await getTaskById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      if (!task.cli_templates) throw new Error('Task has no CLI templates');

      let cliTemplates: { fetch_comments?: string; fetch_media?: string };
      try {
        cliTemplates = JSON.parse(task.cli_templates);
      } catch {
        throw new Error('Invalid cli_templates JSON in task');
      }

      const hasNotePlaceholder = (tpl: string) => tpl.includes('{post_id}') || tpl.includes('{note_id}');
      if (cliTemplates.fetch_comments && !hasNotePlaceholder(cliTemplates.fetch_comments)) {
        throw new Error('fetch_comments template must contain {post_id} or {note_id} placeholder');
      }
      if (cliTemplates.fetch_media && !hasNotePlaceholder(cliTemplates.fetch_media)) {
        throw new Error('fetch_media template must contain {post_id} or {note_id} placeholder');
      }

      const { listTaskTargets } = await import('../db/task-targets');
      const { getPostById } = await import('../db/posts');
      const postTargets = (await listTaskTargets(taskId)).filter(t => t.target_type === 'post');
      if (postTargets.length === 0) throw new Error('No posts bound to this task');

      const postIds = postTargets.map(t => t.target_id);
      const firstPost = await getPostById(postIds[0]);
      if (!firstPost) throw new Error(`Post not found: ${postIds[0]}`);
      const platformId = firstPost.platform_id;

      for (const postId of postIds) {
        await upsertTaskPostStatus(taskId, postId, { status: 'pending' });
      }

      const pending = await getPendingPostIds(taskId);
      let successCount = 0;
      let failCount = 0;

      for (const item of pending) {
        const postId = item.post_id;
        const postMeta = await getPostById(postId);
        const noteId = (postMeta?.metadata as Record<string, unknown> | null)?.note_id as string | undefined;
        const fetchVars: Record<string, string> = {
          post_id: postId,
          note_id: noteId ?? postId,
          limit: '100',
        };

        if (!item.comments_fetched && cliTemplates.fetch_comments) {
          await upsertTaskPostStatus(taskId, postId, { status: 'fetching' });
          const result = await fetchViaOpencli(cliTemplates.fetch_comments, fetchVars);
          if (!result.success) {
            await upsertTaskPostStatus(taskId, postId, { status: 'failed', error: result.error ?? 'unknown' });
            failCount++;
            continue;
          }
          const commentCount = await importCommentsToDb(result.data ?? [], postId, platformId);
          await upsertTaskPostStatus(taskId, postId, { comments_fetched: true, comments_count: commentCount });
        }

        if (!item.media_fetched && cliTemplates.fetch_media) {
          const result = await fetchViaOpencli(cliTemplates.fetch_media, fetchVars);
          if (!result.success) {
            await upsertTaskPostStatus(taskId, postId, { status: 'failed', error: result.error ?? 'unknown' });
            failCount++;
            continue;
          }
          const mediaCount = await importMediaToDb(result.data ?? [], postId, platformId, noteId);
          await upsertTaskPostStatus(taskId, postId, { media_fetched: true, media_count: mediaCount });
          await createMediaQueueJobs(taskId, postId, mediaCount);
          await syncWaitingMediaJobs(taskId, postId);
        }

        await upsertTaskPostStatus(taskId, postId, { status: 'done' });
        successCount++;
      }

      await updateTaskStatus(taskId, 'pending');
      return { success: successCount, failed: failCount, skipped: postIds.length - pending.length };
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
      if (typeof params.file !== 'string') throw new Error('file is required and must be a string');
      const filePath = params.file as string;
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
      const content = fs.readFileSync(filePath, 'utf-8');
      let data: unknown;
      try {
        data = JSON.parse(content);
      } catch {
        throw new Error('Invalid JSON file');
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
        file_path: filePath,
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
  const downloadBase = `downloads/${platform}${noteId ? `/${noteId}` : ''}`;

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
