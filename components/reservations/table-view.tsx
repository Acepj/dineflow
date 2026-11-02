"use client";

import { Phone, Users } from "lucide-react";
import type { ReservationWithTable } from "@/types/database.types";
import { formatShortDate, formatTime, tableLabel } from "@/lib/reservations";
import { ReservationStatusBadge } from "./status-badge";
import {
  ReservationActions,
  type ReservationActionHandlers,
} from "./actions-menu";

type TableViewProps = {
  rows: ReservationWithTable[];
  busyId: string | null;
  handlers: ReservationActionHandlers;
  onOpenDetails: (reservation: ReservationWithTable) => void;
};

const COLUMNS = [
  "Reservation code",
  "Customer",
  "Date & time",
  "Party size",
  "Table",
  "Status",
  "Actions",
];

/**
 * Reservations list: a grid-based table on desktop/tablet (wrapped in its own
 * horizontal scroll container so the page never overflows) and compact cards
 * on mobile, where actions collapse into a single dropdown.
 */
export function ReservationsTableView({
  rows,
  busyId,
  handlers,
  onOpenDetails,
}: TableViewProps) {
  const boundHandlers: ReservationActionHandlers = {
    ...handlers,
    busy: handlers.busy || busyId !== null,
  };

  return (
    <>
      <div className="res-table-wrap">
        <div className="res-table" role="table" aria-label="Reservations">
          <div className="res-table-header" role="row">
            {COLUMNS.map((column, index) => (
              <div
                key={column}
                role="columnheader"
                className={index === 6 ? "res-align-right" : undefined}
              >
                {column}
              </div>
            ))}
          </div>

          {rows.map((reservation) => {
            const table = reservation.restaurant_tables;
            return (
              <div
                key={reservation.id}
                role="row"
                className="res-table-row"
                onClick={() => onOpenDetails(reservation)}
              >
                <div role="cell" className="res-code" title={reservation.code}>
                  {reservation.code}
                </div>

                <div role="cell" className="res-customer">
                  <span className="res-customer-name">
                    {reservation.guest_name}
                  </span>
                  <span className="res-customer-phone">
                    <Phone size={11} aria-hidden="true" />
                    {reservation.phone}
                  </span>
                </div>

                <div role="cell" className="res-datetime">
                  <span className="res-datetime-date">
                    {formatShortDate(reservation.reserved_from)}
                  </span>
                  <span className="res-datetime-time">
                    {formatTime(reservation.reserved_from)} –{" "}
                    {formatTime(reservation.reserved_to)}
                  </span>
                </div>

                <div role="cell" className="res-party">
                  <Users size={13} aria-hidden="true" />
                  {reservation.party_size}
                </div>

                <div role="cell" className="res-table-assignment">
                  {table ? (
                    <>
                      <span className="res-table-number">
                        {tableLabel(table)}
                      </span>
                      <span className="res-table-location">
                        {table.location}
                      </span>
                    </>
                  ) : (
                    <span className="res-unassigned">Unassigned</span>
                  )}
                </div>

                <div role="cell">
                  <ReservationStatusBadge status={reservation.status} />
                </div>

                <div role="cell" className="res-align-right">
                  <ReservationActions
                    reservation={reservation}
                    busy={boundHandlers.busy}
                    {...boundHandlers}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile card list — visible only on small screens via CSS. */}
      <div className="res-cards">
        {rows.map((reservation) => {
          const table = reservation.restaurant_tables;
          return (
            <article
              key={reservation.id}
              className="res-card"
              onClick={() => onOpenDetails(reservation)}
            >
              <div className="res-card-head">
                <span className="res-code">{reservation.code}</span>
                <ReservationStatusBadge status={reservation.status} />
              </div>
              <div className="res-card-guest">
                <span className="res-customer-name">
                  {reservation.guest_name}
                </span>
                <span className="res-customer-phone">
                  <Phone size={11} aria-hidden="true" />
                  {reservation.phone}
                </span>
              </div>
              <dl className="res-card-meta">
                <div>
                  <dt>When</dt>
                  <dd>
                    {formatShortDate(reservation.reserved_from)} ·{" "}
                    {formatTime(reservation.reserved_from)}–
                    {formatTime(reservation.reserved_to)}
                  </dd>
                </div>
                <div>
                  <dt>Party</dt>
                  <dd>
                    <Users size={12} aria-hidden="true" />{" "}
                    {reservation.party_size} guests
                  </dd>
                </div>
                <div>
                  <dt>Table</dt>
                  <dd>{tableLabel(table)}</dd>
                </div>
              </dl>
              <div className="res-card-actions">
                <button
                  type="button"
                  className="res-action-btn"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenDetails(reservation);
                  }}
                  aria-label={`View details for reservation ${reservation.code}`}
                  title="View details"
                >
                  View details
                </button>
                <ReservationActions
                  reservation={reservation}
                  compact
                  busy={boundHandlers.busy}
                  {...boundHandlers}
                />
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
