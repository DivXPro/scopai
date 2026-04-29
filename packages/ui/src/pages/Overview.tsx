import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as icons from '@gravity-ui/icons';
import { apiGet } from '@/api/client';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const Clock = icons.Clock;
const CirclePlay = icons.CirclePlay;
const CircleCheck = icons.CircleCheck;
const CircleXmark = icons.CircleXmark;
const ArrowChevronRight = icons.ArrowChevronRight;
const FileText = icons.FileText;
const TargetDart = icons.TargetDart;
const Thunderbolt = icons.Thunderbolt;

interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

interface StatusData {
  queue_stats: QueueStats;
  uptime: number;
}

interface Task {
  id: string;
  name: string;
  status: string;
  created_at: string;
}

const statusVariantMap: Record<string, BadgeVariant> = {
  pending: 'outline',
  running: 'default',
  paused: 'secondary',
  completed: 'default',
  failed: 'destructive',
};

const statusLabelMap: Record<string, string> = {
  pending: '待处理',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
};

function StatCard({ title, value, icon, colorClass }: { title: string; value: number; icon: React.ReactNode; colorClass: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-foreground">{title}</CardTitle>
        <span className={colorClass}>{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-foreground">{value}</div>
      </CardContent>
    </Card>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时`;
  return `${Math.floor(seconds / 86400)}天`;
}

export default function Overview() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [recentTasks, setRecentTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      apiGet<StatusData>('/api/status'),
      apiGet<{ items: Task[]; total: number }>('/api/tasks?limit=5'),
    ])
      .then(([s, data]) => {
        setStatus(s);
        setRecentTasks(data.items);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    return (
      <div className="rounded-lg border border-danger/50 bg-danger/10 p-4 text-danger">
        <p className="font-medium">加载失败</p>
        <p className="text-sm mt-1">{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => window.location.reload()}>
          重试
        </Button>
      </div>
    );
  }

  const stats = status?.queue_stats ?? { pending: 0, processing: 0, completed: 0, failed: 0 };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight text-foreground">概览</h2>
        {status && (
          <span className="text-xs text-muted-foreground">
            运行时间: {formatUptime(status.uptime)}
          </span>
        )}
      </div>

      {/* 队列统计 */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard title="待处理" value={stats.pending} icon={<Clock className="h-4 w-4" />} colorClass="text-warning" />
        <StatCard title="处理中" value={stats.processing} icon={<CirclePlay className="h-4 w-4 animate-spin" />} colorClass="text-secondary" />
        <StatCard title="已完成" value={stats.completed} icon={<CircleCheck className="h-4 w-4" />} colorClass="text-success" />
        <StatCard title="失败" value={stats.failed} icon={<CircleXmark className="h-4 w-4" />} colorClass="text-danger" />
      </div>

      {/* 快捷入口 */}
      <div className="grid grid-cols-3 gap-4">
        <Link to="/posts" className="block">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardContent className="p-4 flex items-center gap-3">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-semibold text-foreground">帖子库</p>
                <p className="text-xs text-muted-foreground">浏览和分析帖子</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link to="/strategies" className="block">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardContent className="p-4 flex items-center gap-3">
              <TargetDart className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-semibold text-foreground">策略管理</p>
                <p className="text-xs text-muted-foreground">查看和配置策略</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link to="/queue" className="block">
          <Card className="cursor-pointer transition-shadow hover:shadow-md">
            <CardContent className="p-4 flex items-center gap-3">
              <Thunderbolt className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="font-semibold text-foreground">队列监控</p>
                <p className="text-xs text-muted-foreground">查看队列状态</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* 最近任务 */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">最近任务</h3>
          <Link to="/tasks" className="text-sm text-primary hover:underline flex items-center gap-1">
            查看全部 <ArrowChevronRight className="h-3 w-3" />
          </Link>
        </div>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : recentTasks.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground">暂无任务</p>
          </div>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableHead>名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableHeader>
                <TableBody>
                  {recentTasks.map((task) => (
                    <TableRow key={task.id}>
                      <TableCell className="font-medium text-foreground">{task.name}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariantMap[task.status] ?? 'outline'}>
                          {statusLabelMap[task.status] ?? task.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(task.created_at).toLocaleDateString('zh-CN')}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link to={`/tasks/${task.id}`} className="text-primary hover:underline text-sm">
                          查看
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
