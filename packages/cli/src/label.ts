import { Command } from 'commander';
import { apiGet, apiPost, apiDelete } from './api-client';

export function registerLabelCommands(program: Command) {
  const label = program.command('label').description('Manage labels for posts');

  label
    .command('list')
    .description('List all labels')
    .action(async () => {
      const labels = await apiGet('/labels');
      if (!Array.isArray(labels) || labels.length === 0) {
        console.log('No labels found.');
        return;
      }
      console.log('Labels:');
      for (const l of labels) {
        const count = l.post_count ?? 0;
        const color = l.color ? ` (${l.color})` : '';
        console.log(`  ${l.name}${color} — ${count} post${count !== 1 ? 's' : ''}`);
      }
    });

  label
    .command('create')
    .description('Create a new label')
    .requiredOption('--name <name>', 'Label name')
    .option('--color <color>', 'Label color')
    .action(async (opts) => {
      const result = await apiPost('/labels', { name: opts.name, color: opts.color });
      console.log(`Label created: ${result.name} (${result.id})`);
    });

  label
    .command('delete')
    .description('Delete a label')
    .requiredOption('--id <id>', 'Label ID')
    .action(async (opts) => {
      await apiDelete(`/labels/${opts.id}`);
      console.log('Label deleted.');
    });

  return label;
}
