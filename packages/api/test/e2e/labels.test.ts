import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fetchApi } from './helpers';
import type { TestContext } from './helpers';

let ctx: TestContext;

/** Helper: create a platform + post, return the postId */
async function createTestPost(ctx: TestContext, platformId = 'test-platform', postSuffix = '1') {
  await fetchApi(ctx.baseUrl, '/api/platforms', {
    method: 'POST',
    body: JSON.stringify({ id: platformId, name: 'Test Platform' }),
  });
  const res = await fetchApi(ctx.baseUrl, '/api/posts/import', {
    method: 'POST',
    body: JSON.stringify({
      posts: [
        {
          platform_id: platformId,
          platform_post_id: `test-post-${postSuffix}`,
          content: `Test content ${postSuffix}`,
        },
      ],
    }),
  });
  const body = await res.json();
  return body.postIds[0] as string;
}

describe('Labels CRUD', () => {
  before(async () => {
    ctx = await startServer();
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('POST /api/labels — creates a label with name', async () => {
    const res = await fetchApi(ctx.baseUrl, '/api/labels', {
      method: 'POST',
      body: JSON.stringify({ name: 'Important' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, 'Important');
    assert.ok(body.id);
  });

  it('POST /api/labels — creates a label with name and color', async () => {
    const res = await fetchApi(ctx.baseUrl, '/api/labels', {
      method: 'POST',
      body: JSON.stringify({ name: 'Urgent', color: '#ff0000' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.name, 'Urgent');
    assert.equal(body.color, '#ff0000');
    assert.ok(body.id);
  });

  it('POST /api/labels — rejects missing name (400)', async () => {
    const res = await fetchApi(ctx.baseUrl, '/api/labels', {
      method: 'POST',
      body: JSON.stringify({ color: '#00ff00' }),
    });
    assert.equal(res.status, 400);
  });

  it('GET /api/labels — lists labels with post_count', async () => {
    const res = await fetchApi(ctx.baseUrl, '/api/labels');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body), `Expected array, got: ${JSON.stringify(body)}`);
    // At least the two labels we created above
    assert.ok(body.length >= 2, 'should have at least 2 labels');
    const important = body.find((l: any) => l.name === 'Important');
    assert.ok(important, 'Important label should exist');
    assert.equal(typeof important.post_count, 'number');
  });

  it('DELETE /api/labels/:id — deletes a label and its post associations', async () => {
    // Create a label to delete
    const createRes = await fetchApi(ctx.baseUrl, '/api/labels', {
      method: 'POST',
      body: JSON.stringify({ name: 'ToDelete' }),
    });
    const label = await createRes.json();

    // Delete it
    const delRes = await fetchApi(ctx.baseUrl, `/api/labels/${label.id}`, {
      method: 'DELETE',
    });
    assert.equal(delRes.status, 200);
    const delBody = await delRes.json();
    assert.equal(delBody.deleted, true);

    // Verify it's gone from the list
    const listRes = await fetchApi(ctx.baseUrl, '/api/labels');
    const list = await listRes.json();
    const found = list.find((l: any) => l.id === label.id);
    assert.equal(found, undefined);
  });
});

describe('Post star', () => {
  let postId: string;

  before(async () => {
    ctx = await startServer();
    postId = await createTestPost(ctx, 'star-platform', 'star-1');
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('POST /api/posts/:id/star — stars a post (default, no body)', async () => {
    const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/star`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.starred, true);
  });

  it('POST /api/posts/:id/star — stars a post (starred: true)', async () => {
    const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/star`, {
      method: 'POST',
      body: JSON.stringify({ starred: true }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.starred, true);
  });

  it('GET /api/posts?starred=true — filters to show only starred posts', async () => {
    const res = await fetchApi(ctx.baseUrl, '/api/posts?starred=true');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.posts));
    assert.ok(body.posts.length >= 1, 'should have at least 1 starred post');
    const found = body.posts.find((p: any) => p.id === postId);
    assert.ok(found, 'starred post should appear in results');
  });

  it('POST /api/posts/:id/star — unstars a post (starred: false)', async () => {
    const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/star`, {
      method: 'POST',
      body: JSON.stringify({ starred: false }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.starred, false);
  });

  it('GET /api/posts?starred=true — no longer returns unstarred post', async () => {
    const res = await fetchApi(ctx.baseUrl, '/api/posts?starred=true');
    assert.equal(res.status, 200);
    const body = await res.json();
    const found = body.posts.find((p: any) => p.id === postId);
    assert.equal(found, undefined, 'unstarred post should not appear in starred filter');
  });
});

describe('Post labels', () => {
  let postId: string;

  before(async () => {
    ctx = await startServer();
    postId = await createTestPost(ctx, 'label-platform', 'label-1');
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('POST /api/posts/:id/labels — add label by label_name (auto-creates label)', async () => {
    const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/labels`, {
      method: 'POST',
      body: JSON.stringify({ label_name: 'Tech' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.added, 1);

    // Verify the label was auto-created
    const listRes = await fetchApi(ctx.baseUrl, '/api/labels');
    const labels = await listRes.json();
    const tech = labels.find((l: any) => l.name === 'Tech');
    assert.ok(tech, 'Tech label should be auto-created');
  });

  it('POST /api/posts/:id/labels — add label by label_names (array, auto-creates)', async () => {
    const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/labels`, {
      method: 'POST',
      body: JSON.stringify({ label_names: ['Design', 'Product'] }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.added, 2);

    // Verify both labels were auto-created
    const listRes = await fetchApi(ctx.baseUrl, '/api/labels');
    const labels = await listRes.json();
    assert.ok(labels.find((l: any) => l.name === 'Design'), 'Design label should exist');
    assert.ok(labels.find((l: any) => l.name === 'Product'), 'Product label should exist');
  });

  it('POST /api/posts/:id/labels — add label by label_id (existing label)', async () => {
    // Create a label first
    const createRes = await fetchApi(ctx.baseUrl, '/api/labels', {
      method: 'POST',
      body: JSON.stringify({ name: 'ExistingLabel', color: '#123456' }),
    });
    const label = await createRes.json();

    // Add it by ID
    const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/labels`, {
      method: 'POST',
      body: JSON.stringify({ label_id: label.id }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.added, 1);
  });

  it('POST /api/posts/:id/labels — rejects missing label info (400)', async () => {
    const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/labels`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  it('DELETE /api/posts/:id/labels/:labelId — removes a label from a post', async () => {
    // Find a label to remove
    const listRes = await fetchApi(ctx.baseUrl, '/api/labels');
    const labels = await listRes.json();
    const techLabel = labels.find((l: any) => l.name === 'Tech');
    assert.ok(techLabel, 'Tech label should exist');

    const res = await fetchApi(ctx.baseUrl, `/api/posts/${postId}/labels/${techLabel.id}`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.removed, true);
  });

  it('GET /api/posts?label=<name> — filters posts by label name', async () => {
    // Add a label to a post first
    await fetchApi(ctx.baseUrl, `/api/posts/${postId}/labels`, {
      method: 'POST',
      body: JSON.stringify({ label_name: 'FilterTest' }),
    });

    const res = await fetchApi(ctx.baseUrl, '/api/posts?label=FilterTest');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.posts));
    assert.ok(body.posts.length >= 1, 'should have at least 1 post with FilterTest label');
    const found = body.posts.find((p: any) => p.id === postId);
    assert.ok(found, 'post with FilterTest label should appear');
  });

  it('GET /api/posts?label=<nonexistent> — returns empty for unknown label', async () => {
    const res = await fetchApi(ctx.baseUrl, '/api/posts?label=NoSuchLabel');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.posts));
    assert.equal(body.posts.length, 0, 'should have no posts for unknown label');
  });

  it('GET /api/posts — includes labels in response for each post', async () => {
    const res = await fetchApi(ctx.baseUrl, '/api/posts');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.posts));
    assert.ok(body.posts.length >= 1, 'should have at least 1 post');

    const post = body.posts.find((p: any) => p.id === postId);
    assert.ok(post, 'test post should appear in list');
    assert.ok(Array.isArray(post.labels), 'post should have labels array');
    // Post should have at least the FilterTest label and Design/Product/ExistingLabel
    assert.ok(post.labels.length >= 1, 'post should have at least 1 label');
  });
});
