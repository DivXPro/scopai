import { useEffect, useState } from 'react';
import * as icons from '@gravity-ui/icons';
import { apiGet } from '@/api/client';
import { CreatorCard } from '@/components/CreatorCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

const Users = icons.Persons;
const UserCheck = icons.CircleCheck;
const UserPause = icons.CirclePause;

type CreatorStatus = 'active' | 'paused' | 'unsubscribed';
type PlatformId = 'xhs' | 'twitter' | 'bilibili' | 'weibo';

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
  status: CreatorStatus;
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
  metadata: Record<string, unknown> | null;
}

interface CreatorsResponse {
  items: Creator[];
  total: number;
}

const platformOptions: { value: PlatformId | ''; label: string }[] = [
  { value: '', label: '全部平台' },
  { value: 'xhs', label: '小红书' },
  { value: 'twitter', label: 'Twitter' },
  { value: 'bilibili', label: 'B站' },
  { value: 'weibo', label: '微博' },
];

const statusOptions: { value: CreatorStatus | ''; label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'active', label: '活跃' },
  { value: 'paused', label: '已暂停' },
  { value: 'unsubscribed', label: '已取消' },
];

function StatCard({ title, value, icon }: { title: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function CreatorList() {
  const [creators, setCreators] = useState<Creator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [platform, setPlatform] = useState<PlatformId | ''>('');
  const [status, setStatus] = useState<CreatorStatus | ''>('');

  useEffect(() => {
    const params = new URLSearchParams();
    if (platform) params.set('platform', platform);
    if (status) params.set('status', status);
    const query = params.toString();

    setLoading(true);
    setError('');
    apiGet<CreatorsResponse>(`/api/creators${query ? `?${query}` : ''}`)
      .then((data) => setCreators(data.items))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [platform, status]);

  const total = creators.length;
  const activeCount = creators.filter((c) => c.status === 'active').length;
  const pausedCount = creators.filter((c) => c.status === 'paused').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight text-foreground">博主管理</h2>
        <p className="text-sm text-muted-foreground">{total} 个博主</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4">
        <StatCard title="全部" value={total} icon={<Users className="h-4 w-4 text-muted-foreground" />} />
        <StatCard title="活跃" value={activeCount} icon={<UserCheck className="h-4 w-4 text-success" />} />
        <StatCard title="已暂停" value={pausedCount} icon={<UserPause className="h-4 w-4 text-warning" />} />
      </div>

      {/* Filter Bar */}
      <div className="flex gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">平台</label>
          <select
            className="h-9 rounded-md border border-default bg-background px-3 text-sm text-foreground"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as PlatformId | '')}
          >
            {platformOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">状态</label>
          <select
            className="h-9 rounded-md border border-default bg-background px-3 text-sm text-foreground"
            value={status}
            onChange={(e) => setStatus(e.target.value as CreatorStatus | '')}
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/50 bg-danger/10 p-4 text-danger">
          <p className="font-medium">加载失败</p>
          <p className="text-sm mt-1">{error}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => window.location.reload()}
          >
            重试
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : creators.length === 0 ? (
        <div className="text-center py-12">
          <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">暂无博主</p>
          <p className="text-xs text-muted-foreground mt-1">订阅博主后在此查看</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {creators.map((creator) => (
            <CreatorCard key={creator.id} creator={creator} />
          ))}
        </div>
      )}
    </div>
  );
}
