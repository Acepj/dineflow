/**
 * Single source of truth for DineFlow order money calculations.
 *
 * Every component that shows or submits an order total - the customer
 * checkout summary (`app/cart/page.tsx`), the "Review your order" modal, and
 * the staff POS (`app/(dashboard)/orders/new/page.tsx`) - must call
 * `calculateOrderTotals` so the displayed amounts and the values written to
 * `orders.subtotal / service_charge / tax / discount / total` can never drift
 * apart.
 *
 * Business rules (existing DineFlow rules - keep in sync with the database):
 * - Subtotal: sum of the line totals (unit price x quantity).
 * - Service charge: 10% of the subtotal for dine-in orders, 0 for takeout.
 * - VAT: 12% of (subtotal + service charge) - required by law.
 * - Discount (promo codes): subtracted from the final total, never below 0.
 * - Total: subtotal + service charge + VAT - discount.
 *
 * Every monetary value is rounded to 2 decimals (Philippine Peso) at each
 * step so floating point noise cannot leak into the UI or the database.
 */

export const SERVICE_CHARGE_RATE = 0.1; // 10% - dine-in subtotals only
export const VAT_RATE = 0.12; // 12% - value-added tax (required by law)

export type OrderType = "dine_in" | "takeout";

/** Minimal cart/order line shape required to price an order. */
export type PricedLine = {
  price: number;
  quantity: number;
};

export type OrderTotals = {
  subtotal: number;
  serviceCharge: number;
  vat: number;
  discount: number;
  total: number;
};

/** Round a money amount to 2 decimals (centavos). */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Price of a single cart line (unit price x quantity), rounded to centavos. */
export function lineTotal(line: PricedLine): number {
  return roundMoney(Number(line.price) * Number(line.quantity));
}

/**
 * Calculate every monetary value for an order from its lines.
 * This is the ONLY place order totals may be derived.
 */
export function calculateOrderTotals(
  lines: PricedLine[],
  options: { orderType: OrderType; discount?: number | null },
): OrderTotals {
  const subtotal = roundMoney(
    lines.reduce((sum, line) => sum + lineTotal(line), 0),
  );

  const serviceCharge =
    options.orderType === "dine_in"
      ? roundMoney(subtotal * SERVICE_CHARGE_RATE)
      : 0;

  const vat = roundMoney((subtotal + serviceCharge) * VAT_RATE);

  const discount = roundMoney(
    Math.max(0, Math.min(options.discount ?? 0, subtotal)),
  );

  const total = roundMoney(
    Math.max(0, subtotal + serviceCharge + vat - discount),
  );

  return { subtotal, serviceCharge, vat, discount, total };
}

/** True when two totals objects hold identical centavo amounts. */
export function orderTotalsMatch(a: OrderTotals, b: OrderTotals): boolean {
  return (
    roundMoney(a.subtotal) === roundMoney(b.subtotal) &&
    roundMoney(a.serviceCharge) === roundMoney(b.serviceCharge) &&
    roundMoney(a.vat) === roundMoney(b.vat) &&
    roundMoney(a.discount) === roundMoney(b.discount) &&
    roundMoney(a.total) === roundMoney(b.total)
  );
}
