"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Download, Receipt, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import {
  DEFAULT_ORDER_FILTERS,
  HISTORY_ORDER_STATUSES,
  ORDER_STATUS_LABEL,
  ORDER_TYPE_LABEL,
  activeOrderFilterCount,
  computeOrderHistoryStats,
  derivePaymentStatus,
  downloadCsv,
  filterOrderHistory,
  formatDateTime,
  formatMoney,
  ordersToCsv,
  paymentMethodSummary,
  type OrderHistoryFilters,
  type OrderHistoryRow,
} from "@/lib/history";
import { ReservationsPagination } from "@/components/reservations/pagination";

export default function OrderHistoryPage() {
  const [rows, setRows] = useState<OrderHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filters, setFilters] = useState<OrderHistoryFilters>({
    ...DEFAULT_ORDER_FILTERS,
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detail, setDetail] = useState<OrderHistoryRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const { data, error: queryError } = await supabase
      .from("orders")
      .select(
        // NOTE: never select `payments.reference` — this database's payments
        // table has no such column (PostgREST 42703 "column payments_1.reference
        // does not exist"), and naming it on the embedded join failed the WHOLE
        // query, leaving Order History permanently empty even though settled
        // orders were correctly marked `served`.
        "*, restaurant_tables(table_number, capacity, location), customers(name, phone), order_items(*), payments(method, amount_tendered, created_at)",
      )
      .in("status", HISTORY_ORDER_STATUSES)
      .order("created_at", { ascending: false });

    if (queryError) {
      setRows([]);
      setError(true);
      setLoading(false);
      return;
    }

    const orders = (data || []) as OrderHistoryRow[];
    // `orders.processed_by` points at auth.users, which PostgREST cannot
    // embed, so the closer's display name is resolved from profiles instead.
    const staffIds = Array.from(
      new Set(
        orders
          .map((order) => order.processed_by)
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
      orders.map((order) => ({
        ...order,
        processed_by_name: order.processed_by
          ? names.get(order.processed_by) || null
          : null,
      })),
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
    () => filterOrderHistory(rows, filters),
    [rows, filters],
  );
  const stats = useMemo(() => computeOrderHistoryStats(rows), [rows]);
  const activeFilters = activeOrderFilterCount(filters);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  const change = (patch: Partial<OrderHistoryFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  };

  const clear = () => {
    setFilters({ ...DEFAULT_ORDER_FILTERS });
    setPage(1);
  };

  const runExport = () => {
    if (filtered.length === 0) return;
    downloadCsv("dineflow-order-history.csv", ordersToCsv(filtered));
  };

  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-left">
          <div className="search-box">
            <Search size={15} />
            <input
              type="text"
              placeholder="Search order #, customer or phone…"
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
                status: event.target.value as OrderHistoryFilters["status"],
              })
            }
          >
            <option value="all">All statuses</option>
            <option value="served">Served</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <select
            className="filter-select"
            aria-label="Filter by payment"
            value={filters.paymentStatus}
            onChange={(event) =>
              change({
                paymentStatus: event.target
                  .value as OrderHistoryFilters["paymentStatus"],
              })
            }
          >
            <option value="all">All payments</option>
            <option value="paid">Paid</option>
            <option value="unpaid">Unpaid</option>
          </select>
          <select
            className="filter-select"
            aria-label="Filter by order type"
            value={filters.type}
            onChange={(event) =>
              change({
                type: event.target.value as OrderHistoryFilters["type"],
              })
            }
          >
            <option value="all">All types</option>
            <option value="dine_in">Dine-in</option>
            <option value="takeout">Takeout</option>
          </select>
          <select
            className="filter-select"
            aria-label="Sort order"
            value={filters.sort}
            onChange={(event) =>
              change({
                sort: event.target.value as OrderHistoryFilters["sort"],
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
          <Receipt size={14} />
          <span>
            <strong>{stats.total}</strong> records ·{" "}
            <strong>{stats.served}</strong> served ·{" "}
            <strong>{stats.servedToday}</strong> today ·{" "}
            <strong>{formatMoney(stats.revenue)}</strong> revenue
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
          <p>Unable to load order history.</p>
          <button type="button" className="btn-ghost" onClick={load}>
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="bo-loading">Loading order history…</div>
      ) : filtered.length === 0 ? (
        <div className="billing-empty-state">
          <Receipt size={28} />
          <h3>
            {rows.length === 0
              ? "No historical orders yet"
              : "No orders match"}
          </h3>
          <p>
            {rows.length === 0
              ? "Orders move here once they are served or cancelled."
              : "Try a different search, date range or filter."}
          </p>
        </div>
      ) : (
        <>
          <div className="data-table">
            <div className="data-table-header">
              <div>Order #</div>
              <div>Customer</div>
              <div>Type</div>
              <div>Items</div>
              <div>Total</div>
              <div>Status</div>
              <div></div>
            </div>
            {pageRows.map((order) => {
              const payment = derivePaymentStatus(order.payments);
              return (
                <div key={order.id} className="data-table-row">
                  <div>
                    <div className="font-mono">#{order.order_number}</div>
                    <div className="data-table-muted truncate">
                      {formatDateTime(order.created_at)}
                    </div>
                  </div>
                  <div>
                    <div>{order.customers?.name || "Walk-in"}</div>
                    <div className="data-table-muted truncate">
                      {order.customers?.phone || "No phone"}
                    </div>
                  </div>
                  <div>
                    <div>{ORDER_TYPE_LABEL[order.type]}</div>
                    <div className="data-table-muted truncate">
                      {order.restaurant_tables
                        ? `Table ${order.restaurant_tables.table_number}`
                        : "—"}
                    </div>
                  </div>
                  <div>{order.order_items?.length || 0}</div>
                  <div>{formatMoney(Number(order.total))}</div>
                  <div>
                    <span
                      className={`status-badge ${
                        order.status === "cancelled"
                          ? "status-cancelled"
                          : "status-served"
                      }`}
                    >
                      {ORDER_STATUS_LABEL[order.status]}
                    </span>
                    <div className="data-table-muted truncate">
                      {payment === "paid"
                        ? `Paid · ${paymentMethodSummary(order.payments)}`
                        : "Unpaid"}
                    </div>
                  </div>
                  <div>
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => setDetail(order)}
                    >
                      Details
                      <ArrowRight size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
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
            aria-labelledby="order-details-title"
          >
            <div className="modal-header">
              <div>
                <p className="payments-section-kicker">Order Details</p>
                <h2 id="order-details-title">
                  Order #{detail.order_number}
                </h2>
              </div>
              <button
                type="button"
                className="modal-close"
                aria-label="Close order details"
                onClick={() => setDetail(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="payment-details-grid">
              <div>
                <span>Customer</span>
                <strong>{detail.customers?.name || "Walk-in"}</strong>
              </div>
              <div>
                <span>Phone</span>
                <strong>{detail.customers?.phone || "—"}</strong>
              </div>
              <div>
                <span>Placed</span>
                <strong>{formatDateTime(detail.created_at)}</strong>
              </div>
              <div>
                <span>Type</span>
                <strong>{ORDER_TYPE_LABEL[detail.type]}</strong>
              </div>
              <div>
                <span>Table</span>
                <strong>
                  {detail.restaurant_tables
                    ? `Table ${detail.restaurant_tables.table_number}`
                    : "—"}
                </strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{ORDER_STATUS_LABEL[detail.status]}</strong>
              </div>
              <div>
                <span>Payment</span>
                <strong>
                  {paymentMethodSummary(detail.payments)} ·{" "}
                  {derivePaymentStatus(detail.payments) === "paid"
                    ? "Paid"
                    : "Unpaid"}
                </strong>
              </div>
              <div>
                <span>Closed by</span>
                <strong>{detail.processed_by_name || "—"}</strong>
              </div>
              <div>
                <span>Notes</span>
                <strong>{detail.special_instructions || "—"}</strong>
              </div>
            </div>

            <div className="payment-details-grid">
              <div style={{ gridColumn: "1 / -1" }}>
                <p className="payments-section-kicker">Items</p>
                {detail.order_items.length === 0 ? (
                  <div className="receipt-total-row">
                    <div>No item lines</div>
                  </div>
                ) : (
                  detail.order_items.map((item) => (
                    <div key={item.id} className="receipt-total-row">
                      <div>
                        {item.quantity}× {item.menu_item_name}
                        {item.notes ? ` — ${item.notes}` : ""}
                      </div>
                      <strong>{formatMoney(Number(item.line_total))}</strong>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="payment-details-grid">
              <div>
                <span>Subtotal</span>
                <strong>{formatMoney(Number(detail.subtotal))}</strong>
              </div>
              <div>
                <span>Service charge</span>
                <strong>{formatMoney(Number(detail.service_charge))}</strong>
              </div>
              <div>
                <span>Tax</span>
                <strong>{formatMoney(Number(detail.tax))}</strong>
              </div>
              <div>
                <span>Discount</span>
                <strong>{formatMoney(Number(detail.discount))}</strong>
              </div>
            </div>

            <div className="payment-order-summary">
              <span>Total</span>
              <strong>{formatMoney(Number(detail.total))}</strong>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

