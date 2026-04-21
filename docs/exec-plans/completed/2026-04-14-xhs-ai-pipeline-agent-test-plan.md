# 小红书 AI 热帖分析 — Agent 自动执行测试计划

> 版本：1.0
> 日期：2026-04-14
> 目标：通过 opencli 抓取小红书 AI 话题 Top-10 热帖，完成数据导入、媒体下载、评论导入，并对评论进行情感分析与用户反馈分类。
> 执行方式：AI Agent 按本文档逐阶段自动执行，每阶段完成后对照"验收标准"核查，不满足时进入对应的错误回路。
> 平台注意：命令示例基于 bash 语法；Windows 用户使用 Git Bash 或 WSL 执行 shell 命令；Node.js 内联脚本跨平台通用。

---

## Agent 角色分工

本计划复用项目 `agents/` 架构：

| 角色 | 阶段 | 职责 |
|------|------|------|
| `orchestrator` | Phase 0 / Gate Check | 目标确认、阶段衔接、交接物验收 |
| `dataset-curator` | Phase 1a | opencli 抓取 + 格式转换 + 数据导入 |
| `template-task-architect` | Phase 1b | 模板选择 + 任务创建 + 目标绑定 |
| `run-supervisor` | Phase 3 | daemon 管理 + 任务执行 + 进度监控 |
| `insight-synthesizer` | Phase 4 | 结果聚合 + 抽样核查 + 导出摘要 |

---

## 前置条件检查（orchestrator 执行）

在任何阶段开始前，先逐项确认：

| 检查项 | 命令 / 方法 | 通过标准 |
|--------|-------------|----------|
| Node.js 版本 | `node --version` | >= 20 |
| pnpm 可用 | `pnpm --version` | 有输出 |
| 项目构建 | `pnpm build` | 无报错 |
| CLI 可用 | `analyze-cli --version` 或 `node bin/analyze-cli.js --version` | 有版本号 |
| opencli 可用 | `opencli --version` | 有版本号 |
| Chrome + 小红书登录 | `opencli doctor` | 无 browser bridge 报错 |
| ANTHROPIC_API_KEY | `echo $ANTHROPIC_API_KEY` | 非空字符串 |
| 平台注册 | `analyze-cli platform list` | 含 `xhs` 平台 |
| 模板可用 | `analyze-cli template list` | 含 `sentiment-topics` 模板 |

**任一项失败 → 停止执行，向用户报告具体缺失项，等待修复。**

---

## Phase 0：Intake（orchestrator）

**目标：** 确认执行参数。

执行参数：

```
platform       = xhs
search_query   = "AI"
post_limit     = 10
comment_limit  = 100  （每帖）
media_dir      = downloads/xhs-media/
task_name      = xhs-ai-热帖分析-2026-04-14
template       = sentiment-topics
export_path    = docs/exec-plans/active/xhs-ai-analysis-results.json
```

确认无误后，并行启动 Phase 1a 和 Phase 1b。

---

## Phase 1a：数据采集与导入（dataset-curator）

### Step 1 — 搜索 Top-10 AI 热帖

```bash
opencli xiaohongshu search --query "AI" --limit 10 -f json \
  > test-data/xhs_ai_posts_raw.json
```

**验收标准：**
- 文件存在且非空
- `jq '. | length' test-data/xhs_ai_posts_raw.json` 输出 >= 1（理想值 10）
- 每条记录含 `noteId`（或 `id`）字段

**失败回路：** opencli 报错或结果为空时，运行 `OPENCLI_DIAGNOSTIC=1 opencli xiaohongshu search ...` 获取诊断，参考 `opencli-autofix` 技能修复 adapter。

---

### Step 2 — 格式转换：raw JSON → JSONL

opencli 输出的字段名称需要对应到 analyze-cli 的 `posts` 表结构（platform `xhs` 的 `field_mappings` 已内置 13 条映射）。

```bash
# 查看 xhs 字段映射，确认转换规则
analyze-cli platform mapping list --platform xhs
```

转换脚本（使用内联 node 执行，避免创建额外文件）：

```bash
node -e "
const data = JSON.parse(require('fs').readFileSync('test-data/xhs_ai_posts_raw.json', 'utf8'));
const posts = Array.isArray(data) ? data : (data.notes || data.items || data.data || [data]);
const lines = posts.map(p => JSON.stringify({
  platform_post_id: p.noteId || p.id || p.note_id,
  title:            p.title || p.desc || '',
  content:          p.desc  || p.content || '',
  author_id:        p.userId || p.user?.userId || '',
  author_name:      p.nickname || p.user?.nickname || '',
  likes_count:      p.likes  || p.likeCount  || p.interactInfo?.likedCount || 0,
  comments_count:   p.comments || p.commentCount || 0,
  platform_created_at: p.time || p.createTime || null,
  raw_data:         JSON.stringify(p)
}));
require('fs').writeFileSync('test-data/xhs_ai_posts.jsonl', lines.join('\n'));
console.log('Converted', lines.length, 'posts');
"
```

**验收标准：** `wc -l test-data/xhs_ai_posts.jsonl` 与 raw JSON 记录数一致，且每行含 `platform_post_id`。

---

### Step 3 — 导入帖子

```bash
analyze-cli post import --platform xhs --file test-data/xhs_ai_posts.jsonl
analyze-cli post list --platform xhs --limit 10
```

**验收标准：**
- import 输出 "Imported N posts, skipped M" 无报错
- `post list` 返回 >= 1 条记录
- 记录 `post_ids` 列表（后续评论导入和任务绑定使用）

---

### Step 4 — 提取 noteId 列表

```bash
# 提取所有 noteId，保存供后续循环使用
node -e "
const data = JSON.parse(require('fs').readFileSync('test-data/xhs_ai_posts_raw.json', 'utf8'));
const posts = Array.isArray(data) ? data : (data.notes || data.items || data.data || [data]);
const ids = posts.map(p => p.noteId || p.id || p.note_id).filter(Boolean);
require('fs').writeFileSync('test-data/xhs_note_ids.txt', ids.join('\n'));
console.log('Note IDs:', ids);
"
```

---

### Step 5 — 抓取每帖评论（每帖前 100 条）

```bash
mkdir -p test-data/comments

while IFS= read -r noteId; do
  echo "Fetching comments for $noteId ..."
  opencli xiaohongshu comments --note-id "$noteId" --limit 100 -f json \
    > "test-data/comments/raw_${noteId}.json"
  sleep 1  # 避免请求过快
done < test-data/xhs_note_ids.txt
```

**验收标准：** `ls test-data/comments/raw_*.json | wc -l` 与帖子数一致，每个文件非空。

---

### Step 6 — 转换评论格式并导入

对每个 noteId，执行以下三步：

**a) 查询 analyze-cli 内部 post_id**

```bash
analyze-cli post list --platform xhs --limit 100
```

从输出中找到 `platform_post_id == <noteId>` 对应的 `id`（UUID），记为 `<POST_ID>`。

**b) 转换评论格式**

将 `test-data/comments/raw_<noteId>.json` 写入 `test-data/comments/comments_<noteId>.jsonl`，每行一条 JSON：

```bash
node -e "
const noteId = process.argv[1];
const raw = require('fs').readFileSync('test-data/comments/raw_' + noteId + '.json', 'utf8');
const data = JSON.parse(raw);
const comments = Array.isArray(data) ? data : (data.comments || data.data || [data]);
const lines = comments.map(c => JSON.stringify({
  platform_comment_id: c.id || c.commentId,
  content:             c.content || c.text || '',
  author_id:           c.userId || (c.user && c.user.userId) || '',
  author_name:         c.nickname || (c.user && c.user.nickname) || '',
  likes_count:         c.likes || c.likeCount || 0,
  platform_created_at: c.time || c.createTime || null,
  raw_data:            JSON.stringify(c)
}));
require('fs').writeFileSync('test-data/comments/comments_' + noteId + '.jsonl', lines.join('\n'));
console.log('Converted', lines.length, 'comments for', noteId);
" <noteId>
```

**c) 导入评论**

```bash
analyze-cli comment import --platform xhs --post-id <POST_ID> \
  --file test-data/comments/comments_<noteId>.jsonl
```

对 `test-data/xhs_note_ids.txt` 中的每个 noteId 重复 a-b-c 步骤。

**完成后验证：**

```bash
analyze-cli comment list --limit 5
```

**验收标准：**
- 每帖 import 输出无报错
- `analyze-cli comment list` 有结果
- 总评论数目标：每帖 <= 100 条，共 <= 1000 条

---

### Step 7 — 下载媒体文件

```bash
mkdir -p downloads/xhs-media

while IFS= read -r noteId; do
  echo "Downloading media for $noteId ..."
  opencli xiaohongshu download "$noteId" --output "downloads/xhs-media/${noteId}/"
  sleep 1
done < test-data/xhs_note_ids.txt
```

**验收标准：** `ls downloads/xhs-media/` 有对应目录，每目录内有图片或视频文件。

---

### dataset-curator 交接物

Phase 1a 完成后，向 orchestrator 输出以下结构（写入 `test-data/dataset-curator-output.json`）：

```json
{
  "platform": "xhs",
  "post_files": ["test-data/xhs_ai_posts.jsonl"],
  "comment_files_dir": "test-data/comments/",
  "media_dir": "downloads/xhs-media/",
  "import_summary": {
    "posts_imported": "<实际数>",
    "comments_imported": "<实际数>"
  },
  "ready_post_ids": ["<id1>", "..."],
  "ready_comment_ids": ["<id1>", "..."],
  "risks": []
}
```

---

## Phase 1b：模板与任务装配（template-task-architect）

### Step 1 — 确认模板

```bash
analyze-cli template list
```

选择 `sentiment-topics` 模板（同时覆盖情感分析 + 用户反馈分类）。若不存在，检查 `analyze-cli template add`。

### Step 2 — 创建任务

```bash
analyze-cli task create --name "xhs-ai-热帖分析-2026-04-14" --template sentiment-topics
```

**Agent 操作：** 从命令输出中读取并记录 `task_id`（UUID 格式），后续步骤统一使用 `<TASK_ID>` 代指该值。

### Step 3 — 获取评论 ID 列表

```bash
analyze-cli comment list --limit 1000
```

**Agent 操作：** 从输出中收集所有评论的 `id`（或 `comment_id`）字段，组成逗号分隔列表。

### Step 4 — 绑定评论目标

```bash
analyze-cli task add-comments --task-id <TASK_ID> --comment-ids <id1,id2,...>
```

**说明：** 将 Step 3 收集到的所有 comment_id 以逗号连接，填入 `--comment-ids` 参数。

**验收标准：** 绑定无报错，`analyze-cli task status --task-id $TASK_ID` 显示 pending 数量 > 0。

### template-task-architect 交接物

```json
{
  "template_name": "sentiment-topics",
  "task_name": "xhs-ai-热帖分析-2026-04-14",
  "task_id": "<TASK_ID>",
  "target_type": "comment",
  "target_ids": ["<id1>", "..."],
  "next_action": "start_task"
}
```

---

## Phase 2：Gate Check（orchestrator）

**必须同时满足：**

| 条件 | 检查方式 | 要求 |
|------|----------|------|
| 有可分析评论 | `dataset-curator-output.json` 中 `ready_comment_ids.length` | >= 1 |
| 任务已创建 | `TASK_ID` 非空 | 非空 |
| 任务已绑定目标 | `task status` 的 pending > 0 | > 0 |

**不满足时：**
- 缺评论 → 回退到 `dataset-curator` Step 6
- 缺任务 → 回退到 `template-task-architect` Step 2

---

## Phase 3：执行分析（run-supervisor）

### Step 1 — 确认 daemon

```bash
analyze-cli daemon status
```

若未运行：

```bash
analyze-cli daemon start
sleep 3
analyze-cli daemon status  # 确认已启动
```

### Step 2 — 启动任务

```bash
analyze-cli task start --task-id "$TASK_ID"
```

**预期输出：** "Enqueued N jobs"，N == 绑定的评论数。

### Step 3 — 轮询进度（最多 30 次，每次间隔 10 秒）

```bash
for i in $(seq 1 30); do
  STATUS=$(analyze-cli task status --task-id "$TASK_ID" -f json 2>/dev/null)
  DONE=$(echo "$STATUS" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const s=JSON.parse(d); console.log(s.done||s.completed||0)")
  TOTAL=$(echo "$STATUS" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const s=JSON.parse(d); console.log(s.total||0)")
  FAILED=$(echo "$STATUS" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const s=JSON.parse(d); console.log(s.failed||0)")

  echo "[$i/30] done=$DONE total=$TOTAL failed=$FAILED"

  if [ "$DONE" -ge "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
    echo "Task completed!"
    break
  fi

  sleep 10
done
```

**验收标准：** `done == total`，`failed` 为 0 或极少（< 5%）。

**失败回路：**
- `failed > total * 0.05` → 检查 `analyze-cli result list --task-id $TASK_ID --status failed`，报告具体错误
- daemon 停止 → 重新 `daemon start` 后重试
- API 配额耗尽 → 等待后继续，不重新创建任务

### run-supervisor 交接物

```json
{
  "task_id": "<TASK_ID>",
  "daemon_state": "running",
  "task_state": "completed",
  "progress": {
    "total": "<N>",
    "done": "<N>",
    "failed": 0,
    "pending": 0
  },
  "blocking_issues": [],
  "retry_advice": []
}
```

---

## Phase 4：结果归纳与导出（insight-synthesizer）

### Step 1 — 统计汇总

```bash
analyze-cli result stats --task-id "$TASK_ID"
```

**预期输出：**
- 情感分布（正面 / 中性 / 负面 百分比）
- 用户反馈分类分布（问题/赞同/反对/经验分享 等）

### Step 2 — 抽样核查（取前 20 条）

```bash
analyze-cli result list --task-id "$TASK_ID" --limit 20
```

逐条确认结果字段完整（sentiment、intent/category、summary 等），无明显解析异常。

### Step 3 — 导出 JSON 结果

```bash
analyze-cli result export \
  --task-id "$TASK_ID" \
  --format json \
  --output docs/exec-plans/active/xhs-ai-analysis-results.json

echo "Export complete: docs/exec-plans/active/xhs-ai-analysis-results.json"
```

### Step 4 — 导出 CSV（备用）

```bash
analyze-cli result export \
  --task-id "$TASK_ID" \
  --format csv \
  --output docs/exec-plans/active/xhs-ai-analysis-results.csv
```

### Step 5 — 生成摘要（insight-synthesizer 输出）

阅读统计结果，生成最终摘要，格式：

```json
{
  "task_id": "<TASK_ID>",
  "exports": [
    "docs/exec-plans/active/xhs-ai-analysis-results.json",
    "docs/exec-plans/active/xhs-ai-analysis-results.csv"
  ],
  "headline_findings": [
    "正面情感占 X%，负面情感占 Y%",
    "最高频反馈类型：<类型>，占比 Z%",
    "Top-3 热帖互动量均超过 N 条评论"
  ],
  "risk_summary": [],
  "follow_up_questions": [
    "哪类 AI 工具获得最多正面评价？",
    "负面评论集中在哪些功能痛点？"
  ]
}
```

---

## 整体验收标准

| 验收项 | 要求 |
|--------|------|
| 帖子导入 | >= 1 条帖子成功入库 |
| 评论导入 | 至少 1 篇帖子有 >= 1 条评论入库 |
| 媒体下载 | `downloads/xhs-media/` 目录存在且非空 |
| 任务完成 | `task status` 中 done == total |
| 结果导出 | `xhs-ai-analysis-results.json` 文件存在且非空 |
| 摘要可读 | `result stats` 输出情感分布和反馈分类数据 |

---

## 风险与注意事项

1. **字段名称漂移** — opencli 输出的字段名可能因版本变化。Step 2 的转换脚本使用多路备用字段（`noteId || id || note_id`），遇到未匹配字段时先打印 raw 结构再调整。
2. **评论数量不足** — 部分帖子评论数 < 100 为正常现象，按实际可用评论数导入。
3. **API 调用耗时** — 1000 条评论全量分析可能需要数分钟。`run-supervisor` 轮询上限 30 次 × 10 秒 = 5 分钟，若仍未完成可适当增加轮询次数。
4. **ANTHROPIC_API_KEY 缺失** — 前置条件检查中必须确认。Key 无效时 worker 会将 job 标记为 failed。
5. **`post import` 字段校验** — analyze-cli 要求 `platform_post_id` 非空。转换时如遇空值，该条记录会被 skip，属正常行为。

---

## 错误回路总结

| 错误场景 | 回退目标 | 具体动作 |
|----------|----------|----------|
| opencli 搜索返回空 | dataset-curator Step 1 | `OPENCLI_DIAGNOSTIC=1` 诊断，修复 adapter |
| 帖子导入全部 skip | dataset-curator Step 2 | 调整字段映射 / 转换脚本 |
| 评论导入失败 | dataset-curator Step 6 | 检查 `post_id` 是否正确关联 |
| 任务创建失败 | template-task-architect Step 2 | 检查模板名称，重新创建 |
| daemon 未启动 | run-supervisor Step 1 | `daemon start` 后重试 |
| 分析 failed > 5% | run-supervisor Step 3 | 检查 API Key 和 worker 日志 |
| 导出文件为空 | insight-synthesizer Step 1 | 确认 `result list` 有结果后重试导出 |
