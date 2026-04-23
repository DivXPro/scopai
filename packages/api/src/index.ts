import fastify from 'fastify';
import staticPlugin from '@fastify/static';
import * as path from 'path';
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
} from '@scopai/core';
import { setupAuth } from './auth';
import { registerRoutes } from './routes';
import { runConsumer } from './worker/consumer';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '127.0.0.1';
const WORKER_CONCURRENCY = config.worker.concurrency ?? 2;
const SHUTDOWN_DRAIN_TIMEOUT_MS = 30_000;

async function main() {
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
