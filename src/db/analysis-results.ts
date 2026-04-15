import { query, run } from './client';
import { AnalysisResultComment, AnalysisResultMedia, AnalysisResult } from '../shared/types';
import { generateId, now } from '../shared/utils';

export async function createAnalysisResultComment(result: Omit<AnalysisResultComment, 'id'>): Promise<void> {
  const id = generateId();
  await run(
    `INSERT INTO analysis_results_comments (id, task_id, comment_id, sentiment_label, sentiment_score, intent, risk_flagged, risk_level, risk_reason, topics, emotion_tags, keywords, summary, raw_response, error, analyzed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, result.task_id, result.comment_id, result.sentiment_label, result.sentiment_score,
     result.intent, result.risk_flagged, result.risk_level, result.risk_reason,
     result.topics ? JSON.stringify(result.topics) : null,
     result.emotion_tags ? JSON.stringify(result.emotion_tags) : null,
     result.keywords ? JSON.stringify(result.keywords) : null,
     result.summary, result.raw_response ? JSON.stringify(result.raw_response) : null,
     result.error, result.analyzed_at]
  );
}

export async function createAnalysisResultMedia(result: Omit<AnalysisResultMedia, 'id'>): Promise<void> {
  const id = generateId();
  await run(
    `INSERT INTO analysis_results_media (id, task_id, media_id, media_type, content_type, description, ocr_text, sentiment_label, sentiment_score, risk_flagged, risk_level, risk_reason, objects, logos, faces, raw_response, error, analyzed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, result.task_id, result.media_id, result.media_type, result.content_type, result.description,
     result.ocr_text, result.sentiment_label, result.sentiment_score,
     result.risk_flagged, result.risk_level, result.risk_reason,
     result.objects ? JSON.stringify(result.objects) : null,
     result.logos ? JSON.stringify(result.logos) : null,
     result.faces ? JSON.stringify(result.faces) : null,
     result.raw_response ? JSON.stringify(result.raw_response) : null,
     result.error, result.analyzed_at]
  );
}

export async function listResultsByTask(taskId: string, targetType: 'comment' | 'media', limit = 100): Promise<unknown[]> {
  if (targetType === 'comment') {
    return query<AnalysisResultComment>(
      'SELECT * FROM analysis_results_comments WHERE task_id = ? ORDER BY analyzed_at DESC LIMIT ?',
      [taskId, limit]
    );
  } else {
    return query<AnalysisResultMedia>(
      'SELECT * FROM analysis_results_media WHERE task_id = ? ORDER BY analyzed_at DESC LIMIT ?',
      [taskId, limit]
    );
  }
}

export async function getResultById(id: string, targetType: 'comment' | 'media'): Promise<unknown | null> {
  if (targetType === 'comment') {
    const rows = await query<AnalysisResultComment>('SELECT * FROM analysis_results_comments WHERE id = ?', [id]);
    return rows[0] ?? null;
  } else {
    const rows = await query<AnalysisResultMedia>('SELECT * FROM analysis_results_media WHERE id = ?', [id]);
    return rows[0] ?? null;
  }
}

export async function aggregateStats(taskId: string): Promise<Record<string, unknown>> {
  const sentimentStats = await query<{ sentiment_label: string; cnt: bigint }>(
    'SELECT sentiment_label, COUNT(*) as cnt FROM analysis_results_comments WHERE task_id = ? GROUP BY sentiment_label',
    [taskId]
  );
  const intentStats = await query<{ intent: string; cnt: bigint }>(
    'SELECT intent, COUNT(*) as cnt FROM analysis_results_comments WHERE task_id = ? GROUP BY intent',
    [taskId]
  );
  const riskStats = await query<{ cnt: bigint }>(
    'SELECT COUNT(*) as cnt FROM analysis_results_comments WHERE task_id = ? AND risk_flagged = true',
    [taskId]
  );
  const total = await query<{ cnt: bigint }>(
    'SELECT COUNT(*) as cnt FROM analysis_results_comments WHERE task_id = ?',
    [taskId]
  );
  return {
    total: Number(total[0]?.cnt ?? 0),
    sentiment: sentimentStats.reduce<Record<string, number>>((acc, r) => {
      if (r.sentiment_label) acc[r.sentiment_label] = Number(r.cnt);
      return acc;
    }, {}),
    intent: intentStats.reduce<Record<string, number>>((acc, r) => {
      if (r.intent) acc[r.intent] = Number(r.cnt);
      return acc;
    }, {}),
    risk_flagged: Number(riskStats[0]?.cnt ?? 0),
  };
}

export async function createAnalysisResult(result: Omit<AnalysisResult, 'id'>): Promise<void> {
  const id = generateId();
  await run(
    `INSERT INTO analysis_results (id, task_id, strategy_id, strategy_version, target_type, target_id, post_id, columns, json_fields, raw_response, error, analyzed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, result.task_id, result.strategy_id, result.strategy_version, result.target_type,
      result.target_id, result.post_id ?? null,
      JSON.stringify(result.columns),
      JSON.stringify(result.json_fields),
      result.raw_response ? JSON.stringify(result.raw_response) : null,
      result.error, result.analyzed_at,
    ]
  );
}

export async function listAnalysisResultsByTask(taskId: string, limit = 100): Promise<AnalysisResult[]> {
  const rows = await query<AnalysisResult>(
    'SELECT * FROM analysis_results WHERE task_id = ? ORDER BY analyzed_at DESC LIMIT ?',
    [taskId, limit]
  );
  return rows.map(parseAnalysisResultRow);
}

function parseAnalysisResultRow(row: AnalysisResult): AnalysisResult {
  return {
    ...row,
    columns: typeof row.columns === 'string' ? JSON.parse(row.columns) : row.columns,
    json_fields: typeof row.json_fields === 'string' ? JSON.parse(row.json_fields) : row.json_fields,
    raw_response: typeof row.raw_response === 'string' ? JSON.parse(row.raw_response) : row.raw_response,
  } as AnalysisResult;
}

export async function getExistingResultIds(taskId: string, strategyId: string, targetType: string, targetIds: string[]): Promise<string[]> {
  if (targetIds.length === 0) return [];
  const placeholders = targetIds.map(() => '?').join(',');
  const rows = await query<{ target_id: string }>(
    `SELECT target_id FROM analysis_results WHERE task_id = ? AND strategy_id = ? AND target_type = ? AND target_id IN (${placeholders})`,
    [taskId, strategyId, targetType, ...targetIds]
  );
  return rows.map(r => r.target_id);
}
