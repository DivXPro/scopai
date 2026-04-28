#!/usr/bin/env node
/**
 * Test Report Generator for scopai
 * 
 * Usage:
 *   node --experimental-strip-types test/report.ts              # Run all tests + generate report
 *   node --experimental-strip-types test/report.ts test/*.ts    # Specific test files
 * 
 * Output: test-report.json and test-report.md in project root
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

interface TestResult {
  file: string;
  type: string;
  tests: number;
  passed: number;
  failed: number;
  cancelled: number;
  duration_ms: number;
  details: TestDetail[];
}

interface TestDetail {
  name: string;
  status: 'pass' | 'fail' | 'cancelled';
  duration_ms?: number;
  error?: string;
}

interface Report {
  generated_at: string;
  summary: {
    total_files: number;
    total_tests: number;
    total_passed: number;
    total_failed: number;
    total_cancelled: number;
    offline_tests: number;
    online_tests: number;
    total_duration_ms: number;
    success_rate: string;
  };
  suites: TestResult[];
}

const testFiles = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : [
      'test/opencli.test.ts',
      'test/import-offline.test.ts',
      'test/prepare-data-offline.test.ts',
      'test/task-post-status.test.ts',
      'test/prepare-data.test.ts',
      'test/xhs-shanghai-food.test.ts',
    ];

function classifyTest(file: string): string {
  if (file.includes('opencli')) return 'opencli (unit + integration)';
  if (file.includes('import-offline')) return 'import (offline mock)';
  if (file.includes('prepare-data-offline')) return 'prepare-data (offline mock E2E)';
  if (file.includes('task-post-status')) return 'task-post-status (DB integration)';
  if (file.includes('prepare-data.test')) return 'prepare-data (online E2E)';
  if (file.includes('xhs-shanghai-food')) return 'XHS Shanghai food (real data E2E)';
  return path.basename(file);
}

function parseTestOutput(stdout: string): TestResult {
  const lines = stdout.split('\n');
  let tests = 0, passed = 0, failed = 0, cancelled = 0, duration_ms = 0;
  const details: TestDetail[] = [];
  
  for (const line of lines) {
    if (line.includes('ℹ tests')) tests = parseInt(line.match(/\d+/)?.[0] ?? '0');
    if (line.includes('ℹ pass')) passed = parseInt(line.match(/\d+/)?.[0] ?? '0');
    if (line.includes('ℹ fail')) failed = parseInt(line.match(/\d+/)?.[0] ?? '0');
    if (line.includes('ℹ cancelled')) cancelled = parseInt(line.match(/\d+/)?.[0] ?? '0');
    if (line.includes('ℹ duration_ms')) duration_ms = parseInt(line.match(/\d+/)?.[0] ?? '0');
  }

  // Parse individual test results
  const testPattern = /(✔|✖)\s+(.+?)\s+\((\d+\.?\d*)ms\)/g;
  let match;
  while ((match = testPattern.exec(stdout)) !== null) {
    details.push({
      name: match[2].trim(),
      status: match[1] === '✔' ? 'pass' : 'fail',
      duration_ms: parseFloat(match[3]),
    });
  }

  // Parse errors for failed tests
  const errorPattern = /✖\s+(.+?)\s+\(\d+\.?\d*ms\)[\s\S]*?AssertionError.*?\n([\s\S]*?)(?=\ntest at|\n✖|\nℹ)/g;
  let errMatch;
  const tempStdout = stdout;
  while ((errMatch = errorPattern.exec(tempStdout)) !== null) {
    const existing = details.find(d => d.name === errMatch[1].trim() && d.status === 'fail');
    if (existing) {
      existing.error = errMatch[2].trim().slice(0, 200);
    }
  }

  return { tests, passed, failed, cancelled, duration_ms, details };
}

async function runTest(file: string): Promise<TestResult> {
  return new Promise((resolve) => {
    const child = spawn('node', ['--test', '--experimental-strip-types', file], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 180000,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => stdout += d.toString());
    child.stderr.on('data', (d) => stderr += d.toString());
    child.on('close', () => {
      resolve(parseTestOutput(stdout));
    });
  });
}

function generateMarkdown(report: Report): string {
  const lines: string[] = [];
  
  lines.push('# scopai Test Report');
  lines.push('');
  lines.push(`> Generated: ${report.generated_at}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Total Test Files | ${report.summary.total_files} |`);
  lines.push(`| Total Tests | ${report.summary.total_tests} |`);
  lines.push(`| Passed | ${report.summary.total_passed} ✅ |`);
  lines.push(`| Failed | ${report.summary.total_failed} ${report.summary.total_failed > 0 ? '❌' : ''} |`);
  lines.push(`| Cancelled | ${report.summary.total_cancelled} |`);
  lines.push(`| Offline Tests | ${report.summary.offline_tests} |`);
  lines.push(`| Online Tests | ${report.summary.online_tests} |`);
  lines.push(`| Success Rate | ${report.summary.success_rate} |`);
  lines.push(`| Total Duration | ${(report.summary.total_duration_ms / 1000).toFixed(1)}s |`);
  lines.push('');

  lines.push('## Test Suites');
  lines.push('');
  lines.push('| Suite | Type | Tests | Passed | Failed | Duration |');
  lines.push('|-------|------|-------|--------|--------|----------|');
  
  for (const suite of report.suites) {
    lines.push(`| ${path.basename(suite.file)} | ${suite.type} | ${suite.tests} | ${suite.passed} | ${suite.failed} | ${(suite.duration_ms / 1000).toFixed(1)}s |`);
  }
  lines.push('');

  lines.push('## Detailed Results');
  lines.push('');
  
  for (const suite of report.suites) {
    lines.push(`### ${path.basename(suite.file)} (${suite.type})`);
    lines.push('');
    
    for (const test of suite.details) {
      const icon = test.status === 'pass' ? '✅' : test.status === 'fail' ? '❌' : '⏸️';
      const time = test.duration_ms ? ` (${test.duration_ms}ms)` : '';
      lines.push(`- ${icon} ${test.name}${time}`);
      if (test.error) {
        lines.push(`  - Error: ${test.error}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  console.log('Running test suites...\n');
  
  const suites: TestResult[] = [];
  let totalDuration = 0;

  for (const file of testFiles) {
    const label = classifyTest(file);
    process.stdout.write(`  [${suites.length + 1}/${testFiles.length}] ${label}... `);
    const start = Date.now();
    const result = await runTest(file);
    const duration = Date.now() - start;
    totalDuration += duration;
    result.file = file;
    result.type = label;
    result.duration_ms = duration;
    suites.push(result);
    console.log(`${result.passed}/${result.tests} passed (${(duration / 1000).toFixed(1)}s)`);
  }

  const report: Report = {
    generated_at: new Date().toISOString(),
    summary: {
      total_files: suites.length,
      total_tests: suites.reduce((s, r) => s + r.tests, 0),
      total_passed: suites.reduce((s, r) => s + r.passed, 0),
      total_failed: suites.reduce((s, r) => s + r.failed, 0),
      total_cancelled: suites.reduce((s, r) => s + r.cancelled, 0),
      offline_tests: suites.filter(r => 
        r.type.includes('offline') || (r.type.includes('opencli') && r.tests === 16)
      ).reduce((s, r) => {
        if (r.type.includes('offline')) return s + r.tests;
        if (r.type.includes('opencli')) return s + 12;
        return s;
      }, 0),
      online_tests: suites.filter(r => 
        !r.type.includes('offline') && !r.type.includes('opencli')
      ).reduce((s, r) => s + r.tests, 0) + 4, // opencli has 4 online
      total_duration_ms: totalDuration,
      success_rate: suites.reduce((s, r) => s + r.passed, 0) + suites.reduce((s, r) => s + r.failed, 0) > 0
        ? `${((suites.reduce((s, r) => s + r.passed, 0) / (suites.reduce((s, r) => s + r.passed, 0) + suites.reduce((s, r) => s + r.failed, 0))) * 100).toFixed(1)}%`
        : 'N/A',
    },
    suites,
  };

  // Write JSON report
  const reportsDir = path.join(process.cwd(), 'test-data', 'reports');
  fs.mkdirSync(reportsDir, { recursive: true });
  const jsonPath = path.join(reportsDir, 'test-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  console.log(`\nJSON report: ${jsonPath}`);

  // Write Markdown report
  const md = generateMarkdown(report);
  const mdPath = path.join(reportsDir, 'test-report.md');
  fs.writeFileSync(mdPath, md);
  console.log(`Markdown report: ${mdPath}`);

  // Print summary
  console.log('\n' + md.split('\n').slice(0, 20).join('\n'));

  process.exit(report.summary.total_failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Report generation failed:', err);
  process.exit(1);
});
