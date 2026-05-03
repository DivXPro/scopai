# AGENTS.md

## 说明

本文件是 `scopai` 项目的 **开发方 agent** 工作入口。所有 agent 均围绕项目代码开发、架构维护和功能迭代设计，通过 `superpowers` 技能进行编排执行。

## 项目概览

`scopai` 是一个基于 TypeScript 和 Node.js 的社交媒体内容分析平台，采用 pnpm monorepo 架构。

当前主链路：

```text
CLI command / Web UI
  -> API server (Fastify)
  -> DuckDB data / task records (core)
  -> daemon + worker pool
  -> Anthropic analysis
  -> result query / export
```

## 技术栈

- 语言：TypeScript
- 运行时：Node.js 20+
- 包管理：pnpm（monorepo workspace）
- CLI：`commander`
- API：`fastify`
- UI：React 19 + Vite + TailwindCSS + shadcn/ui
- 存储：`duckdb`
- 调度：`bree`
- 模型调用：`@anthropic-ai/sdk`
- 输出：终端结果 + JSON/CSV 导出 + Web Dashboard

## Monorepo 包结构

| 包 | 路径 | 说明 |
|---|------|------|
| `@scopai/core` | `packages/core` | 数据库、配置、共享逻辑（DB CRUD、migration、seed、shutdown、lock-file 等） |
| `@scopai/api` | `packages/api` | Fastify HTTP API 服务 + in-process worker consumer |
| `@scopai/ui` | `packages/ui` | React Web Dashboard（Vite + TailwindCSS + shadcn/ui） |
| `@scopai/cli` | `packages/cli` | CLI 命令入口（commander） |

包间依赖关系：

```text
cli -> core
api -> core
ui -> api（通过 HTTP，非 workspace 依赖）
```

## 关键入口

- CLI 入口：`packages/cli/src/index.ts`
- 可执行入口：`bin/scopai.js`
- API 入口：`packages/api/src/index.ts`
- API 路由注册：`packages/api/src/routes/index.ts`
- worker consumer：`packages/api/src/worker/consumer.ts`
- 配置入口：`packages/core/src/config/index.ts`
- DB 入口：`packages/core/src/db/client.ts`
- UI 入口：`packages/ui/src/main.tsx`

## 当前 CLI 命令组

- `daemon`
- `platform`
- `post`
- `comment`
- `task`
- `result`
- `strategy`
- `queue`
- `analyze`
- `creator`

## API 路由

- `GET /health` — 健康检查
- `GET /api/status` — 服务状态（含 queue_stats）
- `GET /api/platforms` — 平台列表
- `GET/POST /api/posts`、`POST /api/posts/import` — 帖子 CRUD 与导入
- `GET /api/posts/:id/comments`、`GET /api/posts/:id/media` — 评论与媒体
- `GET/POST/DELETE /api/strategies`、`POST /api/strategies/import` — 策略 CRUD 与导入
- `GET/POST /api/tasks`、`POST /api/tasks/:id/start|pause|cancel|resume` — 任务生命周期
- `POST /api/tasks/:id/prepare-data|add-posts` — 任务数据操作
- `POST /api/tasks/:id/steps`、`POST /api/tasks/:id/steps/:stepId/run`、`POST /api/tasks/:id/run-all-steps` — 步骤管理
- `GET /api/tasks/:id/results` — 分析结果查询
- `GET /api/queue`、`POST /api/queue/retry|reset` — 队列管理
- `POST /api/creators`、`GET /api/creators`、`GET /api/creators/:id`、`DELETE /api/creators/:id` — 博主订阅 CRUD
- `POST /api/creators/:id/sync`、`GET /api/creators/:id/sync-logs` — 博主同步触发与日志
- `POST /api/creators/:id/pause|resume` — 博主暂停/恢复
- `GET /api/creators/:id/posts` — 博主帖子列表
- `GET/POST /api/creators/:id/sync-schedule` — 博主同步调度配置
- `GET/POST /api/platforms/:id/creator-mappings` — 平台字段映射

## 测试体系

| 类型 | 位置 | 运行命令 | 说明 |
|------|------|----------|------|
| 根级 e2e | `test/e2e/` | `pnpm test:e2e` | 全链路 e2e（daemon lifecycle、import-prepare、strategy-workflow、queue-recovery） |
| 根级 integration | `test/integration/` | `pnpm test:integration` | DB + worker 集成测试 |
| 根级 unit | `test/unit/` | `pnpm test` | 纯逻辑单元测试 |
| API e2e | `packages/api/test/e2e/` | `pnpm --filter @scopai/api test:e2e` | HTTP API 路由 e2e（46 tests，动态端口隔离） |

API e2e 测试使用 child process 启动真实服务器，每个 suite 独立 DuckDB + 动态端口，通过 `PORT` 环境变量避免端口冲突。

## 当前实现边界

- `worker` 仅支持 Strategy 分析路径（`processStrategyJob`），Legacy comment/media 分析路径已废弃
- `post` 目标在 `worker` 中当前会报 `Unsupported target_type`
- `creator` 博主订阅与同步管道已实现（独立 sync pipeline，通过 opencli 抓取，支持字段映射归一化）
- 规划文档里部分理想化 Bree 编排能力尚未完全成为当前实现
- 高价值文档更新前，应先核对真实代码，不要只沿用规划稿

## 推荐开发工作流

### 初始化

- 安装依赖：`pnpm install`
- 构建：`pnpm build`
- API e2e 测试：`pnpm --filter @scopai/api test:e2e`

### 开发 Agent 编排

1. **需求澄清**：`orchestrator` 判断需求类型和涉及模块
2. **架构设计**：`project-architect` 产出设计文档（如需）
3. **计划编写**：`orchestrator` 或 `project-architect` 产出 `docs/superpowers/plans/`
4. **任务实现**：派发 `feature-developer`、`cli-developer`、`db-developer` 或 `integration-developer`
5. **测试验证**：`test-engineer` 补充测试并执行
6. **代码审查**：`code-reviewer` 检查架构一致性、代码质量、逻辑正确性、安全性、可测试性
7. **合并收尾**：`superpowers:finishing-a-development-branch`

## 文档管理

- 文档规范入口：`docs/index.md`（含 Skill/Agent 生成文档存放规则）
- 所有 skill、agent 自动生成的新文档必须按规范存放到 `docs/` 对应子目录

### 核心文档结构

- 架构说明：`ARCHITECTURE.md`
- agent 主入口：`AGENTS.md`（本文件）
- 技能入口：`SKILL.md`
- 详细文档目录：`docs/`
- 项目 agent 编排包：`agents/`

### 推荐阅读顺序

1. `SKILL.md`
2. `AGENTS.md`
3. `ARCHITECTURE.md`
4. `docs/DESIGN.md`
5. `docs/PLANS.md`
6. `docs/product-specs/index.md`
7. `docs/design-docs/index.md`
8. `docs/generated/db-schema.md`

## 项目 Agent 入口文件

项目根目录 `agents/` 是仓库的开发协作文档入口。

### 开发方 Agent（面向 CLI 开发者）

主入口：

- `agents/README.md` — harness 总览与编排流程

角色入口：

- `agents/orchestrator.md` — 开发需求总控、阶段编排
- `agents/project-architect.md` — 架构设计、模块边界
- `agents/feature-developer.md` — 跨模块功能实现
- `agents/cli-developer.md` — CLI 命令开发、交互设计
- `agents/db-developer.md` — 数据库 schema、migration、数据流
- `agents/integration-developer.md` — opencli 集成、外部 API 对接
- `agents/test-engineer.md` — 测试策略、测试实现、测试执行
- `agents/code-reviewer.md` — 代码审查、架构一致性、安全与质量检查

## Agent 职责

### orchestrstrator

- 需求澄清与分类
- 阶段编排与 agent 派发
- 串并行决策
- 验收下游交接物

### project-architect

- 架构设计与技术选型
- 模块边界划分
- 产出设计文档和实现计划

### feature-developer

- 端到端功能实现
- 跨模块协调
- 按 plan 逐步推进并提交

### cli-developer

- CLI 命令设计与实现
- 参数约定和输出格式
- 命令注册和错误处理

### db-developer

- DuckDB schema 设计
- migration 管理
- CRUD 模块实现

### integration-developer

- 外部工具集成
- 数据获取管道
- 测试数据管理

### test-engineer

- 测试策略制定
- 测试用例编写
- 测试执行与回归验证

### code-reviewer

- 架构一致性审查
- 代码质量与冗余检查
- 逻辑正确性验证
- 安全隐患排查（SQL 注入、命令注入、路径遍历等）
- 可测试性评估

## 给 Claude 的工作约束

- 优先读取真实代码，再修改高价值文档
- 不要把设计文档当成实现事实
- 做 agent 编排时优先复用 `agents/` 下现有角色
- 新功能必须伴随测试
- 如果需求含糊，先给用户方案选择，再继续执行
- 涉及安装依赖、执行脚本或补充命令示例时，默认优先使用 `pnpm`
