import { query, run } from './client';
import { PromptTemplate } from '../shared/types';

export async function createTemplate(template: PromptTemplate): Promise<void> {
  await run(
    `INSERT INTO prompt_templates (id, name, description, template, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [template.id, template.name, template.description, template.template, template.is_default, template.created_at]
  );
}

export async function listTemplates(): Promise<PromptTemplate[]> {
  return query<PromptTemplate>('SELECT * FROM prompt_templates ORDER BY name');
}

export async function getTemplateById(id: string): Promise<PromptTemplate | null> {
  const rows = await query<PromptTemplate>('SELECT * FROM prompt_templates WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function getTemplateByName(name: string): Promise<PromptTemplate | null> {
  const rows = await query<PromptTemplate>('SELECT * FROM prompt_templates WHERE name = ?', [name]);
  return rows[0] ?? null;
}

export async function updateTemplate(id: string, updates: Partial<PromptTemplate>): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description); }
  if (updates.template !== undefined) { sets.push('template = ?'); params.push(updates.template); }
  if (updates.is_default !== undefined) { sets.push('is_default = ?'); params.push(updates.is_default); }
  if (sets.length === 0) return;
  params.push(id);
  await run(`UPDATE prompt_templates SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function setDefaultTemplate(id: string): Promise<void> {
  await run('UPDATE prompt_templates SET is_default = false');
  await run('UPDATE prompt_templates SET is_default = true WHERE id = ?', [id]);
}
