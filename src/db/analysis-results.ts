import { query, run } from './client';
import { AnalysisResult, UnifiedAnalysisResult } from '../shared/types';
import { generateId } from '../shared/utils';
import { getStrategyResultTableName } from './strategies';

export async function insertStrategyResult(
  strategyId: string,
  result: Omit<AnalysisResult, 'id' | 'strategy_id'>,
  dynamicColumns: string[],
  dynamicValues: unknown[],
): Promise<void> {
  const tableName = getStrategyResultTableName(strategyId);
  const id = generateId();
  const columns = [
    'id',
    'task_id',
    'target_type',
    'target_id',
    'post_id',
    'strategy_version',
    ...dynamicColumns,
    'raw_response',
    'error',
    'analyzed_at',
  ];
  const placeholders = columns.map(() => '?').join(',');
  const values = [
    id,
    result.task_id,
    result.target_type,
    result.target_id,
    result.post_id ?? null,
    result.strategy_version,
    ...dynamicValues,
    result.raw_response ? JSON.stringify(result.raw_response) : null,
    result.error,
    result.analyzed_at,
  ];
  await run(
    `INSERT INTO "${tableName}" (${columns.join(',')}) VALUES (${placeholders})`,
    values,
  );
}

export async function listStrategyResultsByTask(
  strategyId: string,
  taskId: string,
  limit = 100,
): Promise<AnalysisResult[]> {
  const tableName = getStrategyResultTableName(strategyId);
  return query<AnalysisResult>(
    `SELECT * FROM "${tableName}" WHERE task_id = ? ORDER BY analyzed_at DESC LIMIT ?`,
    [taskId, limit],
  );
}

export async function getStrategyResultStats(
  strategyId: string,
  taskId: string,
): Promise<Record<string, unknown>> {
  const tableName = getStrategyResultTableName(strategyId);
  const total = await query<{ cnt: bigint }>(
    `SELECT COUNT(*) as cnt FROM "${tableName}" WHERE task_id = ?`,
    [taskId],
  );

  // Query numeric aggregations
  const numericCols = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = ? AND data_type = 'DOUBLE'`,
    [tableName],
  );
  const numericStats: Record<string, Record<string, number>> = {};
  for (const col of numericCols) {
    const rows = await query<{ avg: number | null; min: number | null; max: number | null }>(
      `SELECT AVG(${col.column_name}) as avg, MIN(${col.column_name}) as min, MAX(${col.column_name}) as max FROM "${tableName}" WHERE task_id = ?`,
      [taskId],
    );
    numericStats[col.column_name] = {
      avg: rows[0]?.avg ?? 0,
      min: rows[0]?.min ?? 0,
      max: rows[0]?.max ?? 0,
    };
  }

  // Query enum/text distributions
  const textCols = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = ? AND data_type = 'VARCHAR'`,
    [tableName],
  );
  const textStats: Record<string, Record<string, number>> = {};
  for (const col of textCols) {
    const rows = await query<{ val: string; cnt: bigint }>(
      `SELECT ${col.column_name} as val, COUNT(*) as cnt FROM "${tableName}" WHERE task_id = ? AND ${col.column_name} IS NOT NULL GROUP BY ${col.column_name}`,
      [taskId],
    );
    textStats[col.column_name] = rows.reduce((acc, r) => {
      acc[r.val] = Number(r.cnt);
      return acc;
    }, {} as Record<string, number>);
  }

  return {
    total: Number(total[0]?.cnt ?? 0),
    numeric: numericStats,
    text: textStats,
  };
}

export async function getExistingResultIds(
  strategyId: string,
  taskId: string,
  targetType: string,
  targetIds: string[],
): Promise<string[]> {
  if (targetIds.length === 0) return [];
  const tableName = getStrategyResultTableName(strategyId);
  const placeholders = targetIds.map(() => '?').join(',');
  const rows = await query<{ target_id: string }>(
    `SELECT target_id FROM "${tableName}" WHERE task_id = ? AND target_type = ? AND target_id IN (${placeholders})`,
    [taskId, targetType, ...targetIds],
  );
  return rows.map(r => r.target_id);
}

export async function getUpstreamResult(
  strategyId: string,
  taskId: string,
  targetId: string,
): Promise<Record<string, unknown> | null> {
  const tableName = getStrategyResultTableName(strategyId);
  const rows = await query<{ raw_response: string | null }>(
    `SELECT raw_response FROM "${tableName}" WHERE task_id = ? AND target_id = ? LIMIT 1`,
    [taskId, targetId],
  );
  if (rows.length === 0 || !rows[0].raw_response) return null;
  try {
    return typeof rows[0].raw_response === 'string'
      ? JSON.parse(rows[0].raw_response)
      : (rows[0].raw_response as unknown as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function listAnalysisResults(taskId: string): Promise<UnifiedAnalysisResult[]> {
  const commentRows = await query<UnifiedAnalysisResult>(
    `SELECT * FROM analysis_results_comments WHERE task_id = ? ORDER BY analyzed_at DESC`,
    [taskId],
  );
  const mediaRows = await query<UnifiedAnalysisResult>(
    `SELECT * FROM analysis_results_media WHERE task_id = ? ORDER BY analyzed_at DESC`,
    [taskId],
  );
  return [
    ...commentRows.map(r => ({ ...r, target_type: 'comment' })),
    ...mediaRows.map(r => ({ ...r, target_type: 'media' })),
  ] as UnifiedAnalysisResult[];
}
