import { runCli } from './cli.ts';

export async function startDaemon(): Promise<void> {
  const { exitCode, stderr, stdout } = await runCli(['daemon', 'start']);
  if (exitCode !== 0 && !stderr.includes('already running') && !stdout.includes('already running')) {
    throw new Error(`Failed to start daemon: stdout=${stdout} stderr=${stderr}`);
  }
  await waitForDaemonReady(10000);
}

export async function stopDaemon(): Promise<void> {
  await runCli(['daemon', 'stop']);
  let attempts = 0;
  while (attempts < 30) {
    const { stdout } = await runCli(['daemon', 'status']);
    if (stdout.includes('not running')) {
      return;
    }
    await new Promise(r => setTimeout(r, 200));
    attempts++;
  }
  throw new Error('Daemon did not stop within 6 seconds');
}

export async function isDaemonRunning(): Promise<boolean> {
  const { stdout } = await runCli(['daemon', 'status']);
  return stdout.includes('running');
}

export async function waitForDaemonReady(timeoutMs = 10000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { stdout } = await runCli(['daemon', 'status']);
    if (stdout.includes('running')) {
      return;
    }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`Daemon not ready after ${timeoutMs}ms`);
}

export async function ensureDaemonStopped(): Promise<void> {
  if (await isDaemonRunning()) {
    await stopDaemon();
  }
}

export async function getDaemonPort(): Promise<number | null> {
  const { stdout } = await runCli(['daemon', 'status']);
  const match = stdout.match(/port (\d+)/);
  return match ? parseInt(match[1], 10) : null;
}
