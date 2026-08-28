-- ═══════════════════════════════════════════════════════════════
-- Migration: План участка (фон) для схемы водного баланса
--
-- Хранит одну общую (на всех) картинку ситуационного плана, которая
-- ложится фоном под схему водного баланса — файл лежит в уже существующем
-- публичном bucket 'schemes' (под префиксом diagram-bg/), здесь только
-- метаданные (путь, прозрачность, смещение, масштаб, исходный размер).
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ: выполните весь скрипт в Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dew_diagram_background (
  id             text PRIMARY KEY,       -- всегда 'default' — план один общий на всю схему
  storage_path   text NOT NULL,          -- путь в bucket 'schemes'
  opacity        numeric NOT NULL DEFAULT 0.55,
  offset_x       numeric NOT NULL DEFAULT 0,
  offset_y       numeric NOT NULL DEFAULT 0,
  scale          numeric NOT NULL DEFAULT 1,
  natural_width  numeric,
  natural_height numeric,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE dew_diagram_background IS
  'Общий план участка (фон) под схемой водного баланса — файл в bucket schemes/diagram-bg/, здесь позиция/масштаб/прозрачность';

ALTER TABLE dew_diagram_background ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dew_read_all"  ON dew_diagram_background;
DROP POLICY IF EXISTS "dew_write_all" ON dew_diagram_background;

CREATE POLICY "dew_read_all"  ON dew_diagram_background FOR SELECT USING (true);
CREATE POLICY "dew_write_all" ON dew_diagram_background FOR ALL USING (true) WITH CHECK (true);
