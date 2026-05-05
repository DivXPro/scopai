import { execFile } from 'child_process';
import { config } from '../config';
import { getLogger } from './logger';
import type { HookEvent, HookDefinition, HookPayload, CommandHook, HttpHook } from './types';

function interpolateTemplate(template: string, payload: HookPayload): string {
  return template
    .replace(/\$TASK_ID/g, payload.task_id)
    .replace(/\$STEP_ID/g, payload.step_id ?? '')
    .replace(/\$EVENT/g, payload.event)
    .replace(/\$ERROR/g, payload.error ?? '')
    .replace(/\$STATS_DONE/g, String(payload.stats?.done ?? 0))
    .replace(/\$STATS_FAILED/g, String(payload.stats?.failed ?? 0))
    .replace(/\$STATS_TOTAL/g, String(payload.stats?.total ?? 0));
}

async function executeCommandHook(hook: CommandHook, payload: HookPayload): Promise<void> {
  const logger = getLogger();
  const command = interpolateTemplate(hook.command, payload);

  return new Promise((resolve) => {
    const env = {
      ...process.env,
      SCOPAI_HOOK_EVENT: payload.event,
      SCOPAI_HOOK_PAYLOAD: JSON.stringify(payload),
    };

    execFile('sh', ['-c', command], { env, timeout: 10000 }, (err) => {
      if (err) {
        logger.warn(`[Hook] command hook failed: ${err.message}`);
      }
      resolve();
    });
  });
}

async function executeHttpHook(hook: HttpHook, payload: HookPayload): Promise<void> {
  const logger = getLogger();
  const timeout = hook.timeout_ms ?? 5000;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    timer.unref?.();

    await fetch(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(hook.headers ?? {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);
  } catch (err) {
    logger.warn(`[Hook] HTTP hook failed for ${hook.url}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function emitHook(event: HookEvent, payload: Omit<HookPayload, 'event' | 'timestamp'>): void {
  const hooks = config.hooks?.[event];
  if (!hooks || hooks.length === 0) return;

  const fullPayload: HookPayload = {
    ...payload,
    event,
    timestamp: new Date().toISOString(),
  };

  for (const hook of hooks) {
    if (hook.type === 'command') {
      executeCommandHook(hook, fullPayload).catch(() => {});
    } else if (hook.type === 'http') {
      executeHttpHook(hook, fullPayload).catch(() => {});
    }
  }
}
