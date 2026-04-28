# UI + Monorepo 架构设计

**日期：** 2026-04-21
**状态：** 设计完成，待实施

## 背景与目标

`scopai` 是一个以 CLI 为入口、以 DuckDB 为中心状态存储、以 daemon 和 worker 负责异步分析执行的纯 CLI 项目。

**新需求：**
1. 提供 Web UI 让用户查看采集的数据
2. 架构调整为 monorepo 结构
3. UI 未来可集成到 AI Agent 客户端（Electron/Tauri）中

**使用场景：**
- 开发者本地独立运行（场景 A）
- 小团队局域网共享（场景 B）
- 嵌入 AI Agent 桌面客户端（场景 C）

## 技术选型

| 层级 | 技术 | 选型理由 |
|------|------|----------|
| API 框架 | **Fastify** | 高性能、内置 JSON schema 验证、路由级类型推断、插件生态成熟、轻量适合嵌入 |
| 数据库查询层 | **Kysely + kysely-duckdb** | 类型安全查询构建器、渐进式迁移、DuckDB 社区驱动支持 |
| 前端框架 | **React + Vite** | 组件化成熟、集成到 Electron WebView 方便 |
| 样式方案 | **shadcn/ui + Tailwind CSS** | 基于 Radix UI 的无头组件，可完全自定义样式，与 Tailwind 深度集成，不锁定设计系统 |
| 共享类型/验证 | **Zod** | schema 可同时用于 API 校验和前端表单验证 |
| 包管理器 | **pnpm** | 已有 pnpm-lock.yaml，workspace 支持成熟 |

**为什么不选 Hono：**
- Hono 的多运行时优势（Edge/Bun/Workers）在桌面嵌入场景不显著
- Fastify 的插件生态（`cors`、`static`、`websocket`）开箱即用，更适合局域网共享场景
- Fastify 在 Node.js 生态更成熟，团队踩坑概率低

## Monorepo 结构

```
scopai/
├── packages/
│   ├── core/              ← 共享核心
│   │   ├── src/
│   │   │   ├── db/        ← DuckDB 客户端、schema、迁移、CRUD 仓库
│   │   │   ├── config/    ← 运行时配置
│   │   │   ├── types/     ← 共享 TypeScript 类型
│   │   │   └── utils/     ← 共享工具函数
│   │   └── package.json
│   │
│   ├── cli/               ← CLI 入口（瘦身后，业务逻辑在 core）
│   │   ├── src/
│   │   │   ├── commands/
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── api/               ← HTTP API 服务（核心服务）
│   │   ├── src/
│   │   │   ├── routes/    ← REST API 路由（从 daemon handlers.ts 迁移）
│   │   │   ├── daemon/   ← 任务调度器（原 daemon 的 stream-scheduler 逻辑）
│   │   │   ├── worker/   ← Worker 子进程管理
│   │   │   ├── middleware/
│   │   │   └── index.ts  ← 启动 HTTP server + 调度器（单进程）
│   │   └── package.json
│   │
│   └── ui/                ← Web Dashboard
│       ├── src/
│       │   ├── pages/
│       │   ├── components/
│       │   └── api/
│       └── package.json
│
├── pnpm-workspace.yaml
└── package.json           ← 根 workspace 配置
```

### 设计原则

- `core` 是唯一直接操作 DuckDB 的层（避免并发写冲突）
- `api` 是 `core` 的 HTTP 包装，同时承担任务调度职责（不单独拆 daemon）
- `cli` 通过两种方式访问：直接调用 core（同步查询）和 HTTP 调用 api（异步操作）
- `ui` 仅通过 HTTP 与 `api` 通信，不直接触碰数据库

### 工作原理

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Browser   │────▶│  API 服务   │────▶│    core     │
│  (Dashboard)│◀────│  (Fastify)  │◀────│  (DuckDB)   │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                        ┌──────▼──────┐
                                        │  Worker 子进程 │
                                        │ (Anthropic API) │
                                        └─────────────┘
```

1. API 服务启动 HTTP server + 任务调度器（**daemon 和 api 是同一进程**）
2. API 内部直接调用 core，单进程共享 DuckDB 连接（无并发写冲突）
3. Worker 作为子进程被 API 管理，完成异步分析
4. CLI 本地操作走 core（同步查询）或 api（异步任务）

### Daemon + API 合并说明

原 `src/daemon/` 中的进程与 `packages/api` 是**同一个 Node.js 进程**，不是两个独立进程。

**合并原因：**
- DuckDB 不支持多进程并发写，必须由单一进程持有写句柄
- 合并后部署简单：只需启动一个服务（不是 daemon + api 两个）
- HTTP 请求和任务调度在同一进程内，数据一致性有保障

**迁移映射：**

| 原 daemon 模块 | 新 api 中的位置 | 说明 |
|----------------|----------------|------|
| `src/daemon/index.ts` | `packages/api/src/index.ts` | 进程生命周期管理 |
| `src/daemon/ipc-server.ts` | `packages/api/src/routes/` | IPC → Fastify HTTP routes |
| `src/daemon/handlers.ts` | `packages/api/src/routes/*.ts` | IPC handlers → HTTP handlers |
| `src/daemon/stream-scheduler.ts` | `packages/api/src/daemon/scheduler.ts` | 流式调度逻辑迁移 |
| `src/worker/` | `packages/api/src/worker/` | Worker 子进程管理 |
| `src/cli/ipc-client.ts` | `packages/cli/src/api-client.ts` | IPC client → HTTP client |

**CLI 交互方式：**
```
scopai task list                    → 直接调 core（同步，无 HTTP）
scopai task prepare-data --task-id X → HTTP 调 api（异步，spawn worker）
```

## API 设计

### 核心接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tasks` | 任务列表（分页、搜索、状态筛选） |
| GET | `/api/tasks/:id` | 任务详情（步骤进度、数据准备状态） |
| POST | `/api/tasks` | 创建任务 |
| POST | `/api/tasks/:id/prepare` | 触发数据准备 |
| POST | `/api/tasks/:id/run` | 执行分析步骤 |
| GET | `/api/tasks/:id/results` | 获取分析结果 |
| GET | `/api/platforms` | 平台列表 |
| GET | `/api/posts` | 帖子列表（搜索、分页） |
| GET | `/api/posts/:id/comments` | 帖子评论 |
| GET | `/api/posts/:id/media` | 帖子媒体 |
| GET | `/api/strategies` | 策略列表 |
| GET | `/api/strategies/:id` | 策略详情 |
| GET | `/api/queue` | 队列任务状态 |
| POST | `/api/queue/:id/retry` | 重试队列任务 |
| GET | `/api/daemon/status` | 服务健康状态 |
| GET | `/api/export/:taskId` | 导出结果（CSV/JSON） |

### 认证方案

- 启动时生成随机 token，打印在控制台
- 前端存储在 `localStorage`，自动携带 `Authorization: Bearer <token>`
- 适合小团队局域网场景，未来可升级为 JWT + 用户表

### 错误响应格式

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human readable message",
    "details": [{ "field": "name", "message": "Required" }]
  }
}
```

## Dashboard 页面

| 路径 | 说明 |
|------|------|
| `/` | 概览页（任务统计、队列状态、最近活动） |
| `/tasks` | 任务列表（创建、搜索、筛选、分页） |
| `/tasks/:id` | 任务详情（帖子列表、步骤进度、结果展示） |
| `/posts` | 帖子库（搜索、筛选、查看评论/媒体） |
| `/strategies` | 策略管理（查看、预览输出 schema） |
| `/queue` | 队列监控（运行中/失败/已完成任务） |

## 部署模式

### 场景 A：独立运行

```bash
cd packages/api && pnpm start
# 浏览器打开 http://localhost:3000
```

### 场景 B：局域网共享

```bash
HOST=0.0.0.0 PORT=3000 pnpm start
# 团队成员通过 http://<ip>:3000 访问
```

### 场景 C：嵌入 Electron/Tauri 客户端

```javascript
// Agent 客户端启动时内嵌启动 API
spawn('node', ['packages/api/dist/index.js'])
// 客户端用 iframe 或 WebView 加载 http://localhost:3000
```

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| API 请求参数校验失败 | Fastify 自动返回 400 + Zod 错误详情 |
| DuckDB 查询失败 | 500 错误 + 日志记录，不暴露 SQL 细节 |
| Worker 分析失败 | 写入 `queue_jobs.error`，UI 轮询获取 |
| Anthropic API 限流 | Worker 自动重试（指数退避） |
| API 服务崩溃 | 进程管理器自动重启，DuckDB WAL 保证数据安全 |

## 测试策略

| 层级 | 覆盖范围 |
|------|----------|
| 单元测试 | `core` 中的纯函数、数据转换逻辑 |
| 集成测试 | API 路由 + core 数据库操作（内存 DuckDB） |
| E2E 测试 | CLI 完整工作流（保持现有测试） |
| 前端测试 | UI 组件 + API 交互（Vitest + Playwright） |

## 迁移策略

### Phase 1：Core 提取

1. 创建 `packages/core/`
2. 将 `src/db/` 中的 schema、迁移、CRUD 操作移入 `core/src/db/`
3. 将 `src/config/` 移入 `core/src/config/`
4. 将 `src/shared/types.ts`、`src/shared/utils.ts` 移入 `core/src/`
5. 确保 `packages/cli/` 能正常依赖 `packages/core/`

### Phase 2：API 服务

1. 创建 `packages/api/`
2. 接入 Fastify + Kysely
3. 实现核心 API 路由（tasks、posts、strategies、queue）
4. 将 daemon 的处理逻辑迁移到 `api/src/routes/`：
   - `ipc-server.ts` → Fastify HTTP routes
   - `handlers.ts` → `routes/tasks.ts`、`routes/posts.ts` 等
   - `stream-scheduler.ts` → `api/src/daemon/scheduler.ts`
5. 将 worker 管理逻辑迁移到 `api/src/worker/`
6. API 内部调用 `core` 操作数据库
7. 删除原 `src/daemon/` 和 `src/cli/ipc-client.ts`

### Phase 3：UI

1. 创建 `packages/ui/`（React + Vite）
2. 实现 Dashboard 页面
3. UI 通过 HTTP 调用 `api`

### ~~Phase 4：CLI 瘦身~~（已取消）

> 此阶段已取消，CLI 保持现有架构不变。

## 监控与可观测性

- Dashboard 首页展示：运行中任务数、队列积压数、worker 状态
- `GET /api/daemon/status` 提供实时健康检查
- 日志统一通过 `core` 的 logger（文件 + 控制台）
- 未来可扩展：Prometheus metrics、OpenTelemetry traces

## 风险与缓解

| 风险 | 缓解措施 |
|------|----------|
| DuckDB 并发写冲突 | 只通过 `core` 单进程写，api 合并 daemon 职责解决 |
| 前端 UI 复杂度增长 | 保持 UI 组件小而专注，按需拆分 |
| monorepo 初始迁移成本 | 渐进式迁移，每次只改一个包，不阻断现有功能 |
| Electron 嵌入时的端口冲突 | 支持配置 `PORT` 环境变量，允许用户自定义 |