import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPlatformAdapter,
  getAllPlatformAdapters,
  registerPlatform,
  normalizePostItem,
  normalizeCommentItem,
} from '../../packages/core/dist/index.js';
import type { PlatformAdapter } from '../../packages/core/dist/platforms/types.js';

describe('PlatformAdapter registry', () => {
  it('should have xhs adapter registered', () => {
    const adapter = getPlatformAdapter('xhs');
    assert.ok(adapter);
    assert.equal(adapter!.id, 'xhs');
    assert.equal(adapter!.directoryName, 'xhs');
  });

  it('should have douyin adapter registered', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.equal(adapter!.id, 'douyin');
    assert.equal(adapter!.directoryName, 'douyin');
  });

  it('should have bilibili adapter registered', () => {
    const adapter = getPlatformAdapter('bilibili');
    assert.ok(adapter);
    assert.equal(adapter!.id, 'bilibili');
    assert.equal(adapter!.directoryName, 'bilibili');
  });

  it('should return undefined for unknown platform', () => {
    const adapter = getPlatformAdapter('unknown');
    assert.equal(adapter, undefined);
  });

  it('should return all registered adapters', () => {
    const adapters = getAllPlatformAdapters();
    assert.ok(adapters.length >= 3);
    const ids = adapters.map(a => a.id);
    assert.ok(ids.includes('xhs'));
    assert.ok(ids.includes('douyin'));
    assert.ok(ids.includes('bilibili'));
  });

  it('should allow registering a new adapter', () => {
    const testAdapter: PlatformAdapter = {
      id: 'test_platform',
      defaultTemplates: {
        fetchNote: 'opencli test note {url}',
        fetchMedia: 'opencli test download {url}',
      },
      directoryName: 'test',
      fieldMap: {},
    };
    registerPlatform(testAdapter);
    assert.ok(getPlatformAdapter('test_platform'));
  });
});

// ── douyin adapter ──────────────────────────────────────────────────────────

describe('douyin adapter', () => {
  it('should map all fieldMap entries correctly', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.equal(adapter!.fieldMap.awemeId, 'platform_post_id');
    assert.equal(adapter!.fieldMap.diggCount, 'like_count');
    assert.equal(adapter!.fieldMap.collectCount, 'collect_count');
    assert.equal(adapter!.fieldMap.shareCount, 'share_count');
    assert.equal(adapter!.fieldMap.commentCount, 'comment_count');
    assert.equal(adapter!.fieldMap.nickname, 'author_name');
    assert.equal(adapter!.fieldMap.secUid, 'author_id');
    assert.equal(adapter!.fieldMap.uid, 'author_id');
    assert.equal(adapter!.fieldMap.isImage, 'post_type');
    assert.equal(adapter!.fieldMap.createTime, 'published_at');
    assert.equal(adapter!.fieldMap.desc, 'content');
    assert.equal(adapter!.fieldMap.hashtags, 'tags');
  });

  it('should have empty fetchNote (search covers note data)', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.equal(adapter!.defaultTemplates.fetchNote, '');
  });

  it('should have fetchComments template', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.ok(adapter!.defaultTemplates.fetchComments!.includes('opencli douyin comment'));
  });

  it('should have fetchMedia template', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.ok(adapter!.defaultTemplates.fetchMedia.includes('opencli douyin download'));
  });

  it('should have creatorTemplates with profileFetch and postsFetch', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.ok(adapter!.creatorTemplates);
    assert.ok(adapter!.creatorTemplates!.profileFetch.includes('opencli douyin user-info'));
    assert.ok(adapter!.creatorTemplates!.postsFetch.includes('opencli douyin user-videos'));
  });

  it('should have profileFieldMap with all entries', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.ok(adapter!.profileFieldMap);
    assert.equal(adapter!.profileFieldMap!.nickname, 'author_name');
    assert.equal(adapter!.profileFieldMap!.avatarUrl, 'avatar_url');
    assert.equal(adapter!.profileFieldMap!.followerCount, 'follower_count');
    assert.equal(adapter!.profileFieldMap!.followingCount, 'following_count');
    assert.equal(adapter!.profileFieldMap!.desc, 'bio');
    assert.equal(adapter!.profileFieldMap!.secUid, 'platform_creator_id');
  });

  it('should have homepageUrlTemplate', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.equal(adapter!.homepageUrlTemplate, 'https://www.douyin.com/user/{platform_creator_id}');
  });

  it('should have commentFieldMap with all entries', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.ok(adapter!.commentFieldMap);
    assert.equal(adapter!.commentFieldMap!.cid, 'platform_comment_id');
    assert.equal(adapter!.commentFieldMap!.text, 'content');
    assert.equal(adapter!.commentFieldMap!.diggCount, 'like_count');
    assert.equal(adapter!.commentFieldMap!.nickname, 'author_name');
    assert.equal(adapter!.commentFieldMap!.secUid, 'author_id');
    assert.equal(adapter!.commentFieldMap!.uid, 'author_id');
    assert.equal(adapter!.commentFieldMap!.replyCommentTotal, 'reply_count');
    assert.equal(adapter!.commentFieldMap!.createTime, 'published_at');
  });
});

// ── xhs adapter ────────────────────────────────────────────────────────────

describe('xhs adapter', () => {
  it('should map all fieldMap entries correctly', () => {
    const adapter = getPlatformAdapter('xhs');
    assert.ok(adapter);
    assert.equal(adapter!.fieldMap.note_id, 'platform_post_id');
    assert.equal(adapter!.fieldMap.likes, 'like_count');
    assert.equal(adapter!.fieldMap.collects, 'collect_count');
    assert.equal(adapter!.fieldMap.comments, 'comment_count');
    assert.equal(adapter!.fieldMap.shares, 'share_count');
    assert.equal(adapter!.fieldMap.plays, 'play_count');
    assert.equal(adapter!.fieldMap.user_id, 'author_id');
  });

  it('should have all default templates', () => {
    const adapter = getPlatformAdapter('xhs');
    assert.ok(adapter);
    assert.ok(adapter!.defaultTemplates.fetchNote.includes('opencli xiaohongshu'));
    assert.ok(adapter!.defaultTemplates.fetchComments!.includes('opencli xiaohongshu'));
    assert.ok(adapter!.defaultTemplates.fetchMedia.includes('opencli xiaohongshu'));
  });

  it('should have creatorTemplates', () => {
    const adapter = getPlatformAdapter('xhs');
    assert.ok(adapter);
    assert.ok(adapter!.creatorTemplates);
    assert.ok(adapter!.creatorTemplates!.profileFetch.includes('opencli xiaohongshu'));
    assert.ok(adapter!.creatorTemplates!.postsFetch.includes('opencli xiaohongshu'));
  });

  it('should have profileFieldMap with all entries', () => {
    const adapter = getPlatformAdapter('xhs');
    assert.ok(adapter);
    assert.ok(adapter!.profileFieldMap);
    assert.equal(adapter!.profileFieldMap!.name, 'author_name');
    assert.equal(adapter!.profileFieldMap!.avatar, 'avatar_url');
    assert.equal(adapter!.profileFieldMap!.followers, 'follower_count');
    assert.equal(adapter!.profileFieldMap!.following, 'following_count');
    assert.equal(adapter!.profileFieldMap!.bio, 'bio');
    assert.equal(adapter!.profileFieldMap!.redId, 'platform_creator_id');
  });

  it('should have homepageUrlTemplate', () => {
    const adapter = getPlatformAdapter('xhs');
    assert.ok(adapter);
    assert.equal(adapter!.homepageUrlTemplate, 'https://www.xiaohongshu.com/user/profile/{platform_creator_id}');
  });

  it('should have commentFieldMap with all entries', () => {
    const adapter = getPlatformAdapter('xhs');
    assert.ok(adapter);
    assert.ok(adapter!.commentFieldMap);
    assert.equal(adapter!.commentFieldMap!.id, 'platform_comment_id');
    assert.equal(adapter!.commentFieldMap!.content, 'content');
    assert.equal(adapter!.commentFieldMap!.likes, 'like_count');
    assert.equal(adapter!.commentFieldMap!.username, 'author_name');
    assert.equal(adapter!.commentFieldMap!.userId, 'author_id');
    assert.equal(adapter!.commentFieldMap!.subCommentCount, 'reply_count');
    assert.equal(adapter!.commentFieldMap!.createTime, 'published_at');
  });

  it('should extract noteId from xhs URLs', () => {
    const adapter = getPlatformAdapter('xhs');
    assert.ok(adapter);
    assert.ok(adapter!.extractNoteId);
    assert.equal(adapter!.extractNoteId!('https://www.xiaohongshu.com/explore/6879dfb6000000001201786a'), '6879dfb6000000001201786a');
    assert.equal(adapter!.extractNoteId!('https://www.xiaohongshu.com/search_result/6879dfb6000000001201786a?xsec_token=abc'), '6879dfb6000000001201786a');
    assert.equal(adapter!.extractNoteId!('https://www.xiaohongshu.com/discovery/item/6879dfb6000000001201786a'), '6879dfb6000000001201786a');
    assert.equal(adapter!.extractNoteId!('https://www.xiaohongshu.com/user/profile/abc123'), undefined);
    assert.equal(adapter!.extractNoteId!('not-a-url'), undefined);
  });
});

// ── bilibili adapter ───────────────────────────────────────────────────────

describe('bilibili adapter', () => {
  it('should have correct id and directoryName', () => {
    const adapter = getPlatformAdapter('bilibili');
    assert.ok(adapter);
    assert.equal(adapter!.id, 'bilibili');
    assert.equal(adapter!.directoryName, 'bilibili');
  });

  it('should have defaultTemplates', () => {
    const adapter = getPlatformAdapter('bilibili');
    assert.ok(adapter);
    assert.ok(adapter!.defaultTemplates.fetchNote !== undefined);
    assert.ok(adapter!.defaultTemplates.fetchMedia !== undefined);
  });

  it('should have empty fieldMap', () => {
    const adapter = getPlatformAdapter('bilibili');
    assert.ok(adapter);
    assert.equal(Object.keys(adapter!.fieldMap).length, 0);
  });
});

// ── normalizePostItem with platformId ──────────────────────────────────────

describe('normalizePostItem with platformId', () => {
  it('should map douyin fields when platformId is provided', () => {
    const raw = {
      awemeId: '7597309249148046602',
      desc: '测试抖音视频',
      diggCount: 824442,
      commentCount: 9246,
      shareCount: 351597,
      collectCount: 320680,
      nickname: '日食记',
      secUid: 'MS4wLjABAAAA',
      cover: 'https://example.com/cover.jpg',
      url: 'https://www.douyin.com/video/7597309249148046602',
      isImage: false,
    };

    const result = normalizePostItem(raw, 'douyin');
    assert.equal(result.platform_post_id, '7597309249148046602');
    assert.equal(result.like_count, 824442);
    assert.equal(result.collect_count, 320680);
    assert.equal(result.share_count, 351597);
    assert.equal(result.comment_count, 9246);
    assert.equal(result.author_name, '日食记');
    assert.equal(result.author_id, 'MS4wLjABAAAA');
    assert.equal(result.cover_url, 'https://example.com/cover.jpg');
    assert.equal(result.post_type, 'false');
  });

  it('should map xhs fields when platformId is provided', () => {
    const raw = {
      note_id: 'note123',
      likes: '100',
      collects: '50',
      comments: '20',
      shares: '10',
      plays: '5000',
      user_id: 'user456',
    };

    const result = normalizePostItem(raw, 'xhs');
    assert.equal(result.platform_post_id, 'note123');
    assert.equal(result.like_count, 100);
    assert.equal(result.collect_count, 50);
    assert.equal(result.comment_count, 20);
    assert.equal(result.share_count, 10);
    assert.equal(result.play_count, 5000);
    assert.equal(result.author_id, 'user456');
  });

  it('should work without platformId (backward compatible)', () => {
    const raw = {
      platform_post_id: 'post123',
      title: '测试帖子',
      like_count: 100,
      author_name: '测试用户',
    };

    const result = normalizePostItem(raw);
    assert.equal(result.platform_post_id, 'post123');
    assert.equal(result.like_count, 100);
    assert.equal(result.author_name, '测试用户');
  });

  it('should not map platform-specific fields without platformId', () => {
    const raw = {
      note_id: 'note123',
      likes: '100',
    };

    const result = normalizePostItem(raw);
    assert.equal(result.platform_post_id, null);
    assert.equal(result.like_count, 0);
  });

  it('should use platform fieldMap to override base map', () => {
    const raw = { author: '抖音用户' };
    const result = normalizePostItem(raw, 'douyin');
    assert.equal(result.author_name, '抖音用户');
  });
});

// ── normalizeCommentItem with platformId ────────────────────────────────────

describe('normalizeCommentItem with platformId', () => {
  it('should map douyin comment fields', () => {
    const raw = {
      cid: '7599240120265769787',
      text: '大家看我做的还行吗？',
      diggCount: 768,
      nickname: '五则天',
      secUid: 'MS4wLjABAAAA1mSJsIDGu75p',
      uid: '68454941773',
      replyCommentTotal: 45,
      createTime: '2026-01-25 10:12:51',
    };

    const result = normalizeCommentItem(raw, 'douyin');
    assert.equal(result.platform_comment_id, '7599240120265769787');
    assert.equal(result.content, '大家看我做的还行吗？');
    assert.equal(result.like_count, 768);
    assert.equal(result.author_name, '五则天');
    assert.equal(result.author_id, 'MS4wLjABAAAA1mSJsIDGu75p');
    assert.equal(result.reply_count, 45);
  });

  it('should map xhs comment fields', () => {
    const raw = {
      id: 'comment123',
      content: '好喜欢这个',
      likes: '200',
      username: '小红书用户',
      userId: 'user789',
      subCommentCount: 5,
      createTime: '2026-01-20 12:00:00',
    };

    const result = normalizeCommentItem(raw, 'xhs');
    assert.equal(result.platform_comment_id, 'comment123');
    assert.equal(result.content, '好喜欢这个');
    assert.equal(result.like_count, 200);
    assert.equal(result.author_name, '小红书用户');
    assert.equal(result.author_id, 'user789');
    assert.equal(result.reply_count, 5);
  });

  it('should work without platformId (backward compatible)', () => {
    const raw = {
      platform_comment_id: 'c123',
      content: '测试评论',
      like_count: 10,
      author_name: '用户',
    };

    const result = normalizeCommentItem(raw);
    assert.equal(result.platform_comment_id, 'c123');
    assert.equal(result.content, '测试评论');
    assert.equal(result.like_count, 10);
    assert.equal(result.author_name, '用户');
  });

  it('should not map platform-specific fields without platformId', () => {
    const raw = {
      cid: '7599240120265769787',
      diggCount: 100,
      nickname: '抖音用户',
    };

    const result = normalizeCommentItem(raw);
    assert.equal(result.platform_comment_id, null);
    assert.equal(result.like_count, 0);
    assert.equal(result.author_name, null);
  });
});
