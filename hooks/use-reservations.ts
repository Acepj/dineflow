"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import type {
  Reservation,
  ReservationStatus,
  ReservationWithTable,
  RestaurantTable,
} from "@/types/database.types";
import {
  STATUS_TRANSITIONS,
  canTransition,
  type LifecycleStage,
} from "@/lib/reservations";
import { getDemoSession } from "@/lib/auth/demo";

const RESERVATION_SELECT =
  "*, restaurant_tables(table_number, capacity, location)";

export type ReservationDraft = {
  guest_name: string;
  phone: string;
  email: string | null;
  date: string;
  time: string;
  party_size: number;
  table_id: string | null;
  special_request: string | null;
  status: ReservationStatus;
};

export type MutationResult = {
  ok: boolean;
  data?: ReservationWithTable;
  message?: string;
};

/** One row of the reservation audit trail, with the actor's name resolved. */
export type ReservationStatusEvent = {
  event_id: string;
  previous_status: string | null;
  new_status: string;
  action: string;
  performed_by: string | null;
  performed_by_name: string | null;
  created_at: string;
};

/** Translate Postgres / RLS errors into messages staff can act on. */
function mapWriteError(
  err: { code?: string | null; message?: string | null } | null,
  fallback: string,
): string {
  if (!err) return fallback;
  const message = err.message ?? "";
  if (
    err.code === "23P01" ||
    message.includes("no_overlapping_reservations") ||
    message.includes("overlapping")
  ) {
    return "That table is already booked for an overlapping time slot. Pick another table or time.";
  }
  if (err.code === "23505" && message.includes("idx_unique_phone_window")) {
    return "This phone number already has an active booking in that time window.";
  }
  if (err.code === "23505" && message.includes("code")) {
    return "Generated a duplicate reservation code. Please try again.";
  }
  if (err.code === "23514") {
    return "The reservation data violates a database rule (name, party size, email or time window).";
  }
  if (err.code === "42501" || message.includes("row-level security")) {
    return "You don't have permission to change reservations with this account.";
  }
  return fallback;
}

/**
 * Translate a lifecycle RPC error into a message staff can act on. The server
 * functions raise their own business-rule messages, so those are surfaced
 * verbatim rather than being replaced with generic text.
 */
function mapLifecycleError(
  err: { code?: string | null; message?: string | null } | null,
  fallback: string,
): string {
  if (!err) return fallback;
  const code = err.code;
  const message = err.message ?? "";

  // 42501 = our own authorization raise, and RLS failures.
  if (code === "42501" || message.includes("row-level security")) {
    return "You don't have permission to change reservations with this account.";
  }
  // P0002 = the reservation or table no longer exists.
  if (code === "P0002") {
    return "That record no longer exists. The list has been refreshed.";
  }
  // 23P01 = the exclusion constraint caught a table clash.
  if (code === "23P01" || message.includes("no_overlapping_reservations")) {
    return "This table is currently occupied by another reservation in that time slot.";
  }
  // 22023 = our transition/business-rule raises. These messages are written for
  // staff, so show them as-is.
  if (code === "22023") return message || fallback;

  return message || fallback;
}
/**
 * Maps each lifecycle target status to the server function that performs it.
 * Keeping this as a table (rather than a switch inline) makes the
 * client/server contract obvious: a status with no entry has no server-side
 * operation, so the UI must not offer a button for it.
 *
 * `cancelled` and `no_show` are reached through `cancelReservation()` /
 * `markNoShow()`, which call `close_reservation()` directly; they are listed
 * here only so `transitionReservation()` can never be handed a terminal status
 * without a known endpoint.
 */
const LIFECYCLE_RPC: Partial<
  Record<
    ReservationStatus,
    {
      name: string;
      args: (reservation: ReservationWithTable) => Record<string, unknown>;
    }
  >
> = {
  confirmed: {
    name: "confirm_reservation_booking",
    args: (r) => ({ p_reservation_id: r.id }),
  },
  arrived: {
    name: "confirm_reservation_arrival",
    args: (r) => ({ p_reservation_id: r.id }),
  },
  seated: {
    name: "seat_reservation_guest",
    args: (r) => ({ p_reservation_id: r.id, p_table_id: r.table_id }),
  },
  done_eating: {
    name: "mark_reservation_done_eating",
    args: (r) => ({ p_reservation_id: r.id }),
  },
  completed: {
    name: "complete_reservation",
    args: (r) => ({ p_reservation_id: r.id }),
  },
  cancelled: {
    name: "close_reservation",
    args: (r) => ({ p_reservation_id: r.id, p_close_status: "cancelled" }),
  },
  no_show: {
    name: "close_reservation",
    args: (r) => ({ p_reservation_id: r.id, p_close_status: "no_show" }),
  },
};

/** Table status implied by a reservation status, or null when unchanged. */
function tableStatusFor(
  status: ReservationStatus,
): RestaurantTable["status"] | null {
  // Confirm Arrival means the guest is in the restaurant, so the table reads
  // Occupied everywhere — Tables page, dashboard floor, customer wizard.
  // Seat Guest keeps it Occupied. Mirrors confirm_reservation_arrival +
  // seat_reservation_guest, which both write `occupied` server-side.
  if (status === "arrived") return "occupied";
  if (status === "seated") return "occupied";
  // Done Eating frees the table: the guest has finished, so the table reads
  // Available again immediately — on the Tables page, the dashboard floor and
  // the customer booking wizard. Mirrors the SQL side
  // (is_table_holding_status + mark_reservation_done_eating) exactly.
  if (status === "done_eating") return "available";
  if (status === "completed") return "available";
  if (status === "cancelled" || status === "no_show") return "available";
  // pending / confirmed hold the table but do not occupy it.
  return null;
}



/**
 * The lifecycle functions are SECURITY DEFINER Postgres functions, so they
 * require a genuine Supabase JWT. The local demo sign-in stores a fake token in
 * localStorage instead of a cookie, which `createBrowserClient` does not read —
 * so in demo mode the RPC goes out unauthenticated and Postgres rejects it with
 * 401 "permission denied for function".
 *
 * Detect that case up front and explain it, rather than letting staff see a raw
 * 401 in the console with no idea what to do.
 *
 * The decisive question is whether the browser client actually holds a real
 * session — not whether the demo key is still in localStorage. Signing in with
 * a genuine staff/admin account leaves that key behind until the auth provider
 * sweeps it, and a stale key must never block a user who is really signed in.
 */
async function demoSessionBlocksWrites(): Promise<boolean> {
  if (getDemoSession() === null) return false;

  const { data } = await supabase.auth.getSession();
  return !data.session?.user;
}

/**
 * Call a lifecycle RPC and reconcile local state with the returned row.
 * Every lifecycle function returns the updated reservation, so the UI can patch
 * one row instead of re-querying the whole list.
 *
 * `onTableChange` receives the updated row and is responsible for keeping the
 * table status column in step, because the RPC may also have flipped a table to
 * occupied or back to available.
 */
async function callLifecycleRpc(
  rpc: string,
  args: Record<string, unknown>,
  setReservations: React.Dispatch<React.SetStateAction<ReservationWithTable[]>>,
  onTableChange: (row: Reservation) => void,
  fallbackMessage: string,
): Promise<MutationResult> {
  // Fail fast with a message staff can act on instead of a raw 401.
  if (await demoSessionBlocksWrites()) {
    return {
      ok: false,
      message:
        "Demo mode cannot change reservations. Sign in with a real staff or admin account.",
    };
  }

  const { data, error: rpcError } = await supabase.rpc(rpc, args);

  if (rpcError) {
    return {
      ok: false,
      message: mapLifecycleError(rpcError, fallbackMessage),
    };
  }

  const updated = (data as Reservation | Reservation[] | null) ?? null;
  const row = Array.isArray(updated) ? updated[0] : updated;
  if (!row) {
    return { ok: false, message: fallbackMessage };
  }

  // Preserve the joined table payload for the row we just changed.
  setReservations((prev) =>
    prev.map((existing) =>
      existing.id === row.id
        ? { ...existing, ...row, restaurant_tables: existing.restaurant_tables }
        : existing,
    ),
  );

  // Keep the local table status in step: seating occupies, Done Eating frees.
  onTableChange(row);

  return { ok: true, data: row as unknown as ReservationWithTable };
}


/** Local start/end (2-hour window) for a form draft. */
function windowFromDraft(draft: ReservationDraft): {
  start: Date;
  end: Date;
} {
  const start = new Date(`${draft.date}T${draft.time}:00`);
  return { start, end: new Date(start.getTime() + 2 * 60 * 60 * 1000) };
}

function draftPayload(draft: ReservationDraft) {
  const { start, end } = windowFromDraft(draft);
  return {
    guest_name: draft.guest_name.trim(),
    phone: draft.phone.trim(),
    email: draft.email?.trim() || null,
    party_size: draft.party_size,
    table_id: draft.table_id || null,
    special_request: draft.special_request?.trim() || null,
    reserved_from: start.toISOString(),
    reserved_to: end.toISOString(),
  };
}

export function useReservations() {
  const [reservations, setReservations] = useState<ReservationWithTable[]>([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);

  const reload = useCallback(async (silent = false) => {
    if (!silent) {
      setError(null);
      setLoading(true);
    }
    const [resResult, tableResult] = await Promise.all([
      supabase
        .from("reservations")
        .select(RESERVATION_SELECT)
        .order("reserved_from", { ascending: false }),
      supabase.from("restaurant_tables").select("*").order("table_number"),
    ]);

    if (resResult.error) {
      setError(
        "We couldn't load reservations. Check your connection and try again.",
      );
      if (!silent) setReservations([]);
    } else {
      setError(null);
      setReservations((resResult.data as ReservationWithTable[]) ?? []);
    }

    if (tableResult.error) {
      setError(
        "We couldn't load restaurant tables. Table availability may be incomplete.",
      );
    } else {
      setTables((tableResult.data as RestaurantTable[]) ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * Mirror the table status the server just wrote into client state.
   *
   * Each lifecycle function already updated `restaurant_tables.status` inside
   * the same transaction, so this is purely a local echo — it never decides the
   * status itself (`tableStatusFor` encodes the same rule the SQL uses). Tables
   * out of service are left alone, and a reservation's previous table is
   * reconciled by `assignTable`, which reloads the whole table list.
   */
  const syncTableStatus = useCallback((row: Reservation) => {
    const nextStatus = tableStatusFor(row.status as ReservationStatus);
    if (!nextStatus) return;

    setTables((prevTables) =>
      prevTables.map((table) =>
        table.id === row.table_id && table.status !== "out_of_service"
          ? { ...table, status: nextStatus }
          : table,
      ),
    );
  }, []);

  const createReservation = useCallback(
    async (draft: ReservationDraft): Promise<MutationResult> => {
      setMutating(true);
      try {
        const { data, error: insertError } = await supabase
          .from("reservations")
          .insert({ ...draftPayload(draft), status: draft.status })
          .select(RESERVATION_SELECT)
          .single();
        if (insertError) {
          return {
            ok: false,
            message: mapWriteError(
              insertError,
              "We couldn't save the reservation. Please try again.",
            ),
          };
        }
        const created = data as ReservationWithTable;
        setReservations((prev) =>
          [created, ...prev].sort(
            (a, b) =>
              new Date(b.reserved_from).getTime() -
              new Date(a.reserved_from).getTime(),
          ),
        );
        return { ok: true, data: created };
      } finally {
        setMutating(false);
      }
    },
    [],
  );

  const updateReservation = useCallback(
    async (
      id: string,
      draft: ReservationDraft,
      expectedStatuses: ReservationStatus[],
    ): Promise<MutationResult> => {
      setMutating(true);
      try {
        // UPDATE is restricted to authenticated staff/admin by RLS, so demo mode
        // would silently update zero rows and report a bogus "changed in the
        // meantime" conflict. Say what actually happened instead.
        if (await demoSessionBlocksWrites()) {
          return {
            ok: false,
            message:
              "Demo mode cannot edit reservations. Sign in with a real staff or admin account.",
          };
        }

        const { data, error: updateError } = await supabase
          .from("reservations")
          .update(draftPayload(draft))
          .eq("id", id)
          // Guard against concurrent status changes: only update rows still
          // in one of the expected states.
          .in("status", expectedStatuses)
          .select(RESERVATION_SELECT);
        if (updateError) {
          return {
            ok: false,
            message: mapWriteError(
              updateError,
              "We couldn't update the reservation. Please try again.",
            ),
          };
        }
        const updated = (data as ReservationWithTable[]) ?? [];
        if (updated.length === 0) {
          void reload(true);
          return {
            ok: false,
            message:
              "This reservation changed in the meantime. The list has been refreshed.",
          };
        }
        const row = updated[0];
        setReservations((prev) =>
          prev
            .map((r) => (r.id === id ? row : r))
            .sort(
              (a, b) =>
                new Date(b.reserved_from).getTime() -
                new Date(a.reserved_from).getTime(),
            ),
        );
        return { ok: true, data: row };
      } finally {
        setMutating(false);
      }
    },
    [reload],
  );

  /**
   * Advance a reservation through the service lifecycle.
   *
   * Every stage is a dedicated server-side function rather than a direct
   * `UPDATE status = …`. The functions own the authorization check, the
   * transition rules, the lifecycle timestamps, the table status changes and the
   * audit trail, and they lock the row so two staff members clicking at once
   * cannot both succeed. A direct update would flip the status label while
   * leaving `arrived_at`/`seated_at`, the table's occupied flag and the audit
   * log untouched.
   */
  const transitionReservation = useCallback(
    async (
      reservation: ReservationWithTable,
      to: ReservationStatus,
    ): Promise<MutationResult> => {
      if (!canTransition(reservation.status, to)) {
        return {
          ok: false,
          message: `A ${reservation.status.replace("_", " ")} reservation can't be moved to ${to.replace("_", " ")}.`,
        };
      }

      const rpc = LIFECYCLE_RPC[to];
      if (!rpc) {
        return {
          ok: false,
          message: `A reservation can't be moved to ${to.replace("_", " ")}.`,
        };
      }

      setMutating(true);
      try {
        return await callLifecycleRpc(
          rpc.name,
          rpc.args(reservation),
          setReservations,
          syncTableStatus,
          `We couldn't update the reservation status.`,
        );
      } finally {
        setMutating(false);
      }
    },
    [reload, syncTableStatus],
  );

  const assignTable = useCallback(
    async (
      reservationId: string,
      tableId: string | null,
    ): Promise<MutationResult> => {
      setMutating(true);
      try {
        // Routed through the server function so the overlap check, the
        // out-of-service check and the table status update happen in one
        // transaction instead of a bare UPDATE that could strand a table as
        // "reserved" after a rejected assignment.
        const result = await callLifecycleRpc(
          "assign_reservation_table",
          { p_reservation_id: reservationId, p_table_id: tableId },
          setReservations,
          syncTableStatus,
          "We couldn't update the table assignment.",
        );

        // The RPC may have changed two tables (old + new). Reload the table list
        // so the picker and the Table Management page agree with the server.
        if (result.ok) {
          const { data: freshTables } = await supabase
            .from("restaurant_tables")
            .select("*")
            .order("table_number");
          if (freshTables) setTables(freshTables as RestaurantTable[]);
        }

        return result;
      } finally {
        setMutating(false);
      }
    },
    [reload],
  );

  /**
   * Audit trail for one reservation, with the acting staff/admin resolved to a
   * name by `get_reservation_history()`. Returns [] on failure rather than
   * throwing so the details drawer keeps working if history is unavailable.
   */
  const fetchHistory = useCallback(
    async (reservationId: string): Promise<ReservationStatusEvent[]> => {
      // Same reasoning as callLifecycleRpc(): this function is authenticated-only,
      // so in demo mode skip the request entirely instead of logging a 401.
      if (await demoSessionBlocksWrites()) return [];

      const { data, error: historyError } = await supabase.rpc(
        "get_reservation_history",
        { p_reservation_id: reservationId },
      );

      if (historyError || !data) return [];
      return data as ReservationStatusEvent[];
    },
    [],
  );

  return {
    reservations,
    tables,
    loading,
    error,
    mutating,
    reload,
    fetchHistory,
    createReservation,
    updateReservation,
    transitionReservation,
    assignTable,
  };
}
