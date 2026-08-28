-- ═══════════════════════════════════════════════════════════════
-- Revert: убирает filter_intervals/pump_depth/pump_notes с таблицы wells
-- (Гор. скважины) — эти поля были добавлены по ошибке; интервалы фильтра
-- и глубина насоса нужны на wp_registry (Реестр водопунктов, наблюдательные
-- и эксплуатационные скважины), где они уже давно есть и заполнены.
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ: выполните весь скрипт в Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE wells DROP COLUMN IF EXISTS filter_intervals;
ALTER TABLE wells DROP COLUMN IF EXISTS pump_depth;
ALTER TABLE wells DROP COLUMN IF EXISTS pump_notes;

SELECT column_name FROM information_schema.columns
WHERE table_name = 'wells' AND column_name IN ('filter_intervals', 'pump_depth', 'pump_notes');
-- Ожидаемый результат: 0 строк
