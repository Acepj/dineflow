-- =====================================================================
-- Order & Reservation History — supporting columns and indexes
-- =====================================================================
--
-- History pages read the *existing* order and reservation rows; they do not
-- copy records into a parallel table. This migration therefore only adds the
-- two fields those pages need and cannot derive, plus the indexes that make
-- history search/date/status filtering cheap.
--
-- 1. `orders.processed_by` — who closed the order. `orders.user_id` is the
--    *customer* who placed it, so it cannot answer "Served By".
-- 2. Indexes for the history queries.
--
-- Nothing is deleted, backfilled destructively, or restructured.

-- ------------------------------------------------------------ orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS processed_by uuid
  REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN orders.processed_by IS
  'Staff/admin who served and closed this order. Distinct from user_id, which '
  'records the customer who placed it.';

-- History filters on status + recency, and searches by customer.
CREATE INDEX IF NOT EXISTS idx_orders_status_created
  ON orders (status, created_at DESC);

-- Reservation History must be able to find the order belonging to a
-- reservation (and vice versa) without a sequential scan.
CREATE INDEX IF NOT EXISTS idx_orders_reservation_id
  ON orders (reservation_id)
  WHERE reservation_id IS NOT NULL;

-- ------------------------------------------------------- reservations
-- Completed timestamps already exist from the lifecycle migration
-- (completed_at, cancelled_at-equivalent audit rows). Add the composite
-- index the history list needs: terminal status, newest first.
CREATE INDEX IF NOT EXISTS idx_reservations_status_created
  ON reservations (status, created_at DESC);

-- Customer search on the history page.
CREATE INDEX IF NOT EXISTS idx_reservations_guest_name
  ON reservations (lower(guest_name));

CREATE INDEX IF NOT EXISTS idx_reservations_phone
  ON reservations (phone);

-- ------------------------------------------------------------ payments
-- "Paid / Unpaid" is derived from the existence of a payment row, so no
-- status column is added here. This index lets the join resolve in one
-- lookup per order instead of a scan.
CREATE INDEX IF NOT EXISTS idx_payments_order_id_created
  ON payments (order_id, created_at DESC);
