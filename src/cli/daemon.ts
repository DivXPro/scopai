import { Command } from 'commander';
import * as pc from 'picocolors';
import * as fs from 'fs';
import * as path from 'path';
import { fork, ChildProcess } from 'child_process';
import { DAEMON_PID_FILE, IPC_SOCKET_PATH } from '../shared/constants';
import { sendIpcRequest } from '../daemon/ipc-server';
import { expandPath } from '../shared/utils';

export function daemonCommands(program: Command): void {
  const daemon = program.command('daemon').description('Manage the analysis daemon');

  daemon
    .command('start')
    .description('Start the daemon (background by default)')
    .option('--fg', 'Run in foreground (debug mode)')
    .action(async (opts: { fg?: boolean }) => {
      if (opts.fg) {
        console.log(pc.yellow('Starting daemon in foreground (debug mode)...'));
        const daemonPath = path.join(__dirname, '../daemon/index.js');
        const child = fork(daemonPath, [], {
          env: { ...process.env, WORKER_ID: '0' },
          detached: false,
          stdio: 'inherit',
        });
        child.on('exit', (code) => {
          console.log(`Daemon exited with code ${code}`);
          process.exit(code ?? 1);
        });
      } else {
        if (isDaemonRunning()) {
          const pid = getDaemonPid();
          console.log(pc.yellow('Daemon is already running (PID: ' + pid + ')'));
          return;
        }
        console.log(pc.yellow('Starting daemon in background...'));
        const daemonPath = path.join(__dirname, '../daemon/index.js');
        const child = fork(daemonPath, [], {
          env: { ...process.env, WORKER_ID: '0' },
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        // Wait a moment for the daemon to start
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (isDaemonRunning()) {
          console.log(pc.green(`Daemon started (PID: ${getDaemonPid()})`));
        } else {
          console.log(pc.red('Failed to start daemon'));
        }
      }
    });

  daemon
    .command('stop')
    .description('Stop the daemon')
    .action(() => {
      const pid = getDaemonPid();
      if (!pid) {
        console.log(pc.yellow('Daemon is not running'));
        return;
      }
      try {
        process.kill(pid, 'SIGTERM');
        // Wait for process to exit
        let attempts = 0;
        while (attempts < 30) {
          try {
            process.kill(pid, 0);
            // Still running, wait
            const { execSync } = require('child_process');
            execSync(`sleep 0.2`);
            attempts++;
          } catch {
            break;
          }
        }
        // Clean up PID file
        if (fs.existsSync(DAEMON_PID_FILE)) {
          fs.unlinkSync(DAEMON_PID_FILE);
        }
        if (fs.existsSync(IPC_SOCKET_PATH)) {
          fs.unlinkSync(IPC_SOCKET_PATH);
        }
        console.log(pc.green('Daemon stopped'));
      } catch {
        // Process already dead
        if (fs.existsSync(DAEMON_PID_FILE)) {
          fs.unlinkSync(DAEMON_PID_FILE);
        }
        console.log(pc.green('Daemon stopped (was already dead)'));
      }
    });

  daemon
    .command('status')
    .description('Check daemon status')
    .action(async () => {
      const pid = getDaemonPid();
      if (!pid || !isDaemonRunning()) {
        console.log(pc.red('Daemon is not running'));
        return;
      }
      console.log(pc.green(`Daemon is running (PID: ${pid})`));
      console.log(`Socket: ${IPC_SOCKET_PATH}`);
      try {
        const status = await sendIpcRequest('daemon.status', {}) as Record<string, unknown>;
        console.log('\nQueue stats:');
        const queueStats = status.queue_stats as Record<string, unknown>;
        for (const [key, value] of Object.entries(queueStats || {})) {
          console.log(`  ${key}: ${value}`);
        }
      } catch {
        console.log(pc.yellow('Could not connect to daemon via IPC'));
      }
    });
}

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
