***

name: analyze-cli
description: Social media data analysis CLI — search, import, download comments/media, and run multi-step strategy analysis.
type: tool-use
--------------

# analyze-cli Skill

You are an agent that operates the `analyze-cli` command-line tool for social media content analysis.

## Pre-execution Checks

Before executing any analyze-cli workflow, perform the following checks in order:

1. **Verify analyze-cli is executable**
   - Run `analyze-cli -V` (or `analyze-cli --version`) to confirm the CLI is installed and runnable.
2. **Ensure daemon is running**
   - Run `analyze-cli daemon status`.
   - If the daemon is not running, start it with `analyze-cli daemon start` and wait a few seconds.
   - The daemon performs a database health check on startup. If it logs a health-check failure and exits, do not attempt to delete or modify the database file. Instead, ensure no other process is holding the database lock, then restart the daemon.
3. **Read opencli skill before using opencli**
   - Before running any `opencli` command (e.g., `opencli xiaohongshu search`), first read the opencli skill documentation to confirm command syntax and available adapters.
4. **Verify opencli availability**
   - Run `opencli --help` or `opencli doctor` to confirm opencli is installed and functional.

## Capabilities

Use the tools below to help the user complete data gathering and analysis workflows.

### 1. search\_posts

Search for posts on a platform via OpenCLI.

- Command: `opencli xiaohongshu search {query} --limit {limit} -f json`
- When to use: the user wants to discover posts before importing.
- Output fields (JSON): `rank`, `title`, `author`, `likes`, `published_at`, `url`.
- **Important**: the `url` field is the **full Xiaohongshu note URL** (including `xsec_token`). It should be passed as `{note_id}` to subsequent `opencli xiaohongshu comments` / `download` / `note` commands.

### 2. add\_platform

Register a platform if it does not already exist.

- Command: `analyze-cli platform add --id {id} --name {name}`
- When to use: before importing posts for a new platform.

### 3. import\_posts

Import posts from a JSON/JSONL file and optionally bind them to a task.

- Command: `analyze-cli post import --platform {id} --file {path} [--task-id {task_id}]`
- When to use: after search results have been saved to a file.
- Duplicate posts (same platform\_id + platform\_post\_id) are updated, not skipped.
- **DO NOT manually fetch note details before import**: Do not run `opencli xiaohongshu note` for each post and do not write ad-hoc scripts to "enrich" data before importing. The data-preparation stage (`analyze-cli task prepare-data`) is responsible for fetching full post content via the `fetch_note` template.
- **Format compatibility** (edge case): `post.import` can handle raw `opencli xiaohongshu note` output if you already have it, but this is not the standard workflow. Standard workflow: import search summaries directly, then let `prepare-data` enrich them.

### 4. create\_task

Create an analysis task.

- Command: `analyze-cli task create --name {name} [--cli-templates '{"fetch_comments":"...","fetch_media":"..."}']`
- When to use: before adding analysis steps or binding posts.
- **CLI templates example** (opencli 1.7.4+):
  ```bash
  analyze-cli task create --name "XHS Analysis" \
    --cli-templates '{
      "fetch_note": "opencli xiaohongshu note {note_id} -f json",
      "fetch_comments": "opencli xiaohongshu comments {note_id} --limit 100 --with-replies false -f json",
      "fetch_media": "opencli xiaohongshu download {note_id} --output {download_dir}/xhs -f json"
    }'
  ```
  - **`fetch_note`** **(required)**: Fetches full post details (content, tags, stats, author info) to enrich the imported search-result data. Search results only contain summary fields; without this step, the `{{content}}` variable will be empty during analysis. This step runs **first**, updating the post record in the database before comments/media are fetched.
  - **`fetch_comments`** (optional): Fetches comment data via opencli. Runs after `fetch_note`.
  - **`fetch_media`** (optional): Downloads media files (images/videos) via opencli. Runs after `fetch_comments`.
  - `{note_id}` will be substituted with the post URL (from `posts.url` or `metadata.note_id`).
  - `{download_dir}` will be substituted with the project's download directory (`tmp/downloads` under the project root by default). Always use `{download_dir}` in `--output` paths instead of hard-coded paths, so that downloaded files are stored in a predictable project-local location regardless of the working directory.

### 5. add\_step\_to\_task

Add a strategy-based analysis step to a task.

- Command: `analyze-cli task step add --task-id {task_id} --strategy-id {strategy_id} [--name {name}] [--order {n}]`
- When to use: the user wants to analyze data with a specific strategy (sentiment-topics, risk-detection, etc.).

### 6. prepare\_task\_data

Enrich posts and download comments/media for all posts bound to a task. Executes in three sequential steps per post: (1) `fetch_note` (required) → (2) `fetch_comments` (optional) → (3) `fetch_media` (optional).

- Command: `analyze-cli task prepare-data --task-id {task_id}`
- When to use: after posts have been imported and bound to the task.
- This command is resumable; interrupted runs will continue from unfinished posts.
- `prepare-data` will fail if `cli_templates` does not contain `fetch_note`. `fetch_comments` and `fetch_media` are optional.

### 7. run\_task\_step

Run a single task step.

- Command: `analyze-cli task step run --task-id {task_id} --step-id {step_id}`
- When to use: the user wants to execute one specific strategy step.

### 8. run\_all\_steps

Run all pending/failed steps for a task in order.

- Command: `analyze-cli task run-all-steps --task-id {task_id}`
- When to use: the user wants to start the full analysis pipeline after data preparation.

### 9. get\_task\_status

Check the current status of a task, including data-preparation progress and each step's progress.

- Command: `analyze-cli task status --task-id {task_id}`
- When to use: after starting analysis to monitor progress.
- Read the `phase` field (`dataPreparation` or `analysis`) and the `phases` object to report progress.

### 10. get\_task\_results

Show analysis results for a completed task.

- Command: `analyze-cli task results --task-id {task_id}`
- When to use: after the task status shows `completed`.

### 11. reset\_task\_step

Reset a failed or running task step back to pending, and retry its failed strategy queue jobs.

- Command: `analyze-cli task step reset --task-id {task_id} --step-id {step_id}`
- When to use: a strategy analysis step failed (e.g., due to API rate limits) and the user wants to retry it safely without touching the database directly.

### 12. analyze\_run

Run a strategy directly against a task (alternative to step-based approach).

- Command: `analyze-cli analyze run --task-id <id> --strategy <id>`
- When to use: quick single-strategy analysis without creating formal task steps.

### 13. platform\_mapping\_list

List field mappings for a platform (how platform fields map to system fields).

- Command: `analyze-cli platform mapping list --platform <id> [--entity post|comment]`
- When to use: understanding how platform-specific fields are normalized when importing posts/comments.

### 14. list\_posts

List posts in the database.

- Command: `analyze-cli post list [--platform <id>] [--limit <n>] [--offset <n>]`
- When to use: the user wants to view previously imported posts.

### 15. search\_posts\_db

Search posts by keyword in the database.

- Command: `analyze-cli post search --platform <id> --query <text> [--limit <n>]`
- When to use: searching imported posts by content/title keywords.

### 16. import\_comments

Import comments from a JSON/JSONL file and associate them with a post.

- Command: `analyze-cli comment import --platform <id> --post-id <id> --file <path>`
- When to use: after comment data has been fetched and saved to a file.
- Duplicate comments (same platform\_comment\_id) are skipped.

### 17. list\_comments

List comments for a post.

- Command: `analyze-cli comment list --post-id <id> [--limit <n>]`
- When to use: the user wants to view comments associated with a post.

### 18. add\_posts\_to\_task

Add imported posts to a task.

- Command: `analyze-cli task add-posts --task-id <id> --post-ids <ids>`
- When to use: after `import_posts` (without `--task-id`) and the user wants to bind those posts to an existing task.

### 19. add\_comments\_to\_task

Add imported comments to a task.

- Command: `analyze-cli task add-comments --task-id <id> --comment-ids <ids>`
- When to use: the user wants to analyze comments instead of (or in addition to) posts.

### 20. start\_task

Enqueue analysis jobs for a task's pending targets.

- Command: `analyze-cli task start --task-id <id>`
- When to use: the user wants to begin analysis after steps are added. Unlike `run_all_steps`, this enqueues jobs for pending targets without running strategy steps.

### 21. pause\_task / resume\_task / cancel\_task

Control task execution.

- Commands: `analyze-cli task pause|resume|cancel --task-id <id>`
- When to use: the user wants to pause, resume, or cancel a running task.

### 22. list\_tasks

List all tasks, optionally filtered by status.

- Command: `analyze-cli task list [--status <status>]`
- When to use: the user wants to see existing tasks and their status.

### 23. list\_task\_steps

List all analysis steps for a task.

- Command: `analyze-cli task step list --task-id <id>`
- When to use: before running or resetting steps to verify their state.

### 24. start\_daemon / stop\_daemon

Manage the daemon process.

- Commands: `analyze-cli daemon start [--fg]` / `analyze-cli daemon stop`
- When to use: starting the daemon before a workflow, or stopping it after.

### 25. list\_strategies

List all imported strategies.

- Command: `analyze-cli strategy list`
- When to use: before `add_step_to_task`, to confirm available strategy IDs.

### 26. show\_strategy

Show details of a specific strategy.

- Command: `analyze-cli strategy show --id <id>`
- When to use: reviewing a strategy's parameters before importing or adding a step.

### 27. strategy\_result\_list / stats / export

Query strategy analysis results.

- Commands:
  - `analyze-cli strategy result list --task-id <id> --strategy <id> [--limit <n>]`
  - `analyze-cli strategy result stats --task-id <id> --strategy <id>`
  - `analyze-cli strategy result export --task-id <id> --strategy <id> [--format csv|json] [--output <path>]`
- When to use: after analysis completes, to inspect or export per-post/per-comment results.

### 28. retry\_failed\_queue\_jobs

Retry all failed queue jobs (optionally limited to a specific task).

- Command: `analyze-cli queue retry [--task-id {task_id}]`
- When to use: after analysis jobs failed and the user wants to re-run only the failed ones.

### 29. reset\_queue\_jobs

Reset all non-pending queue jobs to pending (optionally limited to a specific task).

- Command: `analyze-cli queue reset [--task-id {task_id}]`
- When to use: you need to forcefully restart a batch of jobs that are stuck in `processing`, `failed`, or `completed`.
- **Warning**: this is a blunt instrument; prefer `queue retry` for normal recovery.

### 30. create\_strategy

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

**Supported prompt variables (whitelist):**

- `{{content}}` — post content (required)
- `{{title}}` — post title
- `{{author_name}}` — author name
- `{{platform}}` — platform name
- `{{published_at}}` — publish time
- `{{tags}}` — tags JSON string
- `{{media_urls}}` — media file paths (required when `needs_media.enabled=true`)

> Do NOT use other variables such as `{{likes}}`, `{{collects}}`, `{{comments}}`, `{{shares}}`, etc. They are not substituted at runtime.

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
- Analysis jobs fail with 429 / rate limit → the worker automatically requeues them with exponential backoff (up to `max_attempts`). You do not need to manually retry unless all attempts are exhausted.
- Step or queue jobs permanently fail → use `task step reset`, `queue retry`, or `queue reset` to recover. **Never run ad-hoc** **`node -e`** **scripts or any other direct database access to modify queue or task state.**

## Workflow Guidance

1. If the user asks to "analyze" platform content, start with `opencli xiaohongshu search` -> `analyze-cli platform list` -> `analyze-cli platform add` (if not found) -> `analyze-cli task create` -> `analyze-cli post import` (with `--task-id`).
   - **Always check if the platform exists first** using `analyze-cli platform list`. If the platform is already registered, skip `platform add`. This avoids "already exists" errors mid-workflow.
   - **Important workflow rule**: `opencli xiaohongshu search` returns summary data (title, likes, URL). **Do NOT manually fetch full post details with** **`opencli xiaohongshu note`** **before** **`post import`, and do NOT write scripts to do so.** Instead, ensure `task create` includes a `fetch_note` template; the daemon will automatically enrich posts during `analyze-cli task prepare-data`. This is the only supported way to get `{{content}}` populated for analysis.
2. Then `analyze-cli task step add` for each strategy they need.
3. Run `analyze-cli task prepare-data` to fetch comments and media via the opencli templates defined in `task create`.
4. Run `analyze-cli task run-all-steps` to start the analysis pipeline.
5. Poll `analyze-cli task status` periodically and report progress:
   - phase = `dataPreparation`: report `commentsFetched / totalPosts` and `mediaFetched / totalPosts`.
   - phase = `analysis`: for each running step, report `done / total` from its `stats`.
   - status = `completed`: proceed to `analyze-cli task results`.
6. If a step or data-preparation fails, report the error and ask if the user wants to retry.
   - If the failure is due to API rate limits (429), the worker retries automatically with exponential backoff. You only need to intervene if the step status eventually becomes `failed` after all retries are exhausted.
   - To recover a failed step safely, use `analyze-cli task step reset --task-id <id> --step-id <id>` followed by `analyze-cli task step run` or `analyze-cli task run-all-steps`.
   - **Never use direct database access** (e.g., `node -e` scripts opening DuckDB) to fix queue or task state. Always use the CLI commands listed above.

