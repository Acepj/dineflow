"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Armchair, MapPin, Users } from "lucide-react";
import type {
  ReservationWithTable,
  RestaurantTable,
} from "@/types/database.types";
import {
  formatTime,
  getTableAvailability,
  parsePartySize,
} from "@/lib/reservations";
import { ModalShell } from "./modal-shell";

type AssignmentDialogProps = {
  open: boolean;
  reservation: ReservationWithTable | null;
  tables: RestaurantTable[];
  reservations: ReservationWithTable[];
  busy?: boolean;
  onClose: () => void;
  onAssign: (reservationId: string, tableId: string | null) => Promise<boolean>;
};

/**
 * Standalone table assignment dialog. Lists every table with its capacity and
 * availability for the reservation's time slot, blocks tables with an
 * overlapping active booking, and warns when a table seats fewer guests than
 * the party size.
 */
export function TableAssignmentDialog({
  open,
  reservation,
  tables,
  reservations,
  busy = false,
  onClose,
  onAssign,
}: AssignmentDialogProps) {
  const [selectedTableId, setSelectedTableId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const availability = useMemo(() => {
    if (!reservation) return [];
    return getTableAvailability({
      tables,
      reservations,
      start: new Date(reservation.reserved_from),
      end: new Date(reservation.reserved_to),
      partySize: parsePartySize(String(reservation.party_size)),
      excludeReservationId: reservation.id,
    });
  }, [reservation, tables, reservations]);

  const selectedEntry = availability.find(
    (entry) => entry.table.id === selectedTableId,
  );

  if (!reservation) return null;

  const handleAssign = async (tableId: string | null) => {
    setSubmitting(true);
    try {
      await onAssign(reservation.id, tableId);
    } finally {
      setSubmitting(false);
      setSelectedTableId("");
    }
  };

  return (
    <ModalShell
      open={open}
      onClose={busy || submitting ? () => undefined : onClose}
      title="Assign a table"
      eyebrow={`Reservation ${reservation.code}`}
      size="lg"
      footer={
        <>
          {reservation.table_id ? (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => handleAssign(null)}
              disabled={busy || submitting}
            >
              Remove assignment
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => handleAssign(selectedTableId)}
            disabled={!selectedTableId || busy || submitting}
          >
            <Armchair size={14} />
            {submitting ? "Assigning…" : "Assign table"}
          </button>
        </>
      }
    >
      <div className="res-assign-summary">
        <div>
          <span>Guest</span>
          <strong>{reservation.guest_name}</strong>
        </div>
        <div>
          <span>When</span>
          <strong>
            {formatTime(reservation.reserved_from)} –{" "}
            {formatTime(reservation.reserved_to)}
          </strong>
        </div>
        <div>
          <span>Party</span>
          <strong>
            <Users size={13} aria-hidden="true" /> {reservation.party_size}
          </strong>
        </div>
        <div>
          <span>Currently</span>
          <strong>
            {reservation.restaurant_tables
              ? `Table ${reservation.restaurant_tables.table_number}`
              : "Unassigned"}
          </strong>
        </div>
      </div>

      <ul className="res-assign-list">
        {availability.map(({ table, state, conflict }) => {
          const disabled = state === "conflict" || state === "out_of_service";
          const isSelected = selectedTableId === table.id;
          return (
            <li key={table.id}>
              <label
                className={`res-assign-item ${isSelected ? "selected" : ""} ${disabled ? "disabled" : ""}`}
              >
                <input
                  type="radio"
                  name="assignment-table"
                  value={table.id}
                  checked={isSelected}
                  disabled={disabled}
                  onChange={() => setSelectedTableId(table.id)}
                />
                <span className="res-assign-number">
                  <Armchair size={14} aria-hidden="true" />
                  Table {table.table_number}
                </span>
                <span className="res-assign-meta">
                  <span>
                    <Users size={12} aria-hidden="true" /> {table.capacity}{" "}
                    seats
                  </span>
                  <span>
                    <MapPin size={12} aria-hidden="true" /> {table.location}
                  </span>
                </span>
                <span className={`res-assign-state state-${state}`}>
                  {state === "available" && "Available"}
                  {state === "undersized" && "Smaller than party"}
                  {state === "out_of_service" && "Out of service"}
                  {state === "conflict" &&
                    `Booked ${formatTime(conflict!.reserved_from)}–${formatTime(conflict!.reserved_to)}`}
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      {selectedEntry?.state === "undersized" ? (
        <p className="res-form-warning" role="status">
          <AlertTriangle size={14} aria-hidden="true" />
          Table {selectedEntry.table.table_number} seats{" "}
          {selectedEntry.table.capacity} guests — fewer than the party of{" "}
          {reservation.party_size}. Assign anyway only if that&apos;s
          intentional.
        </p>
      ) : null}

      {availability.length === 0 ? (
        <p className="res-form-hint">No tables are configured yet.</p>
      ) : null}
    </ModalShell>
  );
}
