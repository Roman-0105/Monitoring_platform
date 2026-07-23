-- ============================================================
-- Migration: sump forecast geometry fields
-- Run once in Supabase SQL Editor (idempotent)
-- ============================================================

ALTER TABLE dew_sumps ADD COLUMN IF NOT EXISTS tridb_path     TEXT;
ALTER TABLE dew_sumps ADD COLUMN IF NOT EXISTS total_volume   NUMERIC;
ALTER TABLE dew_sumps ADD COLUMN IF NOT EXISTS z_min          NUMERIC;
ALTER TABLE dew_sumps ADD COLUMN IF NOT EXISTS z_max          NUMERIC;
ALTER TABLE dew_sumps ADD COLUMN IF NOT EXISTS critical_level NUMERIC;
ALTER TABLE dew_sumps ADD COLUMN IF NOT EXISTS volume_curve   JSONB;

-- Storage bucket (run manually in Supabase Dashboard → Storage):
-- Create bucket named "sump-models", set to private (not public)
-- Add policy: authenticated users can SELECT, INSERT, UPDATE, DELETE
-- RLS policy SQL:
-- CREATE POLICY "sump_models_auth" ON storage.objects
--   FOR ALL TO authenticated USING (bucket_id = 'sump-models') WITH CHECK (bucket_id = 'sump-models');
