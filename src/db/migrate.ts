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
    await exec("ALTER TABLE strategies ADD COLUMN depends_on TEXT CHECK(depends_on IN ('post', 'comment') OR depends_on IS NULL)");
  }
  if (!columns.some(c => c.name === 'include_original')) {
    await exec('ALTER TABLE strategies ADD COLUMN include_original BOOLEAN NOT NULL DEFAULT false');
  }
}

async function migrateTaskStepsDependsOn(): Promise<void> {
  const columns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'task_steps'"
  );
  if (!columns.some(c => c.name === 'depends_on_step_id')) {
    await exec('ALTER TABLE task_steps ADD COLUMN depends_on_step_id TEXT REFERENCES task_steps(id)');
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

  // Migration: drop legacy analysis_results table if present
  const hasAnalysisResults = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'analysis_results'"
  );
  if (hasAnalysisResults.length > 0) {
    await exec('DROP TABLE analysis_results');
  }
}
