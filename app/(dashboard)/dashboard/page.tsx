"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Grid3X3,
  Receipt,
  ShoppingBag,
  TrendingUp,
  Users,
  UtensilsCrossed,
} from "lucide-react";
import { useAuth } from "@/lib/auth/context";
import { resolveUserRole } from "@/lib/auth/role";
import { supabase } from "@/lib/supabase/client";
import { toInputDate } from "@/lib/reservations";
import {
  TABLE_DAY_STATUS_COLOR,
  TABLE_DAY_STATUS_LABEL,
  resolveTablesForDay,
  type ResolvedTable,
} from "@/lib/table-availability";
import type {
  RestaurantTable,
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

type DashboardStats = {
  sales: number;
  served: number;
  open: number;
  reservations: number;
  pending: number;
  occupied: number;
  tables: number;
  unavailable: number;
  customers: number;
};

const emptyStats: DashboardStats = {
  sales: 0,
  served: 0,
  open: 0,
  reservations: 0,
  pending: 0,
  occupied: 0,
  tables: 0,
  unavailable: 0,
  customers: 0,
};

function peso(value: number) {
  return `₱${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

type Embeddable<T> = T | T[] | null;
function toOne<T>(value: Embeddable<T>): T | null {
  if (Array.isArray(value)) return value.length ? value[0] : null;
  return value;
}

type RevenueReservationRow = {
  id: string;
  guest_name: string;
  reserved_from: string;
  party_size: number;
  status: string;
  restaurant_tables:
    | { table_number: number }
    | { table_number: number }[]
    | null;
};

type OrderStatsRow = {
  total: number;
  type: string;
  created_at: string;
};

type OrderItemSaleRow = {
  menu_item_id: string;
  menu_item_name: string;
  quantity: number;
  line_total: number;
  orders: { status: string } | { status: string }[] | null;
  menu_items:
    | {
        name: string;
        description: string | null;
        price: number;
        image_url: string | null;
      }
    | {
        name: string;
        description: string | null;
        price: number;
        image_url: string | null;
      }[]
    | null;
};

export default function DashboardPage() {
  const { session } = useAuth();
  const role = resolveUserRole(
    session?.user?.user_metadata?.role ?? session?.user?.app_metadata?.role,
  );
  const [stats, setStats] = useState(emptyStats);
  const [recentOrders, setRecentOrders] = useState<
    {
      id: string;
      order_number: number;
      status: string;
      total: number;
      created_at: string;
    }[]
  >([]);
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [revenueData, setRevenueData] = useState<
    { day: string; value: number; amount: number }[]
  >([]);
  const [upcomingReservations, setUpcomingReservations] = useState<
    {
      id: string;
      guest_name: string;
      reserved_from: string;
      party_size: number;
      table_number: number | null;
      status: string;
    }[]
  >([]);
  const [popularItems, setPopularItems] = useState<
    {
      name: string;
      detail: string;
      price: number;
      orders: number;
      image: string | null;
    }[]
  >([]);
  const [orderMix, setOrderMix] = useState<{
    total: number;
    dineIn: number;
    takeout: number;
  }>({ total: 0, dineIn: 0, takeout: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** The day whose floor is being viewed. Defaults to today. */
  const [day, setDay] = useState<string>(() => toInputDate(new Date()));
  /** Staff day-overrides for the chosen day, keyed by table id. */
  const [overrides, setOverrides] = useState<Map<string, TableDailyStatusValue>>(
    () => new Map(),
  );
  /** Reservations overlapping the chosen day, used to derive holds. */
  const [dayReservations, setDayReservations] = useState<DayReservation[]>([]);

  useEffect(() => {
    async function loadDashboard() {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const weekStart = new Date(startOfDay);
      weekStart.setDate(weekStart.getDate() - 6);

      const results = await Promise.allSettled([
        supabase
          .from("orders")
          .select("id, order_number, status, total, created_at")
          .gte("created_at", startOfDay.toISOString())
          .order("created_at", { ascending: false }),
        supabase
          .from("reservations")
          .select(
            "id, guest_name, reserved_from, party_size, status, restaurant_tables(table_number)",
          )
          .gte("reserved_from", new Date().toISOString())
          .in("status", ["pending", "confirmed"])
          .order("reserved_from", { ascending: true })
          .limit(8),
        supabase
          .from("restaurant_tables")
          .select("*")
          .order("table_number"),
        supabase.from("menu_items").select("id").eq("available", false),
        supabase.from("customers").select("id", { count: "exact", head: true }),
        supabase
          .from("orders")
          .select("total, type, created_at")
          .eq("status", "served")
          .gte("created_at", weekStart.toISOString()),
        supabase
          .from("order_items")
          .select(
            "menu_item_id, menu_item_name, quantity, line_total, orders(status), menu_items(name, description, price, image_url)",
          )
          .limit(1000),
      ]);

      const orders =
        results[0].status === "fulfilled" ? results[0].value.data || [] : [];
      const reservations =
        results[1].status === "fulfilled"
          ? (results[1].value.data as RevenueReservationRow[]) || []
          : [];
      const tables =
        results[2].status === "fulfilled" ? results[2].value.data || [] : [];
      const unavailable =
        results[3].status === "fulfilled" ? results[3].value.data || [] : [];
      const weekOrders =
        results[5].status === "fulfilled"
          ? (results[5].value.data as OrderStatsRow[]) || []
          : [];
      const orderItemRows =
        results[6].status === "fulfilled"
          ? (results[6].value.data as OrderItemSaleRow[]) || []
          : [];
      const ordersError =
        results[0].status === "fulfilled" && results[0].value.error;

      if (ordersError)
        setError("Some live data is unavailable. Showing available figures.");

      const served = orders.filter((order) => order.status === "served");
      setStats({
        sales: served.reduce((sum, order) => sum + Number(order.total), 0),
        served: served.length,
        open: orders.filter((order) =>
          ["queued", "preparing", "serving"].includes(order.status),
        ).length,
        reservations: reservations.length,
        pending: reservations.filter(
          (reservation) => reservation.status === "pending",
        ).length,
        occupied: tables.filter((table) => table.status === "occupied").length,
        tables: tables.length,
        unavailable: unavailable.length,
        customers:
          results[4].status === "fulfilled" ? results[4].value.count || 0 : 0,
      });
      setRecentOrders(orders.slice(0, 5) as typeof recentOrders);
      setTables(tables);

      // Revenue per day for the last 7 days, from served orders.
      const revenueByDay = new Map<string, number>();
      weekOrders.forEach((order: OrderStatsRow) => {
        const date = new Date(order.created_at);
        const key = `${date.getMonth() + 1}/${date.getDate()}`;
        revenueByDay.set(
          key,
          (revenueByDay.get(key) || 0) + Number(order.total),
        );
      });
      const days: { day: string; value: number; amount: number }[] = [];
      for (let offset = 0; offset < 7; offset += 1) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + offset);
        const key = `${date.getMonth() + 1}/${date.getDate()}`;
        const amount = Math.round(revenueByDay.get(key) || 0);
        days.push({
          day: date.toLocaleDateString("en-US", { weekday: "short" }),
          amount,
          value: 0,
        });
      }
      const maxRevenue = Math.max(...days.map((entry) => entry.amount), 1);
      setRevenueData(
        days.map((entry) => ({
          ...entry,
          value: Math.round((entry.amount / maxRevenue) * 92),
        })),
      );

      setOrderMix({
        total: weekOrders.length,
        dineIn: weekOrders.filter(
          (order: OrderStatsRow) => order.type === "dine_in",
        ).length,
        takeout: weekOrders.filter(
          (order: OrderStatsRow) => order.type === "takeout",
        ).length,
      });

      setUpcomingReservations(
        reservations
          .map((reservation: RevenueReservationRow) => ({
            id: reservation.id,
            guest_name: reservation.guest_name,
            reserved_from: reservation.reserved_from,
            party_size: reservation.party_size,
            table_number:
              toOne(reservation.restaurant_tables)?.table_number ?? null,
            status: reservation.status,
          }))
          .slice(0, 4),
      );

      // Best-selling items from served orders.
      const itemTotals = new Map<
        string,
        {
          name: string;
          detail: string;
          price: number;
          orders: number;
          image: string | null;
        }
      >();
      orderItemRows.forEach((row: OrderItemSaleRow) => {
          const order = toOne(row.orders);
          const menu = toOne(row.menu_items);
          if (order?.status !== "served") return;
          const current = itemTotals.get(row.menu_item_id) || {
            name: row.menu_item_name || menu?.name || "Unknown item",
            detail: menu?.description || "",
            price: Number(menu?.price || 0),
            orders: 0,
            image: menu?.image_url || null,
          };
          current.orders += row.quantity;
          itemTotals.set(row.menu_item_id, current);
        });
      setPopularItems(
        Array.from(itemTotals.values())
          .sort((a, b) => b.orders - a.orders)
          .slice(0, 3),
      );

      setLoading(false);
    }

    loadDashboard();
  }, []);

  /** Load the chosen day's staff overrides and reservations for the floor plan. */
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverrides(nextOverrides);

      const { data: reservations } = await supabase
        .from("reservations")
        .select("table_id, status, reserved_from, reserved_to")
        .in("status", HOLDING_STATUSES)
        .not("table_id", "is", null)
        .lt("reserved_from", dayEnd.toISOString())
        .gt("reserved_to", dayStart.toISOString());

      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDayReservations((reservations || []) as DayReservation[]);
    })();
  }, [day]);

  /**
   * The floor for the chosen day: each table resolved by the same helper the
   * Tables page uses, so the two views can never disagree.
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

  if (loading) return <div className="bo-loading">Loading dashboard…</div>;

  const cards = [
    {
      label: "Today's sales",
      value: peso(stats.sales),
      icon: TrendingUp,
      tone: "gold",
    },
    {
      label: "Completed orders",
      value: String(stats.served),
      icon: CheckCircle2,
      tone: "green",
    },
    {
      label: "Open orders",
      value: String(stats.open),
      icon: Clock3,
      tone: "orange",
    },
    {
      label: "Reservations",
      value: String(stats.reservations),
      icon: CalendarDays,
      tone: "blue",
    },
    {
      label: "Occupied tables",
      value: `${stats.occupied} / ${stats.tables}`,
      icon: Grid3X3,
      tone: "red",
    },
  ];

  const revenueMax = Math.max(
    ...revenueData.map((entry) => entry.amount),
    1,
  );
  const formatAxis = (value: number) =>
    value >= 1000
      ? `₱${Math.round(value / 1000)}k`
      : `₱${value.toLocaleString("en-US")}`;
  const dinePct = orderMix.total
    ? Math.round((orderMix.dineIn / orderMix.total) * 100)
    : 0;
  const takePct = orderMix.total
    ? Math.round((orderMix.takeout / orderMix.total) * 100)
    : 0;
  const donutBackground =
    orderMix.total === 0
      ? "var(--surface)"
      : `conic-gradient(var(--gold) 0 ${dinePct}%, #6fa97f ${dinePct}% ${dinePct + takePct}%)`;

  return (
    <main className="dashboard-page">
      <div className="dashboard-hero">
        <div>
          <p className="dashboard-kicker">
            {role === "admin" ? "Admin overview" : "Operations overview"}
          </p>
          <h1>
            {role === "admin"
              ? "Restaurant control center"
              : "Service dashboard"}
          </h1>
          <p>Live pulse of the room, the kitchen, and today&apos;s revenue.</p>
        </div>
        <div className="dashboard-date">
          <span>Today</span>
          {new Date().toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      </div>
      {error && <div className="dashboard-notice">{error}</div>}
      <div className="stat-grid dashboard-stat-grid">
        {cards.map((card) => (
          <div className={`stat-card stat-${card.tone}`} key={card.label}>
            <div className="stat-card-top">
              <card.icon size={17} />
              <span>{card.label}</span>
            </div>
            <div className="stat-card-value">{card.value}</div>
          </div>
        ))}
      </div>
      <div className="dash-grid dashboard-lower-grid">
        <section className="dash-panel">
          <div className="dash-panel-header">
            <div>
              <p className="dashboard-kicker">Live feed</p>
              <h3>Recent orders</h3>
            </div>
            <Link className="dash-link" href="/orders">
              View all <ArrowUpRight size={14} />
            </Link>
          </div>
          {recentOrders.length === 0 ? (
            <p className="dashboard-empty">No orders recorded today.</p>
          ) : (
            <div className="dash-list">
              {recentOrders.map((order) => (
                <Link
                  className="dash-list-row"
                  href={`/orders/${order.id}`}
                  key={order.id}
                >
                  <span className="dashboard-order-number">
                    #{order.order_number}
                  </span>
                  <span className={`status-pill status-${order.status}`}>
                    {order.status}
                  </span>
                  <span className="dashboard-order-time">
                    {formatTime(order.created_at)}
                  </span>
                  <strong>{peso(Number(order.total))}</strong>
                </Link>
              ))}
            </div>
          )}
        </section>
        <section className="dash-panel dashboard-actions-panel">
          <div className="dash-panel-header">
            <div>
              <p className="dashboard-kicker">At a glance</p>
              <h3>Quick actions</h3>
            </div>
            <Receipt size={18} className="dashboard-muted-icon" />
          </div>
          <div className="dashboard-action-list">
            <Link href="/reservations">
              <CalendarDays size={17} />
              <span>
                Review reservations
                {stats.pending > 0 ? ` · ${stats.pending} pending` : ""}
              </span>
              <ArrowUpRight size={14} />
            </Link>
            {role === "admin" && (
              <Link href="/customers">
                <Users size={17} />
                <span>View {stats.customers} customers</span>
                <ArrowUpRight size={14} />
              </Link>
            )}
            <Link href="/menu-management/items">
              <UtensilsCrossed size={17} />
              <span>Update menu availability</span>
              <ArrowUpRight size={14} />
            </Link>
          </div>
        </section>
      </div>
      <div className="dashboard-insights-grid">
        <section className="dash-panel dashboard-chart-panel">
          <div className="dash-panel-header">
            <div>
              <p className="dashboard-kicker">Revenue overview</p>
              <h3>Last 7 days</h3>
            </div>
            <Link className="dash-link" href="/sales">
              Reports <ArrowUpRight size={14} />
            </Link>
          </div>
          <div
            className="revenue-chart"
            aria-label="Revenue over the last seven days"
          >
            <div className="revenue-axis">
              <span>{formatAxis(revenueMax)}</span>
              <span>{formatAxis(Math.round(revenueMax / 2))}</span>
              <span>₱0</span>
            </div>
            <div className="revenue-bars">
              {revenueMax <= 1 ? (
                <p className="dashboard-empty">
                  No served sales in the last 7 days yet.
                </p>
              ) : (
                revenueData.map((entry) => (
                  <div className="revenue-bar-wrap" key={entry.day}>
                    <div
                      className="revenue-bar"
                      style={{ height: `${Math.max(entry.value, 2)}%` }}
                      title={`${entry.day}: ${peso(entry.amount)}`}
                    />
                    <span>{entry.day}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
        <section className="dash-panel dashboard-chart-panel">
          <div className="dash-panel-header">
            <div>
              <p className="dashboard-kicker">Order mix</p>
              <h3>Service channels</h3>
            </div>
            <ShoppingBag size={18} className="dashboard-muted-icon" />
          </div>
          <div className="order-mix">
            <div
              className="donut-chart"
              style={{ background: donutBackground }}
            >
              <div className="donut-hole">
                <strong>{orderMix.total}</strong>
                <span>orders</span>
              </div>
            </div>
            <div className="mix-legend">
              <span>
                <i className="mix-dine" />
                Dine-in <b>{dinePct}%</b>
              </span>
              <span>
                <i className="mix-takeout" />
                Take-out <b>{takePct}%</b>
              </span>
            </div>
          </div>
        </section>
      </div>
      <div className="dashboard-three-grid">
        <section className="dash-panel">
          <div className="dash-panel-header">
            <div>
              <p className="dashboard-kicker">Tonight</p>
              <h3>Reservations</h3>
            </div>
            <Link className="dash-link" href="/reservations">
              View all <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="dashboard-reservation-list">
            {upcomingReservations.length === 0 ? (
              <p className="dashboard-empty">No upcoming reservations.</p>
            ) : (
              upcomingReservations.map((reservation) => (
                <Link
                  href="/reservations"
                  className="dashboard-reservation"
                  key={reservation.id}
                >
                  <div className="reservation-time">
                    {new Date(reservation.reserved_from).toLocaleTimeString(
                      "en-US",
                      {
                        hour: "numeric",
                        minute: "2-digit",
                      },
                    )}
                  </div>
                  <div className="reservation-detail">
                    <strong>{reservation.guest_name}</strong>
                    <span>
                      {reservation.party_size} guests
                      {reservation.table_number
                        ? ` · Table ${reservation.table_number}`
                        : ""}
                    </span>
                  </div>
                  <span
                    className={`status-pill status-${reservation.status}`}
                  >
                    {reservation.status}
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>
        <section className="dash-panel">
          <div className="dash-panel-header">
            <div>
              <p className="dashboard-kicker">Best sellers</p>
              <h3>Popular menu items</h3>
            </div>
            <Link className="dash-link" href="/menu-management/items">
              Menu <ArrowUpRight size={14} />
            </Link>
          </div>
          <div className="popular-item-list">
            {popularItems.length === 0 ? (
              <p className="dashboard-empty">No items sold yet.</p>
            ) : (
              popularItems.map((item) => (
                <Link
                  href="/menu-management/items"
                  className="popular-item"
                  key={item.name}
                >
                  {item.image ? (
                    <img src={item.image} alt="" />
                  ) : (
                    <span
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 6,
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                      }}
                    />
                  )}
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.detail}</span>
                  </div>
                  <div className="popular-item-meta">
                    <b>{item.price > 0 ? peso(item.price) : "—"}</b>
                    <small>{item.orders} orders</small>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
        <section className="dash-panel">
          <div className="dash-panel-header">
            <div>
              <p className="dashboard-kicker">Floor plan</p>
              <h3>Table availability</h3>
            </div>
            <div className="dash-panel-header-actions">
              <label
                className="filter-select dash-floor-day"
                title="Choose the day to view"
              >
                <CalendarDays size={14} />
                <input
                  type="date"
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </label>
              <Link className="dash-link" href="/tables">
                Manage <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
          <div className="table-legend">
            {LEGEND_STATUSES.map((s) => (
              <span key={s}>
                <i style={{ background: TABLE_DAY_STATUS_COLOR[s] }} />
                {TABLE_DAY_STATUS_LABEL[s]}
              </span>
            ))}
          </div>
          <div className="table-floor-plan">
            {floor.length === 0 ? (
              <p className="dashboard-empty">No tables configured.</p>
            ) : (
              floor.map((resolved) => (
                <Link
                  href="/tables"
                  className={`floor-table floor-${resolved.dayStatus}`}
                  key={resolved.table.id}
                  title={`Table ${resolved.table.table_number} · ${TABLE_DAY_STATUS_LABEL[resolved.dayStatus]}`}
                >
                  {String(resolved.table.table_number).padStart(2, "0")}
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
      
    </main>
  );
}
