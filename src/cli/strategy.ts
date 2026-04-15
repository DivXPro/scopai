import { Command } from 'commander';
import * as pc from 'picocolors';
import * as fs from 'fs';
import { daemonCall } from './ipc-client';

export function strategyCommands(program: Command): void {
  const strategy = program.command('strategy').description('Strategy management');

  strategy
    .command('list')
    .alias('ls')
    .description('List all imported strategies')
    .action(async () => {
      try {
        const strategies = await daemonCall('strategy.list', {}) as any[];
        if (strategies.length === 0) {
          console.log(pc.yellow('No strategies found'));
          return;
        }
        console.log(pc.bold('\nStrategies:'));
        console.log(pc.dim('─'.repeat(80)));
        for (const s of strategies) {
          console.log(`  ${pc.green(s.id)} ${pc.bold(s.name)} [${s.target}] v${s.version}`);
        }
        console.log(pc.dim('─'.repeat(80)));
        console.log(`\nTotal: ${strategies.length}`);
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  strategy
    .command('import')
    .description('Import a strategy from a JSON file')
    .requiredOption('--file <file>', 'Path to strategy JSON file')
    .action(async (opts: { file: string }) => {
      if (!fs.existsSync(opts.file)) {
        console.log(pc.red('File not found'));
        process.exit(1);
      }
      try {
        const result = await daemonCall('strategy.import', { file: opts.file }) as { imported: boolean; id?: string; reason?: string };
        if (result.imported) {
          console.log(pc.green(`Strategy imported: ${result.id}`));
        } else {
          console.log(pc.yellow(`Skipped: ${result.reason}`));
        }
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  strategy
    .command('show')
    .description('Show strategy details')
    .requiredOption('--id <id>', 'Strategy ID')
    .action(async (opts: { id: string }) => {
      try {
        const s = await daemonCall('strategy.show', { id: opts.id }) as any;
        if (!s) {
          console.log(pc.red('Strategy not found'));
          process.exit(1);
        }
        console.log(pc.bold(`\nStrategy: ${s.name}`));
        console.log(`  ID:       ${s.id}`);
        console.log(`  Target:   ${s.target}`);
        console.log(`  Version:  ${s.version}`);
        if (s.description) console.log(`  Desc:     ${s.description}`);
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
