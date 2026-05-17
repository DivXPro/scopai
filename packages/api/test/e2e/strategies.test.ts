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
      sentiment: { type: 'string', title: '情感' },
      confidence: { type: 'number', title: '置信度' },
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
    it('returns 200 with at least the auto-seeded built-in strategies', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/strategies');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body));
      const byId = new Map<string, { id: string; is_default: boolean }>(
        body.map((s: { id: string; is_default: boolean }) => [s.id, s]),
      );
      for (const seeded of [
        'creative-copy-deconstruct',
        'creative-image-style',
        'creative-video-style',
        'creative-topic-angle',
      ]) {
        const row = byId.get(seeded);
        assert.ok(row, `expected seeded strategy ${seeded} to be present`);
        assert.equal(row.is_default, true, `expected ${seeded} to be is_default=true`);
      }
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
      const found = body.find((s: { id: string }) => s.id === SAMPLE_STRATEGY.id);
      assert.ok(found, 'sample strategy should appear in list');
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

  describe('POST /api/strategies/import', () => {
    it('imports a strategy via import endpoint', async () => {
      const importStrategy = {
        ...SAMPLE_STRATEGY,
        id: 'imported-strategy-v1',
        name: 'Imported Strategy',
      };
      const res = await fetchApi(ctx.baseUrl, '/api/strategies/import', {
        method: 'POST',
        body: JSON.stringify(importStrategy),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.imported, true);
      assert.equal(body.id, importStrategy.id);
    });

    it('skips import of same version', async () => {
      const sameStrategy = {
        ...SAMPLE_STRATEGY,
        id: 'imported-strategy-v1',
        name: 'Imported Strategy',
      };
      const res = await fetchApi(ctx.baseUrl, '/api/strategies/import', {
        method: 'POST',
        body: JSON.stringify(sameStrategy),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.imported, false);
    });
  });

  describe('PATCH /api/strategies/:id', () => {
    it('toggles is_default on an existing strategy', async () => {
      // Sample strategy was created above with is_default omitted → default false
      const before = await fetchApi(ctx.baseUrl, `/api/strategies/${SAMPLE_STRATEGY.id}`);
      assert.equal(before.status, 200);
      const beforeBody = await before.json();
      assert.equal(beforeBody.is_default, false);

      const patch = await fetchApi(ctx.baseUrl, `/api/strategies/${SAMPLE_STRATEGY.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_default: true }),
      });
      assert.equal(patch.status, 200);
      const patchBody = await patch.json();
      assert.equal(patchBody.updated, true);

      const after = await fetchApi(ctx.baseUrl, `/api/strategies/${SAMPLE_STRATEGY.id}`);
      const afterBody = await after.json();
      assert.equal(afterBody.is_default, true);
    });

    it('returns 404 for unknown id', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/strategies/does-not-exist', {
        method: 'PATCH',
        body: JSON.stringify({ is_default: true }),
      });
      assert.equal(res.status, 404);
    });

    it('rejects body with no updatable fields', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/strategies/${SAMPLE_STRATEGY.id}`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
    });

    it('rejects non-boolean is_default', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/strategies/${SAMPLE_STRATEGY.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_default: 'yes' }),
      });
      assert.equal(res.status, 400);
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
