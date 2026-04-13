import { query, run } from './client';
import { AnalysisResultComment, AnalysisResultMedia } from '../shared/types';
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
