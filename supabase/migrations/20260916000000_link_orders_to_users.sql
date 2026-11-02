/*
# Link customer orders to the authenticated user + auto-create customer rows

Problem this solves
- Sign-up created only a `profiles` row; it never created a `customers` row.
  Because `customers` was always empty, `get_current_customer_id()` returned
  NULL, so `orders_select_self` (customer_id = get_current_customer_id())
  matched nothing and every order looked "invisible" in the customer history.
- Checkout saved `orders.customer_id = customer?.id ?? null`, which was always
  NULL for the same reason.

Changes
1. `orders.user_id` — a direct, always-available link to the auth user, so a
   customer's orders are found even before/without a `customers` row and even
   for orders placed before this migration. Backfills from existing
   `orders.customer_id -> customers.user_id`.
2. Trigger `handle_new_auth_user_customer` — creates a `customers` row for every
   new auth user (mirroring the existing profiles trigger), so checkout can link
   `customer_id` going forward and reservations can be matched by phone.
3. RLS: customers may SELECT orders they own by `customer_id` OR by `user_id`.
4. Backfill: attach any still-orphaned orders to the current user is handled in
   the app (we cannot infer ownership for truly anonymous guest orders), but
   orders whose `customer_id` already pointed at a customer now also carry that
   customer's `user_id`.
*/

-- 1. Direct user link on orders --------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders (user_id);

-- Backfill user_id from any orders already linked to a customer row.
UPDATE orders o
SET user_id = c.user_id
FROM customers c
WHERE o.customer_id = c.id
  AND c.user_id IS NOT NULL
  AND o.user_id IS NULL;

-- 2. Auto-create a customers row for every new auth user -------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  metadata_role text;
  base_phone text;
  candidate_phone text;
  suffix int := 0;
BEGIN
  metadata_role := lower(COALESCE(new.raw_user_meta_data ->> 'role', 'user'));
  IF metadata_role NOT IN ('user', 'staff', 'admin') THEN
    metadata_role := 'user';
  END IF;

  -- Only provision a customer record for real customers (not staff/admin).
  IF metadata_role <> 'user' THEN
    RETURN new;
  END IF;

  -- customers.phone is NOT NULL UNIQUE, so derive a stable, unique placeholder
  -- the customer can edit later in their profile.
  base_phone := 'u' || replace(new.id::text, '-', '');
  candidate_phone := substr(base_phone, 1, 20);
  WHILE EXISTS (SELECT 1 FROM customers WHERE phone = candidate_phone) LOOP
    suffix := suffix + 1;
    candidate_phone := substr(base_phone, 1, 18) || suffix::text;
  END LOOP;

  INSERT INTO public.customers (user_id, name, email, phone)
  VALUES (
    new.id,
    COALESCE(NULLIF(new.raw_user_meta_data ->> 'full_name', ''), split_part(COALESCE(new.email, 'Member'), '@', 1)),
    new.email,
    candidate_phone
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_customer ON auth.users;
CREATE TRIGGER on_auth_user_created_customer
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user_customer();

-- 2b. Backfill customers rows for auth users that already exist ------------
-- Derive a phone that is unique across the table (customers.phone is UNIQUE).
DO $$
DECLARE
  u record;
  base_phone text;
  candidate_phone text;
  suffix int;
BEGIN
  FOR u IN
    SELECT id, email, raw_user_meta_data
    FROM auth.users au
    WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.user_id = au.id)
  LOOP
    IF lower(COALESCE(u.raw_user_meta_data ->> 'role', 'user')) <> 'user' THEN
      CONTINUE;
    END IF;

    base_phone := 'u' || replace(u.id::text, '-', '');
    candidate_phone := substr(base_phone, 1, 20);
    suffix := 0;
    WHILE EXISTS (SELECT 1 FROM customers WHERE phone = candidate_phone) LOOP
      suffix := suffix + 1;
      candidate_phone := substr(base_phone, 1, 18) || suffix::text;
    END LOOP;

    INSERT INTO customers (user_id, name, email, phone)
    VALUES (
      u.id,
      COALESCE(NULLIF(u.raw_user_meta_data ->> 'full_name', ''), split_part(COALESCE(u.email, 'Member'), '@', 1)),
      u.email,
      candidate_phone
    );
  END LOOP;
END $$;

-- 3. RLS: let a customer read their own orders by user_id too --------------
DROP POLICY IF EXISTS "orders_select_self" ON orders;
CREATE POLICY "orders_select_self" ON orders FOR SELECT
  TO authenticated USING (
    CASE
      WHEN get_user_role() IN ('staff', 'admin') THEN true
      ELSE customer_id = get_current_customer_id() OR user_id = auth.uid()
    END
  );
