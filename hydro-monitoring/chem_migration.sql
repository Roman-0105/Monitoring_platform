-- ═══════════════════════════════════════════════════════════════
--  Химический мониторинг воды — миграция Supabase
--  Выполнить в Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- 1. Реестр водопунктов ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS water_points (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  code          text,                            -- краткий код/шифр (ПН-1, З-4 и т.п.)
  type          text NOT NULL DEFAULT 'other',   -- well_obs | well_exp | sump | pond | seep | other
  location_desc text,                            -- описание местоположения
  lat           numeric(10,6),
  lng           numeric(10,6),
  active        boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 2. Протоколы химического анализа ─────────────────────────────
CREATE TABLE IF NOT EXISTS chem_protocols (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  water_point_id       uuid REFERENCES water_points(id) ON DELETE SET NULL,
  protocol_type        text NOT NULL DEFAULT 'full',  -- full | radio_gen | radio_ext | cyanide | micro
  lab_name             text,                           -- название лаборатории
  lab_protocol_number  text,                           -- № протокола (421/2)
  lab_order_number     text,                           -- № заказа (421)
  lab_number           text,                           -- лабораторный номер пробы (977)
  sample_name          text,                           -- наименование пробы
  sampled_at           date NOT NULL,                  -- дата отбора проб
  received_at          date,                           -- дата поступления в лабораторию
  tested_from          date,                           -- начало испытаний
  tested_to            date,                           -- окончание испытаний
  analysis_types       text,                           -- виды анализа (строка из протокола)
  test_type            text,                           -- вид испытаний (Гигиенические и т.п.)
  conditions           text,                           -- условия проведения
  source               text NOT NULL DEFAULT 'manual', -- manual | excel
  notes                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text
);

-- 3. Результаты — одна строка на параметр ──────────────────────
CREATE TABLE IF NOT EXISTS chem_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id     uuid NOT NULL REFERENCES chem_protocols(id) ON DELETE CASCADE,
  param_key       text NOT NULL,   -- ph_lab, fe_total, no3, ... (ключи из CHEM_PARAMS)
  value_raw       text,            -- значение как введено: '7,9', '<0,50', '>30,0'
  value_num       numeric,         -- числовое (null если below/above detection или не введено)
  below_detection boolean NOT NULL DEFAULT false,
  above_range     boolean NOT NULL DEFAULT false,
  nd_ref          text             -- НД на определения (из протокола)
);
CREATE UNIQUE INDEX IF NOT EXISTS chem_results_proto_param
  ON chem_results(protocol_id, param_key);

-- 4. Индексы ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chem_protocols_wp   ON chem_protocols(water_point_id);
CREATE INDEX IF NOT EXISTS idx_chem_protocols_date ON chem_protocols(sampled_at DESC);
CREATE INDEX IF NOT EXISTS idx_chem_results_proto  ON chem_results(protocol_id);
CREATE INDEX IF NOT EXISTS idx_chem_results_key    ON chem_results(param_key);

-- 5. RLS (Row Level Security) — разрешить всем авторизованным ──
ALTER TABLE water_points   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chem_protocols ENABLE ROW LEVEL SECURITY;
ALTER TABLE chem_results   ENABLE ROW LEVEL SECURITY;

-- Чтение — все аутентифицированные пользователи
CREATE POLICY "chem_read_all"  ON water_points   FOR SELECT USING (true);
CREATE POLICY "chem_read_all"  ON chem_protocols FOR SELECT USING (true);
CREATE POLICY "chem_read_all"  ON chem_results   FOR SELECT USING (true);

-- Запись — все аутентифицированные пользователи (можно ограничить ролями)
CREATE POLICY "chem_write_all" ON water_points   FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "chem_write_all" ON chem_protocols FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "chem_write_all" ON chem_results   FOR ALL USING (true) WITH CHECK (true);
