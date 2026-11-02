"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Download, Trash2 } from "lucide-react";
import {
  useReservations,
  type ReservationDraft,
  type ReservationStatusEvent,
} from "@/hooks/use-reservations";
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  computeStats,
  downloadCsv,
  filterReservations,
  formatDate,
  formatTime,
  reservationsToCsv,
  toInputDate,
  type ReservationFilters,
} from "@/lib/reservations";
import type {
  ReservationStatus,
  ReservationWithTable,
} from "@/types/database.types";
import { supabase } from "@/lib/supabase/client";
import { ReservationStatsCards } from "@/components/reservations/stats-cards";
import { ReservationsToolbar } from "@/components/reservations/toolbar";
import { ReservationsTableView } from "@/components/reservations/table-view";
import { ReservationsPagination } from "@/components/reservations/pagination";
import { ReservationFormModal } from "@/components/reservations/form-modal";
import { ReservationDetailsDrawer } from "@/components/reservations/details-drawer";
import { TableAssignmentDialog } from "@/components/reservations/table-assignment-dialog";
import { ReservationConfirmDialog } from "@/components/reservations/confirm-dialog";
import {
  ReservationsEmptyState,
  ReservationsErrorState,
  ReservationsNoResults,
  ReservationsSkeleton,
} from "@/components/reservations/states";

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  action: () => Promise<void>;
};

type FormState = {
  open: boolean;
  mode: "create" | "edit";
  reservation: ReservationWithTable | null;
};

const CLOSED_FORM: FormState = {
  open: false,
  mode: "create",
  reservation: null,
};

export default function ReservationsPage() {
  return (
    <Suspense
      fallback={<div className="bo-loading">Loading reservations…</div>}
    >
      <ReservationsDashboard />
    </Suspense>
  );
}

function ReservationsDashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    reservations,
    tables,
    loading,
    error,
    mutating,
    reload,
    createReservation,
    updateReservation,
    transitionReservation,
    assignTable,
    fetchHistory,
  } = useReservations();

  const [filters, setFilters] = useState<ReservationFilters>(() => ({
    ...DEFAULT_FILTERS,
    search: searchParams.get("search") ?? "",
  }));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [formState, setFormState] = useState<FormState>(CLOSED_FORM);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [assignTargetId, setAssignTargetId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [history, setHistory] = useState<ReservationStatusEvent[]>([]);
  // Bumped after every successful transition so the audit trail refetches even
  // though the open reservation's id has not changed.
  const [historyNonce, setHistoryNonce] = useState(0);
  const [removingCancelled, setRemovingCancelled] = useState(false);

  // Deep links from the top bar: ?search= seeds search.
  useEffect(() => {
    if (searchParams.has("search")) {
      const term = searchParams.get("search") ?? "";
      setFilters((prev) =>
        prev.search === term ? prev : { ...prev, search: term },
      );
      setPage(1);
      router.replace("/reservations");
    }
  }, [searchParams, router]);

  const stats = useMemo(() => computeStats(reservations), [reservations]);
  const filtered = useMemo(
    () => filterReservations(reservations, filters),
    [reservations, filters],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Never strand the user on an empty page after filters shrink the list.
  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const startIndex = (page - 1) * pageSize;
  const pageRows = filtered.slice(startIndex, startIndex + pageSize);

  const changeFilters = useCallback((patch: Partial<ReservationFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setPage(1);
  }, []);

  // Resolve live rows so open drawers/dialogs reflect status changes.
  const detailsReservation = detailsId
    ? (reservations.find((r) => r.id === detailsId) ?? null)
    : null;
  const assignTarget = assignTargetId
    ? (reservations.find((r) => r.id === assignTargetId) ?? null)
    : null;

  useEffect(() => {
    if (detailsId && !detailsReservation) setDetailsId(null);
  }, [detailsId, detailsReservation]);
  useEffect(() => {
    if (assignTargetId && !assignTarget) setAssignTargetId(null);
  }, [assignTargetId, assignTarget]);

  // Load the audit trail for whichever reservation the drawer is showing, and
  // again after every status change so the timeline stays current. The hook
  // resolves each event's actor name; failures degrade to an empty list.
  useEffect(() => {
    if (!detailsReservation) {
      setHistory([]);
      return;
    }
    let cancelled = false;
    void fetchHistory(detailsReservation.id).then((events) => {
      if (!cancelled) setHistory(events);
    });
    return () => {
      cancelled = true;
    };
  }, [detailsReservation?.id, historyNonce, fetchHistory]);

  const busy = mutating || busyId !== null;

  const runTransition = useCallback(
    async (
      reservation: ReservationWithTable,
      to: ReservationStatus,
      successMessage: string,
    ): Promise<boolean> => {
      setBusyId(reservation.id);
      try {
        const result = await transitionReservation(reservation, to);
        if (result.ok) {
          toast.success(successMessage);
          setHistoryNonce((n) => n + 1);
        } else {
          toast.error(
            result.message ?? "We couldn't update the reservation.",
          );
        }
        return result.ok;
      } finally {
        setBusyId(null);
      }
    },
    [transitionReservation],
  );

  const handleView = useCallback((reservation: ReservationWithTable) => {
    setDetailsId(reservation.id);
  }, []);

  const handleEdit = useCallback((reservation: ReservationWithTable) => {
    setDetailsId(null);
    setFormState({ open: true, mode: "edit", reservation });
  }, []);

  const handleConfirm = useCallback(
    (reservation: ReservationWithTable) => {
      void runTransition(
        reservation,
        "confirmed",
        `Reservation ${reservation.code} confirmed.`,
      );
    },
    [runTransition],
  );

  const handleArrived = useCallback(
    (reservation: ReservationWithTable) => {
      void runTransition(
        reservation,
        "arrived",
        "Customer arrival confirmed successfully.",
      );
    },
    [runTransition],
  );

  const handleSeat = useCallback(
    (reservation: ReservationWithTable) => {
      // Seating requires a table. Send staff straight to the assignment picker
      // instead of letting the server reject the click.
      if (!reservation.table_id) {
        setDetailsId(null);
        setAssignTargetId(reservation.id);
        toast.message("Assign a table before seating this reservation.");
        return;
      }
      const where = reservation.restaurant_tables
        ? `Table ${reservation.restaurant_tables.table_number}`
        : "their table";
      void runTransition(
        reservation,
        "seated",
        `Guest has been seated successfully at ${where}.`,
      );
    },
    [runTransition],
  );

  const handleDoneEating = useCallback(
    (reservation: ReservationWithTable) => {
      // Staff action frees the table: it reads Available again on the Tables
      // page, the dashboard floor and the customer booking wizard.
      const where = reservation.restaurant_tables
        ? `Table ${reservation.restaurant_tables.table_number} is available again`
        : "The table is available again";
      void runTransition(
        reservation,
        "done_eating",
        `Customer is done eating. ${where}.`,
      );
    },
    [runTransition],
  );

  /**
   * The final step. Explicit confirmation dialog required, and the message
   * says plainly that the reservation leaves this list — staff must not be
   * surprised by a row disappearing.
   */
  const handleComplete = useCallback(
    (reservation: ReservationWithTable) => {
      setDetailsId(null);
      setConfirmState({
        title: "Complete and move to Order History?",
        message: `${reservation.guest_name}'s reservation (${reservation.code}) will be marked Completed and moved to Order History. Reservation details, order items and payment records are preserved. This cannot be undone.`,
        confirmLabel: "Complete & move",
        cancelLabel: "Not yet",
        action: async () => {
          const ok = await runTransition(
            reservation,
            "completed",
            "Reservation completed and moved to Order History.",
          );
          if (ok) setConfirmState(null);
        },
      });
    },
    [runTransition],
  );

  const handleCancel = useCallback(
    (reservation: ReservationWithTable) => {
      setDetailsId(null);
      setConfirmState({
        title: "Cancel this reservation?",
        message: `${reservation.guest_name}'s booking (${reservation.code}) on ${formatDate(reservation.reserved_from)} at ${formatTime(reservation.reserved_from)} will be cancelled and the table released. This cannot be undone.`,
        confirmLabel: "Cancel reservation",
        cancelLabel: "Keep reservation",
        action: async () => {
          const ok = await runTransition(
            reservation,
            "cancelled",
            `Reservation ${reservation.code} cancelled.`,
          );
          if (ok) setConfirmState(null);
        },
      });
    },
    [runTransition],
  );

  const handleNoShow = useCallback(
    (reservation: ReservationWithTable) => {
      setDetailsId(null);
      setConfirmState({
        title: "Mark as no-show?",
        message: `${reservation.guest_name} (${reservation.code}) will be recorded as a no-show for the ${formatTime(reservation.reserved_from)} booking.`,
        confirmLabel: "Mark no-show",
        cancelLabel: "Back",
        action: async () => {
          const ok = await runTransition(
            reservation,
            "no_show",
            `Reservation ${reservation.code} marked as no-show.`,
          );
          if (ok) setConfirmState(null);
        },
      });
    },
    [runTransition],
  );

  const handleAssignTable = useCallback(
    (reservation: ReservationWithTable) => {
      setDetailsId(null);
      setAssignTargetId(reservation.id);
    },
    [],
  );

  const handleAssign = useCallback(
    async (reservationId: string, tableId: string | null): Promise<boolean> => {
      setBusyId(reservationId);
      try {
        const result = await assignTable(reservationId, tableId);
        if (result.ok) {
          toast.success(
            tableId
              ? `Table assigned to reservation ${result.data?.code ?? ""}.`
              : `Table assignment removed from ${result.data?.code ?? "the reservation"}.`,
          );
          setAssignTargetId(null);
        } else {
          toast.error(
            result.message ?? "We couldn't update the table assignment.",
          );
        }
        return result.ok;
      } finally {
        setBusyId(null);
      }
    },
    [assignTable],
  );

  const handleSubmit = useCallback(
    async (
      draft: ReservationDraft,
      mode: "create" | "edit",
      reservationId?: string,
    ): Promise<{ ok: boolean; message?: string }> => {
      if (mode === "create") {
        const result = await createReservation(draft);
        if (result.ok) {
          toast.success(
            `Reservation ${result.data?.code ?? ""} created for ${draft.guest_name}.`,
          );
          setFormState(CLOSED_FORM);
        }
        return { ok: result.ok, message: result.message };
      }

      const expectedStatus: ReservationStatus =
        formState.reservation?.status ?? "pending";
      const result = await updateReservation(
        reservationId ?? formState.reservation?.id ?? "",
        draft,
        [expectedStatus],
      );
      if (result.ok) {
        toast.success(`Reservation ${result.data?.code ?? ""} updated.`);
        setFormState(CLOSED_FORM);
      }
      return { ok: result.ok, message: result.message };
    },
    [createReservation, updateReservation, formState.reservation],
  );

  const handleExport = useCallback(() => {
    if (filtered.length === 0) {
      toast.message("There's nothing to export with the current filters.");
      return;
    }
    downloadCsv(
      `reservations-${toInputDate(new Date())}.csv`,
      reservationsToCsv(filtered),
    );
    toast.success(
      `Exported ${filtered.length} reservation${filtered.length === 1 ? "" : "s"} to CSV.`,
    );
  }, [filtered]);

  const handleRemoveCancelledReservations = useCallback(() => {
    setConfirmState({
      title: "Remove cancelled reservations?",
      message:
        "Remove all cancelled reservations? This cannot be undone.",
      confirmLabel: "Remove cancelled",
      cancelLabel: "Keep reservations",
      action: async () => {
        setRemovingCancelled(true);
        try {
          const { error } = await supabase
            .from("reservations")
            .delete()
            .eq("status", "cancelled");
          if (error) throw error;
          await reload();
          toast.success("Cancelled reservations removed.");
        } catch {
          toast.error("Failed to remove cancelled reservations.");
        } finally {
          setRemovingCancelled(false);
          setConfirmState(null);
        }
      },
    });
  }, [reload]);

  const actionHandlers = {
    busy,
    onView: handleView,
    onEdit: handleEdit,
    onConfirm: handleConfirm,
    onArrived: handleArrived,
    onSeat: handleSeat,
    onDoneEating: handleDoneEating,
    onComplete: handleComplete,
    onCancel: handleCancel,
    onNoShow: handleNoShow,
    onAssignTable: handleAssignTable,
  };

  const countLabel = loading
    ? "Loading…"
    : filtered.length === reservations.length
      ? `${reservations.length} reservation${reservations.length === 1 ? "" : "s"}`
      : `Showing ${filtered.length} of ${reservations.length}`;

  return (
    <div className="res-page">
      <header className="res-header">
        <div className="res-header-copy">
          <h1>Reservations</h1>
          <p>
            Manage bookings, guest information, table assignments, and
            reservation status.
          </p>
        </div>
        <div className="res-header-actions">
          <span className="res-count-chip" title="Reservations loaded">
            <CalendarDays size={13} aria-hidden="true" />
            {countLabel}
          </span>
          <button
            type="button"
            className="btn-ghost"
            onClick={handleExport}
            disabled={loading || reservations.length === 0}
          >
            <Download size={14} aria-hidden="true" /> Export CSV
          </button>
          <button
            type="button"
            className="btn-ghost danger"
            onClick={handleRemoveCancelledReservations}
            disabled={removingCancelled}
            aria-label="Remove cancelled reservations"
          >
            <Trash2 size={14} />
            {removingCancelled ? "Removing…" : "Remove cancelled"}
          </button>
        </div>
      </header>

      <ReservationStatsCards stats={stats} loading={loading} />

      <ReservationsToolbar
        filters={filters}
        onChange={changeFilters}
        onClear={clearFilters}
        tables={tables}
      />

      {loading ? (
        <ReservationsSkeleton />
      ) : error && reservations.length === 0 ? (
        <ReservationsErrorState
          message={error}
          onRetry={() => void reload()}
        />
      ) : filtered.length === 0 ? (
        activeFilterCount(filters) > 0 ? (
          <ReservationsNoResults hasFilters onClear={clearFilters} />
        ) : (
          <ReservationsEmptyState />
        )
      ) : (
        <>
          <ReservationsTableView
            rows={pageRows}
            busyId={busyId}
            handlers={actionHandlers}
            onOpenDetails={handleView}
          />
          <ReservationsPagination
            page={page}
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

      {error && reservations.length > 0 ? (
        <div className="res-inline-notice" role="status">
          <span>{error}</span>
          <button type="button" onClick={() => void reload(true)}>
            Retry
          </button>
        </div>
      ) : null}

      <ReservationFormModal
        open={formState.open}
        mode={formState.mode}
        reservation={formState.reservation}
        tables={tables}
        reservations={reservations}
        busy={mutating}
        onClose={() => setFormState(CLOSED_FORM)}
        onSubmit={handleSubmit}
      />

      <ReservationDetailsDrawer
        open={Boolean(detailsReservation)}
        reservation={detailsReservation}
        busy={busy}
        onClose={() => setDetailsId(null)}
        onEdit={handleEdit}
        onConfirm={handleConfirm}
        onArrived={handleArrived}
        onSeat={handleSeat}
        onDoneEating={handleDoneEating}
        onComplete={handleComplete}
        onCancel={handleCancel}
        onNoShow={handleNoShow}
        onAssignTable={handleAssignTable}
        history={history}
      />

      <TableAssignmentDialog
        open={Boolean(assignTarget)}
        reservation={assignTarget}
        tables={tables}
        reservations={reservations}
        busy={mutating}
        onClose={() => setAssignTargetId(null)}
        onAssign={handleAssign}
      />

      <ReservationConfirmDialog
        open={Boolean(confirmState)}
        title={confirmState?.title ?? ""}
        message={confirmState?.message ?? ""}
        confirmLabel={confirmState?.confirmLabel ?? "Confirm"}
        cancelLabel={confirmState?.cancelLabel ?? "Cancel"}
        onConfirm={confirmState?.action ?? (() => undefined)}
        onClose={() => setConfirmState(null)}
      />
    </div>
  );
}
