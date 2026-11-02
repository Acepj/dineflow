/*
  Allow `out_of_service` as a per-day table status.

  `table_daily_status.status` was originally restricted to
  available / occupied / reserved / served, because `out_of_service` was treated
  only as a permanent, day-independent property of `restaurant_tables`. Staff
  now also want to take a table out of service for one specific day (e.g. a
  broken table that will be fixed tomorrow), so the day-status vocabulary is
  widened to include `out_of_service`.

  The resolver in lib/table-availability.ts already treats an out_of_service
  day-override as day-scoped: it wins over "available" but still loses to a real
  reservation and to a permanent out-of-service flag on the physical table.
*/

-- Drop the original inline CHECK (Postgres names it <table>_<column>_check).
ALTER TABLE table_daily_status
  DROP CONSTRAINT IF EXISTS table_daily_status_status_check;

ALTER TABLE table_daily_status
  ADD CONSTRAINT table_daily_status_status_check
  CHECK (status IN ('available', 'occupied', 'reserved', 'served', 'out_of_service'));