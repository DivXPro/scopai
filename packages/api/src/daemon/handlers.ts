import * as fs from 'fs';
import * as path from 'path';
import { createPost, getPostById, updatePost, listPosts, searchPosts } from '@scopai/core';
import { createComment, listCommentsByPost } from '@scopai/core';
import { createTask, getTaskById, listTasks, updateTaskStatus, updateTaskStats } from '@scopai/core';
import { addTaskTargets, getTargetStats, listTaskTargets } from '@scopai/core';
import { upsertTaskPostStatus, getPendingPostIds } from '@scopai/core';
import { createMediaFile, listMediaFilesByPost } from '@scopai/core';
import { createPlatform, listPlatforms } from '@scopai/core';
import { createFieldMapping, listFieldMappings } from '@scopai/core';
import { createTemplate, listTemplates, getTemplateById, updateTemplate, setDefaultTemplate } from '@scopai/core';
import { enqueueJobs, getQueueStats, syncWaitingMediaJobs } from '@scopai/core';
import { getDbPath, query, run, checkpoint } from '@scopai/core';
import { getLogger } from '@scopai/core';
import { generateId, now, parseImportFile } from '@scopai/core';
import { fetchViaOpencli } from '@scopai/core';
import { createStrategy, getStrategyById, listStrategies, validateStrategyJson, updateStrategy, deleteStrategy, parseJsonSchemaToColumns, createStrategyResultTable, syncStrategyResultTable } from '@scopai/core';
import { getExistingResultIds } from '@scopai/core';
import { getTaskPostStatus } from '@scopai/core';
import { config } from '@scopai/core';
import { normalizePostItem, normalizeCommentItem } from '@scopai/core';
import type { QueueJob } from '@scopai/core';

// Track in-flight prepare-data tasks to prevent concurrent execution
type Handler = (params: Record<string, unknown>) => Promise<unknown>;

// Prevent concurrent prepare-data for the same task
const prepareDataRunning = new Set<string>();

export function getHandlers(): Record<string, Handler> {
  return {
    async 'post.import'(params) {
      const platformId = params.platform as string;
      const file = params.file as string;
      const taskId = (params.task_id as string | undefined) ?? undefined;
      let rawItems: unknown[];
      try {
        rawItems = parseImportFile(file);
      } catch (err: unknown) {
        throw new Error(`Failed to parse import file: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Support opencli xiaohongshu note field-value array format: [{field, value}, ...]
      const items = rawItems.map((raw) => normalizePostItem(raw));

      let imported = 0;
      let skipped = 0;
      const postIds: string[] = [];

      for (const item of items) {
        const platformPostId = item.platform_post_id ?? generateId();
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
                item.title,
                item.content,
                item.author_id,
                item.author_name,
                item.author_url,
                item.url,
                item.cover_url,
                item.post_type as any,
                item.like_count,
                item.collect_count,
                item.comment_count,
                item.share_count,
                item.play_count,
                item.score,
                item.tags ? JSON.stringify(item.tags) : null,
                item.media_files ? JSON.stringify(item.media_files) : null,
                item.published_at,
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
              title: item.title,
              content: item.content,
              author_id: item.author_id,
              author_name: item.author_name,
              author_url: item.author_url,
              url: item.url,
              cover_url: item.cover_url,
              post_type: item.post_type as any,
              like_count: item.like_count,
              collect_count: item.collect_count,
              comment_count: item.comment_count,
              share_count: item.share_count,
              play_count: item.play_count,
              score: item.score,
              tags: item.tags as { name: string; url?: string }[] | null,
              media_files: item.media_files as { type: 'image' | 'video' | 'audio'; url: string; local_path?: string }[] | null,
              published_at: item.published_at,
              metadata: item.metadata,
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
        const { addTaskTargets } = await import('@scopai/core');
        const { upsertTaskPostStatus } = await import('@scopai/core');
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
      let rawItems: unknown[];
      try {
        rawItems = parseImportFile(file);
      } catch (err: unknown) {
        throw new Error(`Failed to parse import file: ${err instanceof Error ? err.message : String(err)}`);
      }
      let imported = 0;
      let skipped = 0;
      for (const rawItem of rawItems) {
        try {
          const item = normalizeCommentItem(rawItem);
          await createComment({
            post_id: postId,
            platform_id: platformId,
            platform_comment_id: item.platform_comment_id,
            parent_comment_id: item.parent_comment_id,
            root_comment_id: item.root_comment_id,
            depth: item.depth,
            author_id: item.author_id,
            author_name: item.author_name,
            content: item.content,
            like_count: item.like_count,
            reply_count: item.reply_count,
            published_at: item.published_at,
            metadata: item.metadata,
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

      if (targetType === 'post') {
        // Convert platform_post_ids to internal post IDs
        const { query } = await import('@scopai/core');
        const internalIds: string[] = [];
        for (const platformPostId of targetIds) {
          const rows = await query<{ id: string }>(
            'SELECT id FROM posts WHERE platform_post_id = ?',
            [platformPostId],
          );
          if (rows.length > 0) {
            internalIds.push(rows[0].id);
          } else {
            // Fallback: assume it's already an internal ID
            internalIds.push(platformPostId);
          }
        }
        await addTaskTargets(taskId, targetType, internalIds);
        const { upsertTaskPostStatus } = await import('@scopai/core');
        for (const postId of internalIds) {
          await upsertTaskPostStatus(taskId, postId, { status: 'pending' });
        }
      } else {
        await addTaskTargets(taskId, targetType, targetIds);
      }
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
      const { listAnalysisResults } = await import('@scopai/core');
      return listAnalysisResults(taskId);
    },

    async 'task.show'(params) {
      const taskId = params.task_id as string;
      const task = await getTaskById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);

      const stats = await getTargetStats(taskId);
      const { getTaskPostStatuses } = await import('@scopai/core');
      const { listTaskSteps } = await import('@scopai/core');
      const { listJobsByTask } = await import('@scopai/core');

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
      } else if (postStatuses.some(p => p.status === 'pending')) {
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

      // Get recent failures for quick debugging
      const recentErrors = jobs
        .filter(j => j.status === 'failed' && j.error)
        .slice(0, 3)
        .map(j => ({
          target_type: j.target_type ?? 'unknown',
          target_id: j.target_id ?? '',
          error: j.error ?? '',
        }));

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
        recentErrors,
      };
    },

    async 'task.step.add'(params) {
      const taskId = params.task_id as string;
      const strategyId = params.strategy_id as string;
      const name = (params.name as string | undefined) ?? strategyId;
      const dependsOnStepId = params.depends_on_step_id as string | undefined;
      const { createTaskStep, getNextStepOrder, getTaskStepById } = await import('@scopai/core');
      const { getStrategyById } = await import('@scopai/core');

      const strategy = await getStrategyById(strategyId);
      if (!strategy) throw new Error(`Strategy not found: ${strategyId}`);

      // Validate dependency
      if (strategy.depends_on) {
        if (!dependsOnStepId) {
          throw new Error(`Strategy "${strategy.name}" requires depends_on_step_id (it depends on upstream results)`);
        }
        const upstreamStep = await getTaskStepById(dependsOnStepId);
        if (!upstreamStep) throw new Error(`Upstream step not found: ${dependsOnStepId}`);
        if (upstreamStep.task_id !== taskId) throw new Error('Upstream step does not belong to this task');
        if (!upstreamStep.strategy_id) throw new Error('Upstream step has no strategy');

        const upstreamStrategy = await getStrategyById(upstreamStep.strategy_id);
        if (!upstreamStrategy) throw new Error(`Upstream strategy not found: ${upstreamStep.strategy_id}`);
        if (upstreamStrategy.target !== strategy.depends_on) {
          throw new Error(`Strategy depends_on="${strategy.depends_on}" but upstream strategy target="${upstreamStrategy.target}"`);
        }
      }

      const stepOrder = (params.order as number | undefined) ?? await getNextStepOrder(taskId);
      const step = await createTaskStep({
        task_id: taskId,
        strategy_id: strategyId,
        depends_on_step_id: dependsOnStepId ?? null,
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
      const { listTaskSteps } = await import('@scopai/core');
      return listTaskSteps(taskId);
    },

    async 'task.step.run'(params) {
      const taskId = params.task_id as string;
      const stepId = params.step_id as string;
      const { getTaskStepById, updateTaskStepStatus } = await import('@scopai/core');
      const { listTaskTargets } = await import('@scopai/core');
      const { getStrategyById } = await import('@scopai/core');
      const { enqueueJobs } = await import('@scopai/core');
      const { generateId } = await import('@scopai/core');

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

      // Filter out targets already enqueued for this step by the stream scheduler
      const { getExistingJobTargets } = await import('@scopai/core');
      const existingTargets = await getExistingJobTargets(taskId, strategy.id);
      const newTargets = relevantTargets.filter(t => !existingTargets.has(t.target_id));

      if (newTargets.length === 0) {
        // All targets already enqueued; ensure step is marked running
        if (step.status === 'pending') {
          await updateTaskStepStatus(stepId, 'running', { total: existingTargets.size, done: 0, failed: 0 });
        }
        return { status: 'running', enqueued: 0 };
      }

      const jobs = newTargets.map(t => ({
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
      await updateTaskStepStatus(stepId, 'running', { total: newTargets.length, done: 0, failed: 0 });

      return { status: 'running', enqueued: jobs.length };
    },

    async 'task.runAllSteps'(params) {
      const taskId = params.task_id as string;
      const { listTaskSteps, updateTaskStepStatus } = await import('@scopai/core');
      const steps = await listTaskSteps(taskId);

      // Topological sort: steps with dependencies come after their upstream
      const stepMap = new Map(steps.map(s => [s.id, s]));
      const sorted = [...steps].sort((a, b) => {
        if (a.depends_on_step_id === b.id) return 1;
        if (b.depends_on_step_id === a.id) return -1;
        return a.step_order - b.step_order;
      });

      const pendingSteps = sorted.filter(s => s.status === 'pending' || s.status === 'failed');

      let completed = 0;
      let failed = 0;
      let skipped = 0;

      for (const step of pendingSteps) {
        if (step.depends_on_step_id) {
          const upstreamStep = stepMap.get(step.depends_on_step_id);
          if (upstreamStep && upstreamStep.status !== 'completed') {
            continue;
          }
        }

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
      return listTasks(params.status as string | undefined, params.query as string | undefined);
    },

    async 'task.prepareData'(params) {
      const taskId = params.task_id as string;
      const task = await getTaskById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      if (!task.cli_templates) throw new Error('Task has no CLI templates');

      if (prepareDataRunning.has(taskId)) {
        return { started: false, reason: 'Data preparation already in progress for this task' };
      }

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

      const hasNotePlaceholder = (tpl: string) => tpl.includes('{post_id}') || tpl.includes('{note_id}') || tpl.includes('{url}');
      if (!hasNotePlaceholder(cliTemplates.fetch_note)) {
        throw new Error('fetch_note template must contain {post_id} or {note_id} placeholder');
      }
      if (cliTemplates.fetch_comments && !hasNotePlaceholder(cliTemplates.fetch_comments)) {
        throw new Error('fetch_comments template must contain {post_id} or {note_id} placeholder');
      }
      if (cliTemplates.fetch_media && !hasNotePlaceholder(cliTemplates.fetch_media)) {
        throw new Error('fetch_media template must contain {post_id} or {note_id} placeholder');
      }

      prepareDataRunning.add(taskId);
      // Run data preparation asynchronously so the CLI can poll status
      runPrepareDataAsync(taskId, cliTemplates).finally(() => {
        prepareDataRunning.delete(taskId);
      }).catch(() => {});
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
      const { getTemplateByName } = await import('@scopai/core');
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
      const { listStrategyResultsByTask } = await import('@scopai/core');
      return listStrategyResultsByTask(params.strategy_id as string, params.task_id as string, Number(params.limit ?? 100));
    },

    async 'strategy.result.stats'(params) {
      if (typeof params.task_id !== 'string') throw new Error('task_id is required');
      if (typeof params.strategy_id !== 'string') throw new Error('strategy_id is required');
      const { getStrategyResultStats } = await import('@scopai/core');
      return getStrategyResultStats(params.strategy_id as string, params.task_id as string);
    },

    async 'strategy.result.export'(params) {
      if (typeof params.task_id !== 'string') throw new Error('task_id is required');
      if (typeof params.strategy_id !== 'string') throw new Error('strategy_id is required');
      const { listStrategyResultsByTask } = await import('@scopai/core');
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

    async 'strategy.result.aggregate'(params) {
      if (typeof params.task_id !== 'string') throw new Error('task_id is required');
      if (typeof params.strategy_id !== 'string') throw new Error('strategy_id is required');
      if (typeof params.field !== 'string') throw new Error('field is required');
      const { runAggregate, runMultiAggregate } = await import('@scopai/core');
      const aggFn = (params.agg as 'count' | 'sum' | 'avg' | 'min' | 'max') ?? 'count';
      const limit = typeof params.limit === 'number' ? params.limit : parseInt(params.limit as string, 10) || 50;

      // Multi-field: comma-separated fields → combination aggregation
      if (params.field.includes(',')) {
        const fields = params.field.split(',').map(f => f.trim());
        return runMultiAggregate(params.strategy_id as string, params.task_id as string, {
          fields,
          aggFn,
          jsonKey: params.json_key as string | undefined,
          having: params.having as string | undefined,
          limit,
        });
      }

      // Single field → original behavior
      return runAggregate(params.strategy_id as string, params.task_id as string, {
        field: params.field as string,
        aggFn,
        jsonKey: params.json_key as string | undefined,
        having: params.having as string | undefined,
        limit,
      });
    },

    async 'strategy.result.fullStats'(params) {
      if (typeof params.task_id !== 'string') throw new Error('task_id is required');
      if (typeof params.strategy_id !== 'string') throw new Error('strategy_id is required');
      const { getFullStats } = await import('@scopai/core');
      return getFullStats(params.strategy_id as string, params.task_id as string);
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
        batch_config: (obj.batch_config ?? null) as any,
        depends_on: (obj.depends_on ?? null) as 'post' | 'comment' | null,
        include_original: (obj.include_original ?? false) as boolean,
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
      const { retryFailedJobs } = await import('@scopai/core');
      const retried = await retryFailedJobs(taskId);
      return { retried };
    },

    async 'queue.reset'(params) {
      const taskId = (params.task_id as string | null) ?? undefined;
      const { resetJobs } = await import('@scopai/core');
      const reset = await resetJobs(taskId);
      return { reset };
    },

    async 'queue.list'(params) {
      const taskId = params.task_id as string;
      const failedOnly = (params.failed_only as boolean) ?? false;
      const limit = Number(params.limit ?? 20);

      let sql = `SELECT id, target_id, target_type, status, attempts, error
                 FROM queue_jobs WHERE task_id = ?`;
      const args: unknown[] = [taskId];

      if (failedOnly) {
        sql += ` AND status = 'failed'`;
      }
      sql += ` ORDER BY created_at DESC LIMIT ?`;
      args.push(limit);

      const rows = await query<{
        id: string;
        target_id: string;
        target_type: string;
        status: string;
        attempts: number;
        error: string | null;
      }>(sql, args);

      return rows.map(r => ({
        id: r.id,
        target_id: r.target_id,
        target_type: r.target_type,
        status: r.status,
        attempts: r.attempts,
        error: r.error,
      }));
    },

    async 'task.step.reset'(params) {
      const taskId = params.task_id as string;
      const stepId = params.step_id as string;
      const { getTaskStepById, updateTaskStepStatus } = await import('@scopai/core');

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
  for (const rawItem of data) {
    try {
      const item = normalizeCommentItem(rawItem);
      await createComment({
        post_id: postId,
        platform_id: platformId,
        platform_comment_id: item.platform_comment_id,
        parent_comment_id: item.parent_comment_id,
        root_comment_id: item.root_comment_id,
        depth: item.depth,
        author_id: item.author_id,
        author_name: item.author_name,
        content: item.content,
        like_count: item.like_count,
        reply_count: item.reply_count,
        published_at: item.published_at,
        metadata: item.metadata,
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
    const localPath = (obj.local_path as string) ?? (obj.path as string) ?? (noteId ? `${downloadBase}/${noteId}_${index}.${ext}` : null);
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

function getDefaultFetchMediaTemplate(platformId: string): string | null {
  const pid = platformId.toLowerCase();
  if (pid.includes('xhs') || pid.includes('xiaohongshu')) {
    return 'opencli xiaohongshu download {url} --output {download_dir}/{platform} -f json';
  }
  if (pid.includes('dy') || pid.includes('douyin')) {
    return 'opencli douyin download {url} --output {download_dir}/{platform} -f json';
  }
  if (pid.includes('bili')) {
    return 'opencli bilibili download {url} --output {download_dir}/{platform} -f json';
  }
  return null;
}

async function runPrepareDataAsync(
  taskId: string,
  cliTemplates: { fetch_note: string; fetch_comments?: string; fetch_media?: string },
): Promise<void> {
  const logger = getLogger();
  logger.info(`[prepare-data] Starting for task ${taskId}`);
  const { listTaskTargets } = await import('@scopai/core');
  const { getPostById } = await import('@scopai/core');
  const postTargets = (await listTaskTargets(taskId)).filter(t => t.target_type === 'post');
  logger.info(`[prepare-data] Task ${taskId}: ${postTargets.length} post targets`);
  if (postTargets.length === 0) return;

  const postIds = postTargets.map(t => t.target_id);
  const firstPost = await getPostById(postIds[0]);
  if (!firstPost) return;
  const platformId = firstPost.platform_id;

  const pending = await getPendingPostIds(taskId);
  logger.info(`[prepare-data] Task ${taskId}: ${pending.length} pending posts`);

  let processedCount = 0;
  for (const item of pending) {
    const postId = item.post_id;
    logger.info(`[prepare-data] Task ${taskId}: processing post ${postId}`);

    try {
      const postMeta = await getPostById(postId);
      // metadata may be stored as a JSON string in DuckDB — parse it if needed
      let metadataObj: Record<string, unknown> | null = null;
      if (postMeta?.metadata) {
        if (typeof postMeta.metadata === 'string') {
          try { metadataObj = JSON.parse(postMeta.metadata); } catch { /* ignore */ }
        } else if (typeof postMeta.metadata === 'object' && postMeta.metadata !== null) {
          metadataObj = postMeta.metadata as Record<string, unknown>;
        }
      }
      const noteId = (metadataObj?.note_id as string | undefined) ?? postMeta?.platform_post_id ?? undefined;
      const postUrl = postMeta?.url ?? undefined;
      const platformDir = platformId.includes('xhs') ? 'xhs' : platformId.includes('dy') ? 'douyin' : platformId.includes('bili') ? 'bilibili' : platformId.split('_')[0];
      const fetchVars: Record<string, string> = {
        post_id: postId,
        note_id: noteId ?? postUrl ?? postId,
        url: postUrl ?? noteId ?? postId,
        limit: '100',
        platform: platformDir,
        download_dir: config.paths.download_dir,
      };
      logger.info(`[prepare-data] Task ${taskId} post ${postId}: fetchVars note_id=${fetchVars.note_id}, url=${fetchVars.url}`);

      // Step 1: fetch_note — enrich post details (content, full stats, tags, etc.)
      try {
        logger.info(`[prepare-data] Task ${taskId} post ${postId}: Step 1 fetch_note with template "${cliTemplates.fetch_note}"`);
        const noteResult = await fetchViaOpencli(cliTemplates.fetch_note, fetchVars);
        logger.info(`[prepare-data] Task ${taskId} post ${postId}: fetch_note result success=${noteResult.success}`);
        if (!noteResult.success) {
          logger.error(`[prepare-data] fetch_note failed for post ${postId}: ${noteResult.error ?? 'unknown'}`);
          await upsertTaskPostStatus(taskId, postId, { status: 'failed', error: noteResult.error ?? 'fetch_note failed' });
          continue;
        }
        if (noteResult.data && noteResult.data.length > 0) {
          const noteData = normalizePostItem(noteResult.data);
          const existingPost = await getPostById(postId);
          const updates: Parameters<typeof updatePost>[1] = {};
          if (existingPost) {
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
          }
          await updatePost(postId, updates);
          logger.info(`[prepare-data] Task ${taskId} post ${postId}: post updated from fetch_note`);
        }
      } catch (err) {
        logger.error(`[prepare-data] fetch_note failed for post ${postId}: ${err instanceof Error ? err.message : String(err)}`);
        await upsertTaskPostStatus(taskId, postId, { status: 'failed', error: `fetch_note: ${err}` });
        continue;
      }

      // Step 2: fetch_comments
      if (cliTemplates.fetch_comments) {
        if (!item.comments_fetched) {
          logger.info(`[prepare-data] Task ${taskId} post ${postId}: Step 2 fetch_comments`);
          await upsertTaskPostStatus(taskId, postId, { status: 'fetching' });
          const result = await fetchViaOpencli(cliTemplates.fetch_comments, fetchVars);
          logger.info(`[prepare-data] Task ${taskId} post ${postId}: fetch_comments result success=${result.success}`);
          if (!result.success) {
            logger.error(`[prepare-data] fetch_comments failed for post ${postId}: ${result.error ?? 'unknown'}`);
            await upsertTaskPostStatus(taskId, postId, { error: result.error ?? 'fetch_comments failed' });
          } else {
            const commentCount = await importCommentsToDb(result.data ?? [], postId, platformId);
            logger.info(`[prepare-data] Task ${taskId} post ${postId}: imported ${commentCount} comments`);
            await upsertTaskPostStatus(taskId, postId, { comments_fetched: true, comments_count: commentCount });
          }
        }
      } else {
        // No fetch_comments template configured — mark as done for this step
        logger.info(`[prepare-data] Task ${taskId} post ${postId}: Step 2 skip (no template)`);
        await upsertTaskPostStatus(taskId, postId, { comments_fetched: true });
      }

      // Step 3: fetch_media
      const fetchMediaTemplate = cliTemplates.fetch_media ?? getDefaultFetchMediaTemplate(platformId);
      if (fetchMediaTemplate) {
        if (!item.media_fetched) {
          logger.info(`[prepare-data] Task ${taskId} post ${postId}: Step 3 fetch_media (template: ${fetchMediaTemplate})`);
          const result = await fetchViaOpencli(fetchMediaTemplate, fetchVars);
          logger.info(`[prepare-data] Task ${taskId} post ${postId}: fetch_media result success=${result.success}`);
          if (!result.success) {
            logger.error(`[prepare-data] fetch_media failed for post ${postId}: ${result.error ?? 'unknown'}`);
            await upsertTaskPostStatus(taskId, postId, { error: result.error ?? 'fetch_media failed' });
          } else {
            const mediaCount = await importMediaToDb(result.data ?? [], postId, platformId, noteId);
            logger.info(`[prepare-data] Task ${taskId} post ${postId}: imported ${mediaCount} media files`);
            await upsertTaskPostStatus(taskId, postId, { media_fetched: true, media_count: mediaCount });
            await createMediaQueueJobs(taskId, postId, mediaCount);
            await syncWaitingMediaJobs(taskId, postId);
          }
        }
      } else {
        // No fetch_media template configured and no default available — mark as done for this step
        logger.info(`[prepare-data] Task ${taskId} post ${postId}: Step 3 skip (no template and no default for platform ${platformId})`);
        await upsertTaskPostStatus(taskId, postId, { media_fetched: true });
      }

      logger.info(`[prepare-data] Task ${taskId} post ${postId}: marking status=done`);
      await upsertTaskPostStatus(taskId, postId, { status: 'done' });

      // Trigger streaming analysis for this post
      try {
        const { buildJobsForPost } = await import('./scheduler');
        const { enqueueJobs } = await import('@scopai/core');
        const { listTaskSteps } = await import('@scopai/core');
        const { getStrategyById } = await import('@scopai/core');
        const { listTaskTargets } = await import('@scopai/core');
        const { getExistingJobTargets } = await import('@scopai/core');
        const { query } = await import('@scopai/core');
        const { generateId: genId } = await import('@scopai/core');

        const steps = await listTaskSteps(taskId);
        const strategies = new Map();
        for (const step of steps) {
          if (step.strategy_id && !strategies.has(step.strategy_id)) {
            const strategy = await getStrategyById(step.strategy_id);
            if (strategy) strategies.set(step.strategy_id, strategy);
          }
        }
        let taskTargets = await listTaskTargets(taskId);
        const mediaStatus = await query<{ media_fetched: boolean }>(
          `SELECT media_fetched FROM task_post_status WHERE task_id = ? AND post_id = ?`,
          [taskId, postId]
        );
        const mediaReady = mediaStatus[0]?.media_fetched === true;
        const comments = await query<{ id: string }>(
          `SELECT id FROM comments WHERE post_id = ?`,
          [postId]
        );

        // Ensure comments are task targets for comment-level strategies
        const hasCommentStrategy = Array.from(strategies.values()).some((s: any) => s.target === 'comment');
        if (hasCommentStrategy && comments.length > 0) {
          const { createTaskTarget } = await import('@scopai/core');
          const existingIds = new Set(taskTargets.map(t => t.target_id));
          for (const c of comments) {
            if (!existingIds.has(c.id)) {
              await createTaskTarget(taskId, 'comment', c.id);
              existingIds.add(c.id);
            }
          }
          taskTargets = await listTaskTargets(taskId);
        }

        const { jobs, stepUpdates } = buildJobsForPost(
          taskId,
          postId,
          steps,
          strategies,
          taskTargets,
          await getExistingJobTargets(taskId, strategies.keys().next().value ?? ''),
          comments,
          mediaReady,
          genId,
        );

        if (jobs.length > 0) {
          await enqueueJobs(jobs);
          for (const update of stepUpdates) {
            await (await import('@scopai/core')).updateTaskStepStatus(update.stepId, update.status, update.stats);
          }
          logger.info(`[stream-scheduler] Post ${postId}: enqueued ${jobs.length} jobs`);
        }
      } catch (schedErr: unknown) {
        const msg = schedErr instanceof Error ? schedErr.message : String(schedErr);
        logger.error(`[stream-scheduler] Failed to enqueue for post ${postId}: ${msg}`);
        // Non-fatal: data preparation continues regardless
      }
    } catch (err: unknown) {
      await upsertTaskPostStatus(taskId, postId, { status: 'failed', error: err instanceof Error ? err.message : String(err) });
    }

    processedCount++;
    if (processedCount % 5 === 0) {
      try { await checkpoint(); } catch (e) { logger.warn(`[prepare-data] checkpoint failed: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }

  try { await checkpoint(); } catch (e) { logger.warn(`[prepare-data] final checkpoint failed: ${e instanceof Error ? e.message : String(e)}`); }
  logger.info(`[prepare-data] Task ${taskId}: all ${pending.length} pending posts processed`);
  // All posts processed; task remains in its current state.
  // Steps transition to completed via worker job completion.
  // (Previously: await updateTaskStatus(taskId, 'pending');)
}
