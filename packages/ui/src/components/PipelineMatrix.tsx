import { memo, Suspense } from "react";
import { PlatformIcon } from "./PlatformIcon";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface MatrixColumn {
  key: string;
  name: string;
}

export interface MatrixRow {
  rowId: string;
  rowLabel: string;
  title?: string | null;
  platformId?: string;
  cells: Record<string, { status: string }>;
}

interface PipelineMatrixProps {
  columns: MatrixColumn[];
  rows: MatrixRow[];
  onCellClick?: (rowId: string, colKey: string) => void;
  onRowClick?: (rowId: string) => void;
}

const statusConfig: Record<string, { text: string; classes: string }> = {
  completed: { text: "完成", classes: "bg-green-50 text-green-700 border-green-100" },
  done: { text: "完成", classes: "bg-green-50 text-green-700 border-green-100" },
  routed: { text: "已路由", classes: "bg-green-50 text-green-700 border-green-100" },
  skipped: { text: "跳过", classes: "bg-slate-50 text-slate-500 border-slate-200" },
  processing: { text: "进行中", classes: "bg-blue-50 text-blue-700 border-blue-100" },
  running: { text: "进行中", classes: "bg-blue-50 text-blue-700 border-blue-100" },
  pending: { text: "待开始", classes: "bg-amber-50 text-amber-700 border-amber-100" },
  fetching: { text: "获取中", classes: "bg-blue-50 text-blue-700 border-blue-100" },
  failed: { text: "失败", classes: "bg-red-50 text-red-700 border-red-100" },
};

function StatusCell({
  status,
  onClick,
}: {
  status: string;
  onClick?: () => void;
}) {
  const cfg = statusConfig[status] ?? { text: "未知", classes: "bg-slate-50 text-slate-500 border-slate-200" };
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border ${cfg.classes} ${onClick ? "cursor-pointer hover:opacity-70" : ""}`}
    >
      {cfg.text}
    </button>
  );
}

function MatrixTable({
  columns,
  rows,
  onCellClick,
  onRowClick,
}: PipelineMatrixProps) {
  return (
    <Table aria-label="相关帖子">
      <TableHeader>
        <TableHead isRowHeader>平台</TableHead>
        <TableHead className="min-w-30">帖子</TableHead>
        {columns.map((col) => (
          <TableHead key={col.key} className="text-center min-w-20">
            {col.name}
          </TableHead>
        ))}
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.rowId}>
            <TableCell>
              {row.platformId && (
                <PlatformIcon platformId={row.platformId} size={16} />
              )}
            </TableCell>
            <TableCell>
              <span
                className="font-medium truncate cursor-pointer"
                onClick={onRowClick ? () => onRowClick(row.rowId) : undefined}
              >
                {row.title || row.rowLabel}
              </span>
            </TableCell>
            {columns.map((col) => {
              const cell = row.cells[col.key];
              return (
                <TableCell key={col.key} className="text-center">
                  <StatusCell
                    status={cell?.status ?? "pending"}
                    onClick={
                      onCellClick
                        ? () => onCellClick(row.rowId, col.key)
                        : undefined
                    }
                  />
                </TableCell>
              );
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export const PipelineMatrix = memo(function PipelineMatrix(
  props: PipelineMatrixProps,
) {
  const { rows } = props;
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无数据</p>;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">相关帖子</h3>
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-auto">
        <Suspense
          fallback={
            <div className="p-4 text-sm text-muted-foreground">加载中…</div>
          }
        >
          <MatrixTable {...props} />
        </Suspense>
      </div>
    </div>
  );
});
