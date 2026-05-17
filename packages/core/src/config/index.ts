import * as fs from 'fs';
import * as path from 'path';
import { Config, LLMApiConfig } from '../shared/types';
import { expandPath } from '../shared/utils';
import { loadClaudeConfig } from './claude-config';

const DEFAULT_CONFIG: Config = {
  database: {
    path: expandPath('~/.scopai/data.duckdb'),
  },
  llm_api: 'default',
  llm_apis: [
    {
      name: 'default',
      type: 'anthropic',
      api_key: '',
      model: 'claude-opus-4-5-20250514',
      max_tokens: 4096,
      temperature: 0.3,
    },
    {
      name: 'openai',
      type: 'openai',
      api_key: '',
      base_url: 'https://api.openai.com',
      model: 'gpt-4o',
      max_tokens: 4096,
      temperature: 0.3,
    },
  ],
  worker: {
    concurrency: 3,
    max_retries: 3,
    retry_delay_ms: 2000,
  },
  paths: {
    media_dir: expandPath('~/.scopai/media'),
    download_dir: expandPath('~/.scopai/downloads'),
    export_dir: expandPath('~/.scopai/exports'),
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

function applyRuntimeEnvOverrides(config: Config): void {
  if (process.env.ANALYZE_CLI_DB_PATH) {
    config.database.path = expandPath(process.env.ANALYZE_CLI_DB_PATH);
  }
  if (process.env.ANALYZE_CLI_LOG_LEVEL) {
    config.logging.level = process.env.ANALYZE_CLI_LOG_LEVEL as Config['logging']['level'];
  }
  if (process.env.ANALYZE_CLI_MEDIA_DIR) {
    config.paths.media_dir = expandPath(process.env.ANALYZE_CLI_MEDIA_DIR);
  }
  if (process.env.ANALYZE_CLI_DOWNLOAD_DIR) {
    config.paths.download_dir = expandPath(process.env.ANALYZE_CLI_DOWNLOAD_DIR);
  }
  if (process.env.ANALYZE_CLI_EXPORT_DIR) {
    config.paths.export_dir = expandPath(process.env.ANALYZE_CLI_EXPORT_DIR);
  }
}

export function loadConfig(): Config {
  const configPath = expandPath('~/.scopai/config.json');

  // If config.json exists, use it exclusively with defaults as fallback only
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      const fileConfig = JSON.parse(content) as Partial<Config>;
      const merged = deepMerge(DEFAULT_CONFIG, fileConfig);
      const config = resolveEnvVariables(merged) as Config;
      applyRuntimeEnvOverrides(config);
      return normalizeLlmConfig(config);
    } catch {
      // ignore parse errors, fall through to fallback
    }
  }

  // Fallback chain only used when config.json does not exist
  const claudeConfig = loadClaudeConfig();
  const claudeFallback: Partial<Config> = {
    llm_apis: [
      {
        name: 'default',
        type: 'anthropic',
        api_key: claudeConfig.api_key ?? '',
        base_url: claudeConfig.base_url ?? '',
        model: '',
        max_tokens: 4096,
        temperature: 0.3,
      },
    ],
  };

  const envLlmApis: LLMApiConfig[] = [];
  if (process.env.ANTHROPIC_API_KEY) {
    envLlmApis.push({
      name: 'default',
      type: 'anthropic',
      api_key: process.env.ANTHROPIC_API_KEY,
      base_url: process.env.ANTHROPIC_BASE_URL ?? '',
      model: process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-5-20250514',
      max_tokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS ?? '4096', 10),
      temperature: parseFloat(process.env.ANTHROPIC_TEMPERATURE ?? '0.3'),
    });
  }
  if (process.env.OPENAI_API_KEY) {
    envLlmApis.push({
      name: 'openai',
      type: 'openai',
      api_key: process.env.OPENAI_API_KEY,
      base_url: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com',
      model: process.env.OPENAI_MODEL ?? 'gpt-4o',
      max_tokens: parseInt(process.env.OPENAI_MAX_TOKENS ?? '4096', 10),
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE ?? '0.3'),
    });
  }

  const envConfig: Partial<Config> = {
    llm_api: process.env.LLM_API ?? undefined,
    ...(envLlmApis.length > 0 ? { llm_apis: envLlmApis } : {}),
    database: {
      path: process.env.ANALYZE_CLI_DB_PATH ?? '',
    },
    paths: {
      media_dir: process.env.ANALYZE_CLI_MEDIA_DIR ? expandPath(process.env.ANALYZE_CLI_MEDIA_DIR) : '',
      download_dir: process.env.ANALYZE_CLI_DOWNLOAD_DIR ? expandPath(process.env.ANALYZE_CLI_DOWNLOAD_DIR) : '',
      export_dir: process.env.ANALYZE_CLI_EXPORT_DIR ? expandPath(process.env.ANALYZE_CLI_EXPORT_DIR) : '',
    },
    worker: {
      concurrency: 3,
      max_retries: 3,
      retry_delay_ms: 2000,
    },
    logging: {
      level: (process.env.ANALYZE_CLI_LOG_LEVEL as Config['logging']['level']) ?? 'info',
    },
  };

  const withEnv = deepMerge(DEFAULT_CONFIG, envConfig);
  const withClaude = deepMerge(withEnv, claudeFallback);
  const config = resolveEnvVariables(withClaude) as Config;
  return normalizeLlmConfig(config);
}

function normalizeLlmConfig(config: Config): Config {
  const hasNewConfig = config.llm_apis && config.llm_apis.length > 0;
  const hasLegacy = config.api_format || config.anthropic || config.openai;

  if (hasNewConfig && !hasLegacy) {
    return config;
  }

  const apis: LLMApiConfig[] = config.llm_apis ? [...config.llm_apis] : [];

  // Convert legacy anthropic config
  if (config.anthropic && config.anthropic.api_key) {
    const existing = apis.find(a => a.name === 'default' && a.type === 'anthropic');
    if (!existing) {
      apis.unshift({
        name: 'default',
        type: 'anthropic',
        ...config.anthropic,
      });
    }
  }

  // Convert legacy openai config
  if (config.openai && config.openai.api_key) {
    const existing = apis.find(a => a.name === 'openai' && a.type === 'openai');
    if (!existing) {
      apis.push({
        name: 'openai',
        type: 'openai',
        ...config.openai,
      });
    }
  }

  // Determine llm_api from legacy api_format
  let llmApi = config.llm_api;
  if (!llmApi && config.api_format) {
    llmApi = config.api_format === 'openai' ? 'openai' : 'default';
  }
  if (!llmApi && apis.length > 0) {
    llmApi = apis[0].name;
  }

  return {
    ...config,
    llm_api: llmApi,
    llm_apis: apis.length > 0 ? apis : config.llm_apis,
  };
}

export const config = loadConfig();
