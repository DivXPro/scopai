import { Command } from 'commander';
import * as pc from 'picocolors';
import * as fs from 'fs';
import { apiGet, apiPost } from './api-client';

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
    .description('Import comments from a JSON or JSONL file')
    .requiredOption('--platform <id>', 'Platform ID')
    .requiredOption('--post-id <id>', 'Post ID to associate comments with')
    .option('--file <path>', 'Path to JSON or JSONL file')
    .action(async (opts: { platform: string; postId: string; file?: string }) => {
      if (!opts.file) {
        console.log(pc.red('Error: --file is required'));
        process.exit(1);
      }
      if (!fs.existsSync(opts.file)) {
        console.log(pc.red(`File not found: ${opts.file}`));
        process.exit(1);
      }
      const content = fs.readFileSync(opts.file, 'utf-8');
      let commentsData: Record<string, unknown>[];
      try {
        const parsed = JSON.parse(content);
        commentsData = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        console.log(pc.red('Invalid JSON file'));
        process.exit(1);
      }
      try {
        const result = await apiPost<{ imported: number; skipped: number }>('/posts/' + opts.postId + '/comments/import', {
          comments: commentsData,
          platform: opts.platform,
        });
        console.log(pc.green(`Imported: ${result.imported}, Skipped (duplicate): ${result.skipped}`));
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  comment
    .command('list')
    .alias('ls')
    .description('List comments for a post')
    .requiredOption('--post-id <id>', 'Post ID')
    .option('--limit <n>', 'Max results', '100')
    .action(async (opts: { postId: string; limit: string }) => {
      const result = await apiGet<{ comments: any[]; total: number }>('/posts/' + opts.postId + '/comments?limit=' + opts.limit);
      const comments = result.comments ?? result;
      const total = (result as any).total ?? comments.length;
      if (comments.length === 0) {
        console.log(pc.yellow('No comments found'));
        return;
      }
      console.log(pc.bold(`\nComments (${total} total):`));
      console.log(pc.dim('─'.repeat(80)));
      for (const c of comments) {
        const author = c.author_name ?? 'Anonymous';
        const content = (c.content ?? '').length > 80 ? (c.content ?? '').slice(0, 80) + '...' : (c.content ?? '');
        console.log(`  ${pc.green(c.id.slice(0, 8))} ${pc.cyan(author)}: ${content}`);
        console.log(`    Likes: ${c.like_count} | ${c.published_at ?? 'N/A'}`);
      }
      console.log(pc.dim('─'.repeat(80)));
      console.log(`Showing ${comments.length} of ${total}\n`);
    });
}
