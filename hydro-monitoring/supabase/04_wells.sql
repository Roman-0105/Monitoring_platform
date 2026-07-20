-- ============================================================
-- Horizontal wells: registry + measurements
-- Run AFTER 03_auth.sql
-- ============================================================

-- ── Wells registry ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wells (
  id               text        PRIMARY KEY,
  name             text        NOT NULL DEFAULT '',
  domain           text        NOT NULL DEFAULT '',
  depth            double precision,
  inclination      double precision,
  azimuth          double precision,
  drill_diameter   double precision,
  casing           text        NOT NULL DEFAULT '',
  drill_date       date,
  has_wellhead     boolean     NOT NULL DEFAULT false,
  flow_after_drill double precision,
  x_local          double precision,
  y_local          double precision,
  z_local          double precision,
  lat              double precision,
  lon              double precision,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wells ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_wells_select" ON wells FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_wells_insert" ON wells FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_wells_update" ON wells FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_wells_delete" ON wells FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS wells_name_idx       ON wells(name);
CREATE INDEX IF NOT EXISTS wells_drill_date_idx ON wells(drill_date DESC NULLS LAST);

-- ── Well measurements ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS well_measurements (
  id               text        PRIMARY KEY,
  well_id          text        NOT NULL REFERENCES wells(id) ON DELETE CASCADE,
  measurement_date date,
  flow_rate        double precision,
  worker           text        NOT NULL DEFAULT '',
  comment          text        NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE well_measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_well_meas_select" ON well_measurements FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_well_meas_insert" ON well_measurements FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth_well_meas_update" ON well_measurements FOR UPDATE TO authenticated USING (true);
CREATE POLICY "auth_well_meas_delete" ON well_measurements FOR DELETE TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS well_meas_well_id_idx ON well_measurements(well_id);
CREATE INDEX IF NOT EXISTS well_meas_date_idx    ON well_measurements(measurement_date DESC NULLS LAST);
