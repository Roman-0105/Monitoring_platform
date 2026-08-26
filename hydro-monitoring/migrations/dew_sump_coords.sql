-- Migration: local-grid coordinates for dewatering sumps (dew_sumps)
-- Needed so sumps from "Журнал Водоотлива" (with their rich daily water-level
-- history in dew_water_levels) can be placed on the 3D pit model and included
-- in the groundwater isohypses, same as wells/water-manifestation points.
-- Run this in Supabase SQL editor.

ALTER TABLE dew_sumps
  ADD COLUMN IF NOT EXISTS coord_x numeric(12,3),  -- X, местная сетка карьера, м
  ADD COLUMN IF NOT EXISTS coord_y numeric(12,3);  -- Y, местная сетка карьера, м

COMMENT ON COLUMN dew_sumps.coord_x IS 'Координата X зумпфа в местной сетке карьера, м';
COMMENT ON COLUMN dew_sumps.coord_y IS 'Координата Y зумпфа в местной сетке карьера, м';
