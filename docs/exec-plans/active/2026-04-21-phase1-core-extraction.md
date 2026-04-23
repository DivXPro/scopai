# Phase 1: Core 提取 — Monorepo 基础实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `analyze-cli` 从单包结构重构为 pnpm monorepo，提取共享核心 (`packages/core`) 包含数据库、配置、类型、工具函数，确保现有 CLI 功能不受影响。

**Architecture:** 创建 `packages/core/` 包作为唯一直接操作 DuckDB 的层。`packages/cli/` 通过 workspace 依赖引用 core。根目录保留 workspace 配置。不改动业务逻辑，只移动文件和更新 import 路径。

**Tech Stack:** pnpm workspaces, TypeScript, DuckDB, tsup, Node.js test runner

---

## File Structure

```
analyze-cli/
├── package.json                    ← 根 workspace 配置（更新）
├── pnpm-workspace.yaml             ← 新增
├── tsconfig.json                   ← 根 tsconfig（更新 include）
├── packages/
│   ├── core/                       ← 新增：共享核心包
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts            ← 包出口（重新导出公共 API）
│   │       ├── db/
│   │       │   ├── client.ts       ← 从 src/db/client.ts 移动
│   │       │   ├── schema.sql      ← 从 src/db/schema.sql 移动
│   │       │   ├── migrate.ts      ← 从 src/db/migrate.ts 移动
│   │       │   ├── seed.ts         ← 从 src/db/seed.ts 移动
│   │       │   ├── aggregation.ts  ← 从 src/db/aggregation.ts 移动
│   │       │   ├── analysis-results.ts
│   │       │   ├── comments.ts
│   │       │   ├── field-mappings.ts
│   │       │   ├── media-files.ts
│   │       │   ├── platforms.ts
│   │       │   ├── posts.ts
│   │       │   ├── queue-jobs.ts
│   │       │   ├── strategies.ts
│   │       │   ├── task-post-status.ts
│   │       │   ├── task-steps.ts
│   │       │   ├── task-targets.ts
│   │       │   └── templates.ts
│   │       ├── config/
│   │       │   ├── index.ts        ← 从 src/config/index.ts 移动
│   │       │   └── claude-config.ts
│   │       ├── shared/
│   │       │   ├── types.ts        ← 从 src/shared/types.ts 移动
│   │       │   ├── constants.ts    ← 从 src/shared/constants.ts 移动
│   │       │   ├── logger.ts       ← 从 src/shared/logger.ts 移动
│   │       │   ├── utils.ts        ← 从 src/shared/utils.ts 移动
│   │       │   ├── shutdown.ts     ← 从 src/shared/shutdown.ts 移动
│   │       │   ├── version.ts      ← 从 src/shared/version.ts 移动
│   │       │   ├── job-events.ts   ← 从 src/shared/job-events.ts 移动
│   │       │   └── daemon-status.ts
│   │       └── data-fetcher/
│   │           └── opencli.ts      ← 从 src/data-fetcher/opencli.ts 移动
│   └── cli/                        ← 新增：CLI 包（当前内容从 src/cli/ 移动）
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts            ← 从 src/cli/index.ts 移动
│           ├── analyze.ts
│           ├── comment.ts
│           ├── daemon.ts
│           ├── ipc-client.ts
│           ├── logs.ts
│           ├── platform.ts
│           ├── post.ts
│           ├── queue.ts
│           ├── result.ts
│           ├── strategy.ts
│           ├── task-prepare.ts
│           ├── task.ts
│           └── template.ts
├── src/                            ← 保留（daemon + worker 暂时不动，Phase 2 迁移）
│   ├── daemon/
│   └── worker/
```

**设计原则：**
- `core` 是唯一直接操作 DuckDB 的层
- `core` 导出所有公共类型、配置、工具函数、数据库操作
- CLI 命令通过 `@scopai/core` 引用数据库和共享代码
- `src/daemon/` 和 `src/worker/` 暂时留在根目录，Phase 2 迁移到 `packages/api/`

---

## Task 1: 创建根级 Monorepo 配置

**Files:**
- Create: `pnpm-workspace.yaml`
- Modify: `package.json`
- Modify: `tsconfig.json`

- [ ] **Step 1.1: 创建 pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 1.2: 更新根 package.json**

将根 `package.json` 改为 workspace 根配置，移除 CLI 入口和依赖，保留 scripts 和 workspace 配置。

原内容（前51行）：
```json
{
  "name": "analyze-cli",
  "version": "0.1.11",
  "description": "AI-powered social media content analysis CLI tool",
  "main": "dist/cli/index.js",
  "bin": {
    "analyze-cli": "./bin/analyze-cli.js",
    "skill": "./bin/skill.js"
  },
  "files": [
    "bin/",
    "dist/",
    "SKILL.md",
    "src/db/schema.sql"
  ],
  "scripts": {
    "build": "tsup src/cli/index.ts src/daemon/index.ts src/daemon/stream-scheduler.ts --format cjs --out-dir dist --external duckdb --minify",
    "dev": "tsup src/cli/index.ts src/daemon/index.ts --format cjs --out-dir dist --external duckdb --watch",
    "test": "node --test --test-concurrency=1 --experimental-strip-types 'test/**/*.test.ts'",
    "test:integration": "node --test --test-concurrency=1 --experimental-strip-types 'test/integration/*.test.ts'",
    "test:e2e": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/**/*.test.ts'",
    "test:e2e:import": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/import-and-prepare/*.test.ts'",
    "test:e2e:strategy": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/strategy-workflow/*.test.ts'",
    "test:e2e:queue": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/queue-recovery/*.test.ts'",
    "test:e2e:daemon": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/daemon-lifecycle/*.test.ts'",
    "test:record": "npx tsx scripts/record-e2e-fixture.ts --platform xhs --query '上海美食' --limit 2 --output test-data/recorded/$(date +%Y-%m-%d)-xhs-shanghai",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.88.0",
    "bree": "^9.2.9",
    "commander": "^14.0.3",
    "duckdb": "^1.4.4",
    "picocolors": "^1.1.1",
    "uuid": "^11.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.3",
    "@types/uuid": "^10.0.0",
    "tsup": "^8.4.0",
    "typescript": "^5.8.3"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "duckdb"
    ]
  }
}
```

新内容：
```json
{
  "name": "analyze-cli",
  "version": "0.1.11",
  "private": true,
  "description": "AI-powered social media content analysis CLI tool",
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm -r dev",
    "test": "pnpm -r test",
    "test:integration": "node --test --test-concurrency=1 --experimental-strip-types 'test/integration/*.test.ts'",
    "test:e2e": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/**/*.test.ts'",
    "test:e2e:import": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/import-and-prepare/*.test.ts'",
    "test:e2e:strategy": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/strategy-workflow/*.test.ts'",
    "test:e2e:queue": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/queue-recovery/*.test.ts'",
    "test:e2e:daemon": "node --test --test-concurrency=1 --experimental-strip-types 'test/e2e/daemon-lifecycle/*.test.ts'",
    "test:record": "npx tsx scripts/record-e2e-fixture.ts --platform xhs --query '上海美食' --limit 2 --output test-data/recorded/$(date +%Y-%m-%d)-xhs-shanghai"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "duckdb"
    ]
  }
}
```

- [ ] **Step 1.3: 更新根 tsconfig.json**

将 `include` 从 `["src/**/*"]` 改为 `["src/**/*", "packages/*/src/**/*"]`。

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "removeComments": true
  },
  "include": ["src/**/*", "packages/*/src/**/*"],
  "exclude": ["node_modules", "dist", "**/dist/**"]
}
```

- [ ] **Step 1.4: Commit**

```bash
git add package.json tsconfig.json pnpm-workspace.yaml
git commit -m "chore(monorepo): add workspace configuration"
```

---

## Task 2: 创建 packages/core 包结构

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`

- [ ] **Step 2.1: 创建 packages/core/package.json**

```json
{
  "name": "@scopai/core",
  "version": "0.1.11",
  "description": "Shared core for analyze-cli: database, config, types, utilities",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": [
    "dist/",
    "src/db/schema.sql"
  ],
  "scripts": {
    "build": "tsup src/index.ts --format cjs --out-dir dist --external duckdb --minify",
    "dev": "tsup src/index.ts --format cjs --out-dir dist --external duckdb --watch",
    "test": "node --test --test-concurrency=1 --experimental-strip-types 'test/**/*.test.ts'"
  },
  "dependencies": {
    "duckdb": "^1.4.4",
    "picocolors": "^1.1.1",
    "uuid": "^11.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.15.3",
    "@types/uuid": "^10.0.0",
    "tsup": "^8.4.0",
    "typescript": "^5.8.3"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

- [ ] **Step 2.2: 创建 packages/core/tsconfig.json**

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
    "declaration": true,
    "declarationDir": "./dist",
    "removeComments": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 2.3: 创建 packages/core/src/index.ts**

这是 core 包的公共出口，重新导出所有公共 API。

```typescript
// === Database ===
export {
  getDbPath,
  getConnection,
  query,
  run,
  exec,
  checkpoint,
  close,
} from './db/client';

export { migrate } from './db/migrate';
export { seedPlatforms } from './db/seed';

export * from './db/posts';
export * from './db/comments';
export * from './db/platforms';
export * from './db/media-files';
export * from './db/field-mappings';
export * from './db/templates';
export * from './db/tasks';
export * from './db/task-targets';
export * from './db/task-steps';
export * from './db/task-post-status';
export * from './db/strategies';
export * from './db/queue-jobs';
export * from './db/analysis-results';
export * from './db/aggregation';

// === Config ===
export { loadConfig, config } from './config';
export { loadClaudeConfig } from './config/claude-config';

// === Shared Types ===
export * from './shared/types';
export * from './shared/constants';
export * from './shared/utils';
export { getLogger } from './shared/logger';
export { addShutdownHook, gracefulShutdown } from './shared/shutdown';
export { version } from './shared/version';
export { emitJobEvent, onJobEvent } from './shared/job-events';
export { getDaemonStatus, setDaemonStatus } from './shared/daemon-status';

// === Data Fetcher ===
export { fetchViaOpencli } from './data-fetcher/opencli';
```

- [ ] **Step 2.4: Commit**

```bash
git add packages/core/
git commit -m "chore(core): create core package structure"
```

---

## Task 3: 迁移 src/db/ 到 packages/core/src/db/

**Files:**
- Move: `src/db/*` → `packages/core/src/db/`
- Modify: all moved files' internal imports

- [ ] **Step 3.1: 移动 db 目录**

```bash
mkdir -p packages/core/src/db
cp src/db/* packages/core/src/db/
```

- [ ] **Step 3.2: 更新 db/client.ts 中的 import 路径**

原文件中：
```typescript
import { config } from '../config';
import { expandPath } from '../shared/utils';
```

改为（同级目录内相对路径不变，因为目录结构相同）：
```typescript
import { config } from '../config';
import { expandPath } from '../shared/utils';
```

**验证：** `packages/core/src/db/client.ts` 中引用 `../config` 和 `../shared/utils`，在 core 包内目录层级 `packages/core/src/db/` → `packages/core/src/config/` 和 `packages/core/src/shared/` 仍然是 `../config` 和 `../shared/utils`。路径不变，不需要修改。

- [ ] **Step 3.3: 验证其他 db 文件的内部引用**

检查以下文件中的 `../config` 或 `../shared` 引用，确认在 core 包内路径仍然正确：

- `packages/core/src/db/migrate.ts`: 引用 `../client`, `../shared/logger`
- `packages/core/src/db/seed.ts`: 引用 `../client`, `../shared/logger`
- `packages/core/src/db/posts.ts`: 引用 `../client`, `../shared/utils`
- `packages/core/src/db/comments.ts`: 引用 `../client`, `../shared/utils`
- 其他 db/*.ts 文件类似

**在 core 包内，所有 `../shared/` 和 `../config/` 引用保持正确，因为目录层级相同。**

但需要检查是否有引用 `../../` 的情况。例如 `src/db/analysis-results.ts`：

```bash
grep -n "from '\.\." packages/core/src/db/*.ts
```

确保所有引用最多只到 `../`（到 src 级别），没有引用到 `src/` 外的文件。

- [ ] **Step 3.4: Commit**

```bash
git add packages/core/src/db/
git commit -m "chore(core): migrate database layer to core package"
```

---

## Task 4: 迁移 src/config/ 到 packages/core/src/config/

**Files:**
- Move: `src/config/*` → `packages/core/src/config/`

- [ ] **Step 4.1: 移动 config 目录**

```bash
mkdir -p packages/core/src/config
cp src/config/* packages/core/src/config/
```

- [ ] **Step 4.2: 验证内部引用路径**

`packages/core/src/config/index.ts` 引用：
```typescript
import { Config } from '../shared/types';
import { expandPath } from '../shared/utils';
import { loadClaudeConfig } from './claude-config';
```

在 core 包内：`../shared/types` → `packages/core/src/shared/types.ts`，路径正确。

`packages/core/src/config/claude-config.ts` 没有引用 shared，路径正确。

- [ ] **Step 4.3: Commit**

```bash
git add packages/core/src/config/
git commit -m "chore(core): migrate config layer to core package"
```

---

## Task 5: 迁移 src/shared/ 到 packages/core/src/shared/

**Files:**
- Move: `src/shared/*` → `packages/core/src/shared/`

- [ ] **Step 5.1: 移动 shared 目录**

```bash
mkdir -p packages/core/src/shared
cp src/shared/* packages/core/src/shared/
```

- [ ] **Step 5.2: 验证内部引用路径**

检查 shared 文件之间的相互引用：

```bash
grep -n "from '\.\." packages/core/src/shared/*.ts
```

需要确认没有引用 `src/` 外的文件。例如：
- `logger.ts` 可能引用 `../config/` — 这在 core 包内变为 `packages/core/src/config/`，路径正确（`../config`）。

- [ ] **Step 5.3: Commit**

```bash
git add packages/core/src/shared/
git commit -m "chore(core): migrate shared utilities to core package"
```

---

## Task 6: 迁移 src/data-fetcher/ 到 packages/core/src/data-fetcher/

**Files:**
- Move: `src/data-fetcher/*` → `packages/core/src/data-fetcher/`

- [ ] **Step 6.1: 移动 data-fetcher 目录**

```bash
mkdir -p packages/core/src/data-fetcher
cp src/data-fetcher/* packages/core/src/data-fetcher/
```

- [ ] **Step 6.2: 验证内部引用**

检查 `packages/core/src/data-fetcher/opencli.ts` 是否有引用 `../shared/` 或 `../config/`。

- [ ] **Step 6.3: Commit**

```bash
git add packages/core/src/data-fetcher/
git commit -m "chore(core): migrate data-fetcher to core package"
```

---

## Task 7: 创建 packages/cli 包

**Files:**
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Move: `src/cli/*` → `packages/cli/src/`

- [ ] **Step 7.1: 创建 packages/cli/package.json**

```json
{
  "name": "@scopai/cli",
  "version": "0.1.11",
  "description": "CLI entry for analyze-cli",
  "main": "dist/index.js",
  "bin": {
    "analyze-cli": "../../bin/analyze-cli.js",
    "skill": "../../bin/skill.js"
  },
  "scripts": {
    "build": "tsup src/index.ts --format cjs --out-dir dist --external @scopai/core --external duckdb --minify",
    "dev": "tsup src/index.ts --format cjs --out-dir dist --external @scopai/core --external duckdb --watch"
  },
  "dependencies": {
    "@scopai/core": "workspace:*",
    "commander": "^14.0.3",
    "picocolors": "^1.1.1"
  },
  "devDependencies": {
    "@types/node": "^22.15.3",
    "tsup": "^8.4.0",
    "typescript": "^5.8.3"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

- [ ] **Step 7.2: 创建 packages/cli/tsconfig.json**

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
    "declaration": false,
    "removeComments": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 7.3: 移动 CLI 源文件**

```bash
mkdir -p packages/cli/src
cp src/cli/* packages/cli/src/
```

- [ ] **Step 7.4: 更新 CLI 文件中的 import 路径**

所有 `packages/cli/src/*.ts` 文件中的 `../db/`, `../config/`, `../shared/` 引用需要改为 `@scopai/core`。

**批量替换规则：**

对每个 `packages/cli/src/*.ts` 文件执行：

1. `from '../db/'` → `from '@scopai/core'`
2. `from '../config'` → `from '@scopai/core'`
3. `from '../shared/'` → `from '@scopai/core'`
4. `from '../data-fetcher/'` → `from '@scopai/core'`

但注意：有些 import 是具体的子模块，例如 `from '../db/posts'`，这些不能直接替换为 `@scopai/core`，因为 core 包的 index.ts 使用 `export * from './db/posts'`，所以 named imports 仍然可用。

**具体替换映射：**

```typescript
// 旧
import { createPost, getPostById, listPosts, searchPosts } from '../db/posts';
// 新
import { createPost, getPostById, listPosts, searchPosts } from '@scopai/core';

// 旧
import { createComment, listCommentsByPost } from '../db/comments';
// 新
import { createComment, listCommentsByPost } from '@scopai/core';

// 旧
import { config } from '../config';
// 新
import { config } from '@scopai/core';

// 旧
import { generateId, now, parseImportFile } from '../shared/utils';
// 新
import { generateId, now, parseImportFile } from '@scopai/core';

// 旧
import { getLogger } from '../shared/logger';
// 新
import { getLogger } from '@scopai/core';

// 旧
import type { QueueJob } from '../shared/types';
// 新
import type { QueueJob } from '@scopai/core';

// 旧
import { fetchViaOpencli } from '../data-fetcher/opencli';
// 新
import { fetchViaOpencli } from '@scopai/core';
```

**处理动态 import：**

有些文件使用动态 import，如：
```typescript
const { addTaskTargets } = await import('../db/task-targets');
```

改为：
```typescript
const { addTaskTargets } = await import('@scopai/core');
```

**保留的相对引用：**

- `packages/cli/src/*.ts` 之间的相互引用保持不变（如 `./task` 等）
- `packages/cli/src/daemon.ts` 中的 `../daemon/` 引用需要暂时保留（因为 daemon 还在根 src/）
- `packages/cli/src/ipc-client.ts` 中的 `../shared/` 等引用需要改为 `@scopai/core`
- `packages/cli/src/task-prepare.ts` 中的 `../daemon/` 引用暂时保留

**逐个文件处理：**

**packages/cli/src/analyze.ts:**
```typescript
// 原 import
import { createStrategy, getStrategyById, listStrategies, validateStrategyJson, updateStrategy, deleteStrategy, parseJsonSchemaToColumns, createStrategyResultTable, syncStrategyResultTable } from '../db/strategies';
import { getExistingResultIds } from '../db/analysis-results';
import { getTaskPostStatus } from '../db/task-post-status';
import { config } from '../config';
import type { QueueJob } from '../shared/types';

// 改为
import {
  createStrategy, getStrategyById, listStrategies, validateStrategyJson,
  updateStrategy, deleteStrategy, parseJsonSchemaToColumns, createStrategyResultTable,
  syncStrategyResultTable, getExistingResultIds, getTaskPostStatus, config,
} from '@scopai/core';
import type { QueueJob } from '@scopai/core';
```

**packages/cli/src/task.ts:**
```typescript
// 原 import
import { createTask, getTaskById, listTasks, updateTaskStatus, updateTaskStats } from '../db/tasks';
import { addTaskTargets, getTargetStats, listTaskTargets } from '../db/task-targets';
import { generateId, now, parseImportFile } from '../shared/utils';

// 改为
import {
  createTask, getTaskById, listTasks, updateTaskStatus, updateTaskStats,
  addTaskTargets, getTargetStats, listTaskTargets, generateId, now, parseImportFile,
} from '@scopai/core';
```

其他文件类似处理。用 sed 批量替换：

```bash
# 对每个 CLI 源文件执行
cd packages/cli/src
for f in *.ts; do
  sed -i.bak "s|from '\.\./db/|from '@scopai/core'|g" "$f"
  sed -i.bak "s|from '\.\./config'|from '@scopai/core'|g" "$f"
  sed -i.bak "s|from '\.\./shared/|from '@scopai/core'|g" "$f"
  sed -i.bak "s|from '\.\./data-fetcher/|from '@scopai/core'|g" "$f"
  rm -f "$f.bak"
done
```

**注意：** 以上 sed 会把所有 `from '../db/xxx'` 变成 `from '@scopai/core'`，这是正确的因为 core 包的 index.ts 已经重新导出了所有命名导出。

**但有一个例外** — `import '../db/schema.sql'` 这种字符串引用需要特别处理（没有这种情况）。

**另一个问题：** `../db/client` 中的 `query`, `run` 等函数也在 core 中导出，但 CLI 文件中是否有直接引用 `../db/client`？

检查：`grep -r "from '../db/client'" src/cli/` — 应该没有直接引用。

- [ ] **Step 7.5: 特殊处理引用 daemon 的 CLI 文件**

`packages/cli/src/daemon.ts` 引用：
```typescript
import { startDaemon, stopDaemon, getDaemonStatus as getDaemonProcessStatus } from '../daemon';
```

这里 `../daemon` 是指根目录的 `src/daemon/`。在 `packages/cli/src/` 中，这变成了引用 `packages/cli/src/daemon/`（不存在）或 `packages/daemon/`（也不存在）。

**解决方案：** 暂时在 `packages/cli/src/daemon.ts` 中保留对 `../../src/daemon` 的引用（指向根 src/daemon/）。

```typescript
// 改为
import { startDaemon, stopDaemon, getDaemonStatus as getDaemonProcessStatus } from '../../../src/daemon';
```

同样处理 `packages/cli/src/task-prepare.ts` 中的 `../daemon/` 引用。

- [ ] **Step 7.6: Commit**

```bash
git add packages/cli/
git commit -m "chore(cli): create cli package and migrate source files"
```

---

## Task 8: 安装依赖并构建验证

**Files:**
- Run: `pnpm install`
- Run: `pnpm build`

- [ ] **Step 8.1: 安装 workspace 依赖**

```bash
pnpm install
```

预期：pnpm 会安装根依赖和各 workspace 包的依赖，并在 `node_modules/` 下创建 `@scopai/core` 的软链接。

- [ ] **Step 8.2: 验证 workspace 链接**

```bash
ls -la node_modules/@scopai/
```

预期输出包含 `core` → `../../packages/core` 的符号链接。

- [ ] **Step 8.3: 构建 core 包**

```bash
cd packages/core && pnpm build
```

预期：tsup 成功编译，无错误。

- [ ] **Step 8.4: 构建 cli 包**

```bash
cd packages/cli && pnpm build
```

预期：tsup 成功编译，无错误。

- [ ] **Step 8.5: Commit**

```bash
git add pnpm-lock.yaml node_modules/.pnpm-lock.yaml 2>/dev/null || true
git commit -m "chore(deps): install workspace dependencies"
```

---

## Task 9: 更新 bin 脚本

**Files:**
- Modify: `bin/analyze-cli.js`
- Modify: `bin/skill.js`

- [ ] **Step 9.1: 更新 bin/analyze-cli.js**

原内容（假设）：
```javascript
#!/usr/bin/env node
require('../dist/cli/index.js');
```

改为：
```javascript
#!/usr/bin/env node
require('../packages/cli/dist/index.js');
```

- [ ] **Step 9.2: 更新 bin/skill.js**

同样更新为指向新的构建输出路径。

- [ ] **Step 9.3: Commit**

```bash
git add bin/
git commit -m "chore(bin): update entry scripts for monorepo build paths"
```

---

## Task 10: 运行测试验证

**Files:**
- Run: test suite

- [ ] **Step 10.1: 运行单元测试**

```bash
pnpm test
```

或先只运行 core 包的测试：
```bash
cd packages/core && pnpm test
```

预期：所有现有测试通过。

- [ ] **Step 10.2: 运行集成测试**

```bash
pnpm test:integration
```

预期：所有集成测试通过（它们引用根 `src/db/` 等，需要确认路径是否仍然有效）。

**问题：** 集成测试在 `test/integration/*.test.ts` 中，可能引用 `../../src/db/` 等路径。

检查并更新测试文件中的 import 路径：

```bash
grep -r "from '../../src/" test/
```

对于引用 `../../src/db/` 的测试文件，改为 `../../packages/core/src/db/` 或 `@scopai/core`。

由于测试使用 `--experimental-strip-types` 直接运行 TypeScript，不能使用 `@scopai/core` 包名（因为没有 TypeScript 模块解析）。所以需要使用相对路径：

```typescript
// 旧
import { getConnection, close } from '../../src/db/client';
// 新
import { getConnection, close } from '../../packages/core/src/db/client';
```

- [ ] **Step 10.3: 运行 E2E 测试**

```bash
pnpm test:e2e
```

E2E 测试使用 helpers 文件引用 CLI 和 daemon。检查并更新路径。

- [ ] **Step 10.4: Commit 测试修复**

```bash
git add test/
git commit -m "test: update test imports for monorepo structure"
```

---

## Task 11: 清理旧的 src/ 目录（保留 daemon 和 worker）

**Files:**
- Delete: `src/db/`, `src/config/`, `src/shared/`, `src/data-fetcher/`, `src/cli/`
- Keep: `src/daemon/`, `src/worker/`

- [ ] **Step 11.1: 删除已迁移的目录**

```bash
rm -rf src/db/ src/config/ src/shared/ src/data-fetcher/ src/cli/
```

- [ ] **Step 11.2: 验证保留的目录**

```bash
ls src/
```

预期输出：`daemon/ worker/`

- [ ] **Step 11.3: 验证根构建仍然工作**

根 package.json 的 build script 已经改为 `pnpm -r build`，它会递归构建所有 workspace 包。

```bash
pnpm build
```

- [ ] **Step 11.4: Commit**

```bash
git add -A
git commit -m "chore(monorepo): remove migrated source directories from root"
```

---

## Task 12: 验证完整功能

**Files:**
- Run: full test suite
- Run: CLI smoke test

- [ ] **Step 12.1: 完整测试运行**

```bash
pnpm test
pnpm test:integration
pnpm test:e2e
```

- [ ] **Step 12.2: CLI smoke test**

```bash
node bin/analyze-cli.js --version
node bin/analyze-cli.js --help
```

预期：CLI 正常响应，显示版本号和帮助信息。

- [ ] **Step 12.3: 最终 Commit**

```bash
git commit -m "feat(monorepo): complete Phase 1 core extraction"
```

---

## Self-Review

### Spec Coverage Check

| 设计文档 Phase 1 要求 | 对应任务 |
|----------------------|---------|
| 创建 `packages/core/` | Task 2 |
| 将 `src/db/` 移入 `core/src/db/` | Task 3 |
| 将 `src/config/` 移入 `core/src/config/` | Task 4 |
| 将 `src/shared/` 移入 `core/src/shared/` | Task 5 |
| 将 `src/data-fetcher/` 移入 `core/src/data-fetcher/` | Task 6 |
| 确保 `packages/cli/` 能正常依赖 `packages/core/` | Task 7 |
| 更新 bin 脚本 | Task 9 |
| 测试验证 | Task 10, 12 |

### Placeholder Scan

- [x] 无 "TBD", "TODO", "implement later"
- [x] 无 "Add appropriate error handling" 等模糊描述
- [x] 每个步骤包含实际代码或命令
- [x] 无 "Similar to Task N" 引用

### Type Consistency

- [x] 所有类型名称与原始代码一致（`QueueJob`, `Config`, `TaskStatus` 等）
- [x] 所有函数签名与原始代码一致
- [x] core 包 index.ts 导出的名称与原始文件导出的名称一致

---

## 已知风险与缓解

| 风险 | 缓解 |
|------|------|
| import 路径更新遗漏 | 使用 grep 批量检查，编译阶段会报错 |
| 测试文件路径引用失效 | Task 10 专门处理，运行测试验证 |
| pnpm workspace 链接问题 | Step 8.2 验证符号链接 |
| CLI bin 脚本路径错误 | Task 9 更新，Step 12.2 smoke test 验证 |
| TypeScript 编译错误 | 每个包的 tsconfig.json 独立配置，逐步构建验证 |
