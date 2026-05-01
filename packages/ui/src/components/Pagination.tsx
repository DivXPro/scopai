import * as icons from '@gravity-ui/icons';

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

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const getVisiblePages = (): (number | 'ellipsis')[] => {
    const pages: (number | 'ellipsis')[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (page > 3) pages.push('ellipsis');
      const rangeStart = Math.max(2, page - 1);
      const rangeEnd = Math.min(totalPages - 1, page + 1);
      for (let i = rangeStart; i <= rangeEnd; i++) pages.push(i);
      if (page < totalPages - 2) pages.push('ellipsis');
      pages.push(totalPages);
    }
    return pages;
  };

  return (
    <div className="flex items-center justify-between border-t border-outline-variant pt-8 mt-12">
      <span className="text-sm text-on-surface-variant font-medium">
        显示 {start} 到 {end}，共 {total} 条帖子
      </span>
      <div className="flex gap-2">
        <button
          className="w-10 h-10 rounded-lg border border-outline-variant flex items-center justify-center hover:bg-white hover:shadow-sm text-on-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
        >
          <ArrowChevronLeft className="h-4 w-4" />
        </button>
        {getVisiblePages().map((p, i) =>
          p === 'ellipsis' ? (
            <span key={`ellipsis-${i}`} className="w-10 h-10 flex items-center justify-center text-slate-400">
              ...
            </span>
          ) : (
            <button
              key={p}
              className={`w-10 h-10 rounded-lg flex items-center justify-center font-medium transition-all ${
                p === page
                  ? 'bg-secondary text-white shadow-md'
                  : 'border border-outline-variant hover:bg-white hover:shadow-sm text-on-surface-variant'
              }`}
              onClick={() => onChange(p)}
            >
              {p}
            </button>
          )
        )}
        <button
          className="w-10 h-10 rounded-lg border border-outline-variant flex items-center justify-center hover:bg-white hover:shadow-sm text-on-surface-variant disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
        >
          <ArrowChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
