import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateStrategyJson } from '../../packages/core/dist/db/strategies.js';

describe('validateStrategyJson', () => {
  it('should accept strategy without depends_on', () => {
    const result = validateStrategyJson({
      id: 'test-basic',
      name: 'Basic Strategy',
      version: '1.0.0',
      target: 'post',
      prompt: 'Analyze {{content}}',
      output_schema: { type: 'object', properties: { sentiment: { type: 'string' } } },
    });
    assert.equal(result.valid, true);
  });

  it('should accept strategy with depends_on: post', () => {
    const result = validateStrategyJson({
      id: 'test-secondary-post',
      name: 'Secondary Post Strategy',
      version: '1.0.0',
      target: 'post',
      depends_on: 'post',
      include_original: true,
      prompt: 'Based on: {{upstream_result}}\n\nOriginal: {{original_content}}',
      output_schema: { type: 'object', properties: { risk_level: { type: 'string' } } },
    });
    assert.equal(result.valid, true);
  });

  it('should accept strategy with depends_on: comment', () => {
    const result = validateStrategyJson({
      id: 'test-secondary-comment',
      name: 'Secondary Comment Strategy',
      version: '1.0.0',
      target: 'comment',
      depends_on: 'comment',
      include_original: false,
      prompt: 'Based on: {{upstream_result}}',
      output_schema: { type: 'object', properties: { category: { type: 'string' } } },
    });
    assert.equal(result.valid, true);
  });

  it('should accept strategy with depends_on: null', () => {
    const result = validateStrategyJson({
      id: 'test-null-depends',
      name: 'Null Depends Strategy',
      version: '1.0.0',
      target: 'post',
      depends_on: null,
      prompt: 'Analyze {{content}}',
      output_schema: { type: 'object', properties: { x: { type: 'string' } } },
    });
    assert.equal(result.valid, true);
  });

  it('should reject invalid depends_on value', () => {
    const result = validateStrategyJson({
      id: 'test-bad-depends',
      name: 'Bad Depends',
      version: '1.0.0',
      target: 'post',
      depends_on: 'invalid',
      prompt: 'test',
      output_schema: { type: 'object', properties: { x: { type: 'string' } } },
    });
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('depends_on'));
  });

  it('should reject non-boolean include_original', () => {
    const result = validateStrategyJson({
      id: 'test-bad-include',
      name: 'Bad Include',
      version: '1.0.0',
      target: 'post',
      include_original: 'yes',
      prompt: 'test',
      output_schema: { type: 'object', properties: { x: { type: 'string' } } },
    });
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('include_original'));
  });

  it('should accept include_original: false', () => {
    const result = validateStrategyJson({
      id: 'test-include-false',
      name: 'Include False',
      version: '1.0.0',
      target: 'post',
      include_original: false,
      prompt: 'test',
      output_schema: { type: 'object', properties: { x: { type: 'string' } } },
    });
    assert.equal(result.valid, true);
  });

  it('should accept include_original: true', () => {
    const result = validateStrategyJson({
      id: 'test-include-true',
      name: 'Include True',
      version: '1.0.0',
      target: 'post',
      include_original: true,
      prompt: 'test',
      output_schema: { type: 'object', properties: { x: { type: 'string' } } },
    });
    assert.equal(result.valid, true);
  });
});
