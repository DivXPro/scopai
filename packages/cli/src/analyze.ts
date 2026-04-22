import { Command } from 'commander';
import * as pc from 'picocolors';
import { apiPost } from './api-client';

export function analyzeCommands(program: Command): void {
  const analyze = program.command('analyze').description('Run strategy-based analysis');

  analyze
    .command('run')
    .description('Run a strategy against a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--strategy <id>', 'Strategy ID')
    .action(async (opts: { taskId: string; strategy: string }) => {
      try {
        const result = await apiPost<{ enqueued: number }>('/analyze/run', { task_id: opts.taskId, strategy_id: opts.strategy });
        console.log(pc.green(`Enqueued ${result.enqueued} jobs for analysis`));
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
