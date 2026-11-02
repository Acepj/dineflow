import {
  CalendarClock,
  CheckCircle2,
  DoorOpen,
  Utensils,
  XCircle,
  CalendarX2,
} from "lucide-react";
import type { ReservationStats } from "@/lib/reservations";

type StatCardDef = {
  key: string;
  label: string;
  value: number;
  tone: string;
  Icon: typeof CalendarClock;
  /** Optional tooltip explaining what the metric counts. */
  hint?: string;
};

/**
 * Compact summary row for the reservations page. Mirrors the service lifecycle
 * so staff can see the floor at a glance: what still needs a decision, what is
 * waiting to arrive, what is dining, and what finished. All values come from
 * the loaded reservation data — nothing is hardcoded.
 */
export function ReservationStatsCards({
  stats,
  loading = false,
}: {
  stats: ReservationStats;
  loading?: boolean;
}) {
  const cards: StatCardDef[] = [
    {
      key: "total",
      label: "Total reservations",
      value: stats.total,
      tone: "gold",
      Icon: CalendarClock,
      hint: "All reservations in the system, including completed and cancelled.",
    },
    {
      key: "reserved",
      label: "Reserved",
      value: stats.reserved,
      tone: "amber",
      Icon: CheckCircle2,
      hint: "Bookings accepted, waiting for the guest to arrive.",
    },
    {
      key: "arrived",
      label: "Arrived",
      value: stats.arrived,
      tone: "blue",
      Icon: DoorOpen,
      hint: "Guests at the door, ready to be seated.",
    },
    {
      key: "seated",
      label: "Seated",
      value: stats.seated,
      tone: "purple",
      Icon: Utensils,
      hint: "Guests currently dining.",
    },
    {
      key: "done",
      label: "Done eating",
      value: stats.doneEating,
      tone: "orange",
      Icon: Utensils,
      hint: "Finished dining. The table is available again immediately.",
    },
    {
      key: "completed",
      label: "Completed",
      value: stats.completed,
      tone: "green",
      Icon: CheckCircle2,
      hint: "Finalized and moved to Order History.",
    },
    {
      key: "cancelled",
      label: "Cancelled / no-show",
      value: stats.cancelled + stats.noShow,
      tone: "red",
      Icon: CalendarX2,
      hint: "Reservations cancelled or where the guest never arrived.",
    },
    {
      key: "today",
      label: "Today",
      value: stats.today,
      tone: "gold",
      Icon: CalendarClock,
      hint: "Bookings scheduled for today that are still in service.",
    },
  ];

  return (
    <section className="res-stats" aria-label="Reservation statistics">
      {cards.map((card) => (
        <article
          key={card.key}
          className={`res-stat-card res-stat-${card.tone}`}
          title={card.hint}
        >
          <span className="res-stat-icon" aria-hidden="true">
            <card.Icon size={15} />
          </span>
          <div className="res-stat-body">
            <strong className="res-stat-value">
              {loading ? "—" : card.value.toLocaleString("en-US")}
            </strong>
            <span className="res-stat-label">{card.label}</span>
          </div>
        </article>
      ))}
    </section>
  );
}
