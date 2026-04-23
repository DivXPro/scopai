import { useEffect, useState } from 'react';
import { Target, Trash2, FileJson, AlertTriangle } from 'lucide-react';
import { apiGet, apiDelete } from '@/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface Strategy {
  id: string;
  name: string;
  description: string | null;
  version: string;
  target: 'post' | 'comment';
  needs_media: { enabled: boolean } | null;
  prompt: string;
  output_schema: Record<string, unknown>;
  batch_config: { enabled: boolean; size?: number } | null;
  depends_on: 'post' | 'comment' | null;
  include_original: boolean;
  created_at: string;
  updated_at: string;
}

function SchemaPreview({ schema }: { schema: Record<string, unknown> }) {
  const props = (schema.properties ?? {}) as Record<string, Record<string, string>>;
  if (!props || Object.keys(props).length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(props).map(([name, def]) => (
        <Badge key={name} variant="secondary" className="text-[10px] h-5 font-mono">
          {name}:{def.type ?? '?'}
        </Badge>
      ))}
    </div>
  );
}

export default function Strategies() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const fetchStrategies = () => {
    setLoading(true);
    apiGet<Strategy[]>('/api/strategies')
      .then(setStrategies)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStrategies();
  }, []);

  const handleDelete = async (id: string) => {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setDeleting(id);
    try {
      await apiDelete(`/api/strategies/${id}`);
      setStrategies((prev) => prev.filter((s) => s.id !== id));
    } finally {
      setDeleting(null);
      setConfirmDelete(null);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">策略管理</h2>
        <p className="text-sm text-muted-foreground">{strategies.length} 个策略</p>
      </div>

      {strategies.length === 0 ? (
        <div className="text-center py-12">
          <Target className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground">暂无策略</p>
          <p className="text-xs text-muted-foreground mt-1">通过 CLI 导入策略后在此查看</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {strategies.map((s) => (
            <Card key={s.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 flex-1">
                    <CardTitle className="text-base">{s.name}</CardTitle>
                    <div className="flex items-center gap-2">
                      <Badge variant={s.target === 'post' ? 'default' : 'secondary'}>
                        {s.target === 'post' ? '帖子' : '评论'}
                      </Badge>
                      <Badge variant="outline" className="text-xs">v{s.version}</Badge>
                      {s.batch_config?.enabled && (
                        <Badge variant="outline" className="text-xs">
                          批量 ×{s.batch_config.size ?? 10}
                        </Badge>
                      )}
                      {s.depends_on && (
                        <Badge variant="outline" className="text-xs">
                          依赖: {s.depends_on === 'post' ? '帖子' : '评论'}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => handleDelete(s.id)}
                    disabled={deleting === s.id}
                  >
                    {confirmDelete === s.id ? (
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {s.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">{s.description}</p>
                )}

                {/* 输出 schema */}
                <div className="space-y-1">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <FileJson className="h-3 w-3" />
                    输出字段
                  </div>
                  <SchemaPreview schema={s.output_schema} />
                </div>

                {/* Prompt 预览 */}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Prompt</p>
                  <p className="text-xs bg-muted rounded p-2 line-clamp-3 font-mono">
                    {s.prompt}
                  </p>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    创建于 {new Date(s.created_at).toLocaleDateString('zh-CN')}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground">{s.id}</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
