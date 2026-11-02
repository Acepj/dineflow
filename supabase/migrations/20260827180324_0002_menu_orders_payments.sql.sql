/*
# Menu, orders, payments, and reporting tables (public, no auth)

1. New Tables
- `categories`: menu categories (name, description, sort_order, active)
- `menu_items`: dishes (category fk, name, description, price, image_url, prep_time, available)
- `customers`: guest records (name, phone unique, email, notes)
- `orders`: order tickets (number, type, table fk nullable, reservation fk nullable, customer fk nullable, status, subtotal, service_charge, tax, discount, total)
- `order_items`: line items (order fk, menu_item fk, quantity, unit_price snapshot, line_total, notes)
- `payments`: settlements (order fk, method, amount_due, amount_tendered, change, reference)

2. Constraints
- Prices and quantities must be positive.
- Menu items unique per category.
- Customers have unique phone.

3. Security
- RLS enabled on all tables, anon+authenticated full CRUD (no auth app).

4. Notes
- order_items.unit_price and order money totals are deliberate financial snapshots.
*/

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1001;

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Older databases may already have categories without the current metadata columns.
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS slug text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_name_unique
  ON categories (name);

CREATE TABLE IF NOT EXISTS menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text,
  price numeric(10,2) NOT NULL CHECK (price > 0),
  image_url text,
  prep_time int NOT NULL DEFAULT 15 CHECK (prep_time > 0 AND prep_time <= 120),
  available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category_id, name)
);

-- Older databases may already have menu_items without the category relationship.
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS category_id uuid;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS price numeric(10,2) NOT NULL DEFAULT 1;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS image_url text;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS prep_time int NOT NULL DEFAULT 15;

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS available boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'menu_items_category_id_fkey'
      AND conrelid = 'menu_items'::regclass
  ) THEN
    ALTER TABLE menu_items
      ADD CONSTRAINT menu_items_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) >= 2),
  phone text NOT NULL UNIQUE,
  email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number int NOT NULL DEFAULT nextval('order_number_seq'),
  type text NOT NULL DEFAULT 'dine_in' CHECK (type IN ('dine_in','takeout')),
  table_id uuid REFERENCES restaurant_tables(id) ON DELETE SET NULL,
  reservation_id uuid REFERENCES reservations(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','preparing','serving','served','cancelled')),
  subtotal numeric(10,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  service_charge numeric(10,2) NOT NULL DEFAULT 0 CHECK (service_charge >= 0),
  tax numeric(10,2) NOT NULL DEFAULT 0 CHECK (tax >= 0),
  discount numeric(10,2) NOT NULL DEFAULT 0 CHECK (discount >= 0),
  total numeric(10,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE RESTRICT,
  menu_item_name text NOT NULL,
  quantity int NOT NULL CHECK (quantity > 0 AND quantity <= 99),
  unit_price numeric(10,2) NOT NULL CHECK (unit_price >= 0),
  line_total numeric(10,2) NOT NULL CHECK (line_total >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('cash','card','gcash','bank_transfer')),
  amount_due numeric(10,2) NOT NULL CHECK (amount_due >= 0),
  amount_tendered numeric(10,2) NOT NULL CHECK (amount_tendered >= 0),
  change_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (change_amount >= 0),
  reference text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items (category_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_available ON menu_items (available);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders (table_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments (order_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_categories" ON categories;
CREATE POLICY "public_read_categories" ON categories FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_insert_categories" ON categories;
CREATE POLICY "public_insert_categories" ON categories FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_categories" ON categories;
CREATE POLICY "public_update_categories" ON categories FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_categories" ON categories;
CREATE POLICY "public_delete_categories" ON categories FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_menu_items" ON menu_items;
CREATE POLICY "public_read_menu_items" ON menu_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_insert_menu_items" ON menu_items;
CREATE POLICY "public_insert_menu_items" ON menu_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_menu_items" ON menu_items;
CREATE POLICY "public_update_menu_items" ON menu_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_menu_items" ON menu_items;
CREATE POLICY "public_delete_menu_items" ON menu_items FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_customers" ON customers;
CREATE POLICY "public_read_customers" ON customers FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_insert_customers" ON customers;
CREATE POLICY "public_insert_customers" ON customers FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_customers" ON customers;
CREATE POLICY "public_update_customers" ON customers FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_customers" ON customers;
CREATE POLICY "public_delete_customers" ON customers FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_orders" ON orders;
CREATE POLICY "public_read_orders" ON orders FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_insert_orders" ON orders;
CREATE POLICY "public_insert_orders" ON orders FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_orders" ON orders;
CREATE POLICY "public_update_orders" ON orders FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_orders" ON orders;
CREATE POLICY "public_delete_orders" ON orders FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_order_items" ON order_items;
CREATE POLICY "public_read_order_items" ON order_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_insert_order_items" ON order_items;
CREATE POLICY "public_insert_order_items" ON order_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_order_items" ON order_items;
CREATE POLICY "public_update_order_items" ON order_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_order_items" ON order_items;
CREATE POLICY "public_delete_order_items" ON order_items FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_payments" ON payments;
CREATE POLICY "public_read_payments" ON payments FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "public_insert_payments" ON payments;
CREATE POLICY "public_insert_payments" ON payments FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "public_update_payments" ON payments;
CREATE POLICY "public_update_payments" ON payments FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "public_delete_payments" ON payments;
CREATE POLICY "public_delete_payments" ON payments FOR DELETE TO anon, authenticated USING (true);

INSERT INTO categories (name, slug, description, sort_order)
SELECT v.name, v.slug, v.description, v.sort_order
FROM (VALUES
  ('Signature Rolls', 'signature-rolls', 'Chef''s specialty maki creations', 1),
  ('Nigiri & Sashimi', 'nigiri-sashimi', 'Fresh cuts on and off the rice', 2),
  ('Small Plates', 'small-plates', 'Shareable starters and sides', 3),
  ('Ramen', 'ramen', 'Slow-brothed noodle bowls', 4),
  ('Desserts', 'desserts', 'Sweet finishes', 5),
  ('Drinks', 'drinks', 'Sake, tea, and refreshments', 6)
) AS v(name, slug, description, sort_order)
WHERE NOT EXISTS (
  SELECT 1
  FROM categories existing
  WHERE existing.name = v.name
);

INSERT INTO menu_items (category_id, name, description, price, prep_time, available, image_url)
SELECT c.id, v.name, v.description, v.price, v.prep, true, v.img
FROM (VALUES
  ('Signature Rolls', 'Dragon Roll', 'Eel, cucumber, avocado, tobiko', 320.00, 12, 'https://images.pexels.com/photos/2098085/pexels-photo-2098085.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Signature Rolls', 'Rainbow Roll', 'Crab, avocado, topped with assorted sashimi', 380.00, 14, 'https://images.pexels.com/photos/8951244/pexels-photo-8951244.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Signature Rolls', 'Spicy Tuna Roll', 'Tuna, spicy mayo, scallion, sesame', 280.00, 10, 'https://images.pexels.com/photos/15476268/pexels-photo-15476268.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Signature Rolls', 'Philadelphia Roll', 'Salmon, cream cheese, cucumber', 290.00, 10, 'https://images.pexels.com/photos/354979/pexels-photo-354979.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Signature Rolls', 'Tempura Roll', 'Shrimp tempura, avocado, eel sauce', 340.00, 12, 'https://images.pexels.com/photos/2098085/pexels-photo-2098085.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Signature Rolls', 'Volcano Roll', 'Spicy scallop, crunch, dynamite sauce', 360.00, 14, 'https://images.pexels.com/photos/15476268/pexels-photo-15476268.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Nigiri & Sashimi', 'Toro Nigiri', 'Bluefin belly, wasabi', 220.00, 8, 'https://images.pexels.com/photos/2098085/pexels-photo-2098085.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Nigiri & Sashimi', 'Salmon Nigiri', 'Norwegian salmon, wasabi', 180.00, 8, 'https://images.pexels.com/photos/354979/pexels-photo-354979.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Nigiri & Sashimi', 'Hamachi Nigiri', 'Yellowtail, wasabi', 190.00, 8, 'https://images.pexels.com/photos/15476268/pexels-photo-15476268.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Nigiri & Sashimi', 'Sashimi Platter', 'Chef''s selection of 9 pieces', 520.00, 12, 'https://images.pexels.com/photos/8951244/pexels-photo-8951244.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Nigiri & Sashimi', 'Ebi Nigiri', 'Cooked prawn, wasabi', 160.00, 8, 'https://images.pexels.com/photos/354979/pexels-photo-354979.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Nigiri & Sashimi', 'Unagi Nigiri', 'Freshwater eel, sweet sauce', 240.00, 8, 'https://images.pexels.com/photos/2098085/pexels-photo-2098085.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Small Plates', 'Edamame', 'Steamed soybeans, sea salt', 150.00, 6, 'https://images.pexels.com/photos/15476268/pexels-photo-15476268.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Small Plates', 'Gyoza', 'Pan-fried pork dumplings (6 pcs)', 220.00, 12, 'https://images.pexels.com/photos/354979/pexels-photo-354979.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Small Plates', 'Agedashi Tofu', 'Fried tofu, dashi broth, daikon', 190.00, 10, 'https://images.pexels.com/photos/15476268/pexels-photo-15476268.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Small Plates', 'Karaage', 'Japanese fried chicken (8 pcs)', 280.00, 14, 'https://images.pexels.com/photos/8951244/pexels-photo-8951244.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Small Plates', 'Takoyaki', 'Octopus balls, bonito, mayo (6 pcs)', 240.00, 12, 'https://images.pexels.com/photos/2098085/pexels-photo-2098085.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Small Plates', 'Wagyu Tataki', 'Seared wagyu, ponzu, microgreens', 480.00, 10, 'https://images.pexels.com/photos/354979/pexels-photo-354979.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Ramen', 'Tonkotsu Ramen', 'Pork bone broth, chashu, egg, scallion', 390.00, 18, 'https://images.pexels.com/photos/15476268/pexels-photo-15476268.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Ramen', 'Miso Ramen', 'Miso broth, ground pork, corn, bean sprouts', 360.00, 18, 'https://images.pexels.com/photos/8951244/pexels-photo-8951244.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Ramen', 'Spicy Ramen', 'Spicy miso broth, chashu, chili oil', 380.00, 18, 'https://images.pexels.com/photos/2098085/pexels-photo-2098085.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Ramen', 'Vegan Ramen', 'Mushroom broth, tofu, vegetables', 340.00, 18, 'https://images.pexels.com/photos/354979/pexels-photo-354979.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Desserts', 'Matcha Cheesecake', 'Green tea cheesecake, red bean', 220.00, 5, 'https://images.pexels.com/photos/15476268/pexels-photo-15476268.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Desserts', 'Mochi Ice Cream', 'Three flavors: matcha, black sesame, yuzu', 190.00, 5, 'https://images.pexels.com/photos/8951244/pexels-photo-8951244.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Desserts', 'Tempura Ice Cream', 'Vanilla ice cream, fried tempura shell', 200.00, 8, 'https://images.pexels.com/photos/2098085/pexels-photo-2098085.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Desserts', 'Yuzu Tart', 'Yuzu curd, sable crust, toasted meringue', 240.00, 5, 'https://images.pexels.com/photos/354979/pexels-photo-354979.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Drinks', 'Junmai Sake', 'Chilled sake, 180ml', 350.00, 3, 'https://images.pexels.com/photos/15476268/pexels-photo-15476268.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Drinks', 'Ginjo Sake', 'Premium chilled sake, 180ml', 480.00, 3, 'https://images.pexels.com/photos/8951244/pexels-photo-8951244.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Drinks', 'Hot Green Tea', 'Hojicha, pot', 90.00, 3, 'https://images.pexels.com/photos/2098085/pexels-photo-2098085.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Drinks', 'Iced Yuzu Tea', 'Yuzu, honey, sparkling water', 130.00, 3, 'https://images.pexels.com/photos/354979/pexels-photo-354979.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Drinks', 'Asahi Beer', 'Draft, 500ml', 180.00, 2, 'https://images.pexels.com/photos/15476268/pexels-photo-15476268.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('Drinks', 'Plum Wine', 'Umeshu, on the rocks', 220.00, 2, 'https://images.pexels.com/photos/8951244/pexels-photo-8951244.jpeg?auto=compress&cs=tinysrgb&w=600')
) AS v(cat, name, description, price, prep, img)
JOIN categories c ON c.name = v.cat
WHERE NOT EXISTS (
  SELECT 1
  FROM menu_items existing
  WHERE existing.category_id = c.id
    AND existing.name = v.name
);
