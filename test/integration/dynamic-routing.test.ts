import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../packages/core/dist/db/client.js';
const { query } = db;
import * as migrate from '../../packages/core/dist/db/migrate.js';
const { runMigrations } = migrate;
import * as strategies from '../../packages/core/dist/db/strategies.js';
const { getStrategyById } = strategies;
import * as seedBuiltIn from '../../packages/core/dist/strategies/seed-built-in.js';
const { seedBuiltInStrategies } = seedBuiltIn;

describe('Dynamic routing', () => {
  before(async () => {
    await runMigrations();
    await seedBuiltInStrategies();
  });

  it('content-strategy-router is seeded with is_router=true', async () => {
    const router = await getStrategyById('content-strategy-router');
    assert.ok(router, 'content-strategy-router should exist');
    assert.equal(router.is_router, true);
  });

  it('all 4 built-in creative strategies have routing config', async () => {
    const ids = [
      'creative-copy-deconstruct',
      'creative-image-style',
      'creative-video-style',
      'creative-topic-angle',
    ];
    for (const id of ids) {
      const s = await getStrategyById(id);
      assert.ok(s, `${id} should exist`);
      assert.ok(s.routing, `${id} should have routing config`);
      assert.ok(Array.isArray(s.routing.applicability_checks), `${id} should have applicability_checks`);
      assert.ok(Array.isArray(s.routing.boundary_false_positives), `${id} should have boundary_false_positives`);
    }
  });

  it('built-in strategies are not routers', async () => {
    const ids = [
      'creative-copy-deconstruct',
      'creative-image-style',
      'creative-video-style',
      'creative-topic-angle',
    ];
    for (const id of ids) {
      const s = await getStrategyById(id);
      assert.equal(s?.is_router, false, `${id} should not be a router`);
    }
  });
});
