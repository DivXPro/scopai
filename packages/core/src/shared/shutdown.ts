export interface WorkerState {
  activeCount: number;
}

const workerStates = new Map<number, WorkerState>();

export function registerWorker(workerId: number): void {
  workerStates.set(workerId, { activeCount: 0 });
}

export function unregisterWorker(workerId: number): void {
  workerStates.delete(workerId);
}

export function setWorkerActiveCount(workerId: number, count: number): void {
  workerStates.set(workerId, { activeCount: count });
}

export function getTotalActiveJobs(): number {
  let total = 0;
  for (const state of workerStates.values()) {
    total += state.activeCount;
  }
  return total;
}

export function getWorkerCount(): number {
  return workerStates.size;
}

// Global shutdown flag
let shuttingDown = false;

export function requestShutdown(): void {
  shuttingDown = true;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function resetShutdown(): void {
  shuttingDown = false;
}
