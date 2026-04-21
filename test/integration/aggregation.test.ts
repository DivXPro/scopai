import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../packages/core/dist/db/client.js';
const { query, run, close: closeDb } = db;
import * as migrate from '../../packages/core/dist/db/migrate.js';
const { runMigrations } = migrate;
import * as strategies from '../../packages/core/dist/db/strategies.js';
const { createStrategy, getStrategyResultTableName } = strategies;
import {
  detectColumnMeta,
  aggregateScalar,
  aggregateArray,
  aggregateJson,
  runAggregate,
  runMultiAggregate,
  getFullStats,
} from '../../packages/core/dist/db/aggregation.js';

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
      depends_on: null,
      include_original: false,
    });
    tableName = getStrategyResultTableName(strategyId);
    // Override tags column to VARCHAR[] so aggregateArray can unnest native DuckDB arrays
    await run(`CREATE TABLE IF NOT EXISTS "${tableName}" (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, target_type TEXT NOT NULL,
      target_id TEXT NOT NULL, post_id TEXT, strategy_version TEXT NOT NULL,
      sentiment_score DOUBLE, sentiment_label TEXT, tags VARCHAR[],
      topics JSON, raw_response JSON, error TEXT, analyzed_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(task_id, target_type, target_id)
    )`);
    // Insert test data with native DuckDB array syntax for tags
    await run(`INSERT INTO "${tableName}" VALUES ('r1', 'task-agg-1', 'post', 'p1', NULL, '1.0.0', 0.8, 'positive', ['美食', '探店'], '${JSON.stringify([{name: '生活方式'}, {name: '美食'}])}', NULL, NULL, NULL)`);
    await run(`INSERT INTO "${tableName}" VALUES ('r2', 'task-agg-1', 'post', 'p2', NULL, '1.0.0', 0.6, 'positive', ['美食', '上海'], '${JSON.stringify([{name: '美食'}])}', NULL, NULL, NULL)`);
    await run(`INSERT INTO "${tableName}" VALUES ('r3', 'task-agg-1', 'post', 'p3', NULL, '1.0.0', 0.3, 'negative', ['探店'], '${JSON.stringify([{name: '生活方式'}])}', NULL, NULL, NULL)`);
  });

  after(async () => {
    await query(`DROP TABLE IF EXISTS "${tableName}"`);
    await query(`DELETE FROM strategies WHERE id = ?`, [strategyId]);
  });

  it('detectColumnMeta returns all column types', async () => {
    const meta = await detectColumnMeta(tableName);
    assert.ok(meta.sentiment_score, 'should detect DOUBLE');
    assert.ok(meta.tags, 'should detect VARCHAR[]');
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

  it('aggregateArray unnests VARCHAR[] and groups by element', async () => {
    const rows = await aggregateArray(tableName, 'task-agg-1', 'tags', 'VARCHAR[]', 'count', 50);
    // Should have 美食(2), 探店(2), 上海(1)
    const byTag: Record<string, number> = {};
    for (const row of rows) {
      byTag[String(row[Object.keys(row)[0]])] = Number(row[Object.keys(row)[1]]);
    }
    assert.strictEqual(byTag['美食'], 2);
    assert.strictEqual(byTag['探店'], 2);
    assert.strictEqual(byTag['上海'], 1);
  });

  it('aggregateJson rejects invalid jsonKey with SQL injection chars', async () => {
    try {
      await aggregateJson(tableName, 'task-agg-1', 'topics', "name'; DROP TABLE--", 'count', 50);
      assert.fail('should throw');
    } catch (e: any) {
      assert.ok(e.message.includes("Invalid --json-key"));
      assert.ok(e.message.includes("'; DROP TABLE--"));
    }
  });

  it('aggregateJson rejects jsonKey with spaces', async () => {
    try {
      await aggregateJson(tableName, 'task-agg-1', 'topics', 'has space', 'count', 50);
      assert.fail('should throw');
    } catch (e: any) {
      assert.ok(e.message.includes('Invalid --json-key'));
    }
  });

  it('aggregateJson accepts valid jsonKey and groups by extracted field', async () => {
    const rows = await aggregateJson(tableName, 'task-agg-1', 'topics', 'name', 'count', 50);
    const byName: Record<string, number> = {};
    for (const row of rows) {
      byName[String(row[Object.keys(row)[0]])] = Number(row[Object.keys(row)[1]]);
    }
    assert.strictEqual(byName['美食'], 2);
    assert.strictEqual(byName['生活方式'], 2);
  });

  it('runMultiAggregate validates all fields exist', async () => {
    try {
      await runMultiAggregate(strategyId, 'task-agg-1', { fields: ['tags', 'nonexistent'] });
      assert.fail('should throw');
    } catch (e: any) {
      assert.ok(e.message.includes('nonexistent'));
      assert.ok(e.message.includes('Available columns'));
    }
  });

  it('runMultiAggregate requires --json-key for JSON field', async () => {
    try {
      await runMultiAggregate(strategyId, 'task-agg-1', { fields: ['tags', 'topics'] });
      assert.fail('should throw');
    } catch (e: any) {
      assert.ok(e.message.includes('--json-key'));
    }
  });

  it('runMultiAggregate combines VARCHAR[] + VARCHAR for combination counts', async () => {
    const rows = await runMultiAggregate(strategyId, 'task-agg-1', {
      fields: ['tags', 'sentiment_label'],
      aggFn: 'count',
    });
    // Post1: 美食-positive, 探店-positive
    // Post2: 美食-positive, 上海-positive
    // Post3: 探店-negative
    const combo = (tag: string, sentiment: string) =>
      rows.find(r => r.tags === tag && r.sentiment_label === sentiment);
    assert.strictEqual(Number(combo('美食', 'positive')?.count), 2);
    assert.strictEqual(Number(combo('探店', 'positive')?.count), 1);
    assert.strictEqual(Number(combo('上海', 'positive')?.count), 1);
    assert.strictEqual(Number(combo('探店', 'negative')?.count), 1);
  });

  it('runMultiAggregate with JSON field uses --json-key', async () => {
    const rows = await runMultiAggregate(strategyId, 'task-agg-1', {
      fields: ['topics', 'sentiment_label'],
      jsonKey: 'name',
      aggFn: 'count',
    });
    const combo = (topic: string, sentiment: string) =>
      rows.find(r => r.topics === topic && r.sentiment_label === sentiment);
    assert.strictEqual(Number(combo('生活方式', 'positive')?.count), 1);
    assert.strictEqual(Number(combo('美食', 'positive')?.count), 2);
    assert.strictEqual(Number(combo('生活方式', 'negative')?.count), 1);
  });

  it('runMultiAggregate respects limit', async () => {
    const rows = await runMultiAggregate(strategyId, 'task-agg-1', {
      fields: ['tags', 'sentiment_label'],
      limit: 2,
    });
    assert.ok(rows.length <= 2, 'should respect limit');
  });
});
