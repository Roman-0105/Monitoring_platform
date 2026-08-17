-- Migration: Enhanced well construction fields for wp_registry
-- Run this in Supabase SQL editor

ALTER TABLE wp_registry
  ADD COLUMN IF NOT EXISTS elev_z          numeric(10,3),      -- Абсолютная отметка (Z), м
  ADD COLUMN IF NOT EXISTS drill_company   text,               -- Буровая компания
  ADD COLUMN IF NOT EXISTS drill_date_start date,              -- Начало бурения
  ADD COLUMN IF NOT EXISTS drill_date_end   date,              -- Конец бурения
  ADD COLUMN IF NOT EXISTS filter_intervals jsonb DEFAULT '[]'::jsonb,  -- [{from,to,diameter}]
  ADD COLUMN IF NOT EXISTS drill_intervals  jsonb DEFAULT '[]'::jsonb,  -- [{from,to,diameter}]
  ADD COLUMN IF NOT EXISTS casing_intervals jsonb DEFAULT '[]'::jsonb;  -- [{from,to,diameter}]

COMMENT ON COLUMN wp_registry.elev_z           IS 'Абсолютная отметка устья скважины, м';
COMMENT ON COLUMN wp_registry.drill_company    IS 'Наименование буровой компании';
COMMENT ON COLUMN wp_registry.drill_date_start IS 'Дата начала бурения';
COMMENT ON COLUMN wp_registry.drill_date_end   IS 'Дата окончания бурения';
COMMENT ON COLUMN wp_registry.filter_intervals IS 'Интервалы фильтров: [{from,to,diameter}]';
COMMENT ON COLUMN wp_registry.drill_intervals  IS 'Интервалы бурения (диаметры): [{from,to,diameter}]';
COMMENT ON COLUMN wp_registry.casing_intervals IS 'Интервалы обсадных труб: [{from,to,diameter}]';
