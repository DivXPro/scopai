# PLANS.md

## 说明

本文件是执行计划入口，统一索引当前活动计划、已完成计划和技术债记录。

## 目录

- 活动计划：`exec-plans/active/`
- 已完成计划：`exec-plans/completed/`
- 技术债：`exec-plans/tech-debt-tracker.md`

## 当前活动计划

- `exec-plans/active/2026-04-18-comment-analysis-and-batch.md` — Comment 级策略分析与 Worker 软批量分析实施计划
- `exec-plans/active/2026-04-16-auto-strategy-generation.md` — AI Agent 自然语言生成并注册分析策略实施计划
- `exec-plans/active/2026-04-16-agent-e2e-recording-plan.md` — Agent 驱动 E2E 数据录制与离线测试实施计划
- `exec-plans/active/2026-04-15-strategy-system.md` — 分析套路系统 P0 实施计划（策略导入、动态分析、Worker 支持）
- `exec-plans/active/2026-04-14-xhs-ai-pipeline-agent-test-plan.md` — 小红书 AI 热帖 Agent 自动执行测试计划（opencli 抓取 + 导入 + 分析）
- `exec-plans/active/2026-04-19-e2e-test-suite.md` — E2E 测试套件实施计划：覆盖导入→数据准备→策略分析→队列恢复→daemon 生命周期的真实链路测试

## 当前已归档内容

- `exec-plans/completed/2026-04-13-social-media-analysis-implementation.md`
- `exec-plans/completed/2026-04-13-manual-e2e-test-plan.md`
- `exec-plans/completed/2026-04-13-manual-e2e-test-report.md`
- `exec-plans/completed/2026-04-14-two-phase-task-pipeline.md` — 两阶段任务流水线实施计划（已完成）
- `exec-plans/completed/2026-04-15-json-import-plan.md` — JSON 数组导入支持实施计划（已完成）
- `exec-plans/completed/2026-04-18-streaming-analysis-plan.md` — 流式分析实施计划：帖子数据就绪后立即触发分析，数据准备与分析并行执行（已完成）

## 维护规则

- 进行中的计划放在 `active/`
- 已验证完成的计划移到 `completed/`
- 临时想法不要直接写进 completed，先形成可执行 plan
