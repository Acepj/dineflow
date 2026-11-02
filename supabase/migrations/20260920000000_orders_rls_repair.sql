/*
# Repair drifted orders RLS + harden the cancellation guard

Problem this solves
1. The remote database still carries the original wide-open policies from
   20260827180324_0002 (public_read_orders / public_insert_orders /
   public_update_orders / public_delete_orders) even though 20260904000000
   dropped them and replaced them with scoped policies (orders_select_self /
   orders_select_anon / orders_insert_public / orders_update_staff /
   orders_delete_admin). Behavioural probes against the linked project
   confirmed the drift: the publishable (anon) key alone could SELECT every
   order and UPDATE any order - including flipping statuses - and an
   authenticated customer could read/update rows they do not own.
2. The cancellation guard from 20260919000000 skipped anon callers (it only
   checked 'authenticated') and its ownership test treated a NULL-linked
   (guest) order as "owned" by anyone, because NULL IS DISTINCT FROM NULL is
   false.

Changes
1. Drop the four drifted public_* policies on `orders`. Nothing else changes:
   orders_select_self (customers + staff/admin by role), orders_select_anon
   (false), orders_insert_public (guest checkout), orders_update_staff
   (staff/admin operational access - unchanged, so staff and admin keep full
   access to cancelled orders for records, billing and sales reports),
   orders_delete_admin (admin), orders_update_cancel_self (customer
   cancellation) and the orders_select_self / history policies all remain.
2. Re-create orders_guard_customer_update: cover 'anon' and 'authenticated'
   JWT callers, and require a non-NULL ownership link (customer_id or
   user_id) so a NULL-linked order can never be modified by a caller who does
   not own it. Staff/admin, the service role and direct SQL (no JWT) stay
   unaffected. Still status-only: no rows or columns are deleted or altered
   beyond `status`/`updated_at` during a cancellation.
*/

-- 1. Drop the drifted wide-open policies (IF EXISTS = no-op if absent) ------
DROP POLICY IF EXISTS "public_read_orders" ON orders;
DROP POLICY IF EXISTS "public_insert_orders" ON orders;
DROP POLICY IF EXISTS "public_update_orders" ON orders;
DROP POLICY IF EXISTS "public_delete_orders" ON orders;

-- 2. Harden the cancellation guard ------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_guard_customer_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Restrict JWT callers with a customer-update path: authenticated and anon.
  -- Staff/admin keep full update access via orders_update_staff; the service
  -- role and direct SQL sessions (no JWT) are outside this flow.
  IF COALESCE(auth.jwt() ->> 'role', '') NOT IN ('authenticated', 'anon') THEN
    RETURN new;
  END IF;
  IF get_user_role() IN ('staff', 'admin') THEN
    RETURN new;
  END IF;

  -- A caller may change only the status column (updated_at is bookkeeping).
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

  -- ...on an order the caller owns. NULL links never match (a guest order is
  -- nobody's to cancel from the client), mirroring orders_update_cancel_self.
  IF NOT (
       (new.customer_id IS NOT NULL
        AND new.customer_id = get_current_customer_id())
    OR (new.user_id IS NOT NULL
        AND new.user_id = auth.uid())
  ) THEN
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
