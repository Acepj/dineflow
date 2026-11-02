"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  BarChart3,
  Calendar,
  Download,
  Printer,
  RefreshCw,
} from "lucide-react";
import { DashboardBackButton } from "@/components/ui/dashboard-back-button";
import { supabase } from "@/lib/supabase/client";
import type {
  MenuItemWithCategory,
  Order,
  OrderItem,
  Payment,
} from "@/types/database.types";

type ReportOrder = Order & {
  order_items: OrderItem[];
  restaurant_tables: { table_number: number } | null;
  customers: { name: string } | null;
  payments: Payment[];
};

type Preset =
  | "today"
  | "yesterday"
  | "last-7-days"
  | "last-30-days"
  | "this-month"
  | "custom";

const PIE_COLORS = [
  "#C6A15B",
  "#6FA97F",
  "#8AA6C1",
  "#D9A03C",
  "#C1584F",
  "#9A958C",
];

function formatP(value: number) {
  return (
    "₱" +
    Number(value).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function toDateInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function SalesReportPage() {
  const [orders, setOrders] = useState<ReportOrder[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemWithCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [preset, setPreset] = useState<Preset>("custom");
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const query = supabase
      .from("orders")
      .select(
        "*, order_items(*), restaurant_tables(table_number), customers(name), payments(*)",
      )
      .eq("status", "served")
      .order("created_at", { ascending: false });
    if (dateFrom) query.gte("created_at", `${dateFrom}T00:00:00`);
    if (dateTo) query.lte("created_at", `${dateTo}T23:59:59`);

    const [ordersResult, menuResult] = await Promise.all([
      query,
      supabase.from("menu_items").select("*, categories(name)").order("name"),
    ]);

    if (ordersResult.error || menuResult.error) {
      setOrders([]);
      setMenuItems([]);
      setError(true);
      setLoading(false);
      return;
    }

    const paidOrders = (
      (ordersResult.data || []) as unknown as ReportOrder[]
    ).filter((order) => order.payments?.length > 0);
    setOrders(paidOrders);
    setMenuItems((menuResult.data || []) as unknown as MenuItemWithCategory[]);
    setLoading(false);
  }, [dateFrom, dateTo]);

  useEffect(() => {
    // The loader updates state from the async Supabase response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const menuCategoryById = useMemo(
    () =>
      new Map(
        menuItems.map((item) => [item.id, item.categories?.name || "Other"]),
      ),
    [menuItems],
  );
  const totalSales = orders.reduce(
    (sum, order) => sum + Number(order.total),
    0,
  );
  const totalOrders = orders.length;
  const avgTicket = totalOrders ? totalSales / totalOrders : 0;

  const dailyData = useMemo(() => {
    const daily = new Map<
      string,
      { date: string; sales: number; orders: number }
    >();
    orders.forEach((order) => {
      const date = order.created_at.slice(0, 10);
      const current = daily.get(date) || { date, sales: 0, orders: 0 };
      current.sales += Number(order.total);
      current.orders += 1;
      daily.set(date, current);
    });
    return Array.from(daily.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }, [orders]);

  const categoryData = useMemo(() => {
    const categories = new Map<string, number>();
    orders.forEach((order) => {
      order.order_items?.forEach((item) => {
        const category = menuCategoryById.get(item.menu_item_id) || "Other";
        categories.set(
          category,
          (categories.get(category) || 0) + Number(item.line_total),
        );
      });
    });
    return Array.from(categories.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [menuCategoryById, orders]);

  const topItems = useMemo(() => {
    const items = new Map<
      string,
      { name: string; category: string; qty: number; revenue: number }
    >();
    orders.forEach((order) => {
      order.order_items?.forEach((item) => {
        const current = items.get(item.menu_item_id) || {
          name: item.menu_item_name,
          category: menuCategoryById.get(item.menu_item_id) || "Other",
          qty: 0,
          revenue: 0,
        };
        current.qty += item.quantity;
        current.revenue += Number(item.line_total);
        items.set(item.menu_item_id, current);
      });
    });
    return Array.from(items.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);
  }, [menuCategoryById, orders]);

  const selectedPeriod =
    dateFrom || dateTo
      ? `${dateFrom ? formatDate(dateFrom) : "All dates"} - ${dateTo ? formatDate(dateTo) : "All dates"}`
      : "All available dates";

  const applyPreset = (nextPreset: Preset) => {
    const today = startOfDay(new Date());
    let from = "";
    let to = toDateInput(today);
    if (nextPreset === "yesterday") {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      from = to = toDateInput(yesterday);
    } else if (nextPreset === "last-7-days") {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      from = toDateInput(start);
    } else if (nextPreset === "last-30-days") {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      from = toDateInput(start);
    } else if (nextPreset === "this-month") {
      from = toDateInput(new Date(today.getFullYear(), today.getMonth(), 1));
    } else if (nextPreset === "today") {
      from = to;
    } else {
      setPreset("custom");
      return;
    }
    setDateFrom(from);
    setDateTo(to);
    setPreset(nextPreset);
  };

  const exportCSV = () => {
    setExportNotice(null);
    if (!orders.length) {
      setExportNotice("No sales data available for the selected period.");
      return;
    }
    const rows = [
      [
        "Date",
        "Order ID",
        "Customer",
        "Item",
        "Category",
        "Quantity",
        "Subtotal",
        "Total",
        "Payment Status",
      ],
    ];
    orders.forEach((order) => {
      order.order_items?.forEach((item) => {
        rows.push([
          formatDateTime(order.created_at),
          String(order.order_number),
          order.customers?.name || "Walk-in",
          item.menu_item_name,
          menuCategoryById.get(item.menu_item_id) || "Other",
          String(item.quantity),
          String(order.subtotal),
          String(order.total),
          "Paid",
        ]);
      });
    });
    const csv = rows
      .map((row) =>
        row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `sales-report-${toDateInput(new Date())}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const presetOptions: { value: Preset; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "yesterday", label: "Yesterday" },
    { value: "last-7-days", label: "Last 7 Days" },
    { value: "last-30-days", label: "Last 30 Days" },
    { value: "this-month", label: "This Month" },
    { value: "custom", label: "Custom" },
  ];

  return (
    <div className="sales-report-page">
      <DashboardBackButton />
      <header className="report-page-header">
        <p className="report-kicker">Reports</p>
        <h1>Sales &amp; Analytics</h1>
        <p>Track restaurant sales, orders, and top-performing menu items.</p>
      </header>

      <section className="report-controls" aria-label="Report filters">
        <div className="report-filter-heading">
          <Calendar size={16} />
          <span>Date Range</span>
        </div>
        <div className="report-presets">
          {presetOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`report-preset ${preset === option.value ? "active" : ""}`}
              onClick={() => applyPreset(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="report-date-fields">
          <label>
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPreset("custom");
              }}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPreset("custom");
              }}
            />
          </label>
        </div>
        <div className="report-actions">
          <button className="btn-ghost" type="button" onClick={exportCSV}>
            <Download size={15} /> Export CSV
          </button>
          <button
            className="btn-ghost"
            type="button"
            onClick={() => window.print()}
          >
            <Printer size={15} /> Print
          </button>
        </div>
      </section>
      {exportNotice && (
        <p className="report-notice" role="status">
          {exportNotice}
        </p>
      )}

      {error ? (
        <section className="report-error-state" role="alert">
          <BarChart3 size={24} />
          <h2>Unable to load sales data</h2>
          <p>Please try again.</p>
          <button className="btn-ghost" type="button" onClick={load}>
            <RefreshCw size={14} /> Retry
          </button>
        </section>
      ) : (
        <>
          <section className="report-summary" aria-label="Sales summary cards">
            {loading
              ? ["Total Sales", "Orders", "Avg Ticket"].map((label) => (
                  <div
                    className="report-summary-card report-skeleton-card"
                    key={label}
                  >
                    <span>{label}</span>
                    <i />
                    <em />
                  </div>
                ))
              : [
                  [
                    "Total Sales",
                    formatP(totalSales),
                    "Revenue during selected period",
                  ],
                  [
                    "Orders",
                    String(totalOrders),
                    "Completed paid orders during selected period",
                  ],
                  ["Avg Ticket", formatP(avgTicket), "Average order value"],
                ].map(([label, value, description]) => (
                  <div className="report-summary-card" key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                    <small>{description}</small>
                  </div>
                ))}
          </section>

          <section className="report-charts">
            <div className="dash-panel report-chart-panel">
              <div className="report-panel-heading">
                <div>
                  <h2>Daily Sales</h2>
                  <p>{selectedPeriod}</p>
                </div>
              </div>
              {loading ? (
                <div className="report-chart-loading" />
              ) : dailyData.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={dailyData}
                    margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#2a2a2a"
                      vertical={false}
                    />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(value: string) =>
                        formatDate(value).split(",")[0]
                      }
                      stroke="#9a958c"
                      tickLine={false}
                      fontSize={11}
                      tickMargin={8}
                    />
                    <YAxis
                      stroke="#9a958c"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      tickMargin={6}
                      tickFormatter={(value: number) =>
                        `₱${Math.round(value).toLocaleString()}`
                      }
                    />
                    <Tooltip
                      formatter={(value: unknown) => [
                        formatP(Number(value) || 0),
                        "Sales",
                      ]}
                      labelFormatter={(value: unknown) =>
                        typeof value === "string" ? formatDate(value) : ""
                      }
                      cursor={{ fill: "rgba(198, 161, 91, 0.06)" }}
                      contentStyle={{
                        background: "#161616",
                        border: "1px solid rgba(198, 161, 91, 0.28)",
                        borderRadius: 8,
                        fontSize: 12,
                        padding: "8px 12px",
                        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
                      }}
                      labelStyle={{ color: "#f4efe4", fontWeight: 600 }}
                      itemStyle={{ color: "#c6a15b" }}
                    />
                    <Bar
                      dataKey="sales"
                      fill="#C6A15B"
                      radius={[4, 4, 0, 0]}
                      maxBarSize={38}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="report-empty-state">
                  <BarChart3 size={24} />
                  <h3>No sales data</h3>
                  <p>There are no completed sales for the selected period.</p>
                </div>
              )}
            </div>

            <div className="dash-panel report-chart-panel">
              <div className="report-panel-heading">
                <div>
                  <h2>Sales by Category</h2>
                  <p>Revenue contribution by menu category</p>
                </div>
              </div>
              {loading ? (
                <div className="report-chart-loading" />
              ) : categoryData.length ? (
                <div className="category-chart-wrap">
                  <ResponsiveContainer width="48%" height={220}>
                    <PieChart>
                      <Pie
                        data={categoryData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={52}
                        outerRadius={82}
                        paddingAngle={3}
                      >
                        {categoryData.map((category, index) => (
                          <Cell
                            key={category.name}
                            fill={PIE_COLORS[index % PIE_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: unknown) =>
                          formatP(Number(value) || 0)
                        }
                        contentStyle={{
                          background: "#161616",
                          border: "1px solid rgba(198, 161, 91, 0.28)",
                          borderRadius: 8,
                          fontSize: 12,
                          padding: "8px 12px",
                          boxShadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
                        }}
                        labelStyle={{ color: "#f4efe4", fontWeight: 600 }}
                        itemStyle={{ color: "#c6a15b" }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="category-legend">
                    {categoryData.map((category, index) => {
                      const percentage = totalSales
                        ? Math.round(
                            (category.value /
                              categoryData.reduce(
                                (sum, item) => sum + item.value,
                                0,
                              )) *
                              100,
                          )
                        : 0;
                      return (
                        <div key={category.name}>
                          <span>
                            <i
                              style={{
                                background:
                                  PIE_COLORS[index % PIE_COLORS.length],
                              }}
                            />
                            {category.name}
                          </span>
                          <strong>{percentage}%</strong>
                          <small>{formatP(category.value)}</small>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="report-empty-state">
                  <BarChart3 size={24} />
                  <h3>No category sales</h3>
                  <p>
                    Sales by category will appear once completed orders are
                    recorded.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="dash-panel report-table-panel">
            <div className="report-panel-heading">
              <div>
                <h2>Top 5 Items</h2>
                <p>Best-selling menu items during the selected period</p>
              </div>
            </div>
            {loading ? (
              <div className="report-table-loading" />
            ) : topItems.length ? (
              <div className="data-table report-top-table">
                <div className="data-table-header">
                  <div>Rank</div>
                  <div>Item</div>
                  <div>Category</div>
                  <div>Qty Sold</div>
                  <div>Revenue</div>
                </div>
                {topItems.map((item, index) => (
                  <div key={item.name} className="data-table-row">
                    <div className="report-rank">
                      {String(index + 1).padStart(2, "0")}
                    </div>
                    <div>
                      <strong>{item.name}</strong>
                    </div>
                    <div>{item.category}</div>
                    <div>{item.qty}</div>
                    <div>{formatP(item.revenue)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="report-empty-state report-table-empty">
                <BarChart3 size={24} />
                <h3>No items sold</h3>
                <p>
                  Top-selling menu items will appear after completed orders are
                  recorded.
                </p>
              </div>
            )}
          </section>

          <section className="dash-panel report-summary-detail">
            <div className="report-panel-heading">
              <div>
                <h2>Sales Summary</h2>
                <p>A quick reference for the selected reporting period</p>
              </div>
            </div>
            <dl>
              <div>
                <dt>Selected Period</dt>
                <dd>{selectedPeriod}</dd>
              </div>
              <div>
                <dt>Total Revenue</dt>
                <dd>{formatP(totalSales)}</dd>
              </div>
              <div>
                <dt>Total Orders</dt>
                <dd>{totalOrders}</dd>
              </div>
              <div>
                <dt>Average Order Value</dt>
                <dd>{formatP(avgTicket)}</dd>
              </div>
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
