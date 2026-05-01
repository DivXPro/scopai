import { Command } from 'commander';
import * as pc from 'picocolors';
import * as fs from 'fs';
import { apiGet, apiPost, apiDelete } from './api-client';

interface AggregateOpts {
  taskId: string;
  strategy: string;
  groupBy: string;
  agg?: string;
  jsonKey?: string;
  having?: string;
  limit?: string;
  format?: string;
  output?: string;
}

interface AggregateRow {
  [key: string]: string | number;
}

function formatAggregateOutput(rows: AggregateRow[], format: string, outputPath?: string): string {
  if (format === 'json') {
    return rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  }
  if (format === 'csv') {
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    for (const row of rows) {
      const values = headers.map(h => {
        const v = row[h];
        const str = String(v === null || v === undefined ? '' : v);
        if (str.includes(',') || str.includes('"')) return '"' + str.replace(/"/g, '""') + '"';
        return str;
      });
      lines.push(values.join(','));
    }
    return lines.join('\n') + '\n';
  }
  // table format
  const headers = Object.keys(rows[0]);
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.slice(0, 50).map(r => String(r[h] ?? '').length))
  );
  const divider = '  ' + headers.map((h, i) => pc.bold(h.padEnd(colWidths[i]))).join('  ');
  const headerLine = '  ' + colWidths.map(w => pc.dim('─'.repeat(w))).join('  ');
  const lines = rows.slice(0, 50).map(row =>
    '  ' + headers.map((h, i) => String(row[h] ?? '').padEnd(colWidths[i])).join('  ')
  );
  return '\n' + divider + '\n' + headerLine + '\n' + lines.join('\n') + '\n\n';
}

export function strategyCommands(program: Command): void {
  const strategy = program.command('strategy').description('Strategy management');

  strategy
    .command('list')
    .alias('ls')
    .description('List all imported strategies')
    .action(async () => {
      try {
        const strategies = await apiGet<any[]>('/strategies');
        if (strategies.length === 0) {
          console.log(pc.yellow('No strategies found'));
          return;
        }
        console.log(pc.bold('\nStrategies:'));
        console.log(pc.dim('─'.repeat(80)));
        for (const s of strategies) {
          const batchInfo = s.batch_config?.enabled ? pc.yellow(` batch=${s.batch_config.size}`) : '';
          console.log(`  ${pc.green(s.id)} ${pc.bold(s.name)} [${s.target}] v${s.version}${batchInfo}`);
        }
        console.log(pc.dim('─'.repeat(80)));
        console.log(`\nTotal: ${strategies.length}`);
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  strategy
    .command('import')
    .description('Import a strategy from a JSON file or string')
    .option('--file <file>', 'Path to strategy JSON file')
    .option('--json <json>', 'Strategy JSON string')
    .action(async (opts: { file?: string; json?: string }) => {
      if (!opts.file && !opts.json) {
        console.log(pc.red('Either --file or --json is required'));
        process.exit(1);
      }
      if (opts.file && opts.json) {
        console.log(pc.red('Cannot use both --file and --json'));
        process.exit(1);
      }
      if (opts.file && !fs.existsSync(opts.file)) {
        console.log(pc.red('File not found'));
        process.exit(1);
      }
      let strategyData: Record<string, unknown>;
      if (opts.json) {
        try {
          strategyData = JSON.parse(opts.json);
        } catch {
          console.log(pc.red('Invalid JSON string'));
          process.exit(1);
        }
      } else {
        const content = fs.readFileSync(opts.file!, 'utf-8');
        try {
          strategyData = JSON.parse(content);
        } catch {
          console.log(pc.red('Invalid JSON file'));
          process.exit(1);
        }
      }
      try {
        const result = await apiPost<{ imported: boolean; id?: string; reason?: string }>('/strategies/import', strategyData);
        if (result.imported) {
          console.log(pc.green(`Strategy imported: ${result.id}`));
        } else {
          console.log(pc.yellow(`Skipped: ${result.reason}`));
        }
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  strategy
    .command('show')
    .description('Show strategy details')
    .requiredOption('--id <id>', 'Strategy ID')
    .action(async (opts: { id: string }) => {
      try {
        const s = await apiGet<any>('/strategies/' + opts.id);
        if (!s) {
          console.log(pc.red('Strategy not found'));
          process.exit(1);
        }
        console.log(pc.bold(`\nStrategy: ${s.name}`));
        console.log(`  ID:       ${s.id}`);
        console.log(`  Target:   ${s.target}`);
        console.log(`  Version:  ${s.version}`);
        if (s.description) console.log(`  Desc:     ${s.description}`);
        if (s.needs_media) console.log(`  Media:    ${JSON.stringify(s.needs_media)}`);
        if (s.batch_config) console.log(`  Batch:    ${JSON.stringify(s.batch_config)}`);
        if (s.file_path) console.log(`  File:     ${s.file_path}`);
        console.log(`\n  Prompt:\n${pc.dim(s.prompt)}`);
        console.log(`\n  Output Schema:\n${pc.dim(JSON.stringify(s.output_schema, null, 2))}`);
        if (s.created_at) console.log(`\n  Created:  ${s.created_at}`);
        if (s.updated_at) console.log(`  Updated:  ${s.updated_at}`);
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  strategy
    .command('delete')
    .description('Delete a strategy by ID')
    .requiredOption('--id <id>', 'Strategy ID')
    .action(async (opts: { id: string }) => {
      try {
        await apiDelete('/strategies/' + opts.id);
        console.log(pc.green(`Strategy deleted: ${opts.id}`));
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  const result = strategy.command('result').description('Query strategy analysis results');

  result
    .command('list')
    .alias('ls')
    .description('List results for a task and strategy')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--strategy <id>', 'Strategy ID')
    .option('--limit <n>', 'Max results', '50')
    .action(async (opts: { taskId: string; strategy: string; limit: string }) => {
      try {
        const response = await apiGet<{ results: any[]; stats: Record<string, unknown> }>('/tasks/' + opts.taskId + '/results?strategy_id=' + opts.strategy + '&limit=' + (opts.limit ?? '50'));
        const rows = response.results ?? [];
        if (rows.length === 0) {
          console.log(pc.yellow('No results found'));
          return;
        }
        console.log(pc.bold(`\nResults (${rows.length}):`));
        console.log(pc.dim('─'.repeat(80)));
        for (const r of rows) {
          const id = String(r.id ?? '').slice(0, 8);
          const dynamicKeys = Object.keys(r).filter(k => ![
            'id', 'task_id', 'target_type', 'target_id', 'post_id', 'strategy_version', 'raw_response', 'error', 'analyzed_at'
          ].includes(k));
          const summary = dynamicKeys.map(k => `${k}=${JSON.stringify(r[k]).slice(0, 30)}`).join(' ');
          console.log(`  ${pc.green(id)} ${summary}`);
        }
        console.log(pc.dim('─'.repeat(80)));
      } catch (err: unknown) {
        console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  result
    .command('stats')
    .description('Show statistics for a task and strategy')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--strategy <id>', 'Strategy ID')
    .action(async (opts: { taskId: string; strategy: string }) => {
      try {
        const stats = await apiGet<Record<string, unknown>>('/strategies/' + opts.strategy + '/stats?task_id=' + opts.taskId);
        console.log(pc.bold(`\nStatistics:`));
        console.log(pc.dim('─'.repeat(40)));
        console.log(`  Total: ${stats.total ?? 0}`);
        const numeric = stats.numeric as Record<string, Record<string, number>> | undefined;
        if (numeric && Object.keys(numeric).length > 0) {
          console.log('\n  Numeric:');
          for (const [col, agg] of Object.entries(numeric)) {
            console.log(`    ${col}: avg=${agg.avg.toFixed(2)} min=${agg.min} max=${agg.max}`);
          }
        }
        const text = stats.text as Record<string, Record<string, number>> | undefined;
        if (text && Object.keys(text).length > 0) {
          console.log('\n  Distribution:');
          for (const [col, dist] of Object.entries(text)) {
            console.log(`    ${col}:`);
            for (const [val, cnt] of Object.entries(dist)) {
              console.log(`      ${val}: ${cnt}`);
            }
          }
        }
        // New: call full stats for array field aggregation
        try {
          const fullStats = await apiGet<Record<string, unknown>>('/strategies/' + opts.strategy + '/full-stats?task_id=' + opts.taskId);
          const array = fullStats.array as Record<string, unknown> | undefined;
          if (array && Object.keys(array).length > 0) {
            console.log('\n  Array Fields:');
            for (const [col, data] of Object.entries(array)) {
              if ((data as any)?.skipped) {
                console.log(`    ${col} (JSON) → ${(data as any).hint}`);
                continue;
              }
              const rows = (data as any)?.varchar_array as AggregateRow[] | undefined;
              if (rows && rows.length > 0) {
                const valKey = `${col}_val`;
                const cntKey = `${col}_count`;
                console.log(`    ${col}:`);
                for (const row of rows.slice(0, 10)) {
                  const val = row[valKey];
                  const cnt = row[cntKey];
                  console.log(`      ${val}  ${cnt}`);
                }
                if (rows.length > 10) console.log(`      ... (${rows.length} total)`);
              }
            }
          }
        } catch {
          // strategy.result.fullStats not available yet, skip silently
        }
        console.log(pc.dim('─'.repeat(40)));
      } catch (err: unknown) {
        console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  result
    .command('export')
    .description('Export results for a task and strategy')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--strategy <id>', 'Strategy ID')
    .option('--format <fmt>', 'Output format (csv/json)', 'json')
    .option('--output <path>', 'Output file path')
    .action(async (opts: { taskId: string; strategy: string; format: string; output?: string }) => {
      try {
        const result = await apiPost<{ content: string; writtenTo: string | null; count: number }>('/strategies/' + opts.strategy + '/export', {
          task_id: opts.taskId,
          format: opts.format,
          output: opts.output ?? null,
        });
        if (!opts.output) {
          process.stdout.write(result.content);
        } else {
          console.log(pc.green(`Exported ${result.count} rows to ${opts.output}`));
        }
      } catch (err: unknown) {
        console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });

  result
    .command('aggregate')
    .description('Aggregate a specific field from strategy results')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--strategy <id>', 'Strategy ID')
    .requiredOption('--group-by <field>', 'Field to aggregate')
    .option('--agg <fn>', 'Aggregation function (count/sum/avg/min/max)', 'count')
    .option('--json-key <key>', 'JSON key to extract for JSON array fields')
    .option('--having <condition>', 'Filter aggregated results (e.g. "count > 2")')
    .option('--limit <n>', 'Max result rows', '50')
    .option('--format <fmt>', 'Output format (table/csv/json)', 'table')
    .option('--output <path>', 'Output file path')
    .action(async (opts: AggregateOpts) => {
      try {
        const rows = await apiPost<AggregateRow[]>('/strategies/' + opts.strategy + '/aggregate', {
          task_id: opts.taskId,
          field: opts.groupBy,
          agg: opts.agg,
          json_key: opts.jsonKey,
          having: opts.having ?? null,
          limit: parseInt(opts.limit ?? '50', 10),
        });

        if (rows.length === 0) {
          console.log(pc.yellow('No results'));
          return;
        }

        const output = formatAggregateOutput(rows, opts.format ?? 'table', opts.output);
        if (opts.output) {
          fs.writeFileSync(opts.output, output);
          console.log(pc.green(`Wrote ${rows.length} rows to ${opts.output}`));
        } else {
          process.stdout.write(output);
        }
      } catch (err: unknown) {
        console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
        process.exit(1);
      }
    });
}
