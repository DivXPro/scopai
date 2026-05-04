import { upsertPlatform, updatePlatform } from './platforms';
import { createFieldMapping } from './field-mappings';
import { PLATFORMS } from '../shared/constants';
import { generateId } from '../shared/utils';
import { getAllPlatformAdapters } from '../platforms';

interface FieldMapDef {
  entity_type: 'post' | 'comment';
  system_field: string;
  platform_field: string;
  data_type: string;
  is_required: boolean;
  description: string;
  transform_expr?: string;
}

const PLATFORM_MAPPINGS: Record<string, FieldMapDef[]> = {
  xhs: [
    { entity_type: 'post', system_field: 'platform_post_id', platform_field: 'noteId', data_type: 'string', is_required: true, description: '笔记ID' },
    { entity_type: 'post', system_field: 'title', platform_field: 'displayTitle', data_type: 'string', is_required: false, description: '标题' },
    { entity_type: 'post', system_field: 'content', platform_field: 'desc', data_type: 'string', is_required: true, description: '正文' },
    { entity_type: 'post', system_field: 'author_id', platform_field: 'user.userId', data_type: 'string', is_required: false, description: '作者ID' },
    { entity_type: 'post', system_field: 'author_name', platform_field: 'user.nickname', data_type: 'string', is_required: false, description: '作者昵称' },
    { entity_type: 'post', system_field: 'like_count', platform_field: 'likes', data_type: 'number', is_required: false, description: '点赞数', transform_expr: 'parse_chinese_number' },
    { entity_type: 'post', system_field: 'post_type', platform_field: 'type', data_type: 'string', is_required: false, description: '笔记类型' },
    { entity_type: 'post', system_field: 'published_at', platform_field: 'lastUpdateTime', data_type: 'date', is_required: false, description: '更新时间', transform_expr: 'timestamp_to_date' },
    { entity_type: 'comment', system_field: 'content', platform_field: 'content', data_type: 'string', is_required: true, description: '评论内容' },
    { entity_type: 'comment', system_field: 'author_name', platform_field: 'user.nickname', data_type: 'string', is_required: false, description: '评论者昵称' },
    { entity_type: 'comment', system_field: 'like_count', platform_field: 'likeCount', data_type: 'number', is_required: false, description: '点赞数' },
  ],
  twitter: [
    { entity_type: 'post', system_field: 'platform_post_id', platform_field: 'id_str', data_type: 'string', is_required: true, description: '推文ID' },
    { entity_type: 'post', system_field: 'content', platform_field: 'text', data_type: 'string', is_required: true, description: '正文' },
    { entity_type: 'post', system_field: 'author_name', platform_field: 'user.name', data_type: 'string', is_required: false, description: '用户名' },
    { entity_type: 'post', system_field: 'like_count', platform_field: 'favorite_count', data_type: 'number', is_required: false, description: '点赞数' },
    { entity_type: 'post', system_field: 'share_count', platform_field: 'retweet_count', data_type: 'number', is_required: false, description: '转发数' },
    { entity_type: 'post', system_field: 'published_at', platform_field: 'created_at', data_type: 'date', is_required: false, description: '发布时间' },
  ],
  weibo: [
    { entity_type: 'post', system_field: 'platform_post_id', platform_field: 'idstr', data_type: 'string', is_required: true, description: '微博ID' },
    { entity_type: 'post', system_field: 'content', platform_field: 'text', data_type: 'string', is_required: true, description: '正文' },
    { entity_type: 'post', system_field: 'author_name', platform_field: 'user.screen_name', data_type: 'string', is_required: false, description: '用户名' },
    { entity_type: 'post', system_field: 'like_count', platform_field: 'attitudes_count', data_type: 'number', is_required: false, description: '点赞数' },
    { entity_type: 'post', system_field: 'share_count', platform_field: 'reposts_count', data_type: 'number', is_required: false, description: '转发数' },
    { entity_type: 'post', system_field: 'comment_count', platform_field: 'comments_count', data_type: 'number', is_required: false, description: '评论数' },
    { entity_type: 'comment', system_field: 'content', platform_field: 'text', data_type: 'string', is_required: true, description: '评论内容' },
    { entity_type: 'comment', system_field: 'like_count', platform_field: 'like_count', data_type: 'number', is_required: false, description: '点赞数' },
  ],
  bilibili: [
    { entity_type: 'post', system_field: 'platform_post_id', platform_field: 'aid', data_type: 'string', is_required: true, description: '视频ID' },
    { entity_type: 'post', system_field: 'title', platform_field: 'title', data_type: 'string', is_required: false, description: '标题' },
    { entity_type: 'post', system_field: 'content', platform_field: 'desc', data_type: 'string', is_required: false, description: '简介' },
    { entity_type: 'post', system_field: 'author_name', platform_field: 'author', data_type: 'string', is_required: false, description: 'UP主' },
    { entity_type: 'post', system_field: 'play_count', platform_field: 'stat.play', data_type: 'number', is_required: false, description: '播放数' },
    { entity_type: 'post', system_field: 'like_count', platform_field: 'stat.like', data_type: 'number', is_required: false, description: '点赞数' },
    { entity_type: 'post', system_field: 'comment_count', platform_field: 'stat.reply', data_type: 'number', is_required: false, description: '评论数' },
    { entity_type: 'comment', system_field: 'content', platform_field: 'content.message', data_type: 'string', is_required: true, description: '评论内容' },
    { entity_type: 'comment', system_field: 'like_count', platform_field: 'like', data_type: 'number', is_required: false, description: '点赞数' },
  ],
  zhihu: [
    { entity_type: 'post', system_field: 'platform_post_id', platform_field: 'id', data_type: 'string', is_required: true, description: '回答ID' },
    { entity_type: 'post', system_field: 'title', platform_field: 'question.title', data_type: 'string', is_required: false, description: '问题标题' },
    { entity_type: 'post', system_field: 'content', platform_field: 'content', data_type: 'string', is_required: true, description: '回答内容' },
    { entity_type: 'post', system_field: 'author_name', platform_field: 'author.name', data_type: 'string', is_required: false, description: '作者名' },
    { entity_type: 'post', system_field: 'like_count', platform_field: 'voteup_count', data_type: 'number', is_required: false, description: '赞同数' },
    { entity_type: 'comment', system_field: 'content', platform_field: 'content', data_type: 'string', is_required: true, description: '评论内容' },
    { entity_type: 'comment', system_field: 'like_count', platform_field: 'voteup_count', data_type: 'number', is_required: false, description: '点赞数' },
  ],
  reddit: [
    { entity_type: 'post', system_field: 'platform_post_id', platform_field: 'id', data_type: 'string', is_required: true, description: '帖子ID' },
    { entity_type: 'post', system_field: 'title', platform_field: 'title', data_type: 'string', is_required: false, description: '标题' },
    { entity_type: 'post', system_field: 'content', platform_field: 'selftext', data_type: 'string', is_required: true, description: '正文' },
    { entity_type: 'post', system_field: 'author_name', platform_field: 'author', data_type: 'string', is_required: false, description: '作者' },
    { entity_type: 'post', system_field: 'like_count', platform_field: 'score', data_type: 'number', is_required: false, description: '分数' },
    { entity_type: 'comment', system_field: 'content', platform_field: 'body', data_type: 'string', is_required: true, description: '评论内容' },
    { entity_type: 'comment', system_field: 'like_count', platform_field: 'score', data_type: 'number', is_required: false, description: '分数' },
  ],
  douyin: [
    { entity_type: 'post', system_field: 'platform_post_id', platform_field: 'aweme_id', data_type: 'string', is_required: true, description: '视频ID' },
    { entity_type: 'post', system_field: 'content', platform_field: 'desc', data_type: 'string', is_required: true, description: '视频描述' },
    { entity_type: 'post', system_field: 'author_name', platform_field: 'author.nickname', data_type: 'string', is_required: false, description: '作者昵称' },
    { entity_type: 'post', system_field: 'play_count', platform_field: 'statistics.play_count', data_type: 'number', is_required: false, description: '播放数' },
    { entity_type: 'post', system_field: 'like_count', platform_field: 'statistics.digg_count', data_type: 'number', is_required: false, description: '点赞数' },
    { entity_type: 'post', system_field: 'comment_count', platform_field: 'statistics.comment_count', data_type: 'number', is_required: false, description: '评论数' },
    { entity_type: 'post', system_field: 'share_count', platform_field: 'statistics.share_count', data_type: 'number', is_required: false, description: '分享数' },
    { entity_type: 'comment', system_field: 'content', platform_field: 'comment_text', data_type: 'string', is_required: true, description: '评论内容' },
    { entity_type: 'comment', system_field: 'author_name', platform_field: 'user.nickname', data_type: 'string', is_required: false, description: '评论者昵称' },
  ],
  instagram: [
    { entity_type: 'post', system_field: 'platform_post_id', platform_field: 'id', data_type: 'string', is_required: true, description: '帖子ID' },
    { entity_type: 'post', system_field: 'post_type', platform_field: 'media_type', data_type: 'string', is_required: false, description: '媒体类型' },
    { entity_type: 'comment', system_field: 'content', platform_field: 'text', data_type: 'string', is_required: true, description: '评论内容' },
    { entity_type: 'comment', system_field: 'author_name', platform_field: 'username', data_type: 'string', is_required: false, description: '评论者昵称' },
  ],
  tiktok: [
    { entity_type: 'post', system_field: 'platform_post_id', platform_field: 'aweme_id', data_type: 'string', is_required: true, description: '视频ID' },
    { entity_type: 'post', system_field: 'content', platform_field: 'desc', data_type: 'string', is_required: true, description: '视频描述' },
    { entity_type: 'post', system_field: 'author_name', platform_field: 'author.nickname', data_type: 'string', is_required: false, description: '作者昵称' },
    { entity_type: 'post', system_field: 'play_count', platform_field: 'statistics.play_count', data_type: 'number', is_required: false, description: '播放数' },
    { entity_type: 'post', system_field: 'like_count', platform_field: 'statistics.digg_count', data_type: 'number', is_required: false, description: '点赞数' },
    { entity_type: 'post', system_field: 'comment_count', platform_field: 'statistics.comment_count', data_type: 'number', is_required: false, description: '评论数' },
    { entity_type: 'post', system_field: 'share_count', platform_field: 'statistics.share_count', data_type: 'number', is_required: false, description: '分享数' },
    { entity_type: 'comment', system_field: 'content', platform_field: 'comment_text', data_type: 'string', is_required: true, description: '评论内容' },
    { entity_type: 'comment', system_field: 'author_name', platform_field: 'user.nickname', data_type: 'string', is_required: false, description: '评论者昵称' },
  ],
  weixin: [
    { entity_type: 'post', system_field: 'platform_post_id', platform_field: 'msgid', data_type: 'string', is_required: true, description: '文章ID' },
    { entity_type: 'post', system_field: 'title', platform_field: 'title', data_type: 'string', is_required: false, description: '文章标题' },
    { entity_type: 'post', system_field: 'content', platform_field: 'content_html', data_type: 'string', is_required: true, description: '正文' },
    { entity_type: 'post', system_field: 'author_name', platform_field: 'author', data_type: 'string', is_required: false, description: '作者' },
    { entity_type: 'post', system_field: 'published_at', platform_field: 'pub_time', data_type: 'date', is_required: false, description: '发布时间' },
  ],
  bluesky: [
    { entity_type: 'post', system_field: 'platform_post_id', platform_field: 'uri', data_type: 'string', is_required: true, description: '帖子URI' },
    { entity_type: 'post', system_field: 'content', platform_field: 'record.text', data_type: 'string', is_required: true, description: '正文' },
    { entity_type: 'post', system_field: 'author_name', platform_field: 'author.handle', data_type: 'string', is_required: false, description: '用户handle' },
    { entity_type: 'post', system_field: 'like_count', platform_field: 'likeCount', data_type: 'number', is_required: false, description: '点赞数' },
    { entity_type: 'post', system_field: 'share_count', platform_field: 'repostCount', data_type: 'number', is_required: false, description: '转发数' },
    { entity_type: 'post', system_field: 'comment_count', platform_field: 'replyCount', data_type: 'number', is_required: false, description: '回复数' },
  ],
};

export async function seedPlatformsAndMappings(): Promise<void> {
  for (const platform of PLATFORMS) {
    await upsertPlatform({ id: platform.id, name: platform.name, description: platform.description ?? null });
    const mappings = PLATFORM_MAPPINGS[platform.id];
    if (mappings) {
      for (const m of mappings) {
        try {
          await createFieldMapping({
            id: generateId(),
            platform_id: platform.id,
            entity_type: m.entity_type,
            system_field: m.system_field,
            platform_field: m.platform_field,
            data_type: m.data_type as 'string' | 'number' | 'date' | 'boolean' | 'array' | 'json',
            is_required: m.is_required,
            transform_expr: m.transform_expr ?? null,
            description: m.description,
          });
        } catch {
          // ignore duplicate
        }
      }
    }
  }
}

export async function seedAll(): Promise<void> {
  await seedPlatformsAndMappings();
  await seedPlatformSyncTemplates();
}

async function seedPlatformSyncTemplates(): Promise<void> {
  for (const adapter of getAllPlatformAdapters()) {
    if (adapter.creatorTemplates) {
      const { profileFetch, postsFetch } = adapter.creatorTemplates;
      await updatePlatform(adapter.id, {
        profile_fetch_template: profileFetch ?? null,
        posts_fetch_template: postsFetch ?? null,
      });
    }
  }
}
