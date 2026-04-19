import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import { closeDb, cleanupByPrefix, query } from '../helpers/db.ts';
import { runCli, extractId } from '../helpers/cli.ts';
import { ensureDaemonStopped } from '../helpers/daemon.ts';
import { waitForDataPreparation } from '../helpers/assertions.ts';

const RUN_ID = `e2e_strategy_${Date.now()}`;
const RUN_PLATFORM = `${RUN_ID}_platform`;
const POSTS_FIXTURE = path.join(process.cwd(), 'test', 'e2e', 'fixtures', 'posts', 'sample-xhs.json');
const SENTIMENT_FIXTURE = path.join(process.cwd(), 'test', 'e2e', 'fixtures', 'strategies', 'sentiment.json');

describe('strategy-workflow', { timeout: 180000 }, () => {
  before(async () => {
    await closeDb();
    await ensureDaemonStopped();
    // Remove any existing test DB file to ensure a clean start.
    // We do NOT call resetTestDb() here because opening the DB in the test
    // process and then having the daemon open the same file triggers a
    // DuckDB internal error (unique_ptr NULL dereference) on macOS.
    const dbPath = process.env.ANALYZE_CLI_DB_PATH;
    if (dbPath) {
      try { fs.unlinkSync(dbPath); } catch {}
      try { fs.unlinkSync(dbPath + '.wal'); } catch {}
    }
  });

  after(async () => {
    await ensureDaemonStopped();
    await cleanupByPrefix(RUN_ID);
  });

  it('should create strategy, run task step, and produce results', async () => {
    // Setup: register platform and import posts
    await runCli(['platform', 'add', '--id', RUN_PLATFORM, '--name', 'E2E Platform']);
    await runCli(['post', 'import', '--platform', RUN_PLATFORM, '--file', POSTS_FIXTURE]);

    // 1. Create strategy
    const { stdout: stratOut, exitCode: stratExit } = await runCli([
      'strategy', 'import', '--file', SENTIMENT_FIXTURE,
    ]);
    assert.equal(stratExit, 0, 'Strategy import should succeed');
    const strategyId = extractId(stratOut);
    assert.ok(strategyId, 'Should extract strategy ID');

    // 2. Create task
    const { stdout: taskOut, exitCode: taskExit } = await runCli([
      'task', 'create',
      '--name', `${RUN_ID}_task`,
      '--cli-templates', JSON.stringify({
        fetch_note: 'echo "{\\"title\\": \\"test\\"}" # {post_id}',
        fetch_comments: 'echo "[{\\"content\\": \\"great food\\"}]" # {post_id}',
        fetch_media: 'echo "[]" # {post_id}',
      }),
    ]);
    assert.equal(taskExit, 0);
    const taskId = extractId(taskOut);
    assert.ok(taskId);

    // 3. Add posts
    await runCli(['task', 'add-posts', '--task-id', taskId!, '--post-ids', 'post_001,post_002']);

    // 4. Prepare data
    await runCli(['task', 'prepare-data', '--task-id', taskId!]);
    await waitForDataPreparation(taskId!, 60000);

    // 5. Add strategy step
    const { exitCode: stepExit } = await runCli([
      'task', 'step', 'add',
      '--task-id', taskId!,
      '--strategy-id', strategyId!,
      '--name', '情感分析',
    ]);
    assert.equal(stepExit, 0, 'Step add should succeed');

    // 6. Run all steps with wait
    const { exitCode: runExit } = await runCli([
      'task', 'run-all-steps',
      '--task-id', taskId!,
      '--wait',
    ]);
    assert.equal(runExit, 0, 'Run all steps should succeed');

    // Stop daemon so we can query the DB
    await ensureDaemonStopped();
    await closeDb();

    // 7. Verify result table exists and has data
    const resultTable = `analysis_results_strategy_${strategyId}`;
    const results = await query<Record<string, unknown>>(
      `SELECT * FROM "${resultTable}" WHERE task_id = ?`,
      [taskId!],
    );
    assert.ok(results.length > 0, 'Should have analysis results');

    // 8. Verify result fields
    const first = results[0];
    assert.ok(first.sentiment, 'Result should have sentiment field');
    assert.ok(
      ['positive', 'negative', 'neutral'].includes(first.sentiment as string),
      'Sentiment should be valid',
    );
    assert.ok(typeof first.confidence === 'number', 'Confidence should be a number');

    await closeDb();
  });

  it('should fail to import invalid strategy', async () => {
    // Create a temp file with invalid strategy (missing required fields)
    const invalidStrategy = JSON.stringify({
      name: 'Invalid',
      // missing id, version, target, prompt and output_schema
    });
    const tmpFile = `/tmp/e2e_invalid_strategy_${Date.now()}.json`;
    fs.writeFileSync(tmpFile, invalidStrategy);

    const { exitCode, stdout, stderr } = await runCli([
      'strategy', 'import', '--file', tmpFile,
    ]);
    assert.notEqual(exitCode, 0, 'Invalid strategy should fail');
    const output = stdout + stderr;
    assert.ok(
      output.includes('Error') || output.includes('required'),
      'Should show error message',
    );

    // Cleanup temp file
    fs.unlinkSync(tmpFile);
  });
});
