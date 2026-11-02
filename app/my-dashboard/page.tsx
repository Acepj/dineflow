"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  CalendarCheck,
  CalendarDays,
  Clock3,
  Grid3X3,
  History,
  LogOut,
  ReceiptText,
  ShoppingBag,
  UserRound,
  Utensils,
  Users,
} from "lucide-react";
import { RoleGuard } from "@/components/auth/role-guard";
import { useAuth } from "@/lib/auth/context";
import { clearDemoSession } from "@/lib/auth/demo";
import { supabase } from "@/lib/supabase/client";
import type {
  Order,
  OrderItem,
  ReservationWithTable,
} from "@/types/database.types";

type SectionState = "loading" | "ready" | "error";

type MemberCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
};

type MemberRecentOrder = Order & { order_items: OrderItem[] };

function formatPeso(value: number | string) {
  return (
    "₱" +
    Number(value).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function formatReservationDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function formatReservationTime(value: string) {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatOrderDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatStatus(value: string) {
  return value
    .replace("_", " ")
    .replace(/\b\w/g, (first) => first.toUpperCase());
}

function SkeletonBlock() {
  return (
    <div className="member-skeleton" aria-hidden="true">
      <i />
      <em />
      <em />
    </div>
  );
}

function SectionError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="member-error">
      <p>{message}</p>
      <button type="button" className="btn-ghost" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}


export default function CustomerDashboardPage() {
  const router = useRouter();
  const { session } = useAuth();
  const uid = session?.user?.id;

  const [baseState, setBaseState] = useState<SectionState>("loading");
  const [customer, setCustomer] = useState<MemberCustomer | null>(null);

  const [resState, setResState] = useState<SectionState>("loading");
  const [reservation, setReservation] = useState<ReservationWithTable | null>(
    null,
  );

  const [orderState, setOrderState] = useState<SectionState>("loading");
  const [order, setOrder] = useState<MemberRecentOrder | null>(null);

  const [activityState, setActivityState] = useState<SectionState>("loading");
  const [activity, setActivity] = useState({ orders: 0, reservations: 0 });

  const loadAll = useCallback(async () => {
    if (!uid) return;

    setBaseState("loading");
    setResState("loading");
    setOrderState("loading");
    setActivityState("loading");

    // The dashboard only ever reads the authenticated user's own customer row.
    const customerResult = await supabase
      .from("customers")
      .select("id, name, phone, email")
      .eq("user_id", uid)
      .maybeSingle();

    if (customerResult.error) {
      setBaseState("error");
      setResState("error");
      setOrderState("error");
      setActivityState("error");
      return;
    }

    const member = customerResult.data as MemberCustomer | null;
    setCustomer(member);
    setBaseState("ready");

    // No customer record yet — every section is a calm empty state.
    if (!member) {
      setReservation(null);
      setOrder(null);
      setActivity({ orders: 0, reservations: 0 });
      setResState("ready");
      setOrderState("ready");
      setActivityState("ready");
      return;
    }

    const now = new Date().toISOString();

    // Reservations are matched the same way as the reservation history page
    // (my-orders): by the direct auth link (user_id) OR by the customer's
    // saved phone, so bookings made while signed in still show up even when
    // the booking phone was typed in a different format.
    const reservationOwnership = member.phone
      ? `user_id.eq.${uid},phone.eq.${member.phone}`
      : null;

    const upcomingReservationsQuery = supabase
      .from("reservations")
      .select("*, restaurant_tables(table_number, capacity, location)")
      .in("status", ["pending", "confirmed", "seated"])
      .gte("reserved_to", now)
      .order("reserved_from", { ascending: true });

    const reservationCountQuery = supabase
      .from("reservations")
      .select("id", { count: "exact", head: true });

    const [reservationResult, orderResult, orderCountResult, reservationCountResult] =
      await Promise.allSettled([
        (reservationOwnership
          ? upcomingReservationsQuery.or(reservationOwnership)
          : upcomingReservationsQuery.eq("user_id", uid))
          .limit(1)
          .maybeSingle(),
        supabase
          .from("orders")
          .select("*, order_items(*)")
          .eq("customer_id", member.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", member.id),
        reservationOwnership
          ? reservationCountQuery.or(reservationOwnership)
          : reservationCountQuery.eq("user_id", uid),
      ]);

    if (reservationResult.status === "fulfilled" && !reservationResult.value.error) {
      setReservation(reservationResult.value.data as ReservationWithTable | null);
      setResState("ready");
    } else {
      setResState("error");
    }

    if (orderResult.status === "fulfilled" && !orderResult.value.error) {
      setOrder(orderResult.value.data as MemberRecentOrder | null);
      setOrderState("ready");
    } else {
      setOrderState("error");
    }

    if (
      orderCountResult.status === "fulfilled" &&
      reservationCountResult.status === "fulfilled" &&
      !orderCountResult.value.error &&
      !reservationCountResult.value.error
    ) {
      setActivity({
        orders: orderCountResult.value.count ?? 0,
        reservations: reservationCountResult.value.count ?? 0,
      });
      setActivityState("ready");
    } else {
      setActivityState("error");
    }
  }, [uid]);

  useEffect(() => {
    // The loader updates state from the async Supabase response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAll();
  }, [loadAll]);

  const handleSignOut = async () => {
    clearDemoSession();
    await supabase.auth.signOut();
    router.push("/sign-in/user");
  };


  const userName =
    customer?.name?.trim() ||
    session?.user?.user_metadata?.full_name?.trim() ||
    session?.user?.email?.split("@")[0] ||
    "";
  const accountEmail = customer?.email?.trim() || session?.user?.email || "";
  const accountPhone = customer?.phone?.trim() || "";

  const resTable = reservation?.restaurant_tables?.table_number;
  const itemCount = order?.order_items?.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );

  return (
    <RoleGuard allow={["user"]} redirect="/dashboard">
      <div className="member-page">
        <header className="member-header">
          <div>
            <p className="member-eyebrow">Your Qitchen</p>
            <h1 className="member-title">Member dashboard</h1>
          </div>
          <div className="member-header-actions">
            <Link href="/profile" className="btn-ghost">
              <UserRound size={14} /> Profile
            </Link>
            <button type="button" className="btn-ghost" onClick={handleSignOut}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </header>

        <section className="member-hero">
          <p className="member-eyebrow">Good to see you</p>
          <h2>{userName ? `Welcome back, ${userName}.` : "Welcome back."}</h2>
          <p>Everything for your next memorable meal, in one place.</p>
          <Link href="/menu" className="member-hero-cta">
            Browse the menu <ArrowRight size={14} />
          </Link>
        </section>

        <section className="member-actions-grid" aria-label="Quick actions">
          <Link href="/menu" className="member-action-card">
            <span className="member-card-icon">
              <Utensils size={18} />
            </span>
            <span className="member-action-copy">
              <strong>Explore menu</strong>
              <small>See today&apos;s dishes</small>
            </span>
            <ArrowUpRight size={15} className="member-action-arrow" />
          </Link>
          <Link href="/book-a-table" className="member-action-card">
            <span className="member-card-icon">
              <CalendarDays size={18} />
            </span>
            <span className="member-action-copy">
              <strong>Book a table</strong>
              <small>Reserve your spot</small>
            </span>
            <ArrowUpRight size={15} className="member-action-arrow" />
          </Link>
          <Link href="/my-orders" className="member-action-card">
            <span className="member-card-icon">
              <ReceiptText size={18} />
            </span>
            <span className="member-action-copy">
              <strong>View orders</strong>
              <small>Track and revisit</small>
            </span>
            <ArrowUpRight size={15} className="member-action-arrow" />
          </Link>
        </section>


        <div className="member-columns">
          <section className="member-card" aria-label="Upcoming reservation">
            <div className="member-card-head">
              <span className="member-card-icon">
                <CalendarDays size={18} />
              </span>
              <h3>Upcoming reservation</h3>
            </div>

            {baseState === "error" || resState === "error" ? (
              <SectionError
                message="Unable to load your reservation."
                onRetry={loadAll}
              />
            ) : resState === "loading" || baseState === "loading" ? (
              <SkeletonBlock />
            ) : !reservation ? (
              <div className="member-empty">
                <span className="member-empty-icon">
                  <CalendarCheck size={22} />
                </span>
                <strong>No upcoming reservations</strong>
                <p>You don&apos;t have a reservation scheduled yet.</p>
                <Link href="/book-a-table" className="btn-ghost">
                  Book a table
                </Link>
              </div>
            ) : (
              <>
                <div className="member-primary-block">
                  <p className="member-primary">
                    {formatReservationDate(reservation.reserved_from)}
                  </p>
                  <div className="member-detail-grid">
                    <span className="member-detail-item">
                      <Clock3 size={13} />{" "}
                      {formatReservationTime(reservation.reserved_from)}
                    </span>
                    <span className="member-detail-item">
                      <Users size={13} /> {reservation.party_size}{" "}
                      {reservation.party_size === 1 ? "guest" : "guests"}
                    </span>
                    {resTable ? (
                      <span className="member-detail-item">
                        <Grid3X3 size={13} /> Table {resTable}
                      </span>
                    ) : null}
                  </div>
                  <span
                    className={`status-badge status-${reservation.status}`}
                  >
                    {formatStatus(reservation.status)}
                  </span>
                </div>
                <div className="member-card-footer">
                  <Link href="/my-orders?tab=reservations" className="btn-icon">
                    View reservation <ArrowRight size={12} />
                  </Link>
                </div>
              </>
            )}
          </section>

          <section className="member-card" aria-label="Recent order">
            <div className="member-card-head">
              <span className="member-card-icon">
                <ReceiptText size={18} />
              </span>
              <h3>Recent order</h3>
            </div>

            {baseState === "error" || orderState === "error" ? (
              <SectionError
                message="Unable to load your recent order."
                onRetry={loadAll}
              />
            ) : orderState === "loading" || baseState === "loading" ? (
              <SkeletonBlock />
            ) : !order ? (
              <div className="member-empty">
                <span className="member-empty-icon">
                  <ShoppingBag size={22} />
                </span>
                <strong>No orders yet</strong>
                <p>Your orders will appear here.</p>
                <Link href="/menu" className="btn-ghost">
                  Explore the menu
                </Link>
              </div>
            ) : (
              <>
                <div className="member-primary-block">
                  <p className="member-primary">
                    Order #{order.order_number}
                  </p>
                  <div className="member-detail-grid">
                    <span className="member-detail-item">
                      <ShoppingBag size={13} /> {itemCount ?? 0}{" "}
                      {itemCount === 1 ? "item" : "items"}
                    </span>
                    <span className="member-detail-item">
                      {formatPeso(order.total)}
                    </span>
                    <span className="member-detail-item">
                      {formatOrderDate(order.created_at)}
                    </span>
                  </div>
                  <span className={`status-badge status-${order.status}`}>
                    {formatStatus(order.status)}
                  </span>
                </div>
                <div className="member-card-footer">
                  <Link href="/my-orders" className="btn-icon">
                    View order <ArrowRight size={12} />
                  </Link>
                </div>
              </>
            )}
          </section>
        </div>

        <div className="member-columns">
          <section className="member-card" aria-label="Your activity">
            <div className="member-card-head">
              <span className="member-card-icon">
                <History size={18} />
              </span>
              <h3>Your activity</h3>
            </div>

            {activityState === "error" ? (
              <SectionError
                message="Unable to load your activity."
                onRetry={loadAll}
              />
            ) : activityState === "loading" ? (
              <SkeletonBlock />
            ) : (
              <>
                <dl className="member-stats">
                  <div className="member-stat">
                    <dt>Orders</dt>
                    <dd>{activity.orders}</dd>
                  </div>
                  <div className="member-stat">
                    <dt>Reservations</dt>
                    <dd>{activity.reservations}</dd>
                  </div>
                </dl>
                <div className="member-card-footer member-card-footer-split">
                  <Link href="/my-orders" className="btn-icon">
                    View order history <ArrowRight size={12} />
                  </Link>
                  <Link href="/my-orders?tab=reservations" className="btn-icon">
                    View reservations <ArrowRight size={12} />
                  </Link>
                </div>
              </>
            )}
          </section>

          <section className="member-card" aria-label="Your account">
            <div className="member-card-head">
              <span className="member-card-icon">
                <UserRound size={18} />
              </span>
              <h3>Your account</h3>
            </div>

            {baseState === "loading" ? (
              <SkeletonBlock />
            ) : (
              <>
                <dl className="member-account-list">
                  <div>
                    <dt>Name</dt>
                    <dd>{userName || "—"}</dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>{accountEmail || "—"}</dd>
                  </div>
                  {accountPhone ? (
                    <div>
                      <dt>Phone</dt>
                      <dd>{accountPhone}</dd>
                    </div>
                  ) : null}
                </dl>
                <div className="member-card-footer">
                  <Link href="/profile" className="btn-icon">
                    Manage profile <ArrowRight size={12} />
                  </Link>
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </RoleGuard>
  );
}
