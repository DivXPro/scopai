import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execFileAsync = promisify(execFile);
const OPENCLI_TIMEOUT_MS = 60000;
const OPENCLI_MAX_BUFFER = 50 * 1024 * 1024;
const CLI_TIMEOUT_MS = 30000;
const CLI_MAX_BUFFER = 10 * 1024 * 1024;
const DAEMON_START_WAIT_MS = 1500;
const DAEMON_STOP_WAIT_MS = 500;

interface RecordOptions {
  platform: string;
  platformName: string;
  query: string;
  limit: number;
  outputDir: string;
  searchTemplate: string;
  commentsTemplate: string;
  mediaTemplate: string;
  noteIdField: string;
}

function parseArgs(): RecordOptions {
  const args = process.argv.slice(2);
  const getArg = (flag: string, fallback?: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--') ? args[idx + 1] : fallback;
  };

  const platform = getArg('--platform');
  if (!platform) {
    console.error('Usage: npx tsx scripts/record-e2e-fixture.ts --platform <id> --query <q> [options]');
    process.exit(1);
  }

  const limitRaw = getArg('--limit', '3') ?? '3';
  const limitParsed = parseInt(limitRaw, 10);
  const limit = Number.isNaN(limitParsed) ? 3 : limitParsed;

  return {
    platform,
    platformName: getArg('--platform-name', `${platform} (Recorded)`),
    query: getArg('--query', '上海美食'),
    limit,
    outputDir: getArg('--output', `test-data/recorded/${new Date().toISOString().slice(0, 10)}-${platform}-e2e`),
    // Default templates target Xiaohongshu (xhs) platform
    searchTemplate: getArg('--search-template', 'opencli xiaohongshu search {query} --limit {limit} -f json'),
    commentsTemplate: getArg('--comments-template', 'opencli xiaohongshu comments {note_url} --limit 20 -f json'),
    mediaTemplate: getArg('--media-template', 'opencli xiaohongshu download {note_url} --output downloads/xhs -f json'),
    noteIdField: getArg('--note-id-field', 'noteId'),
  };
}

async function runOpencli(template: string, vars: Record<string, string | number>): Promise<{ success: boolean; data?: unknown[]; error?: string }> {
  let cmd = template;
  for (const [key, value] of Object.entries(vars)) {
    cmd = cmd.split(`{${key}}`).join(String(value));
  }
  const tokens = cmd.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { success: false, error: 'Empty opencli template' };
  }
  try {
    const { stdout, stderr } = await execFileAsync(tokens[0], tokens.slice(1), {
      timeout: OPENCLI_TIMEOUT_MS,
      maxBuffer: OPENCLI_MAX_BUFFER,
    });
    const trimmed = stdout.trim();
    if (!trimmed) {
      return { success: true, data: [] };
    }
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      return { success: true, data: [trimmed] };
    }
    if (Array.isArray(data)) {
      return { success: true, data };
    }
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      const arr = ('data' in obj ? obj.data : 'items' in obj ? obj.items : [data]);
      return { success: true, data: Array.isArray(arr) ? arr : [arr] };
    }
    return { success: true, data: [data] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

function getExecProp(obj: unknown, key: 'stdout' | 'stderr'): string {
  if (typeof obj === 'object' && obj !== null && key in obj) {
    const val = (obj as Record<string, unknown>)[key];
    return typeof val === 'string' ? val : '';
  }
  return '';
}

async function runAnalyzeCli(args: string[]): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
  const cliPath = path.join(process.cwd(), 'dist/cli/index.js');
  if (!fs.existsSync(cliPath)) {
    throw new Error(`CLI not built: ${cliPath} missing. Run 'npm run build' first.`);
  }
  try {
    const { stdout, stderr } = await execFileAsync('node', [cliPath, ...args], {
      timeout: CLI_TIMEOUT_MS,
      maxBuffer: CLI_MAX_BUFFER,
    });
    return { success: true, stdout, stderr };
  } catch (err: unknown) {
    const execErr = err instanceof Error ? err : new Error(String(err));
    return {
      success: false,
      stdout: getExecProp(err, 'stdout'),
      stderr: getExecProp(err, 'stderr'),
      error: execErr.message,
    };
  }
}

const DAEMON_PID_FILE = process.env.ANALYZE_CLI_DAEMON_PID || '/tmp/scopai.pid';
const IPC_SOCKET_PATH = process.env.ANALYZE_CLI_IPC_SOCKET || '/tmp/scopai.sock';

function isDaemonRunning(): boolean {
  if (!fs.existsSync(DAEMON_PID_FILE)) return false;
  try {
    const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim(), 10);
    if (isNaN(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureDaemonStarted(): Promise<void> {
  if (isDaemonRunning()) {
    console.log('[record] Daemon already running');
    return;
  }
  console.log('[record] Starting daemon...');
  const result = await runAnalyzeCli(['daemon', 'start']);
  if (!result.success) {
    throw new Error(`Failed to start daemon: ${result.error}`);
  }
  await new Promise(r => setTimeout(r, DAEMON_START_WAIT_MS));
  if (!isDaemonRunning()) {
    throw new Error('Daemon did not start in time');
  }
  console.log('[record] Daemon started');
}

async function stopDaemon(): Promise<void> {
  if (!isDaemonRunning()) return;
  console.log('[record] Stopping daemon...');
  await runAnalyzeCli(['daemon', 'stop']);
  await new Promise(r => setTimeout(r, DAEMON_STOP_WAIT_MS));
}

function extractNoteId(item: any, noteIdField: string): string | undefined {
  const direct = item[noteIdField] ?? item.note_id ?? item.id ?? item.noteId ?? item.platform_post_id;
  if (direct) return String(direct);
  const url = item.url ?? item.link;
  if (typeof url === 'string') {
    try {
      const parsed = new URL(url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      const last = segments[segments.length - 1];
      if (last && /^[a-f0-9]{16,24}$/i.test(last)) {
        return last;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function resolveMediaDownloadDir(template: string, vars: Record<string, string | number>): string {
  let cmd = template;
  for (const [key, value] of Object.entries(vars)) {
    cmd = cmd.split(`{${key}}`).join(String(value));
  }
  const tokens = cmd.trim().split(/\s+/).filter(Boolean);
  const outIdx = tokens.findIndex(t => t === '--output' || t === '-o');
  const rawDir = outIdx !== -1 && tokens[outIdx + 1] ? tokens[outIdx + 1] : './xiaohongshu-downloads';
  return path.resolve(rawDir);
}

function generateOfflineTest(opts: RecordOptions, manifest: any): string {
  const testName = `import-recorded-${opts.platform}`;
  const testFile = path.join(process.cwd(), 'test', `${testName}.test.ts`);
  const fixtureDirRel = path.relative(process.cwd(), opts.outputDir).replace(/\\/g, '/');

  const code = `import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { close as closeDb } from '../dist/db/client.js';
import { runMigrations } from '../dist/db/migrate.js';
import { seedAll } from '../dist/db/seed.js';
import { upsertPlatform } from '../dist/db/platforms.js';
import { createPost, getPostById, listPosts, countPosts } from '../dist/db/posts.js';
import { createComment, listCommentsByPost, countComments } from '../dist/db/comments.js';
import { createMediaFile, listMediaFilesByPost } from '../dist/db/media-files.js';
import { config } from '../dist/config/index.js';
import { expandPath } from '../dist/shared/utils.js';

const FIXTURE_DIR = path.join(process.cwd(), '${fixtureDirRel}');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manifest.json'), 'utf-8'));

describe('import — recorded ${opts.platform} fixture', { timeout: 30000 }, () => {
  let postIds: string[] = [];

  before(async () => {
    closeDb();
    // Remove existing DB file to ensure a clean state for replay
    const dbPath = expandPath(config.database.path);
    try {
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
      }
      // Also remove WAL/shm files if present
      for (const suffix of ['.wal', '.tmp', '.shm']) {
        const ext = dbPath + suffix;
        if (fs.existsSync(ext)) fs.unlinkSync(ext);
      }
    } catch {
      // ignore cleanup errors
    }
    await runMigrations();
    await seedAll();
    await upsertPlatform({ id: MANIFEST.platform, name: 'Recorded Platform' });
  });

  it('should import posts from fixture', async () => {
    const postsFile = path.join(FIXTURE_DIR, MANIFEST.fixtures.posts);
    const content = fs.readFileSync(postsFile, 'utf-8');
    const lines = content.split('\\n').filter((l: string) => l.trim());
    let imported = 0;

    for (const line of lines) {
      try {
        const item = JSON.parse(line);
        const post = await createPost({
          platform_id: MANIFEST.platform,
          platform_post_id: item.platform_post_id ?? item.noteId ?? item.id ?? \`post_\${imported}\`,
          title: item.displayTitle ?? item.title ?? null,
          content: item.desc ?? item.content ?? item.text ?? '',
          author_id: item.user?.userId ?? null,
          author_name: item.user?.nickname ?? item.author_name ?? null,
          author_url: item.author_url ?? null,
          url: item.url ?? null,
          cover_url: item.cover_url ?? null,
          post_type: (item.type ?? null) as any,
          like_count: Number(item.interactInfo?.likedCount ?? item.like_count ?? 0),
          collect_count: Number(item.interactInfo?.collectedCount ?? item.collect_count ?? 0),
          comment_count: Number(item.interactInfo?.commentCount ?? item.comment_count ?? 0),
          share_count: Number(item.share_count ?? 0),
          play_count: Number(item.play_count ?? 0),
          score: item.score ?? null,
          tags: item.tags ?? null,
          media_files: item.media_files ?? null,
          published_at: item.lastUpdateTime ? new Date(item.lastUpdateTime) : (item.published_at ? new Date(item.published_at) : null),
          metadata: item,
        });
        postIds.push(post.id);
        imported++;
      } catch {
        // skip duplicates
      }
    }

    assert.ok(imported > 0, \`expected at least 1 post imported, got \${imported}\`);
    const posts = await listPosts(MANIFEST.platform, 50, 0);
    assert.ok(posts.length >= imported, \`expected at least \${imported} posts in DB\`);
  });

  it('should import comments from fixture', async () => {
    let totalImported = 0;
    for (let idx = 0; idx < MANIFEST.fixtures.comments.length; idx++) {
      const commentFileName = MANIFEST.fixtures.comments[idx];
      const commentFile = path.join(FIXTURE_DIR, commentFileName);
      if (!fs.existsSync(commentFile) || fs.statSync(commentFile).size === 0) continue;
      const content = fs.readFileSync(commentFile, 'utf-8');
      const lines = content.split('\\n').filter((l: string) => l.trim());
      if (lines.length === 0) continue;

      const postId = postIds[idx];
      if (!postId) continue;

      let imported = 0;
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          await createComment({
            post_id: postId,
            platform_id: MANIFEST.platform,
            platform_comment_id: item.id ?? item.commentId ?? \`c_\${imported}\`,
            parent_comment_id: null,
            root_comment_id: null,
            depth: 0,
            author_id: item.author_id ?? null,
            author_name: (item.author ?? item.user?.nickname ?? item.author_name ?? '匿名用户') as string,
            content: (item.text ?? item.content ?? '') as string,
            like_count: Number(item.likes ?? item.likeCount ?? 0),
            reply_count: Number(item.replies ?? item.replyCount ?? 0),
            published_at: item.time ? new Date(String(item.time).split(/[^\\d-]/)[0]) : null,
            metadata: item,
          });
          imported++;
        } catch {
          // skip duplicates
        }
      }
      totalImported += imported;
      const comments = await listCommentsByPost(postId, 100);
      assert.ok(comments.length >= imported, \`expected at least \${imported} comments for post \${postId}\`);
    }
    console.log(\`  Imported \${totalImported} comments from fixtures\`);
  });

  it('should import media from fixture', async () => {
    let totalImported = 0;
    for (let idx = 0; idx < MANIFEST.fixtures.media.length; idx++) {
      const mediaFileName = MANIFEST.fixtures.media[idx];
      const mediaFile = path.join(FIXTURE_DIR, mediaFileName);
      if (!fs.existsSync(mediaFile) || fs.statSync(mediaFile).size === 0) continue;
      const content = fs.readFileSync(mediaFile, 'utf-8');
      const lines = content.split('\\n').filter((l: string) => l.trim());
      if (lines.length === 0) continue;

      const postId = postIds[idx];
      if (!postId) continue;

      let imported = 0;
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          await createMediaFile({
            post_id: postId,
            comment_id: null,
            platform_id: MANIFEST.platform,
            media_type: (item.type ?? 'image') as any,
            url: (item.url ?? \`https://example.com/\${postId}_\${imported}\`) as string,
            local_path: item.local_path ? path.join(FIXTURE_DIR, item.local_path) : null,
            width: item.width ? Number(item.width) : null,
            height: item.height ? Number(item.height) : null,
            duration_ms: item.duration_ms ? Number(item.duration_ms) : null,
            file_size: item.file_size ? Number(item.file_size) : null,
            downloaded_at: item.status === 'success' ? new Date() : null,
          });
          imported++;
        } catch {
          // skip duplicates
        }
      }
      totalImported += imported;
      const mediaList = await listMediaFilesByPost(postId);
      assert.ok(mediaList.length >= imported, \`expected at least \${imported} media for post \${postId}\`);
    }
    console.log(\`  Imported \${totalImported} media from fixtures\`);
  });

  it('should verify imported data integrity', async () => {
    const posts = await listPosts(MANIFEST.platform, 50, 0);
    assert.ok(posts.length > 0, 'expected posts in DB');

    for (const post of posts) {
      assert.ok(post.platform_id === MANIFEST.platform, 'post should have correct platform');
      assert.ok(post.content?.length >= 0, 'post should have content');
    }
  });
});
`;

  fs.writeFileSync(testFile, code);
  console.log(`[record] Generated offline test: ${testFile}`);
  return testFile;
}

async function main() {
  const opts = parseArgs();
  await fs.promises.mkdir(opts.outputDir, { recursive: true });
  console.log(`[record] Output dir: ${opts.outputDir}`);

  await ensureDaemonStarted();
  console.log('[record] Daemon ready');

  // --- Search posts ---
  console.log(`[record] Searching posts: "${opts.query}"`);
  const searchResult = await runOpencli(opts.searchTemplate, { query: opts.query, limit: opts.limit });
  if (!searchResult.success) {
    throw new Error(`Search failed: ${searchResult.error}`);
  }
  const postsRaw = searchResult.data ?? [];
  console.log(`[record] Found ${postsRaw.length} posts`);

  const postsRawFile = path.join(opts.outputDir, 'posts_raw.json');
  fs.writeFileSync(postsRawFile, JSON.stringify(postsRaw, null, 2));

  // Transform to import-compatible JSONL
  const postsForImport = postsRaw.map((item: any, idx: number) => ({
    ...item,
    platform_post_id: extractNoteId(item, opts.noteIdField) ?? `post_${idx}`,
  }));
  const postsJsonlFile = path.join(opts.outputDir, 'posts_transformed.jsonl');
  fs.writeFileSync(postsJsonlFile, postsForImport.map(p => JSON.stringify(p)).join('\n') + '\n');

  // --- Create platform via CLI (if not already exists) ---
  const listPlatResult = await runAnalyzeCli(['platform', 'list']);
  const platformExists = listPlatResult.success && listPlatResult.stdout.includes(opts.platform);
  if (!platformExists) {
    console.log(`[record] Creating platform: ${opts.platform}`);
    const platResult = await runAnalyzeCli([
      'platform', 'add',
      '--id', opts.platform,
      '--name', opts.platformName,
      '--description', `Recorded from query: ${opts.query}`,
    ]);
    if (!platResult.success) {
      console.warn(`[record] Platform add warning: ${platResult.error ?? platResult.stderr}`);
    }
  } else {
    console.log(`[record] Platform ${opts.platform} already exists, skipping creation`);
  }

  // --- Import posts via CLI ---
  console.log(`[record] Importing posts via CLI...`);
  const importResult = await runAnalyzeCli([
    'post', 'import',
    '--platform', opts.platform,
    '--file', postsJsonlFile,
  ]);
  if (!importResult.success) {
    throw new Error(`Post import failed: ${importResult.error}`);
  }
  console.log(`[record] Post import stdout: ${importResult.stdout.trim()}`);

  // Parse imported post IDs from stdout
  const postIdMatch = importResult.stdout.match(/Post IDs: (.+)/);
  const importedPostIds = postIdMatch ? postIdMatch[1].split(',') : [];
  if (importedPostIds.length === 0) {
    console.warn('[record] No post IDs returned from import; falling back to raw data for note_id extraction');
  }

  const manifest: any = {
    platform: opts.platform,
    query: opts.query,
    limit: opts.limit,
    recordedAt: new Date().toISOString(),
    posts: importedPostIds,
    fixtures: {
      posts: 'posts_transformed.jsonl',
      comments: [] as string[],
      media: [] as string[],
    },
    failures: [] as string[],
  };

  for (let idx = 0; idx < postsForImport.length; idx++) {
    const item = postsForImport[idx];
    const postId = importedPostIds[idx] ?? `unknown_${idx}`;
    const noteId = extractNoteId(item, opts.noteIdField) ?? `note_${idx}`;
    const noteUrl = item.url ?? item.link ?? noteId;

    console.log(`[record] Processing post ${postId} (note_id=${noteId})`);

    // Comments
    const commentsFile = path.join(opts.outputDir, `comments_${postId}.jsonl`);
    console.log(`[record]   Fetching comments...`);
    const commentsResult = await runOpencli(opts.commentsTemplate, { note_url: noteUrl, note_id: noteId, post_id: postId });
    if (commentsResult.success && (commentsResult.data ?? []).length > 0) {
      const comments = commentsResult.data!;
      fs.writeFileSync(commentsFile, comments.map((c: any) => JSON.stringify(c)).join('\n') + '\n');

      // Import comments via CLI
      const commentImportResult = await runAnalyzeCli([
        'comment', 'import',
        '--platform', opts.platform,
        '--post-id', postId,
        '--file', commentsFile,
      ]);
      if (commentImportResult.success) {
        console.log(`[record]   Comments imported: ${commentImportResult.stdout.trim()}`);
      } else {
        console.warn(`[record]   Comment import warning: ${commentImportResult.error}`);
        manifest.failures.push(`comment-import-${postId}`);
      }
    } else {
      console.log(`[record]   No comments fetched (${commentsResult.error ?? 'empty'})`);
      fs.writeFileSync(commentsFile, '');
    }
    manifest.fixtures.comments.push(path.basename(commentsFile));

    // Media
    const mediaFile = path.join(opts.outputDir, `media_${postId}.jsonl`);
    console.log(`[record]   Fetching media...`);
    const mediaResult = await runOpencli(opts.mediaTemplate, { note_url: noteUrl, note_id: noteId, post_id: postId });
    if (mediaResult.success && (mediaResult.data ?? []).length > 0) {
      const media = mediaResult.data! as any[];
      const downloadDir = resolveMediaDownloadDir(opts.mediaTemplate, { note_url: noteUrl, note_id: noteId, post_id: postId });
      const noteDownloadDir = path.join(downloadDir, noteId);
      const fixtureMediaDir = path.join(opts.outputDir, 'media_files', postId);
      if (fs.existsSync(noteDownloadDir)) {
        const downloadedFiles = fs.readdirSync(noteDownloadDir);
        for (const item of media) {
          const idx = item.index;
          if (idx == null) continue;
          const matched = downloadedFiles.find(f => new RegExp(`^${noteId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_${idx}\\.`).test(f));
          if (matched) {
            fs.mkdirSync(fixtureMediaDir, { recursive: true });
            const src = path.join(noteDownloadDir, matched);
            const dst = path.join(fixtureMediaDir, matched);
            fs.copyFileSync(src, dst);
            item.local_path = path.relative(opts.outputDir, dst).replace(/\\/g, '/');
          }
        }
      }
      fs.writeFileSync(mediaFile, media.map((m: any) => JSON.stringify(m)).join('\n') + '\n');
      console.log(`[record]   Media saved: ${media.length} items`);
    } else {
      console.log(`[record]   No media fetched (${mediaResult.error ?? 'empty'})`);
      fs.writeFileSync(mediaFile, '');
    }
    manifest.fixtures.media.push(path.basename(mediaFile));
  }

  // Write manifest
  const manifestFile = path.join(opts.outputDir, 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  console.log(`[record] Manifest written: ${manifestFile}`);

  generateOfflineTest(opts, manifest);
}

main().catch(err => {
  console.error('[record] Fatal error:', err);
  process.exit(1);
});
