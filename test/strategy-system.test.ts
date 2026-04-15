import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../dist/db/client.js';
const { query, close: closeDb } = db;
import * as migrate from '../dist/db/migrate.js';
const { runMigrations } = migrate;
import * as strategies from '../dist/db/strategies.js';
const { createStrategy, getStrategyById, validateStrategyJson } = strategies;
import * as postsMod from '../dist/db/posts.js';
const { createPost } = postsMod;
import * as platformsMod from '../dist/db/platforms.js';
const { createPlatform } = platformsMod;
import * as tasksMod from '../dist/db/tasks.js';
const { createTask } = tasksMod;
import * as anthropic from '../dist/worker/anthropic.js';
const { buildStrategyPrompt } = anthropic;
import * as queueJobs from '../dist/db/queue-jobs.js';
const { syncWaitingMediaJobs } = queueJobs;
import * as testPath from 'path';
import * as testFs from 'fs';
import { getHandlers } from '../dist/daemon/handlers.js';

describe('strategy system', { timeout: 15000 }, () => {
  before(async () => {
    closeDb();
    await runMigrations();
    await query("DELETE FROM queue_jobs WHERE task_id = 'daemon-analyze-task'");
    await query("DELETE FROM task_targets WHERE task_id = 'daemon-analyze-task'");
    await query("DELETE FROM queue_jobs WHERE id = 'test-waiting-media-job'");
    await query("DELETE FROM queue_jobs WHERE id = 'sync-job-1'");
    await query("DELETE FROM queue_jobs WHERE task_id LIKE 'e2e-task-%'");
    await query("DELETE FROM task_targets WHERE task_id LIKE 'e2e-task-%'");
    await query("DELETE FROM comments WHERE platform_id LIKE 'e2e_%'");
    await query("DELETE FROM media_files WHERE platform_id LIKE 'e2e_%'");
    await query("DELETE FROM posts WHERE platform_id LIKE 'plt_%'");
    await query("DELETE FROM posts WHERE platform_id LIKE 'e2e_%'");
    await query("DELETE FROM tasks WHERE id = 'test-task'");
    await query("DELETE FROM tasks WHERE id = 'daemon-analyze-task'");
    await query("DELETE FROM tasks WHERE id LIKE 'e2e-task-%'");
    await query("DELETE FROM strategies WHERE id = 'test-strategy-1'");
    await query("DELETE FROM strategies WHERE id = 'daemon-strategy-1'");
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
    const { Strategy } = await import('../dist/shared/types.js');
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
        columns: [{ name: 'score', type: 'number', label: 'Score' }],
        json_fields: [{ name: 'tags', type: 'array', label: 'Tags' }],
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


  after(async () => {
    await query("DELETE FROM queue_jobs WHERE task_id = 'daemon-analyze-task'");
    await query("DELETE FROM task_targets WHERE task_id = 'daemon-analyze-task'");
    await query("DELETE FROM queue_jobs WHERE id = 'test-waiting-media-job'");
    await query("DELETE FROM queue_jobs WHERE id = 'sync-job-1'");
    await query("DELETE FROM queue_jobs WHERE task_id LIKE 'e2e-task-%'");
    await query("DELETE FROM task_targets WHERE task_id LIKE 'e2e-task-%'");
    await query("DELETE FROM comments WHERE platform_id LIKE 'e2e_%'");
    await query("DELETE FROM media_files WHERE platform_id LIKE 'e2e_%'");
    await query("DELETE FROM posts WHERE platform_id LIKE 'plt_%'");
    await query("DELETE FROM posts WHERE platform_id LIKE 'e2e_%'");
    await query("DELETE FROM tasks WHERE id = 'test-task'");
    await query("DELETE FROM tasks WHERE id = 'daemon-analyze-task'");
    await query("DELETE FROM tasks WHERE id LIKE 'e2e-task-%'");
    await query("DELETE FROM strategies WHERE id = 'test-strategy-1'");
    await query("DELETE FROM strategies WHERE id = 'daemon-strategy-1'");
    await query("DELETE FROM strategies WHERE id LIKE 'e2e-%'");
    await query("DELETE FROM platforms WHERE name = 'Test Platform'");
    await query("DELETE FROM platforms WHERE id LIKE 'e2e_%'");
  });
});
