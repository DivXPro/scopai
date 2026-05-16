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
      <div className="relative pl-6 space-y-4">
        <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-border" />

        {phases.map((phase) => (
          <div key={phase.id} className="relative">
            <div
              className={`absolute -left-6 top-1 h-5 w-5 rounded-full border-2 border-background flex items-center justify-center ${statusColorMap[phase.status] ?? 'bg-muted'}`}
            >
              {statusIconMap[phase.status] ?? null}
            </div>

            <Card className="ml-2">
              <CardContent className="p-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    {phase.stepOrder !== undefined && (
                      <span className="text-xs font-medium text-muted-foreground">步骤 {phase.stepOrder}</span>
                    )}
                    <span className="font-semibold text-foreground">{phase.name}</span>
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
                  <div className="w-32">
                    <Progress value={phase.progress} size="sm" showValueLabel />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
});
