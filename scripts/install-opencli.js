#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const EXTENSIONS_DIR = path.resolve(__dirname, '..', 'opencli-extensions');
const TARGET_DIR = path.join(require('os').homedir(), '.opencli', 'clis');

function install({ symlink = false } = {}) {
  if (!fs.existsSync(EXTENSIONS_DIR)) {
    return;
  }

  if (!fs.existsSync(TARGET_DIR)) {
    fs.mkdirSync(TARGET_DIR, { recursive: true });
  }

  for (const name of fs.readdirSync(EXTENSIONS_DIR)) {
    const src = path.join(EXTENSIONS_DIR, name);
    const dest = path.join(TARGET_DIR, name);
    const stat = fs.lstatSync(src);
    if (!stat.isDirectory()) continue;

    if (fs.existsSync(dest)) {
      if (fs.lstatSync(dest).isSymbolicLink()) {
        fs.unlinkSync(dest);
      } else {
        fs.rmSync(dest, { recursive: true, force: true });
      }
    }

    if (symlink) {
      fs.symlinkSync(src, dest, 'dir');
      console.log(`  Linked  ${name} -> ${dest}`);
    } else {
      fs.cpSync(src, dest, { recursive: true, force: true });
      console.log(`  Copied  ${name} -> ${dest}`);
    }
  }
}

const symlink = process.argv.includes('--symlink') || process.argv.includes('-s');
install({ symlink });
