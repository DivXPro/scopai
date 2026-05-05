import { getNextJobs, registerWorker, unregisterWorker, isShuttingDown, waitForJob, checkpoint, setWorkerActiveCount } from '@scopai/core';
import { processJobWithLifecycle } from './consumer';
import { getLogger, sleep } from '@scopai/core';

const POLL_INTERVAL_MS = 2000;
const MAX_WAIT_MS = 30000;
const EXPONENTIAL_BACKOFF_FACTOR = 2;

export async function runPrepareConsumer(workerId: string): Promise<void> {
  const logger = getLogger();
  logger.info(`[Worker-${workerId}] Prepare consumer started`);

  registerWorker(workerId);
  let currentWaitMs = POLL_INTERVAL_MS;

  try {
    while (true) {
      setWorkerActiveCount(workerId, 0);

      if (isShuttingDown()) {
        logger.info(`[Worker-${workerId}] Prepare consumer graceful shutdown`);
        break;
      }

      try {
        const jobs = await getNextJobs(1, ['prepare']);
        if (jobs.length > 0) {
          currentWaitMs = POLL_INTERVAL_MS;
          await processJobWithLifecycle(jobs[0], workerId);
          continue;
        }

        try {
          await checkpoint();
        } catch (e) {
          logger.warn(`[Worker-${workerId}] Checkpoint failed: ${e instanceof Error ? e.message : String(e)}`);
        }

        logger.debug(`[Worker-${workerId}] Waiting for prepare job (timeout ${currentWaitMs}ms)`);
        const gotNotify = await waitForJob(currentWaitMs);
        if (gotNotify) {
          currentWaitMs = POLL_INTERVAL_MS;
        } else {
          currentWaitMs = Math.min(currentWaitMs * EXPONENTIAL_BACKOFF_FACTOR, MAX_WAIT_MS);
        }
      } catch (err) {
        logger.error(`[Worker-${workerId}] Error in prepare consumer loop: ${err instanceof Error ? err.message : String(err)}`);
        await sleep(POLL_INTERVAL_MS);
        currentWaitMs = POLL_INTERVAL_MS;
      }
    }
  } finally {
    unregisterWorker(workerId);
  }
}
