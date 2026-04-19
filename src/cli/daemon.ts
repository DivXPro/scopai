import { Command } from 'commander';
import * as pc from 'picocolors';
import * as path from 'path';
import { fork, spawn } from 'child_process';
import { IPC_SOCKET_PATH } from '../shared/constants';
import { sendIpcRequest } from '../daemon/ipc-server';
import { isDaemonRunning, getDaemonPid, getDaemonVersion, cleanupStaleDaemonFiles } from '../shared/daemon-status';
import { VERSION } from '../shared/version';
import { getLogFilePath } from '../shared/logger';

export function daemonCommands(program: Command): void {
  const daemon = program.command('daemon').description('Manage the analysis daemon');

  daemon
    .command('start')
    .description('Start the daemon (background by default)')
    .option('--fg', 'Run in foreground (debug mode)')
    .option('--verbose', 'Enable debug-level logging')
    .action(async (opts: { fg?: boolean; verbose?: boolean }) => {
      const logFile = getLogFilePath();
      if (opts.fg) {
        console.log(pc.yellow('Starting daemon in foreground (debug mode)...'));
        const daemonPath = path.join(__dirname, '../daemon/index.js');
        const env: NodeJS.ProcessEnv = { ...process.env, WORKER_ID: '0' };
        if (opts.verbose) {
          env.ANALYZE_CLI_LOG_LEVEL = 'debug';
        }
        const child = fork(daemonPath, [], {
          env,
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
          console.log(pc.dim(`Log file: ${logFile}`));
          return;
        }
        cleanupStaleDaemonFiles();
        console.log(pc.yellow('Starting daemon in background...'));
        const daemonPath = path.join(__dirname, '../daemon/index.js');
        const env: NodeJS.ProcessEnv = { ...process.env, WORKER_ID: '0' };
        if (opts.verbose) {
          env.ANALYZE_CLI_LOG_LEVEL = 'debug';
        }
        const child = spawn('node', [daemonPath], {
          env,
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        // Wait a moment for the daemon to start
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (isDaemonRunning()) {
          console.log(pc.green(`Daemon started (PID: ${getDaemonPid()})`));
          console.log(pc.dim(`Log file: ${logFile}`));
        } else {
          console.log(pc.red('Failed to start daemon'));
        }
      }
    });

  daemon
    .command('stop')
    .description('Stop the daemon')
    .action(async () => {
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
            await new Promise(resolve => setTimeout(resolve, 200));
            attempts++;
          } catch {
            break;
          }
        }
        cleanupStaleDaemonFiles();
        console.log(pc.green('Daemon stopped'));
      } catch {
        // Process already dead
        cleanupStaleDaemonFiles();
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
      const daemonVersion = getDaemonVersion();
      const versionMatch = daemonVersion === VERSION;
      console.log(pc.green(`Daemon is running (PID: ${pid})`));
      console.log(`Version:  ${daemonVersion ?? 'unknown'} ${versionMatch ? pc.green('(matches CLI)') : pc.yellow(`(CLI: ${VERSION})`)}`);
      console.log(`Socket:   ${IPC_SOCKET_PATH}`);
      console.log(pc.dim(`Log file: ${getLogFilePath()}`));
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

  daemon
    .command('restart')
    .description('Restart the daemon')
    .option('--fg', 'Run in foreground (debug mode)')
    .option('--verbose', 'Enable debug-level logging')
    .action(async (opts: { fg?: boolean; verbose?: boolean }) => {
      const pid = getDaemonPid();
      if (pid) {
        try {
          process.kill(pid, 'SIGTERM');
          let attempts = 0;
          while (attempts < 30) {
            try {
              process.kill(pid, 0);
              await new Promise(resolve => setTimeout(resolve, 200));
              attempts++;
            } catch {
              break;
            }
          }
          cleanupStaleDaemonFiles();
          console.log(pc.green('Daemon stopped'));
        } catch {
          cleanupStaleDaemonFiles();
        }
      }

      const logFile = getLogFilePath();
      if (opts.fg) {
        console.log(pc.yellow('Starting daemon in foreground (debug mode)...'));
        const daemonPath = path.join(__dirname, '../daemon/index.js');
        const env: NodeJS.ProcessEnv = { ...process.env, WORKER_ID: '0' };
        if (opts.verbose) {
          env.ANALYZE_CLI_LOG_LEVEL = 'debug';
        }
        const child = fork(daemonPath, [], {
          env,
          detached: false,
          stdio: 'inherit',
        });
        child.on('exit', (code) => {
          console.log(`Daemon exited with code ${code}`);
          process.exit(code ?? 1);
        });
      } else {
        cleanupStaleDaemonFiles();
        console.log(pc.yellow('Starting daemon in background...'));
        const daemonPath = path.join(__dirname, '../daemon/index.js');
        const env: NodeJS.ProcessEnv = { ...process.env, WORKER_ID: '0' };
        if (opts.verbose) {
          env.ANALYZE_CLI_LOG_LEVEL = 'debug';
        }
        const child = spawn('node', [daemonPath], {
          env,
          detached: true,
          stdio: 'ignore',
        });
        child.unref();
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (isDaemonRunning()) {
          console.log(pc.green(`Daemon started (PID: ${getDaemonPid()})`));
          console.log(pc.dim(`Log file: ${logFile}`));
        } else {
          console.log(pc.red('Failed to start daemon'));
        }
      }
    });
}
