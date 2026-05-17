import * as fs from 'fs';
import * as path from 'path';
import {
  createStrategy,
  updateStrategy,
  getStrategyById,
  validateStrategyJson,
  parseJsonSchemaToColumns,
  createStrategyResultTable,
  syncStrategyResultTable,
} from '../db/strategies';

function findBuiltInDir(): string | null {
  // Bundled (tsup output): __dirname = packages/core/dist
  const distDir = path.join(__dirname, 'strategies', 'built-in');
  if (fs.existsSync(distDir)) return distDir;

  // Source (strip-types in tests): __dirname = packages/core/src/strategies
  const srcSibling = path.join(__dirname, 'built-in');
  if (fs.existsSync(srcSibling)) return srcSibling;

  return null;
}

export interface SeedBuiltInResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: Array<{ file: string; error: string }>;
}

export async function seedBuiltInStrategies(): Promise<SeedBuiltInResult> {
  const result: SeedBuiltInResult = { imported: 0, updated: 0, skipped: 0, errors: [] };

  const dir = findBuiltInDir();
  if (!dir) {
    return result;
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();

  for (const file of files) {
    const full = path.join(dir, file);
    try {
      const raw = fs.readFileSync(full, 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;

      const validation = validateStrategyJson(data);
      if (!validation.valid) {
        result.errors.push({ file, error: validation.error ?? 'invalid strategy json' });
        continue;
      }

      const id = data.id as string;
      const existing = await getStrategyById(id);
      if (existing && existing.version === data.version) {
        result.skipped++;
        continue;
      }

      const columnDefs = parseJsonSchemaToColumns(data.output_schema as Record<string, unknown>);
      await createStrategyResultTable(id, columnDefs);
      await syncStrategyResultTable(id, columnDefs);

      const strategy = {
        id,
        name: data.name as string,
        description: (data.description ?? null) as string | null,
        version: (data.version ?? '1.0.0') as string,
        target: data.target as 'post' | 'comment',
        needs_media: (data.needs_media ?? { enabled: false }) as any,
        prompt: data.prompt as string,
        output_schema: data.output_schema as any,
        batch_config: (data.batch_config ?? null) as any,
        depends_on: (data.depends_on ?? null) as 'post' | 'comment' | null,
        include_original: (data.include_original ?? false) as boolean,
        is_default: (data.is_default ?? false) as boolean,
        file_path: null,
      };

      if (existing) {
        await updateStrategy(id, strategy);
        result.updated++;
      } else {
        await createStrategy(strategy);
        result.imported++;
      }
    } catch (err) {
      result.errors.push({ file, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
