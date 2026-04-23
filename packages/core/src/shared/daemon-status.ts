import { readLockFile, isApiAlive, removeLockFile } from './lock-file';

export interface DaemonStatus {
  running: boolean;
  port?: number;
  pid?: number;
  startedAt?: string;
}

export async function getDaemonStatus(): Promise<DaemonStatus> {
  const lock = readLockFile();
  if (!lock) return { running: false };

  const alive = await isApiAlive(lock.port);
  if (!alive) {
    removeLockFile();
    return { running: false };
  }

  return {
    running: true,
    port: lock.port,
    pid: lock.pid,
    startedAt: lock.startedAt,
  };
}
