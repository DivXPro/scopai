import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fetchApi } from './helpers';
import type { TestContext } from './helpers';

let ctx: TestContext;

describe('Posts routes', () => {
  before(async () => {
    ctx = await startServer();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('GET /api/posts', () => {
    it('returns 200 with empty list', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/posts');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.posts));
      assert.equal(body.total, 0);
    });

    it('supports limit parameter', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/posts?limit=5');
      assert.equal(res.status, 200);
    });
  });

  describe('POST /api/posts/import', () => {
    it('imports posts and returns counts', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/posts/import', {
        method: 'POST',
        body: JSON.stringify({
          posts: [
            {
              platform_id: 'xhs',
              platform_post_id: 'test-post-1',
              title: 'Test Post',
              content: 'Hello world',
              author_name: 'tester',
            },
          ],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.imported, 1);
      assert.equal(body.skipped, 0);
      assert.ok(Array.isArray(body.postIds));
      assert.equal(body.postIds.length, 1);
    });

    it('rejects empty posts array', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/posts/import', {
        method: 'POST',
        body: JSON.stringify({ posts: [] }),
      });
      assert.equal(res.status, 400);
    });

    it('skips duplicate imports', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/posts/import', {
        method: 'POST',
        body: JSON.stringify({
          posts: [
            {
              platform_id: 'xhs',
              platform_post_id: 'test-post-1',
              title: 'Test Post Updated',
              content: 'Hello world v2',
              author_name: 'tester',
            },
          ],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.imported, 0);
      assert.equal(body.skipped, 1);
    });
  });

  describe('GET /api/posts/:id/comments', () => {
    it('returns 200 with comments for a post', async () => {
      const importRes = await fetchApi(ctx.baseUrl, '/api/posts/import', {
        method: 'POST',
        body: JSON.stringify({
          posts: [
            {
              platform_id: 'xhs',
              platform_post_id: 'post-for-comments',
              title: 'Post With Comments',
              content: 'Content',
            },
          ],
        }),
      });
      const importBody = await importRes.json();
      const postId = importBody.postIds[0];

      const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/comments`);
      assert.equal(res.status, 200);
    });
  });

  describe('GET /api/posts/:id/media', () => {
    it('returns 200 with media files', async () => {
      const importRes = await fetchApi(ctx.baseUrl, '/api/posts/import', {
        method: 'POST',
        body: JSON.stringify({
          posts: [
            {
              platform_id: 'xhs',
              platform_post_id: 'post-for-media',
              title: 'Post With Media',
              content: 'Content',
            },
          ],
        }),
      });
      const importBody = await importRes.json();
      const postId = importBody.postIds[0];

      const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/media`);
      assert.equal(res.status, 200);
    });
  });

  describe('DELETE /api/posts/:id', () => {
    it('deletes a post and returns 200', async () => {
      const importRes = await fetchApi(ctx.baseUrl, '/api/posts/import', {
        method: 'POST',
        body: JSON.stringify({
          posts: [
            {
              platform_id: 'xhs',
              platform_post_id: 'post-to-delete',
              title: 'Post To Delete',
              content: 'Will be deleted',
            },
          ],
        }),
      });
      const importBody = await importRes.json();
      const postId = importBody.postIds[0];

      const deleteRes = await fetchApi(ctx.baseUrl, `/api/posts/${postId}`, {
        method: 'DELETE',
      });
      assert.equal(deleteRes.status, 200);
      const deleteBody = await deleteRes.json();
      assert.equal(deleteBody.success, true);
      assert.equal(deleteBody.deleted, postId);

      const getRes = await fetchApi(ctx.baseUrl, `/api/posts/${postId}`);
      assert.equal(getRes.status, 404);
    });

    it('returns 404 for non-existent post', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/posts/non-existent-id', {
        method: 'DELETE',
      });
      assert.equal(res.status, 404);
    });

    it('cascades deletion to comments and media', async () => {
      const importRes = await fetchApi(ctx.baseUrl, '/api/posts/import', {
        method: 'POST',
        body: JSON.stringify({
          posts: [
            {
              platform_id: 'xhs',
              platform_post_id: 'post-with-comments',
              title: 'Post With Comments',
              content: 'Content',
            },
          ],
        }),
      });
      const importBody = await importRes.json();
      const postId = importBody.postIds[0];

      // Import a comment
      await fetchApi(ctx.baseUrl, `/api/posts/${postId}/comments/import`, {
        method: 'POST',
        body: JSON.stringify({
          platform: 'xhs',
          comments: [
            {
              platform_comment_id: 'comment-1',
              content: 'Nice post',
              author_name: 'user1',
            },
          ],
        }),
      });

      // Delete the post
      const deleteRes = await fetchApi(ctx.baseUrl, `/api/posts/${postId}`, {
        method: 'DELETE',
      });
      assert.equal(deleteRes.status, 200);

      // Post should be gone
      const getRes = await fetchApi(ctx.baseUrl, `/api/posts/${postId}`);
      assert.equal(getRes.status, 404);

      // Comments should be gone
      const commentsRes = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/comments`);
      assert.equal(commentsRes.status, 200);
      const commentsBody = await commentsRes.json();
      assert.equal(Array.isArray(commentsBody) ? commentsBody.length : commentsBody.comments?.length, 0);

      // Media should be empty
      const mediaRes = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/media`);
      assert.equal(mediaRes.status, 200);
      const mediaBody = await mediaRes.json();
      assert.equal(Array.isArray(mediaBody) ? mediaBody.length : mediaBody.length, 0);
    });
  });
});
