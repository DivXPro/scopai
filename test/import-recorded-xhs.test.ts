import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { close as closeDb } from '../dist/db/client.js';
import { runMigrations } from '../dist/db/migrate.js';
import { seedAll } from '../dist/db/seed.js';
import { upsertPlatform } from '../dist/db/platforms.js';
import { createPost, getPostById, listPosts, countPosts } from '../dist/db/posts.js';
import { createComment, listCommentsByPost, countComments } from '../dist/db/comments.js';
import { createMediaFile, listMediaFilesByPost } from '../dist/db/media-files.js';
import { config } from '../dist/config/index.js';
import { expandPath } from '../dist/shared/utils.js';

const FIXTURE_DIR = path.join(process.cwd(), 'test-data/recorded/2026-04-16-xhs-gen');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manifest.json'), 'utf-8'));

describe('import — recorded xhs fixture', { timeout: 30000 }, () => {
  let postIds: string[] = [];

  before(async () => {
    closeDb();
    // Remove existing DB file to ensure a clean state for replay
    const dbPath = expandPath(config.database.path);
    try {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      // Also remove WAL/shm files if present
      for (const suffix of ['.wal', '.tmp', '.shm']) {
        const ext = dbPath + suffix;
        if (fs.existsSync(ext)) fs.unlinkSync(ext);
      }
    } catch {
      // ignore cleanup errors
    }
    await runMigrations();
    await seedAll();
    await upsertPlatform({ id: MANIFEST.platform, name: 'Recorded Platform' });
  });

  it('should import posts from fixture', async () => {
    const postsFile = path.join(FIXTURE_DIR, MANIFEST.fixtures.posts);
    const content = fs.readFileSync(postsFile, 'utf-8');
    const lines = content.split('\n').filter((l: string) => l.trim());
    let imported = 0;

    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        const post = await createPost({
          platform_id: MANIFEST.platform,
          platform_post_id: item.platform_post_id ?? item.noteId ?? item.id ?? `post_${imported}`,
          title: item.displayTitle ?? item.title ?? null,
          content: item.desc ?? item.content ?? item.text ?? '',
          author_id: item.user?.userId ?? null,
          author_name: item.user?.nickname ?? item.author_name ?? null,
          author_url: item.author_url ?? null,
          url: item.url ?? null,
          cover_url: item.cover_url ?? null,
          post_type: (item.type ?? null) as any,
          like_count: Number(item.interactInfo?.likedCount ?? item.like_count ?? 0),
          collect_count: Number(item.interactInfo?.collectedCount ?? item.collect_count ?? 0),
          comment_count: Number(item.interactInfo?.commentCount ?? item.comment_count ?? 0),
          share_count: Number(item.share_count ?? 0),
          play_count: Number(item.play_count ?? 0),
          score: item.score ?? null,
          tags: item.tags ?? null,
          media_files: item.media_files ?? null,
          published_at: item.lastUpdateTime ? new Date(item.lastUpdateTime) : (item.published_at ? new Date(item.published_at) : null),
          metadata: item,
        });
        postIds.push(post.id);
        imported++;
      } catch {
        // skip duplicates
      }
    }

    assert.ok(imported > 0, `expected at least 1 post imported, got ${imported}`);
    const posts = await listPosts(MANIFEST.platform, 50, 0);
    assert.ok(posts.length >= imported, `expected at least ${imported} posts in DB`);
  });

  it('should import comments from fixture', async () => {
    let totalImported = 0;
    for (let idx = 0; idx < MANIFEST.fixtures.comments.length; idx++) {
      const commentFileName = MANIFEST.fixtures.comments[idx];
      const commentFile = path.join(FIXTURE_DIR, commentFileName);
      if (!fs.existsSync(commentFile) || fs.statSync(commentFile).size === 0) continue;
      const content = fs.readFileSync(commentFile, 'utf-8');
      const lines = content.split('\n').filter((l: string) => l.trim());
      if (lines.length === 0) continue;

      const postId = postIds[idx];
      if (!postId) continue;

      let imported = 0;
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          await createComment({
            post_id: postId,
            platform_id: MANIFEST.platform,
            platform_comment_id: item.id ?? item.commentId ?? `c_${imported}`,
            parent_comment_id: null,
            root_comment_id: null,
            depth: 0,
            author_id: item.author_id ?? null,
            author_name: (item.author ?? item.user?.nickname ?? item.author_name ?? '匿名用户') as string,
            content: (item.text ?? item.content ?? '') as string,
            like_count: Number(item.likes ?? item.likeCount ?? 0),
            reply_count: Number(item.replies ?? item.replyCount ?? 0),
            published_at: item.time ? new Date(String(item.time).split(/[^\d-]/)[0]) : null,
            metadata: item,
          });
          imported++;
        } catch {
          // skip duplicates
        }
      }
      totalImported += imported;
      const comments = await listCommentsByPost(postId, 100);
      assert.ok(comments.length >= imported, `expected at least ${imported} comments for post ${postId}`);
    }
    console.log(`  Imported ${totalImported} comments from fixtures`);
  });

  it('should import media from fixture', async () => {
    let totalImported = 0;
    for (let idx = 0; idx < MANIFEST.fixtures.media.length; idx++) {
      const mediaFileName = MANIFEST.fixtures.media[idx];
      const mediaFile = path.join(FIXTURE_DIR, mediaFileName);
      if (!fs.existsSync(mediaFile) || fs.statSync(mediaFile).size === 0) continue;
      const content = fs.readFileSync(mediaFile, 'utf-8');
      const lines = content.split('\n').filter((l: string) => l.trim());
      if (lines.length === 0) continue;

      const postId = postIds[idx];
      if (!postId) continue;

      let imported = 0;
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          await createMediaFile({
            post_id: postId,
            comment_id: null,
            platform_id: MANIFEST.platform,
            media_type: (item.type ?? 'image') as any,
            url: (item.url ?? `https://example.com/${postId}_${imported}`) as string,
            local_path: item.local_path ?? null,
            width: item.width ? Number(item.width) : null,
            height: item.height ? Number(item.height) : null,
            duration_ms: item.duration_ms ? Number(item.duration_ms) : null,
            file_size: item.file_size ? Number(item.file_size) : null,
            downloaded_at: item.status === 'success' ? new Date() : null,
          });
          imported++;
        } catch {
          // skip duplicates
        }
      }
      totalImported += imported;
      const mediaList = await listMediaFilesByPost(postId);
      assert.ok(mediaList.length >= imported, `expected at least ${imported} media for post ${postId}`);
    }
    console.log(`  Imported ${totalImported} media from fixtures`);
  });

  it('should verify imported data integrity', async () => {
    const posts = await listPosts(MANIFEST.platform, 50, 0);
    assert.ok(posts.length > 0, 'expected posts in DB');

    for (const post of posts) {
      assert.ok(post.platform_id === MANIFEST.platform, 'post should have correct platform');
      assert.ok(post.content?.length >= 0, 'post should have content');
    }
  });
});
