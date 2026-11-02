/*
# Restaurant tables and reservations (public, no auth)

1. New Tables
- `restaurant_tables`: physical tables in the restaurant.
  - `id` (uuid, pk), `table_number` (int, unique), `capacity` (int, 1-20),
  - `location` (text: indoor/outdoor/bar/private), `status` (text), `created_at`
- `reservations`: guest bookings.
  - `id` (uuid, pk), `code` (text, unique auto-generated), `table_id` (fk nullable),
  - `guest_name`, `phone`, `email`, `party_size` (1-20),
  - `reserved_from`, `reserved_to` (timestamptz), `status`, `special_request`, `created_at`

2. Constraints
- `reserved_to > reserved_from` via CHECK.
- Exclusion constraint prevents overlapping active reservations on the same table (tstzrange + btree_gist).
- Unique phone per window blocks duplicate same-phone bookings.

3. Security
- RLS enabled on both tables.
- anon+authenticated can read tables and reservations, and insert reservations.
- No public UPDATE/DELETE on reservations.

4. Notes
- No auth/sign-in; all policies use `TO anon, authenticated`.
- Restaurant hours 17:30–23:00 enforced in app layer.
*/

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

CREATE TABLE IF NOT EXISTS restaurant_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number int NOT NULL UNIQUE,
  capacity int NOT NULL CHECK (capacity > 0 AND capacity <= 20),
  location text NOT NULL DEFAULT 'indoor' CHECK (location IN ('indoor','outdoor','bar','private')),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','occupied','reserved','out_of_service')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE DEFAULT upper(substr(encode(gen_random_bytes(4),'hex'),1,6)),
  table_id uuid REFERENCES restaurant_tables(id) ON DELETE SET NULL,
  guest_name text NOT NULL CHECK (char_length(guest_name) >= 2 AND char_length(guest_name) <= 80),
  phone text NOT NULL,
  email text CHECK (email IS NULL OR email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  party_size int NOT NULL CHECK (party_size >= 1 AND party_size <= 20),
  reserved_from timestamptz NOT NULL,
  reserved_to timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','seated','completed','cancelled','no_show')),
  special_request text CHECK (special_request IS NULL OR char_length(special_request) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT valid_time_window CHECK (reserved_to > reserved_from)
);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'no_overlapping_reservations'
  ) THEN
    ALTER TABLE reservations
      ADD CONSTRAINT no_overlapping_reservations
      EXCLUDE USING gist (
        table_id WITH =,
        tstzrange(reserved_from, reserved_to) WITH &&
      ) WHERE (status IN ('pending','confirmed','seated') AND table_id IS NOT NULL);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_phone_window
  ON reservations (phone, reserved_from, reserved_to)
  WHERE (status IN ('pending','confirmed','seated'));

CREATE INDEX IF NOT EXISTS idx_reservations_from ON reservations (reserved_from);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations (status);
CREATE INDEX IF NOT EXISTS idx_reservations_table ON reservations (table_id);
CREATE INDEX IF NOT EXISTS idx_tables_status ON restaurant_tables (status);

ALTER TABLE restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_tables" ON restaurant_tables;
CREATE POLICY "public_read_tables" ON restaurant_tables FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_read_reservations" ON reservations;
CREATE POLICY "public_read_reservations" ON reservations FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "public_insert_reservations" ON reservations;
CREATE POLICY "public_insert_reservations" ON reservations FOR INSERT
  TO anon, authenticated WITH CHECK (true);

INSERT INTO restaurant_tables (table_number, capacity, location, status) VALUES
  (1, 2, 'indoor', 'available'),
  (2, 2, 'indoor', 'available'),
  (3, 4, 'indoor', 'available'),
  (4, 4, 'indoor', 'available'),
  (5, 4, 'indoor', 'available'),
  (6, 6, 'indoor', 'available'),
  (7, 2, 'outdoor', 'available'),
  (8, 2, 'outdoor', 'available'),
  (9, 4, 'outdoor', 'available'),
  (10, 4, 'outdoor', 'available'),
  (11, 6, 'outdoor', 'available'),
  (12, 8, 'outdoor', 'available'),
  (13, 2, 'bar', 'available'),
  (14, 2, 'bar', 'available'),
  (15, 2, 'bar', 'available'),
  (16, 4, 'bar', 'available'),
  (17, 4, 'bar', 'available'),
  (18, 6, 'private', 'available'),
  (19, 8, 'private', 'available'),
  (20, 10, 'private', 'available')
ON CONFLICT (table_number) DO NOTHING;
