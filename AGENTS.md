# AGENTS.md

## 说明

本文件是项目级 agent 工作入口。

- `AGENTS.md` 是唯一主入口
- 涉及 agent 编排、文档入口、执行约束时，优先以本文件和 `agents/` 目录为准

## 项目概览

`analyze-cli` 是一个基于 TypeScript 和 Node.js 的社交媒体内容分析 CLI。

当前主链路：

```text
CLI command
  -> DuckDB data / task records
  -> daemon + worker pool
  -> Anthropic analysis
  -> result query / export
```

项目定位不是 Web 服务，而是一个可被 AI agent 或人工命令行直接调用的分析工具。

## 技术栈

- 语言：TypeScript
- 运行时：Node.js 20+
- 包管理：优先使用 `pnpm`
- CLI：`commander`
- 存储：`duckdb`
- 调度：`bree`
- 模型调用：`@anthropic-ai/sdk`
- 输出：终端结果 + JSON/CSV 导出

## 关键入口

- CLI 入口：`src/cli/index.ts`
- 可执行入口：`bin/analyze-cli.js`
- daemon 入口：`src/daemon/index.ts`
- worker 入口：`src/worker/index.ts`
- consumer 主循环：`src/worker/consumer.ts`
- 配置入口：`src/config/index.ts`

## 当前 CLI 命令组

- `daemon`
- `platform`
- `post`
- `comment`
- `task`
- `template`
- `result`

## 当前实现边界

- `worker` 对 `comment` 路径是主实现路径
- `media` 路径已有处理代码，但完整生产链路需要结合实际数据确认
- `post` 目标在 `worker` 中当前会报 `Unsupported target_type`
- 规划文档里部分理想化 Bree 编排能力尚未完全成为当前实现
- 高价值文档更新前，应先核对真实代码，不要只沿用规划稿

## 推荐工作流

### 初始化

- 安装依赖：`pnpm install`
- 构建：`pnpm build`

### 数据准备

- 导入帖子：`analyze-cli post import --platform <id> --file <posts.jsonl>`
- 导入评论：`analyze-cli comment import --platform <id> --post-id <postId> --file <comments.jsonl>`
- 核查数据：`analyze-cli post list`、`analyze-cli comment list`

### 任务准备

- 查看模板：`analyze-cli template list`
- 创建任务：`analyze-cli task create --name "<name>" --template <templateName>`
- 绑定目标：`analyze-cli task add-comments --task-id <taskId> --comment-ids <id1,id2>`

### 执行与结果

- daemon 状态：`analyze-cli daemon status`
- 启动任务：`analyze-cli task start --task-id <taskId>`
- 查看进度：`analyze-cli task status --task-id <taskId>`
- 统计结果：`analyze-cli result stats --task-id <taskId>`
- 导出结果：`analyze-cli result export --task-id <taskId> --format json --output <path>`

## 文档入口

核心文档结构：

- 架构说明：`ARCHITECTURE.md`
- agent 主入口：`AGENTS.md`
- 详细文档目录：`docs/`
- 项目 agent 编排包：`agents/`

`docs/` 内推荐阅读顺序：

1. `docs/DESIGN.md`
2. `docs/PLANS.md`
3. `docs/product-specs/index.md`
4. `docs/design-docs/index.md`
5. `docs/generated/db-schema.md`

## 项目 Agent 入口文件

项目根目录 `agents/` 是这套仓库的协作文档入口。<mccoremem id="03fxt3wab7n06ugtti28x07pu" />

主入口：

- `agents/social-media-analysis-harness.md`

角色入口：

- `agents/orchestrator.md`
- `agents/dataset-curator.md`
- `agents/template-task-architect.md`
- `agents/run-supervisor.md`
- `agents/insight-synthesizer.md`

辅助说明：

- `agents/README.md`

## Agent 职责

### orchestrator

- 需求澄清
- 阶段编排
- 串并行决策
- 验收下游交接物

### dataset-curator

- 导入帖子和评论
- 核对数据是否落库
- 交付可用目标 ID

### template-task-architect

- 选择和测试模板
- 创建任务并绑定目标
- 形成 task brief

### run-supervisor

- 检查 daemon
- 启动任务和跟踪进度
- 汇总执行异常

### insight-synthesizer

- 聚合结果
- 抽样核查
- 导出与总结

## 给 Claude 的工作约束

- 优先读取真实代码，再修改高价值文档
- 不要把设计文档当成实现事实
- 做 agent 编排时优先复用 `agents/` 下现有角色
- 涉及任务执行时，先确认 daemon 和 task 状态
- 需要结论时，优先给聚合统计和代表性样本
- 如果需求含糊，先给用户方案选择，再继续执行
- 涉及安装依赖、执行脚本或补充命令示例时，默认优先使用 `pnpm`
