import type {
  ReservationStatus,
  ReservationWithTable,
  RestaurantTable,
} from "@/types/database.types";

/* ------------------------------------------------------------------ */
/* Status vocabulary                                                   */
/* ------------------------------------------------------------------ */

export const RESERVATION_STATUSES: ReservationStatus[] = [
  "pending",
  "confirmed",
  "arrived",
  "seated",
  "done_eating",
  "completed",
  "cancelled",
  "no_show",
];

/**
 * Labels shown to staff. `confirmed` reads as "Reserved" here — the guest has
 * a booking but has not arrived yet. "Confirmed" was the old label and meant
 * "the booking is accepted", which is exactly this state, so renaming it in the
 * UI keeps the meaning and matches the Reserved → Arrived wording of the
 * lifecycle.
 */
export const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: "Pending",
  confirmed: "Reserved",
  arrived: "Arrived",
  seated: "Seated",
  done_eating: "Done Eating",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No-show",
};

/** One-line explanation of each status, used in tooltips and details views. */
export const STATUS_DESCRIPTION: Record<ReservationStatus, string> = {
  pending: "Awaiting a staff decision on the booking.",
  confirmed: "Booking accepted. Waiting for the guest to arrive.",
  arrived: "Guest is at the door, ready to be seated.",
  seated: "Guest is dining. The table is occupied.",
  done_eating: "Guest has finished. The table is available again.",
  completed: "Finalized and moved to Order History.",
  cancelled: "The reservation was cancelled and the table released.",
  no_show: "The guest never arrived and the table was released.",
};

/**
 * Allowed status transitions. Enforced client-side for instant feedback and
 * re-checked server-side by the lifecycle functions, which are the source of
 * truth.
 */
export const STATUS_TRANSITIONS: Record<
  ReservationStatus,
  ReservationStatus[]
> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["arrived", "cancelled", "no_show"],
  arrived: ["seated", "cancelled", "no_show"],
  seated: ["done_eating"],
  done_eating: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

/**
 * Statuses that hold a table. Mirrors the DB `is_table_holding_status()` and
 * the exclusion constraint.
 *
 * `done_eating` is deliberately NOT included: when staff mark a guest done
 * eating, the table is released immediately — it reads Available on the Tables
 * page, the dashboard floor and the customer booking wizard, and a new booking
 * may take it (migration 20261019000000_done_eating_releases_table). Keeping
 * this list in step with the SQL matters — it drives client-side conflict
 * detection, so the two must agree on what holds a table.
 */
export const ACTIVE_STATUSES: ReservationStatus[] = [
  "pending",
  "confirmed",
  "arrived",
  "seated",
];

/**
 * Statuses visible in the active Reservations Management list.
 *
 * `completed` is deliberately absent: finishing a reservation moves it to Order
 * History, so it must leave this list. Cancelled and no-show stay visible —
 * staff still need to see and re-book a table that was given up. The record is
 * never deleted; it is filtered out of the active view and remains queryable
 * from Order History and the history drawer.
 */
export const LIVE_STATUSES: ReservationStatus[] = [
  "pending",
  "confirmed",
  "arrived",
  "seated",
  "done_eating",
  "cancelled",
  "no_show",
];

/** Statuses that appear in Order History. */
export const HISTORY_STATUSES: ReservationStatus[] = [
  "completed",
  "cancelled",
  "no_show",
];

/** True once a reservation is terminal and can no longer be acted on. */
export function isTerminalStatus(status: ReservationStatus): boolean {
  return (
    status === "completed" || status === "cancelled" || status === "no_show"
  );
}

/* ------------------------------------------------------------------ */
/* Lifecycle actions                                                   */
/* ------------------------------------------------------------------ */

/** The single forward action offered for each reservation status. */
export type LifecycleStage =
  | "confirm_booking"
  | "confirm_arrival"
  | "seat_guest"
  | "mark_done_eating"
  | "complete_reservation";

export type LifecycleAction = {
  stage: LifecycleStage;
  /** Button label. */
  label: string;
  /**
   * Shorter label for the table's Actions column, where horizontal room is
   * limited. Falls back to `label` when absent. The full `label` is still used
   * for `aria-label`/`title` and in the details drawer, so nothing is lost.
   */
  shortLabel?: string;
  /** Longer description for tooltips and the details drawer. */
  description: string;
  /** Toast shown on success. */
  successMessage: string;
  /** True when the user must confirm first. */
  requiresConfirmation: boolean;
  /** Modal title when `requiresConfirmation` is true. */
  confirmTitle?: string;
  /** Modal body when `requiresConfirmation` is true. */
  confirmMessage?: string;
  /** Label on the confirm button. */
  confirmLabel?: string;
};

/**
 * The one action each status advances to. This map is the single source of
 * truth for the Actions column, the mobile cards and the details drawer, so the
 * button always matches the reservation's real status.
 */
export const LIFECYCLE_ACTIONS: Partial<
  Record<ReservationStatus, LifecycleAction>
> = {
  pending: {
    stage: "confirm_booking",
    label: "Confirm Booking",
    description: "Accept this pending booking so the guest can be checked in.",
    successMessage: "Reservation confirmed. The booking is now Reserved.",
    requiresConfirmation: false,
  },
  confirmed: {
    stage: "confirm_arrival",
    label: "Confirm Arrival",
    description: "The guest has arrived at the restaurant.",
    successMessage: "Customer arrival confirmed successfully.",
    requiresConfirmation: false,
  },
  arrived: {
    stage: "seat_guest",
    label: "Seat Guest",
    description: "Seat the guest at their assigned table.",
    successMessage: "Guest has been seated successfully.",
    requiresConfirmation: false,
  },
  seated: {
    stage: "mark_done_eating",
    label: "Done Eating",
    description:
      "The guest has finished dining. The table becomes available again.",
    successMessage:
      "Customer marked as done eating. Table is now available.",
    requiresConfirmation: false,
  },
  done_eating: {
    stage: "complete_reservation",
    label: "Complete & Move to Order History",
    // "Complete & Move to Order History" is far wider than the Actions column,
    // which pushed it over the Status badge. The full wording stays on
    // aria-label/title and in the confirmation dialog.
    shortLabel: "Complete",
    description: "Finalize this reservation and move it to Order History.",
    successMessage: "Reservation completed and moved to Order History.",
    requiresConfirmation: true,
    confirmTitle: "Complete this reservation?",
    confirmMessage:
      "This moves the reservation to Order History. It can no longer be changed, and the action cannot be undone.",
    confirmLabel: "Complete reservation",
  },
};

/**
 * The action for a status, or null for terminal statuses where no forward
 * action is offered (Completed, Cancelled, No-show).
 */
export function getLifecycleAction(
  status: ReservationStatus,
): LifecycleAction | null {
  return LIFECYCLE_ACTIONS[status] ?? null;
}

/** True when the status has a forward lifecycle action to show. */
export function hasLifecycleAction(status: ReservationStatus): boolean {
  return getLifecycleAction(status) !== null;
}

export function canTransition(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  return STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/* ------------------------------------------------------------------ */
/* Date / time helpers                                                 */
/* ------------------------------------------------------------------ */

/** Standard reservation length, matching the public booking wizard (2h). */
export const RESERVATION_DURATION_MS = 2 * 60 * 60 * 1000;

export function reservationEnd(start: Date): Date {
  return new Date(start.getTime() + RESERVATION_DURATION_MS);
}

/** Combine yyyy-mm-dd + HH:mm form values into a local Date. */
export function combineDateTime(date: string, time: string): Date | null {
  if (!date || !time) return null;
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function startOfLocalDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate());
}

export function endOfLocalDay(day: Date): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
}

export function isSameLocalDay(value: string, day: Date): boolean {
  const date = new Date(value);
  return (
    date.getFullYear() === day.getFullYear() &&
    date.getMonth() === day.getMonth() &&
    date.getDate() === day.getDate()
  );
}

export function formatTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatShortDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** e.g. "Mar 5 · 7:30 PM – 9:30 PM" */
export function formatDateTimeRange(from: string, to: string): string {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (isSameLocalDay(from, toDate)) {
    return `${formatShortDate(fromDate)} · ${formatTime(fromDate)} – ${formatTime(toDate)}`;
  }
  return `${formatShortDate(fromDate)} ${formatTime(fromDate)} – ${formatShortDate(toDate)} ${formatTime(toDate)}`;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${formatShortDate(date)} · ${formatTime(date)}`;
}

/** yyyy-mm-dd for populating <input type="date"> in local time. */
export function toInputDate(value: Date): string {
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** HH:mm for populating <input type="time"> in local time. */
export function toInputTime(value: Date): string {
  return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
}

/** Time slots offered to staff, every 15 minutes between 11:00 and 23:45. */
export const TIME_SLOTS: string[] = (() => {
  const slots: string[] = [];
  for (let minutes = 11 * 60; minutes <= 23 * 60 + 45; minutes += 15) {
    slots.push(
      `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`,
    );
  }
  return slots;
})();

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type ReservationFormValues = {
  guest_name: string;
  phone: string;
  email: string;
  date: string;
  time: string;
  party_size: string;
  table_id: string;
  special_request: string;
  status: ReservationStatus;
};

export type ReservationFormErrors = Partial<
  Record<keyof ReservationFormValues, string>
>;

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function isValidPhone(phone: string): boolean {
  const trimmed = phone.trim();
  if (!/^\+?[\d\s\-().]+$/.test(trimmed)) return false;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export function parsePartySize(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const size = Number(value);
  return Number.isInteger(size) && size >= 1 && size <= 20 ? size : null;
}

/**
 * Validate the reservation form. `context.reservations` is the locally loaded
 * dataset used to pre-check table conflicts; the database re-validates on
 * write through its exclusion constraint.
 */
export function validateReservationForm(
  values: ReservationFormValues,
  context: {
    reservations: ReservationWithTable[];
    tables: RestaurantTable[];
    excludeReservationId?: string;
    now?: Date;
  },
): ReservationFormErrors {
  const errors: ReservationFormErrors = {};
  const now = context.now ?? new Date();

  const name = values.guest_name.trim();
  if (!name) errors.guest_name = "Customer name is required.";
  else if (name.length < 2)
    errors.guest_name = "Customer name must be at least 2 characters.";
  else if (name.length > 80)
    errors.guest_name = "Customer name must be 80 characters or fewer.";

  const phone = values.phone.trim();
  if (!phone) errors.phone = "Phone number is required.";
  else if (!isValidPhone(phone))
    errors.phone = "Enter a valid phone number (7–15 digits).";

  const email = values.email.trim();
  if (email && !EMAIL_RE.test(email))
    errors.email = "Enter a valid email address or leave it empty.";

  const partySize = parsePartySize(values.party_size);
  if (!values.party_size.trim()) errors.party_size = "Party size is required.";
  else if (partySize === null)
    errors.party_size = "Party size must be a whole number between 1 and 20.";

  const start = combineDateTime(values.date, values.time);
  if (!values.date) errors.date = "Reservation date is required.";
  if (!values.time) errors.time = "Reservation time is required.";
  if (start && start.getTime() <= now.getTime())
    errors.time = "Reservation time must be in the future.";

  if (values.table_id && start && partySize !== null && !errors.time) {
    const end = reservationEnd(start);
    const table = context.tables.find((t) => t.id === values.table_id);
    const conflict = findTableConflict(
      values.table_id,
      start,
      end,
      context.reservations,
      context.excludeReservationId,
    );
    if (!table) {
      errors.table_id = "Selected table no longer exists.";
    } else if (table.status === "out_of_service") {
      errors.table_id = `Table ${table.table_number} is out of service.`;
    } else if (conflict) {
      errors.table_id = `Table ${table.table_number} is already booked from ${formatTime(conflict.reserved_from)} to ${formatTime(conflict.reserved_to)}.`;
    }
  }

  return errors;
}

/* ------------------------------------------------------------------ */
/* Table availability                                                  */
/* ------------------------------------------------------------------ */

export function rangesOverlap(
  aFrom: Date,
  aTo: Date,
  bFrom: Date,
  bTo: Date,
): boolean {
  return aFrom.getTime() < bTo.getTime() && bFrom.getTime() < aTo.getTime();
}

export function findTableConflict(
  tableId: string,
  start: Date,
  end: Date,
  reservations: ReservationWithTable[],
  excludeReservationId?: string,
): ReservationWithTable | null {
  return (
    reservations.find(
      (r) =>
        r.table_id === tableId &&
        r.id !== excludeReservationId &&
        ACTIVE_STATUSES.includes(r.status) &&
        rangesOverlap(
          start,
          end,
          new Date(r.reserved_from),
          new Date(r.reserved_to),
        ),
    ) ?? null
  );
}

export type TableAvailabilityState =
  | "available"
  | "conflict"
  | "out_of_service"
  | "undersized";

export type TableAvailability = {
  table: RestaurantTable;
  state: TableAvailabilityState;
  conflict?: ReservationWithTable;
};

/**
 * Evaluate every table for a given reservation window. Tables that clash with
 * an active reservation are marked `conflict`; tables smaller than the party
 * are `undersized` (selectable, but the UI warns staff).
 */
export function getTableAvailability(options: {
  tables: RestaurantTable[];
  reservations: ReservationWithTable[];
  start: Date | null;
  end: Date | null;
  partySize: number | null;
  excludeReservationId?: string;
}): TableAvailability[] {
  return options.tables.map((table) => {
    if (table.status === "out_of_service") {
      return { table, state: "out_of_service" as const };
    }
    if (options.start && options.end) {
      const conflict = findTableConflict(
        table.id,
        options.start,
        options.end,
        options.reservations,
        options.excludeReservationId,
      );
      if (conflict) return { table, state: "conflict" as const, conflict };
    }
    if (options.partySize !== null && table.capacity < options.partySize) {
      return { table, state: "undersized" as const };
    }
    return { table, state: "available" as const };
  });
}

export function tableLabel(
  table: Pick<RestaurantTable, "table_number" | "location"> | null | undefined,
): string {
  if (!table) return "Unassigned";
  return `Table ${table.table_number}`;
}

/* ------------------------------------------------------------------ */
/* CSV export                                                          */
/* ------------------------------------------------------------------ */

function csvCell(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

export function reservationsToCsv(rows: ReservationWithTable[]): string {
  const header = [
    "Code",
    "Customer",
    "Phone",
    "Email",
    "Date",
    "Time",
    "Party Size",
    "Table",
    "Status",
    "Special Requests",
    "Created At",
  ];
  const lines = rows.map((r) =>
    [
      csvCell(r.code),
      csvCell(r.guest_name),
      csvCell(r.phone),
      csvCell(r.email),
      csvCell(formatDate(r.reserved_from)),
      csvCell(`${formatTime(r.reserved_from)} – ${formatTime(r.reserved_to)}`),
      csvCell(r.party_size),
      csvCell(tableLabel(r.restaurant_tables)),
      csvCell(STATUS_LABEL[r.status]),
      csvCell(r.special_request),
      csvCell(formatDateTime(r.created_at)),
    ].join(","),
  );
  // BOM so Excel detects UTF-8.
  return `\uFEFF${[header.map(csvCell).join(","), ...lines].join("\r\n")}`;
}

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

/* ------------------------------------------------------------------ */
/* Filtering / sorting                                                 */
/* ------------------------------------------------------------------ */

export type ReservationSortKey =
  | "reserved_from_desc"
  | "reserved_from_asc"
  | "guest_name_asc"
  | "created_at_desc";

export const SORT_OPTIONS: { value: ReservationSortKey; label: string }[] = [
  { value: "reserved_from_desc", label: "Reservation date (newest)" },
  { value: "reserved_from_asc", label: "Reservation date (soonest)" },
  { value: "guest_name_asc", label: "Customer name (A–Z)" },
  { value: "created_at_desc", label: "Date created (newest)" },
];

export type ReservationFilters = {
  search: string;
  status: string;
  date: string;
  party: string;
  table: string;
  sort: ReservationSortKey;
};

export const DEFAULT_FILTERS: ReservationFilters = {
  search: "",
  status: "all",
  date: "",
  party: "all",
  table: "all",
  sort: "reserved_from_desc",
};

export function activeFilterCount(filters: ReservationFilters): number {
  let count = 0;
  if (filters.search.trim()) count += 1;
  if (filters.status !== "all") count += 1;
  if (filters.date) count += 1;
  if (filters.party !== "all") count += 1;
  if (filters.table !== "all") count += 1;
  return count;
}

function partyMatches(partySize: number, bucket: string): boolean {
  switch (bucket) {
    case "1-2":
      return partySize <= 2;
    case "3-4":
      return partySize >= 3 && partySize <= 4;
    case "5-6":
      return partySize >= 5 && partySize <= 6;
    case "7+":
      return partySize >= 7;
    default:
      return true;
  }
}

export function filterReservations(
  rows: ReservationWithTable[],
  filters: ReservationFilters,
): ReservationWithTable[] {
  const term = filters.search.trim().toLowerCase();

  const filtered = rows.filter((r) => {
    if (term) {
      const haystack = `${r.code} ${r.guest_name} ${r.phone}`.toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    // A completed reservation has moved to Order History, so it leaves the
    // active list. An explicit status filter still wins: picking "Completed"
    // from the dropdown must show completed rows, otherwise that filter would
    // be a dead option that always returns nothing.
    if (filters.status !== "all") {
      if (r.status !== filters.status) return false;
    } else if (!LIVE_STATUSES.includes(r.status)) {
      return false;
    }
    if (
      filters.date &&
      !isSameLocalDay(r.reserved_from, new Date(`${filters.date}T12:00:00`))
    )
      return false;
    if (filters.party !== "all" && !partyMatches(r.party_size, filters.party))
      return false;
    if (filters.table !== "all") {
      if (filters.table === "unassigned" && r.table_id !== null) return false;
      if (filters.table !== "unassigned" && r.table_id !== filters.table)
        return false;
    }
    return true;
  });

  const sorted = [...filtered];
  switch (filters.sort) {
    case "reserved_from_asc":
      sorted.sort(
        (a, b) =>
          new Date(a.reserved_from).getTime() -
          new Date(b.reserved_from).getTime(),
      );
      break;
    case "guest_name_asc":
      sorted.sort((a, b) => a.guest_name.localeCompare(b.guest_name));
      break;
    case "created_at_desc":
      sorted.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      );
      break;
    default:
      sorted.sort(
        (a, b) =>
          new Date(b.reserved_from).getTime() -
          new Date(a.reserved_from).getTime(),
      );
  }
  return sorted;
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

export type ReservationStats = {
  total: number;
  pending: number;
  reserved: number;
  arrived: number;
  seated: number;
  doneEating: number;
  completed: number;
  cancelled: number;
  noShow: number;
  today: number;
};

export const EMPTY_STATS: ReservationStats = {
  total: 0,
  pending: 0,
  reserved: 0,
  arrived: 0,
  seated: 0,
  doneEating: 0,
  completed: 0,
  cancelled: 0,
  noShow: 0,
  today: 0,
};

export function computeStats(
  rows: ReservationWithTable[],
  now = new Date(),
): ReservationStats {
  const stats = { ...EMPTY_STATS, total: rows.length };
  for (const r of rows) {
    switch (r.status) {
      case "pending":
        stats.pending += 1;
        break;
      case "confirmed":
        stats.reserved += 1;
        break;
      case "arrived":
        stats.arrived += 1;
        break;
      case "seated":
        stats.seated += 1;
        break;
      case "done_eating":
        stats.doneEating += 1;
        break;
      case "completed":
        stats.completed += 1;
        break;
      case "cancelled":
        stats.cancelled += 1;
        break;
      case "no_show":
        stats.noShow += 1;
        break;
    }
    // "Today" counts bookings scheduled today that are still live on the floor:
    // reserved through done eating. A done-eating guest is still occupying the
    // table, so it counts; completed, cancelled and no-shows do not.
    if (
      isSameLocalDay(r.reserved_from, now) &&
      r.status !== "cancelled" &&
      r.status !== "no_show" &&
      r.status !== "completed"
    ) {
      stats.today += 1;
    }
  }
  return stats;
}
