import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

const TEST_RUN_ID = `e2e_${Date.now()}_${process.pid}`;
export const TEST_TMP_DIR = path.join(os.tmpdir(), 'scopai-e2e', TEST_RUN_ID);
fs.mkdirSync(TEST_TMP_DIR, { recursive: true });

export const TEST_DB_PATH = path.join(TEST_TMP_DIR, 'test.duckdb');
export const TEST_IPC_SOCKET = path.join(TEST_TMP_DIR, 'daemon.sock');
export const TEST_DAEMON_PID = path.join(TEST_TMP_DIR, 'daemon.pid');
