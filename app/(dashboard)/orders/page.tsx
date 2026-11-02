"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Search, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import type { OrderWithPayment, PaymentMethod } from "@/types/database.types";

function formatP(n: number) {
  return "₱" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

function methodLabel(method: PaymentMethod) {
  return method === "bank_transfer" ? "Bank Transfer" : method;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderWithPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("orders")
      .select(
        "*, restaurant_tables(table_number, capacity, location), customers(name, phone), order_items(*), payments(*)",
      )
      .order("created_at", { ascending: false });
    setOrders((data as OrderWithPayment[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // The loader updates state from the async Supabase response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const filtered = orders.filter((o) => {
    const matchSearch =
      String(o.order_number).includes(search) ||
      (o.customers?.name || "").toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "all" || o.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div>
      <div className="page-toolbar">
        <div className="toolbar-left">
          <div className="search-box">
            <Search size={15} />
            <input
              type="text"
              placeholder="Search by order # or customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="filter-select"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
          >
            <option value="all">All Status</option>
            <option value="queued">Queued</option>
            <option value="preparing">Preparing</option>
            <option value="serving">Serving</option>
            <option value="served">Served</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {loading ? (
        <div className="bo-loading">Loading orders…</div>
      ) : (
        <div className="data-table orders-table">
          <div className="data-table-header">
            <div>Order #</div>
            <div>Type</div>
            <div>Table</div>
            <div>Customer</div>
            <div>Items</div>
            <div>Status</div>
            <div>Total</div>
            <div>Payment</div>
            <div></div>
          </div>
          {filtered.map((o) => {
            const isPaid = o.payments && o.payments.length > 0;
            const cancelled = o.status === "cancelled";
            // Cancelled-and-unpaid orders must never be settleable; every
            // other unpaid order links to the same /billing/[orderId] settle
            // screen the staff Billing page uses, so admin can close out a
            // bill straight from Orders.
            const canSettle = !isPaid && !cancelled;
            return (
              <div key={o.id} className="data-table-row">
                <div className="font-mono">#{o.order_number}</div>
                <div>{o.type === "dine_in" ? "Dine In" : "Takeout"}</div>
                <div>
                  {o.restaurant_tables
                    ? `Table ${o.restaurant_tables.table_number}`
                    : "—"}
                </div>
                <div>
                  {o.customers?.name || "Walk-in"}
                  {/* Order-level special instructions from cart checkout.
                      Already fetched by the `*` select; shown under the
                      customer so staff can spot notes without opening the
                      order. Clamped to 2 lines (full text is on the order
                      detail page and in the title tooltip). */}
                  {o.special_instructions ? (
                    <span
                      className="text-muted"
                      title={o.special_instructions}
                      style={{
                        display: "-webkit-box",
                        overflow: "hidden",
                        WebkitBoxOrient: "vertical",
                        WebkitLineClamp: 2,
                        fontSize: 11,
                        marginTop: 2,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {o.special_instructions}
                    </span>
                  ) : null}
                </div>
                <div>{o.order_items?.length || 0}</div>
                <div>
                  <span className={`status-badge status-${o.status}`}>
                    {o.status}
                  </span>
                </div>
                <div>{formatP(Number(o.total))}</div>
                <div>
                  <span
                    className={`status-badge ${
                      isPaid ? "status-completed" : "status-pending"
                    }`}
                  >
                    {isPaid
                      ? `Paid · ${methodLabel(o.payments[0].method)}`
                      : cancelled
                        ? "Cancelled"
                        : "Unpaid"}
                  </span>
                </div>
                <div>
                  {canSettle ? (
                    <Link href={`/billing/${o.id}`} className="btn-icon">
                      Settle <ArrowRight size={12} />
                    </Link>
                  ) : isPaid ? (
                    // Settled order: open the order detail, or jump straight to
                    // the receipt rendered by /billing/[orderId] (the same
                    // screen the Billing list uses for a paid bill).
                    <div className="orders-actions">
                      <Link href={`/orders/${o.id}`} className="btn-icon">
                        View <ArrowRight size={12} />
                      </Link>
                      <Link href={`/billing/${o.id}`} className="btn-icon">
                        Receipt <ArrowRight size={12} />
                      </Link>
                    </div>
                  ) : (
                    <Link href={`/orders/${o.id}`} className="btn-icon">
                      View <ArrowRight size={12} />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
