import { readLockFile, isApiAlive, type LockFileData } from '@scopai/core';

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function getBaseUrl(lock: LockFileData): string {
  return `http://localhost:${lock.port}`;
}

async function requireLock(): Promise<LockFileData> {
  const lock = readLockFile();
  if (!lock) {
    throw new Error('Daemon is not running. Start it with: scopai daemon start');
  }
  const alive = await isApiAlive(lock.port);
  if (!alive) {
    throw new Error('Daemon is not responding. Try: scopai daemon restart');
  }
  return lock;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  const lock = await requireLock();
  const res = await fetch(`${getBaseUrl(lock)}/api${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new ApiClientError(res.status, (body as Record<string, { message: string }>).error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  const lock = await requireLock();
  const res = await fetch(`${getBaseUrl(lock)}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new ApiClientError(res.status, (errBody as Record<string, { message: string }>).error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function apiDelete<T = unknown>(path: string): Promise<T> {
  const lock = await requireLock();
  const res = await fetch(`${getBaseUrl(lock)}/api${path}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new ApiClientError(res.status, (errBody as Record<string, { message: string }>).error?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
