"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  Info,
  Loader2,
  Lock,
  Minus,
  Package,
  Plus,
  RotateCcw,
  ShoppingBag,
  Star,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import { RoleGuard } from "@/components/auth/role-guard";
import { useAuth } from "@/lib/auth/context";
import { supabase } from "@/lib/supabase/client";
import {
  clearCart,
  formatP,
  readCart,
  readOrderType,
  readSpecialInstructions,
  writeCart,
  writeOrderType,
  writeSpecialInstructions,
  type CartLine,
} from "@/lib/cart";
import {
  SERVICE_CHARGE_RATE,
  VAT_RATE,
  calculateOrderTotals,
  lineTotal,
  orderTotalsMatch,
} from "@/lib/utils/order-calculations";
import type {
  AppliedPromo,
  CartItemRow,
  LoyaltyCustomer,
  MenuItemAvailability,
  OrderWithDetails,
} from "@/types/database.types";

const PICKUP_TIMES = Array.from({ length: 24 }, (_, index) => {
  const minutes = index * 30 + 600; // start at 10:00 AM
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
});

// Minimal safety net for special instructions; kept intentionally small.
const INAPPROPRIATE_PATTERN = /\b(dumb|idiot|stupid|moron|worthless)\b/i;

type CheckoutLine = {
  menu_item_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number; // current price from menu_items
  storedPrice: number; // price at the time the item was added
  quantity: number;
  notes?: string;
  customizations?: string[];
  available: boolean;
  stock: number | null;
  stockNotice?: boolean;
  imageError?: boolean;
};

type CartStatus = "loading" | "ready" | "error";

const toSlimLine = (line: CheckoutLine): CartLine => ({
  menu_item_id: line.menu_item_id,
  name: line.name,
  price: line.price,
  storedPrice: line.storedPrice,
  quantity: line.quantity,
  notes: line.notes,
  customizations: line.customizations,
});

function dateToISO(value: Date) {
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function initialDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return dateToISO(date);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string) {
  return UUID_RE.test(value);
}

/**
 * PostgREST/Postgres error shape that means "the connected database has not
 * received the migration adding this column yet".
 */
function isMissingColumnError(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return (
    error?.code === "PGRST204" ||
    error?.code === "42703" ||
    /could not find the .*column/i.test(error?.message ?? "") ||
    /column .* does not exist/i.test(error?.message ?? "")
  );
}

/**
 * Flatten a caught value into a plain, JSON-safe object for logging.
 *
 * `Error` and `DOMException` expose `name`/`message`/`stack` as
 * non-enumerable properties, and Supabase `PostgrestError`s keep their
 * actionable `message` on the `Error` prototype. Log pipelines that
 * serialize console arguments only see enumerable keys, which is how a
 * failed checkout ends up printed as a useless `{}`. Copying the fields
 * explicitly guarantees the trace is diagnosable.
 */
function describeThrownError(error: unknown): Record<string, unknown> {
  if (typeof error !== "object" || error === null) {
    return { value: String(error) };
  }

  // Start from the enumerable properties so plain thrown payloads (e.g. the
  // `{ message, details, hint, code }` object PostgREST returns) survive as-is.
  const described: Record<string, unknown> = { ...error };
  const source = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    details?: unknown;
    hint?: unknown;
    stack?: unknown;
  };

  // Then copy the non-enumerable Error fields the spread above cannot see.
  if (typeof source.name === "string") described.name = source.name;
  if (typeof source.message === "string") described.message = source.message;
  if (typeof source.code === "string" || typeof source.code === "number") {
    described.code = source.code;
  }
  if (typeof source.details === "string") described.details = source.details;
  if (typeof source.hint === "string") described.hint = source.hint;
  if (typeof source.stack === "string") described.stack = source.stack;

  if (Object.keys(described).length === 0) {
    // A contentless object carries no information — say so explicitly
    // instead of logging another bare `{}`.
    return {
      value: `${Object.prototype.toString.call(error)} had no readable properties`,
    };
  }
  return described;
}

/**
 * Fetch menu rows for the cart item ids. The `stock` column ships with
 * migration 20260914000000. When that migration has not been applied yet the
 * query fails with a missing-column error, so we retry with the base columns
 * and treat stock as unlimited. Any other failure surfaces as an explicit
 * error so the page can show its retry state.
 */
async function loadMenuRows(ids: string[]) {
  const full = await supabase
    .from("menu_items")
    .select("id, name, description, price, image_url, prep_time, available, stock")
    .in("id", ids);
  if (!full.error) {
    return { rows: (full.data ?? []) as MenuItemAvailability[], error: null };
  }

  const missingColumn = isMissingColumnError(full.error);

  if (missingColumn) {
    const base = await supabase
      .from("menu_items")
      .select("id, name, description, price, image_url, prep_time, available")
      .in("id", ids);
    if (!base.error) {
      return {
        rows: (base.data ?? []) as MenuItemAvailability[],
        error: null,
      };
    }
  }

  return { rows: [], error: full.error };
}

export default function CustomerCartPage() {
  const { session } = useAuth();
  const router = useRouter();

  const [status, setStatus] = useState<CartStatus>("loading");
  const [lines, setLines] = useState<CheckoutLine[]>([]);
  const [orderType, setOrderTypeState] = useState<"dine_in" | "takeout">(
    () => readOrderType(),
  );
  const [pickupMode, setPickupMode] = useState<"asap" | "scheduled">("asap");
  const [pickupDate, setPickupDate] = useState<string>(() => initialDate());
  const [pickupTime, setPickupTime] = useState<string>(() => "12:00");
  const [specialInstructions, setSpecialInstructions] = useState(
    () => readSpecialInstructions(),
  );

  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);

  const [removing, setRemoving] = useState<CheckoutLine | null>(null);
  const [undoEntry, setUndoEntry] = useState<{
    line: CheckoutLine;
    index: number;
  } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  const [reviewOpen, setReviewOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const [customer, setCustomer] = useState<LoyaltyCustomer | null>(null);
  const [tableNumber, setTableNumber] = useState<number | null>(null);
  const [previousOrders, setPreviousOrders] = useState<OrderWithDetails[]>([]);
  /** True when the menu lookup failed but stored cart data is still shown. */
  const [menuStale, setMenuStale] = useState(false);

  const cartDbOkRef = useRef(false);
  const syncTimer = useRef<number | null>(null);

  // ------------------------------------------------------------------ totals
  // Every money value comes from the shared pricing rules
  // (`lib/utils/order-calculations`) so the checkout summary, the review
  // modal, and the order payload sent to the database can never disagree.
  const promoDiscount = appliedPromo?.calculated ?? 0;
  const totals = useMemo(
    () =>
      calculateOrderTotals(
        lines.map((line) => ({ price: line.price, quantity: line.quantity })),
        { orderType, discount: promoDiscount },
      ),
    [lines, orderType, promoDiscount],
  );
  const {
    subtotal,
    serviceCharge,
    vat,
    discount: discountAmount,
    total,
  } = totals;
  const itemCount = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity, 0),
    [lines],
  );
// ---------------------------------------------------------------- db sync
  const upsertCart = useCallback(
    async (slim: CartLine[], ownerId: string) => {
      if (slim.length === 0) {
        await supabase.from("cart_items").delete().eq("user_id", ownerId);
        return;
      }
      const rows = slim.map((line) => ({
        user_id: ownerId,
        menu_item_id: line.menu_item_id,
        quantity: line.quantity,
        customizations: line.customizations ?? [],
        notes: line.notes ?? null,
      }));
      await supabase
        .from("cart_items")
        .upsert(rows, { onConflict: "user_id,menu_item_id" });
    },
    [],
  );

  const scheduleDbSync = useCallback(
    (slim: CartLine[]) => {
      const ownerId = session?.user?.id;
      if (!ownerId || !cartDbOkRef.current) return;
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => {
        void upsertCart(slim, ownerId);
      }, 300);
    },
    [session?.user?.id, upsertCart],
  );

  // ---------------------------------------------------------------- loading
  const load = useCallback(async () => {
    setStatus("loading");
    const ownerId = session?.user?.id ?? null;
    const local = readCart();

    // Load the database cart first so the menu lookup below covers every item
    // (including rows added from another device).
    let dbCartRows: CartItemRow[] = [];
    let dbCartOk = false;
    if (ownerId) {
      const cartResult = await supabase
        .from("cart_items")
        .select("menu_item_id, quantity, customizations, notes")
        .eq("user_id", ownerId);
      if (!cartResult.error) {
        dbCartOk = true;
        dbCartRows = (cartResult.data ?? []) as CartItemRow[];
      }
    }

    const ids = [
      ...new Set([
        ...local.map((line) => line.menu_item_id).filter(isUuid),
        ...dbCartRows.map((row) => row.menu_item_id).filter(isUuid),
      ]),
    ];

    const menuRecords = new Map<string, MenuItemAvailability>();
    let menuLookupFailed = false;
    if (ids.length > 0) {
      const menuResult = await loadMenuRows(ids);
      if (menuResult.error) {
        // The menu service is unreachable (or blocked) but the customer has
        // cart items. Degrade to the stored names/prices instead of showing a
        // dead-end error screen — the cart stays usable and a soft warning
        // banner explains what happened.
        const hasUsableLocal = local.length > 0;
        if (!hasUsableLocal) {
          setStatus("error");
          return;
        }
        menuLookupFailed = true;
      } else {
        for (const row of menuResult.rows) {
          menuRecords.set(row.id, {
            id: row.id,
            name: row.name,
            description: row.description,
            price: row.price,
            image_url: row.image_url,
            prep_time: row.prep_time,
            available: row.available,
            stock: row.stock ?? null,
          });
        }
      }
    }
    setMenuStale(menuLookupFailed);

    let currentCustomer: LoyaltyCustomer | null = null;
    let reservedTable: number | null = null;
    let pastOrders: OrderWithDetails[] = [];

    if (ownerId) {
      const customerResult = await supabase
        .from("customers")
        .select("id, name, phone, email, loyalty_points, member_tier")
        .eq("user_id", ownerId)
        .maybeSingle();

      if (!customerResult.error && customerResult.data) {
        currentCustomer = customerResult.data as LoyaltyCustomer;

        const [reservationResult, ordersResult] = await Promise.all([
          supabase
            .from("reservations")
            .select("restaurant_tables(table_number)")
            .eq("phone", currentCustomer.phone)
            .in("status", ["confirmed", "seated"])
            .order("reserved_from", { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from("orders")
            .select("*, order_items(*)")
            .eq("customer_id", currentCustomer.id)
            .order("created_at", { ascending: false })
            .limit(5),
        ]);

        const tableRow = reservationResult.data as {
          restaurant_tables: { table_number: number } | null;
        } | null;
        reservedTable = tableRow?.restaurant_tables?.table_number ?? null;
        pastOrders = (ordersResult.data as OrderWithDetails[]) ?? [];
      } else {
        // Migration may not be applied yet — fall back to the base columns.
        const fallback = await supabase
          .from("customers")
          .select("id, name, phone, email")
          .eq("user_id", ownerId)
          .maybeSingle();
        if (!fallback.error && fallback.data) {
          currentCustomer = fallback.data as LoyaltyCustomer;
          const reservationResult = await supabase
            .from("reservations")
            .select("restaurant_tables(table_number)")
            .eq("phone", fallback.data.phone)
            .in("status", ["confirmed", "seated"])
            .order("reserved_from", { ascending: false })
            .limit(1)
            .maybeSingle();
          const tableRow = reservationResult.data as {
            restaurant_tables: { table_number: number } | null;
          } | null;
          reservedTable = tableRow?.restaurant_tables?.table_number ?? null;
        }
      }
    }

    if (!menuLookupFailed && menuRecords.size < ids.length) {
      // Items that were deleted after being added are treated as unavailable.
      ids
        .filter((id) => !menuRecords.has(id))
        .forEach((id) => {
          const carried = local.find((line) => line.menu_item_id === id);
          menuRecords.set(id, {
            id,
            name: carried?.name || "Item",
            description: null,
            price: carried?.price || 0,
            image_url: null,
            prep_time: 15,
            available: false,
            stock: null,
          });
        });
    }

    // Merge localStorage cart with the database cart (auth-only).
    const merged: CartLine[] = local.map((line) => ({ ...line }));
    for (const row of dbCartRows) {
      const found = merged.find(
        (entry) => entry.menu_item_id === row.menu_item_id,
      );
      if (found) {
        found.quantity = Math.max(found.quantity, row.quantity);
      } else {
        merged.push({
          menu_item_id: row.menu_item_id,
          name: menuRecords.get(row.menu_item_id)?.name || "Item",
          price: Number(menuRecords.get(row.menu_item_id)?.price || 0),
          quantity: row.quantity,
          notes: row.notes ?? undefined,
          customizations: (row.customizations as string[]) ?? undefined,
        });
      }
    }

    const hydrated: CheckoutLine[] = merged.map((line) => {
      const menu = menuRecords.get(line.menu_item_id);
      // When the menu lookup failed we trust the stored line data: items stay
      // marked available, prices stay as saved, and no stock checks run.
      const isAvailable = menuLookupFailed
        ? true
        : menu
          ? menu.available
          : false;
      let quantity = line.quantity;
      let stockNotice = false;
      if (!menuLookupFailed && menu && menu.stock != null) {
        if (quantity > menu.stock) {
          quantity = menu.stock;
          stockNotice = true;
        }
      }
      return {
        menu_item_id: line.menu_item_id,
        name: menu?.name ?? line.name,
        description: menu?.description ?? null,
        image_url: menu?.image_url ?? null,
        price: menu ? Number(menu.price) : line.price,
        storedPrice: line.storedPrice ?? line.price,
        quantity,
        notes: line.notes,
        customizations: line.customizations,
        available: isAvailable,
        stock: menuLookupFailed ? null : (menu?.stock ?? null),
        stockNotice,
      };
    });

    setLines(hydrated);
    setCustomer(currentCustomer);
    setTableNumber(reservedTable);
    setPreviousOrders(
      pastOrders.filter((order) => (order.order_items?.length ?? 0) > 0).slice(0, 2),
    );
    cartDbOkRef.current = dbCartOk;
    setStatus("ready");

    const slim = hydrated.map(toSlimLine);
    writeCart(slim);
    if (dbCartOk && ownerId) {
      void upsertCart(slim, ownerId);
    }
  }, [session?.user?.id, upsertCart]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Ask before leaving when the cart still has items.
  useEffect(() => {
    if (lines.length === 0) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [lines.length]);

  // Close modals with Escape.
  useEffect(() => {
    if (!removing && !reviewOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (removing) setRemoving(null);
        if (reviewOpen) setReviewOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [removing, reviewOpen]);

  // Auto-dismiss the undo toast after 3 seconds.
  useEffect(() => {
    if (!undoEntry) return;
    const timer = window.setTimeout(() => {
      setUndoEntry(null);
      setToast(null);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [undoEntry]);
// -------------------------------------------------------------- mutations
  const commit = useCallback(
    (nextLines: CheckoutLine[], announceText?: string) => {
      setLines(nextLines);
      const slim = nextLines.map(toSlimLine);
      writeCart(slim);
      scheduleDbSync(slim);
      if (announceText) setAnnounce(announceText);
    },
    [scheduleDbSync],
  );

  const updateQty = (line: CheckoutLine, delta: number) => {
    const nextQuantity = line.quantity + delta;
    if (nextQuantity < 1) return;
    if (line.stock != null && nextQuantity > line.stock) return;
    const nextLines = lines.map((entry) =>
      entry.menu_item_id === line.menu_item_id
        ? {
            ...entry,
            quantity: nextQuantity,
            stockNotice: line.stock != null && nextQuantity >= line.stock,
          }
        : entry,
    );
    commit(
      nextLines,
      `${line.name} quantity ${nextQuantity}`,
    );
  };

  const requestRemove = (line: CheckoutLine) => {
    setRemoving(line);
  };

  const confirmRemove = () => {
    if (!removing) return;
    const target = removing;
    const index = lines.findIndex(
      (entry) => entry.menu_item_id === target.menu_item_id,
    );
    setRemoving(null);
    if (index === -1) return;

    const nextLines = lines.filter(
      (entry) => entry.menu_item_id !== target.menu_item_id,
    );
    commit(nextLines, `${target.name} removed from your cart`);
    setToast(`Removed ${target.name}`);
    setUndoEntry({ line: target, index });

    // Remove the row from the database cart as well (best effort).
    const ownerId = session?.user?.id;
    if (ownerId && cartDbOkRef.current) {
      void supabase
        .from("cart_items")
        .delete()
        .eq("user_id", ownerId)
        .eq("menu_item_id", target.menu_item_id);
    }
    // Removed items change the totals instantly — clear any no-longer-valid promo.
    const newSubtotal = nextLines.reduce(
      (sum, entry) => sum + entry.price * entry.quantity,
      0,
    );
    if (
      appliedPromo &&
      newSubtotal < appliedPromo.min_subtotal
    ) {
      setAppliedPromo(null);
    }
  };

  const undoRemove = () => {
    if (!undoEntry) return;
    const nextLines = [...lines];
    nextLines.splice(
      Math.min(undoEntry.index, nextLines.length),
      0,
      undoEntry.line,
    );
    commit(nextLines, `${undoEntry.line.name} restored to your cart`);
    setUndoEntry(null);
    setToast(null);
  };

  const acceptPrice = (line: CheckoutLine) => {
    const nextLines = lines.map((entry) =>
      entry.menu_item_id === line.menu_item_id
        ? { ...entry, storedPrice: entry.price }
        : entry,
    );
    commit(nextLines, `Price accepted for ${line.name}`);
  };

  const switchOrderType = (type: "dine_in" | "takeout") => {
    setOrderTypeState(type);
    writeOrderType(type);
    setAnnounce(
      type === "dine_in"
        ? "Order type set to dine-in"
        : "Order type set to takeout",
    );
  };

  const handleInstructions = (value: string) => {
    const limited = value.slice(0, 200);
    setSpecialInstructions(limited);
    writeSpecialInstructions(limited);
  };

// ------------------------------------------------------------- reorder
  const addPreviousOrder = async (order: OrderWithDetails) => {
    const items = order.order_items ?? [];
    if (items.length === 0) return;

    const ids = [
      ...new Set(items.map((item) => item.menu_item_id).filter(Boolean)),
    ];
    const { data: rows } = await supabase
      .from("menu_items")
      .select("id, available")
      .in("id", ids);
    const menuRows = (rows ?? []) as { id: string; available: boolean }[];

    const unavailable = new Set<string>();
    menuRows.forEach((row) => {
      if (!row.available) unavailable.add(row.id);
    });
    // Items that are no longer on the menu at all are unavailable too.
    ids.forEach((id) => {
      if (!menuRows.some((row) => row.id === id)) unavailable.add(id);
    });

    const nextLines = [...lines];
    let added = 0;
    for (const item of items) {
      if (unavailable.has(item.menu_item_id)) continue;
      const found = nextLines.find(
        (entry) => entry.menu_item_id === item.menu_item_id,
      );
      if (found) {
        found.quantity += item.quantity;
      } else {
        nextLines.push({
          menu_item_id: item.menu_item_id,
          name: item.menu_item_name,
          description: null,
          image_url: null,
          price: Number(item.unit_price),
          storedPrice: Number(item.unit_price),
          quantity: item.quantity,
          available: true,
          stock: null,
        });
      }
      added += 1;
    }

    if (added > 0) {
      commit(
        nextLines,
        `Added ${added} item${added === 1 ? "" : "s"} from Order #${order.order_number}`,
      );
      setToast(`Added from Order #${order.order_number}`);
    } else {
      setToast("No items from that order are available right now.");
    }
  };

  // ------------------------------------------------------------- checkout
  const openReview = () => {
    if (lines.length === 0) return;
    if (lines.some((line) => !line.available)) {
      setSubmitError(
        "Some items in your cart are no longer available. Remove them to continue.",
      );
      return;
    }
    if (
      INAPPROPRIATE_PATTERN.test(specialInstructions) ||
      specialInstructions.length > 200
    ) {
      setSubmitError(
        "Please adjust your special instructions before continuing.",
      );
      return;
    }
    setSubmitError(null);
    setReviewOpen(true);
  };

  const proceedToPayment = async () => {
    if (lines.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);

    // Checkout phase currently running — merged into the failure log so even
    // an error that serializes as `{}` still tells the next developer where
    // order placement stopped.
    let stage = "validate cart";

    try {
      const unavailable = lines.some((line) => !line.available);
      if (unavailable) {
        setSubmitError(
          "Some items in your cart are no longer available. Remove them to continue.",
        );
        setSubmitting(false);
        return;
      }

      // Recompute from the current cart with the shared pricing rules and make
      // sure the result still matches the total shown in the review modal.
      // This guards against stale prices, quantities, or promo changes so the
      // order written to the database is exactly what the customer reviewed.
      stage = "price order";
      const submitTotals = calculateOrderTotals(
        lines.map((line) => ({ price: line.price, quantity: line.quantity })),
        { orderType, discount: promoDiscount },
      );
      if (!orderTotalsMatch(submitTotals, totals)) {
        setSubmitError(
          "Your order total has changed. Please review the updated total and try again.",
        );
        setSubmitting(false);
        return;
      }

      stage = "create order";
      const requestedAt =
        orderType === "takeout" && pickupMode === "scheduled"
          ? new Date(`${pickupDate}T${pickupTime}:00`).toISOString()
          : null;

      // Generate the order id up front so the insert does not depend on a
      // RETURNING/SELECT round-trip: `orders_select_self` hides rows until
      // customer_id is linked, which would make `.single()` fail (PGRST116)
      // even though the order had been created.
      const orderId = crypto.randomUUID();

      // Money columns always exist; `special_instructions`, `promo_code`, and
      // `requested_at` ship with migration 20260914000000.
      const baseOrderPayload = {
        id: orderId,
        order_number: Math.floor(Date.now() % 900000) + 100000,
        type: orderType,
        table_id: null,
        customer_id: customer?.id ?? null,
        // Direct link to the signed-in user (migration 20260916000000) so the
        // order is always retrievable in "My Orders" even before/without a
        // linked customers row.
        user_id: session?.user?.id ?? null,
        status: "queued",
        subtotal: submitTotals.subtotal,
        service_charge: submitTotals.serviceCharge,
        tax: submitTotals.vat,
        discount: submitTotals.discount,
        total: submitTotals.total,
      };

      let orderError = (
        await supabase.from("orders").insert({
          ...baseOrderPayload,
          special_instructions: specialInstructions.trim() || null,
          promo_code: appliedPromo?.code ?? null,
          requested_at: requestedAt,
        })
      ).error;

      if (orderError && isMissingColumnError(orderError)) {
        // The connected database is missing one of the checkout/user columns
        // (special_instructions/promo_code/requested_at from 20260914000000, or
        // user_id from 20260916000000). Retry with just the always-present base
        // money columns so the order still goes through.
        console.warn(
          "orders is missing a newer column; saving the order with the base columns only.",
          orderError.message,
        );
        const { user_id: _user_id, ...coreOrderPayload } = baseOrderPayload;
        void _user_id; // user_id is intentionally dropped from the fallback insert.
        orderError = (await supabase.from("orders").insert(coreOrderPayload))
          .error;
      }

      if (orderError) throw orderError;

      stage = "create order items";
      const orderItems = lines.map((line) => ({
        order_id: orderId,
        menu_item_id: line.menu_item_id,
        menu_item_name: line.name,
        quantity: line.quantity,
        unit_price: line.price,
        line_total: lineTotal(line),
      }));

      const { error: itemError } = await supabase
        .from("order_items")
        .insert(orderItems);
      if (itemError) throw itemError;

      stage = "finalize checkout";

      // Consume one promo use (best effort, never fails the checkout).
      if (appliedPromo) {
        await supabase
          .from("promo_codes")
          .update({ used_count: appliedPromo.used_count + 1 })
          .eq("id", appliedPromo.id);
      }

      // The order is committed — clear the cart and confirm.
      clearCart();
      const ownerId = session?.user?.id;
      if (ownerId && cartDbOkRef.current) {
        try {
          await supabase
            .from("cart_items")
            .delete()
            .eq("user_id", ownerId);
        } catch {
          // Best effort — the order is already committed.
        }
      }
      setLines([]);
      setAppliedPromo(null);
      setReviewOpen(false);
      router.push(`/order-confirmation/${orderId}`);
    } catch (error) {
      // Keep the same user-facing message, but leave a diagnosable trace for
      // whoever is debugging an order-placement failure: which checkout phase
      // failed plus a JSON-safe snapshot of the error (raw Error properties
      // are non-enumerable and can otherwise serialize as an empty `{}`).
      console.error("Failed to place order:", {
        stage,
        ...describeThrownError(error),
      });
      setSubmitError(
        "Unable to place your order right now. Please try again.",
      );
      setSubmitting(false);
    }
  };
// ---------------------------------------------------------------- render
  const markImageError = (id: string) => {
    setLines((prev) =>
      prev.map((line) =>
        line.menu_item_id === id ? { ...line, imageError: true } : line,
      ),
    );
  };

  const renderCheckoutButton = (variant: "desktop" | "mobile") => (
    <button
      type="button"
      className={`cart-checkout-btn${
        variant === "mobile" ? " cart-checkout-btn-mobile" : ""
      }`}
      onClick={openReview}
      disabled={lines.length === 0 || submitting}
    >
      {submitting ? (
        <Loader2 className="cart-spin" aria-hidden="true" />
      ) : (
        <Lock size={17} aria-hidden="true" />
      )}
      <span className="cart-checkout-label">
        {submitting ? "Placing order…" : "Checkout"}
      </span>
      <span className="cart-checkout-amount">{formatP(total)}</span>
    </button>
  );

  return (
    <RoleGuard allow={["user"]} redirect="/dashboard">
      <div className="cart-page">
        <header className="cart-header">
          <div className="cart-header-copy">
            <p className="cart-eyebrow">Your cart</p>
            <div className="cart-title-row">
              <h1 className="cart-title">Ready to order</h1>
              {itemCount > 0 && (
                <span
                  className="cart-count-badge"
                  aria-label={`${itemCount} ${
                    itemCount === 1 ? "item" : "items"
                  } in your cart`}
                >
                  {itemCount} {itemCount === 1 ? "item" : "items"}
                </span>
              )}
            </div>
          </div>
          <Link
            href="/menu"
            className="cart-back-link"
            aria-label="Continue shopping"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Continue shopping
          </Link>
        </header>

        {/* Screen-reader announcements for cart changes */}
        <p className="cart-sr-only" aria-live="polite">
          {announce}
        </p>

        {status === "loading" && <CartSkeleton />}

        {status === "error" && (
          <div className="cart-state" role="alert">
            <span className="cart-state-icon cart-state-error">
              <AlertCircle size={32} aria-hidden="true" />
            </span>
            <p className="cart-eyebrow">Something went wrong</p>
            <h2 className="cart-state-title">Unable to load your cart</h2>
            <p className="cart-state-text">Please try refreshing the page.</p>
            <button
              type="button"
              className="cart-browse-btn"
              onClick={() => void load()}
            >
              <RotateCcw size={16} aria-hidden="true" /> Try again
            </button>
          </div>
        )}

        {status === "ready" && lines.length === 0 && (
          <div className="cart-state">
            <span className="cart-state-icon">
              <ShoppingBag size={32} aria-hidden="true" />
            </span>
            <p className="cart-eyebrow">Your cart is empty</p>
            <h2 className="cart-state-title">
              Looks like you haven&apos;t added anything yet.
            </h2>
            <p className="cart-state-text">
              Browse our menu and add items to get started.
            </p>
            <Link href="/menu" className="cart-browse-btn">
              Browse menu
              <ChevronRight size={16} aria-hidden="true" />
            </Link>
            <p className="cart-empty-disabled" aria-hidden="true">
              <Lock size={13} /> Add items to order
            </p>
          </div>
        )}

        {status === "ready" && lines.length > 0 && (
          <>
            <div className="cart-layout">
              <div className="cart-main">
                {/* ---------------------------------------------- items */}
                <section
                  className="cart-panel"
                  aria-labelledby="cart-items-heading"
                >
                  <div className="cart-panel-head">
                    <h2 id="cart-items-heading" className="cart-panel-title">
                      Selected items
                    </h2>
                    <span className="cart-panel-note">
                      {lines.length} {lines.length === 1 ? "item" : "items"}
                    </span>
                  </div>
                  {menuStale && (
                    <div className="cart-stale-banner" role="status">
                      <AlertTriangle size={15} aria-hidden="true" />
                      <p>
                        Couldn&apos;t verify the latest menu. Showing your
                        saved items — prices may be out of date.
                      </p>
                      <button
                        type="button"
                        className="cart-stale-retry"
                        onClick={() => void load()}
                      >
                        Retry
                      </button>
                    </div>
                  )}
                  <div className="cart-item-list">
                    {lines.map((line) => {
                      const priceChanged =
                        line.storedPrice > 0 && line.price !== line.storedPrice;
                      return (
                        <div key={line.menu_item_id} className="cart-item">
                          <div className="cart-item-thumb">
                            {line.image_url && !line.imageError ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={line.image_url}
                                alt=""
                                loading="lazy"
                                onError={() => markImageError(line.menu_item_id)}
                              />
                            ) : (
                              <span
                                className="cart-item-fallback"
                                aria-hidden="true"
                              >
                                <Utensils size={18} />
                              </span>
                            )}
                          </div>
<div className="cart-item-main">
                            <div className="cart-item-info">
                              <h3 className="cart-item-name">{line.name}</h3>
                              {line.description && (
                                <p className="cart-item-desc">
                                  {line.description}
                                </p>
                              )}
                              <p className="cart-item-unit">
                                {formatP(line.price)} each
                              </p>
                              {line.customizations &&
                                line.customizations.length > 0 && (
                                  <div className="cart-item-chips">
                                    {(line.customizations ?? []).map(
                                      (customization) => (
                                        <span
                                          key={customization}
                                          className="cart-item-chip"
                                        >
                                          {customization}
                                        </span>
                                      ),
                                    )}
                                  </div>
                                )}
                              {line.notes && (
                                <p className="cart-item-notes">{line.notes}</p>
                              )}
                              {priceChanged && (
                                <div
                                  className="cart-price-notice"
                                  role="status"
                                >
                                  <AlertTriangle size={14} aria-hidden="true" />
                                  <span>
                                    Price updated for {line.name}:{" "}
                                    <s>{formatP(line.storedPrice)}</s>{" "}
                                    <strong>{formatP(line.price)}</strong>
                                  </span>
                                  <button
                                    type="button"
                                    className="cart-link-btn"
                                    onClick={() => acceptPrice(line)}
                                  >
                                    Accept new price
                                  </button>
                                </div>
                              )}
                            </div>

                            <div className="cart-item-actions">
<div className="cart-qty"
                                aria-label={`Quantity of ${line.name} is ${line.quantity}`}
                              >
                                <button
                                  type="button"
                                  className="cart-qty-btn"
                                  onClick={() => updateQty(line, -1)}
                                  disabled={line.quantity <= 1}
                                  aria-label={`Decrease quantity of ${line.name}`}
                                >
                                  <Minus size={16} aria-hidden="true" />
                                </button>
                                <span className="cart-qty-value">
                                  {line.quantity}
                                </span>
                                <button
                                  type="button"
                                  className="cart-qty-btn"
                                  onClick={() => updateQty(line, 1)}
                                  disabled={
                                    line.stock != null &&
                                    line.quantity >= line.stock
                                  }
                                  aria-label={`Increase quantity of ${line.name}`}
                                >
                                  <Plus size={16} aria-hidden="true" />
                                </button>
                              </div>
                              <button
                                type="button"
                                className="cart-remove-btn"
                                onClick={() => requestRemove(line)}
                                aria-label={`Remove ${line.name} from cart`}
                                title="Remove item"
                              >
                                <Trash2 size={16} aria-hidden="true" />
                              </button>
                            </div>
                          </div>
<div className="cart-line-total">
                            <span className="cart-line-total-label">
                              Line total
                            </span>
                            <strong>
                              {formatP(lineTotal(line))}
                            </strong>
                          </div>

                          {!line.available && (
                            <div className="cart-item-warning" role="alert">
                              <AlertCircle size={14} aria-hidden="true" />
                              <span>
                                <strong>{line.name}</strong> is currently
                                unavailable
                              </span>
                              <button
                                type="button"
                                className="cart-link-btn"
                                onClick={() => requestRemove(line)}
                              >
                                Remove item
                              </button>
                              <Link
                                href="/"
                                className="cart-link-btn cart-link-btn-ghost"
                              >
                                Contact us
                              </Link>
                            </div>
                          )}

                          {line.stockNotice && line.stock != null && (
                            <div className="cart-item-warning" role="status">
                              <AlertTriangle size={14} aria-hidden="true" />
                              <span>
                                Only <strong>{line.stock}</strong> items
                                available — quantity adjusted
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
{/* ---------------------------------------------- order type */}
                <section
                  className="cart-panel"
                  aria-labelledby="order-type-heading"
                >
                  <div className="cart-panel-head">
                    <h2 id="order-type-heading" className="cart-panel-title">
                      Order type
                    </h2>
                  </div>
                  <div
                    className="cart-select-grid"
                    role="radiogroup"
                    aria-label="Order type"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={orderType === "dine_in"}
                      className={`cart-select-card${
                        orderType === "dine_in" ? " selected" : ""
                      }`}
                      onClick={() => switchOrderType("dine_in")}
                    >
                      <span className="cart-select-icon">
                        <Utensils size={20} aria-hidden="true" />
                      </span>
                      <span className="cart-select-copy">
                        <strong>Dine-in</strong>
                        <small>Enjoy your meal at our restaurant</small>
                      </span>
                      <span className="cart-select-check" aria-hidden="true">
                        {orderType === "dine_in" && <Check size={14} />}
                      </span>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={orderType === "takeout"}
                      className={`cart-select-card${
                        orderType === "takeout" ? " selected" : ""
                      }`}
                      onClick={() => switchOrderType("takeout")}
                    >
                      <span className="cart-select-icon">
                        <Package size={20} aria-hidden="true" />
                      </span>
                      <span className="cart-select-copy">
                        <strong>Takeout</strong>
                        <small>Pick up your order</small>
                      </span>
                      <span className="cart-select-check" aria-hidden="true">
                        {orderType === "takeout" && <Check size={14} />}
                      </span>
                    </button>
                  </div>
{orderType === "dine_in" ? (
                    <div className="cart-service-note">
                      <Clock size={16} aria-hidden="true" />
                      <span>Table service — your order will be brought to you.</span>
                      {tableNumber && (
                        <strong className="cart-service-table">
                          Reserved · Table {tableNumber}
                        </strong>
                      )}
                    </div>
                  ) : (
                    <div className="cart-timing">
                      <p className="cart-timing-label">
                        When do you want your order?
                      </p>
                      <div
                        className="cart-timing-options"
                        role="radiogroup"
                        aria-label="Pickup time"
                      >
                        <button
                          type="button"
                          role="radio"
                          aria-checked={pickupMode === "asap"}
                          className={`cart-timing-option${
                            pickupMode === "asap" ? " selected" : ""
                          }`}
                          onClick={() => setPickupMode("asap")}
                        >
                          <strong>ASAP</strong>
                          <small>Ready in 25–35 minutes</small>
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={pickupMode === "scheduled"}
                          className={`cart-timing-option${
                            pickupMode === "scheduled" ? " selected" : ""
                          }`}
                          onClick={() => setPickupMode("scheduled")}
                        >
                          <strong>Schedule for later</strong>
                          <small>Pick a date and time</small>
                        </button>
                      </div>
                      {pickupMode === "scheduled" && (
                        <div className="cart-schedule">
                          <label className="cart-schedule-field">
                            <span>Pickup date</span>
                            <input
                              type="date"
                              value={pickupDate}
                              min={new Date().toISOString().slice(0, 10)}
                              onChange={(event) =>
                                setPickupDate(event.target.value)
                              }
                              aria-label="Pickup date"
                            />
                          </label>
                          <label className="cart-schedule-field">
                            <span>Pickup time</span>
                            <select
                              value={pickupTime}
                              onChange={(event) =>
                                setPickupTime(event.target.value)
                              }
                              aria-label="Pickup time"
                            >
                              {PICKUP_TIMES.map((slot) => (
                                <option key={slot} value={slot}>
{slot}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </section>
{/* ----------------------------------------- special instructions */}
                <section
                  className="cart-panel"
                  aria-labelledby="special-heading"
                >
                  <div className="cart-panel-head">
                    <h2 id="special-heading" className="cart-panel-title">
                      Special requests
                    </h2>
                  </div>
                  <label
                    className="cart-sr-only"
                    htmlFor="cart-special-instructions"
                  >
                    Special instructions for the kitchen
                  </label>
                  <textarea
                    id="cart-special-instructions"
                    className="cart-textarea"
                    rows={4}
                    maxLength={200}
                    value={specialInstructions}
                    onChange={(event) =>
                      handleInstructions(event.target.value)
                    }
                    placeholder="Add any special instructions for the kitchen (allergies, preferences, etc.)"
                  />
                  <div className="cart-char-count" aria-live="polite">
                    {specialInstructions.length}/200
                  </div>
                </section>

                {/* ------------------------------------------- reorder */}
                {previousOrders.length > 0 && (
                  <section
                    className="cart-panel"
                    aria-labelledby="reorder-heading"
                  >
                    <div className="cart-panel-head">
                      <h2 id="reorder-heading" className="cart-panel-title">
                        Reorder favorites
                      </h2>
                    </div>
                    <div className="cart-reorder-list">
                      {previousOrders.map((order) => {
                        const items = (order.order_items ?? []).slice(0, 2);
                        const remaining =
                          (order.order_items?.length ?? 0) - items.length;
                        const summary = items
                          .map(
                            (item) =>
                              `${item.menu_item_name}${
                                item.quantity > 1 ? ` × ${item.quantity}` : ""
                              }`,
                          )
                          .join(", ");
                        return (
                          <div key={order.id} className="cart-reorder-item">
                            <span className="cart-reorder-icon" aria-hidden="true">
                              <RotateCcw size={16} />
                            </span>
                            <div className="cart-reorder-copy">
                              <strong>Order #{order.order_number}</strong>
                              <small>
                                {summary}
                                {remaining > 0 ? ` +${remaining} more` : ""}
                              </small>
                            </div>
                            <button
                              type="button"
                              className="cart-reorder-btn"
                              onClick={() => void addPreviousOrder(order)}
                            >
                              Add to cart
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}
              </div>

              <aside className="cart-side">
{/* -------------------------------------------------- summary */}
                <section
                  className="cart-panel cart-summary-panel"
                  aria-labelledby="summary-heading"
                >
                  <div className="cart-panel-head">
                    <h2 id="summary-heading" className="cart-panel-title">
                      Order summary
                    </h2>
                  </div>
                  <div className="cart-summary-rows">
                    <div className="cart-summary-row">
                      <span>
                        Subtotal ({itemCount}{" "}
                        {itemCount === 1 ? "item" : "items"})
                      </span>
                      <strong>{formatP(subtotal)}</strong>
                    </div>

                    {appliedPromo && discountAmount > 0 && (
                      <div className="cart-summary-row cart-discount">
                        <span>
                          {appliedPromo.description ||
                            `${appliedPromo.code} discount`}
                        </span>
                        <strong>−{formatP(discountAmount)}</strong>
                      </div>
                    )}

                    <div className="cart-summary-row">
                      <span className="cart-row-label">
                        Service Charge ({Math.round(SERVICE_CHARGE_RATE * 100)}%)
                        <span
                          className="cart-info-tip"
                          tabIndex={0}
                          role="button"
                          aria-label="About the service charge"
                          data-tip="A 10% service charge is added to dine-in orders and shared with our team. Takeout orders are not charged."
                        >
                          <Info size={14} aria-hidden="true" />
                        </span>
                      </span>
                      <strong>
                        {orderType === "dine_in"
                          ? formatP(serviceCharge)
                          : "—"}
                      </strong>
                    </div>

                    <div className="cart-summary-row">
                      <span className="cart-row-label">
                        VAT ({Math.round(VAT_RATE * 100)}%)
                        <span
                          className="cart-info-tip"
                          tabIndex={0}
                          role="button"
                          aria-label="About value-added tax"
                          data-tip="Value-added tax is computed on the total including the service charge, as required by Philippine law."
                        >
                          <Info size={14} aria-hidden="true" />
                        </span>
                      </span>
                      <strong>{formatP(vat)}</strong>
                    </div>
                  </div>

                  <div className="cart-summary-legal">
                    VAT is included as required by law.
                  </div>

                  <div className="cart-summary-divider" />

                  <div className="cart-summary-total">
                    <span>Total</span>
                    <strong className="cart-total-amount">
                      {formatP(total)}
                    </strong>
                  </div>

                  {discountAmount > 0 && (
                    <p className="cart-saved">
                      <Star size={13} aria-hidden="true" />
                      You saved {formatP(discountAmount)}
                    </p>
                  )}
                </section>
{/* ------------------------------------------------ estimate */}
                <section
                  className="cart-estimate"
                  aria-labelledby="estimate-heading"
                >
                  <div className="cart-estimate-row">
                    <Clock size={18} aria-hidden="true" />
                    <div>
                      <p className="cart-eyebrow" id="estimate-heading">
                        Estimated time
                      </p>
                      <p className="cart-estimate-value">
                        {orderType === "dine_in"
                          ? "Ready in 20–30 minutes"
                          : pickupMode === "asap"
                            ? "Pickup ready in 25–35 minutes"
                            : `Pickup at ${new Date(
                                `${pickupDate}T00:00:00`,
                              ).toLocaleDateString("en-US", {
                                weekday: "short",
                                month: "short",
                                day: "numeric",
                              })} · ${pickupTime}`}
                      </p>
                    </div>
                  </div>
                </section>

                {/* Desktop checkout CTA */}
                <div className="cart-desktop-cta">
                  {renderCheckoutButton("desktop")}
                  <p className="cart-secure-note">
                    <Lock size={12} aria-hidden="true" />
                    Secure checkout
                  </p>
                </div>
              </aside>
            </div>

            {/* Mobile sticky checkout bar */}
            <div className="cart-mobile-bar">
              <div className="cart-mobile-total">
                <span>Total</span>
                <strong>{formatP(total)}</strong>
              </div>
              {renderCheckoutButton("mobile")}
            </div>
          </>
        )}
{/* ------------------------------------------- remove confirmation */}
        {removing && (
          <div
            className="cart-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setRemoving(null);
            }}
          >
            <div
              className="cart-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="remove-dialog-title"
            >
              <button
                type="button"
                className="cart-modal-close"
                onClick={() => setRemoving(null)}
                aria-label="Close dialog"
              >
                <X size={18} aria-hidden="true" />
              </button>
              <span className="cart-modal-icon cart-modal-icon-danger">
                <Trash2 size={20} aria-hidden="true" />
              </span>
              <h3 id="remove-dialog-title" className="cart-modal-title">
                Remove {removing.name}?
              </h3>
              <p className="cart-modal-text">
                This item will be removed from your order. You can undo for a
                few seconds afterwards.
              </p>
              <div className="cart-modal-actions">
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setRemoving(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="cart-btn-danger"
                  onClick={confirmRemove}
                >
                  <Trash2 size={15} aria-hidden="true" /> Remove item
                </button>
              </div>
            </div>
          </div>
        )}
{/* ------------------------------------------------- review */}
        {reviewOpen && (
          <div
            className="cart-modal-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setReviewOpen(false);
            }}
          >
            <div
              className="cart-modal cart-review"
              role="dialog"
              aria-modal="true"
              aria-labelledby="review-dialog-title"
            >
              <button
                type="button"
                className="cart-modal-close"
                onClick={() => setReviewOpen(false)}
                aria-label="Close dialog"
              >
                <X size={18} aria-hidden="true" />
              </button>
              <p className="cart-eyebrow">Almost there</p>
<h3 id="review-dialog-title" className="cart-modal-title">
                  Review your order
                </h3>
                <div className="cart-review-list">
                  {lines.map((line) => (
                    <div key={line.menu_item_id} className="cart-review-item">
                      <span className="cart-review-qty">{line.quantity}×</span>
                      <span className="cart-review-name">{line.name}</span>
                      <span className="cart-review-price">
                        {formatP(lineTotal(line))}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="cart-review-meta">
                  <span className="cart-review-mode">
                    {orderType === "dine_in"
                      ? "Dine-in · Table service"
                      : `Takeout · ${
                          pickupMode === "asap"
                            ? "ASAP pickup"
                            : `Pickup ${new Date(
                                `${pickupDate}T00:00:00`,
                              ).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })} · ${pickupTime}`
                        }`}
                  </span>
                  {specialInstructions.trim() && (
                    <span className="cart-review-instructions">
                      <strong>Instructions:</strong> {specialInstructions}
                    </span>
                  )}
                  {appliedPromo && (
                    <span className="cart-review-promo">
                      {appliedPromo.code} · −{formatP(discountAmount)}
                    </span>
                  )}
                </div>
                <div className="cart-summary-divider" />
                <div className="cart-summary-total">
                  <span>Total</span>
                  <strong className="cart-total-amount">
                    {formatP(total)}
                  </strong>
                </div>
                {submitError && (
                  <p className="cart-submit-error" role="alert">
                    <AlertCircle size={14} aria-hidden="true" />
                    {submitError}
                  </p>
                )}
                <div className="cart-modal-actions">
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => setReviewOpen(false)}
                    disabled={submitting}
                  >
                    Edit order
                  </button>
                  <button
                    type="button"
                    className="cart-checkout-btn"
                    onClick={() => void proceedToPayment()}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <Loader2 className="cart-spin" aria-hidden="true" />
                    ) : (
                      <Lock size={16} aria-hidden="true" />
                    )}
                    {submitting ? "Placing order…" : "Proceed to payment"}
                  </button>
                </div>
              </div>
            </div>
          )}
{/* ----------------------------------------------------- toast */}
        {toast && (
          <div className="cart-toast" role="status">
            <span className="cart-toast-text">{toast}</span>
            {undoEntry && (
              <button
                type="button"
                className="cart-toast-undo"
                onClick={undoRemove}
              >
                <RotateCcw size={14} aria-hidden="true" /> Undo
              </button>
            )}
            <button
              type="button"
              className="cart-toast-close"
              onClick={() => {
                setToast(null);
                setUndoEntry(null);
              }}
              aria-label="Dismiss notification"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>
    </RoleGuard>
  );
}

/* ----------------------------------------------------------- skeletons */
function CartSkeleton() {
  return (
    <div className="cart-layout" aria-hidden="true">
      <div className="cart-main">
        <div className="cart-panel">
          <div className="cart-skeleton cart-skeleton-title" />
          <div className="cart-item-list">
            {[0, 1, 2].map((index) => (
              <div key={index} className="cart-item">
                <div className="cart-skeleton cart-skeleton-thumb" />
                <div className="cart-item-main">
                  <div className="cart-skeleton cart-skeleton-line-lg" />
                  <div className="cart-skeleton cart-skeleton-line" />
                  <div className="cart-skeleton cart-skeleton-line short" />
                  <div className="cart-skeleton cart-skeleton-line short" />
                </div>
                <div className="cart-skeleton cart-skeleton-total" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="cart-side">
        <div className="cart-panel">
          <div className="cart-skeleton cart-skeleton-title" />
          <div className="cart-skeleton cart-skeleton-line" />
          <div className="cart-skeleton cart-skeleton-line" />
          <div className="cart-skeleton cart-skeleton-line" />
          <div className="cart-skeleton cart-skeleton-line short" />
          <div className="cart-skeleton cart-skeleton-btn" />
        </div>
      </div>
    </div>
  );
}
