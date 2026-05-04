import type { PlatformAdapter } from './types';

export const douyinAdapter: PlatformAdapter = {
  id: 'douyin',
  defaultTemplates: {
    fetchNote: '',
    fetchComments: '',
    fetchMedia: 'opencli douyin download {url} --output {download_dir}/{platform} -f json',
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
  },
};
