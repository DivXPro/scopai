#!/usr/bin/env node
// Test script: verify get_post returns _meta.ui for MCP Apps rendering

const { spawn } = require('child_process');
const path = require('path');

const POST_ID = '85594e9b-b8d9-4b30-bc8c-a73f3f751d2c';
const MCP_CMD = path.resolve(__dirname, '../packages/cli/dist/index.js');

let msgId = 0;
function nextId() { return ++msgId; }

function send(stdin, method, params) {
  const msg = JSON.stringify({ jsonrpc: '2.0', id: nextId(), method, params });
  stdin.write(msg + '\n');
  console.log('[SEND]', msg.slice(0, 200));
}

function sendNotify(stdin, method, params) {
  const msg = JSON.stringify({ jsonrpc: '2.0', method, params });
  stdin.write(msg + '\n');
  console.log('[SEND notify]', method);
}

async function main() {
  const child = spawn('node', [MCP_CMD, 'mcp'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  const responses = [];
  let buffer = '';

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        responses.push(obj);
        console.log('[RECV]', JSON.stringify(obj).slice(0, 300));
      } catch {
        console.log('[RECV raw]', trimmed.slice(0, 200));
      }
    }
  });

  // Wait for stdout to be ready
  await new Promise((r) => setTimeout(r, 300));

  // Step 1: initialize
  send(child.stdin, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-script', version: '1.0.0' },
  });

  // Wait for initialize response
  await new Promise((r) => setTimeout(r, 500));

  // Step 2: send initialized notification
  sendNotify(child.stdin, 'notifications/initialized', {});
  await new Promise((r) => setTimeout(r, 200));

  // Step 3: call get_post
  send(child.stdin, 'tools/call', {
    name: 'get_post',
    arguments: { id: POST_ID },
  });

  // Wait for response
  await new Promise((r) => setTimeout(r, 1000));

  // Analyze
  const callResponses = responses.filter((r) => r.id === 2 && r.result);
  if (callResponses.length === 0) {
    console.error('\n[FAIL] No tools/call response found');
    process.exit(1);
  }

  const result = callResponses[0].result;
  console.log('\n========== RESULT ANALYSIS ==========');

  // Check content
  const hasContent = result.content && Array.isArray(result.content) && result.content.length > 0;
  console.log('Has content array:', hasContent);

  // Check _meta.ui
  const hasMeta = result._meta != null;
  const hasUi = hasMeta && result._meta.ui != null;
  const hasResourceUri = hasUi && result._meta.ui.resourceUri != null;
  const hasVisibility = hasUi && Array.isArray(result._meta.ui.visibility);

  console.log('Has _meta:', hasMeta);
  console.log('Has _meta.ui:', hasUi);
  console.log('Has resourceUri:', hasResourceUri, hasResourceUri ? `(${result._meta.ui.resourceUri})` : '');
  console.log('Has visibility:', hasVisibility, hasVisibility ? `(${result._meta.ui.visibility.join(', ')})` : '');

  if (hasContent && hasMeta && hasUi && hasResourceUri && hasVisibility) {
    console.log('\n[PASS] get_post returns proper _meta.ui for MCP Apps rendering');
  } else {
    console.log('\n[FAIL] get_post is missing _meta.ui fields');
    console.log('Full result keys:', Object.keys(result));
  }

  child.kill();
  process.exit(hasContent && hasMeta && hasUi && hasResourceUri && hasVisibility ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
