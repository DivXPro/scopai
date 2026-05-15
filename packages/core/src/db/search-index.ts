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
  return query(
    `SELECT DISTINCT s.post_id, p.title, p.content, p.author_name, p.platform_id, s.searchable_text as matched_snippet
     FROM search_index s
     JOIN posts p ON s.post_id = p.id
     WHERE s.searchable_text LIKE ?
     ORDER BY s.weight DESC
     LIMIT ?`,
    [likePattern, limit],
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
