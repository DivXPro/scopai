import { query, run } from './client';
import { PromptTemplate } from '../shared/types';

export function createTemplate(template: PromptTemplate): void {
  run(
    `INSERT INTO prompt_templates (id, name, description, template, is_default, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [template.id, template.name, template.description, template.template, template.is_default, template.created_at]
  );
}

export function listTemplates(): PromptTemplate[] {
  return query<PromptTemplate>('SELECT * FROM prompt_templates ORDER BY name');
}

export function getTemplateById(id: string): PromptTemplate | null {
  const rows = query<PromptTemplate>('SELECT * FROM prompt_templates WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export function getTemplateByName(name: string): PromptTemplate | null {
  const rows = query<PromptTemplate>('SELECT * FROM prompt_templates WHERE name = ?', [name]);
  return rows[0] ?? null;
}

export function updateTemplate(id: string, updates: Partial<PromptTemplate>): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); params.push(updates.description); }
  if (updates.template !== undefined) { sets.push('template = ?'); params.push(updates.template); }
  if (updates.is_default !== undefined) { sets.push('is_default = ?'); params.push(updates.is_default); }
  if (sets.length === 0) return;
  params.push(id);
  run(`UPDATE prompt_templates SET ${sets.join(', ')} WHERE id = ?`, params);
}

export function setDefaultTemplate(id: string): void {
  run('UPDATE prompt_templates SET is_default = false');
  run('UPDATE prompt_templates SET is_default = true WHERE id = ?', [id]);
}
