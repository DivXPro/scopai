import { FastifyInstance } from 'fastify';
import {
  listPosts, searchPosts, listCommentsByPost, listMediaFilesByPost,
  getPostAnalysisResults, getPostById, countPosts, createComment,
  countPostAnalysisResults, countMediaFilesByPost,
  getOrCreateLabel, addPostLabel, removePostLabel, getPostLabels,
  setPostStarred, listPostsByLabel, listStarredPostIds, getLabelByName,
} from '@scopai/core';
import type { Post } from '@scopai/core';
import {
  createPost, updatePost, generateId, now, query, run, checkpoint,
  getTaskById, addTaskTargets, upsertTaskPostStatus,
  normalizePostItem, normalizeCommentItem,
  getLogger,
  getPlatformAdapter,
} from '@scopai/core';

export default async function postsRoutes(app: FastifyInstance) {
  app.get('/posts', async (request) => {
    const { platform, limit = '50', offset = '0', query: searchQuery, starred, label } = request.query as Record<string, string>;
    const parsedLimit = parseInt(limit, 10);
    const parsedOffset = parseInt(offset, 10);

    let items;
    if (starred === 'true') {
      const ids = await listStarredPostIds(parsedLimit, parsedOffset);
      items = await Promise.all(ids.map(id => getPostById(id))).then(r => r.filter(Boolean) as Post[]);
    } else if (label) {
      const labelRow = await getLabelByName(label);
      if (!labelRow) {
        items = [];
      } else {
        const ids = await listPostsByLabel(labelRow.id, parsedLimit, parsedOffset);
        items = await Promise.all(ids.map(id => getPostById(id))).then(r => r.filter(Boolean) as Post[]);
      }
    } else if (searchQuery) {
      items = await searchPosts(platform || '', searchQuery, parsedLimit, parsedOffset);
    } else {
      items = await listPosts(platform || undefined, parsedLimit, parsedOffset);
    }

    const itemsWithExtras = await Promise.all(
      items.map(async (post) => ({
        ...post,
        labels: await getPostLabels(post.id),
        analysis_count: await countPostAnalysisResults(post.id),
        media_count: await countMediaFilesByPost(post.id),
      })),
    );
    return { posts: itemsWithExtras, total: await countPosts(platform || undefined) };
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
      const platformId = (rawItem as Record<string, unknown>).platform_id as string;
      const item = normalizePostItem(rawItem, platformId);
      let platformPostId = item.platform_post_id;
      if (!platformPostId && item.url) {
        const adapter = getPlatformAdapter(platformId);
        if (adapter?.extractNoteId) platformPostId = adapter.extractNoteId(item.url);
      }
      if (!platformPostId) platformPostId = generateId();

      const existing = await query<{ id: string }>(
        'SELECT id FROM posts WHERE platform_id = ? AND platform_post_id = ?',
        [platformId, platformPostId],
      );

      let postId: string;
      try {
        if (existing.length > 0) {
          postId = existing[0].id;
          // Fetch existing post to compare and only update changed fields.
          // DuckDB fails on UPDATEs touching >16 columns on rows with FK refs
          // (internal DELETE+INSERT), so we minimize the update set.
          const existingPost = await getPostById(postId);
          const updates: Parameters<typeof updatePost>[1] = {};
          if (existingPost) {
            if (item.title !== existingPost.title) updates.title = item.title;
            if (item.content !== existingPost.content) updates.content = item.content;
            if (item.author_id !== existingPost.author_id) updates.author_id = item.author_id;
            if (item.author_name !== existingPost.author_name) updates.author_name = item.author_name;
            if (item.author_url !== existingPost.author_url) updates.author_url = item.author_url;
            if (item.url !== existingPost.url) updates.url = item.url;
            if (item.cover_url !== existingPost.cover_url) updates.cover_url = item.cover_url;
            if (item.post_type !== existingPost.post_type) updates.post_type = item.post_type as any;
            if (item.like_count !== existingPost.like_count) updates.like_count = item.like_count;
            if (item.collect_count !== existingPost.collect_count) updates.collect_count = item.collect_count;
            if (item.comment_count !== existingPost.comment_count) updates.comment_count = item.comment_count;
            if (item.share_count !== existingPost.share_count) updates.share_count = item.share_count;
            if (item.play_count !== existingPost.play_count) updates.play_count = item.play_count;
            if (item.score !== existingPost.score) updates.score = item.score;
            if (JSON.stringify(item.tags) !== JSON.stringify(existingPost.tags)) updates.tags = item.tags as { name: string; url?: string }[] | null;
            if (JSON.stringify(item.media_files) !== JSON.stringify(existingPost.media_files)) updates.media_files = item.media_files as { type: 'image' | 'video' | 'audio'; url: string; local_path?: string }[] | null;
            if (item.published_at?.getTime() !== existingPost.published_at?.getTime()) updates.published_at = item.published_at;
            if (JSON.stringify(item.metadata) !== JSON.stringify(existingPost.metadata)) updates.metadata = item.metadata;
          }
          await updatePost(postId, updates);
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

    if (body.task_id && postIds.length > 0) {
      await addTaskTargets(body.task_id, 'post', postIds);
      for (const postId of postIds) {
        await upsertTaskPostStatus(body.task_id, postId, { status: 'pending' });
      }
    }

    getLogger().info(`[PostImport] Imported ${imported} new posts, updated ${skipped} existing posts, task_id=${body.task_id ?? 'none'}`);

    try { await checkpoint(); } catch {}

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
    for (const rawItem of body.comments) {
      try {
        const item = normalizeCommentItem(rawItem, platformId || undefined);
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
  });

  app.get('/posts/:id/media', async (request) => {
    const { id } = request.params as { id: string };
    const files = await listMediaFilesByPost(id);
    return files.map(f => ({
      ...f,
      src: f.local_path ? `/api/media/${f.id}/file` : f.url,
    }));
  });

  app.get('/posts/:id/analysis', async (request) => {
    const { id } = request.params as { id: string };
    return getPostAnalysisResults(id);
  });

  app.post('/posts/:id/labels', async (request, reply) => {
    const { id: postId } = request.params as { id: string };
    const body = request.body as { label_id?: string; label_name?: string; label_names?: string[] };

    if (body.label_names && Array.isArray(body.label_names)) {
      for (const name of body.label_names) {
        const label = await getOrCreateLabel(name);
        await addPostLabel(postId, label.id);
      }
      return { added: body.label_names.length };
    }

    if (body.label_name) {
      const label = await getOrCreateLabel(body.label_name);
      await addPostLabel(postId, label.id);
      return { added: 1 };
    }

    if (body.label_id) {
      await addPostLabel(postId, body.label_id);
      return { added: 1 };
    }

    reply.code(400);
    throw new Error('label_id, label_name, or label_names is required');
  });

  app.delete('/posts/:id/labels/:labelId', async (request) => {
    const { id: postId, labelId } = request.params as { id: string; labelId: string };
    await removePostLabel(postId, labelId);
    return { removed: true };
  });

  app.post('/posts/:id/star', async (request) => {
    const { id: postId } = request.params as { id: string };
    const body = request.body as { starred?: boolean };
    const starred = body.starred ?? true;
    await setPostStarred(postId, starred);
    return { starred };
  });
}
