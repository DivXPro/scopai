import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface FetchResult {
  success: boolean;
  data?: unknown[];
  error?: string;
}

/**
 * Execute an opencli command with template variable substitution.
 *
 * @param template - CLI command template with {variable} placeholders
 * @param vars - Variable values to substitute into the template
 * @param timeoutMs - Command timeout in milliseconds (default: 120000)
 */
export async function fetchViaOpencli(
  template: string,
  vars: Record<string, string>,
  timeoutMs: number = 120000,
): Promise<FetchResult> {
  // Validate that required placeholders are filled
  const missingVars = extractPlaceholders(template).filter(v => !(v in vars));
  if (missingVars.length > 0) {
    return {
      success: false,
      error: `Missing template variables: ${missingVars.join(', ')}`,
    };
  }

  // Parse template into command + args (split on whitespace, first token is executable)
  const tokens = template.trim().split(/\s+/);
  if (tokens.length === 0) {
    return { success: false, error: 'Empty command template' };
  }

  // Substitute placeholders in command and args
  const command = substitutePlaceholders(tokens[0], vars);
  const args = tokens.slice(1).map(t => substitutePlaceholders(t, vars));

  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      maxBuffer: 50 * 1024 * 1024, // 50MB
    });

    const trimmed = stdout.trim();
    if (!trimmed) {
      // stderr may contain warnings but no stdout = empty result
      return { success: true, data: [] };
    }

    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      // Not JSON, return as single string item
      return { success: true, data: [trimmed] };
    }

    // If it's an object with a data/items field, extract it
    if (Array.isArray(data)) {
      return { success: true, data };
    }
    if (typeof data === 'object' && data !== null) {
      const arr = (data as Record<string, unknown>).data ?? (data as Record<string, unknown>).items ?? [data];
      return { success: true, data: Array.isArray(arr) ? arr : [arr] };
    }

    return { success: true, data: [data] };
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && err.code === 'ETIMEOUT') {
      return { success: false, error: `Command timed out after ${timeoutMs}ms: ${command}` };
    }
    const message = err instanceof Error ? err.message : String(err);
    // Extract stderr if available
    const execErr = err as { stderr?: string };
    const detail = execErr.stderr?.trim() ?? message;
    return { success: false, error: detail };
  }
}

/** Extract {variable} placeholders from a template string. */
function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{(\w+)\}/g) ?? [];
  return [...new Set(matches.map(m => m.slice(1, -1)))];
}

/** Substitute {variable} placeholders in a template string (single-pass). */
function substitutePlaceholders(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}
