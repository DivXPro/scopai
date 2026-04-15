import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../dist/db/client.js';
const { query, close: closeDb } = db;
import * as migrate from '../dist/db/migrate.js';
const { runMigrations } = migrate;
import * as strategies from '../dist/db/strategies.js';
const { createStrategy, getStrategyById, validateStrategyJson } = strategies;
import * as analysisResults from '../dist/db/analysis-results.js';
const { createAnalysisResult, getExistingResultIds, listAnalysisResultsByTask } = analysisResults;
import * as parser from '../dist/worker/parser.js';
const { parseStrategyResult } = parser;
import * as postsMod from '../dist/db/posts.js';
const { createPost } = postsMod;
import * as platformsMod from '../dist/db/platforms.js';
const { createPlatform } = platformsMod;
import * as tasksMod from '../dist/db/tasks.js';
const { createTask } = tasksMod;
import * as anthropic from '../dist/worker/anthropic.js';
const { buildStrategyPrompt } = anthropic;
import type { StrategyOutputSchema } from '../dist/shared/types.js';

describe('strategy system', { timeout: 15000 }, () => {
  before(async () => {
    closeDb();
    await runMigrations();
    await query("DELETE FROM analysis_results WHERE task_id = 'test-task'");
    await query("DELETE FROM queue_jobs WHERE id = 'test-waiting-media-job'");
    await query("DELETE FROM tasks WHERE id = 'test-task'");
    await query("DELETE FROM strategies WHERE id = 'test-strategy-1'");
  });

  it('should have strategies table', async () => {
    const rows = await query("SELECT table_name FROM information_schema.tables WHERE table_name = 'strategies'");
    assert.equal(rows.length, 1);
  });

  it('should have analysis_results table', async () => {
    const rows = await query("SELECT table_name FROM information_schema.tables WHERE table_name = 'analysis_results'");
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

  it('should have expected columns in analysis_results table', async () => {
    const rows = await query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'analysis_results'"
    );
    const columns = rows.map(r => r.column_name);
    assert.ok(columns.includes('task_id'));
    assert.ok(columns.includes('strategy_id'));
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
    const { Strategy, StrategyOutputSchema } = await import('../dist/shared/types.js');
    assert.ok(Strategy === undefined); // interfaces are erased at runtime
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
      output_schema: { columns: [], json_fields: [] },
      file_path: null,
    };
    await createStrategy(strategy);
    const found = await getStrategyById('test-strategy-1');
    assert.ok(found);
    assert.equal(found.name, 'Test Strategy');
    assert.deepEqual(found.needs_media, { enabled: false });
    assert.deepEqual(found.output_schema, { columns: [], json_fields: [] });
  });

  it('should validate strategy JSON', () => {
    assert.ok(validateStrategyJson({ id: 's', name: 'S', version: '1.0.0', target: 'post', prompt: 'P', output_schema: { columns: [], json_fields: [] } }).valid);
    assert.ok(!validateStrategyJson({ name: 'S' }).valid);
    assert.ok(!validateStrategyJson({ id: null, name: 'S', version: '1.0.0', target: 'post', prompt: 'P', output_schema: { columns: [], json_fields: [] } }).valid);
  });

  it('should reject invalid target in validateStrategyJson', () => {
    const result = validateStrategyJson({ id: 's', name: 'S', version: '1.0.0', target: 'user', prompt: 'P', output_schema: { columns: [], json_fields: [] } });
    assert.ok(!result.valid);
    assert.ok(result.error?.includes("Invalid target"));
  });

  it('should create an analysis result and retrieve existing result ids', async () => {
    await createAnalysisResult({
      task_id: 'test-task',
      strategy_id: 'test-strategy-1',
      strategy_version: '1.0.0',
      target_type: 'post',
      target_id: 'post-1',
      post_id: null,
      columns: { sentiment: 'positive' },
      json_fields: { topics: ['a', 'b'] },
      raw_response: null,
      error: null,
      analyzed_at: new Date().toISOString(),
    });
    const existing = await getExistingResultIds('test-task', 'test-strategy-1', 'post', ['post-1', 'post-2']);
    assert.deepEqual(existing, ['post-1']);
  });

  it('should parse columns and json_fields from listAnalysisResultsByTask', async () => {
    const results = await listAnalysisResultsByTask('test-task');
    assert.ok(results.length > 0);
    const result = results[0];
    assert.equal(typeof result.columns, 'object');
    assert.equal(typeof result.json_fields, 'object');
    assert.deepEqual(result.columns, { sentiment: 'positive' });
    assert.deepEqual(result.json_fields, { topics: ['a', 'b'] });
  });

  it('should parse strategy result dynamically', async () => {
    const schema: StrategyOutputSchema = {
      columns: [
        { name: 'score', type: 'number', label: 'Score' },
        { name: 'level', type: 'enum', label: 'Level', enum_values: ['low', 'medium', 'high'] },
      ],
      json_fields: [
        { name: 'tags', type: 'array', label: 'Tags' },
        { name: 'summary', type: 'string', label: 'Summary' },
      ],
    };
    const raw = JSON.stringify({ score: 4.5, level: 'medium', tags: ['a', 'b'], summary: 'ok' });
    const result = parseStrategyResult(raw, schema);
    assert.equal(result.columns.score, 4.5);
    assert.equal(result.columns.level, 'medium');
    assert.deepEqual(result.json_fields.tags, ['a', 'b']);
    assert.equal(result.json_fields.summary, 'ok');
  });

  it('should handle missing fields with defaults', async () => {
    const schema: StrategyOutputSchema = {
      columns: [{ name: 'score', type: 'number', label: 'Score' }],
      json_fields: [{ name: 'tags', type: 'array', label: 'Tags' }],
    };
    const result = parseStrategyResult('{}', schema);
    assert.equal(result.columns.score, null);
    assert.deepEqual(result.json_fields.tags, []);
  });

  it('should handle invalid JSON gracefully', async () => {
    const schema: StrategyOutputSchema = {
      columns: [
        { name: 'score', type: 'number', label: 'Score' },
        { name: 'level', type: 'enum', label: 'Level', enum_values: ['low', 'medium', 'high'] },
      ],
      json_fields: [
        { name: 'tags', type: 'array', label: 'Tags' },
        { name: 'summary', type: 'string', label: 'Summary' },
      ],
    };
    const result = parseStrategyResult('not json', schema);
    assert.equal(result.columns.score, null);
    assert.equal(result.columns.level, null);
    assert.deepEqual(result.json_fields.tags, []);
    assert.equal(result.json_fields.summary, null);
  });

  it('should return null for malformed number', async () => {
    const schema: StrategyOutputSchema = {
      columns: [{ name: 'score', type: 'number', label: 'Score' }],
      json_fields: [],
    };
    const result = parseStrategyResult(JSON.stringify({ score: 'n/a' }), schema);
    assert.equal(result.columns.score, null);
  });

  it('should return null for mismatched enum', async () => {
    const schema: StrategyOutputSchema = {
      columns: [{ name: 'level', type: 'enum', label: 'Level', enum_values: ['low', 'medium', 'high'] }],
      json_fields: [],
    };
    const result = parseStrategyResult(JSON.stringify({ level: 'critical' }), schema);
    assert.equal(result.columns.level, null);
  });

  it('should wrap scalar into array when array type expected', async () => {
    const schema: StrategyOutputSchema = {
      columns: [],
      json_fields: [{ name: 'tags', type: 'array', label: 'Tags' }],
    };
    const result = parseStrategyResult(JSON.stringify({ tags: 'a' }), schema);
    assert.deepEqual(result.json_fields.tags, ['a']);
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
      output_schema: { columns: [], json_fields: [] },
      file_path: null,
    };

    const prompt = await buildStrategyPrompt(post, strategy as any);
    assert.ok(prompt.includes('Hello world'));
    assert.ok(prompt.includes('Alice'));
  });

  after(async () => {
    await query("DELETE FROM analysis_results WHERE task_id = 'test-task'");
    await query("DELETE FROM queue_jobs WHERE id = 'test-waiting-media-job'");
    await query("DELETE FROM tasks WHERE id = 'test-task'");
    await query("DELETE FROM strategies WHERE id = 'test-strategy-1'");
  });
});
