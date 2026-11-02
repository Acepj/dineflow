"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search, ArrowRight, Receipt } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import type { OrderWithPayment, PaymentMethod } from "@/types/database.types";

function formatP(n: number) {
  return (
    "₱" +
    Number(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function methodLabel(method: PaymentMethod) {
  return method === "bank_transfer" ? "Bank Transfer" : method;
}

export default function BillingPage() {
  const [orders, setOrders] = useState<OrderWithPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [filterPayment, setFilterPayment] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    const { data, error: queryError } = await supabase
      .from("orders")
      .select(
        "*, restaurant_tables(table_number), customers(name, phone), order_items(*), payments(*)",
      )
      .order("created_at", { ascending: false });

    if (queryError) {
      setOrders([]);
      setError(true);
      setLoading(false);
      return;
    }

    setOrders((data as OrderWithPayment[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // The loader updates state from the async Supabase response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const filtered = orders.filter((order) => {
    const normalizedSearch = search.trim().toLowerCase();
    const matchSearch =
      !normalizedSearch ||
      String(order.order_number).includes(normalizedSearch) ||
      (order.customers?.name || "")
        .toLowerCase()
        .includes(normalizedSearch);
    const isPaid = order.payments && order.payments.length > 0;
    const matchPayment =
      filterPayment === "all" ||
      (filterPayment === "paid" ? isPaid : !isPaid);
    return matchSearch && matchPayment;
  });

  const unpaidCount = orders.filter(
    (order) =>
      order.status !== "cancelled" &&
      (!order.payments || order.payments.length === 0),
  ).length;
  const paidCount = orders.filter(
    (order) => order.payments && order.payments.length > 0,
  ).length;
  const collected = orders.reduce(
    (sum, order) =>
      sum +
      (order.payments || []).reduce(
        (paymentSum, payment) => paymentSum + Number(payment.amount_due),
        0,
      ),
    0,
  );
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
            value={filterPayment}
            onChange={(e) => setFilterPayment(e.target.value)}
          >
            <option value="all">All Bills</option>
            <option value="unpaid">Unpaid</option>
            <option value="paid">Paid</option>
          </select>
        </div>
        <div className="billing-toolbar-total">
          <Receipt size={14} />
          <span>
            <strong>{unpaidCount}</strong> open ·{" "}
            <strong>{paidCount}</strong> settled ·{" "}
            <strong>{formatP(collected)}</strong> collected
          </span>
        </div>
      </div>

      {error ? (
        <div className="billing-error-state" role="alert">
          <p>Unable to load bills.</p>
          <button type="button" className="btn-ghost" onClick={load}>
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="bo-loading">Loading bills…</div>
      ) : filtered.length === 0 ? (
        <div className="billing-empty-state">
          <Receipt size={28} />
          <h3>{orders.length ? "No bills match" : "No bills yet"}</h3>
          <p>
            {orders.length
              ? "Try a different search or payment filter."
              : "Orders that need settling will appear here."}
          </p>
        </div>
      ) : (
        <div className="data-table">
          <div className="data-table-header">
            <div>Order #</div>
            <div>Customer</div>
            <div>Table</div>
            <div>Items</div>
            <div>Total</div>
            <div>Payment</div>
            <div></div>
          </div>
          {filtered.map((order) => {
            const isPaid = order.payments && order.payments.length > 0;
            const cancelled = order.status === "cancelled";
            return (
              <div key={order.id} className="data-table-row">
                <div className="font-mono">#{order.order_number}</div>
                <div>{order.customers?.name || "Walk-in"}</div>
                <div>
                  {order.restaurant_tables
                    ? `Table ${order.restaurant_tables.table_number}`
                    : "—"}
                </div>
                <div>{order.order_items?.length || 0}</div>
                <div>{formatP(Number(order.total))}</div>
                <div>
                  <span
                    className={`status-badge ${
                      isPaid ? "status-completed" : "status-pending"
                    }`}
                  >
                    {isPaid
                      ? `Paid · ${methodLabel(order.payments[0].method)}`
                      : cancelled
                        ? "Cancelled"
                        : "Unpaid"}
                  </span>
                </div>
                <div>
                  {cancelled && !isPaid ? (
                    <span className="data-table-muted">—</span>
                  ) : (
                    <Link href={`/billing/${order.id}`} className="btn-icon">
                      {isPaid ? "Receipt" : "Settle"}
                      <ArrowRight size={12} />
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