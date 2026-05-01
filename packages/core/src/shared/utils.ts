import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';

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
