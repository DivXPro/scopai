# analyze-cli Agent Harness

这套编排包面向当前仓库已经实现的 `CLI -> task queue -> worker -> result export` 流程，目的是让 `superpowers` 先拆角色、再分阶段执行，而不是把导入、建任务、跑分析、读结果混成一次长对话。

## 入口文件

### 使用方 Agent（面向 CLI 使用者）

- 主编排入口：`agents/social-media-analysis-harness.md`
- 总控 agent：`agents/orchestrator.md`
- 数据接入 agent：`agents/dataset-curator.md`
- 模板与任务 agent：`agents/template-task-architect.md`
- 运行监督 agent：`agents/run-supervisor.md`
- 洞察输出 agent：`agents/insight-synthesizer.md`

### 开发方 Agent（面向 CLI 开发者）

- 项目架构师：`agents/project-architect.md`
- 数据工程师：`agents/data-engineer.md`
- CLI 开发者：`agents/cli-developer.md`
- 集成工程师：`agents/integration-engineer.md`

## 适用场景

- 导入某个平台的帖子和评论，准备分析数据
- 选择或微调 prompt 模板，并批量创建分析任务
- 启动 daemon / worker，跟踪任务进度与失败项
- 导出结果并生成产品反馈、风险、情绪分布等结论

## 推荐的 Superpowers 编排方式

1. 用 `writing-plans` 明确本次目标、平台、数据源、分析模板和交付物。
2. 用 `dispatching-parallel-agents` 并行派发 `dataset-curator` 与 `template-task-architect`。
3. 用 `subagent-driven-development` 让 `run-supervisor` 接手执行与监控阶段。
4. 在结果稳定后派发 `insight-synthesizer` 做统计、导出和结论整理。
5. 如果中途改了模板或命令约定，再走一次 `requesting-code-review` 做回看。

## 设计原则

- 每个 agent 只负责一个阶段，避免跨阶段直接改动别人的产物。
- 交接只传结构化摘要，不传冗长思维过程。
- 所有命令都以当前仓库实际 CLI 为准，不假设额外服务存在。
- 遇到输入不完整或业务目标含糊时，由总控先向用户补齐约束。
