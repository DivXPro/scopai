# 创作分析策略模板参考

本文档列出系统预置的 4 个创作分析策略模板，供开发者和 AI Agent 参考使用。所有策略 JSON 内置在 `packages/core/src/strategies/built-in/`，**daemon 启动时会自动种子导入**：首次启动注册全部 4 个策略，后续启动按 `id + version` 比对增量更新（同版本跳过，新版本覆盖）。

> **手动导入兜底**：自定义策略或排障重导可走 `POST /api/strategies/import`（见下方 curl 示例）。<br>**提醒**：MCP 暂未提供 `import_strategies` 工具；MCP 仅提供 `analyze_creative_references` 等运行类工具，不负责注册策略。

> **设计原则**：所有 v2 模板对齐 AI Visual Prompt Cookbook 风格模板（`prompt_template` + `variables` + `example_cases` + `negative_prompt`）的工程化思路——产物必须明确区分「可复制元素」与「可变化元素」，并显式给出适用场景与所需素材。

> **图片 vs 视频**：`creative-image-style` 与 `creative-video-style` 分别针对静态图片帖子和视频帖子。Worker 会根据帖子实际媒体类型（`needs_media.media_types`）自动只跑能匹配的那个，无需手动二选一。

> v1 模板 `creative-brief`（综合创作简报）与 v2.0 阶段的合并版 `creative-visual-style` 均已废弃。聚合工作由 4 个 v2 模板的结构化产物直接承载，下游消费方按需组合。

---

## 手动导入（自定义或排障）

daemon 已经自动种子，下面这些命令只在以下情况用：写自定义策略 JSON、跳过 daemon 直接灌库、或者在 daemon 启动失败时人工补齐。

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

## 模板 1：文案解构（v2.0.0）

**策略 ID**: `creative-copy-deconstruct`

**分析目标**: 单条帖子（`post`）

**用途**: 把一条爆款文案拆成「可复用骨架 + 槽位 + 适用场景 + 素材清单」，下游创作者填空即可产出同款风格作品。产物对齐 AI Visual Prompt Cookbook 风格模板（`prompt_template` + `variables` + `example_cases` + `negative_prompt`）的工程化思路。

**Prompt 变量**: `{{title}}`, `{{content}}`, `{{author_name}}`, `{{platform}}`, `{{published_at}}`

**输出字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `reusable_skeleton` | string | 文案骨架，固定句式保留，可变部分写成 `{SLOT_NAME}` 占位符 |
| `slots` | object[] | 每个槽位的 `name / kind / description / examples[] / source_value`（原帖在该槽的取值） |
| `reusable_patterns` | object[] | 原帖中可独立复用的高密度句式，含 `pattern / reuse_level(verbatim/structural/inspirational) / source_quote` |
| `applicable_scenarios` | object[] | 可复用的 `(vertical, audience, platform)` 组合 + `why_fits` + `confidence(0-1)` |
| `non_applicable_scenarios` | object[] | 不适用场景，等价于 negative prompt |
| `required_assets` | object | `must_have[]` 必备素材清单（kind/spec/count），`nice_to_have[]` 加分项 |
| `source_evidence` | object | 原帖钩子句、CTA 句、表现指标，作为本条模板的诞生证据 |
| `emotion_curve` | string | 情绪曲线（供 brief 聚合） |
| `cta_type` | string | CTA 类型（供 brief 聚合） |

> **破坏性变更**：v1.x 字段（`hook` / `structure_template` / `golden_phrases` / `pain_point` / `target_audience`）已被骨架 + 槽位结构取代，旧任务结果仍可读但下游需走 v2 schema。

---

## 模板 2：图片视觉风格（v2.1.0）

**策略 ID**: `creative-image-style`

**分析目标**: 单条图片帖子（`post`，`needs_media.media_types: ["image"]`）

**用途**: 把一组爆款配图（单图或多图）拆成「可复用 prompt 骨架 + 槽位 + 风格本体 + 多图分镜 + 素材清单」，下游 AI 图像生成可直接喂入。仅针对图片帖子；视频帖子由 `creative-video-style` 处理。

**Prompt 变量**: `{{title}}`, `{{content}}`, `{{author_name}}`, `{{platform}}`, `{{media_urls}}`

**输出字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `visual_prompt_skeleton` | string (英文) | 完整 image-gen prompt 骨架，固定描述符保留，可变部分写成 `{SLOT_NAME}` |
| `negative_prompt` | string (英文) | 会破坏风格的反向描述符 |
| `slots` | object[] | 每个槽位的 `name / kind / description / examples[] / source_value`；`kind` 限定 subject/action/wardrobe/prop/location/background/main_text/secondary_text/accent_symbol/aspect_ratio |
| `style_identity` | object | 不可变的风格本体：`color_palette[{name, hex, role}]` / `composition` / `lighting` / `texture` / `typography` / `aesthetic_keywords[]` |
| `aspect_ratios` | string[] | 推荐画幅（1:1 / 9:16 / 16:9 等） |
| `frames` | object[]（可选） | **新增**：多图帖子时逐张给出 `index / role(cover/product_hero/lifestyle/comparison_before/comparison_after/detail/infographic/testimonial/cta) / scene_description / extra_slots[]`，显式描述图与图之间的叙事节奏。单图可省略 |
| `applicable_scenarios` | object[] | `(vertical, audience, platform)` 组合 + `why_fits` + `confidence(0-1)` |
| `non_applicable_scenarios` | object[] | 套上去翻车的场景 |
| `required_assets` | object | `must_have[]`（主体照片/产品/场景参考等）+ `nice_to_have[]` |
| `source_evidence` | object | `media_urls_referenced[]` + `key_observations[]`（3-5 条事实观察） + `series_consistency` |

> **2026-05-17 拆分变更**：原 `creative-visual-style` 已拆为本模板（图片）与 `creative-video-style`（视频）。原策略 ID 不再可用；Worker 会通过 `needs_media.media_types` 自动选择正确策略，不会在视频帖子上跑图片策略。

---

## 模板 3：视频视觉风格（v1.0.0）

**策略 ID**: `creative-video-style`

**分析目标**: 单条视频帖子（`post`，`needs_media.media_types: ["video"]`）

**用途**: 把一条爆款短视频的视觉语言+时间结构拆成「视频 prompt 骨架 + 关键帧 + 叙事弧线 + 节奏 + 声效设计 + 素材清单」，下游 AI 视频生成（Sora/Runway/Veo）或人工分镜脚本可直接套用。仅针对视频帖子。

**Prompt 变量**: `{{title}}`, `{{content}}`, `{{author_name}}`, `{{platform}}`, `{{media_urls}}`

**输出字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `video_prompt_skeleton` | string (英文) | 完整 video-gen prompt 骨架，固定描述符保留，可变部分写成 `{SLOT_NAME}` |
| `negative_prompt` | string (英文) | 会破坏视频风格的反向描述符 |
| `slots` | object[] | 每个槽位的 `name / kind / description / examples[] / source_value`；`kind` 限定 subject/action/wardrobe/prop/location/background/hook_shot_type/camera_movement/edit_style/grading_style/voiceover_line/on_screen_text/aspect_ratio/duration |
| `style_identity` | object | 不可变的视觉身份卡：`color_palette[{name, hex, role}]` / `lighting` / `texture` / `typography` / `aesthetic_keywords[]` |
| `keyframes` | object[] | 至少 3 帧的时间序列，每帧含 `time_seconds / role(hook/build/turn/reveal/proof/cta) / shot_description / camera_movement(static/push_in/pull_out/pan_left/pan_right/tilt_up/tilt_down/orbit/handheld/tracking/whip) / slots[]` |
| `narrative_arc` | object | `pattern`（悬念-揭秘 / Before-After / 假装抗拒-反转-推荐 / 教学拆解 / ...） + `beats[]` |
| `pacing` | object | `total_duration_seconds` / `hook_window_seconds` / `cut_frequency_per_10s` / `scene_count` |
| `sound_design` | object | `music_mood` / `bpm_hint` / `voiceover_pattern(narrator_monologue/dialogue/vlog_diary/silent_with_caption/asmr)` / `sfx_cues[{time_seconds, cue}]` |
| `transition_style` | string | 转场方式，如 `hard cuts only` / `whip pan transitions` / `match cuts` |
| `aspect_ratio` | string | `9:16` / `16:9` / `1:1` / `4:5` |
| `applicable_scenarios` | object[] | `(vertical, audience, platform)` 组合 + `why_fits` + `confidence(0-1)` |
| `non_applicable_scenarios` | object[] | 套上去翻车的场景 |
| `required_assets` | object | `must_have[]`（主体演员/拍摄场景/核心道具/BGM 选段/配音脚本等）+ `nice_to_have[]` |
| `source_evidence` | object | `media_urls_referenced[]` + `key_observations[]`（3-5 条事实） + `timecode_anchors[{time_seconds, description}]` |

> **设计要点**：`keyframes[]` + `narrative_arc` + `pacing` + `sound_design` 把视频的「时间维度」结构化下来——这是图片模板做不到的核心区别。下游创作者拿到产物后，既能直接喂 AI 视频模型，也能照着写人工分镜脚本。

---

## 模板 4：话题角度（v2.0.0）

**策略 ID**: `creative-topic-angle`

**分析目标**: 单条帖子（`post`）

**用途**: 把一条爆款的「话题切入」抽成可迁移的角度公式，下游创作者可直接套到新赛道复刻爆点逻辑。

**Prompt 变量**: `{{title}}`, `{{content}}`, `{{author_name}}`, `{{platform}}`, `{{published_at}}`

**输出字段**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `angle_skeleton` | string | 含 `{SLOT_NAME}` 的角度公式骨架 |
| `slots` | object[] | 每个槽位 `name / kind / description / examples[] / source_value`；`kind` 限定 vertical/persona/perspective/common_belief/counter_truth/evidence/payoff/trigger |
| `core_mechanic` | object | `insight_type`（反常识/对比揭示/数据揭秘/...）+ `tension` + `payoff` + `hook_window_seconds` |
| `transferability` | object | `score(0-1)` + `verticals_proven[]` + `verticals_potential[]` + `verticals_avoid[]` + `what_must_stay[]` |
| `applicable_scenarios` | object[] | 可落地的 `(vertical, audience, platform)` 组合 + `confidence` |
| `non_applicable_scenarios` | object[] | 翻车场景 |
| `required_assets` | object | `must_have[]`（亲历经验/独家数据/行业人脉/对比样本等） + `nice_to_have[]` |
| `source_evidence` | object | `anchor_quotes[]`（1-3 句原文直接引用） + `performance_hint` |
| `related_angles` | string[] | 基于同一 core_mechanic 可衍生的相邻角度 |

> **破坏性变更**：v1 字段（`core_topic` / `angle` / `differentiation` / `trend_potential` / `content_format`）已被骨架 + 核心机制 + 迁移性结构取代。

---

## 推荐用法

### 单条帖子参考

对一条帖子并行运行可用策略，得到结构化模板。Worker 会基于 `needs_media.media_types` 自动只跑能匹配的视觉策略：

| 帖子媒体类型 | 实际会跑的策略 |
|---|---|
| 纯图片 | copy + image + topic（video 自动跳过） |
| 纯视频 | copy + video + topic（image 自动跳过） |
| 图片+视频混合 | copy + image + video + topic（都跑） |
| 无媒体（纯文字） | copy + topic（image / video 都跳过） |

四份产物各自独立可用，无需再走聚合策略。

### 批量帖子参考

```
Task: "参考素材分析"
├── Step 1: creative-copy-deconstruct (target=post)
├── Step 2: creative-image-style       (target=post, 只跑含图片的帖子)
├── Step 3: creative-video-style       (target=post, 只跑含视频的帖子)
└── Step 4: creative-topic-angle       (target=post)
```

四个步骤可并行执行。下游若需要跨帖子聚合（如"找出共同的角度公式"），由消费方在拿到全部 v2 产物后按 `slots` / `applicable_scenarios` 等结构化字段自行做。

### MCP 工具一键生成

通过 MCP Server 的 `analyze_creative_references` 工具可一次性触发上述 4 个策略：传入 `post_ids` 即可自动创建任务、添加 4 个分析步骤并启动。Worker 会按媒体类型自动过滤，纯图片帖子不会被强行跑视频策略，反之亦然。

旧名 `generate_creative_brief` 仍保留为 deprecated 别名，内部转发到同一编排，**不再调用已废弃的 `creative-brief` 策略**。新集成请使用 `analyze_creative_references`。

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
  "needs_media": { "enabled": false, "media_types": ["image"] },
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

`needs_media.media_types` 支持 `image` / `video` / `audio`。当一个 post 没有任何匹配类型的媒体时，Worker 会自动跳过该策略（不会强行用空媒体调用 LLM），所以拆图片/视频策略只需各自声明 media_types 即可，无需手写路由逻辑。
