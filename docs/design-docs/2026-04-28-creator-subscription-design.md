# 博主订阅功能设计

## 背景与目标

现有系统支持通过 `post import` 导入帖子数据进行分析，但缺少对特定博主的持续追踪能力。本功能允许用户将博主加入订阅列表，系统定期自动采集该博主的新发布内容，使分析对象从"一批帖子"扩展到"一个博主的持续产出"。

**核心目标：**
- 支持将博主加入订阅列表，记录博主元数据
- 支持一次性导入博主历史帖子
- 支持按配置频率定期自动同步博主新帖
- 兼容多平台数据结构，通过字段映射归一化
- 与现有 posts 表和分析 pipeline 无缝衔接

## 架构方案

采用**独立 Creator Sync Pipeline**（方案 B）：
- 不复用现有 `task` 系统，避免语义混淆
- 独立的 `creator_sync_jobs` 入队消费机制，复用 worker 并发能力
- 完整的审计日志（`creator_sync_logs`）
- 灵活的调度配置（`creator_sync_schedules`）

## 数据模型

### creators

存储博主基本信息和订阅状态。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 系统生成的唯一 ID |
| platform_id | TEXT FK | 所属平台，关联 platforms.id |
| platform_author_id | TEXT | 平台侧博主原始 ID |
| author_name | TEXT | 博主名称 |
| display_name | TEXT | 显示名称（可能与 author_name 不同） |
| bio | TEXT | 简介 |
| avatar_url | TEXT | 头像 URL |
| homepage_url | TEXT | 主页 URL |
| follower_count | INTEGER | 粉丝数 |
| following_count | INTEGER | 关注数 |
| post_count | INTEGER | 帖子数（平台统计） |
| status | TEXT | `active` / `paused` / `unsubscribed` |
| created_at | TIMESTAMP | 订阅时间 |
| updated_at | TIMESTAMP | 更新时间 |
| last_synced_at | TIMESTAMP | 上次成功同步时间 |
| metadata | JSON | 平台特定扩展字段 |

**约束：** `UNIQUE(platform_id, platform_author_id)`

### creator_field_mappings

博主数据的字段映射表，结构与现有 `field_mappings` 类似但独立管理。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 唯一 ID |
| platform_id | TEXT FK | 关联 platforms.id |
| entity_type | TEXT | 固定为 `creator`（预留扩展性） |
| system_field | TEXT | 系统标准字段名 |
| platform_field | TEXT | 平台原始字段名 |
| data_type | TEXT | `string` / `number` / `date` / `boolean` / `array` / `json` |
| is_required | BOOLEAN | 是否必填 |
| transform_expr | TEXT | 可选的转换表达式 |
| description | TEXT | 描述 |

**约束：** `UNIQUE(platform_id, entity_type, system_field)`

### creator_sync_jobs

同步任务队列，类似 `queue_jobs` 但独立管理。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 唯一 ID |
| creator_id | TEXT FK | 关联 creators.id |
| sync_type | TEXT | `initial`（历史全量）/ `periodic`（定期增量） |
| status | TEXT | `pending` / `processing` / `completed` / `completed_with_errors` / `failed` |
| posts_imported | INTEGER | 本次同步新导入帖子数 |
| posts_updated | INTEGER | 本次同步更新帖子数 |
| posts_skipped | INTEGER | 本次同步跳过（无变化）帖子数 |
| posts_failed | INTEGER | 本次同步失败帖子数 |
| cursor | TEXT | 分页断点（支持续传） |
| progress | JSON | 同步进度详情（当前页、总数等） |
| error | TEXT | 错误信息 |
| created_at | TIMESTAMP | 创建时间 |
| processed_at | TIMESTAMP | 处理完成时间 |

### creator_sync_logs

同步审计日志，每次同步完成（无论成功失败）写入一条记录。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 唯一 ID |
| creator_id | TEXT FK | 关联 creators.id |
| job_id | TEXT FK | 关联 creator_sync_jobs.id |
| sync_type | TEXT | `initial` / `periodic` |
| status | TEXT | `success` / `partial` / `failed` |
| result_summary | JSON | 结果摘要 `{ imported, updated, skipped, failed, duration_ms }` |
| started_at | TIMESTAMP | 同步开始时间 |
| completed_at | TIMESTAMP | 同步完成时间 |

### creator_sync_schedules

同步调度配置，每个 active 状态的 creator 可独立配置。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | 唯一 ID |
| creator_id | TEXT FK | 关联 creators.id，UNIQUE |
| interval_minutes | INTEGER | 同步间隔（分钟），如 60 表示每小时 |
| time_window_start | TIME | 可选：允许同步的开始时间 |
| time_window_end | TIME | 可选：允许同步的结束时间 |
| max_retries | INTEGER | 失败重试次数，默认 3 |
| retry_interval_minutes | INTEGER | 重试间隔（分钟），默认 30 |
| is_enabled | BOOLEAN | 是否启用自动同步 |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

## CLI 命令

```
scopai creator
  add       --platform <id> --author-id <id> [--name <name>]
            添加博主到订阅列表

  list      [--platform <id>] [--status active|paused|unsubscribed]
            列出订阅博主

  show      --id <creator_id>
            查看博主详情及最近同步历史

  sync      --id <creator_id> [--initial] [--wait]
            手动触发同步（--initial 导入历史全部帖子，--wait 阻塞等待完成）

  remove    --id <creator_id>
            取消订阅（status → unsubscribed，软删除）

  pause     --id <creator_id>
            暂停自动同步（status → paused）

  resume    --id <creator_id>
            恢复自动同步（status → active）

  mapping   add --platform <id> --system-field <field> --platform-field <field> [--type <type>]
            添加博主字段映射

  mapping   list --platform <id>
            列出博主字段映射
```

## API 路由

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/creators` | 添加订阅 |
| GET | `/creators` | 列出订阅，支持 `?platform=`、`?status=`、`?limit=`、`?offset=` |
| GET | `/creators/:id` | 获取博主详情 |
| POST | `/creators/:id/sync` | 触发同步，`{ sync_type: "initial" \| "periodic" }` |
| DELETE | `/creators/:id` | 取消订阅（软删除） |
| POST | `/creators/:id/pause` | 暂停同步 |
| POST | `/creators/:id/resume` | 恢复同步 |
| GET | `/creators/:id/posts` | 获取该博主已导入的帖子列表 |
| GET | `/creators/:id/sync-logs` | 获取同步历史 |
| GET | `/creators/:id/sync-schedule` | 获取同步调度配置 |
| POST | `/creators/:id/sync-schedule` | 更新同步调度配置 |
| GET | `/platforms/:id/creator-mappings` | 获取平台博主字段映射 |
| POST | `/platforms/:id/creator-mappings` | 添加平台博主字段映射 |

## 数据流

### 手动同步

```
CLI: scopai creator sync --id <creator_id> --initial
  → API: POST /creators/:id/sync { sync_type: "initial" }
    → 校验 creator 存在且 status ≠ unsubscribed
    → 检查是否已有 pending 的 sync job，有则拒绝
    → 创建 creator_sync_job（status: pending, sync_type: initial）
    → 返回 { job_id }
    → worker 消费 job
      → 更新 job status → processing
      → 查询 creator + platform + creator_field_mappings
      → 查询 creator_sync_schedules 获取配置（如无则使用默认值）
      → 执行 opencli 命令获取博主帖子列表
        → 模板变量替换: {author_id}, {platform_id}, {cursor}, {limit}
        → 分页获取，cursor 存入 job.progress
      → 根据 creator_field_mappings 归一化原始数据为标准帖子格式
      → 批量 upsert 到 posts 表（复用现有 createPost/updatePost）
        → 新帖子: 插入，author_id 关联 creators.id
        → 已有帖子 (platform_id + platform_post_id): 更新
      → 更新 job: status, posts_imported/updated/skipped/failed
      → 写入 creator_sync_logs 审计记录
      → 更新 creators.last_synced_at
      → 如 sync_type=initial 且还有下一页: 创建新的 sync job 继续
```

### 自动同步

```
daemon 定时器（每 5 分钟扫描一次）
  → 查询 creator_sync_schedules 中 is_enabled=true 的记录
  → 关联 creators 表过滤 status=active
  → 过滤 last_synced_at + interval_minutes < now() 的记录
  → 为每个符合条件的 creator 创建 periodic sync job
  → worker 消费
    → 执行 opencli 命令，模板变量 {since} = creators.last_synced_at
    → 只获取该时间点之后的新帖
    → 归一化、upsert 导入
    → 更新 job、log、creators.last_synced_at
```

## 字段映射归一化

博主帖子的字段映射与现有帖子导入逻辑对齐：

1. 通过 `creator_field_mappings` 定义平台原始字段 → 系统标准字段的映射
2. 系统标准字段与 `posts` 表字段一致：`platform_post_id`, `title`, `content`, `author_id`, `author_name`, `url`, `cover_url`, `like_count`, `comment_count`, `published_at`, `metadata` 等
3. `FIELD_NAME_MAP`（如 `likes` → `like_count`）复用现有归一化逻辑
4. `transform_expr` 支持简单转换（如字符串日期 → ISO 格式）

归一化后的数据结构与 `posts/import` 接口期望的格式完全一致，直接调用现有 CRUD 函数导入。

## opencli 模板约定

平台配置中新增 `creator_templates`（或在现有 `cli_templates` 中扩展）：

```json
{
  "fetch_creator_posts": "opencli xhs creator-posts --author-id {author_id} --cursor {cursor} --limit {limit}",
  "fetch_creator_info": "opencli xhs creator-info --author-id {author_id}"
}
```

模板变量：
- `{author_id}`: 博主的 platform_author_id
- `{platform_id}`: 平台 ID
- `{cursor}`: 分页游标（首次为空）
- `{limit}`: 每页数量（默认 20）
- `{since}`: 时间戳（ISO 8601，仅 periodic 同步使用）

返回格式：JSON 数组，每个元素为原始帖子对象，字段名与 `creator_field_mappings` 中的 `platform_field` 对应。

## 错误处理

| 场景 | 处理方式 |
|------|----------|
| opencli 执行失败 | 标记 job 为 `failed`，记录 error，sync_logs 记录失败详情，不阻塞其他 creator 的同步 |
| 部分帖子导入失败 | 记录失败数量，成功部分正常导入，job 标记为 `completed_with_errors` |
| 博主信息获取失败（如博主已注销/封号） | 标记 job `failed`，sync_logs 记录，可选择将该 creator status 设为 `paused` |
| 分页获取中断（网络/超时） | cursor 已存入 job.progress，支持重新创建 job 从断点续传 |
| 重复 sync 请求 | 检查 pending job，有则拒绝并返回现有 job_id |
| 调度配置冲突 | 校验 time_window_start < time_window_end，interval_minutes >= 5 |

## 与现有系统的集成

### 复用现有组件

- **opencli 执行**: 复用 `packages/core/src/data-fetcher/opencli.ts` 的 `fetchViaOpencli`
- **帖子导入**: 复用 `packages/core/src/db/` 中的 `createPost` / `updatePost` CRUD
- **字段归一化**: 复用 `postsRoutes` 中的 `normalizeFieldValueArray` 和 `FIELD_NAME_MAP`
- **Worker 消费**: 扩展 `consumer.ts`，新增 `creator_sync` job type 的处理分支
- **Lock file / API 通信**: 复用现有机制，CLI 通过 HTTP 调用 API

### 新增组件

- **DB**: `creators`, `creator_field_mappings`, `creator_sync_jobs`, `creator_sync_logs`, `creator_sync_schedules` 的 CRUD 模块
- **API Routes**: `packages/api/src/routes/creators.ts`
- **CLI**: `packages/cli/src/creator.ts`
- **Worker**: `consumer.ts` 中新增 `processCreatorSyncJob` 函数

## 测试策略

| 测试类型 | 范围 | 验证点 |
|----------|------|--------|
| DB CRUD 单元测试 | creators, creator_field_mappings, sync_jobs, sync_logs, sync_schedules | 增删改查、约束、关联查询 |
| API 路由 e2e | POST/GET/DELETE /creators, /creators/:id/sync, /creators/:id/sync-schedule | 请求/响应格式、状态码、边界条件 |
| 同步数据流集成测试 | mock opencli 返回 → 归一化 → 导入 posts → 验证 upsert | 字段映射正确性、重复导入更新、分页续传 |
| 自动调度测试 | mock 时间推进，验证 daemon 按 schedule 创建 jobs | 间隔计算、时间窗口过滤、失败重试 |
| Worker 消费测试 | 直接调用 processCreatorSyncJob，mock opencli | 成功/失败/部分失败的状态流转 |

## 风险与注意事项

1. **数据量**: initial 同步可能获取大量历史帖子，需支持分页和断点续传，避免内存溢出
2. **频率限制**: opencli 调用可能受平台 API 频率限制，需在 schedule 中配置合理的 interval
3. **博主更名/改名**: platform_author_id 不变但 author_name 可能变化，upsert 时更新博主信息
4. **与现有 task 系统的区分**: creator 同步产生的帖子可被 task 引用分析，但 sync job 不进入 task/targets/queue_jobs 体系
