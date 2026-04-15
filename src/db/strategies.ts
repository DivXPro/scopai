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
  if (typeof schema !== 'object' || schema === null || !Array.isArray(schema.columns) || !Array.isArray(schema.json_fields)) {
    return { valid: false, error: 'output_schema must have columns and json_fields arrays' };
  }
  return { valid: true };
}
