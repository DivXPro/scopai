import { FastifyInstance } from 'fastify';
import { listPosts, searchPosts, listCommentsByPost, listMediaFilesByPost, getPostAnalysisResults, getPostById, countPosts, createComment, countPostAnalysisResults, countMediaFilesByPost } from '@scopai/core';
import { createPost, generateId, now, query, run, getTaskById, addTaskTargets, upsertTaskPostStatus, parseChineseNumber } from '@scopai/core';

const FIELD_NAME_MAP: Record<string, string> = {
  likes: 'like_count',
  collects: 'collect_count',
  comments: 'comment_count',
  shares: 'share_count',
  plays: 'play_count',
  note_id: 'platform_post_id',
  author: 'author_name',
  user_id: 'author_id',
  cover: 'cover_url',
  cover_image: 'cover_url',
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

export default async function postsRoutes(app: FastifyInstance) {
  app.get('/posts', async (request) => {
    const { platform, limit = '50', offset = '0', query: searchQuery } = request.query as Record<string, string>;
    const parsedLimit = parseInt(limit, 10);
    const parsedOffset = parseInt(offset, 10);
    const items = searchQuery
      ? await searchPosts(platform || '', searchQuery, parsedLimit, parsedOffset)
      : await listPosts(platform || undefined, parsedLimit, parsedOffset);
    const total = await countPosts(platform || undefined);
    const itemsWithCount = await Promise.all(
      items.map(async (post) => ({
        ...post,
        analysis_count: await countPostAnalysisResults(post.id),
        media_count: await countMediaFilesByPost(post.id),
      })),
    );
    return { posts: itemsWithCount, total };
  });

  app.post('/posts/import', async (request, reply) => {
    const body = request.body as { posts?: Record<string, unknown>[]; task_id?: string };
    if (!body.posts || !Array.isArray(body.posts) || body.posts.length === 0) {
      reply.code(400);
      throw new Error('posts array is required and must not be empty');
    }

    if (body.task_id) {
      const task = await getTaskById(body.task_id);
      if (!task) {
        reply.code(400);
        throw new Error(`Task not found: ${body.task_id}`);
      }
    }

    let imported = 0;
    let skipped = 0;
    const postIds: string[] = [];

    for (const rawItem of body.posts) {
      const item = normalizeFieldValueArray(rawItem) as RawPostItem;
      const platformId = (rawItem as Record<string, unknown>).platform_id as string;
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
              parseChineseNumber(item.likes) ?? item.like_count ?? 0,
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
            like_count: parseChineseNumber(item.likes) ?? item.like_count ?? 0,
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

    if (body.task_id && postIds.length > 0) {
      await addTaskTargets(body.task_id, 'post', postIds);
      for (const postId of postIds) {
        await upsertTaskPostStatus(body.task_id, postId, { status: 'pending' });
      }
    }

    return { imported, skipped, postIds };
  });

  app.get('/posts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const post = await getPostById(id);
    if (!post) {
      reply.code(404);
      throw new Error(`Post not found: ${id}`);
    }
    return post;
  });

  app.get('/posts/:id/comments', async (request) => {
    const { id } = request.params as { id: string };
    return listCommentsByPost(id);
  });

  app.post('/posts/:id/comments/import', async (request, reply) => {
    const { id: postId } = request.params as { id: string };
    const body = request.body as { comments?: Record<string, unknown>[]; platform?: string };
    if (!body.comments || !Array.isArray(body.comments) || body.comments.length === 0) {
      reply.code(400);
      throw new Error('comments array is required and must not be empty');
    }
    const platformId = body.platform ?? '';
    let imported = 0;
    let skipped = 0;
    for (const item of body.comments) {
      try {
        await createComment({
          post_id: postId,
          platform_id: platformId,
          platform_comment_id: (item.platform_comment_id ?? item.id ?? null) as string | null,
          parent_comment_id: (item.parent_comment_id ?? null) as string | null,
          root_comment_id: (item.root_comment_id ?? null) as string | null,
          depth: Number(item.depth ?? 0),
          author_id: (item.author_id ?? null) as string | null,
          author_name: (item.author_name ?? item.author ?? null) as string | null,
          content: (item.content ?? '') as string,
          like_count: parseChineseNumber(item.likes) ?? item.like_count ?? 0,
          reply_count: Number(item.reply_count ?? 0),
          published_at: item.published_at ? new Date(item.published_at as string) : null,
          metadata: (item.metadata ?? null) as Record<string, unknown> | null,
        });
        imported++;
      } catch {
        skipped++;
      }
    }
    return { imported, skipped };
  });

  app.get('/posts/:id/media', async (request) => {
    const { id } = request.params as { id: string };
    return listMediaFilesByPost(id);
  });

  app.get('/posts/:id/analysis', async (request) => {
    const { id } = request.params as { id: string };
    return getPostAnalysisResults(id);
  });
}
