/*
# Customer history visibility (soft-hide)

Lets a customer hide an eligible order or reservation from their *personal*
history without deleting the underlying financial or operational record.

Why a separate table instead of a column on `orders` / `reservations`:
- Those tables are shared with staff and administrators, who must keep seeing
  every row (kitchen queue, billing, sales reports). A shared `hidden` flag
  would hide the record from everyone.
- Reservations are matched to a customer by phone, not by a stable
  `customer_id`/`user_id`, so visibility must be keyed on the authenticated
  user explicitly rather than inferred from the record itself.

This table is purely a per-user overlay:
- `record_type`   : 'order' | 'reservation'
- `record_id`     : the orders.id or reservations.id being hidden
- `hidden_at`     : when the customer hid it (used to offer a restore window)

Security:
- RLS is scoped to `auth.uid()`, so a customer can only ever create, read, or
  delete visibility rows for themselves. They cannot touch another customer's
  visibility, and this table grants no access to (or mutation of) the orders,
  order_items, payments, or reservations rows themselves.
- The uniqueness constraint prevents duplicate rows per (user, record).
*/

CREATE TABLE IF NOT EXISTS customer_history_visibility (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  record_type text NOT NULL CHECK (record_type IN ('order', 'reservation')),
  record_id uuid NOT NULL,
  hidden_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One visibility row per (user, record): idempotent hides, no duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_history_visibility_unique
  ON customer_history_visibility (user_id, record_type, record_id);

-- Fast lookups of a user's hidden records.
CREATE INDEX IF NOT EXISTS idx_customer_history_visibility_user
  ON customer_history_visibility (user_id);

-- Reverse lookups (e.g. auditing which users hid a given order).
CREATE INDEX IF NOT EXISTS idx_customer_history_visibility_record
  ON customer_history_visibility (record_type, record_id);

ALTER TABLE customer_history_visibility ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "history_visibility_select_self" ON customer_history_visibility;
CREATE POLICY "history_visibility_select_self" ON customer_history_visibility FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "history_visibility_insert_self" ON customer_history_visibility;
-- A customer can hide ONLY their OWN eligible records, validated server-side so
-- a crafted request (tampered record_id) cannot hide another customer's data.
-- Eligibility mirrors the UI rules: only completed/cancelled orders and
-- past/cancelled reservations may be hidden; active records are rejected here
-- even if the client is bypassed.
CREATE POLICY "history_visibility_insert_self" ON customer_history_visibility FOR INSERT
  TO authenticated WITH CHECK (
    user_id = auth.uid()
    AND (
      (
        record_type = 'order'
        AND EXISTS (
          SELECT 1 FROM orders
          WHERE orders.id = record_id
            AND orders.customer_id = get_current_customer_id()
            AND orders.status IN ('served', 'cancelled')
        )
      )
      OR
      (
        record_type = 'reservation'
        AND EXISTS (
          SELECT 1 FROM reservations
          JOIN customers ON customers.phone = reservations.phone
          WHERE reservations.id = record_id
            AND customers.user_id = auth.uid()
            AND reservations.status IN ('completed', 'cancelled', 'no_show')
        )
      )
    )
  );

DROP POLICY IF EXISTS "history_visibility_delete_self" ON customer_history_visibility;
CREATE POLICY "history_visibility_delete_self" ON customer_history_visibility FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- No UPDATE policy is defined: hiding is done via insert and un-hiding via
-- delete, so a customer can never rewrite another field or another user's row.
