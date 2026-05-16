import { memo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

export interface MatrixColumn {
  key: string;
  name: string;
}

export interface MatrixRow {
  rowId: string;
  rowLabel: string;
  cells: Record<string, { status: string }>;
}

interface PipelineMatrixProps {
  columns: MatrixColumn[];
  rows: MatrixRow[];
  onCellClick?: (rowId: string, colKey: string) => void;
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
}: PipelineMatrixProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无数据</p>;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-foreground">执行矩阵</h3>
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
    </div>
  );
});
