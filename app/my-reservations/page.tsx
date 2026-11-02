"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarDays,
  CalendarX2,
  Check,
  Clock,
  MapPin,
  RefreshCw,
  Search,
  Users,
  Utensils,
  X,
} from "lucide-react";
import { RoleGuard } from "@/components/auth/role-guard";
import { DashboardBackButton } from "@/components/ui/dashboard-back-button";
import { useAuth } from "@/lib/auth/context";
import { supabase } from "@/lib/supabase/client";
import type {
  ReservationWithTable,
  ReservationStatus,
} from "@/types/database.types";

type Tab = "upcoming" | "past" | "cancelled";

const TAB_LABEL: Record<Tab, string> = {
  upcoming: "Upcoming",
  past: "Past",
  cancelled: "Cancelled",
};

const STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: "Pending",
  confirmed: "Reserved",
  arrived: "Arrived",
  seated: "Seated",
  done_eating: "Done eating",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isUpcomingStatus(status: ReservationStatus) {
  return status === "pending" || status === "confirmed" || status === "seated";
}

function isPastStatus(status: ReservationStatus) {
  return status === "completed" || status === "no_show";
}

export default function MyReservationsPage() {
  const { session } = useAuth();
  const uid = session?.user?.id;
  const [reservations, setReservations] = useState<ReservationWithTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [tab, setTab] = useState<Tab>("upcoming");
  const [queryInput, setQueryInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<string>("soonest");
  const [detail, setDetail] = useState<ReservationWithTable | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ReservationWithTable | null>(
    null,
  );
  const [cancelling, setCancelling] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    if (!uid) {
      setReservations([]);
      setLoading(false);
      return;
    }

    const { data: customer } = await supabase
      .from("customers")
      .select("phone")
      .eq("user_id", uid)
      .maybeSingle();

    if (!customer?.phone) {
      setReservations([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("reservations")
      .select("*, restaurant_tables(table_number, capacity, location)")
      .eq("phone", customer.phone)
      .order("reserved_from", { ascending: false });

    if (error) {
      setLoadError(true);
      setReservations([]);
    } else {
      setReservations((data as ReservationWithTable[]) || []);
    }
    setLoading(false);
  }, [uid]);

  useEffect(() => {
    // Defer the initial fetch so state updates don't fire synchronously
    // inside the effect body.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Debounce the search input (300ms).
  useEffect(() => {
    const timer = setTimeout(
      () => setSearch(queryInput.trim().toLowerCase()),
      300,
    );
    return () => clearTimeout(timer);
  }, [queryInput]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => (current === message ? null : current)), 2800);
  };

  const upcomingList = useMemo(
    () => reservations.filter((r) => isUpcomingStatus(r.status)),
    [reservations],
  );
  const pastList = useMemo(
    () => reservations.filter((r) => isPastStatus(r.status)),
    [reservations],
  );
  const cancelledList = useMemo(
    () => reservations.filter((r) => r.status === "cancelled"),
    [reservations],
  );

  const totalVisits = pastList.length;
  const nextReservation = useMemo(() => {
    const future = upcomingList
      .filter((r) => new Date(r.reserved_from) >= new Date())
      .sort(
        (a, b) => new Date(a.reserved_from).getTime() - new Date(b.reserved_from).getTime(),
      );
    return future[0] ?? null;
  }, [upcomingList]);

  const activeList = useMemo(() => {
    const base =
      tab === "upcoming"
        ? upcomingList
        : tab === "past"
          ? pastList
          : cancelledList;
    let list = base;
    if (search) {
      list = list.filter((r) =>
        `${r.code} ${r.guest_name} ${r.phone} ${r.special_request || ""}`
          .toLowerCase()
          .includes(search),
      );
    }
    const sorted = [...list].sort((a, b) => {
      const at = new Date(a.reserved_from).getTime();
      const bt = new Date(b.reserved_from).getTime();
      switch (sort) {
        case "latest":
          return bt - at;
        case "largest":
          return b.party_size - a.party_size;
        case "smallest":
          return a.party_size - b.party_size;
        default:
          return at - bt;
      }
    });
    return sorted;
  }, [tab, upcomingList, pastList, cancelledList, search, sort]);

  const hasAny = reservations.length > 0;

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setCancelling(true);
    const { error } = await supabase
      .from("reservations")
      .update({ status: "cancelled" })
      .eq("id", cancelTarget.id);
    setCancelling(false);
    if (error) {
      showToast("Unable to cancel the reservation. Please try again.");
      setCancelTarget(null);
      return;
    }
    showToast("Reservation cancelled.");
    setCancelTarget(null);
    setDetail(null);
    load();
  };

  return (
    <RoleGuard allow={["user"]} redirect="/dashboard">
      <div className="rs-page">
        <header className="rs-head">
          <DashboardBackButton />
          <div className="rs-head-copy">
            <p className="rs-eyebrow">My reservations</p>
            <h1 className="rs-title">Upcoming plans</h1>
            <p className="rs-lede">
              Your upcoming dining experiences, all in one place.
            </p>
          </div>
        </header>

        {loadError ? (
          <div className="menu-state">
            <CalendarX2 size={28} aria-hidden="true" />
            <p className="menu-state-title">
              Unable to load your reservations.
            </p>
            <p className="menu-state-text">
              There was a problem loading your reservations. Please try again.
            </p>
            <button className="btn-primary" onClick={load}>
              <RefreshCw size={15} /> Try again
            </button>
          </div>
        ) : loading ? (
          <div className="rs-skel-list" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rs-skel-card">
                <div className="menu-skeleton menu-skeleton-title" />
                <div className="menu-skeleton menu-skeleton-line" />
                <div className="menu-skeleton menu-skeleton-line short" />
                <div className="menu-skeleton menu-skeleton-row" />
              </div>
            ))}
          </div>
        ) : !hasAny ? (
          <div className="rs-empty-wrap">
            <section className="rs-empty" aria-labelledby="rs-empty-title">
              <span className="rs-empty-icon" aria-hidden="true">
                <CalendarDays size={26} strokeWidth={1.4} />
              </span>
              <h2 className="rs-empty-title" id="rs-empty-title">
                No reservations yet
              </h2>
              <p className="rs-empty-text">
                Plan your next dining experience with us. Reserve your table now
                for a memorable meal.
              </p>
              <div className="rs-empty-actions">
                <Link
                  href="/book-a-table"
                  className="btn-primary rs-empty-action"
                >
                  Book a Table <ArrowRight size={15} aria-hidden="true" />
                </Link>
                <span className="rs-or">or</span>
                <Link href="/menu" className="btn-outline rs-empty-action">
                  Browse the Menu
                </Link>
              </div>
            </section>

            <div className="rs-tip">
              <span className="rs-tip-label">Did you know?</span>
              Reservations ensure you get your preferred table and time.
            </div>
          </div>
        ) : (
          <>
            <div className="rs-stats">
              <div className="rs-stat">
                <span className="rs-stat-label">Upcoming</span>
                <span className="rs-stat-value">{upcomingList.length}</span>
                <span className="rs-stat-sub">
                  {upcomingList.length === 1 ? "reservation" : "reservations"}
                </span>
              </div>
              <div className="rs-stat">
                <span className="rs-stat-label">Total visits</span>
                <span className="rs-stat-value">{totalVisits}</span>
                <span className="rs-stat-sub">all time</span>
              </div>
              <div className="rs-stat">
                <span className="rs-stat-label">Next visit</span>
                {nextReservation ? (
                  <>
                    <span className="rs-stat-date">
                      {fmtDate(nextReservation.reserved_from)}
                    </span>
                    <span className="rs-stat-sub">
                      {fmtTime(nextReservation.reserved_from)} ·{" "}
                      {nextReservation.party_size}{" "}
                      {nextReservation.party_size === 1 ? "guest" : "guests"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="rs-stat-date">—</span>
                    <span className="rs-stat-sub">no upcoming</span>
                  </>
                )}
              </div>
            </div>
            <div className="rs-tabs" role="tablist" aria-label="Reservation sections">
              {(
                [
                  ["upcoming", upcomingList.length],
                  ["past", pastList.length],
                  ["cancelled", cancelledList.length],
                ] as [Tab, number][]
              ).map(([key, count]) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  className={tab === key ? "rs-tab active" : "rs-tab"}
                  onClick={() => setTab(key)}
                >
                  {TAB_LABEL[key]}
                  <span className="rs-tab-count">{count}</span>
                </button>
              ))}
            </div>

            <div className="rs-controls">
              <div className="menu-search rs-search">
                <Search size={16} aria-hidden="true" />
                <input
                  type="text"
                  value={queryInput}
                  onChange={(e) => setQueryInput(e.target.value)}
                  placeholder="Search by code, name, or request…"
                  aria-label="Search reservations"
                />
                {queryInput && (
                  <button
                    className="menu-search-clear"
                    onClick={() => setQueryInput("")}
                    aria-label="Clear search"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <select
                className="oh-select"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Sort reservations"
              >
                <option value="soonest">Soonest first</option>
                <option value="latest">Latest first</option>
                <option value="largest">Largest party</option>
                <option value="smallest">Smallest party</option>
              </select>
            </div>

            {activeList.length === 0 ? (
              <div className="menu-state rs-tab-empty">
                {search ? (
                  <>
                    <Search size={28} aria-hidden="true" />
                    <p className="menu-state-title">
                      No reservations match your search
                    </p>
                    <button
                      className="btn-outline"
                      onClick={() => setQueryInput("")}
                    >
                      Clear search
                    </button>
                  </>
                ) : (
                  <>
                    <CalendarX2 size={28} aria-hidden="true" />
                    <p className="menu-state-title">
                      No {TAB_LABEL[tab].toLowerCase()} reservations
                    </p>
                    <p className="menu-state-text">
                      {tab === "upcoming"
                        ? "You don't have any upcoming reservations."
                        : tab === "past"
                          ? "Your completed visits will appear here."
                          : "You have no cancelled reservations."}
                    </p>
                    {tab === "upcoming" && (
                      <Link href="/book-a-table" className="btn-primary">
                        Book a Table <ArrowRight size={15} />
                      </Link>
                    )}
                  </>
                )}
              </div>
            ) : (

              <div className="rs-list">
                {activeList.map((reservation) => (
                  <article key={reservation.id} className="rs-card">
                    <div className="rs-card-top">
                      <span className="rs-code">
                        Reservation · {reservation.code}
                      </span>
                      <span
                        className={`status-badge status-${reservation.status}`}
                      >
                        {STATUS_LABEL[reservation.status]}
                      </span>
                    </div>

                    <div className="rs-card-date">
                      <CalendarDays size={16} aria-hidden="true" />
                      <span>{fmtDate(reservation.reserved_from)}</span>
                      <Clock size={15} aria-hidden="true" />
                      <span className="rs-time">
                        {fmtTime(reservation.reserved_from)}
                      </span>
                    </div>

                    <div className="rs-details">
                      <span>
                        <Users size={14} aria-hidden="true" />{" "}
                        {reservation.party_size}{" "}
                        {reservation.party_size === 1 ? "guest" : "guests"}
                      </span>
                      <span>
                        <MapPin size={14} aria-hidden="true" />{" "}
                        {reservation.restaurant_tables
                          ? `Table ${reservation.restaurant_tables.table_number} · ${reservation.restaurant_tables.location}`
                          : "Table to be assigned"}
                      </span>
                    </div>

                    {reservation.special_request && (
                      <p className="rs-request">“{reservation.special_request}”</p>
                    )}

                    <div className="rs-actions">
                      <button
                        className="btn-outline"
                        onClick={() => setDetail(reservation)}
                      >
                        View details
                      </button>
                      {isUpcomingStatus(reservation.status) ? (
                        <button
                          className="btn-outline danger"
                          onClick={() => setCancelTarget(reservation)}
                        >
                          Cancel
                        </button>
                      ) : (
                        <Link href="/book-a-table" className="btn-primary">
                          Book again
                        </Link>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}

        {toast && (
          <div className="menu-toast" role="status" aria-live="polite">
            <Check size={14} aria-hidden="true" /> {toast}
          </div>
        )}

        
        {detail && (
          <div
            className="oh-modal-overlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setDetail(null);
            }}
          >
            <div
              className="oh-modal"
              role="dialog"
              aria-modal="true"
              aria-label={`Reservation ${detail.code}`}
            >
              <div className="oh-modal-head">
                <div>
                  <p className="eyebrow">Reservation details</p>
                  <h3>Reservation · {detail.code}</h3>
                  <p className="oh-modal-sub">
                    {fmtDate(detail.reserved_from)} at {fmtTime(detail.reserved_from)}
                  </p>
                </div>
                <button
                  className="oh-modal-close"
                  onClick={() => setDetail(null)}
                  aria-label="Close reservation details"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="rs-modal-status">
                <span className={`status-badge status-${detail.status}`}>
                  {STATUS_LABEL[detail.status]}
                </span>
              </div>

              <p className="oh-sec-label">Party &amp; table</p>
              <div className="oh-modal-section">
                <div className="rs-modal-line">
                  <Users size={14} aria-hidden="true" /> {detail.party_size}{" "}
                  {detail.party_size === 1 ? "guest" : "guests"}
                </div>
                <div className="rs-modal-line">
                  <MapPin size={14} aria-hidden="true" />{" "}
                  {detail.restaurant_tables
                    ? `Table ${detail.restaurant_tables.table_number} · ${detail.restaurant_tables.location}`
                    : "Table to be assigned"}
                </div>
              </div>

              <p className="oh-sec-label">Contact</p>
              <div className="oh-modal-section">
                <div className="rs-modal-line">
                  <Utensils size={14} aria-hidden="true" /> {detail.guest_name}
                </div>
                <div className="rs-modal-line">
                  <span className="rs-modal-phone">{detail.phone}</span>
                </div>
                {detail.email && (
                  <div className="rs-modal-line">{detail.email}</div>
                )}
              </div>

              {detail.special_request && (
                <>
                  <p className="oh-sec-label">Special requests</p>
                  <div className="oh-modal-section">
                    <p className="rs-request">“{detail.special_request}”</p>
                  </div>
                </>
              )}
              <div className="oh-modal-actions">
                {isUpcomingStatus(detail.status) && (
                  <button
                    className="btn-outline danger"
                    onClick={() => setCancelTarget(detail)}
                  >
                    Cancel reservation
                  </button>
                )}
                <button className="btn-primary" onClick={() => setDetail(null)}>
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {cancelTarget && (
          <div
            className="oh-modal-overlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setCancelTarget(null);
            }}
          >
            <div
              className="oh-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Cancel reservation"
            >
              <div className="oh-modal-head">
                <div>
                  <p className="eyebrow">Cancel reservation?</p>
                  <h3>{fmtDate(cancelTarget.reserved_from)}</h3>
                  <p className="oh-modal-sub">
                    {fmtTime(cancelTarget.reserved_from)} ·{" "}
                    {cancelTarget.party_size}{" "}
                    {cancelTarget.party_size === 1 ? "guest" : "guests"}
                  </p>
                </div>
                <button
                  className="oh-modal-close"
                  onClick={() => setCancelTarget(null)}
                  disabled={cancelling}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
              <p className="oh-sec-label">Are you sure?</p>
              <div className="oh-modal-section">
                You can cancel your reservation for{" "}
                {fmtDate(cancelTarget.reserved_from)} at{" "}
                {fmtTime(cancelTarget.reserved_from)}. This cannot be undone.
              </div>
              <div className="oh-modal-actions">
                <button
                  className="btn-outline"
                  onClick={() => setCancelTarget(null)}
                  disabled={cancelling}
                >
                  No, keep it
                </button>
                <button
                  className="btn-outline danger"
                  onClick={confirmCancel}
                  disabled={cancelling}
                >
                  {cancelling ? "Cancelling…" : "Yes, cancel"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </RoleGuard>
  );
}

