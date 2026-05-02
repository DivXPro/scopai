/**
 * Standalone script for seeding media_files rows in tests.
 * Spawned as a separate child process so DuckDB file handles fully release on exit.
 *
 * Usage:
 *   tsx seed-media.ts <dbPath> <mediaRoot> <validFile>
 * Outputs JSON to stdout: { validId, unsafeId, missingId }
 */
import * as path from 'node:path';

async function main() {
  const [, , dbPath, mediaRoot, validFile] = process.argv;
  if (!dbPath || !mediaRoot || !validFile) {
    console.error('Usage: tsx seed-media.ts <dbPath> <mediaRoot> <validFile>');
    process.exit(1);
  }

  process.env.ANALYZE_CLI_DB_PATH = dbPath;
  process.env.ANALYZE_CLI_MEDIA_DIR = mediaRoot;
  process.env.ANALYZE_CLI_LOG_LEVEL = 'error';

  const core = await import('@scopai/core');
  await core.migrate();

  const m1 = await core.createMediaFile({
    post_id: null,
    comment_id: null,
    platform_id: null,
    media_type: 'image',
    url: 'https://example.com/photo.jpg',
    local_path: validFile,
    width: null,
    height: null,
    duration_ms: null,
    file_size: null,
    downloaded_at: new Date(),
  });

  const m2 = await core.createMediaFile({
    post_id: null,
    comment_id: null,
    platform_id: null,
    media_type: 'image',
    url: 'https://example.com/etc.jpg',
    local_path: '/etc/hosts',
    width: null,
    height: null,
    duration_ms: null,
    file_size: null,
    downloaded_at: new Date(),
  });

  const m3 = await core.createMediaFile({
    post_id: null,
    comment_id: null,
    platform_id: null,
    media_type: 'image',
    url: 'https://example.com/missing.jpg',
    local_path: path.join(mediaRoot, 'does-not-exist.jpg'),
    width: null,
    height: null,
    duration_ms: null,
    file_size: null,
    downloaded_at: null,
  });

  await core.checkpoint();
  await core.close();

  console.log(JSON.stringify({ validId: m1.id, unsafeId: m2.id, missingId: m3.id }));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
