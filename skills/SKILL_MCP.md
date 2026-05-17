---
name: scopai-mcp
description: scopai MCP server — access posts, tasks, strategies, creators and analysis results via Model Context Protocol.
type: tool-use
---

# scopai MCP Skill

You operate the `scopai` MCP server for social media content analysis. This server exposes scopai's core capabilities as MCP tools that can be called directly.

## Prerequisites

- scopai daemon must be running (`scopai daemon start`)
- scopai MCP server is registered in your MCP client (Claude Code / Claude Desktop)

## Available Tools

### Data Discovery

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `list_posts` | List imported posts with filters | `platform`, `author_id`, `starred`, `label`, `limit`, `offset`, `platform_post_id` |
| `search_posts` | Search posts by keyword in content | `platform` (required), `query` (required), `author_id`, `starred`, `label`, `limit`, `offset` |
| `get_post` | Get detailed post info with media files. Returns `media_files` array with absolute URLs. When NOT using MCP App HTML UI, render images as Markdown `![alt](url)` — all images for single post, cover image only for lists. | `id` (internal ID) or `platform_post_id` + `platform` |
| `get_post_reference` | Get structured creative reference card for a post | `post_id` |
| `list_creators` | List subscribed creators | `platform`, `status`, `name`, `limit`, `offset` |

### Task Management

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `list_tasks` | List analysis tasks | `status`, `query`, `limit`, `offset` |
| `get_task` | Get task status and progress | `id` (required) |
| `create_task` | Create a new analysis task | `name` (required), `description`, `cli_templates`, `router_strategy_id`, `candidate_strategy_ids` |
| `add_task_posts` | Add posts to a task | `task_id`, `post_ids` |
| `add_task_step` | Add a strategy step to a task | `task_id`, `strategy_id` |
| `run_task_prepare` | Fetch post details, comments, media | `task_id` |
| `run_task_analysis` | Run all pending analysis steps | `task_id` |
| `get_task_results` | Get analysis results | `task_id`, `strategy_id`, `limit`, `offset` |
| `get_task_routing` | Get dynamic routing decisions for a task (post → applicable strategies) | `task_id` |

### Strategy & Queue

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `list_strategies` | List all available analysis strategies | — |
| `list_queue_jobs` | View task queue jobs | `task_id`, `failed_only`, `limit`, `offset` |
| `retry_failed_jobs` | Retry failed jobs | `task_id` (optional) |

## Standard Workflow

```
search_posts(platform=xhs, query="上海美食") → get_post(id) for details
  → create_task(name="上海美食分析") → add_task_posts(task_id, post_ids)
  → add_task_step(task_id, strategy_id="sentiment-topics")
  → run_task_prepare(task_id) → run_task_analysis(task_id)
  → get_task_results(task_id)
```

### Dynamic Strategy Routing Workflow

Use `router_strategy_id` in `create_task` to enable per-post strategy filtering. The router step evaluates each post and decides which candidate strategies apply, skipping non-applicable ones.

```
search_posts(platform=xhs, query="护肤", limit=20)
  → create_task(
      name="护肤帖子智能分析",
      router_strategy_id="content-strategy-router",
      candidate_strategy_ids=["creative-copy-deconstruct", "creative-image-style"]
    )
  → add_task_posts(task_id, post_ids)
  → run_task_prepare(task_id)          # fetches post details
  → run_task_analysis(task_id)         # router runs first, then applicable strategies
  → get_task_routing(task_id)          # inspect per-post routing decisions
  → get_task_results(task_id)          # get final analysis results
```

**Key differences from standard workflow:**
- `create_task` includes `router_strategy_id` (typically `"content-strategy-router"`) and optional `candidate_strategy_ids`
- Router step runs automatically during `run_task_analysis`, before candidate strategies
- Only applicable strategies receive analysis jobs per post
- `get_task_routing` returns the decision matrix (post → applicable strategies + skipped reasons)
- Posts without applicable strategies are silently skipped for that strategy

### "查看帖子详情（带图片展示）"

```
1. get_post(id="xxx") 或 get_post(platform_post_id="xxx", platform="xhs")
2. （Agent client 自动渲染帖子展示 UI，含图片轮播）
```

**Media rendering rules:**
- **MCP App HTML UI** (`visibility: app`): The `post-viewer` App resource renders media natively — do NOT output Markdown images, the HTML handles it.
- **Text / model mode** (`visibility: model`): Render images as Markdown `![alt](url)`. For a single post, show all images. For lists, show cover image only. Video posts show cover thumbnail only.

## Key Rules

1. **search_posts only searches `content` field** — it does NOT search title or author. Use `get_post` to inspect specific posts.
2. **Platform IDs** — use short codes like `xhs` (xiaohongshu), `douyin`, `twitter`, etc. Run `list_posts` without filters to see what's available.
3. **Task lifecycle** — `create_task` → `add_task_posts` → `add_task_step` → `run_task_prepare` → `run_task_analysis` → `get_task_results`. Each step must be completed before the next.
4. **run_task_prepare blocks** — it fetches details/comments/media and waits for completion.
5. **run_task_analysis blocks** — it runs all steps in order and waits for completion.
6. **Daemon dependency** — all tools require `scopai daemon` to be running. If MCP server fails to start, check daemon status first.
7. **Media rendering** — When presenting post data in text mode (not MCP App HTML UI), render images as Markdown `![alt](url)`. Single post: all images. List/video: cover image only. Video posts: cover thumbnail only. MCP App HTML UI (`post-viewer`) handles media natively — skip Markdown images in that mode.

### "查看指定笔记的详情"

```
1. get_post(platform_post_id="5xXyZ123", platform="xhs")
2. (Review post content, images, stats)
```

## Example Conversation Flows

### "分析小红书上关于护肤的帖子"

```
1. search_posts(platform="xhs", query="护肤", limit=20)
2. (Review results, note interesting post IDs)
3. create_task(name="护肤帖子分析")
4. add_task_posts(task_id=<id>, post_ids=["post1", "post2", ...])
5. list_strategies() → pick a suitable strategy ID
6. add_task_step(task_id=<id>, strategy_id=<sid>, name="护肤分析")
7. run_task_prepare(task_id=<id>)
8. run_task_analysis(task_id=<id>)
9. get_task_results(task_id=<id>)
```

### "查看最近失败的任务"

```
1. list_tasks(status="failed")
2. get_task(id=<task_id>) for details
3. list_queue_jobs(task_id=<id>, failed_only=true)
4. retry_failed_jobs(task_id=<id>) if needed
```

## MCP vs CLI

| Operation | MCP Tool | Equivalent CLI |
|-----------|----------|----------------|
| Search posts | `search_posts` | `scopai post search --platform x --query q` |
| Create task | `create_task` | `scopai task create --name n` |
| Run analysis | `run_task_analysis` | `scopai task run-all-steps <id>` |
| Get results | `get_task_results` | `scopai task results <id>` |

Use MCP tools when you want direct structured access without spawning shell commands.
