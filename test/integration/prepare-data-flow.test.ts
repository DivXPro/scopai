import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as db from '../../packages/core/dist/db/client.js';
const { close: closeDb } = db;
import * as migrate from '../../packages/core/dist/db/migrate.js';
const { runMigrations } = migrate;
import * as seed from '../../packages/core/dist/db/seed.js';
const { seedAll } = seed;
import * as platforms from '../../packages/core/dist/db/platforms.js';
const { createPlatform } = platforms;
import * as posts from '../../packages/core/dist/db/posts.js';
const { createPost, getPostById } = posts;
import * as tasks from '../../packages/core/dist/db/tasks.js';
const { createTask } = tasks;
import * as taskTargets from '../../packages/core/dist/db/task-targets.js';
const { createTaskTarget } = taskTargets;
import * as taskPostStatus from '../../packages/core/dist/db/task-post-status.js';
const { getTaskPostStatus, getPendingPostIds } = taskPostStatus;
import * as comments from '../../packages/core/dist/db/comments.js';
const { listCommentsByPost } = comments;
import * as mediaFiles from '../../packages/core/dist/db/media-files.js';
const { listMediaFilesByPost } = mediaFiles;
import * as opencli from '../../packages/core/dist/data-fetcher/opencli.js';
const { fetchViaOpencli } = opencli;
import * as utils from '../../packages/core/dist/shared/utils.js';
const { now } = utils;

import { getHandlers } from '../../packages/api/src/daemon/handlers.ts';

const RUN_ID = `xhs_flow_${Date.now()}`;
const TEST_PLATFORM = `${RUN_ID}_platform`;

describe('prepare-data — flow with real XHS data', { timeout: 600000 }, () => {
  let realPosts: any[] = [];

  before(async () => {
    closeDb();
    await runMigrations();
    await seedAll();

    await createPlatform({
      id: TEST_PLATFORM,
      name: `XHS Flow Test (${RUN_ID})`,
      description: 'Real XHS data for prepare-data flow integration test',
    });

    // Fetch real XHS posts by searching "美食"
    console.log('  [Setup] Searching XHS for 美食 posts...');
    const result = await fetchViaOpencli(
      'opencli xiaohongshu search 美食 --limit 2 -f json',
      {},
      60000,
    );
    assert.equal(result.success, true, `XHS search failed: ${result.error}`);
    assert.ok(result.data && result.data.length >= 2, `Expected at least 2 posts, got ${result.data?.length ?? 0}`);
    realPosts = result.data as any[];
    console.log(`  [Setup] Fetched ${realPosts.length} real XHS posts`);
  });

  after(async () => {
    // Cleanup downloaded media files for test posts
    for (const item of realPosts) {
      const noteId = item.id || item.note_id;
      if (noteId) {
        const downloadDir = path.join(os.homedir(), '.scopai', 'downloads', 'xhs', String(noteId));
        try { fs.rmSync(downloadDir, { recursive: true, force: true }); } catch { }
      }
    }
  });

  async function createTestTask(taskId: string, templates: any) {
    await createTask({
      id: taskId,
      name: 'XHS Flow Test Task',
      description: 'Integration test with real XHS data',
      template_id: null,
      cli_templates: JSON.stringify(templates),
      status: 'pending',
      stats: { total: 0, done: 0, failed: 0 },
      created_at: now(),
      updated_at: now(),
      completed_at: null,
    });
  }

  function parseLikes(likes: unknown): number {
    if (typeof likes === 'number') return likes;
    if (typeof likes !== 'string') return 0;
    const clean = likes.replace(/,/g, '');
    if (clean.includes('万')) {
      const num = parseFloat(clean.replace('万', ''));
      return isNaN(num) ? 0 : Math.round(num * 10000);
    }
    const num = parseInt(clean, 10);
    return isNaN(num) ? 0 : num;
  }

  async function createPostFromRealData(index: number) {
    const item = realPosts[index];
    const noteUrl = String(item.url || '');
    // Extract note_id from XHS URL: .../search_result/NOTE_ID?...
    const match = noteUrl.match(/\/([a-f0-9]{24})(?:\?|$)/);
    const noteId = match ? match[1] : `xhs_${index}`;
    // Use unique platform_post_id per test to avoid constraint conflicts,
    // while keeping the real note_id in metadata for opencli template substitution
    const uniquePostId = `${noteId}_${Date.now()}`;

    return createPost({
      platform_id: TEST_PLATFORM,
      platform_post_id: uniquePostId,
      title: String(item.title || 'XHS Post'),
      content: String(item.title || 'XHS Content'),
      author_id: null,
      author_name: String(item.author || 'XHS User'),
      author_url: null,
      url: noteUrl || null,
      cover_url: null,
      post_type: 'image',
      like_count: parseLikes(item.likes),
      collect_count: 0,
      comment_count: 0,
      share_count: 0,
      play_count: 0,
      score: null,
      tags: null,
      media_files: null,
      published_at: null,
      metadata: { ...item, note_id: noteId, note_url: noteUrl },
    });
  }

  async function bindPostToTask(taskId: string, postId: string) {
    await createTaskTarget(taskId, 'post', postId);
    const { upsertTaskPostStatus } = await import('../../packages/core/dist/db/task-post-status.js');
    await upsertTaskPostStatus(taskId, postId, { status: 'pending' });
  }

  async function runPrepareDataAndWait(taskId: string): Promise<'done' | 'failed'> {
    const handlers = getHandlers();
    console.log(`  [Test] Calling task.prepareData for ${taskId}...`);
    const result = await handlers['task.prepareData']({ task_id: taskId });
    console.log(`  [Test] task.prepareData result: started=${(result as any).started}, reason=${(result as any).reason ?? ''}`);
    assert.equal(result.started, true, `prepareData failed: ${(result as any).reason}`);

    const start = Date.now();
    while (Date.now() - start < 300000) {
      const show = await handlers['task.show']({ task_id: taskId });
      const status = (show as any).phases?.dataPreparation?.status;
      const totalPosts = (show as any).phases?.dataPreparation?.totalPosts ?? 0;
      const failedPosts = (show as any).phases?.dataPreparation?.failedPosts ?? 0;
      console.log(`  [Test] Poll status=${status}, total=${totalPosts}, failed=${failedPosts}, elapsed=${Date.now() - start}ms`);
      if (status === 'done' || status === 'failed') {
        console.log(`  [Test] Final status: ${status}`);
        return status;
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error(`Timeout waiting for prepare-data for task ${taskId}`);
  }

  it('should complete full flow: note + comments + media with real XHS data', async () => {
    const taskId = `${RUN_ID}_full_${Date.now()}`;
    const post = await createPostFromRealData(0);
    await createTestTask(taskId, {
      fetch_note: 'opencli xiaohongshu note {url} -f json',
      fetch_comments: 'opencli xiaohongshu comments {url} --limit 10 -f json',
      fetch_media: 'opencli xiaohongshu download {url} --output {download_dir}/xhs -f json',
    });
    await bindPostToTask(taskId, post.id);

    const finalStatus = await runPrepareDataAndWait(taskId);
    assert.equal(finalStatus, 'done');

    const updatedPost = await getPostById(post.id);
    assert.ok(updatedPost);

    const commentList = await listCommentsByPost(post.id, 100);
    console.log(`  Imported ${commentList.length} real comments`);

    const mediaList = await listMediaFilesByPost(post.id);
    console.log(`  Imported ${mediaList.length} real media files`);

    const status = await getTaskPostStatus(taskId, post.id);
    assert.equal(status?.status, 'done');
    assert.equal(status?.comments_fetched, true);
    assert.equal(status?.media_fetched, true);
  });

  it('should mark comments_fetched and media_fetched true when templates not configured', async () => {
    const taskId = `${RUN_ID}_noteonly_${Date.now()}`;
    const post = await createPostFromRealData(0);
    await createTestTask(taskId, {
      fetch_note: 'opencli xiaohongshu note {url} -f json',
    });
    await bindPostToTask(taskId, post.id);

    const finalStatus = await runPrepareDataAndWait(taskId);
    assert.equal(finalStatus, 'done');

    const status = await getTaskPostStatus(taskId, post.id);
    assert.equal(status?.status, 'done');
    assert.equal(status?.comments_fetched, true);
    assert.equal(status?.media_fetched, true);
  });

  it('should mark post as failed when fetch_note fails and not reprocess', async () => {
    const taskId = `${RUN_ID}_notefail_${Date.now()}`;
    const post = await createPostFromRealData(0);
    await createTestTask(taskId, {
      fetch_note: 'node -e process.exit(1) {note_id}',
      fetch_comments: 'opencli xiaohongshu comments {url} --limit 10 -f json',
      fetch_media: 'opencli xiaohongshu download {url} --output {download_dir}/xhs -f json',
    });
    await bindPostToTask(taskId, post.id);

    const finalStatus = await runPrepareDataAndWait(taskId);
    assert.equal(finalStatus, 'failed');

    const status = await getTaskPostStatus(taskId, post.id);
    assert.equal(status?.status, 'failed');

    const pending = await getPendingPostIds(taskId);
    const pendingIds = pending.map(p => p.post_id);
    assert.ok(!pendingIds.includes(post.id), 'failed post should not appear in pending list');
  });

  it('should execute fetch_media even when fetch_comments fails', async () => {
    const taskId = `${RUN_ID}_commentsfail_${Date.now()}`;
    const post = await createPostFromRealData(0);
    await createTestTask(taskId, {
      fetch_note: 'opencli xiaohongshu note {url} -f json',
      fetch_comments: 'node -e process.exit(1) {note_id}',
      fetch_media: 'opencli xiaohongshu download {url} --output {download_dir}/xhs -f json',
    });
    await bindPostToTask(taskId, post.id);

    const finalStatus = await runPrepareDataAndWait(taskId);
    assert.equal(finalStatus, 'done');

    const commentList = await listCommentsByPost(post.id, 100);
    assert.equal(commentList.length, 0);

    const mediaList = await listMediaFilesByPost(post.id);
    console.log(`  Imported ${mediaList.length} real media files despite comments failure`);

    const status = await getTaskPostStatus(taskId, post.id);
    assert.equal(status?.status, 'done');
    assert.equal(status?.comments_fetched, false);
    assert.equal(status?.media_fetched, true);
    assert.ok(status?.error, 'error should be preserved from comments failure');
  });

  it('should skip already-done posts on resume', async () => {
    const taskId = `${RUN_ID}_resume_${Date.now()}`;
    const postDone = await createPostFromRealData(0);
    const postPending = await createPostFromRealData(1);
    await createTestTask(taskId, {
      fetch_note: 'opencli xiaohongshu note {url} -f json',
    });
    await bindPostToTask(taskId, postDone.id);
    await bindPostToTask(taskId, postPending.id);

    const { upsertTaskPostStatus } = await import('../../packages/core/dist/db/task-post-status.js');
    await upsertTaskPostStatus(taskId, postDone.id, { status: 'done', comments_fetched: true, media_fetched: true });

    const finalStatus = await runPrepareDataAndWait(taskId);
    assert.equal(finalStatus, 'done');

    const statuses = await (await import('../../packages/core/dist/db/task-post-status.js')).getTaskPostStatuses(taskId);
    assert.equal(statuses.length, 2);
    assert.ok(statuses.every(s => s.status === 'done'));
  });
});
