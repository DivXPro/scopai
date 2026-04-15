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

async function migrateAnalysisResultsTable(): Promise<void> {
  const hasAnalysisResults = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'analysis_results'"
  );
  if (hasAnalysisResults.length === 0) {
    await exec(`CREATE TABLE analysis_results (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES tasks(id),
      strategy_id TEXT REFERENCES strategies(id),
      strategy_version TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
      target_id TEXT NOT NULL,
      post_id TEXT REFERENCES posts(id),
      columns JSON NOT NULL,
      json_fields JSON NOT NULL,
      raw_response JSON,
      error TEXT,
      analyzed_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(task_id, strategy_id, target_type, target_id)
    )`);
    await exec(`CREATE INDEX idx_analysis_results_task ON analysis_results(task_id)`);
    await exec(`CREATE INDEX idx_analysis_results_strategy ON analysis_results(strategy_id)`);
    await exec(`CREATE INDEX idx_analysis_results_target ON analysis_results(target_type, target_id)`);
    await exec(`CREATE INDEX idx_analysis_results_post ON analysis_results(post_id)`);
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

export async function runMigrations(): Promise<void> {
  const schemaPath = findSchemaPath();
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await exec(schema);

  await migrateCliTemplates();
  await migrateStrategiesTable();
  await migrateAnalysisResultsTable();
  await migrateQueueJobsStrategyId();
}
