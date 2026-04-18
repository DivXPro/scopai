import * as fs from 'fs';
import { DAEMON_PID_FILE, IPC_SOCKET_PATH } from './constants';

export function getDaemonPid(): number | null {
  if (!fs.existsSync(DAEMON_PID_FILE)) return null;
  try {
    const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function cleanupStaleDaemonFiles(): void {
  if (fs.existsSync(DAEMON_PID_FILE)) {
    try { fs.unlinkSync(DAEMON_PID_FILE); } catch {}
  }
  if (fs.existsSync(IPC_SOCKET_PATH)) {
    try { fs.unlinkSync(IPC_SOCKET_PATH); } catch {}
  }
}

export function isDaemonRunning(): boolean {
  const pid = getDaemonPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    // Process is dead but PID file remains — clean it up
    cleanupStaleDaemonFiles();
    return false;
  }
}
