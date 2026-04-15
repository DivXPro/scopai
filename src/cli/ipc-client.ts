import * as fs from 'fs';
import * as path from 'path';
import { fork } from 'child_process';
import { DAEMON_PID_FILE, IPC_SOCKET_PATH } from '../shared/constants';
import { sendIpcRequest } from '../daemon/ipc-server';

function getDaemonPid(): number | null {
  if (!fs.existsSync(DAEMON_PID_FILE)) return null;
  try {
    const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isDaemonRunning(): boolean {
  const pid = getDaemonPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function startDaemon(): Promise<void> {
  if (isDaemonRunning()) return;
  const daemonPath = path.join(__dirname, '../daemon/index.js');
  const child = fork(daemonPath, [], {
    env: { ...process.env, WORKER_ID: '0' },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  // Poll until daemon writes pid file (up to 8s)
  for (let i = 0; i < 40; i++) {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (isDaemonRunning()) return;
  }
  throw new Error('Failed to start daemon');
}

export async function daemonCall(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (!isDaemonRunning()) {
    await startDaemon();
  }
  return sendIpcRequest(method, params);
}
