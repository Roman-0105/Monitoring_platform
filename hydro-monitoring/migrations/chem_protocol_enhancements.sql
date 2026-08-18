-- Migration: Add is_control flag to chem_protocols
-- Run this in Supabase SQL editor

ALTER TABLE chem_protocols
  ADD COLUMN IF NOT EXISTS is_control boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN chem_protocols.is_control IS 'Признак контрольной пробы';
