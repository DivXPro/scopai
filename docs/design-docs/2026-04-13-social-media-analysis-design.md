# 社交媒体内容分析 CLI 工具 — 设计文档

> 本工具通过 CLI 方式供 AI Agent 调用，利用大模型（Claude）对社交媒体内容进行情感分析、话题分类、内容摘要、风险检测等多维度分析，支持大批量数据处理、数据存储查询和任务批次管理。

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────┐
│  AI Agent / User (CLI)                                       │
│  scopai <command> [subcommand] [options]                │
└──────────────────────────┬────────────────────────────────────┘
                           │ Unix Socket (IPC)
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  守护进程 Daemon (常驻 Node.js 进程)                          │
│  ├── IPC Server (JSON-RPC 2.0)                               │
│  ├── Bree Scheduler + DuckDB Adapter                         │
│  └── Worker Pool (可配置数量，默认 2 个独立进程)               │
└──────┬───────────────────┬──────────────────────┬───────────┘
       │                   │                      │
       ▼                   ▼                      ▼
┌─────────────┐    ┌──────────────┐    ┌──────────────────────────┐
│  DuckDB     │    │  DuckDB       │    │  Anthropic API           │
│  (数据存储)  │    │  (队列状态)   │    │  (Claude)               │
│  posts/     │    │  queue_jobs   │    │                          │
│  comments/  │    │               │    │                          │
│  results/   │    │               │    │                          │
│  tasks/     │    │               │    │                          │
└─────────────┘    └──────────────┘    └──────────────────────────┘
```

**核心设计原则**：
- 所有写操作统一经过守护进程，天然解决多 CLI 并发写入问题
- DuckDB 作为统一数据存储（posts/comments/results + 队列状态）
- Bree + DuckDB Adapter 实现任务队列调度，无需 Redis
- Worker 是独立进程，调用 Claude API，结果直接写 DuckDB

---

## 二、数据库设计

### 2.1 ER 关系

```
platforms
    ├── field_mappings
    │
    ├── posts ──────────────────┐
    │       └── comments        │
    │               └── media_files
    │
    ├── tasks
    │       ├── task_targets
    │       └── queue_jobs ──→ Worker
    │
    ├── analysis_results_comments
    └── analysis_results_media
```

### 2.2 表清单

| # | 表名 | 说明 |
|---|---|---|
| 1 | `platforms` | 平台定义 |
| 2 | `field_mappings` | 系统字段 ↔ 平台字段映射 |
| 3 | `posts` | 帖子/笔记/视频原始数据 |
| 4 | `comments` | 评论/回复原始数据 |
| 5 | `media_files` | 媒体文件（图片/视频） |
| 6 | `tasks` | 分析任务 |
| 7 | `task_targets` | 任务关联的数据项 |
| 8 | `analysis_results_comments` | 评论分析结果 |
| 9 | `analysis_results_media` | 媒体内容分析结果 |
| 10 | `prompt_templates` | Prompt 模板 |
| 11 | `queue_jobs` | 队列任务状态 |

### 2.3 完整 DDL

```sql
-- 1. 平台
CREATE TABLE platforms (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 2. 字段映射（系统字段 ↔ 平台字段对应关系）
CREATE TABLE field_mappings (
    id              TEXT PRIMARY KEY,
    platform_id     TEXT NOT NULL REFERENCES platforms(id),
    entity_type     TEXT NOT NULL CHECK(entity_type IN ('post','comment','user')),
    system_field    TEXT NOT NULL,
    platform_field  TEXT NOT NULL,
    data_type       TEXT NOT NULL CHECK(data_type IN ('string','number','date','boolean','array','json')),
    is_required     BOOLEAN DEFAULT false,
    transform_expr  TEXT,
    description     TEXT,
    UNIQUE(platform_id, entity_type, system_field)
);

-- 3. 帖子原始数据
CREATE TABLE posts (
    id                  TEXT PRIMARY KEY,
    platform_id         TEXT NOT NULL REFERENCES platforms(id),
    platform_post_id    TEXT NOT NULL,
    title               TEXT,
    content             TEXT NOT NULL,
    author_id           TEXT,
    author_name         TEXT,
    author_url          TEXT,
    url                 TEXT,
    cover_url           TEXT,
    post_type           TEXT,
    like_count          INTEGER DEFAULT 0,
    collect_count       INTEGER DEFAULT 0,
    comment_count       INTEGER DEFAULT 0,
    share_count         INTEGER DEFAULT 0,
    play_count          INTEGER DEFAULT 0,
    score               INTEGER,
    tags                JSON,
    media_files         JSON,
    published_at        TIMESTAMP,
    fetched_at          TIMESTAMP DEFAULT NOW(),
    metadata            JSON,
    UNIQUE(platform_id, platform_post_id)
);

-- 4. 评论原始数据
CREATE TABLE comments (
    id                  TEXT PRIMARY KEY,
    post_id             TEXT NOT NULL REFERENCES posts(id),
    platform_id         TEXT NOT NULL REFERENCES platforms(id),
    platform_comment_id TEXT,
    parent_comment_id   TEXT,
    root_comment_id     TEXT,
    depth               INTEGER DEFAULT 0,
    author_id           TEXT,
    author_name         TEXT,
    content             TEXT NOT NULL,
    like_count          INTEGER DEFAULT 0,
    reply_count         INTEGER DEFAULT 0,
    published_at        TIMESTAMP,
    fetched_at          TIMESTAMP DEFAULT NOW(),
    metadata            JSON
);

-- 5. 媒体文件
CREATE TABLE media_files (
    id              TEXT PRIMARY KEY,
    post_id         TEXT REFERENCES posts(id),
    comment_id      TEXT REFERENCES comments(id),
    platform_id     TEXT REFERENCES platforms(id),
    media_type      TEXT NOT NULL,
    url             TEXT NOT NULL,
    local_path      TEXT,
    width           INTEGER,
    height          INTEGER,
    duration_ms     INTEGER,
    file_size       INTEGER,
    downloaded_at   TIMESTAMP,
    created_at      TIMESTAMP DEFAULT NOW()
);

-- 6. 分析任务
CREATE TABLE tasks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    template_id TEXT REFERENCES prompt_templates(id),
    status      TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','paused','completed','failed')),
    stats       JSON,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- 7. 任务关联数据项
CREATE TABLE task_targets (
    id          TEXT PRIMARY KEY,
    task_id     TEXT NOT NULL REFERENCES tasks(id),
    target_type TEXT NOT NULL CHECK(target_type IN ('post','comment')),
    target_id   TEXT NOT NULL,
    status      TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','done','failed')),
    error       TEXT,
    created_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE(task_id, target_type, target_id)
);

-- 8. 评论分析结果
CREATE TABLE analysis_results_comments (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    comment_id      TEXT NOT NULL REFERENCES comments(id),
    sentiment_label TEXT,
    sentiment_score DOUBLE,
    intent          TEXT,
    risk_flagged    BOOLEAN DEFAULT false,
    risk_level      TEXT,
    risk_reason     TEXT,
    topics          JSON,
    emotion_tags    JSON,
    keywords        JSON,
    summary         TEXT,
    raw_response    JSON,
    error           TEXT,
    analyzed_at     TIMESTAMP DEFAULT NOW()
);

-- 9. 媒体内容分析结果
CREATE TABLE analysis_results_media (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    media_id        TEXT NOT NULL REFERENCES media_files(id),
    media_type      TEXT NOT NULL,
    content_type    TEXT,
    description     TEXT,
    ocr_text        TEXT,
    sentiment_label TEXT,
    sentiment_score DOUBLE,
    risk_flagged    BOOLEAN DEFAULT false,
    risk_level      TEXT,
    risk_reason     TEXT,
    objects         JSON,
    logos           JSON,
    faces           JSON,
    raw_response    JSON,
    error           TEXT,
    analyzed_at     TIMESTAMP DEFAULT NOW()
);

-- 10. Prompt 模板
CREATE TABLE prompt_templates (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    description TEXT,
    template    TEXT NOT NULL,
    is_default  BOOLEAN DEFAULT false,
    created_at  TIMESTAMP DEFAULT NOW()
);

-- 11. 队列任务
CREATE TABLE queue_jobs (
    id              TEXT PRIMARY KEY,
    task_id         TEXT NOT NULL REFERENCES tasks(id),
    target_type     TEXT,
    target_id       TEXT,
    status          TEXT DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
    priority        INTEGER DEFAULT 0,
    attempts        INTEGER DEFAULT 0,
    max_attempts    INTEGER DEFAULT 3,
    error           TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    processed_at    TIMESTAMP
);

-- 索引
CREATE INDEX idx_posts_platform ON posts(platform_id);
CREATE INDEX idx_posts_published ON posts(published_at);
CREATE INDEX idx_comments_post ON comments(post_id);
CREATE INDEX idx_comments_platform ON comments(platform_id);
CREATE INDEX idx_task_targets_task ON task_targets(task_id);
CREATE INDEX idx_analysis_results_comments_task ON analysis_results_comments(task_id);
CREATE INDEX idx_analysis_results_comments_sentiment ON analysis_results_comments(sentiment_label);
CREATE INDEX idx_analysis_results_media_task ON analysis_results_media(task_id);
CREATE INDEX idx_queue_jobs_status ON queue_jobs(status);
```

### 2.4 平台映射数据

内置支持的 11 个平台：

| platform_id | name | description |
|---|---|---|
| xhs | xiaohongshu | 小红书 |
| twitter | twitter | Twitter/X |
| weibo | weibo | 微博 |
| bilibili | bilibili | Bilibili |
| zhihu | zhihu | 知乎 |
| reddit | reddit | Reddit |
| douyin | douyin | 抖音 |
| instagram | instagram | Instagram |
| tiktok | tiktok | TikTok |
| weixin | weixin | 微信公众平台 |
| bluesky | bluesky | Bluesky |

每个平台在 `field_mappings` 表中预置 post 和 comment 字段映射到统一系统字段。

---

## 三、CLI 命令设计

```
scopai <command> [subcommand] [options]
```

### 3.1 平台管理

```
scopai platform list                       # 列出已注册平台
scopai platform add --id xhs --name xiaohongshu --description "小红书"
scopai platform mapping list --platform xhs --entity post
scopai platform mapping add --platform xhs --entity post \
    --system title --platform displayTitle --type string --required false
scopai platform mapping import --platform xhs --file ./xhs-mapping.json
```

### 3.2 数据导入

```
# 帖子导入
scopai post import --platform xhs --file ./posts.jsonl
scopai post import --platform weibo --csv ./weibo.csv --mapping ./weibo-post-mapping.json

# 评论导入
scopai comment import --platform xhs --file ./comments.jsonl
scopai comment import --platform xhs --post-id <id> --file ./comments.jsonl

# 单条导入（Agent 实时追加数据）
scopai post add --platform xhs \
    --platform-post-id 697f6c74... \
    --title "测试标题" \
    --content "正文内容" \
    --author-name "用户名" \
    --author-id "xxx" \
    --url https://www.xiaohongshu.com/...

# 数据查询
scopai post list --platform xhs --limit 50 --offset 0
scopai post list --platform xhs --where "like_count > 100"
scopai post search --platform xhs --query "关键词"
scopai comment list --post-id <id>
```

### 3.3 任务管理

```
# 创建分析任务
scopai task create \
    --name "Q1产品反馈分析" \
    --platforms xhs,weibo \
    --template sentiment-topics \
    --description "分析Q1各平台产品反馈"

# 任务关联数据
scopai task add-posts --task-id <id> --post-ids <id1>,<id2>
scopai task add-posts --task-id <id> --platform xhs --where "like_count > 50"
scopai task add-comments --task-id <id> --post-id <id>

# 任务控制
scopai task start --task-id <id>           # 手动触发
scopai task pause --task-id <id>
scopai task resume --task-id <id>
scopai task cancel --task-id <id>

# 任务查询
scopai task list --status running
scopai task status --task-id <id>          # 进度统计
```

### 3.4 Prompt 模板管理

```
scopai template list
scopai template add --name sentiment-topics \
    --description "情感+话题分析" \
    --template "分析以下内容的情感倾向和话题分类..."
scopai template update --id <id> --template "新模板内容..."
scopai template test --id <id> --input "这个产品很好用"
```

### 3.5 分析结果查询

```
# 查询结果
scopai result list --task-id <id> --target comment --limit 50
scopai result list --task-id <id> --filter "sentiment_label = 'negative'"
scopai result show --id <result-id>

# 统计聚合
scopai result stats --task-id <id>

# 导出
scopai result export --task-id <id> --format csv --output ./results.csv
scopai result export --task-id <id> --format json --output ./results.jsonl
```

### 3.6 守护进程管理

```
scopai daemon start       # 启动守护进程（后台）
scopai daemon start --fg   # 前台运行（调试）
scopai daemon stop          # 停止守护进程
scopai daemon status        # 查看状态
scopai daemon restart       # 重启
```

---

## 四、守护进程 (Daemon) 设计

### 4.1 职责

- 常驻 Node.js 进程，处理所有写操作
- 通过 Unix Socket 接收 CLI 请求（JSON-RPC 2.0）
- 协调 Bree 调度队列
- 管理 Worker 进程池

### 4.2 IPC 通信

```bash
# CLI 请求示例
echo '{"jsonrpc":"2.0","method":"task.create","params":{"name":"测试"},"id":1}' \
  | nc -U /tmp/scopai.sock

# 响应
{"jsonrpc":"2.0","result":{"id":"uuid-xxx"},"id":1}
```

**可用方法**：post.import, comment.import, task.create, task.addTargets, task.start, task.pause, task.status, daemon.status

### 4.3 Worker 进程池

- Worker 数量通过配置指定（默认 2）
- 每个 Worker 是独立进程，从队列取任务，调用 Claude，写结果
- 失败重试：最多 3 次，指数退避（2s, 4s, 8s）

---

## 五、Worker 设计

### 5.1 任务消费流程

```
1. Worker 从队列取任务 (status=pending)
2. 更新 queue_jobs.status = 'processing'
3. 根据 target_type 读取数据 + 模板，构造 Prompt
4. 调用 Anthropic API (Claude)
5. 解析 LLM JSON 响应
6. 写入 analysis_results_comments 或 analysis_results_media
7. 更新 task_targets.status = 'done'
8. 更新 queue_jobs.status = 'completed'
9. 更新 tasks.stats (done +1)
10. 异常: 写入 error，重试或标记 failed
```

### 5.2 Prompt 构造

模板从 `prompt_templates` 表读取，支持 `{{variable}}` 占位符替换：

```js
const prompt = template
  .replace('{{content}}', comment.content)
  .replace('{{platform}}', platform.name)
  .replace('{{published_at}}', comment.published_at || '未知')
  .replace('{{author_name}}', comment.author_name || '匿名');
```

### 5.3 Claude 调用

```js
const response = await anthropic.messages.create({
  model: 'claude-opus-4-5-20250514',
  max_tokens: 4096,
  messages: [{ role: 'user', content: prompt }]
});
const result = JSON.parse(response.content[0].text);
```

### 5.4 并发控制

- Worker 数量由 Daemon 配置指定，默认 2
- 每个 Worker 同时只处理 1 个任务
- 全局请求速率通过配置限制

---

## 六、配置管理

### 6.1 配置文件路径

```
优先: ~/.scopai/config.json
降级: Claude Code 配置文件 (实时读取，不导入)
最后: 环境变量 / 默认值
```

### 6.2 配置文件格式

```json
{
  "database": {
    "path": "~/.scopai/data.duckdb"
  },
  "anthropic": {
    "api_key": "${ANTHROPIC_API_KEY}",
    "model": "claude-opus-4-5-20250514",
    "max_tokens": 4096,
    "temperature": 0.3
  },
  "worker": {
    "concurrency": 2,
    "max_retries": 3,
    "retry_delay_ms": 2000
  },
  "paths": {
    "media_dir": "~/.scopai/media",
    "export_dir": "~/.scopai/exports"
  },
  "logging": {
    "level": "info"
  }
}
```

### 6.3 配置优先级

```
命令行参数 > 环境变量 > Claude Code 配置 > 配置文件 > 默认值
```

### 6.4 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude API Key | (必填) |
| `ANTHROPIC_BASE_URL` | API 端点 | `https://api.anthropic.com` |
| `ANALYZE_CLI_DB_PATH` | 数据库路径 | `~/.scopai/data.duckdb` |
| `ANALYZE_CLI_WORKERS` | Worker 数量 | `2` |
| `ANALYZE_CLI_LOG_LEVEL` | 日志级别 | `info` |

---

## 七、安装与部署

### 7.1 目录结构

```
~/.scopai/
├── config.json           # 配置文件
├── data.duckdb          # 数据库文件
├── media/               # 下载的媒体文件
│   └── {platform}/
│       └── {post_id}/
├── exports/             # 导出结果
│   └── {task_id}/
├── templates/           # 自定义 Prompt 模板
└── logs/                # 日志文件
```

### 7.2 npm 包结构

```
scopai/
├── package.json
├── src/
│   ├── cli/              # CLI 命令入口
│   ├── daemon/           # 守护进程
│   │   ├── index.ts
│   │   ├── ipc-server.ts
│   │   ├── bree-duckdb.ts
│   │   └── worker-pool.ts
│   ├── worker/           # Worker 进程
│   │   ├── index.ts
│   │   ├── consumer.ts
│   │   ├── anthropic.ts
│   │   └── parser.ts
│   ├── db/               # 数据库层
│   │   ├── client.ts
│   │   ├── schema.sql
│   │   └── migrations/
│   ├── config/           # 配置加载
│   │   └── index.ts
│   └── shared/           # 共享类型/工具
│       └── types.ts
├── templates/            # 内置 Prompt 模板
│   ├── sentiment.json
│   ├── topics.json
│   ├── risk.json
│   └── media-image.json
└── bin/
    └── scopai.js
```

### 7.3 初始化流程

```bash
# 安装
npm install -g scopai

# 首次运行
scopai daemon start

# 初始化时:
# 1. 检测 Claude Code 配置文件路径，实时读取 API Key
# 2. 创建默认数据库 schema（11张表）
# 3. 插入内置 Prompt 模板
# 4. 注册 11 个平台及其字段映射
# 5. 启动守护进程
```

---

## 八、数据类型汇总

### 8.1 枚举值

```ts
// posts.post_type
['text', 'image', 'video', 'audio', 'article', 'carousel', 'mixed']

// tasks.status
['pending', 'running', 'paused', 'completed', 'failed']

// task_targets.status
['pending', 'processing', 'done', 'failed']

// analysis_results_comments.sentiment_label
['positive', 'negative', 'neutral']

// analysis_results_comments.intent
['praise', 'complaint', 'question', 'suggestion', 'neutral', 'other']

// analysis_results_comments.risk_level
['low', 'medium', 'high']

// analysis_results_media.media_type
['image', 'video', 'audio']

// analysis_results_media.content_type
['product', 'person', 'scene', 'text', 'screenshot', 'meme', 'other']

// queue_jobs.status
['pending', 'processing', 'completed', 'failed']
```

### 8.2 JSON 字段说明

| 表 | 字段 | 内容示例 |
|---|---|---|
| posts | tags | `[{name: "话题1", url: "..."}]` |
| posts | media_files | `[{type: "image", url: "...", local_path: "..."}]` |
| comments | metadata | 平台特定字段兜底 |
| analysis_results_comments | topics | `[{name: "产品反馈", confidence: 0.8}]` |
| analysis_results_comments | emotion_tags | `[{tag: "愤怒", confidence: 0.6}]` |
| analysis_results_comments | keywords | `["关键词1", "关键词2"]` |
| analysis_results_media | objects | `[{label: "手机", confidence: 0.9}]` |
| analysis_results_media | logos | `[{name: "品牌", confidence: 0.85}]` |
| analysis_results_media | faces | `[{age: 25, gender: "female"}]` |

---

## 九、技术选型汇总

| 组件 | 技术选型 | 理由 |
|---|---|---|
| 开发语言 | TypeScript | 类型安全，IDE 支持好，便于维护 |
| 运行时 | Node.js | CLI 工具主流选择，生态丰富 |
| 数据库 | DuckDB | 列式存储向量化，分析查询快，零依赖 |
| 任务队列 | Bree + DuckDB Adapter | 无需 Redis，轻量，队列状态存 DuckDB |
| LLM | Anthropic Claude API | 用户指定 |
| 队列协调 | 守护进程 (Daemon) | 所有写操作统一入口，解决并发写入问题 |
| CLI 通信 | Unix Socket + JSON-RPC 2.0 | 进程间通信，无网络依赖，低延迟 |
| 配置 | config.json + Claude Code 配置 + 环境变量 | 复用 Claude Code 配置，避免重复 |
