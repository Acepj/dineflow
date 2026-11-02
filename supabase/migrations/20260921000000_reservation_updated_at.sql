/*
# Track when a reservation was last updated

1. New column
- `reservations.updated_at` (timestamptz, default now()).

2. Trigger
- A BEFORE UPDATE trigger keeps `updated_at` current on every write so the
  staff Reservations dashboard can display a reliable "last updated" value.

3. Notes
- Existing rows get `now()` as their initial value; the app falls back to
  `created_at` when the column is absent, so this migration is safe to apply
  independently of a frontend deploy.
*/

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION set_reservations_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reservations_updated_at ON reservations;
CREATE TRIGGER trg_reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW
  EXECUTE FUNCTION set_reservations_updated_at();