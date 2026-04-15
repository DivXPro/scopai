# JSON Schema Dynamic Result Tables Design

## Goal

Replace the fixed-schema `analysis_results` table with per-strategy dynamically created result tables, using JSON Schema as the source of truth for the table schema. This enables native SQL columns, indexing, and precise type safety for strategy outputs.

## Context

The existing strategy system uses a single `analysis_results` table with JSON columns (`columns`, `json_fields`) to store dynamic results. This prevents efficient querying, indexing, and aggregation on strategy-specific fields. This design migrates to dynamically created tables—one per strategy—derived directly from the strategy's `output_schema`.

---

## 1. Table Naming Convention

Each strategy gets a dedicated result table:

```
analysis_results_strategy_<strategy_id>
```

**Constraints:**
- `strategy_id` must match `^[a-z0-9_-]+$`
- Table name length must not exceed 63 characters
- Illegal characters in `strategy_id` are rejected at import time

---

## 2. Fixed Columns

Every dynamic table includes these fixed columns:

| Column | Type | Notes |
|--------|------|-------|
| `id` | `TEXT PRIMARY KEY` | Result UUID |
| `task_id` | `TEXT NOT NULL` | References `tasks(id)` |
| `target_type` | `TEXT NOT NULL` | `'post'` or `'comment'` |
| `target_id` | `TEXT NOT NULL` | Post or comment ID |
| `post_id` | `TEXT` | References `posts(id)` |
| `strategy_version` | `TEXT NOT NULL` | Strategy version at analysis time |
| `raw_response` | `JSON` | Full raw LLM response |
| `error` | `TEXT` | Error message if analysis failed |
| `analyzed_at` | `TIMESTAMP DEFAULT NOW()` | Analysis timestamp |
| `UNIQUE(task_id, target_type, target_id)` | | Prevents duplicate analysis for the same task+target |

---

## 3. JSON Schema to DuckDB Type Mapping

Dynamic columns are derived from `output_schema.properties`.

| JSON Schema | DuckDB Type | Notes |
|-------------|-------------|-------|
| `number` / `integer` | `DOUBLE` | All numeric types map to DOUBLE |
| `string` | `TEXT` | |
| `string` + `enum` | `TEXT` | Enum validation enforced at application layer |
| `boolean` | `BOOLEAN` | |
| `array` + `items.type=string` | `VARCHAR[]` | Native array |
| `array` + `items.type=number` | `DOUBLE[]` | Native array |
| `array` + `items.type=boolean` | `BOOLEAN[]` | Native array |
| `array` (other/mixed/no items) | `JSON` | Fallback for complex arrays |
| `object` | `JSON` | Nested objects serialized as JSON |

**Unsupported JSON Schema features** (rejected at import):
- `anyOf`, `oneOf`, `allOf`
- `$ref`
- Nested `$defs` / `definitions`

**Column naming rules:**
- Property names must match `^[a-z_][a-z0-9_]*$` (case-insensitive)
- Maximum 128 properties per schema
- All dynamic columns are `NULLABLE` by default

---

## 4. Auto-Indexing Strategy

The following dynamic columns automatically receive a `BTREE` index on table creation:

- All `number` / `integer` properties
- All `string` properties that include an `enum` constraint
- The `task_id` fixed column (always indexed)

Non-enum `string`, `boolean`, `array`, `object`, and `JSON` columns are **not** auto-indexed to avoid write overhead.

---

## 5. Table Lifecycle

### 5.1 Creation on Import

When `strategy.import` succeeds, the system:

1. Validates `strategy_id` against the whitelist regex
2. Parses `output_schema.properties` into column definitions
3. Generates the table name
4. Executes `CREATE TABLE IF NOT EXISTS analysis_results_strategy_<id> (...)`
5. Creates auto-indexes
6. If the table already exists but the schema has new fields, executes `ALTER TABLE ADD COLUMN` for each missing field

### 5.2 Sync on Schema Update

If an existing strategy is re-imported with a newer version and additional properties:

1. Compare existing table columns with new schema properties
2. Run `ALTER TABLE ADD COLUMN <name> <type>` for each new property
3. DuckDB does not support `DROP COLUMN` or type changes; if a property type changes, import fails with an error requiring manual migration

### 5.3 Cleanup on Strategy Delete

When `strategy.delete` is invoked (existing DB function):

1. Run `DROP TABLE IF EXISTS analysis_results_strategy_<id>`
2. Then delete the strategy row from `strategies`

---

## 6. Worker Write Flow

`processStrategyJob` in `src/worker/consumer.ts` is updated to:

1. Resolve the result table name from `strategy.id`
2. Parse the LLM response with `parseStrategyResult`
3. Extract values for every property declared in `output_schema.properties`
4. Build a parameterized `INSERT` statement:
   - Fixed columns are always included
   - Dynamic columns are derived from the schema property names
   - **Column names are concatenated safely (whitelist validated at import)**
   - **All values are passed as bound parameters**

Example generated SQL:

```sql
INSERT INTO analysis_results_strategy_sentiment_v1
  (id, task_id, target_type, target_id, post_id, strategy_version, score, level, tags, raw_response, error, analyzed_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

---

## 7. Query Interface

### 7.1 Daemon Handlers

New handlers added to `src/daemon/handlers.ts`:

- `strategy.result.list(params)`
  - `task_id`, `strategy_id`, `limit`
  - Queries `analysis_results_strategy_<id>`
  - Returns all columns (fixed + dynamic)

- `strategy.result.stats(params)`
  - `task_id`, `strategy_id`
  - Aggregates:
    - `COUNT(*)` total
    - `AVG()` / `MIN()` / `MAX()` for numeric columns
    - `GROUP BY` counts for enum columns

- `strategy.result.export(params)`
  - `task_id`, `strategy_id`, `format`, `output`
  - Exports results to CSV or JSON lines

### 7.2 CLI Commands

New commands in `src/cli/strategy.ts`:

```bash
analyze-cli strategy result list --task-id <id> --strategy <id> [--limit <n>]
analyze-cli strategy result stats --task-id <id> --strategy <id>
analyze-cli strategy result export --task-id <id> --strategy <id> [--format csv|json] [--output <path>]
```

---

## 8. Type Validation & Safety

### 8.1 Import-Time Validation

`validateStrategyJson` is extended to:

1. Require `output_schema` to be a valid JSON Schema object with `type: 'object'`
2. Require `properties` to be an object
3. Validate each property has a supported `type`
4. Reject unsupported keywords (`anyOf`, `oneOf`, `allOf`, `$ref`)
5. Validate property names against the column naming regex

### 8.2 Write-Time Coercion

`parseStrategyResult` is rewritten to use JSON Schema for coercion:

- `number` → `parseFloat`, invalid → `null`
- `string` → `String`
- `boolean` → strict `true`/`false`/`1`/`0`/`'true'`/`'false'`, invalid → `null`
- `enum` → lowercased match against `enum` array, invalid → `null`
- Arrays → validate element types when `items.type` is present; wrap scalars into arrays
- Objects → pass through as-is

Only properties declared in `output_schema.properties` are written to the dynamic table. Extra fields are preserved in `raw_response` but dropped from the table insert.

---

## 9. Migration Plan

Since there is no production data in `analysis_results`:

1. Update `src/db/schema.sql`:
   - Remove the `CREATE TABLE analysis_results` block
2. Update `src/db/migrate.ts`:
   - Add a migration step: `DROP TABLE IF EXISTS analysis_results`
3. Update `src/shared/types.ts`:
   - Change `Strategy.output_schema` from `StrategyOutputSchema` to `Record<string, unknown>` (raw JSON Schema)
   - Remove `StrategyColumnDef`, `StrategyJsonFieldDef`, `StrategyOutputSchema` (no longer needed)
   - Update `AnalysisResult` if it still references old types

---

## 10. Testing Strategy

| Test | Scope |
|------|-------|
| `npm run build` | TypeScript compiles cleanly |
| `test/strategy-system.test.ts` | Schema migration, strategy import creates dynamic table, worker writes correct values, CLI lists/stats/export work, e2e flow end-to-end |
| JSON Schema edge cases | Invalid types, unsupported keywords, oversized property lists, bad column names rejected |
| Array coercion | `VARCHAR[]`, `DOUBLE[]`, `BOOLEAN[]`, and `JSON` fallback |

---

## 11. Open Decisions (none remaining)

All design decisions are locked:
- JSON Schema as source of truth
- Per-strategy dynamic tables
- JSON Schema → DuckDB mapping per Section 3
- Auto-index strategy: `number` and `enum` columns
- Old `analysis_results` table: dropped via migration
