import { IpcServer } from './ipc-server';
import { getHandlers } from './handlers';
import Bree from 'bree';
import { BreeDuckDBAdapter } from './bree-adapter';
import { WorkerPool } from './worker-pool';
import { runMigrations } from '../db/migrate';
import { seedAll } from '../db/seed';
import { close } from '../db/client';
import { writePid, removePid } from './worker-pool';
import { IPC_SOCKET_PATH } from '../shared/constants';

export class Daemon {
  private ipcServer: IpcServer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private bree: any;
  private workerPool: WorkerPool;

  constructor() {
    const adapter = new BreeDuckDBAdapter();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.bree = new (Bree as any)({
      jobs: [],
    });
    this.workerPool = new WorkerPool();
    const handlers = getHandlers();
    this.ipcServer = new IpcServer(async (method, params) => {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unknown method: ${method}`);
      return handler(params);
    });
  }

  async start(): Promise<void> {
    await runMigrations();
    await seedAll();
    await this.ipcServer.start();
    this.workerPool.start();
    writePid();
    console.log('[Daemon] Started on', IPC_SOCKET_PATH);
  }

  stop(): void {
    this.ipcServer.stop();
    this.workerPool.stop();
    this.bree.stop();
    close();
    removePid();
    console.log('[Daemon] Stopped');
  }
}

if (require.main === module) {
  const daemon = new Daemon();
  daemon.start().catch(console.error);
  process.on('SIGINT', () => daemon.stop());
  process.on('SIGTERM', () => daemon.stop());
}
