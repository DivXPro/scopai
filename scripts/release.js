#!/usr/bin/env node

/**
 * Sync version across all packages and publish.
 *
 * Usage: node scripts/release.js <version>
 *   e.g. node scripts/release.js 1.3.0
 *
 * Steps:
 * 1. Read version from argument
 * 2. Update root package.json + all packages/*/package.json
 * 3. Build all packages
 * 4. Publish all packages
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/release.js <version>');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Invalid version format: ${version}`);
  process.exit(1);
}

const pkgFiles = [
  path.join(rootDir, 'package.json'),
  ...fs.readdirSync(packagesDir).map(d => path.join(packagesDir, d, 'package.json')),
];

for (const filePath of pkgFiles) {
  if (!fs.existsSync(filePath)) continue;
  const pkg = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  pkg.version = version;
  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  Updated ${path.relative(rootDir, filePath)} → ${version}`);
}

console.log('\nBuilding all packages...');
execSync('pnpm -r build', { stdio: 'inherit', cwd: rootDir });

console.log('\nPublishing all packages...');
execSync('pnpm -r publish --access public --no-git-checks', { stdio: 'inherit', cwd: rootDir });

console.log(`\nReleased v${version}`);