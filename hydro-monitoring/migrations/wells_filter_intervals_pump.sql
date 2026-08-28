-- ═══════════════════════════════════════════════════════════════
-- Migration: Интервалы фильтров и глубина установки насоса для скважин
--
-- Новая функциональность (в старом приложении отсутствовала). Глубины
-- (top/bottom интервала фильтра, глубина насоса) — это глубина ПО СТВОЛУ
-- от устья (measured depth), как и существующие wells.depth и
-- sensors[].depth — не вертикальная отметка.
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ: выполните весь скрипт в Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE wells ADD COLUMN IF NOT EXISTS filter_intervals jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE wells ADD COLUMN IF NOT EXISTS pump_depth numeric;
ALTER TABLE wells ADD COLUMN IF NOT EXISTS pump_notes text;

COMMENT ON COLUMN wells.filter_intervals IS
  'Интервалы фильтра скважины (глубина по стволу от устья): [{id, top, bottom, notes}]';
COMMENT ON COLUMN wells.pump_depth IS
  'Глубина установки насоса по стволу от устья, м (если насос стоит в скважине)';

SELECT column_name, data_type, column_default FROM information_schema.columns
WHERE table_name = 'wells' AND column_name IN ('filter_intervals', 'pump_depth', 'pump_notes');
