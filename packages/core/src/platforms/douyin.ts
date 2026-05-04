import type { PlatformAdapter } from './types';

export const douyinAdapter: PlatformAdapter = {
  id: 'douyin',
  defaultTemplates: {
    fetchNote: 'opencli douyin note {url} -f json',
    fetchComments: '',
    fetchMedia: 'opencli douyin download {url} --output {download_dir}/{platform} -f json',
  },
  creatorTemplates: {
    profileFetch: 'opencli douyin user-info {author_id} -f json',
    postsFetch: 'opencli douyin user-videos {author_id} --limit {limit} -f json',
  },
  directoryName: 'douyin',
  fieldMap: {
    // search 命令返回下划线风格
    aweme_id: 'platform_post_id',
    digg_count: 'like_count',
    collect_count: 'collect_count',
    share_count: 'share_count',
    comment_count: 'comment_count',
    author_id: 'author_id',
    is_image: 'post_type',
    create_time: 'published_at',
    // note 命令返回驼峰风格
    awemeId: 'platform_post_id',
    diggCount: 'like_count',
    collectCount: 'collect_count',
    shareCount: 'share_count',
    commentCount: 'comment_count',
    nickname: 'author_name',
    secUid: 'author_id',
    isImage: 'post_type',
    createTime: 'published_at',
    // 通用
    desc: 'content',
    hashtags: 'tags',
  },
  profileFieldMap: {
    nickname: 'author_name',
    avatar: 'avatar_url',
    follower_count: 'follower_count',
    following_count: 'following_count',
    signature: 'bio',
    sec_uid: 'platform_creator_id',
  },
};
