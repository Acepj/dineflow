/*
# Backfill reservation ownership by auth email

Incremental follow-up to 20260917000000: also attribute pre-existing
reservations to an auth user when the reservation email matches that user's
auth email (covers accounts whose customers.email was empty or different).
Idempotent — only touches rows still missing a user_id.
*/

UPDATE reservations r
SET user_id = u.id
FROM auth.users u
WHERE r.user_id IS NULL
  AND u.email IS NOT NULL
  AND lower(r.email) = lower(u.email);
