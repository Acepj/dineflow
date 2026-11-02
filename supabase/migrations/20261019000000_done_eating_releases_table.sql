/*
  # Done Eating releases the table

  Product change
  --------------
  Marking a reservation `done_eating` now frees the table immediately instead
  of holding it until `completed`:

    - the Tables page and the dashboard floor (lib/table-availability.ts) show
      the table as Available again the moment staff click "Done eating";
    - the customer booking wizard offers the table for that slot, so customer
      availability follows the staff/admin action;
    - a new overlapping booking is accepted.

  Implementation
  --------------
  1. `is_table_holding_status()` drops `done_eating`, so the exclusion
     constraint, the unique-phone index and the conflict/release helpers all
     stop treating a finished meal as a hold.
  2. The constraint and the unique index are rebuilt so their entries are
     recomputed with the new function. The new holding set is a strict subset
     of the old one, so existing data can never violate either object.
  3. `mark_reservation_done_eating` releases the live floor status via
     `release_table_if_idle()` in the same transaction, mirroring what
     `complete_reservation` already does.
*/

-- 1. A finished meal no longer holds the table. ----------------------------
CREATE OR REPLACE FUNCTION is_table_holding_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status IN ('pending', 'confirmed', 'arrived', 'seated');
$$;

-- 2. Rebuild the exclusion constraint and the unique-phone index so their
--    entries are recomputed with the narrower holding set.
ALTER TABLE reservations
  DROP CONSTRAINT IF EXISTS no_overlapping_reservations;

ALTER TABLE reservations
  ADD CONSTRAINT no_overlapping_reservations
  EXCLUDE USING gist (
    table_id WITH =,
    tstzrange(reserved_from, reserved_to) WITH &&
  ) WHERE (is_table_holding_status(status) AND table_id IS NOT NULL);

DROP INDEX IF EXISTS idx_unique_phone_window;

CREATE UNIQUE INDEX idx_unique_phone_window
  ON reservations (phone, reserved_from, reserved_to)
  WHERE (is_table_holding_status(status));

-- 3. Done Eating releases the live floor status in the same transaction. ---
CREATE OR REPLACE FUNCTION mark_reservation_done_eating(p_reservation_id uuid)
RETURNS reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row reservations;
BEGIN
  PERFORM assert_reservation_staff();
  v_row := lock_reservation(p_reservation_id);

  IF v_row.status <> 'seated' THEN
    RAISE EXCEPTION 'Only a seated guest can be marked done eating (current status: %).', v_row.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE reservations
  SET status = 'done_eating',
      done_eating_at = now(),
      done_eating_by = auth.uid()
  WHERE id = p_reservation_id
  RETURNING * INTO v_row;

  -- The guest has finished: the table is free again immediately — it reads as
  -- Available on the floor views and customers may book it. release_table_if_idle()
  -- re-checks that no other table-holding reservation still owns this table, so
  -- a later booking for the same slot is never stolen. The status update and
  -- this release share one transaction.
  PERFORM release_table_if_idle(v_row.table_id);

  PERFORM log_reservation_event(
    p_reservation_id, 'seated', 'done_eating', 'mark_done_eating'
  );

  RETURN v_row;
END;
$$;
