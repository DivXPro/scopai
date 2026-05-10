import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { runCli } from '../helpers/cli.ts';
import { ensureDaemonStopped, startDaemon, stopDaemon, getDaemonPort } from '../helpers/daemon.ts';
import { closeDb, cleanupByPrefix } from '../helpers/db.ts';

const RUN_ID = `e2e_cli_filters_${Date.now()}`;
const RUN_PLATFORM = `${RUN_ID}_platform`;

async function fetchApi(port: number, urlPath: string, options?: RequestInit): Promise<Response> {
  return fetch(`http://localhost:${port}${urlPath}`, {
    ...options,
    headers: {
      ...(options?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });
}

describe('cli-filter-commands', { timeout: 60000 }, () => {
  let tmpPostsFile: string;
  let port: number;

  before(async () => {
    await ensureDaemonStopped();
    await startDaemon();
    port = (await getDaemonPort())!;
    assert.ok(port, 'Daemon port should be available');

    // Register platform
    const { exitCode: platExit } = await runCli([
      'platform', 'add', '--id', RUN_PLATFORM, '--name', 'E2E Filter Platform',
    ]);
    assert.equal(platExit, 0, 'Platform add should succeed');

    // Create temp JSON file with posts for import
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scopai-e2e-'));
    tmpPostsFile = path.join(tmpDir, 'posts.json');
    fs.writeFileSync(tmpPostsFile, JSON.stringify([
      { platform_post_id: 'post-a1', title: 'Post A1', content: 'Alpha content here', author_id: 'author-alpha', author_name: 'Alpha' },
      { platform_post_id: 'post-a2', title: 'Post A2', content: 'Another alpha', author_id: 'author-alpha', author_name: 'Alpha' },
      { platform_post_id: 'post-b1', title: 'Post B1', content: 'Beta content here', author_id: 'author-beta', author_name: 'Beta' },
    ]));

    // Import posts
    const { exitCode: postExit } = await runCli([
      'post', 'import', '--platform', RUN_PLATFORM, '--file', tmpPostsFile,
    ]);
    assert.equal(postExit, 0, 'Post import should succeed');
  });

  after(async () => {
    await stopDaemon();
    await cleanupByPrefix(RUN_ID);
    if (tmpPostsFile) {
      try { fs.unlinkSync(tmpPostsFile); } catch {}
      try { fs.rmdirSync(path.dirname(tmpPostsFile)); } catch {}
    }
    await closeDb();
  });

  describe('post list', () => {
    it('filters by author_id', async () => {
      const { stdout, stderr, exitCode } = await runCli([
        'post', 'list', '--platform', RUN_PLATFORM, '--author-id', 'author-alpha',
      ]);
      assert.equal(exitCode, 0, `post list --author-id should succeed. stderr: ${stderr}`);
      assert.ok(stdout.includes('Post A1'), 'Should show Post A1');
      assert.ok(stdout.includes('Post A2'), 'Should show Post A2');
      assert.ok(!stdout.includes('Post B1'), 'Should not show Post B1');
    });

    it('filters by starred', async () => {
      // Get full post ID via API (CLI only shows truncated IDs)
      const res = await fetchApi(port, `/api/posts?platform=${RUN_PLATFORM}`);
      assert.equal(res.status, 200);
      const body = await res.json() as { posts: any[] };
      const postA1 = body.posts.find((p: any) => p.title === 'Post A1');
      assert.ok(postA1, 'Should find Post A1');

      const { exitCode: starExit } = await runCli(['post', 'star', '--id', postA1.id]);
      assert.equal(starExit, 0, 'Star should succeed');

      const { stdout, stderr, exitCode } = await runCli([
        'post', 'list', '--platform', RUN_PLATFORM, '--starred',
      ]);
      assert.equal(exitCode, 0, `post list --starred should succeed. stderr: ${stderr}`);
      assert.ok(stdout.includes(postA1.id.slice(0, 8)), 'Should show starred post');
    });

    it('filters by label', async () => {
      // Get full post ID via API
      const res = await fetchApi(port, `/api/posts?platform=${RUN_PLATFORM}`);
      assert.equal(res.status, 200);
      const body = await res.json() as { posts: any[] };
      const postA1 = body.posts.find((p: any) => p.title === 'Post A1');
      assert.ok(postA1, 'Should find Post A1');

      const { exitCode: tagExit, stderr: tagStderr } = await runCli([
        'post', 'tag', '--id', postA1.id, '--label-name', 'e2e-test-label',
      ]);
      assert.equal(tagExit, 0, `Tag should succeed. stderr: ${tagStderr}`);

      const { stdout, stderr, exitCode } = await runCli([
        'post', 'list', '--platform', RUN_PLATFORM, '--label', 'e2e-test-label',
      ]);
      assert.equal(exitCode, 0, `post list --label should succeed. stderr: ${stderr}`);
      assert.ok(stdout.includes(postA1.id.slice(0, 8)), 'Should show labeled post');
    });
  });

  describe('post search', () => {
    it('searches by query', async () => {
      const { stdout, stderr, exitCode } = await runCli([
        'post', 'search', '--platform', RUN_PLATFORM, '--query', 'Alpha',
      ]);
      assert.equal(exitCode, 0, `post search should succeed. stderr: ${stderr}`);
      assert.ok(stdout.includes('Post A1') || stdout.includes('Post A2'), 'Should show alpha posts');
    });

    it('searches by query and author_id together', async () => {
      const { stdout, stderr, exitCode } = await runCli([
        'post', 'search', '--platform', RUN_PLATFORM, '--query', 'content', '--author-id', 'author-beta',
      ]);
      assert.equal(exitCode, 0, `post search with author-id should succeed. stderr: ${stderr}`);
      assert.ok(stdout.includes('Post B1'), 'Should show Post B1');
      assert.ok(!stdout.includes('Post A1'), 'Should not show Post A1');
    });
  });

  describe('creator list', () => {
    before(async () => {
      // Add creators for name filter testing
      const { exitCode: c1Exit } = await runCli([
        'creator', 'add', '--platform', RUN_PLATFORM, '--author-id', 'creator-alice', '--name', 'Alice Wonderland',
      ]);
      assert.equal(c1Exit, 0, 'Add Alice should succeed');

      const { exitCode: c2Exit } = await runCli([
        'creator', 'add', '--platform', RUN_PLATFORM, '--author-id', 'creator-bob', '--name', 'Bob Builder',
      ]);
      assert.equal(c2Exit, 0, 'Add Bob should succeed');
    });

    it('filters by name (partial match)', async () => {
      const { stdout, stderr, exitCode } = await runCli([
        'creator', 'list', '--name', 'Alice',
      ]);
      assert.equal(exitCode, 0, `creator list --name should succeed. stderr: ${stderr}`);
      assert.ok(stdout.includes('Alice Wonderland'), 'Should show Alice');
      assert.ok(!stdout.includes('Bob Builder'), 'Should not show Bob');
    });

    it('filters by platform and name together', async () => {
      const { stdout, stderr, exitCode } = await runCli([
        'creator', 'list', '--platform', RUN_PLATFORM, '--name', 'Bob',
      ]);
      assert.equal(exitCode, 0, `creator list with platform and name should succeed. stderr: ${stderr}`);
      assert.ok(stdout.includes('Bob Builder'), 'Should show Bob');
      assert.ok(!stdout.includes('Alice Wonderland'), 'Should not show Alice');
    });
  });
});
