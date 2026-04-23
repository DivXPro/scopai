import { FastifyInstance } from 'fastify';
import { listPosts, searchPosts, listCommentsByPost, listMediaFilesByPost, getPostAnalysisResults } from '@scopai/core';
import { createPost, generateId, now, query, run } from '@scopai/core';

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

export default async function postsRoutes(app: FastifyInstance) {
  app.get('/posts', async (request) => {
    const { platform, limit = '50', offset = '0', query: searchQuery } = request.query as Record<string, string>;
    if (searchQuery) {
      return searchPosts(platform || '', searchQuery, parseInt(limit, 10));
    }
    return listPosts(platform || undefined, parseInt(limit, 10), parseInt(offset, 10));
  });

  app.post('/posts/import', async (request, reply) => {
    const body = request.body as { posts?: Record<string, unknown>[] };
    if (!body.posts || !Array.isArray(body.posts) || body.posts.length === 0) {
      reply.code(400);
      throw new Error('posts array is required and must not be empty');
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

    return { imported, skipped, postIds };
  });

  app.get('/posts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const posts = await listPosts(undefined, 1, 0);
    const post = posts.find(p => p.id === id);
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

  app.get('/posts/:id/media', async (request) => {
    const { id } = request.params as { id: string };
    return listMediaFilesByPost(id);
  });

  app.get('/posts/:id/analysis', async (request) => {
    const { id } = request.params as { id: string };
    return getPostAnalysisResults(id);
  });
}
