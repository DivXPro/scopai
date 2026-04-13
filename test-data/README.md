# 测试数据

用于测试 analyze-cli 功能的小红书模拟数据。

## 文件说明

| 文件 | 说明 | 数据量 |
|------|------|--------|
| `xhs_posts.jsonl` | 小红书笔记数据（AI工具相关） | 5条 |
| `xhs_comments_post1.jsonl` | 笔记1的评论（ChatGPT相关） | 5条 |
| `xhs_comments_post2.jsonl` | 笔记2的评（编程工具横评） | 8条 |

## 使用方法

```bash
# 1. 导入笔记
analyze-cli post import --platform xhs --file test-data/xhs_posts.jsonl

# 2. 查看导入的笔记，获取 post-id
analyze-cli post list --platform xhs --limit 5

# 3. 导入评论（替换为实际的 post-id）
analyze-cli comment import --platform xhs --post-id <post-id-1> --file test-data/xhs_comments_post1.jsonl
analyze-cli comment import --platform xhs --post-id <post-id-2> --file test-data/xhs_comments_post2.jsonl

# 4. 创建分析任务
analyze-cli task create --name "测试分析" --template sentiment-topics

# 5. 添加评论到任务
analyze-cli task add-comments --task-id <task-id> --comment-ids <id1>,<id2>,...

# 6. 启动分析
analyze-cli task start --task-id <task-id>
```
