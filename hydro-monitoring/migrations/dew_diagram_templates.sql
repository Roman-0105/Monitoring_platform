-- ═══════════════════════════════════════════════════════════════
-- Migration: Шаблоны расстановки блок-схемы водного баланса
--
-- Позволяет сохранять именованные "снимки" раскладки схемы (позиции
-- узлов + ручные правки связей — изгибы/порты) и применять их позже,
-- в том числе с другого устройства/браузера. До этой миграции текущая
-- раскладка хранилась только локально (localStorage), по одной штуке
-- на браузер, и не переживала смену компьютера или очистку кэша.
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ: выполните весь скрипт в Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

-- id — text, не uuid: как и остальные dew_*-таблицы (dew_sumps, dew_pumps,
-- dew_destinations, ...), id генерируется на клиенте (DewateringState._id())
-- в формате "dgt<timestamp>_<rand>", а не средствами БД.
CREATE TABLE IF NOT EXISTS dew_diagram_templates (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  positions  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {nodeId: {x,y}}
  edges      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {edgeId: {vertices:[{x,y}], sourcePort, targetPort}}
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name)
);

COMMENT ON TABLE dew_diagram_templates IS
  'Именованные шаблоны расстановки блок-схемы водного баланса (позиции узлов + ручные правки связей) — сохраняются/применяются с любого устройства';

ALTER TABLE dew_diagram_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dew_read_all"  ON dew_diagram_templates;
DROP POLICY IF EXISTS "dew_write_all" ON dew_diagram_templates;

CREATE POLICY "dew_read_all"  ON dew_diagram_templates FOR SELECT USING (true);
CREATE POLICY "dew_write_all" ON dew_diagram_templates FOR ALL USING (true) WITH CHECK (true);
