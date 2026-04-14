// === Platform ===
export interface Platform {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
}

export interface FieldMapping {
  id: string;
  platform_id: string;
  entity_type: 'post' | 'comment' | 'user';
  system_field: string;
  platform_field: string;
  data_type: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'json';
  is_required: boolean;
  transform_expr: string | null;
  description: string | null;
}

// === Post ===
export type PostType = 'text' | 'image' | 'video' | 'audio' | 'article' | 'carousel' | 'mixed';

export interface Post {
  id: string;
  platform_id: string;
  platform_post_id: string;
  title: string | null;
  content: string;
  author_id: string | null;
  author_name: string | null;
  author_url: string | null;
  url: string | null;
  cover_url: string | null;
  post_type: PostType | null;
  like_count: number;
  collect_count: number;
  comment_count: number;
  share_count: number;
  play_count: number;
  score: number | null;
  tags: Tag[] | null;
  media_files: MediaFileRef[] | null;
  published_at: Date | null;
  fetched_at: Date;
  metadata: Record<string, unknown> | null;
}

export interface Tag {
  name: string;
  url?: string;
}

export interface MediaFileRef {
  type: 'image' | 'video' | 'audio';
  url: string;
  local_path?: string;
}

// === Comment ===
export interface Comment {
  id: string;
  post_id: string;
  platform_id: string;
  platform_comment_id: string | null;
  parent_comment_id: string | null;
  root_comment_id: string | null;
  depth: number;
  author_id: string | null;
  author_name: string | null;
  content: string;
  like_count: number;
  reply_count: number;
  published_at: Date | null;
  fetched_at: Date;
  metadata: Record<string, unknown> | null;
}

// === MediaFile ===
export type MediaType = 'image' | 'video' | 'audio';

export interface MediaFile {
  id: string;
  post_id: string | null;
  comment_id: string | null;
  platform_id: string | null;
  media_type: MediaType;
  url: string;
  local_path: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  file_size: number | null;
  downloaded_at: Date | null;
  created_at: Date;
}

// === Task ===
export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
export type TargetStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface Task {
  id: string;
  name: string;
  description: string | null;
  template_id: string | null;
  cli_templates: string | null;
  status: TaskStatus;
  stats: TaskStats | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export type TaskPostStatusValue = 'pending' | 'fetching' | 'done' | 'failed';

export interface TaskPostStatus {
  task_id: string;
  post_id: string;
  comments_fetched: boolean;
  media_fetched: boolean;
  comments_count: number;
  media_count: number;
  status: TaskPostStatusValue;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface TaskStats {
  total: number;
  done: number;
  failed: number;
}

export interface TaskTarget {
  id: string;
  task_id: string;
  target_type: 'post' | 'comment';
  target_id: string;
  status: TargetStatus;
  error: string | null;
  created_at: Date;
}

// === Analysis Results ===
export type SentimentLabel = 'positive' | 'negative' | 'neutral';
export type CommentIntent = 'praise' | 'complaint' | 'question' | 'suggestion' | 'neutral' | 'other';
export type RiskLevel = 'low' | 'medium' | 'high';
export type MediaContentType = 'product' | 'person' | 'scene' | 'text' | 'screenshot' | 'meme' | 'other';

export interface AnalysisResultComment {
  id: string;
  task_id: string;
  comment_id: string;
  sentiment_label: SentimentLabel | null;
  sentiment_score: number | null;
  intent: CommentIntent | null;
  risk_flagged: boolean;
  risk_level: RiskLevel | null;
  risk_reason: string | null;
  topics: TopicTag[] | null;
  emotion_tags: EmotionTag[] | null;
  keywords: string[] | null;
  summary: string | null;
  raw_response: Record<string, unknown> | null;
  error: string | null;
  analyzed_at: Date;
}

export interface TopicTag {
  name: string;
  confidence: number;
}

export interface EmotionTag {
  tag: string;
  confidence: number;
}

export interface AnalysisResultMedia {
  id: string;
  task_id: string;
  media_id: string;
  media_type: MediaType;
  content_type: MediaContentType | null;
  description: string | null;
  ocr_text: string | null;
  sentiment_label: SentimentLabel | null;
  sentiment_score: number | null;
  risk_flagged: boolean;
  risk_level: RiskLevel | null;
  risk_reason: string | null;
  objects: DetectedObject[] | null;
  logos: DetectedLogo[] | null;
  faces: DetectedFace[] | null;
  raw_response: Record<string, unknown> | null;
  error: string | null;
  analyzed_at: Date;
}

export interface DetectedObject {
  label: string;
  confidence: number;
}

export interface DetectedLogo {
  name: string;
  confidence: number;
}

export interface DetectedFace {
  age?: number;
  gender?: string;
  emotion?: string;
}

// === Prompt Template ===
export interface PromptTemplate {
  id: string;
  name: string;
  description: string | null;
  template: string;
  is_default: boolean;
  created_at: Date;
}

// === Queue ===
export type QueueStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface QueueJob {
  id: string;
  task_id: string;
  target_type: 'post' | 'comment' | 'media' | null;
  target_id: string | null;
  status: QueueStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  error: string | null;
  created_at: Date;
  processed_at: Date | null;
}

// === Config ===
export interface Config {
  database: {
    path: string;
  };
  anthropic: {
    api_key: string;
    model: string;
    max_tokens: number;
    temperature: number;
  };
  worker: {
    concurrency: number;
    max_retries: number;
    retry_delay_ms: number;
  };
  paths: {
    media_dir: string;
    export_dir: string;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

// === IPC ===
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
  id: number | string;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number | string;
}
