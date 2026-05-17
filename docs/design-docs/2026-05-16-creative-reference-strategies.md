# 二次创作参考策略与 MCP 增强设计

> **⚠️ 部分废弃 (2026-05-17)**
>
> - `creative-brief` 策略已废弃，本文档相关章节仅作为历史设计记录保留。
> - 其余三个策略（`creative-copy-deconstruct` / `creative-visual-style` / `creative-topic-angle`）已升级到 v2.0.0，输出结构改为「骨架 + 槽位 + 适用场景 + 素材清单」工程化模板，与本文档原始 schema 已不兼容。
> - MCP 工具 `generate_creative_brief` 已 deprecate，新名 `analyze_creative_references`。
> - 当前权威规格见 `docs/product-specs/creative-strategy-templates.md` 与 `packages/core/src/strategies/built-in/*.json`。

## 背景

Scopai 已具备完整的社交媒体内容采集、策略分析和 MCP Server 能力。当前痛点：

1. **缺乏面向创作场景的分析策略** — 现有策略偏向通用分析（情感、关键词等），未针对"二次创作参考"设计结构化提取
2. **检索效率低** — 策略结果分散在动态表中，无法支持模糊概念检索（如"高级感美妆"）
3. **MCP 工具未覆盖创作工作流** — 现有工具以数据管理为主，缺少"发现参考 → 提取要素 → 生成方案"的创作链路

## 目标

1. 提供 4 个预置创作分析策略，自动提取帖子的文案结构、视觉风格、话题角度、综合简报
2. 新增 `search_index` 表，支持基于分析结果的全文模糊检索
3. 扩展策略系统 `target`，支持 `multi-post` 类型（用于综合创作简报生成）
4. 增强 MCP Server，新增/改进创作参考相关工具

## 策略设计

### 策略 1：文案解构 (`creative-copy-deconstruct`)

**target**: `post`

**Prompt**:
> 你是一位资深短视频/社交媒体文案分析师。请对以下帖子文案进行结构化拆解，提取创作者使用的文案技巧。关注：开头如何抓注意力、中间如何建立信任/制造情绪、结尾如何引导互动。

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "hook": { "type": "string", "description": "开头钩子，3秒内抓注意力的手法" },
    "structure_template": { "type": "string", "description": "文案结构模板，如'痛点共鸣→解决方案→社会证明→CTA'" },
    "golden_phrases": { "type": "array", "items": { "type": "string" }, "description": "可复用的金句/话术" },
    "emotion_curve": { "type": "string", "description": "情绪走向，如'焦虑→希望→紧迫'" },
    "pain_point": { "type": "string", "description": "触达的受众痛点" },
    "target_audience": { "type": "string", "description": "目标受众画像" },
    "cta_type": { "type": "string", "description": "行动号召类型" }
  }
}
```

### 策略 2：视觉风格 (`creative-visual-style`)

**target**: `post`
**needs_media**: `{ "enabled": true }`

**Prompt**:
> 你是一位视觉创意总监。请分析这组图片/视频的视觉效果，提取可用于二次创作参考的风格要素。如果有多张图，请指出系列图的一致性设计和变化节奏。

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "color_palette": { "type": "array", "items": { "type": "string" }, "description": "主色调" },
    "composition": { "type": "string", "description": "构图特点" },
    "lighting": { "type": "string", "description": "光影风格" },
    "mood": { "type": "string", "description": "整体氛围" },
    "aesthetic_keywords": { "type": "array", "items": { "type": "string" }, "description": "美学标签" },
    "suitable_scenes": { "type": "array", "items": { "type": "string" }, "description": "适用场景" },
    "style_reference_prompt": { "type": "string", "description": "可直接用于AI图像生成的风格描述Prompt" }
  }
}
```

### 策略 3：话题角度 (`creative-topic-angle`)

**target**: `post`

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "core_topic": { "type": "string", "description": "核心话题" },
    "angle": { "type": "string", "description": "切入角度" },
    "differentiation": { "type": "string", "description": "差异化点" },
    "trend_potential": { "type": "string", "description": "爆点分析" },
    "content_format": { "type": "string", "description": "内容形式" },
    "related_angles": { "type": "array", "items": { "type": "string" }, "description": "可延伸的相关角度" }
  }
}
```

### 策略 4：综合创作简报 (`creative-brief`)

**target**: `multi-post`
**depends_on**: 前三个策略的分析结果

**Prompt**:
> 基于以下多条参考帖子的分析结果，生成一份综合创作简报。这份简报要能帮助创作者快速理解"这些参考为什么有效"以及"我可以怎么借鉴融合"。

**Input 格式**（由 worker 在调用前组装）:
```json
{
  "references": [
    {
      "post_id": "...",
      "post_content": "...",
      "copy_analysis": { ... },
      "visual_analysis": { ... },
      "topic_analysis": { ... }
    }
  ],
  "requirements": "用户额外要求（可选）"
}
```

**Output Schema**:
```json
{
  "type": "object",
  "properties": {
    "reference_summary": { "type": "string", "description": "150字内参考精华总结" },
    "copy_direction": { "type": "string", "description": "文案方向建议" },
    "visual_direction": { "type": "string", "description": "视觉方向建议" },
    "applicable_scenarios": { "type": "array", "items": { "type": "string" } },
    "adaptation_tips": { "type": "array", "items": { "type": "string" }, "description": "改编建议" }
  }
}
```

## 数据层设计

### 新增表：search_index

```sql
CREATE TABLE IF NOT EXISTS search_index (
    post_id          TEXT NOT NULL,
    source_type      TEXT NOT NULL,
    searchable_text  TEXT NOT NULL,
    weight           REAL DEFAULT 1.0,
    updated_at       TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_search_index_post ON search_index(post_id);
CREATE INDEX IF NOT EXISTS idx_search_index_type ON search_index(source_type);
```

**写入时机**：worker 完成策略分析后，在 `insertStrategyResult` 之后同步写入。

**source_type 枚举**:
- `post_content` — 帖子原始内容（title + content + author_name）
- `brief_copy` — 文案解构结果文本聚合
- `brief_visual` — 视觉风格结果文本聚合
- `brief_topic` — 话题角度结果文本聚合
- `brief_comprehensive` — 综合简报结果文本聚合

**searchable_text 生成逻辑**:

```typescript
function buildSearchableText(sourceType: string, data: unknown): string {
  const texts: string[] = [];
  
  function extractStrings(value: unknown) {
    if (typeof value === 'string') {
      texts.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(extractStrings);
    } else if (value && typeof value === 'object') {
      Object.values(value).forEach(extractStrings);
    }
  }
  
  extractStrings(data);
  return texts.join(' ');
}

// 写入示例（在 worker 分析完成后）
const result = await analyzeWithStrategy(post, strategy);
await insertStrategyResult(strategyId, result);

// 同步写入 search_index
const searchableText = buildSearchableText(strategy.name, result);
await insertSearchIndex(post.id, `brief_${strategyType}`, searchableText);
```

**关键原则**：把所有结构化 JSON 的字段值递归提取为纯文本，用空格拼接。这样无论用户搜索哪个维度的关键词，都能命中。

### 策略结果存储（复用现有）

继续复用现有的动态策略结果表（`strategy_results_<strategy_id>`），精确详情查询直接查对应表。

## 策略系统扩展

### target 类型扩展

当前 `target` 为 `post | comment`，需扩展为 `post | comment | multi-post`。

**影响范围**:
- `strategies` 表的 CHECK 约束
- `task_targets` 表的 CHECK 约束
- `queue_jobs` 表的 target_type 字段
- worker 中的 job 处理逻辑

### multi-post 策略的 job 处理流程

```
1. worker 接收到 target_type='multi-post' 的 job
2. 从 task_targets 获取该 task 关联的所有 post
3. 查询这些 post 在 depends_on 策略中的分析结果
4. 组装 input JSON（参考内容 + 分析结果）
5. 调用 LLM 生成综合简报
6. 结果写入 strategy_results_creative-brief 表
7. 同时写入 search_index（source_type='brief_comprehensive'）
```

## MCP Server 增强

### 新增后端 API（供 MCP 工具调用）

| 路由 | 方法 | 用途 |
|------|------|------|
| `/api/search` | GET | 基于 search_index 的全文检索，`?query=高级感美妆&limit=5` |
| `/api/posts/:id/reference` | GET | 获取单条帖子的结构化参考卡片（聚合多策略结果） |

### 现有工具保持不变

`list_posts`, `list_tasks`, `get_task`, `list_strategies`, `list_creators`, `get_task_results`, `list_queue_jobs`, `retry_failed_jobs`, `create_task`, `add_task_posts`, `add_task_step`, `run_task_prepare`, `run_task_analysis`, `get_post` 等现有工具保持不变。

### search_posts 增强

**当前实现**: 调用 `/posts` API，按平台+关键词过滤。

**新实现**: 当传入 `query` 参数时，优先查 `search_index` 表做全文检索，返回匹配帖子的列表及核心参考摘要。

```typescript
server.registerTool('search_posts', {
  description: 'Search posts by natural language query. Supports creative concept queries like "高级感美妆产品首图".',
  inputSchema: z.object({
    query: z.string().describe('Natural language search query'),
    platform: z.string().optional().describe('Filter by platform ID'),
    limit: z.number().optional().default(5),
  }),
}, async (args) => {
  // 1. 查 search_index 做全文匹配
  // 2. JOIN posts 获取基础信息
  // 3. 聚合各 source_type 的匹配片段
  // 4. 返回带 reference_summary 的帖子列表
});
```

### 新增工具：get_post_reference

```typescript
server.registerTool('get_post_reference', {
  description: 'Get structured creative reference card for a post. Includes copy解构, visual style, topic angle, and comprehensive brief if analyzed.',
  inputSchema: z.object({
    post_id: z.string().describe('Post ID'),
    include_original: z.boolean().optional().default(false),
  }),
}, async (args) => {
  // 1. 从 posts 表取基础信息
  // 2. 从 strategy_results_creative-copy-deconstruct 取文案要素
  // 3. 从 strategy_results_creative-visual-style 取视觉要素
  // 4. 从 strategy_results_creative-topic-angle 取话题要素
  // 5. 从 strategy_results_creative-brief 取综合简报
  // 6. 组装成结构化参考卡片返回
});
```

**返回格式**:
```json
{
  "post": { ... },
  "references": {
    "copy": { "hook": "...", "structure_template": "...", ... },
    "visual": { "color_palette": [...], "mood": "...", ... },
    "topic": { "core_topic": "...", "angle": "...", ... },
    "brief": { "reference_summary": "...", "copy_direction": "...", ... }
  },
  "analyzed": true
}
```

### 新增工具：generate_creative_brief

```typescript
server.registerTool('generate_creative_brief', {
  description: 'Generate a creative brief based on multiple reference posts. Creates a task and runs the creative-brief strategy.',
  inputSchema: z.object({
    post_ids: z.array(z.string()).describe('Array of post IDs to use as references'),
    brief_type: z.enum(['短视频脚本', '产品图方案', '种草文案', '通用']).default('通用'),
    requirements: z.string().optional().describe('Additional creative requirements'),
  }),
}, async (args) => {
  // 1. 检查所有 post 是否已有前三个策略的分析结果
  // 2. 创建 task，name = "创作简报生成"
  // 3. add_task_posts 添加 post_ids
  // 4. add_task_step 添加 creative-brief 策略（target=multi-post）
  // 5. run_task_analysis 启动分析
  // 6. 返回 task_id，Agent 可轮询 get_task 查看进度
});
```

## 任务步骤组合（推荐用法）

对于一批帖子，推荐的分析步骤链：

```
Task: "美妆参考分析"
├── Step 1: creative-copy-deconstruct (target=post)
├── Step 2: creative-visual-style (target=post, depends_on_step_id=step1)
├── Step 3: creative-topic-angle (target=post, depends_on_step_id=step2)
└── Step 4: creative-brief (target=multi-post, depends_on_step_id=step3)
```

前三个步骤并行分析单条帖子，第四步基于前三步结果生成综合简报。

## 实现边界

1. **预置策略导入**: 4 个策略通过 JSON 文件定义，系统启动时自动导入（或提供 CLI 命令一键导入）
2. **search_index 填充**: 在 worker 完成策略分析后，同步写入 search_index
3. **multi-post worker 支持**: 需要扩展 `processStrategyJob` 处理 `target_type='multi-post'` 的逻辑
4. **MCP 工具无状态**: 所有 MCP 工具通过 HTTP API 调用后端，不直接操作数据库
