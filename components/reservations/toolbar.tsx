"use client";

import { useEffect, useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { RestaurantTable } from "@/types/database.types";
import {
  DEFAULT_FILTERS,
  RESERVATION_STATUSES,
  SORT_OPTIONS,
  STATUS_LABEL,
  activeFilterCount,
  type ReservationFilters,
} from "@/lib/reservations";

type ToolbarProps = {
  filters: ReservationFilters;
  onChange: (patch: Partial<ReservationFilters>) => void;
  onClear: () => void;
  tables: RestaurantTable[];
};

/**
 * Compact search + filter bar. Search covers reservation code, customer name
 * and phone number; every control combines with the others and applies
 * immediately (search is debounced).
 */
export function ReservationsToolbar({
  filters,
  onChange,
  onClear,
  tables,
}: ToolbarProps) {
  const [searchInput, setSearchInput] = useState(filters.search);
  const [showFilters, setShowFilters] = useState(false);
  const firstRender = useRef(true);

  // Debounce the search input before pushing it to the filter state.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return undefined;
    }
    const timeout = setTimeout(
      () => onChange({ search: searchInput }),
      250,
    );
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // Sync when the search value is set externally (e.g. top-bar quick search).
  useEffect(() => {
    setSearchInput((prev) => (prev === filters.search ? prev : filters.search));
  }, [filters.search]);

  const activeCount = activeFilterCount(filters);
  const isPristine =
    activeCount === 0 && filters.sort === DEFAULT_FILTERS.sort;

  return (
    <div className="res-toolbar">
      <div className="res-search">
        <Search size={15} aria-hidden="true" />
        <input
          type="search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search code, customer or phone…"
          aria-label="Search reservations by code, customer name or phone number"
        />
        {searchInput ? (
          <button
            type="button"
            onClick={() => setSearchInput("")}
            aria-label="Clear search"
            title="Clear search"
          >
            <X size={13} />
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className="res-filters-toggle"
        onClick={() => setShowFilters((open) => !open)}
        aria-expanded={showFilters}
        aria-controls="res-toolbar-filters"
      >
        <SlidersHorizontal size={14} aria-hidden="true" />
        Filters
        {activeCount > 0 ? (
          <span className="res-filter-count">{activeCount}</span>
        ) : null}
      </button>

      <div
        id="res-toolbar-filters"
        className={`res-toolbar-filters ${showFilters ? "open" : ""}`}
      >
        <select
          className="res-filter"
          value={filters.status}
          onChange={(event) => onChange({ status: event.target.value })}
          aria-label="Filter by reservation status"
        >
          <option value="all">All statuses</option>
          {RESERVATION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABEL[status]}
            </option>
          ))}
        </select>

        <input
          type="date"
          className="res-filter res-filter-date"
          value={filters.date}
          onChange={(event) => onChange({ date: event.target.value })}
          aria-label="Filter by reservation date"
          title="Filter by reservation date"
        />

        <select
          className="res-filter"
          value={filters.party}
          onChange={(event) => onChange({ party: event.target.value })}
          aria-label="Filter by party size"
        >
          <option value="all">Any party size</option>
          <option value="1-2">1–2 guests</option>
          <option value="3-4">3–4 guests</option>
          <option value="5-6">5–6 guests</option>
          <option value="7+">7+ guests</option>
        </select>

        <select
          className="res-filter"
          value={filters.table}
          onChange={(event) => onChange({ table: event.target.value })}
          aria-label="Filter by assigned table"
        >
          <option value="all">All tables</option>
          <option value="unassigned">Unassigned</option>
          {tables.map((table) => (
            <option key={table.id} value={table.id}>
              Table {table.table_number} · {table.location}
            </option>
          ))}
        </select>

        <select
          className="res-filter res-filter-sort"
          value={filters.sort}
          onChange={(event) =>
            onChange({
              sort: event.target.value as ReservationFilters["sort"],
            })
          }
          aria-label="Sort reservations"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="res-clear-btn"
          onClick={onClear}
          disabled={isPristine}
        >
          <X size={13} aria-hidden="true" /> Clear filters
        </button>
      </div>
    </div>
  );
}
