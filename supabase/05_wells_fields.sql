-- ============================================================
-- Add quarry, quarry_section, status fields to wells
-- Run AFTER 04_wells.sql
-- ============================================================

ALTER TABLE wells
  ADD COLUMN IF NOT EXISTS quarry         text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS quarry_section text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS status         text NOT NULL DEFAULT 'Активная'
    CHECK (status IN ('Активная', 'Иссякает', 'Сухая'));
