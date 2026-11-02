"use client";

import Link from "next/link";
import { useState, useMemo, useCallback, useEffect } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Banknote,
  Check,
  Clock,
  CreditCard,
  Users,
  Calendar,
  Phone,
  User,
  Mail,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/context";
import { getRoleLandingPath } from "@/lib/auth/role";
import { formatP } from "@/lib/cart";
import {
  TABLE_DAY_STATUS_LABEL,
  resolveTablesForDay,
  tableUnavailableNote,
} from "@/lib/table-availability";
import type {
  ResolvedTableDayStatus,
  ReservationPaymentMethod,
  RestaurantTable,
  ReservationWithTable,
  TableDailyStatusValue,
} from "@/types/database.types";

type FormData = {
  date: string;
  time: string;
  partySize: number;
  tableId: string;
  guestName: string;
  phone: string;
  email: string;
  specialRequest: string;
  /** Reservations are paid online (GCash / card) at booking — cash is not offered. */
  paymentMethod: ReservationPaymentMethod;
};

/** Offered start times, stored in 24-hour form and labeled for display. */
const TIME_SLOTS: { value: string; label: string }[] = [
  { value: "17:30", label: "5:30 PM" },
  { value: "18:00", label: "6:00 PM" },
  { value: "18:30", label: "6:30 PM" },
  { value: "19:00", label: "7:00 PM" },
  { value: "19:30", label: "7:30 PM" },
  { value: "20:00", label: "8:00 PM" },
  { value: "20:30", label: "8:30 PM" },
  { value: "21:00", label: "9:00 PM" },
];

const PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8];

/** Reservation length in hours. */
const RESERVATION_HOURS = 2;

/** Reservation fee (pesos) charged to hold a booked table. */
const RESERVATION_FEE = 500;

/**
 * Build a real Date for `date` (yyyy-mm-dd) at `time` (HH:mm, local time)
 * so it can be serialized as a valid ISO timestamp.
 */
function toReservationDate(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Start time + RESERVATION_HOURS as the reservation end. */
function getEndDate(reservedFrom: Date): Date {
  return new Date(
    reservedFrom.getTime() + RESERVATION_HOURS * 60 * 60 * 1000,
  );
}

/**
 * A table's status for the day the customer picked — resolved by the shared
 * `resolveTablesForDay` helper from staff day-overrides plus any reservations
 * overlapping the chosen date + time window (not from the table's live floor
 * status, which only describes *right now*).
 *
 * `available`      free for the chosen window and ready to pick.
 * `occupied`       a guest will be seated there then (overlapping `seated` stay).
 * `reserved`       held by another booking for that window (pending/confirmed/arrived).
 * `served`         staff marked the table as served for that day.
 * `out_of_service` the table itself is unavailable regardless of the day.
 */
type DayStatus = ResolvedTableDayStatus;

/** A table shown in the picker, annotated with its status for the chosen day. */
type TableOption = {
  table: RestaurantTable;
  /** The table's availability for the day/window the customer chose. */
  dayStatus: DayStatus;
  /** True when the table is free for the chosen day and time and selectable. */
  bookable: boolean;
  /** Short reason shown on a table that cannot be booked (null when bookable). */
  note: string | null;
};

export default function BookingWizard() {
  const { session } = useAuth();
  const dashboardHref = getRoleLandingPath(
    session?.user?.user_metadata?.role ?? session?.user?.app_metadata?.role,
  );

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<FormData>({
    date: "",
    time: "",
    partySize: 2,
    tableId: "",
    guestName: "",
    phone: "",
    email: "",
    specialRequest: "",
    // Reservations are paid online only — step 3 offers no cash option, so
    // the choice is fixed at booking time.
    paymentMethod: "online",
  });
  const [tableOptions, setTableOptions] = useState<TableOption[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ReservationWithTable | null>(
    null,
  );

  // Booking window: today through 90 days out, captured per mount.
  const today = new Date().toISOString().split("T")[0];
  // eslint-disable-next-line react-hooks/purity
  const maxDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];

  /** Human label of the chosen time slot, for the day-availability hint. */
  const slotLabel = useMemo(
    () => TIME_SLOTS.find((slot) => slot.value === form.time)?.label ?? "",
    [form.time],
  );

  /**
   * Fetch the full floor and resolve every table's status for the chosen
   * date + time window — other customers' bookings first, then the staff
   * day-overrides, then free. Throws on failure; callers decide how to
   * surface the problem.
   */
  const loadTableOptions = useCallback(async (): Promise<TableOption[]> => {
    const reservedFrom = toReservationDate(form.date, form.time);
    if (!reservedFrom) {
      throw new Error("Please pick a valid date and time.");
    }
    const reservedTo = getEndDate(reservedFrom);

    // Fetch EVERY table (not just free ones) so the customer can see the
    // full floor with each table's status for the chosen day before picking.
    const { data: tables, error: tablesErr } = await supabase
      .from("restaurant_tables")
      .select("*")
      .order("table_number");

    if (tablesErr) throw tablesErr;

    // Every booking touching the chosen day: the picker's statuses are
    // derived from these, not from the tables' live floor statuses (which
    // only describe right now and miss future holds on this day). The slim
    // public view (migration 20261018000000_reservation_holds_public_view)
    // exposes just the hold columns — no guest PII — and, unlike the base
    // table, is readable by every signed-in customer, so one guest's booking
    // always shows up as taken for the next guest picking a table. If the
    // view is not migrated yet, fall back to the base table (same pattern as
    // the cart's customer lookup), which still works for staff/admin.
    const holdsQuery = (source: "reservation_holds" | "reservations") =>
      supabase
        .from(source)
        .select("table_id, status, reserved_from, reserved_to")
        .in("status", [
          "pending",
          "confirmed",
          "arrived",
          "seated",
        ])
        .not("table_id", "is", null)
        // Overlap = this window starts before their end AND ends after
        // their start, so both conditions must hold.
        .lt("reserved_from", reservedTo.toISOString())
        .gt("reserved_to", reservedFrom.toISOString());

    let holdsResult = await holdsQuery("reservation_holds");
    if (holdsResult.error) {
      holdsResult = await holdsQuery("reservations");
    }
    if (holdsResult.error) throw holdsResult.error;
    const reservations = holdsResult.data || [];

    // Staff/admin day-overrides for the chosen date (migration
    // 20261015000000_table_daily_status). These let staff plan the day —
    // e.g. mark a table occupied for a private event — so the customer sees
    // that day's real availability rather than the live floor status. Public
    // read is allowed by RLS. If the table is not yet migrated, treat it as
    // "no overrides" so the picker still works from reservations alone.
    const { data: dailyRows } = await supabase
      .from("table_daily_status")
      .select("table_id, status")
      .eq("day", form.date);

    const overrides = new Map<string, TableDailyStatusValue>();
    for (const row of (dailyRows || []) as {
      table_id: string;
      status: TableDailyStatusValue;
    }[]) {
      overrides.set(row.table_id, row.status);
    }

    // One shared resolver decides each table's status for the chosen day:
    // a live seated guest wins, then a staff override, then a booking that
    // has not arrived yet, then free.
    return resolveTablesForDay({
      tables: (tables as RestaurantTable[]) || [],
      reservations: reservations as {
        table_id: string | null;
        status: string;
        reserved_from: string;
        reserved_to: string;
      }[],
      overrides,
      windowFrom: reservedFrom,
      windowTo: reservedTo,
    }).map((resolved) => {
      // Clickable purely on availability for the chosen day and time: any
      // table the resolver marks `available` can be picked — capacity never
      // blocks it. Tables with a booking or a staff day-status stay disabled
      // with an explanatory note.
      const bookable = resolved.dayStatus === "available";

      return {
        table: resolved.table,
        dayStatus: resolved.dayStatus,
        bookable,
        note: bookable ? null : tableUnavailableNote(resolved, form.partySize),
      };
    });
  }, [form.date, form.time, form.partySize]);

  const fetchTables = useCallback(async () => {
    if (!form.date || !form.time) return;
    if (!toReservationDate(form.date, form.time)) {
      setError("Please pick a valid date and time.");
      return;
    }
    setLoadingTables(true);
    setError(null);

    try {
      const options = await loadTableOptions();
      setTableOptions(options);
      // Drop a selection that is no longer bookable for this slot (someone
      // booked it or staff re-statused the day), so a stale pick can never
      // be carried into "Your details".
      setForm((prev) =>
        prev.tableId &&
        options.some(
          (option) => option.table.id === prev.tableId && option.bookable,
        )
          ? prev
          : { ...prev, tableId: "" },
      );
    } catch {
      setError("Could not check table availability. Please try again.");
    } finally {
      setLoadingTables(false);
    }
  }, [form.date, form.time, loadTableOptions]);

  useEffect(() => {
    // Fetch availability whenever the customer lands on the table step. The
    // loader updates state from the async Supabase response (same pattern as
    // the dashboard list pages), so the rule's "no sync setState in effect"
    // warning is expected here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (step === 2) fetchTables();
  }, [step, fetchTables]);

  const canProceed = useMemo(() => {
    if (step === 1) return form.date && form.time && form.partySize > 0;
    if (step === 2) {
      // Continue only while the picked table is still free for this exact
      // slot; a selection that went stale renders disabled and blocks here.
      const picked = tableOptions.find(
        (option) => option.table.id === form.tableId,
      );
      return Boolean(picked?.bookable);
    }
    if (step === 3)
      return form.guestName.trim().length >= 2 && form.phone.trim().length >= 7;
    return true;
  }, [step, form, tableOptions]);

  const update = (field: keyof FormData, value: string | number) => {
    setForm((prev) => ({
      ...prev,
      [field]: value,
      // A table picked for the old slot may not be free for the new one,
      // so the selection never outlives its date/time/party size.
      ...(field === "date" || field === "time" || field === "partySize"
        ? { tableId: "" }
        : {}),
    }));
    setError(null);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    const reservedFrom = toReservationDate(form.date, form.time);
    if (!reservedFrom) {
      setError("Please pick a valid date and time.");
      setSubmitting(false);
      return;
    }
    const reservedTo = getEndDate(reservedFrom);

    try {
      // Re-check the floor immediately before inserting: the options on
      // screen can be minutes old, and a staff day-override (occupied,
      // reserved, out of service…) is not enforced by the database's
      // overlap constraint — only a fresh check stops a stale pick from
      // landing on a table that is no longer free.
      const currentOptions = await loadTableOptions();
      setTableOptions(currentOptions);
      const stillBookable = currentOptions.some(
        (option) => option.table.id === form.tableId && option.bookable,
      );
      if (!stillBookable) {
        setForm((prev) => ({ ...prev, tableId: "" }));
        setStep(2);
        setError(
          "That table is no longer free for this time. Please pick another table.",
        );
        return;
      }

      // Online settles immediately: store a booking-scoped reference staff can
      // verify (booking code + timestamp). Cash settles at the restaurant.
      const payOnline = form.paymentMethod === "online";
      const { data, error: insertErr } = await supabase
        .from("reservations")
        .insert({
          table_id: form.tableId,
          guest_name: form.guestName.trim(),
          phone: form.phone.trim(),
          email: form.email.trim() || null,
          party_size: form.partySize,
          reserved_from: reservedFrom.toISOString(),
          reserved_to: reservedTo.toISOString(),
          special_request: form.specialRequest.trim() || null,
          status: "pending",
          // Link the booking to the signed-in customer (migration
          // 20260917000000) so it always appears in their Reservations tab.
          user_id: session?.user?.id ?? null,
          // Payment choice from "Your details" (migration
          // 20261014000000_reservation_payment).
          payment_method: form.paymentMethod,
          payment_status: payOnline ? "paid" : "unpaid",
          payment_reference: payOnline
            ? `ONLINE-${Date.now().toString(36).toUpperCase()}`
            : null,
        })
        .select("*, restaurant_tables(table_number, capacity, location)")
        .single();

      if (insertErr) {
        if (
          insertErr.code === "23RR10" ||
          insertErr.message?.includes("overlapping")
        ) {
          throw new Error(
            "That table is already booked for this time. Please pick another table or time.",
          );
        }
        if (insertErr.message?.includes("idx_unique_phone_window")) {
          throw new Error(
            "You already have a booking around this time. Please call us to modify it.",
          );
        }
        throw new Error(
          "We could not complete your booking. Please check your details and try again.",
        );
      }

      setConfirmation(data as ReservationWithTable);
      setStep(4);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmation && step === 4) {
    return (
      <div className="booking-confirmation">
        <div className="confirm-icon">
          <Check size={32} strokeWidth={1.5} />
        </div>
        <p className="eyebrow">Reservation requested</p>
        <h2>You&apos;re booked in.</h2>
        <div className="confirm-code">
          <span>Confirmation code</span>
          <strong>{confirmation.code}</strong>
        </div>
        <div className="confirm-details">
          <div>
            <Calendar size={15} />
            <span>
              {new Date(confirmation.reserved_from).toLocaleDateString(
                "en-US",
                { weekday: "long", month: "long", day: "numeric" },
              )}
            </span>
          </div>
          <div>
            <Clock size={15} />
            <span>
              {form.time} · {form.partySize}{" "}
              {form.partySize === 1 ? "guest" : "guests"}
            </span>
          </div>
          <div>
            <User size={15} />
            <span>{confirmation.guest_name}</span>
          </div>
          {confirmation.restaurant_tables && (
            <div>
              <Users size={15} />
              <span>
                Table {confirmation.restaurant_tables.table_number} ·{" "}
                {confirmation.restaurant_tables.location}
              </span>
            </div>
          )}
          <div>
            {confirmation.payment_method === "online" ? (
              <CreditCard size={15} />
            ) : (
              <Banknote size={15} />
            )}
            <span>
              {confirmation.payment_method === "online"
                ? "Paid online"
                : "Pay with cash on arrival"}
              {confirmation.payment_method === "online" &&
              confirmation.payment_reference
                ? ` · Ref ${confirmation.payment_reference}`
                : ""}
            </span>
          </div>
        </div>
        <div className="booking-receipt">
          <p className="booking-receipt-kicker">Reservation receipt</p>
          <div className="booking-receipt-rows">
            <div className="booking-receipt-row">
              <span>Reservation fee — table hold</span>
              <span>{formatP(RESERVATION_FEE)}</span>
            </div>
            <div className="booking-receipt-row">
              <span>Payment method</span>
              <span>Online (GCash / card)</span>
            </div>
            <div className="booking-receipt-row">
              <span>Status</span>
              <span className="booking-receipt-paid">Paid</span>
            </div>
            {confirmation.payment_reference && (
              <div className="booking-receipt-row">
                <span>Reference</span>
                <span>Ref {confirmation.payment_reference}</span>
              </div>
            )}
            <div className="booking-receipt-total">
              <span>Total</span>
              <span>{formatP(RESERVATION_FEE)}</span>
            </div>
          </div>
        </div>
        <p className="confirm-note">
          We&apos;ll hold your table for 15 minutes past the reservation time. A
          confirmation will be sent to{" "}
          {confirmation.email || `your phone ${confirmation.phone}`}.
        </p>
        <Link href={dashboardHref} className="cream-button">
          Back to dashboard <ArrowRight size={15} />
        </Link>
      </div>
    );
  }

  return (
    <div className="booking-wizard">
      <div className="wizard-progress">
        {[1, 2, 3].map((s) => (
          <div key={s} className={`wizard-dot ${step >= s ? "active" : ""}`}>
            <span>{step > s ? <Check size={12} /> : s}</span>
          </div>
        ))}
      </div>

      {error && (
        <div className="wizard-error">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {step === 1 && (
        <div className="wizard-step">
          <p className="eyebrow">Step 1</p>
          <h3>When are you joining us?</h3>
          <div className="form-field">
            <label htmlFor="date">
              <Calendar size={14} /> Date
            </label>
            <input
              id="date"
              type="date"
              min={today}
              max={maxDate}
              value={form.date}
              onChange={(e) => update("date", e.target.value)}
            />
          </div>
          <div className="form-field">
            <label>
              <Clock size={14} /> Time
            </label>
            <div className="time-grid">
              {TIME_SLOTS.map((slot) => (
                <button
                  key={slot.value}
                  type="button"
                  className={`time-chip ${form.time === slot.value ? "selected" : ""}`}
                  onClick={() => update("time", slot.value)}
                >
                  {slot.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-field">
            <label>
              <Users size={14} /> Party size
            </label>
            <div className="party-grid">
              {PARTY_SIZES.map((size) => (
                <button
                  key={size}
                  type="button"
                  className={`party-chip ${form.partySize === size ? "selected" : ""}`}
                  onClick={() => update("partySize", size)}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="wizard-step">
          <p className="eyebrow">Step 2</p>
          <h3>Pick your table</h3>
          {loadingTables ? (
            <div className="wizard-loading">
              <Loader2 size={20} className="animate-spin" />
              <span>Checking availability…</span>
            </div>
          ) : tableOptions.length === 0 ? (
            <p className="wizard-empty">
              No tables found. Please go back and try a different slot.
            </p>
          ) : (
            <>
              <p className="wizard-day-hint">
                Availability for{" "}
                {form.date
                  ? new Date(`${form.date}T00:00:00`).toLocaleDateString(
                      "en-US",
                      {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      },
                    )
                  : "the chosen day"}
                {slotLabel ? ` · ${slotLabel}` : ""}. Only tables free that day
                can be picked.
              </p>
              <div className="table-grid">
                {tableOptions.map(({ table, dayStatus, bookable, note }) => (
                  <button
                    key={table.id}
                    type="button"
                    className={`table-card ${
                      form.tableId === table.id ? "selected" : ""
                    }${bookable ? "" : " disabled"}`}
                    onClick={() => bookable && update("tableId", table.id)}
                    disabled={!bookable}
                    aria-label={`Table ${table.table_number}, ${TABLE_DAY_STATUS_LABEL[dayStatus]} for the chosen day${
                      note ? `, ${note}` : ""
                    }`}
                  >
                    <div className="table-card-top">
                      <span className="table-num">
                        Table {table.table_number}
                      </span>
                      <span className={`table-loc ${table.location}`}>
                        {table.location}
                      </span>
                    </div>
                    <div className="table-card-bottom">
                      <span>
                        <Users size={13} />
                      </span>
                    </div>
                    <span
                      className={`status-badge table-status status-${dayStatus}`}
                    >
                      {TABLE_DAY_STATUS_LABEL[dayStatus]}
                    </span>
                    {note && <span className="table-note">{note}</span>}
                  </button>
                ))}
              </div>
              {tableOptions.every((option) => !option.bookable) && (
                <p className="wizard-empty">
                  No tables can be booked for this time and party size. Try a
                  different slot.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="wizard-step">
          <p className="eyebrow">Step 3</p>
          <h3>Your details</h3>
          <div className="form-field">
            <label htmlFor="guestName">
              <User size={14} /> Full name
            </label>
            <input
              id="guestName"
              type="text"
              placeholder="Your name"
              value={form.guestName}
              onChange={(e) => update("guestName", e.target.value)}
              maxLength={80}
            />
          </div>
          <div className="form-field">
            <label htmlFor="phone">
              <Phone size={14} /> Phone
            </label>
            <input
              id="phone"
              type="tel"
              placeholder="+63 9XX XXX XXXX"
              value={form.phone}
              onChange={(e) => update("phone", e.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="email">
              <Mail size={14} /> Email (optional)
            </label>
            <input
              id="email"
              type="email"
              placeholder="you@email.com"
              value={form.email}
              onChange={(e) => update("email", e.target.value)}
            />
          </div>
          <div className="form-field">
            <label htmlFor="specialRequest">Special requests (optional)</label>
            <textarea
              id="specialRequest"
              placeholder="Allergies, celebrations, seating preferences…"
              value={form.specialRequest}
              onChange={(e) => update("specialRequest", e.target.value)}
              maxLength={500}
              rows={3}
            />
          </div>
          <div className="form-field">
            <label id="paymentMethodLabel">
              <CreditCard size={14} /> How would you like to pay?
            </label>
            {/* Reservations are paid online only — the cash option is not
                offered, so this card is fixed and always selected. */}
            <div
              className="payment-option selected"
              role="group"
              aria-labelledby="paymentMethodLabel"
            >
              <span className="payment-option-icon">
                <CreditCard size={20} strokeWidth={1.5} />
              </span>
              <span className="payment-option-title">Online</span>
              <span className="payment-option-sub">
                Pay now with GCash or card
              </span>
            </div>
            <p className="payment-online-note">
              Reservations are paid online — your booking is settled right
              away, and a payment reference is saved for the staff to verify.
            </p>
          </div>
        </div>
      )}

      <div className="wizard-actions">
        {step > 1 && step < 4 && (
          <button
            type="button"
            className="outline-button"
            onClick={() => setStep((s) => s - 1)}
            disabled={submitting}
          >
            <ArrowLeft size={15} /> Back
          </button>
        )}
        {step < 3 && (
          <button
            type="button"
            className="cream-button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canProceed}
          >
            Continue <ArrowRight size={15} />
          </button>
        )}
        {step === 3 && (
          <button
            type="button"
            className="cream-button"
            onClick={handleSubmit}
            disabled={!canProceed || submitting}
          >
            {submitting ? (
              <>
                <Loader2 size={15} className="animate-spin" /> Confirming…
              </>
            ) : (
              <>
                Confirm booking <ArrowRight size={15} />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
