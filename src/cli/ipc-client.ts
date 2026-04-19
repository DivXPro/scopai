import * as path from 'path';
import { spawn } from 'child_process';
import { sendIpcRequest } from '../daemon/ipc-server';
import { isDaemonRunning, cleanupStaleDaemonFiles, getDaemonVersion, getDaemonPid } from '../shared/daemon-status';
import { VERSION } from '../shared/version';

async function startDaemon(): Promise<void> {
  if (isDaemonRunning()) return;
  cleanupStaleDaemonFiles();
  const daemonPath = path.join(__dirname, '../daemon/index.js');
  const child = spawn('node', [daemonPath], {
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

async function ensureDaemonVersion(): Promise<void> {
  if (!isDaemonRunning()) {
    await startDaemon();
    return;
  }
  const daemonVersion = getDaemonVersion();
  if (daemonVersion && daemonVersion !== VERSION) {
    const pid = getDaemonPid();
    if (pid) {
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
    cleanupStaleDaemonFiles();
    // Wait briefly for old daemon to exit
    await new Promise(resolve => setTimeout(resolve, 500));
    await startDaemon();
  }
}

export async function daemonCall(method: string, params: Record<string, unknown>): Promise<unknown> {
  await ensureDaemonVersion();
  return sendIpcRequest(method, params);
}
