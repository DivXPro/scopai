# scopai Agent Skill 原子化任务与子任务设计

**Goal:** 让 AI Agent 通过调用 Custom Skill 的方式，以原子化工具操作 scopai，完成从数据搜索、导入、下载评论/媒体、到多步骤策略分析的全流程，并支持 Agent 轮询任务状态与断点续传。

**Architecture:** 在现有 `tasks` 体系上引入 `task_steps` 子任务（步骤）表，每个步骤绑定一个 `strategy`（套路）；数据准备（`prepare-data`）作为 task 级别前置阶段，分析执行拆分为可独立运行、可追加的步骤。Skill 以原子 CLI 命令封装暴露给 Agent。

**Tech Stack:** TypeScript, Node 20, DuckDB, Commander, Claude Code Custom Skill (Markdown)

---

## 背景与约束

- 已通过 `record-e2e-fixture.ts` 验证了 OpenCLI 与 scopai CLI 的联动能力。
- 用户明确要求：**不做同步阻塞等待**，由 **Agent 轮询**确认任务进度。
- 用户要求 CLI 具备**完整任务接受能力**，且支持**后续对已有 task 追加策略分析步骤**。
- `task.prepareData` 当前存在 bug：每次调用会重置所有 `task_post_status` 为 `pending`，导致无法断点续传。

---

## 核心设计决策

### 1. 阶段与步骤模型

一个 Task 的生命周期分为两个层级：

| 层级 | 概念 | 数据载体 |
|------|------|----------|
| **阶段 1：数据准备** | 遍历 task 下所有帖子，下载评论和媒体 | `task_post_status` 表 |
| **阶段 2：分析执行** | 按顺序执行一个或多个 strategy（套路） | `task_steps` 表 + `queue_jobs` |

`task_steps` 表设计：

```sql
CREATE TABLE IF NOT EXISTS task_steps (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    strategy_id     TEXT REFERENCES strategies(id),
    name            TEXT NOT NULL,
    step_order      INTEGER NOT NULL DEFAULT 0,
    status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','skipped')),
    stats           JSON,
    error           TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    updated_at      TIMESTAMP DEFAULT NOW(),
    UNIQUE(task_id, strategy_id)
);
```

**规则：**
- 同一个 task 不能重复绑定同一个 strategy（`UNIQUE(task_id, strategy_id)`）。
- `step_order` 控制执行顺序，Agent 可以显式指定，也可以默认按添加顺序递增。
- `status` 独立追踪每个步骤的完成状态，支持后续追加新步骤。

### 2. Agent 原子工具（Skill 暴露）

| 工具名 | 对应 CLI 命令 | 说明 |
|--------|--------------|------|
| `search_posts` | `opencli xiaohongshu search {query} --limit {n} -f json` | 搜索帖子 |
| `add_platform` | `scopai platform add --id {id} --name {name}` | 添加平台 |
| `import_posts` | `scopai post import --platform {id} --file {path} [--task-id {tid}]` | 导入帖子，自动绑定 task；已存在则更新 |
| `list_posts` | `scopai post list --platform {id} --limit {n}` | 查询已导入帖子 |
| `create_task` | `scopai task create --name {name} [--cli-templates '{...}']` | 创建分析任务 |
| `add_step_to_task` | `scopai task step add --task-id {tid} --strategy-id {sid} [--name {name}] [--order {n}]` | 为 task 追加分析步骤 |
| `list_task_steps` | `scopai task step list --task-id {tid}` | 查看 task 下所有步骤 |
| `prepare_task_data` | `scopai task prepare-data --task-id {tid}` | 遍历下载评论和媒体（支持断点续传） |
| `run_task_step` | `scopai task step run --task-id {tid} --step-id {sid}` | 执行指定步骤 |
| `run_all_steps` | `scopai task run-all-steps --task-id {tid}` | 顺序执行所有 pending/failed 步骤 |
| `get_task_status` | `scopai task status --task-id {tid}` | 聚合返回 dataPreparation + steps 进度 |
| `get_task_results` | `scopai task results --task-id {tid}` | 返回最终分析报告 |

### 3. `task status` 聚合返回结构

```typescript
{
  id: "...",
  name: "...",
  status: "running",

  phases: {
    dataPreparation: {
      status: "done",           // pending | fetching | done | failed
      totalPosts: 10,
      commentsFetched: 10,
      mediaFetched: 10,
      failedPosts: 0,
    },
    steps: [
      {
        stepId: "...",
        strategyId: "sentiment-topics",
        name: "情感分析",
        status: "completed",
        stats: { total: 30, done: 30, failed: 0 },
        stepOrder: 0,
      },
      {
        stepId: "...",
        strategyId: "risk-detection",
        name: "风险检测",
        status: "running",
        stats: { total: 30, done: 12, failed: 1 },
        stepOrder: 1,
      }
    ]
  }
}
```

**整体状态推导规则：**
- 若 `task_post_status` 中存在 `comments_fetched = FALSE OR media_fetched = FALSE` → `task.status = pending`（数据准备未完成）
- 数据准备完成后，若存在 `task_steps.status IN ('pending', 'running')` → `task.status = running`
- 所有 steps 均为 `completed/failed/skipped` → `task.status = completed`

### 4. 断点续传机制

**修复 `task.prepareData`：**
- 删除循环开头重置所有 post 为 `pending` 的逻辑。
- 只处理 `comments_fetched = FALSE OR media_fetched = FALSE OR status = 'failed'` 的记录。
- `status = 'done'` 的 post 直接跳过。

**步骤执行的幂等性：**
- `task step run --step-id {sid}` 检查 `task_steps.status`：
  - 若为 `completed` → 直接返回 "already completed"
  - 若为 `pending/failed` → 生成 `queue_jobs` 并入队
- `task run-all-steps` 按 `step_order` 升序遍历，跳过 `completed/skipped`，顺序执行其余步骤。

### 5. 数据流示例

Agent 典型调用链：

```
1. search_posts(platform=xhs, query="上海美食", limit=5)
2. add_platform(id=xhs, name="小红书")
3. create_task(name="上海美食情感与风险分析")
4. import_posts(platform=xhs, file=posts.jsonl, task_id=...)
5. add_step_to_task(task_id=..., strategy_id="sentiment-topics", name="情感分析", order=0)
6. add_step_to_task(task_id=..., strategy_id="risk-detection", name="风险检测", order=1)
7. prepare_task_data(task_id=...)

Agent 轮询 get_task_status：
  → phases.dataPreparation.status: fetching, commentsFetched: 3/5
  → phases.dataPreparation.status: done

8. run_all_steps(task_id=...)

Agent 继续轮询：
  → phases.steps[0].status: running, stats: { done: 15, total: 30 }
  → phases.steps[0].status: completed
  → phases.steps[1].status: running, stats: { done: 8, total: 30 }
  → phases.steps[1].status: completed
  → task.status: completed

9. get_task_results(task_id=...) → 返回报告
```

后续追加新步骤：
```
10. add_step_to_task(task_id=..., strategy_id="new-strategy", order=2)
11. run_task_step(task_id=..., step_id=...)
```

---

## 需要修改的文件

| 文件 | 修改内容 |
|------|----------|
| `src/db/schema.sql` | 新增 `task_steps` 表定义 |
| `src/db/migrate.ts` | 增加 `task_steps` 迁移逻辑 |
| `src/db/task-steps.ts` | 新增 CRUD 模块 |
| `src/shared/types.ts` | 新增 `TaskStep` 类型 |
| `src/daemon/handlers.ts` | `task.status` 聚合返回；修复 `task.prepareData` 断点续传；新增 `task.step.add`、`task.step.run`、`task.runAllSteps` handlers |
| `src/cli/task.ts` | 新增 CLI 子命令：`task step add/list/run`、`task run-all-steps`、`task results` |
| `src/cli/post.ts` | `post import` 增加 `--task-id`，并改为 upsert 而非 skip |
| `.claude/skills/scopai/skill.md` | Custom Skill 定义（后续计划实施） |

---

## 错误处理

- `prepare_task_data` 失败时：更新对应 `task_post_status.status = 'failed'` 并记录 `error`。
- `task step run` 失败时：更新 `task_steps.status = 'failed'`，不影响其他步骤。
- Agent 轮询到 `failed` 状态时，可向用户展示错误并询问是否重试。

---

## Spec Self-Review

1. **Spec coverage:** 原子工具、阶段/步骤模型、断点续传、追加步骤、Agent 轮询流程均已覆盖。
2. **Placeholder scan:** 无 TBD/TODO，代码块和命令完整。
3. **Internal consistency:** `task_steps.status` 枚举与推导规则一致，不会与 `tasks.status` 冲突。
4. **Scope check:** 本设计聚焦 Skill 原子化与步骤子系统，MCP Server 暂不涉及，范围可控。
