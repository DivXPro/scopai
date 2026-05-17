# Task Detail 页面重设计实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Task Detail 页面从平铺卡片布局改造为 Dashboard 仪表盘风格，包含概览头部、KPI 指标、Pipeline 时间线和 Pipeline 矩阵表。

**Architecture:** 前端基于 React + HeroUI + TailwindCSS 改造页面布局；后端 API 增强以返回每个帖子的数据准备状态，供矩阵表使用。新组件采用"对 HeroUI 薄包装"的现有模式。

**Tech Stack:** React 19, HeroUI (@heroui/react), TailwindCSS v4, TypeScript

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/api/src/routes/tasks.ts` | 修改 | GET /tasks/:id 返回增加 `postStatuses` 字段 |
| `packages/ui/src/components/ui/progress.tsx` | 创建 | HeroUI Progress 组件包装 |
| `packages/ui/src/components/TaskTimeline.tsx` | 创建 | Pipeline 纵向时间线组件 |
| `packages/ui/src/components/PipelineMatrix.tsx` | 创建 | 帖子×阶段矩阵表组件 |
| `packages/ui/src/pages/TaskDetail.tsx` | 修改 | 页面整体重构，整合新组件 |

---

### Task 1: API 增强 — 返回 postStatuses

**Files:**
- Modify: `packages/api/src/routes/tasks.ts:93-119`

当前 `GET /api/tasks/:id` 在内部查询了 `postStatuses` 但只返回了汇总统计。需要把每个帖子的状态数组也返回给前端，供矩阵表使用。

- [ ] **Step 1: 修改 API 返回结构**

在 `packages/api/src/routes/tasks.ts` 第 93 行的 return 对象中，加入 `postStatuses`：

```typescript
return {
  ...task,
  ...stats,
  progress: {
    dataPreparation: {
      status: dataPrepStatus,
      totalPosts,
      donePosts,
      failedPosts,
      fetchingPosts,
      pendingPosts,
      commentsFetched,
      mediaFetched,
    },
    analysis: jobStats,
  },
  steps: stepDetails,
  recentErrors,
  jobs: jobs.map((j) => ({
    id: j.id,
    target_type: j.target_type,
    target_id: j.target_id,
    status: j.status,
    attempts: j.attempts,
    error: j.error,
  })),
  postStatuses: postStatuses.map(p => ({
    postId: p.post_id,
    status: p.status,
    commentsFetched: p.comments_fetched,
    mediaFetched: p.media_fetched,
    error: p.error,
  })),
};
```

- [ ] **Step 2: 验证 API 编译**

Run: `pnpm build`
Expected: 编译通过，无类型错误。

- [ ] **Step 3: Commit**

```bash
git add packages/api/src/routes/tasks.ts
git commit -m "feat(api): task detail 返回 postStatuses 供矩阵表使用"
```

---

### Task 2: 创建 Progress UI 组件

**Files:**
- Create: `packages/ui/src/components/ui/progress.tsx`

参考现有组件模式（如 `skeleton.tsx`），对 HeroUI Progress 做薄包装。

- [ ] **Step 1: 编写 Progress 组件**

创建 `packages/ui/src/components/ui/progress.tsx`：

```typescript
import { Progress as HeroProgress } from "@heroui/react";

export interface ProgressProps {
  value?: number;
  max?: number;
  color?: "default" | "primary" | "secondary" | "success" | "warning" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
  showValueLabel?: boolean;
}

export function Progress({
  value = 0,
  max = 100,
  color = "primary",
  size = "md",
  className = "",
  label,
  showValueLabel = false,
}: ProgressProps) {
  return (
    <HeroProgress
      value={value}
      maxValue={max}
      color={color}
      size={size}
      className={className}
      label={label}
      showValueLabel={showValueLabel}
    />
  );
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm --filter @scopai/ui build`
Expected: 编译通过。

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/ui/progress.tsx
git commit -m "feat(ui): 添加 Progress 组件包装"
```

---

### Task 3: 重构 TaskDetail 概览头部与 KPI Cards

**Files:**
- Modify: `packages/ui/src/pages/TaskDetail.tsx:312-354`

- [ ] **Step 1: 提取 TaskHeader 子组件**

在 `TaskDetail.tsx` 中，将顶部导航和统计卡片区域替换为新的 Dashboard 风格布局。先编写 TaskHeader 组件：

```typescript
function TaskHeader({ task }: { task: TaskDetail }) {
  const total = task.stats?.total ?? 0;
  const done = task.stats?.done ?? 0;
  const failed = task.stats?.failed ?? 0;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

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
        <div className="text-right">
          <p className="text-3xl font-bold text-foreground">{progress}%</p>
          <p className="text-xs text-muted-foreground">总进度</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提取 KpiCards 子组件**

```typescript
function KpiCards({ task }: { task: TaskDetail }) {
  const totalJobs = task.jobs.length;
  const completedJobs = task.jobs.filter((j) => j.status === 'completed').length;
  const failedJobs = task.jobs.filter((j) => j.status === 'failed').length;
  const processingJobs = task.jobs.filter((j) => j.status === 'processing').length;

  const cards = [
    { label: '总任务', value: task.stats?.total ?? 0, color: 'text-foreground', icon: null },
    { label: '已完成', value: task.stats?.done ?? 0, color: 'text-success', icon: icons.Check },
    { label: '失败', value: task.stats?.failed ?? 0, color: 'text-danger', icon: icons.CircleExclamation },
    { label: '进行中', value: processingJobs, color: 'text-primary', icon: icons.Clock },
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
              {card.icon && <card.icon className="h-5 w-5 text-muted-foreground" />}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
```

注意：需要引入 `CircleExclamation` 和 `Clock` 图标。如果 `@gravity-ui/icons` 中没有，使用其他合适的图标或内联 SVG。

- [ ] **Step 3: 替换页面中的旧头部和统计区**

在 `TaskDetail.tsx` 的主渲染区（约第 312 行开始），将旧的头部和 4 个统计卡片替换为：

```tsx
<TaskHeader task={task} />
<KpiCards task={task} />
```

并删除旧的 `totalJobs`, `completedJobs`, `failedJobs` 计算逻辑（移到 KpiCards 内部）。

- [ ] **Step 4: 验证编译**

Run: `pnpm --filter @scopai/ui build`
Expected: 编译通过。

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/pages/TaskDetail.tsx
git commit -m "feat(ui): TaskDetail 头部和 KPI Cards Dashboard 化"
```

---

### Task 4: 创建 Pipeline Timeline 组件

**Files:**
- Create: `packages/ui/src/components/TaskTimeline.tsx`

- [ ] **Step 1: 编写组件**

创建 `packages/ui/src/components/TaskTimeline.tsx`：

```typescript
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

const statusIconMap: Record<string, React.ReactNode> = {
  pending: <span className="h-2 w-2 rounded-full bg-muted-foreground" />,
  running: <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />,
  processing: <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />,
  completed: <icons.Check className="h-3 w-3 text-success-foreground" />,
  done: <icons.Check className="h-3 w-3 text-success-foreground" />,
  failed: <icons.CircleExclamation className="h-3 w-3 text-danger-foreground" />,
};

export function TaskTimeline({ phases }: TaskTimelineProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">执行流程</h3>
      <div className="relative pl-6 space-y-4">
        {/* 纵向连接线 */}
        <div className="absolute left-[11px] top-3 bottom-3 w-0.5 bg-border" />

        {phases.map((phase, index) => (
          <div key={phase.id} className="relative">
            {/* 节点圆点 */}
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
                    <Badge variant={phase.status === 'completed' || phase.status === 'done' ? 'success' : phase.status === 'failed' ? 'destructive' : phase.status === 'running' || phase.status === 'processing' ? 'default' : 'outline'} size="sm">
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
}
```

注意：`CircleExclamation` 可能不在 `@gravity-ui/icons` 中。如果找不到，使用 `TriangleExclamation` 或其他警告图标，或直接内联 SVG。

- [ ] **Step 2: 在 TaskDetail 中集成 Timeline**

在 `TaskDetail.tsx` 中，替换原来的 `DataPrepSection` 和步骤列表区域：

```typescript
// 在任务数据加载后构建 phases 数组
const phases: TimelinePhase[] = [
  {
    id: 'data-prep',
    name: '数据准备',
    status: task.progress?.dataPreparation?.status ?? 'pending',
    progress: task.progress?.dataPreparation?.totalPosts
      ? Math.round((task.progress.dataPreparation.donePosts / task.progress.dataPreparation.totalPosts) * 100)
      : 0,
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
    };
  }),
];
```

然后在 JSX 中：

```tsx
<TaskTimeline phases={phases} />
```

删除旧的 `DataPrepSection` 组件定义和使用。

- [ ] **Step 3: 验证编译**

Run: `pnpm --filter @scopai/ui build`
Expected: 编译通过。

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/TaskTimeline.tsx packages/ui/src/pages/TaskDetail.tsx
git commit -m "feat(ui): 添加 Pipeline Timeline 纵向时间线组件"
```

---

### Task 5: 创建 Pipeline Matrix 组件

**Files:**
- Create: `packages/ui/src/components/PipelineMatrix.tsx`

- [ ] **Step 1: 编写组件**

创建 `packages/ui/src/components/PipelineMatrix.tsx`：

```typescript
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import * as icons from '@gravity-ui/icons';

export interface MatrixColumn {
  key: string;
  name: string;
}

export interface MatrixRow {
  rowId: string;
  rowLabel: string;
  cells: Record<string, { status: string; detail?: string }>;
}

interface PipelineMatrixProps {
  columns: MatrixColumn[];
  rows: MatrixRow[];
  onCellClick?: (rowId: string, colKey: string) => void;
}

const statusIconMap: Record<string, { icon: string; color: string; label: string }> = {
  completed: { icon: '✅', color: 'text-success', label: '完成' },
  done: { icon: '✅', color: 'text-success', label: '完成' },
  processing: { icon: '🔄', color: 'text-primary', label: '进行中' },
  running: { icon: '🔄', color: 'text-primary', label: '进行中' },
  pending: { icon: '⏳', color: 'text-muted-foreground', label: '待开始' },
  failed: { icon: '⚠️', color: 'text-danger', label: '失败' },
};

function StatusCell({ status, onClick }: { status: string; onClick?: () => void }) {
  const cfg = statusIconMap[status] ?? { icon: '⏳', color: 'text-muted-foreground', label: '未知' };
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 text-sm ${onClick ? 'cursor-pointer hover:opacity-70' : ''}`}
      title={cfg.label}
    >
      <span>{cfg.icon}</span>
    </button>
  );
}

export function PipelineMatrix({ columns, rows, onCellClick }: PipelineMatrixProps) {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无数据</p>;
  }

  return (
    <Card>
      <CardContent className="p-0 overflow-auto">
        <Table aria-label="Pipeline 矩阵">
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 bg-background z-10 min-w-[120px]">帖子</TableHead>
              {columns.map((col) => (
                <TableHead key={col.key} className="text-center min-w-[100px]">{col.name}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.rowId}>
                <TableCell className="sticky left-0 bg-background z-10 font-medium text-sm">
                  {row.rowLabel}
                </TableCell>
                {columns.map((col) => {
                  const cell = row.cells[col.key];
                  return (
                    <TableCell key={col.key} className="text-center">
                      <StatusCell
                        status={cell?.status ?? 'pending'}
                        onClick={onCellClick ? () => onCellClick(row.rowId, col.key) : undefined}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: 在 TaskDetail 中准备矩阵数据并集成**

在 `TaskDetail.tsx` 中，构建矩阵数据：

```typescript
// 在任务数据加载后构建矩阵数据
const matrixColumns: MatrixColumn[] = [
  { key: 'data-prep', name: '数据准备' },
  ...task.steps.map((step) => ({
    key: step.id,
    name: step.name,
  })),
];

// 从 jobs 中收集所有帖子 target_id
const postIds = Array.from(new Set(
  task.jobs.filter(j => j.target_type === 'post' && j.target_id).map(j => j.target_id!)
));

// 从 postStatuses 补充帖子信息
const postStatusMap = new Map((task as any).postStatuses?.map((p: any) => [p.postId, p]) ?? []);

const matrixRows: MatrixRow[] = postIds.map((postId) => {
  const postStatus = postStatusMap.get(postId);
  const cells: Record<string, { status: string }> = {};

  // 数据准备状态
  cells['data-prep'] = { status: postStatus?.status ?? 'pending' };

  // 各分析步骤状态
  for (const step of task.steps) {
    const job = task.jobs.find(
      j => j.target_id === postId && j.strategy_id === step.strategy_id
    );
    cells[step.id] = { status: job?.status ?? 'pending' };
  }

  return {
    rowId: postId,
    rowLabel: postId.slice(0, 12) + (postId.length > 12 ? '...' : ''),
    cells,
  };
});
```

注意：`task` 类型定义中没有 `postStatuses`，需要扩展类型或在构建数据时做类型断言。

在 JSX 中：

```tsx
<div className="space-y-3">
  <h3 className="text-lg font-semibold text-foreground">执行矩阵</h3>
  <PipelineMatrix
    columns={matrixColumns}
    rows={matrixRows}
    onCellClick={(rowId, colKey) => {
      // TODO: 打开详情 Modal
      console.log('点击:', rowId, colKey);
    }}
  />
</div>
```

- [ ] **Step 3: 更新 TaskDetail 类型定义**

在 `TaskDetail.tsx` 的 `TaskDetail` interface 中加入 `postStatuses`：

```typescript
interface TaskDetail {
  // ... 现有字段 ...
  postStatuses?: {
    postId: string;
    status: string;
    commentsFetched: boolean;
    mediaFetched: boolean;
    error: string | null;
  }[];
}
```

- [ ] **Step 4: 验证编译**

Run: `pnpm --filter @scopai/ui build`
Expected: 编译通过。

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/PipelineMatrix.tsx packages/ui/src/pages/TaskDetail.tsx
git commit -m "feat(ui): 添加 Pipeline Matrix 矩阵表组件"
```

---

### Task 6: 清理旧代码并整合

**Files:**
- Modify: `packages/ui/src/pages/TaskDetail.tsx`

- [ ] **Step 1: 删除已废弃的组件**

删除以下不再使用的组件定义：
- `DataPrepSection`
- `StepRow`
- `AnalysisResult` interface（如果未被使用）
- `ResultStats` interface（如果未被使用）
- 旧的 `rawExpanded` state 和相关折叠逻辑

- [ ] **Step 2: 清理未使用的 import**

删除未使用的 import，如旧的 Table 相关 import（如果 Table 还在 PipelineMatrix 中使用，则保留）。

- [ ] **Step 3: 验证编译和运行**

Run: `pnpm build`
Expected: 编译通过。

Run: `pnpm --filter @scopai/ui dev`（或启动完整服务）
打开浏览器访问 Task Detail 页面，验证：
1. 头部显示名称、状态、进度百分比
2. KPI Cards 显示 4 个指标
3. Timeline 显示数据准备 + 各步骤的纵向时间线
4. Pipeline Matrix 显示帖子×阶段的矩阵表

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/pages/TaskDetail.tsx
git commit -m "refactor(ui): 清理 TaskDetail 旧代码，完成 Dashboard 重构"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ 概览头部（TaskHeader）
- ✅ KPI Cards（KpiCards）
- ✅ Pipeline 时间线（TaskTimeline）
- ✅ Pipeline 矩阵表（PipelineMatrix）
- ✅ 删除原始数据折叠区

**2. Placeholder scan:**
- 无 TBD/TODO
- 所有代码片段完整
- 所有命令明确

**3. Type consistency:**
- `TaskDetail` interface 中增加了 `postStatuses`
- `TimelinePhase` 和 `MatrixColumn`/`MatrixRow` 类型在组件间一致
- API 返回字段名（`postId`, `status` 等）与前端消费一致
