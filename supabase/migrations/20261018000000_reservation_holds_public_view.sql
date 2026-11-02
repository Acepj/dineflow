/*
  # Public availability view: `reservation_holds`

  Problem this solves
  -------------------
  The booking wizard's "Pick your table" step derives each table's status for
  the chosen day from OTHER customers' reservations plus staff day-overrides
  (migration 20261015000000_table_daily_status). But the reservations query
  runs under RLS: per migration 20260904000000_0004_auth_links_and_rls, a
  signed-in customer only sees the whole reservations table when a `customers`
  row is already linked to their account — otherwise `reservations_select_self`
  shows them just their OWN rows. Any account that books without a linked
  profile therefore saw every booked table as "Available" and could click
  tables that were already taken.

  Widening the `reservations` SELECT policy is not an option: reservations
  carry guest PII (name, phone, email, special requests) that must not become
  readable by every customer.

  Model
  -----
  `reservation_holds` is a slim view exposing exactly the four columns the
  availability resolver consumes:
      table_id, status, reserved_from, reserved_to
  It runs with its owner's rights (the Postgres view default — the base table
  has no FORCE ROW LEVEL SECURITY), so it reads every reservation row
  regardless of the per-row policies, while the base table's strict RLS stays
  untouched for every PII-bearing query. SELECT is granted to anon and
  authenticated, mirroring the public-read style of `table_daily_status`.
*/

CREATE OR REPLACE VIEW public.reservation_holds AS
SELECT table_id, status, reserved_from, reserved_to
  FROM public.reservations;

REVOKE ALL ON public.reservation_holds FROM PUBLIC;
GRANT SELECT ON public.reservation_holds TO anon, authenticated;
