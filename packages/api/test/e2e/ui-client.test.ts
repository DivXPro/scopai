import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { startServer } from './helpers';
import type { TestContext } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamically import UI client to bypass tsx CJS cross-package resolution
type ClientModule = typeof import('../../../ui/src/api/client.ts');

let ctx: TestContext;
let apiGet: ClientModule['apiGet'];
let apiPost: ClientModule['apiPost'];
let apiDelete: ClientModule['apiDelete'];
let setApiBase: ClientModule['setApiBase'];

describe('UI API Client', () => {
  before(async () => {
    ctx = await startServer();
    const client = await import(path.resolve(__dirname, '../../../ui/src/api/client.ts')) as ClientModule;
    apiGet = client.apiGet;
    apiPost = client.apiPost;
    apiDelete = client.apiDelete;
    setApiBase = client.setApiBase;
    setApiBase(ctx.baseUrl);
  });

  after(async () => {
    setApiBase('');
    await ctx.cleanup();
  });

  describe('URL construction', () => {
    it('apiGet constructs correct absolute URL with API_BASE', async () => {
      const result = await apiGet<{ pid: number; db_path: string }>('/api/status');
      assert.equal(typeof result.pid, 'number');
      assert.ok(result.db_path);
    });

    it('does not double-prefix /api paths', async () => {
      // Regression: if API_BASE were '/api', '/api/status' would become '/api/api/status' → 404
      const result = await apiGet('/api/status');
      assert.ok(result);
    });
  });

  describe('Content-Type header logic', () => {
    it('apiGet does not send Content-Type', async () => {
      // Previously always set Content-Type: application/json, causing FST_ERR_CTP_EMPTY_JSON_BODY
      const result = await apiGet('/api/platforms');
      assert.ok(Array.isArray(result));
    });

    it('apiPost with body sends Content-Type: application/json', async () => {
      const result = await apiPost<{ id: string }>('/api/strategies', {
        id: 'ct-test-strategy',
        name: 'Content-Type Test',
        version: '1.0.0',
        target: 'post',
        needs_media: { enabled: false },
        prompt: 'Test',
        output_schema: { type: 'object', properties: { r: { type: 'string', title: '结果' } } },
      });
      assert.equal(result.id, 'ct-test-strategy');
    });

    it('apiPost without body does not send Content-Type', async () => {
      const result = await apiPost<{ retried: number }>('/api/queue/retry');
      assert.equal(typeof result.retried, 'number');
    });

    it('apiDelete does not send Content-Type', async () => {
      const result = await apiDelete<{ deleted: boolean }>('/api/strategies/ct-test-strategy');
      assert.equal(result.deleted, true);
    });
  });

  describe('Error parsing', () => {
    it('apiGet throws on 404', async () => {
      await assert.rejects(
        () => apiGet('/api/tasks/nonexistent-id'),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          return true;
        },
      );
    });

    it('apiGet throws on 400', async () => {
      const task = await apiPost<{ id: string }>('/api/tasks', { name: 'Error Test Task' });
      await assert.rejects(
        () => apiGet(`/api/tasks/${task.id}/results`),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          return true;
        },
      );
    });

    it('apiPost throws on validation error', async () => {
      await assert.rejects(
        () => apiPost('/api/strategies', { name: 'Missing id field' }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          return true;
        },
      );
    });
  });

  describe('Function wrappers', () => {
    it('apiGet returns parsed JSON, not Response', async () => {
      const result = await apiGet('/api/platforms');
      assert.ok(Array.isArray(result));
      assert.equal(typeof (result as unknown as { json?: unknown }).json, 'undefined');
    });

    it('apiPost auto-stringifies body', async () => {
      const result = await apiPost<{ id: string }>('/api/strategies', {
        id: 'stringify-test-strategy',
        name: 'Stringify Test',
        version: '1.0.0',
        target: 'post',
        needs_media: { enabled: false },
        prompt: 'Test',
        output_schema: { type: 'object', properties: { x: { type: 'string', title: '结果' } } },
      });
      assert.equal(result.id, 'stringify-test-strategy');
    });

    it('apiDelete returns parsed JSON', async () => {
      const result = await apiDelete<{ deleted: boolean }>('/api/strategies/stringify-test-strategy');
      assert.equal(result.deleted, true);
      assert.equal(typeof (result as unknown as { json?: unknown }).json, 'undefined');
    });
  });
});