import { Command } from 'commander';
import * as pc from 'picocolors';
import { generateId, formatTimestamp, waitForTaskStep, waitForTaskSteps } from '@scopai/core';
import { apiGet, apiPost } from './api-client';
import type {
  ListTasksResponse,
  TaskDetailResponse,
  CreateTaskStepResponse,
  RunTaskStepResponse,
  ResetTaskStepResponse,
  RunAllTaskStepsResponse,
} from '@scopai/api';

export function taskCommands(program: Command): void {
  const task = program.command('task').description('Task management');

  task
    .command('create')
    .description('Create a new analysis task')
    .requiredOption('--name <name>', 'Task name')
    .option('--description <desc>', 'Task description')
    .option('--cli-templates <json>', 'JSON string of opencli command templates')
    .action(async (opts: { name: string; description?: string; cliTemplates?: string }) => {
      const id = generateId();
      let cliTemplates: Record<string, unknown> | null = null;
      if (opts.cliTemplates) {
        try {
          cliTemplates = JSON.parse(opts.cliTemplates);
        } catch {
          console.log(pc.red('Invalid JSON for --cli-templates'));
          process.exit(1);
        }
      }
      await apiPost('/tasks', {
        id,
        name: opts.name,
        description: opts.description ?? null,
        cli_templates: cliTemplates ? JSON.stringify(cliTemplates) : null,
      });
      console.log(pc.green(`Task created: ${id}`));
      console.log(`  Name: ${opts.name}`);
      if (opts.description) console.log(`  Description: ${opts.description}`);
      if (opts.cliTemplates) console.log(`  CLI Templates: ${opts.cliTemplates}`);
      console.log();
    });

  task
    .command('add-posts <id>')
    .description('Add posts to a task')
    .requiredOption('--post-ids <ids>', 'Comma-separated post IDs')
    .action(async (taskId: string, opts: { postIds: string }) => {
      const postIds = opts.postIds.split(',').map(id => id.trim());
      await apiPost('/tasks/' + taskId + '/add-posts', { post_ids: postIds });
      console.log(pc.green(`Added ${postIds.length} posts to task ${taskId}`));
    });

  task
    .command('pause <id>')
    .description('Pause a running task')
    .action(async (taskId: string) => {
      await apiPost('/tasks/' + taskId + '/pause');
      console.log(pc.green(`Task ${taskId} paused`));
    });

  task
    .command('resume <id>')
    .description('Resume a paused task')
    .action(async (taskId: string) => {
      await apiPost('/tasks/' + taskId + '/resume');
      console.log(pc.green(`Task ${taskId} resumed`));
    });

  task
    .command('cancel <id>')
    .description('Cancel a task')
    .action(async (taskId: string) => {
      await apiPost('/tasks/' + taskId + '/cancel');
      console.log(pc.yellow(`Task ${taskId} cancelled`));
    });

  task
    .command('list')
    .alias('ls')
    .description('List tasks')
    .option('--status <status>', 'Filter by status')
    .option('--query <text>', 'Search by task name')
    .action(async (opts: { status?: string; query?: string }) => {
      const params = new URLSearchParams();
      if (opts.status) params.set('status', opts.status);
      if (opts.query) params.set('query', opts.query);
      const response = await apiGet<ListTasksResponse>('/tasks?' + params.toString());
      const tasks = response.items ?? [];
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
    .command('show <id>')
    .alias('status')
    .description('Show task status and progress')
    .action(async (taskId: string) => {
      const full = await apiGet<TaskDetailResponse>('/tasks/' + taskId);
      if (!full.id) {
        console.log(pc.red(`Task not found: ${taskId}`));
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
    .option('--depends-on-step-id <id>', 'Upstream step ID (for secondary strategies)')
    .option('--name <name>', 'Step name')
    .option('--order <n>', 'Step order (auto-increment if omitted)')
    .action(async (opts: { taskId: string; strategyId: string; dependsOnStepId?: string; name?: string; order?: string }) => {
      const result = await apiPost<CreateTaskStepResponse>('/tasks/' + opts.taskId + '/steps', {
        strategy_id: opts.strategyId,
        depends_on_step_id: opts.dependsOnStepId,
        name: opts.name,
        order: opts.order ? parseInt(opts.order, 10) : undefined,
      });
      console.log(pc.green(`Step added: ${result.stepId} (order=${result.stepOrder})`));
    });

  stepCmd
    .command('list <id>')
    .alias('ls')
    .description('List steps for a task')
    .action(async (taskId: string) => {
      const steps = await apiGet<any[]>('/tasks/' + taskId + '/steps');
      if (steps.length === 0) {
        console.log(pc.yellow('No steps found'));
        return;
      }
      console.log(pc.bold(`\nSteps for task ${taskId.slice(0, 8)}:`));
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
      const result = await apiPost<RunTaskStepResponse>('/tasks/' + opts.taskId + '/steps/' + opts.stepId + '/run');

      if (opts.wait === false) {
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
          (id) => apiGet<Record<string, any>>('/tasks/' + id),
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
        const result = await apiPost<ResetTaskStepResponse>('/tasks/' + opts.taskId + '/steps/' + opts.stepId + '/reset');
        console.log(pc.green(`Step reset: ${result.reset}`));
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  task
    .command('run-all-steps <id>')
    .description('Run all pending/failed steps for a task in order')
    .option('--wait', 'Block until all steps complete (default: true)')
    .option('--no-wait', 'Return immediately after enqueueing')
    .action(async (taskId: string, opts: { wait: boolean }) => {
      const result = await apiPost<RunAllTaskStepsResponse>('/tasks/' + taskId + '/run-all-steps');

      if (opts.wait === false) {
        console.log(pc.green('All steps processed'));
        console.log(`  Completed: ${result.completed}`);
        console.log(`  Failed:    ${result.failed}`);
        console.log(`  Skipped:   ${result.skipped}`);
        return;
      }

      console.log(pc.yellow('Steps started. Waiting for completion...\n'));

      try {
        const final = await waitForTaskSteps(
          taskId,
          (id) => apiGet<Record<string, any>>('/tasks/' + id),
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
    .command('results <id>')
    .description('Show analysis results for a completed task')
    .option('--strategy-id <id>', 'Strategy ID (auto-detected from task steps if omitted)')
    .action(async (taskId: string, opts: { strategyId?: string }) => {
      const full = await apiGet<TaskDetailResponse>('/tasks/' + taskId);
      if (!full.id) {
        console.log(pc.red(`Task not found: ${taskId}`));
        process.exit(1);
      }

      // Determine strategy IDs to query
      let strategyIds: string[] = [];
      if (opts.strategyId) {
        strategyIds = [opts.strategyId];
      } else {
        // Try phases.steps first, then fallback to top-level steps
        const phaseSteps = full.phases?.steps ?? [];
        const topSteps = (full as any).steps ?? [];
        const allSteps = phaseSteps.length > 0 ? phaseSteps : topSteps;
        strategyIds = allSteps
          .map((s: any) => s.strategyId ?? s.strategy_id)
          .filter(Boolean);
        if (strategyIds.length === 0) {
          console.log(pc.yellow('No strategy steps found for this task. Use --strategy-id <id> to specify one manually.'));
          process.exit(1);
        }
      }

      for (const strategyId of strategyIds) {
        const response = await apiGet<{ results: any[]; stats: Record<string, unknown> }>('/tasks/' + taskId + '/results?strategy_id=' + strategyId);
        const results = response.results ?? [];
        const allSteps = [...(full.phases?.steps ?? []), ...((full as any).steps ?? [])];
        const stepName = allSteps.find((s: any) => (s.strategyId ?? s.strategy_id) === strategyId)?.name ?? strategyId;

        console.log(pc.bold(`\nAnalysis results for strategy "${stepName}" (${results.length} records):`));
        console.log(pc.dim('─'.repeat(80)));
        for (const r of results.slice(0, 5)) {
          const raw = r.raw_response ? JSON.stringify(r.raw_response).slice(0, 100) : '-';
          console.log(`  - ${r.target_type} ${r.target_id?.slice(0, 8) ?? '-'}: ${raw}`);
        }
        if (results.length > 5) {
          console.log(pc.dim(`  ... and ${results.length - 5} more`));
        }
        console.log(pc.dim('─'.repeat(80)));
      }
      console.log();
    });
}
