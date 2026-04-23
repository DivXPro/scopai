# 设计文档索引

## 说明

本目录存放架构设计、核心设计信念和历史设计稿。

## 当前文档

- `core-beliefs.md`
- `2026-04-13-social-media-analysis-design.md`
- `2026-04-14-two-phase-task-pipeline-design.md`
- `2026-04-15-json-import-design.md`
- `2026-04-15-json-schema-dynamic-tables.md`
- `2026-04-16-agent-e2e-recording-design.md`
- `2026-04-16-agent-skill-atomic-tasks-design.md`
- `2026-04-16-auto-strategy-generation-design.md`
- `2026-04-18-streaming-analysis-design.md` — 流式分析：帖子数据就绪后立即触发分析，数据准备与分析并行执行
- `2026-04-19-e2e-test-suite-design.md` — E2E 测试套件设计：完整用户工作流的真实链路测试
- `2026-04-20-strategy-aggregation-design.md` — 策略结果聚合查询：自动识别并展开 Array/JSON 字段，支持跨帖子聚合分析
- `2026-04-21-secondary-strategy-design.md` — 二次分析策略：基于上游策略结果做进一步分析，支持运行时动态绑定依赖
- `2026-04-21-ui-monorepo-architecture.md` — UI + Monorepo 架构设计：Web Dashboard + Fastify API + pnpm workspace，将 CLI 重构为 monorepo 结构以支持小团队共享和 AI Agent 客户端嵌入

## 如何使用

- 想快速理解系统边界：先读 `../../ARCHITECTURE.md`
- 想理解设计判断：读 `core-beliefs.md`
- 想查看详细历史设计：读 `2026-04-13-social-media-analysis-design.md`
