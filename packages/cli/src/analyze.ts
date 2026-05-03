import { Command } from 'commander';
import * as pc from 'picocolors';
import { apiPost } from './api-client';

export function analyzeCommands(program: Command): void {
  const analyze = program.command('analyze').description('Strategy analysis');

  analyze
    .command('run')
    .description('Enqueue analysis jobs for an existing task')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--strategy-id <id>', 'Strategy ID')
    .action(async (opts: { taskId: string; strategyId: string }) => {
      const result = await apiPost('/analyze/run', {
        task_id: opts.taskId,
        strategy_id: opts.strategyId,
      });
      console.log(pc.green(`Enqueued ${result.enqueued} jobs, skipped ${result.skipped}`));
    });

  analyze
    .command('submit')
    .description('Submit posts/comments for strategy analysis (auto-creates task)')
    .requiredOption('--strategy-id <id>', 'Strategy ID')
    .option('--task-id <id>', 'Existing task ID (auto-created if omitted)')
    .option('--post-ids <ids>', 'Comma-separated post IDs')
    .option('--comment-ids <ids>', 'Comma-separated comment IDs')
    .option('--force', 'Re-analyze targets that already have results')
    .action(async (opts: { strategyId: string; taskId?: string; postIds?: string; commentIds?: string; force?: boolean }) => {
      const payload: Record<string, unknown> = {
        strategy_id: opts.strategyId,
        force: opts.force ?? false,
      };
      if (opts.taskId) payload.task_id = opts.taskId;
      if (opts.postIds) payload.post_ids = opts.postIds.split(',').map(s => s.trim());
      if (opts.commentIds) payload.comment_ids = opts.commentIds.split(',').map(s => s.trim());

      const result = await apiPost('/analyze/submit', payload);
      console.log(pc.green(`Task: ${result.task_id}`));
      console.log(`  Enqueued: ${result.enqueued}, Skipped: ${result.skipped}`);
    });
}