import { Pagination as HeroUIPagination } from '@heroui/react';
import { ArrowChevronLeft, ArrowChevronRight } from '@gravity-ui/icons';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

export default function Pagination({ page, pageSize, total, onChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

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
    <HeroUIPagination>
      <HeroUIPagination.Content>
        <HeroUIPagination.Item>
          <HeroUIPagination.Previous
            onPress={() => onChange(page - 1)}
            isDisabled={page <= 1}
          >
            <ArrowChevronLeft className="h-4 w-4" />
          </HeroUIPagination.Previous>
        </HeroUIPagination.Item>
        {getVisiblePages().map((p, i) =>
          p === 'ellipsis' ? (
            <HeroUIPagination.Item key={`ellipsis-${i}`}>
              <HeroUIPagination.Ellipsis />
            </HeroUIPagination.Item>
          ) : (
            <HeroUIPagination.Item key={p}>
              <HeroUIPagination.Link
                isActive={p === page}
                onPress={() => onChange(p)}
              >
                {p}
              </HeroUIPagination.Link>
            </HeroUIPagination.Item>
          )
        )}
        <HeroUIPagination.Item>
          <HeroUIPagination.Next
            onPress={() => onChange(page + 1)}
            isDisabled={page >= totalPages}
          >
            <ArrowChevronRight className="h-4 w-4" />
          </HeroUIPagination.Next>
        </HeroUIPagination.Item>
      </HeroUIPagination.Content>
    </HeroUIPagination>
  );
}
