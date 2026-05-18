import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateStrategyJson } from '../../packages/core/dist/db/strategies.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('strategy routing fields', () => {
  const builtInDir = path.join(__dirname, '../../packages/core/src/strategies/built-in');
  const strategyFiles = fs.readdirSync(builtInDir).filter(f => f.endsWith('.json'));

  for (const file of strategyFiles) {
    const filePath = path.join(builtInDir, file);
    const strategy = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    if (strategy.routing) {
      it(`${strategy.id} should have tags_description`, () => {
        assert.ok(strategy.routing.tags_description !== undefined);
        assert.equal(typeof strategy.routing.tags_description, 'string');
        assert.ok(strategy.routing.tags_description.length > 0);
      });

      it(`${strategy.id} should have positive_signals as string array`, () => {
        assert.ok(Array.isArray(strategy.routing.positive_signals));
        for (const sig of strategy.routing.positive_signals) {
          assert.equal(typeof sig, 'string');
        }
      });

      it(`${strategy.id} should have negative_signals as string array`, () => {
        assert.ok(Array.isArray(strategy.routing.negative_signals));
        for (const sig of strategy.routing.negative_signals) {
          assert.equal(typeof sig, 'string');
        }
      });

      it(`${strategy.id} should have valid JSON schema`, () => {
        const validation = validateStrategyJson(strategy);
        assert.equal(validation.valid, true);
      });
    }
  }
});
