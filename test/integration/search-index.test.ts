import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../packages/core/dist/db/client.js';
const { close: closeDb } = db;
import * as migrate from '../../packages/core/dist/db/migrate.js';
const { runMigrations } = migrate;
import * as seed from '../../packages/core/dist/db/seed.js';
const { seedAll } = seed;
import * as posts from '../../packages/core/dist/db/posts.js';
const { createPost, deletePostById } = posts;
import * as searchIndex from '../../packages/core/dist/db/search-index.js';
const { insertSearchIndex, searchPostsByQueryWithPostJoin, buildSearchableText } = searchIndex;
import * as platforms from '../../packages/core/dist/db/platforms.js';
const { createPlatform } = platforms;
import * as utils from '../../packages/core/dist/shared/utils.js';
const { generateId, now } = utils;

const RUN_ID = `si_${Date.now()}`;
const TEST_PLATFORM = `${RUN_ID}_platform`;

describe('search_index', { timeout: 15000 }, () => {
  const createdPostIds: string[] = [];

  before(async () => {
    await closeDb();
    await runMigrations();
    await seedAll();

    await createPlatform({
      id: TEST_PLATFORM,
      name: `Search Index Test (${RUN_ID})`,
      description: 'Integration test platform for search_index module',
    });
  });

  after(async () => {
    // Clean up posts (deletePostById cascades to search_index)
    for (const postId of createdPostIds) {
      try {
        await deletePostById(postId);
      } catch {
        // Post may already be deleted
      }
    }
    const { query } = await import('../../packages/core/dist/db/client.js');
    await query('DELETE FROM platforms WHERE id = ?', [TEST_PLATFORM]);
  });

  async function createTestPost(overrides: Partial<Parameters<typeof createPost>[0]> = {}) {
    const post = await createPost({
      platform_id: TEST_PLATFORM,
      platform_post_id: generateId(),
      title: 'Test Beauty Product',
      content: 'This is a review of luxury skincare product',
      author_id: 'author1',
      author_name: 'Beauty Blogger',
      author_url: null,
      url: null,
      cover_url: null,
      post_type: 'image',
      like_count: 100,
      collect_count: 50,
      comment_count: 20,
      share_count: 10,
      play_count: 0,
      score: null,
      tags: null,
      media_files: null,
      published_at: null,
      metadata: null,
      ...overrides,
    });
    createdPostIds.push(post.id);
    return post;
  }

  describe('buildSearchableText', () => {
    it('extracts strings from flat object', () => {
      const result = buildSearchableText({ a: 'hello', b: 'world' });
      assert.ok(result.includes('hello'));
      assert.ok(result.includes('world'));
    });

    it('extracts strings from nested object', () => {
      const result = buildSearchableText({ a: { b: 'nested' }, c: 'flat' });
      assert.ok(result.includes('nested'));
      assert.ok(result.includes('flat'));
    });

    it('extracts strings from arrays', () => {
      const result = buildSearchableText({ tags: ['tag1', 'tag2'] });
      assert.ok(result.includes('tag1'));
      assert.ok(result.includes('tag2'));
    });

    it('ignores numbers and booleans', () => {
      const result = buildSearchableText({ a: 'text', b: 123, c: true });
      assert.ok(result.includes('text'));
      assert.ok(!result.includes('123'));
      assert.ok(!result.includes('true'));
    });

    it('handles empty objects', () => {
      const result = buildSearchableText({});
      assert.strictEqual(result, '');
    });
  });

  describe('insertSearchIndex & searchPostsByQueryWithPostJoin', () => {
    it('inserts and searches post content', async () => {
      const post = await createTestPost({
        title: 'Test Beauty Product',
        content: 'This is a review of luxury skincare product',
      });

      await insertSearchIndex(post.id, 'post_content', 'Test Beauty Product luxury skincare', 1.0);

      const results = await searchPostsByQueryWithPostJoin('luxury', 5);
      assert.ok(results.length > 0);
      assert.strictEqual(results[0].post_id, post.id);
      assert.ok(results[0].matched_snippet.includes('luxury'));
    });

    it('returns empty array for non-matching query', async () => {
      const results = await searchPostsByQueryWithPostJoin('nonexistent_xyz_12345', 5);
      assert.deepStrictEqual(results, []);
    });

    it('respects limit parameter', async () => {
      // Create multiple posts with search index entries
      const post1 = await createTestPost({
        title: 'First Post',
        content: 'content one',
      });
      const post2 = await createTestPost({
        title: 'Second Post',
        content: 'content two',
      });

      await insertSearchIndex(post1.id, 'post_content', 'common keyword first', 1.0);
      await insertSearchIndex(post2.id, 'post_content', 'common keyword second', 1.0);

      const results = await searchPostsByQueryWithPostJoin('common', 1);
      assert.ok(results.length <= 1);
    });

    it('joins post data correctly', async () => {
      const post = await createTestPost({
        title: 'Special Title For Join Test',
        content: 'join test content',
        author_name: 'Test Author',
      });

      await insertSearchIndex(post.id, 'post_content', 'join test searchable text', 1.0);

      const results = await searchPostsByQueryWithPostJoin('join', 5);
      assert.ok(results.length > 0);
      const result = results.find(r => r.post_id === post.id);
      assert.ok(result);
      assert.strictEqual(result.title, 'Special Title For Join Test');
      assert.strictEqual(result.author_name, 'Test Author');
      assert.strictEqual(result.platform_id, TEST_PLATFORM);
    });

    it('orders results by weight descending', async () => {
      const postHigh = await createTestPost({
        title: 'High Weight Post',
        content: 'weight test',
      });
      const postLow = await createTestPost({
        title: 'Low Weight Post',
        content: 'weight test',
      });

      await insertSearchIndex(postHigh.id, 'post_content', 'weight test high', 2.0);
      await insertSearchIndex(postLow.id, 'post_content', 'weight test low', 0.5);

      const results = await searchPostsByQueryWithPostJoin('weight', 5);
      assert.ok(results.length >= 2);
      // High weight should come first
      const highIndex = results.findIndex(r => r.post_id === postHigh.id);
      const lowIndex = results.findIndex(r => r.post_id === postLow.id);
      assert.ok(highIndex < lowIndex, 'higher weight should come before lower weight');
    });
  });
});
