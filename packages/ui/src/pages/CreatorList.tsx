import { useEffect, useState } from 'react';
import * as icons from '@gravity-ui/icons';
import { apiGet } from '@/api/client';
import { CreatorCard } from '@/components/CreatorCard';
import { Skeleton, Button } from '@heroui/react';

const Persons = icons.Persons;
const CircleCheck = icons.CircleCheck;
const CirclePause = icons.CirclePause;
const Plus = icons.Plus;
const CaretDown = icons.CaretDown;
const ArrowUpArrowDown = icons.ArrowUpArrowDown;

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
  { value: '', label: '全部' },
  { value: 'xhs', label: '小红书' },
  { value: 'twitter', label: 'Twitter' },
  { value: 'bilibili', label: 'B站' },
  { value: 'weibo', label: '微博' },
];

const statusOptions: { value: CreatorStatus | ''; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'active', label: '活跃' },
  { value: 'paused', label: '已暂停' },
  { value: 'unsubscribed', label: '已取消' },
];

function StatCard({ title, value, icon, iconBg, label }: { title: string; value: number; icon: React.ReactNode; iconBg: string; label: string }) {
  return (
    <div className="bg-white p-6 rounded-xl border border-outline-variant shadow-sm hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start mb-4">
        <div className={`p-3 rounded-lg ${iconBg}`}>
          {icon}
        </div>
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-3xl font-bold text-primary">{value}</div>
      <div className="text-sm text-slate-500 mt-1">{title}</div>
    </div>
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
    <div className="space-y-6 max-w-[1440px]">
      {/* Page Header */}
      <div className="flex justify-between items-end mb-10">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-primary mb-2">博主管理</h2>
          <p className="text-sm text-on-surface-variant">共有 {total} 个博主</p>
        </div>
        <Button className="flex items-center gap-2 shadow-lg shadow-blue-500/20">
          <Plus className="h-4 w-4" />
          <span>添加博主</span>
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-6 mb-10">
        <StatCard
          title="全部博主"
          value={total}
          label="TOTAL"
          icon={<Persons className="h-5 w-5 text-secondary" />}
          iconBg="bg-primary-fixed text-secondary"
        />
        <StatCard
          title="活跃博主"
          value={activeCount}
          label="ACTIVE"
          icon={<CircleCheck className="h-5 w-5 text-emerald-600" />}
          iconBg="bg-green-50 text-emerald-600"
        />
        <StatCard
          title="已暂停"
          value={pausedCount}
          label="PAUSED"
          icon={<CirclePause className="h-5 w-5 text-amber-600" />}
          iconBg="bg-amber-50 text-amber-600"
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-8 bg-surface-container-low p-4 rounded-xl">
        <div className="relative flex items-center gap-2 bg-white border border-outline-variant px-4 py-2 rounded-lg cursor-pointer hover:border-secondary transition-colors">
          <span className="text-sm text-on-surface-variant font-semibold">平台:</span>
          <span className="text-sm font-medium">
            {platformOptions.find(o => o.value === platform)?.label || '全部'}
          </span>
          <CaretDown className="h-4 w-4 text-on-surface-variant" />
          <select
            className="absolute opacity-0 w-full h-full cursor-pointer inset-0"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as PlatformId | '')}
          >
            {platformOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="relative flex items-center gap-2 bg-white border border-outline-variant px-4 py-2 rounded-lg cursor-pointer hover:border-secondary transition-colors">
          <span className="text-sm text-on-surface-variant font-semibold">状态:</span>
          <span className="text-sm font-medium">
            {statusOptions.find(o => o.value === status)?.label || '全部'}
          </span>
          <CaretDown className="h-4 w-4 text-on-surface-variant" />
          <select
            className="absolute opacity-0 w-full h-full cursor-pointer inset-0"
            value={status}
            onChange={(e) => setStatus(e.target.value as CreatorStatus | '')}
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto text-sm text-on-surface-variant flex items-center gap-2">
          <ArrowUpArrowDown className="h-4 w-4" />
          <span>排序: 最近添加</span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-danger/50 bg-danger/10 p-4 text-danger">
          <p className="font-medium">加载失败</p>
          <p className="text-sm mt-1">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onPress={() => window.location.reload()}>
            重试
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
      ) : creators.length === 0 ? (
        <div className="text-center py-12">
          <Persons className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">暂无博主</p>
          <p className="text-xs text-muted-foreground mt-1">订阅博主后在此查看</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
          {creators.map((creator) => (
            <CreatorCard key={creator.id} creator={creator} />
          ))}
          {/* Add New Creator Card */}
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center gap-4 hover:border-secondary hover:bg-slate-50 transition-all cursor-pointer group">
            <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center group-hover:bg-secondary group-hover:text-white transition-all">
              <Plus className="h-6 w-6" />
            </div>
            <span className="text-sm font-semibold text-slate-400 group-hover:text-secondary">添加新博主</span>
          </div>
        </div>
      )}
    </div>
  );
}