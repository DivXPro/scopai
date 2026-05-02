import { Command } from 'commander';
import * as pc from 'picocolors';
import { apiGet, apiPost } from './api-client';
import type { TaskDetailResponse, TaskPrepareDataResponse } from '@scopai/api';

export function taskPrepareCommands(program: Command): void {
  const task = program.commands.find(c => c.name() === 'task') ?? program.command('task');

  task
    .command('prepare-data <id>')
    .description('Download comments and media for task posts via opencli (resumable)')
    .action(async (taskId: string) => {
      const t = await apiGet<TaskDetailResponse>('/tasks/' + taskId);
      if (!t.id) {
        console.log(pc.red(`Task not found: ${taskId}`));
        process.exit(1);
      }

      if (!t.cli_templates) {
        console.log(pc.red('Task has no CLI templates. Create the task with --cli-templates.'));
        process.exit(1);
      }

      const result = await apiPost<TaskPrepareDataResponse>('/tasks/' + taskId + '/prepare-data');
      if (result.status !== 'queued') {
        console.log(pc.red('Failed to start data preparation'));
        process.exit(1);
      }

      console.log(pc.yellow('Data preparation started. Polling progress...\n'));

      const poll = async () => {
        const status = await apiGet<Record<string, any>>('/tasks/' + taskId);
        const dp = status.phases?.dataPreparation ?? {};
        const done = dp.status === 'done';
        const failed = dp.status === 'failed';

        process.stdout.write(`\r  Posts: ${dp.totalPosts ?? 0} | Comments: ${dp.commentsFetched ?? 0} | Media: ${dp.mediaFetched ?? 0}`);
        if (done || failed) {
          console.log();
          console.log(pc.dim('─'.repeat(40)));
          if (failed) {
            console.log(pc.red('Data preparation failed'));
          } else {
            console.log(pc.green('Data preparation complete'));
            console.log(`  Done: ${dp.commentsFetched ?? 0}/${dp.totalPosts ?? 0} posts, ${dp.failedPosts ?? 0} failed`);
            console.log(pc.cyan('Analysis jobs have been automatically enqueued. Use "task show" to check progress.'));
          }
          console.log();
          return;
        }

        await new Promise(r => setTimeout(r, 2000));
        return poll();
      };

      await poll();
    });
}
