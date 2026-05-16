import { useEffect, useState, useMemo, memo } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as icons from '@gravity-ui/icons';
import { apiGet } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { TaskTimeline } from '@/components/TaskTimeline';
import { PipelineMatrix } from '@/components/PipelineMatrix';

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

interface PostPreview {
  id: string;
  platform_id: string;
  platform_post_id: string;
  title: string | null;
  content: string;
  author_name: string | null;
  url: string | null;
  cover_url: string | null;
  like_count: number;
  comment_count: number;
  share_count: number;
  collect_count: number;
  published_at: string | null;
  post_type: string | null;
  is_starred: boolean;
}


const statusVariantMap: Record<string, BadgeVariant> = {
  pending: 'outline',
  running: 'default',
  paused: 'secondary',
  completed: 'default',
  failed: 'destructive',
  cancelled: 'destructive',
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
          <Badge variant={statusVariantMap[task.status] ?? 'outline'} size="lg">{task.status}</Badge>
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
  const [previewPost, setPreviewPost] = useState<PostPreview | null>(null);
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
    apiGet<PostPreview>(`/api/posts/${previewPostId}`)
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
      {previewPostId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setPreviewPostId(null)}
        >
          <div
            className="bg-background rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-y-auto m-4 p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            {previewLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : previewPost ? (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-foreground">
                      {previewPost.title || '无标题'}
                    </h3>
                    <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                      <span>{previewPost.platform_id}</span>
                      {previewPost.author_name && (
                        <span>· {previewPost.author_name}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setPreviewPostId(null)}
                    className="shrink-0 p-1 rounded-md hover:bg-muted text-muted-foreground"
                  >
                    ✕
                  </button>
                </div>

                {previewPost.cover_url && (
                  <img
                    src={previewPost.cover_url}
                    alt="cover"
                    className="w-full h-48 object-cover rounded-lg"
                  />
                )}

                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {previewPost.content}
                </p>

                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {previewPost.like_count > 0 && (
                    <span>❤️ {previewPost.like_count}</span>
                  )}
                  {previewPost.comment_count > 0 && (
                    <span>💬 {previewPost.comment_count}</span>
                  )}
                  {previewPost.share_count > 0 && (
                    <span>↗️ {previewPost.share_count}</span>
                  )}
                  {previewPost.collect_count > 0 && (
                    <span>🔖 {previewPost.collect_count}</span>
                  )}
                </div>

                {previewPost.url && (
                  <a
                    href={previewPost.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-sm text-primary hover:underline"
                  >
                    查看原帖 →
                  </a>
                )}
              </>
            ) : (
              <div className="text-center text-muted-foreground py-8">
                <p>无法加载帖子详情</p>
                <button
                  onClick={() => setPreviewPostId(null)}
                  className="mt-2 text-sm text-primary hover:underline"
                >
                  关闭
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
