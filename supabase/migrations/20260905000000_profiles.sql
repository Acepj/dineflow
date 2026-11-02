/*
# Auth profiles and role directory

- Links one profile to each Supabase Auth user.
- Stores the DineFlow role used by the application.
- Creates profiles automatically when Auth users sign up.
- Backfills profiles for Auth users that already exist.
*/

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(full_name) >= 2),
  email text,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'staff', 'admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles (role);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles (status);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_self_or_staff" ON public.profiles;
CREATE POLICY "profiles_select_self_or_staff"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR get_user_role() IN ('staff', 'admin')
  );

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  metadata_role text;
BEGIN
  metadata_role := lower(COALESCE(new.raw_user_meta_data ->> 'role', 'user'));
  IF metadata_role NOT IN ('user', 'staff', 'admin') THEN
    metadata_role := 'user';
  END IF;

  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (
    new.id,
    COALESCE(NULLIF(new.raw_user_meta_data ->> 'full_name', ''), split_part(COALESCE(new.email, 'User'), '@', 1)),
    new.email,
    metadata_role
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    updated_at = now();

  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_auth_user();

INSERT INTO public.profiles (id, full_name, email, role)
SELECT
  users.id,
  COALESCE(NULLIF(users.raw_user_meta_data ->> 'full_name', ''), split_part(COALESCE(users.email, 'User'), '@', 1)),
  users.email,
  CASE lower(COALESCE(users.raw_user_meta_data ->> 'role', 'user'))
    WHEN 'admin' THEN 'admin'
    WHEN 'staff' THEN 'staff'
    ELSE 'user'
  END
FROM auth.users AS users
ON CONFLICT (id) DO NOTHING;
