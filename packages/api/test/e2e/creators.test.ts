import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fetchApi } from './helpers';
import type { TestContext } from './helpers';

let ctx: TestContext;

describe('Creators routes', () => {
  before(async () => {
    ctx = await startServer();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('POST /api/creators', () => {
    it('creates a creator subscription', async () => {
      await fetchApi(ctx.baseUrl, '/api/platforms', {
        method: 'POST',
        body: JSON.stringify({ id: 'test-platform', name: 'Test Platform' }),
      });

      const res = await fetchApi(ctx.baseUrl, '/api/creators', {
        method: 'POST',
        body: JSON.stringify({
          platform_id: 'test-platform',
          platform_author_id: 'author-123',
          author_name: 'Test Author',
        }),
      });
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.platform_author_id, 'author-123');
      assert.equal(body.status, 'active');
    });

    it('rejects duplicate subscription', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/creators', {
        method: 'POST',
        body: JSON.stringify({
          platform_id: 'test-platform',
          platform_author_id: 'author-123',
        }),
      });
      assert.equal(res.status, 409);
    });

    it('requires platform_id and author_id', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/creators', {
        method: 'POST',
        body: JSON.stringify({ platform_id: 'test-platform' }),
      });
      assert.equal(res.status, 400);
    });
  });

  describe('GET /api/creators', () => {
    it('lists creators with pagination', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/creators?limit=10');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.items));
      assert.ok(typeof body.total === 'number');
    });

    it('filters by status', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/creators?status=active');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.items.every((c: any) => c.status === 'active'));
    });
  });

  describe('POST /api/creators/:id/sync', () => {
    it('creates a sync job', async () => {
      const listRes = await fetchApi(ctx.baseUrl, '/api/creators');
      const list = await listRes.json();
      const creatorId = list.items[0]?.id;
      assert.ok(creatorId, 'Creator should exist');

      const res = await fetchApi(ctx.baseUrl, `/api/creators/${creatorId}/sync`, {
        method: 'POST',
        body: JSON.stringify({ sync_type: 'periodic' }),
      });
      assert.equal(res.status, 202);
      const body = await res.json();
      assert.ok(body.job_id);
      assert.equal(body.status, 'pending');
    });

    it('rejects sync for unsubscribed creator', async () => {
      const createRes = await fetchApi(ctx.baseUrl, '/api/creators', {
        method: 'POST',
        body: JSON.stringify({ platform_id: 'test-platform', platform_author_id: 'author-unsub' }),
      });
      const creator = await createRes.json();

      await fetchApi(ctx.baseUrl, `/api/creators/${creator.id}`, { method: 'DELETE' });

      const res = await fetchApi(ctx.baseUrl, `/api/creators/${creator.id}/sync`, {
        method: 'POST',
      });
      assert.equal(res.status, 400);
    });
  });

  describe('DELETE /api/creators/:id', () => {
    it('unsubscribes a creator', async () => {
      const createRes = await fetchApi(ctx.baseUrl, '/api/creators', {
        method: 'POST',
        body: JSON.stringify({ platform_id: 'test-platform', platform_author_id: 'author-del' }),
      });
      const creator = await createRes.json();

      const res = await fetchApi(ctx.baseUrl, `/api/creators/${creator.id}`, { method: 'DELETE' });
      assert.equal(res.status, 204);

      const getRes = await fetchApi(ctx.baseUrl, `/api/creators/${creator.id}`);
      const body = await getRes.json();
      assert.equal(body.status, 'unsubscribed');
    });
  });

  describe('GET /api/creators/:id/sync-logs', () => {
    it('returns sync logs', async () => {
      const listRes = await fetchApi(ctx.baseUrl, '/api/creators');
      const list = await listRes.json();
      const creatorId = list.items[0]?.id;
      assert.ok(creatorId);

      const res = await fetchApi(ctx.baseUrl, `/api/creators/${creatorId}/sync-logs`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body));
    });
  });
});
