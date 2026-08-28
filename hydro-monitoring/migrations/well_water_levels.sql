-- Migration: history of groundwater level (УПВ) measurements per well in wp_registry
-- Stores depth-to-water measured from the wellhead (as read in the field with a tape/dipper),
-- not the absolute elevation directly — this stays valid even if the wellhead elevation
-- (wp_registry.elev_z) is corrected later; absolute water elevation is computed on read as
-- wp_registry.elev_z - depth_to_water.
-- Run this in Supabase SQL editor.

create table if not exists wp_well_levels (
  id             uuid primary key default gen_random_uuid(),
  well_id        uuid not null references wp_registry(id) on delete cascade,
  date           date not null,
  depth_to_water numeric(10,3) not null,
  measured_by    text,
  notes          text,
  created_at     timestamptz not null default now()
);

create index if not exists wp_well_levels_well_id_idx on wp_well_levels(well_id);

comment on table wp_well_levels is 'История замеров УПВ (уровня подземных вод) по скважинам реестра';
comment on column wp_well_levels.depth_to_water is 'Глубина до воды от устья скважины, м (замер рулеткой/лотом)';
