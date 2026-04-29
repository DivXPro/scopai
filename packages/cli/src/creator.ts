import { Command } from 'commander';
import * as pc from 'picocolors';
import { apiGet, apiPost, apiDelete } from './api-client';

export function creatorCommands(program: Command): void {
  const creator = program.command('creator').description('Creator subscription management');

  creator
    .command('add')
    .description('Subscribe to a creator')
    .requiredOption('--platform <id>', 'Platform ID')
    .requiredOption('--author-id <id>', 'Platform author ID')
    .option('--name <name>', 'Author name')
    .action(async (opts: { platform: string; authorId: string; name?: string }) => {
      try {
        const result = await apiPost('/creators', {
          platform_id: opts.platform,
          platform_author_id: opts.authorId,
          author_name: opts.name,
        });
        console.log(pc.green(`Subscribed to creator: ${result.id}`));
      } catch (err: unknown) {
        const msg = (err as Error).message;
        if (msg.includes('already subscribed')) {
          console.log(pc.yellow('Creator already subscribed'));
        } else {
          console.log(pc.red(`Error: ${msg}`));
          process.exit(1);
        }
      }
    });

  creator
    .command('list')
    .alias('ls')
    .description('List subscribed creators')
    .option('--platform <id>', 'Filter by platform')
    .option('--status <status>', 'Filter by status (active/paused/unsubscribed)')
    .action(async (opts: { platform?: string; status?: string }) => {
      const params = new URLSearchParams();
      if (opts.platform) params.set('platform', opts.platform);
      if (opts.status) params.set('status', opts.status);
      const result = await apiGet<{ items: any[]; total: number }>('/creators?' + params.toString());
      const creators = result.items ?? [];
      if (creators.length === 0) {
        console.log(pc.yellow('No creators found'));
        return;
      }
      console.log(pc.bold(`\nCreators (${result.total} total):`));
      console.log(pc.dim('─'.repeat(80)));
      for (const c of creators) {
        const statusColor = c.status === 'active' ? pc.green : c.status === 'paused' ? pc.yellow : pc.gray;
        console.log(`  ${pc.cyan(c.id.slice(0, 8))} ${pc.cyan(c.platform_id)} ${c.author_name ?? 'Unknown'} ${statusColor(`[${c.status}]`)}`);
        if (c.last_synced_at) {
          console.log(`    Last sync: ${new Date(c.last_synced_at).toLocaleString()}`);
        }
      }
      console.log(pc.dim('─'.repeat(80)));
    });

  creator
    .command('show')
    .description('Show creator details')
    .requiredOption('--id <id>', 'Creator ID')
    .action(async (opts: { id: string }) => {
      const c = await apiGet<any>(`/creators/${opts.id}`);
      console.log(pc.bold(`\nCreator: ${c.author_name ?? 'Unknown'}`));
      console.log(`  ID:        ${c.id}`);
      console.log(`  Platform:  ${c.platform_id}`);
      console.log(`  Author ID: ${c.platform_author_id}`);
      console.log(`  Status:    ${c.status}`);
      console.log(`  Followers: ${c.follower_count}`);
      if (c.last_synced_at) {
        console.log(`  Last Sync: ${new Date(c.last_synced_at).toLocaleString()}`);
      }

      const logs = await apiGet<any[]>(`/creators/${opts.id}/sync-logs?limit=5`);
      if (logs.length > 0) {
        console.log(pc.bold('\nRecent Syncs:'));
        for (const log of logs) {
          const status = log.status === 'success' ? pc.green('✓') : log.status === 'partial' ? pc.yellow('~') : pc.red('✗');
          const summary = typeof log.result_summary === 'string' ? JSON.parse(log.result_summary) : (log.result_summary ?? {});
          console.log(`  ${status} ${log.sync_type} — imported:${summary.imported ?? 0} updated:${summary.updated ?? 0} ${new Date(log.started_at).toLocaleString()}`);
        }
      }
      console.log();
    });

  creator
    .command('sync')
    .description('Trigger manual sync for a creator')
    .requiredOption('--id <id>', 'Creator ID')
    .option('--initial', 'Import all historical posts')
    .action(async (opts: { id: string; initial?: boolean }) => {
      const result = await apiPost(`/creators/${opts.id}/sync`, {
        sync_type: opts.initial ? 'initial' : 'periodic',
      });
      console.log(pc.green(`Sync job created: ${result.job_id}`));
    });

  creator
    .command('sync-profile')
    .description('Sync creator profile info (bio, avatar, follower count)')
    .requiredOption('--id <id>', 'Creator ID')
    .action(async (opts: { id: string }) => {
      const result = await apiPost(`/creators/${opts.id}/sync-profile`);
      console.log(pc.green(`Profile sync job created: ${result.job_id}`));
    });

  creator
    .command('remove')
    .description('Unsubscribe from a creator')
    .requiredOption('--id <id>', 'Creator ID')
    .action(async (opts: { id: string }) => {
      await apiDelete(`/creators/${opts.id}`);
      console.log(pc.green('Creator unsubscribed'));
    });

  creator
    .command('pause')
    .description('Pause automatic sync')
    .requiredOption('--id <id>', 'Creator ID')
    .action(async (opts: { id: string }) => {
      await apiPost(`/creators/${opts.id}/pause`);
      console.log(pc.yellow('Sync paused'));
    });

  creator
    .command('resume')
    .description('Resume automatic sync')
    .requiredOption('--id <id>', 'Creator ID')
    .action(async (opts: { id: string }) => {
      await apiPost(`/creators/${opts.id}/resume`);
      console.log(pc.green('Sync resumed'));
    });
}
