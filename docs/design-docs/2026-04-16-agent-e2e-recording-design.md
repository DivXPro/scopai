# Agent 驱动的 E2E 数据录制与离线测试设计

## 目标

构建一套可复用的 Agent 驱动录制机制，使 AI Agent 能够通过 OpenCLI 获取真实平台数据，并调用 `scopai` CLI 完成数据导入。同时，将本次在线交互中获取的原始数据自动保存为 fixture，并生成对应的离线测试文件，供后续 CI 和回归测试使用。

## 背景

- 现有 `test/xhs-shanghai-food.test.ts` 等 E2E 测试直接调用 `fetchViaOpencli` 和 DB API，**未使用 CLI 作为入口**，与真实工作流存在偏差。
- 现有 `test/import-offline.test.ts` 使用 `test-data/mock/` 下的静态 fixture，但这些 fixture 是手工维护的，无法反映平台数据格式变化。
- 未来真实场景是：**Agent 调用 OpenCLI → Agent 调用 scopai CLI → 数据进入数据库**。本设计旨在让测试体系与这一工作流对齐。

## 核心工作流

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  AI Agent   │────▶│  OpenCLI     │────▶│  真实平台数据     │
│  (当前会话)  │     │  (search)    │     │  (帖子列表)       │
└─────────────┘     └──────────────┘     └──────────────────┘
       │
       │  调用 scopai CLI
       ▼
┌─────────────────────────────────────────────────────────────┐
│  scripts/record-e2e-fixture.ts                               │
│  ├─ 1. 调用 CLI: post import --platform <p> --file <f>      │
│  ├─ 2. 从数据库读取已导入的帖子列表                            │
│  ├─ 3. 对每个帖子调用 OpenCLI 获取评论/媒体                    │
│  ├─ 4. 调用 CLI: comment import --post-id <id> --file <f>   │
│  ├─ 5. 调用 CLI: task prepare-data --task-id <id> (可选)     │
│  └─ 6. 将原始响应保存为 fixture，生成离线测试文件             │
└─────────────────────────────────────────────────────────────┘
```

## 组件设计

### 1. 录制脚本 `scripts/record-e2e-fixture.ts`

录制脚本是整个方案的核心协调器，负责串联 Agent、OpenCLI、CLI 和 fixture 生成。

**职责**
- 接收平台名称、搜索关键词、输出目录等参数
- 通过 `child_process.spawn` 或 `execFile` 调用 `scopai` 命令
- 通过 OpenCLI 命令模板获取真实数据
- 将原始 JSON/JSONL 响应写入 `test-data/recorded/<timestamp>/`
- 基于 fixture 生成离线测试文件到 `test/`

**命令行接口（示例）**
```bash
npx tsx scripts/record-e2e-fixture.ts \
  --platform xhs \
  --query "上海美食" \
  --limit 3 \
  --output test-data/recorded/2026-04-16-xhs-shanghai
```

**内部流程**
1. **创建 platform**：调用 `scopai platform add --id <id> --name <name>`
2. **搜索帖子**：调用 `opencli xiaohongshu search <query> --limit <n> -f json`，保存原始响应为 `<output>/posts_raw.json`
3. **导入帖子**：调用 `scopai post import --platform <id> --file <output>/posts_raw.jsonl`
4. **遍历帖子获取详情**：对每个 `note_id`，调用 `opencli xiaohongshu comments <note_id> ...` 和 `opencli xiaohongshu download <note_id> ...`
5. **保存原始响应**：评论存为 `<output>/comments_<post_id>.jsonl`，媒体存为 `<output>/media_<post_id>.jsonl`
6. **导入评论**：调用 `scopai comment import --post-id <id> --file ...`
7. **创建 task 并 prepare-data**（可选）：模拟完整链路
8. **生成离线测试**：基于 fixture 目录生成 `test/import-recorded-<name>.test.ts`

### 2. Fixture 目录结构

```
test-data/recorded/
└── 2026-04-16-xhs-shanghai/
    ├── manifest.json          # 元数据：平台、关键词、帖子数、生成时间
    ├── posts_raw.jsonl        # OpenCLI 搜索原始响应
    ├── posts_transformed.jsonl # 适配 scopai post import 的格式
    ├── comments_<post_id>.jsonl
    ├── media_<post_id>.jsonl
    └── generated/
        └── import-recorded-xhs-shanghai.test.ts  # 自动生成的离线测试
```

`manifest.json` 示例：
```json
{
  "platform": "xhs_shanghai_20260416",
  "query": "上海美食",
  "limit": 3,
  "recordedAt": "2026-04-16T10:30:00Z",
  "posts": ["post_id_1", "post_id_2"],
  "fixtures": {
    "posts": "posts_transformed.jsonl",
    "comments": ["comments_post_id_1.jsonl"],
    "media": ["media_post_id_1.jsonl"]
  }
}
```

### 3. 自动生成的离线测试文件

离线测试的职责是：**验证 fixture 数据能否被正确导入数据库**，不调用任何外部 API。

**生成规则**
- 测试结构与现有 `import-offline.test.ts` 保持一致（使用 `node:test`，DuckDB reset + seed）
- 直接读取 fixture 文件，调用 `createPost` / `createComment` / `createMediaFile` 等 DB API
- 断言导入数量、字段完整性、关联正确性

**生成的测试骨架**
```typescript
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
// ... DB imports

const FIXTURE_DIR = path.join(process.cwd(), 'test-data/recorded/2026-04-16-xhs-shanghai');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'manifest.json'), 'utf-8'));

describe('import — recorded xhs shanghai fixture', { timeout: 15000 }, () => {
  let postIds: string[] = [];

  before(async () => {
    closeDb();
    await runMigrations();
    await seedAll();
    await createPlatform({ id: MANIFEST.platform, name: 'Recorded XHS' });
  });

  it('should import posts from fixture', async () => {
    // read posts_transformed.jsonl, createPost for each line
  });

  it('should import comments from fixture', async () => {
    // read comments_*.jsonl, createComment for each line
  });

  // ... media, integrity assertions
});
```

## 与现有测试体系的对齐

| 维度 | 现有 E2E (`xhs-shanghai-food.test.ts`) | 离线 fixture (`import-offline.test.ts`) | 新录制方案 |
|------|----------------------------------------|------------------------------------------|------------|
| 调用 OpenCLI | 是 | 否 | **Agent 调用** |
| 调用 scopai CLI | 否 | 否 | **是** |
| 可复用 fixture | 否 | 是 | **是** |
| 反映真实工作流 | 低 | 中 | **高** |
| 维护成本 | 高（依赖真实 API 稳定性） | 低 | **中**（定期重录即可） |

## 错误处理

1. **OpenCLI 调用失败**：脚本应记录失败的命令和错误信息，跳过该步骤，继续处理其他帖子，并在 `manifest.json` 中标记失败的步骤。
2. **CLI 导入失败**：如果 `post import` 或 `comment import` 返回非零退出码，脚本应捕获 stderr 并提示用户。
3. **部分帖子缺失评论/媒体**：这是正常情况，脚本应生成空 fixture 文件或跳过，不影响整体流程。
4. **数据库重复导入**：生成的离线测试应使用唯一 platform_id（如 `manifest.json` 中指定的 id），避免与现有测试冲突。

## 非目标

- 不修改 `scopai` 核心 CLI 命令的签名或行为
- 不在 `scopai` 运行时内置 fixture 录制逻辑
- 不引入新的测试框架，继续使用 `node:test`

## 验收标准

- [ ] 录制脚本可成功从 OpenCLI 获取 XHS 帖子、评论、媒体数据
- [ ] 录制脚本成功调用 `scopai` CLI 完成所有导入操作
- [ ] fixture 目录包含 `manifest.json` 和所有原始响应文件
- [ ] 自动生成一个离线测试文件，运行 `node --test` 可全部通过
- [ ] 不修改 `src/` 下的任何核心源代码
