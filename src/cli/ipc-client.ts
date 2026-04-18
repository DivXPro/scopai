import * as path from 'path';
import { fork } from 'child_process';
import { sendIpcRequest } from '../daemon/ipc-server';
import { isDaemonRunning, cleanupStaleDaemonFiles } from '../shared/daemon-status';

async function startDaemon(): Promise<void> {
  if (isDaemonRunning()) return;
  cleanupStaleDaemonFiles();
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
