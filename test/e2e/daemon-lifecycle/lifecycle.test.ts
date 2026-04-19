import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../helpers/cli.ts';
import { ensureDaemonStopped, isDaemonRunning } from '../helpers/daemon.ts';

describe('daemon-lifecycle', { timeout: 30000 }, () => {
  before(async () => {
    await ensureDaemonStopped();
  });

  after(async () => {
    await ensureDaemonStopped();
  });

  it('should start daemon and report running status', async () => {
    // Verify not running
    const { stdout: beforeOut } = await runCli(['daemon', 'status']);
    assert.ok(
      beforeOut.includes('not running') || beforeOut.includes('stopped'),
      'Daemon should not be running initially',
    );

    // Start daemon
    const { exitCode: startExit } = await runCli(['daemon', 'start']);
    assert.equal(startExit, 0, 'Daemon start should succeed');

    // Wait for it to be ready
    let attempts = 0;
    let running = false;
    while (attempts < 20) {
      const { stdout } = await runCli(['daemon', 'status']);
      if (stdout.includes('running')) {
        running = true;
        break;
      }
      await new Promise(r => setTimeout(r, 300));
      attempts++;
    }
    assert.ok(running, 'Daemon should be running after start');

    // Verify status output contains version info
    const { stdout: statusOut } = await runCli(['daemon', 'status']);
    assert.ok(statusOut.includes('Version:'), 'Status should show version');
    assert.ok(
      /Version:\s*v?\d+\.\d+\.\d+/.test(statusOut),
      'Version should match semantic format',
    );

    // Stop daemon
    const { exitCode: stopExit } = await runCli(['daemon', 'stop']);
    assert.equal(stopExit, 0, 'Daemon stop should succeed');

    // Verify stopped
    attempts = 0;
    let stopped = false;
    while (attempts < 30) {
      const { stdout } = await runCli(['daemon', 'status']);
      if (stdout.includes('not running')) {
        stopped = true;
        break;
      }
      await new Promise(r => setTimeout(r, 200));
      attempts++;
    }
    assert.ok(stopped, 'Daemon should be stopped');
  });

  it('should handle start when already running', async () => {
    // Start daemon
    await runCli(['daemon', 'start']);
    await new Promise(r => setTimeout(r, 1000));
    assert.ok(await isDaemonRunning(), 'Daemon should be running');

    // Try to start again (should not fail, just warn)
    const { exitCode, stdout } = await runCli(['daemon', 'start']);
    assert.equal(exitCode, 0, 'Start when running should return 0');
    assert.ok(
      stdout.includes('already running'),
      'Should warn that daemon is already running',
    );

    // Cleanup
    await runCli(['daemon', 'stop']);
  });

  it('should stop gracefully when not running', async () => {
    // Ensure not running
    await ensureDaemonStopped();

    const { exitCode, stdout } = await runCli(['daemon', 'stop']);
    assert.equal(exitCode, 0, 'Stop when not running should return 0');
    assert.ok(
      stdout.includes('not running') || stdout.includes('already dead'),
      'Should report daemon not running',
    );
  });
});
