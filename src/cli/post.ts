import { Command } from 'commander';
import * as pc from 'picocolors';
import { daemonCall } from './ipc-client';

interface RawPostItem {
  platform_post_id?: string;
  noteId?: string;
  id?: string;
  title?: string;
  content?: string;
  text?: string;
  desc?: string;
  author_id?: string;
  author_name?: string;
  author?: string;
  author_url?: string;
  url?: string;
  cover_url?: string;
  post_type?: string;
  type?: string;
  like_count?: number;
  collect_count?: number;
  comment_count?: number;
  share_count?: number;
  play_count?: number;
  score?: number;
  tags?: unknown;
  media_files?: unknown;
  published_at?: string;
  metadata?: unknown;
}

export function postCommands(program: Command): void {
  const post = program.command('post').description('Post management');

  post
    .command('import')
    .description('Import posts from a JSON or JSONL file')
    .requiredOption('--platform <id>', 'Platform ID')
    .option('--file <path>', 'Path to JSON or JSONL file')
    .action(async (opts: { platform: string; file?: string }) => {
      if (!opts.file) {
        console.log(pc.red('Error: --file is required'));
        process.exit(1);
      }
      const fs = require('fs');
      if (!fs.existsSync(opts.file)) {
        console.log(pc.red(`File not found: ${opts.file}`));
        process.exit(1);
      }
      const result = await daemonCall('post.import', { platform: opts.platform, file: opts.file }) as { imported: number; skipped: number; postIds?: string[] };
      console.log(pc.green(`Imported: ${result.imported}, Skipped (duplicate): ${result.skipped}`));
      if (result.postIds && result.postIds.length > 0) {
        console.log(`Post IDs: ${result.postIds.join(',')}`);
      }
    });

  post
    .command('list')
    .alias('ls')
    .description('List posts')
    .option('--platform <id>', 'Filter by platform')
    .option('--limit <n>', 'Max results', '50')
    .option('--offset <n>', 'Offset', '0')
    .action(async (opts: { platform?: string; limit: string; offset: string }) => {
      const result = await daemonCall('post.list', {
        platform: opts.platform,
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
      }) as { posts: any[]; total: number };
      const posts = result.posts ?? result;
      const total = (result as any).total ?? posts.length;
      if (posts.length === 0) {
        console.log(pc.yellow('No posts found'));
        return;
      }
      console.log(pc.bold(`\nPosts (${total} total):`));
      console.log(pc.dim('─'.repeat(80)));
      for (const p of posts) {
        const title = p.title ?? p.content.slice(0, 40);
        console.log(`  ${pc.green(p.id.slice(0, 8))} ${pc.cyan(p.platform_id)} ${title}`);
        console.log(`    Likes: ${p.like_count} | Comments: ${p.comment_count} | ${p.published_at ?? 'N/A'}`);
      }
      console.log(pc.dim('─'.repeat(80)));
      console.log(`Showing ${posts.length} of ${total}\n`);
    });

  post
    .command('search')
    .description('Search posts by keyword')
    .requiredOption('--platform <id>', 'Platform ID')
    .requiredOption('--query <text>', 'Search query')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts: { platform: string; query: string; limit: string }) => {
      const posts = await daemonCall('post.search', {
        platform: opts.platform,
        query: opts.query,
        limit: parseInt(opts.limit, 10),
      }) as any[];
      if (posts.length === 0) {
        console.log(pc.yellow('No posts found'));
        return;
      }
      console.log(pc.bold(`\nSearch results (${posts.length}):`));
      for (const p of posts) {
        const title = p.title ?? p.content.slice(0, 40);
        console.log(`  ${pc.green(p.id.slice(0, 8))} ${title}`);
      }
      console.log();
    });
}
