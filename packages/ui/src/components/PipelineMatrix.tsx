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

const statusConfig: Record<string, { icon: string; label: string }> = {
  completed: { icon: "✅", label: "完成" },
  done: { icon: "✅", label: "完成" },
  processing: { icon: "🔄", label: "进行中" },
  running: { icon: "🔄", label: "进行中" },
  pending: { icon: "⏳", label: "待开始" },
  fetching: { icon: "🔄", label: "获取中" },
  failed: { icon: "⚠️", label: "失败" },
};

function StatusCell({
  status,
  onClick,
}: {
  status: string;
  onClick?: () => void;
}) {
  const cfg = statusConfig[status] ?? { icon: "⏳", label: "未知" };
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center text-base ${onClick ? "cursor-pointer hover:opacity-70" : ""}`}
      title={cfg.label}
    >
      {cfg.icon}
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
