import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fetchApi } from './helpers';
import type { TestContext } from './helpers';

let ctx: TestContext;

const SAMPLE_STRATEGY = {
  id: 'test-sentiment-v1',
  name: 'Sentiment Analysis',
  version: '1.0.0',
  target: 'post',
  needs_media: { enabled: false },
  prompt: 'Analyze the sentiment of: {{content}}',
  output_schema: {
    type: 'object',
    properties: {
      sentiment: { type: 'string' },
      confidence: { type: 'number' },
    },
  },
};

describe('Strategies routes', () => {
  before(async () => {
    ctx = await startServer();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('GET /api/strategies', () => {
    it('returns 200 with empty list initially', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/strategies');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body));
    });
  });

  describe('POST /api/strategies', () => {
    it('creates a strategy', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/strategies', {
        method: 'POST',
        body: JSON.stringify(SAMPLE_STRATEGY),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.id, SAMPLE_STRATEGY.id);
    });

    it('rejects invalid strategy missing id', async () => {
      const { id, ...noId } = SAMPLE_STRATEGY;
      const res = await fetchApi(ctx.baseUrl, '/api/strategies', {
        method: 'POST',
        body: JSON.stringify(noId),
      });
      assert.equal(res.status, 500);
    });

    it('strategy now appears in list', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/strategies');
      const body = await res.json();
      assert.equal(body.length, 1);
      assert.equal(body[0].id, SAMPLE_STRATEGY.id);
    });
  });

  describe('GET /api/strategies/:id', () => {
    it('returns strategy by id', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/strategies/${SAMPLE_STRATEGY.id}`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.name, SAMPLE_STRATEGY.name);
    });

    it('returns 404 for unknown strategy', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/strategies/nonexistent');
      assert.equal(res.status, 404);
    });
  });

  describe('DELETE /api/strategies/:id', () => {
    it('deletes a strategy', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/strategies/${SAMPLE_STRATEGY.id}`, {
        method: 'DELETE',
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.deleted, true);
    });

    it('returns 404 when deleting nonexistent strategy', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/strategies/nonexistent', {
        method: 'DELETE',
      });
      assert.equal(res.status, 404);
    });
  });
});
