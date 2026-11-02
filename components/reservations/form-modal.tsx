"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Armchair,
  Calendar,
  Clock,
  Mail,
  MessageSquare,
  Phone,
  Save,
  User,
  Users,
} from "lucide-react";
import type {
  ReservationStatus,
  ReservationWithTable,
  RestaurantTable,
} from "@/types/database.types";
import type { ReservationDraft } from "@/hooks/use-reservations";
import {
  STATUS_LABEL,
  combineDateTime,
  formatTime,
  getTableAvailability,
  parsePartySize,
  reservationEnd,
  toInputDate,
  toInputTime,
  validateReservationForm,
  type ReservationFormErrors,
  type ReservationFormValues,
} from "@/lib/reservations";
import { ModalShell } from "./modal-shell";
import { ReservationStatusBadge } from "./status-badge";

type FormModalProps = {
  open: boolean;
  mode: "create" | "edit";
  reservation: ReservationWithTable | null;
  tables: RestaurantTable[];
  reservations: ReservationWithTable[];
  busy?: boolean;
  onClose: () => void;
  onSubmit: (
    draft: ReservationDraft,
    mode: "create" | "edit",
    reservationId?: string,
  ) => Promise<{ ok: boolean; message?: string }>;
};

const EMPTY_VALUES: ReservationFormValues = {
  guest_name: "",
  phone: "",
  email: "",
  date: "",
  time: "",
  party_size: "2",
  table_id: "",
  special_request: "",
  status: "pending",
};

/** Next quarter-hour slot inside service hours, used as the create default. */
function defaultDateTime(): { date: string; time: string } {
  const next = new Date(Date.now() + 30 * 60 * 1000);
  next.setMinutes(Math.ceil(next.getMinutes() / 15) * 15, 0, 0);
  if (next.getHours() < 11) next.setHours(11, 0, 0, 0);
  if (next.getHours() >= 24 || (next.getHours() === 23 && next.getMinutes() > 45)) {
    const tomorrow = new Date(next.getTime() + 24 * 60 * 60 * 1000);
    tomorrow.setHours(17, 30, 0, 0);
    return { date: toInputDate(tomorrow), time: toInputTime(tomorrow) };
  }
  return { date: toInputDate(next), time: toInputTime(next) };
}

function valuesFromReservation(
  reservation: ReservationWithTable,
): ReservationFormValues {
  const start = new Date(reservation.reserved_from);
  return {
    guest_name: reservation.guest_name,
    phone: reservation.phone,
    email: reservation.email ?? "",
    date: toInputDate(start),
    time: toInputTime(start),
    party_size: String(reservation.party_size),
    table_id: reservation.table_id ?? "",
    special_request: reservation.special_request ?? "",
    status: reservation.status,
  };
}

/**
 * Create / edit reservation form. Validates input locally (name, phone, email,
 * party size, no past dates, table conflicts) before submitting; the database
 * re-validates constraints and the table-overlap exclusion rule on write.
 */
export function ReservationFormModal({
  open,
  mode,
  reservation,
  tables,
  reservations,
  busy = false,
  onClose,
  onSubmit,
}: FormModalProps) {
  const [values, setValues] = useState<ReservationFormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<ReservationFormErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset the form whenever it opens for a different target.
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && reservation) {
      setValues(valuesFromReservation(reservation));
    } else {
      const fallback = defaultDateTime();
      setValues({ ...EMPTY_VALUES, ...fallback });
    }
    setErrors({});
    setSubmitError(null);
  }, [open, mode, reservation]);

  const start = combineDateTime(values.date, values.time);
  const end = start ? reservationEnd(start) : null;
  const partySize = parsePartySize(values.party_size);

  const availability = useMemo(() => {
    return getTableAvailability({
      tables,
      reservations,
      start,
      end,
      partySize,
      excludeReservationId: mode === "edit" ? reservation?.id : undefined,
    });
  }, [tables, reservations, start, end, partySize, mode, reservation]);

  const selectedEntry = availability.find(
    (entry) => entry.table.id === values.table_id,
  );

  const update = <K extends keyof ReservationFormValues>(
    key: K,
    value: ReservationFormValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
    setSubmitError(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitError(null);

    const nextErrors = validateReservationForm(values, {
      reservations,
      tables,
      excludeReservationId: mode === "edit" ? reservation?.id : undefined,
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const draft: ReservationDraft = {
        guest_name: values.guest_name.trim(),
        phone: values.phone.trim(),
        email: values.email.trim() || null,
        date: values.date,
        time: values.time,
        party_size: Number(values.party_size),
        table_id: values.table_id || null,
        special_request: values.special_request.trim() || null,
        status:
          mode === "edit"
            ? (reservation?.status ?? "pending")
            : values.status,
      };
      const result = await onSubmit(
        draft,
        mode,
        mode === "edit" ? reservation?.id : undefined,
      );
      if (!result.ok) {
        setSubmitError(
          result.message ?? "Something went wrong. Please try again.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  const isEdit = mode === "edit";

  return (
    <ModalShell
      open={open}
      onClose={busy || submitting ? () => undefined : onClose}
      title={isEdit ? "Edit reservation" : "New reservation"}
      eyebrow={isEdit && reservation ? `Reservation ${reservation.code}` : undefined}
      size="lg"
      footer={
        <>
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            form="res-form"
            className="btn-primary"
            disabled={submitting || busy}
          >
            <Save size={14} />
            {submitting
              ? "Saving…"
              : isEdit
                ? "Save changes"
                : "Save reservation"}
          </button>
        </>
      }
    >
      <form id="res-form" onSubmit={handleSubmit} noValidate>
        {submitError ? (
          <p className="res-form-error" role="alert">
            <AlertCircle size={14} aria-hidden="true" /> {submitError}
          </p>
        ) : null}

        <div className="res-form-grid">
          <div className="form-field res-field-span-2">
            <label htmlFor="res-guest-name">
              <User size={13} aria-hidden="true" /> Customer name
            </label>
            <input
              id="res-guest-name"
              type="text"
              value={values.guest_name}
              onChange={(event) => update("guest_name", event.target.value)}
              placeholder="e.g. Maria Santos"
              maxLength={80}
              autoComplete="off"
              aria-invalid={Boolean(errors.guest_name)}
              aria-describedby={
                errors.guest_name ? "res-guest-name-error" : undefined
              }
            />
            {errors.guest_name ? (
              <span
                className="res-field-error"
                id="res-guest-name-error"
                role="alert"
              >
                {errors.guest_name}
              </span>
            ) : null}
          </div>

          <div className="form-field">
            <label htmlFor="res-phone">
              <Phone size={13} aria-hidden="true" /> Phone number
            </label>
            <input
              id="res-phone"
              type="tel"
              value={values.phone}
              onChange={(event) => update("phone", event.target.value)}
              placeholder="+63 9XX XXX XXXX"
              autoComplete="off"
              aria-invalid={Boolean(errors.phone)}
              aria-describedby={errors.phone ? "res-phone-error" : undefined}
            />
            {errors.phone ? (
              <span className="res-field-error" id="res-phone-error" role="alert">
                {errors.phone}
              </span>
            ) : null}
          </div>

          <div className="form-field">
            <label htmlFor="res-email">
              <Mail size={13} aria-hidden="true" /> Email (optional)
            </label>
            <input
              id="res-email"
              type="email"
              value={values.email}
              onChange={(event) => update("email", event.target.value)}
              placeholder="guest@email.com"
              autoComplete="off"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? "res-email-error" : undefined}
            />
            {errors.email ? (
              <span className="res-field-error" id="res-email-error" role="alert">
                {errors.email}
              </span>
            ) : null}
          </div>

          <div className="form-field">
            <label htmlFor="res-date">
              <Calendar size={13} aria-hidden="true" /> Reservation date
            </label>
            <input
              id="res-date"
              type="date"
              value={values.date}
              onChange={(event) => update("date", event.target.value)}
              aria-invalid={Boolean(errors.date)}
              aria-describedby={errors.date ? "res-date-error" : undefined}
            />
            {errors.date ? (
              <span className="res-field-error" id="res-date-error" role="alert">
                {errors.date}
              </span>
            ) : null}
          </div>

          <div className="form-field">
            <label htmlFor="res-time">
              <Clock size={13} aria-hidden="true" /> Reservation time
            </label>
            <input
              id="res-time"
              type="time"
              value={values.time}
              step={900}
              onChange={(event) => update("time", event.target.value)}
              aria-invalid={Boolean(errors.time)}
              aria-describedby={errors.time ? "res-time-error" : undefined}
            />
            {errors.time ? (
              <span className="res-field-error" id="res-time-error" role="alert">
                {errors.time}
              </span>
            ) : end ? (
              <span className="res-form-hint">
                Table held for 2 hours — until {formatTime(end)}.
              </span>
            ) : null}
          </div>

          <div className="form-field">
            <label htmlFor="res-party">
              <Users size={13} aria-hidden="true" /> Party size
            </label>
            <input
              id="res-party"
              type="number"
              min={1}
              max={20}
              value={values.party_size}
              onChange={(event) => update("party_size", event.target.value)}
              aria-invalid={Boolean(errors.party_size)}
              aria-describedby={
                errors.party_size ? "res-party-error" : undefined
              }
            />
            {errors.party_size ? (
              <span className="res-field-error" id="res-party-error" role="alert">
                {errors.party_size}
              </span>
            ) : null}
          </div>

          <div className="form-field">
            <label htmlFor="res-status">
              <Clock size={13} aria-hidden="true" />{" "}
              {isEdit ? "Status" : "Initial status"}
            </label>
            {isEdit && reservation ? (
              <div className="res-readonly">
                <ReservationStatusBadge status={reservation.status} />
                <span className="res-form-hint">
                  Change status from the reservation actions.
                </span>
              </div>
            ) : (
              <select
                id="res-status"
                value={values.status}
                onChange={(event) =>
                  update("status", event.target.value as ReservationStatus)
                }
              >
                <option value="pending">
                  {STATUS_LABEL.pending} — awaiting confirmation
                </option>
                <option value="confirmed">
                  {STATUS_LABEL.confirmed} — booked in
                </option>
              </select>
            )}
          </div>

          <div className="form-field res-field-span-2">
            <label htmlFor="res-table">
              <Armchair size={13} aria-hidden="true" /> Table assignment
              (optional)
            </label>
            <select
              id="res-table"
              value={values.table_id}
              onChange={(event) => update("table_id", event.target.value)}
              aria-invalid={Boolean(errors.table_id)}
              aria-describedby={
                errors.table_id
                  ? "res-table-error"
                  : start && partySize !== null
                    ? "res-table-hint"
                    : undefined
              }
            >
              <option value="">Unassigned — assign later</option>
              {availability.map(({ table, state }) => (
                <option
                  key={table.id}
                  value={table.id}
                  disabled={
                    state === "conflict" || state === "out_of_service"
                  }
                >
                  Table {table.table_number} · {table.capacity} seats ·{" "}
                  {table.location}
                  {state === "conflict" && " · booked"}
                  {state === "out_of_service" && " · out of service"}
                  {state === "undersized" && " · smaller than party"}
                </option>
              ))}
            </select>
            {errors.table_id ? (
              <span className="res-field-error" id="res-table-error" role="alert">
                {errors.table_id}
              </span>
            ) : start && partySize !== null ? (
              <span className="res-form-hint" id="res-table-hint">
                Availability is checked for {formatTime(start)} and{" "}
                {partySize} {partySize === 1 ? "guest" : "guests"}. Booked
                tables are disabled.
              </span>
            ) : (
              <span className="res-form-hint">
                Pick a date, time and party size to check table availability.
              </span>
            )}
            {selectedEntry?.state === "undersized" ? (
              <span className="res-form-warning" role="status">
                <AlertCircle size={13} aria-hidden="true" />
                Table {selectedEntry.table.table_number} seats{" "}
                {selectedEntry.table.capacity} — fewer than {partySize} guests.
              </span>
            ) : null}
          </div>

          <div className="form-field res-field-span-2">
            <label htmlFor="res-notes">
              <MessageSquare size={13} aria-hidden="true" />
              Special requests or notes (optional)
            </label>
            <textarea
              id="res-notes"
              rows={3}
              maxLength={500}
              value={values.special_request}
              onChange={(event) =>
                update("special_request", event.target.value)
              }
              placeholder="Allergies, celebrations, seating preferences…"
            />
            <span className="res-form-hint">
              {values.special_request.length}/500 characters
            </span>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}
