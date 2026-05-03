import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../packages/core/dist/db/client.js';
const { query, run, close: closeDb } = db;
import * as migrate from '../../packages/core/dist/db/migrate.js';
const { runMigrations } = migrate;
import * as seed from '../../packages/core/dist/db/seed.js';
const { seedAll } = seed;
import * as platforms from '../../packages/core/dist/db/platforms.js';
const { createPlatform } = platforms;
import * as posts from '../../packages/core/dist/db/posts.js';
const { createPost, getPostById } = posts;
import * as tasks from '../../packages/core/dist/db/tasks.js';
const { createTask, getTaskById, updateTaskStatus } = tasks;
import * as taskTargets from '../../packages/core/dist/db/task-targets.js';
const { createTaskTarget, listTaskTargets, getTargetStats } = taskTargets;
import * as taskPostStatus from '../../packages/core/dist/db/task-post-status.js';
const { getTaskPostStatuses, getPendingPostIds, upsertTaskPostStatus, getTaskPostStatus } = taskPostStatus;
import * as opencli from '../../packages/core/dist/data-fetcher/opencli.js';
const { fetchViaOpencli } = opencli;
import * as comments from '../../packages/core/dist/db/comments.js';
const { createComment, listCommentsByPost } = comments;
import * as mediaFiles from '../../packages/core/dist/db/media-files.js';
const { createMediaFile, listMediaFilesByPost } = mediaFiles;
import * as queueJobs from '../../packages/core/dist/db/queue-jobs.js';
const { enqueueJobs, getNextJob, updateJobStatus, listJobsByTask } = queueJobs;
import * as utils from '../../packages/core/dist/shared/utils.js';
const { generateId, now } = utils;

// Test constants — unique IDs per run
const RUN_ID = `e2e_${Date.now()}`;
const TEST_PLATFORM = `${RUN_ID}_platform`;
const TEST_TASK_ID = `${RUN_ID}_task`;

describe('prepare-data E2E — real opencli data', { timeout: 60000 }, () => {
  let postId: string;

  before(async () => {
    closeDb(); // Reset connection from previous tests
    await runMigrations();
    await seedAll();

    // Create platform
    await createPlatform({
      id: TEST_PLATFORM,
      name: `Test Platform (E2E ${RUN_ID})`,
      description: 'For E2E tests with real opencli data',
    });

    // Create post
    const post = await createPost({
      platform_id: TEST_PLATFORM,
      platform_post_id: `${RUN_ID}_post`,
      title: 'E2E Test Post',
      content: 'Test content for E2E',
      author_id: null, author_name: 'E2E Author', author_url: null,
      url: null, cover_url: null, post_type: 'text',
      like_count: 0, collect_count: 0, comment_count: 0,
      share_count: 0, play_count: 0, score: null,
      tags: null, media_files: null, published_at: null,
      metadata: null,
    });
    postId = post.id;

    // Create task with cli_templates (comments + media)
    const cliTemplates = JSON.stringify({
      fetch_comments: 'opencli hackernews top --limit {limit} -f json',
      fetch_media: 'opencli producthunt today -f json',
    });
    await createTask({
      id: TEST_TASK_ID,
      name: 'E2E Test Task',
      description: 'E2E test with real opencli data',
      cli_templates: cliTemplates,
      status: 'pending',
      stats: { total: 0, done: 0, failed: 0 },
      created_at: now(),
      updated_at: now(),
      completed_at: null,
    });

    // Bind post as task target
    await createTaskTarget(TEST_TASK_ID, 'post', postId);
  });

  // ---- Phase 1: Data Preparation ----

  it('should create task with opencli templates and retrieve it', async () => {
    const task = await getTaskById(TEST_TASK_ID);
    assert.ok(task);
    assert.equal(task.name, 'E2E Test Task');
    assert.ok(task.cli_templates);

    const parsed = JSON.parse(task.cli_templates!);
    assert.ok(parsed.fetch_comments.includes('{limit}'));
  });

  it('should verify post and task target binding', async () => {
    const post = await getPostById(postId);
    assert.ok(post);
    assert.equal(post.platform_id, TEST_PLATFORM);

    const targets = await listTaskTargets(TEST_TASK_ID);
    const postTargets = targets.filter(t => t.target_type === 'post');
    assert.equal(postTargets.length, 1);
    assert.equal(postTargets[0].target_id, postId);
  });

  it('should fetch real data from opencli using the template', async () => {
    const task = await getTaskById(TEST_TASK_ID);
    const templates = JSON.parse(task!.cli_templates!);

    const result = await fetchViaOpencli(
      templates.fetch_comments,
      { post_id: postId, limit: '5' },
      30000,
    );

    assert.equal(result.success, true, `fetch failed: ${result.error}`);
    assert.ok(result.data!.length > 0, 'expected at least 1 item from opencli');
    assert.ok(result.data!.length <= 5, 'expected at most 5 items');

    const first = result.data![0] as Record<string, unknown>;
    assert.ok('title' in first, 'expected title in HN data');
    console.log(`  Fetched ${result.data!.length} items from HackerNews`);
  });

  it('should import fetched data into DuckDB as comments', async () => {
    const task = await getTaskById(TEST_TASK_ID);
    const templates = JSON.parse(task!.cli_templates!);
    const result = await fetchViaOpencli(
      templates.fetch_comments,
      { post_id: postId, limit: '3' },
      30000,
    );
    assert.equal(result.success, true);

    let imported = 0;
    for (const item of result.data!) {
      if (typeof item !== 'object' || item === null) continue;
      const obj = item as Record<string, unknown>;
      try {
        await createComment({
          post_id: postId,
          platform_id: TEST_PLATFORM,
          platform_comment_id: `hn_${String(obj.url ?? obj.rank ?? imported)}`,
          parent_comment_id: null,
          root_comment_id: null,
          depth: 0,
          author_id: null,
          author_name: (obj.author ?? 'HN User') as string,
          content: (obj.title ?? 'No title') as string,
          like_count: Number(obj.score ?? 0),
          reply_count: Number(obj.comments ?? 0),
          published_at: null,
          metadata: obj,
        });
        imported++;
      } catch {
        // Skip duplicates
      }
    }
    assert.ok(imported > 0, `expected at least 1 comment imported, got ${imported}`);

    const commentList = await listCommentsByPost(postId, 10);
    assert.equal(commentList.length, imported);
    console.log(`  Imported ${imported} comments into DuckDB`);
  });

  it('should import media files into DuckDB from opencli data', async () => {
    const task = await getTaskById(TEST_TASK_ID);
    const templates = JSON.parse(task!.cli_templates!);
    const result = await fetchViaOpencli(
      templates.fetch_media,
      { post_id: postId },
      30000,
    );
    assert.equal(result.success, true, `media fetch failed: ${result.error}`);
    assert.ok(result.data!.length > 0, 'expected at least 1 media item');

    // Import media (using URL from opencli data as media URL)
    let imported = 0;
    for (const item of result.data!.slice(0, 3)) {
      if (typeof item !== 'object' || item === null) continue;
      const obj = item as Record<string, unknown>;
      const mediaUrl = (obj.url ?? obj.image_url ?? obj.thumbnail ?? `https://example.com/${imported}`) as string;
      try {
        await createMediaFile({
          post_id: postId,
          comment_id: null,
          platform_id: TEST_PLATFORM,
          media_type: 'image',
          url: mediaUrl,
          local_path: null,
          width: null,
          height: null,
          duration_ms: null,
          file_size: null,
          downloaded_at: null,
        });
        imported++;
      } catch {
        // Skip duplicates
      }
    }
    assert.ok(imported > 0, `expected at least 1 media imported, got ${imported}`);

    const mediaList = await listMediaFilesByPost(postId);
    assert.equal(mediaList.length, imported);
    assert.ok(mediaList.every(m => m.url.startsWith('http')), 'all media should have valid URLs');
    console.log(`  Imported ${imported} media files into DuckDB`);
  });

  it('should track progress in task_post_status', async () => {
    // Initialize status
    await upsertTaskPostStatus(TEST_TASK_ID, postId, { status: 'pending' });

    let status = await getTaskPostStatus(TEST_TASK_ID, postId);
    assert.ok(status);
    assert.equal(status.status, 'pending');

    // Mark as fetching
    await upsertTaskPostStatus(TEST_TASK_ID, postId, { status: 'fetching' });
    status = await getTaskPostStatus(TEST_TASK_ID, postId);
    assert.equal(status.status, 'fetching');

    // Mark comments as fetched
    await upsertTaskPostStatus(TEST_TASK_ID, postId, { comments_fetched: true, comments_count: 3 });
    status = await getTaskPostStatus(TEST_TASK_ID, postId);
    assert.equal(status.comments_fetched, true);
    assert.equal(status.comments_count, 3);

    // Mark as done
    await upsertTaskPostStatus(TEST_TASK_ID, postId, { status: 'done' });
    status = await getTaskPostStatus(TEST_TASK_ID, postId);
    assert.equal(status.status, 'done');
  });

  it('should skip already-fetched posts on retry (breakpoint recovery)', async () => {
    // Mark both as fetched
    await upsertTaskPostStatus(TEST_TASK_ID, postId, {
      comments_fetched: true,
      media_fetched: true,
      status: 'done',
    });

    const pending = await getPendingPostIds(TEST_TASK_ID);
    const postIds = pending.map(p => p.post_id);
    assert.ok(!postIds.includes(postId), 'post should not be pending after both fetched');
  });

  // ---- Phase 2: Analysis Pipeline ----

  it('should create queue jobs from task targets', async () => {
    const stats = await getTargetStats(TEST_TASK_ID);
    assert.ok(stats.total > 0, 'expected at least 1 target');

    const jobs = stats.pending.map(t => ({
      id: generateId(),
      task_id: TEST_TASK_ID,
      strategy_id: null,
      target_type: t.target_type as 'post' | 'comment' | null,
      target_id: t.target_id,
      status: 'pending' as const,
      priority: 0,
      attempts: 0,
      max_attempts: 3,
      error: null,
      created_at: now(),
      processed_at: null,
    }));

    if (jobs.length > 0) {
      await enqueueJobs(jobs);
      const taskJobs = await listJobsByTask(TEST_TASK_ID);
      assert.equal(taskJobs.length, jobs.length);
      console.log(`  Created ${jobs.length} queue jobs`);
    } else {
      console.log('  No pending targets (all already processed)');
    }
  });

  it('should be able to dequeue and process a job', async () => {
    // Get jobs for our specific task (avoid picking up stale jobs from other tests)
    const taskJobs = await listJobsByTask(TEST_TASK_ID);
    const pendingJobs = taskJobs.filter(j => j.status === 'pending');
    assert.ok(pendingJobs.length > 0, 'expected at least 1 pending job for our task');

    const job = pendingJobs[0];
    assert.equal(job.task_id, TEST_TASK_ID);

    await updateJobStatus(job.id, 'completed');

    const updatedJobs = await listJobsByTask(TEST_TASK_ID);
    const completed = updatedJobs.filter(j => j.status === 'completed');
    assert.ok(completed.length >= 1, 'expected at least 1 completed job');
  });

  it('should verify full data flow: opencli → import → queue → process', async () => {
    const task = await getTaskById(TEST_TASK_ID);
    assert.ok(task);
    assert.equal(task.name, 'E2E Test Task');

    const post = await getPostById(postId);
    assert.ok(post);

    const commentList = await listCommentsByPost(postId, 100);
    assert.ok(commentList.length > 0, 'expected comments from opencli data');

    const mediaList = await listMediaFilesByPost(postId);
    assert.ok(mediaList.length > 0, 'expected media from opencli data');

    const taskJobs = await listJobsByTask(TEST_TASK_ID);
    assert.ok(taskJobs.length > 0, 'expected queue jobs');

    const statuses = await getTaskPostStatuses(TEST_TASK_ID);
    assert.ok(statuses.length > 0, 'expected task_post_status records');

    console.log(`  E2E chain verified: ${commentList.length} comments, ${mediaList.length} media, ${taskJobs.length} jobs, ${statuses.length} status records`);
  });
});
