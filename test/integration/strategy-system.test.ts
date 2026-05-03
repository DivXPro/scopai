import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../packages/core/dist/db/client.js';
const { query, close: closeDb } = db;
import * as migrate from '../../packages/core/dist/db/migrate.js';
const { runMigrations } = migrate;
import * as strategies from '../../packages/core/dist/db/strategies.js';
const { createStrategy, getStrategyById, validateStrategyJson, getStrategyResultTableName, parseJsonSchemaToColumns, createStrategyResultTable } = strategies;
import * as postsMod from '../../packages/core/dist/db/posts.js';
const { createPost } = postsMod;
import * as platformsMod from '../../packages/core/dist/db/platforms.js';
const { createPlatform } = platformsMod;
import * as tasksMod from '../../packages/core/dist/db/tasks.js';
const { createTask } = tasksMod;
import * as anthropic from '../../packages/api/src/worker/anthropic.ts';
const { buildStrategyPrompt } = anthropic;
import * as queueJobs from '../../packages/core/dist/db/queue-jobs.js';
const { syncWaitingMediaJobs } = queueJobs;
import {
  insertStrategyResult,
  listStrategyResultsByTask,
  getExistingResultIds,
} from '../../packages/core/dist/db/analysis-results.js';
import * as testPath from 'path';
import * as testFs from 'fs';
import { getHandlers } from '../../packages/api/src/daemon/handlers.ts';
import { parseStrategyResult } from '../../packages/api/src/worker/parser.ts';

describe('strategy system', { timeout: 15000 }, () => {
  before(async () => {
    closeDb();
    await runMigrations();
    // Clean up child tables first to avoid FK constraint errors
    await query("DELETE FROM queue_jobs WHERE task_id = 'daemon-analyze-task'");
    await query("DELETE FROM queue_jobs WHERE id = 'test-waiting-media-job'");
    await query("DELETE FROM queue_jobs WHERE id = 'sync-job-1'");
    await query("DELETE FROM queue_jobs WHERE task_id LIKE 'e2e-task-%'");
    await query("DELETE FROM queue_jobs WHERE task_id = 'test-task'");
    await query("DELETE FROM task_targets WHERE task_id = 'daemon-analyze-task'");
    await query("DELETE FROM task_targets WHERE task_id LIKE 'e2e-task-%'");
    await query("DELETE FROM task_targets WHERE task_id = 'test-task'");
    await query("DELETE FROM task_steps WHERE task_id = 'test-task'");
    await query("DELETE FROM task_steps WHERE task_id = 'daemon-analyze-task'");
    await query("DELETE FROM task_steps WHERE task_id LIKE 'e2e-task-%'");
    await query("DELETE FROM task_steps WHERE strategy_id = 'e2e-secondary-strategy'");
    await query("DELETE FROM comments WHERE platform_id LIKE 'e2e_%'");
    await query("DELETE FROM media_files WHERE platform_id LIKE 'e2e_%'");
    await query("DELETE FROM posts WHERE platform_id LIKE 'plt_%'");
    await query("DELETE FROM posts WHERE platform_id LIKE 'e2e_%'");
    await query("DELETE FROM tasks WHERE id = 'test-task'");
    await query("DELETE FROM tasks WHERE id = 'daemon-analyze-task'");
    await query("DELETE FROM tasks WHERE id LIKE 'e2e-task-%'");
    await query("DELETE FROM strategies WHERE id = 'test-strategy-1'");
    await query("DELETE FROM strategies WHERE id = 'daemon-strategy-1'");
    await query("DELETE FROM strategies WHERE id = 'e2e-secondary-strategy'");
    await query("DELETE FROM strategies WHERE id LIKE 'e2e-%'");
    await query("DELETE FROM platforms WHERE name = 'Test Platform'");
    await query("DELETE FROM platforms WHERE id LIKE 'e2e_%'");
  });

  it('should have strategies table', async () => {
    const rows = await query("SELECT table_name FROM information_schema.tables WHERE table_name = 'strategies'");
    assert.equal(rows.length, 1);
  });

  it('should have queue_jobs.strategy_id column', async () => {
    const rows = await query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'queue_jobs' AND column_name = 'strategy_id'"
    );
    assert.equal(rows.length, 1);
  });

  it('should have expected columns in strategies table', async () => {
    const rows = await query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'strategies'"
    );
    const columns = rows.map(r => r.column_name);
    assert.ok(columns.includes('id'));
    assert.ok(columns.includes('name'));
    assert.ok(columns.includes('target'));
  });

  it('should allow queue_jobs status waiting_media', async () => {
    await query("INSERT INTO tasks (id, name, status) VALUES ('test-task', 'Test Task', 'pending')");
    const rows = await query<{ status: string }>(
      "INSERT INTO queue_jobs (id, task_id, status) VALUES ('test-waiting-media-job', 'test-task', 'waiting_media') RETURNING status"
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, 'waiting_media');
  });

  it('should import strategy types without error', async () => {
    const { Strategy } = await import('../../packages/core/dist/shared/types.js');
    assert.ok(Strategy === undefined);
  });

  it('should create and retrieve a strategy', async () => {
    const strategy = {
      id: 'test-strategy-1',
      name: 'Test Strategy',
      description: 'A test strategy',
      version: '1.0.0',
      target: 'post' as const,
      needs_media: { enabled: false },
      prompt: 'Analyze {{content}}',
      output_schema: { type: 'object', properties: {} },
      depends_on: null as 'post' | 'comment' | null,
      include_original: false,
      file_path: null,
    };
    await createStrategy(strategy);
    const found = await getStrategyById('test-strategy-1');
    assert.ok(found);
    assert.equal(found.name, 'Test Strategy');
    assert.deepEqual(found.needs_media, { enabled: false });
    assert.deepEqual(found.output_schema, { type: 'object', properties: {} });

    // Result table should be auto-created
    const tables = await query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'analysis_results_strategy_test-strategy-1'"
    );
    assert.strictEqual(tables.length, 1, 'strategy result table should be auto-created');
  });

  it('should validate strategy JSON', () => {
    assert.ok(validateStrategyJson({ id: 's', name: 'S', version: '1.0.0', target: 'post', prompt: 'P', output_schema: { type: 'object', properties: {} } }).valid);
    assert.ok(!validateStrategyJson({ name: 'S' }).valid);
    assert.ok(!validateStrategyJson({ id: null, name: 'S', version: '1.0.0', target: 'post', prompt: 'P', output_schema: { type: 'object', properties: {} } }).valid);
  });

  it('should reject invalid target in validateStrategyJson', () => {
    const result = validateStrategyJson({ id: 's', name: 'S', version: '1.0.0', target: 'user', prompt: 'P', output_schema: { type: 'object', properties: {} } });
    assert.ok(!result.valid);
    assert.ok(result.error?.includes("Invalid target"));
  });

  it('should build strategy prompt with media placeholders', async () => {
    const platformId = `plt_${Date.now()}`;
    await createPlatform({ id: platformId, name: 'Test Platform', description: null });
    const post = await createPost({
      platform_id: platformId,
      platform_post_id: 'p1',
      title: 'Title',
      content: 'Hello world',
      author_id: null,
      author_name: 'Alice',
      author_url: null,
      url: null,
      cover_url: null,
      post_type: 'text',
      like_count: 0,
      collect_count: 0,
      comment_count: 0,
      share_count: 0,
      play_count: 0,
      score: null,
      tags: null,
      media_files: null,
      published_at: new Date('2024-01-01'),
      metadata: null,
    });

    const strategy = {
      id: 'prompt-test',
      name: 'Prompt Test',
      description: null,
      version: '1.0.0',
      target: 'post' as const,
      needs_media: { enabled: false },
      prompt: 'Content: {{content}} Author: {{author_name}}',
      output_schema: { type: 'object', properties: {} },
      file_path: null,
    };

    const prompt = await buildStrategyPrompt(post, strategy as any);
    assert.ok(prompt.includes('Hello world'));
    assert.ok(prompt.includes('Alice'));
  });

  it('should sync waiting_media jobs to pending', async () => {
    await query("INSERT INTO queue_jobs (id, task_id, target_id, status) VALUES ('sync-job-1', 'test-task', 'post-sync', 'waiting_media')");
    const count = await syncWaitingMediaJobs('test-task', 'post-sync');
    assert.equal(count, 1);
    const rows = await query<{ status: string }>("SELECT status FROM queue_jobs WHERE id = 'sync-job-1'");
    assert.equal(rows[0].status, 'pending');
  });

  it('should import strategy via daemon', async () => {
    const strategyFile = testPath.join(process.cwd(), 'test-data', 'mock', 'test-strategy-daemon.json');
    testFs.writeFileSync(strategyFile, JSON.stringify({
      id: 'daemon-strategy-1',
      name: 'Daemon Strategy',
      version: '1.0.0',
      target: 'post',
      prompt: 'Analyze: {{content}}',
      output_schema: {
        type: 'object',
        properties: {
          score: { type: 'number' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    }));
    try {
      const handlers = getHandlers();
      const result = await handlers['strategy.import']({ file: strategyFile }) as any;
      assert.equal(result.imported, true);
    } finally {
      testFs.unlinkSync(strategyFile);
    }
  });

  it('should list strategies via daemon', async () => {
    const handlers = getHandlers();
    const result = await handlers['strategy.list']() as any[];
    const ids = result.map((s: any) => s.id);
    assert.ok(ids.includes('daemon-strategy-1'));
  });

  it('should show strategy via daemon', async () => {
    const handlers = getHandlers();
    const result = await handlers['strategy.show']({ id: 'daemon-strategy-1' }) as any;
    assert.equal(result.id, 'daemon-strategy-1');
    assert.equal(result.name, 'Daemon Strategy');
  });

  it('should generate table name from strategy id', () => {
    assert.equal(getStrategyResultTableName('sentiment_v1'), 'analysis_results_strategy_sentiment_v1');
  });

  it('should reject illegal strategy ids', () => {
    assert.throws(() => getStrategyResultTableName('bad;id'), /Strategy ID must only contain/);
  });

  it('should parse JSON Schema to columns', () => {
    const schema = {
      type: 'object',
      properties: {
        score: { type: 'number' },
        level: { type: 'string', enum: ['low', 'medium', 'high'] },
        tags: { type: 'array', items: { type: 'string' } },
        scores: { type: 'array', items: { type: 'number' } },
        mixed: { type: 'array' },
        meta: { type: 'object' },
      },
    };
    const cols = parseJsonSchemaToColumns(schema);
    assert.equal(cols.find(c => c.name === 'score')?.sqlType, 'DOUBLE');
    assert.equal(cols.find(c => c.name === 'level')?.sqlType, 'TEXT');
    assert.equal(cols.find(c => c.name === 'tags')?.sqlType, 'VARCHAR[]');
    assert.equal(cols.find(c => c.name === 'scores')?.sqlType, 'DOUBLE[]');
    assert.equal(cols.find(c => c.name === 'mixed')?.sqlType, 'JSON');
    assert.equal(cols.find(c => c.name === 'meta')?.sqlType, 'JSON');
    assert.ok(cols.find(c => c.name === 'score')?.indexable);
    assert.ok(cols.find(c => c.name === 'level')?.indexable);
    assert.ok(!cols.find(c => c.name === 'tags')?.indexable);
  });

  it('should create a strategy result table', async () => {
    await createStrategyResultTable('test_schema_1', [
      { name: 'score', sqlType: 'DOUBLE', indexable: true },
      { name: 'level', sqlType: 'TEXT', indexable: true },
    ]);
    const rows = await query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'analysis_results_strategy_test_schema_1'"
    );
    assert.equal(rows.length, 1);
  });

  it('should reject invalid sqlType when creating table', async () => {
    await assert.rejects(
      () => createStrategyResultTable('test_bad_type', [{ name: 'evil', sqlType: 'TEXT; DROP TABLE strategies; --', indexable: false }]),
      /Invalid sqlType/
    );
  });

  it('should sync new columns and reject type changes', async () => {
    const { syncStrategyResultTable } = strategies;
    await syncStrategyResultTable('test_schema_1', [
      { name: 'score', sqlType: 'DOUBLE', indexable: true },
      { name: 'level', sqlType: 'TEXT', indexable: true },
      { name: 'tags', sqlType: 'VARCHAR[]', indexable: false },
    ]);
    const cols = await query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'analysis_results_strategy_test_schema_1'"
    );
    assert.ok(cols.some(c => c.column_name === 'tags'));

    await assert.rejects(
      () => syncStrategyResultTable('test_schema_1', [{ name: 'score', sqlType: 'TEXT', indexable: false }]),
      /DuckDB does not support ALTER COLUMN/
    );
  });

  it('should parse strategy result with JSON Schema', async () => {
    const schema = {
      type: 'object',
      properties: {
        score: { type: 'number' },
        level: { type: 'string', enum: ['low', 'medium', 'high'] },
        tags: { type: 'array', items: { type: 'string' } },
        summary: { type: 'string' },
        verified: { type: 'boolean' },
      },
    };
    const raw = JSON.stringify({ score: 4.5, level: 'medium', tags: ['a', 'b'], summary: 'ok', verified: true });
    const result = parseStrategyResult(raw, schema);
    assert.equal(result.values.score, 4.5);
    assert.equal(result.values.level, 'medium');
    assert.deepEqual(result.values.tags, ['a', 'b']);
    assert.equal(result.values.summary, 'ok');
    assert.equal(result.values.verified, true);
  });

  it('should handle missing fields with defaults', async () => {
    const schema = {
      type: 'object',
      properties: {
        score: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    const result = parseStrategyResult('{}', schema);
    assert.equal(result.values.score, null);
    assert.deepEqual(result.values.tags, []);
  });

  it('should coerce boolean values', async () => {
    const schema = {
      type: 'object',
      properties: {
        active: { type: 'boolean' },
      },
    };
    assert.equal(parseStrategyResult('{"active": true}', schema).values.active, true);
    assert.equal(parseStrategyResult('{"active": "true"}', schema).values.active, true);
    assert.equal(parseStrategyResult('{"active": 1}', schema).values.active, true);
    assert.equal(parseStrategyResult('{"active": false}', schema).values.active, false);
    assert.equal(parseStrategyResult('{"active": "false"}', schema).values.active, false);
    assert.equal(parseStrategyResult('{"active": 0}', schema).values.active, false);
    assert.equal(parseStrategyResult('{"active": "maybe"}', schema).values.active, null);
  });

  it('should wrap scalar into array', async () => {
    const schema = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    const result = parseStrategyResult('{"tags": "a"}', schema);
    assert.deepEqual(result.values.tags, ['a']);
  });

  it('should coerce integer values strictly', async () => {
    const schema = {
      type: 'object',
      properties: {
        count: { type: 'integer' },
      },
    };
    assert.equal(parseStrategyResult('{"count": 5}', schema).values.count, 5);
    assert.equal(parseStrategyResult('{"count": "7"}', schema).values.count, 7);
    assert.equal(parseStrategyResult('{"count": 5.5}', schema).values.count, null);
    assert.equal(parseStrategyResult('{"count": "abc"}', schema).values.count, null);
  });

  it('should handle invalid JSON gracefully', async () => {
    const schema = {
      type: 'object',
      properties: {
        score: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
      },
    };
    const result = parseStrategyResult('not json at all', schema);
    assert.equal(result.values.score, null);
    assert.deepEqual(result.values.tags, []);
    assert.deepEqual(result.raw, {});
  });

  it('should extract JSON from markdown code block', async () => {
    const schema = {
      type: 'object',
      properties: {
        score: { type: 'number' },
      },
    };
    const raw = 'Here is the result:\n```json\n{"score": 9.5}\n```';
    const result = parseStrategyResult(raw, schema);
    assert.equal(result.values.score, 9.5);
  });

  it('should insert and list strategy results dynamically', async () => {
    const taskId = `dyn-task-${Date.now()}`;
    const targetId = `dyn-post-${Date.now()}`;
    await insertStrategyResult('test_schema_1', {
      task_id: taskId,
      target_type: 'post',
      target_id: targetId,
      post_id: targetId,
      strategy_version: '1.0.0',
      raw_response: { score: 5 },
      error: null,
      analyzed_at: new Date(),
    }, ['score', 'level'], [4.5, 'high']);

    const rows = await listStrategyResultsByTask('test_schema_1', taskId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].score, 4.5);
    assert.equal(rows[0].level, 'high');
  });

  it('should list strategy results via daemon', async () => {
    const handlers = getHandlers();
    const rows = await handlers['strategy.result.list']({ task_id: 'task-1', strategy_id: 'test_schema_1' }) as any[];
    assert.ok(Array.isArray(rows));
  });

  it('should get strategy result stats via daemon', async () => {
    const handlers = getHandlers();
    const stats = await handlers['strategy.result.stats']({ task_id: 'task-1', strategy_id: 'test_schema_1' }) as any;
    assert.equal(typeof stats.total, 'number');
  });

  it('should export strategy results via daemon', async () => {
    const handlers = getHandlers();
    const result = await handlers['strategy.result.export']({ task_id: 'task-1', strategy_id: 'test_schema_1', format: 'json' }) as any;
    assert.ok(typeof result.content === 'string');
    assert.ok(result.count >= 0);
  });

  it('should run e2e: import strategy, create task, add post, analyze run', async () => {
    const platformId = `e2e_${Date.now()}`;
    await createPlatform({ id: platformId, name: 'E2E Platform', description: null });
    const post = await createPost({
      platform_id: platformId,
      platform_post_id: 'e2e_post_1',
      title: 'E2E Post',
      content: 'This is an e2e test post',
      author_id: null,
      author_name: 'Bot',
      author_url: null,
      url: null,
      cover_url: null,
      post_type: 'text',
      like_count: 0, collect_count: 0, comment_count: 0, share_count: 0, play_count: 0,
      score: null, tags: null, media_files: null,
      published_at: new Date(), metadata: null,
    });

    const taskId = `e2e-task-${Date.now()}`;
    await createTask({
      id: taskId, name: 'E2E Task', description: null, cli_templates: null,
      status: 'pending', stats: { total: 0, done: 0, failed: 0 },
      created_at: new Date(), updated_at: new Date(), completed_at: null,
    });
    const { addTaskTargets } = await import('../../packages/core/dist/db/task-targets.js');
    await addTaskTargets(taskId, 'post', [post.id]);

    const strategyId = `e2e-strategy-${Date.now()}`;
    const strategyFile = testPath.join(process.cwd(), 'test-data', 'mock', `e2e-strategy-${Date.now()}.json`);
    testFs.writeFileSync(strategyFile, JSON.stringify({
      id: strategyId,
      name: 'E2E Strategy',
      target: 'post',
      version: '1.0.0',
      prompt: 'Analyze post: {{content}}',
      output_schema: {
        type: 'object',
        properties: {
          score: { type: 'number' },
          tags: { type: 'array', items: { type: 'string' } },
        },
      },
    }));

    const handlers = getHandlers();
    const importResult = await handlers['strategy.import']({ file: strategyFile }) as any;
    assert.equal(importResult.imported, true);

    const runResult = await handlers['analyze.run']({ task_id: taskId, strategy: strategyId }) as any;
    assert.equal(runResult.enqueued, 1);

    const jobs = await query('SELECT * FROM queue_jobs WHERE task_id = ? AND strategy_id = ?', [taskId, strategyId]);
    assert.equal(jobs.length, 1);
    assert.ok(jobs[0].status === 'pending' || jobs[0].status === 'waiting_media');

    testFs.unlinkSync(strategyFile);
  });

  it('should have depends_on and include_original columns in strategies table', async () => {
    const rows = await query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'strategies' AND column_name IN ('depends_on', 'include_original')"
    );
    const columns = rows.map(r => r.column_name);
    assert.ok(columns.includes('depends_on'));
    assert.ok(columns.includes('include_original'));
  });

  it('should have depends_on_step_id column in task_steps table', async () => {
    const rows = await query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'task_steps' AND column_name = 'depends_on_step_id'"
    );
    assert.equal(rows.length, 1);
  });

  it('should validate depends_on field', async () => {
    const valid = validateStrategyJson({
      id: 'test-secondary',
      name: 'Secondary Strategy',
      version: '1.0.0',
      target: 'post',
      depends_on: 'post',
      include_original: true,
      prompt: 'Based on: {{upstream_result}}\n\nOriginal: {{original_content}}',
      output_schema: {
        type: 'object',
        properties: {
          risk_level: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['risk_level'],
      },
    });
    assert.equal(valid.valid, true);
  });

  it('should reject invalid depends_on value', async () => {
    const result = validateStrategyJson({
      id: 'test-bad-depends',
      name: 'Bad Depends',
      version: '1.0.0',
      target: 'post',
      depends_on: 'invalid',
      prompt: 'test',
      output_schema: { type: 'object', properties: { x: { type: 'string' } } },
    });
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('depends_on'));
  });

  it('should create a secondary strategy with depends_on', async () => {
    await createStrategy({
      id: 'e2e-secondary-strategy',
      name: 'Risk Judgment',
      description: 'Judge risk based on scoring results',
      version: '1.0.0',
      target: 'post',
      needs_media: null,
      prompt: 'Based on scoring result:\n{{upstream_result}}\n\nJudge the risk level.',
      output_schema: {
        type: 'object',
        properties: {
          risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          explanation: { type: 'string' },
        },
        required: ['risk_level', 'explanation'],
      },
      batch_config: null,
      depends_on: 'post',
      include_original: true,
      file_path: null,
    });

    const strategy = await getStrategyById('e2e-secondary-strategy');
    assert.ok(strategy);
    assert.equal(strategy.depends_on, 'post');
    assert.equal(strategy.include_original, true);
  });

  it('should add step with depends_on_step_id', async () => {
    const { createTaskStep } = await import('../../packages/core/dist/db/task-steps.js');
    const step = await createTaskStep({
      task_id: 'test-task',
      strategy_id: 'e2e-secondary-strategy',
      depends_on_step_id: null,
      name: 'Secondary step',
      step_order: 2,
      status: 'pending',
      stats: { total: 0, done: 0, failed: 0 },
      error: null,
    });
    assert.ok(step.id);
    assert.equal(step.depends_on_step_id, null);
  });

  after(async () => {
    // Clean up child tables first to avoid FK constraint errors
    await query("DELETE FROM analysis_results_strategy_test_schema_1 WHERE task_id = 'task-1'");
    await query("DELETE FROM queue_jobs WHERE task_id = 'daemon-analyze-task'");
    await query("DELETE FROM queue_jobs WHERE id = 'test-waiting-media-job'");
    await query("DELETE FROM queue_jobs WHERE id = 'sync-job-1'");
    await query("DELETE FROM queue_jobs WHERE task_id LIKE 'e2e-task-%'");
    await query("DELETE FROM queue_jobs WHERE task_id = 'test-task'");
    await query("DELETE FROM task_targets WHERE task_id = 'daemon-analyze-task'");
    await query("DELETE FROM task_targets WHERE task_id LIKE 'e2e-task-%'");
    await query("DELETE FROM task_targets WHERE task_id = 'test-task'");
    await query("DELETE FROM task_steps WHERE task_id = 'test-task'");
    await query("DELETE FROM task_steps WHERE task_id = 'daemon-analyze-task'");
    await query("DELETE FROM task_steps WHERE task_id LIKE 'e2e-task-%'");
    await query("DELETE FROM task_steps WHERE strategy_id = 'e2e-secondary-strategy'");
    await query("DELETE FROM comments WHERE platform_id LIKE 'e2e_%'");
    await query("DELETE FROM media_files WHERE platform_id LIKE 'e2e_%'");
    await query("DELETE FROM posts WHERE platform_id LIKE 'plt_%'");
    await query("DELETE FROM posts WHERE platform_id LIKE 'e2e_%'");
    await query("DELETE FROM tasks WHERE id = 'test-task'");
    await query("DELETE FROM tasks WHERE id = 'daemon-analyze-task'");
    await query("DELETE FROM tasks WHERE id LIKE 'e2e-task-%'");
    await query("DELETE FROM strategies WHERE id = 'test-strategy-1'");
    await query("DELETE FROM strategies WHERE id = 'e2e-secondary-strategy'");
    await query("DELETE FROM strategies WHERE id = 'daemon-strategy-1'");
    await query("DELETE FROM strategies WHERE id LIKE 'e2e-%'");
    await query("DELETE FROM platforms WHERE name = 'Test Platform'");
    await query("DELETE FROM platforms WHERE id LIKE 'e2e_%'");
  });
});
