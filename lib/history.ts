import type {
  OrderStatus,
  OrderType,
  OrderWithDetails,
  Payment,
  PaymentMethod,
  ReservationStatus,
  ReservationWithTable,
} from "@/types/database.types";
import { STATUS_LABEL } from "@/lib/reservations";

/* ================================================================== */
/* Shared helpers for the Order History and Reservation History pages. */
/*                                                                     */
/* Both pages read the SAME rows the live Orders/Reservations pages    */
/* read. Nothing is copied into a parallel table: an order becomes     */
/* "history" when its status reaches `served`, and a reservation when  */
/* it reaches a terminal status. That means a completed record can     */
/* never be missing from history, and repeated status updates can      */
/* never duplicate one.                                                */
/* ================================================================== */

/* ------------------------------------------------------------------ */
/* Statuses                                                           */
/* ------------------------------------------------------------------ */

/** Order statuses shown in history: served, plus cancelled for auditing. */
export const HISTORY_ORDER_STATUSES: OrderStatus[] = ["served", "cancelled"];

/** Reservation statuses that are terminal and therefore historical. */
export const HISTORY_RESERVATION_STATUSES: ReservationStatus[] = [
  "completed",
  "done_eating",
  "cancelled",
  "no_show",
];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  queued: "Queued",
  preparing: "Preparing",
  serving: "Serving",
  served: "Served",
  cancelled: "Cancelled",
};

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  dine_in: "Dine-in",
  takeout: "Takeout",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  card: "Card",
  gcash: "GCash",
  bank_transfer: "Bank Transfer",
};

/* ------------------------------------------------------------------ */
/* Filter types                                                       */
/* ------------------------------------------------------------------ */

export type OrderHistoryFilters = {
  search: string;
  dateFrom: string;
  dateTo: string;
  status: "all" | OrderStatus;
  paymentStatus: "all" | "paid" | "unpaid";
  type: "all" | OrderType;
  sort: "newest" | "oldest";
};

export type ReservationHistoryFilters = {
  search: string;
  dateFrom: string;
  dateTo: string;
  status: "all" | ReservationStatus;
  sort: "newest" | "oldest";
};

export const DEFAULT_ORDER_FILTERS: OrderHistoryFilters = {
  search: "",
  dateFrom: "",
  dateTo: "",
  status: "all",
  paymentStatus: "all",
  type: "all",
  sort: "newest",
};

export const DEFAULT_RESERVATION_FILTERS: ReservationHistoryFilters = {
  search: "",
  dateFrom: "",
  dateTo: "",
  status: "all",
  sort: "newest",
};

/** An order plus the resolved name of the staff member who closed it. */
export type OrderHistoryRow = OrderWithDetails & {
  processed_by_name?: string | null;
  /**
   * Mirrors exactly what the Order History query selects. `reference` is
   * deliberately absent: this database's `payments` table has no
   * `payments.reference` column (PostgREST 42703), and requesting it on the
   * embedded join failed the entire query, leaving history blank.
   */
  payments?: Pick<Payment, "method" | "amount_tendered" | "created_at">[];
};

export type ReservationHistoryRow = ReservationWithTable & {
  processed_by_name?: string | null;
};

export type HistoryStats = {
  totalCompleted: number;
  completedToday: number;
};

/* ------------------------------------------------------------------ */
/* Date / format helpers                                              */
/* ------------------------------------------------------------------ */

/**
 * Inclusive day range from `yyyy-mm-dd` inputs, interpreted in LOCAL time so
 * a staff member in Manila filtering "today" gets the day they are actually
 * looking at rather than a UTC-shifted one.
 */
export function dayRange(
  from: string,
  to: string,
): { start: Date | null; end: Date | null } {
  return {
    start: from ? new Date(`${from}T00:00:00`) : null,
    end: to ? new Date(`${to}T23:59:59.999`) : null,
  };
}

function inRange(value: string, start: Date | null, end: Date | null): boolean {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return false;
  if (start && time < start.getTime()) return false;
  if (end && time > end.getTime()) return false;
  return true;
}

export function isSameLocalDay(value: string, day: Date): boolean {
  const date = new Date(value);
  return (
    date.getFullYear() === day.getFullYear() &&
    date.getMonth() === day.getMonth() &&
    date.getDate() === day.getDate()
  );
}

export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDateTime(
  value: string | Date | null | undefined,
): string {
  if (!value) return "—";
  return `${formatDate(value)} · ${formatTime(value)}`;
}

export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return (
    "₱" +
    Number(value).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

/* ------------------------------------------------------------------ */
/* Payment status                                                     */
/* ------------------------------------------------------------------ */

/**
 * `payments` has no status column, so "Paid" is derived from the existence of
 * a payment row covering a non-zero amount. Defined once so the table, the
 * details view and the CSV export can never disagree.
 *
 * The money column is `amount_tendered` (what the customer actually handed
 * over), not `amount` — `amount_due` can legitimately be 0 for a comped order
 * while cash was still taken, so tendered is the column that proves payment.
 */
export function derivePaymentStatus(
  payments: { amount_tendered: number }[] | null | undefined,
): "paid" | "unpaid" {
  if (!payments || payments.length === 0) return "unpaid";
  const paid = payments.reduce(
    (sum, p) => sum + Number(p.amount_tendered || 0),
    0,
  );
  return paid > 0 ? "paid" : "unpaid";
}

export function paymentMethodSummary(
  payments: { method: PaymentMethod }[] | null | undefined,
): string {
  if (!payments || payments.length === 0) return "—";
  // De-duplicate so two card payments read "Card", not "Card, Card".
  const labels = Array.from(
    new Set(payments.map((p) => PAYMENT_METHOD_LABEL[p.method] ?? p.method)),
  );
  return labels.join(", ");
}

/* ------------------------------------------------------------------ */
/* Filtering & sorting                                                */
/* ------------------------------------------------------------------ */

function matchesSearch(haystack: string[], term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return haystack.some((field) => field.toLowerCase().includes(needle));
}

function sortRows<T>(
  rows: T[],
  sort: "newest" | "oldest",
  dateOf: (row: T) => string,
): T[] {
  return [...rows].sort((a, b) => {
    const diff = new Date(dateOf(a)).getTime() - new Date(dateOf(b)).getTime();
    return sort === "newest" ? -diff : diff;
  });
}

export function filterOrderHistory(
  rows: OrderHistoryRow[],
  filters: OrderHistoryFilters,
): OrderHistoryRow[] {
  const { start, end } = dayRange(filters.dateFrom, filters.dateTo);

  const filtered = rows.filter((order) => {
    // Only terminal orders are history, regardless of the other filters.
    if (!HISTORY_ORDER_STATUSES.includes(order.status)) return false;
    if (filters.status !== "all" && order.status !== filters.status) {
      return false;
    }
    if (filters.type !== "all" && order.type !== filters.type) return false;

    if (
      filters.paymentStatus !== "all" &&
      derivePaymentStatus(order.payments) !== filters.paymentStatus
    ) {
      return false;
    }

    if (!inRange(order.created_at, start, end)) return false;

    // Search by order number, customer name or phone.
    return matchesSearch(
      [
        String(order.order_number),
        order.customers?.name ?? "",
        order.customers?.phone ?? "",
      ],
      filters.search,
    );
  });

  return sortRows(filtered, filters.sort, (o) => o.created_at);
}

export function filterReservationHistory(
  rows: ReservationHistoryRow[],
  filters: ReservationHistoryFilters,
): ReservationHistoryRow[] {
  const { start, end } = dayRange(filters.dateFrom, filters.dateTo);

  const filtered = rows.filter((reservation) => {
    if (!HISTORY_RESERVATION_STATUSES.includes(reservation.status)) {
      return false;
    }
    if (filters.status !== "all" && reservation.status !== filters.status) {
      return false;
    }

    // Dated by when the booking was *for*, which is what a staff member
    // reviewing a past shift looks for.
    if (!inRange(reservation.reserved_from, start, end)) return false;

    return matchesSearch(
      [
        reservation.code,
        reservation.guest_name,
        reservation.phone,
        reservation.email ?? "",
      ],
      filters.search,
    );
  });

  return sortRows(filtered, filters.sort, (r) => r.reserved_from);
}

export function activeOrderFilterCount(filters: OrderHistoryFilters): number {
  let count = 0;
  if (filters.search.trim()) count += 1;
  if (filters.status !== "all") count += 1;
  if (filters.paymentStatus !== "all") count += 1;
  if (filters.type !== "all") count += 1;
  if (filters.dateFrom || filters.dateTo) count += 1;
  return count;
}

export function activeReservationFilterCount(
  filters: ReservationHistoryFilters,
): number {
  let count = 0;
  if (filters.search.trim()) count += 1;
  if (filters.status !== "all") count += 1;

  if (filters.dateFrom || filters.dateTo) count += 1;
  return count;
}

/* ------------------------------------------------------------------ */

export type OrderHistoryStats = {
  /** Terminal orders overall (served + cancelled). */
  total: number;
  /** Served orders — the "completed" figure on the dashboard. */
  served: number;
  /** Served orders closed today, in the restaurant's local time. */
  servedToday: number;
  /** Sum of the totals of served orders, for a revenue-at-a-glance figure. */
  revenue: number;
};

export type ReservationHistoryStats = {
  total: number;
  completed: number;
  completedToday: number;
};

/**
 * Dashboard figures. Derived from whatever rows are loaded, so they always
 * agree with what the tables show.
 *
 * "Today" deliberately uses `updated_at` (when the kitchen actually flipped the
 * order to served) rather than `created_at`. An order placed at 11pm last night
 * and served at midnight belongs to today's numbers, not yesterday's.
 */
export function computeOrderHistoryStats(
  rows: OrderHistoryRow[],
  now = new Date(),
): OrderHistoryStats {
  const stats: OrderHistoryStats = {
    total: 0,
    served: 0,
    servedToday: 0,
    revenue: 0,
  };
  for (const order of rows) {
    if (!HISTORY_ORDER_STATUSES.includes(order.status)) continue;
    stats.total += 1;
    if (order.status !== "served") continue;
    stats.served += 1;
    stats.revenue += Number(order.total || 0);
    if (isSameLocalDay(order.updated_at ?? order.created_at, now)) {
      stats.servedToday += 1;
    }
  }
  return stats;
}

export function computeReservationHistoryStats(
  rows: ReservationHistoryRow[],
  now = new Date(),
): ReservationHistoryStats {
  const stats: ReservationHistoryStats = {
    total: 0,
    completed: 0,
    completedToday: 0,
  };
  for (const r of rows) {
    if (!HISTORY_RESERVATION_STATUSES.includes(r.status)) continue;
    stats.total += 1;
    if (r.status !== "completed") continue;
    stats.completed += 1;
    if (isSameLocalDay(reservationClosedAt(r) ?? r.created_at, now)) {
      stats.completedToday += 1;
    }
  }
  return stats;
}

/* ------------------------------------------------------------------ */
/* Completion timestamps & actors                                      */
/* ------------------------------------------------------------------ */

/**
 * When a reservation reached its final state. The lifecycle migration records
 * each stage in its own column; the fallbacks keep the column populated even
 * before those migrations are applied.
 */
export function reservationClosedAt(
  reservation: ReservationHistoryRow,
): string | null {
  switch (reservation.status) {
    case "completed":
      return (
        reservation.completed_at ??
        reservation.updated_at ??
        reservation.created_at
      );
    case "done_eating":
      return (
        reservation.done_eating_at ??
        reservation.updated_at ??
        reservation.created_at
      );
    default:
      return reservation.updated_at ?? reservation.created_at;
  }
}

/** The staff/admin who performed the step that closed the reservation. */
export function reservationProcessedBy(
  reservation: ReservationHistoryRow,
): string | null {
  switch (reservation.status) {
    case "completed":
      return reservation.completed_by ?? null;
    case "done_eating":
      return reservation.done_eating_by ?? null;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

/**
 * Quote a CSV field.
 *
 * Two threats are handled here:
 *  - Standard quoting so commas, quotes and newlines inside a value cannot
 *    break the row apart.
 *  - Spreadsheet *formula injection*: a value beginning with `=`, `+`, `-`,
 *    `@`, tab or carriage return is interpreted as a formula by Excel/Sheets
 *    (the classic `=HYPERLINK(...)` exfiltration trick). Such values are
 *    prefixed with a single quote so they render as inert text. Customer names
 *    and special requests are free-text, so this is a real exposure.
 */
function historyCsvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  const neutralised = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${neutralised.replace(/"/g, '""')}"`;
}

function csvLines(
  header: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const lines = [
    header.map(historyCsvCell).join(","),
    ...rows.map((row) => row.map(historyCsvCell).join(",")),
  ];
  // BOM so Excel detects UTF-8 and keeps the peso sign intact.
  return `\uFEFF${lines.join("\r\n")}`;
}

/** Staff-facing CSV for a filtered slice of order history. */
export function ordersToCsv(rows: OrderHistoryRow[]): string {
  return csvLines(
    [
      "Order ID",
      "Order Date & Time",
      "Customer",
      "Phone",
      "Order Type",
      "Items",
      "Subtotal",
      "Service Charge",
      "Tax",
      "Discount",
      "Total",
      "Payment Method",
      "Payment Status",
      "Final Status",
      "Processed By",
      "Notes",
    ],
    rows.map((order) => {
      const payment = derivePaymentStatus(order.payments);
      return [
        `#${order.order_number}`,
        formatDateTime(order.created_at),
        order.customers?.name ?? "Walk-in",
        order.customers?.phone ?? "",
        ORDER_TYPE_LABEL[order.type],
        order.order_items.length,
        order.subtotal,
        order.service_charge,
        order.tax,
        order.discount,
        order.total,
        paymentMethodSummary(order.payments),
        payment === "paid" ? "Paid" : "Unpaid",
        ORDER_STATUS_LABEL[order.status],
        order.processed_by_name ?? "",
        order.special_instructions ?? "",
      ];
    }),
  );
}

/** Staff-facing CSV for a filtered slice of reservation history. */
export function reservationsToHistoryCsv(rows: ReservationHistoryRow[]): string {
  return csvLines(
    [
      "Reservation Code",
      "Customer",
      "Phone",
      "Reservation Date",
      "Reservation Time",
      "Party Size",
      "Table",
      "Seating Area",
      "Final Status",
      "Completion Date & Time",
      "Processed By",
      "Special Requests",
    ],
    rows.map((r) => [
      r.code,
      r.guest_name,
      r.phone,
      formatDate(r.reserved_from),
      `${formatTime(r.reserved_from)} – ${formatTime(r.reserved_to)}`,
      r.party_size,
      r.restaurant_tables ? `Table ${r.restaurant_tables.table_number}` : "Unassigned",
      r.restaurant_tables?.location ?? "",
      STATUS_LABEL[r.status],
      reservationClosedAt(r) ? formatDateTime(reservationClosedAt(r)!) : "",
      r.processed_by_name ?? reservationProcessedBy(r) ?? "",
      r.special_request ?? "",
    ]),
  );
}

/** Trigger a browser download for already-serialised CSV text. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

