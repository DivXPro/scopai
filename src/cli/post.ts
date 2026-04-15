import { Command } from 'commander';
import * as pc from 'picocolors';
import { createPost, listPosts, searchPosts, countPosts } from '../db/posts';
import { runMigrations } from '../db/migrate';
import { seedAll } from '../db/seed';
import { generateId, now, parseImportFile } from '../shared/utils';

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
      // Initialize DB for direct file access
      await runMigrations();
      await seedAll();

      const fs = require('fs');
      if (!fs.existsSync(opts.file)) {
        console.log(pc.red(`File not found: ${opts.file}`));
        process.exit(1);
      }

      let items: unknown[];
      try {
        items = parseImportFile(opts.file);
      } catch (err: unknown) {
        console.log(pc.red(`Failed to parse import file: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
      let imported = 0;
      let skipped = 0;
      for (const itemRaw of items) {
        try {
          const item = itemRaw as RawPostItem;
          await createPost({
            platform_id: opts.platform,
            platform_post_id: item.platform_post_id ?? item.noteId ?? item.id ?? generateId(),
            title: item.title ?? null,
            content: item.content ?? item.text ?? item.desc ?? '',
            author_id: item.author_id ?? null,
            author_name: item.author_name ?? item.author ?? null,
            author_url: item.author_url ?? null,
            url: item.url ?? null,
            cover_url: item.cover_url ?? null,
            post_type: (item.post_type ?? item.type ?? null) as 'text' | 'image' | 'video' | 'audio' | 'article' | 'carousel' | 'mixed' | null,
            like_count: Number(item.like_count ?? 0),
            collect_count: Number(item.collect_count ?? 0),
            comment_count: Number(item.comment_count ?? 0),
            share_count: Number(item.share_count ?? 0),
            play_count: Number(item.play_count ?? 0),
            score: item.score ? Number(item.score) : null,
            tags: item.tags as { name: string; url?: string }[] | null,
            media_files: (item.media_files as { type: 'image' | 'video' | 'audio'; url: string }[] | null) ?? null,
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

  post
    .command('list')
    .alias('ls')
    .description('List posts')
    .option('--platform <id>', 'Filter by platform')
    .option('--limit <n>', 'Max results', '50')
    .option('--offset <n>', 'Offset', '0')
    .action(async (opts: { platform?: string; limit: string; offset: string }) => {
      await runMigrations();
      await seedAll();
      const posts = await listPosts(opts.platform, parseInt(opts.limit, 10), parseInt(opts.offset, 10));
      const total = await countPosts(opts.platform);
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
      await runMigrations();
      await seedAll();
      const posts = await searchPosts(opts.platform, opts.query, parseInt(opts.limit, 10));
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
