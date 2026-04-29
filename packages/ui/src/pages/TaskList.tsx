import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as icons from '@gravity-ui/icons';
import { apiGet } from '@/api/client';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import Pagination from '@/components/Pagination';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const ListCheck = icons.ListCheck;
const Funnel = icons.Funnel;

interface Task {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
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

const PAGE_SIZE = 20;

export default function TaskList() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    setLoading(true);
    setError('');
    const offset = (page - 1) * PAGE_SIZE;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (statusFilter) params.set('status', statusFilter);
    apiGet<{ items: Task[]; total: number }>(`/api/tasks?${params}`)
      .then((data) => {
        setTasks(data.items);
        setTotal(data.total);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page, statusFilter]);

  const statusCounts = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.status] = (acc[t.status] ?? 0) + 1;
    return acc;
  }, {});

  if (error) {
    return (
      <div className="rounded-lg border border-danger/50 bg-danger/10 p-4 text-danger">
        <p className="font-medium">加载失败</p>
        <p className="text-sm mt-1">{error}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={() => setPage(1)}>
          重试
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight text-foreground">任务列表</h2>
        <p className="text-sm text-muted-foreground">
          {loading ? '加载中...' : `共 ${total} 个任务`}
        </p>
      </div>

      {/* 状态筛选 */}
      <div className="flex items-center gap-2">
        <Funnel className="h-4 w-4 text-muted-foreground" />
        <Button
          variant={statusFilter === '' ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setStatusFilter(''); setPage(1); }}
        >
          全部 ({total})
        </Button>
        {Object.entries(statusCounts).map(([status, count]) => (
          <Button
            key={status}
            variant={statusFilter === status ? 'default' : 'outline'}
            size="sm"
            onClick={() => { setStatusFilter(statusFilter === status ? '' : status); setPage(1); }}
          >
            {statusLabelMap[status] ?? status} ({count})
          </Button>
        ))}
      </div>

      {/* 任务表格 */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-12">
          <ListCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">
            {statusFilter ? '无匹配任务' : '暂无任务'}
          </p>
          {statusFilter && (
            <Button variant="ghost" size="sm" onClick={() => { setStatusFilter(''); setPage(1); }} className="mt-2">
              清除筛选
            </Button>
          )}
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="p-0">
              <Table aria-label="任务列表">
                <TableHeader>
                  <TableHead>名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableHeader>
                <TableBody>
                  {tasks.map((task) => (
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
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(task.updated_at).toLocaleDateString('zh-CN')}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link to={`/tasks/${task.id}`} className="text-sm text-primary hover:underline">
                          查看详情
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
