import * as child_process from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface TestContext {
  port: number;
  baseUrl: string;
  cleanup: () => Promise<void>;
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()!;
      server.close(() => resolve((addr as net.AddressInfo).port));
    });
    server.on('error', reject);
  });
}

export async function startServer(): Promise<TestContext> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'analyze-cli-e2e-'));
  const dbPath = path.join(tmpDir, 'test.duckdb');

  const distPath = path.resolve(__dirname, '../../dist/index.js');
  if (!fs.existsSync(distPath)) {
    throw new Error('API dist not found. Run `pnpm --filter @scopai/api build` first.');
  }

  const port = await getFreePort();

  const proc = child_process.spawn('node', [distPath], {
    env: {
      ...process.env,
      PORT: String(port),
      ANALYZE_CLI_DB_PATH: dbPath,
      ANALYZE_CLI_LOG_LEVEL: 'error',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Wait for server to be ready
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      // not ready yet
    }
    await new Promise(r => setTimeout(r, 250));
  }

  if (!ready) {
    proc.kill('SIGKILL');
    const stderr = proc.stderr.read()?.toString() ?? '';
    throw new Error(`Server failed to start within 10s on port ${port}\n${stderr}`);
  }

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    cleanup: async () => {
      proc.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        proc.on('exit', () => resolve());
        setTimeout(() => { proc.kill('SIGKILL'); resolve(); }, 5000);
      });
      try { fs.unlinkSync(dbPath); } catch {}
      try { fs.unlinkSync(`${dbPath}.wal`); } catch {}
      try { fs.rmdirSync(tmpDir); } catch {}
    },
  };
}

export async function fetchApi(
  baseUrl: string,
  urlPath: string,
  options?: RequestInit
): Promise<Response> {
  const hasBody = options?.body !== undefined;
  return fetch(`${baseUrl}${urlPath}`, {
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });
}
