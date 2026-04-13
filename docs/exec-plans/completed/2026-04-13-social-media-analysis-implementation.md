# 社交媒体分析 CLI 工具 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个完整的 AI Agent 调用型社交媒体内容/评论分析 CLI 工具，支持大批量数据处理、数据存储查询和任务批次管理。

**Architecture:** TypeScript + Node.js CLI 工具。CLI 通过 Unix Socket 向守护进程发送 JSON-RPC 请求，守护进程协调 Bree 队列调度 Worker，Worker 调用 Claude API，结果写回 DuckDB。所有写操作经守护进程，天然解决多 CLI 并发问题。

**Tech Stack:** TypeScript, Node.js, DuckDB (duckdb npm), Bree, Anthropic SDK, commander.js, Typescript

---

## 文件结构

```
analyze-cli/
├── package.json
├── tsconfig.json
├── src/
│   ├── cli/
│   │   ├── index.ts          # CLI 入口，commander 加载所有命令
│   │   ├── daemon.ts         # daemon start/stop/status 命令
│   │   ├── platform.ts      # platform list/add/mapping 命令
│   │   ├── post.ts           # post import/add/list/search 命令
│   │   ├── comment.ts        # comment import/list 命令
│   │   ├── task.ts           # task create/add/start/pause/resume/cancel/list/status 命令
│   │   ├── template.ts       # template list/add/update/test 命令
│   │   └── result.ts         # result list/show/stats/export 命令
│   ├── daemon/
│   │   ├── index.ts          # 守护进程主入口
│   │   ├── ipc-server.ts     # Unix Socket JSON-RPC 2.0 服务器
│   │   ├── bree-adapter.ts   # Bree DuckDB Adapter
│   │   ├── handlers.ts       # IPC 方法处理器 (post.import, task.create 等)
│   │   └── worker-pool.ts    # Worker 进程池管理
│   ├── worker/
│   │   ├── index.ts          # Worker 进程入口
│   │   ├── consumer.ts        # 任务消费逻辑
│   │   ├── anthropic.ts       # Anthropic API 调用封装
│   │   └── parser.ts          # LLM 响应解析器
│   ├── db/
│   │   ├── client.ts         # DuckDB 连接管理
│   │   ├── schema.sql        # 完整 DDL
│   │   ├── migrate.ts         # 迁移运行器
│   │   ├── seed.ts           # 初始化数据 (平台+映射+模板)
│   │   ├── platforms.ts      # platforms CRUD
│   │   ├── posts.ts          # posts CRUD
│   │   ├── comments.ts       # comments CRUD
│   │   ├── media-files.ts    # media_files CRUD
│   │   ├── tasks.ts          # tasks CRUD
│   │   ├── task-targets.ts   # task_targets CRUD
│   │   ├── analysis-results.ts # analysis_results CRUD
│   │   ├── templates.ts      # prompt_templates CRUD
│   │   └── queue-jobs.ts     # queue_jobs CRUD
│   ├── config/
│   │   └── index.ts          # 配置加载器 (config.json → Claude Code → env)
│   └── shared/
│       ├── types.ts          # 所有 TypeScript 类型定义
│       ├── constants.ts      # 枚举值、平台列表
│       └── utils.ts          # UUID、时间等工具函数
├── templates/
│   ├── sentiment.json         # 情感分析模板
│   ├── topics.json           # 话题分类模板
│   ├── risk.json             # 风险检测模板
│   └── media-image.json       # 媒体图片分析模板
└── bin/
    └── analyze-cli.js         # 可执行入口 (#!/usr/bin/env node)
```

---

## 第一阶段：项目初始化与基础设施

### Task 1: 项目初始化与依赖安装

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bin/analyze-cli.js`
- Create: `src/shared/types.ts`
- Create: `src/shared/constants.ts`
- Create: `src/shared/utils.ts`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "analyze-cli",
  "version": "0.1.0",
  "description": "AI-powered social media content analysis CLI tool",
  "main": "dist/cli/index.js",
  "bin": {
    "analyze-cli": "./bin/analyze-cli.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.32.1",
    "bree": "^9.4.4",
    "commander": "^12.1.0",
    "duckdb": "^1.2.1",
    "picocolors": "^1.1.1",
    "uuid": "^11.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.3",
    "@types/uuid": "^10.0.0",
    "typescript": "^5.8.3"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

- [ ] **Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: 创建 src/shared/types.ts（全部类型定义）**

```ts
// === Platform ===
export interface Platform {
  id: string;
  name: string;
  description: string | null;
  created_at: Date;
}

export interface FieldMapping {
  id: string;
  platform_id: string;
  entity_type: 'post' | 'comment' | 'user';
  system_field: string;
  platform_field: string;
  data_type: 'string' | 'number' | 'date' | 'boolean' | 'array' | 'json';
  is_required: boolean;
  transform_expr: string | null;
  description: string | null;
}

// === Post ===
export type PostType = 'text' | 'image' | 'video' | 'audio' | 'article' | 'carousel' | 'mixed';

export interface Post {
  id: string;
  platform_id: string;
  platform_post_id: string;
  title: string | null;
  content: string;
  author_id: string | null;
  author_name: string | null;
  author_url: string | null;
  url: string | null;
  cover_url: string | null;
  post_type: PostType | null;
  like_count: number;
  collect_count: number;
  comment_count: number;
  share_count: number;
  play_count: number;
  score: number | null;
  tags: Tag[] | null;
  media_files: MediaFileRef[] | null;
  published_at: Date | null;
  fetched_at: Date;
  metadata: Record<string, unknown> | null;
}

export interface Tag {
  name: string;
  url?: string;
}

export interface MediaFileRef {
  type: 'image' | 'video' | 'audio';
  url: string;
  local_path?: string;
}

// === Comment ===
export interface Comment {
  id: string;
  post_id: string;
  platform_id: string;
  platform_comment_id: string | null;
  parent_comment_id: string | null;
  root_comment_id: string | null;
  depth: number;
  author_id: string | null;
  author_name: string | null;
  content: string;
  like_count: number;
  reply_count: number;
  published_at: Date | null;
  fetched_at: Date;
  metadata: Record<string, unknown> | null;
}

// === MediaFile ===
export type MediaType = 'image' | 'video' | 'audio';

export interface MediaFile {
  id: string;
  post_id: string | null;
  comment_id: string | null;
  platform_id: string | null;
  media_type: MediaType;
  url: string;
  local_path: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  file_size: number | null;
  downloaded_at: Date | null;
  created_at: Date;
}

// === Task ===
export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
export type TargetStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface Task {
  id: string;
  name: string;
  description: string | null;
  template_id: string | null;
  status: TaskStatus;
  stats: TaskStats | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
}

export interface TaskStats {
  total: number;
  done: number;
  failed: number;
}

export interface TaskTarget {
  id: string;
  task_id: string;
  target_type: 'post' | 'comment';
  target_id: string;
  status: TargetStatus;
  error: string | null;
  created_at: Date;
}

// === Analysis Results ===
export type SentimentLabel = 'positive' | 'negative' | 'neutral';
export type CommentIntent = 'praise' | 'complaint' | 'question' | 'suggestion' | 'neutral' | 'other';
export type RiskLevel = 'low' | 'medium' | 'high';
export type MediaContentType = 'product' | 'person' | 'scene' | 'text' | 'screenshot' | 'meme' | 'other';

export interface AnalysisResultComment {
  id: string;
  task_id: string;
  comment_id: string;
  sentiment_label: SentimentLabel | null;
  sentiment_score: number | null;
  intent: CommentIntent | null;
  risk_flagged: boolean;
  risk_level: RiskLevel | null;
  risk_reason: string | null;
  topics: TopicTag[] | null;
  emotion_tags: EmotionTag[] | null;
  keywords: string[] | null;
  summary: string | null;
  raw_response: Record<string, unknown> | null;
  error: string | null;
  analyzed_at: Date;
}

export interface TopicTag {
  name: string;
  confidence: number;
}

export interface EmotionTag {
  tag: string;
  confidence: number;
}

export interface AnalysisResultMedia {
  id: string;
  task_id: string;
  media_id: string;
  media_type: MediaType;
  content_type: MediaContentType | null;
  description: string | null;
  ocr_text: string | null;
  sentiment_label: SentimentLabel | null;
  sentiment_score: number | null;
  risk_flagged: boolean;
  risk_level: RiskLevel | null;
  risk_reason: string | null;
  objects: DetectedObject[] | null;
  logos: DetectedLogo[] | null;
  faces: DetectedFace[] | null;
  raw_response: Record<string, unknown> | null;
  error: string | null;
  analyzed_at: Date;
}

export interface DetectedObject {
  label: string;
  confidence: number;
}

export interface DetectedLogo {
  name: string;
  confidence: number;
}

export interface DetectedFace {
  age?: number;
  gender?: string;
  emotion?: string;
}

// === Prompt Template ===
export interface PromptTemplate {
  id: string;
  name: string;
  description: string | null;
  template: string;
  is_default: boolean;
  created_at: Date;
}

// === Queue ===
export type QueueStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface QueueJob {
  id: string;
  task_id: string;
  target_type: 'post' | 'comment' | null;
  target_id: string | null;
  status: QueueStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  error: string | null;
  created_at: Date;
  processed_at: Date | null;
}

// === Config ===
export interface Config {
  database: {
    path: string;
  };
  anthropic: {
    api_key: string;
    model: string;
    max_tokens: number;
    temperature: number;
  };
  worker: {
    concurrency: number;
    max_retries: number;
    retry_delay_ms: number;
  };
  paths: {
    media_dir: string;
    export_dir: string;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

// === IPC ===
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
  id: number | string;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number | string;
}
```

- [ ] **Step 4: 创建 src/shared/constants.ts**

```ts
export const PLATFORMS = [
  { id: 'xhs',       name: 'xiaohongshu',  description: '小红书' },
  { id: 'twitter',   name: 'twitter',       description: 'Twitter/X' },
  { id: 'weibo',    name: 'weibo',         description: '微博' },
  { id: 'bilibili', name: 'bilibili',       description: 'Bilibili' },
  { id: 'zhihu',    name: 'zhihu',          description: '知乎' },
  { id: 'reddit',   name: 'reddit',         description: 'Reddit' },
  { id: 'douyin',   name: 'douyin',         description: '抖音' },
  { id: 'instagram',name: 'instagram',      description: 'Instagram' },
  { id: 'tiktok',   name: 'tiktok',         description: 'TikTok' },
  { id: 'weixin',   name: 'weixin',         description: '微信公众平台' },
  { id: 'bluesky',  name: 'bluesky',        description: 'Bluesky' },
] as const;

export const POST_TYPES = ['text', 'image', 'video', 'audio', 'article', 'carousel', 'mixed'] as const;
export const TASK_STATUSES = ['pending', 'running', 'paused', 'completed', 'failed'] as const;
export const TARGET_STATUSES = ['pending', 'processing', 'done', 'failed'] as const;
export const SENTIMENT_LABELS = ['positive', 'negative', 'neutral'] as const;
export const COMMENT_INTENTS = ['praise', 'complaint', 'question', 'suggestion', 'neutral', 'other'] as const;
export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export const MEDIA_TYPES = ['image', 'video', 'audio'] as const;
export const MEDIA_CONTENT_TYPES = ['product', 'person', 'scene', 'text', 'screenshot', 'meme', 'other'] as const;
export const QUEUE_STATUSES = ['pending', 'processing', 'completed', 'failed'] as const;

export const IPC_SOCKET_PATH = '/tmp/analyze-cli.sock';
export const DAEMON_PID_FILE = '/tmp/analyze-cli.pid';
export const DEFAULT_WORKERS = 2;
```

- [ ] **Step 5: 创建 src/shared/utils.ts**

```ts
import { v4 as uuidv4 } from 'uuid';

export function generateId(): string {
  return uuidv4();
}

export function now(): Date {
  return new Date();
}

export function expandPath(path: string): string {
  if (path.startsWith('~/')) {
    const home = process.env.HOME ?? '';
    return path.replace(/^~/, home);
  }
  return path;
}

export function formatDate(date: Date): string {
  return date.toISOString();
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
): Promise<T> {
  return fn().catch(async (err) => {
    if (maxRetries <= 0) throw err;
    await sleep(baseDelayMs);
    return retryWithBackoff(fn, maxRetries - 1, baseDelayMs * 2);
  });
}
```

- [ ] **Step 6: 创建 bin/analyze-cli.js**

```js
#!/usr/bin/env node
require('../dist/cli/index.js');
```

Run: `chmod +x bin/analyze-cli.js`

- [ ] **Step 7: 安装依赖**

Run: `npm install` in /Users/huhui/Projects/analyze-cli/

- [ ] **Step 8: 编译验证**

Run: `npx tsc` in /Users/huhui/Projects/analyze-cli/
Expected: 无编译错误

- [ ] **Step 9: 提交**

```bash
git add package.json tsconfig.json src/shared/ bin/ && git commit -m "feat: project initialization with TypeScript, dependencies, and shared types"
```

---

### Task 2: 配置加载器

**Files:**
- Create: `src/config/index.ts`
- Create: `src/config/claude-config.ts` (Claude Code 配置读取)

- [ ] **Step 1: 创建 src/config/claude-config.ts**

Claude Code 配置文件路径：`~/.claude/settings.json`

```ts
import * as fs from 'fs';
import * as path from 'path';
import { expandPath } from '../shared/utils';

export interface ClaudeConfig {
  api_key?: string;
  base_url?: string;
}

export function loadClaudeConfig(): ClaudeConfig {
  const configPath = expandPath('~/.claude/settings.json');
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const data = JSON.parse(content);
    return {
      api_key: data.api_key,
      base_url: data.base_url,
    };
  } catch {
    return {};
  }
}
```

- [ ] **Step 2: 创建 src/config/index.ts**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../shared/types';
import { expandPath } from '../shared/utils';
import { loadClaudeConfig } from './claude-config';

const DEFAULT_CONFIG: Config = {
  database: {
    path: expandPath('~/.analyze-cli/data.duckdb'),
  },
  anthropic: {
    api_key: '',
    model: 'claude-opus-4-5-20250514',
    max_tokens: 4096,
    temperature: 0.3,
  },
  worker: {
    concurrency: 2,
    max_retries: 3,
    retry_delay_ms: 2000,
  },
  paths: {
    media_dir: expandPath('~/.analyze-cli/media'),
    export_dir: expandPath('~/.analyze-cli/exports'),
  },
  logging: {
    level: 'info',
  },
};

function deepMerge<T extends Record<string, unknown>>(base: T, override: Partial<T>): T {
  const result = { ...base };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const baseVal = base[key];
    const overVal = override[key];
    if (typeof baseVal === 'object' && typeof overVal === 'object' && baseVal !== null && overVal !== null && !Array.isArray(baseVal) && !Array.isArray(overVal)) {
      (result as T)[key] = deepMerge(baseVal as Record<string, unknown>, overVal as Record<string, unknown>) as T[keyof T];
    } else if (overVal !== undefined) {
      (result as T)[key] = overVal as T[keyof T];
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
  const configPath = expandPath('~/.analyze-cli/config.json');
  let fileConfig: Partial<Config> = {};
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      fileConfig = JSON.parse(content) as Partial<Config>;
    } catch {
      // ignore
    }
  }

  // 环境变量覆盖
  const envConfig: Partial<Config> = {
    anthropic: {
      api_key: process.env.ANTHROPIC_API_KEY ?? '',
      model: process.env.ANTHROPIC_MODEL ?? '',
      max_tokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS ?? '4096', 10),
      temperature: parseFloat(process.env.ANTHROPIC_TEMPERATURE ?? '0.3'),
    },
    database: {
      path: process.env.ANALYZE_CLI_DB_PATH ?? '',
    },
    worker: {
      concurrency: parseInt(process.env.ANALYZE_CLI_WORKERS ?? '2', 10),
      max_retries: 3,
      retry_delay_ms: 2000,
    },
    logging: {
      level: (process.env.ANALYZE_CLI_LOG_LEVEL as Config['logging']['level']) ?? 'info',
    },
  };

  // Claude Code 配置降级读取
  const claudeConfig = loadClaudeConfig();
  if (!envConfig.anthropic?.api_key && !fileConfig.anthropic?.api_key) {
    if (claudeConfig.api_key) {
      if (!envConfig.anthropic) envConfig.anthropic = { ...DEFAULT_CONFIG.anthropic };
      envConfig.anthropic.api_key = claudeConfig.api_key;
    }
    if (claudeConfig.base_url && !envConfig.anthropic?.model) {
      if (!envConfig.anthropic) envConfig.anthropic = { ...DEFAULT_CONFIG.anthropic };
      (envConfig.anthropic as Record<string, unknown>).base_url = claudeConfig.base_url;
    }
  }

  const resolved = deepMerge(DEFAULT_CONFIG, fileConfig);
  const withEnv = deepMerge(resolved, envConfig);
  return resolveEnvVariables(withEnv) as Config;
}

export const config = loadConfig();
```

- [ ] **Step 3: 编译验证**

Run: `npx tsc` in /Users/huhui/Projects/analyze-cli/
Expected: 无编译错误

- [ ] **Step 4: 提交**

```bash
git add src/config/ && git commit -m "feat: add config loader with Claude Code config fallback"
```

---

## 第二阶段：数据库层

### Task 3: 数据库连接与 Schema

**Files:**
- Create: `src/db/schema.sql`
- Create: `src/db/client.ts`
- Create: `src/db/migrate.ts`

- [ ] **Step 1: 创建 src/db/schema.sql（完整 DDL）**

```sql
CREATE TABLE IF NOT EXISTS platforms (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS field_mappings (
    id              TEXT PRIMARY KEY,
    platform_id     TEXT NOT NULL REFERENCES platforms(id),
    entity_type     TEXT NOT NULL CHECK(entity_type IN ('post','comment','user')),
    system_field    TEXT NOT NULL,
    platform_field  TEXT NOT NULL,
    data_type       TEXT NOT NULL CHECK(data_type IN ('string','number','date','boolean','array','json')),
    is_required     BOOLEAN DEFAULT false,
    transform_expr  TEXT,
    description     TEXT,
    UNIQUE(platform_id, entity_type, system_field)
);

CREATE TABLE IF NOT EXISTS posts (
    id                  TEXT PRIMARY KEY,
    platform_id         TEXT NOT NULL REFERENCES platforms(id),
    platform_post_id    TEXT NOT NULL,
    title               TEXT,
    content             TEXT NOT NULL,
    author_id           TEXT,
    author_name         TEXT,
    author_url          TEXT,
    url                 TEXT,
    cover_url           TEXT,
    post_type           TEXT,
    like_count          INTEGER DEFAULT 0,
    collect_count       INTEGER DEFAULT 0,
    comment_count       INTEGER DEFAULT 0,
    share_count         INTEGER DEFAULT 0,
    play_count          INTEGER DEFAULT 0,
    score               INTEGER,
    tags                JSON,
    media_files         JSON,
    published_at        TIMESTAMP,
    fetched_at          TIMESTAMP DEFAULT NOW(),
    metadata            JSON,
    UNIQUE(platform_id, platform_post_id)
);

CREATE TABLE IF NOT EXISTS comments (
    id                  TEXT PRIMARY KEY,
    post_id             TEXT NOT NULL REFERENCES posts(id),
    platform_id         TEXT NOT NULL REFERENCES platforms(id),
    platform_comment_id TEXT,
    parent_comment_id   TEXT,
    root_comment_id     TEXT,
    depth               INTEGER DEFAULT 0,
    author_id           TEXT,
    author_name         TEXT,
    content             TEXT NOT NULL,
    like_count          INTEGER DEFAULT 0,
    reply_count         INTEGER DEFAULT 0,
    published_at        TIMESTAMP,
    fetched_at          TIMESTAMP DEFAULT NOW(),
    metadata            JSON
);

CREATE TABLE IF NOT EXISTS media_files (
    id              TEXT PRIMARY KEY,
    post_id         TEXT REFERENCES posts(id),
    comment_id      TEXT REFERENCES comments(id),
    platform_id     TEXT REFERENCES platforms(id),
    media_type      TEXT NOT NULL,
    url             TEXT NOT NULL,
    local_path      TEXT,
    width           INTEGER,
    height          INTEGER,
    duration_ms     INTEGER,
    file_size       INTEGER,
    downloaded_at   TIMESTAMP,
    created_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prompt_templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    template    TEXT NOT NULL,
    is_default  BOOLEAN DEFAULT false,
    created_at  TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    template_id TEXT REFERENCES prompt_templates(id),
    status      TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','paused','completed','failed')),
    stats       JSON,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS task_targets (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES tasks(id),
    target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')),
    target_id   TEXT NOT NULL,
    status      TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),
    error       TEXT,
    created_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE(task_id, target_type, target_id)
);

CREATE TABLE IF NOT EXISTS analysis_results_comments (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    comment_id      TEXT NOT NULL REFERENCES comments(id),
    sentiment_label TEXT,
    sentiment_score DOUBLE,
    intent          TEXT,
    risk_flagged    BOOLEAN DEFAULT false,
    risk_level      TEXT,
    risk_reason     TEXT,
    topics          JSON,
    emotion_tags    JSON,
    keywords        JSON,
    summary         TEXT,
    raw_response    JSON,
    error           TEXT,
    analyzed_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analysis_results_media (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    media_id        TEXT NOT NULL REFERENCES media_files(id),
    media_type      TEXT NOT NULL,
    content_type    TEXT,
    description     TEXT,
    ocr_text        TEXT,
    sentiment_label TEXT,
    sentiment_score DOUBLE,
    risk_flagged    BOOLEAN DEFAULT false,
    risk_level      TEXT,
    risk_reason     TEXT,
    objects         JSON,
    logos           JSON,
    faces           JSON,
    raw_response    JSON,
    error           TEXT,
    analyzed_at     TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS queue_jobs (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    target_type     TEXT,
    target_id       TEXT,
    status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
    priority        INTEGER DEFAULT 0,
    attempts        INTEGER DEFAULT 0,
    max_attempts    INTEGER DEFAULT 3,
    error           TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    processed_at    TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform_id);
CREATE INDEX IF NOT EXISTS idx_posts_published ON posts(published_at);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_platform ON comments(platform_id);
CREATE INDEX IF NOT EXISTS idx_task_targets_task ON task_targets(task_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_comments_task ON analysis_results_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_comments_sentiment ON analysis_results_comments(sentiment_label);
CREATE INDEX IF NOT EXISTS idx_analysis_results_media_task ON analysis_results_media(task_id);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_status ON queue_jobs(status);
```

- [ ] **Step 2: 创建 src/db/client.ts**

```ts
import duckdb from 'duckdb';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';
import { expandPath } from '../shared/utils';

let _conn: duckdb.Connection | null = null;

export function getDbPath(): string {
  const dbPath = expandPath(config.database.path);
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dbPath;
}

export function getConnection(): duckdb.Connection {
  if (!_conn) {
    const db = new duckdb.Database(getDbPath());
    _conn = db.connect();
  }
  return _conn;
}

export function query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
  const conn = getConnection();
  const result = params ? conn.query(sql, params) : conn.query(sql);
  return result.toArray().map(row => {
    const obj: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(row)) {
      obj[key] = val;
    }
    return obj as T;
  });
}

export function run(sql: string, params?: unknown[]): void {
  const conn = getConnection();
  if (params) {
    conn.run(sql, params);
  } else {
    conn.run(sql);
  }
}

export function close(): void {
  if (_conn) {
    _conn.close();
    _conn = null;
  }
}
```

- [ ] **Step 3: 创建 src/db/migrate.ts**

```ts
import * as fs from 'fs';
import * as path from 'path';
import { getConnection } from './client';

export function runMigrations(): void {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  const conn = getConnection();
  conn.streamfs(schemaPath);
  // DuckDB 的 run 一次性执行整个 schema
  run(schema);
}

function run(sql: string): void {
  const conn = getConnection();
  conn.run(sql);
}
```

- [ ] **Step 4: 编译验证**

Run: `npx tsc` in /Users/huhui/Projects/analyze-cli/
Expected: 无编译错误

- [ ] **Step 5: 提交**

```bash
git add src/db/schema.sql src/db/client.ts src/db/migrate.ts && git commit -m "feat: add DuckDB connection, schema, and migration runner"
```

---

### Task 4: 数据库 CRUD 仓库

**Files:**
- Create: `src/db/platforms.ts`
- Create: `src/db/field-mappings.ts`
- Create: `src/db/posts.ts`
- Create: `src/db/comments.ts`
- Create: `src/db/media-files.ts`
- Create: `src/db/tasks.ts`
- Create: `src/db/task-targets.ts`
- Create: `src/db/analysis-results.ts`
- Create: `src/db/templates.ts`
- Create: `src/db/queue-jobs.ts`

每个文件遵循相同模式：以 `src/db/posts.ts` 为例：

```ts
import { query, run } from './client';
import { Post } from '../shared/types';
import { generateId, now } from '../shared/utils';

export function createPost(post: Omit<Post, 'id' | 'fetched_at'>): Post {
  const id = generateId();
  const ts = now();
  run(
    `INSERT INTO posts (id, platform_id, platform_post_id, title, content, author_id, author_name,
     author_url, url, cover_url, post_type, like_count, collect_count, comment_count,
     share_count, play_count, score, tags, media_files, published_at, fetched_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, post.platform_id, post.platform_post_id, post.title, post.content, post.author_id,
     post.author_name, post.author_url, post.url, post.cover_url, post.post_type, post.like_count,
     post.collect_count, post.comment_count, post.share_count, post.play_count, post.score,
     post.tags ? JSON.stringify(post.tags) : null, post.media_files ? JSON.stringify(post.media_files) : null,
     post.published_at, ts, post.metadata ? JSON.stringify(post.metadata) : null]
  );
  return { ...post, id, fetched_at: ts };
}

export function listPosts(platformId?: string, limit = 50, offset = 0): Post[] {
  let sql = 'SELECT * FROM posts';
  const params: unknown[] = [];
  if (platformId) {
    sql += ' WHERE platform_id = ?';
    params.push(platformId);
  }
  sql += ' ORDER BY fetched_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  return query<Post>(sql, params);
}

export function getPostById(id: string): Post | null {
  const rows = query<Post>('SELECT * FROM posts WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export function searchPosts(platformId: string, queryText: string, limit = 50): Post[] {
  return query<Post>(
    `SELECT * FROM posts WHERE platform_id = ? AND content LIKE ? ORDER BY fetched_at DESC LIMIT ?`,
    [platformId, `%${queryText}%`, limit]
  );
}

export function queryPosts(platformId: string, whereClause: string, limit = 1000): Post[] {
  return query<Post>(
    `SELECT * FROM posts WHERE platform_id = ? AND ${whereClause} LIMIT ?`,
    [platformId, limit]
  );
}

export function countPosts(platformId?: string): number {
  const sql = platformId
    ? 'SELECT COUNT(*) as cnt FROM posts WHERE platform_id = ?'
    : 'SELECT COUNT(*) as cnt FROM posts';
  const params = platformId ? [platformId] : [];
  const rows = query<{ cnt: bigint }>(sql, params);
  return Number(rows[0]?.cnt ?? 0);
}
```

其他 CRUD 文件（platforms, comments, tasks 等）遵循完全相同的模式——`create*`, `list*`, `get*ById`, `update*Status` 等方法。

- [ ] **Step 1: 创建 src/db/platforms.ts**

实现: `createPlatform`, `listPlatforms`, `getPlatformById`, `upsertPlatform`

- [ ] **Step 2: 创建 src/db/field-mappings.ts**

实现: `createFieldMapping`, `listFieldMappings`, `getMappingsForPlatform`

- [ ] **Step 3: 创建 src/db/posts.ts**

实现: `createPost`, `listPosts`, `getPostById`, `searchPosts`, `queryPosts`, `countPosts`

- [ ] **Step 4: 创建 src/db/comments.ts**

实现: `createComment`, `listCommentsByPost`, `getCommentById`, `countComments`

- [ ] **Step 5: 创建 src/db/media-files.ts**

实现: `createMediaFile`, `listMediaFilesByPost`, `getMediaFileById`

- [ ] **Step 6: 创建 src/db/tasks.ts**

实现: `createTask`, `getTaskById`, `listTasks`, `updateTaskStatus`, `updateTaskStats`

- [ ] **Step 7: 创建 src/db/task-targets.ts**

实现: `createTaskTarget`, `addTaskTargets` (批量), `listTaskTargets`, `updateTargetStatus`, `getTargetStats`

- [ ] **Step 8: 创建 src/db/analysis-results.ts**

实现: `createAnalysisResultComment`, `createAnalysisResultMedia`, `listResultsByTask`, `getResultById`, `aggregateStats`

- [ ] **Step 9: 创建 src/db/templates.ts**

实现: `createTemplate`, `listTemplates`, `getTemplateById`, `getTemplateByName`, `updateTemplate`, `setDefaultTemplate`

- [ ] **Step 10: 创建 src/db/queue-jobs.ts**

实现: `enqueueJob`, `enqueueJobs` (批量), `getNextJob`, `updateJobStatus`, `listJobsByTask`

- [ ] **Step 11: 编译验证**

Run: `npx tsc` in /Users/huhui/Projects/analyze-cli/
Expected: 无编译错误

- [ ] **Step 12: 提交**

```bash
git add src/db/*.ts && git commit -m "feat: add database CRUD repositories for all 11 tables"
```

---

### Task 5: 初始化种子数据

**Files:**
- Create: `src/db/seed.ts`

- [ ] **Step 1: 创建 src/db/seed.ts（平台数据 + 11平台字段映射）**

```ts
import { createPlatform, upsertPlatform } from './platforms';
import { createFieldMapping } from './field-mappings';
import { createTemplate } from './templates';
import { PLATFORMS } from '../shared/constants';
import { generateId } from '../shared/utils';

interface FieldMapDef {
  entity_type: 'post' | 'comment';
  system_field: string;
  platform_field: string;
  data_type: string;
  is_required: boolean;
  description: string;
}

const PLATFORM_MAPPINGS: Record<string, FieldMapDef[]> = {
  xhs: [
    { entity_type: 'post', system_field: 'platform_post_id', platform_field: 'noteId', data_type: 'string', is_required: true, description: '笔记ID' },
    { entity_type: 'post', system_field: 'title', platform_field: 'displayTitle', data_type: 'string', is_required: false, description: '标题' },
    { entity_type: 'post', system_field: 'content', platform_field: 'desc', data_type: 'string', is_required: true, description: '正文' },
    { entity_type: 'post', system_field: 'author_id', platform_field: 'user.userId', data_type: 'string', is_required: false, description: '作者ID' },
    { entity_type: 'post', system_field: 'author_name', platform_field: 'user.nickname', data_type: 'string', is_required: false, description: '作者昵称' },
    { entity_type: 'post', system_field: 'like_count', platform_field: 'interactInfo.likedCount', data_type: 'number', is_required: false, description: '点赞数' },
    { entity_type: 'post', system_field: 'collect_count', platform_field: 'interactInfo.collectedCount', data_type: 'number', is_required: false, description: '收藏数' },
    { entity_type: 'post', system_field: 'comment_count', platform_field: 'interactInfo.commentCount', data_type: 'number', is_required: false, description: '评论数' },
    { entity_type: 'post', system_field: 'post_type', platform_field: 'type', data_type: 'string', is_required: false, description: '笔记类型' },
    { entity_type: 'post', system_field: 'published_at', platform_field: 'lastUpdateTime', data_type: 'date', is_required: false, description: '更新时间', transform_expr: 'timestamp_to_date' },
    { entity_type: 'comment', system_field: 'content', platform_field: 'content', data_type: 'string', is_required: true, description: '评论内容' },
    { entity_type: 'comment', system_field: 'author_name', platform_field: 'user.nickname', data_type: 'string', is_required: false, description: '评论者昵称' },
    { entity_type: 'comment', system_field: 'like_count', platform_field: 'likeCount', data_type: 'number', is_required: false, description: '点赞数' },
  ],
  twitter: [
    { entity_type: 'post', system_field: 'platform_post_id', platform_field: 'id_str', data_type: 'string', is_required: true, description: '推文ID' },
    { entity_type: 'post', system_field: 'content', platform_field: 'text', data_type: 'string', is_required: true, description: '正文' },
    { entity_type: 'post', system_field: 'author_name', platform_field: 'user.name', data_type: 'string', is_required: false, description: '用户名' },
    { entity_type: 'post', system_field: 'like_count', platform_field: 'favorite_count', data_type: 'number', is_required: false, description: '点赞数' },
    { entity_type: 'post', system_field: 'share_count', platform_field: 'retweet_count', data_type: 'number', is_required: false, description: '转发数' },
    { entity_type: 'post', system_field: 'published_at', platform_field: 'created_at', data_type: 'date', is_required: false, description: '发布时间' },
  ],
  weibo: [
    { entity_type: 'post', system_field: 'platform_post_id', platform_field: 'idstr', data_type: 'string', is_required: true, description: '微博ID' },
    { entity_type: 'post', system_field: 'content', platform_field: 'text', data_type: 'string', is_required: true, description: '正文' },
    { entity_type: 'post', system_field: 'author_name', platform_field: 'user.screen_name', data_type: 'string', is_required: false, description: '用户名' },
    { entity_type: 'post', system_field: 'like_count', platform_field: 'attitudes_count', data_type: 'number', is_required: false, description: '点赞数' },
    { entity_type: 'post', system_field: 'share_count', platform_field: 'reposts_count', data_type: 'number', is_required: false, description: '转发数' },
    { entity_type: 'post', system_field: 'comment_count', platform_field: 'comments_count', data_type: 'number', is_required: false, description: '评论数' },
    { entity_type: 'comment', system_field: 'content', platform_field: 'text', data_type: 'string', is_required: true, description: '评论内容' },
    { entity_type: 'comment', system_field: 'like_count', platform_field: 'like_count', data_type: 'number', is_required: false, description: '点赞数' },
  ],
  // bilibili, zhihu, reddit, douyin, instagram, tiktok, weixin, bluesky 类似省略
};

const BUILT_IN_TEMPLATES = [
  {
    name: 'sentiment-topics',
    description: '情感分析 + 话题分类',
    template: `你是一个社交媒体评论分析助手。请分析以下评论的情感倾向和话题分类。

评论内容: {{content}}
评论平台: {{platform}}
评论发布时间: {{published_at}}
评论者: {{author_name}}

请分析并返回以下 JSON（直接返回 JSON，不要其他文字）：
{
  "sentiment": { "label": "positive|negative|neutral", "score": 0.0-1.0 },
  "topics": [{ "name": "话题名称", "confidence": 0.0-1.0 }],
  "intent": "praise|complaint|question|suggestion|neutral|other",
  "risk": { "flagged": true/false, "level": "low|medium|high", "reason": "..." },
  "summary": "一句话摘要"
}`,
    is_default: true,
  },
  {
    name: 'risk-detection',
    description: '风险内容检测',
    template: `你是一个内容安全审核助手。请检测以下内容是否包含风险信息。

内容: {{content}}
平台: {{platform}}

请返回 JSON：
{
  "risk": { "flagged": true/false, "level": "low|medium|high", "reason": "..." },
  "categories": ["涉政", "涉暴", "涉黄", "广告", "虚假信息", "其他"]
}`,
    is_default: false,
  },
  {
    name: 'media-image',
    description: '图片内容分析',
    template: `你是一个图片内容分析助手。请分析以下图片的内容。

图片URL: {{media_url}}
图片来源平台: {{platform}}

请返回 JSON：
{
  "content_type": "product|person|scene|text|screenshot|meme|other",
  "description": "画面内容描述",
  "sentiment": { "label": "positive|negative|neutral", "score": 0.0-1.0 },
  "objects": [{ "label": "物体名称", "confidence": 0.0-1.0 }],
  "risk": { "flagged": true/false, "level": "low|medium|high", "reason": "..." }
}`,
    is_default: false,
  },
];

export function seedPlatformsAndMappings(): void {
  for (const platform of PLATFORMS) {
    upsertPlatform({ id: platform.id, name: platform.name, description: platform.description });
    const mappings = PLATFORM_MAPPINGS[platform.id];
    if (mappings) {
      for (const m of mappings) {
        try {
          createFieldMapping({
            id: generateId(),
            platform_id: platform.id,
            entity_type: m.entity_type,
            system_field: m.system_field,
            platform_field: m.platform_field,
            data_type: m.data_type as 'string' | 'number' | 'date' | 'boolean' | 'array' | 'json',
            is_required: m.is_required,
            transform_expr: m.transform_expr ?? null,
            description: m.description,
          });
        } catch {
          // ignore duplicate
        }
      }
    }
  }
}

export function seedTemplates(): void {
  for (const t of BUILT_IN_TEMPLATES) {
    try {
      createTemplate({
        id: generateId(),
        name: t.name,
        description: t.description,
        template: t.template,
        is_default: t.is_default,
        created_at: new Date(),
      });
    } catch {
      // ignore duplicate
    }
  }
}

export function seedAll(): void {
  seedPlatformsAndMappings();
  seedTemplates();
}
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc` in /Users/huhui/Projects/analyze-cli/
Expected: 无编译错误

- [ ] **Step 3: 提交**

```bash
git add src/db/seed.ts && git commit -m "feat: add seed data for 11 platforms, field mappings, and built-in templates"
```

---

## 第三阶段：IPC 与队列基础设施

### Task 6: IPC 服务器

**Files:**
- Create: `src/daemon/ipc-server.ts`

- [ ] **Step 1: 创建 src/daemon/ipc-server.ts**

```ts
import * as net from 'net';
import * as fs from 'fs';
import { IPC_SOCKET_PATH } from '../shared/constants';
import { JsonRpcRequest, JsonRpcResponse } from '../shared/types';

export type RequestHandler = (method: string, params: Record<string, unknown>) => Promise<unknown>;

export class IpcServer {
  private server: net.Server;
  private handler: RequestHandler;

  constructor(handler: RequestHandler) {
    this.handler = handler;
    this.server = net.createServer((socket) => {
      let buffer = '';
      socket.on('data', async (data) => {
        buffer += data.toString();
        // Handle one JSON-RPC request per line
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const req: JsonRpcRequest = JSON.parse(line);
            const result = await this.handler(req.method, req.params ?? {});
            const resp: JsonRpcResponse = { jsonrpc: '2.0', result, id: req.id };
            socket.write(JSON.stringify(resp) + '\n');
          } catch (err) {
            const resp: JsonRpcResponse = {
              jsonrpc: '2.0',
              error: { code: -32603, message: String(err) },
              id: 0,
            };
            socket.write(JSON.stringify(resp) + '\n');
          }
        }
      });
      socket.on('error', () => {});
    });
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      if (fs.existsSync(IPC_SOCKET_PATH)) {
        fs.unlinkSync(IPC_SOCKET_PATH);
      }
      this.server.listen(IPC_SOCKET_PATH, () => resolve());
    });
  }

  stop(): void {
    this.server.close();
    if (fs.existsSync(IPC_SOCKET_PATH)) {
      fs.unlinkSync(IPC_SOCKET_PATH);
    }
  }
}

export async function sendIpcRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(IPC_SOCKET_PATH);
    let buffer = '';
    const req: JsonRpcRequest = { jsonrpc: '2.0', method, params, id: Date.now() };
    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const resp: JsonRpcResponse = JSON.parse(line);
          if (resp.error) {
            reject(new Error(resp.error.message));
          } else {
            resolve(resp.result);
          }
        } catch {
          // ignore
        }
      }
    });
    socket.on('error', reject);
    socket.write(JSON.stringify(req) + '\n');
    socket.end();
  });
}
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc` in /Users/huhui/Projects/analyze-cli/
Expected: 无编译错误

- [ ] **Step 3: 提交**

```bash
git add src/daemon/ipc-server.ts && git commit -m "feat: add Unix Socket IPC server with JSON-RPC 2.0"
```

---

### Task 7: Bree DuckDB Adapter

**Files:**
- Create: `src/daemon/bree-adapter.ts`

- [ ] **Step 1: 创建 src/daemon/bree-adapter.ts**

```ts
import { query, run } from '../db/client';
import { QueueJob } from '../shared/types';
import { generateId } from '../shared/utils';

export class BreeDuckDBAdapter {
  async insert(jobData: { name: string; data: unknown; priority?: number }): Promise<void> {
    const id = generateId();
    const data = jobData.data as { task_id: string; target_type?: string; target_id?: string };
    run(
      `INSERT INTO queue_jobs (id, task_id, target_type, target_id, status, priority, attempts, max_attempts)
       VALUES (?, ?, ?, ?, 'pending', ?, 0, 3)`,
      [id, data.task_id, data.target_type ?? null, data.target_id ?? null, jobData.priority ?? 0]
    );
  }

  async remove(name: string): Promise<void> {
    run(`DELETE FROM queue_jobs WHERE id = ?`, [name]);
  }

  async getNext(): Promise<{ name: string; data: unknown } | null> {
    const rows = query<QueueJob>(
      `SELECT id, task_id, target_type, target_id FROM queue_jobs
       WHERE status = 'pending'
       ORDER BY priority DESC, created_at ASC
       LIMIT 1`
    );
    if (rows.length === 0) return null;
    const job = rows[0];
    run(`UPDATE queue_jobs SET status = 'processing', attempts = attempts + 1 WHERE id = ?`, [job.id]);
    return { name: job.id, data: { task_id: job.task_id, target_type: job.target_type, target_id: job.target_id } };
  }

  async failed(name: string, error: string): Promise<void> {
    const job = query<QueueJob>(`SELECT attempts, max_attempts FROM queue_jobs WHERE id = ?`, [name]);
    if (job.length === 0) return;
    if (job[0].attempts >= job[0].max_attempts) {
      run(`UPDATE queue_jobs SET status = 'failed', error = ? WHERE id = ?`, [error, name]);
    } else {
      run(`UPDATE queue_jobs SET status = 'pending', error = ? WHERE id = ?`, [error, name]);
    }
  }

  async success(name: string): Promise<void> {
    run(`UPDATE queue_jobs SET status = 'completed', processed_at = NOW() WHERE id = ?`, [name]);
  }

  async stop(name: string): Promise<void> {
    run(`UPDATE queue_jobs SET status = 'pending' WHERE id = ? AND status = 'processing'`, [name]);
  }

  async getStats(): Promise<{ pending: number; processing: number; completed: number; failed: number }> {
    const rows = query<{ status: string; cnt: bigint }>(
      `SELECT status, COUNT(*) as cnt FROM queue_jobs GROUP BY status`
    );
    const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of rows) {
      if (row.status in stats) {
        (stats as Record<string, number>)[row.status] = Number(row.cnt);
      }
    }
    return stats;
  }
}
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc` in /Users/huhui/Projects/analyze-cli/
Expected: 无编译错误

- [ ] **Step 3: 提交**

```bash
git add src/daemon/bree-adapter.ts && git commit -m "feat: add Bree DuckDB adapter for queue persistence"
```

---

### Task 8: IPC 请求处理器

**Files:**
- Create: `src/daemon/handlers.ts`

- [ ] **Step 1: 创建 src/daemon/handlers.ts**

实现所有 IPC 方法：

```ts
import { createPost, listPosts, searchPosts, queryPosts } from '../db/posts';
import { createComment, listCommentsByPost } from '../db/comments';
import { createTask, getTaskById, listTasks, updateTaskStatus, updateTaskStats } from '../db/tasks';
import { addTaskTargets, updateTargetStatus, getTargetStats } from '../db/task-targets';
import { listResultsByTask, getResultById, aggregateStats } from '../db/analysis-results';
import { listTemplates, getTemplateByName } from '../db/templates';
import { enqueueJobs } from '../db/queue-jobs';
import { getDbPath } from '../db/client';
import { Bree } from 'bree';
import { BreeDuckDBAdapter } from './bree-adapter';
import { generateId, now } from '../shared/utils';

let breeInstance: B | null = null;

type Handler = (params: Record<string, unknown>) => Promise<unknown>;

export function getHandlers(bree: B): Record<string, Handler> {
  return {
    async 'post.import'(params) {
      const platformId = params.platform as string;
      const file = params.file as string;
      const items = await readJsonLines(file);
      let imported = 0;
      for (const item of items) {
        try {
          createPost({
            platform_id: platformId,
            platform_post_id: item.platform_post_id ?? item.noteId ?? item.id ?? generateId(),
            title: item.title ?? null,
            content: item.content ?? item.text ?? item.desc ?? '',
            author_id: item.author_id ?? null,
            author_name: item.author_name ?? item.author ?? null,
            author_url: item.author_url ?? null,
            url: item.url ?? null,
            cover_url: item.cover_url ?? null,
            post_type: item.post_type ?? item.type ?? null,
            like_count: Number(item.like_count ?? 0),
            collect_count: Number(item.collect_count ?? 0),
            comment_count: Number(item.comment_count ?? 0),
            share_count: Number(item.share_count ?? 0),
            play_count: Number(item.play_count ?? 0),
            score: item.score ? Number(item.score) : null,
            tags: item.tags ?? null,
            media_files: item.media_files ?? null,
            published_at: item.published_at ? new Date(item.published_at) : null,
            metadata: item.metadata ?? null,
          });
          imported++;
        } catch {
          // ignore duplicate
        }
      }
      return { imported };
    },

    async 'comment.import'(params) {
      const platformId = params.platform as string;
      const postId = params.post_id as string;
      const file = params.file as string;
      const items = await readJsonLines(file);
      let imported = 0;
      for (const item of items) {
        try {
          createComment({
            post_id: postId,
            platform_id: platformId,
            platform_comment_id: item.platform_comment_id ?? item.id ?? null,
            parent_comment_id: item.parent_comment_id ?? null,
            root_comment_id: item.root_comment_id ?? null,
            depth: Number(item.depth ?? 0),
            author_id: item.author_id ?? null,
            author_name: item.author_name ?? item.author ?? null,
            content: item.content ?? '',
            like_count: Number(item.like_count ?? 0),
            reply_count: Number(item.reply_count ?? 0),
            published_at: item.published_at ? new Date(item.published_at) : null,
            metadata: item.metadata ?? null,
          });
          imported++;
        } catch {
          // ignore
        }
      }
      return { imported };
    },

    async 'task.create'(params) {
      const id = generateId();
      createTask({
        id,
        name: params.name as string,
        description: params.description as string | null,
        template_id: params.template_id as string | null,
        status: 'pending',
        stats: { total: 0, done: 0, failed: 0 },
        created_at: now(),
        updated_at: now(),
        completed_at: null,
      });
      return { id };
    },

    async 'task.addTargets'(params) {
      const taskId = params.task_id as string;
      const targetType = params.target_type as 'post' | 'comment';
      const targetIds = params.target_ids as string[];
      addTaskTargets(taskId, targetType, targetIds);
      return { added: targetIds.length };
    },

    async 'task.start'(params) {
      const taskId = params.task_id as string;
      updateTaskStatus(taskId, 'running');
      const targets = getTargetStats(taskId);
      updateTaskStats(taskId, { total: targets.total, done: targets.done, failed: targets.failed });

      // Enqueue all pending targets
      const pendingTargets = targets.pending;
      const jobs = pendingTargets.map(t => ({
        id: generateId(),
        task_id: taskId,
        target_type: t.target_type,
        target_id: t.target_id,
        status: 'pending' as const,
        priority: 0,
        attempts: 0,
        max_attempts: 3,
        error: null,
        created_at: now(),
        processed_at: null,
      }));
      enqueueJobs(jobs);

      // Schedule bree job
      scheduleBree(bree);

      return { enqueued: jobs.length };
    },

    async 'task.pause'(params) {
      const taskId = params.task_id as string;
      updateTaskStatus(taskId, 'paused');
      return { status: 'paused' };
    },

    async 'task.status'(params) {
      const taskId = params.task_id as string;
      const task = getTaskById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      const stats = getTargetStats(taskId);
      return { ...task, ...stats };
    },

    async 'task.list'(params) {
      const status = params.status as string | undefined;
      return listTasks(status);
    },

    async 'daemon.status'() {
      return {
        pid: process.pid,
        db_path: getDbPath(),
        queue_stats: await new BreeDuckDBAdapter().getStats(),
      };
    },
  };
}

async function readJsonLines(filePath: string): Promise<unknown[]> {
  const fs = await import('fs');
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}

let scheduled = false;
function scheduleBree(bree: B): void {
  if (scheduled) return;
  scheduled = true;
  bree.start();
}
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc` in /Users/huhui/Projects/analyze-cli/
Expected: 无编译错误（注意类型导入需正确）

- [ ] **Step 3: 提交**

```bash
git add src/daemon/handlers.ts && git commit -m "feat: add IPC request handlers for all daemon operations"
```

---

## 第四阶段：守护进程

### Task 9: 守护进程主入口

**Files:**
- Create: `src/daemon/index.ts`
- Modify: `src/daemon/worker-pool.ts`

- [ ] **Step 1: 创建 src/daemon/worker-pool.ts**

```ts
import { fork, ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { DAEMON_PID_FILE, DEFAULT_WORKERS } from '../shared/constants';
import { config } from '../config';

export class WorkerPool {
  private workers: ChildProcess[] = [];
  private concurrency: number;

  constructor(concurrency?: number) {
    this.concurrency = concurrency ?? config.worker.concurrency ?? DEFAULT_WORKERS;
  }

  start(): void {
    for (let i = 0; i < this.concurrency; i++) {
      const worker = fork(path.join(__dirname, '../worker/index.js'));
      worker.on('error', () => {});
      this.workers.push(worker);
    }
  }

  stop(): void {
    for (const worker of this.workers) {
      worker.kill();
    }
    this.workers = [];
  }

  size(): number {
    return this.workers.length;
  }
}

export function writePid(): void {
  fs.writeFileSync(DAEMON_PID_FILE, String(process.pid));
}

export function readPid(): number | null {
  if (!fs.existsSync(DAEMON_PID_FILE)) return null;
  const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim(), 10);
  return isNaN(pid) ? null : pid;
}

export function removePid(): void {
  if (fs.existsSync(DAEMON_PID_FILE)) {
    fs.unlinkSync(DAEMON_PID_FILE);
  }
}
```

- [ ] **Step 2: 创建 src/daemon/index.ts**

```ts
import { IpcServer } from './ipc-server';
import { getHandlers } from './handlers';
import { Bree } from 'bree';
import { BreeDuckDBAdapter } from './bree-adapter';
import { WorkerPool } from './worker-pool';
import { runMigrations } from '../db/migrate';
import { seedAll } from '../db/seed';
import { close } from '../db/client';
import { writePid, removePid } from './worker-pool';
import { IPC_SOCKET_PATH } from '../shared/constants';
import * as fs from 'fs';
import * as net from 'net';

export class Daemon {
  private ipcServer: IpcServer;
  private bree: B;
  private workerPool: WorkerPool;

  constructor() {
    const adapter = new BreeDuckDBAdapter();
    this.bree = new Bree({
      jobs: [
        {
          name: 'process-queue',
          path: './src/worker/index.ts',
          interval: 5,
        },
      ],
      // @ts-ignore - bree adapter types
      adapter,
    });
    this.workerPool = new WorkerPool();
    const handlers = getHandlers(this.bree);
    this.ipcServer = new IpcServer(async (method, params) => {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unknown method: ${method}`);
      return handler(params);
    });
  }

  async start(): Promise<void> {
    // Run migrations and seed on start
    runMigrations();
    seedAll();

    await this.ipcServer.start();
    this.workerPool.start();
    writePid();
    console.log('[Daemon] Started on', IPC_SOCKET_PATH);
  }

  stop(): void {
    this.ipcServer.stop();
    this.workerPool.stop();
    this.bree.stop();
    close();
    removePid();
    console.log('[Daemon] Stopped');
  }
}

// CLI entry for starting daemon
if (require.main === module) {
  const daemon = new Daemon();
  daemon.start().catch(console.error);
  process.on('SIGINT', () => daemon.stop());
  process.on('SIGTERM', () => daemon.stop());
}
```

- [ ] **Step 3: 编译验证**

Run: `npx tsc` in /Users/huhui/Projects/analyze-cli/
Expected: 无编译错误

- [ ] **Step 4: 提交**

```bash
git add src/daemon/index.ts src/daemon/worker-pool.ts && git commit -m "feat: add daemon main entry with IPC server, Bree, and worker pool"
```

---

## 第五阶段：Worker

### Task 10: Worker 进程

**Files:**
- Create: `src/worker/index.ts`
- Create: `src/worker/consumer.ts`
- Create: `src/worker/anthropic.ts`
- Create: `src/worker/parser.ts`

- [ ] **Step 1: 创建 src/worker/anthropic.ts**

```ts
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config';
import { Comment, MediaFile, PromptTemplate } from '../shared/types';

const client = new Anthropic({
  apiKey: config.anthropic.api_key,
  baseURL: (config.anthropic as Record<string, unknown>).base_url as string | undefined,
});

export async function analyzeComment(
  comment: Comment,
  platformName: string,
  template: PromptTemplate,
): Promise<string> {
  const prompt = fillTemplate(template.template, {
    content: comment.content,
    platform: platformName,
    published_at: comment.published_at?.toISOString() ?? '未知',
    author_name: comment.author_name ?? '匿名',
  });

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.max_tokens,
    temperature: config.anthropic.temperature,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}

export async function analyzeMedia(
  media: MediaFile,
  platformName: string,
  template: PromptTemplate,
): Promise<string> {
  const prompt = fillTemplate(template.template, {
    media_url: media.url,
    platform: platformName,
  });

  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.max_tokens,
    temperature: config.anthropic.temperature,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content[0].type === 'text' ? response.content[0].text : '';
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}
```

- [ ] **Step 2: 创建 src/worker/parser.ts**

```ts
import {
  SentimentLabel, CommentIntent, RiskLevel, MediaContentType,
  TopicTag, EmotionTag, DetectedObject, DetectedLogo, DetectedFace
} from '../shared/types';

export interface ParsedCommentResult {
  sentiment_label: SentimentLabel | null;
  sentiment_score: number | null;
  intent: CommentIntent | null;
  risk_flagged: boolean;
  risk_level: RiskLevel | null;
  risk_reason: string | null;
  topics: TopicTag[] | null;
  emotion_tags: EmotionTag[] | null;
  keywords: string[] | null;
  summary: string | null;
  raw: Record<string, unknown>;
}

export interface ParsedMediaResult {
  content_type: MediaContentType | null;
  description: string | null;
  ocr_text: string | null;
  sentiment_label: SentimentLabel | null;
  sentiment_score: number | null;
  risk_flagged: boolean;
  risk_level: RiskLevel | null;
  risk_reason: string | null;
  objects: DetectedObject[] | null;
  logos: DetectedLogo[] | null;
  faces: DetectedFace[] | null;
  raw: Record<string, unknown>;
}

export function parseCommentResult(rawText: string): ParsedCommentResult {
  const json = extractJson(rawText);
  const obj = typeof json === 'object' ? json as Record<string, unknown> : {};

  const sentiment = obj.sentiment as Record<string, unknown> | undefined;
  const risk = obj.risk as Record<string, unknown> | undefined;

  return {
    sentiment_label: normalizeSentiment((sentiment?.label as string) ?? null),
    sentiment_score: typeof sentiment?.score === 'number' ? sentiment.score : null,
    intent: normalizeIntent((obj.intent as string) ?? null),
    risk_flagged: Boolean(risk?.flagged),
    risk_level: normalizeRiskLevel((risk?.level as string) ?? null),
    risk_reason: typeof risk?.reason === 'string' ? risk.reason : null,
    topics: normalizeTopics(obj.topics),
    emotion_tags: normalizeEmotions(obj.emotion_tags ?? obj.emotions),
    keywords: normalizeKeywords(obj.keywords),
    summary: typeof obj.summary === 'string' ? obj.summary : null,
    raw: obj,
  };
}

export function parseMediaResult(rawText: string): ParsedMediaResult {
  const json = extractJson(rawText);
  const obj = typeof json === 'object' ? json as Record<string, unknown> : {};
  const risk = obj.risk as Record<string, unknown> | undefined;

  return {
    content_type: normalizeContentType((obj.content_type as string) ?? null),
    description: typeof obj.description === 'string' ? obj.description : null,
    ocr_text: typeof obj.ocr_text === 'string' ? obj.ocr_text : null,
    sentiment_label: normalizeSentiment(((obj.sentiment as Record<string, unknown>)?.label as string) ?? null),
    sentiment_score: typeof (obj.sentiment as Record<string, unknown>)?.score === 'number'
      ? (obj.sentiment as Record<string, number>).score : null,
    risk_flagged: Boolean(risk?.flagged),
    risk_level: normalizeRiskLevel((risk?.level as string) ?? null),
    risk_reason: typeof risk?.reason === 'string' ? risk.reason : null,
    objects: normalizeObjects(obj.objects),
    logos: normalizeLogos(obj.logos),
    faces: normalizeFaces(obj.faces),
    raw: obj,
  };
}

function extractJson(text: string): unknown {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in response');
  return JSON.parse(match[0]);
}

function normalizeSentiment(v: string | null): SentimentLabel | null {
  if (!v) return null;
  const lower = v.toLowerCase();
  if (['positive', 'negative', 'neutral'].includes(lower)) return lower as SentimentLabel;
  return null;
}

function normalizeIntent(v: string | null): CommentIntent | null {
  if (!v) return null;
  const lower = v.toLowerCase();
  if (['praise', 'complaint', 'question', 'suggestion', 'neutral', 'other'].includes(lower)) {
    return lower as CommentIntent;
  }
  return 'other';
}

function normalizeRiskLevel(v: string | null): RiskLevel | null {
  if (!v) return null;
  const lower = v.toLowerCase();
  if (['low', 'medium', 'high'].includes(lower)) return lower as RiskLevel;
  return null;
}

function normalizeContentType(v: string | null): MediaContentType | null {
  if (!v) return null;
  const valid = ['product', 'person', 'scene', 'text', 'screenshot', 'meme', 'other'];
  const lower = v.toLowerCase();
  if (valid.includes(lower)) return lower as MediaContentType;
  return null;
}

function normalizeTopics(v: unknown): TopicTag[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(t => {
    const obj = t as Record<string, unknown>;
    return {
      name: String(obj.name ?? ''),
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
    };
  });
}

function normalizeEmotions(v: unknown): EmotionTag[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(t => {
    const obj = t as Record<string, unknown>;
    return {
      tag: String(obj.tag ?? ''),
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
    };
  });
}

function normalizeKeywords(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(k => String(k));
}

function normalizeObjects(v: unknown): DetectedObject[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(o => {
    const obj = o as Record<string, unknown>;
    return {
      label: String(obj.label ?? ''),
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
    };
  });
}

function normalizeLogos(v: unknown): DetectedLogo[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(l => {
    const obj = l as Record<string, unknown>;
    return {
      name: String(obj.name ?? ''),
      confidence: typeof obj.confidence === 'number' ? obj.confidence : 0,
    };
  });
}

function normalizeFaces(v: unknown): DetectedFace[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(f => {
    const obj = f as Record<string, unknown>;
    return {
      age: typeof obj.age === 'number' ? obj.age : undefined,
      gender: typeof obj.gender === 'string' ? obj.gender : undefined,
      emotion: typeof obj.emotion === 'string' ? obj.emotion : undefined,
    };
  });
}
```

- [ ] **Step 3: 创建 src/worker/consumer.ts**

```ts
import { getConnection } from '../db/client';
import { getPostById, getCommentById } from '../db/posts';
import { getCommentById as getComment } from '../db/comments';
import { getMediaFileById } from '../db/media-files';
import { getPlatformById } from '../db/platforms';
import { getTaskById, updateTaskStats } from '../db/tasks';
import { getTemplateById, getTemplateByName } from '../db/templates';
import { updateTargetStatus, getTargetStats } from '../db/task-targets';
import { createAnalysisResultComment, createAnalysisResultMedia } from '../db/analysis-results';
import { updateJobStatus } from '../db/queue-jobs';
import { analyzeComment, analyzeMedia } from './anthropic';
import { parseCommentResult, parseMediaResult } from './parser';
import { generateId, now } from '../shared/utils';

export async function consumeJob(job: { task_id: string; target_type: string | null; target_id: string | null }): Promise<void> {
  const task = getTaskById(job.task_id);
  if (!task) throw new Error(`Task not found: ${job.task_id}`);

  if (!job.target_type || !job.target_id) {
    throw new Error('Invalid job: missing target_type or target_id');
  }

  const targetId = job.target_id;

  try {
    if (job.target_type === 'comment') {
      const comment = getCommentById(targetId);
      if (!comment) throw new Error(`Comment not found: ${targetId}`);

      const platform = getPlatformById(comment.platform_id);
      const template = task.template_id
        ? getTemplateById(task.template_id)
        : getTemplateByName('sentiment-topics');
      if (!template) throw new Error('No template found');

      const rawText = await analyzeComment(comment, platform?.name ?? 'unknown', template);
      const parsed = parseCommentResult(rawText);

      createAnalysisResultComment({
        id: generateId(),
        task_id: task.id,
        comment_id: comment.id,
        sentiment_label: parsed.sentiment_label,
        sentiment_score: parsed.sentiment_score,
        intent: parsed.intent,
        risk_flagged: parsed.risk_flagged,
        risk_level: parsed.risk_level,
        risk_reason: parsed.risk_reason,
        topics: parsed.topics,
        emotion_tags: parsed.emotion_tags,
        keywords: parsed.keywords,
        summary: parsed.summary,
        raw_response: parsed.raw,
        error: null,
        analyzed_at: now(),
      });
    } else if (job.target_type === 'post') {
      // Post analysis not implemented in v1, skip
    }

    updateTargetStatus(task.id, job.target_type, targetId, 'done');
    updateJobStatus(job.task_id + ':' + targetId, 'completed');

    // Update task stats
    const stats = getTargetStats(task.id);
    updateTaskStats(task.id, stats);

    // Check if all done
    if (stats.total === stats.done + stats.failed) {
      updateTaskStatus(task.id, stats.failed > 0 ? 'completed' : 'completed');
    }
  } catch (err) {
    updateTargetStatus(task.id, job.target_type!, targetId, 'failed', String(err));
    updateJobStatus(job.task_id + ':' + targetId, 'failed');
    const stats = getTargetStats(task.id);
    updateTaskStats(task.id, stats);
    throw err;
  }
}
```

- [ ] **Step 4: 创建 src/worker/index.ts**

Worker 进程入口，从队列取任务并消费：

```ts
import { consumeJob } from './consumer';
import { runMigrations } from '../db/migrate';
import { BreeDuckDBAdapter } from '../daemon/bree-adapter';
import { config } from '../config';
import { sleep } from '../shared/utils';

async function main(): Promise<void> {
  runMigrations();
  const adapter = new BreeDuckDBAdapter();
  const maxRetries = config.worker.max_retries ?? 3;
  const baseDelay = config.worker.retry_delay_ms ?? 2000;

  while (true) {
    try {
      const job = await adapter.getNext();
      if (!job) {
        await sleep(5000);
        continue;
      }

      const data = job.data as { task_id: string; target_type: string | null; target_id: string | null };
      await consumeJob(data);
      await adapter.success(job.name);
    } catch (err) {
      const job = await adapter.getNext();
      if (job) {
        await adapter.failed(job.name, String(err));
      }
      await sleep(baseDelay);
    }
  }
}

main().catch(console.error);
```

- [ ] **Step 5: 编译验证**

Run: `npx tsc` in /Users/huhui/Projects/analyze-cli/
Expected: 无编译错误

- [ ] **Step 6: 提交**

```bash
git add src/worker/ && git commit -m "feat: add Worker process with Claude API integration and result parsing"
```

---

## 第六阶段：CLI 命令

### Task 11: CLI 主入口与平台命令

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/daemon.ts`
- Create: `src/cli/platform.ts`

- [ ] **Step 1: 创建 src/cli/daemon.ts（守护进程管理命令）**

```ts
import { Command } from 'commander';
import * as fs from 'fs';
import * as net from 'net';
import { fork, ChildProcess } from 'child_process';
import { DAEMON_PID_FILE, IPC_SOCKET_PATH } from '../shared/constants';
import { sendIpcRequest } from '../daemon/ipc-server';
import { config } from '../config';

export function makeDaemonCommands(program: Command): void {
  const daemon = new Command('daemon');
  daemon.description('Manage the analyze-cli daemon process');

  daemon
    .command('start')
    .option('-f, --fg', 'Run in foreground')
    .action(async (opts) => {
      const pid = readDaemonPid();
      if (pid && processExists(pid)) {
        console.error(`Daemon already running with PID ${pid}`);
        process.exit(1);
      }

      if (opts.fg) {
        // Run in foreground (import and call daemon start)
        const { Daemon } = await import('../daemon/index');
        const d = new Daemon();
        await d.start();
        process.on('SIGINT', () => d.stop());
      } else {
        const child = fork(`${__dirname}/../daemon/index.js`, [], { detached: true });
        child.unref();
        console.log(`Daemon started with PID ${child.pid}`);
      }
    });

  daemon
    .command('stop')
    .action(() => {
      const pid = readDaemonPid();
      if (!pid || !processExists(pid)) {
        console.log('Daemon is not running');
        return;
      }
      process.kill(pid, 'SIGTERM');
      fs.unlinkSync(DAEMON_PID_FILE);
      console.log('Daemon stopped');
    });

  daemon
    .command('status')
    .action(async () => {
      const pid = readDaemonPid();
      if (!pid || !processExists(pid)) {
        console.log('Daemon: stopped');
        return;
      }
      try {
        const result = await sendIpcRequest('daemon.status', {}) as {
          pid: number;
          db_path: string;
          queue_stats: { pending: number; processing: number; completed: number; failed: number };
        };
        console.log('Daemon: running');
        console.log(`  PID: ${result.pid}`);
        console.log(`  DB: ${result.db_path}`);
        console.log(`  Queue: pending=${result.queue_stats.pending} processing=${result.queue_stats.processing} completed=${result.queue_stats.completed} failed=${result.queue_stats.failed}`);
      } catch {
        console.log('Daemon: not responding');
      }
    });

  daemon
    .command('restart')
    .action(async () => {
      const { daemon: daemonCmd } = await import('./daemon');
      const stop = new Command('daemon');
      daemonCmd(stop);
      await stop.parseAsync(['node', 'daemon', 'stop']);
      await stop.parseAsync(['node', 'daemon', 'start']);
    });

  program.addCommand(daemon);
}

function readDaemonPid(): number | null {
  if (!fs.existsSync(DAEMON_PID_FILE)) return null;
  const pid = parseInt(fs.readFileSync(DAEMON_PID_FILE, 'utf-8').trim(), 10);
  return isNaN(pid) ? null : pid;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: 创建 src/cli/platform.ts**

```ts
import { Command } from 'commander';
import { sendIpcRequest } from '../daemon/ipc-server';

export function makePlatformCommands(_program: Command): void {
  const platform = new Command('platform');
  platform.description('Manage platforms and field mappings');

  platform
    .command('list')
    .action(async () => {
      try {
        const result = await sendIpcRequest('platform.list', {}) as unknown[];
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('Error:', err);
      }
    });

  platform
    .command('mapping list')
    .requiredOption('--platform <id>', 'Platform ID')
    .requiredOption('--entity <type>', 'Entity type (post/comment)')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('platform.mapping.list', {
          platform: opts.platform,
          entity: opts.entity,
        }) as unknown[];
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('Error:', err);
      }
    });

  _program.addCommand(platform);
}
```

- [ ] **Step 3: 提交**

```bash
git add src/cli/daemon.ts src/cli/platform.ts && git commit -m "feat: add daemon management and platform CLI commands"
```

---

### Task 12: 数据导入与查询命令

**Files:**
- Create: `src/cli/post.ts`
- Create: `src/cli/comment.ts`

- [ ] **Step 1: 创建 src/cli/post.ts**

```ts
import { Command } from 'commander';
import { sendIpcRequest } from '../daemon/ipc-server';

export function makePostCommands(_program: Command): void {
  const post = new Command('post');
  post.description('Post data import and query');

  post
    .command('import')
    .requiredOption('--platform <id>', 'Platform ID')
    .requiredOption('--file <path>', 'Import file (JSONL)')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('post.import', {
          platform: opts.platform,
          file: opts.file,
        }) as { imported: number };
        console.log(`Imported ${result.imported} posts`);
      } catch (err) {
        console.error('Error:', err);
      }
    });

  post
    .command('add')
    .requiredOption('--platform <id>', 'Platform ID')
    .requiredOption('--platform-post-id <id>', 'Platform post ID')
    .requiredOption('--content <text>', 'Content')
    .option('--title <text>', 'Title')
    .option('--author-name <name>', 'Author name')
    .option('--url <url>', 'Post URL')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('post.add', {
          platform: opts.platform,
          platform_post_id: opts.platformPostId,
          content: opts.content,
          title: opts.title,
          author_name: opts.authorName,
          url: opts.url,
        }) as { id: string };
        console.log(`Created post ${result.id}`);
      } catch (err) {
        console.error('Error:', err);
      }
    });

  post
    .command('list')
    .option('--platform <id>', 'Filter by platform')
    .option('--limit <n>', 'Limit', '50')
    .option('--offset <n>', 'Offset', '0')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('post.list', {
          platform: opts.platform,
          limit: parseInt(opts.limit, 10),
          offset: parseInt(opts.offset, 10),
        }) as unknown[];
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('Error:', err);
      }
    });

  post
    .command('search')
    .requiredOption('--platform <id>', 'Platform ID')
    .requiredOption('--query <text>', 'Search query')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('post.search', {
          platform: opts.platform,
          query: opts.query,
        }) as unknown[];
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('Error:', err);
      }
    });

  _program.addCommand(post);
}
```

- [ ] **Step 2: 创建 src/cli/comment.ts**

```ts
import { Command } from 'commander';
import { sendIpcRequest } from '../daemon/ipc-server';

export function makeCommentCommands(_program: Command): void {
  const comment = new Command('comment');
  comment.description('Comment data import and query');

  comment
    .command('import')
    .requiredOption('--platform <id>', 'Platform ID')
    .requiredOption('--post-id <id>', 'Post ID')
    .requiredOption('--file <path>', 'Import file (JSONL)')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('comment.import', {
          platform: opts.platform,
          post_id: opts.postId,
          file: opts.file,
        }) as { imported: number };
        console.log(`Imported ${result.imported} comments`);
      } catch (err) {
        console.error('Error:', err);
      }
    });

  comment
    .command('list')
    .requiredOption('--post-id <id>', 'Post ID')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('comment.list', {
          post_id: opts.postId,
        }) as unknown[];
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('Error:', err);
      }
    });

  _program.addCommand(comment);
}
```

- [ ] **Step 3: 提交**

```bash
git add src/cli/post.ts src/cli/comment.ts && git commit -m "feat: add post and comment CLI commands"
```

---

### Task 13: 任务与结果命令

**Files:**
- Create: `src/cli/task.ts`
- Create: `src/cli/result.ts`
- Create: `src/cli/template.ts`

- [ ] **Step 1: 创建 src/cli/task.ts**

```ts
import { Command } from 'commander';
import { sendIpcRequest } from '../daemon/ipc-server';

export function makeTaskCommands(_program: Command): void {
  const task = new Command('task');
  task.description('Task management');

  task
    .command('create')
    .requiredOption('--name <name>', 'Task name')
    .option('--description <text>', 'Task description')
    .option('--template <name>', 'Template name')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('task.create', {
          name: opts.name,
          description: opts.description ?? null,
          template_id: opts.template ?? null,
        }) as { id: string };
        console.log(`Created task ${result.id}`);
      } catch (err) {
        console.error('Error:', err);
      }
    });

  task
    .command('add-posts')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--post-ids <ids>', 'Post IDs (comma-separated)')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('task.addTargets', {
          task_id: opts.taskId,
          target_type: 'post',
          target_ids: opts.postIds.split(','),
        }) as { added: number };
        console.log(`Added ${result.added} posts to task`);
      } catch (err) {
        console.error('Error:', err);
      }
    });

  task
    .command('add-comments')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--post-id <id>', 'Post ID')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('task.addComments', {
          task_id: opts.taskId,
          post_id: opts.postId,
        }) as { added: number };
        console.log(`Added ${result.added} comments to task`);
      } catch (err) {
        console.error('Error:', err);
      }
    });

  task
    .command('start')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('task.start', {
          task_id: opts.taskId,
        }) as { enqueued: number };
        console.log(`Started task, enqueued ${result.enqueued} items`);
      } catch (err) {
        console.error('Error:', err);
      }
    });

  task
    .command('pause')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts) => {
      try {
        await sendIpcRequest('task.pause', { task_id: opts.taskId });
        console.log('Task paused');
      } catch (err) {
        console.error('Error:', err);
      }
    });

  task
    .command('status')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('task.status', { task_id: opts.taskId }) as Record<string, unknown>;
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('Error:', err);
      }
    });

  task
    .command('list')
    .option('--status <status>', 'Filter by status')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('task.list', { status: opts.status ?? null }) as unknown[];
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('Error:', err);
      }
    });

  _program.addCommand(task);
}
```

- [ ] **Step 2: 创建 src/cli/result.ts**

```ts
import * as fs from 'fs';
import { Command } from 'commander';
import { sendIpcRequest } from '../daemon/ipc-server';

export function makeResultCommands(_program: Command): void {
  const result = new Command('result');
  result.description('Query and export analysis results');

  result
    .command('list')
    .requiredOption('--task-id <id>', 'Task ID')
    .option('--target <type>', 'Target type (comment/media)')
    .option('--limit <n>', 'Limit', '50')
    .action(async (opts) => {
      try {
        const result2 = await sendIpcRequest('result.list', {
          task_id: opts.taskId,
          target: opts.target ?? 'comment',
          limit: parseInt(opts.limit, 10),
        }) as unknown[];
        console.log(JSON.stringify(result2, null, 2));
      } catch (err) {
        console.error('Error:', err);
      }
    });

  result
    .command('stats')
    .requiredOption('--task-id <id>', 'Task ID')
    .action(async (opts) => {
      try {
        const stats = await sendIpcRequest('result.stats', { task_id: opts.taskId }) as Record<string, unknown>;
        console.log(JSON.stringify(stats, null, 2));
      } catch (err) {
        console.error('Error:', err);
      }
    });

  result
    .command('export')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--format <format>', 'Export format (csv/json)')
    .requiredOption('--output <path>', 'Output file path')
    .action(async (opts) => {
      try {
        const results = await sendIpcRequest('result.list', {
          task_id: opts.taskId,
          target: 'comment',
          limit: 100000,
        }) as unknown[];
        if (opts.format === 'json') {
          fs.writeFileSync(opts.output, JSON.stringify(results, null, 2));
        } else if (opts.format === 'csv') {
          const lines = toCsv(results as Record<string, unknown>[]);
          fs.writeFileSync(opts.output, lines);
        }
        console.log(`Exported to ${opts.output}`);
      } catch (err) {
        console.error('Error:', err);
      }
    });

  _program.addCommand(result);
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const headerLine = headers.join(',');
  const dataLines = rows.map(row =>
    headers.map(h => {
      const v = row[h];
      if (v === null || v === undefined) return '';
      const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  return [headerLine, ...dataLines].join('\n');
}
```

- [ ] **Step 3: 创建 src/cli/template.ts**

```ts
import { Command } from 'commander';
import { sendIpcRequest } from '../daemon/ipc-server';

export function makeTemplateCommands(_program: Command): void {
  const template = new Command('template');
  template.description('Prompt template management');

  template
    .command('list')
    .action(async () => {
      try {
        const result = await sendIpcRequest('template.list', {}) as unknown[];
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error('Error:', err);
      }
    });

  template
    .command('add')
    .requiredOption('--name <name>', 'Template name')
    .requiredOption('--template <text>', 'Template content')
    .option('--description <text>', 'Description')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('template.add', {
          name: opts.name,
          template: opts.template,
          description: opts.description ?? null,
        }) as { id: string };
        console.log(`Created template ${result.id}`);
      } catch (err) {
        console.error('Error:', err);
      }
    });

  template
    .command('test')
    .requiredOption('--name <name>', 'Template name')
    .requiredOption('--input <text>', 'Test input')
    .action(async (opts) => {
      try {
        const result = await sendIpcRequest('template.test', {
          name: opts.name,
          input: opts.input,
        }) as { result: string };
        console.log(result.result);
      } catch (err) {
        console.error('Error:', err);
      }
    });

  _program.addCommand(template);
}
```

- [ ] **Step 4: 提交**

```bash
git add src/cli/task.ts src/cli/result.ts src/cli/template.ts && git commit -m "feat: add task, result, and template CLI commands"
```

---

### Task 14: CLI 主入口

**Files:**
- Create: `src/cli/index.ts`

- [ ] **Step 1: 创建 src/cli/index.ts**

```ts
#!/usr/bin/env node
import { Command } from 'commander';
import { makeDaemonCommands } from './daemon';
import { makePlatformCommands } from './platform';
import { makePostCommands } from './post';
import { makeCommentCommands } from './comment';
import { makeTaskCommands } from './task';
import { makeResultCommands } from './result';
import { makeTemplateCommands } from './template';

const program = new Command();

program
  .name('analyze-cli')
  .description('AI-powered social media content analysis CLI tool')
  .version('0.1.0');

makeDaemonCommands(program);
makePlatformCommands(program);
makePostCommands(program);
makeCommentCommands(program);
makeTaskCommands(program);
makeResultCommands(program);
makeTemplateCommands(program);

program.parse(process.argv);
```

- [ ] **Step 2: 编译验证**

Run: `npx tsc` in /Users/huhui/Projects/analyze-cli/
Expected: 无编译错误

- [ ] **Step 3: 测试 CLI 基本运行**

Run: `node dist/cli/index.js --help`
Expected: 显示帮助信息，包含所有命令组

- [ ] **Step 4: 提交**

```bash
git add src/cli/index.ts && git commit -m "feat: add CLI main entry with all command groups"
```

---

## 第七阶段：最终化

### Task 15: 根目录 package.json 更新与入口脚本

**Files:**
- Modify: `package.json` (scripts)
- Modify: `bin/analyze-cli.js` (正确路径)

- [ ] **Step 1: 更新 bin/analyze-cli.js**

```js
#!/usr/bin/env node
const path = require('path');
const { spawn } = require('child_process');

// Check if daemon is needed
const args = process.argv.slice(2);
const needsDaemon = args[0] === 'daemon' && args[1] === 'start' && !args.includes('--fg');

// For daemon commands, run the compiled daemon directly
if (needsDaemon) {
  const daemonPath = path.join(__dirname, '../dist/daemon/index.js');
  const child = spawn('node', [daemonPath, ...args.slice(2)], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return;
}

// For all other commands, run CLI
const cliPath = path.join(__dirname, '../dist/cli/index.js');
require(cliPath);
```

- [ ] **Step 2: 完整编译并验证**

Run: `npx tsc && node dist/cli/index.js --help`
Expected: 显示完整命令帮助

- [ ] **Step 3: 提交**

```bash
git add bin/analyze-cli.js && git commit -m "feat: finalize CLI entry point and package bin"
```

---

## 实施顺序总结

| 顺序 | Task | 说明 |
|---|---|---|
| 1 | Task 1 | 项目初始化、TypeScript、依赖 |
| 2 | Task 2 | 配置加载器 |
| 3 | Task 3 | DuckDB 连接与 Schema |
| 4 | Task 4 | 数据库 CRUD 仓库 |
| 5 | Task 5 | 初始化种子数据 |
| 6 | Task 6 | IPC 服务器 |
| 7 | Task 7 | Bree DuckDB Adapter |
| 8 | Task 8 | IPC 请求处理器 |
| 9 | Task 9 | 守护进程主入口 |
| 10 | Task 10 | Worker 进程 |
| 11 | Task 11 | CLI 平台命令 |
| 12 | Task 12 | CLI 数据导入命令 |
| 13 | Task 13 | CLI 任务与结果命令 |
| 14 | Task 14 | CLI 主入口 |
| 15 | Task 15 | 最终化 |
