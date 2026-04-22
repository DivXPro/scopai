import { Command } from 'commander';
import * as pc from 'picocolors';
import { apiGet, apiPost } from './api-client';

export function templateCommands(program: Command): void {
  const template = program.command('template').description('Prompt template management');

  template
    .command('list')
    .alias('ls')
    .description('List all prompt templates')
    .action(async () => {
      const templates = await apiGet<any[]>('/templates');
      if (templates.length === 0) {
        console.log(pc.yellow('No templates found'));
        return;
      }
      console.log(pc.bold('\nPrompt Templates:'));
      console.log(pc.dim('─'.repeat(60)));
      for (const t of templates) {
        const badge = t.is_default ? pc.green(' [default]') : '';
        console.log(`  ${pc.cyan(t.name)}${badge}`);
        if (t.description) console.log(`    ${pc.gray(t.description)}`);
      }
      console.log(pc.dim('─'.repeat(60)));
      console.log(`Total: ${templates.length}\n`);
    });

  template
    .command('show')
    .description('Show template details')
    .requiredOption('--id <id>', 'Template ID')
    .action(async (opts: { id: string }) => {
      try {
        const t = await apiGet<any>('/templates/' + opts.id);
        if (!t || !t.id) {
          console.log(pc.red(`Template not found: ${opts.id}`));
          process.exit(1);
        }
        console.log(pc.bold(`\nTemplate: ${t.name}`));
        console.log(`  ID:       ${t.id}`);
        if (t.description) console.log(`  Desc:     ${t.description}`);
        console.log(`  Default:  ${t.is_default ? pc.green('yes') : 'no'}`);
        console.log(`\n  Content:\n${pc.dim(t.template)}`);
        console.log();
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });

  template
    .command('add')
    .description('Add a new prompt template')
    .requiredOption('--name <name>', 'Template name')
    .requiredOption('--template <text>', 'Template content (with {{variable}} placeholders)')
    .option('--description <desc>', 'Template description')
    .option('--default', 'Set as default template')
    .action(async (opts: { name: string; template: string; description?: string; default?: boolean }) => {
      try {
        await apiPost('/templates', {
          name: opts.name,
          description: opts.description ?? null,
          template: opts.template,
          is_default: opts.default ?? false,
        });
        console.log(pc.green(`Template created: ${opts.name}`));
      } catch (err: unknown) {
        console.log(pc.red(`Failed to create template: ${String(err)}`));
        process.exit(1);
      }
    });

  template
    .command('update')
    .description('Update an existing template')
    .requiredOption('--id <id>', 'Template ID')
    .option('--name <name>', 'New name')
    .option('--template <text>', 'New template content')
    .option('--description <desc>', 'New description')
    .action(async (opts: { id: string; name?: string; template?: string; description?: string }) => {
      const existing = await apiGet<any>('/templates/' + opts.id);
      if (!existing || !existing.id) {
        console.log(pc.red(`Template not found: ${opts.id}`));
        process.exit(1);
      }

      const updates: Record<string, unknown> = {};
      if (opts.name !== undefined) updates.name = opts.name;
      if (opts.template !== undefined) updates.template = opts.template;
      if (opts.description !== undefined) updates.description = opts.description;

      if (Object.keys(updates).length === 0) {
        console.log(pc.yellow('No updates provided'));
        return;
      }

      await apiPost('/templates/' + opts.id, updates);
      console.log(pc.green(`Template updated: ${opts.id}`));
    });

  template
    .command('test')
    .description('Test a template by rendering it with sample input')
    .requiredOption('--id <id>', 'Template ID')
    .option('--input <text>', 'Sample input text')
    .action(async (opts: { id: string; input?: string }) => {
      const tpl = await apiGet<any>('/templates/' + opts.id);
      if (!tpl || !tpl.id) {
        console.log(pc.red(`Template not found: ${opts.id}`));
        process.exit(1);
      }

      let rendered = tpl.template;
      const sampleVars: Record<string, string> = {
        content: opts.input ?? 'This is a sample comment for testing.',
        platform: 'xiaohongshu',
        published_at: new Date().toISOString(),
        author_name: 'TestUser',
      };
      for (const [key, value] of Object.entries(sampleVars)) {
        rendered = rendered.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }

      console.log(pc.bold(`\nTemplate: ${tpl.name}`));
      if (tpl.description) console.log(pc.gray(tpl.description));
      console.log(pc.dim('\n' + '─'.repeat(60)));
      console.log(rendered);
      console.log(pc.dim('─'.repeat(60) + '\n'));
    });
}
