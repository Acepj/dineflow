"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

type PaginationProps = {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
};

/**
 * Pagination footer: rows-per-page selector, range summary and first / prev /
 * next / last controls. The parent clamps the page when filters change.
 */
export function ReservationsPagination({
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const safePageCount = Math.max(1, pageCount);
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);

  return (
    <div className="res-pagination">
      <div className="res-pagination-info">
        <span>
          {total === 0
            ? "No reservations"
            : `Showing ${firstRow}–${lastRow} of ${total.toLocaleString("en-US")}`}
        </span>
        <label className="res-page-size">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            aria-label="Rows per page"
          >
            {[10, 25, 50].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="res-pagination-controls">
        <button
          type="button"
          className="res-page-btn"
          onClick={() => onPageChange(1)}
          disabled={page <= 1}
          aria-label="First page"
          title="First page"
        >
          <ChevronsLeft size={15} />
        </button>
        <button
          type="button"
          className="res-page-btn"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          title="Previous page"
        >
          <ChevronLeft size={15} />
        </button>
        <span className="res-page-indicator" aria-live="polite">
          Page {page} of {safePageCount}
        </span>
        <button
          type="button"
          className="res-page-btn"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= safePageCount}
          aria-label="Next page"
          title="Next page"
        >
          <ChevronRight size={15} />
        </button>
        <button
          type="button"
          className="res-page-btn"
          onClick={() => onPageChange(safePageCount)}
          disabled={page >= safePageCount}
          aria-label="Last page"
          title="Last page"
        >
          <ChevronsRight size={15} />
        </button>
      </div>
    </div>
  );
}
