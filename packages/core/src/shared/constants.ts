export const PLATFORMS = [
  { id: 'xhs',       name: 'xiaohongshu',  description: '小红书' },
  { id: 'twitter',   name: 'twitter',       description: 'Twitter/X' },
  { id: 'weibo',     name: 'weibo',         description: '微博' },
  { id: 'bilibili',  name: 'bilibili',      description: 'Bilibili' },
  { id: 'zhihu',     name: 'zhihu',         description: '知乎' },
  { id: 'reddit',    name: 'reddit',        description: 'Reddit' },
  { id: 'douyin',    name: 'douyin',        description: '抖音' },
  { id: 'instagram', name: 'instagram',     description: 'Instagram' },
  { id: 'tiktok',    name: 'tiktok',        description: 'TikTok' },
  { id: 'weixin',    name: 'weixin',        description: '微信公众平台' },
  { id: 'bluesky',   name: 'bluesky',       description: 'Bluesky' },
] as const;

export const POST_TYPES = ['text', 'image', 'video', 'audio', 'article', 'carousel', 'mixed'] as const;
export const TASK_STATUSES = ['pending', 'running', 'paused', 'completed', 'failed'] as const;
export const TARGET_STATUSES = ['pending', 'processing', 'done', 'failed'] as const;
export const SENTIMENT_LABELS = ['positive', 'negative', 'neutral'] as const;
export const COMMENT_INTENTS = ['praise', 'complaint', 'question', 'suggestion', 'neutral', 'other'] as const;
export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export const MEDIA_TYPES = ['image', 'video', 'audio'] as const;
export const MEDIA_CONTENT_TYPES = ['product', 'person', 'scene', 'text', 'screenshot', 'meme', 'other'] as const;
export const QUEUE_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;

export const DEFAULT_WORKERS = 2;
