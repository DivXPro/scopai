# 二次分析策略设计

## 概述

基于一个策略的分析结果，运行另一个策略做进一步分析。二次策略的输入是上游策略的结构化分析结果，逐条对应原始帖子/评论，结果存储在独立的结果表中。

依赖关系在策略层面声明"需要上游结果"，具体绑定哪个上游策略在 task step 添加时确定，实现运行时动态绑定。

## 数据模型变更

### Strategy 接口

```typescript
export interface Strategy {
  // ...existing fields...
  depends_on: 'post' | 'comment' | null;  // null = 原始分析策略
  include_original: boolean;               // 是否同时注入原始内容
}
```

- `depends_on: null` — 原始分析策略，输入是帖子/评论内容
- `depends_on: 'post'` — 二次策略，输入是 target='post' 的上游策略结果
- `depends_on: 'comment'` — 二次策略，输入是 target='comment' 的上游策略结果
- `include_original: true` — prompt 中同时注入原始帖子/评论内容

### strategies 表

```sql
ALTER TABLE strategies ADD COLUMN depends_on TEXT CHECK(depends_on IN ('post', 'comment') OR depends_on IS NULL);
ALTER TABLE strategies ADD COLUMN include_original BOOLEAN NOT NULL DEFAULT false;
```

### task_steps 表

```sql
ALTER TABLE task_steps ADD COLUMN depends_on_step_id TEXT REFERENCES task_steps(id);
```

`depends_on_step_id` 在添加 step 时绑定，指定当前 step 依赖哪个上游 step。

## 执行流程

### 添加 Step

```bash
# 添加上游策略 step
scopai task step add --task-id <id> --strategy-id scoring-v1

# 添加二次策略 step，绑定上游 step
scopai task step add \
  --task-id <id> \
  --strategy-id risk-judgment \
  --depends-on-step-id <upstream-step-id>
```

校验规则：
1. 如果策略的 `depends_on` 非 null，必须指定 `--depends-on-step-id`
2. 上游 step 的策略 `target` 必须与当前策略的 `depends_on` 匹配
3. 上游 step 必须属于同一个 task
4. 不允许循环依赖

### Worker 处理

当 worker 处理 `depends_on` 策略的 job 时：

1. 通过 `task_steps.depends_on_step_id` 找到上游 step
2. 通过上游 step 的 `strategy_id` 确定上游结果表 `analysis_results_strategy_{upstream_id}`
3. 用 `target_id` 从上游结果表查询该条目的分析结果
4. 如果 `include_original: true`，同时查询原始帖子/评论内容
5. 将上游结果注入 `{{upstream_result}}` 占位符
6. 如果 `include_original: true`，将原始内容注入 `{{original_content}}` 占位符
7. 调用 LLM，结果存入二次策略的结果表

### Step 排序

`run-all-steps` 按 `depends_on_step_id` 拓扑排序执行，确保上游 step 先完成。

## Prompt 模板

二次策略的 prompt 使用占位符：

```
基于以下分析结果进行风险判定：
{{upstream_result}}

请判断该内容的风险等级...
```

当 `include_original: true` 时：

```
原始内容：
{{original_content}}

分析结果：
{{upstream_result}}

请结合原始内容和分析结果，判断风险等级...
```

## 结果存储

与现有策略完全一致——每个二次策略有自己的 `analysis_results_strategy_{id}` 结果表。通过 `target_id` 与上游结果关联，查询时 JOIN：

```sql
SELECT r1.*, r2.*
FROM analysis_results_strategy_{upstream_id} r1
JOIN analysis_results_strategy_{downstream_id} r2
  ON r1.target_id = r2.target_id AND r1.task_id = r2.task_id
WHERE r1.task_id = ?
```

## 策略 JSON 示例

```json
{
  "id": "risk-judgment-v1",
  "name": "风险判定",
  "description": "基于评分结果进行风险等级判定",
  "version": "1.0.0",
  "target": "post",
  "depends_on": "post",
  "include_original": true,
  "prompt": "原始内容：\n{{original_content}}\n\n评分结果：\n{{upstream_result}}\n\n请结合原始内容和评分结果，判断该内容的风险等级...",
  "output_schema": {
    "type": "object",
    "properties": {
      "risk_level": { "type": "string", "enum": ["low", "medium", "high", "critical"] },
      "risk_factors": { "type": "array", "items": { "type": "string" } },
      "explanation": { "type": "string" }
    },
    "required": ["risk_level", "risk_factors", "explanation"]
  }
}
```

## CLI 变更

### task step add

新增 `--depends-on-step-id` 选项：

```bash
scopai task step add \
  --task-id <id> \
  --strategy-id <id> \
  [--depends-on-step-id <upstream-step-id>] \
  [--name <name>] \
  [--order <n>]
```

### task step list

显示依赖关系：

```
Step  Strategy          Depends On        Status
1     scoring-v1        -                 completed
2     risk-judgment-v1  step 1 (scoring)  pending
```

### strategy import

支持 `depends_on` 和 `include_original` 字段的校验。

## 向后兼容

- `depends_on` 默认为 null，现有策略不受影响
- `include_original` 默认为 false
- `task_steps.depends_on_step_id` 默认为 null
- 现有执行流程不变，只有 `depends_on` 非 null 的策略走新路径
