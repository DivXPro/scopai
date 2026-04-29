import { useEffect, useState, useCallback } from 'react';
import * as icons from '@gravity-ui/icons';
import { apiGet } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import Pagination from '@/components/Pagination';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

const Heart = icons.Heart;
const Bookmark = icons.Bookmark;
const Comment = icons.Comment;
const Eye = icons.Eye;
const Magnifier = icons.Magnifier;
const Sliders = icons.Sliders;
const ChartBar = icons.ChartBar;
const ArrowChevronDown = icons.ArrowChevronDown;
const ArrowChevronUp = icons.ArrowChevronUp;
const CirclePlay = icons.CirclePlay;
const CircleArrowRight = icons.CircleArrowRight;

interface Post {
  id: string;
  title: string | null;
  content: string;
  author_name: string | null;
  platform_id: string;
  post_type: string | null;
  like_count: number;
  collect_count: number;
  comment_count: number;
  share_count: number;
  play_count: number;
  url: string | null;
  cover_url: string | null;
  published_at: string | null;
  fetched_at: string;
}

interface Platform {
  id: string;
  name: string;
}

interface AnalysisResult {
  strategy_id: string;
  strategy_name: string;
  task_id: string;
  target_type: string;
  target_id: string | null;
  raw_response: Record<string, unknown> | null;
  analyzed_at: string;
}

function getPlatformMeta(platformId: string) {
  if (platformId.includes('xhs')) {
    return { name: '小红书', color: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' };
  }
  if (platformId.includes('twitter')) {
    return { name: 'Twitter', color: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100' };
  }
  if (platformId.includes('bilibili')) {
    return { name: 'B站', color: 'bg-pink-50 text-pink-700 border-pink-200 hover:bg-pink-100' };
  }
  if (platformId.includes('weibo')) {
    return { name: '微博', color: 'bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100' };
  }
  return { name: platformId, color: 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100' };
}

function PlatformBadge({ platformId }: { platformId: string }) {
  const meta = getPlatformMeta(platformId);
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium shrink-0 ${meta.color}`}>
      {meta.name}
    </span>
  );
}

function AnalysisSection({ postId }: { postId: string }) {
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<AnalysisResult[]>(`/api/posts/${postId}/analysis`)
      .then((data) => { if (!cancelled) setResults(data); })
      .catch(() => { if (!cancelled) setResults([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [postId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <CirclePlay className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="ml-2 text-xs text-muted-foreground">加载分析结果...</span>
      </div>
    );
  }

  if (results.length === 0) {
    return <p className="text-xs text-muted-foreground py-2">暂无分析结果</p>;
  }

  const grouped = results.reduce<Record<string, AnalysisResult[]>>((acc, r) => {
    const key = r.strategy_name || r.strategy_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  return (
    <div className="space-y-3 pt-2 border-t">
      {Object.entries(grouped).map(([strategyName, items]) => (
        <div key={strategyName}>
          <p className="text-xs font-medium text-muted-foreground mb-1">{strategyName}</p>
          <Table aria-label="分析结果">
            <TableHeader>
              <TableHead className="h-7 text-xs">目标</TableHead>
              <TableHead className="h-7 text-xs">摘要</TableHead>
              <TableHead className="h-7 text-xs">时间</TableHead>
            </TableHeader>
            <TableBody>
              {items.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs py-1">
                    <Badge variant="outline" className="text-[10px] h-4">
                      {r.target_type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs py-1 max-w-[200px] truncate text-foreground">
                    {r.raw_response
                      ? String(r.raw_response.sentiment ?? r.raw_response.summary ?? JSON.stringify(r.raw_response).slice(0, 60))
                      : '-'}
                  </TableCell>
                  <TableCell className="text-xs py-1 text-muted-foreground whitespace-nowrap">
                    {new Date(r.analyzed_at).toLocaleDateString('zh-CN')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ))}
    </div>
  );
}

function PostCard({ post }: { post: Post }) {
  const [expanded, setExpanded] = useState(false);
  const contentPreview = post.content?.slice(0, 120) + (post.content?.length > 120 ? '...' : '') || '无内容';

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm leading-tight line-clamp-2 flex-1 text-foreground">
            {post.title || contentPreview}
          </h3>
          <PlatformBadge platformId={post.platform_id} />
        </div>

        <p className="text-xs text-muted-foreground">
          {post.author_name ? `@${post.author_name}` : '匿名用户'}
        </p>

        {post.title && post.content && post.content !== post.title && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {contentPreview}
          </p>
        )}

        <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
          <span className="flex items-center gap-1">
            <Heart className="h-3 w-3" />
            {post.like_count?.toLocaleString() ?? 0}
          </span>
          <span className="flex items-center gap-1">
            <Bookmark className="h-3 w-3" />
            {post.collect_count?.toLocaleString() ?? 0}
          </span>
          <span className="flex items-center gap-1">
            <Comment className="h-3 w-3" />
            {post.comment_count?.toLocaleString() ?? 0}
          </span>
          {post.play_count > 0 && (
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {post.play_count?.toLocaleString() ?? 0}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">
            {post.published_at
              ? new Date(post.published_at).toLocaleDateString('zh-CN')
              : new Date(post.fetched_at).toLocaleDateString('zh-CN')}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setExpanded(!expanded)}
            >
              <ChartBar className="h-3 w-3 mr-1" />
              分析
              {expanded ? <ArrowChevronUp className="h-3 w-3 ml-0.5" /> : <ArrowChevronDown className="h-3 w-3 ml-0.5" />}
            </Button>
            <a href={post.url ?? '#'} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground">
              <Button variant="ghost" size="sm" className="h-7 text-xs">
                <CircleArrowRight className="h-3 w-3 mr-1" />
                查看
              </Button>
            </a>
          </div>
        </div>

        {expanded && <AnalysisSection postId={post.id} />}
      </CardContent>
    </Card>
  );
}

function PostSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-5 w-12 shrink-0" />
        </div>
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-full" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-3 w-12" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

const PAGE_SIZE = 30;

export default function PostLibrary() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [total, setTotal] = useState(0);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setError('');
    const offset = (page - 1) * PAGE_SIZE;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (searchQuery.trim()) params.set('query', searchQuery.trim());
    if (selectedPlatform) params.set('platform', selectedPlatform);
    try {
      const data = await apiGet<{ posts: Post[]; total: number }>(`/api/posts?${params}`);
      setPosts(data.posts);
      setTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedPlatform, page]);

  useEffect(() => {
    apiGet<Platform[]>('/api/platforms')
      .then((data) => {
        const knownPlatforms = data.filter((p) => {
          const meta = getPlatformMeta(p.id);
          return meta.name !== p.id;
        });
        const seen = new Set<string>();
        const unique = knownPlatforms.filter((p) => {
          const name = getPlatformMeta(p.id).name;
          if (seen.has(name)) return false;
          seen.add(name);
          return true;
        });
        setPlatforms(unique);
      })
      .catch(() => setPlatforms([]));
    fetchPosts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setPage(1);
      fetchPosts();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedPlatform, fetchPosts]);

  if (error && posts.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-bold tracking-tight text-foreground">帖子库</h2>
        <div className="rounded-lg border border-danger/50 bg-danger/10 p-4 text-danger">
          <p className="font-medium">加载失败</p>
          <p className="text-sm mt-1">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={fetchPosts}>
            重试
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground">帖子库</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {loading ? '加载中...' : `共 ${total} 条帖子`}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="relative w-full sm:w-80">
          <Magnifier className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索帖子标题或内容..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-4 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Sliders className="h-4 w-4 text-muted-foreground" />
          <Button
            variant={selectedPlatform === null ? 'default' : 'outline'}
            size="sm"
            onClick={() => setSelectedPlatform(null)}
          >
            全部
          </Button>
          {platforms.map((p) => {
            const isActive = selectedPlatform === p.id;
            return (
              <Button
                key={p.id}
                variant={isActive ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSelectedPlatform(isActive ? null : p.id)}
              >
                {getPlatformMeta(p.id).name}
              </Button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <PostSkeleton key={i} />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-2">暂无匹配的帖子</p>
          {(searchQuery || selectedPlatform) && (
            <Button variant="ghost" size="sm" onClick={() => { setSearchQuery(''); setSelectedPlatform(null); }}>
              清除筛选条件
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={setPage} />
        </>
      )}
    </div>
  );
}
