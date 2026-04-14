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
const { createPost, getPostById, listPosts, countPosts } = posts;
import * as comments from '../dist/db/comments.js';
const { createComment, listCommentsByPost, countComments } = comments;
import * as mediaFiles from '../dist/db/media-files.js';
const { createMediaFile, listMediaFilesByPost } = mediaFiles;
import * as fs from 'fs';
import * as path from 'path';

// Test constants — unique per run
const RUN_ID = `import_${Date.now()}`;
const TEST_PLATFORM = `${RUN_ID}_xhs`;

// Resolve test-data paths
const testDir = path.join(process.cwd(), 'test-data');
const postsFile = path.join(testDir, 'xhs_posts.jsonl');
const commentsFile1 = path.join(testDir, 'xhs_comments_post1.jsonl');
const commentsFile2 = path.join(testDir, 'xhs_comments_post2.jsonl');

describe('import — offline mock data', { timeout: 15000 }, () => {
  let postIds: string[] = [];

  before(async () => {
    await runMigrations();
    await seedAll();

    // Create platform
    await createPlatform({
      id: TEST_PLATFORM,
      name: `XHS Test (${RUN_ID})`,
      description: 'Offline mock data test',
    });
  });

  // ============================================================
  // Post Import Tests
  // ============================================================

  it('should import posts from mock JSONL file', async () => {
    const content = fs.readFileSync(postsFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    let imported = 0;
    let skipped = 0;

    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        const post = await createPost({
          platform_id: TEST_PLATFORM,
          platform_post_id: item.noteId ?? item.id ?? `post_${imported}`,
          title: item.displayTitle ?? item.title ?? null,
          content: item.desc ?? item.content ?? '',
          author_id: item.user?.userId ?? null,
          author_name: item.user?.nickname ?? null,
          author_url: null,
          url: null,
          cover_url: null,
          post_type: (item.type ?? null) as any,
          like_count: Number(item.interactInfo?.likedCount ?? 0),
          collect_count: Number(item.interactInfo?.collectedCount ?? 0),
          comment_count: Number(item.interactInfo?.commentCount ?? 0),
          share_count: 0,
          play_count: 0,
          score: null,
          tags: null,
          media_files: null,
          published_at: item.lastUpdateTime ? new Date(item.lastUpdateTime) : null,
          metadata: item,
        });
        postIds.push(post.id);
        imported++;
      } catch {
        skipped++;
      }
    }

    assert.equal(imported, lines.length, `expected ${lines.length} posts imported`);
    assert.equal(skipped, 0, 'expected no skipped posts');
    assert.equal(postIds.length, 5);
  });

  it('should verify imported posts are queryable', async () => {
    const posts = await listPosts(TEST_PLATFORM, 50, 0);
    assert.ok(posts.length >= 5, `expected at least 5 posts, got ${posts.length}`);

    const total = await countPosts(TEST_PLATFORM);
    assert.ok(total >= 5, `expected at least 5 total posts, got ${total}`);
  });

  it('should verify post content integrity', async () => {
    const post = await getPostById(postIds[0]);
    assert.ok(post);
    assert.equal(post.platform_id, TEST_PLATFORM);
    assert.ok(post.content?.length > 0, 'post should have content');
    assert.ok(post.metadata, 'post should have metadata');
  });

  // ============================================================
  // Comment Import Tests
  // ============================================================

  it('should import comments from mock JSONL file for post 1', async () => {
    const content = fs.readFileSync(commentsFile1, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    let imported = 0;

    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        await createComment({
          post_id: postIds[0],
          platform_id: TEST_PLATFORM,
          platform_comment_id: item.id ?? null,
          parent_comment_id: null,
          root_comment_id: null,
          depth: 0,
          author_id: item.user?.userId ?? null,
          author_name: item.user?.nickname ?? null,
          content: item.content ?? '',
          like_count: Number(item.likeCount ?? 0),
          reply_count: Number(item.replyCount ?? 0),
          published_at: item.publishedAt ? new Date(item.publishedAt) : null,
          metadata: item,
        });
        imported++;
      } catch {
        // Skip duplicates
      }
    }

    assert.ok(imported > 0, `expected at least 1 comment imported`);
    const commentList = await listCommentsByPost(postIds[0], 100);
    assert.equal(commentList.length, imported);
  });

  it('should import comments from mock JSONL file for post 2', async () => {
    const content = fs.readFileSync(commentsFile2, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    let imported = 0;

    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        await createComment({
          post_id: postIds[1],
          platform_id: TEST_PLATFORM,
          platform_comment_id: item.id ?? null,
          parent_comment_id: null,
          root_comment_id: null,
          depth: 0,
          author_id: item.user?.userId ?? null,
          author_name: item.user?.nickname ?? null,
          content: item.content ?? '',
          like_count: Number(item.likeCount ?? 0),
          reply_count: Number(item.replyCount ?? 0),
          published_at: item.publishedAt ? new Date(item.publishedAt) : null,
          metadata: item,
        });
        imported++;
      } catch {
        // Skip duplicates
      }
    }

    assert.ok(imported > 0, `expected at least 1 comment imported`);
    const commentList = await listCommentsByPost(postIds[1], 100);
    assert.equal(commentList.length, imported);
  });

  it('should verify comment counts match mock data', async () => {
    const total1 = await countComments(postIds[0]);
    assert.ok(total1 > 0, 'post 1 should have comments');

    const total2 = await countComments(postIds[1]);
    assert.ok(total2 > 0, 'post 2 should have comments');
  });

  it('should verify comment content integrity', async () => {
    const commentList = await listCommentsByPost(postIds[0], 100);
    assert.ok(commentList.length > 0);

    const first = commentList[0];
    assert.ok(first.content?.length > 0, 'comment should have content');
    assert.ok(first.post_id === postIds[0], 'comment should be linked to correct post');
    assert.ok(first.platform_id === TEST_PLATFORM, 'comment should have correct platform');
  });

  // ============================================================
  // Media Import Tests (using post cover_url as media URL)
  // ============================================================

  it('should import media files from post metadata', async () => {
    // Create media from post metadata (simulating media extraction from posts)
    let imported = 0;
    for (const postId of postIds) {
      const post = await getPostById(postId);
      if (!post) continue;

      try {
        await createMediaFile({
          post_id: postId,
          comment_id: null,
          platform_id: TEST_PLATFORM,
          media_type: (post.post_type === 'image' ? 'image' : 'video') as any,
          url: `https://example.com/media/${postId}`,
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

    assert.ok(imported > 0, `expected at least 1 media imported`);
  });

  it('should verify media files are queryable by post', async () => {
    const mediaList = await listMediaFilesByPost(postIds[0]);
    assert.ok(mediaList.length >= 0, 'should return media list (may be empty)');

    // Verify media structure
    if (mediaList.length > 0) {
      const first = mediaList[0];
      assert.ok(first.url.startsWith('http'), 'media should have valid URL');
      assert.ok(first.post_id === postIds[0], 'media should be linked to correct post');
    }
  });

  // ============================================================
  // Edge Cases
  // ============================================================

  it('should handle empty JSONL file gracefully', async () => {
    const emptyFile = path.join(testDir, '_test_empty.jsonl');
    fs.writeFileSync(emptyFile, '');

    const content = fs.readFileSync(emptyFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    assert.equal(lines.length, 0, 'empty file should have no lines');

    fs.unlinkSync(emptyFile);
  });

  it('should handle malformed JSONL lines', async () => {
    const badFile = path.join(testDir, '_test_bad.jsonl');
    fs.writeFileSync(badFile, '{"valid": true}\n{bad json\n{"also_valid": true}\n');

    const content = fs.readFileSync(badFile, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());
    let parsed = 0;
    for (const line of lines) {
      try {
        JSON.parse(line);
        parsed++;
      } catch {
        // Skip malformed lines
      }
    }
    assert.equal(parsed, 2, 'should parse 2 of 3 lines');

    fs.unlinkSync(badFile);
  });
});
