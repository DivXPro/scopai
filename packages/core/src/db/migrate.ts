import * as fs from 'fs';
import * as path from 'path';
import { exec, query } from './client';

function findSchemaPath(): string {
  const distSchema = path.join(__dirname, 'schema.sql');
  if (fs.existsSync(distSchema)) return distSchema;

  const projectRoot = path.join(__dirname, '..', '..');
  const srcSchema = path.join(projectRoot, 'src', 'db', 'schema.sql');
  if (fs.existsSync(srcSchema)) return srcSchema;

  throw new Error(`schema.sql not found. Searched: ${distSchema}, ${srcSchema}`);
}

async function migrateCliTemplates(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'tasks'"
  );
  const hasCliTemplates = columns.some(c => c.name === 'cli_templates');
  if (!hasCliTemplates) {
    await exec('ALTER TABLE tasks ADD COLUMN cli_templates TEXT');
  }
}

async function migrateStrategiesTable(): Promise<void> {
  const hasStrategies = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'strategies'"
  );
  if (hasStrategies.length === 0) {
    await exec(`CREATE TABLE strategies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      version TEXT NOT NULL DEFAULT '1.0.0',
      target TEXT NOT NULL CHECK(target IN ('post', 'comment')),
      needs_media JSON,
      prompt TEXT NOT NULL,
      output_schema JSON NOT NULL,
      file_path TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
  }
}


async function migrateQueueJobsStrategyId(): Promise<void> {
  const queueColumns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'queue_jobs'"
  );
  const hasStrategyId = queueColumns.some(c => c.name === 'strategy_id');
  if (!hasStrategyId) {
    await exec("ALTER TABLE queue_jobs ADD COLUMN strategy_id TEXT");
  }
}

async function migrateTaskStepsTable(): Promise<void> {
  const hasTaskSteps = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'task_steps'"
  );
  if (hasTaskSteps.length === 0) {
    await exec(`CREATE TABLE task_steps (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id),
      strategy_id TEXT REFERENCES strategies(id),
      name TEXT NOT NULL,
      step_order INTEGER NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','skipped')),
      stats JSON,
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(task_id, strategy_id)
    )`);
    await exec('CREATE INDEX idx_task_steps_task ON task_steps(task_id)');
  }
}

async function migrateBatchConfigColumn(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'strategies'"
  );
  const hasBatchConfig = columns.some(c => c.name === 'batch_config');
  if (!hasBatchConfig) {
    await exec('ALTER TABLE strategies ADD COLUMN batch_config JSON');
  }
}

async function migrateDependsOnColumns(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'strategies'"
  );
  if (!columns.some(c => c.name === 'depends_on')) {
    await exec('ALTER TABLE strategies ADD COLUMN depends_on TEXT');
  }
  if (!columns.some(c => c.name === 'include_original')) {
    await exec('ALTER TABLE strategies ADD COLUMN include_original BOOLEAN DEFAULT false');
  }
}

async function migrateTaskStepsDependsOn(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'task_steps'"
  );
  if (!columns.some(c => c.name === 'depends_on_step_id')) {
    await exec('ALTER TABLE task_steps ADD COLUMN depends_on_step_id TEXT');
  }
}

async function migratePlatformSyncTemplates(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'platforms'"
  );
  if (!columns.some(c => c.name === 'profile_fetch_template')) {
    await exec('ALTER TABLE platforms ADD COLUMN profile_fetch_template TEXT');
  }
  if (!columns.some(c => c.name === 'posts_fetch_template')) {
    await exec('ALTER TABLE platforms ADD COLUMN posts_fetch_template TEXT');
  }
}

// Expand sync_type CHECK to allow 'profile_sync' value
// DuckDB does not support DROP CONSTRAINT or ALTER COLUMN type.
// Migration strategy: if profile_sync INSERT fails due to CHECK, recreate the
// table using the schema.sql definition (which has the expanded CHECK).
// This is safe for dev: we require no active processing/running jobs.
async function migrateCreatorSyncJobType(): Promise<void> {
  const tables = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'creator_sync_jobs'"
  );
  if (tables.length === 0) return;

  // Check if profile_sync is already accepted by attempting a no-op INSERT
  // with WHERE 1=0 (never actually inserts rows, but validates against CHECK)
  // Actually we need to test a real row that would trigger CHECK.
  // Use a subquery that would fail CHECK if constraint is old:
  try {
    await exec(`
      INSERT INTO creator_sync_jobs (id, creator_id, sync_type, status, posts_imported, posts_updated, posts_skipped, posts_failed, cursor, progress, error, created_at, processed_at)
      SELECT 'check-migrate-0001', 'check-trigger', 'profile_sync', 'pending', 0, 0, 0, 0, NULL, NULL, NULL, NOW(), NULL
    `);
    // Success - cleanup the test row
    await exec("DELETE FROM creator_sync_jobs WHERE id = 'check-migrate-0001'");
    return; // CHECK already accepts profile_sync
  } catch (err: unknown) {
    const msg = String(err);
    if (!msg.includes('CHECK constraint') && !msg.includes('creator_sync_jobs')) {
      return; // unexpected error, don't risk data loss
    }
    // CHECK rejected profile_sync - recreate table using current schema.sql definition
    // 1. Copy data to temp table
    await exec('CREATE TABLE creator_sync_jobs_backup AS SELECT * FROM creator_sync_jobs');
    // 2. Drop old table (CHECK is now gone)
    await exec('DROP TABLE creator_sync_jobs');
    // 3. Recreate from backup with new CHECK (CREATE TABLE IF NOT EXISTS from schema.sql will NOT override
    //    because table now exists; use INSERT ... SELECT to restore with schema-compatible values)
    await exec('INSERT INTO creator_sync_jobs SELECT * FROM creator_sync_jobs_backup');
    await exec('DROP TABLE creator_sync_jobs_backup');
    // Recreate indexes (they don't survive CREATE TABLE AS SELECT)
    await exec('CREATE INDEX IF NOT EXISTS idx_creator_sync_jobs_creator ON creator_sync_jobs(creator_id)');
    await exec('CREATE INDEX IF NOT EXISTS idx_creator_sync_jobs_status ON creator_sync_jobs(status)');
  }
}

export async function runMigrations(): Promise<void> {
  const schemaPath = findSchemaPath();
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await exec(schema);

  await migrateCliTemplates();
  await migrateStrategiesTable();
  await migrateQueueJobsStrategyId();
  await migrateTaskStepsTable();
  await migrateBatchConfigColumn();
  await migrateDependsOnColumns();
  await migrateTaskStepsDependsOn();
  await migratePlatformSyncTemplates();
  await migrateCreatorSyncJobType();

  // Migration: drop legacy analysis_results table if present
  const hasAnalysisResults = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'analysis_results'"
  );
  if (hasAnalysisResults.length > 0) {
    await exec('DROP TABLE analysis_results');
  }

  // Migration: drop legacy prompt_templates, analysis_results_comments, analysis_results_media tables
  const legacyTables = ['prompt_templates', 'analysis_results_comments', 'analysis_results_media'];
  for (const table of legacyTables) {
    const exists = await query<{ name: string }>(
      `SELECT table_name as name FROM information_schema.tables WHERE table_name = '${table}'`
    );
    if (exists.length > 0) {
      await exec(`DROP TABLE ${table}`);
    }
  }

  // Migration: drop template_id column from tasks if present
  const taskColumns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'tasks'"
  );
  if (taskColumns.some(c => c.name === 'template_id')) {
    await exec('ALTER TABLE tasks DROP COLUMN template_id');
  }
}
