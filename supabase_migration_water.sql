-- ============================================================
-- Supabase migration: dewatering + dust suppression tables
-- Run once in Supabase SQL Editor (idempotent).
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. dew_sumps
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dew_sumps (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL DEFAULT '',
  quarry  TEXT NOT NULL DEFAULT '',
  notes   TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dew_sumps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dew_sumps_all" ON dew_sumps;
CREATE POLICY "dew_sumps_all" ON dew_sumps
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- 2. dew_elevation_history
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dew_elevation_history (
  id         TEXT PRIMARY KEY,
  sump_id    TEXT NOT NULL DEFAULT '',
  date       DATE,
  elevation  NUMERIC,
  notes      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dew_elevation_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dew_elevation_history_all" ON dew_elevation_history;
CREATE POLICY "dew_elevation_history_all" ON dew_elevation_history
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_dew_elev_sump_id ON dew_elevation_history (sump_id);
CREATE INDEX IF NOT EXISTS idx_dew_elev_date ON dew_elevation_history (date DESC);

-- ──────────────────────────────────────────────────────────────
-- 3. dew_pumps
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dew_pumps (
  id               TEXT PRIMARY KEY,
  sump_id          TEXT NOT NULL DEFAULT '',
  name             TEXT NOT NULL DEFAULT '',
  model            TEXT NOT NULL DEFAULT '',
  serial_number    TEXT NOT NULL DEFAULT '',
  inventory_number TEXT NOT NULL DEFAULT '',
  quarry           TEXT NOT NULL DEFAULT '',
  capacity         NUMERIC,
  head             NUMERIC,
  type             TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT 'off',
  install_date     DATE,
  notes            TEXT NOT NULL DEFAULT '',
  count_in_volume  BOOLEAN NOT NULL DEFAULT true,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dew_pumps ADD COLUMN IF NOT EXISTS default_distributions JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE dew_pumps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dew_pumps_all" ON dew_pumps;
CREATE POLICY "dew_pumps_all" ON dew_pumps
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_dew_pumps_sump_id ON dew_pumps (sump_id);
CREATE INDEX IF NOT EXISTS idx_dew_pumps_status ON dew_pumps (status);

-- ──────────────────────────────────────────────────────────────
-- 4. dew_pump_events
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dew_pump_events (
  id                TEXT PRIMARY KEY,
  sump_id           TEXT NOT NULL DEFAULT '',
  date              DATE,
  type              TEXT NOT NULL DEFAULT '',
  removed_pump_id   TEXT,
  installed_pump_id TEXT,
  reason            TEXT NOT NULL DEFAULT '',
  performed_by      TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dew_pump_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dew_pump_events_all" ON dew_pump_events;
CREATE POLICY "dew_pump_events_all" ON dew_pump_events
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_dew_pump_events_sump_id ON dew_pump_events (sump_id);
CREATE INDEX IF NOT EXISTS idx_dew_pump_events_date ON dew_pump_events (date DESC);

-- ──────────────────────────────────────────────────────────────
-- 5. dew_destinations
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dew_destinations (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL DEFAULT '',
  type           TEXT NOT NULL DEFAULT '',
  target_sump_id TEXT,
  color          TEXT NOT NULL DEFAULT '',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dew_destinations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dew_destinations_all" ON dew_destinations;
CREATE POLICY "dew_destinations_all" ON dew_destinations
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- 6. dew_meter_readings
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dew_meter_readings (
  id               TEXT PRIMARY KEY,
  pump_id          TEXT NOT NULL DEFAULT '',
  date             DATE,
  reading          NUMERIC,
  is_reset         BOOLEAN NOT NULL DEFAULT false,
  is_stopped       BOOLEAN NOT NULL DEFAULT false,
  reset_start_value NUMERIC,
  downtime_reason  TEXT NOT NULL DEFAULT '',
  hours_worked     NUMERIC,
  distributions    JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_manual_volume BOOLEAN NOT NULL DEFAULT false,
  manual_volume    NUMERIC,
  notes            TEXT NOT NULL DEFAULT '',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dew_meter_readings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dew_meter_readings_all" ON dew_meter_readings;
CREATE POLICY "dew_meter_readings_all" ON dew_meter_readings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_dew_meter_readings_pump_date ON dew_meter_readings (pump_id, date DESC);

-- ──────────────────────────────────────────────────────────────
-- 7. dew_water_levels
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dew_water_levels (
  id          TEXT PRIMARY KEY,
  sump_id     TEXT NOT NULL DEFAULT '',
  date        DATE,
  time        TEXT NOT NULL DEFAULT '',
  elevation   NUMERIC,
  measured_by TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dew_water_levels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dew_water_levels_all" ON dew_water_levels;
CREATE POLICY "dew_water_levels_all" ON dew_water_levels
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_dew_water_levels_sump_date ON dew_water_levels (sump_id, date DESC);

-- ──────────────────────────────────────────────────────────────
-- 8. dust_orgs
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dust_orgs (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dust_orgs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dust_orgs_all" ON dust_orgs;
CREATE POLICY "dust_orgs_all" ON dust_orgs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- 9. dust_vehicles
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dust_vehicles (
  id           TEXT PRIMARY KEY,
  org_id       TEXT NOT NULL DEFAULT '',
  name         TEXT NOT NULL DEFAULT '',
  plate_number TEXT NOT NULL DEFAULT '',
  capacity     NUMERIC,
  notes        TEXT NOT NULL DEFAULT '',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dust_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dust_vehicles_all" ON dust_vehicles;
CREATE POLICY "dust_vehicles_all" ON dust_vehicles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_dust_vehicles_org_id ON dust_vehicles (org_id);

-- ──────────────────────────────────────────────────────────────
-- 10. dust_nozzles
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dust_nozzles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT '',
  source_id   TEXT,
  location    TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dust_nozzles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dust_nozzles_all" ON dust_nozzles;
CREATE POLICY "dust_nozzles_all" ON dust_nozzles
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────
-- 11. dust_logs
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dust_logs (
  id               TEXT PRIMARY KEY,
  date             DATE,
  org_id           TEXT NOT NULL DEFAULT '',
  vehicle_id       TEXT NOT NULL DEFAULT '',
  nozzle_id        TEXT NOT NULL DEFAULT '',
  trips            INTEGER,
  total_volume     NUMERIC,
  is_manual_volume BOOLEAN NOT NULL DEFAULT false,
  manual_volume    NUMERIC,
  notes            TEXT NOT NULL DEFAULT '',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE dust_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dust_logs_all" ON dust_logs;
CREATE POLICY "dust_logs_all" ON dust_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_dust_logs_date ON dust_logs (date DESC);
CREATE INDEX IF NOT EXISTS idx_dust_logs_org_id ON dust_logs (org_id);
CREATE INDEX IF NOT EXISTS idx_dust_logs_nozzle_id ON dust_logs (nozzle_id);

-- ──────────────────────────────────────────────────────────────
-- Additive column migrations (idempotent)
-- ──────────────────────────────────────────────────────────────
ALTER TABLE dew_destinations ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '';
