# 抖音平台适配（PlatformAdapter 注册表）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将平台特定逻辑从硬编码 if/else 抽取为 PlatformAdapter 注册表，添加抖音平台适配。

**Architecture:** 创建 `packages/core/src/platforms/` 模块，定义 PlatformAdapter 接口和注册表。每个平台一个适配器文件，注册表提供查询函数。现有代码中的硬编码逻辑替换为从注册表查询。normalizePostItem/normalizeCommentItem 新增可选 platformId 参数以合并平台特有字段映射。

**Tech Stack:** TypeScript, Node.js, pnpm monorepo, node:test

---

### Task 1: 创建 PlatformAdapter 类型定义 ✅

**Files:**
- Create: `packages/core/src/platforms/types.ts`

- [x] 已完成。最终实现包含 `fieldMap`、`profileFieldMap`、`commentFieldMap`、`homepageUrlTemplate` 等字段。

---

### Task 2: 创建注册表实现 ✅

**Files:**
- Create: `packages/core/src/platforms/registry.ts`

- [x] 已完成。

---

### Task 3: 创建小红书适配器 ✅

**Files:**
- Create: `packages/core/src/platforms/xhs.ts`

- [x] 已完成。fieldMap 仅保留平台特有映射（通用映射由 POST_FIELD_MAP 处理）。新增 profileFieldMap、commentFieldMap、homepageUrlTemplate。

---

### Task 4: 创建抖音适配器 ✅

**Files:**
- Create: `packages/core/src/platforms/douyin.ts`

- [x] 已完成。关键变更（与初始计划不同）：
  - fieldMap 使用 **camelCase**（awemeId, diggCount 等），与 opencli 实际输出一致
  - fetchNote 为空（search 已覆盖 note 数据，无需重复抓取）
  - fetchComments 有值（`opencli douyin comment`）
  - 有 creatorTemplates（profileFetch + postsFetch）
  - 新增 profileFieldMap、commentFieldMap、homepageUrlTemplate

---

### Task 5: 创建 Bilibili 适配器 ✅

**Files:**
- Create: `packages/core/src/platforms/bilibili.ts`

- [x] 已完成。

---

### Task 6: 创建统一导出 + 自动注册 ✅

**Files:**
- Create: `packages/core/src/platforms/index.ts`
- Modify: `packages/core/src/index.ts`

- [x] 已完成。

---

### Task 7: 修改 normalizePostItem 支持平台字段映射 ✅

**Files:**
- Modify: `packages/core/src/shared/utils.ts`

- [x] 已完成。`normalizePostItem(raw, platformId?)` 合并 adapter fieldMap。

---

### Task 8: 修改 normalizeCommentItem 支持平台字段映射 ✅

**Files:**
- Modify: `packages/core/src/shared/utils.ts`

- [x] 已完成。`normalizeCommentItem(raw, platformId?)` 合并 adapter commentFieldMap。所有调用点（handlers.ts、posts.ts）已传入 platformId。

---

### Task 9: 替换 handlers.ts 中的硬编码逻辑 ✅

**Files:**
- Modify: `packages/api/src/daemon/handlers.ts`

- [x] 已完成。关键变更：
  - `getDefaultFetchMediaTemplate()` → adapter 查询
  - 目录名映射 → adapter directoryName
  - normalizePostItem/normalizeCommentItem 传入 platformId
  - fetchNote 为空时跳过（不再要求必填）

---

### Task 10: 修改 seed.ts 使用 adapter 的 creatorTemplates ✅

**Files:**
- Modify: `packages/core/src/db/seed.ts`

- [x] 已完成。

---

### Task 11: 修改 creator-sync.ts 使用 adapter ✅

**Files:**
- Modify: `packages/api/src/worker/creator-sync.ts`

- [x] 已完成。关键变更：
  - fetchProfile/fetchPosts: 数据库模板优先，adapter 兜底
  - FIELD_NAME_MAP 删除，替换为 POST_FIELD_MAP import
  - FALLBACK_POSTS_TEMPLATE 删除
  - homepage URL: 用 adapter.homepageUrlTemplate 替代硬编码 if/else
  - profileFieldMap 用于用户资料字段归一化

---

### Task 12: 清理 POST_FIELD_MAP ✅

**Files:**
- Modify: `packages/core/src/shared/utils.ts`

- [x] 已完成。POST_FIELD_MAP 仅保留跨平台通用映射（author, user_id, cover, cover_image）。平台特有映射移到各 adapter fieldMap。

---

### Task 13: 编写适配器单元测试 ✅

**Files:**
- Create: `test/unit/platform-adapter.test.ts`

- [x] 已完成。34 个测试覆盖：
  - 注册表查询/注册（6 个）
  - douyin adapter 全字段验证（8 个）
  - xhs adapter 全字段验证（6 个）
  - bilibili adapter 基础验证（3 个）
  - normalizePostItem + platformId（5 个）
  - normalizeCommentItem + platformId（4 个）

---

### Task 14: 添加抖音测试夹具 ✅

**Files:**
- Create: `test/e2e/fixtures/posts/sample-douyin.json`

- [x] 已完成。使用 camelCase 格式与 opencli 实际输出一致。

---

### Task 15: 全量构建和回归测试（待执行）

**Files:** 无新增

- [ ] **Step 1: 全量构建**

Run: `pnpm build`
Expected: 构建成功

- [ ] **Step 2: 运行全部单元测试**

Run: `pnpm test && node --test test/unit/platform-adapter.test.ts`
Expected: 所有测试通过

- [ ] **Step 3: 运行 API e2e 测试**

Run: `pnpm --filter @scopai/api test:e2e`
Expected: 所有测试通过
