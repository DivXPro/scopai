import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as icons from '@gravity-ui/icons';
import { apiGet } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const ArrowChevronLeft = icons.ArrowChevronLeft;
const ArrowChevronDown = icons.ArrowChevronDown;
const ArrowChevronUp = icons.ArrowChevronUp;
const ChartBar = icons.ChartBar;

interface TaskStep {
  id: string;
  name: string;
  status: string;
  strategy_id: string | null;
  step_order: number;
  stats: { total: number; done: number; failed: number } | null;
}

interface TaskJob {
  id: string;
  target_type: string | null;
  target_id: string | null;
  status: string;
  attempts: number;
  error: string | null;
}

interface TaskDetail {
  id: string;
  name: string;
  description: string | null;
  status: string;
  stats: { total: number; done: number; failed: number } | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  steps: TaskStep[];
  jobs: TaskJob[];
}

interface AnalysisResult {
  id: string;
  target_type: string;
  target_id: string | null;
  summary: string | null;
  raw_response: Record<string, unknown> | null;
  analyzed_at: string;
}

interface ResultStats {
  total: number;
  [key: string]: unknown;
}

const statusVariantMap: Record<string, BadgeVariant> = {
  pending: 'outline',
  running: 'default',
  paused: 'secondary',
  completed: 'default',
  failed: 'destructive',
};

function StepRow({ step, taskId }: { step: TaskStep; taskId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [resultStats, setResultStats] = useState<ResultStats | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);

  const loadResults = async () => {
    if (!step.strategy_id) return;
    setLoadingResults(true);
    try {
      const data = await apiGet<{ results: AnalysisResult[]; stats: ResultStats }>(
        `/api/tasks/${taskId}/results?strategy_id=${step.strategy_id}`
      );
      setResults(data.results);
      setResultStats(data.stats);
    } catch {
      // ignore
    } finally {
      setLoadingResults(false);
    }
  };

  const toggleExpanded = () => {
    if (!expanded && step.strategy_id && results.length === 0) {
      loadResults();
    }
    setExpanded(!expanded);
  };

  const total = step.stats?.total ?? 0;
  const done = step.stats?.done ?? 0;
  const failed = step.stats?.failed ?? 0;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Card>
      <button
        onClick={toggleExpanded}
        className="w-full flex items-center justify-between p-4 hover:bg-default/50 transition-colors text-left"
      >
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-foreground">步骤 {step.step_order}</span>
          <span className="font-semibold text-foreground">{step.name}</span>
          <Badge variant={statusVariantMap[step.status] ?? 'outline'}>{step.status}</Badge>
          {total > 0 && (
            <span className="text-xs text-muted-foreground">
              {done}/{total} ({progress}%)
              {failed > 0 && ` · ${failed} 失败`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {step.strategy_id && (
            <span className="text-xs text-muted-foreground">
              {results.length > 0 ? `${results.length} 条结果` : '点击查看结果'}
            </span>
          )}
          {expanded ? <ArrowChevronUp className="h-4 w-4" /> : <ArrowChevronDown className="h-4 w-4" />}
        </div>
      </button>

      {expanded && (
        <CardContent className="border-t">
          {step.strategy_id ? (
            loadingResults ? (
              <div className="py-4 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : results.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">暂无分析结果</p>
            ) : (
              <div className="space-y-4 pt-4">
                {resultStats && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <ChartBar className="h-4 w-4" />
                    共 {resultStats.total} 条结果
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>目标</TableHead>
                      <TableHead>摘要</TableHead>
                      <TableHead>分析时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs font-mono text-foreground">{r.target_id ?? '-'}</TableCell>
                        <TableCell className="text-sm max-w-md truncate text-foreground">
                          {r.summary || (r.raw_response ? JSON.stringify(r.raw_response).slice(0, 100) + '...' : '-')}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {new Date(r.analyzed_at).toLocaleString('zh-CN')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )
          ) : (
            <p className="text-sm text-muted-foreground py-4">此步骤无关联策略</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    setError('');
    apiGet<TaskDetail>(`/api/tasks/${id}`)
      .then(setTask)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link to="/tasks">
          <Button variant="outline" size="sm">
            <ArrowChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="rounded-lg border border-danger/50 bg-danger/10 p-4 text-danger">
          <p className="font-medium">{error.includes('not found') ? '任务不存在' : '加载失败'}</p>
          <p className="text-sm mt-1">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => window.location.reload()}>
            重试
          </Button>
        </div>
      </div>
    );
  }

  if (!task) {
    return <div className="text-muted-foreground">任务不存在</div>;
  }

  const totalJobs = task.jobs.length;
  const completedJobs = task.jobs.filter((j) => j.status === 'completed').length;
  const failedJobs = task.jobs.filter((j) => j.status === 'failed').length;

  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4">
        <Link to="/tasks">
          <Button variant="outline" size="sm">
            <ArrowChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h2 className="text-3xl font-bold tracking-tight text-foreground">{task.name}</h2>
        <Badge variant={statusVariantMap[task.status] ?? 'outline'}>{task.status}</Badge>
      </div>

      {/* 基本信息卡片 */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">总任务</p>
            <p className="text-2xl font-bold text-foreground">{task.stats?.total ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">已完成</p>
            <p className="text-2xl font-bold text-foreground">{task.stats?.done ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">失败</p>
            <p className="text-2xl font-bold text-foreground">{task.stats?.failed ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">队列任务</p>
            <p className="text-2xl font-bold text-foreground">{totalJobs}</p>
            <p className="text-xs text-muted-foreground">
              {completedJobs} 完成 · {failedJobs} 失败
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 步骤列表 */}
      <div className="space-y-3">
        <h3 className="text-lg font-semibold text-foreground">分析步骤与结果</h3>
        {task.steps.length === 0 ? (
          <p className="text-sm text-muted-foreground">暂无分析步骤</p>
        ) : (
          task.steps.map((step) => <StepRow key={step.id} step={step} taskId={task.id} />)
        )}
      </div>

      {/* 原始数据（折叠） */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm text-foreground">原始数据</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="rounded-lg bg-default p-4 overflow-auto text-xs text-foreground">
            {JSON.stringify(task, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
