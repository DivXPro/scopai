import { useEffect, useState, useCallback, useRef } from 'react';
import * as icons from '@gravity-ui/icons';
import { apiGet, apiPost, apiDelete } from '@/api/client';
import { Card, Skeleton, Button, Select, ListBox, Modal } from '@heroui/react';
import Pagination from '@/components/Pagination';
import {
  Table as DataTable, TableHeader, TableHead, TableBody, TableRow, TableCell,
} from '@/components/ui/table';

const Heart = icons.Heart;
const Bookmark = icons.Bookmark;
const Comment = icons.Comment;
const Eye = icons.Eye;
const Sliders = icons.Sliders;
const ArrowUpArrowDown = icons.ArrowUpArrowDown;
const ChartBar = icons.ChartBar;
const CirclePlay = icons.CirclePlay;
const CircleArrowRight = icons.CircleArrowRight;
const LayoutCellsLarge = icons.LayoutCellsLarge;
const ListUl = icons.ListUl;
const Picture = icons.Picture;
const Play = icons.Play;

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
  analysis_count?: number;
  media_count?: number;
  is_starred: boolean;
  labels?: { id: string; name: string; color: string | null }[];
}

interface MediaFile {
  id: string;
  media_type: 'image' | 'video' | 'audio';
  url: string;
  src: string;
  width: number | null;
  height: number | null;
  downloaded_at: string | null;
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

interface Strategy {
  id: string;
  name: string;
  output_schema: Record<string, unknown>;
}

function getPlatformMeta(platformId: string) {
  if (platformId.includes('xhs')) {
    return { name: '小红书', color: 'bg-red-50 text-red-600 border-red-100' };
  }
  if (platformId.includes('twitter')) {
    return { name: 'Twitter', color: 'bg-slate-900 text-white border-slate-900' };
  }
  if (platformId.includes('bilibili')) {
    return { name: 'B站', color: 'bg-blue-50 text-blue-600 border-blue-100' };
  }
  if (platformId.includes('weibo')) {
    return { name: '微博', color: 'bg-yellow-50 text-orange-600 border-orange-100' };
  }
  return { name: platformId, color: 'bg-gray-50 text-gray-700 border-gray-200' };
}

function PlatformBadge({ platformId }: { platformId: string }) {
  const meta = getPlatformMeta(platformId);
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wider uppercase shrink-0 ${meta.color}`}>
      {meta.name}
    </span>
  );
}

function formatCount(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + 'w';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  return date.toLocaleDateString('zh-CN');
}

function PostCard({ post, onAnalyze, onViewMedia, onToggleStar, onAddLabel, onRemoveLabel }: { post: Post; onAnalyze: (postId: string) => void; onViewMedia: (postId: string) => void; onToggleStar: (postId: string, currentStarred: boolean) => void; onAddLabel: (postId: string, labelName: string) => void; onRemoveLabel: (postId: string, labelId: string) => void }) {
  const contentPreview = post.content?.slice(0, 120) + (post.content?.length > 120 ? '...' : '') || '无内容';
  const isVideo = post.post_type === 'video' || post.platform_id.includes('bilibili');
  const initials = (post.author_name || '匿名').slice(0, 2).toUpperCase();

  return (
    <Card className="hover:shadow-[0_12px_24px_rgba(0,0,0,0.06)] transition-all duration-300 flex flex-col group relative">
      <Card.Content className="p-5 flex flex-col flex-1">
        {/* Author + Platform */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600 shrink-0">
              {initials}
            </div>
            <div>
              <p className="font-semibold text-sm text-slate-900 leading-tight">
                {post.author_name || '匿名用户'}
              </p>
              <p className="text-xs text-slate-400">
                @{post.author_name || 'anonymous'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <PlatformBadge platformId={post.platform_id} />
            <button
              onClick={(e) => { e.stopPropagation(); onToggleStar(post.id, post.is_starred); }}
              className="ml-1 text-lg leading-none hover:scale-110 transition-transform"
            >
              <span className={post.is_starred ? 'text-yellow-500' : 'text-gray-400'}>{post.is_starred ? '★' : '☆'}</span>
            </button>
          </div>
        </div>

        {/* Cover Image or Text Content */}
        {post.cover_url ? (
          <div className="relative rounded-lg overflow-hidden mb-4 aspect-[4/3] cursor-pointer" onClick={() => onViewMedia(post.id)}>
            <img
              src={post.cover_url}
              alt=""
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
            {isVideo && (
              <>
                <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
                  <Play className="h-12 w-12 text-white" style={{ fill: 'white' }} />
                </div>
                {post.play_count > 0 && (
                  <div className="absolute bottom-2 right-2 bg-black/60 text-white px-2 py-0.5 rounded text-[10px] font-medium">
                    {formatCount(post.play_count)} 播放
                  </div>
                )}
              </>
            )}
            {!isVideo && (
              <div className="absolute top-2 right-2 bg-black/40 backdrop-blur-sm text-white px-2 py-1 rounded text-[10px] font-medium flex items-center gap-1">
                <Picture className="h-3 w-3" />
                封面
              </div>
            )}
          </div>
        ) : (
          <div className="relative rounded-lg overflow-hidden mb-4 aspect-[4/3] bg-slate-50 border border-slate-100 p-5 flex flex-col justify-center cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => onViewMedia(post.id)}>
            <h3 className="font-semibold text-sm text-slate-900 line-clamp-2 mb-2 leading-snug">
              {post.title || contentPreview}
            </h3>
            {post.title && post.content && post.content !== post.title && (
              <p className="text-sm text-slate-500 line-clamp-3">
                {contentPreview}
              </p>
            )}
          </div>
        )}

        {/* Labels */}
        {(post.labels && post.labels.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {post.labels.map((label) => (
              <span key={label.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                {label.name}
                <button
                  onClick={(e) => { e.stopPropagation(); onRemoveLabel(post.id, label.id); }}
                  className="ml-0.5 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  x
                </button>
              </span>
            ))}
            <button
              className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-dashed border-gray-300 text-gray-400 text-xs hover:border-gray-400 hover:text-gray-500 transition-colors"
              onClick={() => {
                const name = window.prompt('Label name:');
                if (name?.trim()) onAddLabel(post.id, name.trim());
              }}
            >
              +
            </button>
          </div>
        )}
        {(!post.labels || post.labels.length === 0) && (
          <div className="flex items-center gap-1.5 mb-3">
            <button
              className="inline-flex items-center gap-1 text-[10px] text-gray-400 hover:text-gray-500 transition-colors"
              onClick={() => {
                const name = window.prompt('Label name:');
                if (name?.trim()) onAddLabel(post.id, name.trim());
              }}
            >
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-dashed border-gray-300 text-xs">+</span>
              添加标签
            </button>
          </div>
        )}

        {/* Engagement Stats */}
        <div className="flex items-center gap-4 text-xs text-on-surface-variant font-medium mt-auto border-t border-slate-50 pt-4">
          <span className="flex items-center gap-1.5">
            <Heart className="h-3.5 w-3.5" />
            {formatCount(post.like_count ?? 0)}
          </span>
          <span className="flex items-center gap-1.5">
            <Comment className="h-3.5 w-3.5" />
            {formatCount(post.comment_count ?? 0)}
          </span>
          {post.collect_count > 0 && (
            <span className="flex items-center gap-1.5">
              <Bookmark className="h-3.5 w-3.5" />
              {formatCount(post.collect_count)}
            </span>
          )}
          {post.play_count > 0 && !isVideo && (
            <span className="flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              {formatCount(post.play_count)}
            </span>
          )}
          <span className="ml-auto text-[10px] text-slate-400 uppercase tracking-wider">
            {timeAgo(post.published_at || post.fetched_at)}
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-50">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onPress={() => onAnalyze(post.id)}
            isDisabled={!post.analysis_count}
          >
            <ChartBar className="h-3.5 w-3.5 mr-1" />
            分析{post.analysis_count ? ` (${post.analysis_count})` : ''}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onPress={() => onViewMedia(post.id)}
            isDisabled={!post.media_count}
          >
            <Picture className="h-3.5 w-3.5 mr-1" />
            媒体{post.media_count ? ` (${post.media_count})` : ''}
          </Button>
          <a href={post.url ?? '#'} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:text-foreground ml-auto">
            <Button variant="ghost" size="sm" className="h-7 text-xs">
              <CircleArrowRight className="h-3.5 w-3.5 mr-1" />
              查看
            </Button>
          </a>
        </div>
      </Card.Content>
    </Card>
  );
}

function SchemaRenderer({
  data,
  schema,
}: {
  data: Record<string, unknown>;
  schema: Record<string, unknown>;
}) {
  const properties = (schema.properties ?? schema) as Record<
    string,
    Record<string, unknown>
  >;

  function renderValue(
    value: unknown,
    propSchema: Record<string, unknown>,
  ): React.ReactNode {
    const type = (propSchema.type ?? 'string') as string;

    if (value === null || value === undefined) {
      return <span className="text-muted-foreground">-</span>;
    }

    if (type === 'array' && Array.isArray(value)) {
      const itemSchema = (propSchema.items ?? {}) as Record<string, unknown>;
      const itemType = itemSchema.type as string;
      if (itemType === 'object' && itemSchema.properties) {
        return (
          <div className="space-y-2">
            {value.map((item, idx) => (
              <div key={idx} className="pl-3 border-l-2 border-slate-200">
                <SchemaRenderer
                  data={item as Record<string, unknown>}
                  schema={itemSchema}
                />
              </div>
            ))}
          </div>
        );
      }
      return (
        <ul className="list-disc list-inside text-sm text-foreground space-y-0.5">
          {value.map((item, idx) => (
            <li key={idx}>{String(item)}</li>
          ))}
        </ul>
      );
    }

    if (type === 'object' && typeof value === 'object' && value !== null) {
      const nestedSchema = propSchema.properties
        ? propSchema
        : { properties: {} as Record<string, unknown> };
      return (
        <div className="pl-3 border-l-2 border-slate-200">
          <SchemaRenderer
            data={value as Record<string, unknown>}
            schema={nestedSchema}
          />
        </div>
      );
    }

    if (type === 'boolean') {
      return (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
            value ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {value ? '是' : '否'}
        </span>
      );
    }

    if (type === 'number') {
      return <span className="font-mono text-sm text-foreground">{String(value)}</span>;
    }

    // string or fallback
    return <span className="text-sm text-foreground">{String(value)}</span>;
  }

  const entries = Object.entries(properties).filter(([key]) => key in data);

  if (entries.length === 0) {
    return (
      <pre className="text-xs bg-white rounded p-3 overflow-x-auto border">
        {JSON.stringify(data, null, 2)}
      </pre>
    );
  }

  return (
    <div className="space-y-3">
      {entries.map(([key, propSchema]) => {
        const value = data[key];
        const description = propSchema.description as string | undefined;
        const label = propSchema.title as string | undefined;

        return (
          <div key={key}>
            <div className="flex items-baseline gap-1.5">
              <span className="text-sm font-semibold text-foreground">
                {label || key}
              </span>
              {description && (
                <span className="text-[10px] text-muted-foreground">
                  {description}
                </span>
              )}
            </div>
            <div className="mt-1">{renderValue(value, propSchema)}</div>
          </div>
        );
      })}
    </div>
  );
}

function MediaFilesModal({ post, onClose, onToggleStar }: { post: Post; onClose: () => void; onToggleStar: (postId: string, currentStarred: boolean) => void }) {
  const [mediaFiles, setMediaFiles] = useState<MediaFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<'content' | 'analysis'>('content');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCurrentIndex(0);
    apiGet<MediaFile[]>(`/api/posts/${post.id}/media`)
      .then((data) => {
        if (cancelled) return;
        setMediaFiles(data);
      })
      .catch(() => {
        if (!cancelled) setMediaFiles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [post.id]);

  const goPrev = () => setCurrentIndex((i) => (i > 0 ? i - 1 : mediaFiles.length - 1));
  const goNext = () => setCurrentIndex((i) => (i < mediaFiles.length - 1 ? i + 1 : 0));

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') goPrev();
      if (e.key === 'ArrowRight') goNext();
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [mediaFiles.length, onClose]);

  const current = mediaFiles[currentIndex];

  return (
    <Modal isOpen={true} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="max-w-5xl max-h-[90vh] w-full p-0 overflow-hidden">
            <div className="flex h-[80vh]">
              {/* 左侧：媒体 */}
              <div className="flex-[3] bg-black relative group">
                {loading ? (
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
                    {/* 媒体内容 - absolute 撑满 */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      {current.media_type === 'image' && current.src ? (
                        <img
                          src={current.src}
                          alt={`媒体 ${currentIndex + 1}`}
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : current.media_type === 'video' ? (
                        <video
                          src={current.src}
                          controls
                          className="max-w-full max-h-full"
                        />
                      ) : current.media_type === 'audio' ? (
                        <audio src={current.src} controls className="w-full max-w-md" />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-white/40">
                          <span className="text-3xl mb-3">📏</span>
                          <span className="text-sm capitalize">{current.media_type}</span>
                        </div>
                      )}
                    </div>

                    {/* 左右切换 */}
                    {mediaFiles.length > 1 && (
                      <>
                        <button
                          onClick={goPrev}
                          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-all opacity-0 group-hover:opacity-100"
                          aria-label="上一张"
                        >
                          <icons.ArrowChevronLeft className="h-5 w-5 text-white" />
                        </button>
                        <button
                          onClick={goNext}
                          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center hover:bg-white/30 transition-all opacity-0 group-hover:opacity-100"
                          aria-label="下一张"
                        >
                          <icons.ArrowChevronRight className="h-5 w-5 text-white" />
                        </button>
                      </>
                    )}

                    {/* 左上角索引浮层 */}
                    {mediaFiles.length > 1 && (
                      <span className="absolute top-4 left-4 bg-black/50 text-white text-xs font-medium px-2.5 py-1 rounded-full backdrop-blur-sm z-10">
                        {currentIndex + 1} / {mediaFiles.length}
                      </span>
                    )}

                    {/* 底部缩略图条 */}
                    {mediaFiles.length > 1 && (
                      <div className="absolute bottom-0 left-0 right-0 flex gap-2 overflow-x-auto px-4 py-2 bg-black/40 opacity-0 group-hover:opacity-100 transition-all justify-center">
                        {mediaFiles.map((m, i) => (
                          <button
                            key={m.id}
                            onClick={() => setCurrentIndex(i)}
                            className={`shrink-0 w-12 h-12 rounded border overflow-hidden transition-all ${
                              i === currentIndex ? 'ring-2 ring-white' : 'opacity-50 hover:opacity-80'
                            }`}
                          >
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
                    )}
                  </>
                )}
              </div>

              {/* 右侧：信息 */}
              <div className="flex-[2] flex flex-col bg-white min-w-0">
                <div className="flex border-b border-slate-200 shrink-0">
                  <button
                    className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                      activeTab === 'content'
                        ? 'text-secondary border-b-2 border-secondary'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                    onClick={() => setActiveTab('content')}
                  >
                    文字内容
                  </button>
                  <button
                    className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                      activeTab === 'analysis'
                        ? 'text-secondary border-b-2 border-secondary'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}
                    onClick={() => setActiveTab('analysis')}
                  >
                    分析结果
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {activeTab === 'content' ? (
                    <div className="p-4">
                      <div className="space-y-4">
                        <div className="flex items-center gap-2">
                          <PlatformBadge platformId={post.platform_id} />
                          <span className="text-xs text-slate-400">{timeAgo(post.published_at || post.fetched_at)}</span>
                        </div>

                        {post.title && (
                          <h3 className="font-semibold text-sm text-slate-900">{post.title}</h3>
                        )}

                        {post.content && (
                          <p className="text-sm text-slate-600 whitespace-pre-wrap">{post.content}</p>
                        )}

                        <div className="flex items-center gap-4 text-xs text-slate-500 pt-2 border-t border-slate-100">
                          <span className="flex items-center gap-1">
                            <Heart className="h-3.5 w-3.5" />
                            {formatCount(post.like_count ?? 0)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Comment className="h-3.5 w-3.5" />
                            {formatCount(post.comment_count ?? 0)}
                          </span>
                          {post.collect_count > 0 && (
                            <span className="flex items-center gap-1">
                              <Bookmark className="h-3.5 w-3.5" />
                              {formatCount(post.collect_count)}
                            </span>
                          )}
                          {post.share_count > 0 && (
                            <span className="flex items-center gap-1">
                              <Eye className="h-3.5 w-3.5" />
                              {formatCount(post.share_count)}
                            </span>
                          )}
                        </div>

                        {post.url && (
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            查看原文
                            <icons.ArrowChevronRight className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="p-4">
                      <PostAnalysisDetail postId={post.id} />
                    </div>
                  )}
                </div>

                {/* 底部操作栏 */}
                <div className="shrink-0 border-t border-slate-200 p-3 flex items-center justify-between bg-white">
                  <button
                    onClick={() => onToggleStar(post.id, post.is_starred)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors hover:bg-slate-50"
                  >
                    <span className={post.is_starred ? 'text-yellow-500 text-lg' : 'text-gray-400 text-lg'}>
                      {post.is_starred ? '★' : '☆'}
                    </span>
                    <span className={post.is_starred ? 'text-slate-900' : 'text-slate-500'}>
                      {post.is_starred ? '已星标' : '星标'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function PostAnalysisDetail({ postId }: { postId: string }) {
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStrategy, setSelectedStrategy] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all([
      apiGet<AnalysisResult[]>(`/api/posts/${postId}/analysis`),
      apiGet<Strategy[]>('/api/strategies'),
    ])
      .then(([analysisData, strategyData]) => {
        if (cancelled) return;
        setResults(analysisData);
        setStrategies(strategyData);

        const grouped = analysisData.reduce<
          Record<string, AnalysisResult[]>
        >((acc, r) => {
          const key = r.strategy_name || r.strategy_id;
          if (!acc[key]) acc[key] = [];
          acc[key].push(r);
          return acc;
        }, {});
        const strategyNames = Object.keys(grouped);
        if (strategyNames.length > 0) {
          setSelectedStrategy(strategyNames[0]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResults([]);
          setStrategies([]);
        }
      })
      .finally(() => {
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

  if (results.length === 0) {
    return <p className="text-xs text-muted-foreground py-4">暂无分析结果</p>;
  }

  const grouped = results.reduce<Record<string, AnalysisResult[]>>((acc, r) => {
    const key = r.strategy_name || r.strategy_id;
    if (!acc[key]) acc[key] = [];
    acc[key].push(r);
    return acc;
  }, {});

  const strategyNames = Object.keys(grouped);
  const selectedResults = grouped[selectedStrategy] ?? [];
  const selectedStrategyObj = strategies.find(
    (s) =>
      s.name === selectedStrategy || s.id === selectedStrategy,
  );
  const outputSchema = selectedStrategyObj?.output_schema;

  return (
    <div className="space-y-4">
      <Select
        selectedKey={selectedStrategy}
        onSelectionChange={(key) => setSelectedStrategy(key as string)}
        className="w-full max-w-xs"
      >
        <Select.Trigger className="h-9 text-sm">
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {strategyNames.map((s) => (
              <ListBox.Item key={s} id={s}>
                {s}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <div className="space-y-3">
        {selectedResults.map((r, i) => (
          <div
            key={i}
            className="rounded-lg border bg-slate-50 p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] h-5 bg-white">
                {r.target_type}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {new Date(r.analyzed_at).toLocaleString('zh-CN')}
              </span>
            </div>
            {r.raw_response && outputSchema ? (
              <SchemaRenderer
                data={r.raw_response}
                schema={outputSchema}
              />
            ) : r.raw_response ? (
              <pre className="text-xs bg-white rounded p-3 overflow-x-auto border">
                {JSON.stringify(r.raw_response, null, 2)}
              </pre>
            ) : (
              <p className="text-xs text-muted-foreground">无数据</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PostSkeleton() {
  return (
    <Card>
      <Card.Content className="p-5 space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-24 mb-1" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <div className="flex items-center gap-4 pt-2 border-t border-slate-50">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-10" />
        </div>
      </Card.Content>
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
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [analyzingPostId, setAnalyzingPostId] = useState<string | null>(null);
  const [viewingMediaPostId, setViewingMediaPostId] = useState<string | null>(null);
  const [starredFilter, setStarredFilter] = useState(false);
  const analyzingPost = posts.find((p) => p.id === analyzingPostId) ?? null;
  const abortRef = useRef<AbortController | null>(null);
  const latestRef = useRef(0);

  const fetchPosts = useCallback(async (overridePage?: number) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const id = ++latestRef.current;

    const effectivePage = overridePage ?? page;
    setLoading(true);
    setError('');
    const offset = (effectivePage - 1) * PAGE_SIZE;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
    if (searchQuery.trim()) params.set('query', searchQuery.trim());
    if (selectedPlatform) params.set('platform', selectedPlatform);
    if (starredFilter) params.set('starred', 'true');
    try {
      const data = await apiGet<{ posts: Post[]; total: number }>(`/api/posts?${params}`, { signal: abortRef.current.signal });
      if (id !== latestRef.current) return;
      setPosts(data.posts);
      setTotal(data.total);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      if (id !== latestRef.current) return;
      setError(e instanceof Error ? e.message : '加载失败');
      setPosts([]);
    } finally {
      if (id === latestRef.current) {
        setLoading(false);
      }
    }
  }, [searchQuery, selectedPlatform, starredFilter, page]);

  const loadPosts = useCallback(() => {
    setPage(1);
    fetchPosts(1);
  }, [fetchPosts]);

  const toggleStar = useCallback(async (postId: string, currentStarred: boolean) => {
    await apiPost(`/api/posts/${postId}/star`, { starred: !currentStarred });
    await loadPosts();
  }, [loadPosts]);

  const addLabel = useCallback(async (postId: string, labelName: string) => {
    await apiPost(`/api/posts/${postId}/labels`, { label_name: labelName });
    await loadPosts();
  }, [loadPosts]);

  const removeLabel = useCallback(async (postId: string, labelId: string) => {
    await apiDelete(`/api/posts/${postId}/labels/${labelId}`);
    await loadPosts();
  }, [loadPosts]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

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
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPosts();
    }, searchQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [searchQuery, selectedPlatform, starredFilter, page, fetchPosts]);

  if (error && posts.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-3xl font-bold tracking-tight text-foreground">帖子库</h2>
        <div className="rounded-lg border border-danger/50 bg-danger/10 p-4 text-danger">
          <p className="font-medium">加载失败</p>
          <p className="text-sm mt-1">{error}</p>
          <Button variant="outline" size="sm" className="mt-2" onPress={() => fetchPosts()}>
            重试
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1440px]">
      {/* Page Header */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">帖子库</h2>
          <p className="text-sm text-on-surface-variant mt-1">
            {loading ? '加载中...' : `共 ${total} 条帖子`}
          </p>
        </div>
      </div>

      {/* Filters & Sorting Row */}
      <div className="flex gap-4 items-center">
        <Select
          selectedKey={selectedPlatform || '_all'}
          onSelectionChange={(key) => {
            setSelectedPlatform(key === '_all' ? null : (key as string));
            setPage(1);
          }}
          className="w-40"
        >
          <Select.Trigger className="h-9 text-sm">
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="_all">全部平台</ListBox.Item>
              {platforms.map((p) => (
                <ListBox.Item key={p.id} id={p.id}>
                  {getPlatformMeta(p.id).name}
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <Button
          variant={starredFilter ? 'primary' : 'outline'}
          size="sm"
          className="h-9"
          onPress={() => { setStarredFilter(!starredFilter); setPage(1); }}
        >
          <span className={starredFilter ? 'text-yellow-300' : 'text-yellow-500'}>&#9733;</span>
          星标
        </Button>
        <button className="flex items-center gap-2 px-4 py-2 bg-white border border-outline-variant rounded-lg text-sm font-medium text-on-surface-variant hover:bg-slate-50 transition-colors">
          <Sliders className="h-4 w-4" />
          更多筛选
        </button>
        <button className="flex items-center gap-2 px-4 py-2 bg-white border border-outline-variant rounded-lg text-sm font-medium text-on-surface-variant hover:bg-slate-50 transition-colors">
          <ArrowUpArrowDown className="h-4 w-4" />
          排序: 互动量
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-on-surface-variant uppercase tracking-wider font-semibold">视图:</span>
          <div className="flex bg-surface-container rounded-lg p-1">
            <button
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white shadow-sm text-secondary' : 'text-on-surface-variant hover:text-on-surface'}`}
              onClick={() => setViewMode('grid')}
            >
              <LayoutCellsLarge className="h-5 w-5" />
            </button>
            <button
              className={`p-1.5 rounded-md transition-colors ${viewMode === 'table' ? 'bg-white shadow-sm text-secondary' : 'text-on-surface-variant hover:text-on-surface'}`}
              onClick={() => setViewMode('table')}
            >
              <ListUl className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <PostSkeleton key={i} />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        )
      ) : posts.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-2">暂无匹配的帖子</p>
          {(searchQuery || selectedPlatform || starredFilter) && (
            <Button variant="ghost" size="sm" onPress={() => { setSearchQuery(''); setSelectedPlatform(null); setStarredFilter(false); }}>
              清除筛选条件
            </Button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => (
              <PostCard key={post.id} post={post} onAnalyze={setAnalyzingPostId} onViewMedia={setViewingMediaPostId} onToggleStar={toggleStar} onAddLabel={addLabel} onRemoveLabel={removeLabel} />
            ))}
          </div>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={(p) => { setPage(p); fetchPosts(p); }} />
        </>
      ) : (
        <>
          <DataTable aria-label="帖子列表">
            <TableHeader>
              <TableHead isRowHeader>星标</TableHead>
              <TableHead>平台</TableHead>
              <TableHead>作者</TableHead>
              <TableHead>标题</TableHead>
              <TableHead>标签</TableHead>
              <TableHead>互动</TableHead>
              <TableHead>发布时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableHeader>
            <TableBody>
              {posts.map((post) => (
                <TableRow key={post.id}>
                  <TableCell>
                    <button
                      onClick={() => toggleStar(post.id, post.is_starred)}
                      className="text-lg leading-none hover:scale-110 transition-transform"
                    >
                      <span className={post.is_starred ? 'text-yellow-500' : 'text-gray-400'}>{post.is_starred ? '★' : '☆'}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    <PlatformBadge platformId={post.platform_id} />
                  </TableCell>
                  <TableCell className="text-sm font-medium text-foreground">
                    {post.author_name || '匿名'}
                  </TableCell>
                  <TableCell className="text-sm text-foreground max-w-xs truncate">
                    {post.title || post.content?.slice(0, 60)}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="flex flex-wrap items-center gap-1">
                      {post.labels?.map((label) => (
                        <span key={label.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                          {label.name}
                          <button
                            onClick={() => removeLabel(post.id, label.id)}
                            className="ml-0.5 text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            x
                          </button>
                        </span>
                      ))}
                      <button
                        className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-dashed border-gray-300 text-gray-400 text-xs hover:border-gray-400 hover:text-gray-500 transition-colors shrink-0"
                        onClick={() => {
                          const name = window.prompt('Label name:');
                          if (name?.trim()) addLabel(post.id, name.trim());
                        }}
                      >
                        +
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    <span className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <Heart className="h-3 w-3" />
                        {formatCount(post.like_count ?? 0)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Comment className="h-3 w-3" />
                        {formatCount(post.comment_count ?? 0)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Bookmark className="h-3 w-3" />
                        {formatCount(post.collect_count ?? 0)}
                      </span>
                      {post.media_count ? (
                        <span className="flex items-center gap-1">
                          <Picture className="h-3 w-3" />
                          {formatCount(post.media_count)}
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    {timeAgo(post.published_at || post.fetched_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onPress={() => setAnalyzingPostId(post.id)}
                        isDisabled={!post.analysis_count}
                      >
                        <ChartBar className="h-3.5 w-3.5 mr-1" />
                        分析{post.analysis_count ? ` (${post.analysis_count})` : ''}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs"
                        onPress={() => setViewingMediaPostId(post.id)}
                        isDisabled={!post.media_count}
                      >
                        <Picture className="h-3.5 w-3.5 mr-1" />
                        媒体{post.media_count ? ` (${post.media_count})` : ''}
                      </Button>
                      <a
                        href={post.url ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline"
                      >
                        查看
                      </a>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </DataTable>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onChange={(p) => { setPage(p); fetchPosts(p); }} />
        </>
      )}

      {/* Analysis Modal */}
      {analyzingPost && (
        <Modal isOpen={true} onOpenChange={(open) => { if (!open) setAnalyzingPostId(null); }}>
          <Modal.Backdrop>
            <Modal.Container>
              <Modal.Dialog className="max-w-3xl max-h-[80vh]">
                <Modal.CloseTrigger />
                <Modal.Header>
                  <Modal.Heading>
                    <span className="flex items-center gap-2">
                      <PlatformBadge platformId={analyzingPost.platform_id} />
                      <span className="text-base font-semibold">{analyzingPost.author_name || '匿名用户'}</span>
                    </span>
                  </Modal.Heading>
                </Modal.Header>
                <Modal.Body className="overflow-y-auto">
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {analyzingPost.title || analyzingPost.content?.slice(0, 120)}
                  </p>
                  <PostAnalysisDetail postId={analyzingPost.id} />
                </Modal.Body>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      )}

      {/* Post Detail Modal */}
      {viewingMediaPostId && (
        <MediaFilesModal
          post={posts.find((p) => p.id === viewingMediaPostId)!}
          onClose={() => setViewingMediaPostId(null)}
          onToggleStar={toggleStar}
        />
      )}
    </div>
  );
}
