# 数据库结构摘要

本文件根据当前 `src/db/schema.sql` 整理，供文档快速查阅使用。

## 核心表

### 基础数据

- `platforms`：平台定义
- `field_mappings`：平台字段到系统字段的映射
- `posts`：帖子或笔记原始数据
- `comments`：评论原始数据
- `media_files`：媒体文件记录

### 分析配置

- `prompt_templates`：分析模板
- `tasks`：分析任务
- `task_targets`：任务绑定的目标集
- `queue_jobs`：待执行和执行中的队列任务

### 分析结果

- `analysis_results_comments`：评论分析结果
- `analysis_results_media`：媒体分析结果

## 关键关系

- `field_mappings.platform_id -> platforms.id`
- `posts.platform_id -> platforms.id`
- `comments.post_id -> posts.id`
- `comments.platform_id -> platforms.id`
- `media_files.post_id -> posts.id`
- `media_files.comment_id -> comments.id`
- `tasks.template_id -> prompt_templates.id`
- `task_targets.task_id -> tasks.id`
- `queue_jobs.task_id -> tasks.id`
- `analysis_results_comments.task_id -> tasks.id`
- `analysis_results_comments.comment_id -> comments.id`
- `analysis_results_media.task_id -> tasks.id`
- `analysis_results_media.media_id -> media_files.id`

## 当前使用重点

- 任务执行关注：`tasks`、`task_targets`、`queue_jobs`
- 评论分析关注：`comments`、`analysis_results_comments`
- 导出和聚合关注：`analysis_results_comments` 与 `analysis_results_media`

## 来源

- 真实 schema：`src/db/schema.sql`
