# 抖音平台适配设计

## 目标

为 scopai 添加抖音(douyin)平台适配，采用 PlatformAdapter 注册表模式，将平台特定逻辑从硬编码 if/else 抽取为可扩展的适配器接口。

## 背景

当前平台特定逻辑散布在多处硬编码中：
- `handlers.ts` 中 `getDefaultFetchMediaTemplate()` 的 if/else 链
- `handlers.ts` 中平台目录名映射的 if/else 链
- `seed.ts` 中仅 xhs 有 `profile_fetch_template` 和 `posts_fetch_template`
- `creator-sync.ts` 中 `FALLBACK_POSTS_TEMPLATE` 硬编码为 xiaohongshu
- `POST_FIELD_MAP` 缺少抖音特有字段映射（`awemeId`, `diggCount` 等）
- `creator-sync.ts` 中 homepage URL 拼接硬编码 if/else

抖音的基础设施已部分存在：
- `PLATFORMS` 常量中已有 `douyin` 定义
- `PLATFORM_MAPPINGS` 种子数据中已有抖音字段映射
- `getDefaultFetchMediaTemplate()` 已有抖音分支
- 目录名解析已有 `dy`/`douyin` 分支

## 设计

### PlatformAdapter 接口

```typescript
// packages/core/src/platforms/types.ts

export interface PlatformDefaultTemplates {
  fetchNote: string;
  fetchComments?: string;
  fetchMedia: string;
}

export interface PlatformCreatorTemplates {
  profileFetch: string;
  postsFetch: string;
}

export interface PlatformAdapter {
  /** 平台 ID，与 PLATFORMS 常量中的 id 一致 */
  id: string;

  /** 默认 cli_templates，用于 task prepare-data */
  defaultTemplates: PlatformDefaultTemplates;

  /** creator sync 模板 */
  creatorTemplates?: PlatformCreatorTemplates;

  /** 平台目录名，用于下载路径 */
  directoryName: string;

  /** 平台特有帖子字段 -> 内部字段的映射，合并到 POST_FIELD_MAP */
  fieldMap: Record<string, string>;

  /** 平台特有用户资料字段 -> 内部字段的映射 */
  profileFieldMap?: Record<string, string>;

  /** 平台特有评论字段 -> 内部字段的映射 */
  commentFieldMap?: Record<string, string>;

  /** 用户主页 URL 模板，{platform_creator_id} 为占位符 */
  homepageUrlTemplate?: string;
}
```

### 注册表

```typescript
// packages/core/src/platforms/registry.ts

const adapters: Map<string, PlatformAdapter> = new Map();

export function registerPlatform(adapter: PlatformAdapter): void;
export function getPlatformAdapter(platformId: string): PlatformAdapter | undefined;
export function getAllPlatformAdapters(): PlatformAdapter[];
```

### 平台适配器实例

每个平台一个文件，放在 `packages/core/src/platforms/` 下：

**douyin.ts**:
```typescript
export const douyinAdapter: PlatformAdapter = {
  id: 'douyin',
  defaultTemplates: {
    // search 结果已覆盖 note 的所有字段，无需重复抓取
    fetchNote: '',
    fetchComments: 'opencli douyin comment {url} --limit {limit} -f json',
    fetchMedia: 'opencli douyin download {url} --output {download_dir}/{platform} -f json',
  },
  creatorTemplates: {
    profileFetch: 'opencli douyin user-info {author_id} -f json',
    postsFetch: 'opencli douyin user-videos {author_id} --limit {limit} -f json',
  },
  directoryName: 'douyin',
  fieldMap: {
    // search / note 命令均返回驼峰风格
    awemeId: 'platform_post_id',
    diggCount: 'like_count',
    collectCount: 'collect_count',
    shareCount: 'share_count',
    commentCount: 'comment_count',
    nickname: 'author_name',
    secUid: 'author_id',
    uid: 'author_id',
    isImage: 'post_type',
    createTime: 'published_at',
    desc: 'content',
    hashtags: 'tags',
  },
  profileFieldMap: {
    nickname: 'author_name',
    avatarUrl: 'avatar_url',
    followerCount: 'follower_count',
    followingCount: 'following_count',
    desc: 'bio',
    secUid: 'platform_creator_id',
  },
  commentFieldMap: {
    cid: 'platform_comment_id',
    text: 'content',
    diggCount: 'like_count',
    nickname: 'author_name',
    secUid: 'author_id',
    uid: 'author_id',
    replyCommentTotal: 'reply_count',
    createTime: 'published_at',
  },
  homepageUrlTemplate: 'https://www.douyin.com/user/{platform_creator_id}',
};
```

**xhs.ts** — 从现有硬编码逻辑提取：
```typescript
export const xhsAdapter: PlatformAdapter = {
  id: 'xhs',
  defaultTemplates: {
    fetchNote: 'opencli xiaohongshu note {url} -f json',
    fetchComments: 'opencli xiaohongshu comments {note_id} --limit {limit} -f json',
    fetchMedia: 'opencli xiaohongshu download {url} --output {download_dir}/{platform} -f json',
  },
  creatorTemplates: {
    profileFetch: 'opencli xiaohongshu user-info {author_id} --format json',
    postsFetch: 'opencli xiaohongshu user {author_id} --format json',
  },
  directoryName: 'xhs',
  fieldMap: {
    note_id: 'platform_post_id',
    likes: 'like_count',
    collects: 'collect_count',
    comments: 'comment_count',
    shares: 'share_count',
    plays: 'play_count',
    user_id: 'author_id',
  },
  profileFieldMap: {
    name: 'author_name',
    avatar: 'avatar_url',
    followers: 'follower_count',
    following: 'following_count',
    bio: 'bio',
    redId: 'platform_creator_id',
  },
  commentFieldMap: {
    id: 'platform_comment_id',
    content: 'content',
    likes: 'like_count',
    username: 'author_name',
    userId: 'author_id',
    subCommentCount: 'reply_count',
    createTime: 'published_at',
  },
  homepageUrlTemplate: 'https://www.xiaohongshu.com/user/profile/{platform_creator_id}',
};
```

**bilibili.ts**:
```typescript
export const bilibiliAdapter: PlatformAdapter = {
  id: 'bilibili',
  defaultTemplates: {
    fetchNote: '',
    fetchMedia: 'opencli bilibili download {url} --output {download_dir}/{platform} -f json',
  },
  directoryName: 'bilibili',
  fieldMap: {},
};
```

### 现有代码改造

#### 1. normalizePostItem（`packages/core/src/shared/utils.ts`）

- `normalizePostItem(raw, platformId?)` 新增可选 `platformId` 参数
- 调用时从 `getPlatformAdapter(platformId)` 获取 `fieldMap`，合并到 `POST_FIELD_MAP` 后再归一化
- 不传 `platformId` 时行为不变（向后兼容）
- 合并策略：平台 fieldMap 覆盖 POST_FIELD_MAP 中的同名 key

#### 2. normalizeCommentItem（`packages/core/src/shared/utils.ts`）

- `normalizeCommentItem(raw, platformId?)` 新增可选 `platformId` 参数
- 调用时从 `getPlatformAdapter(platformId)` 获取 `commentFieldMap`，合并到 `COMMENT_FIELD_MAP` 后再归一化
- 不传 `platformId` 时行为不变（向后兼容）

#### 3. handlers.ts（`packages/api/src/daemon/handlers.ts`）

- `getDefaultFetchMediaTemplate()` → 改为 `getPlatformAdapter(platformId)?.defaultTemplates.fetchMedia || null`
- 平台目录名映射 → `getPlatformAdapter(platformId)?.directoryName ?? platformId.split('_')[0]`
- `importMediaToDb` 中目录名解析同样改为从 adapter 获取
- `runPrepareDataAsync` 中调用 `normalizePostItem(result, platformId)` 传入平台 ID
- `runPrepareDataAsync` 中调用 `normalizeCommentItem(result, platformId)` 传入平台 ID
- `comment.import` handler 中调用 `normalizeCommentItem(rawItem, platformId)` 传入平台 ID
- `fetch_note` 为空时跳过（不再要求必填），打日志 `fetch_note skipped (no template)`

#### 4. posts.ts（`packages/api/src/routes/posts.ts`）

- `normalizeCommentItem(rawItem, platformId)` 传入平台 ID

#### 5. seed.ts（`packages/core/src/db/seed.ts`）

- `seedPlatformSyncTemplates()` 遍历 `getAllPlatformAdapters()`，为每个有 `creatorTemplates` 的 adapter 种子 `profile_fetch_template` 和 `posts_fetch_template`
- 移除硬编码的 xhs 模板

#### 6. creator-sync.ts（`packages/api/src/worker/creator-sync.ts`）

- `fetchProfile()`: 数据库模板优先，adapter `creatorTemplates.profileFetch` 兜底
- `fetchPosts()`: 数据库模板优先，adapter `creatorTemplates.postsFetch` 兜底
- `FALLBACK_POSTS_TEMPLATE` 删除，改为从 adapter 获取
- homepage URL 拼接：用 `adapter.homepageUrlTemplate.replace('{platform_creator_id}', ...)` 替代硬编码 if/else
- `FIELD_NAME_MAP` 删除，替换为 `POST_FIELD_MAP` import

#### 7. POST_FIELD_MAP 清理（`packages/core/src/shared/utils.ts`）

- 保留仅跨平台通用映射（`author → author_name`, `user_id → author_id`, `cover → cover_url`, `cover_image → cover_url`）
- 平台特有映射移到各 adapter 的 `fieldMap` 中（如 `note_id → platform_post_id` 移到 xhs adapter，`likes → like_count` 移到 xhs adapter）
- 不传 platformId 时，平台特有字段不会被映射

### 不做的事

- **不封装 opencli 搜索命令**：用户直接用 `opencli douyin search` 搜索，再用 `scopai post import --platform douyin --file result.json` 导入
- **不修改 CLI 命令结构**：现有 `scopai post import` 命令已支持 `--platform` 参数，无需新增命令
- **不修改 PLATFORM_MAPPINGS 种子数据**：DB 层的字段映射用于 creator sync，与 normalizePostItem 的 fieldMap 职责不同，保持独立

### 错误处理

- `getPlatformAdapter()` 返回 `undefined` 时：
  - CLI/API 层返回明确错误 "平台 {id} 未注册适配器"
  - `normalizePostItem` / `normalizeCommentItem` 不传 platformId 时使用基础映射
  - 目录名回退到 `platformId.split('_')[0]`
  - 默认模板回退到 `null`（prepare-data 流程会跳过该步骤）

### 测试

1. **单元测试**（`test/unit/platform-adapter.test.ts`，34 个测试）：
   - `PlatformAdapter` 注册/查询（6 个）
   - douyin adapter 全字段验证：fieldMap(12)、defaultTemplates(3)、creatorTemplates(1)、profileFieldMap(6)、commentFieldMap(7)、homepageUrlTemplate(1)
   - xhs adapter 全字段验证：fieldMap(7)、defaultTemplates(1)、creatorTemplates(1)、profileFieldMap(6)、commentFieldMap(7)、homepageUrlTemplate(1)
   - bilibili adapter 基础验证：id/directoryName、defaultTemplates、空 fieldMap
   - `normalizePostItem` 合并平台 fieldMap（5 个场景）
   - `normalizeCommentItem` 合并平台 commentFieldMap（4 个场景）

2. **测试夹具**：
   - `test/e2e/fixtures/posts/sample-douyin.json`（camelCase 格式）

## 文件变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 新增 | `packages/core/src/platforms/types.ts` | PlatformAdapter 接口定义 |
| 新增 | `packages/core/src/platforms/registry.ts` | 注册表实现 |
| 新增 | `packages/core/src/platforms/xhs.ts` | 小红书适配器 |
| 新增 | `packages/core/src/platforms/douyin.ts` | 抖音适配器 |
| 新增 | `packages/core/src/platforms/bilibili.ts` | B站适配器 |
| 新增 | `packages/core/src/platforms/index.ts` | 统一导出 + 自动注册 |
| 修改 | `packages/core/src/shared/utils.ts` | normalizePostItem/normalizeCommentItem 支持 platformId，POST_FIELD_MAP 清理 |
| 修改 | `packages/api/src/daemon/handlers.ts` | 替换硬编码为 adapter 查询，fetchNote 为空时跳过 |
| 修改 | `packages/api/src/routes/posts.ts` | normalizeCommentItem 传入 platformId |
| 修改 | `packages/core/src/db/seed.ts` | seedPlatformSyncTemplates 改用 adapter |
| 修改 | `packages/api/src/worker/creator-sync.ts` | 模板/字段映射/homepage URL 改用 adapter |
| 新增 | `test/e2e/fixtures/posts/sample-douyin.json` | 抖音测试夹具 |
| 新增 | `test/unit/platform-adapter.test.ts` | 适配器单元测试 |