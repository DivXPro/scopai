import { Command } from 'commander';
import * as pc from 'picocolors';
import { apiGet, apiPost } from './api-client';

export function resultCommands(program: Command): void {
  const result = program.command('result').description('Analysis result management');

  result
    .command('list')
    .alias('ls')
    .description('List analysis results for a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .option('--target <type>', 'Target type (comment/media)', 'comment')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts: { taskId: string; target: string; limit: string }) => {
      const params = new URLSearchParams();
      params.set('target', opts.target);
      params.set('limit', opts.limit);
      const results = await apiGet<any[]>('/tasks/' + opts.taskId + '/results?' + params.toString());
      if (results.length === 0) {
        console.log(pc.yellow('No results found'));
        return;
      }
      console.log(pc.bold(`\nAnalysis Results (${results.length}):`));
      console.log(pc.dim('─'.repeat(80)));
      const isMedia = opts.target === 'media';
      for (const r of results) {
        const rec = r as Record<string, unknown>;
        const id = String(rec.id ?? '').slice(0, 8);
        if (isMedia) {
          const mediaType = rec.media_type ? pc.cyan(String(rec.media_type)) : pc.gray('N/A');
          const contentType = rec.content_type ? pc.yellow(String(rec.content_type)) : '';
          const desc = rec.description ? String(rec.description).slice(0, 60) : '';
          const risk = rec.risk_flagged ? pc.red(` ⚠${rec.risk_level}`) : '';
          console.log(`  ${pc.green(id)} Type: ${mediaType} ${contentType}${risk}`);
          if (desc) console.log(`    ${pc.gray(desc)}`);
          if (rec.ocr_text) console.log(`    OCR: ${pc.gray(String(rec.ocr_text).slice(0, 60))}`);
        } else {
          const sentiment = rec.sentiment_label ? pc.cyan(String(rec.sentiment_label)) : pc.gray('N/A');
          const summary = rec.summary ? String(rec.summary).slice(0, 80) : '';
          console.log(`  ${pc.green(id)} Sentiment: ${sentiment} ${summary}`);
          if (rec.intent) console.log(`    Intent: ${pc.yellow(String(rec.intent))}`);
          if (rec.risk_flagged) console.log(`    ${pc.red('⚠ Risk:')} ${rec.risk_level} - ${rec.risk_reason ?? ''}`);
        }
      }
      console.log(pc.dim('─'.repeat(80)));
      console.log(`Showing ${results.length}\n`);
    });

  result
    .command('show')
    .description('Show detailed result by ID')
    .requiredOption('--id <id>', 'Result ID')
    .option('--target <type>', 'Target type (comment/media)', 'comment')
    .action(async (opts: { id: string; target: string }) => {
      const r = await apiGet<Record<string, unknown> | null>('/results/' + opts.id + '?target=' + opts.target);
      if (!r) {
        console.log(pc.red(`Result not found: ${opts.id}`));
        process.exit(1);
      }
      console.log(pc.bold('\nResult Details:'));
      console.log(pc.dim('─'.repeat(60)));
      for (const [key, value] of Object.entries(r)) {
        if (value === null || value === undefined) continue;
        const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
        console.log(`  ${pc.cyan(key.padEnd(20))} ${displayValue}`);
      }
      console.log(pc.dim('─'.repeat(60) + '\n'));
    });

  result
    .command('stats')
    .description('Show aggregated statistics for a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts: { taskId: string }) => {
      const stats = await apiGet<Record<string, unknown>>('/tasks/' + opts.taskId + '/results/stats');
      console.log(pc.bold(`\nAnalysis Statistics for task ${opts.taskId}:`));
      console.log(pc.dim('─'.repeat(40)));
      console.log(`  ${'Total analyzed'.padEnd(20)} ${stats.total ?? 0}`);
      console.log(`  ${'Risk flagged'.padEnd(20)} ${stats.risk_flagged ?? 0}`);

      const sentiment = stats.sentiment as Record<string, number> | undefined;
      if (sentiment && Object.keys(sentiment).length > 0) {
        console.log(`\n  Sentiment:`);
        for (const [label, count] of Object.entries(sentiment)) {
          const bar = '█'.repeat(count);
          console.log(`    ${label.padEnd(12)} ${count} ${pc.gray(bar)}`);
        }
      }

      const intent = stats.intent as Record<string, number> | undefined;
      if (intent && Object.keys(intent).length > 0) {
        console.log(`\n  Intent:`);
        for (const [label, count] of Object.entries(intent)) {
          const bar = '█'.repeat(count);
          console.log(`    ${label.padEnd(12)} ${count} ${pc.gray(bar)}`);
        }
      }
      console.log(pc.dim('─'.repeat(40) + '\n'));
    });

  result
    .command('export')
    .description('Export analysis results')
    .requiredOption('--task-id <id>', 'Task ID')
    .option('--format <fmt>', 'Output format (csv/json)', 'json')
    .option('--output <path>', 'Output file path')
    .action(async (opts: { taskId: string; format: string; output?: string }) => {
      const result = await apiPost<{ content: string; writtenTo: string | null; count: number }>('/tasks/' + opts.taskId + '/results/export', {
        format: opts.format,
        output: opts.output ?? null,
      });

      if (!opts.output) {
        process.stdout.write(result.content);
      } else {
        console.log(pc.green(`Exported to ${opts.output}`));
      }
    });
}

/**
 * `result media` — Show media files and analysis results for a task's posts
 */
export function resultMediaCommands(program: Command): void {
  const result = program.commands.find(c => c.name() === 'result') ?? program.command('result');

  result
    .command('media')
    .description('Show media files and analysis results for a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .option('--post-id <id>', 'Filter by specific post ID')
    .action(async (opts: { taskId: string; postId?: string }) => {
      const params = new URLSearchParams();
      if (opts.postId) params.set('post_id', opts.postId);
      const data = await apiGet<{
        posts: { post_id: string; title: string; media: any[] }[];
        totalMedia: number;
        totalAnalyzed: number;
      }>('/tasks/' + opts.taskId + '/media?' + params.toString());

      if (data.posts.length === 0) {
        console.log(pc.yellow('No posts bound to this task. Use task add-posts first.'));
        return;
      }

      console.log(pc.bold(`\nMedia Files for task ${opts.taskId}:`));
      console.log(pc.dim('─'.repeat(80)));

      for (const p of data.posts) {
        console.log(pc.bold(`\n  📝 ${p.title} (${p.post_id.slice(0, 8)}...)`));
        for (const m of p.media) {
          const mediaIcon = m.media_type === 'image' ? '🖼️' : m.media_type === 'video' ? '🎬' : '🎵';
          const pathInfo = m.local_path ? m.local_path : m.url;
          console.log(`    ${mediaIcon} ${pc.cyan(m.id.slice(0, 8))} ${pc.dim(pathInfo)}`);
          if (m.analysis) {
            const a = m.analysis;
            const sentiment = a.sentiment_label ? pc.cyan(String(a.sentiment_label)) : pc.gray('N/A');
            const contentType = a.content_type ? pc.yellow(String(a.content_type)) : '';
            const desc = a.description ? String(a.description).slice(0, 80) : '';
            const risk = a.risk_flagged ? pc.red(` ⚠${a.risk_level}`) : '';
            console.log(`      Analysis: ${sentiment} ${contentType}${risk}`);
            if (desc) console.log(`      ${pc.gray(desc)}`);
            if (a.ocr_text) console.log(`      OCR: ${pc.gray(String(a.ocr_text).slice(0, 80))}`);
          } else {
            console.log(`      ${pc.gray('Not analyzed')}`);
          }
        }
      }

      console.log(pc.dim('\n' + '─'.repeat(80)));
      console.log(`  Total: ${data.totalMedia} media files, ${data.totalAnalyzed} analyzed, ${data.totalMedia - data.totalAnalyzed} pending`);
      console.log();
    });
}
