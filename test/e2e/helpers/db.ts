import * as db from '../../../dist/db/client.js';
const { query, run, close: closeDb } = db;
import * as migrate from '../../../dist/db/migrate.js';
const { runMigrations } = migrate;
import * as seed from '../../../dist/db/seed.js';
const { seedAll } = seed;

export { query, run, closeDb, runMigrations, seedAll };

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
  closeDb();
  await runMigrations();
  await seedAll();
}
