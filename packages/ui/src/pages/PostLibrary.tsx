import { useEffect, useState, useCallback } from 'react';
import { Heart, MessageCircle, Share2, Bookmark, Eye, Search, SlidersHorizontal } from 'lucide-react';
import { apiGet } from '@/api/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

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
    <Badge variant="outline" className={meta.color}>
      {meta.name}
    </Badge>
  );
}

function PostCard({ post }: { post: Post }) {
  const contentPreview = post.content?.slice(0, 120) + (post.content?.length > 120 ? '...' : '') || '无内容';

  return (
    <Card className="hover:shadow-md transition-shadow cursor-pointer">
      <CardContent className="p-4 space-y-3">
        {/* 标题行 */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm leading-tight line-clamp-2 flex-1">
            {post.title || contentPreview}
          </h3>
          <PlatformBadge platformId={post.platform_id} />
        </div>

        {/* 作者 */}
        <p className="text-xs text-muted-foreground">
          {post.author_name ? `@${post.author_name}` : '匿名用户'}
        </p>

        {/* 内容摘要 - 仅当标题存在且内容与标题不同时显示 */}
        {post.title && post.content && post.content !== post.title && (
          <p className="text-sm text-muted-foreground line-clamp-2">
            {contentPreview}
          </p>
        )}

        {/* 统计数据 */}
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
            <MessageCircle className="h-3 w-3" />
            {post.comment_count?.toLocaleString() ?? 0}
          </span>
          {post.play_count > 0 && (
            <span className="flex items-center gap-1">
              <Eye className="h-3 w-3" />
              {post.play_count?.toLocaleString() ?? 0}
            </span>
          )}
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">
            {post.published_at
              ? new Date(post.published_at).toLocaleDateString('zh-CN')
              : new Date(post.fetched_at).toLocaleDateString('zh-CN')}
          </span>
          <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
            <a href={post.url ?? '#'} target="_blank" rel="noopener noreferrer">
              <Share2 className="h-3 w-3 mr-1" />
              查看
            </a>
          </Button>
        </div>
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

export default function PostLibrary() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('limit', '100');
    if (searchQuery.trim()) params.set('query', searchQuery.trim());
    if (selectedPlatform) params.set('platform', selectedPlatform);
    const queryString = params.toString();
    const url = '/api/posts' + (queryString ? `?${queryString}` : '');
    try {
      const data = await apiGet<Post[]>(url);
      setPosts(data);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedPlatform]);

  useEffect(() => {
    // 加载平台列表并过滤掉测试/未知平台
    apiGet<Platform[]>('/api/platforms')
      .then((data) => {
        // 只保留已知平台（有中文名或英文名映射的）
        const knownPlatforms = data.filter((p) => {
          const meta = getPlatformMeta(p.id);
          return meta.name !== p.id; // 排除没有映射的平台（名称等于ID的）
        });
        // 按名称去重
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
    // 初始加载帖子
    fetchPosts();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 搜索和筛选变化时重新加载
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPosts();
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedPlatform, fetchPosts]);

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">帖子库</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {loading ? '加载中...' : `共 ${posts.length} 条帖子`}
        </p>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        {/* 搜索框 */}
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索帖子标题或内容..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-9 pl-9 pr-4 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        {/* 平台筛选 */}
        <div className="flex items-center gap-2 flex-wrap">
          <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
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

      {/* 结果展示 */}
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  );
}
