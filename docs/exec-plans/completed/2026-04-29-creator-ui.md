# Creator UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add creator management UI to browse subscribed creators, their posts, sync logs, and sync schedule configuration.

**Architecture:** Two new pages (CreatorList, CreatorDetail) + two reusable components (CreatorCard, SyncSchedule). Follow existing HeroUI v3 patterns in the codebase. CreatorDetail uses tab-based navigation. All API calls use existing `apiGet`/`apiPost` helpers.

**Tech Stack:** React 19, HeroUI v3, @gravity-ui/icons, React Router v7

---

## File Map

| File | Action |
|------|--------|
| `packages/ui/src/pages/CreatorList.tsx` | Create |
| `packages/ui/src/pages/CreatorDetail.tsx` | Create |
| `packages/ui/src/components/CreatorCard.tsx` | Create |
| `packages/ui/src/components/SyncSchedule.tsx` | Create |
| `packages/ui/src/App.tsx` | Modify |
| `packages/ui/src/components/Sidebar.tsx` | Modify |

---

## Task 1: Add Creator route to App.tsx and nav to Sidebar

**Files:**
- Modify: `packages/ui/src/App.tsx`
- Modify: `packages/ui/src/components/Sidebar.tsx`

- [ ] **Step 1: Add imports to App.tsx**
  ```tsx
  import CreatorList from '@/pages/CreatorList';
  import CreatorDetail from '@/pages/CreatorDetail';
  ```

- [ ] **Step 2: Add routes inside the existing `<Routes>`**
  ```tsx
  <Route path="/creators" element={<CreatorList />} />
  <Route path="/creators/:id" element={<CreatorDetail />} />
  ```
  Place after the QueueMonitor route.

- [ ] **Step 3: Add Users icon to Sidebar.tsx**
  ```tsx
  const Users = icons.Users;
  ```

- [ ] **Step 4: Add nav item to navItems array in Sidebar.tsx**
  ```tsx
  { path: '/creators', label: '博主管理', icon: Users },
  ```
  Place before the settings link at bottom.

- [ ] **Step 5: Commit**
  ```bash
  git add packages/ui/src/App.tsx packages/ui/src/components/Sidebar.tsx
  git commit -m "feat(ui): add creator routes and sidebar nav"
  ```

---

## Task 2: Create CreatorCard component

**Files:**
- Create: `packages/ui/src/components/CreatorCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Creator {
  id: string;
  platform_id: string;
  author_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  follower_count: number;
  post_count: number;
  status: 'active' | 'paused' | 'unsubscribed';
  last_synced_at: string | null;
}

function getPlatformLabel(platformId: string): string {
  if (platformId.includes('xhs')) return '小红书';
  if (platformId.includes('twitter')) return 'Twitter';
  if (platformId.includes('bilibili')) return 'B站';
  if (platformId.includes('weibo')) return '微博';
  return platformId;
}

function getPlatformBadgeClass(platformId: string): string {
  if (platformId.includes('xhs')) return 'bg-red-50 text-red-700 border-red-200';
  if (platformId.includes('twitter')) return 'bg-blue-50 text-blue-700 border-blue-200';
  if (platformId.includes('bilibili')) return 'bg-pink-50 text-pink-700 border-pink-200';
  if (platformId.includes('weibo')) return 'bg-yellow-50 text-yellow-700 border-yellow-200';
  return 'bg-gray-50 text-gray-700 border-gray-200';
}

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '从未同步';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

const statusVariantMap: Record<string, string> = {
  active: 'default',
  paused: 'secondary',
  unsubscribed: 'destructive',
};

const statusLabelMap: Record<string, string> = {
  active: '活跃',
  paused: '已暂停',
  unsubscribed: '已取消',
};

interface CreatorCardProps {
  creator: Creator;
}

export function CreatorCard({ creator }: CreatorCardProps) {
  const displayName = creator.display_name || creator.author_name || '未知博主';
  const platformLabel = getPlatformLabel(creator.platform_id);

  return (
    <Link to={`/creators/${creator.id}`} className="block">
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            {creator.avatar_url ? (
              <img
                src={creator.avatar_url}
                alt={displayName}
                className="w-10 h-10 rounded-full object-cover shrink-0"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-default flex items-center justify-center text-foreground text-lg font-medium shrink-0">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground truncate">{displayName}</span>
                <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium shrink-0 ${getPlatformBadgeClass(creator.platform_id)}`}>
                  {platformLabel}
                </span>
              </div>
              {creator.author_name && creator.display_name && (
                <p className="text-xs text-muted-foreground truncate">@{creator.author_name}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span>{creator.follower_count.toLocaleString()} 粉丝</span>
            <span>{creator.post_count.toLocaleString()} 帖子</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(creator.last_synced_at)}
            </span>
            <Badge variant={statusVariantMap[creator.status] ?? 'default'} size="sm">
              {statusLabelMap[creator.status] ?? creator.status}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 2: Commit**
  ```bash
  git add packages/ui/src/components/CreatorCard.tsx
  git commit -m "feat(ui): add CreatorCard component"
  ```

---

## Task 3: Create CreatorList page

**Files:**
- Create: `packages/ui/src/pages/CreatorList.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { useEffect, useState } from 'react';
import * as icons from '@gravity-ui/icons';
import { apiGet } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CreatorCard } from '@/components/CreatorCard';

const Users = icons.Users;

interface Creator {
  id: string;
  platform_id: string;
  author_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  follower_count: number;
  post_count: number;
  status: 'active' | 'paused' | 'unsubscribed';
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
}

interface CreatorListResponse {
  items: Creator[];
  total: number;
}

const platformOptions = [
  { value: '', label: '全部平台' },
  { value: 'xhs', label: '小红书' },
  { value: 'twitter', label: 'Twitter' },
  { value: 'bilibili', label: 'B站' },
  { value: 'weibo', label: '微博' },
];

const statusOptions = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '活跃' },
  { value: 'paused', label: '已暂停' },
  { value: 'unsubscribed', label: '已取消' },
];

const PAGE_SIZE = 50;

export default function CreatorList() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [platformFilter, setPlatformFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);

  const fetchCreators = () => {
    setLoading(true);
    setError('');
    const offset = (page - 1) * PAGE_SIZE;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (platformFilter) params.set('platform', platformFilter);
    if (statusFilter) params.set('status', statusFilter);

    apiGet<CreatorListResponse>(`/api/creators?${params}`)
      .then((data) => {
        setCreators(data.items);
        setTotal(data.total);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCreators();
  }, [platformFilter, statusFilter, page]);

  const stats = {
    total,
    active: creators.filter(c => c.status === 'active').length,
    paused: creators.filter(c => c.status === 'paused').length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight text-foreground">博主管理</h2>
        <p className="text-sm text-muted-foreground">
          {loading ? '加载中...' : `共 ${total} 位博主`}
        </p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground">全部博主</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground">活跃</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.active}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground">已暂停</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-foreground">{stats.paused}</div>
          </CardContent>
        </Card>
      </div>

      {/* 筛选栏 */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">平台:</span>
          {platformOptions.map((opt) => (
            <Button
              key={opt.value}
              variant={platformFilter === opt.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setPlatformFilter(opt.value); setPage(1); }}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">状态:</span>
          {statusOptions.map((opt) => (
            <Button
              key={opt.value}
              variant={statusFilter === opt.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => { setStatusFilter(opt.value); setPage(1); }}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      </div>

      {/* 博主列表 */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="w-10 h-10 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-danger/50 bg-danger/10 p-4 text-danger">
          <p className="font-medium">加载失败</p>
          <p className="text-sm mt-1">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={fetchCreators}>
            重试
          </Button>
        </div>
      ) : creators.length === 0 ? (
        <div className="text-center py-12">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">暂无博主</p>
          <p className="text-xs text-muted-foreground mt-1">通过 CLI 订阅博主后在此查看</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {creators.map((creator) => (
            <CreatorCard key={creator.id} creator={creator} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**
  ```bash
  git add packages/ui/src/pages/CreatorList.tsx
  git commit -m "feat(ui): add CreatorList page"
  ```

---

## Task 4: Create SyncSchedule component

**Files:**
- Create: `packages/ui/src/components/SyncSchedule.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useState } from 'react';
import * as icons from '@gravity-ui/icons';
import { apiGet, apiPost } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const Clock = icons.Clock;

interface CreatorSyncSchedule {
  id: string;
  creator_id: string;
  interval_minutes: number;
  time_window_start: string | null;
  time_window_end: string | null;
  max_retries: number;
  retry_interval_minutes: number;
  is_enabled: boolean;
}

const intervalOptions = [
  { value: 30, label: '30 分钟' },
  { value: 60, label: '1 小时' },
  { value: 120, label: '2 小时' },
  { value: 360, label: '6 小时' },
  { value: 720, label: '12 小时' },
  { value: 1440, label: '每天' },
];

interface SyncScheduleProps {
  creatorId: string;
}

export function SyncSchedule({ creatorId }: SyncScheduleProps) {
  const [schedule, setSchedule] = useState<CreatorSyncSchedule | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchSchedule = () => {
    setLoading(true);
    apiGet<CreatorSyncSchedule>(`/api/creators/${creatorId}/sync-schedule`)
      .then(setSchedule)
      .catch(() => setSchedule(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchSchedule();
  }, [creatorId]);

  const handleSave = async (updates: Partial<CreatorSyncSchedule>) => {
    setSaving(true);
    setError('');
    try {
      const updated = await apiPost<CreatorSyncSchedule>(
        `/api/creators/${creatorId}/sync-schedule`,
        updates
      );
      setSchedule(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!schedule) {
    return (
      <Card>
        <CardContent className="p-4 text-center">
          <p className="text-sm text-muted-foreground">暂无同步调度配置</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => handleSave({ is_enabled: true, interval_minutes: 60 })}
          >
            创建调度
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm text-foreground">调度配置</CardTitle>
            <Button
              variant={schedule.is_enabled ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleSave({ is_enabled: !schedule.is_enabled })}
              disabled={saving}
            >
              {schedule.is_enabled ? '已启用' : '已禁用'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded bg-danger/10 p-2 text-xs text-danger">{error}</div>
          )}

          <div className="space-y-2">
            <label className="text-sm text-foreground">同步间隔</label>
            <div className="flex flex-wrap gap-2">
              {intervalOptions.map((opt) => (
                <Button
                  key={opt.value}
                  variant={schedule.interval_minutes === opt.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleSave({ interval_minutes: opt.value })}
                  disabled={saving}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">开始时间</label>
              <input
                type="time"
                value={schedule.time_window_start || ''}
                onChange={(e) => handleSave({ time_window_start: e.target.value || null })}
                disabled={saving}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">结束时间</label>
              <input
                type="time"
                value={schedule.time_window_end || ''}
                onChange={(e) => handleSave({ time_window_end: e.target.value || null })}
                disabled={saving}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">最大重试次数</label>
              <input
                type="number"
                min={0}
                max={10}
                value={schedule.max_retries}
                onChange={(e) => handleSave({ max_retries: parseInt(e.target.value) || 0 })}
                disabled={saving}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">重试间隔（分钟）</label>
              <input
                type="number"
                min={1}
                value={schedule.retry_interval_minutes}
                onChange={(e) => handleSave({ retry_interval_minutes: parseInt(e.target.value) || 1 })}
                disabled={saving}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**
  ```bash
  git add packages/ui/src/components/SyncSchedule.tsx
  git commit -m "feat(ui): add SyncSchedule component"
  ```

---

## Task 5: Create CreatorDetail page

**Files:**
- Create: `packages/ui/src/pages/CreatorDetail.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as icons from '@gravity-ui/icons';
import { apiGet } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SyncSchedule } from '@/components/SyncSchedule';
import Pagination from '@/components/Pagination';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const ArrowChevronLeft = icons.ArrowChevronLeft;
const CirclePlay = icons.CirclePlay;
const CirclePause = icons.CirclePause;
const CirclePlayFill = icons.CirclePlayFill;
const CirclePauseFill = icons.CirclePauseFill;

interface Creator {
  id: string;
  platform_id: string;
  platform_author_id: string;
  author_name: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  homepage_url: string | null;
  follower_count: number;
  following_count: number;
  post_count: number;
  status: 'active' | 'paused' | 'unsubscribed';
  last_synced_at: string | null;
}

interface Post {
  id: string;
  platform_id: string;
  title: string | null;
  content: string;
  author_name: string | null;
  url: string | null;
  like_count: number;
  collect_count: number;
  comment_count: number;
  published_at: string | null;
}

interface CreatorPostResponse {
  items: Post[];
  total: number;
}

interface CreatorSyncLog {
  id: string;
  creator_id: string;
  job_id: string;
  sync_type: string;
  status: 'success' | 'partial' | 'failed';
  result_summary: Record<string, unknown> | null;
  started_at: string;
  completed_at: string | null;
}

type Tab = 'posts' | 'logs' | 'schedule' | 'actions';

const statusVariantMap: Record<string, string> = {
  active: 'default',
  paused: 'secondary',
  unsubscribed: 'destructive',
};

const statusLabelMap: Record<string, string> = {
  active: '活跃',
  paused: '已暂停',
  unsubscribed: '已取消',
};

function getPlatformLabel(platformId: string): string {
  if (platformId.includes('xhs')) return '小红书';
  if (platformId.includes('twitter')) return 'Twitter';
  if (platformId.includes('bilibili')) return 'B站';
  if (platformId.includes('weibo')) return '微博';
  return platformId;
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('zh-CN');
}

const POST_PAGE_SIZE = 20;
const LOG_PAGE_SIZE = 10;

export default function CreatorDetail() {
  const { id } = useParams<{ id: string }>();
  const [creator, setCreator] = useState<Creator | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('posts');

  // Posts state
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsTotal, setPostsTotal] = useState(0);
  const [postsPage, setPostsPage] = useState(1);
  const [loadingPosts, setLoadingPosts] = useState(false);

  // Logs state
  const [logs, setLogs] = useState<CreatorSyncLog[]>([]);
  const [logsPage, setLogsPage] = useState(1);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [actionLoading, setActionLoading] = useState('');

  const fetchCreator = () => {
    if (!id) return;
    setLoading(true);
    setError('');
    apiGet<Creator>(`/api/creators/${id}`)
      .then(setCreator)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const fetchPosts = (page: number) => {
    if (!id) return;
    setLoadingPosts(true);
    const offset = (page - 1) * POST_PAGE_SIZE;
    apiGet<CreatorPostResponse>(`/api/creators/${id}/posts?limit=${POST_PAGE_SIZE}&offset=${offset}`)
      .then((data) => {
        setPosts(data.items);
        setPostsTotal(data.total);
        setPostsPage(page);
      })
      .finally(() => setLoadingPosts(false));
  };

  const fetchLogs = (page: number) => {
    if (!id) return;
    setLoadingLogs(true);
    const offset = (page - 1) * LOG_PAGE_SIZE;
    apiGet<CreatorSyncLog[]>(`/api/creators/${id}/sync-logs?limit=${LOG_PAGE_SIZE}&offset=${offset}`)
      .then(setLogs)
      .finally(() => setLoadingLogs(false));
  };

  useEffect(() => {
    fetchCreator();
  }, [id]);

  useEffect(() => {
    if (activeTab === 'posts') fetchPosts(1);
    if (activeTab === 'logs') fetchLogs(1);
  }, [activeTab, id]);

  const handleSync = async (type: 'initial' | 'periodic') => {
    if (!id) return;
    setSyncing(true);
    try {
      await apiPost(`/api/creators/${id}/sync`, { type });
      fetchLogs(1);
    } catch (e) {
      alert(e instanceof Error ? e.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const handlePauseResume = async () => {
    if (!id || !creator) return;
    setActionLoading('pause');
    try {
      const action = creator.status === 'paused' ? 'resume' : 'pause';
      await apiPost(`/api/creators/${id}/${action}`);
      fetchCreator();
    } catch (e) {
      alert(e instanceof Error ? e.message : '操作失败');
    } finally {
      setActionLoading('');
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !creator) {
    return (
      <div className="space-y-4">
        <Link to="/creators">
          <Button variant="outline" size="sm">
            <ArrowChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="rounded-lg border border-danger/50 bg-danger/10 p-4 text-danger">
          <p className="font-medium">{error || '博主不存在'}</p>
        </div>
      </div>
    );
  }

  const displayName = creator.display_name || creator.author_name || '未知博主';

  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4">
        <Link to="/creators">
          <Button variant="outline" size="sm">
            <ArrowChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h2 className="text-3xl font-bold tracking-tight text-foreground">{displayName}</h2>
        <Badge variant={statusVariantMap[creator.status] ?? 'default'}>
          {statusLabelMap[creator.status] ?? creator.status}
        </Badge>
      </div>

      {/* 博主信息卡片 */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-start gap-4">
            {creator.avatar_url ? (
              <img src={creator.avatar_url} alt={displayName} className="w-16 h-16 rounded-full object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-full bg-default flex items-center justify-center text-2xl font-medium text-foreground">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">@{creator.author_name || '-'}</span>
                <Badge variant="outline" size="sm">{getPlatformLabel(creator.platform_id)}</Badge>
              </div>
              {creator.bio && (
                <p className="text-sm text-muted-foreground line-clamp-2">{creator.bio}</p>
              )}
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>{creator.follower_count.toLocaleString()} 粉丝</span>
                <span>{creator.following_count.toLocaleString()} 关注</span>
                <span>{creator.post_count.toLocaleString()} 帖子</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tab 切换 */}
      <div className="flex border-b border-divider">
        {(['posts', 'logs', 'schedule', 'actions'] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'posts' ? '帖子' : tab === 'logs' ? '同步日志' : tab === 'schedule' ? '同步调度' : '操作'}
          </button>
        ))}
      </div>

      {/* Tab 内容 */}
      {activeTab === 'posts' && (
        <div className="space-y-4">
          {loadingPosts ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : posts.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">暂无帖子</p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {posts.map((post) => (
                  <Card key={post.id}>
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground line-clamp-1">
                            {post.title || post.content.slice(0, 60)}
                          </p>
                          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                            <span>{post.like_count.toLocaleString()} 赞</span>
                            <span>{post.collect_count.toLocaleString()} 收藏</span>
                            <span>{post.comment_count.toLocaleString()} 评论</span>
                            {post.published_at && (
                              <span>{new Date(post.published_at).toLocaleDateString('zh-CN')}</span>
                            )}
                          </div>
                        </div>
                        {post.url && (
                          <a href={post.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary shrink-0">
                            查看
                          </a>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Pagination
                page={postsPage}
                pageSize={POST_PAGE_SIZE}
                total={postsTotal}
                onChange={(p) => fetchPosts(p)}
              />
            </>
          )}
        </div>
      )}

      {activeTab === 'logs' && (
        <div className="space-y-4">
          {loadingLogs ? (
            <Skeleton className="h-48 w-full" />
          ) : logs.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">暂无同步日志</p>
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>类型</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>开始时间</TableHead>
                      <TableHead>完成时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-sm text-foreground">
                          {log.sync_type === 'initial' ? '初始同步' : '增量同步'}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              log.status === 'success' ? 'default' :
                              log.status === 'partial' ? 'secondary' : 'destructive'
                            }
                            size="sm"
                          >
                            {log.status === 'success' ? '成功' : log.status === 'partial' ? '部分成功' : '失败'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDateTime(log.started_at)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDateTime(log.completed_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'schedule' && (
        <SyncSchedule creatorId={creator.id} />
      )}

      {activeTab === 'actions' && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-foreground">同步操作</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  onClick={() => handleSync('initial')}
                  disabled={syncing}
                >
                  <CirclePlayFill className="h-4 w-4 mr-1" />
                  {syncing ? '同步中...' : '触发初始同步'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleSync('periodic')}
                  disabled={syncing}
                >
                  <CirclePlay className="h-4 w-4 mr-1" />
                  触发增量同步
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                初始同步会重新获取博主的所有历史帖子，增量同步只获取新帖子。
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm text-foreground">订阅管理</CardTitle>
            </CardHeader>
            <CardContent>
              <Button
                variant={creator.status === 'paused' ? 'default' : 'outline'}
                onClick={handlePauseResume}
                disabled={actionLoading !== '' || creator.status === 'unsubscribed'}
              >
                {creator.status === 'paused' ? (
                  <>
                    <CirclePlayFill className="h-4 w-4 mr-1" />
                    恢复订阅
                  </>
                ) : (
                  <>
                    <CirclePauseFill className="h-4 w-4 mr-1" />
                    暂停订阅
                  </>
                )}
              </Button>
              {creator.status === 'unsubscribed' && (
                <p className="text-xs text-muted-foreground mt-2">该博主已取消订阅</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**
  ```bash
  git add packages/ui/src/pages/CreatorDetail.tsx
  git commit -m "feat(ui): add CreatorDetail page with tabs"
  ```

---

## Self-Review Checklist

- [ ] All 4 new files created: CreatorList, CreatorDetail, CreatorCard, SyncSchedule
- [ ] Routes added to App.tsx
- [ ] Nav added to Sidebar.tsx
- [ ] No placeholder code (no TODO, no TBD)
- [ ] All API endpoints match spec
- [ ] TypeScript interfaces match API response shapes
- [ ] Follows existing HeroUI v3 patterns
- [ ] Uses @gravity-ui/icons instead of lucide-react

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-29-creator-ui.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
