import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../dist/db/client.js';
const { query, run, close: closeDb } = db;
import * as migrate from '../dist/db/migrate.js';
const { runMigrations } = migrate;
import * as seed from '../dist/db/seed.js';
const { seedAll } = seed;
import * as platforms from '../dist/db/platforms.js';
const { createPlatform } = platforms;
import * as tasks from '../dist/db/tasks.js';
const { createTask } = tasks;
import * as posts from '../dist/db/posts.js';
const { createPost } = posts;
import * as comments from '../dist/db/comments.js';
const { createComment } = comments;
import * as strategies from '../dist/db/strategies.js';
const { createStrategy } = strategies;
import * as taskSteps from '../dist/db/task-steps.js';
const { createTaskStep } = taskSteps;
import * as taskTargets from '../dist/db/task-targets.js';
const { createTaskTarget } = taskTargets;
import * as taskPostStatus from '../dist/db/task-post-status.js';
const { upsertTaskPostStatus } = taskPostStatus;
import * as utils from '../dist/shared/utils.js';
const { generateId, now } = utils;
import * as streamScheduler from '../dist/daemon/stream-scheduler.js';
const { onPostReady } = streamScheduler;

const RUN_ID = `ss_${Date.now()}`;

describe('stream-scheduler — onPostReady', { timeout: 15000 }, () => {
  let platformId: string;
  let taskId: string;
  let postId: string;
  let commentId: string;
  let strategyId: string;
  let stepId: string;

  before(async () => {
    closeDb();
    await runMigrations();
    await seedAll();

    platformId = generateId();
    await createPlatform({ id: platformId, name: `test-platform-${RUN_ID}`, description: null });

    taskId = generateId();
    await createTask({
      id: taskId,
      name: 'test-task',
      description: null,
      template_id: null,
      cli_templates: null,
      status: 'pending',
      stats: { total: 0, done: 0, failed: 0 },
      created_at: now(),
      updated_at: now(),
      completed_at: null,
    });

    const post = await createPost({
      platform_id: platformId,
      platform_post_id: 'note_123',
      title: 'Test Post',
      content: 'Hello world',
      author_id: null,
      author_name: null,
      author_url: null,
      url: null,
      cover_url: null,
      post_type: null,
      like_count: 0,
      collect_count: 0,
      comment_count: 0,
      share_count: 0,
      play_count: 0,
      score: null,
      tags: null,
      media_files: null,
      published_at: null,
      metadata: null,
    });
    postId = post.id;

    const comment = await createComment({
      post_id: postId,
      platform_id: platformId,
      platform_comment_id: 'cmt_1',
      parent_comment_id: null,
      root_comment_id: null,
      depth: 0,
      author_id: null,
      author_name: null,
      content: 'Nice post',
      like_count: 0,
      reply_count: 0,
      published_at: null,
      metadata: null,
    });
    commentId = comment.id;

    await createTaskTarget(taskId, 'post', postId);

    strategyId = generateId();
    await createStrategy({
      id: strategyId,
      name: 'sentiment',
      description: null,
      version: '1.0.0',
      target: 'comment',
      needs_media: null,
      prompt: 'Analyze sentiment',
      output_schema: { type: 'object', properties: { sentiment: { type: 'string' } } },
      file_path: null,
    });

    const step = await createTaskStep({
      task_id: taskId,
      strategy_id: strategyId,
      name: 'sentiment-analysis',
      step_order: 0,
      status: 'pending',
      stats: { total: 0, done: 0, failed: 0 },
      error: null,
    });
    stepId = step.id;

    // Mark post as data-ready
    await upsertTaskPostStatus(taskId, postId, { status: 'done', comments_fetched: true, media_fetched: true });
  });

  beforeEach(async () => {
    await run("DELETE FROM queue_jobs WHERE task_id = ?", [taskId]);
    await run("UPDATE task_steps SET status = 'pending', stats = ? WHERE id = ?", [JSON.stringify({ total: 0, done: 0, failed: 0 }), stepId]);
  });

  it('enqueues jobs for all comments when post is ready', async () => {
    const result = await onPostReady(taskId, postId);
    assert.equal(result.enqueued, 1);
    assert.equal(result.skipped, 0);

    const jobs = await query('SELECT * FROM queue_jobs WHERE task_id = ? AND strategy_id = ?', [taskId, strategyId]);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].target_id, commentId);
    assert.equal(jobs[0].target_type, 'comment');
    assert.equal(jobs[0].status, 'pending');

    // Step should be marked running
    const stepRows = await query('SELECT status, stats FROM task_steps WHERE id = ?', [stepId]);
    assert.equal(stepRows[0].status, 'running');
    const stats = typeof stepRows[0].stats === 'string' ? JSON.parse(stepRows[0].stats) : stepRows[0].stats;
    assert.equal(stats.total, 1);
  });

  it('skips already-enqueued targets on second call', async () => {
    // First call enqueues the job
    await onPostReady(taskId, postId);

    // Second call should find nothing new to enqueue
    const result = await onPostReady(taskId, postId);
    assert.equal(result.enqueued, 0);
    assert.equal(result.skipped, 0);
  });
});
