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

export interface PostAnalysisResult {
  strategy_id: string;
  strategy_name: string;
  task_id: string;
  target_type: string;
  target_id: string | null;
  raw_response: Record<string, unknown> | null;
  analyzed_at: Date;
}

export async function countPostAnalysisResults(postId: string): Promise<number> {
  const commentIds = await query<{ id: string }>(
    `SELECT id FROM comments WHERE post_id = ?`,
    [postId],
  );
  const commentIdList = commentIds.map(c => c.id);

  let total = 0;

  if (commentIdList.length > 0) {
    const builtinCount = await query<{ cnt: bigint }>(
      `SELECT COUNT(*) as cnt FROM analysis_results_comments WHERE comment_id IN (${commentIdList.map(() => '?').join(',')})`,
      [...commentIdList],
    );
    total += Number(builtinCount[0]?.cnt ?? 0);
  }

  const strategies = await query<{ id: string }>('SELECT id FROM strategies');
  for (const strategy of strategies) {
    try {
      const tableName = getStrategyResultTableName(strategy.id);
      const placeholders = commentIdList.map(() => '?').join(',');
      const whereClause = commentIdList.length > 0
        ? `target_id = ? OR target_id IN (${placeholders})`
        : 'target_id = ?';
      const params = commentIdList.length > 0
        ? [postId, ...commentIdList]
        : [postId];

      const rows = await query<{ cnt: bigint }>(
        `SELECT COUNT(*) as cnt FROM "${tableName}" WHERE ${whereClause}`,
        params,
      );
      total += Number(rows[0]?.cnt ?? 0);
    } catch {
      // Table may not exist, skip
    }
  }

  return total;
}

export async function getPostAnalysisResults(postId: string): Promise<PostAnalysisResult[]> {
  // Get all comment IDs for this post
  const commentIds = await query<{ id: string }>(
    `SELECT id FROM comments WHERE post_id = ?`,
    [postId],
  );
  const commentIdList = commentIds.map(c => c.id);

  // Get all strategies
  const strategies = await query<{ id: string; name: string }>(
    `SELECT id, name FROM strategies`,
  );

  const results: PostAnalysisResult[] = [];

  // Query built-in analysis_results_comments table
  let builtinCommentRows: Array<{
    task_id: string;
    comment_id: string;
    sentiment_label: string | null;
    sentiment_score: number | null;
    intent: string | null;
    risk_flagged: boolean;
    risk_level: string | null;
    topics: string | null;
    keywords: string | null;
    analyzed_at: Date;
  }> = [];
  if (commentIdList.length > 0) {
    builtinCommentRows = await query(
      `SELECT task_id, comment_id, sentiment_label, sentiment_score, intent,
              risk_flagged, risk_level, topics, keywords, analyzed_at
       FROM analysis_results_comments WHERE comment_id IN (${commentIdList.map(() => '?').join(',')})`,
      [...commentIdList],
    );
  }

  for (const row of builtinCommentRows) {
    results.push({
      strategy_id: 'sentiment',
      strategy_name: '情感分析',
      task_id: row.task_id,
      target_type: 'comment',
      target_id: row.comment_id,
      raw_response: {
        sentiment: row.sentiment_label,
        score: row.sentiment_score,
        intent: row.intent,
        risk: row.risk_level,
        risk_flagged: row.risk_flagged,
      },
      analyzed_at: row.analyzed_at,
    });
  }

  // Query each strategy's dynamic result table
  for (const strategy of strategies) {
    try {
      const tableName = getStrategyResultTableName(strategy.id);
      const placeholders = commentIdList.map(() => '?').join(',');
      const whereClause = commentIdList.length > 0
        ? `target_id = ? OR target_id IN (${placeholders})`
        : 'target_id = ?';
      const params = commentIdList.length > 0
        ? [postId, ...commentIdList]
        : [postId];

      const rows = await query<{
        task_id: string;
        target_type: string;
        target_id: string;
        raw_response: string | null;
        analyzed_at: Date;
      }>(
        `SELECT task_id, target_type, target_id, raw_response, analyzed_at
         FROM "${tableName}" WHERE ${whereClause} LIMIT 50`,
        params,
      );

      for (const row of rows) {
        results.push({
          strategy_id: strategy.id,
          strategy_name: strategy.name,
          task_id: row.task_id,
          target_type: row.target_type,
          target_id: row.target_id,
          raw_response: row.raw_response ? JSON.parse(row.raw_response) : null,
          analyzed_at: row.analyzed_at,
        });
      }
    } catch {
      // Table may not exist, skip
    }
  }

  return results.sort((a, b) =>
    new Date(b.analyzed_at).getTime() - new Date(a.analyzed_at).getTime(),
  );
}
