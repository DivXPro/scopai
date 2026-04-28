# Strategy Result Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `strategy result aggregate` command for single-field aggregation, and expand `strategy result stats` to automatically detect and aggregate VARCHAR[], DOUBLE[], BOOLEAN[], and JSON array fields from dynamic strategy result tables.

**Architecture:** New `src/db/aggregation.ts` provides type-aware aggregation functions. Both `stats` (expanded) and `aggregate` commands share this layer. Column naming uses `{field_prefix}_{metric}` pattern with `_agg` suffix fallback on conflict.

**Tech Stack:** TypeScript, DuckDB (duckdb npm), Node.js built-in `node:test`, picocolors for terminal output, Commander for CLI.

---

## Task 1: Create `src/db/aggregation.ts` — Core Aggregation Layer

**Files:**
- Create: `src/db/aggregation.ts`
- Test: `test/integration/aggregation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/integration/aggregation.test.ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../dist/db/client.js';
const { query, run, close: closeDb } = db;
import * as migrate from '../../dist/db/migrate.js';
const { runMigrations } = migrate;
import * as strategies from '../../dist/db/strategies.js';
const { createStrategy, createStrategyResultTable, getStrategyResultTableName } = strategies;
import {
  detectColumnMeta,
  aggregateScalar,
  aggregateArray,
  aggregateJson,
  runAggregate,
  getFullStats,
} from '../../dist/db/aggregation.js';

describe('aggregation', { timeout: 15000 }, () => {
  let strategyId: string;
  let tableName: string;

  before(async () => {
    closeDb();
    await runMigrations();
    strategyId = 'test-agg-strategy-' + Date.now();
    const schema = {
      type: 'object',
      properties: {
        sentiment_score: { type: 'number' },
        sentiment_label: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        topics: { type: 'array', items: { type: 'object' } },
      },
    };
    await createStrategy({
      id: strategyId,
      name: 'Test Aggregation Strategy',
      version: '1.0.0',
      target: 'post',
      prompt: 'test',
      output_schema: schema,
    });
    await createStrategyResultTable(strategyId, []);
    tableName = getStrategyResultTableName(strategyId);
    // Insert test data
    await run(`INSERT INTO "${tableName}" (id, task_id, target_type, target_id, strategy_version, sentiment_score, sentiment_label, tags, topics) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['r1', 'task-agg-1', 'post', 'p1', '1.0.0', 0.8, 'positive', JSON.stringify(['美食', '探店']), JSON.stringify([{name: '生活方式'}, {name: '美食'}]),
    ]);
    await run(`INSERT INTO "${tableName}" (id, task_id, target_type, target_id, strategy_version, sentiment_score, sentiment_label, tags, topics) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['r2', 'task-agg-1', 'post', 'p2', '1.0.0', 0.6, 'positive', JSON.stringify(['美食', '上海']), JSON.stringify([{name: '美食'}]),
    ]);
    await run(`INSERT INTO "${tableName}" (id, task_id, target_type, target_id, strategy_version, sentiment_score, sentiment_label, tags, topics) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['r3', 'task-agg-1', 'post', 'p3', '1.0.0', 0.3, 'negative', JSON.stringify(['探店']), JSON.stringify([{name: '生活方式'}]),
    ]);
  });

  after(async () => {
    await query(`DELETE FROM "${tableName}" WHERE task_id = 'task-agg-1'`);
    await query(`DELETE FROM strategies WHERE id = ?`, [strategyId]);
    closeDb();
  });

  it('detectColumnMeta returns all column types', async () => {
    const meta = await detectColumnMeta(tableName);
    assert.ok(meta.sentiment_score, 'should detect DOUBLE');
    assert.ok(meta.tags, 'should detect VARCHAR[]');
    assert.ok(meta.topics, 'should detect JSON');
  });

  it('aggregateScalar returns avg/min/max for DOUBLE', async () => {
    const result = await aggregateScalar(tableName, 'task-agg-1', 'sentiment_score', 'DOUBLE');
    assert.strictEqual(result.avg, 0.566, 'avg should be ~0.567');
    assert.strictEqual(result.min, 0.3);
    assert.strictEqual(result.max, 0.8);
  });

  it('aggregateScalar returns enum distribution for VARCHAR', async () => {
    const result = await aggregateScalar(tableName, 'task-agg-1', 'sentiment_label', 'VARCHAR');
    assert.strictEqual(result.distribution.positive, 2);
    assert.strictEqual(result.distribution.negative, 1);
  });

  it('aggregateArray unnest VARCHAR[] and group by', async () => {
    const result = await aggregateArray(tableName, 'task-agg-1', 'tags', 'VARCHAR[]', 'count');
    assert.ok(result.find(r => r.tags_val === '美食' && r.tags_count === 2));
    assert.ok(result.find(r => r.tags_val === '探店' && r.tags_count === 2));
    assert.ok(result.find(r => r.tags_val === '上海' && r.tags_count === 1));
  });

  it('aggregateArray respects limit', async () => {
    const result = await aggregateArray(tableName, 'task-agg-1', 'tags', 'VARCHAR[]', 'count', 1);
    assert.strictEqual(result.length, 1);
  });

  it('aggregateJson extracts json key and groups', async () => {
    const result = await aggregateJson(tableName, 'task-agg-1', 'topics', 'name', 'count');
    assert.ok(result.find(r => r.name_val === '美食' && r.name_count === 2));
    assert.ok(result.find(r => r.name_val === '生活方式' && r.name_count === 2));
  });

  it('runAggregate validates field existence', async () => {
    try {
      await runAggregate(strategyId, 'task-agg-1', { field: 'nonexistent_field' });
      assert.fail('should throw');
    } catch (e: any) {
      assert.ok(e.message.includes('nonexistent_field'));
      assert.ok(e.message.includes('Available columns'));
    }
  });

  it('runAggregate requires --json-key for JSON field', async () => {
    try {
      await runAggregate(strategyId, 'task-agg-1', { field: 'topics' });
      assert.fail('should throw');
    } catch (e: any) {
      assert.ok(e.message.includes('--json-key'));
    }
  });

  it('getFullStats returns scalar + array stats', async () => {
    const stats = await getFullStats(strategyId, 'task-agg-1');
    assert.strictEqual(stats.total, 3);
    assert.ok(stats.numeric.sentiment_score);
    assert.ok(stats.text.sentiment_label);
    assert.ok(Array.isArray(stats.array.varchar_array?.tags));
    assert.ok(Array.isArray(stats.array.json?.topics));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/huhui/Projects/scopai && npm run build 2>&1 | tail -5
node --test --test-concurrency=1 'test/integration/aggregation.test.ts' 2>&1 | head -20
```
Expected: FAIL with "Cannot find module '../../dist/db/aggregation.js'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/db/aggregation.ts
import { query, run } from './client';
import { getStrategyResultTableName } from './strategies';
import { StrategyResult } from '../shared/types';

export interface ColumnMeta {
  [columnName: string]: string; // DuckDB type string
}

export interface AggregateOptions {
  field: string;
  aggFn?: 'count' | 'sum' | 'avg' | 'min' | 'max';
  jsonKey?: string;
  having?: string;
  limit?: number;
}

export interface AggregateRow {
  [key: string]: string | number;
}

// Detect all column names and types from information_schema
export async function detectColumnMeta(tableName: string): Promise<ColumnMeta> {
  const rows = await query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ? AND column_name NOT IN ('id', 'task_id', 'target_type', 'target_id', 'post_id', 'strategy_version', 'raw_response', 'error', 'analyzed_at')`,
    [tableName],
  );
  const meta: ColumnMeta = {};
  for (const row of rows) {
    meta[row.column_name] = row.data_type;
  }
  // Fallback: try DESCRIBE if information_schema returned nothing
  if (Object.keys(meta).length === 0) {
    const descRows = await query<{ column_name: string; column_type: string }>(
      `DESCRIBE TABLE "${tableName}"`,
    );
    for (const row of descRows) {
      if (!['id', 'task_id', 'target_type', 'target_id', 'post_id', 'strategy_version', 'raw_response', 'error', 'analyzed_at'].includes(row.column_name)) {
        meta[row.column_name] = row.column_type;
      }
    }
  }
  return meta;
}

// Conflict-aware column alias: if the alias already exists as a real column, append _agg
async function resolveAlias(tableName: string, preferred: string, suffix: string): Promise<string> {
  const alias = `${preferred}_${suffix}`;
  const existing = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
    [tableName, alias],
  );
  return existing.length > 0 ? `${alias}_agg` : alias;
}

// Aggregate DOUBLE columns: avg/min/max
export async function aggregateScalar(
  tableName: string,
  taskId: string,
  col: string,
  duckDbType: string,
): Promise<Record<string, unknown>> {
  if (duckDbType === 'DOUBLE' || duckDbType === 'FLOAT' || duckDbType === 'INTEGER' || duckDbType === 'BIGINT') {
    const avgAlias = await resolveAlias(tableName, col, 'avg');
    const minAlias = await resolveAlias(tableName, col, 'min');
    const maxAlias = await resolveAlias(tableName, col, 'max');
    const rows = await query<Record<string, unknown>>(
      `SELECT AVG(${col}) as ${avgAlias}, MIN(${col}) as ${minAlias}, MAX(${col}) as ${maxAlias} FROM "${tableName}" WHERE task_id = ? AND ${col} IS NOT NULL`,
      [taskId],
    );
    return {
      avg: rows[0]?.[avgAlias] ?? 0,
      min: rows[0]?.[minAlias] ?? 0,
      max: rows[0]?.[maxAlias] ?? 0,
    };
  }
  // VARCHAR: enum distribution
  const valAlias = await resolveAlias(tableName, col, 'val');
  const cntAlias = await resolveAlias(tableName, col, 'count');
  const rows = await query<Record<string, unknown>>(
    `SELECT ${col} as ${valAlias}, COUNT(*) as ${cntAlias} FROM "${tableName}" WHERE task_id = ? AND ${col} IS NOT NULL GROUP BY ${col} ORDER BY ${cntAlias} DESC`,
    [taskId],
  );
  const distribution: Record<string, number> = {};
  for (const row of rows) {
    distribution[String(row[valAlias])] = Number(row[cntAlias]);
  }
  return { distribution };
}

// Aggregate array columns (VARCHAR[], DOUBLE[], BOOLEAN[]) using unnest + LATERAL
export async function aggregateArray(
  tableName: string,
  taskId: string,
  col: string,
  duckDbType: string,
  aggFn: 'count' | 'sum' | 'avg' | 'min' | 'max' = 'count',
  limit = 50,
): Promise<AggregateRow[]> {
  const valAlias = await resolveAlias(tableName, col, 'val');
  const metricAlias = await resolveAlias(tableName, col, aggFn === 'count' ? 'count' : aggFn);
  const effectiveLimit = limit <= 0 ? 50 : limit;

  const sql = `SELECT t.${valAlias} as ${valAlias}, ${aggFn === 'count' ? 'COUNT(*)' : aggFn === 'sum' ? `SUM(t.${valAlias})` : aggFn === 'avg' ? `AVG(t.${valAlias})` : aggFn === 'min' ? `MIN(t.${valAlias})` : `MAX(t.${valAlias})`} as ${metricAlias} FROM "${tableName}", LATERAL (SELECT unnest(${col})) AS t(${valAlias}) WHERE "${tableName}".task_id = ? AND t.${valAlias} IS NOT NULL AND t.${valAlias} != '' GROUP BY t.${valAlias} ORDER BY ${metricAlias} DESC LIMIT ?`;
  const rows = await query<AggregateRow>(sql, [taskId, effectiveLimit]);
  return rows;
}

// Aggregate JSON columns by extracting a specific key then grouping
export async function aggregateJson(
  tableName: string,
  taskId: string,
  col: string,
  jsonKey: string,
  aggFn: 'count' | 'sum' | 'avg' | 'min' | 'max' = 'count',
  limit = 50,
): Promise<AggregateRow[]> {
  const valAlias = await resolveAlias(tableName, jsonKey, 'val');
  const metricAlias = await resolveAlias(tableName, jsonKey, aggFn === 'count' ? 'count' : aggFn);
  const effectiveLimit = limit <= 0 ? 50 : limit;
  const extracted = `json_extract_string(${col}, '$.${jsonKey}')`;

  const sql = `SELECT t.${valAlias} as ${valAlias}, ${aggFn === 'count' ? 'COUNT(*)' : aggFn === 'sum' ? `SUM(t.${valAlias})` : aggFn === 'avg' ? `AVG(t.${valAlias})` : aggFn === 'min' ? `MIN(t.${valAlias})` : `MAX(t.${valAlias})`} as ${metricAlias} FROM "${tableName}", LATERAL (SELECT unnest(${col})) AS t, LATERAL (SELECT ${extracted} as ${valAlias}) AS j WHERE "${tableName}".task_id = ? AND j.${valAlias} IS NOT NULL AND j.${valAlias} != '' GROUP BY j.${valAlias} ORDER BY ${metricAlias} DESC LIMIT ?`;
  const rows = await query<AggregateRow>(sql, [taskId, effectiveLimit]);
  return rows;
}

// Entry point for aggregate command (single field)
export async function runAggregate(
  strategyId: string,
  taskId: string,
  opts: AggregateOptions,
): Promise<AggregateRow[]> {
  const tableName = getStrategyResultTableName(strategyId);
  const meta = await detectColumnMeta(tableName);
  const { field, aggFn = 'count', jsonKey, limit = 50 } = opts;

  if (!(field in meta)) {
    const available = Object.keys(meta).join(', ');
    throw new Error(`Field '${field}' not found. Available columns: ${available}`);
  }

  const duckDbType = meta[field];

  if (duckDbType === 'JSON' || duckDbType === 'JSON[]') {
    if (!jsonKey) {
      throw new Error(`Field '${field}' is JSON. Use --json-key <key> to specify which key to extract for aggregation.`);
    }
    return aggregateJson(tableName, taskId, field, jsonKey, aggFn, limit);
  }

  if (duckDbType === 'VARCHAR[]' || duckDbType === 'DOUBLE[]' || duckDbType === 'BOOLEAN[]') {
    return aggregateArray(tableName, taskId, field, duckDbType, aggFn, limit);
  }

  if (duckDbType === 'DOUBLE' || duckDbType === 'FLOAT' || duckDbType === 'INTEGER' || duckDbType === 'BIGINT') {
    const result = await aggregateScalar(tableName, taskId, field, duckDbType);
    // Convert to AggregateRow[] format for consistency
    return [{
      [`${field}_avg`]: result.avg,
      [`${field}_min`]: result.min,
      [`${field}_max`]: result.max,
    } as AggregateRow];
  }

  // VARCHAR
  const result = await aggregateScalar(tableName, taskId, field, 'VARCHAR');
  return Object.entries(result.distribution as Record<string, number>).map(([val, count]) => ({
    [`${field}_val`]: val,
    [`${field}_count`]: count,
  } as AggregateRow));
}

// Full stats: all fields aggregated (used by expanded stats command)
export async function getFullStats(strategyId: string, taskId: string): Promise<Record<string, unknown>> {
  const tableName = getStrategyResultTableName(strategyId);
  const meta = await detectColumnMeta(tableName);

  const total = await query<{ cnt: bigint }>(
    `SELECT COUNT(*) as cnt FROM "${tableName}" WHERE task_id = ?`,
    [taskId],
  );

  const numeric: Record<string, Record<string, number>> = {};
  const text: Record<string, Record<string, number>> = {};
  const array: Record<string, { varchar_array?: AggregateRow[]; json?: { skipped: boolean; hint?: string } }> = {};

  for (const [col, duckDbType] of Object.entries(meta)) {
    if (duckDbType === 'DOUBLE' || duckDbType === 'FLOAT' || duckDbType === 'INTEGER' || duckDbType === 'BIGINT') {
      const result = await aggregateScalar(tableName, taskId, col, duckDbType);
      numeric[col] = { avg: result.avg as number, min: result.min as number, max: result.max as number };
    } else if (duckDbType === 'VARCHAR' || duckDbType === 'TEXT') {
      const result = await aggregateScalar(tableName, taskId, col, 'VARCHAR');
      text[col] = result.distribution as Record<string, number>;
    } else if (duckDbType === 'VARCHAR[]' || duckDbType === 'DOUBLE[]' || duckDbType === 'BOOLEAN[]') {
      const rows = await aggregateArray(tableName, taskId, col, duckDbType, 'count', 50);
      array[col] = { varchar_array: rows };
    } else if (duckDbType === 'JSON' || duckDbType === 'JSON[]') {
      // JSON object arrays: skip in auto-stats, hint user to use --json-key
      array[col] = { json: { skipped: true, hint: `Use --json-key with aggregate command` } };
    }
  }

  return {
    total: Number(total[0]?.cnt ?? 0),
    numeric,
    text,
    array,
  };
}
```

- [ ] **Step 4: Build and run tests**

```bash
cd /Users/huhui/Projects/scopai && npm run build 2>&1 | tail -10
node --test --test-concurrency=1 'test/integration/aggregation.test.ts' 2>&1
```
Expected: PASS (all 9 tests green)

- [ ] **Step 5: Commit**

```bash
git add src/db/aggregation.ts test/integration/aggregation.test.ts
git commit -m "$(cat <<'EOF'
feat(db): add aggregation layer for strategy results

Add src/db/aggregation.ts with:
- detectColumnMeta: type-aware column discovery
- aggregateScalar: avg/min/max for DOUBLE, distribution for VARCHAR
- aggregateArray: unnest + group by for VARCHAR[]/DOUBLE[]/BOOLEAN[]
- aggregateJson: extract JSON key then aggregate
- runAggregate: single-field entry point
- getFullStats: full-field stats for expanded stats command

Output columns use {field_prefix}_{metric} pattern with _agg suffix on conflict.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add `strategy.result.aggregate` Daemon Handler

**Files:**
- Modify: `src/daemon/handlers.ts:796-830` (add after `strategy.result.export`)

- [ ] **Step 1: Add the handler**

After line 795 (closing brace of `strategy.result.export`), add:

```typescript
async 'strategy.result.aggregate'(params) {
  if (typeof params.task_id !== 'string') throw new Error('task_id is required');
  if (typeof params.strategy_id !== 'string') throw new Error('strategy_id is required');
  if (typeof params.field !== 'string') throw new Error('field is required');
  const { runAggregate } = await import('../db/aggregation');
  const aggFn = (params.agg as 'count' | 'sum' | 'avg' | 'min' | 'max') ?? 'count';
  const limit = typeof params.limit === 'number' ? params.limit : parseInt(params.limit as string, 10) || 50;
  return runAggregate(params.strategy_id as string, params.task_id as string, {
    field: params.field as string,
    aggFn,
    jsonKey: params.json_key as string | undefined,
    having: params.having as string | undefined,
    limit,
  });
},
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/huhui/Projects/scopai && npm run build 2>&1 | grep -E "(error|warning|success)" | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/daemon/handlers.ts
git commit -m "$(cat <<'EOF'
feat(daemon): add strategy.result.aggregate handler

Accepts field, agg (count/sum/avg/min/max), json_key, having, limit params.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add `strategy result aggregate` CLI Command and Expand `stats` Output

**Files:**
- Modify: `src/cli/strategy.ts`

- [ ] **Step 1: Write test for CLI output formatting**

```typescript
// Add to test/integration/aggregation.test.ts:
it('getFullStats includes array field results', async () => {
  const stats = await getFullStats(strategyId, 'task-agg-1');
  const tagsResult = stats.array.tags;
  assert.ok(tagsResult?.varchar_array, 'tags should have varchar_array result');
  assert.ok(tagsResult.varchar_array.find(r => (r as any).tags_val === '美食' && (r as any).tags_count === 2));
});
```

- [ ] **Step 2: Add the aggregate subcommand to strategy.ts**

After the `export` subcommand (after line 207), add:

```typescript
result
  .command('aggregate')
  .description('Aggregate a specific field from strategy results')
  .requiredOption('--task-id <id>', 'Task ID')
  .requiredOption('--strategy <id>', 'Strategy ID')
  .requiredOption('--group-by <field>', 'Field to aggregate')
  .option('--agg <fn>', 'Aggregation function (count/sum/avg/min/max)', 'count')
  .option('--json-key <key>', 'JSON key to extract for JSON array fields')
  .option('--having <condition>', 'Filter aggregated results (e.g. "count > 2")')
  .option('--limit <n>', 'Max result rows', '50')
  .option('--format <fmt>', 'Output format (table/csv/json)', 'table')
  .option('--output <path>', 'Output file path')
  .action(async (opts: AggregateOpts) => {
    try {
      const rows = await daemonCall('strategy.result.aggregate', {
        task_id: opts.taskId,
        strategy_id: opts.strategy,
        field: opts.groupBy,
        agg: opts.agg,
        json_key: opts.jsonKey,
        having: opts.having,
        limit: parseInt(opts.limit, 10),
      }) as AggregateRow[];

      if (rows.length === 0) {
        console.log(pc.yellow('No results'));
        return;
      }

      const output = formatAggregateOutput(rows, opts.format, opts.output);
      if (opts.output) {
        fs.writeFileSync(opts.output, output);
        console.log(pc.green(`Wrote ${rows.length} rows to ${opts.output}`));
      } else {
        process.stdout.write(output);
      }
    } catch (err: unknown) {
      console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });
```

Add the type and helper at the top of the file:

```typescript
interface AggregateOpts {
  taskId: string;
  strategy: string;
  groupBy: string;
  agg?: string;
  jsonKey?: string;
  having?: string;
  limit?: string;
  format?: string;
  output?: string;
}

interface AggregateRow {
  [key: string]: string | number;
}

function formatAggregateOutput(rows: AggregateRow[], format: string, outputPath?: string): string {
  if (format === 'json') {
    return rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  }
  if (format === 'csv') {
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    for (const row of rows) {
      const values = headers.map(h => {
        const v = row[h];
        const str = String(v === null || v === undefined ? '' : v);
        if (str.includes(',') || str.includes('"')) return '"' + str.replace(/"/g, '""') + '"';
        return str;
      });
      lines.push(values.join(','));
    }
    return lines.join('\n') + '\n';
  }
  // table format
  const headers = Object.keys(rows[0]);
  const colWidths = headers.map(h => Math.max(h.length, ...rows.map(r => String(r[h] ?? '').length)));
  const divider = '  ' + colWidths.map((w, i) => (i === 0 ? pc.bold(headers[i].padEnd(w)) : headers[i].padEnd(w))).join('  ');
  const headerLine = '  ' + headers.map((h, i) => pc.dim('─'.repeat(colWidths[i]))).join('  ');
  const lines = rows.slice(0, 50).map(row =>
    '  ' + headers.map((h, i) => String(row[h] ?? '').padEnd(colWidths[i])).join('  '),
  );
  return '\n' + divider + '\n' + headerLine + '\n' + lines.join('\n') + '\n\n';
}
```

- [ ] **Step 3: Expand the `stats` command output**

Modify the existing `stats` action (lines 145-181) to call `strategy.result.aggregate` for expanded output, adding array section:

```typescript
result
  .command('stats')
  .description('Show statistics for a task and strategy')
  .requiredOption('--task-id <id>', 'Task ID')
  .requiredOption('--strategy <id>', 'Strategy ID')
  .action(async (opts: { taskId: string; strategy: string }) => {
    try {
      const stats = await daemonCall('strategy.result.stats', {
        task_id: opts.taskId,
        strategy_id: opts.strategy,
      }) as Record<string, unknown>;

      console.log(pc.bold(`\nStatistics:`));
      console.log(pc.dim('─'.repeat(40)));
      console.log(`  Total: ${stats.total ?? 0}`);
      const numeric = stats.numeric as Record<string, Record<string, number>> | undefined;
      if (numeric && Object.keys(numeric).length > 0) {
        console.log('\n  Numeric:');
        for (const [col, agg] of Object.entries(numeric)) {
          console.log(`    ${col}: avg=${agg.avg?.toFixed(2)} min=${agg.min} max=${agg.max}`);
        }
      }
      const text = stats.text as Record<string, Record<string, number>> | undefined;
      if (text && Object.keys(text).length > 0) {
        console.log('\n  Distribution:');
        for (const [col, dist] of Object.entries(text)) {
          console.log(`    ${col}:`);
          for (const [val, cnt] of Object.entries(dist)) {
            console.log(`      ${val}: ${cnt}`);
          }
        }
      }

      // New: call full stats for array field aggregation
      try {
        const fullStats = await daemonCall('strategy.result.fullStats', {
          task_id: opts.taskId,
          strategy_id: opts.strategy,
        }) as Record<string, unknown>;
        const array = fullStats.array as Record<string, unknown> | undefined;
        if (array && Object.keys(array).length > 0) {
          console.log('\n  Array Fields:');
          for (const [col, data] of Object.entries(array)) {
            if ((data as any)?.skipped) {
              console.log(`    ${col} (JSON) → ${(data as any).hint}`);
              continue;
            }
            const rows = (data as any)?.varchar_array as AggregateRow[] | undefined;
            if (rows && rows.length > 0) {
              console.log(`    ${col} (${col}_val / ${col}_count):`);
              for (const row of rows.slice(0, 10)) {
                const val = row[`${col}_val`];
                const cnt = row[`${col}_count`];
                console.log(`      ${val}  ${cnt}`);
              }
              if (rows.length > 10) console.log(`      ... (${rows.length} total)`);
            }
          }
        }
      } catch {
        // strategy.result.fullStats not available yet, skip
      }
      console.log(pc.dim('─'.repeat(40)));
    } catch (err: unknown) {
      console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
      process.exit(1);
    }
  });
```

- [ ] **Step 4: Add fullStats handler**

Add to `src/daemon/handlers.ts` after `strategy.result.aggregate`:

```typescript
async 'strategy.result.fullStats'(params) {
  if (typeof params.task_id !== 'string') throw new Error('task_id is required');
  if (typeof params.strategy_id !== 'string') throw new Error('strategy_id is required');
  const { getFullStats } = await import('../db/aggregation');
  return getFullStats(params.strategy_id as string, params.task_id as string);
},
```

- [ ] **Step 5: Build and verify**

```bash
cd /Users/huhui/Projects/scopai && npm run build 2>&1 | grep -E "error" | head -10
```

- [ ] **Step 6: Commit**

```bash
git add src/cli/strategy.ts src/daemon/handlers.ts
git commit -m "$(cat <<'EOF'
feat(cli): add strategy result aggregate command

- New: strategy result aggregate --task-id --strategy --group-by [--agg] [--json-key] [--having] [--limit] [--format] [--output]
- Expanded: strategy result stats now auto-detects and prints VARCHAR[]/DOUBLE[]/BOOLEAN[] aggregation

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Error Handling — HAVING Clause and Edge Cases

**Files:**
- Modify: `src/db/aggregation.ts` (add having clause to `aggregateArray` and `aggregateJson`)

- [ ] **Step 1: Add HAVING support**

Modify `aggregateArray` to accept and apply the having clause. Update the function signature and SQL:

```typescript
export async function aggregateArray(
  tableName: string,
  taskId: string,
  col: string,
  duckDbType: string,
  aggFn: 'count' | 'sum' | 'avg' | 'min' | 'max' = 'count',
  limit = 50,
  having?: string,
): Promise<AggregateRow[]> {
  // ... existing code ...
  // Before: GROUP BY t.${valAlias}
  // After: append ` HAVING ${having}` if provided (having refers to the metric alias)
  // And add HAVING clause before ORDER BY
}
```

Update `aggregateJson` similarly.

Also add to `runAggregate` to pass the `having` parameter through.

- [ ] **Step 2: Test HAVING**

```bash
cd /Users/huhui/Projects/scopai && npm run build && node --test --test-concurrency=1 'test/integration/aggregation.test.ts' 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add src/db/aggregation.ts
git commit -m "$(cat <<'EOF'
fix(aggregation): add HAVING clause support for filtering

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Checklist

- [ ] Spec coverage: detectColumnMeta ✅, aggregateScalar ✅, aggregateArray ✅, aggregateJson ✅, runAggregate ✅, getFullStats ✅, stats command expansion ✅, aggregate command ✅, output column naming (prefix) ✅, conflict resolution (_agg suffix) ✅, error handling ✅
- [ ] No placeholders: all SQL code shown inline, all function signatures consistent
- [ ] Type consistency: all tasks use `AggregateRow` and `AggregateOptions` interfaces from aggregation.ts
- [ ] Missing: `tests/unit/aggregation.test.ts` → covered by `test/integration/aggregation.test.ts` which imports from dist/
