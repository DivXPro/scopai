import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fetchApi } from './helpers';
import type { TestContext } from './helpers';

let ctx: TestContext;

describe('Missing endpoints', () => {
  before(async () => {
    ctx = await startServer();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('Platforms mappings', () => {
    it('GET /api/platforms/:id/mappings returns field mappings', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/platforms/xiaohongshu/mappings');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body));
    });

    it('GET /api/platforms/:id/mappings filters by entity', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/platforms/xiaohongshu/mappings?entity=post');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body));
    });
  });

  describe('Task steps GET and reset', () => {
    let stepTaskId: string;
    let stepId: string;

    before(async () => {
      // Create strategy
      const stratRes = await fetchApi(ctx.baseUrl, '/api/strategies', {
        method: 'POST',
        body: JSON.stringify({
          id: 'get-step-strategy',
          name: 'Get Step Strategy',
          version: '1.0.0',
          target: 'post',
          needs_media: { enabled: false },
          prompt: 'Test',
          output_schema: { type: 'object', properties: { score: { type: 'number', title: '评分' } } },
        }),
      });
      assert.equal(stratRes.status, 200);

      // Create task
      const taskRes = await fetchApi(ctx.baseUrl, '/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ name: 'Step Get Test' }),
      });
      const taskBody = await taskRes.json();
      stepTaskId = taskBody.id;

      // Add step
      const stepRes = await fetchApi(ctx.baseUrl, `/api/tasks/${stepTaskId}/steps`, {
        method: 'POST',
        body: JSON.stringify({ strategy_id: 'get-step-strategy', name: 'Test Step' }),
      });
      const stepBody = await stepRes.json();
      stepId = stepBody.stepId;
    });

    it('GET /api/tasks/:id/steps returns steps', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${stepTaskId}/steps`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body));
      assert.equal(body.length, 1);
      assert.equal(body[0].id, stepId);
    });

    it('POST /api/tasks/:id/steps/:stepId/reset resets step', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${stepTaskId}/steps/${stepId}/reset`, {
        method: 'POST',
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.reset, true);
    });
  });

  describe('Analyze route', () => {
    let analyzeTaskId: string;

    before(async () => {
      const stratRes = await fetchApi(ctx.baseUrl, '/api/strategies', {
        method: 'POST',
        body: JSON.stringify({
          id: 'analyze-test-strategy',
          name: 'Analyze Test Strategy',
          version: '1.0.0',
          target: 'post',
          needs_media: { enabled: false },
          prompt: 'Test',
          output_schema: { type: 'object', properties: { ok: { type: 'boolean', title: '结果' } } },
        }),
      });
      assert.equal(stratRes.status, 200);

      const taskRes = await fetchApi(ctx.baseUrl, '/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ name: 'Analyze Test' }),
      });
      const taskBody = await taskRes.json();
      analyzeTaskId = taskBody.id;

      // Add a post target
      await fetchApi(ctx.baseUrl, `/api/tasks/${analyzeTaskId}/add-posts`, {
        method: 'POST',
        body: JSON.stringify({ post_ids: ['post-analyze-1'] }),
      });
    });

    it('POST /api/analyze/run requires task_id and strategy_id', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/analyze/run', {
        method: 'POST',
        body: JSON.stringify({}),
      });
      assert.equal(res.status, 400);
    });

    it('POST /api/analyze/run enqueues jobs', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/analyze/run', {
        method: 'POST',
        body: JSON.stringify({
          task_id: analyzeTaskId,
          strategy_id: 'analyze-test-strategy',
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(typeof body.enqueued, 'number');
      assert.equal(body.enqueued, 1);
    });
  });

  describe('Strategy stats, export, aggregate', () => {
    let statTaskId: string;
    const strategyId = 'stats-test-strategy';

    before(async () => {
      const stratRes = await fetchApi(ctx.baseUrl, '/api/strategies', {
        method: 'POST',
        body: JSON.stringify({
          id: strategyId,
          name: 'Stats Test Strategy',
          version: '1.0.0',
          target: 'post',
          needs_media: { enabled: false },
          prompt: 'Test',
          output_schema: { type: 'object', properties: { score: { type: 'number', title: '评分' } } },
        }),
      });
      assert.equal(stratRes.status, 200);

      const taskRes = await fetchApi(ctx.baseUrl, '/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ name: 'Stats Test' }),
      });
      const taskBody = await taskRes.json();
      statTaskId = taskBody.id;
    });

    it('GET /api/strategies/:id/stats requires task_id', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/strategies/${strategyId}/stats`);
      assert.equal(res.status, 400);
    });

    it('GET /api/strategies/:id/stats returns stats', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/strategies/${strategyId}/stats?task_id=${statTaskId}`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(typeof body.total, 'number');
    });

    it('GET /api/strategies/:id/full-stats returns full stats', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/strategies/${strategyId}/full-stats?task_id=${statTaskId}`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(typeof body.total, 'number');
      assert.ok(body.numeric || body.text || body.array);
    });

    it('POST /api/strategies/:id/export exports results', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/strategies/${strategyId}/export`, {
        method: 'POST',
        body: JSON.stringify({ task_id: statTaskId, format: 'json' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(typeof body.content === 'string');
      assert.equal(typeof body.count, 'number');
    });

    it('POST /api/strategies/:id/aggregate aggregates results', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/strategies/${strategyId}/aggregate`, {
        method: 'POST',
        body: JSON.stringify({ task_id: statTaskId, field: 'score', agg: 'count' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body));
    });
  });

  describe('Task legacy results and media', () => {
    let legacyTaskId: string;

    before(async () => {
      const taskRes = await fetchApi(ctx.baseUrl, '/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ name: 'Legacy Results Test' }),
      });
      const taskBody = await taskRes.json();
      legacyTaskId = taskBody.id;
    });

    it('GET /api/tasks/:id/media returns empty when no posts', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${legacyTaskId}/media`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.posts));
      assert.equal(body.totalMedia, 0);
    });
  });
});
