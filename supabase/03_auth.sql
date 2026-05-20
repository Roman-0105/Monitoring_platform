-- ============================================================
-- Auth: profiles table + RLS updates
-- Run AFTER 01_schema.sql and 02_storage.sql
-- ============================================================

-- ── Profiles table ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text        NOT NULL DEFAULT '',
  role         text        NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Helper: check if current user is admin (SECURITY DEFINER bypasses RLS)
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT role = 'admin' FROM profiles WHERE id = auth.uid()),
    false
  );
$$;

-- Policies for profiles
CREATE POLICY "profiles_select" ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_admin());

CREATE POLICY "profiles_update_own" ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- ── Drop old anon policies on main tables ─────────────────────
DROP POLICY IF EXISTS "anon read points"   ON points;
DROP POLICY IF EXISTS "anon write points"  ON points;
DROP POLICY IF EXISTS "anon update points" ON points;
DROP POLICY IF EXISTS "anon delete points" ON points;

DROP POLICY IF EXISTS "anon read ditches"   ON ditches;
DROP POLICY IF EXISTS "anon write ditches"  ON ditches;
DROP POLICY IF EXISTS "anon update ditches" ON ditches;
DROP POLICY IF EXISTS "anon delete ditches" ON ditches;

DROP POLICY IF EXISTS "anon read workers"   ON workers;
DROP POLICY IF EXISTS "anon write workers"  ON workers;
DROP POLICY IF EXISTS "anon update workers" ON workers;
DROP POLICY IF EXISTS "anon delete workers" ON workers;

DROP POLICY IF EXISTS "anon read schemes"   ON schemes;
DROP POLICY IF EXISTS "anon write schemes"  ON schemes;
DROP POLICY IF EXISTS "anon update schemes" ON schemes;
DROP POLICY IF EXISTS "anon delete schemes" ON schemes;

-- ── New authenticated policies ────────────────────────────────
-- points
CREATE POLICY "auth_points_select" ON points FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_points_insert" ON points FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_points_update" ON points FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_points_delete" ON points FOR DELETE TO authenticated USING (true);

-- ditches
CREATE POLICY "auth_ditches_select" ON ditches FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_ditches_insert" ON ditches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_ditches_update" ON ditches FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_ditches_delete" ON ditches FOR DELETE TO authenticated USING (true);

-- workers
CREATE POLICY "auth_workers_select" ON workers FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_workers_insert" ON workers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_workers_update" ON workers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_workers_delete" ON workers FOR DELETE TO authenticated USING (true);

-- schemes
CREATE POLICY "auth_schemes_select" ON schemes FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_schemes_insert" ON schemes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_schemes_update" ON schemes FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_schemes_delete" ON schemes FOR DELETE TO authenticated USING (true);

-- ── Storage policies update ───────────────────────────────────
DROP POLICY IF EXISTS "anon upload photos"  ON storage.objects;
DROP POLICY IF EXISTS "anon read photos"    ON storage.objects;
DROP POLICY IF EXISTS "anon delete photos"  ON storage.objects;
DROP POLICY IF EXISTS "anon upload schemes" ON storage.objects;
DROP POLICY IF EXISTS "anon read schemes"   ON storage.objects;
DROP POLICY IF EXISTS "anon delete schemes" ON storage.objects;
DROP POLICY IF EXISTS "anon update schemes" ON storage.objects;

CREATE POLICY "auth_read_photos"   ON storage.objects FOR SELECT    TO authenticated USING (bucket_id = 'photos');
CREATE POLICY "auth_upload_photos" ON storage.objects FOR INSERT    TO authenticated WITH CHECK (bucket_id = 'photos');
CREATE POLICY "auth_delete_photos" ON storage.objects FOR DELETE    TO authenticated USING (bucket_id = 'photos');

CREATE POLICY "auth_read_schemes"   ON storage.objects FOR SELECT   TO authenticated USING (bucket_id = 'schemes');
CREATE POLICY "auth_upload_schemes" ON storage.objects FOR INSERT   TO authenticated WITH CHECK (bucket_id = 'schemes');
CREATE POLICY "auth_update_schemes" ON storage.objects FOR UPDATE   TO authenticated USING (bucket_id = 'schemes');
CREATE POLICY "auth_delete_schemes" ON storage.objects FOR DELETE   TO authenticated USING (bucket_id = 'schemes');
