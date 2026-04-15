# analyze-cli Development Agent Harness

This harness is for **developing** the `analyze-cli` project, not for using it to analyze data. All agents are orchestrated through `superpowers` skills for structured, high-quality software development.

## Agent Topology

```text
orchestrator
  |- project-architect
  |- feature-developer
  |- cli-developer
  |- db-developer
  |- integration-developer
  |- test-engineer
  `- code-reviewer
```

## Orchestration Flow

### Phase 0: Intake
**Agent:** `orchestrator`

- Understand the user's development request
- Determine if it's a bug fix, feature, refactor, or architectural change
- Identify affected modules and required agents
- If unclear, ask clarifying questions before proceeding

**Recommended skill:** `superpowers:brainstorming`

### Phase 1: Architecture & Planning
**Agent:** `orchestrator` dispatches:
- `project-architect` for multi-module or architectural changes
- `feature-developer` for isolated feature work

Outputs:
- Design spec in `docs/superpowers/specs/`
- Implementation plan in `docs/superpowers/plans/`

**Recommended skill:** `superpowers:writing-plans`

### Phase 2: Implementation
**Agent:** `orchestrator` dispatches the appropriate developer agent(s):
- `cli-developer` — new/modified CLI commands
- `db-developer` — schema, migration, CRUD changes
- `integration-developer` — opencli, external API, data pipeline changes
- `feature-developer` — cross-module feature implementation

**Recommended skill:** `superpowers:subagent-driven-development`

### Phase 3: Testing & Verification
**Agent:** `orchestrator` dispatches `test-engineer`

- Verify tests cover the changes
- Run the test suite
- Report coverage gaps or failures

**Recommended skill:** `superpowers:verification-before-completion`

### Phase 4: Review
**Agent:** `orchestrator` dispatches `code-reviewer`

- Check architectural consistency against design
- Identify redundant code, logic errors, and security issues
- Output a structured review report with blocking vs non-blocking items
- Require fixes for blocking issues before approval

**Recommended skill:** `superpowers:requesting-code-review`

### Phase 5: Merge
**Agent:** `orchestrator`

- Merge or create PR via `superpowers:finishing-a-development-branch`

## Agent Responsibilities

| Agent | Responsibility |
|-------|----------------|
| `orchestrator` | Understand requirements, pick agents, enforce phase gates |
| `project-architect` | Architecture decisions, module boundaries, tech choices |
| `feature-developer` | End-to-end feature implementation across modules |
| `cli-developer` | CLI commands, arguments, output formatting, error handling |
| `db-developer` | DuckDB schema, migrations, CRUD modules, data flow |
| `integration-developer` | opencli integration, external APIs, test data |
| `test-engineer` | Test design, test implementation, test execution |
| `code-reviewer` | Code review, architecture consistency, security, quality |

## Design Principles

- **Read before modifying** — always inspect existing code and patterns first
- **One agent per responsibility** — don't mix CLI design with schema design in the same step
- **Structured handoffs** — each phase produces documented artifacts (specs, plans, commits)
- **Tests are mandatory** — no feature is complete without passing tests
- **Worktree isolation** — implementation phases use isolated git worktrees

## Command Mapping (for Development)

```bash
# Setup
pnpm install
pnpm build

# Testing
pnpm test:offline
pnpm test
node --test --experimental-strip-types 'test/<file>.test.ts'

# CLI (for manual verification)
node ./bin/analyze-cli.js <command>
```
