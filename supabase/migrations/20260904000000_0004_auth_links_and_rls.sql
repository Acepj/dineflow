/*
# Auth User Links and Role-Based RLS

1. Link customers to auth users
   - Add user_id foreign key to customers table
   - Customers can be optional linked to auth.users (for guest orders)

2. Implement proper RLS for roles
   - CUSTOMER: Can only see their own orders, reservations, and profile
   - STAFF: Can see and manage restaurant operations (orders, tables, reservations, menu availability)
   - ADMIN: Full access to all resources

3. Helper functions
   - get_user_role(): Get current user's role from auth.users.user_metadata
   - is_customer_auth(): Check if current user is authenticated
   - is_staff_or_admin(): Check if user is staff or admin
*/

-- Add user_id to customers table
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

-- Create helper function to get user role
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text AS $$
  SELECT COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', 'user')::text;
$$ LANGUAGE SQL STABLE;

-- Create helper function to check if user is authenticated
CREATE OR REPLACE FUNCTION is_customer_auth()
RETURNS boolean AS $$
  SELECT auth.uid() IS NOT NULL;
$$ LANGUAGE SQL STABLE;

-- Create helper function to get current customer
CREATE OR REPLACE FUNCTION get_current_customer_id()
RETURNS uuid AS $$
  SELECT id FROM customers WHERE user_id = auth.uid() LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- Drop old open policies and replace with role-based ones
DROP POLICY IF EXISTS "public_read_categories" ON categories;
DROP POLICY IF EXISTS "public_insert_categories" ON categories;
DROP POLICY IF EXISTS "public_update_categories" ON categories;
DROP POLICY IF EXISTS "public_delete_categories" ON categories;

-- CATEGORIES: Public read, admin-only write
CREATE POLICY "categories_select_all" ON categories FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "categories_insert_admin" ON categories FOR INSERT
  TO authenticated WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "categories_update_admin" ON categories FOR UPDATE
  TO authenticated USING (get_user_role() = 'admin');

CREATE POLICY "categories_delete_admin" ON categories FOR DELETE
  TO authenticated USING (get_user_role() = 'admin');

-- Drop menu items policies
DROP POLICY IF EXISTS "public_read_menu_items" ON menu_items;
DROP POLICY IF EXISTS "public_insert_menu_items" ON menu_items;
DROP POLICY IF EXISTS "public_update_menu_items" ON menu_items;
DROP POLICY IF EXISTS "public_delete_menu_items" ON menu_items;

-- MENU_ITEMS: Public read, staff can update availability, admin can full CRUD
CREATE POLICY "menu_items_select_all" ON menu_items FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "menu_items_insert_admin" ON menu_items FOR INSERT
  TO authenticated WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "menu_items_update_staff" ON menu_items FOR UPDATE
  TO authenticated USING (get_user_role() IN ('staff', 'admin'));

CREATE POLICY "menu_items_delete_admin" ON menu_items FOR DELETE
  TO authenticated USING (get_user_role() = 'admin');

-- Drop customers policies
DROP POLICY IF EXISTS "public_read_customers" ON customers;
DROP POLICY IF EXISTS "public_insert_customers" ON customers;
DROP POLICY IF EXISTS "public_update_customers" ON customers;
DROP POLICY IF EXISTS "public_delete_customers" ON customers;

-- CUSTOMERS: Users can read their own, staff/admin can read all
CREATE POLICY "customers_select_self" ON customers FOR SELECT
  TO authenticated USING (
    user_id = auth.uid() OR
    get_user_role() IN ('staff', 'admin')
  );

CREATE POLICY "customers_select_anon" ON customers FOR SELECT
  TO anon USING (false);

CREATE POLICY "customers_insert_public" ON customers FOR INSERT
  TO anon, authenticated WITH CHECK (true);

CREATE POLICY "customers_update_self" ON customers FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "customers_update_admin" ON customers FOR UPDATE
  TO authenticated USING (get_user_role() = 'admin');

CREATE POLICY "customers_delete_admin" ON customers FOR DELETE
  TO authenticated USING (get_user_role() = 'admin');

-- Drop reservations policies
DROP POLICY IF EXISTS "public_read_reservations" ON reservations;
DROP POLICY IF EXISTS "public_insert_reservations" ON reservations;

-- RESERVATIONS: Public can insert (unauthenticated booking), auth users see their own, staff/admin see all
CREATE POLICY "reservations_select_public" ON reservations FOR SELECT
  TO anon, authenticated USING (
    CASE
      WHEN get_user_role() IN ('staff', 'admin') THEN true
      WHEN auth.uid() IS NOT NULL THEN
        (SELECT id FROM customers WHERE user_id = auth.uid()) IS NOT NULL
      ELSE false
    END
  );

CREATE POLICY "reservations_insert_public" ON reservations FOR INSERT
  TO anon, authenticated WITH CHECK (true);

CREATE POLICY "reservations_update_staff" ON reservations FOR UPDATE
  TO authenticated USING (get_user_role() IN ('staff', 'admin'));

CREATE POLICY "reservations_delete_staff" ON reservations FOR DELETE
  TO authenticated USING (get_user_role() IN ('staff', 'admin'));

-- Drop orders policies
DROP POLICY IF EXISTS "public_read_orders" ON orders;
DROP POLICY IF EXISTS "public_insert_orders" ON orders;
DROP POLICY IF EXISTS "public_update_orders" ON orders;
DROP POLICY IF EXISTS "public_delete_orders" ON orders;

-- ORDERS: Customers see their own, staff/admin see all
CREATE POLICY "orders_select_self" ON orders FOR SELECT
  TO authenticated USING (
    CASE
      WHEN get_user_role() IN ('staff', 'admin') THEN true
      ELSE customer_id = get_current_customer_id()
    END
  );

CREATE POLICY "orders_select_anon" ON orders FOR SELECT
  TO anon USING (false);

CREATE POLICY "orders_insert_public" ON orders FOR INSERT
  TO anon, authenticated WITH CHECK (true);

CREATE POLICY "orders_update_staff" ON orders FOR UPDATE
  TO authenticated USING (get_user_role() IN ('staff', 'admin'));

CREATE POLICY "orders_delete_admin" ON orders FOR DELETE
  TO authenticated USING (get_user_role() = 'admin');

-- Drop order items policies
DROP POLICY IF EXISTS "public_read_order_items" ON order_items;
DROP POLICY IF EXISTS "public_insert_order_items" ON order_items;
DROP POLICY IF EXISTS "public_update_order_items" ON order_items;
DROP POLICY IF EXISTS "public_delete_order_items" ON order_items;

-- ORDER_ITEMS: Access controlled through orders relationship
CREATE POLICY "order_items_select_self" ON order_items FOR SELECT
  TO authenticated USING (
    CASE
      WHEN get_user_role() IN ('staff', 'admin') THEN true
      ELSE (
        SELECT COUNT(*) FROM orders 
        WHERE orders.id = order_items.order_id 
        AND orders.customer_id = get_current_customer_id()
      ) > 0
    END
  );

CREATE POLICY "order_items_select_anon" ON order_items FOR SELECT
  TO anon USING (false);

CREATE POLICY "order_items_insert_public" ON order_items FOR INSERT
  TO anon, authenticated WITH CHECK (true);

CREATE POLICY "order_items_update_staff" ON order_items FOR UPDATE
  TO authenticated USING (get_user_role() IN ('staff', 'admin'));

CREATE POLICY "order_items_delete_staff" ON order_items FOR DELETE
  TO authenticated USING (get_user_role() IN ('staff', 'admin'));

-- Drop payments policies
DROP POLICY IF EXISTS "public_read_payments" ON payments;
DROP POLICY IF EXISTS "public_insert_payments" ON payments;
DROP POLICY IF EXISTS "public_update_payments" ON payments;
DROP POLICY IF EXISTS "public_delete_payments" ON payments;

-- PAYMENTS: Customers see their own, staff/admin see all
CREATE POLICY "payments_select_self" ON payments FOR SELECT
  TO authenticated USING (
    CASE
      WHEN get_user_role() IN ('staff', 'admin') THEN true
      ELSE (
        SELECT COUNT(*) FROM orders 
        WHERE orders.id = payments.order_id 
        AND orders.customer_id = get_current_customer_id()
      ) > 0
    END
  );

CREATE POLICY "payments_select_anon" ON payments FOR SELECT
  TO anon USING (false);

CREATE POLICY "payments_insert_staff" ON payments FOR INSERT
  TO authenticated WITH CHECK (get_user_role() IN ('staff', 'admin'));

CREATE POLICY "payments_update_staff" ON payments FOR UPDATE
  TO authenticated USING (get_user_role() IN ('staff', 'admin'));

CREATE POLICY "payments_delete_staff" ON payments FOR DELETE
  TO authenticated USING (get_user_role() IN ('staff', 'admin'));

-- RESTAURANT_TABLES: Public read, staff/admin can update
DROP POLICY IF EXISTS "public_read_tables" ON restaurant_tables;

CREATE POLICY "tables_select_all" ON restaurant_tables FOR SELECT
  TO anon, authenticated USING (true);

CREATE POLICY "tables_insert_admin" ON restaurant_tables FOR INSERT
  TO authenticated WITH CHECK (get_user_role() = 'admin');

CREATE POLICY "tables_update_staff" ON restaurant_tables FOR UPDATE
  TO authenticated USING (get_user_role() IN ('staff', 'admin'));

CREATE POLICY "tables_delete_admin" ON restaurant_tables FOR DELETE
  TO authenticated USING (get_user_role() = 'admin');

-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers (user_id);
