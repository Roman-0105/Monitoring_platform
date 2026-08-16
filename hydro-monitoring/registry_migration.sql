-- ═══════════════════════════════════════════════════════════════
--  Реестр водопунктов — миграция Supabase
--  Выполнить в Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS wp_registry (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Общие поля (все типы)
  wp_type       text NOT NULL DEFAULT 'other',
                -- well_obs | well_exp | sump | pond | seep | ditch | other
  name          text NOT NULL,
  code          text,

  -- Координаты местные (система карьера)
  coord_x       numeric(12,3),
  coord_y       numeric(12,3),

  -- Координаты WGS-84
  lat           numeric(10,6),
  lng           numeric(10,6),

  -- Скважины: well_obs + well_exp
  depth         numeric(8,2),      -- глубина скважины, м
  diameter      numeric(8,1),      -- диаметр обсадной трубы, мм
  filter_from   numeric(8,2),      -- глубина фильтра от, м
  filter_to     numeric(8,2),      -- глубина фильтра до, м
  aquifer       text,              -- водоносный горизонт
  drilled_at    date,              -- дата бурения

  -- Только эксплуатационные скважины: well_exp
  pump_model    text,              -- марка насоса
  pump_depth    numeric(8,2),      -- глубина установки насоса, м
  pump_capacity numeric(8,2),      -- производительность, м³/ч
  pump_head     numeric(8,2),      -- напор, м

  notes         text,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wp_registry_type ON wp_registry(wp_type);

ALTER TABLE wp_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wp_registry_all" ON wp_registry FOR ALL USING (true) WITH CHECK (true);
