/*
  # Confirm Arrival occupies the table

  Confirm Arrival is staff's hand signal that the guest is in the restaurant,
  so the table reads Occupied everywhere right away — Tables page, dashboard
  floor, and the customer booking wizard (all three derive it from live
  statuses through the shared day resolver).

  confirm_reservation_arrival flips the reservation's table to `occupied` in
  the same transaction, mirroring what seat_reservation_guest already does.
  A permanent out-of-service table is never touched: staff must take it back
  into service first, and the operation still fails loudly otherwise.

  Confirm Booking keeps the table Reserved (unchanged — no table write there
  by design). Done Eating still frees the table (migration
  20261019000000_done_eating_releases_table).
*/

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

  -- The guest is in the restaurant: occupy the table right away, in the same
  -- transaction. Seat Guest keeps it occupied; Done Eating releases it.
  IF v_row.table_id IS NOT NULL THEN
    UPDATE restaurant_tables
    SET status = 'occupied'
    WHERE id = v_row.table_id
      AND status <> 'out_of_service';
  END IF;

  PERFORM log_reservation_event(
    p_reservation_id, 'confirmed', 'arrived', 'confirm_arrival'
  );

  RETURN v_row;
END;
$$;
