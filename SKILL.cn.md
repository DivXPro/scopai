---
name: analyze-cli
description: 社交媒体数据分析 CLI — 搜索、导入、下载评论/媒体，并运行多步骤策略分析。
type: tool-use
---

# analyze-cli 技能

你是一个操作 `analyze-cli` 命令行工具的代理，用于社交媒体内容分析。

## 执行前检查

按顺序执行：

1. **验证 CLI 可执行**: `analyze-cli --version`
2. **确保守护进程运行**: `analyze-cli daemon status` → 如未运行则 `analyze-cli daemon start`
3. **使用 opencli 前先阅读 opencli 技能**
4. **验证 opencli**: `opencli --help` 或 `opencli doctor`

> 如果守护进程启动时健康检查失败并退出，**不要**删除数据库文件。确保没有其他进程持有数据库锁，然后重新启动守护进程。

---

## 按阶段分类的能力

### 阶段 1：数据收集

| # | 工具 | 命令 | 使用场景 |
|---|------|------|----------|
| 1 | **search_posts** | `opencli <site> <command> {query} --limit {limit} -f json` | 导入前发现帖子。**各平台命令不同** — (1) 用 `opencli list | grep <keyword>` 找平台，(2) 用 `opencli <platform> --help` 查看可用命令，(3) 用 `opencli <platform> <command> -h` 了解具体用法。|
| 2 | **add_platform** | `analyze-cli platform add --id {id} --name {name}` | 如果 `analyze-cli platform list` 中没有该平台，则注册。 |
| 3 | **import_posts** | `analyze-cli post import --platform {id} --file {path} [--task-id {tid}]` | 导入搜索结果。**不要**在导入前手动获取笔记详情 — 让 `prepare-data` 通过 `fetch_note` 模板来丰富帖子内容。重复帖子会更新而非跳过。 |
| 4 | **import_comments** | `analyze-cli comment import --platform {id} --post-id {id} --file {path}` | 获取评论后从 JSON/JSONL 导入。重复评论会被跳过。 |

### 阶段 2：任务设置

| # | 工具 | 命令 | 使用场景 |
|---|------|------|----------|
| 5 | **create_task** | `analyze-cli task create --name {name} [--cli-templates '{...}']` | 添加步骤前创建任务。**必填模板**: `fetch_note`（丰富帖子内容）。可选：`fetch_comments`、`fetch_media`。 |
| 6 | **add_step_to_task** | `analyze-cli task step add --task-id {tid} --strategy-id {sid} [--name {n}] [--order {n}]` | 添加用户需要的每个策略。 |
| 7 | **list_strategies** | `analyze-cli strategy list` | 添加步骤前确认可用的策略 ID。 |

### 阶段 3：数据准备

| # | 工具 | 命令 | 使用场景 |
|---|------|------|----------|
| 8 | **prepare_task_data** | `analyze-cli task prepare-data --task-id {tid}` | 获取帖子详情、评论和媒体。**可恢复** — 中断后重新运行会从上次未完成处继续。如果 `cli_templates` 缺少 `fetch_note` 会报错终止。 |

### 阶段 4：分析执行

| # | 工具 | 命令 | 使用场景 |
|---|------|------|----------|
| 9 | **run_all_steps** | `analyze-cli task run-all-steps --task-id {tid}` | **默认 `--wait`**：阻塞直到所有步骤完成，期间打印进度。使用 `--no-wait` 可入队后立即返回。 |
| 10 | **run_task_step** | `analyze-cli task step run --task-id {tid} --step-id {sid}` | 运行单个步骤。**默认 `--wait`**：阻塞直到完成。 |
| 11 | **start_task** | `analyze-cli task start --task-id {tid}` | 为待处理目标入队作业，**不**运行策略步骤。 |
| 12 | **reset_task_step** | `analyze-cli task step reset --task-id {tid} --step-id {sid}` | 将失败步骤重置为待处理以便重试。 |

> **进度输出**（`--wait` 模式）：
> ```
> [10:23:45] Step: sentiment-analysis | running | 15/30 done, 1 failed
> [10:24:45] Steps progress: 2/2 completed
> ```

### 阶段 5：结果与管理

| # | 工具 | 命令 | 使用场景 |
|---|------|------|----------|
| 13 | **get_task_results** | `analyze-cli task results --task-id {tid}` | 所有步骤完成后查看结果。 |
| 14 | **get_task_status** | `analyze-cli task show --task-id {tid}` | 显示完整任务详情，包括阶段、步骤、作业和最近的失败。**使用 `--wait` 模式时不需要。** |
| 15 | **list_tasks** | `analyze-cli task list [--status {s}] [--query {text}]` | 查看现有任务。可按状态过滤或按名称搜索。 |
| 16 | **list_task_steps** | `analyze-cli task step list --task-id {tid}` | 运行前检查步骤状态。 |
| 17 | **strategy_result_list** | `analyze-cli strategy result list --task-id {tid} --strategy {sid}` | 查看每个帖子的分析结果。 |
| 18 | **strategy_result_export** | `analyze-cli strategy result export --task-id {tid} --strategy {sid} [--format csv|json]` | 导出结果到文件。 |

### 工具与恢复

| # | 工具 | 命令 | 使用场景 |
|---|------|------|----------|
| 19 | **retry_failed_queue_jobs** | `analyze-cli queue retry [--task-id {tid}]` | 只重试失败的作业。 |
| 20 | **reset_queue_jobs** | `analyze-cli queue reset [--task-id {tid}]` | **粗旷工具**：强制重置所有非待处理作业。优先使用 `queue retry`。 |
| 21 | **pause_task / resume_task / cancel_task** | `analyze-cli task pause|resume|cancel --task-id {tid}` | 控制正在运行的任务。 |
| 22 | **list_posts / search_posts_db** | `analyze-cli post list [--platform {id}]` / `analyze-cli post search --platform {id} --query {text}` | 浏览已导入的数据。 |
| 23 | **daemon management** | `analyze-cli daemon start [--fg]` / `stop` / `restart` / `status` | 管理守护进程生命周期。版本不匹配时 CLI 会自动重启守护进程。 |

### 高级：创建策略

| # | 工具 | 描述 |
|---|------|------|
| 24 | **create_strategy** | 通过对话生成新的分析策略。详见下方 JSON 规则。 |

---

## 执行模式

`task prepare-data` 和 `task run-all-steps` / `task step run` 都支持两种执行模式。根据用户是否想要等待完成来选择：

| 模式 | 标志 | 行为 | 使用场景 |
|------|------|------|----------|
| **阻塞（默认）** | `--wait` | 命令阻塞直到完成，期间打印实时进度。Agent 看到输出后可以立即报告结果。 | **推荐用于交互式工作流。** 用户想要实时反馈。 |
| **非阻塞** | `--no-wait` | 命令入队后立即返回。Agent 稍后需要手动检查状态。 | 用户想要"触发后不管"，或同时运行多个任务。 |

> `prepare-data` 始终是阻塞的（没有 `--no-wait` 标志）。`run-all-steps` 和 `step run` 默认 `--wait`。

---

## 标准工作流

数据准备和分析在标准流程中**连续执行**，一气呵成：

```
search_posts(query) → add_platform(如为新平台) → create_task(含 fetch_note 模板)
  → import_posts(带 --task-id) → add_step_to_task(每个策略)
  → prepare_task_data(阻塞到完成)
  → run_all_steps --wait(阻塞到所有步骤完成，打印进度)
  → get_task_results
```

### 模板动态发现（B 方案）

OpenCLI 支持 100+ 平台且命令持续更新，**创建任务前必须动态查询命令格式**，不要依赖硬编码示例。

**步骤 1：查找站点名**
```bash
opencli list | grep -i <平台名>
# 例如：opencli list | grep -i xiaohongshu → xiaohongshu
```

**步骤 2：发现可用命令**
```bash
opencli <site> --help
# 例如：opencli xiaohongshu --help → search, note, comments, download, ...
```

**步骤 3：检查命令参数（关键！）**
```bash
opencli <site> <命令> --help
# 例如：opencli xiaohongshu note --help
# 输出："note-id  Full Xiaohongshu note URL with xsec_token"
#       → 模板必须用 {url} 变量
```

**步骤 4：根据参数签名构建模板**
- 如果 help 写 `"<note-id>"` 或 `"<post-id>"`（短 ID）→ 用 `{note_id}`
- 如果 help 写 `"Full URL"` 或 `"URL"` → 用 `{url}`（有歧义时永远优先）

### 模板变量

| 变量 | 值 | 使用场景 |
|------|-----|----------|
| `{post_id}` | 数据库内部帖子 ID | 外部命令极少需要 |
| `{note_id}` | `metadata.note_id` → `url` → `post_id`（回退链） | 命令接受短 ID 的平台 |
| `{url}` | 导入数据中的完整帖子 URL | **默认选择** — 大多数 OpenCLI 命令接受完整 URL |
| `{limit}` | 固定值 `100` | fetch_comments 分页限制 |
| `{download_dir}` | 配置的下载目录 | 媒体文件存储路径 |

> **经验法则**：不确定时永远用 `{url}`，它是跨平台最通用的格式。

### 示例：完整分析流程（动态发现）

```bash
# 1. 发现平台命令
opencli list | grep -i xiaohongshu        # → xiaohongshu
opencli xiaohongshu --help                # → search, note, comments, ...
opencli xiaohongshu note --help           # → 要求 "Full note URL"

# 2. 搜索
opencli xiaohongshu search "上海美食" --limit 10 -f json > posts.json

# 3. 设置
analyze-cli platform add --id xhs --name "小红书"
analyze-cli task create --name "上海美食分析" \
  --cli-templates '{"fetch_note":"opencli xiaohongshu note {url} -f json","fetch_comments":"opencli xiaohongshu comments {url} --limit 100 -f json"}'

# 4. 导入
analyze-cli post import --platform xhs --file posts.json --task-id <task_id>

# 5. 添加策略
analyze-cli task step add --task-id <task_id> --strategy-id sentiment-topics --name "情感分析"
analyze-cli task step add --task-id <task_id> --strategy-id risk-detection --name "风险检测"

# 6. 准备数据（阻塞，可恢复）
analyze-cli task prepare-data --task-id <task_id>

# 7. 运行分析（阻塞，带进度输出）
analyze-cli task run-all-steps --task-id <task_id>
# → [10:23:45] Steps progress: 0/2 completed | running: 情感分析
# → [10:24:12] Steps progress: 1/2 completed | running: 风险检测
# → [10:24:45] Steps progress: 2/2 completed

# 8. 查看结果
analyze-cli task results --task-id <task_id>
```

### 替代方案：非阻塞模式

如果用户想要启动分析后稍后再检查（例如同时运行多个任务）：

```bash
# 数据准备仍然是阻塞的
analyze-cli task prepare-data --task-id <task_id>

# 但分析在后台运行
analyze-cli task run-all-steps --task-id <task_id> --no-wait
# → "All steps processed"（立即返回）

# 稍后检查状态
analyze-cli task show --task-id <task_id>
```

### 从失败中恢复

```bash
# 如果步骤在所有重试后仍然失败：
analyze-cli task step reset --task-id <tid> --step-id <sid>
analyze-cli task step run --task-id <tid> --step-id <sid> --wait
```

---

## create_strategy 的 JSON 规则

**必填字段：**

- `id`：小写 `a-z0-9_-`，例如 `monetization-v1`
- `name`、`version`（默认 `"1.0.0"`）
- `target`：仅 `"post"`
- `needs_media`：如果启用，需包含 `{ enabled: true, media_types, max_media, mode }`
- `prompt`：必须包含 `{{content}}`；如果 `needs_media.enabled` 还需包含 `{{media_urls}}`
- `output_schema`：标准 JSON Schema，`type: "object"`，每个属性需有 `type`

**提示变量（仅白名单）：**

- `{{content}}`（必填）、`{{title}}`、`{{author_name}}`、`{{platform}}`、`{{published_at}}`、`{{tags}}`、`{{media_urls}}`

> **不要**使用 `{{likes}}`、`{{collects}}`、`{{comments}}` 等变量。它们在运行时不会被替换。

**提示质量：** 在提示末尾追加 JSON 输出格式要求，确保返回纯 JSON（无 markdown 代码块）。

**示例：**

```json
{
  "id": "monetization-v1",
  "name": "带货潜力分析",
  "version": "1.0.0",
  "target": "post",
  "needs_media": { "enabled": true, "media_types": ["image"], "max_media": 5, "mode": "all" },
  "prompt": "分析以下帖子的带货潜力。\n\n帖子内容：{{content}}\n作者：{{author_name}}\n\n{{media_urls}}\n\n请严格按以下 JSON 格式返回，只输出纯 JSON：{ \"score\": number, \"category\": string }",
  "output_schema": {
    "type": "object",
    "properties": {
      "score": { "type": "number" },
      "category": { "type": "string" }
    }
  }
}
```

**策略导入错误恢复：**

- 验证失败 → 读取确切错误，修复字段，重试（最多 2 次）
- 相同版本已存在 → 询问是增加版本号还是更改 ID
- 用户批准后：`analyze-cli strategy import --json '<json>'`，然后 `analyze-cli strategy show --id <id>`

---

## 全局规则

1. **永远不要编写临时轮询脚本**循环调用 `analyze-cli task show`。使用内置的 `--wait` 模式。
2. **永远不要使用直接数据库访问**（例如运行打开 DuckDB 的 `node -e` 脚本）。始终使用 CLI 命令。
3. **速率限制（429）恢复**：工作进程自动使用指数退避重新入队。只有当状态在所有重试后变为 `failed` 时才需要介入。
4. **先检查平台**：使用 `analyze-cli platform list` 确认平台是否已注册，避免 "already exists" 错误。
5. **不要在导入前手动获取笔记详情**：让 `prepare-data` 通过 `fetch_note` 模板处理数据丰富。
