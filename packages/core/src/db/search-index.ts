import { Jieba } from '@node-rs/jieba';
import { dict } from '@node-rs/jieba/dict';
import { query, run } from './client';
import { generateId } from '../shared/utils';

const jieba = Jieba.withDict(dict);
let ftsInitialized = false;

export async function initFtsIndex(): Promise<void> {
  if (ftsInitialized) return;

  const hasTable = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'search_index'",
  );
  if (hasTable.length === 0) return;

  await run('INSTALL fts');
  await run('LOAD fts');

  const hasFts = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'fts_main_search_index'",
  );

  if (hasFts.length === 0) {
    await run(
      `PRAGMA create_fts_index(
        'search_index',
        'id',
        'searchable_text',
        stemmer = 'none',
        stopwords = 'none',
        lower = 1
      )`,
    );
  }

  ftsInitialized = true;
}

export async function rebuildFtsIndex(): Promise<void> {
  const hasTable = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'search_index'",
  );
  if (hasTable.length === 0) return;

  await run('INSTALL fts');
  await run('LOAD fts');

  try {
    await run("PRAGMA drop_fts_index('search_index')");
  } catch {
    // Index may not exist
  }

  await run(
    `PRAGMA create_fts_index(
      'search_index',
      'id',
      'searchable_text',
      stemmer = 'none',
      stopwords = 'none',
      lower = 1
    )`,
  );

  ftsInitialized = true;
}

export async function insertSearchIndex(
  postId: string,
  sourceType: string,
  searchableText: string,
  weight = 1.0,
): Promise<void> {
  const id = generateId();
  await run(
    `INSERT INTO search_index (id, post_id, source_type, searchable_text, weight, updated_at) VALUES (?, ?, ?, ?, ?, NOW())`,
    [id, postId, sourceType, searchableText, weight],
  );
}

export function segmentSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return '';
  const segmented = jieba.cut(trimmed, false);
  return segmented.join(' ');
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
    score: number;
  }>
> {
  const segmentedQuery = segmentSearchQuery(queryText);
  if (!segmentedQuery) return [];

  await initFtsIndex();

  const conditions = ['s.score IS NOT NULL'];
  const params: unknown[] = [segmentedQuery];

  if (platformId) {
    conditions.push('p.platform_id = ?');
    params.push(platformId);
  }
  if (starred) {
    conditions.push('p.is_starred = true');
  }

  return query(
    `SELECT s.post_id, p.title, p.content, p.author_name, p.platform_id, s.searchable_text as matched_snippet, s.score
     FROM (
       SELECT *, fts_main_search_index.match_bm25(id, ?) AS score
       FROM search_index
     ) s
     JOIN posts p ON s.post_id = p.id
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.score DESC
     LIMIT ?`,
    [...params, limit],
  );
}

export function buildSearchableText(data: Record<string, unknown>): string {
  const texts: string[] = [];
  function extract(value: unknown) {
    if (typeof value === 'string') texts.push(value);
    else if (Array.isArray(value)) value.forEach(extract);
    else if (value && typeof value === 'object') Object.values(value).forEach(extract);
  }
  extract(data);
  const flatText = texts.join(' ');
  if (!flatText) return '';

  const segmented = jieba.cut(flatText, false);
  return segmented.join(' ');
}
