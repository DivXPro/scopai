import * as path from 'path';
import * as os from 'os';

// Generate a consistent test run ID and DB path shared with cli.ts
const TEST_RUN_ID = `e2e_${Date.now()}_${process.pid}`;
const TEST_TMP_DIR = path.join(os.tmpdir(), 'scopai-e2e', TEST_RUN_ID);
const TEST_DB_PATH = path.join(TEST_TMP_DIR, 'test.duckdb');

// Set env vars BEFORE any db modules are loaded
process.env.ANALYZE_CLI_DB_PATH = TEST_DB_PATH;
process.env.ANALYZE_CLI_IPC_SOCKET = path.join(TEST_TMP_DIR, 'daemon.sock');
process.env.ANALYZE_CLI_DAEMON_PID = path.join(TEST_TMP_DIR, 'daemon.pid');

// Lazy-load db modules after env vars are set to ensure they pick up the test paths
let _dbModule: typeof import('../../../packages/core/dist/db/client.js') | null = null;
let _migrateModule: typeof import('../../../packages/core/dist/db/migrate.js') | null = null;
let _seedModule: typeof import('../../../packages/core/dist/db/seed.js') | null = null;

async function getDbModule() {
  if (!_dbModule) {
    _dbModule = await import('../../../packages/core/dist/db/client.js');
  }
  return _dbModule;
}

async function getMigrateModule() {
  if (!_migrateModule) {
    _migrateModule = await import('../../../packages/core/dist/db/migrate.js');
  }
  return _migrateModule;
}

async function getSeedModule() {
  if (!_seedModule) {
    _seedModule = await import('../../../packages/core/dist/db/seed.js');
  }
  return _seedModule;
}

export async function query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
  const db = await getDbModule();
  return db.query(sql, params) as Promise<T[]>;
}

export async function run(sql: string, params?: unknown[]): Promise<void> {
  const db = await getDbModule();
  return db.run(sql, params);
}

export async function closeDb(): Promise<void> {
  const db = await getDbModule();
  return db.close();
}

export async function runMigrations(): Promise<void> {
  const m = await getMigrateModule();
  return m.runMigrations();
}

export async function seedAll(): Promise<void> {
  const s = await getSeedModule();
  return s.seedAll();
}

export function getTestDbPath(): string {
  return TEST_DB_PATH;
}

export async function cleanupByPrefix(prefix: string): Promise<void> {
  const like = `${prefix}%`;
  // Clean up in dependency order
  await run(`DELETE FROM queue_jobs WHERE task_id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM task_post_status WHERE task_id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM task_steps WHERE task_id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM task_targets WHERE task_id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM tasks WHERE id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM posts WHERE platform_id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM comments WHERE platform_id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM media_files WHERE platform_id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM platforms WHERE id LIKE ?`, [like]).catch(() => {});
  await run(`DELETE FROM strategies WHERE id LIKE ?`, [like]).catch(() => {});
  // Clean up dynamically created strategy_result_ tables
  const tables = await query<{ name: string }>(
    `SELECT table_name as name FROM information_schema.tables WHERE table_name LIKE ?`,
    [`strategy_result_${prefix}%`]
  );
  for (const t of tables) {
    await run(`DROP TABLE IF EXISTS "${t.name}"`).catch(() => {});
  }
}

export async function resetTestDb(): Promise<void> {
  // Run migrations on existing connection (CREATE TABLE IF NOT EXISTS is safe to rerun)
  await runMigrations();
  // Clear all data to start fresh
  await run('DELETE FROM queue_jobs').catch(() => {});
  await run('DELETE FROM task_post_status').catch(() => {});
  await run('DELETE FROM task_steps').catch(() => {});
  await run('DELETE FROM task_targets').catch(() => {});
  await run('DELETE FROM tasks').catch(() => {});
  await run('DELETE FROM posts').catch(() => {});
  await run('DELETE FROM comments').catch(() => {});
  await run('DELETE FROM media_files').catch(() => {});
  await run('DELETE FROM platforms').catch(() => {});
  await run('DELETE FROM strategies').catch(() => {});
  await run('DELETE FROM prompt_templates').catch(() => {});
  await seedAll();
}
