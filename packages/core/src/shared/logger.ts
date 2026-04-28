import * as fs from 'fs';
import * as path from 'path';
import { expandPath } from './utils';
import { config } from '../config/index';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function formatTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function getLogDir(): string {
  return expandPath('~/.scopai/logs');
}

export function getLogFilePath(date?: string): string {
  const d = date ?? new Date().toISOString().slice(0, 10);
  return path.join(getLogDir(), `daemon.${d}.log`);
}

class Logger {
  private fileStream: fs.WriteStream | null = null;
  private minLevel: number;
  private useFile: boolean = false;

  constructor() {
    this.minLevel = LEVEL_ORDER[config.logging.level ?? 'info'];
  }

  setLevel(level: LogLevel): void {
    this.minLevel = LEVEL_ORDER[level];
  }

  enableFileOutput(): void {
    if (this.fileStream) return;
    const logDir = getLogDir();
    fs.mkdirSync(logDir, { recursive: true });
    this.fileStream = fs.createWriteStream(getLogFilePath(), { flags: 'a' });
    this.useFile = true;
  }

  close(): void {
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = null;
    }
  }

  private write(level: LogLevel, message: string): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;

    const line = `[${formatTimestamp()}] [${level.toUpperCase()}] ${message}`;

    if (this.useFile && this.fileStream) {
      this.fileStream.write(line + '\n');
    }

    // Always mirror to stderr for error/warn, stdout for info/debug
    // This ensures systemd/docker can still capture logs even in file mode
    if (level === 'error') {
      process.stderr.write(line + '\n');
    } else if (level === 'warn') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  debug(message: string): void {
    this.write('debug', message);
  }

  info(message: string): void {
    this.write('info', message);
  }

  warn(message: string): void {
    this.write('warn', message);
  }

  error(message: string): void {
    this.write('error', message);
  }
}

let globalLogger: Logger | null = null;

export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger();
  }
  return globalLogger;
}

export function initLogger(): Logger {
  globalLogger = new Logger();
  // Auto-enable file output when not in a TTY (background daemon mode)
  if (!process.stdout.isTTY) {
    globalLogger.enableFileOutput();
  }
  return globalLogger;
}
