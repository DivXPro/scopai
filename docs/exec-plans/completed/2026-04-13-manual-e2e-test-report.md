# scopai 测试报告

> 测试日期: 2026-04-13
> 测试环境: macOS, Node.js v25.8.1, DuckDB

---

## 测试结果总览

| 阶段 | 测试项 | 状态 | 备注 |
|------|--------|------|------|
| 一 | `platform list` | ✅ 通过 | 11个平台正确注册 |
| 一 | `template list` | ✅ 通过 | 3个内置模板正确加载 |
| 一 | `platform mapping list --platform xhs` | ✅ 通过 | 13条字段映射正确 |
| 二 | `post import` (5条笔记) | ✅ 通过 | 导入5条，跳过0条 |
| 二 | `comment import` (13条评论) | ✅ 通过 | 两批分别导入5+8条 |
| 三 | `post list` | ✅ 通过 | 正确显示5条笔记 |
| 三 | `comment list` | ✅ 通过 | 正确显示5条评论及作者/点赞数 |
| 四 | `task create` | ✅ 通过 | 任务创建成功 |
| 四 | `task add-comments` | ✅ 通过 | 正确添加评论到任务 |
| 四 | `task start` | ✅ 通过 | 10个job成功入队 |
| 四 | `task status` | ✅ 通过 | 进度统计正确 |
| 四 | `task list` | ✅ 通过 | 任务列表及进度显示正确 |
| 五 | `result list` | ✅ 通过 | 3条分析结果正确显示 |
| 五 | `result stats` | ✅ 通过 | 情感/意图统计聚合正确（含柱状图） |
| 五 | `result export --format json` | ✅ 通过 | JSONL格式导出正确 |
| 五 | `result export --format csv` | ✅ 通过 | CSV文件生成正确（含中文转义） |

## Bug 修复记录

测试过程中发现并修复了以下问题：

1. **`schema.sql` 路径问题** — `migrate.ts` 从 `dist/db/` 找不到 schema，修复为回退到 `src/db/`
2. **`config` 空字符串覆盖默认值** — `deepMerge` 用空字符串覆盖了默认 DB path，修复为跳过空字符串
3. **DuckDB 异步问题** — DuckDB Node.js 绑定是异步的，将整个 DB 层、CLI 层、Daemon 层、Worker 层全部改为 `async/await`
4. **`task list` stats 未反序列化** — stats 存为 JSON 字符串，CLI 读取时需 `JSON.parse`

## 未测试项（需要 ANTHROPIC_API_KEY）

| 测试项 | 说明 |
|--------|------|
| Worker 实际分析 | 需要 Claude API Key 才能调用 |
| `daemon start/stop/status` | 守护进程管理 |
| `post search` | 全文搜索（LIKE 查询） |
| `template test` | 模板渲染测试 |
| `result show --id` | 单条结果详情 |

## 如何使用 opencli 真实数据测试

1. 安装 opencli 浏览器扩展：
   - 下载 https://github.com/jackwener/opencli/releases
   - Chrome → `chrome://extensions/` → 开发者模式 → 加载已解压的扩展
2. 确保 Chrome 已登录小红书
3. 运行 `opencli xiaohongshu search "关键词" --limit 5 -f json > /tmp/xhs.json`
4. 转换 JSON 格式为 JSONL 并导入：
   ```bash
   scopai post import --platform xhs --file /tmp/xhs_posts.jsonl
   ```
