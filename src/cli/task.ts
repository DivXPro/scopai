import { Command } from 'commander';
import * as pc from 'picocolors';
import { createTask, getTaskById, listTasks, updateTaskStatus, updateTaskStats } from '../db/tasks';
import { addTaskTargets, getTargetStats } from '../db/task-targets';
import { getTemplateByName } from '../db/templates';
import { enqueueJobs } from '../db/queue-jobs';
import { query } from '../db/client';
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
    .option('--cli-templates <json>', 'JSON string of opencli command templates')
    .action(async (opts: { name: string; description?: string; template?: string; cliTemplates?: string }) => {
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
        cli_templates: opts.cliTemplates ?? null,
        status: 'pending',
        stats: { total: 0, done: 0, failed: 0 },
        created_at: now(),
        updated_at: now(),
        completed_at: null,
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

      const analyzedCommentIds = new Set(
        (await query<{ comment_id: string }>(
          'SELECT DISTINCT comment_id FROM analysis_results_comments WHERE task_id = ?',
          [opts.taskId],
        )).map(r => r.comment_id),
      );

      const targetsToProcess = stats.pending.filter(t => {
        if (t.target_type === 'comment' && analyzedCommentIds.has(t.target_id)) return false;
        return true;
      });

      if (targetsToProcess.length === 0) {
        console.log(pc.yellow('All pending targets already have analysis results'));
        return;
      }

      const jobs = targetsToProcess.map(t => ({
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
      const skipped = stats.pending.length - targetsToProcess.length;
      if (skipped > 0) {
        console.log(pc.dim(`  Skipped ${skipped} already-analyzed targets`));
      }

      // Also create queue_jobs for media files associated with this task's posts
      const mediaJobsCreated = await enqueueMediaJobsForTask(opts.taskId);
      if (mediaJobsCreated > 0) {
        console.log(pc.dim(`  Enqueued ${mediaJobsCreated} media analysis jobs`));
      }

      const totalJobs = jobs.length + mediaJobsCreated;
      console.log(pc.green(`Task started. Enqueued ${totalJobs} jobs for analysis.`));
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

/**
 * Create queue_jobs for media files associated with this task's posts.
 * Only creates jobs for media that haven't been analyzed yet.
 */
async function enqueueMediaJobsForTask(taskId: string): Promise<number> {
  // Get post IDs bound to this task
  const postTargets = await query<{ target_id: string }>(
    "SELECT target_id FROM task_targets WHERE task_id = ? AND target_type = 'post'",
    [taskId],
  );
  if (postTargets.length === 0) return 0;

  const postIds = postTargets.map(r => r.target_id);

  // Get media files for these posts
  const placeholders = postIds.map(() => '?').join(',');
  const mediaFiles = await query<{ id: string; post_id: string }>(
    `SELECT id, post_id FROM media_files WHERE post_id IN (${placeholders})`,
    postIds,
  );
  if (mediaFiles.length === 0) return 0;

  // Get media IDs that already have analysis results for this task
  const analyzedMediaIds = new Set(
    (await query<{ media_id: string }>(
      'SELECT DISTINCT media_id FROM analysis_results_media WHERE task_id = ?',
      [taskId],
    )).map(r => r.media_id),
  );

  // Filter out already-analyzed media
  const mediaToProcess = mediaFiles.filter(m => !analyzedMediaIds.has(m.id));
  if (mediaToProcess.length === 0) return 0;

  // Check if queue_jobs already exist for these media
  const mediaIds = mediaToProcess.map(m => m.id);
  const existingJobPlaceholders = mediaIds.map(() => '?').join(',');
  const existingJobs = await query<{ target_id: string }>(
    `SELECT target_id FROM queue_jobs WHERE task_id = ? AND target_type = 'media' AND target_id IN (${existingJobPlaceholders})`,
    [taskId, ...mediaIds],
  );
  const existingTargetIds = new Set(existingJobs.map(j => j.target_id));
  const newMediaJobs = mediaToProcess.filter(m => !existingTargetIds.has(m.id));

  if (newMediaJobs.length === 0) return 0;

  const jobs = newMediaJobs.map(m => ({
    id: generateId(),
    task_id: taskId,
    target_type: 'media' as const,
    target_id: m.id,
    status: 'pending' as const,
    priority: 0,
    attempts: 0,
    max_attempts: 3,
    error: null,
    created_at: now(),
    processed_at: null,
  }));

  await enqueueJobs(jobs);
  return jobs.length;
}
