# analyze-cli Development Skill

## Project Overview

`analyze-cli` is a TypeScript/Node.js CLI tool for AI-powered social media content analysis. It uses DuckDB for storage, Bree for job scheduling, and Anthropic SDK for LLM analysis.

**Core flow:**
```
CLI -> DuckDB -> daemon -> worker -> Anthropic -> results
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test:offline
```

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/cli/` | CLI commands (platform, post, comment, task, template, result, daemon) |
| `src/db/` | Schema, migrations, CRUD modules |
| `src/daemon/` | IPC server, daemon lifecycle, worker pool |
| `src/worker/` | Job consumer, Anthropic integration, result parsing |
| `src/config/` | Configuration management |
| `src/shared/` | Types, utilities, constants |
| `test/` | Node.js built-in test framework tests |
| `test-data/` | Mock data for offline tests |

## Development Workflow

### 1. Read Before Modifying
Always read existing code in the target area before making changes. Key reference files:
- `src/cli/index.ts` — command registration
- `src/cli/task.ts` — complex command example
- `src/db/schema.sql` — database schema
- `src/db/migrate.ts` — migration strategy
- `src/worker/consumer.ts` — worker main loop

### 2. Adding a New CLI Command
1. Read `src/cli/index.ts` and an existing command file
2. Create or modify the command file in `src/cli/`
3. Register it in `src/cli/index.ts`
4. Update `AGENTS.md` if it changes the command surface
5. Add tests in `test/`

### 3. Modifying Database Schema
1. Read `src/db/schema.sql` and `src/db/migrate.ts`
2. Update `schema.sql` with new tables/columns
3. Add migration logic in `migrate.ts` (use `information_schema.columns` for ALTER TABLE)
4. Update `src/shared/types.ts`
5. Add/update CRUD module in `src/db/`
6. Add tests

### 4. Testing
- Use Node.js built-in `node:test` with `--experimental-strip-types`
- Integration tests use real DuckDB (file-based)
- Use timestamp-prefixed IDs to avoid conflicts across test runs
- Offline tests: `pnpm test:offline`
- Full tests: `pnpm test`

### 5. Code Style
- TypeScript strict mode
- Use `picocolors` for CLI output colors
- Parameterized queries for all DB operations
- Fail fast: `process.exit(1)` on CLI errors
- Each command starts with `runMigrations()` and `seedAll()`

## Superpowers Integration

This project uses the `superpowers` skill system for feature development:

1. **Brainstorming** (`superpowers:brainstorming`) — Clarify requirements and create design specs in `docs/superpowers/specs/`
2. **Planning** (`superpowers:writing-plans`) — Create implementation plans in `docs/superpowers/plans/`
3. **Execution** (`superpowers:subagent-driven-development`) — Implement tasks in isolated worktrees
4. **Finishing** (`superpowers:finishing-a-development-branch`) — Merge, PR, or clean up branches

## Common Commands

```bash
# Build TypeScript
npm run build

# Watch build
npm run dev

# Run offline tests only
npm run test:offline

# Run all tests
npm run test

# Run specific test file
node --test --experimental-strip-types 'test/import-offline.test.ts'
```

## Agent Harness

Development agents are defined in `agents/`:
- `orchestrator.md` — Development workflow orchestration
- `project-architect.md` — Architecture and design
- `feature-developer.md` — Feature implementation
- `cli-developer.md` — CLI command development
- `db-developer.md` — Database and schema work
- `integration-developer.md` — External tool integrations
- `test-engineer.md` — Testing and quality
- `code-reviewer.md` — Architecture consistency, code quality, security, and logic review

See `agents/README.md` for the full harness documentation.
