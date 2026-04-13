# docs index

## 说明

这是 `docs/` 的总导航页，统一索引当前项目的设计、计划、产品、生成文档和参考资料。

## 推荐阅读顺序

1. `../AGENTS.md`
2. `../ARCHITECTURE.md`
3. `DESIGN.md`
4. `PLANS.md`
5. `product-specs/index.md`
6. `generated/db-schema.md`

## 顶层入口

- 设计入口：`DESIGN.md`
- 计划入口：`PLANS.md`
- 产品视角：`PRODUCT_SENSE.md`
- 质量视角：`QUALITY_SCORE.md`
- 可靠性：`RELIABILITY.md`
- 安全：`SECURITY.md`

## 分层目录

### `design-docs/`

- 设计文档索引：`design-docs/index.md`
- 核心原则：`design-docs/core-beliefs.md`
- 历史设计稿：`design-docs/2026-04-13-social-media-analysis-design.md`

### `exec-plans/`

- 活动计划：`exec-plans/active/`
- 已完成计划：`exec-plans/completed/`
- 技术债：`exec-plans/tech-debt-tracker.md`

### `generated/`

- 数据库结构摘要：`generated/db-schema.md`

### `product-specs/`

- 规格索引：`product-specs/index.md`
- CLI 产品规格：`product-specs/social-media-analysis-cli.md`

### `references/`

- 参考资料说明：`references/README.md`

## 使用约定

- 新文档先判断所属层级，再决定放到顶层还是子目录
- 设计稿、计划和产品规格不要混放
- 高价值文档更新前先核对真实实现
