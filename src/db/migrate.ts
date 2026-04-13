import * as fs from 'fs';
import * as path from 'path';
import { exec } from './client';

export function runMigrations(): void {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  exec(schema);
}
