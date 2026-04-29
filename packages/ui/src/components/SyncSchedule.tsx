import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';


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
