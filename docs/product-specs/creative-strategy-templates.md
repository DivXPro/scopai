# 创作分析策略模板参考

本文档列出系统预置的 4 个创作分析策略模板，供开发者和 AI Agent 参考使用。所有策略均已内置在 `packages/core/src/strategies/built-in/` 目录下，可通过 `/api/strategies/import` 或 MCP `import_strategies` 一键导入。

---

## 快速导入

```bash
# 逐个导入
curl -X POST http://localhost:3000/api/strategies/import \
  -H "Content-Type: application/json" \
  -d @packages/core/src/strategies/built-in/creative-copy-deconstruct.json

# 或一次性导入全部 4 个
for f in packages/core/src/strategies/built-in/*.json; do
  curl -s -X POST http://localhost:3000/api/strategies/import \
    -H "Content-Type: application/json" -d @$f
done
```

---

## 模板 1：文案解构

**策略 ID**: `creative-copy-deconstruct`

**分析目标**: 单条帖子（`post`）

**用途**: 提取帖子的文案技巧、结构模板、金句和情绪曲线，供创作者借鉴文案写法。

**Prompt 变量**: `{{title}}`, `{{content}}`, `{{author_name}}`, `{{platform}}`, `{{published_at}}`

**输出字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `hook` | string | 开头钩子，3秒内抓注意力的手法 |
| `structure_template` | string | 文案结构模板，如"痛点共鸣→解决方案→社会证明→CTA" |
| `golden_phrases` | string[] | 可复用的金句/话术 |
| `emotion_curve` | string | 情绪走向，如"焦虑→希望→紧迫" |
| `pain_point` | string | 触达的受众痛点 |
| `target_audience` | string | 目标受众画像 |
| `cta_type` | string | 行动号召类型 |

---

## 模板 2：视觉风格

**策略 ID**: `creative-visual-style`

**分析目标**: 单条帖子（`post`）

**需要媒体**: 是（`needs_media.enabled: true`）

**用途**: 分析帖子配图/视频的视觉效果，提取色彩、构图、光影、氛围等风格要素，生成可直接用于 AI 图像生成的风格描述 Prompt。

**Prompt 变量**: `{{title}}`, `{{content}}`, `{{author_name}}`, `{{platform}}`, `{{media_urls}}`

**输出字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `color_palette` | string[] | 主色调 |
| `composition` | string | 构图特点 |
| `lighting` | string | 光影风格 |
| `mood` | string | 整体氛围 |
| `aesthetic_keywords` | string[] | 美学标签 |
| `suitable_scenes` | string[] | 适用场景 |
| `style_reference_prompt` | string | 可直接用于 AI 图像生成的风格描述 Prompt |

---

## 模板 3：话题角度

**策略 ID**: `creative-topic-angle`

**分析目标**: 单条帖子（`post`）

**用途**: 分析帖子的核心话题、切入角度和差异化点，评估爆点潜力，提供可延伸的相关角度。

**Prompt 变量**: `{{title}}`, `{{content}}`, `{{author_name}}`, `{{platform}}`, `{{published_at}}`

**输出字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `core_topic` | string | 核心话题 |
| `angle` | string | 切入角度 |
| `differentiation` | string | 差异化点 |
| `trend_potential` | string | 爆点分析 |
| `content_format` | string | 内容形式 |
| `related_angles` | string[] | 可延伸的相关角度 |

---

## 模板 4：综合创作简报

**策略 ID**: `creative-brief`

**分析目标**: 多条帖子聚合（`multi-post`）

**用途**: 基于前三个策略的分析结果，生成一份综合创作简报，帮助创作者理解"这些参考为什么有效"以及"我可以怎么借鉴融合"。

**依赖**: 需要在同一 Task 中先完成 `creative-copy-deconstruct`、`creative-visual-style`、`creative-topic-angle` 的分析。

**Prompt 变量**: `{{references}}`（Worker 自动组装的前序分析结果 JSON）, `{{requirements}}`（用户额外要求，可选）

**输出字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `reference_summary` | string | 150字内参考精华总结 |
| `copy_direction` | string | 文案方向建议 |
| `visual_direction` | string | 视觉方向建议 |
| `applicable_scenarios` | string[] | 适用场景列表 |
| `adaptation_tips` | string[] | 改编建议 |

---

## 推荐用法

### 单条帖子参考

对一条帖子同时运行前三个策略，获取文案、视觉、话题三个维度的参考要素：

1. `creative-copy-deconstruct`
2. `creative-visual-style`
3. `creative-topic-angle`

### 批量帖子创作简报

对一批参考帖子按以下步骤链执行：

```
Task: "创作简报生成"
├── Step 1: creative-copy-deconstruct (target=post)
├── Step 2: creative-visual-style     (target=post, depends_on=step1)
├── Step 3: creative-topic-angle      (target=post, depends_on=step2)
└── Step 4: creative-brief            (target=multi-post, depends_on=step3)
```

前三个步骤并行分析单条帖子，第四步基于前三步结果生成综合简报。

### MCP 工具一键生成

通过 MCP Server 的 `generate_creative_brief` 工具可直接完成上述流程：传入 `post_ids` 即可自动创建任务、添加步骤并启动分析。

---

## 自定义策略模板

参考以上模板结构创建新策略时，JSON 必须包含以下字段：

```json
{
  "id": "unique-strategy-id",
  "name": "策略名称",
  "description": "策略用途说明",
  "version": "1.0.0",
  "target": "post" | "comment" | "multi-post",
  "needs_media": { "enabled": false },
  "prompt": "提示词，支持 {{variable}} 占位符",
  "output_schema": {
    "type": "object",
    "properties": {
      "field_name": {
        "type": "string",
        "title": "字段显示名",
        "description": "字段说明"
      }
    }
  }
}
```

`output_schema` 的 `title` 和 `description` 会用于生成提示词中的字段说明，帮助 LLM 按格式返回结果。
