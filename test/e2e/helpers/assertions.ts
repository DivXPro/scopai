import { runCli } from './cli.ts';

export async function pollUntil<T>(
  fetch: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: { timeout: number; interval: number },
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < options.timeout) {
    const value = await fetch();
    if (predicate(value)) {
      return value;
    }
    await new Promise(r => setTimeout(r, options.interval));
  }
  throw new Error(`pollUntil timeout after ${options.timeout}ms`);
}

export async function waitForDataPreparation(taskId: string, timeoutMs = 60000): Promise<void> {
  await pollUntil(
    async () => {
      const { stdout } = await runCli(['task', 'show', taskId]);
      return stdout;
    },
    (stdout) => stdout.includes('Status:      completed') || (stdout.includes('Data Preparation:') && stdout.includes('done')),
    { timeout: timeoutMs, interval: 3000 },
  );
}

export async function waitForAnalysisComplete(taskId: string, timeoutMs = 120000): Promise<void> {
  await pollUntil(
    async () => {
      const { stdout } = await runCli(['task', 'show', taskId]);
      return stdout;
    },
    (stdout) => {
      const steps = stdout.match(/completed/g) || [];
      return stdout.includes('Analysis Jobs:') &&
        !stdout.includes('running') &&
        !stdout.includes('pending') &&
        steps.length > 0;
    },
    { timeout: timeoutMs, interval: 3000 },
  );
}

export async function waitForJobStatus(
  taskId: string,
  status: 'pending' | 'processing' | 'completed' | 'failed',
  timeoutMs = 30000,
): Promise<void> {
  await pollUntil(
    async () => {
      const { stdout } = await runCli(['queue', 'list', '--task-id', taskId]);
      return stdout;
    },
    (stdout) => stdout.includes(status),
    { timeout: timeoutMs, interval: 2000 },
  );
}
