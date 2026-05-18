# 评论质量门控策略设计

## 背景

`content-strategy-router` 已能根据帖子内容判定其是否适用于各下游创意解构策略，但该判定完全基于帖子正文——评论数据虽已采集入库，却未参与帖子素材价值的评估。

**核心问题**：一条帖子的"值得被二次创作"不仅体现在正文本身，还体现在评论区。高价值帖子往往能在评论区引发深度讨论、争议或需求表达。这些信号是正文无法提供的。

**约束**：采集数据仅覆盖评论内容文本，无用户画像、历史行为、点赞/回复数等元数据可作为分析材料。一切判断只能以评论文本内容为唯一信源。

## 目标

1. 设计一套仅依赖评论文本内容的质量分级机制，将评论分为 `shallow / signal / insight` 三类
2. 通过规则预筛降低 LLM 调用成本，规则层目标过滤率 60-70%
3. 以 `comment-quality-gate` 策略作为后续情感分析、意图挖掘等 comment-targeting 策略的前置过滤器
4. 与 `content-strategy-router` 互补：路由器判定"帖子有没有这类原材料"，质量门控提供"评论有没有额外价值信号"

## 核心设计

### 过滤原则

**用规则解决 70%，用 LLM 解决剩余 30%。**

一个帖子通常有数十到数百条评论，全部喂给 LLM 做三维分类（shallow/signal/insight）既慢又贵。基本事实是：绝大多数浅层评论在文本层面就有明显模式特征，规则足以高精度识别。

### 两级架构

```
Stage 0: 规则预筛（零 LLM 成本）
  ├─ 输入：全部评论
  ├─ 判断：shallow / 非 shallow
  ├─ 手段：代码层正则 + 模板库匹配
  ├─ 期望过滤率：60-70%
  └─ 输出：标为 shallow 的直接入库，非 shallow 的送入 Stage 1

Stage 1: LLM 批量精分（仅对剩余 ~30% 边界评论）
  ├─ 输入：Stage 0 无法判定的非 shallow 评论
  ├─ 判断：shallow / signal / insight 三维分类
  ├─ 手段：comment-targeting 策略 + batch_config
  └─ 输出：signal + insight 评论进入下游分析管道
```

### Stage 0：规则预筛设计

**判断逻辑**：规则层不做三维分类，只判断"是否可以确定是浅层评论"。无法确定的评论交给 LLM。

**浅层评论模板库**（正则匹配）：

```
纯互动附和:
  └─ /^[哈嘿呵嘻呵]{2,}$/
  └─ /^(hh|233|666|草|卧槽|(*^▽^*))+$/i
  └─ /^牛[逼批]?[!！]*$/

模板化附和（完整匹配）:
  └─ "学到了" / "收藏了" / "已阅" / "先赞后看" / "说得好"
  └─ "支持" / "加油" / "顶" / "打卡" / "沙发" / "前排"
  └─ "学习了" / "mark" / "码住" / "先马后看" / "感谢分享"

无实义评论:
  └─ 去除 emoji、标点、@mention、#话题 后有效字符数 < 4
  └─ 纯表情/emoji（Unicode Emoji 范围）
  └─ 纯标点符号
  └─ 仅含 @mention 无正文
```

**非 shallow 信号**（辅助规则，用于反向排除）：

```
潜在信号评论:
  └─ 含 "？" 或 "?"（疑问句）
  └─ 含转折词："但是" / "不过" / "可是" / "然而"
  └─ 含立场词："我觉得" / "个人认为" / "不同意" / "有道理但"
  └─ 句子数 >= 3（以 。！？.!? 为分隔符）
  └─ 有效字符 >= 50
```

规则预筛的结果不存储在策略结果表中，而是通过以下方式传递：
- 在 scheduler 构建 comment-targeting 策略 job 时，跳过已被规则标记为 shallow 的评论（不创建 queue_job）
- 或者在 job 创建后、worker 消费前通过检查跳过

**实现位置**：在 `resolveTargetsForPost` 或 scheduler 的 job 构建阶段增加 shallow 预检，避免为 shallow 评论创建无效 job。

### Stage 1：LLM 批量精分设计

#### 策略定义

```json
{
  "id": "comment-quality-gate",
  "name": "评论质量门控",
  "description": "判断评论是否包含新增信息，将评论分为 shallow/signal/insight 三类",
  "version": "1.0.0",
  "target": "comment",
  "batch_config": {
    "enabled": true,
    "size": 20,
    "max_batch_size": 30
  },
  "prompt": "你是一个内容质量分类器。你的任务是判断每条评论是否包含【新增信息】。\n\n分类标准：\n\nshallow — 读完评论后，没有获得任何新信息。包括：\n- 纯附和：\"说得好\"、\"支持\"、\"学到了\"\n- 纯互动：\"哈哈哈\"、\"第一\"、\"打卡\"\n- 无意义表情或标点\n\nsignal — 评论包含至少一个可被解读的信息点。包括：\n- 明确的态度或偏好（喜欢/不喜欢某个点）\n- 一个问题（即使只有一句话）\n- 一个简短但具体的反馈\n\ninsight — 评论包含结构化的信息增量。至少满足以下一项：\n- 包含个人经验或亲身经历\n- 包含推理过程或反驳理由\n- 多句话构成的信息结构（3 句及以上有逻辑关联的话）\n- 提供了原文未覆盖的新角度或补充信息\n\n判断原则：\n- 只以评论内容本身做判断，忽略作者名、点赞数\n- 边界样本倾向判为 signal（宁可多留，不要漏杀）\n- 如果一条评论既有附和成分又有独立信息，以独立信息为准\n\n返回 JSON 数组，每个元素对应一条评论的分类结果：\n\n[\n  {\"index\": 0, \"class\": \"shallow\"},\n  {\"index\": 1, \"class\": \"signal\"},\n  {\"index\": 2, \"class\": \"insight\"}\n]\n\n以下是待分类的评论：\n{{batch_items}}",
  "output_schema": {
    "type": "object",
    "properties": {
      "index": { "type": "integer", "title": "评论序号" },
      "class": {
        "type": "string",
        "enum": ["shallow", "signal", "insight"],
        "title": "质量分类"
      }
    }
  },
  "needs_media": { "enabled": false }
}
```

#### Prompt 设计要点

1. **单维度判断**：只判断"有无新信息"，不做多维质量评分。单维度判断的 LLM 准确率远高于多维度。
2. **容忍边界模糊**：明确"边界样本倾向判为 signal"，减少漏杀——下游分析策略还有机会二次过滤。
3. **批量上下文**：20 条评论一次提交，LLM 可以在对比中更准确判断相对深度。批量格式使用带序号的文本块，而非 JSON 输入，减少 token 消耗。

#### 批量格式（`{{batch_items}}` 占位符）

Worker 在构建 prompt 时，将评论列表格式化为：

```text
[评论 1]
评论内容第一句...

[评论 2]
评论内容第二句...
```

而非将评论以 JSON 形式嵌入 prompt。纯文本批量比 JSON 批量节省约 30% token。

### 策略流水线：内容分析与评论分析独立解耦

内容侧分析和评论侧分析应作为**两个独立 Task**，而非混在一个 Task 中用 step 串行。各自有独立的生命周期、触发时机和重跑需求。

```
Task A: "内容素材评估"（独立）
│
├── Step 1: content-strategy-router (target=post)
│   └─ 判定帖子对各下游策略的适用性
│
├── Step 2a: creative-copy-deconstruct (target=post)
├── Step 2b: creative-visual-style (target=post)
├── Step 2c: creative-topic-angle (target=post)
│
└── Step 3: post-content-worth (target=post, depends_on=post)
    └─ 聚合 Step 1+2 结果，产出内容侧素材价值分


Task B: "评论深度评估"（独立）
│
├── Step 1: comment-quality-gate (target=comment, batch)
│   └─ Stage 0 规则预筛 → Stage 1 LLM 批量三分
│
├── Step 2a: comment-sentiment (target=comment, batch)
│   └─ 对通过 gate 的评论做情感极性 + 情绪强度分析
│   └─ gate 过滤在 scheduler 层完成，策略本身不依赖 gate
│
├── Step 2b: comment-intent (target=comment, batch)
│   └─ 对通过 gate 的评论做意图分类
│   └─ 同上，gate 过滤在 scheduler 层
│
└── Step 3: post-comment-worth (target=post)
    └─ 聚合该帖所有评论分析结果，产出评论侧素材价值分
```

**关于 depends_on**：Step 2a/2b 的 gate 过滤在 scheduler 构建 job 时通过 `GateFilterContext` 实现，策略自身的 `depends_on` 为 `null`，保持 `batch_config` 可用。Step 3 作为 post 级聚合，需要 Worker 额外支持——详见下文 post-comment-worth 设计。

**为何解耦**：

| 场景 | 混在一个 Task 里的问题 | 解耦后的行为 |
|------|----------------------|------------|
| 只想跑内容分析，评论还没采集 | 得手动跳过 comment step | 直接跑 Task A |
| 采集了更多评论，想追加评估 | 得重建 task 或追加 step | 新跑一次 Task B 即可 |
| quality-gate 规则优化，想重算 | 需重跑整个 task | 只重跑 Task B |
| 两个维度想独立看结果 | Step 间耦合，不好拆分 | 各自有独立的结果表 |

**跨 Task 聚合**：最终的综合素材价值评分，由上层查询同时读取 Task A 和 Task B 的结果表做聚合，不要求它们属于同一个 Task。聚合层通过 `post_id` 关联两条 task 的产出：

```sql
-- 伪代码：跨 task 聚合素材价值
SELECT
  p.id as post_id,
  p.title,
  cr.creative_score,          -- 来自 Task A 结果表
  cw.comment_worth_score,     -- 来自 Task B 结果表
  (cr.creative_score * 0.6 + cw.comment_worth_score * 0.4) as composite_score
FROM posts p
LEFT JOIN results_task_a cr ON cr.post_id = p.id
LEFT JOIN results_task_b cw ON cw.post_id = p.id;
```

权重可配置，不写死在策略中。

### 下游策略的过滤衔接

`comment-quality-gate` 完成分析后，分类结果存入策略结果表（`class` 列为 `TEXT`，取值 `shallow / signal / insight`）。后续 comment-targeting 策略在 scheduler 构建 job 时直接查询 gate 结果表过滤 target，**不依赖 `depends_on` 链路**。

理由：
- 有 `depends_on` 的策略不能走批量（当前 `consumer.ts` 限制），下游退化为逐条调用
- gate 结果 `{class: "signal"}` 对下游情感/意图分析无实际参考价值，注入 prompt 无意义
- scheduler 层过滤让下游保持 `depends_on: null` + `batch_config.enabled`，全链路批量

**方案：`buildJobsForPost` 接收 `GateFilterContext` 参数**

```typescript
interface GateFilterContext {
  enabled: boolean;              // task 中有 quality-gate step
  strategyId: string;            // 'comment-quality-gate'
  results: Map<string, string>;  // comment_id → class（仅 signal+insight）
}
```

在 `buildJobsForPost` 的 step 循环中：

```typescript
// 对非 gate 的 comment-targeting 步骤做 gate 过滤
if (
  strategy.target === 'comment' &&
  step.strategy_id !== gateFilter?.strategyId &&
  gateFilter?.enabled
) {
  if (gateFilter.results.size === 0) {
    continue; // gate 未运行 → 跳过，等 gate 完成后重新调度
  }
  finalTargets = targets.filter(t => {
    const cls = gateFilter.results.get(t.target_id);
    return cls === 'signal' || cls === 'insight';
  });
}
```

**触发机制**：`processCommentBatch` 每批 gate 结果入库后，调用 `triggerDownstreamJobs` 重新执行 `buildJobsForPost`。`existingTargets` 保证已创建的 job 不重复。当 gate 最后一批完成时，所有下游 job 全部就位。

**效果**：

| 方案 | 下游调用次数（100 条评论） | 下游可用 batch |
|------|--------------------------|---------------|
| depends_on 链 | 30+30=60 次（逐条） | 否 |
| scheduler 层过滤 | 2+2=4 次（20/批） | 是 |

### 下游策略：comment-sentiment（评论情感分析）

**定位**：对通过 gate 的评论做情感极性和情绪强度分析，产出该帖受众情感分布。

**target**: `comment`
**batch_config**: `{ enabled: true, size: 20 }`
**depends_on**: `null`（gate 过滤在 scheduler 层）

**Prompt**:

> 你是一个评论情感分析器。分析每条评论的情感倾向和情绪强度。
>
> 情感极性：
> - positive — 正面评价、赞同、喜爱、推荐、肯定
> - negative — 负面评价、批评、不满、反对、失望
> - neutral — 中性陈述、客观说明、不表态的提问
> - mixed — 同时包含正面和负面（如"效果还行但是太贵了"）
>
> 情绪强度（1-3）：
> - 1 — 温和、理性、平铺直叙
> - 2 — 有明显情绪色彩但不激烈
> - 3 — 强烈情绪，如愤怒、欢呼、激动、嘲讽
>
> 判断原则：只以评论文本内容为准。极性判断关注态度方向，强度判断关注情绪浓度。
>
> 待分析评论：
> {{batch_items}}

**Output Schema**:

```json
{
  "type": "object",
  "properties": {
    "sentiment": {
      "type": "string",
      "title": "情感极性",
      "enum": ["positive", "negative", "neutral", "mixed"]
    },
    "intensity": {
      "type": "integer",
      "title": "情绪强度",
      "minimum": 1,
      "maximum": 3
    }
  }
}
```

**对帖子素材价值的意义**：

- 正面评论占比高 → 内容获得了认可，有受众共鸣
- 负面评论中有具体理由 → 存在争议点，可做对比类二次创作
- high intensity 评论 → 话题激发了真实情绪，有传播潜能
- mixed 评论占比高 → 内容有讨论空间，可做多角度分析

---

### 下游策略：comment-intent（评论意图分类）

**定位**：对通过 gate 的评论做意图分类，从评论中挖掘内容创作机会。

**target**: `comment`
**batch_config**: `{ enabled: true, size: 20 }`
**depends_on**: `null`（gate 过滤在 scheduler 层）

**Prompt**:

> 你是一个评论意图分类器。分析每条评论背后的意图和可挖掘价值。
>
> 意图分类：
> - question — 提问（如何做、在哪里买、什么意思），表示受众有信息缺口
> - suggestion — 建议/补充（应该试试 X、建议加 Y），表示受众有未被满足的需求
> - counterargument — 反驳/异议（不同意/有问题/纠正），表示存在争议或认知差异
> - personal_story — 个人故事/经验分享（我也遇到过/我们公司也...），表示内容引发了共鸣
> - agreement — 赞同附议（说得对/确实如此/好文推荐），表示内容获得了认可
> - usage_feedback — 使用体验反馈（买了/用了/效果如何），表示产品/方法有实际用户
> - off_topic — 偏离主题（与帖子内容无关的讨论）
> - other — 以上都不匹配
>
> 如果一条评论同时有多个意图，选最主导的。
> 对 question/suggestion/counterargument/personal_story 类评论，额外提取一句"创作提示"（30字以内），说明这条评论可能启发出什么内容角度。其余意图的创作提示留空字符串。
>
> 待分析评论：
> {{batch_items}}

**Output Schema**:

```json
{
  "type": "object",
  "properties": {
    "intent": {
      "type": "string",
      "title": "意图分类",
      "enum": ["question", "suggestion", "counterargument", "personal_story", "agreement", "usage_feedback", "off_topic", "other"]
    },
    "creative_hint": {
      "type": "string",
      "title": "创作提示"
    }
  }
}
```

**对帖子素材价值的意义**：

| 意图 | 含义 | 创作价值 |
|------|------|---------|
| question | 受众有信息缺口 | → "X 的常见疑问解答" |
| suggestion | 受众的改进需求 | → "Y 的进阶玩法/优化技巧" |
| counterargument | 存在争议 | → "关于 Z 的正反两方面分析" |
| personal_story | 引发真实共鸣 | → 用户故事合集 / 案例分析素材 |
| usage_feedback | 有实际使用数据 | → 产品评测 / 横向对比素材 |

每条 `creative_hint` 是一句话级别的创作灵感，聚合到 post 级别后形成该帖的"可创作方向清单"。

---

### 下游策略：post-comment-worth（帖子评论综合价值评估）

**定位**：聚合一条帖子下所有评论分析结果，产出一个综合价值评分 + 定性摘要。这是评论侧分析管线的最终产出。

**target**: `post`
**depends_on**: `null`
**batch_config**: `null`

**与 comment 级策略的关键区别**：前三个策略（quality-gate、sentiment、intent）面向单个 comment，批量执行。post-comment-worth 面向单个 post，输入是该 post 的 comment 分析结果聚合，输出一个综合评分。

**实现方式**：post-comment-worth 不是通过 `depends_on` 拿上游结果（每个 comment 一条结果，不是 post 到 post 的映射）。需要 Worker 在处理该 job 时，查询该 post 关联的所有 comment 在 `comment-quality-gate`、`comment-sentiment`、`comment-intent` 三个策略结果表中的数据，聚合为统计摘要后注入 prompt。

Worker 识别方式：策略 JSON 中增加一个新字段 `needs_comment_aggregation`：

```json
{
  "needs_comment_aggregation": {
    "enabled": true,
    "source_strategies": [
      "comment-quality-gate",
      "comment-sentiment",
      "comment-intent"
    ]
  }
}
```

Worker 在处理该策略时：
1. 查询 `source_strategies` 中每个策略的结果表，聚合该 `post_id` 下的所有结果
2. 生成统计数据（分布计数、占比等）
3. 注入 prompt 的 `{{comment_aggregation}}` 占位符

**Prompt**:

> 你是一个内容素材价值评估器。基于帖子的评论分析数据，评估该帖子作为二次创作素材的综合价值。
>
> 评分维度（各 0-10 分）：
>
> 1. **engagement_depth**（参与深度）：评论中 signal+insight 的比例和绝对数量。越多深度评论 = 越高分。
> 2. **sentiment_value**（情感价值）：评论情感分布的创作可利用性。争议性（mixed 多、正负分化大）> 一致好评 > 平淡中性。纯灌水 = 0。
> 3. **reuse_potential**（复用潜力）：评论中 question/suggestion/personal_story/counterargument 的密度。这些意图直接指向可创作的内容方向。
> 4. **audience_insight**（受众洞察）：评论是否揭示了受众的真实需求、痛点或偏好。能从评论中"听到用户声音"的程度。
>
> 综合评分 = 加权平均。权重：engagement_depth 0.2, sentiment_value 0.2, reuse_potential 0.35, audience_insight 0.25。
>
> 此外提供：
> - 一句话总结该帖评论对创作的核心价值
> - 从评论中提取的 3 个具体创作方向建议（如果有）
>
> 评论分析统计数据：
> {{comment_aggregation}}
>
> 帖子原始信息：
> 标题：{{title}}
> 正文摘要：{{content}}

**Output Schema**:

```json
{
  "type": "object",
  "properties": {
    "engagement_depth": {
      "type": "number", "title": "参与深度",
      "minimum": 0, "maximum": 10
    },
    "sentiment_value": {
      "type": "number", "title": "情感价值",
      "minimum": 0, "maximum": 10
    },
    "reuse_potential": {
      "type": "number", "title": "复用潜力",
      "minimum": 0, "maximum": 10
    },
    "audience_insight": {
      "type": "number", "title": "受众洞察",
      "minimum": 0, "maximum": 10
    },
    "composite_score": {
      "type": "number", "title": "综合素材价值分",
      "minimum": 0, "maximum": 10
    },
    "verdict": {
      "type": "string", "title": "一句话价值总结"
    },
    "creative_directions": {
      "type": "array", "title": "创作方向建议",
      "items": { "type": "string" }
    }
  }
}
```

**`{{comment_aggregation}}` 注入格式**（Worker 自动构建）：

```text
评论总数: 100
质量分布: shallow=70, signal=22, insight=8
情感分布: positive=12, negative=7, neutral=8, mixed=3
情绪强度分布: 1级=18, 2级=9, 3级=3
意图分布: question=5, suggestion=3, counterargument=2, personal_story=4, agreement=12, usage_feedback=2, off_topic=1, other=1
创作提示摘录:
  [1] 请问这个适合干皮用吗？ → 可创作：干皮使用注意事项专题
  [2] 试了，确实好用，比A牌强 → 可创作：横向对比评测
  [3] 这个思路不对，应该先... → 可创作：不同方法优劣分析
  ...（最多 10 条）...
```

**实现优先级**：comment-quality-gate 之后最先做的下游策略。它是评论分析管线与"素材价值评估"这一最终目标的桥梁。sentiment 和 intent 为它提供数据输入，但即使没有这两个策略，仅凭 quality-gate 的质量分布也足以产出有参考价值的评分。

**与 content-strategy-router 的最终汇合**：

```
Task A 产出: 帖子 42 → creative_score = 7.2
Task B 产出: 帖子 42 → comment_worth_score = 5.8

跨 Task 聚合: composite = 7.2 × 0.6 + 5.8 × 0.4 = 6.64
```

两条管线独立运行，上层按 post_id 关联结果。权重可在聚合 API 中配置，不写死在策略中。

## 评论分析管线总览

| 策略 | target | batch | 作用 | 输出 |
|------|--------|-------|------|------|
| comment-quality-gate | comment | 20/批 | 质量三分 | shallow / signal / insight |
| comment-sentiment | comment | 20/批 | 情感分析 | sentiment + intensity |
| comment-intent | comment | 20/批 | 意图挖掘 | intent + creative_hint |
| post-comment-worth | post | - | 综合价值评估 | 四个子分 + composite_score + creative_directions |

gate 过滤在 scheduler 层生效：下游 comment 策略仅对 class ∈ {signal, insight} 的评论建 job。post-comment-worth 通过 `needs_comment_aggregation` 获取全量聚合数据。

## 与 content-strategy-router 的互补关系

| 维度 | Task A（内容侧） | Task B（评论侧） |
|------|-----------------|-----------------|
| 分析对象 | 帖子正文 | 评论内容 |
| 回答的问题 | 这篇帖子有没有某类原材料？ | 评论揭示了什么受众态度和创作机会？ |
| 核心策略 | content-strategy-router | comment-quality-gate + sentiment + intent |
| 最终产出 | creative_score（0-10） | composite_score（0-10） + creative_directions |
| 独立运行 | 是 | 是 |

两者通过跨 Task 聚合层汇合：内容侧评估"帖子自身有什么"，评论侧评估"受众怎么看"。对帖子素材价值的判断比单独使用任一方都更完整，但两条管线的产出互不阻塞。

## 成本估算

假设一个典型帖子有 100 条评论，规则预筛过滤 70%：

| 策略 | 调用次数 | 方式 |
|------|---------|------|
| comment-quality-gate | ~2 次（30÷20） | 批量 |
| comment-sentiment | ~2 次（30÷20） | 批量 |
| comment-intent | ~2 次（30÷20） | 批量 |
| post-comment-worth | 1 次 | 单条 |
| **合计** | **~7 次 LLM 调用 / 帖** | |

对比无规则预筛的纯 LLM 方案（5+5+5+1=16 次），成本降低约 55%。对比逐条分析方案（100+100+100+1=301 次），成本降低约 98%。

## Task 详情页自适应渲染

评论分析 Task 与帖子分析 Task 在 PipelineMatrix 上的展示需求不同。当前矩阵以帖子为行、step 为列，每个 cell 是一个 job 的状态。评论分析 Task 中，每个 step 下会批量创建大量 comment job，需要在同一视图下表达不同的粒度。

### 核心差异

| | 帖子分析 Task | 评论分析 Task |
|------|-------------|-------------|
| Job 粒度 | 1 post = 1 job | 1 comment = 1 job，数十个 job 对 1 个 post |
| 行含义 | 帖子 | 帖子（每个帖子下关联多条评论 job） |
| Cell 含义 | post 在该 step 的状态 | 该 post 的所有 comment 在该 step 的聚合进度 |
| 标题 | "相关帖子" | 按 step target 动态："帖子内容分析"/"帖子评论分析" |

### 自适���渲染策略

**不引入新的 task type 机制**，而是让 PipelineMatrix 根据 step 的 `target` 类型自适应：

```
同一个 Task 内可以混合 post-step 和 comment-step：

Task: "帖子综合评估"
├── Step 1: content-strategy-router (target=post)
│   → 矩阵列：每个 post 一个 cell，单状态图标
│
├── Step 2: comment-quality-gate (target=comment)
│   → 矩阵列：每个 post 一个 cell，显示 "done/total"
│   → done = 该 post 下已完成 gate 分析的评论数
│   → total = 该 post 下通过规则预筛的评论数
│
└── Step 3: comment-sentiment (target=comment)
    → 矩阵列：每个 post 一个 cell，显示 "done/total"
    → total = 通过 gate 过滤后的 signal+insight 评论数
```

### PipelineMatrix 变更

**矩阵行**：当前逻辑（`TaskDetail.tsx:379`）从 `allPostIds` 构建行，评论 Task 自然也用 post 作为行分组，无需改变。

**矩阵列**：当前逻辑从 `task.steps` 构建列。需改为按 step 的 `target` 类型生成列标题：

```typescript
// 列名自适应 target 类型
const matrixColumns = task.steps.map(step => ({
  key: step.id,
  name: getStrategyDisplayName(step),
  target: strategies.get(step.strategy_id)?.target ?? 'post',
}));
```

**Cell 渲染**：当前 `StatusCell` 只渲染单个图标（✅⏳🔄⚠️）。需扩展为双模式：

```typescript
// post-target step → 单个状态图标（现有逻辑）
// comment-target step → 进度文本 "done/total"
function StepCell({ stepId, postId, jobs, target }) {
  if (target === 'post') {
    // 现有单状态图标逻辑
    const job = jobs.find(j => j.target_id === postId && j.strategy_id === stepId);
    return <StatusCell status={job?.status ?? 'pending'} />;
  }

  // comment-target：聚合该 post 下所有相关 comment job
  const stepJobs = jobs.filter(j =>
    j.strategy_id === stepId && j.target_type === 'comment'
  );
  const postComments = stepJobs.filter(j => /* j 关联到此 post */);
  const done = postComments.filter(j => j.status === 'completed').length;
  const total = postComments.length;

  return <span className="text-sm">{done}/{total}</span>;
}
```

注意：comment job 自身不直接携带 `post_id`（其 `target_id` 是 comment id），需要 JOIN `comments` 表或从 API 响应中预关联。建议 API `GET /tasks/:id` 返回的 `jobs` 数组增加 `post_id` 字段（comment job 冗余该字段已在 `queue_jobs` 中有或可通过 `comments.post_id` 反查）。

### TaskTimeline 自适应

当前 TaskTimeline 渲染 phases（阶段），每个阶段显示进度条。在混合 Task 中：

- **router 模式**（已有）：数据准备 → 内容路由 → 策略分析（3 阶段）
- **混合模式**（新增）：数据准备 → 帖子分析 → 评论分析（3 阶段）
  - 阶段判定逻辑：steps 中同时存在 `target=post` 和 `target=comment` 的步骤时进入混合模式
  - "帖子分析"阶段聚合所有 post-target step 的进度
  - "评论分析"阶段聚合所有 comment-target step 的进度
- **纯评论模式**（新增）：数据准备 → 评论质量门控 → 评论分析（3 阶段）
  - 阶段判定：所有 step 的 target 均为 `comment`
  - "评论质量门控"阶段对应 quality-gate step
  - "评论分析"阶段聚合所有下游 comment step

### 不增加新 Task type

Task 类型（`tasks.type`）保持不变。Task 属于"帖子分析"还是"评论分析"完全由 steps 内策略的 `target` 决定，UI 按 steps 的组成自适应。一个 Task 可以混合 post 和 comment 策略，UI 同时展示两种列。

## 实现边界

### 当前执行计划覆盖（P0）
1. **规则预筛**：新建 `packages/core/src/shared/comment-filter.ts` + `comment-shallow-patterns.ts`
2. **comment-quality-gate 策略**：JSON 定义 + 种子导入
3. **scheduler 过滤衔接**：`buildJobsForPost` 新增 `GateFilterContext`，`processCommentBatch` 触发下游
4. **模板库**：浅层评论正则独立为配置文件，方便按平台和语言扩展
5. **不改变 Comment 表结构**：所有分析结果存储在策略结果表中

### 后续阶段（P1-P3）
6. **comment-sentiment / comment-intent 策略**：JSON 定义 + 种子导入，复用现有 batch pipeline
7. **post-comment-worth 策略**：JSON 定义 + Worker 支持 `needs_comment_aggregation` 配置
8. **PipelineMatrix 自适应**：按 step.target 切换渲染模式（单状态图标 vs done/total 进度）
9. **TaskTimeline 混合模式**：Task 内同时存在 post/comment step 时拆分阶段
10. **跨 Task 聚合 API**：content-score + comment-score → composite-score

## 参考来源

- Google Perspective API：分级过滤架构（规则 → ML → 人工复审）
- Disqus 评论质量系统：基于文本特征的浅层评论启发式规则
- Hsu et al. (2009) "Predicting Comment Quality on Social Media"：字符熵、可读性、情感极性三特征回归模型
- Berger & Milkman (2012) "What Makes Online Content Viral"：高唤醒情绪与内容传播的关系
