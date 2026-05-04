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
    postsFetch: '',
  },
  directoryName: 'douyin',
  fieldMap: {
    aweme_id: 'platform_post_id',
    digg_count: 'like_count',
    collect_count: 'collect_count',
    share_count: 'share_count',
    comment_count: 'comment_count',
    author: 'author_name',
    author_id: 'author_id',
    cover_image: 'cover_url',
    is_image: 'post_type',
    create_time: 'published_at',
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
