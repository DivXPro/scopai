import { fork, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { DAEMON_PID_FILE, DEFAULT_WORKERS } from '../shared/constants';
import { config } from '../config';

export class WorkerPool {
  private workers: ChildProcess[] = [];
  private concurrency: number;

  constructor(concurrency?: number) {
    this.concurrency = concurrency ?? config.worker.concurrency ?? DEFAULT_WORKERS;
  }

  start(): void {
    for (let i = 0; i < this.concurrency; i++) {
      const worker = fork(path.join(__dirname, '../worker/index.js'));
      worker.on('error', () => {});
      this.workers.push(worker);
    }
  }

  stop(): void {
    for (const worker of this.workers) {
      worker.kill();
    }
    this.workers = [];
  }

  size(): number {
    return this.workers.length;
  }
}

export function writePid(): void {
  fs.writeFileSync(DAEMON_PID_FILE, String(process.pid));
}

export function readPid(): number | null {
  if (!fs.existsSync(DAEMON_PID_FILE)) return null;
  const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim(), 10);
  return isNaN(pid) ? null : pid;
}

export function removePid(): void {
  if (fs.existsSync(DAEMON_PID_FILE)) {
    fs.unlinkSync(DAEMON_PID_FILE);
  }
}
