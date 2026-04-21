# Auto Strategy Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `analyze-cli strategy import` to accept JSON strings via `--json`, and update the `analyze-cli` Claude Code skill to support interactive strategy creation from natural language.

**Architecture:** Add a `--json` option to the existing `strategy import` CLI command and daemon handler (mutually exclusive with `--file`). Then extend the `.claude/skills/analyze-cli/skill.md` with a new `create_strategy` capability that orchestrates multi-turn clarification, JSON generation, and self-healing import via the CLI.

**Tech Stack:** TypeScript, Node.js, Commander.js, Claude Code skills (markdown-based)

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/cli/strategy.ts` | CLI command definitions for `strategy import`; add `--json` option and mutual exclusion with `--file` |
| `src/daemon/handlers.ts` | Daemon RPC handler for `strategy.import`; accept `json` param and parse string directly |
| `.claude/skills/analyze-cli/skill.md` | Claude Code skill instructions; add `create_strategy` capability with generation rules and error recovery |

---

### Task 1: Extend CLI `strategy import` with `--json`

**Files:**
- Modify: `src/cli/strategy.ts:34-53`

- [ ] **Step 1: Change `.requiredOption('--file')` to `.option` and add `.option('--json')`**

Replace the `import` command definition so that `--file` and `--json` are optional but mutually exclusive.

```typescript
  strategy
    .command('import')
    .description('Import a strategy from a JSON file or string')
    .option('--file <file>', 'Path to strategy JSON file')
    .option('--json <json>', 'Strategy JSON string')
    .action(async (opts: { file?: string; json?: string }) => {
      if (!opts.file && !opts.json) {
        console.log(pc.red('Either --file or --json is required'));
        process.exit(1);
      }
      if (opts.file && opts.json) {
        console.log(pc.red('Cannot use both --file and --json'));
        process.exit(1);
      }
      if (opts.file && !fs.existsSync(opts.file)) {
        console.log(pc.red('File not found'));
        process.exit(1);
      }
      try {
        const result = await daemonCall('strategy.import', { file: opts.file, json: opts.json }) as { imported: boolean; id?: string; reason?: string };
        if (result.imported) {
          console.log(pc.green(`Strategy imported: ${result.id}`));
        } else {
          console.log(pc.yellow(`Skipped: ${result.reason}`));
        }
      } catch (err: unknown) {
        console.log(pc.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
```

- [ ] **Step 2: Build and verify no type errors**

Run: `npm run build`
Expected: Compiles successfully with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli/strategy.ts
git commit -m "feat(cli): strategy import supports --json option

Allow importing a strategy directly from a JSON string without
needing an intermediate file.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Extend Daemon Handler for `strategy.import` to Parse `json` Param

**Files:**
- Modify: `src/daemon/handlers.ts:720-763`

- [ ] **Step 1: Update handler to accept `json` param**

Replace the top of the `strategy.import` handler:

```typescript
    async 'strategy.import'(params) {
      let data: unknown;
      if (typeof params.json === 'string') {
        try {
          data = JSON.parse(params.json as string);
        } catch {
          throw new Error('Invalid JSON string');
        }
      } else if (typeof params.file === 'string') {
        const filePath = params.file as string;
        if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
        const content = fs.readFileSync(filePath, 'utf-8');
        try {
          data = JSON.parse(content);
        } catch {
          throw new Error('Invalid JSON file');
        }
      } else {
        throw new Error('Either file or json is required');
      }
      const validation = validateStrategyJson(data);
      if (!validation.valid) throw new Error(validation.error);
```

Leave the rest of the handler (existing lines 734-763) unchanged.

- [ ] **Step 2: Build and verify no type errors**

Run: `npm run build`
Expected: Compiles successfully.

- [ ] **Step 3: Run existing strategy tests**

Run: `node --test --experimental-strip-types test/strategy-system.test.ts`
Expected: Tests pass (or fail only due to known local DuckDB connection issues unrelated to this change).

- [ ] **Step 4: Commit**

```bash
git add src/daemon/handlers.ts
git commit -m "feat(daemon): strategy.import handler accepts json param

Enables direct JSON-string imports by parsing params.json before
falling back to file-based imports.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Update Skill with `create_strategy` Capability

**Files:**
- Modify: `.claude/skills/analyze-cli/skill.md`

- [ ] **Step 1: Append the new capability before the `## Workflow Guidance` section**

Add the following block immediately before `## Workflow Guidance`:

```markdown
### 11. create_strategy
Create a new analysis strategy via natural language conversation.
- When to use: the user asks to create/generate/build a new strategy (套路/分析维度/分析模板).
- Workflow:
  1. **Clarify requirements** — Ask at most 2 follow-up questions:
     - Target type: post or comment? (If comment, warn that only post is currently supported.)
     - Output dimensions: what fields should the analysis return? (scores, labels, recommendations, etc.)
     - Media dependency: should the strategy automatically read post images/videos?
     - Naming preference: any preferred ID or name?
  2. **Generate strategy JSON** using the strict rules below. The JSON must pass `validateStrategyJson`.
  3. **Present the JSON** in a markdown code block and ask the user to approve or request edits.
  4. **If edits requested**, apply them and regenerate the JSON, then present again.
  5. **If approved**, call `analyze-cli strategy import --json '<generated_json>'`.
  6. **If import fails** (validation error, invalid JSON, etc.), read the error message, fix the JSON, and retry up to 2 times.
  7. **On success**, run `analyze-cli strategy show --id <id>` and summarize for the user.

#### JSON Generation Rules
The generated strategy must satisfy the project's `validateStrategyJson` and database schema.

**Required fields:**
- `id`: lowercase, only `a-z0-9_-`, e.g. `monetization-v1`
- `name`: human-readable name
- `version`: default `"1.0.0"`
- `target`: `"post"` (only post is currently supported)
- `needs_media`: object with `enabled: true/false`. If `true`, include `media_types`, `max_media`, `mode`.
- `prompt`: must include `{{content}}`. If `needs_media.enabled` is `true`, also include `{{media_urls}}`. Do not use Handlebars conditionals/loops.
- `output_schema`: standard JSON Schema with `type: "object"` and a `properties` object. Each property must have a `type`: `number`, `string`, `boolean`, `array` (with `items.type` when possible), or `object`.

**Prompt quality:** Append an output-format hint to the prompt so the model returns pure JSON. Example:
```
=== 输出要求 ===
请严格按以下 JSON 格式返回结果，只输出纯 JSON，不要添加 markdown 代码块标记或额外解释：
{ ... }
```

**Example valid strategy:**
```json
{
  "id": "monetization-v1",
  "name": "带货潜力分析",
  "description": "分析小红书帖子的带货潜力和模仿价值",
  "version": "1.0.0",
  "target": "post",
  "needs_media": {
    "enabled": true,
    "media_types": ["image", "video"],
    "max_media": 5,
    "mode": "all"
  },
  "prompt": "你是一个内容分析专家，请分析以下帖子的带货潜力。\n\n帖子内容：\n{{content}}\n\n作者：{{author_name}}\n平台：{{platform}}\n发布于：{{published_at}}\n\n{{media_urls}}\n\n=== 输出要求 ===\n请严格按以下 JSON 格式返回结果，只输出纯 JSON，不要添加 markdown 代码块标记或额外解释：\n{ \"monetization_score\": number, \"product_type\": string, \"recommendation\": string }",
  "output_schema": {
    "type": "object",
    "properties": {
      "monetization_score": { "type": "number" },
      "product_type": { "type": "string" },
      "recommendation": { "type": "string" }
    }
  }
}
```

#### Error Recovery
- Import validation fails → read the exact error, fix the offending field, retry import.
- Same version exists → ask whether to bump version or change ID.
- Max 2 retries exceeded → show the JSON and error, ask the user to guide the fix.
```

- [ ] **Step 2: Commit skill change**

```bash
git add .claude/skills/analyze-cli/skill.md
git commit -m "feat(skill): add create_strategy capability

Enables natural-language strategy creation via the analyze-cli
Claude Code skill, including interactive clarification and
self-healing import via --json.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Manual End-to-End Verification

- [ ] **Step 1: Test `--json` import via CLI**

Run:
```bash
npm run build
./bin/analyze-cli.js strategy import --json '{"id":"test-plan-strategy","name":"Test Strategy","version":"1.0.0","target":"post","prompt":"Analyze: {{content}}","output_schema":{"type":"object","properties":{"score":{"type":"number"}}}}'
```
Expected output: `Strategy imported: test-plan-strategy`

- [ ] **Step 2: Verify duplicate version skip**

Run the same command again.
Expected output: `Skipped: same version already exists`

- [ ] **Step 3: Verify validation error path**

Run with bad JSON:
```bash
./bin/analyze-cli.js strategy import --json '{"id":"bad","target":"post"}'
```
Expected output: `Error: Missing required field: name` (or similar validation error)

- [ ] **Step 4: Clean up test strategy**

Run:
```bash
./bin/analyze-cli.js strategy remove --id test-plan-strategy
```
(If `remove` does not exist, delete directly from the DB or skip this step.)

- [ ] **Step 5: Final commit (if any fixes were needed)**

If any bugs were found and fixed during manual testing, commit them now.

---

## Self-Review Checklist

| Spec Requirement | Plan Task |
|------------------|-----------|
| `--json` option on `strategy import` | Task 1 + Task 2 |
| `--file` and `--json` mutual exclusion | Task 1 Step 1 |
| Daemon handler parses `json` string directly | Task 2 Step 1 |
| Reuse existing validation (`validateStrategyJson`) | Task 1 Step 1, Task 2 Step 1 (implicit) |
| Skill `create_strategy` capability | Task 3 |
| Preview + edit flow in skill | Task 3 Step 1 |
| Error recovery loop (max 2 retries) | Task 3 Step 1 |
| Manual testing | Task 4 |
