#!/usr/bin/env node

/**
 * Sync version across all packages and publish.
 *
 * Usage: node scripts/release.js [version]
 *   e.g. node scripts/release.js 1.3.0
 *
 * Steps:
 * 1. Build all packages (validate before any changes)
 * 2. Read/bump version
 * 3. Update root package.json + all workspace packages
 * 4. Publish all packages
 * 5. Git tag (optional)
 *
 * Build runs first so a failed build doesn't leave a bumped version behind.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');

function bumpVersion(current) {
  const parts = current.split('.');
  const patch = parseInt(parts[2], 10);
  parts[2] = String(patch + 1);
  return parts.join('.');
}

// Step 1: Build first — if this fails, no version has been touched
console.log('Building all packages...');
execSync('pnpm -r build', { stdio: 'inherit', cwd: rootDir });

// Step 2: Determine version
let version = process.argv[2];
if (!version) {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
  version = bumpVersion(rootPkg.version);
  console.log(`\nAuto-bumping version: ${rootPkg.version} → ${version}`);
} else {
  console.log(`\nUsing specified version: ${version}`);
}

if (!/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Invalid version format: ${version}`);
  process.exit(1);
}

// Step 3: Update version in all package.json files
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

// Step 4: Publish
console.log('\nPublishing all packages...');
execSync('pnpm -r publish --access public --no-git-checks', { stdio: 'inherit', cwd: rootDir });

console.log(`\nReleased v${version}`);
