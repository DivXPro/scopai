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
│   └─ 下游仅处理 class ∈ {signal, insight} 的评论
│
├── Step 2a: comment-sentiment (target=comment, batch, depends_on=comment)
│   └─ 情感分析
│
├── Step 2b: comment-intent (target=comment, batch, depends_on=comment)
│   └─ 意图分类
│
└── Step 3: post-comment-worth (target=post, depends_on=comment)
    └─ 聚合该帖所有评论分析结果，产出评论侧素材价值分
```

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

`comment-quality-gate` 完成分析后，分类结果存入策略结果表。后续 comment-targeting 策略需要知道哪些评论通过了质量门控。

**方案：在 scheduler 构建 job 时查询门控结果**

在 `resolveTargetsForPost` 中，对于 `depends_on: 'comment'` 的策略：
1. 查询 `depends_on_step_id` 对应的上游 step 的策略结果表
2. 过滤 `class IN ('signal', 'insight')` 的 target_id
3. 仅为这些评论创建 downstream job

```typescript
// 伪代码：scheduler 中的过滤逻辑
if (strategy.depends_on === 'comment' && step.depends_on_step_id) {
  const upstreamStrategyId = getStepStrategyId(step.depends_on_step_id);
  const results = await queryGateResults(upstreamStrategyId, taskId);
  const qualifiedIds = results
    .filter(r => r.class !== 'shallow')
    .map(r => r.target_id);
  targets = targets.filter(t => qualifiedIds.includes(t.target_id));
}
```

## 与 content-strategy-router 的互补关系

| 维度 | content-strategy-router | comment-quality-gate |
|------|------------------------|---------------------|
| 所属 Task | Task A（内容评估） | Task B（评论评估） |
| 分析对象 | 帖子正文 | 评论内容 |
| 回答的问题 | 这篇帖子有没有某类原材料？ | 这篇帖子的评论有没有额外价值？ |
| 输出 | 每个下游策略的 applicable + confidence | 每条评论的 shallow / signal / insight |
| 作用阶段 | 分析前（路由决策） | 分析前（评论筛选） |
| 成本 | 每帖 1 次 LLM 调用 | 每帖 ≈1 次 LLM 调用（Stage 0 规则滤掉大部分后） |

两者通过跨 Task 聚合层汇合：路由器说"这篇帖子有文案创作原材料"，质量门控说"但评论区全是灌水，受众没深度互动"——这对帖子素材价值的判断比单独使用任一方都更完整，但两条结论的产出互不阻塞。

## 成本估算

假设一个典型帖子有 100 条评论：

| 方案 | LLM 调用次数 | 每条评论成本 |
|------|------------|-----------|
| 纯 LLM（无规则预筛） | 5 次（100/20） | 100% |
| 规则 + LLM（预筛 70%） | 1-2 次（30/20） | ~30% |
| 纯规则（无 LLM） | 0 | 0%（但误判率高） |

最优策略：规则预筛 + LLM 批量精分，成本约为纯 LLM 方案的 30%。

## 实现边界

1. **规则预筛**：在 `packages/core/src/shared/utils.ts` 或新建 `packages/core/src/shared/comment-filter.ts` 中实现，供 scheduler 调用
2. **comment-quality-gate 策略**：以 JSON 文件定义，通过 `strategy import` 导入作为可选预置策略
3. **scheduler 过滤衔接**：在 `packages/api/src/daemon/scheduler.ts` 的 `resolveTargetsForPost` 中增加 upstream gate 结果查询和过滤逻辑
4. **模板库维护**：浅层评论正则模板独立为配置文件（`packages/core/src/shared/comment-shallow-patterns.ts`），方便根据平台和语言扩展
5. **不改变 Comment 表结构**：质量分类结果仅存储在策略结果表中，不在 Comment 记录上冗余

## 参考来源

- Google Perspective API：分级过滤架构（规则 → ML → 人工复审）
- Disqus 评论质量系统：基于文本特征的浅层评论启发式规则
- Hsu et al. (2009) "Predicting Comment Quality on Social Media"：字符熵、可读性、情感极性三特征回归模型
- Berger & Milkman (2012) "What Makes Online Content Viral"：高唤醒情绪与内容传播的关系
