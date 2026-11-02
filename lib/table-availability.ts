import type {
  ReservationStatus,
  ResolvedTableDayStatus,
  RestaurantTable,
  TableDailyStatusValue,
} from "@/types/database.types";
import { ACTIVE_STATUSES } from "@/lib/reservations";

/* ------------------------------------------------------------------ */
/* Labels & colours                                                    */
/* ------------------------------------------------------------------ */

/** Human labels for a table's status on a chosen day. */
export const TABLE_DAY_STATUS_LABEL: Record<ResolvedTableDayStatus, string> = {
  available: "Available",
  occupied: "Occupied",
  reserved: "Reserved",
  served: "Served",
  out_of_service: "Out of service",
};

/**
 * Colours matching the floor palette. `served` gets its own teal so it reads
 * distinctly from `available` while every status is still distinguishable by
 * its text label, not colour alone.
 */
export const TABLE_DAY_STATUS_COLOR: Record<ResolvedTableDayStatus, string> = {
  available: "#6FA97F",
  occupied: "#C1584F",
  reserved: "#D9A03C",
  served: "#5FA89E",
  out_of_service: "#6B6862",
};

/**
 * The statuses staff/admin can set for a table on a specific day, in the order
 * they are offered as buttons. `out_of_service` can now be set for a single day
 * (migration 20261017000000); a permanent out-of-service flag on the physical
 * table still wins over any daily value. `served` is no longer offered as a
 * manual override.
 */
export const SETTABLE_DAY_STATUSES: TableDailyStatusValue[] = [
  "available",
  "occupied",
  "reserved",
  "out_of_service",
];

/** A reservation row reduced to just what day-availability needs. */
export type ReservationHold = {
  table_id: string | null;
  status: ReservationStatus | string;
  reserved_from: string;
  reserved_to: string;
};

/** The result of resolving one table's status for a particular day/window. */
export type ResolvedTable = {
  table: RestaurantTable;
  /** The table's status for the chosen day, after all resolution rules. */
  dayStatus: ResolvedTableDayStatus;
  /**
   * The table-holding reservation status found in the window, if any. While a
   * guest is in service (`arrived`/`seated`) it is ground truth and beats a
   * staff day override, so a live stay can never be hidden. A booking that has
   * not arrived yet (`pending`/`confirmed`) only pins the table to `reserved`,
   * and staff can still set the day's status manually.
   */
  reservationStatus: ReservationStatus | string | null;
  /**
   * How strongly the reservation(s) in this window hold the table:
   * `occupied` only when the guest is in service — an `arrived` or `seated`
   * reservation, which staff set by hand in Reservations. `null` when no
   * reservation overlaps the window. Staff UIs use this to decide when a day
   * status is locked.
   */
  holdStatus: "occupied" | "reserved" | null;
  /**
   * The staff day-override applied for this day, if any. It wins over a
   * booking that has not arrived yet (`pending`/`confirmed`, i.e. `reserved`),
   * which is how staff manually tweak a booked table's day status. A guest in
   * service (`arrived`/`seated`, i.e. an `occupied` hold) still wins over it.
   */
  override: TableDailyStatusValue | null;
};

export type ResolveTablesForDayParams = {
  tables: RestaurantTable[];
  /**
   * Reservations to consider. Filtered internally to table-holding statuses
   * and to those overlapping `[windowFrom, windowTo)`, so callers may pass a
   * generous set.
   */
  reservations: ReservationHold[];
  /** Staff day-overrides, keyed by `table_id`. */
  overrides:
    | Record<string, TableDailyStatusValue>
    | Map<string, TableDailyStatusValue>;
  /** Start of the day/window being resolved (inclusive). */
  windowFrom: Date;
  /** End of the day/window being resolved (exclusive). */
  windowTo: Date;
};

/** Does a reservation window `[from, to)` overlap `[windowFrom, windowTo)`? */
function overlaps(
  fromMs: number,
  toMs: number,
  windowFromMs: number,
  windowToMs: number,
): boolean {
  return fromMs < windowToMs && toMs > windowFromMs;
}

/**
 * Resolve each table's status for a day/window. Resolution order:
 *
 *   1. `out_of_service` on the physical table — day-independent, always wins.
 *   2. a guest actually at the table: an `arrived` or `seated` reservation —
 *      staff set these by hand in Reservations (Confirm Arrival / Seat Guest),
 *      so they are ground truth and read as `occupied`, beating a staff
 *      override so a live stay is never masked. `done_eating` holds nothing:
 *      staff marking the guest finished releases the table back to the staff
 *      override or `available`.
 *   3. a staff day-override for that table — available / occupied / reserved /
 *      served / out_of_service. It is the only thing that turns a mere booking
 *      into `occupied`: a reservation that has not arrived yet stays `reserved`
 *      and never flips on its own when its calendar day arrives — staff set
 *      that manually.
 *   4. a booking that has not arrived yet — `reserved`.
 *   5. otherwise — available.
 *
 * Keeping this in one shared function means the customer wizard and the staff
 * floor map can never disagree about what a table's status is on a given day.
 */
export function resolveTablesForDay(
  params: ResolveTablesForDayParams,
): ResolvedTable[] {
  const { tables, reservations, overrides, windowFrom, windowTo } = params;
  const fromMs = windowFrom.getTime();
  const toMs = windowTo.getTime();

  const getOverride = (id: string): TableDailyStatusValue | null =>
    overrides instanceof Map ? (overrides.get(id) ?? null) : (overrides[id] ?? null);

  // Strongest hold per table in the window: `occupied` (a guest in service)
  // beats `reserved`. `arrived` / `seated` are set by hand in Reservations
  // (Confirm Arrival / Seat Guest), so they are ground truth and read as
  // `occupied` whenever they overlap the viewed day/window — no clock check,
  // because the status change itself is the staff's manual signal. A booking
  // that has not arrived yet (`pending` / `confirmed`) reads as `reserved`.
  const hold = new Map<
    string,
    { dayStatus: "occupied" | "reserved"; status: string }
  >();
  for (const r of reservations) {
    if (!r.table_id) continue;
    if (!ACTIVE_STATUSES.includes(r.status as ReservationStatus)) continue;
    const from = new Date(r.reserved_from).getTime();
    const to = new Date(r.reserved_to).getTime();
    if (!overlaps(from, to, fromMs, toMs)) continue;

    // Confirm Arrival / Seat Guest are the staff's own hand signals, so they
    // are ground truth: an `arrived` / `seated` overlap reads as `occupied`.
    // A `done_eating` reservation is already filtered out above — marking the
    // guest finished releases the table back to Available.
    const guestInService = r.status === "arrived" || r.status === "seated";
    const dayStatus = guestInService ? "occupied" : "reserved";
    const existing = hold.get(r.table_id);
    if (!existing || existing.dayStatus !== "occupied") {
      hold.set(r.table_id, { dayStatus, status: r.status });
    }
  }

  return tables.map((table) => {
    const override = getOverride(table.id);
    const held = hold.get(table.id);

    let dayStatus: ResolvedTableDayStatus;
    if (table.status === "out_of_service") {
      dayStatus = "out_of_service";
    } else if (held?.dayStatus === "occupied") {
      // A guest is actually at the table — nothing can mask that.
      dayStatus = "occupied";
    } else if (override) {
      // Staff set this by hand for the day; it even overrides a booking that
      // has not arrived yet (`reserved`), which is how a booked table is
      // manually flipped to Occupied (or released back to Available).
      dayStatus = override;
    } else if (held) {
      dayStatus = "reserved";
    } else {
      dayStatus = "available";
    }

    return {
      table,
      dayStatus,
      reservationStatus: held ? (held.status as ReservationStatus) : null,
      holdStatus: held ? held.dayStatus : null,
      override,
    };
  });
}

/** A resolved table is bookable only when it is available and seats the party. */
export function isTableBookableForDay(
  resolved: ResolvedTable,
  partySize: number,
): boolean {
  return (
    resolved.dayStatus === "available" && resolved.table.capacity >= partySize
  );
}

/**
 * Short reason a resolved table cannot be booked, or null when it can (or when
 * it is free but merely too small — that case is called out separately so the
 * wording stays accurate).
 */
export function tableUnavailableNote(
  resolved: ResolvedTable,
  partySize: number,
): string | null {
  switch (resolved.dayStatus) {
    case "out_of_service":
      return "Out of service";
    case "occupied":
      return "Occupied that day";
    case "reserved":
      return "Reserved for this day";
    case "served":
      return "Served that day";
    case "available":
      return resolved.table.capacity < partySize
        ? "Too small for your party"
        : null;
    default:
      return null;
  }
}

