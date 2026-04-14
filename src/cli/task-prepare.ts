import { Command } from 'commander';
import * as pc from 'picocolors';
import { getTaskById, updateTaskStatus } from '../db/tasks';
import { listTaskTargets } from '../db/task-targets';
import { upsertTaskPostStatus, getPendingPostIds, getTaskPostStatus } from '../db/task-post-status';
import { fetchViaOpencli } from '../data-fetcher/opencli';
import { createComment } from '../db/comments';
import { createMediaFile } from '../db/media-files';
import { getPostById } from '../db/posts';
import { runMigrations } from '../db/migrate';
import { seedAll } from '../db/seed';

interface CliTemplates {
  fetch_comments?: string;
  fetch_media?: string;
}

export function taskPrepareCommands(program: Command): void {
  const task = program.command('task');

  task
    .command('prepare-data')
    .description('Download comments and media for task posts via opencli (resumable)')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      await runMigrations();
      await seedAll();

      const task = await getTaskById(opts.taskId);
      if (!task) {
        console.log(pc.red(`Task not found: ${opts.taskId}`));
        process.exit(1);
      }

      if (!task.cli_templates) {
        console.log(pc.red('Task has no CLI templates. Create the task with --cli-templates.'));
        process.exit(1);
      }

      let cliTemplates: CliTemplates;
      try {
        cliTemplates = JSON.parse(task.cli_templates);
      } catch {
        console.log(pc.red('Invalid cli_templates JSON in task'));
        process.exit(1);
      }

      if (cliTemplates.fetch_comments && !cliTemplates.fetch_comments.includes('{post_id}')) {
        console.log(pc.red('fetch_comments template must contain {post_id} placeholder'));
        process.exit(1);
      }
      if (cliTemplates.fetch_media && !cliTemplates.fetch_media.includes('{post_id}')) {
        console.log(pc.red('fetch_media template must contain {post_id} placeholder'));
        process.exit(1);
      }

      const postTargets = (await listTaskTargets(opts.taskId)).filter(t => t.target_type === 'post');
      if (postTargets.length === 0) {
        console.log(pc.yellow('No posts bound to this task. Use task add-posts first.'));
        process.exit(1);
      }

      const postIds = postTargets.map(t => t.target_id);

      const firstPost = await getPostById(postIds[0]);
      if (!firstPost) {
        console.log(pc.red(`Post not found: ${postIds[0]}`));
        process.exit(1);
      }
      const platformId = firstPost.platform_id;

      for (const postId of postIds) {
        await upsertTaskPostStatus(opts.taskId, postId, { status: 'pending' });
      }

      const pending = await getPendingPostIds(opts.taskId);

      if (pending.length === 0) {
        console.log(pc.green('All posts already processed. Nothing to do.'));
        return;
      }

      console.log(`Preparing data for ${pending.length}/${postIds.length} posts...\n`);

      let successCount = 0;
      let skipCount = postIds.length - pending.length;
      let failCount = 0;

      for (const item of pending) {
        const postId = item.post_id;

        console.log(pc.dim(`[${successCount + failCount + 1}/${postIds.length}] Processing post: ${postId.slice(0, 8)}...`));

        if (!item.comments_fetched && cliTemplates.fetch_comments) {
          await upsertTaskPostStatus(opts.taskId, postId, { status: 'fetching' });
          console.log('  Fetching comments...');

          const result = await fetchViaOpencli(cliTemplates.fetch_comments, { post_id: postId, limit: '100' });
          if (!result.success) {
            console.log(pc.red(`  Comments fetch failed: ${result.error}`));
            await upsertTaskPostStatus(opts.taskId, postId, { status: 'failed', error: result.error ?? 'unknown' });
            failCount++;
            continue;
          }

          const commentCount = await importCommentsToDb(result.data ?? [], postId, platformId);
          await upsertTaskPostStatus(opts.taskId, postId, { comments_fetched: true, comments_count: commentCount });
          console.log(`  Comments imported: ${commentCount}`);
        } else if (!cliTemplates.fetch_comments) {
          console.log('  Comments: skipped (no template)');
        } else {
          console.log('  Comments: already fetched');
        }

        if (!item.media_fetched && cliTemplates.fetch_media) {
          console.log('  Fetching media...');

          const result = await fetchViaOpencli(cliTemplates.fetch_media, { post_id: postId });
          if (!result.success) {
            console.log(pc.red(`  Media fetch failed: ${result.error}`));
            await upsertTaskPostStatus(opts.taskId, postId, { status: 'failed', error: result.error ?? 'unknown' });
            failCount++;
            continue;
          }

          const mediaCount = await importMediaToDb(result.data ?? [], postId, platformId);
          await upsertTaskPostStatus(opts.taskId, postId, { media_fetched: true, media_count: mediaCount });
          console.log(`  Media imported: ${mediaCount}`);
        } else if (!cliTemplates.fetch_media) {
          console.log('  Media: skipped (no template)');
        } else {
          console.log('  Media: already fetched');
        }

        await upsertTaskPostStatus(opts.taskId, postId, { status: 'done' });
        successCount++;
      }

      await updateTaskStatus(opts.taskId, 'pending');

      console.log(pc.dim('\n' + '─'.repeat(40)));
      console.log(pc.green(`\nData preparation complete:`));
      console.log(`  Success: ${successCount}`);
      console.log(`  Skipped (already done): ${skipCount}`);
      console.log(`  Failed: ${failCount}`);
      console.log();
    });
}

async function importCommentsToDb(
  data: unknown[],
  postId: string,
  platformId: string,
): Promise<number> {
  let count = 0;
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    try {
      await createComment({
        post_id: postId,
        platform_id: platformId,
        platform_comment_id: (obj.platform_comment_id ?? obj.id ?? null) as string | null,
        parent_comment_id: (obj.parent_comment_id ?? null) as string | null,
        root_comment_id: (obj.root_comment_id ?? null) as string | null,
        depth: Number(obj.depth ?? 0),
        author_id: (obj.author_id ?? null) as string | null,
        author_name: (obj.author_name ?? obj.author ?? null) as string | null,
        content: (obj.content ?? obj.text ?? '') as string,
        like_count: Number(obj.like_count ?? 0),
        reply_count: Number(obj.reply_count ?? 0),
        published_at: obj.published_at ? new Date(obj.published_at as string) : null,
        metadata: (obj.metadata ?? obj) as Record<string, unknown> | null,
      });
      count++;
    } catch (err: unknown) {
      if (!isDuplicateError(err)) {
        console.error(pc.yellow(`  Warning: failed to import comment: ${errorMessage(err)}`));
      }
    }
  }
  return count;
}

async function importMediaToDb(
  data: unknown[],
  postId: string,
  platformId: string,
): Promise<number> {
  let count = 0;
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const obj = item as Record<string, unknown>;
    try {
      await createMediaFile({
        post_id: postId,
        comment_id: null,
        platform_id: platformId,
        media_type: (obj.media_type ?? obj.type ?? 'image') as 'image' | 'video' | 'audio',
        url: (obj.url ?? '') as string,
        local_path: (obj.local_path ?? obj.path ?? null) as string | null,
        width: obj.width ? Number(obj.width) : null,
        height: obj.height ? Number(obj.height) : null,
        duration_ms: obj.duration_ms ? Number(obj.duration_ms) : null,
        file_size: obj.file_size ? Number(obj.file_size) : null,
        downloaded_at: obj.downloaded_at ? new Date(obj.downloaded_at as string) : null,
      });
      count++;
    } catch (err: unknown) {
      if (!isDuplicateError(err)) {
        console.error(pc.yellow(`  Warning: failed to import media: ${errorMessage(err)}`));
      }
    }
  }
  return count;
}

function isDuplicateError(err: unknown): boolean {
  const msg = errorMessage(err);
  return /duplicate|unique|constraint/i.test(msg);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
