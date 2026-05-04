// === Database ===
export {
  getDbPath,
  getConnection,
  query,
  run,
  exec,
  checkpoint,
  close,
  createIsolatedConnection,
} from './db/client';

export { runMigrations as migrate } from './db/migrate';
export { seedPlatformsAndMappings as seedPlatforms } from './db/seed';

export * from './db/posts';
export * from './db/comments';
export * from './db/platforms';
export * from './db/media-files';
export * from './db/field-mappings';
export * from './db/templates';
export * from './db/tasks';
export * from './db/task-targets';
export * from './db/task-steps';
export * from './db/task-post-status';
export * from './db/strategies';
export * from './db/queue-jobs';
export * from './db/analysis-results';
export * from './db/aggregation';
export * from './db/creators';
export * from './db/creator-field-mappings';
export * from './db/creator-sync-jobs';
export * from './db/creator-sync-logs';
export * from './db/creator-sync-schedules';
export { updateTaskCliTemplates } from './db/tasks';

// === Config ===
export { loadConfig, config } from './config';
export { loadClaudeConfig } from './config/claude-config';

// === Shared Types ===
export * from './shared/types';
export * from './shared/constants';
export * from './shared/utils';
export { getLogger, initLogger } from './shared/logger';
export type { NormalizedPostItem, NormalizedCommentItem } from './shared/utils';
export { registerWorker, unregisterWorker, setWorkerActiveCount, getTotalActiveJobs, getWorkerCount, requestShutdown, isShuttingDown, resetShutdown } from './shared/shutdown';
export { VERSION as version } from './shared/version';
export { notifyJobAvailable, waitForJob } from './shared/job-events';
export { getDaemonStatus } from './shared/daemon-status';
export type { DaemonStatus } from './shared/daemon-status';
export { readLockFile, writeLockFile, removeLockFile, isApiAlive } from './shared/lock-file';
export type { LockFileData } from './shared/lock-file';

// === Data Fetcher ===
export { fetchViaOpencli } from './data-fetcher/opencli';

// === Platform Adapters ===
export * from './platforms';
