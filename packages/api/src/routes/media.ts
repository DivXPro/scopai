import { FastifyInstance } from 'fastify';
import { createReadStream, existsSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { config, getMediaFileById } from '@scopai/core';

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
};

function guessMime(mediaType: string, filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  if (mediaType === 'image') return 'image/jpeg';
  if (mediaType === 'video') return 'video/mp4';
  if (mediaType === 'audio') return 'audio/mpeg';
  return 'application/octet-stream';
}

function isInsideRoot(absPath: string, rootAbs: string): boolean {
  if (!rootAbs) return false;
  const root = rootAbs.endsWith(path.sep) ? rootAbs : rootAbs + path.sep;
  return absPath === rootAbs || absPath.startsWith(root);
}

export default async function mediaRoutes(app: FastifyInstance) {
  app.get('/media/:id/file', async (request, reply) => {
    const { id } = request.params as { id: string };

    const media = await getMediaFileById(id);
    if (!media || !media.local_path) {
      reply.code(404);
      return { error: 'Media not found' };
    }

    const abs = path.resolve(media.local_path);
    const allowedRoots = [config.paths.media_dir, config.paths.download_dir]
      .filter((r): r is string => Boolean(r))
      .map((r) => path.resolve(r));

    if (!allowedRoots.some((root) => isInsideRoot(abs, root))) {
      reply.code(403);
      return { error: 'Forbidden path' };
    }

    let resolvedPath = abs;
    if (!existsSync(resolvedPath)) {
      // opencli may have downloaded directly under download_dir/{noteId}/
      // instead of download_dir/{platform}/{noteId}/ — try without platform segment
      for (const root of allowedRoots) {
        if (abs.startsWith(root + path.sep)) {
          const relative = abs.slice(root.length + 1);
          const parts = relative.split(path.sep);
          if (parts.length >= 2) {
            const candidate = path.join(root, ...parts.slice(1));
            if (existsSync(candidate)) {
              resolvedPath = candidate;
              break;
            }
          }
        }
      }
    }

    if (!existsSync(resolvedPath)) {
      reply.code(404);
      return { error: 'File missing on disk' };
    }

    if (!allowedRoots.some((root) => isInsideRoot(resolvedPath, root))) {
      reply.code(403);
      return { error: 'Forbidden path' };
    }

    const stat = statSync(resolvedPath);
    reply.header('Content-Type', guessMime(media.media_type, resolvedPath));
    reply.header('Content-Length', String(stat.size));
    reply.header('Cache-Control', 'private, max-age=3600');
    return reply.send(createReadStream(resolvedPath));
  });
}
