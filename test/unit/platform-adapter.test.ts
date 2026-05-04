import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getPlatformAdapter,
  getAllPlatformAdapters,
  registerPlatform,
  normalizePostItem,
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

describe('douyin adapter field map', () => {
  it('should map aweme_id to platform_post_id', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.equal(adapter!.fieldMap.aweme_id, 'platform_post_id');
  });

  it('should map digg_count to like_count', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.equal(adapter!.fieldMap.digg_count, 'like_count');
  });

  it('should map create_time to published_at', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.equal(adapter!.fieldMap.create_time, 'published_at');
  });

  it('should map hashtags to tags', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.equal(adapter!.fieldMap.hashtags, 'tags');
  });

  it('should have fetchNote and fetchMedia templates', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.ok(adapter!.defaultTemplates.fetchNote.includes('opencli douyin note'));
    assert.ok(adapter!.defaultTemplates.fetchMedia.includes('opencli douyin download'));
  });

  it('should have empty fetchComments', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.equal(adapter!.defaultTemplates.fetchComments, '');
  });

  it('should have creatorTemplates with profileFetch and postsFetch', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.ok(adapter!.creatorTemplates);
    assert.ok(adapter!.creatorTemplates!.profileFetch.includes('opencli douyin user-info'));
    assert.ok(adapter!.creatorTemplates!.postsFetch.includes('opencli douyin user-videos'));
  });

  it('should have profileFieldMap', () => {
    const adapter = getPlatformAdapter('douyin');
    assert.ok(adapter);
    assert.ok(adapter!.profileFieldMap);
    assert.equal(adapter!.profileFieldMap!.nickname, 'author_name');
    assert.equal(adapter!.profileFieldMap!.follower_count, 'follower_count');
    assert.equal(adapter!.profileFieldMap!.signature, 'bio');
    assert.equal(adapter!.profileFieldMap!.sec_uid, 'platform_creator_id');
  });
});

describe('xhs adapter', () => {
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
});

describe('normalizePostItem with platformId', () => {
  it('should map douyin fields when platformId is provided', () => {
    const raw = {
      aweme_id: '7597309249148046602',
      title: '测试抖音视频',
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
    assert.equal(result.like_count, 824442);
    assert.equal(result.collect_count, 320680);
    assert.equal(result.share_count, 351597);
    assert.equal(result.comment_count, 9246);
    assert.equal(result.author_name, '日食记');
    assert.equal(result.author_id, 'MS4wLjABAAAA');
    assert.equal(result.cover_url, 'https://example.com/cover.jpg');
    assert.equal(result.post_type, 'false');
  });

  it('should work without platformId (backward compatible)', () => {
    const raw = {
      note_id: 'note123',
      title: '测试小红书',
      likes: '100',
      author: '测试用户',
    };

    const result = normalizePostItem(raw);
    assert.equal(result.platform_post_id, 'note123');
    assert.equal(result.like_count, 100);
    assert.equal(result.author_name, '测试用户');
  });

  it('should use platform fieldMap to override base map', () => {
    const raw = { author: '抖音用户' };
    const result = normalizePostItem(raw, 'douyin');
    assert.equal(result.author_name, '抖音用户');
  });
});
