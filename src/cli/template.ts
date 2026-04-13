import { Command } from 'commander';
import * as pc from 'picocolors';
import { listTemplates, getTemplateById, updateTemplate } from '../db/templates';
import { runMigrations } from '../db/migrate';
import { seedAll } from '../db/seed';
import { generateId, now } from '../shared/utils';

export function templateCommands(program: Command): void {
  const template = program.command('template').description('Prompt template management');

  template
    .command('list')
    .alias('ls')
    .description('List all prompt templates')
    .action(async () => {
      await runMigrations();
      await seedAll();
      const templates = await listTemplates();
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
    .command('add')
    .description('Add a new prompt template')
    .requiredOption('--name <name>', 'Template name')
    .requiredOption('--template <text>', 'Template content (with {{variable}} placeholders)')
    .option('--description <desc>', 'Template description')
    .option('--default', 'Set as default template')
    .action(async (opts: { name: string; template: string; description?: string; default?: boolean }) => {
      await runMigrations();
      await seedAll();

      const id = generateId();
      try {
        // If --default, unset other defaults first
        if (opts.default) {
          await updateTemplate(id, { is_default: false }); // will be set on insert
        }
        const { createTemplate } = require('../db/templates');
        await createTemplate({
          id,
          name: opts.name,
          description: opts.description ?? null,
          template: opts.template,
          is_default: opts.default ?? false,
          created_at: now(),
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
      await runMigrations();
      await seedAll();

      const existing = await getTemplateById(opts.id);
      if (!existing) {
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

      await updateTemplate(opts.id, updates);
      console.log(pc.green(`Template updated: ${opts.id}`));
    });

  template
    .command('test')
    .description('Test a template by rendering it with sample input')
    .requiredOption('--id <id>', 'Template ID')
    .option('--input <text>', 'Sample input text')
    .action(async (opts: { id: string; input?: string }) => {
      await runMigrations();
      await seedAll();

      const tpl = await getTemplateById(opts.id);
      if (!tpl) {
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
