/*
# Customer order cancellation (queued/preparing -> cancelled)

Problem this solves
- Customers could not cancel their own orders: the only UPDATE policy on
  `orders` was `orders_update_staff` (staff/admin), so a customer's update
  touched zero rows and the UI had no server-backed way to cancel.
- Hiding/showing a button is not enough on its own: the rules must also hold
  in the database so a crafted request cannot cancel another customer's order
  or an order that is already serving/served/cancelled.

Changes
1. RLS `orders_update_cancel_self` - an authenticated customer may UPDATE a
   row only when it is their own (customer_id via get_current_customer_id(),
   or the direct user_id link) AND still 'queued' or 'preparing', and the new
   row must be their own order whose status is 'cancelled'. Ownership,
   eligibility and the final state are therefore enforced server-side.
   Staff/admin keep their existing `orders_update_staff` policy untouched
   (policies for the same command are OR'd), so operational access to
   cancelled orders for records, billing and sales reports is preserved.
2. Trigger `orders_guard_customer_update` - for authenticated non-staff
   updates, only `status` (plus the `updated_at` bookkeeping column) may
   change and the transition must be queued/preparing -> cancelled on the
   caller's own order. This keeps subtotal/service charge/tax/discount/total
   and every other column intact while a customer cancels. Staff/admin, the
   service role, anon and direct SQL sessions (no JWT) are unaffected.

Cancellation only flips `orders.status` - no rows are deleted: order items,
payments and financial history remain for billing and reports. Tables other
than `orders` (and its policies) are not modified.
*/

-- 1. RLS: a customer cancels only their own eligible orders ----------------
DROP POLICY IF EXISTS "orders_update_cancel_self" ON orders;
CREATE POLICY "orders_update_cancel_self" ON orders FOR UPDATE
  TO authenticated
  USING (
    (customer_id = get_current_customer_id() OR user_id = auth.uid())
    AND status IN ('queued', 'preparing')
  )
  WITH CHECK (
    (customer_id = get_current_customer_id() OR user_id = auth.uid())
    AND status = 'cancelled'
  );

-- 2. Guard trigger: customer updates are status-only cancellations ----------
CREATE OR REPLACE FUNCTION public.orders_guard_customer_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Restrict only authenticated, non-staff callers: staff/admin keep full
  -- update access via orders_update_staff, and the service role, anon and
  -- direct SQL sessions (no JWT) are outside this customer flow.
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'authenticated' THEN
    RETURN new;
  END IF;
  IF get_user_role() IN ('staff', 'admin') THEN
    RETURN new;
  END IF;

  -- A customer may change only the status column (updated_at is bookkeeping).
  IF (to_jsonb(old) - 'status' - 'updated_at')
     IS DISTINCT FROM
     (to_jsonb(new) - 'status' - 'updated_at') THEN
    RAISE EXCEPTION 'Cancelling an order may only change its status.';
  END IF;

  -- ...from queued/preparing to cancelled...
  IF old.status NOT IN ('queued', 'preparing')
     OR new.status <> 'cancelled' THEN
    RAISE EXCEPTION 'This order can no longer be cancelled.';
  END IF;

  -- ...on an order the caller owns (mirrors orders_update_cancel_self).
  IF (new.customer_id IS DISTINCT FROM get_current_customer_id())
     AND (new.user_id IS DISTINCT FROM auth.uid()) THEN
    RAISE EXCEPTION 'You can only cancel your own orders.';
  END IF;

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS orders_guard_customer_update ON orders;
CREATE TRIGGER orders_guard_customer_update
  BEFORE UPDATE ON orders
  FOR EACH ROW
  EXECUTE FUNCTION public.orders_guard_customer_update();
