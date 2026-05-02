// === Platform ===
export interface Platform {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
  profile_fetch_template?: string | null;
  posts_fetch_template?: string | null;
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

export type TaskStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface TaskStep {
  id: string;
  task_id: string;
  strategy_id: string | null;
  depends_on_step_id: string | null;
  name: string;
  step_order: number;
  status: TaskStepStatus;
  stats: TaskStats | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
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
export type QueueStatus = 'pending' | 'waiting_media' | 'processing' | 'completed' | 'failed';

export interface QueueJob {
  id: string;
  task_id: string;
  strategy_id: string | null;
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

export interface LLMProviderConfig {
  api_key: string;
  base_url?: string;
  model: string;
  max_tokens: number;
  temperature: number;
}

// === Config ===
export interface Config {
  database: {
    path: string;
  };
  api_format: 'anthropic' | 'openai';
  anthropic: LLMProviderConfig;
  openai: LLMProviderConfig;
  worker: {
    concurrency: number;
    max_retries: number;
    retry_delay_ms: number;
  };
  paths: {
    media_dir: string;
    download_dir: string;
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

// === Strategy System ===

export interface NeedsMediaConfig {
  enabled: boolean;
  media_types?: MediaType[];
  max_media?: number;
  mode?: 'all' | 'first_n' | 'best_quality';
  upload_images?: boolean;
}

export interface BatchConfig {
  enabled: boolean;
  size: number;
}

export interface Strategy {
  id: string;
  name: string;
  description: string | null;
  version: string;
  target: 'post' | 'comment';
  needs_media: NeedsMediaConfig | null;
  prompt: string;
  output_schema: Record<string, unknown>;
  batch_config: BatchConfig | null;
  depends_on: 'post' | 'comment' | null;
  include_original: boolean;
  file_path: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AnalysisResult {
  id: string;
  task_id: string;
  strategy_id: string;
  strategy_version: string;
  target_type: 'post' | 'comment';
  target_id: string;
  post_id: string | null;
  raw_response: Record<string, unknown> | null;
  error: string | null;
  analyzed_at: Date;
  [key: string]: unknown;
}

export interface UnifiedAnalysisResult {
  id: string;
  task_id: string;
  target_type: string;
  target_id: string | null;
  summary: string | null;
  raw_response: Record<string, unknown> | null;
  analyzed_at: Date;
}

// === Creator Subscription ===

export interface Creator {
  id: string;
  platform_id: string;
  platform_author_id: string;
  author_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  homepage_url: string | null;
  follower_count: number;
  following_count: number;
  post_count: number;
  status: 'active' | 'paused' | 'unsubscribed';
  created_at: Date;
  updated_at: Date;
  last_synced_at: Date | null;
  metadata: Record<string, unknown> | null;
}

export interface CreatorFieldMapping {
  id: string;
  platform_id: string;
  entity_type: 'creator';
  system_field: string;
  platform_field: string;
  data_type: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'json';
  is_required: boolean;
  transform_expr: string | null;
  description: string | null;
}

export interface CreatorSyncJob {
  id: string;
  creator_id: string;
  sync_type: 'initial' | 'periodic' | 'profile_sync';
  status: 'pending' | 'processing' | 'completed' | 'completed_with_errors' | 'failed';
  posts_imported: number;
  posts_updated: number;
  posts_skipped: number;
  posts_failed: number;
  cursor: string | null;
  progress: Record<string, unknown> | null;
  error: string | null;
  created_at: Date;
  processed_at: Date | null;
}

export interface CreatorSyncLog {
  id: string;
  creator_id: string;
  job_id: string;
  sync_type: string;
  status: 'success' | 'partial' | 'failed';
  result_summary: Record<string, unknown> | null;
  started_at: Date;
  completed_at: Date | null;
}

export interface CreatorSyncSchedule {
  id: string;
  creator_id: string;
  interval_minutes: number;
  time_window_start: string | null;
  time_window_end: string | null;
  max_retries: number;
  retry_interval_minutes: number;
  is_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}
