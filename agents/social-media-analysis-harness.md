# Social Media Analysis Harness

## 目标

把这个项目的常见工作流拆成 4 个专职 agent，由一个总控 agent 用 `superpowers` 进行阶段化编排：

1. 数据准备
2. 模板与任务装配
3. 执行与监控
4. 结果归纳与导出

## Agent 拓扑

```text
orchestrator
  |- dataset-curator
  |- template-task-architect
  |- run-supervisor
  `- insight-synthesizer
```

## 编排顺序

### Phase 0: Intake

由 `orchestrator` 执行。

- 明确用户目标：要分析哪个平台、哪批帖子/评论、关注什么问题
- 确认数据来源：JSONL 文件、已有 task、已有 template、还是仅做结果导出
- 明确交付物：统计表、导出文件、摘要、风险清单，还是可复用模板
- 如果需求存在歧义，先给用户方案而不是直接执行

建议技能：

- `writing-plans`

### Phase 1: Prepare In Parallel

由 `orchestrator` 并行派发：

- `dataset-curator`
- `template-task-architect`

并行前提：

- 用户已经说明平台和目标数据源
- 如果还没有数据文件，`dataset-curator` 只产出导入计划，不执行导入
- 如果还没有分析目标，`template-task-architect` 只产出模板和任务建议

建议技能：

- `dispatching-parallel-agents`

### Phase 2: Gate Check

由 `orchestrator` 汇总两个阶段产物，检查是否同时满足：

- 存在可分析的 `comment_ids` 或 `post_ids`
- 已选定模板，或已确认使用默认模板
- 已形成任务装配方案

如果任一条件不满足：

- 缺数据：回到 `dataset-curator`
- 缺模板或任务定义：回到 `template-task-architect`

### Phase 3: Execute

由 `orchestrator` 派发 `run-supervisor`。

执行目标：

- 启动或确认 daemon
- 启动任务
- 周期性查看 task / queue 状态
- 汇总失败项和需要人工介入的异常

建议技能：

- `subagent-driven-development`

### Phase 4: Synthesize

由 `orchestrator` 派发 `insight-synthesizer`。

输出目标：

- `result stats`
- 必要时 `result list` / `result show`
- 按需 `result export`
- 面向业务目标的最终摘要

## 交接契约

### dataset-curator -> orchestrator

文件型输出或消息型输出都保持下面结构：

```json
{
  "platform": "xhs",
  "post_files": ["test-data/xhs_posts.jsonl"],
  "comment_files": ["test-data/xhs_comments_post1.jsonl"],
  "import_summary": {
    "posts_imported": 0,
    "comments_imported": 0
  },
  "ready_post_ids": [],
  "ready_comment_ids": [],
  "risks": []
}
```

### template-task-architect -> orchestrator

```json
{
  "template_name": "sentiment-topics",
  "template_id": null,
  "task_name": "Q1 product feedback",
  "task_id": null,
  "target_type": "comment",
  "target_ids": [],
  "assumptions": [],
  "next_action": "create_task"
}
```

### run-supervisor -> orchestrator

```json
{
  "task_id": "uuid",
  "daemon_state": "running",
  "task_state": "running",
  "progress": {
    "total": 0,
    "done": 0,
    "failed": 0,
    "pending": 0
  },
  "blocking_issues": [],
  "retry_advice": []
}
```

### insight-synthesizer -> orchestrator

```json
{
  "task_id": "uuid",
  "exports": [],
  "headline_findings": [],
  "risk_summary": [],
  "follow_up_questions": []
}
```

## 当前仓库命令映射

- 数据导入：`post import`, `comment import`
- 数据浏览：`post list`, `post search`, `comment list`
- 模板管理：`template list`, `template add`, `template update`, `template test`
- 任务管理：`task create`, `task add-posts`, `task add-comments`, `task start`, `task status`
- 守护进程：`daemon start`, `daemon status`, `daemon stop`
- 结果管理：`result stats`, `result list`, `result show`, `result export`

## 失败回路

- 导入失败或数据不足：回退到 `dataset-curator`
- 模板测试不合格：回退到 `template-task-architect`
- daemon 或任务卡住：回退到 `run-supervisor`
- 结果不能回答业务问题：回退到 `insight-synthesizer`，必要时再回到模板阶段
