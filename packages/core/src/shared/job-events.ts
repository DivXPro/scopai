import { EventEmitter } from 'events';

const emitter = new EventEmitter();

let notifyCount = 0;

export function notifyJobAvailable(): void {
  notifyCount++;
  emitter.emit('jobAvailable', notifyCount);
}

export function waitForJob(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;

    const onNotify = () => {
      if (resolved) return;
      resolved = true;
      emitter.off('jobAvailable', onNotify);
      resolve(true);
    };

    emitter.once('jobAvailable', onNotify);

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      emitter.off('jobAvailable', onNotify);
      resolve(false);
    }, timeoutMs);

    // Ensure timer doesn't keep process alive if all workers exit
    timer.unref?.();
  });
}
