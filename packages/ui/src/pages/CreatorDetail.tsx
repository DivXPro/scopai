import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import * as icons from '@gravity-ui/icons';
import { apiGet, apiPost } from '@/api/client';
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
