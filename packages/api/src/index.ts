import fastify from 'fastify';
import staticPlugin from '@fastify/static';
import * as path from 'path';
import { existsSync, renameSync, unlinkSync } from 'fs';
import { spawnSync } from 'child_process';
import {
  config,
  migrate,
  seedPlatforms,
  close as closeDb,
  checkpoint,
  readLockFile,
  writeLockFile,
  removeLockFile,
  isApiAlive,
  requestShutdown,
  resetShutdown,
  registerWorker,
  recoverStalledJobs,
  initLogger,
} from '@scopai/core';
import { setupAuth } from './auth';
import { registerRoutes } from './routes';
import { runConsumer } from './worker/consumer';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';
const WORKER_CONCURRENCY = config.worker.concurrency ?? 2;
const SHUTDOWN_DRAIN_TIMEOUT_MS = 30_000;

function recoverWalIfNeeded(): void {
  const dbPath = config.database.path;
  const walPath = dbPath + '.wal';
  if (!existsSync(walPath)) return;

  const walSize = require('fs').statSync(walPath).size;
  if (walSize === 0) {
    unlinkSync(walPath);
    return;
  }

  // DuckDB INTERNAL errors from WAL replay are thrown asynchronously in worker
  // threads and cannot be caught by try/catch. The safest approach is to delete
  // the WAL file — migrations will recreate any missing schema on startup.
  console.warn(
    `WAL file found (${walSize} bytes) from unclean shutdown. ` +
    `Deleting WAL to prevent async INTERNAL errors on replay. ` +
    `Migrations will re-apply any missing schema.`
  );
  try {
    unlinkSync(walPath);
  } catch (err) {
    console.error('Failed to delete WAL file:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function main() {
  recoverWalIfNeeded();

  await migrate();
  await seedPlatforms();

  // --- Stale lock file check ---
  const existingLock = readLockFile();
  if (existingLock) {
    const alive = await isApiAlive(existingLock.port);
    if (alive) {
      console.error(
        `API server is already running on port ${existingLock.port} (pid ${existingLock.pid}). Exiting.`
      );
      process.exit(1);
    }
    console.warn(
      `Stale lock file found (port ${existingLock.port}, pid ${existingLock.pid}). Removing.`
    );
    removeLockFile();
  }

  // --- Recover stalled jobs from previous run ---
  try {
    const result = await recoverStalledJobs();
    if (result.recovered > 0 || result.failed > 0) {
      console.log(
        `Stalled job recovery: ${result.recovered} recovered, ${result.failed} failed`
      );
    }
  } catch (err) {
    console.warn('Stalled job recovery failed:', err instanceof Error ? err.message : String(err));
  }

  const app = fastify({
    logger: { level: config.logging.level },
  });

  // Register static file serving for UI
  const uiDir = path.join(path.dirname(require.resolve('@scopai/ui/package.json')), 'dist');

  if (!existsSync(path.join(uiDir, 'index.html'))) {
    console.log('UI dist not found, building...');
    const uiRoot = path.dirname(require.resolve('@scopai/ui/package.json'));
    const result = spawnSync('pnpm', ['build'], {
      cwd: uiRoot,
      stdio: 'inherit',
      shell: true,
    });
    if (result.error || result.status !== 0) {
      console.error('UI build failed:', result.error?.message || `exit code ${result.status}`);
      process.exit(1);
    }
    if (!existsSync(path.join(uiDir, 'index.html'))) {
      console.error('UI build did not produce index.html');
      process.exit(1);
    }
  }

  await app.register(staticPlugin, {
    root: uiDir,
    prefix: '/',
  });

  // SPA fallback: serve index.html for non-API, non-static routes
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/') || request.url === '/health') {
      reply.code(404).send({ error: 'Not Found' });
      return;
    }
    return reply.sendFile('index.html');
  });

  app.get('/health', async () => ({ status: 'ok' }));

  await setupAuth(app);
  await registerRoutes(app);

  // Initialize file-based logging for background daemon mode
  initLogger();

  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  // --- Write lock file after server is listening ---
  writeLockFile({
    port: PORT,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  console.log(`API server + UI on http://${HOST}:${PORT}`);

  // --- Start in-process workers ---
  resetShutdown();
  const workerPromises: Promise<void>[] = [];
  for (let i = 0; i < WORKER_CONCURRENCY; i++) {
    registerWorker(i);
    workerPromises.push(
      runConsumer(i).catch((err) => {
        console.error(`Worker ${i} exited with error:`, err instanceof Error ? err.message : String(err));
      })
    );
  }
  console.log(`Started ${WORKER_CONCURRENCY} worker(s)`);

  // --- Graceful shutdown ---
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down gracefully...`);

    try {
      // Stop accepting new HTTP connections
      await app.close();
    } catch (err) {
      console.error('Error closing Fastify:', err instanceof Error ? err.message : String(err));
    }

    // Signal workers to stop accepting new jobs and drain
    requestShutdown();

    // Wait up to SHUTDOWN_DRAIN_TIMEOUT_MS for workers to drain
    const drainTimeout = new Promise<void>((resolve) =>
      setTimeout(() => {
        console.warn('Worker drain timed out, forcing shutdown');
        resolve();
      }, SHUTDOWN_DRAIN_TIMEOUT_MS)
    );
    await Promise.race([Promise.all(workerPromises).then(() => {}), drainTimeout]);

    try {
      await checkpoint();
      await closeDb();
    } catch (err) {
      console.error('Error closing database:', err instanceof Error ? err.message : String(err));
    }

    removeLockFile();
    console.log('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  removeLockFile();
  process.exit(1);
});

export * from './types';
