-- ============================================================
-- Migration: versioned V(H) curves for sumps
-- Run once in Supabase SQL Editor (idempotent)
-- ============================================================

CREATE TABLE IF NOT EXISTS dew_sump_curve_versions (
  id           TEXT PRIMARY KEY,
  sump_id      TEXT NOT NULL REFERENCES dew_sumps(id) ON DELETE CASCADE,
  valid_from   DATE NOT NULL,
  total_volume NUMERIC,
  z_min        NUMERIC,
  z_max        NUMERIC,
  tridb_path   TEXT,
  volume_curve JSONB,
  notes        TEXT DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dew_sump_curve_versions_sump_id
  ON dew_sump_curve_versions(sump_id);

CREATE INDEX IF NOT EXISTS idx_dew_sump_curve_versions_valid_from
  ON dew_sump_curve_versions(valid_from);

-- RLS (mirror the pattern from other dew_* tables)
ALTER TABLE dew_sump_curve_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "dew_sump_curve_versions_auth"
  ON dew_sump_curve_versions FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
