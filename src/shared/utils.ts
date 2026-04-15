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
