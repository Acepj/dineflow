"use client";

import { useEffect, useState, useCallback } from "react";
import { Clock3, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import type { OrderWithDetails } from "@/types/database.types";

const COLUMN_COLORS: Record<string, string> = {
  queued: "#8aa6c1",
  preparing: "#d9a03c",
  serving: "#6fa97f",
};

const ACTIVE_STATUSES = ["queued", "preparing", "serving"];

function minutesSince(value: string) {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
}

function formatElapsed(mins: number) {
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${String(mins % 60).padStart(2, "0")}m`;
}

export default function KitchenPage() {
  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("orders")
      .select(
        "*, restaurant_tables(table_number, capacity, location), customers(name, phone), order_items(*)",
      )
      .in("status", ACTIVE_STATUSES)
      .order("created_at");
    setOrders((data as OrderWithDetails[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // The loader updates state from the async Supabase response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const updateStatus = async (orderId: string, status: string) => {
    await supabase
      .from("orders")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", orderId);
    load();
  };

  const byStatus = (status: string) =>
    orders.filter((order) => order.status === status);

  if (loading) return <div className="bo-loading">Loading kitchen…</div>;

  return (
    <div>
      <div className="page-toolbar">
        <div>
          <h2>Kitchen</h2>
          <p className="text-muted">
            Active tickets grouped by preparation stage
          </p>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="kitchen-empty">
          No active orders. New orders will appear here as they are placed.
        </div>
      ) : (
        <div className="kitchen-board">
          {ACTIVE_STATUSES.map((status) => (
            <section key={status} className="kitchen-column">
              <div
                className="kitchen-column-header"
                style={{ borderBottomColor: COLUMN_COLORS[status] }}
              >
                <span className="kitchen-column-label">{status}</span>
                <span className="kitchen-column-count">
                  {byStatus(status).length}
                </span>
              </div>
              <div className="kitchen-column-body">
                {byStatus(status).length === 0 ? (
                  <div className="kitchen-empty">No {status} tickets</div>
                ) : (
                  byStatus(status).map((order) => {
                    const elapsedMin = minutesSince(order.created_at);
                    const isLate = elapsedMin > 15;
                    return (
                      <div
                        key={order.id}
                        className={`kitchen-ticket${isLate ? " late" : ""}`}
                      >
                        <div className="kitchen-ticket-top">
                          <span className="kitchen-ticket-num">
                            #{order.order_number}
                          </span>
                          <span className="kitchen-ticket-table">
                            {order.restaurant_tables
                              ? `Table ${order.restaurant_tables.table_number}`
                              : "Takeout"}
                            {order.customers?.name
                              ? ` · ${order.customers.name}`
                              : ""}
                          </span>
                        </div>

                        <div className="kitchen-ticket-items">
                          {order.order_items?.map((item) => (
                            <div key={item.id} className="kitchen-ticket-item">
                              <span className="kitchen-item-qty">
                                {item.quantity}×
                              </span>
                              <span className="kitchen-item-name">
                                {item.menu_item_name}
                              </span>
                              {item.notes && (
                                <span className="kitchen-item-notes">
                                  “{item.notes}”
                                </span>
                              )}
                            </div>
                          ))}
                        </div>

                        {/* Order-level special instructions from cart
                            checkout — this is exactly what the customer wrote
                            "for the kitchen", so it belongs on the ticket. */}
                        {order.special_instructions ? (
                          <div
                            className="kitchen-item-notes"
                            style={{
                              margin: "0 0 12px",
                              overflowWrap: "anywhere",
                            }}
                          >
                            Special instructions: {order.special_instructions}
                          </div>
                        ) : null}

                        <span
                          className={`kitchen-ticket-time${isLate ? " late" : ""}`}
                        >
                          <Clock3 size={12} /> {formatElapsed(elapsedMin)}
                          {isLate && (
                            <span className="kitchen-late-flag">
                              <AlertTriangle size={11} /> behind
                            </span>
                          )}
                        </span>

                        <div className="kitchen-ticket-actions">
                          {status === "queued" && (
                            <button
                              className="kitchen-btn advance"
                              onClick={() =>
                                updateStatus(order.id, "preparing")
                              }
                            >
                              Start
                            </button>
                          )}
                          {status === "preparing" && (
                            <button
                              className="kitchen-btn advance"
                              onClick={() => updateStatus(order.id, "serving")}
                            >
                              Ready
                            </button>
                          )}
                          {status === "serving" && (
                            <button
                              className="kitchen-btn complete"
                              onClick={() => updateStatus(order.id, "served")}
                            >
                              Served
                            </button>
                          )}
                          <button
                            className="kitchen-btn cancel"
                            onClick={() => updateStatus(order.id, "cancelled")}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}