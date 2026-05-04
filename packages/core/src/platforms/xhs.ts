import type { PlatformAdapter } from './types';

export const xhsAdapter: PlatformAdapter = {
  id: 'xhs',
  defaultTemplates: {
    fetchNote: 'opencli xiaohongshu note {url} -f json',
    fetchComments: 'opencli xiaohongshu comments {note_id} --limit {limit} -f json',
    fetchMedia: 'opencli xiaohongshu download {url} --output {download_dir}/{platform} -f json',
  },
  creatorTemplates: {
    profileFetch: 'opencli xiaohongshu user-info {author_id} --format json',
    postsFetch: 'opencli xiaohongshu user {author_id} --format json',
  },
  directoryName: 'xhs',
  fieldMap: {
    note_id: 'platform_post_id',
    likes: 'like_count',
    collects: 'collect_count',
    comments: 'comment_count',
    shares: 'share_count',
    plays: 'play_count',
    author: 'author_name',
    user_id: 'author_id',
    cover: 'cover_url',
    cover_image: 'cover_url',
  },
  profileFieldMap: {
    name: 'author_name',
    avatar: 'avatar_url',
    followers: 'follower_count',
    following: 'following_count',
    bio: 'bio',
    redId: 'platform_creator_id',
  },
};
