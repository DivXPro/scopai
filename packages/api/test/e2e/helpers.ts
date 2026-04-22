import fastify from 'fastify';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setupAuth } from '../../src/auth';
import { registerRoutes } from '../../src/routes';

export interface TestContext {
  port: number;
  baseUrl: string;
  cleanup: () => Promise<void>;
}

export async function startServer(): Promise<TestContext> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-cli-e2e-'));
  const dbPath = path.join(tmpDir, 'test.duckdb');

  // Set env before importing core (config loads eagerly)
  process.env.ANALYZE_CLI_DB_PATH = dbPath;
  process.env.ANALYZE_CLI_LOG_LEVEL = 'error';

  // Dynamic import to pick up env vars
  const core = await import('@analyze-cli/core');
  await core.migrate();
  await core.seedPlatforms();

  const app = fastify({ logger: false });

  app.get('/health', async () => ({ status: 'ok' }));
  await setupAuth(app);
  await registerRoutes(app);

  await app.listen({ port: 0, host: '127.0.0.1' });
  const port = app.addresses()[0].port;

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    cleanup: async () => {
      await app.close();
      await core.close();
      try {
        fs.unlinkSync(dbPath);
      } catch {}
      try {
        fs.unlinkSync(`${dbPath}.wal`);
      } catch {}
      try {
        fs.rmdirSync(tmpDir);
      } catch {}
    },
  };
}

export async function fetchApi(
  baseUrl: string,
  urlPath: string,
  options?: RequestInit
): Promise<Response> {
  return fetch(`${baseUrl}${urlPath}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}
