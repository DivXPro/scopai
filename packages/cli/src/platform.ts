import { Command } from 'commander';
import * as pc from 'picocolors';
import { apiGet, apiPost } from './api-client';

export function platformCommands(program: Command): void {
  const platform = program.command('platform').description('Platform management');

  platform
    .command('add')
    .description('Add a new platform')
    .requiredOption('--id <id>', 'Platform ID')
    .requiredOption('--name <name>', 'Platform name')
    .option('--description <desc>', 'Platform description')
    .action(async (opts: { id: string; name: string; description?: string }) => {
      const result = await apiPost<{ id: string; existed?: boolean }>('/platforms', { id: opts.id, name: opts.name, description: opts.description ?? null });
      if (result.existed) {
        console.log(pc.yellow(`Platform already exists: ${opts.id}`));
      } else {
        console.log(pc.green(`Platform added: ${opts.id}`));
      }
    });

  platform
    .command('list')
    .alias('ls')
    .description('List all registered platforms')
    .action(async () => {
      const platforms = await apiGet<any[]>('/platforms');
      if (platforms.length === 0) {
        console.log(pc.yellow('No platforms registered. Run daemon first.'));
        return;
      }
      console.log(pc.bold('\nPlatforms:'));
      console.log(pc.dim('─'.repeat(60)));
      for (const p of platforms) {
        console.log(`  ${pc.green(p.id.padEnd(12))} ${p.name.padEnd(18)} ${p.description ?? ''}`);
      }
      console.log(pc.dim('─'.repeat(60)));
      console.log(`Total: ${platforms.length}\n`);
    });

  const mapping = platform.command('mapping').description('Field mapping management');

  mapping
    .command('list')
    .alias('ls')
    .description('List field mappings for a platform')
    .requiredOption('--platform <id>', 'Platform ID')
    .option('--entity <type>', 'Entity type (post/comment)')
    .action(async (opts: { platform: string; entity?: string }) => {
      const params = new URLSearchParams();
      if (opts.entity) params.set('entity', opts.entity);
      const mappings = await apiGet<any[]>('/platforms/' + opts.platform + '/mappings?' + params.toString());
      if (mappings.length === 0) {
        console.log(pc.yellow(`No mappings found for platform: ${opts.platform}`));
        return;
      }
      console.log(pc.bold(`\nField mappings for ${opts.platform}:`));
      console.log(pc.dim('─'.repeat(80)));
      console.log(
        `  ${'System Field'.padEnd(20)} ${'Platform Field'.padEnd(22)} ${'Type'.padEnd(10)} Required`
      );
      console.log(pc.dim('─'.repeat(80)));
      for (const m of mappings) {
        console.log(
          `  ${m.system_field.padEnd(20)} ${m.platform_field.padEnd(22)} ${m.data_type.padEnd(10)} ${m.is_required ? pc.green('yes') : pc.gray('no')}`
        );
      }
      console.log(pc.dim('─'.repeat(80)));
      console.log(`Total: ${mappings.length}\n`);
    });
}
