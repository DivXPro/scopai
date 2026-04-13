# analyze-cli 测试方案

## 测试目标
使用 opencli 从小红书获取真实数据，导入 analyze-cli，创建分析任务，验证完整的社交媒体分析流程。

## 前置条件
1. Chrome 已登录小红书账号
2. opencli 已安装并可用
3. ANTHROPIC_API_KEY 已配置（用于 Claude API 调用）

## 测试流程

### 阶段一：环境准备验证
**目标**: 验证 analyze-cli 基础功能正常

| 步骤 | 命令 | 预期结果 |
|------|------|----------|
| 1 | `analyze-cli platform list` | 列出 11 个内置平台（含 xhs） |
| 2 | `analyze-cli platform mapping list --platform xhs` | 显示小红书字段映射 |
| 3 | `analyze-cli template list` | 显示 3 个内置模板（sentiment-topics, risk-detection, media-image） |

### 阶段二：数据获取与导入
**目标**: 通过 opencli 获取小红书数据并导入 analyze-cli

#### 2.1 获取小红书笔记数据
```bash
# 搜索热门笔记（选择一个常见关键词，如 "AI" 或 "编程"）
opencli xiaohongshu search --query "AI工具" --limit 5 -f json > /tmp/xhs_notes.json

# 或者获取信息流数据
opencli xiaohongshu feed --limit 5 -f json > /tmp/xhs_feed.json
```

#### 2.2 转换数据格式并导入
opencli 输出的 JSON 格式需要转换为 analyze-cli 的 JSONL 格式：
- 每个笔记一行 JSON
- 字段映射到 analyze-cli 的 posts 表结构

#### 2.3 获取评论数据
```bash
# 对获取到的笔记，逐个获取评论
opencli xiaohongshu comments --note-id <note_id> --limit 20 -f json > /tmp/xhs_comments.json
```

#### 2.4 导入数据
```bash
# 导入笔记
analyze-cli post import --platform xhs --file /tmp/xhs_posts.jsonl

# 导入评论（需要先获取 post_id）
analyze-cli comment import --platform xhs --post-id <post_id> --file /tmp/xhs_comments.jsonl
```

### 阶段三：数据查询验证
**目标**: 验证数据正确导入

| 步骤 | 命令 | 预期结果 |
|------|------|----------|
| 1 | `analyze-cli post list --platform xhs --limit 10` | 显示导入的笔记列表 |
| 2 | `analyze-cli post search --platform xhs --query "关键词"` | 搜索到相关笔记 |
| 3 | `analyze-cli comment list --post-id <id>` | 显示对应笔记的评论 |

### 阶段四：分析任务创建与执行
**目标**: 创建分析任务，触发 AI 分析

| 步骤 | 命令 | 预期结果 |
|------|------|----------|
| 1 | `analyze-cli task create --name "小红书AI工具反馈分析" --template sentiment-topics` | 返回任务 ID |
| 2 | `analyze-cli task add-comments --task-id <id> --comment-ids <id1>,<id2>...` | 添加评论到任务 |
| 3 | `analyze-cli task start --task-id <id>` | 开始分析，显示入队数量 |
| 4 | `analyze-cli task status --task-id <id>` | 显示任务进度 |

### 阶段五：分析结果验证
**目标**: 验证 AI 分析结果正确写入数据库

| 步骤 | 命令 | 预期结果 |
|------|------|----------|
| 1 | `analyze-cli result list --task-id <id> --limit 10` | 显示分析结果（情感、意图等） |
| 2 | `analyze-cli result stats --task-id <id>` | 显示统计聚合数据 |
| 3 | `analyze-cli result show --id <result-id>` | 显示单条结果详情 |
| 4 | `analyze-cli result export --task-id <id> --format json` | 导出 JSON 结果 |
| 5 | `analyze-cli result export --task-id <id> --format csv --output /tmp/results.csv` | 导出 CSV 文件 |

### 阶段六：守护进程测试（可选）
**目标**: 验证守护进程的启动/停止

| 步骤 | 命令 | 预期结果 |
|------|------|----------|
| 1 | `analyze-cli daemon start` | 后台启动守护进程 |
| 2 | `analyze-cli daemon status` | 显示运行状态 |
| 3 | `analyze-cli daemon stop` | 停止守护进程 |

## 成功标准
1. 数据导入无报错，数量正确
2. 查询能正确返回数据
3. 任务创建和启动成功
4. 分析结果正确写入数据库
5. 导出功能正常生成文件

## 风险与注意事项
1. opencli 获取的数据字段名称可能不完全匹配，需要编写转换脚本
2. Claude API 调用需要有效的 API Key
3. 大量评论分析可能需要较长时间
4. 建议先用少量数据（3-5 条笔记，10-20 条评论）测试
