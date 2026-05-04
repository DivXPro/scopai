# Creator UI 设计文档

**日期：** 2026-04-29
**状态：** 已批准

---

## 概述

为 `@scopai/ui` 添加博主（Creator）管理 UI，支撑查看已订阅博主的列表、信息、帖子、同步日志及调度配置。

---

## 页面结构

### 1. 博主列表页 (`/creators`)

**路由：** `src/pages/CreatorList.tsx`

**功能：**
- 顶部统计卡片：总数 / 活跃 / 暂停
- 筛选栏：按平台筛选、按状态筛选（全部/活跃/暂停）
- 卡片网格布局展示博主卡片

**博主卡片字段：**
- 头像 + 昵称（display_name 或 author_name）
- 平台标签
- 粉丝数 / 帖子数
- 状态徽章（active / paused / unsubscribed）
- 最后同步时间

**API：**
- `GET /api/creators?platform=&status=&limit=&offset=`

---

### 2. 博主详情页 (`/creators/:id`)

**路由：** `src/pages/CreatorDetail.tsx`

**布局：** 返回按钮 + 博主信息头 + Tab 切换

**Tab 1 - 帖子 (`/creators/:id?tab=posts`)：**
- 该博主发布的帖子卡片列表（分页）
- API: `GET /api/creators/:id/posts?limit=&offset=`

**Tab 2 - 同步日志 (`/creators/:id?tab=logs`)：**
- 最近同步记录列表
- 字段：同步类型 / 状态 / 开始时间 / 完成时间 / 结果摘要
- API: `GET /api/creators/:id/sync-logs?limit=`

**Tab 3 - 同步调度 (`/creators/:id?tab=schedule`)：**
- 当前调度配置展示
- 支持修改：启用/禁用、间隔分钟、时间窗口、最大重试
- API: `GET/POST /api/creators/:id/sync-schedule`

**Tab 4 - 操作 (`/creators/:id?tab=actions`)：**
- 触发初始同步
- 触发增量同步
- 暂停 / 恢复订阅
- API: `POST /api/creators/:id/sync`, `POST /api/creators/:id/pause`, `POST /api/creators/:id/resume`

---

## 路由注册

**`src/App.tsx`** 新增：
```tsx
<Route path="/creators" element={<CreatorList />} />
<Route path="/creators/:id" element={<CreatorDetail />} />
```

**`src/components/Sidebar.tsx`** 新增导航项：
```tsx
{ path: '/creators', label: '博主管理', icon: Users }
```

---

## 文件清单

| 文件 | 用途 |
|------|------|
| `src/pages/CreatorList.tsx` | 博主列表页 |
| `src/pages/CreatorDetail.tsx` | 博主详情页（含 Tab） |
| `src/components/CreatorCard.tsx` | 博主卡片组件 |
| `src/components/SyncSchedule.tsx` | 同步调度配置组件 |

---

## API 映射

| 操作 | 方法 | 路径 |
|------|------|------|
| 列表 | GET | `/api/creators` |
| 详情 | GET | `/api/creators/:id` |
| 帖子 | GET | `/api/creators/:id/posts` |
| 日志 | GET | `/api/creators/:id/sync-logs` |
| 调度 | GET/POST | `/api/creators/:id/sync-schedule` |
| 同步 | POST | `/api/creators/:id/sync` |
| 暂停 | POST | `/api/creators/:id/pause` |
| 恢复 | POST | `/api/creators/:id/resume` |

---

## 状态

- ✅ 设计已批准
- ⬜ 待实现
