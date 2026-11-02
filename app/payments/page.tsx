"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calendar,
  CreditCard,
  Download,
  Eye,
  MoreHorizontal,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { RoleGuard } from "@/components/auth/role-guard";
import { DashboardBackButton } from "@/components/ui/dashboard-back-button";
import { supabase } from "@/lib/supabase/client";
import type { Order, Payment, PaymentMethod } from "@/types/database.types";

type PaymentRow = Payment & {
  orders: Pick<Order, "order_number" | "total" | "status"> & {
    customers: { name: string } | null;
  };
};

type DatePreset =
  | "today"
  | "yesterday"
  | "last-7-days"
  | "last-30-days"
  | "this-month"
  | "all-time"
  | "custom";
type PaymentStatus = "completed";

const paymentMethods: { value: PaymentMethod | "all"; label: string }[] = [
  { value: "all", label: "All Methods" },
  { value: "cash", label: "Cash" },
  { value: "gcash", label: "GCash" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank Transfer" },
];

const pageSize = 10;

function formatP(value: number) {
  return (
    "₱" +
    Number(value).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function methodLabel(method: PaymentMethod) {
  return method === "gcash"
    ? "GCash"
    : method === "bank_transfer"
      ? "Bank Transfer"
      : method.charAt(0).toUpperCase() + method.slice(1);
}

export default function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [preset, setPreset] = useState<DatePreset>("all-time");
  const [method, setMethod] = useState<PaymentMethod | "all">("all");
  const [status, setStatus] = useState<PaymentStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedPayment, setSelectedPayment] = useState<PaymentRow | null>(
    null,
  );
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(false);
    const { data, error: queryError } = await supabase
      .from("payments")
      .select("*, orders!inner(order_number, total, status, customers(name))")
      .order("created_at", { ascending: false });

    if (queryError) {
      setPayments([]);
      setError(true);
      setLoading(false);
      return;
    }

    const completedPayments = ((data || []) as PaymentRow[]).filter(
      (payment) => payment.orders?.status === "served",
    );
    setPayments(completedPayments);
    setLoading(false);
  };

  useEffect(() => {
    // The loader updates state from the async Supabase response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  const filteredPayments = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return payments.filter((payment) => {
      const paymentDate = payment.created_at.slice(0, 10);
      const inDateRange =
        (!dateFrom || paymentDate >= dateFrom) &&
        (!dateTo || paymentDate <= dateTo);
      const matchesMethod = method === "all" || payment.method === method;
      const matchesStatus = status === "all" || status === "completed";
      const searchable = [
        String(payment.orders?.order_number || ""),
        payment.orders?.customers?.name || "",
        payment.reference || "",
      ]
        .join(" ")
        .toLowerCase();
      return (
        inDateRange &&
        matchesMethod &&
        matchesStatus &&
        (!normalizedSearch || searchable.includes(normalizedSearch))
      );
    });
  }, [dateFrom, dateTo, method, payments, search, status]);

  const totalPages = Math.max(1, Math.ceil(filteredPayments.length / pageSize));
  const visiblePayments = filteredPayments.slice(
    (page - 1) * pageSize,
    page * pageSize,
  );
  const totalAmount = filteredPayments.reduce(
    (sum, payment) => sum + Number(payment.amount_due),
    0,
  );
  const selectedPeriod =
    dateFrom || dateTo
      ? `${dateFrom ? formatDate(dateFrom) : "All dates"} - ${dateTo ? formatDate(dateTo) : "All dates"}`
      : "All time";

  const applyPreset = (nextPreset: DatePreset) => {
    const today = new Date();
    const todayValue = toDateInput(today);
    let from = "";
    let to = "";
    if (nextPreset === "today") {
      from = to = todayValue;
    } else if (nextPreset === "yesterday") {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      from = to = toDateInput(yesterday);
    } else if (nextPreset === "last-7-days" || nextPreset === "last-30-days") {
      const start = new Date(today);
      start.setDate(start.getDate() - (nextPreset === "last-7-days" ? 6 : 29));
      from = toDateInput(start);
      to = todayValue;
    } else if (nextPreset === "this-month") {
      from = toDateInput(new Date(today.getFullYear(), today.getMonth(), 1));
      to = todayValue;
    }
    setDateFrom(from);
    setDateTo(to);
    setPreset(nextPreset);
    setPage(1);
  };

  const clearFilters = () => {
    setDateFrom("");
    setDateTo("");
    setPreset("all-time");
    setMethod("all");
    setStatus("all");
    setSearch("");
    setPage(1);
  };

  const exportCSV = () => {
    setExportNotice(null);
    if (!filteredPayments.length) {
      setExportNotice("No transactions available to export.");
      return;
    }
    const rows = [
      [
        "Order ID",
        "Customer",
        "Amount",
        "Payment Method",
        "Status",
        "Date",
        "Reference",
      ],
    ];
    filteredPayments.forEach((payment) => {
      rows.push([
        String(payment.orders?.order_number || ""),
        payment.orders?.customers?.name || "Walk-in",
        String(payment.amount_due),
        methodLabel(payment.method),
        "Completed",
        formatDateTime(payment.created_at),
        payment.reference || "",
      ]);
    });
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `payment-transactions-${toDateInput(new Date())}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const hasFilters = Boolean(
    dateFrom || dateTo || method !== "all" || status !== "all" || search,
  );
  const datePresets: { value: DatePreset; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "last-7-days", label: "Last 7 Days" },
    { value: "last-30-days", label: "Last 30 Days" },
    { value: "this-month", label: "This Month" },
    { value: "all-time", label: "All Time" },
  ];

  return (
    <RoleGuard allow={["admin"]} redirect="/dashboard">
      <div className="payments-page">
        <DashboardBackButton />
        <header className="payments-page-header">
          <p className="payments-kicker">Payments</p>
          <h1>Transaction overview</h1>
          <p>View and manage customer payments and transaction history.</p>
        </header>

        <section className="payments-controls" aria-label="Payment filters">
          <div className="payments-presets">
            <span className="payments-filter-label">
              <Calendar size={15} /> Date Range
            </span>
            {datePresets.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`payments-preset ${preset === option.value ? "active" : ""}`}
                onClick={() => applyPreset(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="payments-filter-row">
            <label>
              From
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                  setPreset("custom");
                  setPage(1);
                }}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={dateTo}
                onChange={(event) => {
                  setDateTo(event.target.value);
                  setPreset("custom");
                  setPage(1);
                }}
              />
            </label>
            <label>
              Method
              <select
                value={method}
                onChange={(event) => {
                  setMethod(event.target.value as PaymentMethod | "all");
                  setPage(1);
                }}
              >
                {paymentMethods.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as PaymentStatus | "all");
                  setPage(1);
                }}
              >
                <option value="all">All Status</option>
                <option value="completed">Completed</option>
              </select>
            </label>
          </div>
          <div className="payments-search-row">
            <label className="payments-search">
              <Search size={15} />
              <input
                placeholder="Search transactions..."
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                aria-label="Search transactions"
              />
            </label>
            <button className="btn-ghost" type="button" onClick={exportCSV}>
              <Download size={15} /> Export CSV
            </button>
          </div>
        </section>
        {exportNotice && (
          <p className="payments-notice" role="status">
            {exportNotice}
          </p>
        )}

        {error ? (
          <section className="payments-error-state" role="alert">
            <CreditCard size={24} />
            <h2>Unable to load transactions</h2>
            <p>Please try again.</p>
            <button className="btn-ghost" type="button" onClick={load}>
              <RefreshCw size={14} /> Retry
            </button>
          </section>
        ) : (
          <>
            <section className="payments-summary" aria-label="Payment summary">
              {loading ? (
                ["Total Payments", "Completed", "Pending", "Refunded"].map(
                  (label) => (
                    <div
                      className="payments-summary-card payments-skeleton"
                      key={label}
                    >
                      <span>{label}</span>
                      <i />
                      <em />
                    </div>
                  ),
                )
              ) : (
                <>
                  <div className="payments-summary-card">
                    <span>Total Payments</span>
                    <strong>{formatP(totalAmount)}</strong>
                    <small>{selectedPeriod}</small>
                  </div>
                  <div className="payments-summary-card">
                    <span>Completed</span>
                    <strong>{filteredPayments.length}</strong>
                    <small>Successful transactions</small>
                  </div>
                  <div className="payments-summary-card">
                    <span>Pending</span>
                    <strong className="not-tracked">Not tracked</strong>
                    <small>Status is not stored in the current database.</small>
                  </div>
                  <div className="payments-summary-card">
                    <span>Refunded</span>
                    <strong className="not-tracked">Not tracked</strong>
                    <small>
                      Refund status is not stored in the current database.
                    </small>
                  </div>
                </>
              )}
            </section>

            <section className="payments-table-card">
              <div className="payments-table-heading">
                <div>
                  <p className="payments-section-kicker">Transactions</p>
                  <h2>Payment history</h2>
                  <p>{selectedPeriod}</p>
                </div>
                <CreditCard size={20} />
              </div>
              {loading ? (
                <div className="payments-loading-rows">
                  {[1, 2, 3, 4].map((row) => (
                    <i key={row} />
                  ))}
                </div>
              ) : visiblePayments.length ? (
                <>
                  <div className="data-table payments-table">
                    <div className="data-table-header">
                      <div>Order</div>
                      <div>Customer</div>
                      <div>Amount</div>
                      <div>Method</div>
                      <div>Status</div>
                      <div>Date</div>
                      <div>Reference</div>
                      <div />
                    </div>
                    {visiblePayments.map((payment) => (
                      <div className="data-table-row" key={payment.id}>
                        <div className="font-mono">
                          #{payment.orders?.order_number || "—"}
                        </div>
                        <div>
                          {payment.orders?.customers?.name || "Walk-in"}
                        </div>
                        <div className="payment-amount">
                          {formatP(Number(payment.amount_due))}
                        </div>
                        <div>{methodLabel(payment.method)}</div>
                        <div>
                          <span className="payment-status completed">
                            Completed
                          </span>
                        </div>
                        <div>{formatDateTime(payment.created_at)}</div>
                        <div>{payment.reference || "—"}</div>
                        <div className="payment-action-wrap">
                          <button
                            className="payment-action"
                            type="button"
                            aria-label={`View actions for order ${payment.orders?.order_number || ""}`}
                            onClick={() =>
                              setOpenMenuId(
                                openMenuId === payment.id ? null : payment.id,
                              )
                            }
                          >
                            <MoreHorizontal size={16} />
                          </button>
                          {openMenuId === payment.id && (
                            <div className="payment-action-menu">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedPayment(payment);
                                  setOpenMenuId(null);
                                }}
                              >
                                <Eye size={14} /> View Details
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="payments-pagination">
                    <span>
                      Showing {(page - 1) * pageSize + 1}-
                      {Math.min(page * pageSize, filteredPayments.length)} of{" "}
                      {filteredPayments.length} transactions
                    </span>
                    {totalPages > 1 && (
                      <div>
                        <button
                          type="button"
                          disabled={page === 1}
                          onClick={() => setPage((current) => current - 1)}
                        >
                          Previous
                        </button>
                        {Array.from(
                          { length: totalPages },
                          (_, index) => index + 1,
                        ).map((number) => (
                          <button
                            className={page === number ? "active" : ""}
                            type="button"
                            key={number}
                            onClick={() => setPage(number)}
                          >
                            {number}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled={page === totalPages}
                          onClick={() => setPage((current) => current + 1)}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="payments-empty-state">
                  <CreditCard size={28} />
                  <h3>
                    {payments.length
                      ? "No transactions found"
                      : "No payment transactions yet"}
                  </h3>
                  <p>
                    {payments.length
                      ? "There are no payment transactions for the selected filters."
                      : "Payment transactions will appear here when customers complete orders."}
                  </p>
                  {hasFilters && (
                    <button
                      className="btn-ghost"
                      type="button"
                      onClick={clearFilters}
                    >
                      <X size={14} /> Clear filters
                    </button>
                  )}
                </div>
              )}
            </section>
          </>
        )}

        {selectedPayment && (
          <div
            className="modal-overlay"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget)
                setSelectedPayment(null);
            }}
          >
            <section
              className="payment-details-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="payment-details-title"
            >
              <div className="modal-header">
                <div>
                  <p className="payments-section-kicker">Payment Details</p>
                  <h2 id="payment-details-title">
                    Order #{selectedPayment.orders?.order_number || "—"}
                  </h2>
                </div>
                <button
                  className="modal-close"
                  type="button"
                  aria-label="Close payment details"
                  onClick={() => setSelectedPayment(null)}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="payment-details-grid">
                <div>
                  <span>Customer</span>
                  <strong>
                    {selectedPayment.orders?.customers?.name || "Walk-in"}
                  </strong>
                </div>
                <div>
                  <span>Amount</span>
                  <strong>{formatP(Number(selectedPayment.amount_due))}</strong>
                </div>
                <div>
                  <span>Payment Method</span>
                  <strong>{methodLabel(selectedPayment.method)}</strong>
                </div>
                <div>
                  <span>Status</span>
                  <strong>
                    <span className="payment-status completed">Completed</span>
                  </strong>
                </div>
                <div>
                  <span>Date</span>
                  <strong>{formatDateTime(selectedPayment.created_at)}</strong>
                </div>
                <div>
                  <span>Reference</span>
                  <strong>
                    {selectedPayment.reference || "Not available"}
                  </strong>
                </div>
              </div>
              <div className="payment-order-summary">
                <span>Related order total</span>
                <strong>
                  {formatP(Number(selectedPayment.orders?.total || 0))}
                </strong>
              </div>
            </section>
          </div>
        )}
      </div>
    </RoleGuard>
  );
}
