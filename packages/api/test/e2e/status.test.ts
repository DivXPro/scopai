import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fetchApi } from './helpers';
import type { TestContext } from './helpers';

let ctx: TestContext;

describe('GET /api/status', () => {
  before(async () => {
    ctx = await startServer();
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('returns 200 with status fields', async () => {
    const res = await fetchApi(ctx.baseUrl, '/api/status');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.pid, 'number');
    assert.ok(body.db_path);
    assert.ok(body.queue_stats);
    assert.equal(typeof body.uptime, 'number');
  });

  it('queue_stats has expected fields', async () => {
    const res = await fetchApi(ctx.baseUrl, '/api/status');
    const body = await res.json();
    const qs = body.queue_stats;
    assert.equal(typeof qs.pending, 'number');
    assert.equal(typeof qs.processing, 'number');
    assert.equal(typeof qs.completed, 'number');
    assert.equal(typeof qs.failed, 'number');
  });
});
