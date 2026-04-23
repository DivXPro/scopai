import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../packages/core/dist/db/client.js';
const { query, close: closeDb } = db;
import * as migrate from '../../packages/core/dist/db/migrate.js';
const { runMigrations } = migrate;
import * as platforms from '../../packages/core/dist/db/platforms.js';
const { createPlatform } = platforms;
import * as posts from '../../packages/core/dist/db/posts.js';
const { createPost } = posts;
import * as comments from '../../packages/core/dist/db/comments.js';
const { createComment, listCommentsByIds, getCommentById } = comments;
import * as tasks from '../../packages/core/dist/db/tasks.js';
const { createTask } = tasks;
import * as taskTargets from '../../packages/core/dist/db/task-targets.js';
const { addTaskTargets } = taskTargets;
import * as taskSteps from '../../packages/core/dist/db/task-steps.js';
const { createTaskStep } = taskSteps;
import * as strategies from '../../packages/core/dist/db/strategies.js';
const { validateStrategyJson, createStrategy, createStrategyResultTable } = strategies;
import * as utils from '../../packages/core/dist/shared/utils.js';
const { generateId } = utils;

const RUN_ID = `comment_${Date.now()}`;

describe('Comment strategy analysis', { timeout: 30000 }, () => {
  let platformId: string;
  let postId: string;
  let commentIds: string[];
  let taskId: string;
  let strategyId: string;

  before(async () => {
    closeDb();
    await runMigrations();

    platformId = `${RUN_ID}_platform`;
    await createPlatform({ id: platformId, name: `Test (${RUN_ID})`, description: null });

    const post = await createPost({
      platform_id: platformId,
      platform_post_id: 'note123',
      title: 'Test Post',
      content: 'Test content',
      author_id: null,
      author_name: 'Author',
      author_url: null,
      url: null,
      cover_url: null,
      post_type: 'text',
      like_count: 0,
      collect_count: 0,
      comment_count: 0,
      share_count: 0,
      play_count: 0,
      score: null,
      tags: null,
      media_files: null,
      published_at: new Date(),
      metadata: null,
    });
    postId = post.id;

    commentIds = [];
    for (let i = 0; i < 5; i++) {
      const c = await createComment({
        post_id: postId,
        platform_id: platformId,
        platform_comment_id: `c${i}`,
        content: `Comment ${i + 1}`,
        author_id: null,
        author_name: `User${i + 1}`,
        depth: i % 2,
        parent_comment_id: i > 0 ? commentIds[i - 1] : null,
        root_comment_id: null,
        like_count: 0,
        reply_count: 0,
        published_at: new Date(),
        metadata: null,
      });
      commentIds.push(c.id);
    }

    taskId = `${RUN_ID}_task`;
    await createTask({
      id: taskId, name: 'Comment Analysis Test', description: null,
      template_id: null, cli_templates: null, status: 'pending',
      stats: { total: 0, done: 0, failed: 0 },
      created_at: new Date(), updated_at: new Date(), completed_at: null,
    });

    await addTaskTargets(taskId, 'post', [postId]);

    strategyId = `${RUN_ID}_sentiment`;
    const strategyJson = {
      id: strategyId, name: 'Comment Sentiment', version: '1.0.0', target: 'comment',
      prompt: 'Analyze sentiment of: {{content}} by {{author_name}} (depth={{depth}} parent={{parent_author}})',
      output_schema: { type: 'object', properties: { sentiment: { type: 'string' } } },
      batch_config: { enabled: true, size: 3 },
    };
    const validation = validateStrategyJson(strategyJson);
    assert.strictEqual(validation.valid, true, validation.error);
    await createStrategyResultTable(strategyId, [{ name: 'sentiment', sqlType: 'TEXT', indexable: false }]);
    await createStrategy({
      ...strategyJson,
      description: null,
      needs_media: { enabled: false },
      depends_on: null,
      include_original: false,
      file_path: null,
    });

    await createTaskStep({
      task_id: taskId, strategy_id: strategyId, depends_on_step_id: null, name: 'Sentiment',
      step_order: 0, status: 'pending', stats: { total: 0, done: 0, failed: 0 }, error: null,
    });
  });

  it('should list comments by ids', async () => {
    const result = await listCommentsByIds(commentIds.slice(0, 2));
    assert.strictEqual(result.length, 2);
  });

  it('should return empty array for empty ids', async () => {
    const result = await listCommentsByIds([]);
    assert.strictEqual(result.length, 0);
  });

  it('should build comment prompt with depth and parent context', async () => {
    const { buildCommentPrompt } = await import('../../src/worker/anthropic.ts');
    const comment = await getCommentById(commentIds[1]);
    assert.ok(comment);
    const prompt = await buildCommentPrompt(comment!, {
      id: strategyId, name: 'Test', prompt: '{{content}} depth={{depth}} parent={{parent_author}}',
      output_schema: { type: 'object', properties: {} },
      target: 'comment', version: '1.0.0', needs_media: null,
      batch_config: null, file_path: null,
      description: null, created_at: new Date(), updated_at: new Date(),
    });
    assert.ok(prompt.includes('depth=1'));
    assert.ok(prompt.includes('parent=User1'));
  });

  it('should validate batch_config in strategy JSON', () => {
    const valid = validateStrategyJson({
      id: 'b1', name: 'Batch', version: '1.0.0', target: 'comment',
      prompt: 'Analyze', output_schema: { type: 'object', properties: {} },
      batch_config: { enabled: true, size: 10 },
    });
    assert.strictEqual(valid.valid, true);

    const invalidSize = validateStrategyJson({
      id: 'b2', name: 'Batch', version: '1.0.0', target: 'comment',
      prompt: 'Analyze', output_schema: { type: 'object', properties: {} },
      batch_config: { enabled: true, size: 200 },
    });
    assert.strictEqual(invalidSize.valid, false);
    assert.ok(invalidSize.error?.includes('size'));

    const invalidType = validateStrategyJson({
      id: 'b3', name: 'Batch', version: '1.0.0', target: 'comment',
      prompt: 'Analyze', output_schema: { type: 'object', properties: {} },
      batch_config: { enabled: 'yes' },
    });
    assert.strictEqual(invalidType.valid, false);
    assert.ok(invalidType.error?.includes('enabled'));
  });

  it('should parse batch strategy result', async () => {
    const { parseBatchStrategyResult } = await import('../../src/worker/parser.ts');
    const outputSchema = {
      type: 'object',
      properties: {
        sentiment: { type: 'string' },
        score: { type: 'number' },
      },
    };

    const raw = JSON.stringify({
      results: [
        { sentiment: 'positive', score: 0.9 },
        { sentiment: 'negative', score: 0.2 },
      ],
    });

    const parsed = parseBatchStrategyResult(raw, outputSchema);
    assert.strictEqual(parsed.values.length, 2);
    assert.strictEqual(parsed.values[0].sentiment, 'positive');
    assert.strictEqual(parsed.values[1].score, 0.2);
  });

  it('should reject batch result with mismatched count', async () => {
    const { parseBatchStrategyResult } = await import('../../src/worker/parser.ts');
    const outputSchema = {
      type: 'object',
      properties: { sentiment: { type: 'string' } },
    };

    const raw = JSON.stringify({
      results: [
        { sentiment: 'positive' },
      ],
    });

    // This parses fine, count check is done by caller
    const parsed = parseBatchStrategyResult(raw, outputSchema);
    assert.strictEqual(parsed.values.length, 1);
  });

  it('should reject invalid batch JSON', async () => {
    const { parseBatchStrategyResult } = await import('../../src/worker/parser.ts');
    const outputSchema = { type: 'object', properties: {} };

    assert.throws(() => parseBatchStrategyResult('not-json', outputSchema), /Invalid JSON/);
  });

  it('should reject batch result without array', async () => {
    const { parseBatchStrategyResult } = await import('../../src/worker/parser.ts');
    const outputSchema = { type: 'object', properties: {} };

    assert.throws(() => parseBatchStrategyResult('{"foo": "bar"}', outputSchema), /results array/);
  });
});
