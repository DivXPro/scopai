# ARCHITECTURE.md

## 概览

`analyze-cli` 是一个以 CLI 为入口、以 DuckDB 为中心状态存储、以 daemon 和 worker 负责异步分析执行的社交媒体内容分析平台。项目采用 pnpm monorepo 架构，包含 CLI、API 服务、Web UI 和核心库四个包。

核心链路：

```text
CLI / Web UI
  -> API server (Fastify) / CLI commands
  -> core (DuckDB CRUD、配置、共享逻辑)
  -> daemon IPC server
  -> worker consumer loop
  -> Anthropic API
  -> analysis_results (动态 strategy 结果表)
  -> CLI query / Web UI / export
```

## Monorepo 包结构

| 包 | 路径 | 职责 |
|---|------|------|
| `@scopai/core` | `packages/core` | 数据库层、配置、共享逻辑 |
| `@scopai/api` | `packages/api` | Fastify HTTP API + in-process worker |
| `@scopai/ui` | `packages/ui` | React Web Dashboard |
| `@scopai/cli` | `packages/cli` | CLI 命令入口 |

包间依赖：

```text
cli -> core
api -> core
ui -> api（HTTP，非 workspace 依赖）
```

## 主要模块

### `packages/core` — 共享核心

#### `src/db`

负责：

- `schema.sql` 定义
- `migrate.ts` 迁移
- `seed.ts` 种子数据
- 按表/按领域划分的 CRUD 仓库（`posts.ts`、`tasks.ts`、`strategies.ts`、`queue-jobs.ts` 等）

DuckDB 是单一事实来源，承载原始数据、任务状态、队列状态和分析结果。

#### `src/config`

负责：

- `index.ts` — 运行时配置（数据库路径、下载目录、worker 并发数、重试延迟等），支持 `config.json` > Claude settings > 环境变量 > 默认值四级优先级
- `claude-config.ts` — Claude Code 相关配置路径

#### `src/data-fetcher`

负责：

- `opencli.ts` — 通过 OpenCLI 执行外部命令模板（`fetch_note`、`fetch_comments`、`fetch_media`），并解析 JSON 输出

#### `src/shared`

负责：

- `lock-file.ts` — API 进程锁文件（防重复启动）
- `shutdown.ts` — worker 优雅停机（active count 追踪、drain 等待）
- `daemon-status.ts` — daemon 状态管理
- `logger.ts` — 日志
- `types.ts` / `constants.ts` / `utils.ts` / `version.ts` — 类型、常量、工具函数

### `packages/api` — HTTP API 服务

#### `src/index.ts`

服务入口：Fastify 实例创建、锁文件检查、路由注册、worker 启动、优雅停机。

#### `src/routes`

按领域划分的路由模块：

- `platforms.ts` — 平台列表
- `posts.ts` — 帖子 CRUD、导入、评论、媒体
- `strategies.ts` — 策略 CRUD、导入
- `tasks.ts` — 任务生命周期、步骤管理、结果查询
- `queue.ts` — 队列统计、重试、重置
- `status.ts` — 服务状态

#### `src/worker`

- `consumer.ts` — 带并发控制的轮询消费循环
- `anthropic.ts` — 调用 Anthropic API（comment / media / strategy）
- `parser.ts` — 解析 LLM 输出为结构化结果

#### `src/auth.ts`

API 认证中间件。

#### `test/e2e`

API 路由 e2e 测试（46 tests），使用 child process 启动真实服务器，每个 suite 独立 DuckDB + 动态端口隔离。

### `packages/ui` — Web Dashboard

React 19 + Vite + TailwindCSS + shadcn/ui 单页应用。

页面：

- `Overview.tsx` — 总览仪表盘
- `TaskList.tsx` — 任务列表
- `TaskDetail.tsx` — 任务详情（含分析结果查看）
- `PostLibrary.tsx` — 帖子库（搜索 + 平台筛选）
- `Strategies.tsx` — 策略管理
- `QueueMonitor.tsx` — 队列监控

UI 通过 HTTP 调用 API 服务，API 在生产模式下通过 `@fastify/static` 托管 UI 构建产物。

### `packages/cli` — CLI 命令

基于 `commander` 的命令行入口，调用 `core` 完成所有操作。

命令组：

- `daemon` — daemon 生命周期管理
- `platform` — 平台注册与字段映射管理
- `post` — 帖子导入、列表、搜索
- `comment` — 评论导入与列表
- `task` — 任务创建、步骤管理、状态查询、结果导出
- `task-prepare` — 任务数据准备（`prepare-data`）
- `template` — 分析模板管理（legacy）
- `result` — 分析结果查询（legacy comment/media）
- `analyze` — 直接对任务运行单次策略分析
- `strategy` — 策略的导入、列表、展示、删除
- `queue` — 队列任务重试与重置

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

- `packages/core/src/db/schema.sql`
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

## 测试体系

| 类型 | 位置 | 运行命令 | 说明 |
|------|------|----------|------|
| 根级 e2e | `test/e2e/` | `pnpm test:e2e` | 全链路 e2e（daemon lifecycle、import-prepare、strategy-workflow、queue-recovery） |
| 根级 integration | `test/integration/` | `pnpm test:integration` | DB + worker 集成测试 |
| 根级 unit | `test/unit/` | `pnpm test` | 纯逻辑单元测试 |
| API e2e | `packages/api/test/e2e/` | `pnpm --filter @scopai/api test:e2e` | HTTP API 路由 e2e（46 tests，动态端口隔离） |

API e2e 测试架构：

- `helpers.ts` — 通过 `getFreePort()` 分配动态端口，`child_process.spawn` 启动真实 API 服务器，每个 suite 独立 DuckDB + `PORT` 环境变量
- `cleanup` — `SIGTERM` 优雅停机，5 秒超时后 `SIGKILL`，清理临时 DB 文件
- 测试文件按路由领域划分：`health`、`status`、`platforms`、`posts`、`strategies`、`tasks`、`queue`

## 当前实现重点

- **策略化帖子分析（post-level strategy）** 是当前主实现路径：通过 `strategies` 表定义动态策略，`task_steps` 支持多步骤顺序执行，`worker` 中的 `processStrategyJob` 已完整实现。
- **数据准备（`prepare-data`）** 作为任务的前置阶段，通过 `cli_templates` 调用 OpenCLI 自动拉取帖子详情、评论和媒体，进度写入 `task_post_status`。
- **评论分析** 和 **媒体分析** 仍保留 legacy 路径（基于 `prompt_templates` 和 `task_targets`），由 `task.start` 触发的队列任务消费。
- **Agent 工作流** 通过 `SKILL.md` 暴露原子 CLI 命令，Agent 负责轮询 `task status` 获取两阶段进度（`dataPreparation` → `analysis`）。

## 文档导航

- 设计文档索引：`docs/design-docs/index.md`
- 计划文档索引：`docs/PLANS.md`
- 产品文档索引：`docs/product-specs/index.md`
- Agent 入口：`AGENTS.md`
