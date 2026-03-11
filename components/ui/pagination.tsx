"use client";

import { Button } from "@/components/ui/button";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** Number of page buttons to show on each side of the current page. Defaults to 2. */
  siblingCount?: number;
}

/**
 * Builds a list of page numbers and ellipsis markers for pagination display.
 * Always includes the first page, last page, and `siblingCount` pages
 * on either side of the current page. Gaps are filled with "..." markers.
 */
function buildPageRange(
  currentPage: number,
  totalPages: number,
  siblingCount: number
): (number | "...")[] {
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  const visible = pages.filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= siblingCount
  );

  return visible.reduce<(number | "...")[]>((acc, p, i, arr) => {
    if (i > 0 && p - (arr[i - 1] ?? 0) > 1) {
      acc.push("...");
    }
    acc.push(p);
    return acc;
  }, []);
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  siblingCount = 2,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const items = buildPageRange(currentPage, totalPages, siblingCount);

  return (
    <div className="flex items-center justify-between pt-2">
      <p className="text-sm text-muted-foreground">
        Page {currentPage} of {totalPages}
      </p>
      <nav className="flex items-center gap-1" aria-label="Pagination">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
          aria-label="Go to previous page"
        >
          Previous
        </Button>
        {items.map((item, i) =>
          item === "..." ? (
            <span
              key={`ellipsis-${i}`}
              className="px-2 text-sm text-muted-foreground select-none"
              aria-hidden="true"
            >
              ...
            </span>
          ) : (
            <Button
              key={item}
              variant={item === currentPage ? "default" : "outline"}
              size="sm"
              className="w-9"
              onClick={() => onPageChange(item as number)}
              aria-label={`Go to page ${item}`}
              aria-current={item === currentPage ? "page" : undefined}
            >
              {item}
            </Button>
          )
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
          aria-label="Go to next page"
        >
          Next
        </Button>
      </nav>
    </div>
  );
}
