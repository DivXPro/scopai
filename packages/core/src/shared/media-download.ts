import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export async function downloadImage(url: string, destPath: string): Promise<string> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }

  const dir = path.dirname(destPath);
  await fs.mkdir(dir, { recursive: true });

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(destPath, buffer);

  return destPath;
}
