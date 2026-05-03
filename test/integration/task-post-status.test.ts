import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../packages/core/dist/db/client.js';
const { query, run, close: closeDb } = db;
import * as migrate from '../../packages/core/dist/db/migrate.js';
const { runMigrations } = migrate;
import * as seed from '../../packages/core/dist/db/seed.js';
const { seedAll } = seed;
import * as taskPostStatus from '../../packages/core/dist/db/task-post-status.js';
const { upsertTaskPostStatus, getTaskPostStatuses, getTaskPostStatus, getPendingPostIds } = taskPostStatus;
import * as tasks from '../../packages/core/dist/db/tasks.js';
const { createTask, getTaskById, updateTaskCliTemplates } = tasks;
import * as platforms from '../../packages/core/dist/db/platforms.js';
const { createPlatform } = platforms;
import * as posts from '../../packages/core/dist/db/posts.js';
const { createPost } = posts;
import * as taskTargets from '../../packages/core/dist/db/task-targets.js';
const { createTaskTarget } = taskTargets;
import * as utils from '../../packages/core/dist/shared/utils.js';
const { generateId, now } = utils;

// Test constants — use timestamp to avoid collisions across runs
const RUN_ID = `tps_${Date.now()}`;
const TEST_TASK_ID = `${RUN_ID}_task`;
const TEST_POST_1 = `${RUN_ID}_p1`;
const TEST_POST_2 = `${RUN_ID}_p2`;
const TEST_PLATFORM = `${RUN_ID}_platform`;

describe('task-post-status — real DB (integration)', { timeout: 15000 }, () => {
  before(async () => {
    closeDb(); // Reset connection from previous tests
    await runMigrations();
    await seedAll();

    // Create test platform
    await createPlatform({
      id: TEST_PLATFORM,
      name: `Test Platform (status ${RUN_ID})`,
      description: 'For task-post-status tests',
    });

    // Create test posts
    await createPost({
      platform_id: TEST_PLATFORM,
      platform_post_id: TEST_POST_1,
      title: 'Test Post 1',
      content: 'Test content 1',
      author_id: null, author_name: 'Test Author', author_url: null,
      url: null, cover_url: null, post_type: 'text',
      like_count: 0, collect_count: 0, comment_count: 0,
      share_count: 0, play_count: 0, score: null,
      tags: null, media_files: null, published_at: null,
      metadata: null,
    });
    await createPost({
      platform_id: TEST_PLATFORM,
      platform_post_id: TEST_POST_2,
      title: 'Test Post 2',
      content: 'Test content 2',
      author_id: null, author_name: 'Test Author', author_url: null,
      url: null, cover_url: null, post_type: 'text',
      like_count: 0, collect_count: 0, comment_count: 0,
      share_count: 0, play_count: 0, score: null,
      tags: null, media_files: null, published_at: null,
      metadata: null,
    });

    // Create test task with cli_templates
    await createTask({
      id: TEST_TASK_ID,
      name: 'Test Task (status)',
      description: 'For task-post-status tests',
      cli_templates: '{"fetch_comments":"opencli hackernews top --limit {limit} -f json"}',
      status: 'pending',
      stats: { total: 0, done: 0, failed: 0 },
      created_at: now(),
      updated_at: now(),
      completed_at: null,
    });

    // Bind posts as task targets
    await createTaskTarget(TEST_TASK_ID, 'post', TEST_POST_1);
    await createTaskTarget(TEST_TASK_ID, 'post', TEST_POST_2);
  });

  it('should create task with cli_templates and retrieve it', async () => {
    const task = await getTaskById(TEST_TASK_ID);
    assert.ok(task);
    assert.equal(task.cli_templates, '{"fetch_comments":"opencli hackernews top --limit {limit} -f json"}');
  });

  it('should update cli_templates', async () => {
    const newTemplates = '{"fetch_media":"opencli test"}';
    await updateTaskCliTemplates(TEST_TASK_ID, newTemplates);
    const task = await getTaskById(TEST_TASK_ID);
    assert.ok(task);
    assert.equal(task.cli_templates, newTemplates);
    // Restore
    await updateTaskCliTemplates(TEST_TASK_ID, '{"fetch_comments":"opencli hackernews top --limit {limit} -f json"}');
  });

  it('should upsert new post status', async () => {
    await upsertTaskPostStatus(TEST_TASK_ID, TEST_POST_1, { status: 'pending' });
    const status = await getTaskPostStatus(TEST_TASK_ID, TEST_POST_1);
    assert.ok(status);
    assert.equal(status.task_id, TEST_TASK_ID);
    assert.equal(status.post_id, TEST_POST_1);
    assert.equal(status.status, 'pending');
    assert.equal(status.comments_fetched, false);
    assert.equal(status.media_fetched, false);
  });

  it('should preserve existing values when upserting with partial updates', async () => {
    // Set comments_fetched = true
    await upsertTaskPostStatus(TEST_TASK_ID, TEST_POST_1, { comments_fetched: true, comments_count: 5 });

    // Upsert only status (should NOT reset comments_fetched)
    await upsertTaskPostStatus(TEST_TASK_ID, TEST_POST_1, { status: 'fetching' });

    const status = await getTaskPostStatus(TEST_TASK_ID, TEST_POST_1);
    assert.ok(status);
    assert.equal(status.status, 'fetching');
    assert.equal(status.comments_fetched, true);
    assert.equal(status.comments_count, 5);
  });

  it('should clear error field on successful upsert', async () => {
    // Set an error
    await upsertTaskPostStatus(TEST_TASK_ID, TEST_POST_1, { status: 'failed', error: 'connection timeout' });
    let status = await getTaskPostStatus(TEST_TASK_ID, TEST_POST_1);
    assert.ok(status);
    assert.equal(status.error, 'connection timeout');

    // Clear error by setting status to done with error = null
    await upsertTaskPostStatus(TEST_TASK_ID, TEST_POST_1, { status: 'done', error: null });
    status = await getTaskPostStatus(TEST_TASK_ID, TEST_POST_1);
    assert.ok(status);
    assert.equal(status.status, 'done');
    assert.equal(status.error, null);
  });

  it('should get all post statuses for a task', async () => {
    // Ensure both posts have status records
    await upsertTaskPostStatus(TEST_TASK_ID, TEST_POST_2, { status: 'pending' });

    const statuses = await getTaskPostStatuses(TEST_TASK_ID);
    const postIds = statuses.map(s => s.post_id);
    assert.ok(postIds.includes(TEST_POST_1));
    assert.ok(postIds.includes(TEST_POST_2));
  });

  it('should return only pending (incomplete) posts', async () => {
    // Set post1 as fully fetched
    await upsertTaskPostStatus(TEST_TASK_ID, TEST_POST_1, { comments_fetched: true, media_fetched: true, status: 'done' });
    // Keep post2 as pending
    await upsertTaskPostStatus(TEST_TASK_ID, TEST_POST_2, { comments_fetched: false, media_fetched: false, status: 'pending' });

    const pending = await getPendingPostIds(TEST_TASK_ID);
    const postIds = pending.map(p => p.post_id);
    assert.ok(!postIds.includes(TEST_POST_1), 'post1 should not be in pending');
    assert.ok(postIds.includes(TEST_POST_2), 'post2 should be in pending');
  });

  it('should handle partial fetch correctly in getPendingPostIds', async () => {
    // Set post2 as fetching with comments fetched but media not fetched
    await upsertTaskPostStatus(TEST_TASK_ID, TEST_POST_2, { comments_fetched: true, media_fetched: false, status: 'fetching' });
    const pending = await getPendingPostIds(TEST_TASK_ID);
    const postIds = pending.map(p => p.post_id);
    assert.ok(postIds.includes(TEST_POST_2), 'post2 should still be pending (media not fetched)');

    // Now mark media as fetched and status done
    await upsertTaskPostStatus(TEST_TASK_ID, TEST_POST_2, { media_fetched: true, status: 'done' });
    const pending2 = await getPendingPostIds(TEST_TASK_ID);
    const postIds2 = pending2.map(p => p.post_id);
    assert.ok(!postIds2.includes(TEST_POST_2), 'post2 should not be pending after done');
  });

  it('should return null for non-existent post status', async () => {
    const status = await getTaskPostStatus(TEST_TASK_ID, 'non_existent_post');
    assert.equal(status, null);
  });

  it('should exclude failed posts from getPendingPostIds', async () => {
    const uniquePost = `${RUN_ID}_failed_post`;
    await createPost({
      platform_id: TEST_PLATFORM,
      platform_post_id: uniquePost,
      title: 'Failed Post',
      content: 'Test content',
      author_id: null, author_name: 'Test Author', author_url: null,
      url: null, cover_url: null, post_type: 'text',
      like_count: 0, collect_count: 0, comment_count: 0,
      share_count: 0, play_count: 0, score: null,
      tags: null, media_files: null, published_at: null,
      metadata: null,
    });
    await createTaskTarget(TEST_TASK_ID, 'post', uniquePost);
    await upsertTaskPostStatus(TEST_TASK_ID, uniquePost, { status: 'failed', error: 'some error' });

    const pending = await getPendingPostIds(TEST_TASK_ID);
    const postIds = pending.map(p => p.post_id);
    assert.ok(!postIds.includes(uniquePost), 'failed post should not be in pending list');
  });

  it('should preserve error field when not explicitly cleared', async () => {
    const uniquePost = `${RUN_ID}_preserve_post`;
    await createPost({
      platform_id: TEST_PLATFORM,
      platform_post_id: uniquePost,
      title: 'Preserve Post',
      content: 'Test content',
      author_id: null, author_name: 'Test Author', author_url: null,
      url: null, cover_url: null, post_type: 'text',
      like_count: 0, collect_count: 0, comment_count: 0,
      share_count: 0, play_count: 0, score: null,
      tags: null, media_files: null, published_at: null,
      metadata: null,
    });
    await createTaskTarget(TEST_TASK_ID, 'post', uniquePost);

    // Set an error
    await upsertTaskPostStatus(TEST_TASK_ID, uniquePost, { status: 'failed', error: 'connection timeout' });
    let status = await getTaskPostStatus(TEST_TASK_ID, uniquePost);
    assert.equal(status?.error, 'connection timeout');

    // Update status without specifying error — should preserve existing error via COALESCE
    await upsertTaskPostStatus(TEST_TASK_ID, uniquePost, { status: 'fetching' });
    status = await getTaskPostStatus(TEST_TASK_ID, uniquePost);
    assert.equal(status?.error, 'connection timeout', 'error should be preserved when not explicitly cleared');

    // Explicitly clear error
    await upsertTaskPostStatus(TEST_TASK_ID, uniquePost, { status: 'done', error: null });
    status = await getTaskPostStatus(TEST_TASK_ID, uniquePost);
    assert.equal(status?.error, null, 'error should be cleared when explicitly set to null');
  });
});
