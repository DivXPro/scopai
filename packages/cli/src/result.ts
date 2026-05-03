import { Command } from 'commander';
import * as pc from 'picocolors';
import { apiGet } from './api-client';

export function resultCommands(program: Command): void {
  const result = program.command('result').description('Analysis result management');

  result
    .command('list')
    .alias('ls')
    .description('List analysis results for a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--strategy-id <id>', 'Strategy ID')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts: { taskId: string; strategyId: string; limit: string }) => {
      const response = await apiGet<{ results: any[]; stats: Record<string, unknown> }>(
        '/tasks/' + opts.taskId + '/results?strategy_id=' + opts.strategyId + '&limit=' + opts.limit,
      );
      const results = response.results ?? [];
      if (results.length === 0) {
        console.log(pc.yellow('No results found'));
        return;
      }
      console.log(pc.bold(`\nAnalysis Results (${results.length}):`));
      console.log(pc.dim('─'.repeat(80)));
      for (const r of results) {
        const rec = r as Record<string, unknown>;
        const id = String(rec.id ?? '').slice(0, 8);
        const dynamicKeys = Object.keys(rec).filter(
          k => !['id', 'task_id', 'target_type', 'target_id', 'post_id', 'strategy_version', 'raw_response', 'error', 'analyzed_at'].includes(k),
        );
        const summary = dynamicKeys.map(k => `${k}=${JSON.stringify(rec[k]).slice(0, 30)}`).join(' ');
        console.log(`  ${pc.green(id)} ${summary}`);
      }
      console.log(pc.dim('─'.repeat(80)));
      console.log(`Showing ${results.length}\n`);
    });
}
