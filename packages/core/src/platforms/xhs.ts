import type { PlatformAdapter } from './types';

export const xhsAdapter: PlatformAdapter = {
  id: 'xhs',
  defaultTemplates: {
    fetchNote: 'opencli xiaohongshu note {url} -f json',
    fetchComments: 'opencli xiaohongshu comments {url} --limit {limit} --with-replies true -f json',
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
    user_id: 'author_id',
  },
  profileFieldMap: {
    name: 'author_name',
    avatar: 'avatar_url',
    followers: 'follower_count',
    following: 'following_count',
    bio: 'bio',
    redId: 'platform_creator_id',
  },
  commentFieldMap: {
    id: 'platform_comment_id',
    content: 'content',
    likes: 'like_count',
    username: 'author_name',
    userId: 'author_id',
    subCommentCount: 'reply_count',
    createTime: 'published_at',
  },
  homepageUrlTemplate: 'https://www.xiaohongshu.com/user/profile/{platform_creator_id}',
  extractNoteId: (url: string): string | undefined => {
    // Match xiaohongshu note URLs: /explore/{noteId} or /search_result/{noteId} or /discovery/item/{noteId}
    const match = url.match(/xiaohongshu\.com\/(?:explore|search_result|discovery\/item)\/([a-f0-9]{24})/i);
    return match?.[1];
  },
};
