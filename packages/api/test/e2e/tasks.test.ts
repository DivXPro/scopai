import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, fetchApi } from './helpers';
import type { TestContext } from './helpers';

let ctx: TestContext;
let taskId: string;

describe('Tasks routes', () => {
  before(async () => {
    ctx = await startServer();
  });

  after(async () => {
    await ctx.cleanup();
  });

  describe('POST /api/tasks', () => {
    it('creates a task', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/tasks', {
        method: 'POST',
        body: JSON.stringify({
          name: 'E2E Test Task',
          description: 'Created by e2e test',
          cli_templates: JSON.stringify({ fetch_note: 'echo {note_id}' }),
        }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.id);
      taskId = body.id;
    });
  });

  describe('GET /api/tasks', () => {
    it('returns task list', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/tasks');
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.items));
      assert.ok(body.items.length >= 1);
      assert.equal(typeof body.total, 'number');
    });
  });

  describe('GET /api/tasks/:id', () => {
    it('returns task detail', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${taskId}`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.name, 'E2E Test Task');
      assert.equal(body.status, 'pending');
      assert.ok(Array.isArray(body.steps));
      assert.ok(Array.isArray(body.jobs));
    });

    it('returns 404 for unknown task', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/tasks/nonexistent');
      assert.equal(res.status, 404);
    });
  });

  describe('POST /api/tasks/:id/start', () => {
    it('starts a task', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${taskId}/start`, {
        method: 'POST',
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'running');
    });
  });

  describe('POST /api/tasks/:id/pause', () => {
    it('pauses a task', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${taskId}/pause`, {
        method: 'POST',
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'paused');
    });
  });

  describe('POST /api/tasks/:id/prepare-data', () => {
    it('queues a prepare-data job', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${taskId}/prepare-data`, {
        method: 'POST',
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.started, true);
      assert.equal(body.status, 'queued');
    });
  });

  describe('POST /api/tasks/:id/add-posts', () => {
    it('queues an add-posts job', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${taskId}/add-posts`, {
        method: 'POST',
        body: JSON.stringify({ post_ids: ['post-1', 'post-2'] }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(typeof body.added, 'number');
    });

    it('rejects empty post_ids', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${taskId}/add-posts`, {
        method: 'POST',
        body: JSON.stringify({ post_ids: [] }),
      });
      assert.equal(res.status, 400);
    });
  });

  describe('POST /api/tasks/:id/resume', () => {
    it('resumes a task', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${taskId}/resume`, {
        method: 'POST',
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'running');
      assert.equal(body.taskId, taskId);
    });
  });

  describe('POST /api/tasks/:id/cancel', () => {
    it('cancels a task', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${taskId}/cancel`, {
        method: 'POST',
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.status, 'cancelled');
    });
  });

  describe('GET /api/tasks/:id/results', () => {
    it('requires strategy_id query param', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${taskId}/results`);
      assert.equal(res.status, 400);
    });

    it('returns results with strategy_id', async () => {
      // Create a strategy first so its result table exists
      const stratRes = await fetchApi(ctx.baseUrl, '/api/strategies', {
        method: 'POST',
        body: JSON.stringify({
          id: 'results-test-strategy',
          name: 'Results Test',
          version: '1.0.0',
          target: 'post',
          needs_media: { enabled: false },
          prompt: 'Test',
          output_schema: { type: 'object', properties: { sentiment: { type: 'string', title: '情感' } } },
        }),
      });
      assert.equal(stratRes.status, 200);

      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${taskId}/results?strategy_id=results-test-strategy`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body.results));
    });
  });

  describe('Task steps', () => {
    const STRATEGY = {
      id: 'step-test-strategy',
      name: 'Step Test Strategy',
      version: '1.0.0',
      target: 'post',
      needs_media: { enabled: false },
      prompt: 'Test prompt',
      output_schema: {
        type: 'object',
        properties: {
          result: { type: 'string', title: '结果' },
        },
      },
    };
    let stepTaskId: string;
    let stepId: string;

    it('creates strategy for step tests', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/strategies', {
        method: 'POST',
        body: JSON.stringify(STRATEGY),
      });
      assert.equal(res.status, 200);
    });

    it('creates a task for step tests', async () => {
      const res = await fetchApi(ctx.baseUrl, '/api/tasks', {
        method: 'POST',
        body: JSON.stringify({ name: 'Step Test Task' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      stepTaskId = body.id;
    });

    it('POST /api/tasks/:id/steps creates a step', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${stepTaskId}/steps`, {
        method: 'POST',
        body: JSON.stringify({ strategy_id: STRATEGY.id, name: 'Analyze Posts' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.stepId);
      assert.equal(typeof body.stepOrder, 'number');
      stepId = body.stepId;
    });

    it('POST /api/tasks/:id/steps rejects missing strategy_id', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${stepTaskId}/steps`, {
        method: 'POST',
        body: JSON.stringify({ name: 'No Strategy' }),
      });
      assert.equal(res.status, 400);
    });

    it('POST /api/tasks/:id/steps/:stepId/run runs a step', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${stepTaskId}/steps/${stepId}/run`, {
        method: 'POST',
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(body.status);
    });

    it('POST /api/tasks/:id/run-all-steps runs all steps', async () => {
      const res = await fetchApi(ctx.baseUrl, `/api/tasks/${stepTaskId}/run-all-steps`, {
        method: 'POST',
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(typeof body.completed, 'number');
      assert.equal(typeof body.failed, 'number');
      assert.equal(typeof body.skipped, 'number');
    });
  });
});
