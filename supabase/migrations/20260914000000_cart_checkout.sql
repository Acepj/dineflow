/*
# Customer cart & checkout support

1. New Tables
- `cart_items`: persistent shopping cart for authenticated customers
  (user fk, menu_item fk, quantity, customizations, notes). Synced with the
  localStorage cart used by the customer menu.
- `promo_codes`: discount codes validated during checkout
  (code, description, percent/fixed discount, min_subtotal, max_discount,
  expiry, usage limit).

2. Alterations (all idempotent)
- `customers`  : add loyalty_points and member_tier for the rewards display.
- `orders`     : add special_instructions, promo_code (display snapshot),
                 and requested_at (pickup time for takeout).
- `menu_items` : add nullable stock so the cart can warn/auto-clamp when a
                 quantity exceeds available stock (NULL = not tracked).

3. Security
- cart_items: authenticated users only, scoped to their own user_id.
- promo_codes: public read (validated client-side), staff/admin manage.

4. Notes
- All statements are IF NOT EXISTS / guarded so the migration can run
  safely against an existing database.
*/

-- ---------------------------------------------------------------- cart_items
CREATE TABLE IF NOT EXISTS cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  customizations jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, menu_item_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_items_user ON cart_items (user_id);

ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cart_items_select_self" ON cart_items;
CREATE POLICY "cart_items_select_self" ON cart_items FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "cart_items_insert_self" ON cart_items;
CREATE POLICY "cart_items_insert_self" ON cart_items FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "cart_items_update_self" ON cart_items;
CREATE POLICY "cart_items_update_self" ON cart_items FOR UPDATE
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "cart_items_delete_self" ON cart_items;
CREATE POLICY "cart_items_delete_self" ON cart_items FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- ------------------------------------------------------------- promo_codes
CREATE TABLE IF NOT EXISTS promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text,
  discount_type text NOT NULL DEFAULT 'percent'
    CHECK (discount_type IN ('percent', 'fixed')),
  discount_value numeric(10,2) NOT NULL CHECK (discount_value > 0),
  min_subtotal numeric(10,2) NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
  max_discount numeric(10,2) CHECK (max_discount IS NULL OR max_discount > 0),
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  usage_limit int CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count int NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_active ON promo_codes (active);

ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promo_codes_select_all" ON promo_codes;
CREATE POLICY "promo_codes_select_all" ON promo_codes FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "promo_codes_insert_admin" ON promo_codes;
CREATE POLICY "promo_codes_insert_admin" ON promo_codes FOR INSERT
  TO authenticated WITH CHECK (get_user_role() = 'admin');

DROP POLICY IF EXISTS "promo_codes_update_admin" ON promo_codes;
CREATE POLICY "promo_codes_update_admin" ON promo_codes FOR UPDATE
  TO authenticated USING (get_user_role() = 'admin');

DROP POLICY IF EXISTS "promo_codes_delete_admin" ON promo_codes;
CREATE POLICY "promo_codes_delete_admin" ON promo_codes FOR DELETE
  TO authenticated USING (get_user_role() = 'admin');

-- A couple of test-friendly promo codes so the feature can be validated
-- against real rows. Disable by setting active = false when not wanted.
INSERT INTO promo_codes (code, description, discount_type, discount_value, min_subtotal, expires_at)
VALUES
  ('WELCOME10', '10% off your first order', 'percent', 10.00, 200.00, '2030-12-31T23:59:59Z'),
  ('LOYALTY50', '₱50 off orders over ₱500', 'fixed', 50.00, 500.00, '2030-12-31T23:59:59Z')
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------- customers
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS loyalty_points int NOT NULL DEFAULT 0;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS member_tier text NOT NULL DEFAULT 'standard';

-- ----------------------------------------------------------------- orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS special_instructions text;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS promo_code text;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS requested_at timestamptz;

-- ------------------------------------------------------------- menu_items
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS stock int;
