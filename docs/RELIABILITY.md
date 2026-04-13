# RELIABILITY.md

## 可靠性重点

- daemon 是否可启动和可停止
- worker 是否持续轮询并正确更新任务状态
- DuckDB 状态是否与 CLI 展示一致
- 分析失败是否会落入 `failed` 状态而不是静默吞掉

## 当前已知关注点

- `post` 目标不是完整 worker 路径
- `media` 路径需要结合真实样本继续验证
- 长时间任务执行依赖 Anthropic API 可用性

## 推荐检查

- `analyze-cli daemon status`
- `analyze-cli task status --task-id <taskId>`
- `analyze-cli result stats --task-id <taskId>`
