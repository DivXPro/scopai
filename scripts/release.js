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
 * 4. Re-build (embed new version into dist)
 * 5. Publish all packages
 * 6. Publish failure → rollback version numbers
 *
 * Build runs first so a failed build doesn't leave a bumped version behind.
 * Publish failure rolls back package.json so retrying won't skip a version.
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

function getPkgFiles() {
  const files = [path.join(rootDir, 'package.json')];
  for (const d of fs.readdirSync(packagesDir)) {
    const f = path.join(packagesDir, d, 'package.json');
    if (fs.existsSync(f)) files.push(f);
  }
  return files;
}

function saveOriginals(pkgFiles) {
  const originals = {};
  for (const f of pkgFiles) {
    originals[f] = fs.readFileSync(f, 'utf-8');
  }
  return originals;
}

function rollbackVersions(pkgFiles, originals) {
  console.log('\nRolling back version numbers...');
  for (const f of pkgFiles) {
    fs.writeFileSync(f, originals[f]);
    console.log(`  Rolled back ${path.relative(rootDir, f)}`);
  }
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
const pkgFiles = getPkgFiles();
const originals = saveOriginals(pkgFiles);

for (const filePath of pkgFiles) {
  const pkg = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  pkg.version = version;
  fs.writeFileSync(filePath, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`  Updated ${path.relative(rootDir, filePath)} → ${version}`);
}

// Step 4: Re-build so dist artifacts embed the new version
console.log('\nRe-building with new version...');
try {
  execSync('pnpm -r build', { stdio: 'inherit', cwd: rootDir });
} catch {
  rollbackVersions(pkgFiles, originals);
  console.error('\nBuild failed after version bump. Versions have been rolled back.');
  process.exit(1);
}

// Step 5: Publish
console.log('\nPublishing all packages...');
try {
  execSync('pnpm -r publish --access public --no-git-checks', { stdio: 'inherit', cwd: rootDir });
} catch {
  rollbackVersions(pkgFiles, originals);
  console.log('\nRe-building with original version...');
  execSync('pnpm -r build', { stdio: 'inherit', cwd: rootDir });
  console.error('\nPublish failed. Versions have been rolled back. Fix the issue and retry.');
  process.exit(1);
}

console.log(`\nReleased v${version}`);
