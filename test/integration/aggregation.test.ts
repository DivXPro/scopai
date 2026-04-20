import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../dist/db/client.js';
const { query, run, close: closeDb } = db;
import * as migrate from '../../dist/db/migrate.js';
const { runMigrations } = migrate;
import * as strategies from '../../dist/db/strategies.js';
const { createStrategy, getStrategyResultTableName } = strategies;
import {
  detectColumnMeta,
  aggregateScalar,
  aggregateArray,
  aggregateJson,
  runAggregate,
  getFullStats,
} from '../../dist/db/aggregation.js';

describe('aggregation', { timeout: 15000 }, () => {
  let strategyId: string;
  let tableName: string;

  before(async () => {
    await runMigrations();
    strategyId = 'test-agg-strategy-' + Date.now();
    const schema = {
      type: 'object',
      properties: {
        sentiment_score: { type: 'number' },
        sentiment_label: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        topics: { type: 'array', items: { type: 'object' } },
      },
    };
    await createStrategy({
      id: strategyId,
      name: 'Test Aggregation Strategy',
      version: '1.0.0',
      target: 'post',
      prompt: 'test',
      output_schema: schema,
    });
    tableName = getStrategyResultTableName(strategyId);
    // Insert test data using string concatenation to avoid prepared statement issues
    await run(`INSERT OR REPLACE INTO "${tableName}" VALUES ('r1', 'task-agg-1', 'post', 'p1', NULL, '1.0.0', 0.8, 'positive', '${JSON.stringify(['美食', '探店'])}', '${JSON.stringify([{name: '生活方式'}, {name: '美食'}])}', NULL, NULL, NULL)`);
    await run(`INSERT OR REPLACE INTO "${tableName}" VALUES ('r2', 'task-agg-1', 'post', 'p2', NULL, '1.0.0', 0.6, 'positive', '${JSON.stringify(['美食', '上海'])}', '${JSON.stringify([{name: '美食'}])}', NULL, NULL, NULL)`);
    await run(`INSERT OR REPLACE INTO "${tableName}" VALUES ('r3', 'task-agg-1', 'post', 'p3', NULL, '1.0.0', 0.3, 'negative', '${JSON.stringify(['探店'])}', '${JSON.stringify([{name: '生活方式'}])}', NULL, NULL, NULL)`);
  });

  after(async () => {
    await query(`DROP TABLE IF EXISTS "${tableName}"`);
    await query(`DELETE FROM strategies WHERE id = ?`, [strategyId]);
  });

  it('detectColumnMeta returns all column types', async () => {
    const meta = await detectColumnMeta(tableName);
    assert.ok(meta.sentiment_score, 'should detect DOUBLE');
    assert.ok(meta.tags, 'should detect JSON');
    assert.ok(meta.topics, 'should detect JSON');
  });

  it('aggregateScalar returns avg/min/max for DOUBLE', async () => {
    const result = await aggregateScalar(tableName, 'task-agg-1', 'sentiment_score', 'DOUBLE');
    assert.ok(Math.abs((result.avg as number) - 0.567) < 0.01, 'avg should be ~0.567');
    assert.strictEqual(result.min, 0.3);
    assert.strictEqual(result.max, 0.8);
  });

  it('aggregateScalar returns enum distribution for VARCHAR', async () => {
    const result = await aggregateScalar(tableName, 'task-agg-1', 'sentiment_label', 'VARCHAR');
    assert.strictEqual((result.distribution as Record<string,number>).positive, 2);
    assert.strictEqual((result.distribution as Record<string,number>).negative, 1);
  });

  it('runAggregate validates field existence', async () => {
    try {
      await runAggregate(strategyId, 'task-agg-1', { field: 'nonexistent_field' });
      assert.fail('should throw');
    } catch (e: any) {
      assert.ok(e.message.includes('nonexistent_field'));
      assert.ok(e.message.includes('Available columns'));
    }
  });

  it('runAggregate requires --json-key for JSON field', async () => {
    try {
      await runAggregate(strategyId, 'task-agg-1', { field: 'topics' });
      assert.fail('should throw');
    } catch (e: any) {
      assert.ok(e.message.includes('--json-key'));
    }
  });

  it('getFullStats returns total + numeric + text', async () => {
    const stats = await getFullStats(strategyId, 'task-agg-1');
    assert.strictEqual(stats.total, 3);
    assert.ok(stats.numeric);
    assert.ok(stats.text);
    assert.ok(stats.array);
  });
});
