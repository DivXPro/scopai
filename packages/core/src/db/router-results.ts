import { query, run } from './client';
import { generateId, now } from '../shared/utils';

export interface RouterResult {
  id: string;
  router_step_id: string;
  strategy_id: string;
  task_id: string;
  post_id: string;
  applicable_strategy_ids: string[];
  skipped_strategies: Array<{ strategy_id: string; reason: string }>;
  checks: Array<{ check_id: string; strategy_id: string; passed: boolean; evidence?: string }>;
  confidence: number;
  tag_match_score: number | null;
  positive_signals_score: number | null;
  negative_signals_score: number | null;
  match_reason: string | null;
  positive_evidence: string | null;
  negative_evidence: string | null;
  upstream_tags: string | null;
  created_at: Date;
}

export async function createRouterResult(
  result: Omit<RouterResult, 'id' | 'created_at'>,
): Promise<RouterResult> {
  const id = generateId();
  const ts = now();
  await run(
    `INSERT INTO router_results (id, router_step_id, strategy_id, task_id, post_id, applicable_strategy_ids, skipped_strategies, checks, confidence, tag_match_score, positive_signals_score, negative_signals_score, match_reason, positive_evidence, negative_evidence, upstream_tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      result.router_step_id,
      result.strategy_id,
      result.task_id,
      result.post_id,
      JSON.stringify(result.applicable_strategy_ids),
      JSON.stringify(result.skipped_strategies),
      JSON.stringify(result.checks),
      result.confidence,
      result.tag_match_score,
      result.positive_signals_score,
      result.negative_signals_score,
      result.match_reason,
      result.positive_evidence,
      result.negative_evidence,
      result.upstream_tags,
      ts,
    ],
  );
  return { ...result, id, created_at: new Date(ts) };
}

export async function getRouterResultsByTask(taskId: string): Promise<RouterResult[]> {
  const rows = await query<RouterResult>('SELECT * FROM router_results WHERE task_id = ?', [taskId]);
  return rows.map(parseRow);
}

export async function getRouterResultsByStep(stepId: string): Promise<RouterResult[]> {
  const rows = await query<RouterResult>('SELECT * FROM router_results WHERE router_step_id = ?', [stepId]);
  return rows.map(parseRow);
}

export async function hasRouterResultForPost(stepId: string, postId: string): Promise<boolean> {
  const rows = await query<{ count: number }>(
    'SELECT COUNT(*) as count FROM router_results WHERE router_step_id = ? AND post_id = ?',
    [stepId, postId],
  );
  return (rows[0]?.count ?? 0) > 0;
}

export async function getRouterResultByPost(stepId: string, postId: string): Promise<RouterResult | null> {
  const rows = await query<RouterResult>(
    'SELECT * FROM router_results WHERE router_step_id = ? AND post_id = ?',
    [stepId, postId],
  );
  return rows[0] ? parseRow(rows[0]) : null;
}

export async function getRouterResultsByPostId(postId: string): Promise<RouterResult[]> {
  const rows = await query<RouterResult>('SELECT * FROM router_results WHERE post_id = ? ORDER BY created_at DESC', [postId]);
  return rows.map(parseRow);
}

function parseRow(row: RouterResult): RouterResult {
  return {
    ...row,
    applicable_strategy_ids: typeof row.applicable_strategy_ids === 'string'
      ? JSON.parse(row.applicable_strategy_ids)
      : row.applicable_strategy_ids,
    skipped_strategies: typeof row.skipped_strategies === 'string'
      ? JSON.parse(row.skipped_strategies)
      : row.skipped_strategies,
    checks: typeof row.checks === 'string'
      ? JSON.parse(row.checks)
      : row.checks,
    upstream_tags: typeof row.upstream_tags === 'string'
      ? JSON.parse(row.upstream_tags)
      : row.upstream_tags,
  };
}
