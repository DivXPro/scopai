interface MediaBlock {
  type: string;
  source: { type: 'base64'; media_type: string; data: string };
}

interface CachedMediaEntry {
  blocks: MediaBlock[];
  createdAt: number;
}

const cache = new Map<string, CachedMediaEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes, matching Anthropic cache window

export function getCachedMediaBlocks(postId: string): MediaBlock[] | null {
  const cached = cache.get(postId);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
    cache.delete(postId);
    return null;
  }
  return cached.blocks;
}

export function setCachedMediaBlocks(postId: string, blocks: MediaBlock[]): void {
  cache.set(postId, { blocks, createdAt: Date.now() });
}

export function cleanupExpiredMediaCache(): void {
  const now = Date.now();
  for (const [key, value] of cache) {
    if (now - value.createdAt > CACHE_TTL_MS) {
      cache.delete(key);
    }
  }
}
