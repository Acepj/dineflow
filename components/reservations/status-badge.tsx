import type { ReservationStatus } from "@/types/database.types";
import { STATUS_LABEL } from "@/lib/reservations";

/**
 * Pill badge for a reservation status. The text label (not colour alone)
 * communicates the state, with a small dot echoing the status tint.
 */
export function ReservationStatusBadge({
  status,
}: {
  status: ReservationStatus;
}) {
  return (
    <span className={`res-status-badge status-badge status-${status}`}>
      <i aria-hidden="true" />
      {STATUS_LABEL[status]}
    </span>
  );
}
