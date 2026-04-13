# ARCHITECTURE.md

## 概览

`analyze-cli` 是一个以 CLI 为入口、以 DuckDB 为中心状态存储、以 daemon 和 worker 负责异步分析执行的纯 CLI 项目。

核心链路：

```text
CLI
  -> db layer
  -> tasks / queue_jobs
  -> daemon
  -> worker loop
  -> Anthropic
  -> analysis_results
  -> CLI query / export
```

## 主要模块

### `src/cli`

负责用户可见命令入口：

- `platform`
- `post`
- `comment`
- `task`
- `template`
- `result`
- `daemon`

### `src/db`

负责：

- schema 定义
- migrations
- seed
- 按表划分的 CRUD 仓库

DuckDB 是单一事实来源，承载原始数据、任务状态、队列状态和分析结果。

### `src/daemon`

负责：

- IPC server
- daemon 生命周期
- worker pool
- 与任务队列配合

### `src/worker`

负责：

- 轮询待处理 job
- 读取 task、template、comment、media 数据
- 调用 Anthropic
- 解析 LLM 输出
- 写回分析结果

## 当前实现重点

- 评论分析是当前主实现路径
- 媒体分析有代码路径，但需要按真实数据链路验证
- 帖子级分析还未作为完整 worker 目标实现

## 数据模型

关键表：

- `platforms`
- `field_mappings`
- `posts`
- `comments`
- `media_files`
- `prompt_templates`
- `tasks`
- `task_targets`
- `queue_jobs`
- `analysis_results_comments`
- `analysis_results_media`

详见：

- `src/db/schema.sql`
- `docs/generated/db-schema.md`

## 文档导航

- 设计文档索引：`docs/design-docs/index.md`
- 计划文档索引：`docs/PLANS.md`
- 产品文档索引：`docs/product-specs/index.md`
- agent 入口：`AGENTS.md`
