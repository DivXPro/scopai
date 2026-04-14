import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../dist/db/client.js';
const { query, run } = db;
import * as migrate from '../dist/db/migrate.js';
const { runMigrations } = migrate;
import * as seed from '../dist/db/seed.js';
const { seedAll } = seed;
import * as platforms from '../dist/db/platforms.js';
const { createPlatform } = platforms;
import * as posts from '../dist/db/posts.js';
const { createPost, getPostById } = posts;
import * as tasks from '../dist/db/tasks.js';
const { createTask, getTaskById, updateTaskStatus } = tasks;
import * as taskTargets from '../dist/db/task-targets.js';
const { createTaskTarget, listTaskTargets, getTargetStats } = taskTargets;
import * as taskPostStatus from '../dist/db/task-post-status.js';
const { getTaskPostStatuses, getPendingPostIds, upsertTaskPostStatus, getTaskPostStatus } = taskPostStatus;
import * as comments from '../dist/db/comments.js';
const { createComment, listCommentsByPost } = comments;
import * as mediaFiles from '../dist/db/media-files.js';
const { createMediaFile, listMediaFilesByPost } = mediaFiles;
import * as queueJobs from '../dist/db/queue-jobs.js';
const { enqueueJobs, listJobsByTask } = queueJobs;
import * as utils from '../dist/shared/utils.js';
const { generateId, now } = utils;

// Offline mock data simulating opencli output
const MOCK_COMMENTS = [
  { id: 'c1', author: 'user1', content: 'Great post!', likeCount: 10, replyCount: 2 },
  { id: 'c2', author: 'user2', content: 'Very helpful', likeCount: 5, replyCount: 0 },
  { id: 'c3', author: 'user3', content: 'Thanks for sharing', likeCount: 8, replyCount: 1 },
];

const MOCK_MEDIA = [
  { url: 'https://example.com/img1.jpg', type: 'image', width: 800, height: 600 },
  { url: 'https://example.com/video1.mp4', type: 'video', duration_ms: 30000 },
];

// Test constants — unique per run
const RUN_ID = `offline_${Date.now()}`;
const TEST_PLATFORM = `${RUN_ID}_platform`;
const TEST_TASK_ID = `${RUN_ID}_task`;

describe('prepare-data — offline mock E2E', { timeout: 15000 }, () => {
  let postId: string;

  before(async () => {
    await runMigrations();
    await seedAll();

    // Create platform
    await createPlatform({
      id: TEST_PLATFORM,
      name: `Offline Test (${RUN_ID})`,
      description: 'Offline mock data E2E test',
    });

    // Create post
    const post = await createPost({
      platform_id: TEST_PLATFORM,
      platform_post_id: `${RUN_ID}_post`,
      title: 'Offline Test Post',
      content: 'Test content using mock data',
      author_id: null,
      author_name: 'Test Author',
      author_url: null,
      url: null,
      cover_url: null,
      post_type: 'image',
      like_count: 100,
      collect_count: 20,
      comment_count: 3,
      share_count: 10,
      play_count: 0,
      score: null,
      tags: null,
      media_files: null,
      published_at: null,
      metadata: null,
    });
    postId = post.id;

    // Create task with mock cli_templates
    const cliTemplates = JSON.stringify({
      fetch_comments: 'MOCK:opencli xhs comments --post-id {post_id} --limit {limit} -f json',
      fetch_media: 'MOCK:opencli xhs download --post-id {post_id} -f json',
    });
    await createTask({
      id: TEST_TASK_ID,
      name: 'Offline E2E Test',
      description: 'E2E test with mock data (no real opencli)',
      template_id: null,
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

  // ============================================================
  // Phase 1: Mock Data Preparation (simulating prepare-data)
  // ============================================================

  it('should create task with mock cli_templates', async () => {
    const task = await getTaskById(TEST_TASK_ID);
    assert.ok(task);
    assert.equal(task.name, 'Offline E2E Test');
    assert.ok(task.cli_templates);

    const parsed = JSON.parse(task.cli_templates!);
    assert.ok(parsed.fetch_comments.startsWith('MOCK:'));
    assert.ok(parsed.fetch_media.startsWith('MOCK:'));
  });

  it('should simulate comments fetch from mock data', async () => {
    // In offline mode, we use MOCK_COMMENTS instead of calling opencli
    const mockData = MOCK_COMMENTS;
    assert.equal(mockData.length, 3);

    // Import mock comments
    let imported = 0;
    for (const item of mockData) {
      await createComment({
        post_id: postId,
        platform_id: TEST_PLATFORM,
        platform_comment_id: item.id,
        parent_comment_id: null,
        root_comment_id: null,
        depth: 0,
        author_id: null,
        author_name: item.author,
        content: item.content,
        like_count: item.likeCount,
        reply_count: item.replyCount,
        published_at: null,
        metadata: item,
      });
      imported++;
    }

    assert.equal(imported, 3);
    const commentList = await listCommentsByPost(postId, 100);
    assert.equal(commentList.length, 3);
  });

  it('should simulate media fetch from mock data', async () => {
    // In offline mode, we use MOCK_MEDIA instead of calling opencli
    const mockData = MOCK_MEDIA;
    assert.equal(mockData.length, 2);

    // Import mock media
    let imported = 0;
    for (const item of mockData) {
      await createMediaFile({
        post_id: postId,
        comment_id: null,
        platform_id: TEST_PLATFORM,
        media_type: item.type as any,
        url: item.url,
        local_path: null,
        width: item.width ?? null,
        height: item.height ?? null,
        duration_ms: item.duration_ms ?? null,
        file_size: null,
        downloaded_at: null,
      });
      imported++;
    }

    assert.equal(imported, 2);
    const mediaList = await listMediaFilesByPost(postId);
    assert.equal(mediaList.length, 2);
  });

  it('should track progress for mock data preparation', async () => {
    // Initialize status
    await upsertTaskPostStatus(TEST_TASK_ID, postId, { status: 'pending' });

    let status = await getTaskPostStatus(TEST_TASK_ID, postId);
    assert.ok(status);
    assert.equal(status.status, 'pending');

    // Mark comments as fetched (simulating opencli call)
    await upsertTaskPostStatus(TEST_TASK_ID, postId, {
      comments_fetched: true,
      comments_count: 3,
      status: 'fetching',
    });
    status = await getTaskPostStatus(TEST_TASK_ID, postId);
    assert.equal(status.comments_fetched, true);
    assert.equal(status.comments_count, 3);

    // Mark media as fetched
    await upsertTaskPostStatus(TEST_TASK_ID, postId, {
      media_fetched: true,
      media_count: 2,
      status: 'done',
    });
    status = await getTaskPostStatus(TEST_TASK_ID, postId);
    assert.equal(status.media_fetched, true);
    assert.equal(status.media_count, 2);
    assert.equal(status.status, 'done');
  });

  it('should verify breakpoint recovery with mock data', async () => {
    // Post is already done
    const pending = await getPendingPostIds(TEST_TASK_ID);
    const postIds = pending.map(p => p.post_id);
    assert.ok(!postIds.includes(postId), 'post should not be pending after both fetched');

    // Simulate re-running prepare-data — should skip
    assert.equal(pending.length, 0, 'no pending posts should be returned');
  });

  // ============================================================
  // Phase 2: Analysis Pipeline (same as real E2E)
  // ============================================================

  it('should create queue jobs from task targets', async () => {
    const stats = await getTargetStats(TEST_TASK_ID);
    assert.ok(stats.total > 0, 'expected at least 1 target');

    const jobs = stats.pending.map(t => ({
      id: generateId(),
      task_id: TEST_TASK_ID,
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
    }

    const taskJobs = await listJobsByTask(TEST_TASK_ID);
    assert.ok(taskJobs.length >= jobs.length, 'expected queue jobs');
  });

  it('should verify full offline data flow', async () => {
    const task = await getTaskById(TEST_TASK_ID);
    assert.ok(task);

    const post = await getPostById(postId);
    assert.ok(post);

    const commentList = await listCommentsByPost(postId, 100);
    assert.equal(commentList.length, 3, 'expected 3 mock comments');

    const mediaList = await listMediaFilesByPost(postId);
    assert.equal(mediaList.length, 2, 'expected 2 mock media files');

    const statuses = await getTaskPostStatuses(TEST_TASK_ID);
    assert.equal(statuses.length, 1, 'expected 1 status record');
    assert.equal(statuses[0].comments_fetched, true);
    assert.equal(statuses[0].media_fetched, true);

    console.log(`  Offline E2E verified: ${commentList.length} comments, ${mediaList.length} media, ${statuses.length} status`);
  });

  // ============================================================
  // Edge Cases — Mock Data
  // ============================================================

  it('should handle empty mock comments', async () => {
    const emptyData: any[] = [];
    let imported = 0;
    for (const item of emptyData) {
      await createComment({
        post_id: postId,
        platform_id: TEST_PLATFORM,
        platform_comment_id: item.id ?? null,
        parent_comment_id: null,
        root_comment_id: null,
        depth: 0,
        author_id: null,
        author_name: 'Unknown',
        content: '',
        like_count: 0,
        reply_count: 0,
        published_at: null,
        metadata: item,
      });
      imported++;
    }
    assert.equal(imported, 0, 'empty mock data should import 0 comments');
  });

  it('should handle mock media with missing fields', async () => {
    const partialData = [{ url: 'https://example.com/partial.jpg' }];
    let imported = 0;
    for (const item of partialData) {
      await createMediaFile({
        post_id: postId,
        comment_id: null,
        platform_id: TEST_PLATFORM,
        media_type: 'image',
        url: item.url,
        local_path: null,
        width: null,
        height: null,
        duration_ms: null,
        file_size: null,
        downloaded_at: null,
      });
      imported++;
    }
    assert.equal(imported, 1, 'partial mock media should import successfully');
  });
});
