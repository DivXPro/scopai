import { memo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export interface StrategyStat {
  strategyId: string;
  strategyName: string;
  applicableCount: number;
  doneCount: number;
  processingCount: number;
  failedCount: number;
}

interface StrategyStatsProps {
  stats: StrategyStat[];
}

export const StrategyStats = memo(function StrategyStats({ stats }: StrategyStatsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">策略覆盖统计</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>策略</TableHead>
              <TableHead className="text-right">适用</TableHead>
              <TableHead className="text-right">已完成</TableHead>
              <TableHead className="text-right">进行中</TableHead>
              <TableHead className="text-right">失败</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.map((s) => (
              <TableRow key={s.strategyId}>
                <TableCell className="font-medium">{s.strategyName}</TableCell>
                <TableCell className="text-right">{s.applicableCount}</TableCell>
                <TableCell className="text-right text-success">{s.doneCount}</TableCell>
                <TableCell className="text-right text-primary">{s.processingCount}</TableCell>
                <TableCell className="text-right text-danger">{s.failedCount}</TableCell>
              </TableRow>
            ))}
            {stats.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground py-4">
                  暂无策略数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
});
