"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Clock,
  MapPin,
  Printer,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingBag,
  Trash2,
  Users,
  Utensils,
  X,
} from "lucide-react";
import { RoleGuard } from "@/components/auth/role-guard";
import { DashboardBackButton } from "@/components/ui/dashboard-back-button";
import { useAuth } from "@/lib/auth/context";
import { supabase } from "@/lib/supabase/client";
import type {
  CustomerHistoryVisibility,
  HistoryRecordType,
  OrderStatus,
  OrderWithDetails,
  Payment,
  ReservationStatus,
  ReservationWithTable,
} from "@/types/database.types";

const CART_KEY = "dineflow_cart";
const PAGE_SIZE = 10;

type CartItem = {
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
};

type Tab = "orders" | "reservations" | "receipts" | "archived";
type StatusFilter = "all" | "active" | "served" | "cancelled";
type TypeFilter = "all" | "dine_in" | "takeout";
type DateFilter = "all" | "30d" | "3m" | "6m" | "year";
type SortOption = "newest" | "oldest" | "highest" | "lowest";
type ReservationTab = "upcoming" | "past" | "cancelled";

const TABS: { key: Tab; label: string }[] = [
  { key: "orders", label: "My Orders" },
  { key: "reservations", label: "Reservations" },
  { key: "receipts", label: "Receipts" },
  { key: "archived", label: "Archived" },
];

const STATUS_TAGS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "In progress" },
  { key: "served", label: "Served" },
  { key: "cancelled", label: "Cancelled" },
];

// Statuses mapped to readable labels. These reflect the *actual* database enum
// values (order status / reservation status); no new values are introduced.
const ORDER_STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  preparing: "Preparing",
  serving: "Serving",
  served: "Served",
  cancelled: "Cancelled",
};

const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  pending: "Pending",
  confirmed: "Reserved",
  arrived: "Arrived",
  seated: "Seated",
  done_eating: "Done eating",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "No show",
};

const RESERVATION_TAB_LABEL: Record<ReservationTab, string> = {
  upcoming: "Upcoming",
  past: "Past",
  cancelled: "Cancelled",
};

const ACTIVE_ORDER_STATUSES = ["queued", "preparing", "serving"];
// Orders that may be hidden from personal history (never the live queue).
const HIDEABLE_ORDER_STATUSES = ["served", "cancelled"];
// Reservations that may be hidden (past or cancelled — never an active one).
const HIDEABLE_RESERVATION_STATUSES: ReservationStatus[] = [
  "completed",
  "cancelled",
  "no_show",
];
// Order statuses a customer may cancel. Mirrors the server-side rule enforced
// by migration 20260919000000_customer_order_cancellation.sql (RLS policy
// orders_update_cancel_self + orders_guard_customer_update trigger), so the
// UI never shows (or hides) a control the database would disagree with.
const CANCELABLE_ORDER_STATUSES: OrderStatus[] = ["queued", "preparing"];

function isUpcomingReservation(status: ReservationStatus) {
  return status === "pending" || status === "confirmed" || status === "seated";
}
function isPastReservation(status: ReservationStatus) {
  return status === "completed" || status === "no_show";
}

function formatP(value: number | string) {
  return (
    "₱" +
    Number(value).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatStatus(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (first) => first.toUpperCase());
}

// A record queued for "Remove from history", used by the confirmation dialog.
type RemoveTarget = {
  type: HistoryRecordType;
  id: string;
  label: string;
};

export default function CustomerOrdersPage() {
  const { session } = useAuth();
  const uid = session?.user?.id;
  const router = useRouter();
  const pathname = usePathname();

  const [tab, setTab] = useState<Tab>("orders");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const [orders, setOrders] = useState<OrderWithDetails[]>([]);
  const [payments, setPayments] = useState<Map<string, Payment>>(new Map());
  const [reservations, setReservations] = useState<ReservationWithTable[]>([]);

  // Soft-hide overlay: record ids the current user has hidden, per type.
  const [hiddenOrders, setHiddenOrders] = useState<Set<string>>(new Set());
  const [hiddenReservations, setHiddenReservations] = useState<Set<string>>(
    new Set(),
  );
  // The original records paired with when they were hidden (Archived view).
  const [archivedOrders, setArchivedOrders] = useState<
    { order: OrderWithDetails; hiddenAt: string }[]
  >([]);
  const [archivedReservations, setArchivedReservations] = useState<
    { reservation: ReservationWithTable; hiddenAt: string }[]
  >([]);

  const [queryInput, setQueryInput] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [sort, setSort] = useState<SortOption>("newest");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [resTab, setResTab] = useState<ReservationTab>("upcoming");
  const [resQuery, setResQuery] = useState("");
  const [resSearch, setResSearch] = useState("");
  const [resSort, setResSort] = useState<"soonest" | "latest">("soonest");

  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [resDetailId, setResDetailId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [cancelTarget, setCancelTarget] = useState<ReservationWithTable | null>(
    null,
  );
  const [cancelOrderTarget, setCancelOrderTarget] =
    useState<OrderWithDetails | null>(null);

  const [reordering, setReordering] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reorderToast, setReorderToast] = useState<{
    message: string;
    warn: boolean;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(
      () => setToast((current) => (current === message ? null : current)),
      3200,
    );
  }, []);

  // Split fetched records into visible vs archived using the overlay rows.
  const applyVisibility = (
    rows: CustomerHistoryVisibility[],
    allOrders: OrderWithDetails[],
    allReservations: ReservationWithTable[],
  ) => {
    const hiddenOrderIds = new Set<string>();
    const hiddenReservationIds = new Set<string>();
    const orderHiddenAt = new Map<string, string>();
    const reservationHiddenAt = new Map<string, string>();

    rows.forEach((row) => {
      if (row.record_type === "order") {
        hiddenOrderIds.add(row.record_id);
        orderHiddenAt.set(row.record_id, row.hidden_at);
      } else {
        hiddenReservationIds.add(row.record_id);
        reservationHiddenAt.set(row.record_id, row.hidden_at);
      }
    });

    setHiddenOrders(hiddenOrderIds);
    setHiddenReservations(hiddenReservationIds);
    setArchivedOrders(
      allOrders
        .filter((order) => hiddenOrderIds.has(order.id))
        .map((order) => ({
          order,
          hiddenAt: orderHiddenAt.get(order.id) ?? order.created_at,
        })),
    );
    setArchivedReservations(
      allReservations
        .filter((reservation) => hiddenReservationIds.has(reservation.id))
        .map((reservation) => ({
          reservation,
          hiddenAt:
            reservationHiddenAt.get(reservation.id) ?? reservation.created_at,
        })),
    );
  };

  const load = useCallback(async () => {
    if (!uid) return;
    setState("loading");

    // Ensure a customers row exists for this user so orders can be linked by
    // customer_id and reservations can be matched by phone. Sign-up now creates
    // one automatically (migration 20260916000000); this upsert covers accounts
    // created before that migration.
    const { data: member, error: memberError } = await supabase
      .from("customers")
      .select("id, phone")
      .eq("user_id", uid)
      .maybeSingle();

    if (memberError) {
      setState("error");
      return;
    }

    // Orders + reservations + this user's visibility overlay, in parallel.
    // Orders are matched by customer_id OR by the direct user_id link, so
    // history works even when a customer row is missing or was created later.
    const [ordersResult, reservationsResult, visibilityResult] =
      await Promise.all([
        supabase
          .from("orders")
          .select(
            "*, restaurant_tables(table_number, capacity, location), order_items(*)",
          )
          .or(`customer_id.eq.${member?.id ?? "00000000-0000-0000-0000-000000000000"},user_id.eq.${uid}`)
          .order("created_at", { ascending: false }),
        member?.phone
          ? supabase
              .from("reservations")
              .select("*, restaurant_tables(table_number, capacity, location)")
              .or(
                `user_id.eq.${uid}${
                  member?.phone ? `,phone.eq.${member.phone}` : ""
                }`,
              )
              .order("reserved_from", { ascending: false })
          : supabase
              .from("reservations")
              .select("*, restaurant_tables(table_number, capacity, location)")
              .eq("user_id", uid)
              .order("reserved_from", { ascending: false }),
        supabase.from("customer_history_visibility").select("*").eq("user_id", uid),
      ]);

    if (ordersResult.error || reservationsResult.error) {
      setState("error");
      return;
    }

    // A missing visibility table (migration not yet applied) must never break
    // the history — treat it as "nothing hidden".
    const visibilityRows = (visibilityResult.data ??
      []) as CustomerHistoryVisibility[];

    const loadedOrders = (ordersResult.data as OrderWithDetails[]) || [];
    const loadedReservations =
      (reservationsResult.data as ReservationWithTable[]) || [];

    setOrders(loadedOrders);
    setReservations(loadedReservations);

    if (loadedOrders.length > 0) {
      const { data: paymentRows } = await supabase
        .from("payments")
        .select("*")
        .in(
          "order_id",
          loadedOrders.map((order) => order.id),
        );
      const map = new Map<string, Payment>();
      ((paymentRows as Payment[]) || []).forEach((payment) => {
        if (!map.has(payment.order_id)) map.set(payment.order_id, payment);
      });
      setPayments(map);
    } else {
      setPayments(new Map());
    }

    applyVisibility(visibilityRows, loadedOrders, loadedReservations);
    setState("ready");
  }, [uid]);

  useEffect(() => {
    // Defer the initial fetch so state updates don't fire synchronously
    // inside the effect body.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Deep-link support: /my-orders?tab=reservations opens the right section so
  // the dashboard's "View reservations" links land on the unified page.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const initial = new URLSearchParams(window.location.search).get("tab");
    if (!initial || !TABS.some((item) => item.key === initial)) return;
    // Defer so the state update doesn't fire synchronously in the effect body.
    const timer = window.setTimeout(() => setTab(initial as Tab), 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Debounce the search input (300ms); reset pagination when the settled
  // search term changes.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(queryInput.trim().toLowerCase());
      setResSearch(resQuery.trim().toLowerCase());
      setVisibleCount(PAGE_SIZE);
    }, 300);
    return () => clearTimeout(timer);
  }, [queryInput, resQuery]);

  // Close modals with Escape.
  useEffect(() => {
    if (
      !detailsId &&
      !receiptId &&
      !resDetailId &&
      !removeTarget &&
      !cancelOrderTarget
    )
      return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setDetailsId(null);
      setReceiptId(null);
      setResDetailId(null);
      setRemoveTarget(null);
      setCancelOrderTarget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailsId, receiptId, resDetailId, removeTarget, cancelOrderTarget]);

  useEffect(() => {
    if (!reorderToast) return;
    const timer = window.setTimeout(() => setReorderToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [reorderToast]);

  const reorder = async (order: OrderWithDetails) => {
    setReordering(order.id);
    const items = order.order_items || [];
    if (items.length === 0) {
      setReordering(null);
      return;
    }

    // Only add items that are still available on the menu.
    const { data: menuRows } = await supabase
      .from("menu_items")
      .select("id, name, available")
      .in(
        "id",
        items.map((item) => item.menu_item_id),
      );
    const unavailable = new Set(
      ((menuRows as { id: string; available: boolean }[]) || [])
        .filter((row) => !row.available)
        .map((row) => row.id),
    );
    const missing = items.filter(
      (item) => !menuRows?.some((row) => row.id === item.menu_item_id),
    );
    missing.forEach((item) => unavailable.add(item.menu_item_id));

    const addable = items.filter((item) => !unavailable.has(item.menu_item_id));
    if (addable.length > 0) {
      let current: CartItem[] = [];
      try {
        current = JSON.parse(
          localStorage.getItem(CART_KEY) || "[]",
        ) as CartItem[];
      } catch {
        current = [];
      }
      const next = [...current];
      addable.forEach((item) => {
        const existing = next.find(
          (line) => line.menu_item_id === item.menu_item_id,
        );
        if (existing) {
          existing.quantity += item.quantity;
        } else {
          next.push({
            menu_item_id: item.menu_item_id,
            name: item.menu_item_name,
            price: Number(item.unit_price),
            quantity: item.quantity,
          });
        }
      });
      localStorage.setItem(CART_KEY, JSON.stringify(next));
    }

    const skipped = items.length - addable.length;
    setReorderToast({
      message:
        skipped > 0
          ? `${addable.length} item${addable.length === 1 ? "" : "s"} added from Order #${order.order_number} — ${skipped} unavailable.`
          : `All ${addable.length} item${addable.length === 1 ? "" : "s"} added from Order #${order.order_number}.`,
      warn: skipped > 0,
    });
    setReordering(null);
  };

  // Eligibility gates — enforced here AND by RLS + record ownership in the DB,
  // so a crafted request cannot hide another customer's or an active record.
  // Cancellation follows the same principle: the button only appears for an
  // order still queued or preparing, and the database re-checks ownership and
  // status on every update (orders_update_cancel_self + guard trigger).
  const canCancelOrder = (order: OrderWithDetails) =>
    CANCELABLE_ORDER_STATUSES.includes(order.status);
  const canHideOrder = (order: OrderWithDetails) =>
    HIDEABLE_ORDER_STATUSES.includes(order.status);
  const canHideReservation = (reservation: ReservationWithTable) =>
    HIDEABLE_RESERVATION_STATUSES.includes(reservation.status);

  // Soft-hide a record: write a visibility row, then move it to Archived only
  // after the server confirms. On failure the record stays visible.
  const confirmRemove = async () => {
    if (!removeTarget || !uid) return;
    setBusy(true);
    const { error } = await supabase
      .from("customer_history_visibility")
      .insert({
        user_id: uid,
        record_type: removeTarget.type,
        record_id: removeTarget.id,
      });

    if (error) {
      setBusy(false);
      setRemoveTarget(null);
      showToast("Could not update your history. Please try again.");
      return;
    }

    if (removeTarget.type === "order") {
      const order = orders.find((o) => o.id === removeTarget.id) ?? null;
      setOrders((current) => current.filter((o) => o.id !== removeTarget.id));
      setHiddenOrders((current) => new Set(current).add(removeTarget.id));
      if (order) {
        setArchivedOrders((current) => [
          { order, hiddenAt: new Date().toISOString() },
          ...current,
        ]);
      }
    } else {
      const reservation =
        reservations.find((r) => r.id === removeTarget.id) ?? null;
      setReservations((current) =>
        current.filter((r) => r.id !== removeTarget.id),
      );
      setHiddenReservations((current) => new Set(current).add(removeTarget.id));
      if (reservation) {
        setArchivedReservations((current) => [
          { reservation, hiddenAt: new Date().toISOString() },
          ...current,
        ]);
      }
    }

    setBusy(false);
    setRemoveTarget(null);
    showToast("Removed from your history.");
  };

  // Restore an archived record: delete the visibility row, then move it back.
  const restoreRecord = async (type: HistoryRecordType, id: string) => {
    if (!uid) return;
    setBusy(true);
    const { error } = await supabase
      .from("customer_history_visibility")
      .delete()
      .eq("user_id", uid)
      .eq("record_type", type)
      .eq("record_id", id);

    if (error) {
      setBusy(false);
      showToast("Could not restore the record. Please try again.");
      return;
    }

    if (type === "order") {
      const entry = archivedOrders.find((a) => a.order.id === id);
      setArchivedOrders((current) => current.filter((a) => a.order.id !== id));
      setHiddenOrders((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      if (entry) {
        setOrders((current) =>
          [entry.order, ...current].sort(
            (a, b) =>
              new Date(b.created_at).getTime() -
              new Date(a.created_at).getTime(),
          ),
        );
      }
    } else {
      const entry = archivedReservations.find((a) => a.reservation.id === id);
      setArchivedReservations((current) =>
        current.filter((a) => a.reservation.id !== id),
      );
      setHiddenReservations((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      if (entry) {
        setReservations((current) =>
          [entry.reservation, ...current].sort(
            (a, b) =>
              new Date(b.reserved_from).getTime() -
              new Date(a.reserved_from).getTime(),
          ),
        );
      }
    }

    setBusy(false);
    showToast("Restored to your history.");
  };

  const confirmCancelReservation = async () => {
    if (!cancelTarget) return;
    setBusy(true);
    const { error } = await supabase
      .from("reservations")
      .update({ status: "cancelled" })
      .eq("id", cancelTarget.id);
    setBusy(false);
    if (error) {
      showToast("Unable to cancel the reservation. Please try again.");
      setCancelTarget(null);
      return;
    }
    setReservations((current) =>
      current.map((r) =>
        r.id === cancelTarget.id ? { ...r, status: "cancelled" } : r,
      ),
    );
    showToast("Reservation cancelled.");
    setCancelTarget(null);
    setResDetailId(null);
  };

  // "Back to Orders" from the order details view: closing the view returns to
  // the order history on this page, preserving every filter, the search term
  // and pagination (all held in this page's state). If the view was ever
  // opened from another path, route back to the history page explicitly
  // instead of leaving the application.
  const handleBackToOrders = () => {
    setDetailsId(null);
    if (pathname !== "/my-orders") router.push("/my-orders");
  };

  // Cancel an order the customer owns. Ownership and eligibility are re-checked
  // here AND enforced by the database (orders_update_cancel_self policy +
  // orders_guard_customer_update trigger), so hiding the button is never the
  // only defence. Only the status changes — order items, payments and the
  // financial history stay untouched for staff, billing and sales reports.
  const confirmCancelOrder = async () => {
    if (!cancelOrderTarget || !uid) return;
    setBusy(true);

    // 1) Verify ownership: RLS scopes this read to this account's orders only.
    const { data: owned, error: ownerError } = await supabase
      .from("orders")
      .select("id, status")
      .eq("id", cancelOrderTarget.id)
      .maybeSingle();

    if (ownerError) {
      setBusy(false);
      showToast("Could not verify the order. Please try again.");
      return;
    }
    if (!owned) {
      setBusy(false);
      setCancelOrderTarget(null);
      showToast("You can only cancel your own orders.");
      return;
    }
    if (!CANCELABLE_ORDER_STATUSES.includes(owned.status)) {
      setBusy(false);
      setCancelOrderTarget(null);
      showToast("This order can no longer be cancelled.");
      return;
    }

    // 2) Cancel it. The .in() filter mirrors the eligibility rule client-side;
    // the RLS policy and guard trigger re-enforce ownership/status server-side.
    // .select() makes an unsuccessful update visible (zero rows returned)
    // instead of reporting a silent success.
    const { data: updated, error } = await supabase
      .from("orders")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("id", cancelOrderTarget.id)
      .in("status", CANCELABLE_ORDER_STATUSES)
      .select("id");

    setBusy(false);

    if (error) {
      setCancelOrderTarget(null);
      showToast("Unable to cancel the order. Please try again.");
      return;
    }
    if (!updated || updated.length === 0) {
      setCancelOrderTarget(null);
      showToast("This order can no longer be cancelled.");
      return;
    }

    // Reflect the new status immediately, then refresh the full history from
    // the server so every view shows the persisted result.
    const cancelledId = cancelOrderTarget.id;
    setOrders((current) =>
      current.map((order) =>
        order.id === cancelledId ? { ...order, status: "cancelled" } : order,
      ),
    );
    setCancelOrderTarget(null);
    showToast("Order cancelled.");
    void load();
  };

  // ----- Derived data -------------------------------------------------------

  const updateStatusFilter = (value: StatusFilter) => {
    setStatusFilter(value);
    setVisibleCount(PAGE_SIZE);
  };
  const updateTypeFilter = (value: TypeFilter) => {
    setTypeFilter(value);
    setVisibleCount(PAGE_SIZE);
  };
  const updateDateFilter = (value: DateFilter) => {
    setDateFilter(value);
    setVisibleCount(PAGE_SIZE);
  };
  const updateSort = (value: SortOption) => {
    setSort(value);
    setVisibleCount(PAGE_SIZE);
  };
  const clearFilters = () => {
    setQueryInput("");
    setStatusFilter("all");
    setTypeFilter("all");
    setDateFilter("all");
    setSort("newest");
    setVisibleCount(PAGE_SIZE);
  };

  const itemCount = (order: OrderWithDetails) =>
    (order.order_items || []).reduce((sum, item) => sum + item.quantity, 0);

  const filtered = useMemo(() => {
    // Relative date filters need the current time; recomputing on each render
    // is intentional and harmless here (a day-level comparison).
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const cutoffs: Record<Exclude<DateFilter, "all">, number> = {
      "30d": 30 * 24 * 60 * 60 * 1000,
      "3m": 90 * 24 * 60 * 60 * 1000,
      "6m": 182 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000,
    };
    // Soft-hidden orders never appear in the main list.
    const list = orders
      .filter((order) => !hiddenOrders.has(order.id))
      .filter((order) => {
        if (
          statusFilter === "active" &&
          !ACTIVE_ORDER_STATUSES.includes(order.status)
        )
          return false;
        if (statusFilter === "served" && order.status !== "served") return false;
        if (statusFilter === "cancelled" && order.status !== "cancelled")
          return false;
        if (typeFilter !== "all" && order.type !== typeFilter) return false;
        if (dateFilter !== "all") {
          const age = now - new Date(order.created_at).getTime();
          if (age > cutoffs[dateFilter]) return false;
        }
        if (search) {
          const haystack = [
            `#${order.order_number}`,
            String(order.order_number),
            ...(order.order_items || []).map((item) => item.menu_item_name),
          ]
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      });
    switch (sort) {
      case "oldest":
        return [...list].sort(
          (a, b) =>
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime(),
        );
      case "highest":
        return [...list].sort((a, b) => Number(b.total) - Number(a.total));
      case "lowest":
        return [...list].sort((a, b) => Number(a.total) - Number(b.total));
      default:
        return list;
    }
  }, [orders, hiddenOrders, statusFilter, typeFilter, dateFilter, sort, search]);

  const stats = useMemo(() => {
    const counted = orders.filter(
      (order) => order.status !== "cancelled" && !hiddenOrders.has(order.id),
    );
    const spent = counted.reduce((sum, order) => sum + Number(order.total), 0);
    const latest = counted[0];
    const daysAgo = latest
      ? Math.floor(
          // "Days ago" is inherently time-dependent; a day-level drift
          // between renders is acceptable.
          // eslint-disable-next-line react-hooks/purity
          (Date.now() - new Date(latest.created_at).getTime()) /
            (24 * 60 * 60 * 1000),
        )
      : null;
    return { count: counted.length, spent, latest, daysAgo };
  }, [orders, hiddenOrders]);

  const hasFilters =
    statusFilter !== "all" ||
    typeFilter !== "all" ||
    dateFilter !== "all" ||
    search.length > 0;

  // Reservations (excluding soft-hidden), grouped into tabs.
  const visibleReservations = useMemo(
    () => reservations.filter((r) => !hiddenReservations.has(r.id)),
    [reservations, hiddenReservations],
  );

  const upcomingList = useMemo(
    () => visibleReservations.filter((r) => isUpcomingReservation(r.status)),
    [visibleReservations],
  );
  const pastList = useMemo(
    () => visibleReservations.filter((r) => isPastReservation(r.status)),
    [visibleReservations],
  );
  const cancelledList = useMemo(
    () => visibleReservations.filter((r) => r.status === "cancelled"),
    [visibleReservations],
  );

  const resActiveList = useMemo(() => {
    const base =
      resTab === "upcoming"
        ? upcomingList
        : resTab === "past"
          ? pastList
          : cancelledList;
    let list = base;
    if (resSearch) {
      list = list.filter((r) =>
        `${r.code} ${r.guest_name} ${r.phone} ${r.special_request || ""}`
          .toLowerCase()
          .includes(resSearch),
      );
    }
    return [...list].sort((a, b) => {
      const at = new Date(a.reserved_from).getTime();
      const bt = new Date(b.reserved_from).getTime();
      return resSort === "latest" ? bt - at : at - bt;
    });
  }, [resTab, upcomingList, pastList, cancelledList, resSearch, resSort]);

  // Receipts: only orders that actually have a settled payment row. Never
  // fabricate a payment — an unpaid order simply has no receipt.
  const receipts = useMemo(
    () =>
      orders
        .filter((order) => !hiddenOrders.has(order.id))
        .filter((order) => payments.has(order.id))
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime(),
        ),
    [orders, hiddenOrders, payments],
  );

  const details = detailsId
    ? (orders.find((order) => order.id === detailsId) ?? null)
    : null;
  const receiptOrder = receiptId
    ? (orders.find((order) => order.id === receiptId) ?? null)
    : null;
  const resDetail = resDetailId
    ? (reservations.find((r) => r.id === resDetailId) ?? null)
    : null;

  const archivedCount = archivedOrders.length + archivedReservations.length;

  return (
    <RoleGuard allow={["user"]} redirect="/dashboard">
      <div className="oh-page">
        <div className="oh-topnav">
          <DashboardBackButton />
          <div className="oh-topnav-actions">
            <Link href="/book-a-table" className="oh-cta-secondary">
              <CalendarDays size={15} aria-hidden="true" />
              Book a table
            </Link>
            <Link href="/menu" className="oh-cta">
              <Utensils size={15} aria-hidden="true" />
              Browse the menu
            </Link>
          </div>
        </div>

        <header className="oh-header">
          <p className="oh-eyebrow">My account</p>
          <h1 className="oh-title">Order history</h1>
          <p className="oh-lede">
            Your orders, reservations, and receipts — all in one place.
          </p>
        </header>

        <div className="oh-sep" aria-hidden="true" />

        <div className="oh-tabs" role="tablist" aria-label="Account sections">
          {TABS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              className={tab === item.key ? "oh-tab active" : "oh-tab"}
              onClick={() => setTab(item.key)}
            >
              {item.label}
              {item.key === "archived" && archivedCount > 0 && (
                <span className="oh-tab-count">{archivedCount}</span>
              )}
            </button>
          ))}
        </div>

        {state === "loading" ? (
          <div className="oh-skel-list" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className="dash-panel oh-skel-card">
                <div className="menu-skeleton oh-skel-row" />
                <div className="menu-skeleton oh-skel-line" />
                <div className="menu-skeleton oh-skel-line short" />
                <div className="menu-skeleton oh-skel-btn" />
              </div>
            ))}
          </div>
        ) : state === "error" ? (
          <div className="oh-empty" role="alert">
            <span className="oh-empty-mark oh-empty-mark-error">
              <AlertCircle size={30} strokeWidth={1.4} aria-hidden="true" />
            </span>
            <h2 className="oh-empty-title">
              Unable to load your history
            </h2>
            <p className="oh-empty-text">
              There was a problem loading your account. Please try again.
            </p>
            <button className="oh-cta" onClick={load}>
              <RotateCcw size={15} aria-hidden="true" />
              Try again
            </button>
          </div>
        ) : tab === "orders" ? (
          orders.length === 0 ? (
            <div className="oh-empty">
              <span className="oh-empty-mark">
                <ReceiptText size={32} strokeWidth={1.4} aria-hidden="true" />
              </span>
              <h2 className="oh-empty-title">No orders yet</h2>
              <p className="oh-empty-text">
                Your order history will appear here after you place your first
                order.
              </p>
              <Link href="/menu" className="oh-cta">
                Browse the menu
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <p className="oh-or">or</p>
              <Link href="/book-a-table" className="oh-cta-secondary">
                <CalendarDays size={15} aria-hidden="true" />
                Book a table
              </Link>
            </div>
          ) : (
            <>
              <div className="oh-stats">
                <div className="oh-stat dash-panel">
                  <span className="oh-stat-label">Total orders</span>
                  <strong className="oh-stat-value">{stats.count}</strong>
                  <span className="oh-stat-sub">
                    {stats.count === 1 ? "order" : "orders"} all time
                  </span>
                </div>
                <div className="oh-stat dash-panel">
                  <span className="oh-stat-label">Total spent</span>
                  <strong className="oh-stat-value">
                    {formatP(stats.spent)}
                  </strong>
                  <span className="oh-stat-sub">all time</span>
                </div>
                <div className="oh-stat dash-panel">
                  <span className="oh-stat-label">Last order</span>
                  <strong className="oh-stat-value oh-stat-date">
                    {stats.latest ? formatDate(stats.latest.created_at) : "—"}
                  </strong>
                  <span className="oh-stat-sub">
                    {stats.daysAgo === null
                      ? ""
                      : stats.daysAgo === 0
                        ? "today"
                        : stats.daysAgo === 1
                          ? "1 day ago"
                          : `${stats.daysAgo} days ago`}
                  </span>
                </div>
              </div>

              <div className="oh-filters">
                <div className="menu-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="text"
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    placeholder="Search by order number or item…"
                    aria-label="Search orders"
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
                <div className="oh-selects">
                  <label className="oh-select">
                    <span>Type</span>
                    <select
                      value={typeFilter}
                      onChange={(e) =>
                        updateTypeFilter(e.target.value as TypeFilter)
                      }
                      aria-label="Filter by order type"
                    >
                      <option value="all">All types</option>
                      <option value="dine_in">Dine-in</option>
                      <option value="takeout">Takeout</option>
                    </select>
                    <ChevronDown size={13} aria-hidden="true" />
                  </label>
                  <label className="oh-select">
                    <span>Period</span>
                    <select
                      value={dateFilter}
                      onChange={(e) =>
                        updateDateFilter(e.target.value as DateFilter)
                      }
                      aria-label="Filter by date range"
                    >
                      <option value="all">All time</option>
                      <option value="30d">Last 30 days</option>
                      <option value="3m">Last 3 months</option>
                      <option value="6m">Last 6 months</option>
                      <option value="year">This year</option>
                    </select>
                    <ChevronDown size={13} aria-hidden="true" />
                  </label>
                  <label className="oh-select">
                    <span>Sort</span>
                    <select
                      value={sort}
                      onChange={(e) => updateSort(e.target.value as SortOption)}
                      aria-label="Sort orders"
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                      <option value="highest">Highest total</option>
                      <option value="lowest">Lowest total</option>
                    </select>
                    <ChevronDown size={13} aria-hidden="true" />
                  </label>
                </div>
              </div>

              <div
                className="oh-tags"
                role="group"
                aria-label="Quick status filters"
              >
                {STATUS_TAGS.map((tag) => (
                  <button
                    key={tag.key}
                    className={
                      statusFilter === tag.key ? "menu-tab active" : "menu-tab"
                    }
                    aria-pressed={statusFilter === tag.key}
                    onClick={() => updateStatusFilter(tag.key)}
                  >
                    {tag.label}
                  </button>
                ))}
                {hasFilters && (
                  <button className="oh-clear" onClick={clearFilters}>
                    Clear filters
                  </button>
                )}
              </div>

              {filtered.length === 0 ? (
                <div className="oh-empty oh-empty-tight">
                  <span className="oh-empty-mark">
                    <Search size={28} strokeWidth={1.5} aria-hidden="true" />
                  </span>
                  <h2 className="oh-empty-title">
                    No orders match your filters
                  </h2>
                  <p className="oh-empty-text">
                    Try adjusting your filters or search terms.
                  </p>
                  <button className="oh-cta" onClick={clearFilters}>
                    Clear filters
                  </button>
                </div>
              ) : (
                <>
                  <div className="oh-list">
                    {filtered.slice(0, visibleCount).map((order) => {
                      const items = order.order_items || [];
                      const count = itemCount(order);
                      const hasReceipt = payments.has(order.id);
                      return (
                        <article key={order.id} className="oh-card dash-panel">
                          <div className="oh-card-top">
                            <div>
                              <h3 className="oh-order-no">
                                Order #{order.order_number}
                              </h3>
                              <p className="oh-card-meta">
                                {formatDate(order.created_at)}
                                {" · "}
                                {formatTime(order.created_at)}
                              </p>
                            </div>
                            <span
                              className={`status-badge status-${order.status}`}
                            >
                              {ORDER_STATUS_LABEL[order.status] ??
                                formatStatus(order.status)}
                            </span>
                          </div>
                          <div className="oh-type">
                            {order.type === "dine_in" ? (
                              <Utensils size={14} aria-hidden="true" />
                            ) : (
                              <ShoppingBag size={14} aria-hidden="true" />
                            )}
                            <span>
                              {order.type === "dine_in" ? "Dine-in" : "Takeout"}
                              {order.restaurant_tables?.table_number
                                ? ` · Table ${order.restaurant_tables.table_number}`
                                : ""}
                            </span>
                            <span className="oh-total-chip">
                              {formatP(Number(order.total))}
                            </span>
                          </div>
                          <div className="oh-items">
                            <span className="oh-sec-label">
                              {count} {count === 1 ? "item" : "items"}
                            </span>
                            {items.slice(0, 3).map((item) => (
                              <div key={item.id} className="oh-item">
                                <span className="oh-item-qty">
                                  {item.quantity}×
                                </span>
                                <span className="oh-item-name">
                                  {item.menu_item_name}
                                </span>
                                <span className="oh-item-price">
                                  {formatP(Number(item.line_total))}
                                </span>
                              </div>
                            ))}
                            {items.length > 3 && (
                              <p className="oh-more">
                                +{items.length - 3} more item
                                {items.length - 3 === 1 ? "" : "s"}
                              </p>
                            )}
                          </div>
                          <div className="oh-card-actions">
                            <button
                              className="oh-cta-secondary"
                              onClick={() => setDetailsId(order.id)}
                              aria-label={`View details for order ${order.order_number}`}
                            >
                              View details
                            </button>
                            {hasReceipt && (
                              <button
                                className="oh-cta-secondary"
                                onClick={() => setReceiptId(order.id)}
                                aria-label={`View receipt for order ${order.order_number}`}
                              >
                                <Printer size={14} aria-hidden="true" />
                                View receipt
                              </button>
                            )}
                            <button
                              className="oh-cta"
                              onClick={() => reorder(order)}
                              disabled={reordering === order.id}
                              aria-label={`Reorder items from order ${order.order_number}`}
                            >
                              {reordering === order.id ? "Adding…" : "Reorder"}
                            </button>
                            {canCancelOrder(order) && (
                              <button
                                className="btn-outline danger"
                                onClick={() => setCancelOrderTarget(order)}
                                disabled={busy}
                                aria-label={`Cancel order ${order.order_number}`}
                              >
                                Cancel Order
                              </button>
                            )}
                            {canHideOrder(order) && (
                              <button
                                className="oh-remove"
                                onClick={() =>
                                  setRemoveTarget({
                                    type: "order",
                                    id: order.id,
                                    label: `Order #${order.order_number}`,
                                  })
                                }
                                aria-label={`Remove order ${order.order_number} from history`}
                              >
                                <Trash2 size={14} aria-hidden="true" />
                                Remove
                              </button>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {filtered.length > visibleCount && (
                    <div className="oh-load-more">
                      <button
                        className="oh-cta-secondary"
                        onClick={() =>
                          setVisibleCount((current) => current + PAGE_SIZE)
                        }
                      >
                        Load more orders ({filtered.length - visibleCount}{" "}
                        remaining)
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )
        ) : tab === "reservations" ? (
          visibleReservations.length === 0 ? (
            <div className="oh-empty">
              <span className="oh-empty-mark">
                <CalendarDays size={32} strokeWidth={1.4} aria-hidden="true" />
              </span>
              <h2 className="oh-empty-title">No reservations yet</h2>
              <p className="oh-empty-text">
                Reserve a table and your upcoming and past bookings will appear
                here.
              </p>
              <Link href="/book-a-table" className="oh-cta">
                Book a table
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <>
              <div className="rs-tabs oh-subtabs" role="tablist" aria-label="Reservation sections">
                {(
                  [
                    ["upcoming", upcomingList.length],
                    ["past", pastList.length],
                    ["cancelled", cancelledList.length],
                  ] as [ReservationTab, number][]
                ).map(([key, count]) => (
                  <button
                    key={key}
                    role="tab"
                    aria-selected={resTab === key}
                    className={resTab === key ? "rs-tab active" : "rs-tab"}
                    onClick={() => setResTab(key)}
                  >
                    {RESERVATION_TAB_LABEL[key]}
                    <span className="rs-tab-count">{count}</span>
                  </button>
                ))}
              </div>

              <div className="rs-controls oh-controls">
                <div className="menu-search rs-search">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="text"
                    value={resQuery}
                    onChange={(e) => setResQuery(e.target.value)}
                    placeholder="Search by code, name, or request…"
                    aria-label="Search reservations"
                  />
                  {resQuery && (
                    <button
                      className="menu-search-clear"
                      onClick={() => setResQuery("")}
                      aria-label="Clear search"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
                <label className="oh-select">
                  <span>Sort</span>
                  <select
                    value={resSort}
                    onChange={(e) =>
                      setResSort(e.target.value as "soonest" | "latest")
                    }
                    aria-label="Sort reservations"
                  >
                    <option value="soonest">Soonest first</option>
                    <option value="latest">Latest first</option>
                  </select>
                  <ChevronDown size={13} aria-hidden="true" />
                </label>
              </div>

              {resActiveList.length === 0 ? (
                <div className="oh-empty oh-empty-tight">
                  <span className="oh-empty-mark">
                    <CalendarDays
                      size={28}
                      strokeWidth={1.5}
                      aria-hidden="true"
                    />
                  </span>
                  <h2 className="oh-empty-title">
                    No {RESERVATION_TAB_LABEL[resTab].toLowerCase()}{" "}
                    reservations
                  </h2>
                  <p className="oh-empty-text">
                    {resTab === "upcoming"
                      ? "Book a table to see your next visit here."
                      : "Nothing to show in this section yet."}
                  </p>
                  {resTab === "upcoming" && (
                    <Link href="/book-a-table" className="oh-cta">
                      Book a table
                      <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  )}
                </div>
              ) : (
                <div className="oh-list">
                  {resActiveList.map((reservation) => (
                    <article key={reservation.id} className="oh-card dash-panel">
                      <div className="oh-card-top">
                        <div>
                          <h3 className="oh-order-no">Ref {reservation.code}</h3>
                          <p className="oh-card-meta">
                            {formatDate(reservation.reserved_from)}
                            {" · "}
                            {formatTime(reservation.reserved_from)}
                          </p>
                        </div>
                        <span
                          className={`status-badge status-${reservation.status}`}
                        >
                          {RESERVATION_STATUS_LABEL[reservation.status]}
                        </span>
                      </div>
                      <div className="oh-res-facts">
                        <span className="oh-fact">
                          <Users size={14} aria-hidden="true" />
                          {reservation.party_size}{" "}
                          {reservation.party_size === 1 ? "guest" : "guests"}
                        </span>
                        {reservation.restaurant_tables?.table_number && (
                          <span className="oh-fact">
                            <MapPin size={14} aria-hidden="true" />
                            Table {reservation.restaurant_tables.table_number}
                          </span>
                        )}
                        <span className="oh-fact">
                          <Clock size={14} aria-hidden="true" />
                          {formatTime(reservation.reserved_from)} –{" "}
                          {formatTime(reservation.reserved_to)}
                        </span>
                      </div>
                      {reservation.special_request && (
                        <p className="oh-res-request">
                          “{reservation.special_request}”
                        </p>
                      )}
                      <div className="oh-card-actions">
                        <button
                          className="oh-cta-secondary"
                          onClick={() => setResDetailId(reservation.id)}
                          aria-label={`View details for reservation ${reservation.code}`}
                        >
                          View details
                        </button>
                        {isUpcomingReservation(reservation.status) && (
                          <button
                            className="btn-outline danger"
                            onClick={() => setCancelTarget(reservation)}
                          >
                            Cancel reservation
                          </button>
                        )}
                        {canHideReservation(reservation) && (
                          <button
                            className="oh-remove"
                            onClick={() =>
                              setRemoveTarget({
                                type: "reservation",
                                id: reservation.id,
                                label: `Reservation ${reservation.code}`,
                              })
                            }
                            aria-label={`Remove reservation ${reservation.code} from history`}
                          >
                            <Trash2 size={14} aria-hidden="true" />
                            Remove
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </>
          )
        ) : tab === "receipts" ? (
          receipts.length === 0 ? (
            <div className="oh-empty">
              <span className="oh-empty-mark">
                <ReceiptText size={32} strokeWidth={1.4} aria-hidden="true" />
              </span>
              <h2 className="oh-empty-title">No receipts yet</h2>
              <p className="oh-empty-text">
                Receipts appear here once an order has been paid and settled.
              </p>
              <Link href="/menu" className="oh-cta">
                Browse the menu
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <div className="oh-list">
              {receipts.map((order) => {
                const payment = payments.get(order.id);
                return (
                  <article key={order.id} className="oh-card dash-panel">
                    <div className="oh-card-top">
                      <div>
                        <h3 className="oh-order-no">
                          Order #{order.order_number}
                        </h3>
                        <p className="oh-card-meta">
                          {formatDate(order.created_at)} ·{" "}
                          {formatTime(order.created_at)}
                        </p>
                      </div>
                      <span
                        className={`status-badge status-${order.status}`}
                      >
                        {ORDER_STATUS_LABEL[order.status] ??
                          formatStatus(order.status)}
                      </span>
                    </div>
                    <div className="oh-items">
                      <span className="oh-sec-label">
                        {(order.order_items || []).length} line
                        {(order.order_items || []).length === 1 ? "" : "s"}
                      </span>
                      {(order.order_items || []).slice(0, 2).map((item) => (
                        <div key={item.id} className="oh-item">
                          <span className="oh-item-qty">{item.quantity}×</span>
                          <span className="oh-item-name">
                            {item.menu_item_name}
                          </span>
                          <span className="oh-item-price">
                            {formatP(Number(item.line_total))}
                          </span>
                        </div>
                      ))}
                    </div>
                    {payment && (
                      <div className="oh-receipt-pay">
                        <span className="oh-sec-label">Payment</span>
                        <div className="oh-money-row">
                          <span>{formatStatus(payment.method)}</span>
                          <span>Paid {formatP(Number(payment.amount_tendered))}</span>
                        </div>
                        {Number(payment.change_amount) > 0 && (
                          <div className="oh-money-row">
                            <span>Change</span>
                            <span>
                              {formatP(Number(payment.change_amount))}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="oh-receipt-total">
                      <span>Total</span>
                      <strong>{formatP(Number(order.total))}</strong>
                    </div>
                    <div className="oh-card-actions">
                      <button
                        className="oh-cta"
                        onClick={() => setReceiptId(order.id)}
                        aria-label={`Print receipt for order ${order.order_number}`}
                      >
                        <Printer size={14} aria-hidden="true" />
                        View / print receipt
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )
        ) : archivedCount === 0 ? (
          <div className="oh-empty">
            <span className="oh-empty-mark">
              <Archive size={32} strokeWidth={1.4} aria-hidden="true" />
            </span>
            <h2 className="oh-empty-title">Nothing archived</h2>
            <p className="oh-empty-text">
              Orders and reservations you remove from your history are kept here
              so you can restore them anytime.
            </p>
          </div>
        ) : (
          <>
            <p className="oh-archive-note">
              These records are hidden from your main history but still stored in
              the restaurant&apos;s system. Restore any of them to bring it back.
            </p>
            <div className="oh-list">
              {archivedOrders.map(({ order, hiddenAt }) => (
                <article
                  key={order.id}
                  className="oh-card dash-panel oh-card-archived"
                >
                  <div className="oh-card-top">
                    <div>
                      <h3 className="oh-order-no">
                        Order #{order.order_number}
                      </h3>
                      <p className="oh-card-meta">
                        {formatDate(order.created_at)} · Hidden{" "}
                        {formatDate(hiddenAt)}
                      </p>
                    </div>
                    <span className={`status-badge status-${order.status}`}>
                      {ORDER_STATUS_LABEL[order.status] ??
                        formatStatus(order.status)}
                    </span>
                  </div>
                  <div className="oh-card-actions">
                    <button
                      className="oh-cta"
                      onClick={() => restoreRecord("order", order.id)}
                      disabled={busy}
                      aria-label={`Restore order ${order.order_number}`}
                    >
                      <ArchiveRestore size={14} aria-hidden="true" />
                      Restore
                    </button>
                  </div>
                </article>
              ))}
              {archivedReservations.map(({ reservation, hiddenAt }) => (
                <article
                  key={reservation.id}
                  className="oh-card dash-panel oh-card-archived"
                >
                  <div className="oh-card-top">
                    <div>
                      <h3 className="oh-order-no">
                        Reservation {reservation.code}
                      </h3>
                      <p className="oh-card-meta">
                        {formatDate(reservation.reserved_from)} · Hidden{" "}
                        {formatDate(hiddenAt)}
                      </p>
                    </div>
                    <span
                      className={`status-badge status-${reservation.status}`}
                    >
                      {RESERVATION_STATUS_LABEL[reservation.status]}
                    </span>
                  </div>
                  <div className="oh-card-actions">
                    <button
                      className="oh-cta"
                      onClick={() => restoreRecord("reservation", reservation.id)}
                      disabled={busy}
                      aria-label={`Restore reservation ${reservation.code}`}
                    >
                      <ArchiveRestore size={14} aria-hidden="true" />
                      Restore
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}

        {details && (
          <div className="oh-modal-overlay" onClick={() => setDetailsId(null)}>
            <div
              className="oh-modal dash-panel"
              role="dialog"
              aria-modal="true"
              aria-label={`Order ${details.order_number} details`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="oh-modal-nav">
                <button
                  className="oh-cta-secondary"
                  onClick={handleBackToOrders}
                  aria-label="Back to orders"
                >
                  <ArrowLeft size={15} aria-hidden="true" />
                  Back to Orders
                </button>
                <Link href="/cart" className="oh-cta">
                  <ShoppingBag size={15} aria-hidden="true" />
                  Preorder
                </Link>
              </div>
              <div className="oh-modal-head">
                <div>
                  <h3 className="oh-order-no">
                    Order #{details.order_number}
                  </h3>
                  <p className="oh-modal-sub">
                    Placed on {formatDateTime(details.created_at)}
                  </p>
                </div>
                <button
                  className="oh-modal-close"
                  onClick={() => setDetailsId(null)}
                  aria-label="Close order details"
                >
                  <X size={16} />
                </button>
              </div>

              <span className={`status-badge status-${details.status}`}>
                {ORDER_STATUS_LABEL[details.status] ??
                  formatStatus(details.status)}
              </span>

              <div className="oh-modal-section">
                <span className="oh-sec-label">Order type</span>
                <div className="oh-type">
                  {details.type === "dine_in" ? (
                    <Utensils size={14} aria-hidden="true" />
                  ) : (
                    <ShoppingBag size={14} aria-hidden="true" />
                  )}
                  <span>
                    {details.type === "dine_in" ? "Dine-in" : "Takeout"}
                    {details.type === "dine_in" &&
                    details.restaurant_tables?.table_number
                      ? ` · Table ${details.restaurant_tables.table_number}`
                      : ""}
                  </span>
                </div>
              </div>

              <div className="oh-modal-section">
                <span className="oh-sec-label">Items</span>
                <div>
                  {(details.order_items || []).map((item) => (
                    <div key={item.id} className="oh-modal-item">
                      <span className="oh-item-qty">{item.quantity}×</span>
                      <div className="oh-modal-item-body">
                        <span className="oh-item-name">
                          {item.menu_item_name}
                        </span>
                        {item.notes && (
                          <p className="oh-modal-item-note">“{item.notes}”</p>
                        )}
                      </div>
                      <span className="oh-item-price">
                        {formatP(Number(item.line_total))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="oh-modal-section">
                <span className="oh-sec-label">Summary</span>
                <div className="oh-money">
                  <div className="oh-money-row">
                    <span>Subtotal</span>
                    <span>{formatP(Number(details.subtotal))}</span>
                  </div>
                  <div className="oh-money-row">
                    <span>Service charge (10%)</span>
                    <span>{formatP(Number(details.service_charge))}</span>
                  </div>
                  <div className="oh-money-row">
                    <span>VAT (12%)</span>
                    <span>{formatP(Number(details.tax))}</span>
                  </div>
                  {Number(details.discount) > 0 && (
                    <div className="oh-money-row">
                      <span>Discount</span>
                      <span>−{formatP(Number(details.discount))}</span>
                    </div>
                  )}
                  <div className="oh-money-row total">
                    <span>Total</span>
                    <strong>{formatP(Number(details.total))}</strong>
                  </div>
                </div>
              </div>

              {"special_instructions" in details &&
                (details as { special_instructions?: string | null })
                  .special_instructions && (
                  <div className="oh-modal-section">
                    <span className="oh-sec-label">Special instructions</span>
                    <p className="oh-modal-sub">
                      {
                        (details as { special_instructions?: string | null })
                          .special_instructions
                      }
                    </p>
                  </div>
                )}

              <div className="oh-modal-section">
                <span className="oh-sec-label">Payment</span>
                {(() => {
                  const payment = payments.get(details.id);
                  return payment ? (
                    <div className="oh-type">
                      <ReceiptText size={14} aria-hidden="true" />
                      <span>
                        {formatStatus(payment.method)}
                        {payment.amount_tendered != null
                          ? ` · Paid ${formatP(Number(payment.amount_tendered))}`
                          : ""}
                        {payment.change_amount != null &&
                        Number(payment.change_amount) > 0
                          ? ` · Change ${formatP(Number(payment.change_amount))}`
                          : ""}
                      </span>
                    </div>
                  ) : (
                    <p className="oh-modal-sub">Not yet settled.</p>
                  );
                })()}
              </div>

              <div className="oh-modal-actions">
                {payments.has(details.id) && (
                  <button
                    className="oh-cta-secondary"
                    onClick={() => {
                      setReceiptId(details.id);
                      setDetailsId(null);
                    }}
                  >
                    <Printer size={14} aria-hidden="true" />
                    View receipt
                  </button>
                )}
                <button
                  className="oh-cta"
                  onClick={() => reorder(details)}
                  disabled={reordering === details.id}
                >
                  {reordering === details.id ? "Adding…" : "Reorder"}
                </button>
              </div>
            </div>
          </div>
        )}

        {reorderToast && (
          <div
            className={`menu-toast${reorderToast.warn ? " warn" : ""}`}
            role="status"

            aria-live="polite"
          >
            {reorderToast.message}
          </div>
        )}

        {toast && (
          <div className="menu-toast" role="status" aria-live="polite">
            {toast}
          </div>
        )}

        {receiptOrder && (
          <div className="oh-modal-overlay" onClick={() => setReceiptId(null)}>
            <div
              className="oh-modal dash-panel oh-receipt"
              role="dialog"
              aria-modal="true"
              aria-label={`Receipt for order ${receiptOrder.order_number}`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="oh-modal-head">
                <div>
                  <p className="eyebrow">Receipt</p>
                  <h3 className="oh-order-no">
                    Order #{receiptOrder.order_number}
                  </h3>
                  <p className="oh-modal-sub">
                    {formatDateTime(receiptOrder.created_at)}
                  </p>
                </div>
                <button
                  className="oh-modal-close"
                  onClick={() => setReceiptId(null)}
                  aria-label="Close receipt"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="oh-receipt-items">
                {(receiptOrder.order_items || []).map((item) => (
                  <div key={item.id} className="oh-receipt-item">
                    <span className="oh-item-qty">{item.quantity}×</span>
                    <span className="oh-item-name">{item.menu_item_name}</span>
                    <span className="oh-item-price">
                      {formatP(Number(item.line_total))}
                    </span>
                  </div>
                ))}
              </div>

              <div className="oh-money">
                <div className="oh-money-row">
                  <span>Subtotal</span>
                  <span>{formatP(Number(receiptOrder.subtotal))}</span>
                </div>
                <div className="oh-money-row">
                  <span>Service charge</span>
                  <span>{formatP(Number(receiptOrder.service_charge))}</span>
                </div>
                <div className="oh-money-row">
                  <span>VAT (12%)</span>
                  <span>{formatP(Number(receiptOrder.tax))}</span>
                </div>
                {Number(receiptOrder.discount) > 0 && (
                  <div className="oh-money-row">
                    <span>Discount</span>
                    <span>−{formatP(Number(receiptOrder.discount))}</span>
                  </div>
                )}
                <div className="oh-money-row total">
                  <span>Total</span>
                  <strong>{formatP(Number(receiptOrder.total))}</strong>
                </div>
              </div>

              {(() => {
                const payment = payments.get(receiptOrder.id);
                if (!payment) return null;
                return (
                  <div className="oh-receipt-pay">
                    <div className="oh-money-row">
                      <span>Method</span>
                      <span>{formatStatus(payment.method)}</span>
                    </div>
                    <div className="oh-money-row">
                      <span>Paid</span>
                      <span>{formatP(Number(payment.amount_tendered))}</span>
                    </div>
                    {Number(payment.change_amount) > 0 && (
                      <div className="oh-money-row">
                        <span>Change</span>
                        <span>{formatP(Number(payment.change_amount))}</span>
                      </div>
                    )}
                    {payment.reference && (
                      <div className="oh-money-row">
                        <span>Reference</span>
                        <span>{payment.reference}</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div className="oh-modal-actions">
                <button className="oh-cta" onClick={() => window.print()}>
                  <Printer size={14} aria-hidden="true" />
                  Print
                </button>
                <button
                  className="oh-cta-secondary"
                  onClick={() => setReceiptId(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {resDetail && (
          <div className="oh-modal-overlay" onClick={() => setResDetailId(null)}>
            <div
              className="oh-modal dash-panel"
              role="dialog"
              aria-modal="true"
              aria-label={`Reservation ${resDetail.code} details`}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="oh-modal-head">
                <div>
                  <p className="eyebrow">Reservation</p>
                  <h3 className="oh-order-no">Ref {resDetail.code}</h3>
                  <p className="oh-modal-sub">
                    {formatDate(resDetail.reserved_from)}
                  </p>
                </div>
                <button
                  className="oh-modal-close"
                  onClick={() => setResDetailId(null)}
                  aria-label="Close reservation details"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="rs-modal-status">
                <span className={`status-badge status-${resDetail.status}`}>
                  {RESERVATION_STATUS_LABEL[resDetail.status]}
                </span>
              </div>

              <div className="oh-modal-section">
                <span className="oh-sec-label">When</span>
                <div className="rs-modal-line">
                  <Clock size={14} aria-hidden="true" />
                  <span>
                    {formatTime(resDetail.reserved_from)} –{" "}
                    {formatTime(resDetail.reserved_to)}
                  </span>
                </div>
                <div className="rs-modal-line">
                  <Users size={14} aria-hidden="true" />
                  <span>
                    {resDetail.party_size}{" "}
                    {resDetail.party_size === 1 ? "guest" : "guests"}
                  </span>
                </div>
                {resDetail.restaurant_tables?.table_number && (
                  <div className="rs-modal-line">
                    <MapPin size={14} aria-hidden="true" />
                    <span>
                      Table {resDetail.restaurant_tables.table_number} ·{" "}
                      {resDetail.restaurant_tables.location}
                    </span>
                  </div>
                )}
              </div>

              <div className="oh-modal-section">
                <span className="oh-sec-label">Guest</span>
                <div className="rs-modal-line">{resDetail.guest_name}</div>
                <div className="rs-modal-line rs-modal-phone">
                  {resDetail.phone}
                </div>
                {resDetail.email && (
                  <div className="rs-modal-line">{resDetail.email}</div>
                )}
              </div>

              {resDetail.special_request && (
                <div className="oh-modal-section">
                  <span className="oh-sec-label">Special requests</span>
                  <p className="oh-res-request">
                    “{resDetail.special_request}”
                  </p>
                </div>
              )}

              <div className="oh-modal-actions">
                {isUpcomingReservation(resDetail.status) && (
                  <button
                    className="btn-outline danger"
                    onClick={() => setCancelTarget(resDetail)}
                  >
                    Cancel reservation
                  </button>
                )}
                <button
                  className="btn-primary"
                  onClick={() => setResDetailId(null)}
                >
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
              if (e.target === e.currentTarget && !busy) setCancelTarget(null);
            }}
          >
            <div
              className="oh-modal dash-panel oh-modal-narrow"
              role="dialog"
              aria-modal="true"
              aria-label="Cancel reservation"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="oh-modal-head">
                <div>
                  <p className="eyebrow">Cancel reservation?</p>
                  <h3 className="oh-order-no">Ref {cancelTarget.code}</h3>
                  <p className="oh-modal-sub">
                    {formatDate(cancelTarget.reserved_from)} ·{" "}
                    {formatTime(cancelTarget.reserved_from)}
                  </p>
                </div>
                <button
                  className="oh-modal-close"
                  onClick={() => setCancelTarget(null)}
                  disabled={busy}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
              <p className="oh-modal-sub">
                Are you sure you want to cancel your reservation for{" "}
                {formatDate(cancelTarget.reserved_from)} at{" "}
                {formatTime(cancelTarget.reserved_from)}? This cannot be undone.
              </p>
              <div className="oh-modal-actions">
                <button
                  className="btn-outline"
                  onClick={() => setCancelTarget(null)}
                  disabled={busy}
                >
                  No, keep it
                </button>
                <button
                  className="btn-outline danger"
                  onClick={confirmCancelReservation}
                  disabled={busy}
                >
                  {busy ? "Cancelling…" : "Yes, cancel"}
                </button>
              </div>
            </div>
          </div>
        )}

        {cancelOrderTarget && (
          <div
            className="oh-modal-overlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !busy)
                setCancelOrderTarget(null);
            }}
          >
            <div
              className="oh-modal dash-panel oh-modal-narrow"
              role="dialog"
              aria-modal="true"
              aria-label="Cancel order"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="oh-modal-head">
                <div>
                  <p className="eyebrow">Cancel order?</p>
                  <h3 className="oh-order-no">
                    Order #{cancelOrderTarget.order_number}
                  </h3>
                </div>
                <button
                  className="oh-modal-close"
                  onClick={() => setCancelOrderTarget(null)}
                  disabled={busy}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
              <p className="oh-modal-sub">
                Are you sure you want to cancel this order? This action may not
                be reversible.
              </p>
              <div className="oh-modal-actions">
                <button
                  className="btn-outline"
                  onClick={() => setCancelOrderTarget(null)}
                  disabled={busy}
                >
                  Keep Order
                </button>
                <button
                  className="btn-outline danger"
                  onClick={confirmCancelOrder}
                  disabled={busy}
                >
                  {busy ? "Cancelling…" : "Confirm Cancellation"}
                </button>
              </div>
            </div>
          </div>
        )}

        {removeTarget && (
          <div
            className="oh-modal-overlay"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !busy) setRemoveTarget(null);
            }}
          >
            <div
              className="oh-modal dash-panel oh-modal-narrow"
              role="dialog"
              aria-modal="true"
              aria-label="Remove from history"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="oh-modal-head">
                <div>
                  <p className="eyebrow">Remove from history?</p>
                  <h3 className="oh-order-no">{removeTarget.label}</h3>
                </div>
                <button
                  className="oh-modal-close"
                  onClick={() => setRemoveTarget(null)}
                  disabled={busy}
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>
              <p className="oh-modal-sub">
                This {removeTarget.type === "order" ? "order" : "reservation"}{" "}
                will no longer appear in your personal history. Your transaction
                record will remain stored in the restaurant&apos;s system.
              </p>
              <div className="oh-modal-actions">
                <button
                  className="btn-outline"
                  onClick={() => setRemoveTarget(null)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  className="btn-outline danger"
                  onClick={confirmRemove}
                  disabled={busy}
                >
                  {busy ? "Removing…" : "Remove from History"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </RoleGuard>
  );
}




