import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const CLI_PATH = path.join(process.cwd(), 'bin', 'scopai.js');

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Fixed test environment for this process — all runCli calls share the same IPC socket
const TEST_RUN_ID = `e2e_${Date.now()}_${process.pid}`;
const TEST_TMP_DIR = path.join(os.tmpdir(), 'scopai-e2e', TEST_RUN_ID);
fs.mkdirSync(TEST_TMP_DIR, { recursive: true });

function getTestEnv(): Record<string, string> {
  return {
    ...process.env,
    ANALYZE_CLI_DB_PATH: process.env.ANALYZE_CLI_DB_PATH ?? path.join(TEST_TMP_DIR, 'test.duckdb'),
    ANALYZE_CLI_IPC_SOCKET: process.env.ANALYZE_CLI_IPC_SOCKET ?? path.join(TEST_TMP_DIR, 'daemon.sock'),
    ANALYZE_CLI_DAEMON_PID: process.env.ANALYZE_CLI_DAEMON_PID ?? path.join(TEST_TMP_DIR, 'daemon.pid'),
    ANALYZE_CLI_LOG_LEVEL: 'error',
  };
}

const CLI_TIMEOUT_MS = 30000;

export async function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const env = getTestEnv();
    const proc = spawn('node', [CLI_PATH, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, CLI_TIMEOUT_MS);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export function extractId(stdout: string): string | null {
  // Matches patterns like:
  // "Task created: abc-123-def"
  // "Platform added: xhs_e2e_123"
  // "Strategy imported: strategy_abc"
  const match = stdout.match(/(?:created|added|imported):\s*([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export function extractCount(stdout: string, label: string): number | null {
  const pattern = new RegExp(`${label}:\\s*(\\d+)`);
  const match = stdout.match(pattern);
  return match ? parseInt(match[1], 10) : null;
}
