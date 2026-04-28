import { query, run } from './client';
import { CreatorFieldMapping } from '../shared/types';
import { generateId } from '../shared/utils';

export async function createCreatorFieldMapping(
  data: Omit<CreatorFieldMapping, 'id'>,
): Promise<CreatorFieldMapping> {
  const id = generateId();
  await run(
    `INSERT INTO creator_field_mappings (id, platform_id, entity_type, system_field, platform_field,
     data_type, is_required, transform_expr, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.platform_id,
      data.entity_type,
      data.system_field,
      data.platform_field,
      data.data_type,
      data.is_required,
      data.transform_expr,
      data.description,
    ],
  );
  return { ...data, id };
}

export async function getCreatorFieldMappingById(id: string): Promise<CreatorFieldMapping | null> {
  const rows = await query<CreatorFieldMapping>(
    'SELECT * FROM creator_field_mappings WHERE id = ?',
    [id],
  );
  return rows[0] ?? null;
}

export async function listCreatorFieldMappings(platformId?: string): Promise<CreatorFieldMapping[]> {
  if (platformId) {
    return query<CreatorFieldMapping>(
      'SELECT * FROM creator_field_mappings WHERE platform_id = ? ORDER BY system_field',
      [platformId],
    );
  }
  return query<CreatorFieldMapping>('SELECT * FROM creator_field_mappings ORDER BY system_field');
}

export async function getCreatorMappingsForPlatform(
  platformId: string,
): Promise<CreatorFieldMapping[]> {
  return listCreatorFieldMappings(platformId);
}

export async function updateCreatorFieldMapping(
  id: string,
  updates: Partial<Omit<CreatorFieldMapping, 'id'>>,
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.platform_id !== undefined) {
    fields.push('platform_id = ?');
    values.push(updates.platform_id);
  }
  if (updates.system_field !== undefined) {
    fields.push('system_field = ?');
    values.push(updates.system_field);
  }
  if (updates.platform_field !== undefined) {
    fields.push('platform_field = ?');
    values.push(updates.platform_field);
  }
  if (updates.data_type !== undefined) {
    fields.push('data_type = ?');
    values.push(updates.data_type);
  }
  if (updates.is_required !== undefined) {
    fields.push('is_required = ?');
    values.push(updates.is_required);
  }
  if (updates.transform_expr !== undefined) {
    fields.push('transform_expr = ?');
    values.push(updates.transform_expr);
  }
  if (updates.description !== undefined) {
    fields.push('description = ?');
    values.push(updates.description);
  }

  if (fields.length === 0) return;
  values.push(id);

  await run(`UPDATE creator_field_mappings SET ${fields.join(', ')} WHERE id = ?`, values);
}

export async function deleteCreatorFieldMapping(id: string): Promise<void> {
  await run('DELETE FROM creator_field_mappings WHERE id = ?', [id]);
}
