#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const targetDir = path.join(process.cwd(), '.claude', 'skills');
const targetFile = path.join(targetDir, 'scopai.md');

const bundled = path.join(__dirname, '..', 'SKILL.md');
if (!fs.existsSync(bundled)) {
  console.error('SKILL.md not found in package');
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
const content = fs.readFileSync(bundled, 'utf8');
fs.writeFileSync(targetFile, content, 'utf8');
console.log('Skill installed:', path.relative(process.cwd(), targetFile));
console.log('Restart Claude Code to load the new skill.');
