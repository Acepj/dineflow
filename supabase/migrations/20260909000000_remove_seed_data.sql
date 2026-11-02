/*
# Remove seeded demo data (customers, orders, order items, payments)

Earlier migrations inserted sample/demo records so the dashboards had content
to show. This migration removes that example data from databases where those
migrations have already been applied, so the app starts with a clean slate.

Physical restaurant tables, menu categories, and menu items are intentionally
kept — they are operational setup, not example data.

- Removes the seeded `orders` (order numbers 1001–1015) together with their
  `order_items` and `payments`.
- Removes the seeded `customers`.
- Resets the order number sequence so new orders start at 1001.
*/

-- 1. Payments for seeded orders
DELETE FROM payments
WHERE order_id IN (
  SELECT id FROM orders WHERE order_number BETWEEN 1001 AND 1015
);

-- 2. Line items for seeded orders
DELETE FROM order_items
WHERE order_id IN (
  SELECT id FROM orders WHERE order_number BETWEEN 1001 AND 1015
);

-- 3. Seeded orders
DELETE FROM orders WHERE order_number BETWEEN 1001 AND 1015;

-- 4. Seeded customers (matched by the sample phone numbers)
DELETE FROM customers
WHERE phone IN (
  '+639171234567', '+639181234567', '+639191234567', '+639201234567',
  '+639211234567', '+639221234567', '+639231234567', '+639241234567',
  '+639251234567', '+639261234567', '+639271234567', '+639281234567',
  '+639291234567', '+639301234567', '+639311234567'
);

-- 5. Reset the order number sequence so new orders start at 1001
SELECT pg_catalog.setval('order_number_seq', 1000);