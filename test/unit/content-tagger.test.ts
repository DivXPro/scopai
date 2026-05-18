import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateStrategyJson } from '../../packages/core/dist/db/strategies.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('content-tagger strategy', () => {
  const taggerPath = path.join(__dirname, '../../packages/core/src/strategies/built-in/content-tagger.json');
  const taggerJson = JSON.parse(fs.readFileSync(taggerPath, 'utf-8'));

  it('should have valid strategy JSON', () => {
    const validation = validateStrategyJson(taggerJson);
    assert.equal(validation.valid, true);
  });

  it('should have id content-tagger', () => {
    assert.equal(taggerJson.id, 'content-tagger');
  });

  it('should have is_default true', () => {
    assert.equal(taggerJson.is_default, true);
  });

  it('should have target post', () => {
    assert.equal(taggerJson.target, 'post');
  });

  it('should have output_schema with required fields', () => {
    const schema = taggerJson.output_schema;
    assert.ok(schema.required.includes('content_attributes'));
    assert.ok(schema.required.includes('emotion_narrative'));
    assert.ok(schema.required.includes('visual_style'));
    assert.ok(schema.required.includes('platform_spread'));
    assert.ok(schema.required.includes('summary'));
  });

  it('should have summary maxLength 100', () => {
    const summarySchema = taggerJson.output_schema.properties.summary;
    assert.equal(summarySchema.maxLength, 100);
  });

  it('should have four-level tag structure in output_schema', () => {
    const contentAttrs = taggerJson.output_schema.properties.content_attributes;
    assert.ok(contentAttrs.required.includes('topic'));
    assert.ok(contentAttrs.required.includes('product_category'));
    assert.ok(contentAttrs.required.includes('pain_point'));
    assert.ok(contentAttrs.required.includes('scene'));

    const emotionNarr = taggerJson.output_schema.properties.emotion_narrative;
    assert.ok(emotionNarr.required.includes('emotion_tone'));
    assert.ok(emotionNarr.required.includes('narrative_structure'));

    const visualStyle = taggerJson.output_schema.properties.visual_style;
    assert.ok(visualStyle.required.includes('composition'));
    assert.ok(visualStyle.required.includes('color_style'));

    const platformSpread = taggerJson.output_schema.properties.platform_spread;
    assert.ok(platformSpread.required.includes('platform_fit'));
    assert.ok(platformSpread.required.includes('spread_node'));
  });
});
