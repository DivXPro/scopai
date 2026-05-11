#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const EXTENSIONS_DIR = path.resolve(__dirname, '..', 'opencli-extensions');
const OPENCLI_DIR = path.join(require('os').homedir(), '.opencli');
const TARGET_DIR = path.join(OPENCLI_DIR, 'clis');

function isOpencliInstalled() {
  try {
    execSync('opencli --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function install({ symlink = false, force = false } = {}) {
  if (!isOpencliInstalled()) {
    console.warn('[scopai] opencli is not installed. Skipping adapter installation.');
    console.warn('  Install it first: npm install -g @jackwener/opencli');
    console.warn('  Then re-run: node scripts/install-opencli.js');
    return;
  }

  if (!fs.existsSync(EXTENSIONS_DIR)) {
    console.log('[scopai] No opencli-extensions directory found, skipping.');
    return;
  }

  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  for (const name of fs.readdirSync(EXTENSIONS_DIR)) {
    const src = path.join(EXTENSIONS_DIR, name);
    const stat = fs.lstatSync(src);
    if (!stat.isDirectory()) continue;

    const dest = path.join(TARGET_DIR, name);

    if (symlink) {
      if (fs.existsSync(dest)) {
        if (fs.lstatSync(dest).isSymbolicLink()) {
          fs.unlinkSync(dest);
        } else {
          fs.rmSync(dest, { recursive: true, force: true });
        }
      }
      fs.symlinkSync(src, dest, 'dir');
      console.log(`  Linked  ${name} -> ${dest}`);
    } else {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      for (const file of fs.readdirSync(src)) {
        const srcFile = path.join(src, file);
        const destFile = path.join(dest, file);
        const fileStat = fs.lstatSync(srcFile);
        if (!fileStat.isFile()) continue;

        if (fs.existsSync(destFile) && !force) {
          console.log(`  Skipped ${name}/${file} (already exists)`);
        } else {
          fs.copyFileSync(srcFile, destFile);
          console.log(`  ${force ? 'Forced' : 'Copied'}  ${name}/${file} -> ${dest}`);
        }
      }
    }
  }
}

const symlink = process.argv.includes('--symlink') || process.argv.includes('-s');
const force = process.argv.includes('--force') || process.argv.includes('-f');
install({ symlink, force });
