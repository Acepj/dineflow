/**
 * Shared customer cart helpers.
 *
 * The customer menu (`app/menu/page.tsx`) and the cart page both persist the
 * cart in localStorage under `dineflow_cart`. Keep this contract stable so the
 * existing "add to cart" flow keeps working, and layer the database-backed
 * cart (`cart_items`) sync on top in the cart page.
 */

export const CART_KEY = "dineflow_cart";
export const ORDER_TYPE_KEY = "dineflow_order_type";
export const SPECIAL_INSTRUCTIONS_KEY = "dineflow_special_instructions";

/** Cart line stored in localStorage by the menu page. */
export type CartLine = {
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
  customizations?: string[];
  /** Price when first added — used to surface price changes on the cart page. */
  storedPrice?: number;
};

export function readCart(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    return [];
  }
}

export function writeCart(next: CartLine[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CART_KEY, JSON.stringify(next));
}

export function clearCart(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(CART_KEY);
}

export function readOrderType(): "dine_in" | "takeout" {
  if (typeof window === "undefined") return "dine_in";
  const stored = window.localStorage.getItem(ORDER_TYPE_KEY);
  return stored === "takeout" ? "takeout" : "dine_in";
}

export function writeOrderType(type: "dine_in" | "takeout"): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ORDER_TYPE_KEY, type);
}

export function readSpecialInstructions(): string {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(SPECIAL_INSTRUCTIONS_KEY) || "";
}

export function writeSpecialInstructions(value: string): void {
  if (typeof window === "undefined") return;
  if (value) window.localStorage.setItem(SPECIAL_INSTRUCTIONS_KEY, value);
  else window.localStorage.removeItem(SPECIAL_INSTRUCTIONS_KEY);
}

export function formatP(value: number): string {
  return (
    "₱" + Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })
  );
}

/**
 * Money rounding now lives in `lib/utils/order-calculations` - the single
 * source of truth for order math. Re-exported here so existing imports of
 * `roundMoney` from `@/lib/cart` keep working without a second implementation.
 */
export { roundMoney } from "@/lib/utils/order-calculations";
