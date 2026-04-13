import { runConsumer } from './consumer';

const workerId = process.env.WORKER_ID ? parseInt(process.env.WORKER_ID, 10) : 0;

runConsumer(workerId).catch((err) => {
  console.error(`[Worker-${workerId}] Fatal error:`, err);
  process.exit(1);
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
