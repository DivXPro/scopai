import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import { runCli } from '../helpers/cli.ts';
import { ensureDaemonStopped, startDaemon } from '../helpers/daemon.ts';

const RUN_ID = `e2e_strat_import_${Date.now()}`;
const SENTIMENT_FIXTURE = path.join(process.cwd(), 'test', 'e2e', 'fixtures', 'strategies', 'sentiment.json');

describe('strategy-import', { timeout: 60000 }, () => {
  before(async () => {
    await ensureDaemonStopped();
    const dbPath = process.env.ANALYZE_CLI_DB_PATH;
    if (dbPath) {
      try { fs.unlinkSync(dbPath); } catch {}
      try { fs.unlinkSync(dbPath + '.wal'); } catch {}
    }
    await startDaemon();
  });

  after(async () => {
    await ensureDaemonStopped();
  });

  describe('strategy import --file', () => {
    it('should import a strategy from a JSON file', async () => {
      const { stdout } = await runCli([
        'strategy', 'import', '--file', SENTIMENT_FIXTURE,
      ]);
      assert.ok(stdout.includes('Imported') || stdout.includes('imported'), `Should mention import. stdout: ${stdout}`);
    });

    it('should report error for non-existent file', async () => {
      const { stdout } = await runCli([
        'strategy', 'import', '--file', '/tmp/nonexistent_strategy.json',
      ]);
      assert.ok(stdout.includes('not found'), `Should mention file not found. stdout: ${stdout}`);
    });

    it('should report error for invalid JSON file', async () => {
      const tmpFile = `/tmp/e2e_bad_strategy_${Date.now()}.json`;
      fs.writeFileSync(tmpFile, 'not valid json{');
      const { stdout } = await runCli([
        'strategy', 'import', '--file', tmpFile,
      ]);
      assert.ok(stdout.includes('Invalid JSON'), `Should mention invalid JSON. stdout: ${stdout}`);
      fs.unlinkSync(tmpFile);
    });

    it('should list imported strategy', async () => {
      const { stdout } = await runCli(['strategy', 'list']);
      assert.ok(stdout.includes('E2E') || stdout.includes('sentiment'), `Should list imported strategy. stdout: ${stdout}`);
    });
  });

  describe('strategy import --json', () => {
    it('should import a strategy from a JSON string', async () => {
      const jsonStr = JSON.stringify({
        id: `${RUN_ID}_json_strategy`,
        name: 'JSON Import Test',
        version: '1.0.0',
        target: 'post',
        prompt: 'Analyze: {{content}}',
        output_schema: {
          type: 'object',
          properties: {
            label: { type: 'string' },
            score: { type: 'number' },
          },
        },
      });
      const { stdout } = await runCli([
        'strategy', 'import', '--json', jsonStr,
      ]);
      assert.ok(stdout.includes('Imported') || stdout.includes('imported'), `Should mention import. stdout: ${stdout}`);
    });

    it('should report error for invalid JSON string', async () => {
      const { stdout } = await runCli([
        'strategy', 'import', '--json', 'not-json',
      ]);
      assert.ok(stdout.includes('Invalid JSON'), `Should mention invalid JSON. stdout: ${stdout}`);
    });

    it('should report error when neither --file nor --json is provided', async () => {
      const { stdout } = await runCli([
        'strategy', 'import',
      ]);
      assert.ok(stdout.includes('required'), `Should mention required flag. stdout: ${stdout}`);
    });

    it('should report error when both --file and --json are provided', async () => {
      const { stdout } = await runCli([
        'strategy', 'import', '--file', SENTIMENT_FIXTURE, '--json', '{}',
      ]);
      assert.ok(stdout.includes('Cannot use both'), `Should mention conflict. stdout: ${stdout}`);
    });
  });

  describe('strategy import --file (duplicate)', () => {
    it('should skip import of same version', async () => {
      // First import
      await runCli(['strategy', 'import', '--file', SENTIMENT_FIXTURE]);

      // Second import of same strategy
      const { stdout } = await runCli([
        'strategy', 'import', '--file', SENTIMENT_FIXTURE,
      ]);
      assert.ok(
        stdout.includes('Skipped') || stdout.includes('skipped') || stdout.includes('same version'),
        `Should mention skip. stdout: ${stdout}`,
      );
    });
  });
});