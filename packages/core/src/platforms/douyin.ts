import type { PlatformAdapter } from './types';

export const douyinAdapter: PlatformAdapter = {
  id: 'douyin',
  defaultTemplates: {
    fetchNote: '',
    fetchComments: '',
    fetchMedia: 'opencli douyin download {url} --output {download_dir}/{platform} -f json',
  },
  creatorTemplates: {
    profileFetch: 'opencli douyin user-info {author_id} -f json',
    postsFetch: 'opencli douyin user-videos {author_id} --limit {limit} -f json',
  },
  directoryName: 'douyin',
  fieldMap: {
    // search / note 命令均返回驼峰风格
    awemeId: 'platform_post_id',
    diggCount: 'like_count',
    collectCount: 'collect_count',
    shareCount: 'share_count',
    commentCount: 'comment_count',
    nickname: 'author_name',
    secUid: 'author_id',
    uid: 'author_id',
    isImage: 'post_type',
    createTime: 'published_at',
    desc: 'content',
    hashtags: 'tags',
  },
  profileFieldMap: {
    nickname: 'author_name',
    avatarUrl: 'avatar_url',
    followerCount: 'follower_count',
    followingCount: 'following_count',
    desc: 'bio',
    secUid: 'platform_creator_id',
  },
};
