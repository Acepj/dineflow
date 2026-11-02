import {
  AlertCircle,
  CalendarDays,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from "lucide-react";

/** Skeleton placeholder rows shown while reservations load. */
export function ReservationsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="res-table-wrap"
      role="status"
      aria-live="polite"
      aria-label="Loading reservations"
    >
      <div className="res-table res-table-loading" aria-hidden="true">
        {Array.from({ length: rows }).map((_, index) => (
          <div className="res-skeleton-row" key={index}>
            <span className="res-skeleton" style={{ width: "70%" }} />
            <span className="res-skeleton" style={{ width: "85%" }} />
            <span className="res-skeleton" style={{ width: "75%" }} />
            <span className="res-skeleton" style={{ width: "45%" }} />
            <span className="res-skeleton" style={{ width: "70%" }} />
            <span className="res-skeleton" style={{ width: "60%" }} />
            <span className="res-skeleton" style={{ width: "80%" }} />
          </div>
        ))}
      </div>
      <span className="res-visually-hidden">Loading reservations…</span>
    </div>
  );
}

/** No reservations exist yet. */
export function ReservationsEmptyState() {
  return (
    <div className="res-state">
      <span className="res-state-icon" aria-hidden="true">
        <CalendarDays size={22} />
      </span>
      <h3>No reservations yet</h3>
      <p>
        Reservations created by guests will appear here once bookings start
        coming in.
      </p>
    </div>
  );
}

/** Filters/search returned no matches. */
export function ReservationsNoResults({
  hasFilters,
  onClear,
}: {
  hasFilters: boolean;
  onClear: () => void;
}) {
  return (
    <div className="res-state">
      <span className="res-state-icon" aria-hidden="true">
        {hasFilters ? <Search size={22} /> : <SlidersHorizontal size={22} />}
      </span>
      <h3>
        {hasFilters
          ? "No reservations match your filters"
          : "No reservations to show"}
      </h3>
      <p>
        {hasFilters
          ? "Try a different search term or clear the filters to see all reservations."
          : "Adjust the filters to widen the results."}
      </p>
      {hasFilters ? (
        <button type="button" className="btn-ghost" onClick={onClear}>
          <SlidersHorizontal size={14} /> Clear filters
        </button>
      ) : null}
    </div>
  );
}

/** Data could not be loaded. */
export function ReservationsErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="res-state res-state-error" role="alert">
      <span className="res-state-icon" aria-hidden="true">
        <AlertCircle size={22} />
      </span>
      <h3>Something went wrong</h3>
      <p>{message}</p>
      <button type="button" className="btn-ghost" onClick={onRetry}>
        <RefreshCw size={14} /> Try again
      </button>
    </div>
  );
}
