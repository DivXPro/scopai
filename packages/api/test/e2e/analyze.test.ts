import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fetchApi } from './helpers';
import type { TestContext } from './helpers';

let ctx: TestContext;

const SAMPLE_PLATFORM = {
  id: 'test-platform',
  name: 'Test Platform',
};

const SAMPLE_POST_STRATEGY = {
  id: 'test-post-strategy-v1',
  name: 'Post Sentiment',
  version: '1.0.0',
  target: 'post',
  needs_media: { enabled: false },
  prompt: 'Analyze: {{content}}',
  output_schema: {
    type: 'object',
    properties: {
      sentiment: { type: 'string', title: '情感' },
    },
  },
};

const SAMPLE_MEDIA_STRATEGY = {
  id: 'test-media-strategy-v1',
  name: 'Media Analysis',
  version: '1.0.0',
  target: 'post',
  needs_media: { enabled: true },
  prompt: 'Analyze media: {{content}}',
  output_schema: {
    type: 'object',
    properties: {
      type: { type: 'string', title: '类型' },
    },
  },
};

const SAMPLE_COMMENT_STRATEGY = {
  id: 'test-comment-strategy-v1',
  name: 'Comment Analysis',
  version: '1.0.0',
  target: 'comment',
  needs_media: { enabled: false },
  prompt: 'Analyze comment: {{content}}',
  output_schema: {
    type: 'object',
    properties: {
      intent: { type: 'string', title: '意图' },
    },
  },
};

let postCounter = 0;

async function createTestPost(baseUrl: string, overrides: Record<string, unknown> = {}): Promise<string> {
  postCounter++;
  const platformPostId = `test-post-${Date.now()}-${postCounter}`;
  const res = await fetchApi(baseUrl, '/api/posts/import', {
    method: 'POST',
    body: JSON.stringify({
      posts: [{
        platform_id: SAMPLE_PLATFORM.id,
        platform_post_id: platformPostId,
        content: `Test post content ${platformPostId}`,
        ...overrides,
      }],
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `createTestPost failed: ${JSON.stringify(body)}`);
  assert.ok(body.postIds.length > 0, 'should return postIds');
  return body.postIds[0];
}

async function createTestComment(baseUrl: string, postId: string): Promise<string> {
  const commentCounter = Date.now();
  const res = await fetchApi(baseUrl, `/api/posts/${postId}/comments/import`, {
    method: 'POST',
    body: JSON.stringify({
      platform: SAMPLE_PLATFORM.id,
      comments: [{
        platform_comment_id: `test-comment-${commentCounter}`,
        content: 'Test comment content',
        author_name: 'TestUser',
      }],
    }),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `createTestComment failed: ${JSON.stringify(body)}`);
  assert.equal(body.imported, 1, 'should import 1 comment');
  // Fetch the comment ID from the post's comments list
  const commentsRes = await fetchApi(baseUrl, `/api/posts/${postId}/comments`);
  const commentsBody = await commentsRes.json();
  const comments = Array.isArray(commentsBody) ? commentsBody : commentsBody.comments;
  assert.ok(comments && comments.length > 0, 'should have comments');
  return comments[comments.length - 1].id;
}

async function createTestStrategy(baseUrl: string, strategy: Record<string, unknown>): Promise<void> {
  const res = await fetchApi(baseUrl, '/api/strategies', {
    method: 'POST',
    body: JSON.stringify(strategy),
  });
  const body = await res.json();
  assert.equal(res.status, 200, `createTestStrategy failed: ${JSON.stringify(body)}`);
}

describe('Analyze submit routes', () => {
  before(async () => {
    ctx = await startServer();
    // Create platform
    await fetchApi(ctx.baseUrl, '/api/platforms', {
      method: 'POST',
      body: JSON.stringify(SAMPLE_PLATFORM),
    });
    // Create strategies
    await createTestStrategy(ctx.baseUrl, SAMPLE_POST_STRATEGY);
    await createTestStrategy(ctx.baseUrl, SAMPLE_MEDIA_STRATEGY);
    await createTestStrategy(ctx.baseUrl, SAMPLE_COMMENT_STRATEGY);
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('POST /api/analyze/submit — validation', () => {
    it('rejects missing strategy_id', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({ post_ids: ['p1'] }),
      });
      assert.equal(res.status, 400);
    });

    it('rejects unknown strategy_id', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({ strategy_id: 'nonexistent', post_ids: ['p1'] }),
      });
      assert.equal(res.status, 404);
    });

    it('rejects post strategy without post_ids', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({ strategy_id: SAMPLE_POST_STRATEGY.id }),
      });
      assert.equal(res.status, 400);
    });

    it('rejects comment strategy without comment_ids', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({ strategy_id: SAMPLE_COMMENT_STRATEGY.id }),
      });
      assert.equal(res.status, 400);
    });

    it('rejects unknown task_id', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({
          strategy_id: SAMPLE_POST_STRATEGY.id,
          task_id: 'nonexistent-task',
          post_ids: ['p1'],
        }),
      });
      assert.equal(res.status, 404);
    });
  });

  describe('POST /api/analyze/submit — basic submission', () => {
    it('auto-creates task and enqueues jobs for post targets', async () => {
      const postId = await createTestPost(ctx.baseUrl);
      const res = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({
          strategy_id: SAMPLE_POST_STRATEGY.id,
          post_ids: [postId],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.task_id, 'should return task_id');
      assert.equal(body.enqueued, 1);
      assert.equal(body.skipped, 0);
    });

    it('reuses existing task when task_id provided', async () => {
      const postId = await createTestPost(ctx.baseUrl);
      // First submission to get a task_id
      const res1 = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({
          strategy_id: SAMPLE_POST_STRATEGY.id,
          post_ids: [postId],
        }),
      });
      const body1 = await res1.json();
      const taskId = body1.task_id;

      // Second submission with same task_id but different post
      const postId2 = await createTestPost(ctx.baseUrl);
      const res2 = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({
          strategy_id: SAMPLE_POST_STRATEGY.id,
          task_id: taskId,
          post_ids: [postId2],
        }),
      });
      assert.equal(res2.status, 200);
      const body2 = await res2.json();
      assert.equal(body2.task_id, taskId, 'should reuse same task');
      assert.equal(body2.enqueued, 1);
    });
  });

  describe('POST /api/analyze/submit — dedup', () => {
    it('skips targets that already have jobs', async () => {
      const postId = await createTestPost(ctx.baseUrl);
      // First submission
      const res1 = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({
          strategy_id: SAMPLE_POST_STRATEGY.id,
          post_ids: [postId],
        }),
      });
      const body1 = await res1.json();
      const taskId = body1.task_id;
      // Second submission for same target with same task_id (no force)
      const res = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({
          strategy_id: SAMPLE_POST_STRATEGY.id,
          task_id: taskId,
          post_ids: [postId],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.enqueued, 0, 'should not enqueue duplicate');
      assert.ok(body.skipped >= 1, 'should report skipped');
    });
  });

  describe('POST /api/analyze/submit — force mode', () => {
    it('re-enqueues targets with force flag', async () => {
      const postId = await createTestPost(ctx.baseUrl);
      // First submission
      const res1 = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({
          strategy_id: SAMPLE_POST_STRATEGY.id,
          post_ids: [postId],
        }),
      });
      const body1 = await res1.json();
      const taskId = body1.task_id;
      // Force re-submission with same task
      const res = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({
          strategy_id: SAMPLE_POST_STRATEGY.id,
          task_id: taskId,
          post_ids: [postId],
          force: true,
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.enqueued, 1, 'force should re-enqueue');
    });
  });

  describe('POST /api/analyze/submit — media readiness', () => {
    it('skips posts with media_files but no downloaded files when strategy needs media', async () => {
      // Create a post with media_files metadata but no actual downloaded files
      const postId = await createTestPost(ctx.baseUrl, {
        media_files: [{ url: 'https://example.com/image.jpg', type: 'image' }],
      });
      const res = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({
          strategy_id: SAMPLE_MEDIA_STRATEGY.id,
          post_ids: [postId],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.enqueued, 0, 'should skip posts without downloaded media');
      assert.ok(body.skipped >= 1, 'should report skipped');
    });

    it('allows posts with no expected media when strategy needs media', async () => {
      // Post with no media_files
      const postId = await createTestPost(ctx.baseUrl);
      const res = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({
          strategy_id: SAMPLE_MEDIA_STRATEGY.id,
          post_ids: [postId],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.enqueued, 1, 'should allow posts with no expected media');
    });
  });

  describe('POST /api/analyze/submit — comment targets', () => {
    it('enqueues comment targets for comment strategy', async () => {
      const postId = await createTestPost(ctx.baseUrl);
      const commentId = await createTestComment(ctx.baseUrl, postId);

      const res = await fetchApi(ctx.baseUrl, '/api/analyze/submit', {
        method: 'POST',
        body: JSON.stringify({
          strategy_id: SAMPLE_COMMENT_STRATEGY.id,
          comment_ids: [commentId],
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.task_id);
      assert.equal(body.enqueued, 1);
    });
  });
});
