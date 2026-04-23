import { useEffect, useState, useCallback } from 'react';
import { Clock, Loader2, CheckCircle2, XCircle, RefreshCw, RotateCcw, Zap } from 'lucide-react';
import { apiGet, apiPost } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

interface QueueJob {
  id: string;
  task_id: string;
  strategy_id: string | null;
  target_type: string | null;
  target_id: string | null;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  error: string | null;
  created_at: string;
  processed_at: string | null;
}

interface QueueData {
  stats: QueueStats;
  jobs: QueueJob[];
}

const statusVariantMap: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'outline',
  processing: 'default',
  completed: 'secondary',
  failed: 'destructive',
  waiting_media: 'outline',
};

function StatCard({ title, value, icon, color }: { title: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <span className={color}>{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

export default function QueueMonitor() {
  const [data, setData] = useState<QueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [retrying, setRetrying] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const params = statusFilter ? `?status=${statusFilter}` : '';
    try {
      const result = await apiGet<QueueData>(`/api/queue${params}`);
      setData(result);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await apiPost<{ retried: number }>('/api/queue/retry');
      await fetchData();
    } finally {
      setRetrying(false);
    }
  };

  const stats = data?.stats ?? { pending: 0, processing: 0, completed: 0, failed: 0 };
  const jobs = data?.jobs ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">队列监控</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-3 w-3 mr-1" />
            刷新
          </Button>
          {stats.failed > 0 && (
            <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying}>
              <RotateCcw className={`h-3 w-3 mr-1 ${retrying ? 'animate-spin' : ''}`} />
              重试失败 ({stats.failed})
            </Button>
          )}
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          title="待处理"
          value={stats.pending}
          icon={<Clock className="h-4 w-4" />}
          color="text-yellow-600"
        />
        <StatCard
          title="处理中"
          value={stats.processing}
          icon={<Loader2 className="h-4 w-4 animate-spin" />}
          color="text-blue-600"
        />
        <StatCard
          title="已完成"
          value={stats.completed}
          icon={<CheckCircle2 className="h-4 w-4" />}
          color="text-green-600"
        />
        <StatCard
          title="失败"
          value={stats.failed}
          icon={<XCircle className="h-4 w-4" />}
          color="text-red-600"
        />
      </div>

      {/* 状态筛选 */}
      <div className="flex items-center gap-2">
        <Zap className="h-4 w-4 text-muted-foreground" />
        <Button
          variant={statusFilter === '' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setStatusFilter('')}
        >
          全部
        </Button>
        {['pending', 'processing', 'completed', 'failed'].map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
          >
            {s === 'pending' ? '待处理' : s === 'processing' ? '处理中' : s === 'completed' ? '已完成' : '失败'}
          </Button>
        ))}
      </div>

      {/* 任务列表 */}
      {loading && !data ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : jobs.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">暂无队列任务</p>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>状态</TableHead>
                <TableHead>目标类型</TableHead>
                <TableHead>策略</TableHead>
                <TableHead>重试次数</TableHead>
                <TableHead>错误</TableHead>
                <TableHead>创建时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <Badge variant={statusVariantMap[job.status] ?? 'outline'}>
                      {job.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{job.target_type ?? '-'}</TableCell>
                  <TableCell className="text-sm font-mono">{job.strategy_id ?? '-'}</TableCell>
                  <TableCell className="text-sm">
                    {job.attempts}/{job.max_attempts}
                  </TableCell>
                  <TableCell className="text-xs text-destructive max-w-xs truncate">
                    {job.error ?? '-'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(job.created_at).toLocaleString('zh-CN')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
