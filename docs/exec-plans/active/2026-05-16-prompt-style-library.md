# Prompt Style Library 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 scopai 中引入 `prompt_styles` 表、DuckDB FTS 独立全文检索、独立 API/CLI/UI 路径，支持与现有 strategies 系统联动分析提示词风格。

**Architecture:** 在现有基础设施（DuckDB、Fastify、commander、React）上新增独立的提示词风格库模块。不改动现有 posts/search_index 等表，prompt_styles 拥有独立的 Schema、FTS 索引、代码路径。

**Tech Stack:** TypeScript, DuckDB (fts extension), Fastify, commander, React 19

---

## 文件结构映射

### 新增文件

| 文件 | 职责 |
|------|------|
| `packages/core/src/db/prompt-styles.ts` | `prompt_styles` 表的 CRUD + FTS 索引管理 |
| `packages/api/src/routes/prompt-styles.ts` | `/api/prompt-styles/*` 独立路由 |
| `packages/cli/src/prompt-style.ts` | `scopai prompt-style` 命令组 |
| `packages/ui/src/pages/StyleLibrary.tsx` | 风格库页面 |
| `packages/ui/src/components/StyleCard.tsx` | 风格卡片组件 |
| `packages/ui/src/components/StyleDetailDrawer.tsx` | 风格详情抽屉 |
| `scripts/import-prompt-styles.ts` | style.json 批量导入脚本 |
| `docs/design-docs/2026-05-16-prompt-style-library-design.md` | 设计文档（已完成） |

### 修改文件

| 文件 | 修改点 |
|------|--------|
| `packages/core/src/db/schema.sql` | 新增 `prompt_styles` 表、`style_labels` 关联表 |
| `packages/core/src/db/migrate.ts` | 添加 prompt_styles 相关 migration |
| `packages/core/src/index.ts` | 导出 prompt-styles 模块 |
| `packages/api/src/routes/index.ts` | 注册 `/prompt-styles` 路由 |
| `packages/cli/src/bin/cli.ts` | 注册 `prompt-style` 命令组 |
| `packages/ui/src/App.tsx` | 添加 `/styles` 路由 |

---

## Task 1: 数据库 Schema 与 Migration

**Files:**
- Modify: `packages/core/src/db/schema.sql`
- Modify: `packages/core/src/db/migrate.ts`
- Modify: `packages/core/src/index.ts`

### Step 1: 修改 schema.sql

在 `schema.sql` 末尾追加：

```sql
-- Prompt Style Library

CREATE TABLE IF NOT EXISTS prompt_styles (
    id                  TEXT PRIMARY KEY,
    style_name          TEXT NOT NULL,
    style_slug          TEXT NOT NULL UNIQUE,
    version             TEXT,
    status              TEXT DEFAULT 'stable' CHECK(status IN ('stable','draft','deprecated')),
    summary             TEXT NOT NULL,
    prompt_template     TEXT NOT NULL,
    negative_prompt     TEXT,
    variables           JSON,
    palette             JSON,
    composition_rules   JSON,
    style_rules         JSON,
    typography_rules    JSON,
    example_cases       JSON,
    related_styles      JSON,
    license             TEXT DEFAULT 'CC BY 4.0',
    preview_landscape   TEXT,
    preview_portrait    TEXT,
    source_repo         TEXT DEFAULT 'AI-Visual-Prompt-Cookbook',
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_styles_slug ON prompt_styles(style_slug);
CREATE INDEX IF NOT EXISTS idx_prompt_styles_status ON prompt_styles(status);

CREATE TABLE IF NOT EXISTS style_labels (
    style_id   TEXT NOT NULL REFERENCES prompt_styles(id),
    label_id   TEXT NOT NULL REFERENCES labels(id),
    PRIMARY KEY (style_id, label_id)
);
```

### Step 2: 修改 migrate.ts

添加 migration 函数：

```typescript
async function migratePromptStylesTable(): Promise<void> {
  const hasTable = await query<{ name: string }>(
    "SELECT table_name as name FROM information_schema.tables WHERE table_name = 'prompt_styles'"
  );
  if (hasTable.length === 0) {
    await run(`CREATE TABLE prompt_styles (...)`); // 同上
    await run('CREATE INDEX idx_prompt_styles_slug ON prompt_styles(style_slug)');
    await run('CREATE INDEX idx_prompt_styles_status ON prompt_styles(status)');
    await run(`CREATE TABLE style_labels (
      style_id TEXT NOT NULL REFERENCES prompt_styles(id),
      label_id TEXT NOT NULL REFERENCES labels(id),
      PRIMARY KEY (style_id, label_id)
    )`);
  }
}
```

在 `runMigrations` 中添加调用。

### Step 3: 导出模块

在 `packages/core/src/index.ts` 添加：

```typescript
export * from './db/prompt-styles';
```

### Step 4: Commit

---

## Task 2: prompt_styles CRUD + FTS 模块

**Files:**
- Create: `packages/core/src/db/prompt-styles.ts`

### Step 1: 创建 prompt-styles.ts

```typescript
import { query, run } from './client';

export interface PromptStyle {
  id: string;
  style_name: string;
  style_slug: string;
  version?: string;
  status: 'stable' | 'draft' | 'deprecated';
  summary: string;
  prompt_template: string;
  negative_prompt?: string;
  variables: Record<string, string>;
  palette: Record<string, string>;
  composition_rules?: unknown;
  style_rules?: string[];
  typography_rules?: string[];
  example_cases?: unknown[];
  related_styles?: string[];
  license?: string;
  preview_landscape?: string;
  preview_portrait?: string;
  source_repo?: string;
  created_at: string;
  updated_at: string;
}

// CRUD
export async function createPromptStyle(data: Omit<PromptStyle, 'id' | 'created_at' | 'updated_at'>): Promise<PromptStyle> {
  // ... INSERT
}

export async function getPromptStyleBySlug(slug: string): Promise<PromptStyle | null> {
  // ... SELECT
}

export async function listPromptStyles(options?: {
  query?: string;
  color?: string;
  limit?: number;
  offset?: number;
}): Promise<PromptStyle[]> {
  // ... SELECT with filters
}

// FTS
export async function createPromptStyleFtsIndex(): Promise<void> {
  await run(`INSTALL fts`);
  await run(`LOAD fts`);
  await run(`DROP INDEX IF EXISTS prompt_styles_fts_idx`);
  await run(`PRAGMA create_fts_index('prompt_styles', 'id', 'style_name', 'summary', 'prompt_template', 'negative_prompt', 'style_rules', 'typography_rules')`);
}

export async function searchPromptStyles(queryText: string, limit = 20): Promise<Array<{ id: string; style_name: string; style_slug: string; summary: string; score: number }>> {
  return query(
    `SELECT ps.id, ps.style_name, ps.style_slug, ps.summary, fts.score
     FROM prompt_styles ps
     INNER JOIN (
       SELECT id, score
       FROM search_prompt_styles(?)
       ORDER BY score DESC
       LIMIT ?
     ) fts ON ps.id = fts.id`,
    [queryText, limit]
  );
}

// 导入
export async function importPromptStyleFromJson(style: unknown): Promise<PromptStyle> {
  // 解析 style.json 结构，写入数据库
}
```

### Step 2: Commit

---

## Task 3: API 路由

**Files:**
- Create: `packages/api/src/routes/prompt-styles.ts`
- Modify: `packages/api/src/routes/index.ts`

### Step 1: 创建 prompt-styles.ts

实现：
- `GET /prompt-styles/search?q=&limit=` — FTS 全文搜索
- `GET /prompt-styles?q=&color=&has_text=&limit=&offset=` — 结构化过滤列表
- `GET /prompt-styles/:slug` — 单风格详情

### Step 2: 注册路由

在 `packages/api/src/routes/index.ts` 添加：

```typescript
import promptStyleRoutes from './prompt-styles';
// ...
await app.register(promptStyleRoutes, { prefix: '/prompt-styles' });
```

### Step 3: Commit

---

## Task 4: CLI 命令组

**Files:**
- Create: `packages/cli/src/prompt-style.ts`
- Modify: `packages/cli/src/bin/cli.ts`

### Step 1: 创建 prompt-style.ts

基于 `commander` 实现：

```typescript
import { Command } from 'commander';

export function createPromptStyleCommand(): Command {
  const cmd = new Command('prompt-style');
  cmd.description('Prompt style library management');

  cmd.command('import <path>')
    .description('Import style.json files from directory')
    .option('--source <url>', 'Source repository URL')
    .action(async (path, options) => { ... });

  cmd.command('search <query>')
    .description('Full-text search prompt styles')
    .option('--limit <n>', 'Result limit', '10')
    .action(async (query, options) => { ... });

  cmd.command('list')
    .description('List prompt styles with filters')
    .option('--query <q>', 'Search query')
    .option('--color <c>', 'Filter by color')
    .option('--has-text', 'Only text-heavy styles')
    .option('--limit <n>', 'Result limit', '20')
    .action(async (options) => { ... });

  cmd.command('show <slug>')
    .description('Show a single prompt style detail')
    .action(async (slug) => { ... });

  cmd.command('render <slug>')
    .description('Render prompt template with variables')
    .requiredOption('--var <k=v>', 'Variable assignment', collect, [])
    .action(async (slug, options) => { ... });

  cmd.command('reindex')
    .description('Rebuild FTS index')
    .action(async () => { ... });

  return cmd;
}
```

### Step 2: 注册命令

在 `packages/cli/src/bin/cli.ts` 添加：

```typescript
import { createPromptStyleCommand } from '../prompt-style';
// ...
program.addCommand(createPromptStyleCommand());
```

### Step 3: Commit

---

## Task 5: UI 页面

**Files:**
- Create: `packages/ui/src/pages/StyleLibrary.tsx`
- Create: `packages/ui/src/components/StyleCard.tsx`
- Create: `packages/ui/src/components/StyleDetailDrawer.tsx`
- Modify: `packages/ui/src/App.tsx`

### Step 1: 创建组件

StyleCard：展示预览图、名称、摘要、色板色块
StyleDetailDrawer：大图、完整摘要、色板、变量编辑器、构图规则、示例用例

### Step 2: 创建页面

StyleLibrary：搜索栏 + 过滤器 + 卡片网格

### Step 3: 注册路由

在 `App.tsx` 添加 `/styles` 路由。

### Step 4: Commit

---

## Task 6: 导入脚本

**Files:**
- Create: `scripts/import-prompt-styles.ts`

### Step 1: 创建脚本

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { importPromptStyleFromJson, createPromptStyleFtsIndex } from '@scopai/core';

async function main(stylesDir: string, sourceRepo?: string) {
  const dirs = await fs.readdir(stylesDir);
  for (const dir of dirs) {
    const stylePath = path.join(stylesDir, dir, 'style.json');
    try {
      const raw = await fs.readFile(stylePath, 'utf-8');
      const style = JSON.parse(raw);
      await importPromptStyleFromJson(style);
      console.log(`✓ ${style.style_slug}`);
    } catch (err) {
      console.error(`✗ ${dir}:`, err);
    }
  }
  await createPromptStyleFtsIndex();
  console.log('FTS index ready');
}

const stylesDir = process.argv[2];
const sourceRepo = process.argv[3];
if (!stylesDir) {
  console.error('Usage: tsx scripts/import-prompt-styles.ts <path/to/styles> [source-repo-url]');
  process.exit(1);
}
main(stylesDir, sourceRepo);
```

### Step 2: Commit

---

## Task 7: 集成测试

**Files:**
- Create: `test/integration/prompt-styles.test.ts`

### Step 1: 创建测试

测试：
- 导入 style.json
- FTS 搜索
- 结构化过滤
- 单条查询

### Step 2: 运行测试

```bash
pnpm test test/integration/prompt-styles.test.ts
```

### Step 3: Commit

---

## 实现边界

1. **不改动现有表**：`posts`、`comments`、`search_index` 等不做任何修改
2. **独立代码路径**：API、CLI、UI 均有独立的文件和路由，不混入现有逻辑
3. **FTS 索引独立**：使用 DuckDB `fts` 扩展，不依赖 `search_index` 表
4. **标签复用**：`style_labels` 关联现有 `labels` 表
5. **策略联动**：通过 `strategies` + `task_steps` 支持风格自动分析，但不改动策略核心逻辑
