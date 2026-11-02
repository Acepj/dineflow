"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  Fish,
  IceCreamCone,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Soup,
  Trash2,
  Utensils,
  Wine,
  X,
  type LucideIcon,
} from "lucide-react";
import { RoleGuard } from "@/components/auth/role-guard";
import { DashboardBackButton } from "@/components/ui/dashboard-back-button";
import { supabase } from "@/lib/supabase/client";
import type { MenuItemWithCategory } from "@/types/database.types";

const CART_KEY = "dineflow_cart";
const PREVIEW_COUNT = 6;

type CartItem = {
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
};

type MenuCategory = {
  name: string;
  description: string | null;
  sort_order: number;
};

const CATEGORY_META: Record<string, { icon: LucideIcon; subtitle: string }> = {
  "Small Plates": { icon: Utensils, subtitle: "Appetizers and starters" },
  "Signature Rolls": { icon: Fish, subtitle: "Fresh sushi rolls" },
  "Nigiri & Sashimi": { icon: Fish, subtitle: "Fresh cuts on and off the rice" },
  Ramen: { icon: Soup, subtitle: "Slow-brothed noodle bowls" },
  Drinks: { icon: Wine, subtitle: "Sake, tea, and refreshments" },
  Desserts: { icon: IceCreamCone, subtitle: "Sweet finishes" },
};

function formatP(value: number) {
  return (
    "₱" + Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })
  );
}

export default function CustomerMenuPage() {
  const [items, setItems] = useState<MenuItemWithCategory[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [queryInput, setQueryInput] = useState("");
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState<string>("All");
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  const [imgErrors, setImgErrors] = useState<Set<string>>(new Set());
  const [addedId, setAddedId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    const [menuRes, catsRes] = await Promise.all([
      supabase
        .from("menu_items")
        .select("*, categories(name)")
        .eq("available", true)
        .order("name"),
      supabase
        .from("categories")
        .select("name, description, sort_order")
        .eq("active", true)
        .order("sort_order"),
    ]);
    if (menuRes.error || catsRes.error) {
      setLoadError(true);
      setItems([]);
      setCategories([]);
    } else {
      setItems((menuRes.data as MenuItemWithCategory[]) || []);
      setCategories((catsRes.data as MenuCategory[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Initial load reads external systems (Supabase + localStorage).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    setCartItems(
      JSON.parse(localStorage.getItem(CART_KEY) || "[]") as CartItem[],
    );
  }, [load]);

  // Debounce the search input (300ms).
  useEffect(() => {
    const timer = setTimeout(() => setSearch(queryInput.trim().toLowerCase()), 300);
    return () => clearTimeout(timer);
  }, [queryInput]);

  // Close the cart drawer with Escape.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const writeCart = (next: CartItem[]) => {
    setCartItems(next);
    localStorage.setItem(CART_KEY, JSON.stringify(next));
  };

  const cartCount = useMemo(
    () => cartItems.reduce((sum, entry) => sum + entry.quantity, 0),
    [cartItems],
  );

  const cartSubtotal = useMemo(
    () => cartItems.reduce((sum, entry) => sum + entry.price * entry.quantity, 0),
    [cartItems],
  );

  const showToast = (name: string) => {
    setToast(name);
    window.setTimeout(() => setToast((current) => (current === name ? null : current)), 2600);
  };

  const addToCart = (item: MenuItemWithCategory) => {
    const existing = JSON.parse(
      localStorage.getItem(CART_KEY) || "[]",
    ) as CartItem[];
    const found = existing.find((entry) => entry.menu_item_id === item.id);
    const next = found
      ? existing.map((entry) =>
          entry.menu_item_id === item.id
            ? { ...entry, quantity: entry.quantity + 1 }
            : entry,
        )
      : [
          ...existing,
          {
            menu_item_id: item.id,
            name: item.name,
            price: Number(item.price),
            quantity: 1,
          },
        ];
    writeCart(next);
    setAddedId(item.id);
    window.setTimeout(
      () => setAddedId((current) => (current === item.id ? null : current)),
      900,
    );
    showToast(item.name);
  };

  const changeQty = (menuItemId: string, delta: number) => {
    writeCart(
      cartItems
        .map((entry) =>
          entry.menu_item_id === menuItemId
            ? { ...entry, quantity: Math.max(0, entry.quantity + delta) }
            : entry,
        )
        .filter((entry) => entry.quantity > 0),
    );
  };

  const removeItem = (menuItemId: string) => {
    writeCart(cartItems.filter((entry) => entry.menu_item_id !== menuItemId));
  };

  const markImageError = (id: string) => {
    setImgErrors((prev) => new Set(prev).add(id));
  };

  const toggleExpanded = (name: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const filtered = useMemo(() => {
    return items.filter((item) => {
      const cat = item.categories?.name || "";
      if (activeCat !== "All" && cat !== activeCat) return false;
      if (search) {
        const haystack = `${item.name} ${item.description || ""}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [items, activeCat, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, MenuItemWithCategory[]>();
    filtered.forEach((item) => {
      const key = item.categories?.name || "Other";
      map.set(key, [...(map.get(key) || []), item]);
    });
    const ordered = categories
      .map((cat) => [cat.name, map.get(cat.name) || []] as const)
      .filter(([, entries]) => entries.length > 0);
    // Any items under a category not in the active list still render at the end.
    for (const [key, entries] of map.entries()) {
      if (!categories.some((cat) => cat.name === key) && entries.length > 0) {
        ordered.push([key, entries] as const);
      }
    }
    return ordered;
  }, [filtered, categories]);

  const searching = search.length > 0;

  const categoryIcon = (name: string): LucideIcon =>
    CATEGORY_META[name]?.icon || Utensils;

  const categorySubtitle = (name: string): string => {
    const fromDb = categories.find((cat) => cat.name === name)?.description;
    return fromDb || CATEGORY_META[name]?.subtitle || "";
  };

  return (
    <RoleGuard allow={["user"]} redirect="/dashboard">
      <div className="menu-page">
        <DashboardBackButton />
        <div className="page-toolbar">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-[#c6a15b]">
              Customer menu
            </p>
            <h2 className="mt-2 text-3xl font-semibold text-[#ede6d6]">
              Explore the menu
            </h2>
          </div>
          <button
            className="btn-primary"
            onClick={() => setDrawerOpen(true)}
            aria-label={`Open cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}`}
          >
            <ShoppingCart size={16} /> Cart ({cartCount})
          </button>
        </div>

        <div className="menu-controls">
          <div className="menu-search">
            <Search size={16} aria-hidden="true" />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              placeholder="Search menu items…"
              aria-label="Search menu items"
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
          <div className="menu-tabs" role="tablist" aria-label="Menu categories">
            {["All", ...categories.map((cat) => cat.name)].map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={activeCat === name}
                className={activeCat === name ? "menu-tab active" : "menu-tab"}
                onClick={() => setActiveCat(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {loadError ? (
          <div className="menu-state">
            <p className="menu-state-title">
              Unable to load the menu right now.
            </p>
            <button className="btn-primary" onClick={load}>
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="menu-grid" aria-hidden="true">
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className="menu-item-card menu-skeleton-card">
                <div className="menu-skeleton menu-skeleton-img" />
                <div className="menu-item-body">
                  <div className="menu-skeleton menu-skeleton-title" />
                  <div className="menu-skeleton menu-skeleton-line" />
                  <div className="menu-skeleton menu-skeleton-line short" />
                  <div className="menu-skeleton menu-skeleton-row" />
                  <div className="menu-skeleton menu-skeleton-btn" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="menu-state">
            <Search size={28} aria-hidden="true" />
            <p className="menu-state-title">No items match your search</p>
            <p className="menu-state-text">
              Try different keywords or browse all items.
            </p>
            <button
              className="btn-primary"
              onClick={() => {
                setQueryInput("");
                setActiveCat("All");
              }}
            >
              Clear search
            </button>
          </div>
        ) : (
          grouped.map(([category, entries]) => {
            const Icon = categoryIcon(category);
            const showAll =
              searching ||
              expandedCats.has(category) ||
              entries.length <= PREVIEW_COUNT;
            const visible = showAll ? entries : entries.slice(0, PREVIEW_COUNT);
            return (
              <section key={category} className="menu-section-block">
                <div className="menu-section-header">
                  <Icon size={18} className="menu-section-icon" aria-hidden="true" />
                  <div className="menu-section-heading">
                    <h3>{category}</h3>
                    <p>{categorySubtitle(category)}</p>
                  </div>
                  <span className="menu-section-count">
                    {entries.length} {entries.length === 1 ? "item" : "items"}
                  </span>
                  {entries.length > PREVIEW_COUNT && !searching && (
                    <button
                      className="menu-view-all"
                      onClick={() => toggleExpanded(category)}
                      aria-expanded={!showAll}
                    >
                      {showAll ? "Show less" : "View all →"}
                    </button>
                  )}
                </div>
                <div className="menu-grid">
                  {visible.map((item) => {
                    const CardIcon = categoryIcon(item.categories?.name || "");
                    const qty =
                      cartItems.find((entry) => entry.menu_item_id === item.id)
                        ?.quantity ?? 0;
                    const showFallback =
                      !item.image_url || imgErrors.has(item.id);
                    return (
                      <article key={item.id} className="menu-item-card">
                        <div className="menu-item-img">
                          {showFallback ? (
                            <div
                              className="menu-item-fallback"
                              role="img"
                              aria-label={item.name}
                            >
                              <CardIcon size={26} aria-hidden="true" />
                              <span>{item.name}</span>
                            </div>
                          ) : (
                            <img
                              src={item.image_url as string}
                              alt={item.name}
                              loading="lazy"
                              onError={() => markImageError(item.id)}
                            />
                          )}
                        </div>
                        <div className="menu-item-body">
                          <div className="menu-item-top">
                            <h3>{item.name}</h3>
                            <span
                              className={`status-badge status-${item.available ? "available" : "unavailable"}`}
                            >
                              {item.available ? "Available" : "Sold out"}
                            </span>
                          </div>
                          <p className="menu-item-desc">
                            {item.description || "Freshly prepared to order."}
                          </p>
                          <div className="menu-item-bottom">
                            <span className="menu-item-price">
                              {formatP(Number(item.price))}
                            </span>
                            <span className="menu-item-prep">
                              {item.prep_time} min
                            </span>
                          </div>
                          {item.available && qty > 0 ? (
                            <div
                              className="menu-qty"
                              aria-label={`Quantity of ${item.name} in cart`}
                            >
                              <button
                                onClick={() => changeQty(item.id, -1)}
                                aria-label={`Remove one ${item.name}`}
                              >
                                <Minus size={14} />
                              </button>
                              <span aria-live="polite">{qty}</span>
                              <button
                                onClick={() => changeQty(item.id, 1)}
                                aria-label={`Add one ${item.name}`}
                              >
                                <Plus size={14} />
                              </button>
                            </div>
                          ) : (
                            <button
                              className={`menu-add-btn${addedId === item.id ? " added" : ""}`}
                              onClick={() => addToCart(item)}
                              disabled={!item.available}
                              aria-label={`Add ${item.name} to cart, ${formatP(Number(item.price))}`}
                            >
                              {item.available &&
                                (addedId === item.id ? (
                                  <Check size={14} />
                                ) : (
                                  <Plus size={14} />
                                ))}
                              {!item.available
                                ? "Sold out"
                                : addedId === item.id
                                  ? "Added"
                                  : "Add to cart"}
                            </button>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}

        <div
          className={`menu-drawer${drawerOpen ? " open" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label="Cart"
          aria-hidden={!drawerOpen}
        >
          <div className="menu-drawer-header">
            <h3>Your cart</h3>
            <button
              className="menu-search-clear"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close cart"
            >
              <X size={16} />
            </button>
          </div>
          {cartItems.length === 0 ? (
            <div className="menu-drawer-empty">
              <ShoppingCart size={26} aria-hidden="true" />
              <p>Your cart is empty.</p>
              <p className="menu-drawer-hint">
                Add dishes from the menu to get started.
              </p>
            </div>
          ) : (
            <div className="menu-drawer-items">
              {cartItems.map((entry) => (
                <div key={entry.menu_item_id} className="menu-drawer-item">
                  <div className="menu-drawer-item-info">
                    <span className="menu-drawer-item-name">{entry.name}</span>
                    <span className="menu-drawer-item-price">
                      {formatP(entry.price)} each
                    </span>
                  </div>
                  <div className="menu-qty">
                    <button
                      onClick={() => changeQty(entry.menu_item_id, -1)}
                      aria-label={`Remove one ${entry.name}`}
                    >
                      <Minus size={13} />
                    </button>
                    <span>{entry.quantity}</span>
                    <button
                      onClick={() => changeQty(entry.menu_item_id, 1)}
                      aria-label={`Add one ${entry.name}`}
                    >
                      <Plus size={13} />
                    </button>
                    <button
                      onClick={() => removeItem(entry.menu_item_id)}
                      aria-label={`Remove ${entry.name} from cart`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {cartItems.length > 0 && (
            <div className="menu-drawer-footer">
              <div className="menu-drawer-subtotal">
                <span>Subtotal</span>
                <strong>{formatP(cartSubtotal)}</strong>
              </div>
              <Link
                href="/cart"
                className="btn-primary"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => setDrawerOpen(false)}
              >
                Checkout
              </Link>
              <button
                className="menu-drawer-continue"
                onClick={() => setDrawerOpen(false)}
              >
                Continue ordering
              </button>
            </div>
          )}
        </div>

        {toast && (
          <div className="menu-toast" role="status">
            <Check size={14} /> {toast} added to cart
          </div>
        )}
      </div>
    </RoleGuard>
  );
}
