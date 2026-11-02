/*
# Date-scoped table status (`table_daily_status`)

Problem this solves
-------------------
`restaurant_tables.status` is a *live floor status* — it only describes the
restaurant right now (available / occupied / reserved / out_of_service). It
cannot answer "is table 4 free next Friday?" because next Friday's floor has
not happened yet and no one has touched the table.

Staff and admins therefore had no way to plan a specific day, and customers
picking a future date only saw the tables' live statuses, which said nothing
about that day. This migration adds a per-date override so a table's status can
be set *for a chosen day*, independently of its live status and of the actual
reservations recorded for that day.

Model
-----
`table_daily_status` holds one row per (table, day):
  status  available | occupied | reserved | served
      available  staff say this table can be booked that day.
      occupied   the table is in use that day (walk-in, staff assignment, ...).
      reserved   held that day without a live guest (e.g. a held VIP table).
      served     food has been served / the table is winding down that day.
  (out_of_service stays a permanent property of `restaurant_tables`; it is
   day-independent and always wins over any daily override.)

Resolution used by the app (single source of truth in lib/table-availability.ts):
  1. out_of_service on the physical table         -> out_of_service (day-independent)
  2. a real reservation overlapping the day        -> occupied (seated) / reserved
  3. otherwise a staff daily override for the day  -> available / occupied / reserved / served
  4. otherwise                                     -> available
A real booking always wins over a staff "available" override, so the picker
never offers a table the database would reject, while staff can still reserve,
occupy or mark served a table that has no reservation row.

Only staff/admin can write daily statuses; everyone (anon + authenticated) can
read them so the customer booking wizard can show the chosen day's availability.
The reservations exclusion constraint still prevents a customer booking over a
real reservation, so a staff "available" override can never cause an overbook.

Notes
-----
- UNIQUE(table_id, day) makes the staff page's write a clean upsert: set the
  same table/day twice updates the row instead of erroring.
- Idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS) so it is safe to re-run.
*/

CREATE TABLE IF NOT EXISTS table_daily_status (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id   uuid NOT NULL REFERENCES restaurant_tables(id) ON DELETE CASCADE,
  day        date NOT NULL,
  status     text NOT NULL DEFAULT 'available'
             CHECK (status IN ('available', 'occupied', 'reserved', 'served')),
  note       text CHECK (note IS NULL OR char_length(note) <= 200),
  set_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_daily_status_unique UNIQUE (table_id, day)
);

CREATE INDEX IF NOT EXISTS idx_table_daily_status_day
  ON table_daily_status (day);
CREATE INDEX IF NOT EXISTS idx_table_daily_status_table
  ON table_daily_status (table_id);

ALTER TABLE table_daily_status ENABLE ROW LEVEL SECURITY;

-- Public read: the booking wizard must see the chosen day's statuses.
DROP POLICY IF EXISTS "table_daily_status_select_all" ON table_daily_status;
CREATE POLICY "table_daily_status_select_all" ON table_daily_status FOR SELECT
  TO anon, authenticated USING (true);

-- Only staff/admin can set a day's status.
DROP POLICY IF EXISTS "table_daily_status_insert_staff" ON table_daily_status;
CREATE POLICY "table_daily_status_insert_staff" ON table_daily_status FOR INSERT
  TO authenticated WITH CHECK (get_user_role() IN ('staff', 'admin'));

DROP POLICY IF EXISTS "table_daily_status_update_staff" ON table_daily_status;
CREATE POLICY "table_daily_status_update_staff" ON table_daily_status FOR UPDATE
  TO authenticated
  USING (get_user_role() IN ('staff', 'admin'))
  WITH CHECK (get_user_role() IN ('staff', 'admin'));

DROP POLICY IF EXISTS "table_daily_status_delete_staff" ON table_daily_status;
CREATE POLICY "table_daily_status_delete_staff" ON table_daily_status FOR DELETE
  TO authenticated USING (get_user_role() IN ('staff', 'admin'));

-- Keep updated_at current on every write, mirroring the reservations trigger.
CREATE OR REPLACE FUNCTION set_table_daily_status_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_table_daily_status_updated_at ON table_daily_status;
CREATE TRIGGER trg_table_daily_status_updated_at
  BEFORE UPDATE ON table_daily_status
  FOR EACH ROW
  EXECUTE FUNCTION set_table_daily_status_updated_at();
