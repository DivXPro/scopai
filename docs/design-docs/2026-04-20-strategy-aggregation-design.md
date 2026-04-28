# Strategy Result Aggregation Design

## Overview

Extend scopai's result querying capabilities with two complementary features:

1. **Auto-expand `strategy result stats`** — automatically detect and aggregate VARCHAR[], DOUBLE[], BOOLEAN[], and JSON array fields from dynamic strategy result tables
2. **New `strategy result aggregate` command** — explicit single-field aggregation with flexible options for power users

## Architecture

### New File: `src/db/aggregation.ts`

Core aggregation layer used by both `stats` (expanded) and `aggregate` commands.

| Function | Description |
|---|---|
| `detectColumnMeta(tableName)` | Query `information_schema.columns` for column name → DuckDB type mapping |
| `aggregateScalar(tableName, taskId, col)` | DOUBLE → avg/min/max; VARCHAR → enum distribution |
| `aggregateArray(tableName, taskId, col, aggFn)` | VARCHAR[]/DOUBLE[]/BOOLEAN[] → unnest + group by with configurable aggregation |
| `aggregateJson(tableName, taskId, col, jsonKey, aggFn)` | JSON → extract key then group by |
| `runAggregate(strategyId, taskId, opts)` | Single-field aggregate entry point |
| `getFullStats(strategyId, taskId)` | Full-field stats used by expanded `stats` command |

Existing `getStrategyResultStats()` stays unchanged for backward compatibility. `getFullStats()` is the new expanded version.

### Output Column Naming

Output columns use field-name prefix to avoid cross-field conflicts:

| Field Type | Aggregation | Output Columns |
|---|---|---|
| DOUBLE | avg/min/max | `{col}_avg`, `{col}_min`, `{col}_max` |
| VARCHAR | count | `{col}_val`, `{col}_count` |
| VARCHAR[]/DOUBLE[]/BOOLEAN[] | count (default) / avg / sum / min / max | `{col}_val`, `{col}_count` |
| JSON | count (default) / avg / sum / min / max | `{json_key}_val`, `{json_key}_count` |

**Conflict resolution**: If a prefixed column name already exists in the source table, append `_agg` suffix.

**Null/empty handling**: Array unnest filters out NULL and empty strings from results.

## CLI Commands

### `strategy result stats` (expanded)

Automatically appends Array/JSON field aggregation to existing output:

```
$ scopai strategy result stats --task-id <id> --strategy <sid>

Total: 42

── Scalar Fields ──────────────────────────────
sentiment_score   avg: 0.72  min: 0.12  max: 0.98
sentiment_label   positive: 28  negative: 8  neutral: 6

── Array Fields ──────────────────────────────
tags (VARCHAR[])
  美食        18
  探店        14
  上海          9
  ...

topics (JSON) → skipped: use --json-key with aggregate command
```

JSON object array fields are skipped with a hint to use the `aggregate` command with `--json-key`.

### `strategy result aggregate` (new)

```bash
scopai strategy result aggregate \
  --task-id <id> \
  --strategy <sid> \
  --group-by <field> \
  [--agg count|sum|avg|min|max]   # default: count
  [--json-key <key>]               # required for JSON object arrays
  [--having "count > 3"]          # filter aggregated results
  [--limit <n>]                    # default: 50
  [--format csv|json]              # default: terminal table
  [--output <path>]                # export to file
```

**Examples:**

```bash
# VARCHAR[] tag frequency
scopai strategy result aggregate --task-id t1 --strategy s1 --group-by tags

# JSON object array, extract .name field
scopai strategy result aggregate --task-id t1 --strategy s1 \
  --group-by topics --json-key name --having "count > 2"

# DOUBLE[] numeric array average
scopai strategy result aggregate --task-id t1 --strategy s1 \
  --group-by scores --agg avg
```

**Output format** (terminal table):

```
field        count
美食          18
探店          14
上海           9
```

## Error Handling

| Scenario | Behavior |
|---|---|
| `--group-by` field does not exist | Error with `Available columns: ...` list |
| `--json-key` missing on JSON field | Error: `Use --json-key <key>` |
| `--json-key` provided on non-JSON field | Ignored, normal aggregation |
| `--having` SQL syntax error | DuckDB error surfaced, prompt user to check syntax |
| Empty result set | Returns `[]`, no error |
| `--limit` ≤ 0 | Defaults to 50 |

**Type detection fallback**: If `information_schema.columns` fails, fall back to `DESCRIBE` for dynamic type inference.

## File Changes

| File | Change |
|---|---|
| `src/db/aggregation.ts` | **New** — core aggregation logic |
| `src/db/analysis-results.ts` | Add `getFullStats()` wrapper |
| `src/daemon/handlers.ts` | Add `strategy.result.aggregate` handler |
| `src/cli/strategy.ts` | Add `aggregate` subcommand + expand `stats` output |
| `tests/unit/aggregation.test.ts` | **New** — unit tests for all aggregation functions |
