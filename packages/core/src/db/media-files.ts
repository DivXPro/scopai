import { query, run } from './client';
import { MediaFile } from '../shared/types';
import { generateId, now } from '../shared/utils';

export async function createMediaFile(file: Omit<MediaFile, 'id' | 'created_at'>): Promise<MediaFile> {
  const id = generateId();
  const ts = now();
  await run(
    `INSERT INTO media_files (id, post_id, comment_id, platform_id, media_type, url, local_path, width, height, duration_ms, file_size, downloaded_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, file.post_id, file.comment_id, file.platform_id, file.media_type, file.url, file.local_path,
     file.width, file.height, file.duration_ms, file.file_size, file.downloaded_at, ts]
  );
  return { ...file, id, created_at: ts };
}

export async function listMediaFilesByPost(postId: string): Promise<MediaFile[]> {
  return query<MediaFile>('SELECT * FROM media_files WHERE post_id = ? ORDER BY created_at', [postId]);
}

export async function countMediaFilesByPost(postId: string): Promise<number> {
  const rows = await query<{ cnt: bigint }>('SELECT COUNT(*) as cnt FROM media_files WHERE post_id = ?', [postId]);
  return Number(rows[0]?.cnt ?? 0);
}

export async function getMediaFileById(id: string): Promise<MediaFile | null> {
  const rows = await query<MediaFile>('SELECT * FROM media_files WHERE id = ?', [id]);
  return rows[0] ?? null;
}
