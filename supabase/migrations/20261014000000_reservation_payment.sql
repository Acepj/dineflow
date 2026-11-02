/*
 * # Reservation payment choice (customer booking wizard)
 *
 * The booking wizard's "Your details" step lets the customer settle the
 * reservation as either `cash` (paid at the restaurant on arrival) or
 * `online` (paid immediately while booking: GCash / card, recorded with a
 * reference). Reservations carry no fee in this system, so the choice is
 * recorded directly on the reservation row rather than in `payments`
 * (which settles `orders` only).
 *
 * Changes
 * 1. `reservations.payment_method` — 'cash' | 'online', null for bookings
 *    made before this migration (or walk-ins taken by staff tooling).
 * 2. `reservations.payment_status` — 'unpaid' (cash on arrival) | 'paid'
 *    (online), defaults to 'unpaid'.
 * 3. `reservations.payment_reference` — online settlement reference,
 *    null for cash.
 *
 * Security
 * - No new RLS policies: the existing `public_read_reservations` and
 *   `public_insert_reservations` policies already cover these columns, so
 *   the wizard insert keeps working unchanged.
 */

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS payment_method text
    CHECK (payment_method IS NULL OR payment_method IN ('cash', 'online'));

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'paid'));

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS payment_reference text;
