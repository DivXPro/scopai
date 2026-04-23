import { Command } from 'commander';
import * as pc from 'picocolors';
import { spawn } from 'child_process';
import * as path from 'path';
import { readLockFile, isApiAlive, removeLockFile } from '@analyze-cli/core';
import { VERSION } from '@analyze-cli/core';

export function daemonCommands(program: Command): void {
  const daemon = program.command('daemon').description('Manage the analysis daemon');

  daemon
    .command('start')
    .description('Start the daemon (background by default)')
    .option('--fg', 'Run in foreground (debug mode)')
    .option('--verbose', 'Enable debug-level logging')
    .action(async (opts: { fg?: boolean; verbose?: boolean }) => {
      // Check if already running
      const lock = readLockFile();
      if (lock) {
        const alive = await isApiAlive(lock.port);
        if (alive) {
          console.log(pc.yellow(`Daemon already running on port ${lock.port} (PID ${lock.pid})`));
          return;
        }
        removeLockFile();
      }

      // Resolve API package path from monorepo root
      const monorepoRoot = path.dirname(path.dirname(require.resolve('@analyze-cli/core/package.json')));
      const apiDir = path.join(monorepoRoot, 'packages', 'api');
      const env: NodeJS.ProcessEnv = { ...process.env };
      if (opts.verbose) {
        env.ANALYZE_CLI_LOG_LEVEL = 'debug';
      }

      if (opts.fg) {
        console.log(pc.yellow('Starting daemon in foreground...'));
        const child = spawn('node', ['dist/index.js'], {
          cwd: apiDir,
          env,
          stdio: 'inherit',
        });
        child.on('exit', (code) => {
          console.log(`Daemon exited with code ${code}`);
          process.exit(code ?? 1);
        });
      } else {
        console.log(pc.yellow('Starting daemon in background...'));
        const child = spawn('node', ['dist/index.js'], {
          cwd: apiDir,
          env,
          detached: true,
          stdio: 'ignore',
        });
        child.unref();

        // Wait for API to be ready (poll lock file + health)
        const start = Date.now();
        const timeout = 15_000;
        while (Date.now() - start < timeout) {
          await new Promise((r) => setTimeout(r, 500));
          const newLock = readLockFile();
          if (newLock) {
            const alive = await isApiAlive(newLock.port);
            if (alive) {
              console.log(pc.green(`Daemon started on port ${newLock.port} (PID ${newLock.pid})`));
              return;
            }
          }
        }
        console.log(pc.red('Daemon failed to start within timeout'));
        process.exit(1);
      }
    });

  daemon
    .command('stop')
    .description('Stop the daemon')
    .action(async () => {
      const lock = readLockFile();
      if (!lock) {
        console.log(pc.yellow('Daemon is not running'));
        return;
      }
      const alive = await isApiAlive(lock.port);
      if (!alive) {
        removeLockFile();
        console.log(pc.green('Daemon was not running (cleaned stale lock)'));
        return;
      }
      try {
        process.kill(lock.pid, 'SIGTERM');
      } catch {
        removeLockFile();
        console.log(pc.green('Daemon stopped (was already dead)'));
        return;
      }
      console.log(pc.yellow('Daemon stopping...'));

      // Wait for lock file to be removed
      const start = Date.now();
      while (Date.now() - start < 10_000) {
        await new Promise((r) => setTimeout(r, 500));
        if (!readLockFile()) {
          console.log(pc.green('Daemon stopped'));
          return;
        }
      }
      console.log(pc.red('Daemon did not stop within timeout'));
      process.exit(1);
    });

  daemon
    .command('status')
    .description('Check daemon status')
    .action(async () => {
      const lock = readLockFile();
      if (!lock) {
        console.log(pc.red('Daemon is not running'));
        return;
      }
      const alive = await isApiAlive(lock.port);
      if (!alive) {
        removeLockFile();
        console.log(pc.red('Daemon is not running (cleaned stale lock)'));
        return;
      }

      console.log(pc.green(`Daemon running on port ${lock.port} (PID ${lock.pid})`));
      console.log(`Started:  ${lock.startedAt}`);

      try {
        const res = await fetch(`http://localhost:${lock.port}/api/status`);
        const status = await res.json() as Record<string, unknown>;
        console.log(`Uptime:   ${Math.round((status.uptime as number ?? 0))}s`);
        const queueStats = status.queue_stats as Record<string, unknown> | undefined;
        if (queueStats) {
          console.log('\nQueue stats:');
          for (const [key, value] of Object.entries(queueStats)) {
            console.log(`  ${key}: ${value}`);
          }
        }
      } catch {
        console.log(pc.yellow('Could not fetch daemon status'));
      }
    });

  daemon
    .command('restart')
    .description('Restart the daemon')
    .option('--fg', 'Run in foreground (debug mode)')
    .option('--verbose', 'Enable debug-level logging')
    .action(async (opts: { fg?: boolean; verbose?: boolean }) => {
      // Stop
      const lock = readLockFile();
      if (lock) {
        const alive = await isApiAlive(lock.port);
        if (alive) {
          try { process.kill(lock.pid, 'SIGTERM'); } catch {}
          const start = Date.now();
          while (Date.now() - start < 10_000) {
            await new Promise((r) => setTimeout(r, 500));
            if (!readLockFile()) break;
          }
          console.log(pc.green('Daemon stopped'));
        } else {
          removeLockFile();
        }
      }

      // Start — invoke the start action
      const startCmd = daemon.commands.find((c) => c.name() === 'start');
      if (startCmd) {
        await startCmd.parseAsync(['--fg', ...(opts.fg ? [] : []), ...(opts.verbose ? ['--verbose'] : [])], { from: 'user' });
      }
    });
}
