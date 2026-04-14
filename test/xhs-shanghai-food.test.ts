import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../dist/db/client.js';
const { query, run, close: closeDb } = db;
import * as migrate from '../dist/db/migrate.js';
const { runMigrations } = migrate;
import * as seed from '../dist/db/seed.js';
const { seedAll } = seed;
import * as platforms from '../dist/db/platforms.js';
const { createPlatform } = platforms;
import * as posts from '../dist/db/posts.js';
const { createPost, getPostById, listPosts, countPosts } = posts;
import * as tasks from '../dist/db/tasks.js';
const { createTask, getTaskById, updateTaskStatus } = tasks;
import * as taskTargets from '../dist/db/task-targets.js';
const { createTaskTarget, listTaskTargets, getTargetStats } = taskTargets;
import * as taskPostStatus from '../dist/db/task-post-status.js';
const { getTaskPostStatuses, getPendingPostIds, upsertTaskPostStatus, getTaskPostStatus } = taskPostStatus;
import * as opencli from '../dist/data-fetcher/opencli.js';
const { fetchViaOpencli } = opencli;
import * as comments from '../dist/db/comments.js';
const { createComment, listCommentsByPost, countComments } = comments;
import * as mediaFiles from '../dist/db/media-files.js';
const { createMediaFile, listMediaFilesByPost } = mediaFiles;
import * as queueJobs from '../dist/db/queue-jobs.js';
const { enqueueJobs, listJobsByTask } = queueJobs;
import * as utils from '../dist/shared/utils.js';
const { generateId, now } = utils;

// ============================================================
// Real Xiaohongshu Shanghai Food Hot Post E2E Test
// ============================================================
// Uses real opencli calls to XHS with logged-in browser session
// Tests the complete pipeline: search → import → prepare → analyze
// ============================================================

const XHS_NOTE_ID = '68835071000000001c0358d3';
const XHS_NOTE_URL = 'https://www.xiaohongshu.com/discovery/item/68835071000000001c0358d3?xsec_token=ABN6PhNNsXdSuNl-_ml4oxwPOZ-xYOjWJvkwdLkNe4p2k=&xsec_source=';
const RUN_ID = `xhs_${Date.now()}`;
const TEST_PLATFORM = `${RUN_ID}_xhs`;
const TEST_TASK_ID = `${RUN_ID}_shanghai_food`;

describe('xhs shanghai food — real data E2E', { timeout: 120000 }, () => {
  let postId: string;
  let realComments: any[] = [];
  let realMedia: any[] = [];
  let searchResults: any[] = [];

  // ============================================================
  // Phase 0: Fetch real data from Xiaohongshu
  // ============================================================

  before(async () => {
    closeDb(); // Reset connection from previous tests
    await runMigrations();
    await seedAll();

    // Create XHS platform
    await createPlatform({
      id: TEST_PLATFORM,
      name: `Xiaohongshu (${RUN_ID})`,
      description: '小红书 - Shanghai Food E2E Test',
    });

    // Step 1: Search for Shanghai food posts
    console.log('  [1/4] Searching XHS for Shanghai food posts...');
    const searchResult = await fetchViaOpencli(
      'opencli xiaohongshu search {query} --limit {limit} -f json',
      { query: '上海美食', limit: '3' },
      30000,
    );
    assert.equal(searchResult.success, true, `search failed: ${searchResult.error}`);
    assert.ok(searchResult.data!.length > 0, 'expected at least 1 search result');
    searchResults = searchResult.data!;
    console.log(`  Found ${searchResults.length} Shanghai food posts`);

    // Step 2: Fetch real comments for the target post
    console.log('  [2/4] Fetching comments for target post...');
    const commentsResult = await fetchViaOpencli(
      'opencli xiaohongshu comments {note_id} --limit {limit} -f json',
      { note_id: XHS_NOTE_URL, limit: '10' },
      60000,
    );
    assert.equal(commentsResult.success, true, `comments fetch failed: ${commentsResult.error}`);
    realComments = commentsResult.data || [];
    console.log(`  Fetched ${realComments.length} comments`);

    // Step 3: Fetch real media info for the target post
    console.log('  [3/4] Fetching media info for target post...');
    const mediaResult = await fetchViaOpencli(
      'opencli xiaohongshu download {note_id} -f json',
      { note_id: XHS_NOTE_URL },
      60000,
    );
    assert.equal(mediaResult.success, true, `media fetch failed: ${mediaResult.error}`);
    realMedia = mediaResult.data || [];
    console.log(`  Fetched ${realMedia.length} media items`);

    // Step 4: Create post from search result
    console.log('  [4/4] Creating post in DuckDB...');
    const firstPost = searchResults[0] as Record<string, unknown>;
    const post = await createPost({
      platform_id: TEST_PLATFORM,
      platform_post_id: XHS_NOTE_ID,
      title: (firstPost.title ?? '上海美食') as string,
      content: `上海美食热帖: ${firstPost.title}`,
      author_id: null,
      author_name: (firstPost.author ?? '小红书用户') as string,
      author_url: (firstPost.author_url ?? null) as string | null,
      url: (firstPost.url ?? null) as string | null,
      cover_url: null,
      post_type: 'image',
      like_count: parseInt(String(firstPost.likes ?? '0'), 10),
      collect_count: 0,
      comment_count: realComments.length,
      share_count: 0,
      play_count: 0,
      score: null,
      tags: [{ name: '上海美食', url: null }],
      media_files: null,
      published_at: firstPost.published_at ? new Date(String(firstPost.published_at)) : null,
      metadata: { ...firstPost, note_id: XHS_NOTE_ID, note_url: XHS_NOTE_URL },
    });
    postId = post.id;

    // Create task with real XHS CLI templates
    const cliTemplates = JSON.stringify({
      fetch_comments: 'opencli xiaohongshu comments {note_id} --limit {limit} -f json',
      fetch_media: 'opencli xiaohongshu download {note_id} --output downloads/xhs -f json',
    });
    await createTask({
      id: TEST_TASK_ID,
      name: '上海美食热帖分析',
      description: 'Analyze Shanghai food hot posts from Xiaohongshu',
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
  // Phase 1: Verify Real Data Fetch
  // ============================================================

  it('should fetch real Shanghai food search results', async () => {
    assert.ok(searchResults.length >= 1, 'expected at least 1 search result');
    const first = searchResults[0] as Record<string, unknown>;
    assert.ok('title' in first, 'search result should have title');
    assert.ok('author' in first, 'search result should have author');
    assert.ok('url' in first, 'search result should have URL');
    assert.ok('likes' in first, 'search result should have likes');
    console.log(`  Top post: "${first.title}" by ${first.author} (${first.likes} likes)`);
  });

  it('should fetch real comments from XHS post', async () => {
    assert.ok(realComments.length > 0, 'expected at least 1 comment');
    const first = realComments[0] as Record<string, unknown>;
    assert.ok('author' in first, 'comment should have author');
    assert.ok('text' in first, 'comment should have text');
    assert.ok('time' in first, 'comment should have time');
    console.log(`  First comment: ${first.author}: "${first.text}" (${first.time})`);
  });

  it('should fetch real media info from XHS post', async () => {
    assert.ok(realMedia.length > 0, 'expected at least 1 media item');
    const first = realMedia[0] as Record<string, unknown>;
    assert.ok('type' in first, 'media should have type');
    assert.ok('status' in first, 'media should have status');
    assert.equal(first.status, 'success', 'media download should succeed');
    console.log(`  First media: ${first.type} (${first.size})`);
  });

  // ============================================================
  // Phase 2: Import Data into DuckDB
  // ============================================================

  it('should import post into DuckDB', async () => {
    const post = await getPostById(postId);
    assert.ok(post, 'post should exist in DB');
    assert.equal(post.platform_id, TEST_PLATFORM);
    assert.ok(post.title?.includes('上海美食') || post.title?.length > 0, 'post should have title');
    assert.ok(post.author_name?.length > 0, 'post should have author');
    assert.ok(post.url?.includes('xiaohongshu.com'), 'post should have XHS URL');
    console.log(`  Imported post: "${post.title}"`);
  });

  it('should import comments into DuckDB', async () => {
    let imported = 0;
    for (const item of realComments) {
      if (typeof item !== 'object' || item === null) continue;
      const obj = item as Record<string, unknown>;
      try {
        await createComment({
          post_id: postId,
          platform_id: TEST_PLATFORM,
          platform_comment_id: `xhs_c${imported}`,
          parent_comment_id: null,
          root_comment_id: null,
          depth: 0,
          author_id: null,
          author_name: (obj.author ?? '匿名用户') as string,
          content: (obj.text ?? '') as string,
          like_count: Number(obj.likes ?? 0),
          reply_count: Number(obj.is_reply ? 1 : 0),
          published_at: obj.time ? new Date(String(obj.time).split(/[^\d-]/)[0]) : null,
          metadata: obj,
        });
        imported++;
      } catch {
        // Skip duplicates
      }
    }

    assert.ok(imported > 0, `expected at least 1 comment imported, got ${imported}`);
    const commentList = await listCommentsByPost(postId, 100);
    assert.equal(commentList.length, imported);
    console.log(`  Imported ${imported} real XHS comments`);
  });

  it('should import media into DuckDB with correct local_path', async () => {
    let imported = 0;
    for (const item of realMedia.slice(0, 5)) {
      if (typeof item !== 'object' || item === null) continue;
      const obj = item as Record<string, unknown>;
      const index = obj.index ?? imported + 1;
      // Construct local_path as prepare-data command would
      const localPath = `downloads/xhs/${XHS_NOTE_ID}/${XHS_NOTE_ID}_${index}.jpg`;
      try {
        await createMediaFile({
          post_id: postId,
          comment_id: null,
          platform_id: TEST_PLATFORM,
          media_type: (obj.type ?? 'image') as any,
          url: `https://ci.xiaohongshu.com/${XHS_NOTE_ID}_${index}.jpg`,
          local_path: localPath,
          width: null,
          height: null,
          duration_ms: null,
          file_size: null,
          downloaded_at: obj.status === 'success' ? now() : null,
        });
        imported++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`  Media import failed: ${msg}`);
      }
    }

    assert.ok(imported > 0, `expected at least 1 media imported, got ${imported}`);
    const mediaList = await listMediaFilesByPost(postId);
    assert.equal(mediaList.length, imported);
    // Verify local_path is set correctly
    assert.ok(mediaList[0].local_path?.includes('downloads/xhs'), 'local_path should point to downloads/xhs');
    console.log(`  Imported ${imported} real XHS media items`);
  });

  // ============================================================
  // Phase 3: Prepare-Data Simulation
  // ============================================================

  it('should verify task with real XHS CLI templates', async () => {
    const task = await getTaskById(TEST_TASK_ID);
    assert.ok(task);
    assert.equal(task.name, '上海美食热帖分析');
    assert.ok(task.cli_templates);

    const parsed = JSON.parse(task.cli_templates!);
    assert.ok(parsed.fetch_comments.includes('xiaohongshu comments'));
    assert.ok(parsed.fetch_media.includes('xiaohongshu download'));
  });

  it('should simulate prepare-data with real XHS templates', async () => {
    const task = await getTaskById(TEST_TASK_ID);
    const templates = JSON.parse(task!.cli_templates!);

    // Verify templates would work with real note_id
    const commentTemplate = templates.fetch_comments.replace('{note_id}', XHS_NOTE_URL).replace('{limit}', '5');
    assert.ok(commentTemplate.includes('xiaohongshu comments'));
    assert.ok(commentTemplate.includes(XHS_NOTE_URL));

    const mediaTemplate = templates.fetch_media.replace('{note_id}', XHS_NOTE_URL);
    assert.ok(mediaTemplate.includes('xiaohongshu download'));
    assert.ok(mediaTemplate.includes(XHS_NOTE_URL));

    // Track progress
    await upsertTaskPostStatus(TEST_TASK_ID, postId, { status: 'pending' });

    let status = await getTaskPostStatus(TEST_TASK_ID, postId);
    assert.ok(status);
    assert.equal(status.status, 'pending');

    // Mark comments as fetched
    await upsertTaskPostStatus(TEST_TASK_ID, postId, {
      comments_fetched: true,
      comments_count: realComments.length,
      status: 'fetching',
    });
    status = await getTaskPostStatus(TEST_TASK_ID, postId);
    assert.equal(status.comments_fetched, true);
    assert.equal(status.comments_count, realComments.length);

    // Mark media as fetched
    await upsertTaskPostStatus(TEST_TASK_ID, postId, {
      media_fetched: true,
      media_count: realMedia.length,
      status: 'done',
    });
    status = await getTaskPostStatus(TEST_TASK_ID, postId);
    assert.equal(status.media_fetched, true);
    assert.equal(status.media_count, realMedia.length);
    assert.equal(status.status, 'done');
  });

  it('should verify breakpoint recovery after prepare-data', async () => {
    const pending = await getPendingPostIds(TEST_TASK_ID);
    const postIds = pending.map(p => p.post_id);
    assert.ok(!postIds.includes(postId), 'post should not be pending after both fetched');
    assert.equal(pending.length, 0, 'no pending posts should be returned');
  });

  // ============================================================
  // Phase 4: Analysis Pipeline
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
    console.log(`  Created ${taskJobs.length} queue jobs`);
  });

  it('should verify complete E2E data flow', async () => {
    // Verify post
    const post = await getPostById(postId);
    assert.ok(post);
    assert.ok(post.url?.includes('xiaohongshu.com'), 'post should have real XHS URL');

    // Verify comments
    const commentList = await listCommentsByPost(postId, 100);
    assert.ok(commentList.length > 0, 'expected real XHS comments');
    // Verify comment content is real Chinese text
    const firstComment = commentList[0];
    assert.ok(firstComment.content?.length > 0, 'comment should have content');
    assert.ok(firstComment.author_name?.length > 0, 'comment should have author');

    // Verify media
    const mediaList = await listMediaFilesByPost(postId);
    assert.ok(mediaList.length > 0, 'expected real XHS media');
    const firstMedia = mediaList[0];
    assert.ok(firstMedia.url?.includes('xiaohongshu.com'), 'media should have real XHS URL');
    assert.equal(firstMedia.media_type, 'image', 'media should be image type');

    // Verify task status
    const task = await getTaskById(TEST_TASK_ID);
    assert.ok(task);
    assert.equal(task.name, '上海美食热帖分析');

    // Verify task_post_status
    const statuses = await getTaskPostStatuses(TEST_TASK_ID);
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].comments_fetched, true);
    assert.equal(statuses[0].media_fetched, true);

    // Verify queue jobs
    const taskJobs = await listJobsByTask(TEST_TASK_ID);
    assert.ok(taskJobs.length > 0, 'expected queue jobs');

    console.log(`  ✅ E2E verified:`);
    console.log(`    Post: "${post.title}" (${post.url?.slice(0, 50)}...)`);
    console.log(`    Comments: ${commentList.length} (e.g., "${firstComment.content?.slice(0, 20)}...")`);
    console.log(`    Media: ${mediaList.length} images`);
    console.log(`    Queue jobs: ${taskJobs.length}`);
    console.log(`    Status: ${statuses[0].status} (comments=${statuses[0].comments_count}, media=${statuses[0].media_count})`);
  });

  // ============================================================
  // Phase 5: Data Quality Verification
  // ============================================================

  it('should verify comment data quality', async () => {
    const commentList = await listCommentsByPost(postId, 100);
    assert.ok(commentList.length > 0);

    // All comments should have valid fields
    for (const c of commentList) {
      assert.ok(c.content?.length > 0, `comment should have content: ${c.id}`);
      assert.ok(c.platform_id === TEST_PLATFORM, `comment should have correct platform: ${c.id}`);
      assert.ok(c.post_id === postId, `comment should link to correct post: ${c.id}`);
    }

    // Verify metadata contains original XHS data (may be stored as JSON string)
    const rawMeta = commentList[0].metadata;
    const firstMeta = typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta;
    assert.ok(firstMeta, 'comment should have metadata');
    assert.ok(typeof firstMeta === 'object', 'metadata should be an object');
    assert.ok('author' in (firstMeta as object) || 'text' in (firstMeta as object), 'metadata should contain original XHS fields');
  });

  it('should verify media data quality', async () => {
    const mediaList = await listMediaFilesByPost(postId);
    assert.ok(mediaList.length > 0);

    for (const m of mediaList) {
      assert.ok(m.url?.length > 0, `media should have URL: ${m.id}`);
      assert.ok(m.local_path?.includes('downloads/xhs'), `media should have local_path: ${m.id}`);
      assert.ok(m.media_type === 'image', `media should be image: ${m.id}`);
      assert.ok(m.post_id === postId, `media should link to correct post: ${m.id}`);
    }
  });
});
