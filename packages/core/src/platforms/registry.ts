import type { PlatformAdapter } from './types';

const adapters = new Map<string, PlatformAdapter>();

export function registerPlatform(adapter: PlatformAdapter): void {
  adapters.set(adapter.id, adapter);
}

export function getPlatformAdapter(platformId: string): PlatformAdapter | undefined {
  return adapters.get(platformId);
}

export function getAllPlatformAdapters(): PlatformAdapter[] {
  return Array.from(adapters.values());
}
