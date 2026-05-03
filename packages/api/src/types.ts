import type {
  Post,
  Task,
  TaskStep,
  QueueJob,
  Strategy,
  Platform,
  Creator,
  CreatorSyncLog,
  CreatorSyncSchedule,
  AnalysisResult,
  FieldMapping,
  Comment,
  MediaFile,
} from '@scopai/core';

export type { Post, Task, TaskStep, QueueJob, Strategy, Platform, Creator, Comment, MediaFile };

// === Posts ===
export interface ListPostsResponse {
  posts: Post[];
  total: number;
}

export interface SearchPostsResponse {
  posts: Post[];
  total: number;
}

export interface ListCommentsResponse {
  comments: Comment[];
  total: number;
}

export interface ImportPostsResponse {
  imported: number;
  skipped: number;
  postIds: string[];
}

// === Tasks ===
export interface ListTasksResponse {
  items: Task[];
  total: number;
}

export interface TaskDetailResponse extends Task {
  phase: string;
  phases: {
    dataPreparation: {
      status: string;
      totalPosts: number;
      commentsFetched: number;
      mediaFetched: number;
      failedPosts: number;
    };
    steps: Array<{
      stepId: string;
      strategyId: string | null;
      name: string;
      status: string;
      stats: { total: number; done: number; failed: number } | null;
      stepOrder: number;
    }>;
    analysis: {
      totalJobs: number;
      completedJobs: number;
      failedJobs: number;
      pendingJobs: number;
    };
  };
  recentErrors: Array<{ target_type: string; target_id: string; error: string }>;
  steps: TaskStep[];
  jobs: Array<{
    id: string;
    target_type: string | null;
    target_id: string | null;
    status: string;
    attempts: number;
    error: string | null;
  }>;
}

export interface TaskStartResponse {
  enqueued: number;
  skipped: number;
}

export interface TaskPauseResponse {
  status: string;
}

export interface TaskResumeResponse {
  jobId: string;
  taskId: string;
  status: string;
}

export interface TaskCancelResponse {
  status: string;
}

export interface TaskPrepareDataResponse {
  started: boolean;
  reason?: string;
  status: string;
}

export interface TaskAddPostsResponse {
  added: number;
}

export interface CreateTaskStepResponse {
  stepId: string;
  stepOrder: number;
}

export interface AnalyzeSubmitResponse {
  task_id: string;
  enqueued: number;
  skipped: number;
}

export interface RunTaskStepResponse {
  status: string;
  enqueued: number;
}

export interface ResetTaskStepResponse {
  reset: boolean;
}

export interface RunAllTaskStepsResponse {
  completed: number;
  failed: number;
  skipped: number;
}

export interface ListTaskStepsResponse {
  steps: TaskStep[];
}

export interface TaskResultsResponse {
  results: AnalysisResult[];
  stats: Record<string, unknown> | null;
}

// === Creators ===
export interface ListCreatorsResponse {
  items: Creator[];
  total: number;
}

export interface CreatorDetailResponse extends Creator {
  posts: Post[];
  totalPosts: number;
}

export interface CreatorPostsResponse {
  items: Post[];
  total: number;
}

export interface CreatorSyncResponse {
  jobId: string;
}

// === Strategies ===
export interface ListStrategiesResponse {
  strategies: Strategy[];
}

export interface ImportStrategyResponse {
  imported: boolean;
  reason?: string;
  id?: string;
}

// === Queue ===
export interface ListQueueResponse {
  stats: { pending: number; processing: number; completed: number; failed: number };
  jobs: Array<{
    id: string;
    target_id: string;
    target_type: string;
    status: string;
    attempts: number;
    error: string | null;
  }>;
  total: number;
}

export interface QueueRetryResponse {
  retried: number;
}

export interface QueueResetResponse {
  reset: number;
}

// === Platforms ===
export interface ListPlatformsResponse {
  platforms: Platform[];
}

export interface ListFieldMappingsResponse {
  mappings: FieldMapping[];
}

// === Analyze ===
export interface AnalyzeRunResponse {
  enqueued: number;
  skipped: number;
}

// === Status ===
export interface StatusResponse {
  pid: number;
  db_path: string;
  queue_stats: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  };
  uptime: number;
}
