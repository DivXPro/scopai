import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { closeDb, cleanupByPrefix, query } from '../helpers/db.ts';
import { runCli, extractId } from '../helpers/cli.ts';
import { ensureDaemonStopped } from '../helpers/daemon.ts';

const RUN_ID = `e2e_queue_${Date.now()}`;
const RUN_PLATFORM = `${RUN_ID}_platform`;
const POSTS_FIXTURE = path.join(process.cwd(), 'test', 'e2e', 'fixtures', 'posts', 'sample-xhs.json');
const SENTIMENT_FIXTURE = path.join(process.cwd(), 'test', 'e2e', 'fixtures', 'strategies', 'sentiment.json');

describe('queue-recovery', { timeout: 120000 }, () => {
  before(async () => {
    await closeDb();
    await ensureDaemonStopped();
  });

  after(async () => {
    await ensureDaemonStopped();
    await cleanupByPrefix(RUN_ID);
    await closeDb();
  });

  // Skip if no LLM API key — queue jobs won't be created
  it.skip('should reset failed jobs via queue reset command', async () => {
    // Setup: platform, posts, task, strategy
    await runCli(['platform', 'add', '--id', RUN_PLATFORM, '--name', 'E2E Platform']);
    await runCli(['post', 'import', '--platform', RUN_PLATFORM, '--file', POSTS_FIXTURE]);

    const { stdout: stratOut } = await runCli(['strategy', 'import', '--file', SENTIMENT_FIXTURE]);
    const strategyId = extractId(stratOut)!;

    const { stdout: taskOut } = await runCli([
      'task', 'create',
      '--name', `${RUN_ID}_task`,
      '--cli-templates', JSON.stringify({
        fetch_note: 'echo "{\\"title\\": \\"test\\"}" # {post_id}',
        fetch_comments: 'echo "[{\\"content\\": \\"test\\"}]" # {post_id}',
        fetch_media: 'echo "[]" # {post_id}',
      }),
    ]);
    const taskId = extractId(taskOut)!;

    await runCli(['task', 'add-posts', taskId, '--post-ids', 'post_001']);
    await runCli(['task', 'prepare-data', taskId]);

    // Create step
    await runCli([
      'task', 'step', 'add',
      '--task-id', taskId,
      '--strategy-id', strategyId,
    ]);

    // Run steps (this may succeed or fail depending on LLM)
    await runCli(['task', 'run-all-steps', taskId, '--wait']);

    // Stop daemon to query DB
    await ensureDaemonStopped();
    await closeDb();

    // Check queue jobs
    const jobs = await query<{ id: string; status: string; attempts: number }>(
      'SELECT id, status, attempts FROM queue_jobs WHERE task_id = ?',
      [taskId],
    );

    // If any jobs failed, test the reset command
    const failedJobs = jobs.filter(j => j.status === 'failed');
    if (failedJobs.length > 0) {
      // Reset jobs via CLI
      const { exitCode: resetExit, stdout: resetOut } = await runCli([
        'queue', 'reset', '--task-id', taskId,
      ]);
      assert.equal(resetExit, 0, 'Queue reset should succeed');
      assert.ok(resetOut.includes('Reset'), 'Should report reset count');

      // Stop daemon again and verify jobs are now pending
      await ensureDaemonStopped();
      await closeDb();

      const resetJobs = await query<{ status: string; attempts: number }>(
        'SELECT status, attempts FROM queue_jobs WHERE task_id = ?',
        [taskId],
      );
      for (const j of resetJobs) {
        assert.equal(j.status, 'pending', 'Job should be reset to pending');
        assert.equal(j.attempts, 0, 'Attempts should be reset to 0');
      }
    }
  });
});
