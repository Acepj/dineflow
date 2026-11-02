"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CalendarDays, Download, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { STATUS_LABEL } from "@/lib/reservations";
import {
  DEFAULT_RESERVATION_FILTERS,
  HISTORY_RESERVATION_STATUSES,
  activeReservationFilterCount,
  computeReservationHistoryStats,
  downloadCsv,
  filterReservationHistory,
  formatDate,
  formatDateTime,
  formatTime,
  reservationClosedAt,
  reservationProcessedBy,
  reservationsToHistoryCsv,
  type ReservationHistoryFilters,
  type ReservationHistoryRow,
} from "@/lib/history";
import { ReservationsPagination } from "@/components/reservations/pagination";

export default function ReservationHistoryPage() {
  const [rows, setRows] = useState<ReservationHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState<ReservationHistoryFilters>({
    ...DEFAULT_RESERVATION_FILTERS,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detail, setDetail] = useState<ReservationHistoryRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const { data, error: queryError } = await supabase
      .from("reservations")
      .select("*, restaurant_tables(table_number, capacity, location)")
      .in("status", HISTORY_RESERVATION_STATUSES)
      .order("reserved_from", { ascending: false });

    if (queryError) {
      setRows([]);
      setError(true);
      setLoading(false);
      return;
    }

    const reservations = (data || []) as ReservationHistoryRow[];
    // `completed_by` / `done_eating_by` point at auth.users, which PostgREST
    // cannot embed, so staff display names are resolved from profiles instead.
    const staffIds = Array.from(
      new Set(
        reservations
          .flatMap((reservation) => [
            reservation.completed_by ?? null,
            reservation.done_eating_by ?? null,
          ])
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const names = new Map<string, string>();
    if (staffIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", staffIds);
      for (const profile of (profiles || []) as {
        id: string;
        full_name: string;
      }[]) {
        names.set(profile.id, profile.full_name);
      }
    }
    setRows(
      reservations.map((reservation) => {
        const actorId = reservationProcessedBy(reservation);
        return {
          ...reservation,
          processed_by_name: actorId ? names.get(actorId) || null : null,
        };
      }),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    // The loader updates state from the async Supabase response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    if (!detail) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detail]);

  const filtered = useMemo(
    () => filterReservationHistory(rows, filters),
    [rows, filters],
  );
  const stats = useMemo(() => computeReservationHistoryStats(rows), [rows]);
  const activeFilters = activeReservationFilterCount(filters);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const change = (patch: Partial<ReservationHistoryFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const clear = () => {
    setFilters({ ...DEFAULT_RESERVATION_FILTERS });
    setPage(1);
  };

  const runExport = () => {
    if (filtered.length === 0) return;
    downloadCsv(
      "dineflow-reservation-history.csv",
      reservationsToHistoryCsv(filtered),
    );
  };

  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-left">
          <div className="search-box">
            <Search size={15} />
            <input
              type="text"
              placeholder="Search code, guest, phone or email…"
              value={filters.search}
              onChange={(event) => change({ search: event.target.value })}
            />
          </div>
          <input
            type="date"
            className="filter-select"
            aria-label="From date"
            title="From date"
            value={filters.dateFrom}
            style={{ colorScheme: "dark" }}
            onChange={(event) => change({ dateFrom: event.target.value })}
          />
          <select
            className="filter-select"
            aria-label="Filter by status"
            value={filters.status}
            onChange={(event) =>
              change({
                status: event.target
                  .value as ReservationHistoryFilters["status"],
              })
            }
          >
            <option value="all">All statuses</option>
            <option value="completed">{STATUS_LABEL.completed}</option>
            <option value="done_eating">{STATUS_LABEL.done_eating}</option>
            <option value="cancelled">{STATUS_LABEL.cancelled}</option>
            <option value="no_show">{STATUS_LABEL.no_show}</option>
          </select>
          <select
            className="filter-select"
            aria-label="Sort order"
            value={filters.sort}
            onChange={(event) =>
              change({
                sort: event.target.value as ReservationHistoryFilters["sort"],
              })
            }
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
          {activeFilters > 0 ? (
            <button type="button" className="btn-ghost" onClick={clear}>
              <X size={13} /> Clear ({activeFilters})
            </button>
          ) : null}
        </div>
        <div className="billing-toolbar-total">
          <CalendarDays size={14} />
          <span>
            <strong>{stats.total}</strong> records ·{" "}
            <strong>{stats.completed}</strong> completed ·{" "}
            <strong>{stats.completedToday}</strong> today
          </span>
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={runExport}
          disabled={filtered.length === 0}
        >
          <Download size={14} /> Export CSV
        </button>
      </div>


      {error ? (
        <div className="billing-error-state" role="alert">
          <p>Unable to load reservation history.</p>
          <button type="button" className="btn-ghost" onClick={load}>
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="bo-loading">Loading reservation history…</div>
      ) : filtered.length === 0 ? (
        <div className="billing-empty-state">
          <CalendarDays size={28} />
          <h3>
            {rows.length === 0
              ? "No reservation history yet"
              : "No reservations match"}
          </h3>
          <p>
            {rows.length === 0
              ? "Reservations move here once they are completed, cancelled or marked no-show."
              : "Try a different search, date range or filter."}
          </p>
        </div>
      ) : (
        <>
          <div className="data-table">
            <div className="data-table-header">
              <div>Code</div>
              <div>Guest</div>
              <div>Reservation</div>
              <div>Party</div>
              <div>Table</div>
              <div>Status</div>
              <div></div>
            </div>
            {pageRows.map((reservation) => (
              <div key={reservation.id} className="data-table-row">
                <div>
                  <div className="font-mono">{reservation.code}</div>
                  <div className="data-table-muted truncate">
                    Booked {formatDate(reservation.created_at)}
                  </div>
                </div>
                <div>
                  <div>{reservation.guest_name}</div>
                  <div className="data-table-muted truncate">
                    {reservation.phone}
                  </div>
                </div>
                <div>
                  <div>{formatDate(reservation.reserved_from)}</div>
                  <div className="data-table-muted truncate">
                    {formatTime(reservation.reserved_from)} –{" "}
                    {formatTime(reservation.reserved_to)}
                  </div>
                </div>
                <div>{reservation.party_size} pax</div>
                <div>
                  {reservation.restaurant_tables ? (
                    <>
                      <div>
                        Table {reservation.restaurant_tables.table_number}
                      </div>
                      <div className="data-table-muted truncate">
                        {reservation.restaurant_tables.location || "—"}
                      </div>
                    </>
                  ) : (
                    <div className="data-table-muted">Unassigned</div>
                  )}
                </div>
                <div>
                  <span
                    className={`status-badge status-${reservation.status.replace(/_/g, "-")}`}
                  >
                    {STATUS_LABEL[reservation.status]}
                  </span>
                  <div className="data-table-muted truncate">
                    {formatDateTime(reservationClosedAt(reservation))}
                  </div>
                </div>
                <div>
                  <button
                    type="button"
                    className="btn-icon"
                    onClick={() => setDetail(reservation)}
                  >
                    Details
                    <ArrowRight size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <ReservationsPagination
            page={currentPage}
            pageCount={pageCount}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </>
      )}


      {detail ? (
        <div
          className="modal-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setDetail(null);
          }}
        >
          <section
            className="payment-details-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reservation-details-title"
          >
            <div className="modal-header">
              <div>
                <p className="payments-section-kicker">
                  Reservation Details
                </p>
                <h2 id="reservation-details-title">{detail.code}</h2>
              </div>
              <button
                type="button"
                className="modal-close"
                aria-label="Close reservation details"
                onClick={() => setDetail(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="payment-details-grid">
              <div>
                <span>Guest</span>
                <strong>{detail.guest_name}</strong>
              </div>
              <div>
                <span>Phone</span>
                <strong>{detail.phone}</strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{detail.email || "—"}</strong>
              </div>
              <div>
                <span>Party size</span>
                <strong>{detail.party_size} guests</strong>
              </div>
              <div>
                <span>Reservation</span>
                <strong>{formatDateTime(detail.reserved_from)}</strong>
              </div>
              <div>
                <span>Time window</span>
                <strong>
                  {formatTime(detail.reserved_from)} –{" "}
                  {formatTime(detail.reserved_to)}
                </strong>
              </div>
              <div>
                <span>Table</span>
                <strong>
                  {detail.restaurant_tables
                    ? `Table ${detail.restaurant_tables.table_number}${
                        detail.restaurant_tables.location
                          ? ` · ${detail.restaurant_tables.location}`
                          : ""
                      }`
                    : "Unassigned"}
                </strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{STATUS_LABEL[detail.status]}</strong>
              </div>
              <div>
                <span>Closed</span>
                <strong>{formatDateTime(reservationClosedAt(detail))}</strong>
              </div>
              <div>
                <span>Processed by</span>
                <strong>{detail.processed_by_name || "—"}</strong>
              </div>
            </div>

            <div className="payment-details-grid">
              <div style={{ gridColumn: "1 / -1" }}>
                <p className="payments-section-kicker">Special Requests</p>
                <strong>{detail.special_request || "None"}</strong>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

