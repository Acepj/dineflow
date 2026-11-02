"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { ArrowLeft, Printer, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import type { OrderWithPayment, PaymentMethod } from "@/types/database.types";

function formatP(n: number) {
  return "₱" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

/**
 * Extract a human-readable message from an unknown thrown value. Supabase
 * PostgREST errors are plain objects carrying `message` (not Error instances),
 * so both shapes are handled — the real database error must reach the user
 * instead of a generic "please try again".
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as { message: unknown }).message === "string"
  ) {
    return (err as { message: string }).message;
  }
  return String(err);
}

export default function CheckoutPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = use(params);
  const [order, setOrder] = useState<OrderWithPayment | null>(null);
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [tendered, setTendered] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("orders")
      .select(
        "*, restaurant_tables(table_number, capacity, location), customers(name, phone), order_items(*), payments(*)",
      )
      .eq("id", orderId)
      .maybeSingle();
    setOrder((data as OrderWithPayment) || null);
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    // The loader updates state from the async Supabase response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const subtotal = order ? Number(order.subtotal) : 0;
  // Only a discount already stored on the order (e.g. a promo applied at
  // checkout) is honoured here — the Discount input was removed from this
  // form. Orders without a discount keep the exact same total (0 applied).
  const storedDiscount = order
    ? Math.min(Math.max(Number(order.discount) || 0, 0), subtotal)
    : 0;
  const serviceCharge = order ? Number(order.service_charge) : 0;
  const tax = order ? Number(order.tax) : 0;
  const totalDue = Math.max(0, subtotal + serviceCharge + tax - storedDiscount);
  const tenderedNum = parseFloat(tendered) || 0;
  const change = Math.max(0, tenderedNum - totalDue);

  const handlePay = async () => {
    // Guard against rapid double-clicks racing past `disabled={submitting}`
    // and creating duplicate payment records.
    if (submitting) return;
    setError(null);
    if (!order) return;
    if (order.status === "cancelled") {
      setError("Cannot pay for a cancelled order.");
      return;
    }
    if (order.payments && order.payments.length > 0) {
      setError("This order is already paid.");
      return;
    }
    if (method === "cash" && tenderedNum < totalDue) {
      setError("Tendered amount is less than total due.");
      return;
    }

    setSubmitting(true);
    try {
      // NOTE: this database's `payments` table has no `reference` column
      // (PostgREST PGRST204), so the payload only uses columns that actually
      // exist: order_id, method, amount_due, amount_tendered, change_amount.
      const { error: payErr } = await supabase.from("payments").insert({
        order_id: order.id,
        method,
        amount_due: totalDue,
        amount_tendered: method === "cash" ? tenderedNum : totalDue,
        change_amount: method === "cash" ? change : 0,
      });
      if (payErr) throw payErr;

      // Report success only after Supabase confirms the payment row exists.
      toast.success(`Payment recorded for Order #${order.order_number}.`);

      // Post-payment bookkeeping. The payment is already saved, so failures
      // here must NOT be reported as "payment failed" (that would mislead the
      // user into retrying and inserting a duplicate payment).
      //
      // `processed_by` records the staff/admin who closed the order so Order
      // History's "Closed by" column is populated. It is nullable, so a
      // missing session user simply leaves it null instead of blocking the
      // status update.
      const {
        data: { user: sessionUser },
      } = await supabase.auth.getUser();
      const { error: updateErr } = await supabase
        .from("orders")
        .update({
          status: "served",
          total: totalDue,
          processed_by: sessionUser?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      if (updateErr) {
        toast.error(
          `Payment saved, but the order status could not be updated: ${updateErr.message}`,
        );
      }

      if (order.table_id) {
        const { error: tableErr } = await supabase
          .from("restaurant_tables")
          .update({ status: "available" })
          .eq("id", order.table_id);
        if (tableErr) {
          toast.error(
            `Payment saved, but the table could not be released: ${tableErr.message}`,
          );
        }
      }

      load();
    } catch (err) {
      setError(`Payment failed. ${describeError(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="bo-loading">Loading bill…</div>;
  if (!order) return <div className="bo-loading">Order not found.</div>;

  const isPaid = order.payments && order.payments.length > 0;

  return (
    <div className="checkout-page">
      <Link href="/billing" className="back-link">
        <ArrowLeft size={15} /> Back to billing
      </Link>

      <div className="checkout-grid">
        <div className="checkout-bill">
          <div className="receipt">
            <div className="receipt-header">
              <h2>QITCHEN</h2>
              <p>Contemporary Japanese Dining</p>
            </div>
            <div className="receipt-meta">
              <div>
                <span>Order #</span>
                <strong>{order.order_number}</strong>
              </div>
              <div>
                <span>Date</span>
                <strong>
                  {new Date(order.created_at).toLocaleString("en-US", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </strong>
              </div>
              <div>
                <span>Table</span>
                <strong>
                  {order.restaurant_tables
                    ? `Table ${order.restaurant_tables.table_number}`
                    : "Takeout"}
                </strong>
              </div>
              <div>
                <span>Customer</span>
                <strong>{order.customers?.name || "Walk-in"}</strong>
              </div>
            </div>
            <div className="receipt-items">
              {order.order_items?.map((item) => (
                <div key={item.id} className="receipt-item">
                  <span className="receipt-qty">{item.quantity}×</span>
                  <span className="receipt-name">{item.menu_item_name}</span>
                  <span className="receipt-price">
                    {formatP(Number(item.unit_price))}
                  </span>
                  <span className="receipt-total">
                    {formatP(Number(item.line_total))}
                  </span>
                </div>
              ))}
            </div>
            <div className="receipt-totals">
              <div className="receipt-total-row">
                <span>Subtotal</span>
                <span>{formatP(subtotal)}</span>
              </div>
              <div className="receipt-total-row">
                <span>Service (10%)</span>
                <span>{formatP(serviceCharge)}</span>
              </div>
              <div className="receipt-total-row">
                <span>VAT (12%)</span>
                <span>{formatP(tax)}</span>
              </div>
              {isPaid && Number(order.discount) > 0 && (
                <div className="receipt-total-row">
                  <span>Discount</span>
                  <span>-{formatP(Number(order.discount))}</span>
                </div>
              )}
              <div className="receipt-total-row receipt-grand">
                <span>Total</span>
                <strong>
                  {formatP(isPaid ? Number(order.total) : totalDue)}
                </strong>
              </div>
            </div>
            {isPaid && (
              <div className="receipt-payment">
                <div className="receipt-total-row">
                  <span>Method</span>
                  <strong>{order.payments[0].method}</strong>
                </div>
                <div className="receipt-total-row">
                  <span>Tendered</span>
                  <span>
                    {formatP(Number(order.payments[0].amount_tendered))}
                  </span>
                </div>
                <div className="receipt-total-row">
                  <span>Change</span>
                  <span>
                    {formatP(Number(order.payments[0].change_amount))}
                  </span>
                </div>
              </div>
            )}
            <div className="receipt-footer">
              <p>Thank you for dining with us</p>
              <p>Qitchen Manila · www.qitchen.ph</p>
            </div>
          </div>
          {isPaid && (
            <button
              className="btn-ghost"
              onClick={() => window.print()}
              style={{ marginTop: 16 }}
            >
              <Printer size={15} /> Print Receipt
            </button>
          )}
        </div>

        {!isPaid && (
          <div className="checkout-form">
            <h3>Payment</h3>
            {error && <div className="pos-error">{error}</div>}
            <div className="form-field">
              <label>Payment Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="gcash">GCash</option>
                <option value="bank_transfer">Bank Transfer</option>
              </select>
            </div>
            {method === "cash" && (
              <div className="form-field">
                <label>Amount Tendered (₱)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                />
              </div>
            )}
            {method === "cash" && tenderedNum > 0 && (
              <div className="checkout-change">
                Change: <strong>{formatP(change)}</strong>
              </div>
            )}
            <div className="checkout-due">
              Total Due: <strong>{formatP(totalDue)}</strong>
            </div>
            <button
              className="btn-primary"
              onClick={handlePay}
              disabled={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Processing…
                </>
              ) : (
                "Settle Payment"
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
