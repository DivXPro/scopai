import { Command } from 'commander';
import * as pc from 'picocolors';
import { generateId, formatTimestamp, waitForTaskStep, waitForTaskSteps } from '../shared/utils';
import { daemonCall } from './ipc-client';

export function taskCommands(program: Command): void {
  const task = program.command('task').description('Task management');

  task
    .command('create')
    .description('Create a new analysis task')
    .requiredOption('--name <name>', 'Task name')
    .option('--description <desc>', 'Task description')
    .option('--template <name>', 'Prompt template name')
    .option('--cli-templates <json>', 'JSON string of opencli command templates')
    .action(async (opts: { name: string; description?: string; template?: string; cliTemplates?: string }) => {
      let templateId: string | null = null;
      if (opts.template) {
        const tpl = await daemonCall('template.getByName', { name: opts.template }) as { id: string } | null;
        if (!tpl) {
          console.log(pc.red(`Template not found: ${opts.template}`));
          process.exit(1);
        }
        templateId = tpl.id;
      }

      const id = generateId();
      await daemonCall('task.create', {
        id,
        name: opts.name,
        description: opts.description ?? null,
        template_id: templateId,
        cli_templates: opts.cliTemplates ?? null,
      });
      console.log(pc.green(`Task created: ${id}`));
      console.log(`  Name: ${opts.name}`);
      if (opts.description) console.log(`  Description: ${opts.description}`);
      if (opts.cliTemplates) console.log(`  CLI Templates: ${opts.cliTemplates}`);
      console.log();
    });

  task
    .command('add-posts')
    .description('Add posts to a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .option('--post-ids <ids>', 'Comma-separated post IDs')
    .action(async (opts: { taskId: string; postIds?: string }) => {
      if (!opts.postIds) {
        console.log(pc.red('Error: --post-ids is required'));
        process.exit(1);
      }
      const postIds = opts.postIds.split(',').map(id => id.trim());
      await daemonCall('task.addTargets', { task_id: opts.taskId, target_type: 'post', target_ids: postIds });
      console.log(pc.green(`Added ${postIds.length} posts to task ${opts.taskId}`));
    });

  task
    .command('add-comments')
    .description('Add comments to a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .option('--comment-ids <ids>', 'Comma-separated comment IDs')
    .action(async (opts: { taskId: string; commentIds?: string }) => {
      if (!opts.commentIds) {
        console.log(pc.red('Error: --comment-ids is required'));
        process.exit(1);
      }
      const commentIds = opts.commentIds.split(',').map(id => id.trim());
      await daemonCall('task.addTargets', { task_id: opts.taskId, target_type: 'comment', target_ids: commentIds });
      console.log(pc.green(`Added ${commentIds.length} comments to task ${opts.taskId}`));
    });

  task
    .command('start')
    .description('Start a task (enqueue jobs for analysis)')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      const full = await daemonCall('task.show', { task_id: opts.taskId }) as Record<string, any>;
      if (!full.id) {
        console.log(pc.red(`Task not found: ${opts.taskId}`));
        process.exit(1);
      }
      const pending = full.pending as { target_type: string; target_id: string }[] | undefined;
      if (!pending || pending.length === 0) {
        console.log(pc.yellow('No pending targets to process'));
        return;
      }

      const result = await daemonCall('task.start', { task_id: opts.taskId }) as {
        enqueued: number; skipped: number; mediaJobs: number;
      };

      if (result.skipped > 0) {
        console.log(pc.dim(`  Skipped ${result.skipped} already-analyzed targets`));
      }
      if (result.mediaJobs > 0) {
        console.log(pc.dim(`  Enqueued ${result.mediaJobs} media analysis jobs`));
      }
      console.log(pc.green(`Task started. Enqueued ${result.enqueued} jobs for analysis.`));
    });

  task
    .command('pause')
    .description('Pause a running task')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      await daemonCall('task.pause', { task_id: opts.taskId });
      console.log(pc.green(`Task ${opts.taskId} paused`));
    });

  task
    .command('resume')
    .description('Resume a paused task')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      await daemonCall('task.resume', { task_id: opts.taskId });
      console.log(pc.green(`Task ${opts.taskId} resumed`));
    });

  task
    .command('cancel')
    .description('Cancel a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      await daemonCall('task.cancel', { task_id: opts.taskId });
      console.log(pc.yellow(`Task ${opts.taskId} cancelled`));
    });

  task
    .command('list')
    .alias('ls')
    .description('List tasks')
    .option('--status <status>', 'Filter by status')
    .action(async (opts: { status?: string }) => {
      const tasks = await daemonCall('task.list', { status: opts.status }) as any[];
      if (tasks.length === 0) {
        console.log(pc.yellow('No tasks found'));
        return;
      }
      console.log(pc.bold('\nTasks:'));
      console.log(pc.dim('─'.repeat(80)));
      for (const t of tasks) {
        const statusColor = (s: string) => {
          switch (s) {
            case 'completed': return pc.green(s);
            case 'running': return pc.cyan(s);
            case 'failed': return pc.red(s);
            case 'paused': return pc.yellow(s);
            default: return pc.gray(s);
          }
        };
        console.log(`  ${pc.green(t.id.slice(0, 8))} ${pc.bold(t.name)} [${statusColor(t.status)}]`);
        if (t.stats) {
          const stats = typeof t.stats === 'string' ? JSON.parse(t.stats) : t.stats;
          console.log(`    Progress: ${stats.done}/${stats.total} done, ${stats.failed} failed`);
        }
      }
      console.log(pc.dim('─'.repeat(80)));
      console.log(`Total: ${tasks.length}\n`);
    });

  task
    .command('show')
    .alias('status')
    .description('Show task status and progress')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      const full = await daemonCall('task.show', { task_id: opts.taskId }) as Record<string, any>;
      if (!full.id) {
        console.log(pc.red(`Task not found: ${opts.taskId}`));
        process.exit(1);
      }
      console.log(pc.bold(`\nTask: ${full.name}`));
      console.log(`  ID:          ${full.id}`);
      console.log(`  Status:      ${full.status}`);
      console.log(`  Phase:       ${full.phase}`);
      console.log(`  Created:     ${full.created_at}`);
      if (full.completed_at) console.log(`  Completed:   ${full.completed_at}`);

      console.log(`\n  Data Preparation:`);
      const dp = full.phases?.dataPreparation ?? {};
      console.log(`    Status:          ${dp.status ?? 'N/A'}`);
      console.log(`    Total Posts:     ${dp.totalPosts ?? 0}`);
      console.log(`    Comments Fetched:${dp.commentsFetched ?? 0}`);
      console.log(`    Media Fetched:   ${dp.mediaFetched ?? 0}`);
      console.log(`    Failed Posts:    ${dp.failedPosts ?? 0}`);

      console.log(`\n  Steps:`);
      const steps = full.phases?.steps ?? [];
      if (steps.length === 0) {
        console.log(`    (No steps added)`);
      } else {
        for (const s of steps) {
          const st = s.status;
          const color = st === 'completed' ? pc.green : st === 'running' ? pc.cyan : st === 'failed' ? pc.red : pc.gray;
          console.log(`    [${s.stepOrder}] ${s.name} (${s.strategyId}) - ${color(st)}`);
          if (s.stats) {
            console.log(`        Progress: ${s.stats.done}/${s.stats.total} done, ${s.stats.failed} failed`);
          }
        }
      }

      console.log(`\n  Analysis Jobs:`);
      const aj = full.phases?.analysis ?? {};
      console.log(`    Total:     ${aj.totalJobs ?? 0}`);
      console.log(`    Completed: ${aj.completedJobs ?? 0}`);
      console.log(`    Failed:    ${aj.failedJobs ?? 0}`);
      console.log(`    Pending:   ${aj.pendingJobs ?? 0}`);

      const recentErrors = full.recentErrors as { target_type: string; target_id: string; error: string }[] | undefined;
      if (recentErrors && recentErrors.length > 0) {
        console.log(`\n  ${pc.red('Recent Failures:')}`);
        for (const e of recentErrors) {
          const shortId = e.target_id?.slice(0, 8) ?? 'unknown';
          console.log(`    - ${e.target_type} ${shortId}: ${pc.red(e.error.slice(0, 100))}`);
        }
      }

      console.log();
    });

  const stepCmd = task.command('step').description('Task step management');

  stepCmd
    .command('add')
    .description('Add an analysis step to a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--strategy-id <id>', 'Strategy ID')
    .option('--name <name>', 'Step name')
    .option('--order <n>', 'Step order (auto-increment if omitted)')
    .action(async (opts: { taskId: string; strategyId: string; name?: string; order?: string }) => {
      const result = await daemonCall('task.step.add', {
        task_id: opts.taskId,
        strategy_id: opts.strategyId,
        name: opts.name,
        order: opts.order ? parseInt(opts.order, 10) : undefined,
      }) as { stepId: string; stepOrder: number };
      console.log(pc.green(`Step added: ${result.stepId} (order=${result.stepOrder})`));
    });

  stepCmd
    .command('list')
    .alias('ls')
    .description('List steps for a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      const steps = await daemonCall('task.step.list', { task_id: opts.taskId }) as any[];
      if (steps.length === 0) {
        console.log(pc.yellow('No steps found'));
        return;
      }
      console.log(pc.bold(`\nSteps for task ${opts.taskId.slice(0, 8)}:`));
      console.log(pc.dim('─'.repeat(70)));
      for (const s of steps) {
        const statusColor = s.status === 'completed' ? pc.green : s.status === 'running' ? pc.cyan : s.status === 'failed' ? pc.red : pc.gray;
        console.log(`  [${s.step_order}] ${statusColor(s.status.padEnd(10))} ${pc.cyan(s.strategy_id?.slice(0, 16) ?? '-')} ${s.name}`);
      }
      console.log(pc.dim('─'.repeat(70)));
      console.log(`Total: ${steps.length}\n`);
    });

  stepCmd
    .command('run')
    .description('Run a specific task step')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--step-id <id>', 'Step ID')
    .option('--wait', 'Block until step completes (default: true)')
    .option('--no-wait', 'Return immediately after enqueueing')
    .action(async (opts: { taskId: string; stepId: string; wait: boolean }) => {
      const result = await daemonCall('task.step.run', {
        task_id: opts.taskId,
        step_id: opts.stepId,
      }) as { enqueued: number; status: string };

      if (!opts.wait) {
        console.log(pc.green(`Step status: ${result.status}`));
        if (result.enqueued > 0) {
          console.log(`  Enqueued ${result.enqueued} jobs`);
        }
        return;
      }

      // Already completed or skipped
      if (result.status === 'completed' || result.status === 'skipped') {
        console.log(pc.green(`Step already ${result.status}`));
        return;
      }

      console.log(pc.yellow('Step started. Waiting for completion...\n'));

      try {
        const final = await waitForTaskStep(
          opts.taskId,
          opts.stepId,
          (id) => daemonCall('task.status', { task_id: id }) as Promise<Record<string, any>>,
          (p) => {
            const ts = formatTimestamp();
            const stats = p.stats ? `${p.stats.done ?? 0}/${p.stats.total ?? 0} done, ${p.stats.failed ?? 0} failed` : '';
            console.log(`[${ts}] Step: ${p.name} | ${p.status} | ${stats}`);
          },
        );

        console.log();
        if (final.status === 'completed') {
          console.log(pc.green(`Step completed: ${final.name}`));
        } else if (final.status === 'failed') {
          console.log(pc.red(`Step failed: ${final.name}`));
          process.exit(1);
        } else {
          console.log(pc.yellow(`Step ${final.status}: ${final.name}`));
        }
      } catch (err) {
        console.error(pc.red(`Error waiting for step: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  stepCmd
    .command('reset')
    .description('Reset a failed or running task step back to pending')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--step-id <id>', 'Step ID')
    .action(async (opts: { taskId: string; stepId: string }) => {
      try {
        const result = await daemonCall('task.step.reset', {
          task_id: opts.taskId,
          step_id: opts.stepId,
        }) as { reset: boolean };
        console.log(pc.green(`Step reset: ${result.reset}`));
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  task
    .command('run-all-steps')
    .description('Run all pending/failed steps for a task in order')
    .requiredOption('--task-id <id>', 'Task ID')
    .option('--wait', 'Block until all steps complete (default: true)')
    .option('--no-wait', 'Return immediately after enqueueing')
    .action(async (opts: { taskId: string; wait: boolean }) => {
      const result = await daemonCall('task.runAllSteps', { task_id: opts.taskId }) as {
        completed: number;
        failed: number;
        skipped: number;
      };

      if (!opts.wait) {
        console.log(pc.green('All steps processed'));
        console.log(`  Completed: ${result.completed}`);
        console.log(`  Failed:    ${result.failed}`);
        console.log(`  Skipped:   ${result.skipped}`);
        return;
      }

      console.log(pc.yellow('Steps started. Waiting for completion...\n'));

      try {
        const final = await waitForTaskSteps(
          opts.taskId,
          (id) => daemonCall('task.status', { task_id: id }) as Promise<Record<string, any>>,
          (completed, total, running) => {
            const ts = formatTimestamp();
            const progress = total > 0 ? `${completed}/${total}` : '0/0';
            const runningText = running ? ` | running: ${running}` : '';
            console.log(`[${ts}] Steps progress: ${progress} completed${runningText}`);
          },
        );

        console.log();
        console.log(pc.green('All steps complete'));
        console.log(`  Completed: ${final.completed}`);
        console.log(`  Failed:    ${final.failed}`);
        console.log(`  Skipped:   ${final.skipped}`);
        console.log(`  Total:     ${final.total}`);

        if (final.failed > 0) {
          process.exit(1);
        }
      } catch (err) {
        console.error(pc.red(`Error waiting for steps: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  task
    .command('results')
    .description('Show analysis results for a completed task')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      const full = await daemonCall('task.show', { task_id: opts.taskId }) as Record<string, any>;
      if (!full.id) {
        console.log(pc.red(`Task not found: ${opts.taskId}`));
        process.exit(1);
      }
      const results = await daemonCall('task.results', { task_id: opts.taskId }) as { target_type: string; target_id: string | null; summary: string | null; raw_response: Record<string, unknown> | null }[];
      console.log(pc.bold(`\nAnalysis results for task ${opts.taskId.slice(0, 8)}:`));
      console.log(`  Total result records: ${results.length}`);
      for (const r of results.slice(0, 5)) {
        console.log(`  - ${r.target_type} ${r.target_id?.slice(0, 8) ?? '-'}: ${JSON.stringify(r.summary ?? r.raw_response ?? {}).slice(0, 80)}`);
      }
      if (results.length > 5) {
        console.log(pc.dim(`  ... and ${results.length - 5} more`));
      }
      console.log();
    });
}
