import { IpcServer } from './ipc-server';
import { getHandlers } from './handlers';
import { runConsumer } from '../worker/consumer';
import { runMigrations } from '../db/migrate';
import { seedAll } from '../db/seed';
import { close, query, checkpoint } from '../db/client';
import { recoverStalledJobs } from '../db/queue-jobs';
import { IPC_SOCKET_PATH, DEFAULT_WORKERS } from '../shared/constants';
import { getTotalActiveJobs, requestShutdown, resetShutdown } from '../shared/shutdown';
import { sleep } from '../shared/utils';
import { config } from '../config';
import * as fs from 'fs';

const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30000;
const GRACEFUL_SHUTDOWN_POLL_MS = 500;

export class Daemon {
  private ipcServer: IpcServer;

  constructor() {
    const handlers = getHandlers();
    this.ipcServer = new IpcServer(async (method, params) => {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unknown method: ${method}`);
      return handler(params);
    });
  }

  async start(): Promise<void> {
    resetShutdown();
    await runMigrations();

    try {
      await query('SELECT 1');
    } catch (err: unknown) {
      console.error('[Daemon] Database health check failed:', err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    await seedAll();

    const recovered = await recoverStalledJobs();
    if (recovered.recovered > 0 || recovered.failed > 0) {
      console.log(`[Daemon] Recovered ${recovered.recovered} stalled jobs, ${recovered.failed} exceeded max attempts`);
    }

    await this.ipcServer.start();

    const concurrency = config.worker.concurrency ?? DEFAULT_WORKERS;
    for (let i = 0; i < concurrency; i++) {
      runConsumer(i).catch((err) => {
        console.error(`[Worker-${i}] Fatal error:`, err);
      });
    }

    writePid();
    console.log('[Daemon] Started on', IPC_SOCKET_PATH);
  }

  async stop(): Promise<void> {
    console.log('[Daemon] Shutting down gracefully...');
    this.ipcServer.stop();

    requestShutdown();

    const start = Date.now();
    while (Date.now() - start < GRACEFUL_SHUTDOWN_TIMEOUT_MS) {
      const active = getTotalActiveJobs();
      if (active === 0) {
        console.log('[Daemon] All workers idle');
        break;
      }
      console.log(`[Daemon] Waiting for ${active} active job(s)...`);
      await sleep(GRACEFUL_SHUTDOWN_POLL_MS);
    }

    const remaining = getTotalActiveJobs();
    if (remaining > 0) {
      console.warn(`[Daemon] Timeout: ${remaining} job(s) still active, forcing exit`);
    }

    try {
      await checkpoint();
    } catch (err: unknown) {
      console.error('[Daemon] CHECKPOINT failed:', err instanceof Error ? err.message : String(err));
    }
    close();
    removePid();
    console.log('[Daemon] Stopped');
  }
}

function writePid(): void {
  const { DAEMON_PID_FILE } = require('../shared/constants');
  fs.writeFileSync(DAEMON_PID_FILE, String(process.pid));
}

function readPid(): number | null {
  const { DAEMON_PID_FILE } = require('../shared/constants');
  if (!fs.existsSync(DAEMON_PID_FILE)) return null;
  const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim(), 10);
  return isNaN(pid) ? null : pid;
}

function removePid(): void {
  const { DAEMON_PID_FILE } = require('../shared/constants');
  if (fs.existsSync(DAEMON_PID_FILE)) {
    fs.unlinkSync(DAEMON_PID_FILE);
  }
}

if (require.main === module) {
  const daemon = new Daemon();
  daemon.start().catch(console.error);
  process.on('SIGINT', async () => {
    await daemon.stop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await daemon.stop();
    process.exit(0);
  });
}
