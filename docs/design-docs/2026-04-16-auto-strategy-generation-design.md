# Auto Strategy Generation Design

## Overview

Allow users to create new analysis strategies (套路) for `scopai` by describing their needs in natural language to the Claude Code AI Agent. After a brief interactive clarification, the Agent generates a valid strategy JSON and registers it directly into the system.

## Goals

- Zero-friction strategy creation via natural language
- No intermediate files visible to the user
- Leverage existing `validateStrategyJson` and `strategy import` infrastructure for validation
- Keep the skill itself as the orchestration layer, with minimal CLI code changes

## Non-Goals

- Web UI or external bot integration
- Automatic strategy execution after creation
- Version diffing or rollback of strategies

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| CLI change scope | Add `--json` to `strategy import` | Avoids temp-file gymnastics and enables clean skill orchestration |
| Generation engine | Claude Code skill instructions + in-context prompt engineering | No new backend service required; leverages the model already in the conversation |
| Validation | Reuse existing `validateStrategyJson` + CLI error feedback loop | Keeps validation logic in one place (the codebase) |
| Preview flow | Show generated JSON in chat, allow natural-language edits, then confirm import | Balances convenience with user control |

## CLI Changes

### 1. `strategy import` supports `--json`

**Files to modify:**
- `src/cli/strategy.ts`
- `src/daemon/handlers.ts`

**Behavior:**
- `--file <path>` and `--json <string>` are mutually exclusive
- When `--json` is provided, the daemon handler parses the string directly instead of reading from disk
- All subsequent validation and database logic remain unchanged

**Example:**
```bash
scopai strategy import --json '{"id":"monetization-v1","name":"带货潜力分析",...}'
```

### 2. Error Handling

- Invalid JSON string → `Invalid JSON` error
- Fails `validateStrategyJson` → returns the validation error message
- Same `id` + `version` already exists → returns `{ imported: false, reason: 'same version already exists' }`

## Skill Update

**File to modify:**
- `.claude/skills/scopai/skill.md`

### New Capability: `create_strategy`

**Trigger phrases:**
- "创建一个分析...的套路"
- "生成一个策略"
- "新建分析维度"
- "create strategy"

**Workflow:**

```
User expresses intent
  ↓
Clarify requirements (1-2 rounds)
  ↓
Generate strategy JSON following strict rules
  ↓
Present JSON in chat for user review
  ↓
User approves or requests edits
  ├─ Edits → regenerate JSON → present again
  └─ Approves → call CLI import
        ↓
  scopai strategy import --json '<json>'
        ↓
  ├─ Validation fails → show error → fix JSON → retry (max 2 retries)
  └─ Success → run `strategy show --id <id>` → confirm to user
```

### Clarifying Questions

The skill should ask succinctly:
1. **Target type** — `post` or `comment`? (Currently only `post` is supported by the worker.)
2. **Output dimensions** — What fields should the analysis return? (e.g. score, labels, recommendations)
3. **Media dependency** — Should the strategy automatically read images/videos attached to posts?
4. **Naming preference** — Any preferred strategy ID or name?

### JSON Generation Rules (embedded in skill)

The generated JSON must satisfy `validateStrategyJson` and match the database schema:

```json
{
  "id": "lowercase-kebab-v1",
  "name": "Human-readable name",
  "description": "What this strategy does",
  "version": "1.0.0",
  "target": "post",
  "needs_media": {
    "enabled": true,
    "media_types": ["image", "video"],
    "max_media": 5,
    "mode": "all"
  },
  "prompt": "Analyze the post.\n\nContent: {{content}}\nAuthor: {{author_name}}\n{{media_urls}}\n\n...",
  "output_schema": {
    "type": "object",
    "properties": {
      "score": { "type": "number", "title": "评分" },
      "label": { "type": "string", "enum": ["high", "medium", "low"], "title": "标签" },
      "tags": { "type": "array", "items": { "type": "string" }, "title": "标签列表" },
      "verified": { "type": "boolean", "title": "已验证" },
      "meta": { "type": "object", "title": "元数据" }
    }
  }
}
```

**Prompt requirements:**
- Must include `{{content}}`
- If `needs_media.enabled` is `true`, must include `{{media_urls}}`
- Do not use Handlebars conditionals/loops; rely on simple placeholder replacement

**Output schema requirements:**
- `type` must be `"object"`
- Must have a `properties` object
- Each property must have a `type` (`number`, `string`, `boolean`, `array`, `object`) and a `title` (human-readable Chinese label)
- Arrays should specify `items.type` when possible

### Error Recovery Loop

| Failure | Skill Action |
|---------|--------------|
| `Invalid JSON` | Re-generate the JSON more carefully |
| `validateStrategyJson` error | Read the specific field error, correct it, retry import |
| Same version exists | Ask user whether to bump version or change ID |
| Max 2 retries exceeded | Show the JSON and the error, ask user to manually guide the fix |

## Integration with Existing Systems

- **Validation**: Reuses `src/db/strategies.ts:validateStrategyJson`
- **Import**: Reuses `src/daemon/handlers.ts:strategy.import`
- **Result table creation**: Reuses existing `createStrategyResultTable` called during import
- **Worker execution**: No changes; the new strategy is immediately usable via `analyze run --strategy <id>`

## Testing Plan

1. **CLI layer**: Verify `--json` succeeds and fails with the same outputs as `--file`
2. **Daemon layer**: Verify `strategy.import` handler accepts `json` param and parses correctly
3. **Skill layer** (manual): Run conversation flows:
   - Simple strategy creation
   - Strategy creation with media dependency
   - Validation failure and retry
   - User-requested edit after preview

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Model generates invalid JSON schema | CLI validation catches it; skill retries with error feedback |
| Prompt in generated strategy is low quality | Skill generates prompt with embedded output-format hint (same mechanism as `buildSchemaHint` in the worker) |
| Skill instructions become too long | Keep generation rules concise and link to this design doc if needed |

## Implementation Steps

1. Extend `strategy import` CLI and daemon handler to accept `--json`
2. Update `.claude/skills/scopai/skill.md` with `create_strategy` capability
3. Run manual skill conversation tests
4. Commit both code and skill changes
