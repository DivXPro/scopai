import { Command } from 'commander';
import * as pc from 'picocolors';
import { createTask, getTaskById, listTasks, updateTaskStatus, updateTaskStats } from '../db/tasks';
import { addTaskTargets, getTargetStats } from '../db/task-targets';
import { getTemplateByName } from '../db/templates';
import { enqueueJobs } from '../db/queue-jobs';
import { runMigrations } from '../db/migrate';
import { seedAll } from '../db/seed';
import { generateId, now } from '../shared/utils';

export function taskCommands(program: Command): void {
  const task = program.command('task').description('Task management');

  task
    .command('create')
    .description('Create a new analysis task')
    .requiredOption('--name <name>', 'Task name')
    .option('--description <desc>', 'Task description')
    .option('--template <name>', 'Prompt template name')
    .action(async (opts: { name: string; description?: string; template?: string }) => {
      await runMigrations();
      await seedAll();

      let templateId: string | null = null;
      if (opts.template) {
        const tpl = await getTemplateByName(opts.template);
        if (!tpl) {
          console.log(pc.red(`Template not found: ${opts.template}`));
          process.exit(1);
        }
        templateId = tpl.id;
      }

      const id = generateId();
      await createTask({
        id,
        name: opts.name,
        description: opts.description ?? null,
        template_id: templateId,
        status: 'pending',
        stats: { total: 0, done: 0, failed: 0 },
        created_at: now(),
        updated_at: now(),
        completed_at: null,
      });
      console.log(pc.green(`Task created: ${id}`));
      console.log(`  Name: ${opts.name}`);
      if (opts.description) console.log(`  Description: ${opts.description}`);
      console.log();
    });

  task
    .command('add-posts')
    .description('Add posts to a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .option('--post-ids <ids>', 'Comma-separated post IDs')
    .action(async (opts: { taskId: string; postIds?: string }) => {
      await runMigrations();
      await seedAll();

      if (!opts.postIds) {
        console.log(pc.red('Error: --post-ids is required'));
        process.exit(1);
      }
      const postIds = opts.postIds.split(',').map(id => id.trim());
      await addTaskTargets(opts.taskId, 'post', postIds);
      console.log(pc.green(`Added ${postIds.length} posts to task ${opts.taskId}`));
    });

  task
    .command('add-comments')
    .description('Add comments to a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .option('--comment-ids <ids>', 'Comma-separated comment IDs')
    .action(async (opts: { taskId: string; commentIds?: string }) => {
      await runMigrations();
      await seedAll();

      if (!opts.commentIds) {
        console.log(pc.red('Error: --comment-ids is required'));
        process.exit(1);
      }
      const commentIds = opts.commentIds.split(',').map(id => id.trim());
      await addTaskTargets(opts.taskId, 'comment', commentIds);
      console.log(pc.green(`Added ${commentIds.length} comments to task ${opts.taskId}`));
    });

  task
    .command('start')
    .description('Start a task (enqueue jobs for analysis)')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      await runMigrations();
      await seedAll();

      const task = await getTaskById(opts.taskId);
      if (!task) {
        console.log(pc.red(`Task not found: ${opts.taskId}`));
        process.exit(1);
      }
      await updateTaskStatus(opts.taskId, 'running');
      const stats = await getTargetStats(opts.taskId);
      await updateTaskStats(opts.taskId, { total: stats.total, done: stats.done, failed: stats.failed });

      if (stats.pending.length === 0) {
        console.log(pc.yellow('No pending targets to process'));
        return;
      }

      const jobs = stats.pending.map(t => ({
        id: generateId(),
        task_id: opts.taskId,
        target_type: t.target_type as 'post' | 'comment' | null,
        target_id: t.target_id,
        status: 'pending' as const,
        priority: 0,
        attempts: 0,
        max_attempts: 3,
        error: null,
        created_at: now(),
        processed_at: null,
      }));
      await enqueueJobs(jobs);
      console.log(pc.green(`Task started. Enqueued ${jobs.length} jobs for analysis.`));
    });

  task
    .command('pause')
    .description('Pause a running task')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      await runMigrations();
      await seedAll();
      await updateTaskStatus(opts.taskId, 'paused');
      console.log(pc.green(`Task ${opts.taskId} paused`));
    });

  task
    .command('resume')
    .description('Resume a paused task')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      await runMigrations();
      await seedAll();
      await updateTaskStatus(opts.taskId, 'running');
      console.log(pc.green(`Task ${opts.taskId} resumed`));
    });

  task
    .command('cancel')
    .description('Cancel a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      await runMigrations();
      await seedAll();
      await updateTaskStatus(opts.taskId, 'failed');
      console.log(pc.yellow(`Task ${opts.taskId} cancelled`));
    });

  task
    .command('list')
    .alias('ls')
    .description('List tasks')
    .option('--status <status>', 'Filter by status')
    .action(async (opts: { status?: string }) => {
      await runMigrations();
      await seedAll();
      const tasks = await listTasks(opts.status);
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
    .command('status')
    .description('Show task status and progress')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      await runMigrations();
      await seedAll();
      const task = await getTaskById(opts.taskId);
      if (!task) {
        console.log(pc.red(`Task not found: ${opts.taskId}`));
        process.exit(1);
      }
      const stats = await getTargetStats(opts.taskId);
      console.log(pc.bold(`\nTask: ${task.name}`));
      console.log(`  ID:          ${task.id}`);
      console.log(`  Status:      ${task.status}`);
      console.log(`  Created:     ${task.created_at}`);
      if (task.completed_at) console.log(`  Completed:   ${task.completed_at}`);
      console.log(`\n  Progress:`);
      console.log(`    Total:     ${stats.total}`);
      console.log(`    Done:      ${stats.done}`);
      console.log(`    Failed:    ${stats.failed}`);
      console.log(`    Pending:   ${stats.pending.length}`);
      console.log();
    });
}
