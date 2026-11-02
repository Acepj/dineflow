/*
# Customer Reservation Lifecycle

Implements the full service lifecycle for a reservation:

    pending –€→ confirmed (Reserved) –€→ arrived –€→ seated –€→ done_eating –€→ completed
                                                            (Order History)

Design notes
------------
1. Only two statuses are new (`arrived`, `done_eating`). `confirmed` is
   relabelled "Reserved" in the UI and is the state a booking sits in until the
   guest physically arrives, so no existing booking has to migrate.
2. Reservations are never moved between tables. "Order History" is a query over
   `status = 'completed'`, which keeps orders, payments and history in one place
   and makes duplicate archive rows impossible by construction.
3. Every status change goes through a SECURITY DEFINER function. These are the
   project's server-side "endpoints": they own the authorization check, the
   transition rules, the multi-row writes (reservation + table + audit) and the
   error messages. A function body is a single implicit transaction, so any
   failure rolls back the reservation row, the table status and the audit entry
   together.
4. Each function locks the reservation row FOR UPDATE before reading its
   status. Two staff members clicking "Seat Guest" at the same moment therefore
   serialise: the second re-reads a status that no longer permits the transition
   and is rejected instead of double-processing.
*/

-- 1. Status vocabulary ----------------------------------------------------
ALTER TABLE reservations
  DROP CONSTRAINT IF EXISTS reservations_status_check;

ALTER TABLE reservations
  ADD CONSTRAINT reservations_status_check
  CHECK (status IN (
    'pending',
    'confirmed',
    'arrived',
    'seated',
    'done_eating',
    'completed',
    'cancelled',
    'no_show'
  ));

-- 2. Lifecycle timestamps and the staff/admin who performed each step ------
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS arrived_at     timestamptz,
  ADD COLUMN IF NOT EXISTS arrived_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seated_at      timestamptz,
  ADD COLUMN IF NOT EXISTS seated_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS done_eating_at timestamptz,
  ADD COLUMN IF NOT EXISTS done_eating_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_arrived_at ON reservations (arrived_at);
CREATE INDEX IF NOT EXISTS idx_reservations_completed_at ON reservations (completed_at);

-- 3. Table-holding statuses ----------------------------------------------
-- A table is held from `pending` (a booking exists) all the way through
-- `done_eating`. `restaurant_tables.status` has no "cleaning" value — the
-- vocabulary is available/occupied/reserved/out_of_service — so a guest who
-- has finished eating keeps holding the table until staff complete the
-- reservation. That is what stops a new booking from grabbing a table that
-- still needs clearing.
--
-- The release happens in `complete_reservation`, which is the point where the
-- table-clearing requirement is considered satisfied.
CREATE OR REPLACE FUNCTION is_table_holding_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status IN ('pending', 'confirmed', 'arrived', 'seated', 'done_eating');
$$;

-- 4. Rebuild the overlap exclusion constraint with the new statuses --------
ALTER TABLE reservations
  DROP CONSTRAINT IF EXISTS no_overlapping_reservations;

ALTER TABLE reservations
  ADD CONSTRAINT no_overlapping_reservations
  EXCLUDE USING gist (
    table_id WITH =,
    tstzrange(reserved_from, reserved_to) WITH &&
  ) WHERE (is_table_holding_status(status) AND table_id IS NOT NULL);

-- 5. Same treatment for the duplicate-phone-per-window index --------------
DROP INDEX IF EXISTS idx_unique_phone_window;

CREATE UNIQUE INDEX idx_unique_phone_window
  ON reservations (phone, reserved_from, reserved_to)
  WHERE (is_table_holding_status(status));

-- 6. Audit trail ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS reservation_status_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id  uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  previous_status text,
  new_status      text,
  action          text NOT NULL,
  performed_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reservation_events_reservation
  ON reservation_status_events (reservation_id, created_at DESC);

ALTER TABLE reservation_status_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reservation_events_select_staff" ON reservation_status_events;
CREATE POLICY "reservation_events_select_staff" ON reservation_status_events
  FOR SELECT TO authenticated USING (get_user_role() IN ('staff', 'admin'));

-- No INSERT/UPDATE/DELETE policy: rows are written only by the SECURITY
-- DEFINER functions below, so the trail cannot be edited or forged from the
-- client. (Those functions run as the owner and bypass RLS.)

-- 7. Shared helpers -------------------------------------------------------

-- Lock the row and return it, or raise if it no longer exists. The FOR UPDATE
-- is what makes concurrent clicks on the same reservation safe.
CREATE OR REPLACE FUNCTION lock_reservation(p_reservation_id uuid)
RETURNS reservations
LANGUAGE plpgsql
AS $$
DECLARE
  v_row reservations;
BEGIN
  SELECT * INTO v_row
  FROM reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reservation not found.'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION assert_reservation_staff()
RETURNS void
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF get_user_role() NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Only staff and admins can change a reservation.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- Find the first table-holding reservation for the same table/window.
-- Returns NULL (not FOUND) when there is no clash; callers test `.id`.
CREATE OR REPLACE FUNCTION find_reservation_conflict(
  p_table_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_exclude_id uuid
)
RETURNS reservations
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_row reservations;
BEGIN
  SELECT * INTO v_row
  FROM reservations
  WHERE table_id = p_table_id
    AND id <> p_exclude_id
    AND is_table_holding_status(status)
    AND reserved_from < p_to
    AND reserved_to > p_from
  ORDER BY reserved_from
  LIMIT 1;

  RETURN v_row;
END;
$$;

-- Release a table, but only when no *other* table-holding reservation is
-- still using it. Prevents freeing a table that a later booking now owns.
CREATE OR REPLACE FUNCTION release_table_if_idle(p_table_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_still_used boolean;
BEGIN
  IF p_table_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM reservations
    WHERE table_id = p_table_id
      AND is_table_holding_status(status)
  ) INTO v_still_used;

  IF NOT v_still_used THEN
    UPDATE restaurant_tables
    SET status = 'available'
    WHERE id = p_table_id
      AND status <> 'out_of_service';
  END IF;
END;
$$;

-- Append an audit entry. Called only after a successful state change.
CREATE OR REPLACE FUNCTION log_reservation_event(
  p_reservation_id uuid,
  p_previous_status text,
  p_new_status text,
  p_action text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO reservation_status_events (
    reservation_id, previous_status, new_status, action, performed_by
  )
  VALUES (
    p_reservation_id, p_previous_status, p_new_status, p_action, auth.uid()
  );
END;
$$;

-- 8. Restrict the exposed surface to authenticated callers ----------------
REVOKE ALL ON FUNCTION lock_reservation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION assert_reservation_staff() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION find_reservation_conflict(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION release_table_if_idle(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION log_reservation_event(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION is_table_holding_status(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION lock_reservation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION assert_reservation_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION find_reservation_conflict(uuid, timestamptz, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION release_table_if_idle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION log_reservation_event(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION is_table_holding_status(text) TO authenticated, anon;


-- 9. Lifecycle endpoints --------------------------------------------------
-- Each one: authorize → lock → check current status → write → audit.

-- Status 1: Accept a pending booking (pending -> confirmed/"Reserved") -----
-- The first step of the chain. Without this endpoint the "Confirm booking"
-- button has nothing to call, so a pending reservation can never advance.
CREATE OR REPLACE FUNCTION confirm_reservation_booking(p_reservation_id uuid)
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

  IF v_row.status = 'confirmed' THEN
    RAISE EXCEPTION 'This reservation has already been confirmed.'
      USING ERRCODE = '22023';
  END IF;

  IF v_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Only a Pending reservation can be confirmed (current status: %).', v_row.status
      USING ERRCODE = '22023';
  END IF;

  -- `pending` -> `confirmed` keeps holding the table, so the table's status is
  -- unchanged and release_table_if_idle() would be a no-op. Not called
  -- deliberately: releasing here would free a table that is still booked.
  UPDATE reservations
  SET status = 'confirmed'
  WHERE id = p_reservation_id
  RETURNING * INTO v_row;

  PERFORM log_reservation_event(
    p_reservation_id, 'pending', 'confirmed', 'confirm_booking'
  );

  RETURN v_row;
END;
$$;

-- Status 2: Confirmed Arrival ---------------------------------------------
CREATE OR REPLACE FUNCTION confirm_reservation_arrival(p_reservation_id uuid)
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

  IF v_row.status = 'arrived' THEN
    RAISE EXCEPTION 'Arrival was already confirmed for this reservation.'
      USING ERRCODE = '22023';
  END IF;

  IF v_row.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Only a Reserved reservation can confirm arrival (current status: %).', v_row.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE reservations
  SET status = 'arrived',
      arrived_at = now(),
      arrived_by = auth.uid()
  WHERE id = p_reservation_id
  RETURNING * INTO v_row;

  PERFORM log_reservation_event(
    p_reservation_id, 'confirmed', 'arrived', 'confirm_arrival'
  );

  RETURN v_row;
END;
$$;

-- Status 3: Seated --------------------------------------------------------
CREATE OR REPLACE FUNCTION seat_reservation_guest(
  p_reservation_id uuid,
  p_table_id uuid DEFAULT NULL
)
RETURNS reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row reservations;
  v_table restaurant_tables;
  v_previous_table_id uuid;
  v_effective_table_id uuid;
  v_conflict reservations;
BEGIN
  PERFORM assert_reservation_staff();
  v_row := lock_reservation(p_reservation_id);

  IF v_row.status <> 'arrived' THEN
    RAISE EXCEPTION 'Arrival must be confirmed before seating the guest (current status: %).', v_row.status
      USING ERRCODE = '22023';
  END IF;

  -- Fall back to the reservation's existing table when none was passed.
  v_previous_table_id := v_row.table_id;
  v_effective_table_id := COALESCE(p_table_id, v_previous_table_id);

  IF v_effective_table_id IS NULL THEN
    RAISE EXCEPTION 'Please assign an available table before seating the guest.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_table
  FROM restaurant_tables
  WHERE id = v_effective_table_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That table no longer exists.' USING ERRCODE = 'P0002';
  END IF;

  IF v_table.status = 'out_of_service' THEN
    RAISE EXCEPTION 'Table % is out of service.', v_table.table_number
      USING ERRCODE = '22023';
  END IF;

  -- Server-side conflict check; the exclusion constraint is the final guard.
  -- Only meaningful when the guest is moved to a DIFFERENT table: seating on
  -- the reservation's own table can never conflict with itself.
  -- NOTE: test `v_conflict.id`, never FOUND … assigning a function's return
  -- value with := does not set FOUND in PL/pgSQL.
  IF v_effective_table_id IS DISTINCT FROM v_previous_table_id THEN
    v_conflict := find_reservation_conflict(
      v_effective_table_id,
      v_row.reserved_from,
      v_row.reserved_to,
      p_reservation_id
    );

    IF v_conflict.id IS NOT NULL THEN
      RAISE EXCEPTION 'This table is currently occupied by another reservation in that time slot.'
        USING ERRCODE = '23P01';
    END IF;
  END IF;

  UPDATE reservations
  SET status = 'seated',
      table_id = v_effective_table_id,
      seated_at = now(),
      seated_by = auth.uid()
  WHERE id = p_reservation_id
  RETURNING * INTO v_row;

  UPDATE restaurant_tables
  SET status = 'occupied'
  WHERE id = v_effective_table_id;

  -- Free the previous table only if the guest moved and nothing else uses it.
  IF v_previous_table_id IS DISTINCT FROM v_effective_table_id THEN
    PERFORM release_table_if_idle(v_previous_table_id);
  END IF;

  PERFORM log_reservation_event(
    p_reservation_id, 'arrived', 'seated', 'seat_guest'
  );

  RETURN v_row;
END;
$$;

-- Status 4: Done Eating (begins table clearing) ---------------------------
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

  -- The table is deliberately NOT released here. `done_eating` means the guest
  -- has finished eating, not that the table has been cleared. `restaurant_tables`
  -- has no "cleaning" status, so the table stays `occupied` and keeps holding the
  -- slot (see is_table_holding_status) until staff complete the reservation —
  -- which is where the clearing requirement is considered satisfied.
  PERFORM log_reservation_event(
    p_reservation_id, 'seated', 'done_eating', 'mark_done_eating'
  );

  RETURN v_row;
END;
$$;

-- Status 5: Complete & Move to Order History ------------------------------
CREATE OR REPLACE FUNCTION complete_reservation(p_reservation_id uuid)
RETURNS reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row reservations;
  v_table_id uuid;
BEGIN
  PERFORM assert_reservation_staff();
  v_row := lock_reservation(p_reservation_id);

  IF v_row.status = 'completed' THEN
    RAISE EXCEPTION 'This reservation has already been completed and moved to Order History.'
      USING ERRCODE = '22023';
  END IF;

  IF v_row.status <> 'done_eating' THEN
    RAISE EXCEPTION 'Only reservations marked Done Eating can be completed (current status: %).', v_row.status
      USING ERRCODE = '22023';
  END IF;

  v_table_id := v_row.table_id;

  UPDATE reservations
  SET status = 'completed',
      completed_at = now(),
      completed_by = auth.uid()
  WHERE id = p_reservation_id
  RETURNING * INTO v_row;

  -- This is the single point where the table is released. The guest finished
  -- eating one step earlier, so the table has had the whole Done Eating window
  -- to be cleared; completion is the requirement being satisfied.
  --
  -- release_table_if_idle() re-checks that no other table-holding reservation
  -- owns this table, so a later booking made for the same slot is never stolen.
  -- The status update and this release share one transaction: the reservation
  -- cannot end up completed while the table is still marked occupied, or vice
  -- versa.
  PERFORM release_table_if_idle(v_table_id);

  PERFORM log_reservation_event(
    p_reservation_id, 'done_eating', 'completed', 'complete_reservation'
  );

  RETURN v_row;
END;
$$;


-- Table assignment --------------------------------------------------------
-- Reused by both the standalone "Assign table" dialog and the Seat Guest flow
-- when staff picks a different table mid-service. All conflict rules live here
-- so the two paths can never disagree.
CREATE OR REPLACE FUNCTION assign_reservation_table(
  p_reservation_id uuid,
  p_table_id uuid
)
RETURNS reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row reservations;
  v_table restaurant_tables;
  v_previous_table_id uuid;
  v_conflict reservations;
BEGIN
  PERFORM assert_reservation_staff();
  v_row := lock_reservation(p_reservation_id);

  -- Once the guest is seated the table is fixed by the seating action itself,
  -- so assignment only applies to pre-service statuses.
  IF v_row.status NOT IN ('pending', 'confirmed', 'arrived') THEN
    RAISE EXCEPTION 'A % reservation can no longer be assigned a table.', v_row.status
      USING ERRCODE = '22023';
  END IF;

  v_previous_table_id := v_row.table_id;

  -- Clearing the assignment.
  IF p_table_id IS NULL THEN
    UPDATE reservations
    SET table_id = NULL
    WHERE id = p_reservation_id
    RETURNING * INTO v_row;

    PERFORM release_table_if_idle(v_previous_table_id);

    PERFORM log_reservation_event(
      p_reservation_id, v_previous_table_id::text, NULL, 'assign_table'
    );

    RETURN v_row;
  END IF;

  SELECT * INTO v_table
  FROM restaurant_tables
  WHERE id = p_table_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That table no longer exists.' USING ERRCODE = 'P0002';
  END IF;

  IF v_table.status = 'out_of_service' THEN
    RAISE EXCEPTION 'Table % is out of service.', v_table.table_number
      USING ERRCODE = '22023';
  END IF;

  v_conflict := find_reservation_conflict(
    p_table_id,
    v_row.reserved_from,
    v_row.reserved_to,
    p_reservation_id
  );

  IF v_conflict.id IS NOT NULL THEN
    RAISE EXCEPTION 'This table is currently occupied by another reservation in that time slot.'
      USING ERRCODE = '23P01';
  END IF;

  UPDATE reservations
  SET table_id = p_table_id
  WHERE id = p_reservation_id
  RETURNING * INTO v_row;

  -- A booking marks the table `reserved`; never downgrade an occupied table.
  UPDATE restaurant_tables
  SET status = CASE
    WHEN status = 'occupied' THEN 'occupied'
    ELSE 'reserved'
  END
  WHERE id = p_table_id;

  PERFORM release_table_if_idle(v_previous_table_id);

  PERFORM log_reservation_event(
    p_reservation_id, v_previous_table_id::text, p_table_id::text, 'assign_table'
  );

  RETURN v_row;
END;
$$;

-- Cancel / no-show --------------------------------------------------------
-- One endpoint for both terminal exits: they differ only in the resulting
-- status, and both must release the table.
CREATE OR REPLACE FUNCTION close_reservation(
  p_reservation_id uuid,
  p_close_status text
)
RETURNS reservations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row reservations;
  v_table_id uuid;
  v_status text;
BEGIN
  PERFORM assert_reservation_staff();

  IF p_close_status NOT IN ('cancelled', 'no_show') THEN
    RAISE EXCEPTION 'A reservation can only be closed as cancelled or no_show.'
      USING ERRCODE = '22023';
  END IF;

  v_row := lock_reservation(p_reservation_id);

  IF v_row.status IN ('completed', 'cancelled', 'no_show') THEN
    RAISE EXCEPTION 'This reservation is already closed (%); it cannot be changed again.', v_row.status
      USING ERRCODE = '22023';
  END IF;

  v_table_id := v_row.table_id;
  v_status := v_row.status;

  UPDATE reservations
  SET status = p_close_status
  WHERE id = p_reservation_id
  RETURNING * INTO v_row;

  -- Cancelling stops holding the table, so it frees up for other bookings.
  PERFORM release_table_if_idle(v_table_id);

  PERFORM log_reservation_event(
    p_reservation_id, v_status, p_close_status, 'close_reservation'
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION close_reservation(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION close_reservation(uuid, text) TO authenticated;


-- Audit trail for one reservation, newest first. Joins `profiles` so the
-- drawer can show who performed each step instead of a raw UUID.
CREATE OR REPLACE FUNCTION get_reservation_history(p_reservation_id uuid)
RETURNS TABLE (
  event_id uuid,
  reservation_id uuid,
  previous_status text,
  new_status text,
  action text,
  performed_by uuid,
  performed_by_name text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF get_user_role() NOT IN ('staff', 'admin') THEN
    RAISE EXCEPTION 'Only staff and admins can view reservation history.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    e.id,
    e.reservation_id,
    e.previous_status,
    e.new_status,
    e.action,
    e.performed_by,
    p.full_name,
    e.created_at
  FROM reservation_status_events AS e
  LEFT JOIN profiles AS p ON p.id = e.performed_by
  WHERE e.reservation_id = p_reservation_id
  ORDER BY e.created_at DESC;
END;
$$;

-- 11. Exposed surface -----------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC on new functions by default. Revoke it so
-- `anon` cannot even reach these endpoints; the internal assert_reservation_staff()
-- check is defence in depth on top of this.
REVOKE ALL ON FUNCTION confirm_reservation_booking(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION confirm_reservation_arrival(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION seat_reservation_guest(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION mark_reservation_done_eating(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION complete_reservation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION assign_reservation_table(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION get_reservation_history(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION confirm_reservation_booking(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_reservation_arrival(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION seat_reservation_guest(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_reservation_done_eating(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_reservation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION assign_reservation_table(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_reservation_history(uuid) TO authenticated;

