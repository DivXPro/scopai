import { useEffect, useState, useMemo, memo } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as icons from '@gravity-ui/icons';
import { apiGet, apiPost } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { TaskTimeline } from '@/components/TaskTimeline';
import { PipelineMatrix } from '@/components/PipelineMatrix';
import { PostDetailModal, type Post } from '@/pages/PostLibrary';

const ArrowChevronLeft = icons.ArrowChevronLeft;

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
  strategy_id: string | null;
}

interface TaskProgress {
  dataPreparation?: {
    status: string;
    totalPosts: number;
    donePosts: number;
    failedPosts: number;
    fetchingPosts: number;
    pendingPosts: number;
    commentsFetched: number;
    mediaFetched: number;
  };
  analysis?: {
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    pendingJobs: number;
    processingJobs: number;
  };
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
  progress?: TaskProgress;
  postStatuses?: {
    postId: string;
    status: string;
    commentsFetched: boolean;
    mediaFetched: boolean;
    error: string | null;
    title: string | null;
    platformId: string;
  }[];
}

const statusVariantMap: Record<string, BadgeVariant> = {
  pending: 'outline',
  running: 'default',
  paused: 'secondary',
  completed: 'default',
  failed: 'destructive',
  cancelled: 'destructive',
};

const statusLabelMap: Record<string, string> = {
  pending: '待处理',
  running: '进行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const TaskHeader = memo(function TaskHeader({ task }: { task: TaskDetail }) {
  const progress = useMemo(() => {
    const total = task.stats?.total ?? 0;
    const done = task.stats?.done ?? 0;
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }, [task.stats]);

  return (
    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{task.name}</h2>
          <Badge variant={statusVariantMap[task.status] ?? 'outline'} size="lg">{statusLabelMap[task.status] ?? task.status}</Badge>
        </div>
        {task.description && (
          <p className="text-sm text-muted-foreground">{task.description}</p>
        )}
        <p className="text-xs text-muted-foreground">
          创建于 {new Date(task.created_at).toLocaleString('zh-CN')}
          {task.completed_at && ` · 完成于 ${new Date(task.completed_at).toLocaleString('zh-CN')}`}
        </p>
      </div>
      <div className="flex items-center gap-4">
        <div
          className="text-right"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="总进度"
        >
          <p className="text-3xl font-bold text-foreground">{progress}%</p>
          <p className="text-xs text-muted-foreground">总进度</p>
        </div>
      </div>
    </div>
  );
});

const KpiCards = memo(function KpiCards({ task }: { task: TaskDetail }) {
  const processingJobs = useMemo(
    () => task.jobs.filter((j) => j.status === 'processing').length,
    [task.jobs]
  );

  const cards = [
    { label: '总任务', value: task.stats?.total ?? 0, color: 'text-foreground' },
    { label: '已完成', value: task.stats?.done ?? 0, color: 'text-success' },
    { label: '失败', value: task.stats?.failed ?? 0, color: 'text-danger' },
    { label: '进行中', value: processingJobs, color: 'text-primary' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{card.label}</p>
                <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
});

export default function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [previewPostId, setPreviewPostId] = useState<string | null>(null);
  const [previewPost, setPreviewPost] = useState<Post | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    if (!id) return;
    setError('');
    apiGet<TaskDetail>(`/api/tasks/${id}`)
      .then(setTask)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!previewPostId || previewPostId === 'test') {
      setPreviewPost(null);
      return;
    }
    setPreviewLoading(true);
    apiGet<Post>(`/api/posts/${previewPostId}`)
      .then(setPreviewPost)
      .catch(() => setPreviewPost(null))
      .finally(() => setPreviewLoading(false));
  }, [previewPostId]);

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

  const phases = [
    {
      id: 'data-prep',
      name: '数据准备',
      status: task.progress?.dataPreparation?.status ?? 'pending',
      progress: task.progress?.dataPreparation?.totalPosts
        ? Math.round((task.progress.dataPreparation.donePosts / task.progress.dataPreparation.totalPosts) * 100)
        : 0,
      total: task.progress?.dataPreparation?.totalPosts ?? 0,
      done: task.progress?.dataPreparation?.donePosts ?? 0,
    },
    ...task.steps.map((step) => {
      const total = step.stats?.total ?? 0;
      const done = step.stats?.done ?? 0;
      return {
        id: step.id,
        name: step.name,
        status: step.status,
        progress: total > 0 ? Math.round((done / total) * 100) : 0,
        stepOrder: step.step_order,
        total,
        done,
      };
    }),
  ];

  const matrixColumns = [
    { key: 'data-prep', name: '数据准备' },
    ...task.steps.map((step) => ({
      key: step.id,
      name: step.name,
    })),
  ];

  const postStatusMap = new Map(
    task.postStatuses?.map((p) => [p.postId, p]) ?? []
  );

  const jobPostIds = Array.from(
    new Set(
      task.jobs
        .filter((j) => j.target_type === 'post' && j.target_id)
        .map((j) => j.target_id!)
    )
  );
  const statusPostIds = task.postStatuses?.map((p) => p.postId) ?? [];
  const allPostIds = Array.from(new Set([...statusPostIds, ...jobPostIds]));

  const matrixRows = allPostIds.map((postId) => {
    const postStatus = postStatusMap.get(postId);
    const cells: Record<string, { status: string }> = {};
    cells['data-prep'] = { status: postStatus?.status ?? 'pending' };
    for (const step of task.steps) {
      const job = task.jobs.find(
        (j) => j.target_id === postId && j.strategy_id === step.strategy_id
      );
      cells[step.id] = { status: job?.status ?? 'pending' };
    }
    return {
      rowId: postId,
      rowLabel: postId.slice(0, 12) + (postId.length > 12 ? '...' : ''),
      title: postStatus?.title ?? null,
      platformId: postStatus?.platformId ?? '',
      cells,
    };
  });


  return (
    <div className="space-y-6">
      {/* 顶部导航 */}
      <div className="flex items-center gap-4">
        <Link to="/tasks">
          <Button variant="outline" size="sm">
            <ArrowChevronLeft className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      <TaskHeader task={task} />
      <KpiCards task={task} />
      <TaskTimeline phases={phases} />
      <PipelineMatrix
        columns={matrixColumns}
        rows={matrixRows}
        onRowClick={(postId) => setPreviewPostId(postId)}
      />

      {/* Post Preview Modal */}
      {previewPostId && previewPost && !previewLoading && (
        <PostDetailModal
          post={previewPost}
          onClose={() => setPreviewPostId(null)}
          onToggleStar={async (postId, currentStarred) => {
            await apiPost(`/api/posts/${postId}/star`, { starred: !currentStarred });
            // Refresh post detail
            apiGet<Post>(`/api/posts/${postId}`).then(setPreviewPost).catch(() => {});
          }}
          onDelete={(postId) => {
            setPreviewPostId(null);
            window.alert(`帖子 ${postId.slice(0, 8)}... 已删除`);
          }}
        />
      )}
    </div>
  );
}
