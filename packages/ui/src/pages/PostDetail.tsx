import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as icons from '@gravity-ui/icons';
import { apiGet, apiPost, apiDelete } from '@/api/client';
import { Card, Button, Select, ListBox, Skeleton } from '@heroui/react';
import { PlatformBadge } from '@/components/PlatformIcon';
import { Post, MediaFile, AnalysisResult, Strategy, PostRoutingResult } from './PostLibrary';

const Heart = icons.Heart;
const Bookmark = icons.Bookmark;
const Comment = icons.Comment;
const Eye = icons.Eye;
const CirclePlay = icons.CirclePlay;
const ArrowChevronLeft = icons.ArrowChevronLeft;
const ArrowChevronRight = icons.ArrowChevronRight;

function formatCount(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return date.toLocaleDateString('zh-CN');
}

function SchemaRenderer({
  data,
  schema,
}: {
  data: Record<string, unknown>;
  schema: Record<string, unknown>;
}) {
  const properties = (schema.properties ?? schema) as Record<string, Record<string, unknown>>;

  const renderValue = (value: unknown, propSchema: Record<string, unknown>): React.ReactNode => {
    const type = (propSchema.type ?? 'string') as string;
    if (value === null || value === undefined) return <span className="text-muted-foreground">-</span>;

    if (type === 'array' && Array.isArray(value)) {
      const itemSchema = (propSchema.items ?? {}) as Record<string, unknown>;
      const itemType = itemSchema.type as string;
      if (itemType === 'object' && itemSchema.properties) {
        return (
          <div className="space-y-2">
            {value.map((item, idx) => (
              <div key={idx} className="pl-3 border-l-2 border-slate-200">
                <SchemaRenderer data={item as Record<string, unknown>} schema={itemSchema} />
              </div>
            ))}
          </div>
        );
      }
      return (
        <ul className="list-disc list-inside text-sm text-foreground space-y-0.5">
          {value.map((item, idx) => <li key={idx}>{String(item)}</li>)}
        </ul>
      );
    }

    if (type === 'object' && typeof value === 'object' && value !== null) {
      const nestedSchema = propSchema.properties ? propSchema : { properties: {} as Record<string, unknown> };
      return (
        <div className="pl-3 border-l-2 border-slate-200">
          <SchemaRenderer data={value as Record<string, unknown>} schema={nestedSchema} />
        </div>
      );
    }

    if (type === 'boolean') {
      return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${value ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {value ? '是' : '否'}
        </span>
      );
    }

    if (type === 'number') return <span className="font-mono text-sm text-foreground">{String(value)}</span>;
    return <span className="text-sm text-foreground">{String(value)}</span>;
  };

  const entries = Object.entries(properties).filter(([key]) => key in data);
  if (entries.length === 0) {
    return <pre className="text-xs bg-white rounded p-3 overflow-x-auto border">{JSON.stringify(data, null, 2)}</pre>;
  }

  return (
    <div className="space-y-3">
      {entries.map(([key, propSchema]) => {
        const label = propSchema.title as string | undefined;
        const description = propSchema.description as string | undefined;
        return (
          <div key={key}>
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-semibold text-foreground">{label || key}</span>
              {description && <span className="text-[10px] text-muted-foreground">{description}</span>}
            </div>
            <div className="mt-1">{renderValue(data[key], propSchema)}</div>
          </div>
        );
      })}
    </div>
  );
}

function RouterDecisionCard({ routing }: { routing: PostRoutingResult }) {
  return (
    <div className="rounded-lg border bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-purple-50 text-purple-700 px-2 py-0.5 text-[10px] font-medium border border-purple-100">路由决策</span>
          <span className="text-sm font-medium text-slate-800">{routing.router_strategy_name}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">置信度: {(routing.confidence * 100).toFixed(0)}%</span>
      </div>

      {routing.applicable_strategies.length > 0 && (
        <div>
          <div className="text-[10px] font-medium text-green-700 mb-1.5">适用策略</div>
          <div className="flex flex-wrap gap-1.5">
            {routing.applicable_strategies.map(s => (
              <span key={s.strategy_id} className="inline-flex items-center rounded-full bg-green-50 text-green-700 px-2 py-0.5 text-[10px] border border-green-100">
                {s.strategy_name}
              </span>
            ))}
          </div>
        </div>
      )}

      {routing.skipped_strategies.length > 0 && (
        <div>
          <div className="text-[10px] font-medium text-red-700 mb-1.5">跳过策略</div>
          <div className="space-y-1.5">
            {routing.skipped_strategies.map(s => (
              <div key={s.strategy_id} className="flex items-start gap-2 text-[11px]">
                <span className="inline-flex items-center rounded-full bg-red-50 text-red-700 px-1.5 py-0.5 shrink-0 border border-red-100">{s.strategy_name}</span>
                <span className="text-slate-500 leading-relaxed">{s.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {routing.checks && routing.checks.length > 0 && (
        <div>
          <div className="text-[10px] font-medium text-slate-600 mb-1.5">检查项</div>
          <div className="space-y-1">
            {routing.checks.map((check, idx) => (
              <div key={idx} className="flex items-center gap-2 text-[11px]">
                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] shrink-0 ${check.passed ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                  {check.passed ? '通过' : '未通过'}
                </span>
                <span className="text-slate-500">{check.check_id}</span>
                {check.evidence && <span className="text-slate-400">({check.evidence})</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PostAnalysisDetail({ postId }: { postId: string }) {
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [routing, setRouting] = useState<PostRoutingResult[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      apiGet<AnalysisResult[]>(`/api/posts/${postId}/analysis`),
      apiGet<Strategy[]>('/api/strategies'),
      apiGet<{ post_id: string; routing: PostRoutingResult[] | null }>(`/api/posts/${postId}/routing`),
    ]).then(([analysisData, strategyData, routingData]) => {
      if (cancelled) return;
      setResults(analysisData);
      setStrategies(strategyData);
      setRouting(routingData.routing);
      const grouped = analysisData.reduce<Record<string, AnalysisResult[]>>((acc, r) => {
        const key = r.strategy_name || r.strategy_id;
        if (!acc[key]) acc[key] = [];
        acc[key].push(r);
        return acc;
      }, {});
      const keys = Object.keys(grouped);
      if (keys.length > 0) setSelectedStrategy(keys[0]);
    }).catch(() => {
      if (!cancelled) { setResults([]); setStrategies([]); setRouting(null); }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [postId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <CirclePlay className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="ml-2 text-xs text-muted-foreground">加载分析结果...</span>
      </div>
    );
  }

  const grouped = results.reduce<Record<string, AnalysisResult[]>>((acc, r) => {
    const key = r.strategy_name || r.strategy_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});
  const strategyNames = Object.keys(grouped);
  const selectedResults = grouped[selectedStrategy] ?? [];
  const selectedStrategyObj = strategies.find(s => s.name === selectedStrategy || s.id === selectedStrategy);
  const outputSchema = selectedStrategyObj?.output_schema;

  if (results.length === 0 && (!routing || routing.length === 0)) {
    return <p className="text-xs text-muted-foreground py-4">暂无分析结果</p>;
  }

  return (
    <div className="space-y-4">
      {routing && routing.length > 0 && (
        <div className="space-y-3">
          {routing.map(r => <RouterDecisionCard key={r.id} routing={r} />)}
        </div>
      )}
      {results.length > 0 && (
        <>
          <Select selectedKey={selectedStrategy} onSelectionChange={(key) => setSelectedStrategy(key as string)} className="w-full max-w-xs">
            <Select.Trigger className="h-9 text-sm"><Select.Value /><Select.Indicator /></Select.Trigger>
            <Select.Popover>
              <ListBox>
                {strategyNames.map(s => <ListBox.Item key={s} id={s}>{s}</ListBox.Item>)}
              </ListBox>
            </Select.Popover>
          </Select>
          <div className="space-y-3">
            {selectedResults.map((r, i) => (
              <div key={i} className="rounded-lg border bg-slate-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] h-5 bg-white">{r.target_type}</span>
                  <span className="text-[10px] text-muted-foreground">{new Date(r.analyzed_at).toLocaleString('zh-CN')}</span>
                </div>
                {r.raw_response && outputSchema ? (
                  <SchemaRenderer data={r.raw_response} schema={outputSchema} />
                ) : r.raw_response ? (
                  <pre className="text-xs bg-white rounded p-3 overflow-x-auto border">{JSON.stringify(r.raw_response, null, 2)}</pre>
                ) : (
                  <p className="text-xs text-muted-foreground">无数据</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function PostDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMedia, setLoadingMedia] = useState(true);
  const [error, setError] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'content' | 'analysis'>('content');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [starred, setStarred] = useState(false);
  const latestRef = useRef(0);

  const postId = id!;

  useEffect(() => {
    const ctrl = new AbortController();
    const seq = ++latestRef.current;
    setLoading(true);
    setError('');
    apiGet<Post>(`/api/posts/${postId}`, { signal: ctrl.signal })
      .then((data) => {
        if (seq !== latestRef.current) return;
        setPost(data);
        setStarred(data.is_starred);
      })
      .catch((e) => {
        if (seq !== latestRef.current) return;
        if (e instanceof Error && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => {
        if (seq === latestRef.current) setLoading(false);
      });
    return () => ctrl.abort();
  }, [postId]);

  useEffect(() => {
    if (!postId) return;
    const ctrl = new AbortController();
    setLoadingMedia(true);
    setCurrentIndex(0);
    apiGet<MediaFile[]>(`/api/posts/${postId}/media`, { signal: ctrl.signal })
      .then((data) => setMediaFiles(data))
      .catch(() => { if (!ctrl.signal.aborted) setMediaFiles([]); })
      .finally(() => { if (!ctrl.signal.aborted) setLoadingMedia(false); });
    return () => ctrl.abort();
  }, [postId]);

  const goPrev = useCallback(() => setCurrentIndex((i) => (i > 0 ? i - 1 : mediaFiles.length - 1)), [mediaFiles.length]);
  const goNext = useCallback(() => setCurrentIndex((i) => (i < mediaFiles.length - 1 ? i + 1 : 0)), [mediaFiles.length]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [goPrev, goNext]);

  const toggleStar = useCallback(async () => {
    if (!post) return;
    await apiPost(`/api/posts/${post.id}/star`, { starred: !starred });
    setStarred((s) => !s);
  }, [post, starred]);

  const [deleteError, setDeleteError] = useState('');

  const handleDelete = useCallback(async () => {
    if (!post) return;
    try {
      setDeleteError('');
      await apiDelete(`/api/posts/${post.id}`);
      navigate('/posts');
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : '删除失败');
    }
  }, [post, navigate]);

  const current = mediaFiles[currentIndex];

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" className="h-8" onPress={() => navigate('/posts')}>
            <ArrowChevronLeft className="h-4 w-4 mr-1" /> 返回
          </Button>
        </div>
        <Card><Card.Content className="p-8 space-y-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-80 w-full rounded-lg" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </Card.Content></Card>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" className="h-8" onPress={() => navigate('/posts')}>
          <ArrowChevronLeft className="h-4 w-4 mr-1" /> 返回
        </Button>
        <div className="rounded-lg border border-danger/50 bg-danger/10 p-4 text-danger">
          <p className="font-medium">{error || '帖子不存在'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Back + Title */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="h-8" onPress={() => navigate('/posts')}>
          <ArrowChevronLeft className="h-4 w-4 mr-1" /> 返回帖子库
        </Button>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleStar}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:bg-slate-100"
          >
            <span className={starred ? 'text-yellow-500 text-lg' : 'text-gray-400 text-lg'}>{starred ? '★' : '☆'}</span>
            <span className={starred ? 'text-slate-900' : 'text-slate-500'}>{starred ? '已星标' : '星标'}</span>
          </button>
          <Button variant="danger" size="sm" onPress={() => setShowDeleteConfirm(true)}>删除帖子</Button>
        </div>
      </div>

      {/* Main content: media + info */}
      <div className="flex flex-col lg:flex-row gap-4 min-h-[70vh]">
        {/* Left: Media */}
        <div className="flex-1 lg:flex-[3] bg-black rounded-xl overflow-hidden relative group min-h-[400px]">
          {loadingMedia ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <CirclePlay className="h-4 w-4 animate-spin text-white/60" />
              <span className="ml-2 text-xs text-white/60">加载中...</span>
            </div>
          ) : mediaFiles.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-white/40">
              <span className="text-sm">暂无媒体文件</span>
            </div>
          ) : (
            <>
              <div className="absolute inset-0 flex items-center justify-center">
                {current.media_type === 'image' && current.src ? (
                  <img src={current.src} alt={`媒体 ${currentIndex + 1}`} className="max-w-full max-h-full object-contain" />
                ) : current.media_type === 'video' ? (
                  <video src={current.src} controls className="max-w-full max-h-full" />
                ) : current.media_type === 'audio' ? (
                  <audio src={current.src} controls className="w-full max-w-md" />
                ) : (
                  <div className="flex flex-col items-center justify-center text-white/40">
                    <span className="text-3xl mb-3">📏</span>
                    <span className="text-sm capitalize">{current.media_type}</span>
                  </div>
                )}
              </div>

              {mediaFiles.length > 1 && (
                <>
                  <button onClick={goPrev} className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-all opacity-0 group-hover:opacity-100" aria-label="上一张">
                    <ArrowChevronLeft className="h-5 w-5 text-white" />
                  </button>
                  <button onClick={goNext} className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-all opacity-0 group-hover:opacity-100" aria-label="下一张">
                    <ArrowChevronRight className="h-5 w-5 text-white" />
                  </button>
                  <span className="absolute top-4 left-4 bg-black/50 text-white text-xs font-medium px-2.5 py-1 rounded-full backdrop-blur-sm z-10">
                    {currentIndex + 1} / {mediaFiles.length}
                  </span>
                  <div className="absolute bottom-0 left-0 right-0 flex gap-2 overflow-x-auto px-4 py-2 bg-black/40 opacity-0 group-hover:opacity-100 transition-all justify-center">
                    {mediaFiles.map((m, i) => (
                      <button key={m.id} onClick={() => setCurrentIndex(i)} className={`shrink-0 w-12 h-12 rounded border overflow-hidden transition-all ${i === currentIndex ? 'ring-2 ring-white' : 'opacity-50 hover:opacity-80'}`}>
                        {m.media_type === 'image' && m.src ? (
                          <img src={m.src} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-slate-800 text-white text-xs">
                            {m.media_type === 'video' ? '▶' : m.media_type === 'audio' ? '🎧' : '📏'}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Right: Info */}
        <div className="flex-1 lg:flex-[2] bg-white rounded-xl border border-slate-200 flex flex-col min-w-0 max-h-[80vh]">
          <div className="flex border-b border-slate-200 shrink-0 rounded-t-xl overflow-hidden">
            <button className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'content' ? 'text-secondary border-b-2 border-secondary' : 'text-slate-500 hover:text-slate-700'}`} onClick={() => setActiveTab('content')}>
              文字内容
            </button>
            <button className={`flex-1 py-3 text-sm font-medium transition-colors ${activeTab === 'analysis' ? 'text-secondary border-b-2 border-secondary' : 'text-slate-500 hover:text-slate-700'}`} onClick={() => setActiveTab('analysis')}>
              分析结果
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'content' ? (
              <div className="p-5">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <PlatformBadge platformId={post.platform_id} />
                    <span className="text-xs text-slate-400">{timeAgo(post.published_at || post.fetched_at)}</span>
                  </div>
                  {post.title && <h3 className="font-semibold text-base text-slate-900">{post.title}</h3>}
                  {post.content && <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{post.content}</p>}
                  <div className="flex items-center gap-4 text-xs text-slate-500 pt-3 border-t border-slate-100">
                    <span className="flex items-center gap-1"><Heart className="h-3.5 w-3.5" />{formatCount(post.like_count ?? 0)}</span>
                    <span className="flex items-center gap-1"><Comment className="h-3.5 w-3.5" />{formatCount(post.comment_count ?? 0)}</span>
                    {post.collect_count > 0 && <span className="flex items-center gap-1"><Bookmark className="h-3.5 w-3.5" />{formatCount(post.collect_count)}</span>}
                    {post.share_count > 0 && <span className="flex items-center gap-1"><Eye className="h-3.5 w-3.5" />{formatCount(post.share_count)}</span>}
                  </div>
                  {post.labels && post.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {post.labels.map((label) => (
                        <span key={label.id} className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                          {label.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {post.url && (
                    <a href={post.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      查看原文 <ArrowChevronRight className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-5">
                <PostAnalysisDetail postId={post.id} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete Confirm Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold">确认删除</h3>
            <p className="text-sm text-slate-600">此操作不可恢复，将同时删除该帖子的评论、媒体文件和分析数据。</p>
            {deleteError && <p className="text-xs text-danger">{deleteError}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onPress={() => setShowDeleteConfirm(false)}>取消</Button>
              <Button variant="danger" size="sm" onPress={handleDelete}>确认删除</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
