"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CalendarClock } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { formatShortDate, formatTime } from "@/lib/reservations";

type PendingNotice = {
  id: string;
  code: string;
  guest_name: string;
  reserved_from: string;
  party_size: number;
};

const MAX_NOTICES = 5;

/**
 * Notification bell backed by real data: upcoming reservations still waiting
 * for confirmation. The dot indicates unread items; each entry links to the
 * reservations page pre-filtered with that reservation code.
 */
export function TopbarNotifications() {
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState<PendingNotice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const fetchNotices = useCallback(async () => {
    setLoading(true);
    const { count, data, error } = await supabase
      .from("reservations")
      .select("id, code, guest_name, reserved_from, party_size", {
        count: "exact",
      })
      .eq("status", "pending")
      .gte("reserved_from", new Date().toISOString())
      .order("reserved_from", { ascending: true })
      .limit(MAX_NOTICES);
    if (!error) {
      setNotices((data as PendingNotice[]) ?? []);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void fetchNotices();
    const interval = setInterval(() => void fetchNotices(), 60_000);
    return () => clearInterval(interval);
  }, [fetchNotices]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="bo-notif-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`bo-topbar-icon bo-notification ${total > 0 ? "has-unread" : ""}`}
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void fetchNotices();
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          total > 0
            ? `Notifications: ${total} pending reservation${total === 1 ? "" : "s"} awaiting confirmation`
            : "Notifications: no pending reservations"
        }
        title="Notifications"
      >
        <Bell size={17} />
        {total > 0 ? <i aria-hidden="true" /> : null}
      </button>

      {open ? (
        <div className="bo-notif-menu" role="dialog" aria-label="Notifications">
          <div className="bo-notif-head">
            <span>Pending reservations</span>
            {!loading ? <em>{total}</em> : null}
          </div>
          {loading && notices.length === 0 ? (
            <p className="bo-notif-empty">Checking…</p>
          ) : notices.length === 0 ? (
            <p className="bo-notif-empty">
              Nothing needs confirmation right now.
            </p>
          ) : (
            <ul className="bo-notif-list">
              {notices.map((notice) => (
                <li key={notice.id}>
                  <Link
                    href={`/reservations?search=${encodeURIComponent(notice.code)}`}
                    onClick={() => setOpen(false)}
                  >
                    <CalendarClock size={14} aria-hidden="true" />
                    <span className="bo-notif-body">
                      <strong>{notice.guest_name}</strong>
                      <small>
                        {notice.code} · {formatShortDate(notice.reserved_from)}{" "}
                        {formatTime(notice.reserved_from)} ·{" "}
                        {notice.party_size} guests
                      </small>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {total > MAX_NOTICES ? (
            <Link
              className="bo-notif-footer"
              href="/reservations?search="
              onClick={() => setOpen(false)}
            >
              View all reservations
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
