# CLI 阻塞等待模式实施计划

**Goal:** 让 `task step run` 和 `task run-all-steps` 支持 `--wait` 阻塞模式，执行期间持续输出进度，Agent 一次调用即可等到完成，无需轮询脚本。

**Date:** 2026-04-18

---

## 背景

当前 Agent 调用 `task step run` 或 `task run-all-steps` 后，命令立即返回"已入队"。Agent 必须通过临时脚本反复执行 `task status` 才能得知执行结果，这种方式：

- 可靠性低：脚本可能超时、出错、被中断
- 安全性差：脚本注入风险
- 体验差：Agent 需要自行管理轮询逻辑

`task prepare-data` 已在 CLI 内部实现阻塞轮询，Agent 一次调用即可等到完成。本计划将同样的模式扩展到步骤执行。

---

## 方案设计

### 1. CLI 接口

```bash
# 阻塞到该步骤执行完成（默认）
analyze-cli task step run --task-id <id> --step-id <id> --wait

# 立即返回（保持现有行为）
analyze-cli task step run --task-id <id> --step-id <id> --no-wait

# 阻塞到所有步骤执行完成
analyze-cli task run-all-steps --task-id <id> --wait
```

输出格式（默认 Agent 模式）：
```
[2025-01-09T10:23:45] Step: sentiment-analysis | status: running | 15/30 done, 1 failed
[2025-01-09T10:23:47] Step: sentiment-analysis | status: running | 28/30 done, 1 failed
[2025-01-09T10:23:48] Step: sentiment-analysis | status: completed | 30/30 done, 1 failed
```

### 2. 内部机制

```
task step run --wait:
  1. 发送 task.step.run IPC 请求，获取初始状态
  2. 如果状态已经是 completed/skipped → 直接输出并返回
  3. 否则进入轮询循环（每 2 秒）：
     a. 发送 task.status 查询
     b. 定位当前 step 的状态和 stats
     c. 如果 stats 有变化 → 输出进度行
     d. 如果 step 状态变为 completed/failed/skipped → 输出最终结果并返回
     e. 如果超过 30 分钟 → 超时退出
  4. 返回最终的 step 状态

task run-all-steps --wait:
  1. 发送 task.runAllSteps IPC 请求，获取入队结果
  2. 查询所有步骤的初始状态
  3. 进入轮询循环（每 2 秒）：
     a. 发送 task.status 查询
     b. 遍历所有步骤，统计完成/运行/失败数量
     c. 如果有变化 → 输出进度行
     d. 如果所有步骤都 completed/failed/skipped → 输出最终结果并返回
     e. 如果超过 30 分钟 → 超时退出
  4. 返回最终汇总
```

### 3. 文件变更

| 文件 | 变更 |
|------|------|
| `src/cli/task.ts` | `task step run` 添加 `--wait/--no-wait` 选项，增加内部轮询逻辑；`task run-all-steps` 添加 `--wait/--no-wait` 选项 |
| `src/shared/utils.ts` | 新增 `waitForTaskStep()` 和 `waitForTaskSteps()` 共享等待函数（供 CLI 和 daemon 内部使用） |
| `src/daemon/handlers.ts` | 确认 `task.status` 返回的数据结构包含步骤 stats（已确认有） |

### 4. 关键实现细节

**轮询间隔：** 2 秒固定间隔（和 prepare-data 一致）
**超时时间：** 30 分钟（可配置，默认）
**进度去重：** 只在上一次输出后 stats 有变化时才输出新行，避免刷屏
**错误处理：**
- daemon 崩溃 → IPC 错误，退出码 1
- 超时 → 退出码 1，输出当前状态
- step 失败 → 退出码 1，输出失败信息

### 5. Agent 工作流变化

**Before（需要轮询脚本）：**
```
Agent: task step run --task-id xxx --step-id yyy
→ "Enqueued 30 jobs"
Agent: [写临时脚本循环执行 task status]
→ 脚本超时/出错风险
```

**After（一次调用阻塞完成）：**
```
Agent: task step run --task-id xxx --step-id yyy --wait
→ [10:23:45] Step: sentiment-analysis | status: running | 15/30 done
→ [10:23:47] Step: sentiment-analysis | status: running | 28/30 done
→ [10:23:48] Step: sentiment-analysis | status: completed | 30/30 done
```

---

## 测试计划

1. 启动 daemon，创建 task 和 step
2. `task step run --wait` → 验证进度输出和阻塞行为
3. `task run-all-steps --wait` → 验证多步骤顺序执行和进度输出
4. 中断 daemon 测试错误处理
5. 验证 `--no-wait` 保持原有立即返回行为

---

## 范围控制

- **In scope:** CLI 命令的 `--wait` 模式、进度输出、超时处理
- **Out of scope:** WebSocket/SSE 推送、多任务订阅、结果回调
