"use client";

import { useEffect, useRef, useState } from "react";
import {
  Armchair,
  Check,
  Eye,
  Grid3x3,
  History,
  MoreHorizontal,
  Pencil,
  UserCheck,
  UserX,
  Utensils,
  X,
} from "lucide-react";
import type {
  ReservationStatus,
  ReservationWithTable,
} from "@/types/database.types";
import { LIFECYCLE_ACTIONS, type LifecycleStage } from "@/lib/reservations";

type ActionIcon = typeof Eye;

/** Icon per lifecycle stage, so the button visually matches the step. */
const STAGE_ICON: Record<LifecycleStage, ActionIcon> = {
  confirm_booking: Check,
  confirm_arrival: UserCheck,
  seat_guest: Armchair,
  mark_done_eating: Utensils,
  complete_reservation: History,
};

export type ReservationAction = {
  key: string;
  label: string;
  /** Optional shorter label for space-constrained table cells. */
  shortLabel?: string;
  Icon: ActionIcon;
  danger?: boolean;
  run: (reservation: ReservationWithTable) => void;
};

export type ReservationActionHandlers = {
  busy?: boolean;
  onView: (reservation: ReservationWithTable) => void;
  onEdit: (reservation: ReservationWithTable) => void;
  onAssignTable: (reservation: ReservationWithTable) => void;
  onCancel: (reservation: ReservationWithTable) => void;
  onNoShow: (reservation: ReservationWithTable) => void;
  /** pending → confirmed ("Reserved"). */
  onConfirm: (reservation: ReservationWithTable) => void;
  /** confirmed → arrived. */
  onArrived: (reservation: ReservationWithTable) => void;
  /** arrived → seated. */
  onSeat: (reservation: ReservationWithTable) => void;
  /** seated → done_eating (releases the table). */
  onDoneEating: (reservation: ReservationWithTable) => void;
  /** done_eating → completed (Order History). */
  onComplete: (reservation: ReservationWithTable) => void;
};

/**
 * Map a lifecycle stage to its handler. Kept in one place so the table, the
 * mobile cards and the details drawer can never drift apart.
 */
function stageHandler(
  stage: LifecycleStage,
  handlers: ReservationActionHandlers,
): (reservation: ReservationWithTable) => void {
  switch (stage) {
    case "confirm_booking":
      return handlers.onConfirm;
    case "confirm_arrival":
      return handlers.onArrived;
    case "seat_guest":
      return handlers.onSeat;
    case "mark_done_eating":
      return handlers.onDoneEating;
    case "complete_reservation":
      return handlers.onComplete;
  }
}

/**
 * The single forward action for a reservation's current status, read from
 * LIFECYCLE_ACTIONS. Returns null for terminal statuses.
 */
export function primaryAction(
  reservation: ReservationWithTable,
  handlers: ReservationActionHandlers,
): ReservationAction | null {
  const action = LIFECYCLE_ACTIONS[reservation.status];
  if (!action) return null;
  return {
    key: action.stage,
    label: action.label,
    shortLabel: action.shortLabel,
    Icon: STAGE_ICON[action.stage],
    run: stageHandler(action.stage, handlers),
  };
}

/**
 * Secondary actions for a status: always includes View details, plus whatever
 * else still makes sense at that point in the lifecycle. Cancelling is offered
 * only while the guest has not yet been seated.
 */
function actionsForStatus(
  status: ReservationStatus,
  handlers: ReservationActionHandlers,
): ReservationAction[] {
  const view: ReservationAction = {
    key: "view",
    label: "View details",
    Icon: Eye,
    run: handlers.onView,
  };
  const edit: ReservationAction = {
    key: "edit",
    label: "Edit reservation",
    Icon: Pencil,
    run: handlers.onEdit,
  };
  const assign: ReservationAction = {
    key: "assign",
    label: "Assign table",
    Icon: Grid3x3,
    run: handlers.onAssignTable,
  };
  const cancel: ReservationAction = {
    key: "cancel",
    label: "Cancel reservation",
    Icon: X,
    danger: true,
    run: handlers.onCancel,
  };
  const noShow: ReservationAction = {
    key: "no-show",
    label: "Mark no-show",
    Icon: UserX,
    danger: true,
    run: handlers.onNoShow,
  };

  switch (status) {
    case "pending":
      // "Confirm booking" is the primary button for this status, so it is not
      // repeated in the overflow list.
      return [view, edit, assign, cancel];
    case "confirmed":
    case "arrived":
      // No-show applies only while the guest has not been recorded as here.
      return [view, edit, assign, cancel, noShow];
    case "seated":
    case "done_eating":
      return [view, edit];
    default:
      return [view];
  }
}

function ActionsMenu({
  actions,
  reservation,
  handlers,
  label,
}: {
  actions: ReservationAction[];
  reservation: ReservationWithTable;
  handlers: ReservationActionHandlers;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="res-menu-wrap" ref={wrapRef}>
      <button
        type="button"
        className="res-action-btn"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        disabled={handlers.busy}
      >
        <MoreHorizontal size={15} />
      </button>
      {open ? (
        <div className="res-menu" role="menu">
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              className={`res-menu-item ${action.danger ? "danger" : ""}`}
              disabled={handlers.busy}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                action.run(reservation);
              }}
            >
              <action.Icon size={14} aria-hidden="true" /> {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Contextual reservation actions. Desktop rows show the primary action plus a
 * compact overflow menu; `compact` mode (mobile cards) folds everything into
 * a single dropdown to avoid crowding.
 */
export function ReservationActions({
  reservation,
  compact = false,
  ...handlers
}: { reservation: ReservationWithTable; compact?: boolean } &
  ReservationActionHandlers) {
  const all = actionsForStatus(reservation.status, handlers);

  if (compact) {
    // On mobile everything folds into one dropdown, with the lifecycle step
    // first so the next action for this reservation is always the top item.
    const primary = primaryAction(reservation, handlers);
    const items = primary
      ? [primary, ...all.filter((action) => action.key !== primary.key)]
      : all;
    return (
      <ActionsMenu
        actions={items}
        reservation={reservation}
        handlers={handlers}
        label={`Actions for reservation ${reservation.code}`}
      />
    );
  }

  const primary = primaryAction(reservation, handlers);
  const showCancelInline =
    reservation.status === "pending" || reservation.status === "confirmed";
  const cancelAction = all.find((action) => action.key === "cancel");
  const overflow = all.filter((action) => {
    if (primary && action.key === primary.key) return false;
    if (showCancelInline && action.key === "cancel") return false;
    return true;
  });
  const single = overflow.length === 1 ? overflow[0] : null;
  const SingleIcon = single ? single.Icon : null;

  return (
    <div className="res-actions">
      {primary ? (
        <button
          type="button"
          className="res-action-primary"
          data-stage={primary.key}
          onClick={(event) => {
            event.stopPropagation();
            primary.run(reservation);
          }}
          disabled={handlers.busy}
          aria-label={primary.label}
          title={
            LIFECYCLE_ACTIONS[reservation.status]?.description ?? primary.label
          }
        >
          <primary.Icon size={13} aria-hidden="true" />
          <span className="res-action-primary-label">
            {primary.shortLabel ?? primary.label}
          </span>
        </button>
      ) : null}

      {showCancelInline && cancelAction ? (
        <button
          type="button"
          className="res-action-btn danger"
          onClick={(event) => {
            event.stopPropagation();
            cancelAction.run(reservation);
          }}
          disabled={handlers.busy}
          aria-label={cancelAction.label}
          title={cancelAction.label}
        >
          <X size={15} />
        </button>
      ) : null}

      {overflow.length > 1 ? (
        <ActionsMenu
          actions={overflow}
          reservation={reservation}
          handlers={handlers}
          label={`More actions for reservation ${reservation.code}`}
        />
      ) : single && SingleIcon ? (
        <button
          type="button"
          className="res-action-btn"
          onClick={(event) => {
            event.stopPropagation();
            single.run(reservation);
          }}
          disabled={handlers.busy}
          aria-label={single.label}
          title={single.label}
        >
          <SingleIcon size={15} />
        </button>
      ) : null}
    </div>
  );
}
