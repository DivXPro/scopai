import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import { getPlatformAdapter } from '../platforms';

export function generateId(): string {
  return uuidv4();
}

export function now(): Date {
  return new Date();
}

export function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    const home = process.env.HOME ?? '';
    return path.replace(/^~/, home);
  }
  return path;
}

export function formatDate(date: Date): string {
  return date.toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
): Promise<T> {
  return fn().catch(async (err) => {
    if (maxRetries <= 0) throw err;
    await sleep(baseDelayMs);
    return retryWithBackoff(fn, maxRetries - 1, baseDelayMs * 2);
  });
}

export function formatTimestamp(d = new Date()): string {
  return d.toISOString().slice(11, 19); // HH:MM:SS
}

export interface StepProgress {
  stepId: string;
  name: string;
  status: string;
  stats?: { total?: number; done?: number; failed?: number };
}

export async function waitForTaskStep(
  taskId: string,
  stepId: string,
  pollFn: (taskId: string) => Promise<Record<string, any>>,
  onProgress: (progress: StepProgress) => void,
  pollMs = 2000,
  timeoutMs = 30 * 60 * 1000,
): Promise<StepProgress> {
  const start = Date.now();
  let lastPrinted: string | null = null;

  while (true) {
    const status = await pollFn(taskId);
    const steps = status.phases?.steps ?? [];
    const step = steps.find((s: any) => s.stepId === stepId || s.id === stepId);

    if (!step) {
      throw new Error(`Step ${stepId} not found in task show`);
    }

    const progress: StepProgress = {
      stepId,
      name: step.name ?? 'Unknown',
      status: step.status,
      stats: step.stats,
    };

    const sig = `${progress.status}|${progress.stats?.done ?? 0}|${progress.stats?.failed ?? 0}`;
    if (sig !== lastPrinted) {
      onProgress(progress);
      lastPrinted = sig;
    }

    if (['completed', 'failed', 'skipped'].includes(progress.status)) {
      return progress;
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for step ${stepId} after ${timeoutMs}ms`);
    }

    await sleep(pollMs);
  }
}

export async function waitForTaskSteps(
  taskId: string,
  pollFn: (taskId: string) => Promise<Record<string, any>>,
  onProgress: (completed: number, total: number, running: string) => void,
  pollMs = 2000,
  timeoutMs = 30 * 60 * 1000,
): Promise<{ completed: number; failed: number; skipped: number; total: number }> {
  const start = Date.now();
  let lastPrinted = '';

  while (true) {
    const status = await pollFn(taskId);
    const steps = status.phases?.steps ?? [];
    const completed = steps.filter((s: any) => s.status === 'completed').length;
    const failed = steps.filter((s: any) => s.status === 'failed').length;
    const skipped = steps.filter((s: any) => s.status === 'skipped').length;
    const running = steps.find((s: any) => s.status === 'running');

    const sig = `${completed}|${failed}|${skipped}|${running?.name ?? ''}`;
    if (sig !== lastPrinted) {
      onProgress(completed, steps.length, running?.name ?? '');
      lastPrinted = sig;
    }

    if (completed + failed + skipped >= steps.length && steps.length > 0) {
      return { completed, failed, skipped, total: steps.length };
    }

    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for all steps after ${timeoutMs}ms`);
    }

    await sleep(pollMs);
  }
}

export function parseChineseNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const cleaned = value.replace(/[,+\s]/g, '');

  const matchWan = cleaned.match(/^([\d.]+)万$/);
  if (matchWan) {
    const num = parseFloat(matchWan[1]);
    return Number.isFinite(num) ? Math.round(num * 10000) : null;
  }

  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : null;
}

export function parseImportFile(filePath: string): unknown[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = filePath.toLowerCase();

  if (ext.endsWith('.jsonl')) {
    return content
      .split('\n')
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0)
      .map((l: string) => JSON.parse(l));
  }

  if (ext.endsWith('.json')) {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      throw new Error('Invalid JSON array file: expected an array');
    }
    return parsed;
  }

  throw new Error(`Unsupported file format: ${filePath}. Use .json or .jsonl`);
}

// ── Post / Comment field normalization ──────────────────────────────────────

export const POST_FIELD_MAP: Record<string, string> = {
  likes: 'like_count',
  collects: 'collect_count',
  comments: 'comment_count',
  shares: 'share_count',
  plays: 'play_count',
  note_id: 'platform_post_id',
  author: 'author_name',
  user_id: 'author_id',
  cover: 'cover_url',
  cover_image: 'cover_url',
};

const COMMENT_FIELD_MAP: Record<string, string> = {
  likes: 'like_count',
  author: 'author_name',
};

function normalizeRawItem(
  raw: unknown,
  fieldMap: Record<string, string>,
): Record<string, unknown> {
  // Field-value array: [{ field: 'likes', value: '1.5万' }, ...]
  if (
    Array.isArray(raw) &&
    raw.length > 0 &&
    raw.every(
      (i) =>
        typeof i === 'object' &&
        i !== null &&
        'field' in i &&
        'value' in i,
    )
  ) {
    const obj: Record<string, unknown> = {};
    for (const entry of raw) {
      const rawField = (entry as Record<string, unknown>).field as string;
      const mappedField = fieldMap[rawField] ?? rawField;
      obj[mappedField] = (entry as Record<string, unknown>).value;
    }
    return obj;
  }

  // Plain object
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj: Record<string, unknown> = {};
    for (const key of Object.keys(raw)) {
      const mapped = fieldMap[key] ?? key;
      if (obj[mapped] === undefined) {
        obj[mapped] = (raw as Record<string, unknown>)[key];
      }
    }
    return obj;
  }

  return {};
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null) return String(v);
  }
  return null;
}

function pickNumber(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (v === undefined || v === null) return 0;
  const parsed = parseChineseNumber(v);
  return parsed ?? 0;
}

export interface NormalizedPostItem {
  platform_post_id: string | null;
  title: string | null;
  content: string;
  author_id: string | null;
  author_name: string | null;
  author_url: string | null;
  url: string | null;
  cover_url: string | null;
  post_type: string | null;
  like_count: number;
  collect_count: number;
  comment_count: number;
  share_count: number;
  play_count: number;
  score: number | null;
  tags: unknown;
  media_files: unknown;
  published_at: Date | null;
  metadata: Record<string, unknown> | null;
}

export function normalizePostItem(raw: unknown, platformId?: string): NormalizedPostItem {
  let mergedFieldMap = POST_FIELD_MAP;
  if (platformId) {
    const adapter = getPlatformAdapter(platformId);
    if (adapter) {
      mergedFieldMap = { ...POST_FIELD_MAP, ...adapter.fieldMap };
    }
  }

  const obj = normalizeRawItem(raw, mergedFieldMap);

  return {
    platform_post_id:
      pickString(obj, ['platform_post_id', 'noteId', 'id', 'aweme_id']) ?? null,
    title: pickString(obj, ['title']),
    content: pickString(obj, ['content', 'text', 'desc']) ?? '',
    author_id: pickString(obj, ['author_id', 'user_id']),
    author_name: pickString(obj, ['author_name', 'author']),
    author_url: pickString(obj, ['author_url']),
    url: pickString(obj, ['url']),
    cover_url: pickString(obj, ['cover_url', 'cover', 'cover_image']),
    post_type: pickString(obj, ['post_type', 'type']),
    like_count: pickNumber(obj, 'like_count'),
    collect_count: pickNumber(obj, 'collect_count'),
    comment_count: pickNumber(obj, 'comment_count'),
    share_count: pickNumber(obj, 'share_count'),
    play_count: pickNumber(obj, 'play_count'),
    score: obj.score !== undefined && obj.score !== null ? Number(obj.score) : null,
    tags: obj.tags ?? null,
    media_files: obj.media_files ?? null,
    published_at: obj.published_at ? new Date(obj.published_at as string) : null,
    metadata: (obj.metadata as Record<string, unknown> | null) ?? null,
  };
}

export interface NormalizedCommentItem {
  platform_comment_id: string | null;
  parent_comment_id: string | null;
  root_comment_id: string | null;
  depth: number;
  author_id: string | null;
  author_name: string | null;
  content: string;
  like_count: number;
  reply_count: number;
  published_at: Date | null;
  metadata: Record<string, unknown> | null;
}

export function normalizeCommentItem(raw: unknown): NormalizedCommentItem {
  const obj = normalizeRawItem(raw, COMMENT_FIELD_MAP);

  return {
    platform_comment_id: pickString(obj, ['platform_comment_id', 'id']),
    parent_comment_id: pickString(obj, ['parent_comment_id']),
    root_comment_id: pickString(obj, ['root_comment_id']),
    depth: Number(obj.depth ?? 0),
    author_id: pickString(obj, ['author_id']),
    author_name: pickString(obj, ['author_name', 'author']),
    content: pickString(obj, ['content', 'text']) ?? '',
    like_count: pickNumber(obj, 'like_count'),
    reply_count: pickNumber(obj, 'reply_count'),
    published_at: obj.published_at ? new Date(obj.published_at as string) : null,
    metadata: (obj.metadata as Record<string, unknown> | null) ?? null,
  };
}
