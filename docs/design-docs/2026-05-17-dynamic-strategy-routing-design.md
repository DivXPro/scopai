# 动态策略路由设计

## 背景

当前系统每个 Task 创建时，所有下游分析策略对所有 Post 一视同仁生成 QueueJob。但实际上：

- 图片视觉风格策略对纯文字帖无意义
- 视频视觉风格策略对无视频帖无意义
- 文案解构对只有一句话的帖子无意义
- 话题角度策略对纯信息通告无意义

需要引入一层"先判断、再路由"的机制，让系统按内容特征动态决定哪些策略参与分析。

## 核心设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| Router 本身是否为策略 | 是 | Router 是特殊 Strategy（`is_router: true`），复用现有的策略导入、结果存储、Worker 执行链路 |
| 路由判据存放位置 | Strategy 自带的 `routing` 字段 | 策略作者最清楚自己需要什么原材料，Router 动态组装判据，新增策略无需改 Router |
| Router 调用时机 | 数据准备完成后、分析 Job 生成前 | 此时已有 Post 正文 + media 元信息，Router 可做出准确判断 |
| Router 结果缓存 | 存入独立结果表 | 避免重复调用，可供审计和 UI 展示 |
| 分析 Step 生成方式 | 预创建所有候选 Step，Job 按路由结果选择性生成 | Step 从任务创建时就存在且可见，stats 自动反映适用范围；无需 `activated_by` 字段 |
| 多策略是否合并调用 | 否 | 见分析结论：分开调用注意力更聚焦、Schema 约束更严格、错误隔离 |

## 兼容性保证

本设计遵循零破坏原则。以下逐项验证：

| 场景 | 验证 | 兼容性 |
|------|------|--------|
| 现有 Task（无 Router Step） | Worker、Scheduler、API、UI 全部走原有代码路径 | ✅ 完全兼容 |
| 现有 Strategy（无 `is_router`、无 `routing`） | `is_router` 默认 FALSE，`routing` 默认 NULL，所有校验跳过 | ✅ 完全兼容 |
| 现有 API 客户端 | 新增字段均为 optional，旧客户端不传即走旧逻辑 | ✅ 完全兼容 |
| `POST /api/tasks` 不传 `router_strategy_id` | 行为与当前完全一致：创建 Task + data-prep Step + 手动 Step | ✅ 完全兼容 |
| `POST /api/tasks/:id/steps` 手动创建 Step | 手动 Step 的 `strategy_id` 在 `buildJobsForPost` 中不受路由过滤（仅 Router 创建的 Step 受路由影响） | ✅ 完全兼容 |
| `POST /api/tasks/:id/steps/:stepId/run` 手动运行 Step | 手动触发时忽略路由结果，对该 Step 的所有 Target 生成 Job | ✅ 完全兼容 |
| `GET /api/tasks/:id` 响应 | 新增 `strategy_stats`、`post_statuses` 为增量字段，旧客户端忽略 | ✅ 完全兼容 |
| UI PipelineMatrix | 有 Router 时 3 列模式，无 Router 时 N+1 列模式（现有逻辑） | ✅ 完全兼容 |
| UI TaskTimeline | 有 Router 时 3 阶段，无 Router 时 N 阶段（现有逻辑） | ✅ 完全兼容 |
| `enqueueStepJobs`（API 侧 enqueue） | 函数签名不变，调用方按需传入路由上下文；不传则适用于全部 Target | ✅ 完全兼容 |

核心原则：**Router 是可选增强，不是必选替换。** 不开启路由功能的 Task 从 API 到 UI 行为与当前版本完全一致。

### 路由模式下手动 Step 与 Router Step 的交互

一个 Task 可以同时包含 Router 创建的 Step 和手动创建的 Step：

- Router 创建的 Step：受路由过滤，仅对 applicable 的 Post 生成 Job
- 手动创建的 Step：不受路由过滤，对所有 Post 生成 Job（与当前行为一致）

这允许混合使用场景：Router 自动管理大部分策略，同时用户手动追加一个 Router 无法覆盖的特殊策略。

## 1. 数据模型变更

### 1.1 `strategies` 表新增字段

```sql
ALTER TABLE strategies ADD COLUMN is_router BOOLEAN DEFAULT FALSE;
ALTER TABLE strategies ADD COLUMN routing JSON;
```

`routing` 字段结构：

```typescript
interface RoutingConfig {
  // 硬判据：不需要 LLM，scheduler 可直接判断
  availability?: {
    requires_media?: Record<string, number>; // { image: 1, video: 0 }
    requires_text?: {
      min_sentences?: number;
      min_chars?: number;
    };
    requires_data?: string[]; // 依赖的 Post 字段，如 ["engagement_count"]
  };

  // 软判据：需要 Router（LLM）逐条检查
  applicability_checks: Array<{
    id: string;                  // 判据 ID，Router 输出中作为 evidence 的 key
    question: string;            // 自然语言描述的问题，注入 Router prompt
    evidence_field?: string;     // Router 输出中对应的举证字段名
    kind: 'boolean' | 'text' | 'enum';
    enum_values?: string[];
  }>;

  // 负样本边界：告诉 Router "这些看起来像但实际不是"
  boundary_false_positives: string[];
}
```

### 1.2 `task_steps` 表

**无需变更**。Step 在 Task 创建时预创建所有候选策略的 Step，不使用 `activated_by` 动态创建。Step 的 `stats.total` 在 Router 完成后更新为实际适用该策略的 Post 数。

### 1.3 Router 结果表（新表）

```sql
CREATE TABLE router_results (
  id TEXT PRIMARY KEY,
  router_step_id TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  post_id TEXT NOT NULL,
  applicable_strategy_ids JSON NOT NULL,  -- ["s1", "s3"]
  skipped_strategies JSON NOT NULL,        -- [{ strategy_id, reason }]
  checks JSON NOT NULL,                    -- [{ check_id, strategy_id, passed, evidence }]
  confidence REAL NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(router_step_id, post_id)
);
```

## 2. Router Strategy 定义

4 个内置策略各自新增 `routing` 字段。以文案解构为例：

```json
{
  "id": "creative-copy-deconstruct",
  "routing": {
    "availability": {
      "requires_text": { "min_sentences": 3 }
    },
    "applicability_checks": [
      {
        "id": "has_hook",
        "question": "正文是否存在「钩子句」（开头抓注意力的句子）？",
        "evidence_field": "hook_quote",
        "kind": "boolean"
      },
      {
        "id": "has_narrative_body",
        "question": "正文是否有叙事推进段（论述/讲故事/举例/对比）而非仅下结论？",
        "evidence_field": "body_summary",
        "kind": "text"
      },
      {
        "id": "has_cta_or_close",
        "question": "正文是否有收束句或CTA？",
        "evidence_field": "cta_quote",
        "kind": "boolean"
      }
    ],
    "boundary_false_positives": [
      "正文以图片描述为主（如「看看这个」），缺乏独立文案结构",
      "正文是纯搬运/引用他人内容，无原创性",
      "正文是列表式罗列且无论述展开"
    ]
  }
}
```

其余 3 个策略的 `routing` 见附录 A。

新建一个 Router Strategy：

```json
{
  "id": "content-strategy-router",
  "name": "内容策略路由",
  "description": "根据帖子内容特征判定适合的下游分析策略",
  "version": "1.0.0",
  "target": "post",
  "is_router": true,
  "is_default": true,
  "prompt": "见附录 B",
  "output_schema": { "见附录 C" }
}
```

## 3. 后端流程变更

### 3.1 整体流程

```
数据准备完成
    │
    ▼
检查 Task 是否有 Router Step
    │
    ├─ 无 Router Step ──> 现有逻辑（完全兼容，Step 的 Job 对全部 Post 生成）
    │
    └─ 有 Router Step ──> 进入路由阶段
                              │
                    对每个 Post 串行或并行执行 Router
                              │
                    缓存 Router 结果到 router_results 表
                              │
                    聚合：更新各 Step 的 stats.total
                    （每个 Step 的 total = 适用该策略的 Post 总数）
                              │
                    对每个 Post 生成 QueueJob
                    仅对 Router 判定 applicable 的策略生成
                              │
                    进入 Worker 分析阶段（现逻辑不变）
```

### 3.2 Scheduler 改动

`buildJobsForPost` 新增参数：

```typescript
routerResults?: Map<string, Set<string>>  // postId → applicable strategy IDs
```

当 `routerResults` 存在时，遍历 steps 时跳过 strategy_id 不在 applicable set 中的 step。

### 3.3 Worker 改动

新增 `processRouterJob` 函数：

```typescript
async function processRouterJob(job: QueueJob, strategy: Strategy): Promise<void> {
  // 1. 获取 Post 内容
  // 2. 从所有非 Router 策略中收集 routing 字段，动态组装 prompt
  // 3. 调用 LLM（无 media attachment，轻量调用）
  // 4. 解析 Router 结果，写入 router_results 表
  // 5. 通知 scheduler 可以继续为该 Post 生成分析 Job
}
```

## 4. API 变更

### 4.1 `POST /api/tasks` 创建任务

新增参数：

```json
{
  "name": "分析我的素材库",
  "router_strategy_id": "content-strategy-router",
  "candidate_strategy_ids": [
    "creative-copy-deconstruct",
    "creative-image-style",
    "creative-video-style",
    "creative-topic-angle"
  ]
}
```

后端逻辑：
1. 创建 Task
2. 创建 data-prep Step（step_order=1，状态 pending）
3. 创建 Router Step（step_order=2，状态 pending）
4. 为所有 `candidate_strategy_ids` 预创建分析 Step（step_order=3，状态 pending）
5. 各分析 Step 的 `stats.total` 初始为 0，Router 完成后更新为实际适用数

### 4.2 `GET /api/tasks/:id` 任务详情

所有新增字段仅在 Task 存在 Router Step 时返回非空值；无 Router Step 时返回空数组/null，保持向后兼容。

响应新增字段：

```typescript
{
  // 现有字段不变...

  // 新增：策略维度统计
  "strategy_stats": [
    {
      "strategy_id": "creative-copy-deconstruct",
      "strategy_name": "文案解构",
      "applicable_count": 15,
      "done_count": 12,
      "processing_count": 2,
      "failed_count": 1
    }
    // ...
  ],

  // 新增：逐 Post 阶段状态（替代原 postStatuses 中的大部分逻辑）
  "post_statuses": [
    {
      "postId": "post_1",
      "title": "爆款文案结构拆解",
      "platformId": "xhs",
      // 数据准备阶段
      "dataPrepStatus": "done",
      // 路由阶段
      "routerStatus": "completed",       // pending | running | completed | failed
      "routerApplicableCount": 4,         // Router 判定适用几个策略
      // 分析阶段（聚合）
      "analysisDoneCount": 3,
      "analysisTotalCount": 4,            // = routerApplicableCount
      // 细粒度路由详情（按需加载，可单独接口或仅在展开时请求）
      "routerDecisions": {
        "applicable": ["creative-copy-deconstruct", "creative-image-style", "creative-topic-angle"],
        "skipped": [
          { "strategy_id": "creative-video-style", "reason": "帖子无视频" }
        ]
      }
    }
  ]
}
```

### 4.3 新增 API：`GET /api/tasks/:id/routing`

返回完整的路由决策矩阵：

```typescript
{
  "task_id": "task_1",
  "router_step_id": "step_xxx",
  "decisions": [
    {
      "post_id": "post_1",
      "applicable": [
        { "strategy_id": "creative-copy-deconstruct", "confidence": 0.9, "checks": [...] },
        { "strategy_id": "creative-image-style", "confidence": 0.8, "checks": [...] }
      ],
      "skipped": [
        { "strategy_id": "creative-video-style", "reason": "帖子无视频", "checks": [...] }
      ]
    }
  ]
}
```

## 5. UI 变更

### 5.1 PipelineMatrix——条件渲染

根据 Task 是否有 Router Step 决定渲染模式：

**有 Router Step（路由模式）**：固定 3 列

```
         帖子              数据准备    路由      分析进度
 Post_A  爆款文案结构...     ✅         ✅       3/4
 Post_B  这个配色绝了...     ✅         ✅       1/3
 Post_C  短视频拆解思路      ✅         ✅       2/2
 Post_D  随手拍             ✅         ✅       0/1
```

- **分析进度列**：数字 `done/applicable`，hover 显示适用策略明细
- 路由列"✅"可点击，展开该 Post 的路由证据面板（侧边栏或弹窗）
- 路由列"❌"表示 Router 执行失败，可 hover 看错误信息

**无 Router Step（传统模式）**：保持现有 N+1 列布局

```
         帖子              数据准备    文案解构   图片风格   视频风格   话题角度
 Post_A  爆款文案结构...     ✅         ✅        ✅        ⏳        ✅
 Post_B  这个配色绝了...     ✅         ✅        ✅        ✅        ✅
```

无 Router Step 时行为与当前完全一致，无任何视觉或交互变化。

### 5.2 TaskTimeline——条件渲染

**有 Router Step**：固定 3 阶段

```
阶段1: 数据准备    ████████ 100%  (20/20)
阶段2: 内容路由    ████████ 100%  (20/20 已判定)
阶段3: 策略分析    ████░░░░  50%  (30/60 jobs)
```

阶段 3 的进度是所有策略 Job 的合计。策略维度的明细在 StrategyStats 组件。

**无 Router Step**：保持现有 N 阶段布局（数据准备 + 每个分析 Step 各一个 Phase）。现有行为完全不变。

### 5.3 新增 StrategyStats 组件

策略维度的数量统计（非进度），放在 Timeline 和 Matrix 之间：

```
策略覆盖统计
┌──────────────────┬────────┬────────┬────────┬────────┐
│ 策略              │ 适用    │ 已完成  │ 进行中  │ 失败   │
├──────────────────┼────────┼────────┼────────┼────────┤
│ 文案解构          │  15    │  12    │   2    │   1    │
│ 图片视觉风格      │   8    │   8    │   0    │   0    │
│ 视频视觉风格      │   3    │   1    │   1    │   1    │
│ 话题角度          │  18    │  10    │   5    │   3    │
└──────────────────┴────────┴────────┴────────┴────────┘
```

数据来源：`task.strategy_stats`

### 5.4 TaskDetail 页面布局

**路由模式**（有 Router Step）：

```
┌────────────────────────────────────────┐
│ TaskHeader（名称、状态、时间）           │
├────────────────────────────────────────┤
│ KpiCards（Job 总数/完成/失败/进行中）    │
├────────────────────────────────────────┤
│ TaskTimeline（3 阶段进度条）            │
├────────────────────────────────────────┤
│ StrategyStats（策略覆盖统计表格）        │
├────────────────────────────────────────┤
│ PipelineMatrix（Post × 阶段状态矩阵）    │
└────────────────────────────────────────┘
```

**传统模式**（无 Router Step）：

```
┌────────────────────────────────────────┐
│ TaskHeader（名称、状态、时间）           │
├────────────────────────────────────────┤
│ KpiCards（Job 总数/完成/失败/进行中）    │
├────────────────────────────────────────┤
│ TaskTimeline（N 阶段进度条，遍历 steps） │
├────────────────────────────────────────┤
│ PipelineMatrix（Post × Step 状态矩阵）   │
└────────────────────────────────────────┘
```

传统模式不显示 StrategyStats（无路由时 `applicable_count` = 全量 Post 数，统计无增量信息）。

## 6. 实现顺序

### Phase 1：Schema + 策略定义（纯 core）

- [ ] `strategies` 表 migration：加 `is_router`、`routing`
- [ ] 创建 `router_results` 表
- [ ] `validateStrategyJson` 支持 `routing` 字段校验
- [ ] 4 个内置策略补 `routing` 字段
- [ ] 新建 `content-strategy-router` 策略 JSON（含 prompt + output_schema）

### Phase 2：Router 执行链路（core + api）

- [ ] `router-results.ts`：CRUD（insert/get/exists）
- [ ] Worker 新增 `processRouterJob`
- [ ] Scheduler `buildJobsForPost` 支持 `routerResults` 过滤
- [ ] Daemon prepare 阶段插入路由阶段 + Step stats 更新（total 改为适用数）

### Phase 3：API

- [ ] `POST /api/tasks` 支持 `router_strategy_id` + `candidate_strategy_ids`
- [ ] `GET /api/tasks/:id` 响应新增 `strategy_stats` + `post_statuses` 扩展
- [ ] `GET /api/tasks/:id/routing` 路由详情接口

### Phase 4：UI

- [ ] `PipelineMatrix` 简化：3 列 + 路由展开面板
- [ ] `TaskTimeline` 重构：固定 3 阶段
- [ ] `StrategyStats` 新组件
- [ ] `TaskDetail` 页面布局重组

### Phase 5：CLI + 测试

- [ ] CLI 支持 `analyze run --auto-route`
- [ ] Router 策略单元测试
- [ ] 动态路由集成测试
- [ ] API e2e 测试

---

## 附录 A：4 个内置策略的 routing 字段

### creative-copy-deconstruct（文案解构）

```json
{
  "routing": {
    "availability": { "requires_text": { "min_sentences": 3 } },
    "applicability_checks": [
      { "id": "has_hook", "question": "正文是否存在「钩子句」（开头抓注意力的句子）？", "evidence_field": "hook_quote", "kind": "boolean" },
      { "id": "has_narrative_body", "question": "正文是否有叙事推进段（论述/讲故事/举例/对比）而非仅下结论？", "evidence_field": "body_summary", "kind": "text" },
      { "id": "has_cta_or_close", "question": "正文是否有收束句或CTA？", "evidence_field": "cta_quote", "kind": "boolean" }
    ],
    "boundary_false_positives": [
      "正文以图片描述为主（如「看看这个」），缺乏独立文案结构",
      "正文是纯搬运/引用他人内容，无原创性",
      "正文是列表式罗列且无论述展开"
    ]
  }
}
```

### creative-image-style（图片视觉风格）

```json
{
  "routing": {
    "availability": { "requires_media": { "image": 1 } },
    "applicability_checks": [
      { "id": "has_image_mention", "question": "正文中是否讨论或暗示了图片的视觉设计（提到排版/配色/构图/字体/风格等词）？", "evidence_field": "image_description", "kind": "text" },
      { "id": "not_meme_only", "question": "图片是否为有视觉设计的创作（而非表情包/gif贴纸/聊天截图/白底图）？", "kind": "boolean" }
    ],
    "boundary_false_positives": [
      "帖子图片是表情包/gif 贴纸/聊天截图 — 不构成视觉设计体系",
      "帖子图片是纯产品白底图 — 无可提取风格"
    ]
  }
}
```

### creative-video-style（视频视觉风格）

```json
{
  "routing": {
    "availability": { "requires_media": { "video": 1 } },
    "applicability_checks": [
      { "id": "has_video_description", "question": "正文是否对视频内容有描述（不只是一个视频链接）？", "evidence_field": "video_description", "kind": "text" },
      { "id": "has_editing", "question": "视频是否明显有剪辑（非一镜到底监控/直播录屏/纯口播单镜头）？", "kind": "boolean" },
      { "id": "has_visual_variety", "question": "视频是否有镜头切换/场景变化/视觉层次（而非全程同一角度）？", "kind": "boolean" }
    ],
    "boundary_false_positives": [
      "纯口播单镜头 — 无可提取视觉节奏",
      "直播回放 — 非剪辑作品，无分镜结构",
      "监控/屏幕录制 — 无创作意图"
    ]
  }
}
```

### creative-topic-angle（话题角度）

```json
{
  "routing": {
    "availability": { "requires_text": { "min_sentences": 2 } },
    "applicability_checks": [
      { "id": "has_stance", "question": "内容是否表达了明确的「立场」或「观点」（非中性信息罗列）？", "kind": "boolean" },
      { "id": "has_tension", "question": "是否存在可辨识的认知张力（反常识/对比/揭秘/误区纠正/个人经历）？", "evidence_field": "tension_type", "kind": "text" },
      { "id": "has_payoff", "question": "读者读完是否有明确的获得（认知/情绪/方法/谈资）？", "kind": "boolean" }
    ],
    "boundary_false_positives": [
      "纯教程/How-to 无观点（如「三步学会剪视频」）— 有方法无角度",
      "纯情绪宣泄无结构（如「今天好累不想上班」）— 有情绪无公式",
      "新闻快讯/信息通告 — 无作者视角"
    ]
  }
}
```

## 附录 B：Router Strategy Prompt

```
你是一个内容质量评估器。你的任务是逐条判断一个帖子是否具备被某个下游分析策略「解构」的原材料。

对下面列出的每个策略，你必须：
1. 逐条检查该策略声明的 applicability_checks
2. 从帖子中找到具体证据
3. 输出 { applicable: true/false, confidence: 0-1, checks: [...], rejection_reason }

判断原则：
- "有原材料" ≠ "分析结果会好"。你只判断内容是否具备可分析的基本元素
- 宁可漏判（漏一个策略），不要误判（把一个没有图片的帖子判给图片分析策略）
- 检查 boundary_false_positives——如果帖子命中负样本描述，应判不适用
- 如果帖子正文或元信息不足以做出判断，confidence 应降低，但 applicable 可留为 true（交给下游策略自行判断）

各策略判据清单：

{{strategy_list_with_checks}}

---
帖子内容:
标题: {{title}}
正文: {{content}}
作者: {{author_name}}
平台: {{platform}}
媒体数量: 图片 {{image_count}} 张，视频 {{video_count}} 个
媒体 URL 列表: {{media_urls}}

严格按 JSON schema 输出。不要附加任何解释或 Markdown。
```

其中 `{{strategy_list_with_checks}}` 由 Worker 在调用前动态组装——遍历所有非 Router 策略，注入各自的 `routing.applicability_checks` 和 `routing.boundary_false_positives`。

## 附录 C：Router Strategy Output Schema

```json
{
  "type": "object",
  "required": ["decisions"],
  "properties": {
    "decisions": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["strategy_id", "applicable", "confidence"],
        "properties": {
          "strategy_id": { "type": "string" },
          "applicable": { "type": "boolean" },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "checks": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["check_id", "passed"],
              "properties": {
                "check_id": { "type": "string" },
                "passed": { "type": "boolean" },
                "evidence": { "type": "string" }
              }
            }
          },
          "rejection_reason": { "type": "string" }
        }
      }
    }
  }
}
```

## 附录 D：分析结论——多策略合并 vs 分开调用

经讨论确认：保持当前架构的**分开调用**方式，不合并多个策略的 LLM 分析。理由：

1. **注意力聚焦**：单任务时模型注意力不分散，多字段深度推理质量更高
2. **Schema 约束力**：每个策略的 JSON Schema 独立生效，合并后约束被稀释
3. **错误隔离**：一个策略失败不污染其他策略的结果

Router 的存在使得成本问题不再显著——不适合的策略根本不会被调用。

## 附录 E：UI 状态枚举

PipelineMatrix 分析进度列的状态底色：

| 状态 | 展示 | CSS 类 |
|------|------|--------|
| 全部完成 (done == applicable, applicable > 0) | ✅ 绿色底色 |
| 部分完成 (done > 0, done < applicable) | 🔄 蓝色底色 |
| 尚未开始 (done == 0, applicable > 0) | ⏳ 灰色底色 |
| 无适用策略 (applicable == 0) | — 浅灰色，不可点击 |

Router 列：

| 状态 | 展示 |
|------|------|
| pending | ⏳ |
| running | 🔄 |
| completed | ✅ 可点击展开证据 |
| failed | ❌ 可 hover 看错误 |
