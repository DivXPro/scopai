import duckdb from 'duckdb';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config/index';
import { expandPath } from '../shared/utils';

let _db: duckdb.Database | null = null;
let _conn: duckdb.Connection | null = null;
let _dbLock: Promise<unknown> = Promise.resolve();
let _isClosing = false;

export function getDbPath(): string {
  const dbPath = expandPath(config.database.path);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dbPath;
}

function getDb(): duckdb.Database {
  if (!_db) {
    _db = new duckdb.Database(getDbPath());
    _db.run("PRAGMA journal_mode='wal';");
    _db.run("PRAGMA wal_autocheckpoint=1000;");
  }
  return _db;
}

export function getConnection(): duckdb.Connection {
  if (!_conn) {
    _conn = getDb().connect();
  }
  return _conn;
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (_isClosing) {
    throw new Error('Database is closing');
  }
  const next = _dbLock.then(() => fn());
  _dbLock = next.then(
    () => {},
    () => {},
  );
  return next;
}

// Promise-based query
export function query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
  return withLock(() => {
    const conn = getConnection();
    return new Promise((resolve, reject) => {
      if (params && params.length > 0) {
        // @ts-ignore
        conn.all(sql, ...params, (err: Error | null, rows: T[]) => {
          if (err) reject(err);
          else resolve(rows);
        });
      } else {
        // @ts-ignore
        conn.all(sql, (err: Error | null, rows: T[]) => {
          if (err) reject(err);
          else resolve(rows);
        });
      }
    });
  });
}

// Promise-based run
export async function run(sql: string, params?: unknown[]): Promise<void> {
  return withLock(() => {
    const conn = getConnection();
    return new Promise((resolve, reject) => {
      if (params && params.length > 0) {
        // @ts-ignore
        conn.run(sql, ...params, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      } else {
        // @ts-ignore
        conn.run(sql, (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      }
    });
  });
}

// Promise-based exec
export async function exec(sql: string): Promise<void> {
  return withLock(() => {
    const conn = getConnection();
    return new Promise((resolve, reject) => {
      // @ts-ignore
      conn.exec(sql, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

export async function checkpoint(): Promise<void> {
  return exec('CHECKPOINT;');
}

/**
 * Create an isolated database connection for long-running operations.
 * Caller is responsible for closing the connection and database.
 */
export function createIsolatedConnection(): { db: duckdb.Database; conn: duckdb.Connection; close: () => void } {
  const db = new duckdb.Database(getDbPath());
  db.run("PRAGMA journal_mode='wal';");
  const conn = db.connect();
  return {
    db,
    conn,
    close: () => {
      try { conn.close(); } catch {}
      try { db.close(); } catch {}
    },
  };
}

export async function close(): Promise<void> {
  _isClosing = true;

  // Wait for all queued operations to complete or fail
  try {
    await _dbLock;
  } catch {
    // ignore
  }

  if (_db) {
    try {
      await checkpoint();
    } catch {
      // ignore
    }
  }
  if (_conn) {
    _conn.close();
    _conn = null;
  }
  if (_db) {
    _db.close();
    _db = null;
  }

  _isClosing = false;
  _dbLock = Promise.resolve();
}
