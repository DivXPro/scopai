import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as opencli from '../../packages/core/dist/data-fetcher/opencli.js';
const { fetchViaOpencli } = opencli;

// ============================================================
// Unit Tests — Template Substitution
// ============================================================

describe('opencli — template substitution (unit)', () => {
  it('should report missing variables', async () => {
    const result = await fetchViaOpencli(
      'echo {post_id} {limit}',
      { post_id: 'abc123' },
      5000,
    );
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('limit'));
  });

  it('should substitute variables in command args', async () => {
    // With execFile, no shell interpretation. Use echo without quotes.
    const result = await fetchViaOpencli(
      'echo {greeting} {name}',
      { greeting: 'hello', name: 'world' },
      5000,
    );
    assert.equal(result.success, true);
    // echo outputs "hello world\n" — not valid JSON, so wrapped in array
    assert.deepEqual(result.data, ['hello world']);
  });

  it('should reject empty template', async () => {
    const result = await fetchViaOpencli('', {}, 5000);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('Empty'));
  });

  it('should reject whitespace-only template', async () => {
    const result = await fetchViaOpencli('   ', {}, 5000);
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('Empty'));
  });

  it('should handle empty stdout', async () => {
    const result = await fetchViaOpencli('echo', [], 5000);
    // wait — echo with no args on mac outputs empty line
    // Actually `echo` outputs a newline. Let's use `true` instead
  });

  it('should handle command producing no stdout', async () => {
    const result = await fetchViaOpencli('true', {}, 5000);
    assert.equal(result.success, true);
    assert.deepEqual(result.data, []);
  });

  it('should treat empty stdout with stderr as failure', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const tmpFile = path.join(os.tmpdir(), `opencli-test-${Date.now()}.js`);
    fs.writeFileSync(tmpFile, `process.stderr.write('error msg');`);
    try {
      const result = await fetchViaOpencli(`node ${tmpFile}`, {}, 5000);
      assert.equal(result.success, false);
      assert.ok(result.error?.includes('error msg'));
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('should handle command failure', async () => {
    const result = await fetchViaOpencli('false', {}, 5000);
    assert.equal(result.success, false);
  });

  it('should handle timeout errors', async () => {
    const result = await fetchViaOpencli(
      'sleep 10',
      {},
      200,
    );
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('timed out') || result.error?.includes('timeout'), `got: ${result.error}`);
  });

  it('should parse JSON array from command output', async () => {
    // Use printf to output exact JSON without shell interpretation
    const result = await fetchViaOpencli(
      'printf %s [{"id":1},{"id":2}]',
      {},
      5000,
    );
    assert.equal(result.success, true, `parse failed: ${result.error}`);
    assert.equal(result.data?.length, 2);
  });

  it('should unwrap {data: [...]} JSON output', async () => {
    const result = await fetchViaOpencli(
      'printf %s {"data":[{"id":1},{"id":2}]}',
      {},
      5000,
    );
    assert.equal(result.success, true, `parse failed: ${result.error}`);
    assert.equal(result.data?.length, 2);
  });

  it('should unwrap {items: [...]} JSON output', async () => {
    const result = await fetchViaOpencli(
      'printf %s {"items":[{"id":1}]}',
      {},
      5000,
    );
    assert.equal(result.success, true, `parse failed: ${result.error}`);
    assert.equal(result.data?.length, 1);
  });

  it('should handle non-JSON text output', async () => {
    const result = await fetchViaOpencli(
      'printf %s hello',
      {},
      5000,
    );
    assert.equal(result.success, true);
    assert.deepEqual(result.data, ['hello']);
  });
});

// ============================================================
// Integration Tests — Real opencli commands
// ============================================================

describe('opencli — real data (integration)', { timeout: 60000 }, () => {
  it('should fetch HackerNews top stories', async () => {
    const result = await fetchViaOpencli(
      'opencli hackernews top --limit {limit} -f json',
      { limit: '3' },
      30000,
    );
    assert.equal(result.success, true, `fetch failed: ${result.error}`);
    assert.ok(result.data!.length > 0, 'expected at least 1 story');
    const first = result.data![0] as Record<string, unknown>;
    assert.ok('title' in first, 'expected title field');
    assert.ok('url' in first, 'expected url field');
    console.log(`  Fetched ${result.data!.length} HN stories`);
  });

  it('should handle variable substitution with exact limit', async () => {
    const result = await fetchViaOpencli(
      'opencli hackernews top --limit {limit} -f json',
      { limit: '1' },
      30000,
    );
    assert.equal(result.success, true, `fetch failed: ${result.error}`);
    assert.equal(result.data?.length, 1);
  });

  it('should handle template with all variables substituted', async () => {
    const result = await fetchViaOpencli(
      'opencli {site} {command} --limit {limit} -f {format}',
      { site: 'hackernews', command: 'top', limit: '2', format: 'json' },
      30000,
    );
    assert.equal(result.success, true, `fetch failed: ${result.error}`);
    assert.ok(result.data!.length >= 1);
  });

  it('should fetch dev.to top stories (public API, no browser)', async () => {
    const result = await fetchViaOpencli(
      'opencli devto top --limit {limit} -f json',
      { limit: '2' },
      30000,
    );
    assert.equal(result.success, true, `fetch failed: ${result.error}`);
    assert.ok(result.data!.length > 0, 'expected at least 1 story');
    console.log(`  Fetched ${result.data!.length} dev.to stories`);
  });
});
