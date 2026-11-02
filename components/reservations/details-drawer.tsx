"use client";

import {
  Armchair,
  BadgeCheck,
  Calendar,
  CalendarClock,
  Check,
  Clock,
  DoorOpen,
  LogOut,
  Mail,
  MapPin,
  MessageSquare,
  Pencil,
  Phone,
  User,
  Users,
  UserX,
  Utensils,
  X,
} from "lucide-react";
import type {
  ReservationStatus,
  ReservationWithTable,
} from "@/types/database.types";
import type { ReservationStatusEvent } from "@/hooks/use-reservations";
import {
  formatDate,
  formatDateTime,
  formatTime,
  getLifecycleAction,
  isTerminalStatus,
  LIFECYCLE_ACTIONS,
  STATUS_LABEL,
  tableLabel,
  type LifecycleStage,
} from "@/lib/reservations";
import { ModalShell } from "./modal-shell";
import { ReservationStatusBadge } from "./status-badge";

/** Icon for each lifecycle stage, kept beside the action metadata. */
function StageIcon({ stage }: { stage: LifecycleStage }) {
  if (stage === "confirm_booking") return <BadgeCheck size={14} />;
  if (stage === "confirm_arrival") return <DoorOpen size={14} />;
  if (stage === "seat_guest") return <Armchair size={14} />;
  if (stage === "mark_done_eating") return <Utensils size={14} />;
  return <CalendarClock size={14} />;
}

/**
 * Map a recorded audit `action` onto the stage whose icon it belongs to. The
 * audit trail predates the action vocabulary, so unknown actions fall back to
 * the generic calendar icon instead of rendering nothing.
 */
function stageForEvent(action: string): LifecycleStage {
  if (action === "confirm_booking") return "confirm_booking";
  if (action === "confirm_arrival") return "confirm_arrival";
  if (action === "seat_guest") return "seat_guest";
  if (action === "mark_done_eating") return "mark_done_eating";
  if (action === "complete_reservation") return "complete_reservation";
  if (action === "confirm") return "confirm_arrival";
  if (action === "seat") return "seat_guest";
  if (action === "completed") return "complete_reservation";
  return "complete_reservation";
}

type DetailsDrawerProps = {
  open: boolean;
  reservation: ReservationWithTable | null;
  busy?: boolean;
  onClose: () => void;
  onEdit: (reservation: ReservationWithTable) => void;
  onConfirm: (reservation: ReservationWithTable) => void;
  onArrived: (reservation: ReservationWithTable) => void;
  onSeat: (reservation: ReservationWithTable) => void;
  onDoneEating: (reservation: ReservationWithTable) => void;
  onComplete: (reservation: ReservationWithTable) => void;
  onCancel: (reservation: ReservationWithTable) => void;
  onNoShow: (reservation: ReservationWithTable) => void;
  onAssignTable: (reservation: ReservationWithTable) => void;
  /** Audit trail, fetched by the parent while the drawer is open. */
  history?: ReservationStatusEvent[];
};

/**
 * Side drawer with the full picture of one reservation plus its contextual
 * actions. The reservation passed in is the live row from the list, so
 * status changes are reflected immediately.
 */
export function ReservationDetailsDrawer({
  open,
  reservation,
  busy = false,
  onClose,
  onEdit,
  onConfirm,
  onArrived,
  onSeat,
  onDoneEating,
  onComplete,
  onCancel,
  onNoShow,
  onAssignTable,
  history,
}: DetailsDrawerProps) {
  if (!reservation) return null;

  const table = reservation.restaurant_tables;
  const status = reservation.status;
  const action = getLifecycleAction(status);
  const timeline = history ?? [];

  /** Route a lifecycle button to the handler that owns that stage. */
  const runLifecycle = (
    stage: LifecycleStage,
    target: ReservationWithTable,
  ) => {
    if (stage === "confirm_booking") return onConfirm(target);
    if (stage === "confirm_arrival") return onArrived(target);
    if (stage === "seat_guest") return onSeat(target);
    if (stage === "mark_done_eating") return onDoneEating(target);
    return onComplete(target);
  };

  const details: { icon: React.ReactNode; label: string; value: string }[] = [
    {
      icon: <User size={13} aria-hidden="true" />,
      label: "Customer",
      value: reservation.guest_name,
    },
    {
      icon: <Phone size={13} aria-hidden="true" />,
      label: "Phone",
      value: reservation.phone,
    },
    {
      icon: <Mail size={13} aria-hidden="true" />,
      label: "Email",
      value: reservation.email || "Not provided",
    },
    {
      icon: <Calendar size={13} aria-hidden="true" />,
      label: "Date",
      value: formatDate(reservation.reserved_from),
    },
    {
      icon: <Clock size={13} aria-hidden="true" />,
      label: "Time",
      value: `${formatTime(reservation.reserved_from)} – ${formatTime(reservation.reserved_to)}`,
    },
    {
      icon: <Users size={13} aria-hidden="true" />,
      label: "Party size",
      value: `${reservation.party_size} ${reservation.party_size === 1 ? "guest" : "guests"}`,
    },
    {
      icon: <MapPin size={13} aria-hidden="true" />,
      label: "Table",
      value: table
        ? `${tableLabel(table)} · ${table.location} · ${table.capacity} seats`
        : "Unassigned",
    },
  ];

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Reservation details"
      eyebrow={`Code ${reservation.code}`}
      variant="drawer"
    >
      <div className="res-detail-head">
        <ReservationStatusBadge status={status} />
        <span className="res-detail-party">
          <Users size={13} aria-hidden="true" /> {reservation.party_size}{" "}
          guests · {formatTime(reservation.reserved_from)}
        </span>
      </div>

      <dl className="res-detail-grid">
        {details.map((row) => (
          <div key={row.label}>
            <dt>
              {row.icon} {row.label}
            </dt>
            <dd>{row.value}</dd>
          </div>
        ))}
        <div className="res-detail-span">
          <dt>
            <MessageSquare size={13} aria-hidden="true" /> Special requests
          </dt>
          <dd>
            {reservation.special_request || "None recorded for this booking."}
          </dd>
        </div>
        <div>
          <dt>
            <Clock size={13} aria-hidden="true" /> Created
          </dt>
          <dd>
            {formatDate(reservation.created_at)} ·{" "}
            {formatTime(reservation.created_at)}
          </dd>
        </div>
        {reservation.updated_at ? (
          <div>
            <dt>
              <Clock size={13} aria-hidden="true" /> Last updated
            </dt>
            <dd>
              {formatDate(reservation.updated_at)} ·{" "}
              {formatTime(reservation.updated_at)}
            </dd>
          </div>
        ) : null}
      </dl>

      {/* Service timeline: every lifecycle step that has actually happened,
          with the staff/admin who performed it. Steps that have not occurred
          yet are omitted rather than shown as blank. */}
      {timeline.length > 0 ? (
        <div className="res-timeline">
          <h3 className="res-timeline-title">Service history</h3>
          <ol>
            {timeline.map((event) => (
              <li key={event.event_id} className="res-timeline-item">
                <span className="res-timeline-icon" aria-hidden="true">
                  <StageIcon stage={stageForEvent(event.action)} />
                </span>
                <div className="res-timeline-body">
                  <strong>{STATUS_LABEL[event.new_status as ReservationStatus]}</strong>
                  <span className="res-timeline-when">
                    {formatDate(event.created_at)} ·{" "}
                    {formatTime(event.created_at)}
                  </span>
                  <span className="res-timeline-who">
                    {event.performed_by_name
                      ? `by ${event.performed_by_name}`
                      : "by staff"}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="res-detail-actions">
        {/* The primary action always matches the reservation's real status. */}
        {action ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => runLifecycle(action.stage, reservation)}
            disabled={busy}
            title={action.description}
          >
            <StageIcon stage={action.stage} /> {action.label}
          </button>
        ) : null}
        {status === "pending" ? (
          <button
            type="button"
            className="btn-primary"
            onClick={() => onConfirm(reservation)}
            disabled={busy}
          >
            <Check size={14} /> Confirm booking
          </button>
        ) : null}
        {!isTerminalStatus(status) ? (
          <>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => onAssignTable(reservation)}
              disabled={busy}
            >
              <Armchair size={14} />{" "}
              {reservation.table_id ? "Change table" : "Assign table"}
            </button>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => onEdit(reservation)}
              disabled={busy}
            >
              <Pencil size={14} /> Edit
            </button>
            <button
              type="button"
              className="res-btn-danger"
              onClick={() => onCancel(reservation)}
              disabled={busy}
            >
              <X size={14} /> Cancel
            </button>
            {status === "confirmed" || status === "arrived" ? (
              <button
                type="button"
                className="res-btn-danger-soft"
                onClick={() => onNoShow(reservation)}
                disabled={busy}
              >
                <UserX size={14} /> Mark no-show
              </button>
            ) : null}
          </>
        ) : null}
      </div>
    </ModalShell>
  );
}
