import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { close as closeDb } from '../../packages/core/dist/db/client.js';
import { runMigrations } from '../../packages/core/dist/db/migrate.js';
import { seedAll } from '../../packages/core/dist/db/seed.js';
import { createPlatform, upsertPlatform } from '../../packages/core/dist/db/platforms.js';
import { createPost, getPostByPlatformPostId, listPosts, countPosts } from '../../packages/core/dist/db/posts.js';
import { normalizePostItem } from '../../packages/core/dist/shared/utils.js';
import { config } from '../../packages/core/dist/config/index.js';
import { expandPath } from '../../packages/core/dist/shared/utils.js';

const FIXTURE_DIR = path.join(process.cwd(), 'test/e2e/fixtures/posts');
const DOUYIN_FIXTURE = path.join(FIXTURE_DIR, 'sample-douyin.json');

const RUN_ID = `dy_import_${Date.now()}`;
const TEST_PLATFORM = 'douyin';

describe('douyin post import', { timeout: 30000 }, () => {
  before(async () => {
    await closeDb();
    const dbPath = expandPath(config.database.path);
    try {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      for (const suffix of ['.wal', '.tmp', '.shm']) {
        const ext = dbPath + suffix;
        if (fs.existsSync(ext)) fs.unlinkSync(ext);
      }
    } catch {
      // ignore cleanup errors
    }
    await runMigrations();
    await seedAll();
    await upsertPlatform({ id: TEST_PLATFORM, name: '抖音' });
  });

  it('should normalize douyin search result fields', () => {
    const raw = {
      rank: 1,
      aweme_id: '7597309249148046602',
      title: '现在买菜，回家10分钟就能吃上',
      digg_count: 824442,
      comment_count: 9246,
      share_count: 351597,
      collect_count: 320680,
      author: '日食记',
      author_id: 'MS4wLjABAAAA',
      cover_image: 'https://example.com/cover.jpg',
      url: 'https://www.douyin.com/video/7597309249148046602',
      is_image: false,
    };

    const result = normalizePostItem(raw, 'douyin');
    assert.equal(result.platform_post_id, '7597309249148046602');
    assert.equal(result.title, '现在买菜，回家10分钟就能吃上');
    assert.equal(result.like_count, 824442);
    assert.equal(result.comment_count, 9246);
    assert.equal(result.share_count, 351597);
    assert.equal(result.collect_count, 320680);
    assert.equal(result.author_name, '日食记');
    assert.equal(result.author_id, 'MS4wLjABAAAA');
    assert.equal(result.cover_url, 'https://example.com/cover.jpg');
    assert.equal(result.url, 'https://www.douyin.com/video/7597309249148046602');
  });

  it('should map is_image to post_type for douyin', () => {
    const raw = {
      aweme_id: '7123456789012345678',
      title: '周末在家做美食',
      digg_count: 52000,
      comment_count: 1200,
      share_count: 8900,
      collect_count: 45000,
      author: '美食达人',
      author_id: 'MS4wLjABAAAA_test_author_id',
      cover_image: 'https://example.com/cover2.jpg',
      url: 'https://www.douyin.com/video/7123456789012345678',
      is_image: true,
    };

    const result = normalizePostItem(raw, 'douyin');
    assert.equal(result.post_type, 'true');
  });

  it('should import douyin posts from fixture to database', async () => {
    const content = fs.readFileSync(DOUYIN_FIXTURE, 'utf-8');
    const items = JSON.parse(content);
    assert.ok(Array.isArray(items), 'fixture should contain an array');

    let imported = 0;
    for (const item of items) {
      const normalized = normalizePostItem(item, 'douyin');
      try {
        await createPost({
          platform_id: TEST_PLATFORM,
          platform_post_id: normalized.platform_post_id!,
          title: normalized.title,
          content: normalized.content,
          author_id: normalized.author_id,
          author_name: normalized.author_name,
          author_url: normalized.author_url,
          url: normalized.url,
          cover_url: normalized.cover_url,
          post_type: normalized.post_type as any,
          like_count: normalized.like_count,
          collect_count: normalized.collect_count,
          comment_count: normalized.comment_count,
          share_count: normalized.share_count,
          play_count: normalized.play_count,
          score: normalized.score,
          tags: normalized.tags,
          media_files: normalized.media_files,
          published_at: normalized.published_at,
          metadata: item,
        });
        imported++;
      } catch {
        // skip duplicates
      }
    }

    assert.equal(imported, items.length, `expected ${items.length} posts imported`);

    const posts = await listPosts(TEST_PLATFORM, 50, 0);
    assert.ok(posts.length >= imported, `expected at least ${imported} posts in DB`);
  });

  it('should retrieve imported douyin post by platform_post_id', async () => {
    const post = await getPostByPlatformPostId('7597309249148046602', 'douyin');
    assert.ok(post, 'should find douyin post by platform_post_id');
    assert.equal(post!.platform_id, 'douyin');
    assert.equal(post!.platform_post_id, '7597309249148046602');
    assert.equal(post!.title, '现在买菜，回家10分钟就能吃上');
    assert.equal(post!.like_count, 824442);
    assert.equal(post!.comment_count, 9246);
    assert.equal(post!.share_count, 351597);
    assert.equal(post!.collect_count, 320680);
    assert.equal(post!.author_name, '日食记');
    assert.ok(post!.metadata, 'post should have metadata');
  });

  it('should verify douyin post count', async () => {
    const total = await countPosts(TEST_PLATFORM);
    assert.equal(total, 2, 'expected 2 douyin posts in DB');
  });
});
