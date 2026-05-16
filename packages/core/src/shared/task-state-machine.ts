import type { TaskStatus } from './types';

export type TaskAction = 'start' | 'pause' | 'resume' | 'cancel' | 'complete' | 'fail';

const taskStatusTransitions: Record<TaskStatus, Partial<Record<TaskAction, TaskStatus>>> = {
  pending: { start: 'running', cancel: 'cancelled' },
  running: { pause: 'paused', cancel: 'cancelled', complete: 'completed', fail: 'failed' },
  paused: { resume: 'running', cancel: 'cancelled' },
  completed: {},
  failed: {},
  cancelled: {},
};

export function canTransitionStatus(current: TaskStatus, action: TaskAction): TaskStatus | null {
  return taskStatusTransitions[current]?.[action] ?? null;
}
