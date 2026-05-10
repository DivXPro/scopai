import { Command } from 'commander';
import * as pc from 'picocolors';
import { readLockFile, isApiAlive } from '@scopai/core';
import { startMcpServer } from './mcp-server';

export function mcpCommands(program: Command): void {
  program
    .command('mcp')
    .description('Start MCP server (stdio mode)')
    .action(async () => {
      const lock = readLockFile();
      if (!lock) {
        console.error(pc.red('Daemon is not running. Start it with: scopai daemon start'));
        process.exit(1);
      }
      const alive = await isApiAlive(lock.port);
      if (!alive) {
        console.error(pc.red('Daemon is not responding. Try: scopai daemon restart'));
        process.exit(1);
      }

      await startMcpServer();
    });
}
