import { Command } from 'commander';
import * as pc from 'picocolors';
import * as fs from 'fs';
import * as path from 'path';
import { getLogFilePath } from '@scopai/core';
import { expandPath } from '@scopai/core';

function getLogDir(): string {
  return expandPath('~/.scopai/logs');
}

function readLastLines(filePath: string, lineCount: number): string[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  return lines.slice(-lineCount);
}

function listLogFiles(): string[] {
  const dir = getLogDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(f => f.startsWith('daemon.') && f.endsWith('.log'))
    .sort();
}

export function logsCommands(program: Command): void {
  const logs = program.command('logs').description('View daemon logs');

  logs
    .command('show')
    .description('Show recent daemon log entries')
    .option('-n, --lines <n>', 'Number of lines to show', '50')
    .option('-d, --date <date>', 'Date to view (YYYY-MM-DD)', new Date().toISOString().slice(0, 10))
    .action((opts: { lines: string; date: string }) => {
      const logPath = getLogFilePath(opts.date);
      const lines = readLastLines(logPath, parseInt(opts.lines, 10));
      if (lines.length === 0) {
        console.log(pc.yellow(`No log entries found for ${opts.date}`));
        console.log(pc.dim(`Searched: ${logPath}`));
        return;
      }
      console.log(pc.bold(`\nLog: ${logPath}`));
      console.log(pc.dim('─'.repeat(80)));
      for (const line of lines) {
        // Colorize based on log level
        if (line.includes('[ERROR]')) {
          console.log(pc.red(line));
        } else if (line.includes('[WARN]')) {
          console.log(pc.yellow(line));
        } else if (line.includes('[DEBUG]')) {
          console.log(pc.dim(line));
        } else {
          console.log(line);
        }
      }
      console.log(pc.dim('─'.repeat(80)));
      console.log(`Total: ${lines.length} lines\n`);
    });

  logs
    .command('tail')
    .description('Tail daemon logs in real time')
    .option('-d, --date <date>', 'Date to tail (YYYY-MM-DD)', new Date().toISOString().slice(0, 10))
    .action((opts: { date: string }) => {
      const logPath = getLogFilePath(opts.date);
      if (!fs.existsSync(logPath)) {
        console.log(pc.yellow(`Log file not found: ${logPath}`));
        return;
      }

      // Print existing content first
      const initial = readLastLines(logPath, 20);
      for (const line of initial) {
        console.log(line);
      }

      let lastSize = fs.statSync(logPath).size;
      console.log(pc.dim('--- Tailing (Ctrl+C to exit) ---'));

      const watcher = fs.watch(logPath, (eventType) => {
        if (eventType !== 'change') return;
        try {
          const stats = fs.statSync(logPath);
          if (stats.size <= lastSize) return;

          const fd = fs.openSync(logPath, 'r');
          const buffer = Buffer.alloc(stats.size - lastSize);
          fs.readSync(fd, buffer, 0, buffer.length, lastSize);
          fs.closeSync(fd);

          const newLines = buffer.toString('utf-8').split('\n').filter(l => l.trim());
          for (const line of newLines) {
            if (line.includes('[ERROR]')) {
              console.log(pc.red(line));
            } else if (line.includes('[WARN]')) {
              console.log(pc.yellow(line));
            } else if (line.includes('[DEBUG]')) {
              console.log(pc.dim(line));
            } else {
              console.log(line);
            }
          }
          lastSize = stats.size;
        } catch {
          // ignore transient file errors
        }
      });

      process.on('SIGINT', () => {
        watcher.close();
        process.exit(0);
      });
    });

  logs
    .command('list')
    .alias('ls')
    .description('List available log files')
    .action(() => {
      const files = listLogFiles();
      if (files.length === 0) {
        console.log(pc.yellow('No log files found'));
        return;
      }
      console.log(pc.bold('\nLog files:'));
      console.log(pc.dim('─'.repeat(60)));
      for (const f of files) {
        const fp = path.join(getLogDir(), f);
        const stats = fs.statSync(fp);
        const sizeKb = (stats.size / 1024).toFixed(1);
        console.log(`  ${f}  ${pc.dim(sizeKb + ' KB')}`);
      }
      console.log(pc.dim('─'.repeat(60)));
      console.log(`Total: ${files.length}\n`);
    });
}
