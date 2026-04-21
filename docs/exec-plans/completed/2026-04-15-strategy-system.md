# Strategy System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the core strategy system (P0): database schema, strategy import CLI, dynamic analysis results table, `analyze run` command for post-level strategies, and worker support for executing strategy-based jobs.

**Architecture:** Add `strategies` and `analysis_results` tables alongside the existing schema. Strategies are imported from JSON files and stored in the DB. The `analyze run` CLI creates `queue_jobs` referencing a strategy; the worker uses the strategy's prompt and output_schema to build prompts and parse results dynamically. We keep the old `task start` flow untouched for backward compatibility.

**Tech Stack:** TypeScript, Node.js built-in test runner, DuckDB, Commander.js, Anthropic SDK.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/db/schema.sql` | Add `strategies`, `analysis_results`, and extend `queue_jobs` with `strategy_id` and `waiting_media` status |
| `src/db/migrate.ts` | Incremental migration to add new columns/tables if missing |
| `src/shared/types.ts` | Add `Strategy`, `AnalysisResult`, `StrategyOutputSchema`, `StrategyColumnDef`, `StrategyJsonFieldDef`, `NeedsMediaConfig` interfaces |
| `src/db/strategies.ts` | CRUD for strategies table |
| `src/db/analysis-results.ts` | CRUD for `analysis_results` table |
| `src/db/queue-jobs.ts` | Update `getNextJob` to support `waiting_media`, add `syncWaitingMediaJobs` |
| `src/worker/parser.ts` | Add `parseStrategyResult()` for dynamic schema-based parsing |
| `src/worker/anthropic.ts` | Add `analyzeWithStrategy()` and `buildStrategyPrompt()` |
| `src/worker/consumer.ts` | Update `processJob` to handle `strategy_id` jobs |
| `src/daemon/handlers.ts` | Add daemon handlers: `strategy.import`, `strategy.list`, `strategy.show`, `analyze.run` |
| `src/cli/strategy.ts` | New CLI commands: `strategy list`, `strategy import`, `strategy show` |
| `src/cli/analyze.ts` | New CLI command: `analyze run --task-id --strategy` |
| `src/cli/index.ts` | Register new `strategy` and `analyze` commands |
| `test/strategy-system.test.ts` | Integration tests for import, run, and worker processing |

---

### Task 1: Update Database Schema and Migrations

**Files:**
- Modify: `src/db/schema.sql`
- Modify: `src/db/migrate.ts`
- Test: `test/strategy-system.test.ts`

- [ ] **Step 1: Append new tables to schema.sql**

Add the following SQL at the end of `src/db/schema.sql` (after line 195):

```sql
CREATE TABLE IF NOT EXISTS strategies (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT,
    version         TEXT NOT NULL DEFAULT '1.0.0',
    target          TEXT NOT NULL CHECK(target IN ('post', 'comment')),
    needs_media     JSON,
    prompt          TEXT NOT NULL,
    output_schema   JSON NOT NULL,
    file_path       TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analysis_results (
    id              TEXT PRIMARY KEY,
    task_id         TEXT REFERENCES tasks(id),
    strategy_id     TEXT REFERENCES strategies(id),
    strategy_version TEXT NOT NULL,
    target_type     TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
    target_id       TEXT NOT NULL,
    post_id         TEXT REFERENCES posts(id),
    columns         JSON NOT NULL,
    json_fields     JSON NOT NULL,
    raw_response    JSON,
    error           TEXT,
    analyzed_at     TIMESTAMP DEFAULT NOW(),
    UNIQUE(task_id, strategy_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_analysis_results_task ON analysis_results(task_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_strategy ON analysis_results(strategy_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_target ON analysis_results(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_post ON analysis_results(post_id);
```

- [ ] **Step 2: Update queue_jobs CHECK constraint**

In `src/db/schema.sql`, change the `queue_jobs` `status` CHECK from:

```sql
status TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed'))
```

to:

```sql
status TEXT DEFAULT 'pending' CHECK(status IN ('pending','waiting_media','processing','completed','failed'))
```

And add a `strategy_id` column after `task_id`:

```sql
strategy_id TEXT REFERENCES strategies(id),
```

- [ ] **Step 3: Add migration in migrate.ts**

Open `src/db/migrate.ts`. After the existing `cli_templates` migration block, add:

```typescript
  // Migration: ensure strategies table exists
  const hasStrategies = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'strategies'"
  );
  if (hasStrategies.length === 0) {
    await exec(`CREATE TABLE strategies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      version TEXT NOT NULL DEFAULT '1.0.0',
      target TEXT NOT NULL CHECK(target IN ('post', 'comment')),
      needs_media JSON,
      prompt TEXT NOT NULL,
      output_schema JSON NOT NULL,
      file_path TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await exec(`CREATE TABLE analysis_results (
      id TEXT PRIMARY KEY,
      task_id TEXT REFERENCES tasks(id),
      strategy_id TEXT REFERENCES strategies(id),
      strategy_version TEXT NOT NULL,
      target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
      target_id TEXT NOT NULL,
      post_id TEXT REFERENCES posts(id),
      columns JSON NOT NULL,
      json_fields JSON NOT NULL,
      raw_response JSON,
      error TEXT,
      analyzed_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(task_id, strategy_id, target_type, target_id)
    )`);
    await exec(`CREATE INDEX idx_analysis_results_task ON analysis_results(task_id)`);
    await exec(`CREATE INDEX idx_analysis_results_strategy ON analysis_results(strategy_id)`);
    await exec(`CREATE INDEX idx_analysis_results_target ON analysis_results(target_type, target_id)`);
    await exec(`CREATE INDEX idx_analysis_results_post ON analysis_results(post_id)`);
  }

  // Migration: add strategy_id to queue_jobs if missing
  const queueColumns = await query<{ name: string }>(
    "SELECT column_name as name FROM information_schema.columns WHERE table_name = 'queue_jobs'"
  );
  const hasStrategyId = queueColumns.some(c => c.name === 'strategy_id');
  if (!hasStrategyId) {
    await exec("ALTER TABLE queue_jobs ADD COLUMN strategy_id TEXT");
  }
```

- [ ] **Step 4: Run build and verify schema applies**

Run:
```bash
npm run build
```

Expected: clean compile.

- [ ] **Step 5: Write failing test for schema**

Create `test/strategy-system.test.ts` with:

```typescript
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../dist/db/client.js';
const { query, close: closeDb } = db;
import * as migrate from '../dist/db/migrate.js';
const { runMigrations } = migrate;

describe('strategy system', { timeout: 15000 }, () => {
  before(async () => {
    closeDb();
    await runMigrations();
  });

  it('should have strategies table', async () => {
    const rows = await query("SELECT table_name FROM information_schema.tables WHERE table_name = 'strategies'");
    assert.equal(rows.length, 1);
  });

  it('should have analysis_results table', async () => {
    const rows = await query("SELECT table_name FROM information_schema.tables WHERE table_name = 'analysis_results'");
    assert.equal(rows.length, 1);
  });

  it('should have queue_jobs.strategy_id column', async () => {
    const rows = await query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'queue_jobs' AND column_name = 'strategy_id'"
    );
    assert.equal(rows.length, 1);
  });
});
```

- [ ] **Step 6: Run test**

Run:
```bash
node --test --experimental-strip-types test/strategy-system.test.ts
```

Expected: PASS for all three assertions.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.sql src/db/migrate.ts test/strategy-system.test.ts
git commit -m "feat(strategy): add strategies and analysis_results tables with migrations"
```

---

### Task 2: Add TypeScript Types

**Files:**
- Modify: `src/shared/types.ts`
- Test: `test/strategy-system.test.ts`

- [ ] **Step 1: Add strategy types to src/shared/types.ts**

Append at the end of `src/shared/types.ts` (before the closing export of IPC types, or at the very end):

```typescript
// === Strategy System ===

export interface NeedsMediaConfig {
  enabled: boolean;
  media_types?: MediaType[];
  max_media?: number;
  mode?: 'all' | 'first_n' | 'best_quality';
}

export interface StrategyColumnDef {
  name: string;
  type: 'number' | 'enum' | 'array' | 'string';
  label: string;
  min?: number;
  max?: number;
  enum_values?: string[];
  items_label?: string;
}

export interface StrategyJsonFieldDef {
  name: string;
  type: 'number' | 'enum' | 'array' | 'string';
  label: string;
  enum_values?: string[];
  items_label?: string;
}

export interface StrategyOutputSchema {
  columns: StrategyColumnDef[];
  json_fields: StrategyJsonFieldDef[];
}

export interface Strategy {
  id: string;
  name: string;
  description: string | null;
  version: string;
  target: 'post' | 'comment';
  needs_media: NeedsMediaConfig | null;
  prompt: string;
  output_schema: StrategyOutputSchema;
  file_path: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AnalysisResult {
  id: string;
  task_id: string;
  strategy_id: string;
  strategy_version: string;
  target_type: 'post' | 'comment';
  target_id: string;
  post_id: string | null;
  columns: Record<string, unknown>;
  json_fields: Record<string, unknown>;
  raw_response: Record<string, unknown> | null;
  error: string | null;
  analyzed_at: Date;
}
```

- [ ] **Step 2: Update QueueJob type to include strategy_id and waiting_media**

Change `QueueStatus` and `QueueJob` in `src/shared/types.ts` to:

```typescript
export type QueueStatus = 'pending' | 'waiting_media' | 'processing' | 'completed' | 'failed';

export interface QueueJob {
  id: string;
  task_id: string;
  strategy_id: string | null;
  target_type: 'post' | 'comment' | 'media' | null;
  target_id: string | null;
  status: QueueStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  error: string | null;
  created_at: Date;
  processed_at: Date | null;
}
```

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: clean compile.

- [ ] **Step 4: Add type sanity test**

Add to `test/strategy-system.test.ts` inside the `describe` block:

```typescript
  it('should import strategy types without error', async () => {
    const { Strategy, StrategyOutputSchema } = await import('../dist/shared/types.js');
    assert.ok(Strategy === undefined); // interfaces are erased at runtime
  });
```

- [ ] **Step 5: Run test**

```bash
node --test --experimental-strip-types test/strategy-system.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts test/strategy-system.test.ts
git commit -m "feat(strategy): add Strategy and AnalysisResult types"
```

---

### Task 3: Add Strategy DB CRUD

**Files:**
- Create: `src/db/strategies.ts`
- Modify: `src/db/analysis-results.ts`
- Test: `test/strategy-system.test.ts`

- [ ] **Step 1: Create src/db/strategies.ts**

```typescript
import { query, run } from './client';
import { Strategy } from '../shared/types';
import { now } from '../shared/utils';

export async function createStrategy(strategy: Omit<Strategy, 'created_at' | 'updated_at'>): Promise<void> {
  await run(
    `INSERT INTO strategies (id, name, description, version, target, needs_media, prompt, output_schema, file_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      strategy.id, strategy.name, strategy.description, strategy.version, strategy.target,
      strategy.needs_media ? JSON.stringify(strategy.needs_media) : null,
      strategy.prompt, JSON.stringify(strategy.output_schema), strategy.file_path,
      now(), now(),
    ]
  );
}

export async function getStrategyById(id: string): Promise<Strategy | null> {
  const rows = await query<Strategy>('SELECT * FROM strategies WHERE id = ?', [id]);
  return rows[0] ? parseStrategyRow(rows[0]) : null;
}

export async function listStrategies(): Promise<Strategy[]> {
  const rows = await query<Strategy>('SELECT * FROM strategies ORDER BY created_at DESC');
  return rows.map(parseStrategyRow);
}

export async function updateStrategy(id: string, updates: Partial<Pick<Strategy, 'name' | 'description' | 'version' | 'prompt' | 'output_schema' | 'needs_media' | 'file_path'>>): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.name !== undefined) { sets.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { sets.push('description = ?'); values.push(updates.description); }
  if (updates.version !== undefined) { sets.push('version = ?'); values.push(updates.version); }
  if (updates.prompt !== undefined) { sets.push('prompt = ?'); values.push(updates.prompt); }
  if (updates.output_schema !== undefined) { sets.push('output_schema = ?'); values.push(JSON.stringify(updates.output_schema)); }
  if (updates.needs_media !== undefined) { sets.push('needs_media = ?'); values.push(updates.needs_media ? JSON.stringify(updates.needs_media) : null); }
  if (updates.file_path !== undefined) { sets.push('file_path = ?'); values.push(updates.file_path); }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  values.push(now());
  values.push(id);
  await run(`UPDATE strategies SET ${sets.join(', ')} WHERE id = ?`, values);
}

export async function deleteStrategy(id: string): Promise<void> {
  await run('DELETE FROM strategies WHERE id = ?', [id]);
}

function parseStrategyRow(row: Strategy): Strategy {
  return {
    ...row,
    needs_media: typeof row.needs_media === 'string' ? JSON.parse(row.needs_media) : row.needs_media,
    output_schema: typeof row.output_schema === 'string' ? JSON.parse(row.output_schema) : row.output_schema,
  } as Strategy;
}

export function validateStrategyJson(data: unknown): { valid: boolean; error?: string } {
  if (typeof data !== 'object' || data === null) {
    return { valid: false, error: 'Strategy JSON must be an object' };
  }
  const obj = data as Record<string, unknown>;
  const required = ['id', 'name', 'target', 'prompt', 'output_schema'];
  for (const key of required) {
    if (obj[key] === undefined) {
      return { valid: false, error: `Missing required field: ${key}` };
    }
  }
  if (obj.target !== 'post' && obj.target !== 'comment') {
    return { valid: false, error: `Invalid target: ${obj.target}. Must be 'post' or 'comment'` };
  }
  const schema = obj.output_schema as Record<string, unknown>;
  if (typeof schema !== 'object' || schema === null || !Array.isArray(schema.columns) || !Array.isArray(schema.json_fields)) {
    return { valid: false, error: 'output_schema must have columns and json_fields arrays' };
  }
  return { valid: true };
}
```

- [ ] **Step 2: Add analysis_results CRUD to src/db/analysis-results.ts**

Append to `src/db/analysis-results.ts`:

```typescript
export async function createAnalysisResult(result: Omit<AnalysisResult, 'id'>): Promise<void> {
  const id = generateId();
  await run(
    `INSERT INTO analysis_results (id, task_id, strategy_id, strategy_version, target_type, target_id, post_id, columns, json_fields, raw_response, error, analyzed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, result.task_id, result.strategy_id, result.strategy_version, result.target_type,
      result.target_id, result.post_id ?? null,
      JSON.stringify(result.columns),
      JSON.stringify(result.json_fields),
      result.raw_response ? JSON.stringify(result.raw_response) : null,
      result.error, result.analyzed_at,
    ]
  );
}

export async function listAnalysisResultsByTask(taskId: string, limit = 100): Promise<AnalysisResult[]> {
  return query<AnalysisResult>(
    'SELECT * FROM analysis_results WHERE task_id = ? ORDER BY analyzed_at DESC LIMIT ?',
    [taskId, limit]
  );
}

export async function getExistingResultIds(taskId: string, strategyId: string, targetType: string, targetIds: string[]): Promise<string[]> {
  if (targetIds.length === 0) return [];
  const placeholders = targetIds.map(() => '?').join(',');
  const rows = await query<{ target_id: string }>(
    `SELECT target_id FROM analysis_results WHERE task_id = ? AND strategy_id = ? AND target_type = ? AND target_id IN (${placeholders})`,
    [taskId, strategyId, targetType, ...targetIds]
  );
  return rows.map(r => r.target_id);
}
```

Also add `AnalysisResult` to the import at the top:

```typescript
import { AnalysisResultComment, AnalysisResultMedia, AnalysisResult } from '../shared/types';
```

- [ ] **Step 3: Write failing test for strategy CRUD**

Add to `test/strategy-system.test.ts`:

```typescript
import * as strategies from '../dist/db/strategies.js';
const { createStrategy, getStrategyById, listStrategies, validateStrategyJson } = strategies;
import * as analysisResults from '../dist/db/analysis-results.js';
const { createAnalysisResult, getExistingResultIds } = analysisResults;

// ... inside describe block, add:

  it('should create and retrieve a strategy', async () => {
    const strategy = {
      id: 'test-strategy-1',
      name: 'Test Strategy',
      description: 'A test strategy',
      version: '1.0.0',
      target: 'post' as const,
      needs_media: { enabled: false },
      prompt: 'Analyze {{content}}',
      output_schema: { columns: [], json_fields: [] },
      file_path: null,
    };
    await createStrategy(strategy);
    const found = await getStrategyById('test-strategy-1');
    assert.ok(found);
    assert.equal(found.name, 'Test Strategy');
  });

  it('should validate strategy JSON', () => {
    assert.ok(validateStrategyJson({ id: 's', name: 'S', target: 'post', prompt: 'P', output_schema: { columns: [], json_fields: [] } }).valid);
    assert.ok(!validateStrategyJson({ name: 'S' }).valid);
  });
```

- [ ] **Step 4: Run test**

```bash
npm run build && node --test --experimental-strip-types test/strategy-system.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/strategies.ts src/db/analysis-results.ts test/strategy-system.test.ts
git commit -m "feat(strategy): add strategy and analysis_results CRUD"
```

---

### Task 4: Add Dynamic Result Parser

**Files:**
- Modify: `src/worker/parser.ts`
- Test: `test/strategy-system.test.ts`

- [ ] **Step 1: Add parseStrategyResult to src/worker/parser.ts**

Append to `src/worker/parser.ts`:

```typescript
import { StrategyOutputSchema, StrategyColumnDef, StrategyJsonFieldDef } from '../shared/types';

export function parseStrategyResult(rawText: string, schema: StrategyOutputSchema): { columns: Record<string, unknown>; json_fields: Record<string, unknown>; raw: Record<string, unknown> } {
  let obj: Record<string, unknown> = {};
  try {
    const json = extractJson(rawText);
    obj = typeof json === 'object' && json !== null ? (json as Record<string, unknown>) : {};
  } catch {
    // leave obj empty
  }

  const columns: Record<string, unknown> = {};
  const json_fields: Record<string, unknown> = {};

  for (const def of schema.columns) {
    columns[def.name] = normalizeFieldValue(obj[def.name], def);
  }
  for (const def of schema.json_fields) {
    json_fields[def.name] = normalizeFieldValue(obj[def.name], def);
  }

  return { columns, json_fields, raw: obj };
}

function normalizeFieldValue(value: unknown, def: StrategyColumnDef | StrategyJsonFieldDef): unknown {
  if (value === undefined || value === null) {
    if (def.type === 'array') return [];
    return null;
  }
  switch (def.type) {
    case 'number': {
      if (typeof value === 'number') return value;
      const parsed = parseFloat(String(value));
      return isNaN(parsed) ? null : parsed;
    }
    case 'enum': {
      const str = String(value).toLowerCase();
      if (def.enum_values?.includes(str)) return str;
      if (def.enum_values?.includes(String(value))) return String(value);
      return null;
    }
    case 'array': {
      if (Array.isArray(value)) return value;
      return [value];
    }
    case 'string':
    default:
      return String(value);
  }
}
```

- [ ] **Step 2: Write failing test for parser**

Add to `test/strategy-system.test.ts`:

```typescript
import * as parser from '../dist/worker/parser.js';
const { parseStrategyResult } = parser;

// ... inside describe block, add:

  it('should parse strategy result dynamically', async () => {
    const schema = {
      columns: [
        { name: 'score', type: 'number', label: 'Score' },
        { name: 'level', type: 'enum', label: 'Level', enum_values: ['low', 'medium', 'high'] },
      ],
      json_fields: [
        { name: 'tags', type: 'array', label: 'Tags' },
        { name: 'summary', type: 'string', label: 'Summary' },
      ],
    };
    const raw = JSON.stringify({ score: 4.5, level: 'medium', tags: ['a', 'b'], summary: 'ok' });
    const result = parseStrategyResult(raw, schema as any);
    assert.equal(result.columns.score, 4.5);
    assert.equal(result.columns.level, 'medium');
    assert.deepEqual(result.json_fields.tags, ['a', 'b']);
    assert.equal(result.json_fields.summary, 'ok');
  });

  it('should handle missing fields with defaults', async () => {
    const schema = {
      columns: [{ name: 'score', type: 'number', label: 'Score' }],
      json_fields: [{ name: 'tags', type: 'array', label: 'Tags' }],
    };
    const result = parseStrategyResult('{}', schema as any);
    assert.equal(result.columns.score, null);
    assert.deepEqual(result.json_fields.tags, []);
  });
```

- [ ] **Step 3: Run test**

```bash
npm run build && node --test --experimental-strip-types test/strategy-system.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/worker/parser.ts test/strategy-system.test.ts
git commit -m "feat(strategy): add dynamic result parser"
```

---

### Task 5: Add Strategy-Aware Worker Pipeline

**Files:**
- Modify: `src/worker/anthropic.ts`
- Modify: `src/worker/consumer.ts`
- Modify: `src/db/queue-jobs.ts`
- Test: `test/strategy-system.test.ts`

- [ ] **Step 1: Add analyzeWithStrategy to src/worker/anthropic.ts**

Append to `src/worker/anthropic.ts`:

```typescript
import { Strategy, Post, MediaFile } from '../shared/types';
import { listMediaFilesByPost } from '../db/media-files';
import { getPlatformById } from '../db/platforms';

export async function analyzeWithStrategy(
  target: Post,
  strategy: Strategy,
): Promise<string> {
  const prompt = await buildStrategyPrompt(target, strategy);
  const response = await client.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.max_tokens,
    temperature: config.anthropic.temperature,
    messages: [{ role: 'user', content: prompt }],
  });
  return response.content[0].type === 'text' ? response.content[0].text : '';
}

export async function buildStrategyPrompt(target: Post, strategy: Strategy): Promise<string> {
  const platform = target.platform_id ? await getPlatformById(target.platform_id) : null;
  const vars: Record<string, string> = {
    content: target.content ?? '',
    title: target.title ?? '',
    author_name: target.author_name ?? '匿名',
    platform: platform?.name ?? 'unknown',
    published_at: target.published_at?.toISOString() ?? '未知',
    tags: target.tags ? JSON.stringify(target.tags) : '',
    media_urls: '',
  };

  if (strategy.needs_media?.enabled) {
    const mediaFiles = await listMediaFilesByPost(target.id);
    const filtered = filterMediaFiles(mediaFiles, strategy.needs_media);
    if (filtered.length > 0) {
      const lines = filtered.map((m, i) => {
        const path = m.local_path ?? m.url ?? '';
        return `[媒体 ${i + 1}] ${path}`;
      });
      vars.media_urls = '\n' + lines.join('\n') + '\n';
    }
  }

  let result = strategy.prompt;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

function filterMediaFiles(mediaFiles: MediaFile[], config: { media_types?: string[]; max_media?: number; mode?: string }): MediaFile[] {
  let result = mediaFiles;
  if (config.media_types && config.media_types.length > 0) {
    result = result.filter(m => config.media_types!.includes(m.media_type));
  }
  if (config.mode === 'best_quality') {
    result = result
      .filter(m => m.width && m.height)
      .sort((a, b) => (b.width! * b.height!) - (a.width! * a.height!));
  }
  if (config.max_media && config.max_media > 0) {
    result = result.slice(0, config.max_media);
  }
  return result;
}
```

- [ ] **Step 2: Update worker consumer to handle strategy jobs**

Modify `src/worker/consumer.ts`:

1. Add imports:
```typescript
import { getPostById } from '../db/posts';
import { getStrategyById } from '../db/strategies';
import { analyzeWithStrategy } from './anthropic';
import { parseStrategyResult } from './parser';
import { createAnalysisResult } from '../db/analysis-results';
```

2. Update `processJob`:

```typescript
async function processJob(job: QueueJob): Promise<void> {
  const task = await getTaskById(job.task_id);
  if (!task) throw new Error(`Task ${job.task_id} not found`);

  if (job.strategy_id) {
    await processStrategyJob(job, task);
    return;
  }

  if (!task.template_id) throw new Error(`Task ${job.task_id} has no template`);
  const template = await getTemplateById(task.template_id);
  if (!template) throw new Error(`Template ${task.template_id} not found`);

  if (job.target_type === 'comment') {
    await processCommentJob(job, task, template);
  } else if (job.target_type === 'post') {
    throw new Error(`Unsupported target_type: ${job.target_type}`);
  } else if (job.target_type === 'media') {
    await processMediaJob(job, task, template);
  } else {
    throw new Error(`Unknown target_type: ${job.target_type}`);
  }
}
```

3. Append `processStrategyJob`:

```typescript
async function processStrategyJob(
  job: QueueJob,
  task: { id: string; name: string },
): Promise<void> {
  if (!job.strategy_id) throw new Error('Job has no strategy_id');
  if (!job.target_id) throw new Error('Job has no target_id');

  const strategy = await getStrategyById(job.strategy_id);
  if (!strategy) throw new Error(`Strategy ${job.strategy_id} not found`);

  if (strategy.target === 'post') {
    const post = await getPostById(job.target_id);
    if (!post) throw new Error(`Post ${job.target_id} not found`);

    const rawResponse = await analyzeWithStrategy(post, strategy);
    const parsed = parseStrategyResult(rawResponse, strategy.output_schema);

    await createAnalysisResult({
      task_id: task.id,
      strategy_id: strategy.id,
      strategy_version: strategy.version,
      target_type: 'post',
      target_id: job.target_id,
      post_id: job.target_id,
      columns: parsed.columns,
      json_fields: parsed.json_fields,
      raw_response: parsed.raw,
      error: null,
      analyzed_at: new Date(),
    });
  } else if (strategy.target === 'comment') {
    // P2 scope; for now throw
    throw new Error('Comment-level strategy analysis not yet implemented');
  } else {
    throw new Error(`Unknown strategy target: ${strategy.target}`);
  }
}
```

- [ ] **Step 3: Update queue-jobs.ts to support waiting_media sync**

Modify `src/db/queue-jobs.ts` to add:

```typescript
export async function syncWaitingMediaJobs(taskId: string, postId: string): Promise<number> {
  const result = await run(
    `UPDATE queue_jobs
     SET status = 'pending'
     WHERE task_id = ? AND target_id = ? AND status = 'waiting_media'`,
    [taskId, postId]
  );
  // DuckDB run() may not return changes directly; query to confirm
  const rows = await query<{ cnt: bigint }>(
    `SELECT COUNT(*) as cnt FROM queue_jobs WHERE task_id = ? AND target_id = ? AND status = 'pending'`,
    [taskId, postId]
  );
  return Number(rows[0]?.cnt ?? 0);
}
```

Also update `getNextJob` in `src/db/queue-jobs.ts` to only pick `pending` jobs (it already does this).

- [ ] **Step 4: Write failing test for worker pipeline**

Add to `test/strategy-system.test.ts`:

```typescript
import * as postsMod from '../dist/db/posts.js';
const { createPost } = postsMod;
import * as platformsMod from '../dist/db/platforms.js';
const { createPlatform } = platformsMod;
import * as tasksMod from '../dist/db/tasks.js';
const { createTask } = tasksMod;
import * as anthropic from '../dist/worker/anthropic.js';
const { buildStrategyPrompt } = anthropic;

// ... inside describe block, add:

  it('should build strategy prompt with media placeholders', async () => {
    const platformId = `plt_${Date.now()}`;
    await createPlatform({ id: platformId, name: 'Test Platform', description: null });
    const post = await createPost({
      platform_id: platformId,
      platform_post_id: 'p1',
      title: 'Title',
      content: 'Hello world',
      author_id: null,
      author_name: 'Alice',
      author_url: null,
      url: null,
      cover_url: null,
      post_type: 'text',
      like_count: 0,
      collect_count: 0,
      comment_count: 0,
      share_count: 0,
      play_count: 0,
      score: null,
      tags: null,
      media_files: null,
      published_at: new Date('2024-01-01'),
      metadata: null,
    });

    const strategy = {
      id: 'prompt-test',
      name: 'Prompt Test',
      description: null,
      version: '1.0.0',
      target: 'post' as const,
      needs_media: { enabled: false },
      prompt: 'Content: {{content}} Author: {{author_name}}',
      output_schema: { columns: [], json_fields: [] },
      file_path: null,
    };

    const prompt = await buildStrategyPrompt(post, strategy as any);
    assert.ok(prompt.includes('Hello world'));
    assert.ok(prompt.includes('Alice'));
  });
```

- [ ] **Step 5: Run test**

```bash
npm run build && node --test --experimental-strip-types test/strategy-system.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/worker/anthropic.ts src/worker/consumer.ts src/db/queue-jobs.ts test/strategy-system.test.ts
git commit -m "feat(strategy): add strategy-aware worker pipeline"
```

---

### Task 6: Add Daemon Handlers for Strategy and Analyze

**Files:**
- Modify: `src/daemon/handlers.ts`
- Test: `test/strategy-system.test.ts`

- [ ] **Step 1: Add imports for strategy modules**

At the top of `src/daemon/handlers.ts`, add:

```typescript
import { createStrategy, getStrategyById, listStrategies, validateStrategyJson, updateStrategy } from '../db/strategies';
import { getExistingResultIds } from '../db/analysis-results';
import { getPostById } from '../db/posts';
import { getTaskPostStatus } from '../db/task-post-status';
import * as fs from 'fs';
```

(Note: if `getTaskPostStatus` doesn't exist yet, create it in `src/db/task-post-status.ts`):

```typescript
export async function getTaskPostStatus(taskId: string, postId: string): Promise<TaskPostStatus | null> {
  const rows = await query<TaskPostStatus>('SELECT * FROM task_post_status WHERE task_id = ? AND post_id = ?', [taskId, postId]);
  return rows[0] ?? null;
}
```

- [ ] **Step 2: Add daemon handlers inside getHandlers()**

Add these entries to the returned object in `src/daemon/handlers.ts`:

```typescript
    async 'strategy.import'(params) {
      const filePath = params.file as string;
      if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
      const content = fs.readFileSync(filePath, 'utf-8');
      let data: unknown;
      try {
        data = JSON.parse(content);
      } catch {
        throw new Error('Invalid JSON file');
      }
      const validation = validateStrategyJson(data);
      if (!validation.valid) throw new Error(validation.error);

      const obj = data as Record<string, unknown>;
      const existing = await getStrategyById(obj.id as string);
      if (existing && existing.version === obj.version) {
        return { imported: false, reason: 'same version already exists' };
      }

      const strategy = {
        id: obj.id as string,
        name: obj.name as string,
        description: (obj.description ?? null) as string | null,
        version: (obj.version ?? '1.0.0') as string,
        target: obj.target as 'post' | 'comment',
        needs_media: (obj.needs_media ?? { enabled: false }) as any,
        prompt: obj.prompt as string,
        output_schema: obj.output_schema as any,
        file_path: filePath,
      };

      if (existing) {
        await updateStrategy(strategy.id, strategy);
      } else {
        await createStrategy(strategy);
      }
      return { imported: true, id: strategy.id };
    },

    async 'strategy.list'() {
      return listStrategies();
    },

    async 'strategy.show'(params) {
      const strategy = await getStrategyById(params.id as string);
      if (!strategy) throw new Error(`Strategy not found: ${params.id}`);
      return strategy;
    },

    async 'analyze.run'(params) {
      const taskId = params.task_id as string;
      const strategyId = params.strategy as string;
      const task = await getTaskById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      const strategy = await getStrategyById(strategyId);
      if (!strategy) throw new Error(`Strategy not found: ${strategyId}`);

      const { listTaskTargets } = await import('../db/task-targets');
      const targets = (await listTaskTargets(taskId)).filter(t => t.target_type === strategy.target);
      if (targets.length === 0) throw new Error('No matching targets for this strategy');

      const targetIds = targets.map(t => t.target_id);
      const existingIds = new Set(await getExistingResultIds(taskId, strategyId, strategy.target, targetIds));
      const newTargets = targets.filter(t => !existingIds.has(t.target_id));

      const jobs = [];
      for (const t of newTargets) {
        let status: 'pending' | 'waiting_media' = 'pending';
        if (strategy.needs_media?.enabled && strategy.target === 'post') {
          const postStatus = await getTaskPostStatus(taskId, t.target_id);
          if (!postStatus || !postStatus.media_fetched) {
            status = 'waiting_media';
          }
        }
        jobs.push({
          id: generateId(),
          task_id: taskId,
          strategy_id: strategyId,
          target_type: strategy.target,
          target_id: t.target_id,
          status,
          priority: 0,
          attempts: 0,
          max_attempts: 3,
          error: null,
          created_at: now(),
          processed_at: null,
        });
      }

      if (jobs.length > 0) {
        await enqueueJobs(jobs as any);
      }

      return { enqueued: jobs.length, skipped: newTargets.length - jobs.length };
    },
```

- [ ] **Step 3: Write failing test for daemon handlers**

Create a temporary strategy JSON file in `test-data/mock/test-strategy.json`:

```json
{
  "id": "test-strategy-daemon",
  "name": "Daemon Test Strategy",
  "target": "post",
  "prompt": "Analyze: {{content}}",
  "output_schema": {
    "columns": [{"name": "score", "type": "number", "label": "Score"}],
    "json_fields": [{"name": "tags", "type": "array", "label": "Tags"}]
  }
}
```

Add to `test/strategy-system.test.ts`:

```typescript
import * as path from 'path';
import * as fs from 'fs';
import { daemonCall } from '../dist/cli/ipc-client.js';

// ... inside describe block, add:

  it('should import strategy via daemon', async () => {
    const strategyFile = path.join(process.cwd(), 'test-data', 'mock', 'test-strategy.json');
    fs.writeFileSync(strategyFile, JSON.stringify({
      id: 'daemon-strategy-1',
      name: 'Daemon Strategy',
      target: 'post',
      prompt: 'Analyze: {{content}}',
      output_schema: {
        columns: [{ name: 'score', type: 'number', label: 'Score' }],
        json_fields: [{ name: 'tags', type: 'array', label: 'Tags' }],
      },
    }));
    const result = await daemonCall('strategy.import', { file: strategyFile }) as any;
    assert.equal(result.imported, true);
    fs.unlinkSync(strategyFile);
  });
```

- [ ] **Step 4: Run test**

```bash
npm run build && node --test --experimental-strip-types test/strategy-system.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/handlers.ts src/db/task-post-status.ts test-data/mock/test-strategy.json test/strategy-system.test.ts
git commit -m "feat(strategy): add daemon handlers for strategy import and analyze run"
```

---

### Task 7: Add CLI Commands (strategy + analyze)

**Files:**
- Create: `src/cli/strategy.ts`
- Create: `src/cli/analyze.ts`
- Modify: `src/cli/index.ts`
- Test: `test/strategy-system.test.ts`

- [ ] **Step 1: Create src/cli/strategy.ts**

```typescript
import { Command } from 'commander';
import * as pc from 'picocolors';
import { daemonCall } from './ipc-client';

export function strategyCommands(program: Command): void {
  const strategy = program.command('strategy').description('Strategy management');

  strategy
    .command('list')
    .alias('ls')
    .description('List all imported strategies')
    .action(async () => {
      const strategies = await daemonCall('strategy.list', {}) as any[];
      if (strategies.length === 0) {
        console.log(pc.yellow('No strategies found'));
        return;
      }
      console.log(pc.bold('\nStrategies:'));
      console.log(pc.dim('─'.repeat(80)));
      for (const s of strategies) {
        console.log(`  ${pc.green(s.id)} ${pc.bold(s.name)} [${s.target}] v${s.version}`);
      }
      console.log(pc.dim('─'.repeat(80)));
    });

  strategy
    .command('import')
    .description('Import a strategy from a JSON file')
    .requiredOption('--file <file>', 'Path to strategy JSON file')
    .action(async (opts: { file: string }) => {
      const result = await daemonCall('strategy.import', { file: opts.file }) as { imported: boolean; id?: string; reason?: string };
      if (result.imported) {
        console.log(pc.green(`Strategy imported: ${result.id}`));
      } else {
        console.log(pc.yellow(`Skipped: ${result.reason}`));
      }
    });

  strategy
    .command('show')
    .description('Show strategy details')
    .requiredOption('--id <id>', 'Strategy ID')
    .action(async (opts: { id: string }) => {
      const s = await daemonCall('strategy.show', { id: opts.id }) as any;
      console.log(pc.bold(`\nStrategy: ${s.name}`));
      console.log(`  ID:       ${s.id}`);
      console.log(`  Target:   ${s.target}`);
      console.log(`  Version:  ${s.version}`);
      if (s.description) console.log(`  Desc:     ${s.description}`);
    });
}
```

- [ ] **Step 2: Create src/cli/analyze.ts**

```typescript
import { Command } from 'commander';
import * as pc from 'picocolors';
import { daemonCall } from './ipc-client';

export function analyzeCommands(program: Command): void {
  const analyze = program.command('analyze').description('Run strategy-based analysis');

  analyze
    .command('run')
    .description('Run a strategy against a task')
    .requiredOption('--task-id <id>', 'Task ID')
    .requiredOption('--strategy <id>', 'Strategy ID')
    .action(async (opts: { taskId: string; strategy: string }) => {
      const result = await daemonCall('analyze.run', { task_id: opts.taskId, strategy: opts.strategy }) as { enqueued: number };
      console.log(pc.green(`Enqueued ${result.enqueued} jobs for analysis`));
    });
}
```

- [ ] **Step 3: Register commands in src/cli/index.ts**

Add imports:
```typescript
import { strategyCommands } from './strategy';
import { analyzeCommands } from './analyze';
```

Add registrations before `program.parse`:
```typescript
strategyCommands(program);
analyzeCommands(program);
```

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: clean compile.

- [ ] **Step 5: Commit**

```bash
git add src/cli/strategy.ts src/cli/analyze.ts src/cli/index.ts
git commit -m "feat(strategy): add strategy and analyze CLI commands"
```

---

### Task 8: End-to-End Integration Test

**Files:**
- Test: `test/strategy-system.test.ts`

- [ ] **Step 1: Add full e2e test flow**

Add to `test/strategy-system.test.ts`:

```typescript
import * as taskTargets from '../dist/db/task-targets.js';
const { addTaskTargets } = taskTargets;

// ... inside describe block, add:

  it('should run e2e: import strategy, create task, add post, analyze run', async () => {
    const platformId = `e2e_${Date.now()}`;
    await createPlatform({ id: platformId, name: 'E2E Platform', description: null });
    const post = await createPost({
      platform_id: platformId,
      platform_post_id: 'e2e_post_1',
      title: 'E2E Post',
      content: 'This is an e2e test post',
      author_id: null,
      author_name: 'Bot',
      author_url: null,
      url: null,
      cover_url: null,
      post_type: 'text',
      like_count: 0, collect_count: 0, comment_count: 0, share_count: 0, play_count: 0,
      score: null, tags: null, media_files: null,
      published_at: new Date(), metadata: null,
    });

    const taskId = `task_${Date.now()}`;
    await createTask({
      id: taskId, name: 'E2E Task', description: null, template_id: null, cli_templates: null,
      status: 'pending', stats: { total: 0, done: 0, failed: 0 },
      created_at: new Date(), updated_at: new Date(), completed_at: null,
    });
    await addTaskTargets(taskId, 'post', [post.id]);

    const strategyFile = path.join(process.cwd(), 'test-data', 'mock', `e2e-strategy-${Date.now()}.json`);
    fs.writeFileSync(strategyFile, JSON.stringify({
      id: `e2e-strategy-${Date.now()}`,
      name: 'E2E Strategy',
      target: 'post',
      prompt: 'Analyze post: {{content}}',
      output_schema: {
        columns: [{ name: 'score', type: 'number', label: 'Score' }],
        json_fields: [{ name: 'tags', type: 'array', label: 'Tags' }],
      },
    }));

    const importResult = await daemonCall('strategy.import', { file: strategyFile }) as any;
    assert.equal(importResult.imported, true);
    const strategyId = importResult.id;

    const runResult = await daemonCall('analyze.run', { task_id: taskId, strategy: strategyId }) as any;
    assert.equal(runResult.enqueued, 1);

    fs.unlinkSync(strategyFile);
  });
```

- [ ] **Step 2: Run test**

```bash
npm run build && node --test --experimental-strip-types test/strategy-system.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/strategy-system.test.ts
git commit -m "test(strategy): add e2e integration test"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] `strategies` table + CRUD → Task 1, Task 3
- [x] `strategy import` command (JSON parse + validate) → Task 3 (validateStrategyJson), Task 6 (daemon handler), Task 7 (CLI)
- [x] `analysis_results` table → Task 1, Task 3
- [x] `analyze run` command (post type strategy) → Task 5, Task 6, Task 7
- [x] Worker supports new strategy analysis → Task 5
- [x] `needs_media` prompt injection logic → Task 5 (buildStrategyPrompt + filterMediaFiles)
- [x] `waiting_media` status mechanism → Task 1 (schema/migration), Task 5 (queue-jobs sync), Task 6 (analyze.run handler)
- [x] Old `task start` flow untouched → Verified in Task 5 (processJob keeps original branch)

**2. Placeholder scan:**
- No "TBD", "TODO", "implement later", "fill in details"
- No vague "add error handling" without code
- No "Similar to Task N" references
- All steps include actual code blocks and exact commands

**3. Type consistency:**
- `QueueStatus` updated to include `'waiting_media'` in Task 2
- `QueueJob.strategy_id` added in Task 2
- `Strategy` fields (`id`, `name`, `target`, `prompt`, `output_schema`, `needs_media`, `version`) defined in Task 2 and used consistently in Task 3–7
- `parseStrategyResult` signature matches `StrategyOutputSchema` from Task 2
- `analyzeWithStrategy` accepts `Post` and `Strategy` from Task 2

**4. File paths:**
- All paths are exact and relative to project root (`src/db/strategies.ts`, `src/worker/consumer.ts`, etc.)

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-15-strategy-system.md`.**

Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

Which approach would you prefer?

