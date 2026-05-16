import { memo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import * as icons from '@gravity-ui/icons';

export interface TimelinePhase {
  id: string;
  name: string;
  status: string;
  progress: number;
  total?: number;
  done?: number;
  stepOrder?: number;
}

interface TaskTimelineProps {
  phases: TimelinePhase[];
}

const statusColorMap: Record<string, string> = {
  pending: 'bg-muted',
  running: 'bg-primary animate-pulse',
  processing: 'bg-primary animate-pulse',
  completed: 'bg-success',
  done: 'bg-success',
  failed: 'bg-danger',
  paused: 'bg-warning',
  cancelled: 'bg-danger',
};

const CheckIcon = icons.Check;
const ExclamationIcon = icons.TriangleExclamation;

const statusIconMap: Record<string, React.ReactNode> = {
  pending: <span className="h-2 w-2 rounded-full bg-muted-foreground" />,
  running: <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />,
  processing: <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />,
  completed: <CheckIcon className="h-3 w-3 text-success-foreground" />,
  done: <CheckIcon className="h-3 w-3 text-success-foreground" />,
  failed: <ExclamationIcon className="h-3 w-3 text-danger-foreground" />,
};

export const TaskTimeline = memo(function TaskTimeline({ phases }: TaskTimelineProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">执行流程</h3>
      {phases.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无执行步骤</p>
      ) : (
        <ol className="space-y-0" aria-label="任务执行流程">
          {phases.map((phase, idx) => {
            const isLast = idx === phases.length - 1;
            const isFirst = idx === 0;
            const countText = phase.total !== undefined && phase.done !== undefined
              ? `${phase.done}/${phase.total}`
              : undefined;

            return (
              <li
                key={phase.id}
                className="relative flex items-stretch gap-3"
                aria-current={phase.status === 'running' || phase.status === 'processing' ? 'step' : undefined}
              >
                {/* 左侧：连接线 + 圆点 */}
                <div className="w-5 shrink-0 relative flex justify-center">
                  {/* 贯穿连接线 */}
                  <div
                    className={`absolute left-1/2 -translate-x-1/2 w-0.5 ${
                      isFirst && isLast ? 'bg-transparent' : 'bg-border'
                    }`}
                    style={{
                      top: isFirst ? '50%' : '0',
                      bottom: isLast ? '50%' : '0',
                    }}
                  />

                  {/* 状态圆点 — 绝对定位在垂直中心 */}
                  <div
                    className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-5 w-5 rounded-full border-2 border-background flex items-center justify-center z-10 ${statusColorMap[phase.status] ?? 'bg-muted'}`}
                  >
                    {statusIconMap[phase.status] ?? null}
                  </div>
                </div>

                {/* 右侧：卡片 */}
                <div className="flex-1 pb-4">
                  <Card>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 min-w-0">
                          {phase.stepOrder !== undefined && (
                            <span className="text-xs font-medium text-muted-foreground shrink-0">步骤 {phase.stepOrder}</span>
                          )}
                          <span className="font-semibold text-foreground min-w-0 truncate">{phase.name}</span>
                          <Badge
                            variant={
                              phase.status === 'completed' || phase.status === 'done'
                                ? 'success'
                                : phase.status === 'failed'
                                  ? 'destructive'
                                  : phase.status === 'running' || phase.status === 'processing'
                                    ? 'default'
                                    : 'outline'
                            }
                            size="sm"
                          >
                            {phase.status}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {countText && (
                            <span className="text-xs text-muted-foreground tabular-nums">{countText}</span>
                          )}
                          <div className="w-32">
                            <Progress value={phase.progress} size="sm" showValueLabel />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
});
