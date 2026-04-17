# ARCHITECTURE.md

## 概览

`analyze-cli` 是一个以 CLI 为入口、以 DuckDB 为中心状态存储、以 daemon 和 worker 负责异步分析执行的纯 CLI 项目。Agent 通过 `SKILL.md` 定义的原子化工具调用完成从数据搜索、导入、下载评论/媒体、到多步骤策略分析的全流程。

核心链路：

```text
Agent / CLI
  -> CLI commands
  -> db layer (DuckDB)
  -> daemon IPC server
  -> worker consumer loop
  -> Anthropic API
  -> analysis_results (动态 strategy 结果表)
  -> CLI query / export
```

## 主要模块

### `src/cli`

负责用户可见命令入口：

- `platform` — 平台注册与字段映射管理
- `post` — 帖子导入、列表、搜索
- `comment` — 评论导入与列表
- `task` — 任务创建、步骤管理、状态查询、结果导出
- `task-prepare` — 任务数据准备（`prepare-data`）
- `template` — 分析模板管理（legacy）
- `result` — 分析结果查询（legacy comment/media）
- `analyze` — 直接对任务运行单次策略分析
- `strategy` — 策略（套路）的导入、列表、展示、删除
- `queue` — 队列任务重试与重置
- `daemon` — daemon 生命周期管理

### `src/db`

负责：

- `schema.sql` 定义
- `migrate.ts` 迁移
- `seed.ts` 种子数据
- 按表/按领域划分的 CRUD 仓库

DuckDB 是单一事实来源，承载原始数据、任务状态、队列状态和分析结果。

### `src/daemon`

负责：

- IPC server（`ipc-server.ts`）
- daemon 生命周期（`index.ts`）
- handler 路由（`handlers.ts`）
- 任务状态聚合、数据准备异步执行、步骤调度

### `src/worker`

负责：

- `consumer.ts` — 带并发控制的轮询消费循环
- `anthropic.ts` — 调用 Anthropic API（comment / media / strategy）
- `parser.ts` — 解析 LLM 输出为结构化结果
- `index.ts` — worker 进程入口

### `src/data-fetcher`

负责：

- `opencli.ts` — 通过 OpenCLI 执行外部命令模板（`fetch_note`、`fetch_comments`、`fetch_media`），并解析 JSON 输出

### `src/config`

负责：

- `index.ts` — 运行时配置（数据库路径、下载目录、worker 并发数、重试延迟等）
- `claude-config.ts` — Claude Code 相关配置路径

## 当前实现重点

- **策略化帖子分析（post-level strategy）** 是当前主实现路径：通过 `strategies` 表定义动态策略，`task_steps` 支持多步骤顺序执行，`worker` 中的 `processStrategyJob` 已完整实现。
- **数据准备（`prepare-data`）** 作为任务的前置阶段，通过 `cli_templates` 调用 OpenCLI 自动拉取帖子详情、评论和媒体，进度写入 `task_post_status`。
- **评论分析** 和 **媒体分析** 仍保留 legacy 路径（基于 `prompt_templates` 和 `task_targets`），由 `task.start` 触发的队列任务消费。
- **Agent 工作流** 通过 `SKILL.md` 暴露原子 CLI 命令，Agent 负责轮询 `task status` 获取两阶段进度（`dataPreparation` → `analysis`）。

## 数据模型

关键表：

- `platforms`
- `field_mappings`
- `posts`
- `comments`
- `media_files`
- `prompt_templates`（legacy）
- `tasks`
- `task_targets`（legacy）
- `task_post_status` — 记录每个任务-帖子的数据准备状态（评论/媒体是否已下载）
- `task_steps` — 任务的分析步骤，绑定 `strategy`
- `strategies` — 动态策略定义（prompt、output_schema、needs_media 等）
- `queue_jobs` — 分析任务队列
- `analysis_results_comments`（legacy）
- `analysis_results_media`（legacy）
- `strategy_result_{strategy_id}` — 动态创建的 per-strategy 结果表

详见：

- `src/db/schema.sql`
- `docs/generated/db-schema.md`

## 任务生命周期（两阶段模型）

```text
1. 数据准备阶段（dataPreparation）
   - Agent 调用 analyze-cli task prepare-data --task-id <id>
   - Daemon 异步遍历 task 下所有 post，执行 cli_templates 中的 fetch_note → fetch_comments → fetch_media
   - 进度写入 task_post_status

2. 分析执行阶段（analysis）
   - Agent 调用 analyze-cli task step add 追加 strategy 步骤
   - 调用 analyze-cli task run-all-steps 顺序执行 pending/failed 步骤
   - 每个步骤生成 queue_jobs，由 worker consumer 消费并写入对应的 strategy_result_ 表
```

## 文档导航

- 设计文档索引：`docs/design-docs/index.md`
- 计划文档索引：`docs/PLANS.md`
- 产品文档索引：`docs/product-specs/index.md`
- Agent 入口：`AGENTS.md`
