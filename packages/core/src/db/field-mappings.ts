import { query, run } from './client';
import { FieldMapping } from '../shared/types';

export async function createFieldMapping(mapping: FieldMapping): Promise<void> {
  await run(
    `INSERT INTO field_mappings (id, platform_id, entity_type, system_field, platform_field, data_type, is_required, transform_expr, description)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [mapping.id, mapping.platform_id, mapping.entity_type, mapping.system_field, mapping.platform_field,
     mapping.data_type, mapping.is_required, mapping.transform_expr, mapping.description]
  );
}

export async function listFieldMappings(platformId?: string, entityType?: string): Promise<FieldMapping[]> {
  let sql = 'SELECT * FROM field_mappings';
  const params: unknown[] = [];
  const conditions: string[] = [];
  if (platformId) { conditions.push('platform_id = ?'); params.push(platformId); }
  if (entityType) { conditions.push('entity_type = ?'); params.push(entityType); }
  if (conditions.length > 0) { sql += ' WHERE ' + conditions.join(' AND '); }
  sql += ' ORDER BY system_field';
  return query<FieldMapping>(sql, params);
}

export async function getMappingsForPlatform(platformId: string, entityType: string): Promise<FieldMapping[]> {
  return listFieldMappings(platformId, entityType);
}
