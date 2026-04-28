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

export async function listCreatorFieldMappings(platformId: string): Promise<CreatorFieldMapping[]> {
  return query<CreatorFieldMapping>(
    'SELECT * FROM creator_field_mappings WHERE platform_id = ? ORDER BY system_field',
    [platformId],
  );
}

export async function deleteCreatorFieldMapping(id: string): Promise<void> {
  await run('DELETE FROM creator_field_mappings WHERE id = ?', [id]);
}
