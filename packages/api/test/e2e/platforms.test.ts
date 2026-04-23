import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fetchApi } from './helpers';
import type { TestContext } from './helpers';

let ctx: TestContext;

describe('GET /api/platforms', () => {
  before(async () => {
    ctx = await startServer();
  });

  after(async () => {
    await ctx.cleanup();
  });

  it('returns 200 with seeded platforms', async () => {
    const res = await fetchApi(ctx.baseUrl, '/api/platforms');
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 11);
  });

  it('each platform has id and name', async () => {
    const res = await fetchApi(ctx.baseUrl, '/api/platforms');
    const body = await res.json();
    for (const p of body) {
      assert.ok(p.id, 'platform has id');
      assert.ok(p.name, 'platform has name');
    }
  });
});
