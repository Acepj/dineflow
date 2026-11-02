"use client";

import { useCallback, useEffect, useState, use } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Clock,
  Package,
  ShoppingBag,
  Utensils,
} from "lucide-react";
import { RoleGuard } from "@/components/auth/role-guard";
import { supabase } from "@/lib/supabase/client";
import { formatP } from "@/lib/cart";
import type { CheckoutOrder } from "@/types/database.types";

type OrderRow = CheckoutOrder & {
  order_items: {
    id: string;
    menu_item_name: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }[];
};

function formatRequested(pickupDate?: string) {
  if (!pickupDate) return null;
  return new Date(pickupDate).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function OrderConfirmationPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}) {
  const { orderId } = use(params);
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", orderId)
      .maybeSingle();
    if (error || !data) {
      setFailed(true);
    } else {
      setOrder(data as OrderRow);
    }
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    // The loader updates state from the async Supabase response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return (
    <RoleGuard allow={["user"]} redirect="/dashboard">
      <div className="cart-page">
        {loading ? (
          <div className="cart-state">
            <span className="cart-state-icon">
              <ShoppingBag size={30} aria-hidden="true" />
            </span>
            <p className="cart-eyebrow">Loading</p>
            <h2 className="cart-state-title">Fetching your order…</h2>
          </div>
        ) : failed || !order ? (
          <div className="cart-state" role="alert">
            <span className="cart-state-icon cart-state-error">
              <Utensils size={30} aria-hidden="true" />
            </span>
            <p className="cart-eyebrow">Order not found</p>
            <h2 className="cart-state-title">
              We couldn&apos;t find that order.
            </h2>
            <p className="cart-state-text">
              Your order may still be queued. Try again in a moment.
            </p>
            <Link href="/my-orders" className="cart-browse-btn">
              <ArrowLeft size={15} aria-hidden="true" /> Back to my orders
            </Link>
          </div>
        ) : (
<>
              <header className="cart-header">
                <div className="cart-header-copy">
                  <p className="cart-eyebrow">Order confirmed</p>
                  <div className="cart-title-row">
                    <h1 className="cart-title">You&apos;re all set!</h1>
                  </div>
                </div>
                <Link href="/menu" className="cart-back-link">
                  <ArrowLeft size={16} aria-hidden="true" /> Back to menu
                </Link>
              </header>

              <div className="cart-confirm">
                <span className="cart-confirm-icon" aria-hidden="true">
                  <Check size={26} />
                </span>
                <p className="cart-eyebrow">Order #{order.order_number}</p>
                <h2 className="cart-confirm-title">
                  Your order has been received
                </h2>
                <p className="cart-confirm-text">
                  Our kitchen has been notified and will start preparing it
                  soon. We&apos;ll update the status as it progresses.
                </p>
                <div className="cart-confirm-meta">
                  {order.requested_at && (
                    <span className="cart-confirm-meta-item">
                      <Clock size={15} aria-hidden="true" />
                      Pickup {formatRequested(order.requested_at)}
                    </span>
                  )}
                  <span className="cart-confirm-meta-item">
                    {order.type === "dine_in" ? (
                      <>
                        <Utensils size={15} aria-hidden="true" /> Dine-in ·
                        Table service
                      </>
                    ) : (
                      <>
                        <Package size={15} aria-hidden="true" /> Takeout ·
                        Pickup
                      </>
                    )}
                  </span>
                </div>
              </div>

              <section
                className="cart-panel"
                aria-labelledby="confirm-items-heading"
              >
                <div className="cart-panel-head">
                  <h2 id="confirm-items-heading" className="cart-panel-title">
                    Order summary
                  </h2>
                </div>
<div className="cart-review-list">
                  {(order.order_items ?? []).map((item) => (
                    <div key={item.id} className="cart-review-item">
                      <span className="cart-review-qty">{item.quantity}×</span>
                      <span className="cart-review-name">
                        {item.menu_item_name}
                      </span>
                      <span className="cart-review-price">
                        {formatP(Number(item.line_total))}
                      </span>
                    </div>
                  ))}
                </div>
                {order.special_instructions && (
                  <p className="cart-confirm-instructions">
                    <strong>Special instructions:</strong>{" "}
                    {order.special_instructions}
                  </p>
                )}
                <div className="cart-summary-divider" />
                <div className="cart-summary-rows">
                  <div className="cart-summary-row">
                    <span>Subtotal</span>
                    <strong>{formatP(Number(order.subtotal))}</strong>
                  </div>
                  <div className="cart-summary-row">
                    <span>Service charge</span>
                    <strong>{formatP(Number(order.service_charge))}</strong>
                  </div>
                  <div className="cart-summary-row">
                    <span>VAT (12%)</span>
                    <strong>{formatP(Number(order.tax))}</strong>
                  </div>
                  {Number(order.discount) > 0 && (
                    <div className="cart-summary-row cart-discount">
                      <span>{order.promo_code || "Discount"}</span>
                      <strong>−{formatP(Number(order.discount))}</strong>
                    </div>
                  )}
                </div>
                <div className="cart-summary-divider" />
                <div className="cart-summary-total">
                  <span>Total</span>
                  <strong className="cart-total-amount">
                    {formatP(Number(order.total))}
                  </strong>
                </div>
                <div className="cart-confirm-actions">
                  <Link href="/menu" className="btn-ghost">
                    Continue ordering
                  </Link>
                  <Link href="/my-orders" className="cart-checkout-btn">
                    <ShoppingBag size={16} aria-hidden="true" />
                    View my orders
                  </Link>
                </div>
              </section>
            </>
          )}
        </div>
      </RoleGuard>
    );
  }