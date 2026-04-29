import * as icons from '@gravity-ui/icons';
import { Button } from '@/components/ui/button';

const ArrowChevronLeft = icons.ArrowChevronLeft;
const ArrowChevronRight = icons.ArrowChevronRight;

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

export default function Pagination({ page, pageSize, total, onChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between py-2">
      <p className="text-sm text-muted-foreground">
        共 {total} 条，第 {page}/{totalPages} 页
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
        >
          <ArrowChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
        >
          <ArrowChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
