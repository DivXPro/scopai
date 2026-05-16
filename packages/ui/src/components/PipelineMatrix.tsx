import { memo } from 'react';
import { PlatformIcon } from './PlatformIcon';

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
  completed: { icon: '✅', label: '完成' },
  done: { icon: '✅', label: '完成' },
  processing: { icon: '🔄', label: '进行中' },
  running: { icon: '🔄', label: '进行中' },
  pending: { icon: '⏳', label: '待开始' },
  fetching: { icon: '🔄', label: '获取中' },
  failed: { icon: '⚠️', label: '失败' },
};

function StatusCell({ status, onClick }: { status: string; onClick?: () => void }) {
  const cfg = statusConfig[status] ?? { icon: '⏳', label: '未知' };
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center justify-center text-base ${onClick ? 'cursor-pointer hover:opacity-70' : ''}`}
      title={cfg.label}
    >
      {cfg.icon}
    </button>
  );
}

export const PipelineMatrix = memo(function PipelineMatrix({
  columns,
  rows,
  onCellClick,
  onRowClick,
}: PipelineMatrixProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无数据</p>;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">执行矩阵</h3>
      <div className="rounded-xl border bg-card text-card-foreground shadow-sm overflow-auto">
        <table className="w-full text-sm" aria-label="Pipeline 矩阵">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 bg-background z-10 min-w-[200px] text-left font-medium text-muted-foreground px-4 py-3">
                  帖子
                </th>
                {columns.map((col) => (
                  <th key={col.key} className="text-center font-medium text-muted-foreground min-w-[100px] px-4 py-3">
                    {col.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.rowId} className="border-b last:border-b-0">
                  <td className="sticky left-0 bg-background z-10 px-4 py-3">
                    <button
                      onClick={onRowClick ? () => onRowClick(row.rowId) : undefined}
                      className={`flex items-center gap-2 text-left ${onRowClick ? 'cursor-pointer hover:opacity-70' : ''}`}
                    >
                      {row.platformId && (
                        <PlatformIcon platformId={row.platformId} size={16} />
                      )}
                      <span className="font-medium truncate max-w-[180px]">
                        {row.title || row.rowLabel}
                      </span>
                    </button>
                  </td>
                  {columns.map((col) => {
                    const cell = row.cells[col.key];
                    return (
                      <td key={col.key} className="text-center px-4 py-3">
                        <StatusCell
                          status={cell?.status ?? 'pending'}
                          onClick={onCellClick ? () => onCellClick(row.rowId, col.key) : undefined}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
      </div>
    </div>
  );
});
