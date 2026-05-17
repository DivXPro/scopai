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
      output_schema: { type: 'object', properties: { sentiment: { type: 'string', title: '情感' } } },
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
      output_schema: { type: 'object', properties: { risk_level: { type: 'string', title: '风险等级' } } },
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
      output_schema: { type: 'object', properties: { category: { type: 'string', title: '分类' } } },
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
      output_schema: { type: 'object', properties: { x: { type: 'string', title: 'X' } } },
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
      output_schema: { type: 'object', properties: { x: { type: 'string', title: 'X' } } },
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
      output_schema: { type: 'object', properties: { x: { type: 'string', title: 'X' } } },
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
      output_schema: { type: 'object', properties: { x: { type: 'string', title: 'X' } } },
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
      output_schema: { type: 'object', properties: { x: { type: 'string', title: 'X' } } },
    });
    assert.equal(result.valid, true);
  });

  it('should accept strategy with routing config', () => {
    const result = validateStrategyJson({
      id: 'test-routing',
      name: 'Routing Strategy',
      version: '1.0.0',
      target: 'post',
      prompt: 'Analyze {{content}}',
      output_schema: { type: 'object', properties: { x: { type: 'string', title: 'X' } } },
      is_router: false,
      routing: {
        applicability_checks: [
          { id: 'has-image', question: 'Does the post have images?', kind: 'boolean' },
          { id: 'style', question: 'What style?', kind: 'enum', enum_values: ['modern', 'classic'] },
        ],
        boundary_false_positives: ['screenshots without artistic value'],
      },
    });
    assert.equal(result.valid, true);
  });

  it('should accept router strategy with is_router: true', () => {
    const result = validateStrategyJson({
      id: 'test-router',
      name: 'Router Strategy',
      version: '1.0.0',
      target: 'post',
      prompt: 'Route content',
      output_schema: { type: 'object', properties: { decisions: { type: 'array', title: '决策' } } },
      is_router: true,
    });
    assert.equal(result.valid, true);
  });

  it('should reject invalid routing.applicability_checks kind', () => {
    const result = validateStrategyJson({
      id: 'test-bad-check-kind',
      name: 'Bad Check Kind',
      version: '1.0.0',
      target: 'post',
      prompt: 'test',
      output_schema: { type: 'object', properties: { x: { type: 'string', title: 'X' } } },
      routing: {
        applicability_checks: [
          { id: 'bad', question: 'Q', kind: 'invalid_kind' },
        ],
        boundary_false_positives: [],
      },
    });
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('kind'));
  });

  it('should reject non-array routing.boundary_false_positives', () => {
    const result = validateStrategyJson({
      id: 'test-bad-bfp',
      name: 'Bad Boundary False Positives',
      version: '1.0.0',
      target: 'post',
      prompt: 'test',
      output_schema: { type: 'object', properties: { x: { type: 'string', title: 'X' } } },
      routing: {
        applicability_checks: [],
        boundary_false_positives: 'not-an-array',
      },
    });
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('boundary_false_positives'));
  });

  it('should reject non-boolean is_router', () => {
    const result = validateStrategyJson({
      id: 'test-bad-router',
      name: 'Bad Router',
      version: '1.0.0',
      target: 'post',
      prompt: 'test',
      output_schema: { type: 'object', properties: { x: { type: 'string', title: 'X' } } },
      is_router: 'yes',
    });
    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('is_router'));
  });
});
