import { Command } from 'commander';
import * as pc from 'picocolors';
import { createComment, listCommentsByPost, countComments } from '../db/comments';
import { runMigrations } from '../db/migrate';
import { seedAll } from '../db/seed';
import { generateId } from '../shared/utils';

interface RawCommentItem {
  platform_comment_id?: string;
  id?: string;
  parent_comment_id?: string;
  root_comment_id?: string;
  depth?: number;
  author_id?: string;
  author_name?: string;
  author?: string;
  content?: string;
  like_count?: number;
  reply_count?: number;
  published_at?: string;
  metadata?: unknown;
}

export function commentCommands(program: Command): void {
  const comment = program.command('comment').description('Comment management');

  comment
    .command('import')
    .description('Import comments from a JSONL file')
    .requiredOption('--platform <id>', 'Platform ID')
    .requiredOption('--post-id <id>', 'Post ID to associate comments with')
    .option('--file <path>', 'Path to JSONL file')
    .action(async (opts: { platform: string; postId: string; file?: string }) => {
      if (!opts.file) {
        console.log(pc.red('Error: --file is required'));
        process.exit(1);
      }
      await runMigrations();
      await seedAll();

      const fs = require('fs');
      if (!fs.existsSync(opts.file)) {
        console.log(pc.red(`File not found: ${opts.file}`));
        process.exit(1);
      }
      const content = fs.readFileSync(opts.file, 'utf-8');
      const lines = content.split('\n').filter((l: string) => l.trim());
      let imported = 0;
      let skipped = 0;
      for (const line of lines) {
        try {
          const item: RawCommentItem = JSON.parse(line);
          await createComment({
            post_id: opts.postId,
            platform_id: opts.platform,
            platform_comment_id: item.platform_comment_id ?? item.id ?? null,
            parent_comment_id: item.parent_comment_id ?? null,
            root_comment_id: item.root_comment_id ?? null,
            depth: Number(item.depth ?? 0),
            author_id: item.author_id ?? null,
            author_name: item.author_name ?? item.author ?? null,
            content: item.content ?? '',
            like_count: Number(item.like_count ?? 0),
            reply_count: Number(item.reply_count ?? 0),
            published_at: item.published_at ? new Date(item.published_at) : null,
            metadata: item.metadata as Record<string, unknown> | null,
          });
          imported++;
        } catch {
          skipped++;
        }
      }
      console.log(pc.green(`Imported: ${imported}, Skipped (duplicate): ${skipped}`));
    });

  comment
    .command('list')
    .alias('ls')
    .description('List comments for a post')
    .requiredOption('--post-id <id>', 'Post ID')
    .option('--limit <n>', 'Max results', '100')
    .action(async (opts: { postId: string; limit: string }) => {
      await runMigrations();
      await seedAll();
      const comments = await listCommentsByPost(opts.postId, parseInt(opts.limit, 10));
      const total = await countComments(opts.postId);
      if (comments.length === 0) {
        console.log(pc.yellow('No comments found'));
        return;
      }
      console.log(pc.bold(`\nComments (${total} total):`));
      console.log(pc.dim('─'.repeat(80)));
      for (const c of comments) {
        const author = c.author_name ?? 'Anonymous';
        const content = c.content.length > 80 ? c.content.slice(0, 80) + '...' : c.content;
        console.log(`  ${pc.green(c.id.slice(0, 8))} ${pc.cyan(author)}: ${content}`);
        console.log(`    Likes: ${c.like_count} | ${c.published_at ?? 'N/A'}`);
      }
      console.log(pc.dim('─'.repeat(80)));
      console.log(`Showing ${comments.length} of ${total}\n`);
    });
}
