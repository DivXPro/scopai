import { query } from './client';
import { getStrategyResultTableName } from './strategies';

const NUMERIC_TYPES = ['DOUBLE', 'FLOAT', 'INTEGER', 'BIGINT', 'HUGEINT', 'SMALLINT', 'TINYINT'] as const;

export interface ColumnMeta {
  [columnName: string]: string;
}

export interface AggregateOptions {
  field?: string;
  fields?: string[];
  aggFn?: 'count' | 'sum' | 'avg' | 'min' | 'max';
  jsonKey?: string;
  having?: string;
  limit?: number;
}

export interface AggregateRow {
  [key: string]: string | number;
}

export async function detectColumnMeta(tableName: string): Promise<ColumnMeta> {
  const rows = await query<{ column_name: string; data_type: string }>(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ? AND column_name NOT IN ('id', 'task_id', 'target_type', 'target_id', 'post_id', 'strategy_version', 'raw_response', 'error', 'analyzed_at')`,
    [tableName],
  );
  const meta: ColumnMeta = {};
  for (const row of rows) {
    meta[row.column_name] = row.data_type;
  }
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

async function resolveAlias(tableName: string, preferred: string, suffix: string): Promise<string> {
  const alias = `${preferred}_${suffix}`;
  const existing = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
    [tableName, alias],
  );
  return existing.length > 0 ? `${alias}_agg` : alias;
}

export async function aggregateScalar(
  tableName: string,
  taskId: string,
  col: string,
  duckDbType: string,
): Promise<Record<string, unknown>> {
  if (NUMERIC_TYPES.includes(duckDbType as typeof NUMERIC_TYPES[number])) {
    const avgAlias = await resolveAlias(tableName, col, 'avg');
    const minAlias = await resolveAlias(tableName, col, 'min');
    const maxAlias = await resolveAlias(tableName, col, 'max');
    const rows = await query<Record<string, unknown>>(
      `SELECT AVG("${col}") as "${avgAlias}", MIN("${col}") as "${minAlias}", MAX("${col}") as "${maxAlias}" FROM "${tableName}" WHERE task_id = ? AND "${col}" IS NOT NULL`,
      [taskId],
    );
    return {
      avg: rows[0]?.[avgAlias] ?? 0,
      min: rows[0]?.[minAlias] ?? 0,
      max: rows[0]?.[maxAlias] ?? 0,
    };
  }
  const valAlias = await resolveAlias(tableName, col, 'val');
  const cntAlias = await resolveAlias(tableName, col, 'count');
  const rows = await query<Record<string, unknown>>(
    `SELECT "${col}" as "${valAlias}", COUNT(*) as "${cntAlias}" FROM "${tableName}" WHERE task_id = ? AND "${col}" IS NOT NULL GROUP BY "${col}" ORDER BY "${cntAlias}" DESC`,
    [taskId],
  );
  const distribution: Record<string, number> = {};
  for (const row of rows) {
    distribution[String(row[valAlias])] = Number(row[cntAlias]);
  }
  return { distribution };
}

export async function aggregateArray(
  tableName: string,
  taskId: string,
  col: string,
  duckDbType: string,
  aggFn: 'count' | 'sum' | 'avg' | 'min' | 'max' = 'count',
  limit = 50,
  having?: string,
): Promise<AggregateRow[]> {
  const valAlias = await resolveAlias(tableName, col, 'val');
  const metricAlias = await resolveAlias(tableName, col, aggFn === 'count' ? 'count' : aggFn);
  const effectiveLimit = limit <= 0 ? 50 : limit;

  let metricExpr: string;
  if (aggFn === 'count') {
    metricExpr = 'COUNT(*)';
  } else if (aggFn === 'sum') {
    metricExpr = `SUM(t."${valAlias}")`;
  } else if (aggFn === 'avg') {
    metricExpr = `AVG(t."${valAlias}")`;
  } else if (aggFn === 'min') {
    metricExpr = `MIN(t."${valAlias}")`;
  } else {
    metricExpr = `MAX(t."${valAlias}")`;
  }

  let sql = `SELECT t."${valAlias}" as "${valAlias}", ${metricExpr} as "${metricAlias}" FROM "${tableName}", LATERAL (SELECT unnest("${col}")) AS t("${valAlias}") WHERE "${tableName}".task_id = ? AND t."${valAlias}" IS NOT NULL AND t."${valAlias}" != '' GROUP BY t."${valAlias}"`;
  if (having) {
    if (!/^[a-zA-Z0-9_\s><=().+-]+$/.test(having)) {
      throw new Error(`Invalid --having value: only letters, numbers, spaces, underscores, and comparison operators allowed`);
    }
    sql += ` HAVING ${having}`;
  }
  sql += ` ORDER BY "${metricAlias}" DESC LIMIT ?`;
  const rows = await query<AggregateRow>(sql, [taskId, effectiveLimit]);
  return rows;
}

export async function aggregateJson(
  tableName: string,
  taskId: string,
  col: string,
  jsonKey: string,
  aggFn: 'count' | 'sum' | 'avg' | 'min' | 'max' = 'count',
  limit = 50,
  having?: string,
): Promise<AggregateRow[]> {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(jsonKey)) {
    throw new Error(`Invalid --json-key '${jsonKey}': must be alphanumeric/underscore`);
  }
  const valAlias = await resolveAlias(tableName, jsonKey, 'val');
  const metricAlias = await resolveAlias(tableName, jsonKey, aggFn === 'count' ? 'count' : aggFn);
  const effectiveLimit = limit <= 0 ? 50 : limit;
  // json_each produces a 'value' column per array element
  const extracted = `json_extract_string(t.value, '$.${jsonKey}')`;

  let metricExpr: string;
  if (aggFn === 'count') {
    metricExpr = 'COUNT(*)';
  } else if (aggFn === 'sum') {
    metricExpr = `SUM(CAST(${extracted} AS DOUBLE))`;
  } else if (aggFn === 'avg') {
    metricExpr = `AVG(CAST(${extracted} AS DOUBLE))`;
  } else if (aggFn === 'min') {
    metricExpr = `MIN(CAST(${extracted} AS DOUBLE))`;
  } else {
    metricExpr = `MAX(CAST(${extracted} AS DOUBLE))`;
  }

  let sql = `SELECT ${extracted} as "${valAlias}", ${metricExpr} as "${metricAlias}" FROM "${tableName}", json_each("${col}") AS t WHERE "${tableName}".task_id = ? AND ${extracted} IS NOT NULL AND ${extracted} != '' GROUP BY 1`;
  if (having) {
    if (!/^[a-zA-Z0-9_\s><=().+-]+$/.test(having)) {
      throw new Error(`Invalid --having value: only letters, numbers, spaces, underscores, and comparison operators allowed`);
    }
    sql += ` HAVING ${having}`;
  }
  sql += ` ORDER BY "${metricAlias}" DESC LIMIT ?`;
  const rows = await query<AggregateRow>(sql, [taskId, effectiveLimit]);
  return rows;
}

export async function runAggregate(
  strategyId: string,
  taskId: string,
  opts: AggregateOptions,
): Promise<AggregateRow[]> {
  const tableName = getStrategyResultTableName(strategyId);
  const meta = await detectColumnMeta(tableName);
  const { field, aggFn = 'count', jsonKey, limit = 50 } = opts;
  if (!field) throw new Error('field is required for single-field aggregation');

  if (!(field in meta)) {
    const available = Object.keys(meta).join(', ');
    throw new Error(`Field '${field}' not found. Available columns: ${available}`);
  }

  const duckDbType = meta[field];

  if (duckDbType === 'JSON' || duckDbType === 'JSON[]') {
    if (!jsonKey) {
      throw new Error(`Field '${field}' is JSON. Use --json-key <key> to specify which key to extract for aggregation.`);
    }
    return aggregateJson(tableName, taskId, field, jsonKey, aggFn, limit, opts.having);
  }

  if (duckDbType === 'VARCHAR[]' || duckDbType === 'DOUBLE[]' || duckDbType === 'BOOLEAN[]') {
    return aggregateArray(tableName, taskId, field, duckDbType, aggFn, limit, opts.having);
  }

  if (NUMERIC_TYPES.includes(duckDbType as typeof NUMERIC_TYPES[number])) {
    const result = await aggregateScalar(tableName, taskId, field, duckDbType);
    return [{
      [`${field}_avg`]: result.avg,
      [`${field}_min`]: result.min,
      [`${field}_max`]: result.max,
    } as AggregateRow];
  }

  const result = await aggregateScalar(tableName, taskId, field, 'VARCHAR');
  return Object.entries(result.distribution as Record<string, number>).map(([val, count]) => ({
    [`${field}_val`]: val,
    [`${field}_count`]: count,
  } as AggregateRow));
}

export interface MultiAggregateOptions {
  fields: string[];
  aggFn?: 'count' | 'sum' | 'avg' | 'min' | 'max';
  jsonKey?: string;
  having?: string;
  limit?: number;
}

export async function runMultiAggregate(
  strategyId: string,
  taskId: string,
  opts: MultiAggregateOptions,
): Promise<AggregateRow[]> {
  const tableName = getStrategyResultTableName(strategyId);
  const meta = await detectColumnMeta(tableName);
  const { fields, aggFn = 'count', jsonKey, having, limit = 50 } = opts;
  const effectiveLimit = limit <= 0 ? 50 : limit;

  // Validate all fields exist
  for (const field of fields) {
    if (!(field in meta)) {
      const available = Object.keys(meta).join(', ');
      throw new Error(`Field '${field}' not found. Available columns: ${available}`);
    }
  }

  // Build SELECT list, FROM clause, GROUP BY list
  const selectParts: string[] = [];
  const groupByParts: string[] = [];
  const whereParts: string[] = [`"${tableName}".task_id = ?`];
  const fromParts: string[] = [`"${tableName}"`];

  for (const field of fields) {
    const duckDbType = meta[field];
    if (duckDbType === 'VARCHAR[]' || duckDbType === 'DOUBLE[]' || duckDbType === 'BOOLEAN[]') {
      // Each array field gets its own LATERAL unnest with unique alias
      selectParts.push(`u_${field}.v AS "${field}"`);
      fromParts.push(`LATERAL (SELECT unnest("${tableName}"."${field}")) AS u_${field}(v)`);
      groupByParts.push(`u_${field}.v`);
      whereParts.push(`u_${field}.v IS NOT NULL AND u_${field}.v != ''`);
    } else if (duckDbType === 'JSON' || duckDbType === 'JSON[]') {
      if (!jsonKey) {
        throw new Error(`Field '${field}' is JSON. Use --json-key <key> to specify which key to extract for aggregation.`);
      }
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(jsonKey)) {
        throw new Error(`Invalid --json-key '${jsonKey}': must be alphanumeric/underscore`);
      }
      selectParts.push(`COALESCE(CAST(json_extract_string(je_${field}.value, '$.${jsonKey}') AS VARCHAR), '') AS "${field}"`);
      fromParts.push(`json_each("${tableName}"."${field}") AS je_${field}`);
      groupByParts.push(`COALESCE(CAST(json_extract_string(je_${field}.value, '$.${jsonKey}') AS VARCHAR), '')`);
      whereParts.push(`json_extract_string(je_${field}.value, '$.${jsonKey}') IS NOT NULL`);
    } else if (NUMERIC_TYPES.includes(duckDbType as typeof NUMERIC_TYPES[number])) {
      selectParts.push(`"${field}"`);
      groupByParts.push(`"${field}"`);
    } else {
      // VARCHAR / TEXT
      selectParts.push(`COALESCE("${field}", '') AS "${field}"`);
      groupByParts.push(`COALESCE("${field}", '')`);
    }
  }

  const metricAlias = aggFn === 'count' ? 'count' : aggFn;
  const metricExpr = aggFn === 'count' ? 'COUNT(*)' : aggFn === 'sum' ? `SUM("${fields[0]}")` : aggFn === 'avg' ? `AVG("${fields[0]}")` : aggFn === 'min' ? `MIN("${fields[0]}")` : `MAX("${fields[0]}")`;

  let sql = `SELECT ${selectParts.join(', ')}, ${metricExpr} AS "${metricAlias}" FROM ${fromParts.join(', ')} WHERE ${whereParts.join(' AND ')} GROUP BY ${groupByParts.join(', ')}`;

  if (having) {
    if (!/^[a-zA-Z0-9_\s><=().+-]+$/.test(having)) {
      throw new Error(`Invalid --having value: only letters, numbers, spaces, underscores, and comparison operators allowed`);
    }
    sql += ` HAVING ${having}`;
  }

  sql += ` ORDER BY "${metricAlias}" DESC LIMIT ?`;

  const rows = await query<AggregateRow>(sql, [taskId, effectiveLimit]);
  return rows;
}

export async function getFullStats(strategyId: string, taskId: string): Promise<Record<string, unknown>> {
  const tableName = getStrategyResultTableName(strategyId);
  const meta = await detectColumnMeta(tableName);

  const total = await query<{ cnt: bigint }>(
    `SELECT COUNT(*) as cnt FROM "${tableName}" WHERE task_id = ?`,
    [taskId],
  );

  const numeric: Record<string, Record<string, number>> = {};
  const text: Record<string, Record<string, number>> = {};
  const array: Record<string, unknown> = {};
  for (const [col, duckDbType] of Object.entries(meta)) {
    if (NUMERIC_TYPES.includes(duckDbType as typeof NUMERIC_TYPES[number])) {
      const result = await aggregateScalar(tableName, taskId, col, duckDbType);
      numeric[col] = { avg: result.avg as number, min: result.min as number, max: result.max as number };
    } else if (duckDbType === 'VARCHAR' || duckDbType === 'TEXT') {
      const result = await aggregateScalar(tableName, taskId, col, 'VARCHAR');
      text[col] = result.distribution as Record<string, number>;
    } else if (duckDbType === 'VARCHAR[]' || duckDbType === 'DOUBLE[]' || duckDbType === 'BOOLEAN[]') {
      const rows = await aggregateArray(tableName, taskId, col, duckDbType, 'count', 50);
      array[col] = { varchar_array: rows };
    } else if (duckDbType === 'JSON' || duckDbType === 'JSON[]') {
      array[col] = { json: { skipped: true, hint: 'Use --json-key with aggregate command' } };
    }
  }

  return { total: Number(total[0]?.cnt ?? 0), numeric, text, array };
}
