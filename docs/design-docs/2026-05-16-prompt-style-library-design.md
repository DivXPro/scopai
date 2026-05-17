# Prompt Style Library 设计文档

## 背景

AI Visual Prompt Cookbook 是一个结构化的 AI 图像提示词风格库，每个风格被编码为一个 `style.json` 文件，包含：

- `prompt_template`：带变量的提示词模板
- `variables`：可替换的变量字典
- `style_rules` / `composition_rules` / `typography_rules`：风格约束
- `palette`：色板定义
- `example_cases`：示例用例

当前痛点：

1. **风格库与创作工作流割裂** — 用户需要手动复制 JSON 到 LLM，无法与社媒参考分析链路打通
2. **缺乏结构化检索** — 26 个风格已无法凭记忆管理，需要按颜色、构图、情绪、适用场景等维度过滤
3. **无版本和来源追踪** — 风格演进、来源仓库、许可证信息未集中管理

## 目标

1. 在 scopai 中引入 `prompt_styles` 表，存储结构化的提示词风格资产
2. 使用 DuckDB FTS 扩展建立独立的全文检索索引，**不复用现有 `search_index` 表**
3. 提供独立的 API 路由、CLI 命名空间和 UI 页面
4. 支持与现有 `strategies` 系统联动（如：分析社媒帖子后，推荐匹配的风格）

## 核心设计决策

### 决策 1：独立表，不复用 posts

| 维度 | posts | prompt_styles |
|------|-------|---------------|
| 内容类型 | 用户生成的社媒内容 | 结构化的视觉系统定义 |
| 核心字段 | 点赞、评论、作者、平台 | 色板、构图规则、变量模板 |
| 检索维度 | 文本内容 | 风格标签、颜色、构图、复杂度 |
| 生命周期 | 动态导入、更新 | 相对稳定，版本化管理 |

塞进 `posts` 会让 `metadata` JSON 臃肿，且无法利用 DuckDB 列式优势做结构化过滤。

### 决策 2：独立检索基础设施，不复用 search_index

现有 `search_index` 表服务于 posts 的社媒内容检索，写入时机、字段结构、检索后处理流程与 prompt_styles 完全不同：

- **posts 检索后**：展示帖子卡片（封面图、标题、作者、平台）→ 查看评论/媒体
- **prompt_styles 检索后**：展示风格卡片（预览图、色板、变量列表）→ 复制 prompt / 修改变量

强行复用会导致检索逻辑混杂、维护困难。prompt_styles 使用 DuckDB 原生 FTS 扩展建立独立索引。

### 决策 3：复用 strategies 系统做风格分析

`strategies` 系统的动态策略能力可用于自动分析 style.json，提取：

- 视觉关键词、情绪标签
- 设计时期/流派
- 复杂度评分
- 适用场景
- 相似风格推荐

分析结果写入独立的 strategy_result 表，不污染 prompt_styles 主表。

## 数据层设计

### 新增表：prompt_styles

```sql
CREATE TABLE IF NOT EXISTS prompt_styles (
    id                  TEXT PRIMARY KEY,
    style_name          TEXT NOT NULL,
    style_slug          TEXT NOT NULL UNIQUE,
    version             TEXT,
    status              TEXT DEFAULT 'stable' CHECK(status IN ('stable','draft','deprecated')),
    summary             TEXT NOT NULL,
    prompt_template     TEXT NOT NULL,
    negative_prompt     TEXT,
    variables           JSON,
    palette             JSON,
    composition_rules   JSON,
    style_rules         JSON,
    typography_rules    JSON,
    example_cases       JSON,
    related_styles      JSON,
    license             TEXT DEFAULT 'CC BY 4.0',
    preview_landscape   TEXT,
    preview_portrait    TEXT,
    source_repo         TEXT DEFAULT 'AI-Visual-Prompt-Cookbook',
    created_at          TIMESTAMP DEFAULT NOW(),
    updated_at          TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_styles_slug ON prompt_styles(style_slug);
CREATE INDEX IF NOT EXISTS idx_prompt_styles_status ON prompt_styles(status);
```

### FTS 索引（独立）

```sql
-- 在导入数据后执行
INSTALL fts;
LOAD fts;

PRAGMA create_fts_index(
  'prompt_styles',
  'id',
  'style_name',
  'summary',
  'prompt_template',
  'negative_prompt',
  'style_rules',
  'typography_rules',
  stopwords = 'english'
);
```

FTS 索引由 DuckDB 自动管理，支持 BM25 相关性排序、自动分词和词干提取。

### 风格标签关联（复用现有 labels 表）

```sql
CREATE TABLE IF NOT EXISTS style_labels (
    style_id   TEXT NOT NULL REFERENCES prompt_styles(id),
    label_id   TEXT NOT NULL REFERENCES labels(id),
    PRIMARY KEY (style_id, label_id)
);
```

## API 设计

### 路由模块：`/prompt-styles`

独立于现有 `/posts`、`/search` 路由，单独文件维护。

#### GET /prompt-styles/search

全文检索，基于 DuckDB FTS。

```
GET /prompt-styles/search?q=grunge+travel&limit=20
```

```json
{
  "styles": [
    {
      "id": "style_xxx",
      "style_name": "Y2K Grunge Hip-hop Cutout Poster",
      "style_slug": "y2k-grunge-hiphop-cutout-poster-style",
      "summary": "A Y2K grunge hip-hop magazine collage poster...",
      "score": 0.892
    }
  ],
  "total": 3,
  "query": "grunge travel"
}
```

#### GET /prompt-styles

结构化过滤列表。

```
GET /prompt-styles?q=poster&color=cyan&has_text=true&limit=20&offset=0
```

支持参数：
- `q`：全文搜索词（走 FTS）
- `color`：色板颜色名或 Hex 值
- `has_text`：是否含文字排版
- `aspect_ratio`：支持的画幅（`9:16` / `16:9`）
- `category`：类别（从 slug 或标签推断）
- `label`：标签过滤

#### GET /prompt-styles/:slug

获取单个风格完整详情。

```
GET /prompt-styles/y2k-grunge-hiphop-cutout-poster-style
```

返回完整 `style.json` 解析后的数据结构，含所有 JSON 字段展开。

## CLI 设计

独立命令组 `prompt-style`，与现有 `post`、`task`、`strategy` 等命令并列。

```bash
# 从目录批量导入 style.json
scopai prompt-style import <path/to/styles/> [--source github-url]

# 全文搜索
scopai prompt-style search "grunge travel poster" [--limit 10]

# 结构化过滤
scopai prompt-style list [--query poster] [--color cyan] [--has-text] [--limit 5]

# 查看单个风格
scopai prompt-style show <style-slug>

# 渲染为即用 prompt（替换变量）
scopai prompt-style render <style-slug> \
  --var SUBJECT="a street dancer" \
  --var MAIN_TEXT="SIDE B"

# 重新构建 FTS 索引（数据更新后）
scopai prompt-style reindex

# 分析风格（调用 strategy）
scopai prompt-style analyze <style-slug> --strategy style-visual-analyzer
```

## UI 设计

新增 **Style Library** 页面（独立路由 `/styles`）。

### 页面结构

```
StyleLibrary.tsx
├── 搜索栏（全文搜索 + 过滤器抽屉）
│   ├── 关键词输入
│   ├── 色板筛选（颜色块点击）
│   ├── 画幅筛选（9:16 / 16:9）
│   └── 标签筛选
├── 风格卡片网格
│   └── StyleCard.tsx
│       ├── 预览图（16:9）
│       ├── 风格名称
│       ├── 摘要（2行截断）
│       ├── 色板色块（palette 前5色）
│       └── 标签 chips
└── 详情抽屉 StyleDetailDrawer.tsx
    ├── 大图预览（支持横竖切换）
    ├── 完整摘要
    ├── 色板展示（Hex + 复制）
    ├── 变量编辑器（表单形式）
    ├── 构图规则列表
    ├── 示例用例标签页
    └── "复制 Prompt" / "复制 JSON" 按钮
```

## 导入流程

### 批量导入脚本

```typescript
// scripts/import-prompt-styles.ts
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { run } from '@scopai/core/db/client';
import { generateId } from '@scopai/core/shared/utils';

async function importStyles(stylesDir: string, sourceRepo?: string) {
  const dirs = await fs.readdir(stylesDir);
  let imported = 0;
  let failed = 0;

  for (const dir of dirs) {
    const stylePath = path.join(stylesDir, dir, 'style.json');
    try {
      const raw = await fs.readFile(stylePath, 'utf-8');
      const style = JSON.parse(raw);

      const id = generateId();

      await run(`
        INSERT INTO prompt_styles (
          id, style_name, style_slug, version, status, summary,
          prompt_template, negative_prompt, variables, palette,
          composition_rules, style_rules, typography_rules,
          example_cases, related_styles, license,
          preview_landscape, preview_portrait, source_repo
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(style_slug) DO UPDATE SET
          version = excluded.version,
          status = excluded.status,
          summary = excluded.summary,
          prompt_template = excluded.prompt_template,
          negative_prompt = excluded.negative_prompt,
          variables = excluded.variables,
          palette = excluded.palette,
          composition_rules = excluded.composition_rules,
          style_rules = excluded.style_rules,
          typography_rules = excluded.typography_rules,
          example_cases = excluded.example_cases,
          related_styles = excluded.related_styles,
          updated_at = NOW()
      `, [
        id,
        style.style_name,
        style.style_slug,
        style.version,
        style.status || 'stable',
        style.summary,
        style.prompt_template,
        style.negative_prompt || null,
        JSON.stringify(style.variables || {}),
        JSON.stringify(style.palette || {}),
        JSON.stringify(style.composition_rules || {}),
        JSON.stringify(style.style_rules || []),
        JSON.stringify(style.typography_rules || []),
        JSON.stringify(style.example_cases || []),
        JSON.stringify(style.related_styles || []),
        style.license || 'CC BY 4.0',
        style.preview?.landscape || null,
        style.preview?.portrait || null,
        sourceRepo || 'AI-Visual-Prompt-Cookbook',
      ]);

      imported++;
    } catch (err) {
      console.error(`✗ Failed: ${dir}`, err);
      failed++;
    }
  }

  console.log(`Imported: ${imported}, Failed: ${failed}`);

  // 重建 FTS 索引
  console.log('Rebuilding FTS index...');
  await run(`INSTALL fts`);
  await run(`LOAD fts`);
  await run(`DROP INDEX IF EXISTS prompt_styles_fts_idx`);
  await run(`PRAGMA create_fts_index('prompt_styles', 'id', 'style_name', 'summary', 'prompt_template', 'negative_prompt', 'style_rules', 'typography_rules')`);
  console.log('FTS index ready.');
}
```

## 与现有系统的边界

### 不改动现有表

- `posts`、`comments`、`media_files`、`search_index` 等现有表不做任何修改
- `search_index` 继续仅服务于 posts 的社媒内容检索

### 复用基础设施

- `labels` / `style_labels`：复用标签系统
- `strategies`：复用策略定义和执行框架
- `tasks` / `task_steps` / `queue_jobs`：复用任务流水线（用于风格分析）
- DuckDB：复用数据库连接和事务管理

### 独立代码路径

| 层级 | posts 路径 | prompt_styles 路径 |
|------|-----------|-------------------|
| DB | `packages/core/src/db/posts.ts` | `packages/core/src/db/prompt-styles.ts` |
| API | `packages/api/src/routes/posts.ts` | `packages/api/src/routes/prompt-styles.ts` |
| CLI | `packages/cli/src/post.ts` | `packages/cli/src/prompt-style.ts` |
| UI | `packages/ui/src/pages/PostLibrary.tsx` | `packages/ui/src/pages/StyleLibrary.tsx` |

## 与策略系统的联动

### 预置策略：style-visual-analyzer

```json
{
  "name": "Style Visual Analyzer",
  "target": "post",
  "prompt": "Analyze the following AI image prompt style definition and extract structured insights.\n\nStyle: {{style_name}}\nSummary: {{summary}}\nPrompt Template: {{prompt_template}}\nStyle Rules: {{style_rules}}\nPalette: {{palette}}\n\nExtract and return JSON with visual_keywords, mood_tags, design_period, complexity_score, text_heavy, color_dominance, suitable_for, similar_styles.",
  "output_schema": {
    "type": "object",
    "properties": {
      "visual_keywords": { "type": "array", "items": { "type": "string" } },
      "mood_tags": { "type": "array", "items": { "type": "string" } },
      "design_period": { "type": "string" },
      "complexity_score": { "type": "integer", "minimum": 1, "maximum": 10 },
      "text_heavy": { "type": "boolean" },
      "color_dominance": { "type": "string" },
      "suitable_for": { "type": "array", "items": { "type": "string" } },
      "similar_styles": { "type": "array", "items": { "type": "string" } }
    }
  }
}
```

### 执行流程

```bash
# 1. 导入风格
scopai prompt-style import ../AI-Visual-Prompt-Cookbook/styles/

# 2. 创建分析任务
scopai task create --name "Prompt Style Analysis"

# 3. 添加分析步骤
scopai task step add --task-id <id> --strategy style-visual-analyzer

# 4. 运行分析
scopai task run-all-steps --task-id <id>

# 5. 结果自动写入 strategy_result_<id> 表
```

分析结果可用于：
- 自动标签填充（`mood_tags` → `labels` + `style_labels`）
- 相似风格推荐（`similar_styles` → 补充 `related_styles`）
- 复杂度筛选（`complexity_score` → UI 过滤条件）
- 适用场景（`suitable_for` → 用户引导）

## 实现边界

1. **Schema 扩展**：`packages/core/src/db/schema.sql` 追加 `prompt_styles` 和 `style_labels`
2. **FTS 索引**：导入脚本中自动创建/重建
3. **API 路由**：新增 `packages/api/src/routes/prompt-styles.ts`，在 `index.ts` 注册
4. **CLI 命令**：新增 `packages/cli/src/prompt-style.ts`，在 `bin/cli.ts` 注册
5. **UI 页面**：新增 `packages/ui/src/pages/StyleLibrary.tsx`，添加路由
6. **导入脚本**：`scripts/import-prompt-styles.ts`，支持增量更新（`ON CONFLICT`）
