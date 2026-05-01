import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../shared/types';
import { expandPath } from '../shared/utils';
import { loadClaudeConfig } from './claude-config';

const isDevEnv = process.env.NODE_ENV === 'development' || process.env.SCOPAI_ENV === 'dev';

const DEFAULT_CONFIG: Config = {
  database: {
    path: expandPath(isDevEnv ? '~/.scopai/dev.duckdb' : '~/.scopai/data.duckdb'),
  },
  anthropic: {
    api_key: '',
    model: 'claude-opus-4-5-20250514',
    max_tokens: 4096,
    temperature: 0.3,
  },
  worker: {
    concurrency: 3,
    max_retries: 3,
    retry_delay_ms: 2000,
  },
  paths: {
    media_dir: path.resolve(process.cwd(), 'tmp/media'),
    download_dir: path.resolve(process.cwd(), 'tmp/downloads'),
    export_dir: path.resolve(process.cwd(), 'tmp/exports'),
  },
  logging: {
    level: 'info',
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepMerge(base: any, override: any): any {
  if (override === null || override === undefined) return base;
  if (typeof override !== 'object' || Array.isArray(override)) return override;
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const baseVal = base?.[key];
    const overVal = override[key];
    // Skip empty strings so they don't overwrite defaults
    if (overVal === '' || overVal === undefined) continue;
    if (
      typeof baseVal === 'object' && baseVal !== null &&
      typeof overVal === 'object' && overVal !== null &&
      !Array.isArray(baseVal) && !Array.isArray(overVal)
    ) {
      result[key] = deepMerge(baseVal, overVal);
    } else if (overVal !== undefined) {
      result[key] = overVal;
    }
  }
  return result;
}

function resolveEnvVariables(obj: unknown): unknown {
  if (typeof obj === 'string') {
    const match = obj.match(/^\$\{(\w+)\}$/);
    if (match) {
      return process.env[match[1]] ?? '';
    }
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(resolveEnvVariables);
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = resolveEnvVariables(v);
    }
    return result;
  }
  return obj;
}

export function loadConfig(): Config {
  // Load file config first (highest priority)
  const configPath = expandPath('~/.scopai/config.json');
  let fileConfig: Partial<Config> = {};
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(content) as Partial<Config>;
    } catch {
      // ignore parse errors
    }
  }

  // Claude Code config fallback (lowest priority)
  const claudeConfig = loadClaudeConfig();
  const claudeFallback: Partial<Config> = {
    anthropic: {
      api_key: claudeConfig.api_key ?? '',
      base_url: claudeConfig.base_url ?? '',
      model: '',
      max_tokens: 4096,
      temperature: 0.3,
    },
  };

  // Environment variable overrides
  const envConfig: Partial<Config> = {
    anthropic: {
      api_key: process.env.ANTHROPIC_API_KEY ?? '',
      base_url: process.env.ANTHROPIC_BASE_URL ?? '',
      model: process.env.ANTHROPIC_MODEL ?? '',
      max_tokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS ?? '4096', 10),
      temperature: parseFloat(process.env.ANTHROPIC_TEMPERATURE ?? '0.3'),
    },
    database: {
      path: process.env.ANALYZE_CLI_DB_PATH ?? '',
    },
    worker: {
      concurrency: parseInt(process.env.ANALYZE_CLI_WORKERS ?? '1', 10),
      max_retries: 3,
      retry_delay_ms: 2000,
    },
    logging: {
      level: (process.env.ANALYZE_CLI_LOG_LEVEL as Config['logging']['level']) ?? 'info',
    },
  };

  // Priority: config.json (highest) > claude settings > env vars > defaults (lowest)
  const withEnv = deepMerge(DEFAULT_CONFIG, envConfig);
  const withClaude = deepMerge(withEnv, claudeFallback);
  const resolved = deepMerge(withClaude, fileConfig);
  return resolveEnvVariables(resolved) as Config;
}

export const config = loadConfig();
