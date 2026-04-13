import { Command } from 'commander';
import * as pc from 'picocolors';
import * as fs from 'fs';
import { listResultsByTask, aggregateStats, getResultById } from '../db/analysis-results';
import { runMigrations } from '../db/migrate';
import { seedAll } from '../db/seed';

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
      await runMigrations();
      await seedAll();

      const results = await listResultsByTask(
        opts.taskId,
        opts.target as 'comment' | 'media',
        parseInt(opts.limit, 10)
      );
      if (results.length === 0) {
        console.log(pc.yellow('No results found'));
        return;
      }
      console.log(pc.bold(`\nAnalysis Results (${results.length}):`));
      console.log(pc.dim('─'.repeat(80)));
      for (const r of results) {
        const rec = r as Record<string, unknown>;
        const id = String(rec.id ?? '').slice(0, 8);
        const sentiment = rec.sentiment_label ? pc.cyan(String(rec.sentiment_label)) : pc.gray('N/A');
        const summary = rec.summary ? String(rec.summary).slice(0, 80) : '';
        console.log(`  ${pc.green(id)} Sentiment: ${sentiment} ${summary}`);
        if (rec.intent) console.log(`    Intent: ${pc.yellow(String(rec.intent))}`);
        if (rec.risk_flagged) console.log(`    ${pc.red('⚠ Risk:')} ${rec.risk_level} - ${rec.risk_reason ?? ''}`);
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
      await runMigrations();
      await seedAll();

      const r = await getResultById(opts.id, opts.target as 'comment' | 'media');
      if (!r) {
        console.log(pc.red(`Result not found: ${opts.id}`));
        process.exit(1);
      }
      const rec = r as Record<string, unknown>;
      console.log(pc.bold('\nResult Details:'));
      console.log(pc.dim('─'.repeat(60)));
      for (const [key, value] of Object.entries(rec)) {
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
      await runMigrations();
      await seedAll();

      const stats = await aggregateStats(opts.taskId);
      console.log(pc.bold(`\nAnalysis Statistics for task ${opts.taskId}:`));
      console.log(pc.dim('─'.repeat(40)));
      console.log(`  ${'Total analyzed'.padEnd(20)} ${stats.total ?? 0}`);
      console.log(`  ${'Risk flagged'.padEnd(20)} ${(stats as Record<string, unknown>).risk_flagged ?? 0}`);

      const sentiment = (stats as Record<string, unknown>).sentiment as Record<string, number> | undefined;
      if (sentiment && Object.keys(sentiment).length > 0) {
        console.log(`\n  Sentiment:`);
        for (const [label, count] of Object.entries(sentiment)) {
          const bar = '█'.repeat(count);
          console.log(`    ${label.padEnd(12)} ${count} ${pc.gray(bar)}`);
        }
      }

      const intent = (stats as Record<string, unknown>).intent as Record<string, number> | undefined;
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
      await runMigrations();
      await seedAll();

      const commentResults = await listResultsByTask(opts.taskId, 'comment', 100000);
      const allResults = commentResults.map(r => {
        const rec = r as Record<string, unknown>;
        // Flatten JSON fields for export
        const flat: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(rec)) {
          if (typeof value === 'object' && value !== null) {
            flat[key] = JSON.stringify(value);
          } else {
            flat[key] = value;
          }
        }
        return flat;
      });

      if (opts.format === 'csv') {
        const csv = exportToCsv(allResults);
        if (opts.output) {
          fs.writeFileSync(opts.output, csv);
          console.log(pc.green(`Exported to ${opts.output}`));
        } else {
          process.stdout.write(csv);
        }
      } else {
        const json = allResults.map(r => JSON.stringify(r)).join('\n');
        if (opts.output) {
          fs.writeFileSync(opts.output, json);
          console.log(pc.green(`Exported to ${opts.output}`));
        } else {
          process.stdout.write(json + '\n');
        }
      }
    });
}

function exportToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    const values = headers.map(h => {
      const v = row[h];
      const str = v === null || v === undefined ? '' : String(v);
      // Escape commas and quotes in CSV
      if (str.includes(',') || str.includes('"')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    });
    lines.push(values.join(','));
  }
  return lines.join('\n') + '\n';
}
