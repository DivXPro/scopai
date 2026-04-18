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
    .description('Import a strategy from a JSON file or string')
    .option('--file <file>', 'Path to strategy JSON file')
    .option('--json <json>', 'Strategy JSON string')
    .action(async (opts: { file?: string; json?: string }) => {
      if (!opts.file && !opts.json) {
        console.log(pc.red('Either --file or --json is required'));
        process.exit(1);
      }
      if (opts.file && opts.json) {
        console.log(pc.red('Cannot use both --file and --json'));
        process.exit(1);
      }
      if (opts.file && !fs.existsSync(opts.file)) {
        console.log(pc.red('File not found'));
        process.exit(1);
      }
      try {
        const result = await daemonCall('strategy.import', { file: opts.file, json: opts.json }) as { imported: boolean; id?: string; reason?: string };
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
        if (s.needs_media) console.log(`  Media:    ${JSON.stringify(s.needs_media)}`);
        if (s.batch_config) console.log(`  Batch:    ${JSON.stringify(s.batch_config)}`);
        if (s.file_path) console.log(`  File:     ${s.file_path}`);
        console.log(`\n  Prompt:\n${pc.dim(s.prompt)}`);
        console.log(`\n  Output Schema:\n${pc.dim(JSON.stringify(s.output_schema, null, 2))}`);
        if (s.created_at) console.log(`\n  Created:  ${s.created_at}`);
        if (s.updated_at) console.log(`  Updated:  ${s.updated_at}`);
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  strategy
    .command('delete')
    .description('Delete a strategy by ID')
    .requiredOption('--id <id>', 'Strategy ID')
    .action(async (opts: { id: string }) => {
      try {
        await daemonCall('strategy.delete', { id: opts.id });
        console.log(pc.green(`Strategy deleted: ${opts.id}`));
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  const result = strategy.command('result').description('Query strategy analysis results');

  result
    .command('list')
    .alias('ls')
    .description('List results for a task and strategy')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--strategy <id>', 'Strategy ID')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts: { taskId: string; strategy: string; limit: string }) => {
      try {
        const rows = await daemonCall('strategy.result.list', {
          task_id: opts.taskId,
          strategy_id: opts.strategy,
          limit: parseInt(opts.limit, 10),
        }) as any[];
        if (rows.length === 0) {
          console.log(pc.yellow('No results found'));
          return;
        }
        console.log(pc.bold(`\nResults (${rows.length}):`));
        console.log(pc.dim('─'.repeat(80)));
        for (const r of rows) {
          const id = String(r.id ?? '').slice(0, 8);
          const dynamicKeys = Object.keys(r).filter(k => ![
            'id', 'task_id', 'target_type', 'target_id', 'post_id', 'strategy_version', 'raw_response', 'error', 'analyzed_at'
          ].includes(k));
          const summary = dynamicKeys.map(k => `${k}=${JSON.stringify(r[k]).slice(0, 30)}`).join(' ');
          console.log(`  ${pc.green(id)} ${summary}`);
        }
        console.log(pc.dim('─'.repeat(80)));
      } catch (err: unknown) {
        console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  result
    .command('stats')
    .description('Show statistics for a task and strategy')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--strategy <id>', 'Strategy ID')
    .action(async (opts: { taskId: string; strategy: string }) => {
      try {
        const stats = await daemonCall('strategy.result.stats', {
          task_id: opts.taskId,
          strategy_id: opts.strategy,
        }) as Record<string, unknown>;
        console.log(pc.bold(`\nStatistics:`));
        console.log(pc.dim('─'.repeat(40)));
        console.log(`  Total: ${stats.total ?? 0}`);
        const numeric = stats.numeric as Record<string, Record<string, number>> | undefined;
        if (numeric && Object.keys(numeric).length > 0) {
          console.log('\n  Numeric:');
          for (const [col, agg] of Object.entries(numeric)) {
            console.log(`    ${col}: avg=${agg.avg.toFixed(2)} min=${agg.min} max=${agg.max}`);
          }
        }
        const text = stats.text as Record<string, Record<string, number>> | undefined;
        if (text && Object.keys(text).length > 0) {
          console.log('\n  Distribution:');
          for (const [col, dist] of Object.entries(text)) {
            console.log(`    ${col}:`);
            for (const [val, cnt] of Object.entries(dist)) {
              console.log(`      ${val}: ${cnt}`);
            }
          }
        }
        console.log(pc.dim('─'.repeat(40)));
      } catch (err: unknown) {
        console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  result
    .command('export')
    .description('Export results for a task and strategy')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--strategy <id>', 'Strategy ID')
    .option('--format <fmt>', 'Output format (csv/json)', 'json')
    .option('--output <path>', 'Output file path')
    .action(async (opts: { taskId: string; strategy: string; format: string; output?: string }) => {
      try {
        const result = await daemonCall('strategy.result.export', {
          task_id: opts.taskId,
          strategy_id: opts.strategy,
          format: opts.format,
          output: opts.output ?? null,
        }) as { content: string; writtenTo: string | null; count: number };
        if (!opts.output) {
          process.stdout.write(result.content);
        } else {
          console.log(pc.green(`Exported ${result.count} rows to ${opts.output}`));
        }
      } catch (err: unknown) {
        console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });
}
