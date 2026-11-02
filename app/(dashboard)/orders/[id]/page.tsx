"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import type { OrderWithPayment } from "@/types/database.types";

function formatP(n: number) {
  return "₱" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

function minutesSince(value: string) {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60000),
  );
}

export default function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [order, setOrder] = useState<OrderWithPayment | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("orders")
      .select(
        "*, restaurant_tables(table_number, capacity, location), customers(name, phone), order_items(*), payments(*)",
      )
      .eq("id", id)
      .maybeSingle();
    setOrder((data as OrderWithPayment) || null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    // The loader updates state from the async Supabase response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const advanceStatus = async (newStatus: string) => {
    await supabase
      .from("orders")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", id);
    load();
  };

  if (loading) return <div className="bo-loading">Loading order…</div>;
  if (!order) return <div className="bo-loading">Order not found.</div>;

  const elapsedMin = minutesSince(order.created_at);
  const isLate =
    elapsedMin >
    (order.order_items?.reduce((max) => Math.max(max, 0), 0) || 15);
  const isPaid = Boolean(order.payments && order.payments.length > 0);
  const cancelled = order.status === "cancelled";

  const statusFlow: Record<string, string> = {
    queued: "preparing",
    preparing: "serving",
    serving: "served",
  };

  return (
    <div className="order-detail">
      <Link href="/orders" className="back-link">
        <ArrowLeft size={15} /> Back to orders
      </Link>

      <div className="order-detail-header">
        <div>
          <h1>Order #{order.order_number}</h1>
          <p className="text-muted">
            {new Date(order.created_at).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
        </div>
        <span className={`status-badge status-${order.status}`}>
          {order.status}
        </span>
      </div>

      <div className="order-detail-grid">
        <div className="order-detail-main">
          <div className="dash-panel">
            <h3>Items</h3>
            <div className="order-items-list">
              {order.order_items?.map((item) => (
                <div key={item.id} className="order-item-row">
                  <span className="order-item-qty">{item.quantity}×</span>
                  <div className="order-item-info">
                    <span className="order-item-name">
                      {item.menu_item_name}
                    </span>
                    {item.notes && (
                      <span className="order-item-notes">{item.notes}</span>
                    )}
                  </div>
                  <span className="order-item-price">
                    {formatP(Number(item.unit_price))}
                  </span>
                  <span className="order-item-total">
                    {formatP(Number(item.line_total))}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Order-level special instructions from cart checkout ("Special
              instructions for the kitchen"). Rendered only when the customer
              entered any, so regular orders keep the exact same layout. */}
          {order.special_instructions ? (
            <div className="dash-panel">
              <h3>Special Instructions</h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  overflowWrap: "anywhere",
                }}
              >
                {order.special_instructions}
              </p>
            </div>
          ) : null}

          <div className="dash-panel">
            <h3>Update Status</h3>
            {order.status === "cancelled" ? (
              <p className="text-muted">This order is cancelled.</p>
            ) : order.status === "served" ? (
              <p className="text-muted">This order has been served.</p>
            ) : (
              <div className="status-flow-actions">
                {statusFlow[order.status] && (
                  <button
                    className="btn-primary"
                    onClick={() => advanceStatus(statusFlow[order.status])}
                  >
                    Advance to {statusFlow[order.status]}
                  </button>
                )}
                <button
                  className="btn-ghost danger"
                  onClick={() => advanceStatus("cancelled")}
                >
                  Cancel Order
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="order-detail-side">
          <div className="dash-panel">
            <h3>Summary</h3>
            <div className="order-info-row">
              <span>Type</span>
              <strong>
                {order.type === "dine_in" ? "Dine In" : "Takeout"}
              </strong>
            </div>
            <div className="order-info-row">
              <span>Table</span>
              <strong>
                {order.restaurant_tables
                  ? `Table ${order.restaurant_tables.table_number}`
                  : "—"}
              </strong>
            </div>
            <div className="order-info-row">
              <span>Customer</span>
              <strong>{order.customers?.name || "Walk-in"}</strong>
            </div>
            {isLate &&
              order.status !== "served" &&
              order.status !== "cancelled" && (
                <div className="order-late">
                  <AlertTriangle size={14} /> {elapsedMin} min elapsed
                </div>
              )}
          </div>
          <div className="dash-panel">
            <h3>Totals</h3>
            <div className="order-info-row">
              <span>Subtotal</span>
              <span>{formatP(Number(order.subtotal))}</span>
            </div>
            <div className="order-info-row">
              <span>Service</span>
              <span>{formatP(Number(order.service_charge))}</span>
            </div>
            <div className="order-info-row">
              <span>VAT</span>
              <span>{formatP(Number(order.tax))}</span>
            </div>
            {Number(order.discount) > 0 && (
              <div className="order-info-row">
                <span>Discount</span>
                <span>-{formatP(Number(order.discount))}</span>
              </div>
            )}
            <div className="order-info-row order-total-row">
              <span>Total</span>
              <strong>{formatP(Number(order.total))}</strong>
            </div>
          </div>
          {/* Settlement shortcut for admin/staff. Unpaid orders (whatever the
              kitchen status) link straight to the /billing/[orderId] settle
              screen — the same one the staff Billing list uses — so a bill can
              be closed without hunting for it. Paid orders link to the receipt;
              cancelled orders are never settleable. */}
          {cancelled ? null : isPaid ? (
            <Link
              href={`/billing/${order.id}`}
              className="btn-ghost"
              style={{ display: "block", textAlign: "center" }}
            >
              View Receipt
            </Link>
          ) : (
            <Link
              href={`/billing/${order.id}`}
              className="btn-primary"
              style={{ display: "block", textAlign: "center" }}
            >
              Settle Payment
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
