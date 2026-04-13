import * as fs from 'fs';
import { createPost, listPosts, searchPosts } from '../db/posts';
import { createComment, listCommentsByPost } from '../db/comments';
import { createTask, getTaskById, listTasks, updateTaskStatus, updateTaskStats } from '../db/tasks';
import { addTaskTargets, getTargetStats } from '../db/task-targets';
import { listPlatforms } from '../db/platforms';
import { listFieldMappings } from '../db/field-mappings';
import { listTemplates } from '../db/templates';
import { listResultsByTask, aggregateStats } from '../db/analysis-results';
import { enqueueJobs } from '../db/queue-jobs';
import { getDbPath } from '../db/client';
import { BreeDuckDBAdapter } from './bree-adapter';
import { generateId, now } from '../shared/utils';

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
      const items = readJsonLines<RawPostItem>(file);
      let imported = 0;
      for (const item of items) {
        try {
          await createPost({
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
        } catch {
          // ignore duplicate
        }
      }
      return { imported };
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
      const items = readJsonLines<RawCommentItem>(file);
      let imported = 0;
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
          // ignore
        }
      }
      return { imported };
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

      const jobs = stats.pending.map(t => ({
        id: generateId(),
        task_id: taskId,
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
      return { enqueued: jobs.length };
    },

    async 'task.pause'(params) {
      const taskId = params.task_id as string;
      await updateTaskStatus(taskId, 'paused');
      return { status: 'paused' };
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

    async 'platform.list'() {
      return listPlatforms();
    },

    async 'platform.mapping.list'(params) {
      return listFieldMappings(params.platform as string, params.entity as string);
    },

    async 'template.list'() {
      return listTemplates();
    },

    async 'result.list'(params) {
      return listResultsByTask(
        params.task_id as string,
        (params.target ?? 'comment') as 'comment' | 'media',
        Number(params.limit ?? 50)
      );
    },

    async 'result.stats'(params) {
      return aggregateStats(params.task_id as string);
    },

    async 'daemon.status'() {
      return {
        pid: process.pid,
        db_path: getDbPath(),
        queue_stats: await new BreeDuckDBAdapter().getStats(),
      };
    },
  };
}

function readJsonLines<T>(filePath: string): T[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l) as T);
}
