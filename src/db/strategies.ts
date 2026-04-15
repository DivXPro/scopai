import { query, run } from './client';
import { Strategy } from '../shared/types';
import { now } from '../shared/utils';

export async function createStrategy(strategy: Omit<Strategy, 'created_at' | 'updated_at'>): Promise<void> {
  await run(
    `INSERT INTO strategies (id, name, description, version, target, needs_media, prompt, output_schema, file_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      strategy.id, strategy.name, strategy.description, strategy.version, strategy.target,
      strategy.needs_media ? JSON.stringify(strategy.needs_media) : null,
      strategy.prompt, JSON.stringify(strategy.output_schema), strategy.file_path,
      now(), now(),
    ]
  );
}

export async function getStrategyById(id: string): Promise<Strategy | null> {
  const rows = await query<Strategy>('SELECT * FROM strategies WHERE id = ?', [id]);
  return rows[0] ? parseStrategyRow(rows[0]) : null;
}

export async function listStrategies(): Promise<Strategy[]> {
  const rows = await query<Strategy>('SELECT * FROM strategies ORDER BY created_at DESC');
  return rows.map(parseStrategyRow);
}

export async function updateStrategy(id: string, updates: Partial<Pick<Strategy, 'name' | 'description' | 'version' | 'prompt' | 'output_schema' | 'needs_media' | 'file_path'>>): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.version !== undefined) { sets.push('version = ?'); values.push(updates.version); }
  if (updates.prompt !== undefined) { sets.push('prompt = ?'); values.push(updates.prompt); }
  if (updates.output_schema !== undefined) { sets.push('output_schema = ?'); values.push(JSON.stringify(updates.output_schema)); }
  if (updates.needs_media !== undefined) { sets.push('needs_media = ?'); values.push(updates.needs_media ? JSON.stringify(updates.needs_media) : null); }
  if (updates.file_path !== undefined) { sets.push('file_path = ?'); values.push(updates.file_path); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(now());
  values.push(id);
  await run(`UPDATE strategies SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteStrategy(id: string): Promise<void> {
  await run('DELETE FROM strategies WHERE id = ?', [id]);
}

function parseStrategyRow(row: Strategy): Strategy {
  return {
    ...row,
    needs_media: typeof row.needs_media === 'string' ? JSON.parse(row.needs_media) : row.needs_media,
    output_schema: typeof row.output_schema === 'string' ? JSON.parse(row.output_schema) : row.output_schema,
  } as Strategy;
}

export function validateStrategyJson(data: unknown): { valid: boolean; error?: string } {
  if (typeof data !== 'object' || data === null) {
    return { valid: false, error: 'Strategy JSON must be an object' };
  }
  const obj = data as Record<string, unknown>;
  const required = ['id', 'name', 'version', 'target', 'prompt', 'output_schema'];
  for (const key of required) {
    if (obj[key] == null) {
      return { valid: false, error: `Missing required field: ${key}` };
    }
  }
  if (obj.target !== 'post' && obj.target !== 'comment') {
    return { valid: false, error: `Invalid target: ${obj.target}. Must be 'post' or 'comment'` };
  }
  const schema = obj.output_schema as Record<string, unknown>;
  if (typeof schema !== 'object' || schema === null) {
    return { valid: false, error: 'output_schema must be an object' };
  }
  try {
    parseJsonSchemaToColumns(schema);
  } catch (err: unknown) {
    return { valid: false, error: err instanceof Error ? err.message : 'Invalid output_schema' };
  }
  return { valid: true };
}

export function getStrategyResultTableName(strategyId: string): string {
  if (!/^[a-z0-9_-]+$/.test(strategyId)) {
    throw new Error('Strategy ID must only contain a-z, 0-9, _, -');
  }
  return `analysis_results_strategy_${strategyId}`;
}

export interface JsonSchemaColumnDef {
  name: string;
  sqlType: string;
  indexable: boolean;
}

export function parseJsonSchemaToColumns(outputSchema: Record<string, unknown>): JsonSchemaColumnDef[] {
  if (outputSchema.type !== 'object') {
    throw new Error('JSON Schema type must be "object"');
  }
  const properties = outputSchema.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties || typeof properties !== 'object') {
    throw new Error('JSON Schema must have a "properties" object');
  }

  const columns: JsonSchemaColumnDef[] = [];
  for (const [name, def] of Object.entries(properties)) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
      throw new Error(`Invalid property name for SQL column: ${name}`);
    }
    if (Object.keys(def).some(k => ['anyOf', 'oneOf', 'allOf', '$ref'].includes(k))) {
      throw new Error(`Unsupported JSON Schema feature in property ${name}`);
    }
    const sqlType = jsonSchemaTypeToDuckDb(def);
    const indexable = sqlType === 'DOUBLE' || (sqlType === 'TEXT' && Array.isArray(def.enum));
    columns.push({ name, sqlType, indexable });
  }
  return columns;
}

function jsonSchemaTypeToDuckDb(def: Record<string, unknown>): string {
  const type = def.type as string | undefined;
  const items = def.items as Record<string, unknown> | undefined;

  if (type === 'number' || type === 'integer') return 'DOUBLE';
  if (type === 'boolean') return 'BOOLEAN';
  if (type === 'string') return 'TEXT';
  if (type === 'array') {
    if (items && typeof items === 'object') {
      const itemType = items.type as string | undefined;
      if (itemType === 'string') return 'VARCHAR[]';
      if (itemType === 'number' || itemType === 'integer') return 'DOUBLE[]';
      if (itemType === 'boolean') return 'BOOLEAN[]';
    }
    return 'JSON';
  }
  if (type === 'object') return 'JSON';
  throw new Error(`Unsupported JSON Schema type: ${type}`);
}

export async function createStrategyResultTable(
  strategyId: string,
  columnDefs: JsonSchemaColumnDef[],
): Promise<void> {
  const tableName = getStrategyResultTableName(strategyId);
  const dynamicCols = columnDefs.map(c => `  ${c.name} ${c.sqlType}`).join(',\n');
  const sql = `CREATE TABLE IF NOT EXISTS ${tableName} (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    post_id TEXT,
    strategy_version TEXT NOT NULL,
${dynamicCols ? dynamicCols + ',\n' : ''}    raw_response JSON,
    error TEXT,
    analyzed_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(task_id, target_type, target_id)
  )`;
  await run(sql);

  // Auto-indexes
  await run(`CREATE INDEX IF NOT EXISTS idx_${strategyId}_task ON ${tableName}(task_id)`);
  for (const col of columnDefs) {
    if (col.indexable) {
      await run(`CREATE INDEX IF NOT EXISTS idx_${strategyId}_${col.name} ON ${tableName}(${col.name})`);
    }
  }
}

export async function syncStrategyResultTable(
  strategyId: string,
  columnDefs: JsonSchemaColumnDef[],
): Promise<void> {
  const tableName = getStrategyResultTableName(strategyId);
  const existing = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = ?`,
    [tableName]
  );
  const existingNames = new Set(existing.map(c => c.column_name));
  for (const col of columnDefs) {
    if (!existingNames.has(col.name)) {
      await run(`ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.sqlType}`);
      if (col.indexable) {
        await run(`CREATE INDEX IF NOT EXISTS idx_${strategyId}_${col.name} ON ${tableName}(${col.name})`);
      }
    }
  }
}
