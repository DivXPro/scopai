import { query, run } from './client';

export async function insertSearchIndex(
  postId: string,
  sourceType: string,
  searchableText: string,
  weight = 1.0,
): Promise<void> {
  await run(
    `INSERT INTO search_index (post_id, source_type, searchable_text, weight, updated_at) VALUES (?, ?, ?, ?, NOW())`,
    [postId, sourceType, searchableText, weight],
  );
}

export async function searchPostsByQueryWithPostJoin(
  queryText: string,
  limit = 5,
  platformId?: string,
  starred?: boolean,
): Promise<
  Array<{
    post_id: string;
    title: string | null;
    content: string;
    author_name: string | null;
    platform_id: string;
    matched_snippet: string;
  }>
> {
  const likePattern = `%${queryText}%`;
  const conditions = ['s.searchable_text LIKE ?'];
  const params: unknown[] = [likePattern];
  if (platformId) {
    conditions.push('p.platform_id = ?');
    params.push(platformId);
  }
  if (starred) {
    conditions.push('p.is_starred = true');
  }
  return query(
    `SELECT DISTINCT s.post_id, p.title, p.content, p.author_name, p.platform_id, s.searchable_text as matched_snippet
     FROM search_index s
     JOIN posts p ON s.post_id = p.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.weight DESC
     LIMIT ?`,
    [...params, limit],
  );
}

export function buildSearchableText(data: unknown): string {
  const texts: string[] = [];
  function extract(value: unknown) {
    if (typeof value === 'string') texts.push(value);
    else if (Array.isArray(value)) value.forEach(extract);
    else if (value && typeof value === 'object') Object.values(value).forEach(extract);
  }
  extract(data);
  return texts.join(' ');
}
