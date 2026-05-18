import * as fs from 'fs';
import * as path from 'path';
import { exec, query, run } from './client';
import { generateId } from '../shared/utils';

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

async function migrateRouterColumns(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'strategies'"
  );
  if (!columns.some(c => c.name === 'is_router')) {
    await exec('ALTER TABLE strategies ADD COLUMN is_router BOOLEAN DEFAULT FALSE');
  }
  if (!columns.some(c => c.name === 'routing')) {
    await exec('ALTER TABLE strategies ADD COLUMN routing JSON');
  }
}

async function migrateRouterResultsTable(): Promise<void> {
  const hasTable = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'router_results'"
  );
  if (hasTable.length === 0) {
    await exec(`CREATE TABLE router_results (
      id TEXT PRIMARY KEY,
      router_step_id TEXT NOT NULL,
      strategy_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      applicable_strategy_ids JSON NOT NULL,
      skipped_strategies JSON NOT NULL,
      checks JSON NOT NULL,
      confidence REAL NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(router_step_id, post_id)
    )`);
    await exec('CREATE INDEX idx_router_results_task ON router_results(task_id)');
    await exec('CREATE INDEX idx_router_results_step ON router_results(router_step_id)');
  }
}

async function migrateIsDefaultColumn(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'strategies'"
  );
  if (!columns.some(c => c.name === 'is_default')) {
    await exec('ALTER TABLE strategies ADD COLUMN is_default BOOLEAN DEFAULT false');
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

async function migrateTaskStatusCheck(): Promise<void> {
  // DuckDB does not support ALTER COLUMN or DROP CONSTRAINT.
  // Test if 'cancelled' is already accepted; if not, rebuild the table.
  try {
    await exec("UPDATE tasks SET status = 'cancelled' WHERE status = 'failed' AND 1=0");
  } catch {
    await exec('CREATE TABLE tasks_backup AS SELECT * FROM tasks');
    await exec('DROP TABLE tasks');
    await exec(`CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','paused','completed','failed','cancelled')),
      stats JSON,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      completed_at TIMESTAMP
    )`);
    await exec('INSERT INTO tasks SELECT * FROM tasks_backup');
    await exec('DROP TABLE tasks_backup');
  }
}

async function migrateTaskStepsRemoveDependsOn(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'task_steps'"
  );
  const hasDependsOn = columns.some(c => c.name === 'depends_on_step_id');
  if (!hasDependsOn) return;

  await exec(`CREATE TABLE task_steps_backup AS
    SELECT id, task_id, strategy_id, name, step_order, status, stats, error, created_at, updated_at
    FROM task_steps`);
  await exec('DROP TABLE task_steps');
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
    updated_at TIMESTAMP DEFAULT NOW()
  )`);
  await exec('INSERT INTO task_steps SELECT * FROM task_steps_backup');
  await exec('DROP TABLE task_steps_backup');
  await exec('CREATE INDEX idx_task_steps_task ON task_steps(task_id)');
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
    // Ensure a dummy creator exists so FK check passes and we only test CHECK.
    await exec(`
      INSERT INTO creators (id, platform_id, platform_author_id, author_name, created_at, updated_at)
      SELECT 'check-migrate-creator', 'check-platform', 'check-author', 'check', NOW(), NOW()
      ON CONFLICT DO NOTHING
    `);
    await exec(`
      INSERT INTO creator_sync_jobs (id, creator_id, sync_type, status, posts_imported, posts_updated, posts_skipped, posts_failed, cursor, progress, error, created_at, processed_at)
      SELECT 'check-migrate-0001', 'check-migrate-creator', 'profile_sync', 'pending', 0, 0, 0, 0, NULL, NULL, NULL, NOW(), NULL
    `);
    // Success - cleanup the test row
    await exec("DELETE FROM creator_sync_jobs WHERE id = 'check-migrate-0001'");
    await exec("DELETE FROM creators WHERE id = 'check-migrate-creator'");
    return; // CHECK already accepts profile_sync
  } catch (err: unknown) {
    const msg = String(err);
    await exec("DELETE FROM creators WHERE id = 'check-migrate-creator'").catch(() => {});
    if (!msg.includes('CHECK constraint') && !msg.includes('creator_sync_jobs')) {
      return; // unexpected error, don't risk data loss
    }
    // CHECK rejected profile_sync - recreate table using current schema.sql definition
    // 1. Copy data to temp table
    await exec('CREATE TABLE creator_sync_jobs_backup AS SELECT * FROM creator_sync_jobs');
    // 2. Drop old table (CHECK is now gone)
    await exec('DROP TABLE creator_sync_jobs');
    // 3. Recreate table with new CHECK
    await exec(`CREATE TABLE creator_sync_jobs (
      id TEXT PRIMARY KEY,
      creator_id TEXT NOT NULL REFERENCES creators(id),
      sync_type TEXT NOT NULL CHECK(sync_type IN ('initial','periodic','profile_sync')),
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','completed_with_errors','failed')),
      posts_imported INTEGER DEFAULT 0,
      posts_updated INTEGER DEFAULT 0,
      posts_skipped INTEGER DEFAULT 0,
      posts_failed INTEGER DEFAULT 0,
      cursor TEXT,
      progress JSON,
      error TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      processed_at TIMESTAMP
    )`);
    await exec('INSERT INTO creator_sync_jobs SELECT * FROM creator_sync_jobs_backup');
    await exec('DROP TABLE creator_sync_jobs_backup');
    // Recreate indexes (they don't survive CREATE TABLE AS SELECT)
    await exec('CREATE INDEX IF NOT EXISTS idx_creator_sync_jobs_creator ON creator_sync_jobs(creator_id)');
    await exec('CREATE INDEX IF NOT EXISTS idx_creator_sync_jobs_status ON creator_sync_jobs(status)');
  }
}

async function migrateIsStarredColumn(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'posts'"
  );
  if (!columns.some(c => c.name === 'is_starred')) {
    await exec('ALTER TABLE posts ADD COLUMN is_starred BOOLEAN DEFAULT false');
  }
}

async function migrateCoverLocalPathColumn(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'posts'"
  );
  if (!columns.some(c => c.name === 'cover_local_path')) {
    await exec('ALTER TABLE posts ADD COLUMN cover_local_path TEXT');
  }
}

async function migrateLabelsTables(): Promise<void> {
  const hasLabels = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'labels'"
  );
  if (hasLabels.length === 0) {
    await exec(`CREATE TABLE labels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    await exec(`CREATE TABLE post_labels (
      post_id TEXT NOT NULL REFERENCES posts(id),
      label_id TEXT NOT NULL REFERENCES labels(id),
      PRIMARY KEY (post_id, label_id)
    )`);
    await exec('CREATE INDEX idx_post_labels_label ON post_labels(label_id)');
  }
}

async function migrateSearchIndexTable(): Promise<void> {
  const hasSearchIndex = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'search_index'"
  );
  if (hasSearchIndex.length === 0) {
    await exec(`CREATE TABLE search_index (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      searchable_text TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await exec('CREATE INDEX idx_search_index_post ON search_index(post_id)');
    await exec('CREATE INDEX idx_search_index_type ON search_index(source_type)');
    return;
  }

  // Migration: add id column if missing (needed for FTS)
  const columns = await query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'search_index'"
  );
  const hasId = columns.some(c => c.column_name === 'id');

  if (!hasId) {
    await exec(`CREATE TABLE search_index_new (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      searchable_text TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      updated_at TIMESTAMP DEFAULT NOW()
    )`);

    const rows = await query<{ post_id: string; source_type: string; searchable_text: string; weight: number; updated_at: string }>(
      'SELECT post_id, source_type, searchable_text, weight, updated_at FROM search_index'
    );

    for (const row of rows) {
      await run(
        `INSERT INTO search_index_new (id, post_id, source_type, searchable_text, weight, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [generateId(), row.post_id, row.source_type, row.searchable_text, row.weight, row.updated_at]
      );
    }

    await exec('DROP TABLE search_index');
    await exec('ALTER TABLE search_index_new RENAME TO search_index');
    await exec('CREATE INDEX idx_search_index_post ON search_index(post_id)');
    await exec('CREATE INDEX idx_search_index_type ON search_index(source_type)');
  }
}

// Remove 'multi-post' values from task_targets and strategies.
// DuckDB does not support DROP CONSTRAINT or ALTER COLUMN type.
// We simply delete any 'multi-post' rows; the old CHECK may still list the value,
// but with no data present it will never be exercised.  Rebuilding the table
// is avoided because task_steps has a FK to strategies and the backup/restore
// dance is fragile.
async function migrateTargetTypeCheck(): Promise<void> {
  const taskTargetsTables = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'task_targets'"
  );
  if (taskTargetsTables.length > 0) {
    await exec("DELETE FROM task_targets WHERE target_type = 'multi-post'");
  }

  const strategiesTables = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'strategies'"
  );
  if (strategiesTables.length > 0) {
    // Remove referencing rows first to avoid FK constraint violations
    const queueJobsTables = await query<{ name: string }>(
      "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'queue_jobs'"
    );
    if (queueJobsTables.length > 0) {
      await exec("DELETE FROM queue_jobs WHERE strategy_id IN (SELECT id FROM strategies WHERE target = 'multi-post')");
    }
    const taskStepsTables = await query<{ name: string }>(
      "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'task_steps'"
    );
    if (taskStepsTables.length > 0) {
      await exec("DELETE FROM task_steps WHERE strategy_id IN (SELECT id FROM strategies WHERE target = 'multi-post')");
    }
    await exec("DELETE FROM strategies WHERE target = 'multi-post'");
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
  await migrateIsDefaultColumn();
  await migrateTaskStepsDependsOn();
  await migratePlatformSyncTemplates();
  await migrateCreatorSyncJobType();
  await migrateIsStarredColumn();
  await migrateCoverLocalPathColumn();
  await migrateLabelsTables();
  await migrateSearchIndexTable();
  await migrateTargetTypeCheck();
  await migrateTaskStatusCheck();
  await migrateTaskStepsRemoveDependsOn();
  await migrateRouterColumns();
  await migrateRouterResultsTable();

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
