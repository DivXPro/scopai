import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import { closeDb, cleanupByPrefix } from '../helpers/db.ts';
import { runCli, extractId } from '../helpers/cli.ts';
import { ensureDaemonStopped, startDaemon, stopDaemon, getDaemonPort } from '../helpers/daemon.ts';

const RUN_ID = `e2e_cli_results_${Date.now()}`;
const RUN_PLATFORM = `${RUN_ID}_platform`;
const POSTS_FIXTURE = path.join(process.cwd(), 'test', 'e2e', 'fixtures', 'posts', 'sample-xhs.json');
const STRATEGY_FIXTURE = path.join(process.cwd(), 'test', 'e2e', 'fixtures', 'strategies', 'sentiment.json');

describe('cli-results-commands', { timeout: 90000 }, () => {
  let taskId: string;
  let strategyId: string;
  let platformId: string;

  before(async () => {
    await ensureDaemonStopped();

    // Clean up any existing test DB file
    const dbPath = process.env.ANALYZE_CLI_DB_PATH;
    if (dbPath) {
      try { fs.unlinkSync(dbPath); } catch {}
      try { fs.unlinkSync(dbPath + '.wal'); } catch {}
    }

    // Start daemon for CLI commands
    await startDaemon();

    // 1. Register platform
    const { exitCode: platExit } = await runCli([
      'platform', 'add', '--id', RUN_PLATFORM, '--name', 'E2E Results Platform',
    ]);
    assert.equal(platExit, 0, 'Platform add should succeed');
    platformId = RUN_PLATFORM;

    // 2. Import posts
    const { exitCode: postExit } = await runCli([
      'post', 'import', '--platform', platformId, '--file', POSTS_FIXTURE,
    ]);
    assert.equal(postExit, 0, 'Post import should succeed');

    // 3. Create task with mock templates (no real opencli needed)
    const { stdout: taskOut, exitCode: taskExit } = await runCli([
      'task', 'create',
      '--name', `${RUN_ID}_task`,
      '--cli-templates', JSON.stringify({
        fetch_note: 'echo "{\"title\": \"test\"}"',
        fetch_comments: 'echo "[]"',
        fetch_media: 'echo "[]"',
      }),
    ]);
    assert.equal(taskExit, 0, 'Task create should succeed');
    taskId = extractId(taskOut)!;
    assert.ok(taskId, 'Should extract task ID');

    // 4. Add posts to task
    const { exitCode: addExit } = await runCli([
      'task', 'add-posts', '--task-id', taskId, '--post-ids', 'post_001,post_002',
    ]);
    assert.equal(addExit, 0, 'Add posts should succeed');

    // 5. Import strategy
    const { stdout: stratOut, exitCode: stratExit } = await runCli([
      'strategy', 'import', '--file', STRATEGY_FIXTURE,
    ]);
    assert.equal(stratExit, 0, 'Strategy import should succeed');
    strategyId = extractId(stratOut)!;
    assert.ok(strategyId, 'Should extract strategy ID');

    // 6. Add strategy step to task
    const { exitCode: stepExit } = await runCli([
      'task', 'step', 'add',
      '--task-id', taskId,
      '--strategy-id', strategyId,
      '--name', '情感分析',
    ]);
    assert.equal(stepExit, 0, 'Step add should succeed');

    // 7. Insert mock results via HTTP API (avoids direct DB access from test process)
    const port = await getDaemonPort();
    assert.ok(port, 'Daemon port should be available');

    // Use known post IDs from fixture
    const postIds = ['post_001', 'post_002'];

    const mockResults = postIds.map((postId, i) => ({
      task_id: taskId,
      target_type: 'post',
      target_id: postId,
      post_id: postId,
      strategy_version: '1.0.0',
      sentiment: i === 0 ? 'positive' : 'negative',
      confidence: i === 0 ? 0.95 : 0.72,
      raw_response: { sentiment: i === 0 ? 'positive' : 'negative', confidence: i === 0 ? 0.95 : 0.72 },
      error: null,
      analyzed_at: new Date().toISOString(),
    }));

    const res = await fetch(`http://localhost:${port}/api/tasks/${taskId}/seed-results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strategy_id: strategyId, results: mockResults }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to seed results: ${res.status} ${text}`);
    }

    const seedResponse = await res.json() as { inserted: number };
    assert.equal(seedResponse.inserted, postIds.length, 'Should insert all mock results');
  });

  after(async () => {
    await stopDaemon();
    await closeDb();
    await cleanupByPrefix(RUN_ID);
  });

  describe('task results', () => {
    it('should auto-detect strategy from task steps and show results', async () => {
      const { stdout, stderr, exitCode } = await runCli([
        'task', 'results', '--task-id', taskId,
      ]);

      assert.equal(exitCode, 0, `task results should succeed. stderr: ${stderr}`);
      assert.ok(stdout.includes('records'), 'Should show result count');
      assert.ok(stdout.includes('post'), 'Should show target type');
      // Should show raw response preview
      assert.ok(stdout.includes('sentiment') || stdout.includes('positive') || stdout.includes('negative'),
        'Should show result content preview');
    });

    it('should work with explicit --strategy-id', async () => {
      const { stdout, stderr, exitCode } = await runCli([
        'task', 'results', '--task-id', taskId, '--strategy-id', strategyId,
      ]);

      assert.equal(exitCode, 0, `task results with strategy-id should succeed. stderr: ${stderr}`);
      assert.ok(stdout.includes('records'), 'Should show result count');
    });

    it('should fail gracefully for nonexistent task', async () => {
      const { stderr, exitCode } = await runCli([
        'task', 'results', '--task-id', 'nonexistent-task-id',
      ]);

      assert.notEqual(exitCode, 0, 'Should fail for nonexistent task');
      const output = stderr;
      assert.ok(
        output.includes('not found') || output.includes('404') || output.includes('Error'),
        'Should show error for nonexistent task',
      );
    });
  });

  describe('strategy result list', () => {
    it('should parse { results, stats } response correctly', async () => {
      const { stdout, stderr, exitCode } = await runCli([
        'strategy', 'result', 'list',
        '--task-id', taskId,
        '--strategy', strategyId,
      ]);

      assert.equal(exitCode, 0, `strategy result list should succeed. stderr: ${stderr}`);
      assert.ok(stdout.includes('Results'), 'Should show "Results" header');
      // Should show dynamic columns from the result rows
      assert.ok(stdout.includes('sentiment='), 'Should show sentiment field');
      assert.ok(stdout.includes('confidence='), 'Should show confidence field');
    });

    it('should respect --limit', async () => {
      const { stdout, stderr, exitCode } = await runCli([
        'strategy', 'result', 'list',
        '--task-id', taskId,
        '--strategy', strategyId,
        '--limit', '1',
      ]);

      assert.equal(exitCode, 0, `strategy result list with limit should succeed. stderr: ${stderr}`);
      // Should still show results header even with limited rows
      assert.ok(stdout.includes('Results'), 'Should show results header');
    });

    it('should show no results for task without results', async () => {
      // Create a new task with no results
      const { stdout: taskOut, exitCode: taskExit } = await runCli([
        'task', 'create', '--name', `${RUN_ID}_empty_task`,
      ]);
      assert.equal(taskExit, 0);
      const emptyTaskId = extractId(taskOut)!;

      // Add step but don't insert any results
      await runCli([
        'task', 'step', 'add',
        '--task-id', emptyTaskId,
        '--strategy-id', strategyId,
        '--name', 'Empty Step',
      ]);

      const { stdout, exitCode } = await runCli([
        'strategy', 'result', 'list',
        '--task-id', emptyTaskId,
        '--strategy', strategyId,
      ]);

      assert.equal(exitCode, 0, 'Should succeed even with no results');
      assert.ok(stdout.includes('No results found'), 'Should show "No results found" message');
    });
  });

  describe('result list', () => {
    it('should work with --strategy-id option', async () => {
      const { stdout, stderr, exitCode } = await runCli([
        'result', 'list',
        '--task-id', taskId,
        '--strategy-id', strategyId,
      ]);

      assert.equal(exitCode, 0, `result list with strategy-id should succeed. stderr: ${stderr}`);
      assert.ok(stdout.includes('Analysis Results'), 'Should show "Analysis Results" header');
      // Should show dynamic columns
      assert.ok(stdout.includes('sentiment='), 'Should show sentiment field');
    });
  });
});
