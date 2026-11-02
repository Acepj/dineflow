/*
# Menu item image storage bucket

Persists menu-item photos uploaded from the admin "New Menu Item" modal.

The client (app/(dashboard)/menu-management/items/page.tsx) uploads the chosen
file to a public Supabase Storage bucket and stores the returned public URL in
`menu_items.image_url` — the same column already used for pasted image links. No
new database column or schema is introduced.

What this migration does
------------------------
1. Creates a public bucket `menu-images` (idempotent — safe to re-run) with a
   5 MB size cap and an allow-list of image MIME types, so oversized or
   non-image uploads are rejected server-side as well as client-side.
2. Grants RLS on `storage.objects` for that bucket, mirroring the existing
   menu_items write model:
     - anyone (anon + authenticated) may read, so the public menu/cart pages can
       display the photos;
     - only staff/admin may upload, update, or delete (get_user_role()).

Role source of truth is get_user_role() (profiles-first), consistent with the
rest of the project's RLS.
*/

-- 1. Bucket ------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'menu-images',
  'menu-images',
  true,
  5242880, -- 5 MB, matches the client-side MAX_IMAGE_MB guardrail
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. RLS on storage.objects for the menu-images bucket -----------------------
-- Drop first so the migration is re-runnable.
DROP POLICY IF EXISTS "menu_images_public_read" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_insert_staff" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_update_staff" ON storage.objects;
DROP POLICY IF EXISTS "menu_images_delete_staff" ON storage.objects;

-- Public read: menu photos are shown on the customer menu, cart, and dashboard.
CREATE POLICY "menu_images_public_read" ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'menu-images');

-- Staff/admin write. Mirrors menu_items_update_staff / _insert_admin.
CREATE POLICY "menu_images_insert_staff" ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'menu-images'
    AND get_user_role() IN ('staff', 'admin')
  );

CREATE POLICY "menu_images_update_staff" ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'menu-images'
    AND get_user_role() IN ('staff', 'admin')
  );

CREATE POLICY "menu_images_delete_staff" ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'menu-images'
    AND get_user_role() IN ('staff', 'admin')
  );
