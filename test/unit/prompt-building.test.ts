import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildStrategyPrompt, buildCommentPrompt } from '../../src/worker/anthropic.ts';
import type { Post, Comment, Strategy } from '../../packages/core/dist/shared/types.js';

const baseStrategy: Strategy = {
  id: 'test-strategy',
  name: 'Test',
  description: null,
  version: '1.0.0',
  target: 'post',
  needs_media: null,
  prompt: 'Content: {{content}}\nUpstream: {{upstream_result}}\nOriginal: {{original_content}}',
  output_schema: { type: 'object', properties: { result: { type: 'string' } } },
  batch_config: null,
  depends_on: null,
  include_original: false,
  file_path: null,
  created_at: new Date(),
  updated_at: new Date(),
};

const basePost: Post = {
  id: 'post-1',
  platform_id: null,
  author_name: 'Test Author',
  title: 'Test Title',
  content: 'This is the original post content',
  url: null,
  published_at: null,
  tags: null,
  note_id: null,
  like_count: null,
  comment_count: null,
  share_count: null,
  created_at: new Date(),
};

const baseComment: Comment = {
  id: 'comment-1',
  platform_id: null,
  post_id: 'post-1',
  author_name: 'Commenter',
  content: 'This is the original comment content',
  parent_comment_id: null,
  depth: 0,
  reply_count: 0,
  published_at: null,
  created_at: new Date(),
};

describe('buildStrategyPrompt with upstream result', () => {
  it('should replace {{upstream_result}} with JSON when upstreamResult provided', async () => {
    const strategy = { ...baseStrategy, depends_on: 'post' as const };
    const upstream = { score: 0.85, label: 'positive' };
    const prompt = await buildStrategyPrompt(basePost, strategy, upstream);
    assert.ok(prompt.includes('"score": 0.85'));
    assert.ok(prompt.includes('"label": "positive"'));
  });

  it('should leave {{upstream_result}} empty when no upstreamResult', async () => {
    const prompt = await buildStrategyPrompt(basePost, baseStrategy);
    assert.ok(!prompt.includes('{{upstream_result}}'));
    assert.ok(prompt.includes('Upstream: '));
  });

  it('should replace {{original_content}} when include_original is true', async () => {
    const strategy = { ...baseStrategy, include_original: true };
    const prompt = await buildStrategyPrompt(basePost, strategy);
    assert.ok(prompt.includes('This is the original post content'));
  });

  it('should leave {{original_content}} empty when include_original is false', async () => {
    const strategy = { ...baseStrategy, include_original: false };
    const prompt = await buildStrategyPrompt(basePost, strategy);
    // original_content placeholder should be replaced with empty string
    assert.ok(!prompt.includes('{{original_content}}'));
  });
});

describe('buildCommentPrompt with upstream result', () => {
  it('should replace {{upstream_result}} with JSON when upstreamResult provided', async () => {
    const strategy = { ...baseStrategy, target: 'comment' as const, depends_on: 'comment' as const };
    const upstream = { sentiment: 'negative', confidence: 0.92 };
    const prompt = await buildCommentPrompt(baseComment, strategy, upstream);
    assert.ok(prompt.includes('"sentiment": "negative"'));
    assert.ok(prompt.includes('"confidence": 0.92'));
  });

  it('should replace {{original_content}} when include_original is true', async () => {
    const strategy = { ...baseStrategy, target: 'comment' as const, include_original: true };
    const prompt = await buildCommentPrompt(baseComment, strategy);
    assert.ok(prompt.includes('This is the original comment content'));
  });
});
