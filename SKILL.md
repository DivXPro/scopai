---
name: analyze-cli
description: Social media data analysis CLI — search, import, download comments/media, and run multi-step strategy analysis.
type: tool-use
---

# analyze-cli Skill

You are an agent that operates the `analyze-cli` command-line tool for social media content analysis.

## Pre-execution Checks

Before executing any analyze-cli workflow, perform the following checks in order:

1. **Ensure analyze-cli is built**
   - Check if `dist/cli/index.js` exists.
   - If not, run `npm run build` (or `pnpm build`) in the project root.

2. **Ensure daemon is running**
   - Run `analyze-cli daemon status`.
   - If the daemon is not running, start it with `analyze-cli daemon start` and wait a few seconds.

3. **Read opencli skill before using opencli**
   - Before running any `opencli` command (e.g., `opencli xiaohongshu search`), first read the opencli skill documentation to confirm command syntax and available adapters.

4. **Verify opencli availability**
   - Run `opencli --help` or `opencli doctor` to confirm opencli is installed and functional.

## Capabilities

Use the tools below to help the user complete data gathering and analysis workflows.

### 1. search_posts
Search for posts on a platform via OpenCLI.
- Command: `opencli xiaohongshu search {query} --limit {limit} -f json`
- When to use: the user wants to discover posts before importing.
- Output fields (JSON): `rank`, `title`, `author`, `likes`, `published_at`, `url`.
- **Important**: the `url` field is the **full Xiaohongshu note URL** (including `xsec_token`). It should be passed as `{note_id}` to subsequent `opencli xiaohongshu comments` / `download` / `note` commands.

### 2. add_platform
Register a platform if it does not already exist.
- Command: `analyze-cli platform add --id {id} --name {name}`
- When to use: before importing posts for a new platform.

### 3. import_posts
Import posts from a JSON/JSONL file and optionally bind them to a task.
- Command: `analyze-cli post import --platform {id} --file {path} [--task-id {task_id}]`
- When to use: after search results have been saved to a file.
- Duplicate posts (same platform_id + platform_post_id) are updated, not skipped.

### 4. create_task
Create an analysis task.
- Command: `analyze-cli task create --name {name} [--cli-templates '{"fetch_comments":"...","fetch_media":"..."}']`
- When to use: before adding analysis steps or binding posts.
- **CLI templates example** (opencli 1.7.4+):
  ```bash
  analyze-cli task create --name "XHS Analysis" \
    --cli-templates '{
      "fetch_comments": "opencli xiaohongshu comments {note_id} --limit 100 --with-replies false -f json",
      "fetch_media": "opencli xiaohongshu download {note_id} --output downloads/xhs -f json"
    }'
  ```
  - `{note_id}` will be substituted with the post URL (from `posts.url` or `metadata.note_id`).

### 5. add_step_to_task
Add a strategy-based analysis step to a task.
- Command: `analyze-cli task step add --task-id {task_id} --strategy-id {strategy_id} [--name {name}] [--order {n}]`
- When to use: the user wants to analyze data with a specific strategy (sentiment-topics, risk-detection, etc.).

### 6. prepare_task_data
Download comments and media for all posts bound to a task.
- Command: `analyze-cli task prepare-data --task-id {task_id}`
- When to use: after posts have been imported and bound to the task.
- This command is resumable; interrupted runs will continue from unfinished posts.

### 7. run_task_step
Run a single task step.
- Command: `analyze-cli task step run --task-id {task_id} --step-id {step_id}`
- When to use: the user wants to execute one specific strategy step.

### 8. run_all_steps
Run all pending/failed steps for a task in order.
- Command: `analyze-cli task run-all-steps --task-id {task_id}`
- When to use: the user wants to start the full analysis pipeline after data preparation.

### 9. get_task_status
Check the current status of a task, including data-preparation progress and each step's progress.
- Command: `analyze-cli task status --task-id {task_id}`
- When to use: after starting analysis to monitor progress.
- Read the `phase` field (`dataPreparation` or `analysis`) and the `phases` object to report progress.

### 10. get_task_results
Show analysis results for a completed task.
- Command: `analyze-cli task results --task-id {task_id}`
- When to use: after the task status shows `completed`.

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

## Workflow Guidance

1. If the user asks to "analyze" platform content, start with `search_posts` -> `add_platform` -> `create_task` -> `import_posts` (with `--task-id`).
   - **Note**: `search_posts` returns summary data (title, likes, URL). If the strategy needs full post content (`{{content}}`), you may need to enrich the data first using `opencli xiaohongshu note {url} -f json` before `import_posts`.
2. Then `add_step_to_task` for each strategy they need.
3. Run `prepare_task_data` to fetch comments and media via the opencli templates defined in `create_task`.
4. Run `run_all_steps` to start the analysis pipeline.
5. Poll `get_task_status` periodically and report progress:
   - phase = `dataPreparation`: report `commentsFetched / totalPosts` and `mediaFetched / totalPosts`.
   - phase = `analysis`: for each running step, report `done / total` from its `stats`.
   - status = `completed`: proceed to `get_task_results`.
6. If a step or data-preparation fails, report the error and ask if the user wants to retry.
