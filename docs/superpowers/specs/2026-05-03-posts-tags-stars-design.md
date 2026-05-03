# Posts 标签与加星功能设计

## 概述

为帖子增加用户自定义标签和加星功能，便于分类、搜索和快速查找。

## 数据层

### 新增表

```sql
CREATE TABLE labels (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE post_labels (
  post_id    TEXT NOT NULL REFERENCES posts(id),
  label_id   TEXT NOT NULL REFERENCES labels(id),
  PRIMARY KEY (post_id, label_id)
);

CREATE INDEX idx_post_labels_label ON post_labels(label_id);
```

### posts 表变更

```sql
ALTER TABLE posts ADD COLUMN is_starred BOOLEAN DEFAULT false;
```

### 类型变更

- `Post` 接口新增 `is_starred: boolean`
- 新增 `Label` 接口：`{ id: string; name: string; color?: string; created_at: Date }`

### 核心函数

- `createLabel(name, color?)` — INSERT OR IGNORE（同名不报错）
- `getOrCreateLabel(name, color?)` — 查找或创建，返回 label
- `listLabels()` — 列出所有标签（含每个标签关联的帖子数）
- `deleteLabel(id)` — 删除标签及 post_labels 关联
- `addPostLabel(postId, labelId)` — INSERT OR IGNORE
- `removePostLabel(postId, labelId)` — DELETE
- `getPostLabels(postId)` — 查帖子关联的标签
- `setPostStarred(postId, starred: boolean)` — 更新 is_starred
- `listPostsByLabel(labelId, limit, offset)` — 按标签查帖子
- `listStarredPosts(limit, offset)` — 查加星帖子

## API 层

### 新增路由

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/labels` | 创建标签 `{ name, color? }` |
| GET | `/api/labels` | 列出所有标签（含帖子数） |
| DELETE | `/api/labels/:id` | 删除标签 |
| POST | `/api/posts/:id/labels` | 给帖子添加标签。支持 `{ label_id }` 或 `{ label_name }` 或 `{ label_names: [] }`。label_name(s) 时自动 getOrCreate |
| DELETE | `/api/posts/:id/labels/:labelId` | 移除帖子的标签 |
| POST | `/api/posts/:id/star` | 加星/取消 `{ starred: true/false }` |

### 现有路由变更

- `GET /api/posts` — 新增查询参数 `?label=xxx`（按标签名过滤）、`?starred=true`（只看加星）
- `GET /api/posts` 返回的每个 post 对象附带 `labels` 数组

## CLI 层

### 新增命令

| 命令 | 说明 |
|------|------|
| `scopai post star <post-id>` | 加星 |
| `scopai post unstar <post-id>` | 取消加星 |
| `scopai post tag <post-id> --labels 高价值,待跟进` | 添加标签（自动创建） |
| `scopai post untag <post-id> --labels 高价值` | 移除标签 |
| `scopai label list` | 列出所有标签 |
| `scopai label create --name <name> [--color <hex>]` | 创建标签 |
| `scopai label delete --id <id>` | 删除标签 |

### 现有命令变更

- `scopai post list` — 新增 `--starred`、`--label <name>` 过滤选项
- `scopai post list` 输出中显示加星标记和标签

## UI 层

### PostLibrary.tsx 变更

- PostCard 上增加星标图标，点击切换 is_starred
- PostCard 上显示标签 badge，点击可添加/移除标签
- 利用现有"更多筛选"按钮展开标签列表（多选）和加星开关
- 利用现有"排序"按钮增加按加星优先排序

### 新增组件

- `LabelBadge` — 标签徽章（名称 + 颜色点）
- `StarButton` — 星标切换按钮
- `LabelFilter` — 标签筛选面板（从 labels API 获取列表）
