import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config/index';
import { expandPath } from '../shared/utils';

export interface LockFileData {
  port: number;
  pid: number;
  startedAt: string;
}

const isDevEnv = process.env.NODE_ENV === 'development' || process.env.SCOPAI_ENV === 'dev';

function getLockFilePath(): string {
  const dataDir = expandPath(config.database.path);
  const lockFileName = isDevEnv ? 'api-dev.lock' : 'api.lock';
  return path.join(path.dirname(dataDir), lockFileName);
}

export function readLockFile(): LockFileData | null {
  const lockPath = getLockFilePath();
  if (!fs.existsSync(lockPath)) return null;
  try {
    const raw = fs.readFileSync(lockPath, 'utf-8');
    return JSON.parse(raw) as LockFileData;
  } catch {
    return null;
  }
}

export function writeLockFile(data: LockFileData): void {
  const lockPath = getLockFilePath();
  fs.writeFileSync(lockPath, JSON.stringify(data, null, 2), 'utf-8');
}

export function removeLockFile(): void {
  const lockPath = getLockFilePath();
  try { fs.unlinkSync(lockPath); } catch {}
}

export async function isApiAlive(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
