-- ============================================================
-- Wells: restrict write access to admin (matches UI, which already
-- hides add/edit/delete controls for wells and well_measurements
-- from non-admin users — this migration makes the server enforce
-- what the client only used to hide).
-- Run AFTER 03_auth.sql and 04_wells.sql (needs is_admin()).
-- ============================================================

DROP POLICY IF EXISTS "auth_wells_insert" ON wells;
DROP POLICY IF EXISTS "auth_wells_update" ON wells;
DROP POLICY IF EXISTS "auth_wells_delete" ON wells;

CREATE POLICY "admin_wells_insert" ON wells FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "admin_wells_update" ON wells FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "admin_wells_delete" ON wells FOR DELETE TO authenticated USING (is_admin());
-- auth_wells_select stays unchanged: all authenticated users can read.

DROP POLICY IF EXISTS "auth_well_meas_insert" ON well_measurements;
DROP POLICY IF EXISTS "auth_well_meas_update" ON well_measurements;
DROP POLICY IF EXISTS "auth_well_meas_delete" ON well_measurements;

CREATE POLICY "admin_well_meas_insert" ON well_measurements FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "admin_well_meas_update" ON well_measurements FOR UPDATE TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "admin_well_meas_delete" ON well_measurements FOR DELETE TO authenticated USING (is_admin());
-- auth_well_meas_select stays unchanged: all authenticated users can read.
