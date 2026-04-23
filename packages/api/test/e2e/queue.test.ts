import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fetchApi } from './helpers';
import type { TestContext } from './helpers';

let ctx: TestContext;

describe('Queue routes', () => {
  before(async () => {
    ctx = await startServer();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('GET /api/queue', () => {
    it('returns queue stats and jobs', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/queue');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.stats);
      assert.ok(Array.isArray(body.jobs));
      assert.equal(typeof body.stats.pending, 'number');
      assert.equal(typeof body.stats.processing, 'number');
      assert.equal(typeof body.stats.completed, 'number');
      assert.equal(typeof body.stats.failed, 'number');
    });
  });

  describe('POST /api/queue/retry', () => {
    it('retries failed jobs', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/queue/retry', {
        method: 'POST',
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(typeof body.retried, 'number');
    });
  });

  describe('POST /api/queue/reset', () => {
    it('resets all jobs', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/queue/reset', {
        method: 'POST',
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(typeof body.reset, 'number');
    });
  });
});
