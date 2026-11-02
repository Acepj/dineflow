/*
# get_user_role(): use the profiles role directory as the source of truth

Problem this solves
-------------------
The client resolves a user's role from the `profiles` table (the auth context
calls `enrichSession()` which reads `profiles.role`), so the UI shows the
admin/staff workspace. But RLS everywhere calls `get_user_role()`, which read
ONLY the JWT's `user_metadata.role` and never consulted `profiles`.

For any account whose role is correct in `profiles` but absent from the JWT
metadata — an admin/staff user provisioned outside the sign-up flow, or one
whose metadata was never updated — the database therefore evaluated
`get_user_role()` as 'user'. RLS then restricted every table to "rows you
own", and since an admin/staff member owns no orders or reservations, the
whole dashboard (today's sales, completed/open orders, reservations, live
feed, revenue, order mix, best sellers) rendered empty even though the data
exists and the same page shows it correctly for a staff JWT that carries a
role.

Fix
---
`get_user_role()` now prefers an explicit role on the JWT when present, and
otherwise falls back to `profiles.role` — the directory the app already treats
as authoritative. This makes RLS agree with the UI for every real staff/admin
account, without changing any policy.

Notes
-----
- SECURITY DEFINER so the function can read `public.profiles` without
  re-entering the `profiles_select_self_or_staff` policy (which itself calls
  get_user_role()); that would recurse. The lookup is scoped to the caller's
  own row (`id = auth.uid()`) and returns only a role string, so no other
  rows are exposed.
- JWT metadata still wins when present, so accounts that already work are
  unaffected. This is a pure widening for correctly-roled accounts that were
  being misread as 'user'.
- The built-in *demo* admin (a purely client-side fake session with no real
  Supabase JWT) still cannot read protected data — it has no server-side
  identity at all. Sign in with a real admin account to see live data.
*/

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    auth.jwt() -> 'user_metadata' ->> 'role',
    (SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()),
    'user'
  )::text;
$$;