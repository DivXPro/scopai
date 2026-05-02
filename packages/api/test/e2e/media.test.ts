import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as child_process from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, fetchApi } from './helpers';
import type { TestContext } from './helpers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let ctx: TestContext;
let mediaRoot: string;
let validMediaId: string;
let unsafeMediaId: string;
let missingFileMediaId: string;
let validBytes: Buffer;

describe('Media file route', () => {
  before(async () => {
    mediaRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scopai-media-root-'));

    const validFile = path.join(mediaRoot, 'photo.jpg');
    validBytes = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10,
      0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01,
      0x00, 0x00,
    ]);
    fs.writeFileSync(validFile, validBytes);

    ctx = await startServer({
      env: { ANALYZE_CLI_MEDIA_DIR: mediaRoot },
      seed: async (dbPath) => {
        // Run seeding in an isolated child process so DuckDB file handles
        // fully release before the API server child opens the same DB.
        const seedScript = path.join(__dirname, 'seed-media.ts');
        const result = child_process.spawnSync(
          'node',
          ['--import', 'tsx', seedScript, dbPath, mediaRoot, validFile],
          { encoding: 'utf-8' },
        );
        if (result.status !== 0) {
          throw new Error(
            `Seed script failed (exit ${result.status})\nstderr: ${result.stderr}\nstdout: ${result.stdout}`,
          );
        }
        const ids = JSON.parse(result.stdout.trim());
        validMediaId = ids.validId;
        unsafeMediaId = ids.unsafeId;
        missingFileMediaId = ids.missingId;
      },
    });
  });

  after(async () => {
    await ctx.cleanup();
    fs.rmSync(mediaRoot, { recursive: true, force: true });
  });

  it('returns 200 with file bytes for valid media id', async () => {
    const res = await fetchApi(ctx.baseUrl, `/api/media/${validMediaId}/file`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /image\/jpeg/);
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(body.length, validBytes.length);
    assert.ok(body.equals(validBytes));
  });

  it('returns 404 for unknown media id', async () => {
    const res = await fetchApi(ctx.baseUrl, '/api/media/nonexistent-id/file');
    assert.equal(res.status, 404);
  });

  it('returns 403 when local_path is outside the whitelist root', async () => {
    const res = await fetchApi(ctx.baseUrl, `/api/media/${unsafeMediaId}/file`);
    assert.equal(res.status, 403);
  });

  it('returns 404 when the on-disk file is missing', async () => {
    const res = await fetchApi(ctx.baseUrl, `/api/media/${missingFileMediaId}/file`);
    assert.equal(res.status, 404);
  });
});
