import duckdb from 'duckdb';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { expandPath } from '../shared/utils';

let _db: duckdb.Database | null = null;
let _conn: duckdb.Connection | null = null;

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
  }
  return _db;
}

export function getConnection(): duckdb.Connection {
  if (!_conn) {
    _conn = getDb().connect();
  }
  return _conn;
}

function querySync<T>(conn: duckdb.Connection, sql: string, params?: unknown[]): T[] {
  let results: T[] = [];
  let error: Error | null = null;
  const callback = (err: Error | null, rows: T[]) => {
    error = err;
    results = rows;
  };
  if (params && params.length > 0) {
    // @ts-ignore - duckdb callback types are flexible
    conn.all(sql, ...params, callback);
  } else {
    // @ts-ignore
    conn.all(sql, callback);
  }
  if (error) throw error;
  return results;
}

export function query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
  const conn = getConnection();
  return querySync<T>(conn, sql, params);
}

export function run(sql: string, params?: unknown[]): void {
  const conn = getConnection();
  let error: Error | null = null;
  const callback = (err: Error | null) => { error = err; };
  if (params && params.length > 0) {
    // @ts-ignore
    conn.run(sql, ...params, callback);
  } else {
    // @ts-ignore
    conn.run(sql, callback);
  }
  if (error) throw error;
}

export function exec(sql: string): void {
  const conn = getConnection();
  let error: Error | null = null;
  const callback = (err: Error | null) => { error = err; };
  // @ts-ignore
  conn.exec(sql, callback);
  if (error) throw error;
}

export function close(): void {
  if (_conn) {
    _conn.close();
    _conn = null;
  }
  if (_db) {
    _db.close();
    _db = null;
  }
}
