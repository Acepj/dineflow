/*
# Link reservations to the authenticated user

Reservations were matched to a customer only by phone, which broke whenever the
booking phone didn't equal the customer's saved phone (e.g. accounts created
before customers rows existed, or a booking made with a different number).

Changes
1. `reservations.user_id` — a direct link to the auth user, set at booking time
   for signed-in customers.
2. Backfill: attach existing reservations to a customer by matching the
   reservation's email to that user's customers.email (case-insensitive). This
   recovers bookings made under the same email as the account.
3. RLS: a customer may SELECT reservations they own by `user_id`, in addition to
   the existing public-read policy (which staff/admin rely on). The public-read
   policy is left intact so nothing regresses.
*/

-- 1. Direct user link on reservations --------------------------------------
ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reservations_user_id ON reservations (user_id);

-- 2. Backfill user_id from the matching customer email ---------------------
UPDATE reservations r
SET user_id = c.user_id
FROM customers c
WHERE r.user_id IS NULL
  AND c.user_id IS NOT NULL
  AND c.email IS NOT NULL
  AND lower(r.email) = lower(c.email);

-- 2b. Also backfill by matching the reservation email to the auth user's email
-- directly (covers accounts whose customers.email is empty or differs).
UPDATE reservations r
SET user_id = u.id
FROM auth.users u
WHERE r.user_id IS NULL
  AND u.email IS NOT NULL
  AND lower(r.email) = lower(u.email);

-- 3. RLS: let a customer read their own reservations by user_id ------------
DROP POLICY IF EXISTS "reservations_select_self" ON reservations;
CREATE POLICY "reservations_select_self" ON reservations FOR SELECT
  TO authenticated USING (user_id = auth.uid());
