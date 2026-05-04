import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import { closeDb, cleanupByPrefix, query } from '../helpers/db.ts';
import { runCli, extractId } from '../helpers/cli.ts';
import { ensureDaemonStopped, startDaemon } from '../helpers/daemon.ts';
import { waitForDataPreparation } from '../helpers/assertions.ts';

const RUN_ID = `e2e_import_${Date.now()}`;
const RUN_PLATFORM = `${RUN_ID}_platform`;
const FIXTURE_PATH = path.join(process.cwd(), 'test', 'e2e', 'fixtures', 'posts', 'sample-xhs.json');

describe('import-and-prepare', { timeout: 90000 }, () => {
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
    await startDaemon();
  });

  after(async () => {
    await ensureDaemonStopped();
    await cleanupByPrefix(RUN_ID);
    await closeDb();
  });

  it('should register platform, import posts, prepare data, and verify status', async () => {
    // 1. Register platform
    const { exitCode: platformExit } = await runCli([
      'platform', 'add',
      '--id', RUN_PLATFORM,
      '--name', 'E2E Test Platform',
    ]);
    assert.equal(platformExit, 0, 'Platform add should succeed');

    // 2. Import posts
    const { exitCode: importExit } = await runCli([
      'post', 'import',
      '--platform', RUN_PLATFORM,
      '--file', FIXTURE_PATH,
    ]);
    assert.equal(importExit, 0, 'Post import should succeed');

    // 3. Create task with cli_templates
    const { stdout: taskOut, exitCode: taskExit, stderr: taskStderr } = await runCli([
      'task', 'create',
      '--name', `${RUN_ID}_task`,
      '--cli-templates', JSON.stringify({
        fetch_note: 'echo "{\\"title\\": \\"test\\"}" # {post_id}',
        fetch_comments: 'echo "[]" # {post_id}',
        fetch_media: 'echo "[]" # {post_id}',
      }),
    ]);
    console.log('Task create exitCode:', taskExit, 'stdout:', taskOut, 'stderr:', taskStderr.substring(0, 300));
    assert.equal(taskExit, 0, 'Task create should succeed');
    const taskId = extractId(taskOut);
    assert.ok(taskId, 'Should extract task ID from output');

    // 4. Add posts to task
    const { exitCode: addExit, stderr: addStderr } = await runCli([
      'task', 'add-posts', taskId!,
      '--post-ids', 'post_001,post_002',
    ]);
    console.log('Add posts exitCode:', addExit, 'stderr:', addStderr.substring(0, 300));
    assert.equal(addExit, 0, 'Add posts should succeed');

    // Check daemon status before prepare-data
    const { stdout: daemonStatus } = await runCli(['daemon', 'status']);
    console.log('Daemon status before prepare-data:', daemonStatus);

    // 5. Run data preparation
    const { exitCode: prepExit, stderr: prepStderr } = await runCli([
      'task', 'prepare-data', taskId!,
    ]);
    console.log('Prepare data exitCode:', prepExit, 'stderr:', prepStderr.substring(0, 300));
    assert.equal(prepExit, 0, 'Prepare data should start successfully');

    // 6. Wait for completion
    await waitForDataPreparation(taskId!, 60000);

    // 7. Verify results via DB queries
    // DuckDB does not allow concurrent access from two processes on macOS.
    // Stop the daemon so the test process can open the DB file.
    await ensureDaemonStopped();

    // 7a. Verify posts count
    const posts = await query<{ count: number }>(
      'SELECT COUNT(*) as count FROM posts WHERE platform_id = ?',
      [RUN_PLATFORM],
    );
    assert.equal(Number(posts[0].count), 2, 'Should have 2 imported posts');

    // 7b. Verify task_post_status
    const statuses = await query<{
      post_id: string;
      comments_fetched: boolean;
      media_fetched: boolean;
    }>(
      'SELECT post_id, comments_fetched, media_fetched FROM task_post_status WHERE task_id = ?',
      [taskId!],
    );
    assert.equal(statuses.length, 2, 'Should have 2 task_post_status records');
    for (const s of statuses) {
      assert.equal(s.comments_fetched, true, `Post ${s.post_id} comments should be fetched`);
      assert.equal(s.media_fetched, true, `Post ${s.post_id} media should be fetched`);
    }

    await closeDb();
  });
});
