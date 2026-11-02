"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Users, X, CalendarDays, Info } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/context";
import { toInputDate } from "@/lib/reservations";
import {
  TABLE_DAY_STATUS_COLOR,
  TABLE_DAY_STATUS_LABEL,
  SETTABLE_DAY_STATUSES,
  resolveTablesForDay,
  type ResolvedTable,
} from "@/lib/table-availability";
import type {
  RestaurantTable,
  Order,
  Reservation,
  ResolvedTableDayStatus,
  TableDailyStatusValue,
} from "@/types/database.types";

/** Reservation statuses that hold a table, used to derive a day's holds. */
const HOLDING_STATUSES = ["pending", "confirmed", "arrived", "seated"];

/** Day statuses shown in the floor legend, in display order. */
const LEGEND_STATUSES: ResolvedTableDayStatus[] = [
  "available",
  "occupied",
  "reserved",
  "out_of_service",
];

/** A reservation row reduced to just what the day resolver needs. */
type DayReservation = {
  table_id: string | null;
  status: string;
  reserved_from: string;
  reserved_to: string;
};

export default function TablesPage() {
  const { session } = useAuth();
  const staffId = session?.user?.id ?? null;

  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ResolvedTable | null>(null);

  /** The day whose floor is being viewed/edited. Defaults to today. */
  const [day, setDay] = useState<string>(() => toInputDate(new Date()));

  /** Staff day-overrides for the chosen day, keyed by table id. */
  const [overrides, setOverrides] = useState<Map<string, TableDailyStatusValue>>(
    () => new Map(),
  );

  /** Reservations overlapping the chosen day, used to derive holds. */
  const [dayReservations, setDayReservations] = useState<DayReservation[]>([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [tableOrder, setTableOrder] = useState<
    | (Order & {
        order_items: {
          menu_item_name: string;
          quantity: number;
          line_total: number;
        }[];
      })
    | null
  >(null);
  const [tableRes, setTableRes] = useState<Reservation | null>(null);

  /** Load the physical tables once (their capacity/location/live status). */
  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("restaurant_tables")
      .select("*")
      .order("table_number");
    setTables((data as RestaurantTable[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // The loader updates state from the async Supabase response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  /**
   * Load the chosen day's staff overrides and reservations. Both feed the
   * shared resolver so the floor map and the customer wizard agree on what
   * each table's status is for that day.
   */
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    (async () => {
      const dayStart = new Date(`${day}T00:00:00`);
      const dayEnd = new Date(`${day}T23:59:59.999`);

      const { data: dailyRows } = await supabase
        .from("table_daily_status")
        .select("table_id, status")
        .eq("day", day);

      const nextOverrides = new Map<string, TableDailyStatusValue>();
      for (const row of (dailyRows || []) as {
        table_id: string;
        status: TableDailyStatusValue;
      }[]) {
        nextOverrides.set(row.table_id, row.status);
      }
      setOverrides(nextOverrides);

      const { data: reservations } = await supabase
        .from("reservations")
        .select("table_id, status, reserved_from, reserved_to")
        .in("status", HOLDING_STATUSES)
        .not("table_id", "is", null)
        .lt("reserved_from", dayEnd.toISOString())
        .gt("reserved_to", dayStart.toISOString());

      setDayReservations((reservations || []) as DayReservation[]);
    })();
  }, [day]);

  /**
   * The floor for the chosen day: each table resolved to a day status by the
   * same helper the customer wizard uses, so the two can never disagree.
   */
  const floor = useMemo<ResolvedTable[]>(() => {
    const dayStart = new Date(`${day}T00:00:00`);
    const dayEnd = new Date(`${day}T23:59:59.999`);
    return resolveTablesForDay({
      tables,
      reservations: dayReservations,
      overrides,
      windowFrom: dayStart,
      windowTo: dayEnd,
    });
  }, [tables, dayReservations, overrides, day]);

  const grouped = useMemo(
    () => ({
      indoor: floor.filter((r) => r.table.location === "indoor"),
      outdoor: floor.filter((r) => r.table.location === "outdoor"),
      bar: floor.filter((r) => r.table.location === "bar"),
      private: floor.filter((r) => r.table.location === "private"),
    }),
    [floor],
  );

  /** When the day changes, the open modal must reflect the new day's table. */
  useEffect(() => {
    if (!selected) return;
    const fresh = floor.find((r) => r.table.id === selected.table.id) || null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(fresh);
  }, [floor, selected]);

  /** Fetch the day's live order + reservation for the selected table. */
  useEffect(() => {
    if (!selected) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setTableOrder(null);
      setTableRes(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    (async () => {
      const { data: orders } = await supabase
        .from("orders")
        .select("*, order_items(menu_item_name, quantity, line_total)")
        .eq("table_id", selected.table.id)
        .in("status", ["queued", "preparing", "serving"])
        .order("created_at", { ascending: false })
        .limit(1);
      setTableOrder((orders && orders[0]) || null);

      const { data: res } = await supabase
        .from("reservations")
        .select("*")
        .eq("table_id", selected.table.id)
        .in("status", HOLDING_STATUSES)
        .lt("reserved_from", new Date(`${day}T23:59:59.999`).toISOString())
        .gt("reserved_to", new Date(`${day}T00:00:00`).toISOString())
        .order("reserved_from", { ascending: true })
        .limit(1)
        .maybeSingle();
      setTableRes((res as Reservation) || null);
    })();
  }, [selected, day]);

  /** Human label for the chosen day, e.g. "Friday, October 24, 2025". */
  const dayLabel = useMemo(() => {
    const d = new Date(`${day}T00:00:00`);
    if (Number.isNaN(d.getTime())) return day;
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }, [day]);

  /**
   * Set a table's status for the chosen day. Writes (upserts) a row in
   * `table_daily_status` — it never touches the physical table, so the live
   * floor status and every other day are unaffected. A guest actually seated
   * at the table still wins over the override in the resolver, so a live stay
   * can't be hidden; a booking that has not arrived yet can be set by hand.
   */
  const setDayStatus = async (
    tableId: string,
    status: TableDailyStatusValue,
  ) => {
    if (!staffId) {
      setSaveError("You must be signed in to set a table's day status.");
      return;
    }
    setSaving(true);
    setSaveError(null);

    const { error } = await supabase
      .from("table_daily_status")
      .upsert(
        {
          table_id: tableId,
          day,
          status,
          set_by: staffId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "table_id,day" },
      );

    if (error) {
      setSaveError(
        "We couldn't save this table's status for the day. Please try again.",
      );
      setSaving(false);
      return;
    }

    // Reflect the change immediately; the day effect would reload it anyway.
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(tableId, status);
      return next;
    });
    setSaving(false);
  };

  /**
   * The status buttons are locked only when the table itself is permanently
   * out of service or a guest is actually at it right now (`holdStatus` is
   * `occupied`). A booking whose time is still ahead — another day, or later
   * today — never locks the buttons, even if its record was advanced to
   * `seated`, because nothing changes automatically; staff set the day's
   * status by hand.
   */
  const selectedLocked =
    selected !== null &&
    (selected.table.status === "out_of_service" ||
      selected.holdStatus === "occupied");

  if (loading) return <div className="bo-loading">Loading tables…</div>;

  return (
    <div>
      <div className="dashboard-toolbar" style={{ marginBottom: 16 }}>
        <div className="toolbar-left">
          <label
            className="toolbar-date"
            htmlFor="floor-day"
            title="Choose the day to view or edit"
          >
            <CalendarDays size={15} />
            <input
              id="floor-day"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
            />
          </label>
          <span className="floor-day-label">{dayLabel}</span>
        </div>
        <p className="floor-day-hint">
          <Info size={13} />
          Set each table&apos;s status for <strong>{dayLabel}</strong>.
          Customers picking this date will see exactly what you set here. A
          booking stays Reserved until you set it Occupied — nothing changes
          automatically when the day comes.
        </p>
      </div>

      <div className="floor-legend">
        {LEGEND_STATUSES.map((s) => (
          <div key={s} className="legend-item">
            <span style={{ background: TABLE_DAY_STATUS_COLOR[s] }} />{" "}
            {TABLE_DAY_STATUS_LABEL[s]}
          </div>
        ))}
      </div>
      <div className="floor-map">
        {(Object.keys(grouped) as Array<keyof typeof grouped>).map((area) => (
          <div key={area} className="floor-area">
            <h3 className="floor-area-title">{area}</h3>
            <div className="floor-tiles">
              {grouped[area].map((resolved) => (
                <button
                  key={resolved.table.id}
                  className={`floor-tile status-${resolved.dayStatus}`}
                  onClick={() => setSelected(resolved)}
                  style={{ borderColor: TABLE_DAY_STATUS_COLOR[resolved.dayStatus] }}
                  title={`Table ${resolved.table.table_number} · ${TABLE_DAY_STATUS_LABEL[resolved.dayStatus]} on ${dayLabel}`}
                >
                  <span className="floor-tile-num">
                    {resolved.table.table_number}
                  </span>
                  <span className="floor-tile-cap">
                    <Users size={12} /> {resolved.table.capacity}
                  </span>
                  <span className="floor-tile-status">
                    {TABLE_DAY_STATUS_LABEL[resolved.dayStatus]}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Table {selected.table.table_number}</h2>
              <button className="btn-icon" onClick={() => setSelected(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">
              <div className="table-info">
                <span>Capacity</span>
                <strong>{selected.table.capacity} seats</strong>
              </div>
              <div className="table-info">
                <span>Location</span>
                <strong>{selected.table.location}</strong>
              </div>
              <div className="table-info">
                <span>Status on {dayLabel}</span>
                <strong style={{ color: TABLE_DAY_STATUS_COLOR[selected.dayStatus] }}>
                  {TABLE_DAY_STATUS_LABEL[selected.dayStatus]}
                </strong>
              </div>
              {selected.holdStatus === "occupied" && (
                <p className="table-lock-note">
                  <Info size={13} /> A guest is at this table right now, so its
                  status is locked and shown to customers as{" "}
                  {TABLE_DAY_STATUS_LABEL[selected.dayStatus]}.
                </p>
              )}

              {tableOrder && (
                <div className="table-section">
                  <h4>Current Order #{tableOrder.order_number}</h4>
                  <div className="table-info">
                    <span>Status</span>
                    <strong>{tableOrder.status}</strong>
                  </div>
                  {tableOrder.order_items?.map((item, i) => (
                    <div key={i} className="table-order-item">
                      {item.quantity}× {item.menu_item_name} — ₱
                      {Number(item.line_total).toFixed(2)}
                    </div>
                  ))}
                  <div className="table-info">
                    <span>Total</span>
                    <strong>₱{Number(tableOrder.total).toFixed(2)}</strong>
                  </div>
                </div>
              )}

              {tableRes && (
                <div className="table-section">
                  <h4>Upcoming Reservation</h4>
                  <div className="table-info">
                    <span>Customer</span>
                    <strong>{tableRes.guest_name}</strong>
                  </div>
                  <div className="table-info">
                    <span>Time</span>
                    <strong>
                      {new Date(tableRes.reserved_from).toLocaleString(
                        "en-US",
                        {
                          weekday: "short",
                          hour: "numeric",
                          minute: "2-digit",
                        },
                      )}
                    </strong>
                  </div>
                  <div className="table-info">
                    <span>Party</span>
                    <strong>{tableRes.party_size} guests</strong>
                  </div>
                </div>
              )}

              <div className="status-actions">
                <h4>Set Status for {dayLabel}</h4>
                <p className="status-actions-note">
                  {selectedLocked
                    ? selected.table.status === "out_of_service"
                      ? "This table is out of service, so its day status is locked."
                      : "A guest is at this table — its status is locked until they leave."
                    : selected.reservationStatus
                      ? "This table has a booking this day, but nothing changes automatically — set its status manually."
                      : "Choose how this table should read to customers on this day."}
                </p>
                {saveError && <p className="status-save-error">{saveError}</p>}
                <div className="status-btn-row">
                  {SETTABLE_DAY_STATUSES.map((s) => (
                    <button
                      key={s}
                      disabled={saving || selectedLocked}
                      className={`status-btn ${selected.dayStatus === s && !selectedLocked ? "active" : ""}`}
                      style={{
                        borderColor: TABLE_DAY_STATUS_COLOR[s],
                        color:
                          selected.dayStatus === s
                            ? TABLE_DAY_STATUS_COLOR[s]
                            : undefined,
                      }}
                      onClick={() => setDayStatus(selected.table.id, s)}
                    >
                      {TABLE_DAY_STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
