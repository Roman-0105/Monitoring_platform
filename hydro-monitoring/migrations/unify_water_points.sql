-- ═══════════════════════════════════════════════════════════════
-- Migration: Унификация реестра водопунктов
-- Переносим water_points → wp_registry, переключаем chem_protocols
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ:
--   1. Выполните весь скрипт в Supabase SQL Editor
--   2. Проверьте результат запросами в конце
--   3. После проверки можно (но не обязательно) удалить таблицу water_points
-- ═══════════════════════════════════════════════════════════════

-- ── Шаг 1: Добавляем в wp_registry поля, которых может не быть ──
ALTER TABLE wp_registry
  ADD COLUMN IF NOT EXISTS location_desc text;   -- описание местоположения (из water_points)

COMMENT ON COLUMN wp_registry.location_desc IS 'Описание местоположения / привязки водопункта';

-- ── Шаг 2: Мигрируем записи из water_points в wp_registry ───────
-- Вставляем только те, которых ещё нет (по совпадению name + code).
-- Если совпадение есть — обновляем location_desc из water_points.

INSERT INTO wp_registry (id, name, code, wp_type, location_desc, active)
SELECT
  gen_random_uuid(),        -- новый id (ссылки обновим в шаге 3)
  wp.name,
  wp.code,
  wp.type,                  -- тип совпадает (well_obs, well_exp, sump, …)
  wp.location_desc,
  true
FROM water_points wp
WHERE NOT EXISTS (
  SELECT 1 FROM wp_registry r
  WHERE (r.name = wp.name OR (r.code IS NOT NULL AND r.code = wp.code))
)
ON CONFLICT DO NOTHING;

-- Для тех, что уже есть — дополняем location_desc если пусто
UPDATE wp_registry r
SET location_desc = COALESCE(r.location_desc, wp.location_desc)
FROM water_points wp
WHERE (r.name = wp.name OR (r.code IS NOT NULL AND r.code = wp.code))
  AND r.location_desc IS NULL
  AND wp.location_desc IS NOT NULL;

-- ── Шаг 3: Переключаем chem_protocols.water_point_id ────────────
-- Добавляем новую колонку для ссылки на wp_registry
ALTER TABLE chem_protocols
  ADD COLUMN IF NOT EXISTS registry_id uuid REFERENCES wp_registry(id) ON DELETE SET NULL;

-- Заполняем registry_id по совпадению name или code
UPDATE chem_protocols cp
SET registry_id = r.id
FROM water_points wp
JOIN wp_registry r
  ON (r.name = wp.name OR (r.code IS NOT NULL AND r.code = wp.code))
WHERE cp.water_point_id = wp.id
  AND cp.registry_id IS NULL;

-- ── Шаг 4: Делаем registry_id основным (переименование) ──────────
-- Переименовываем старый water_point_id → water_point_id_legacy
-- и registry_id → water_point_id
ALTER TABLE chem_protocols
  RENAME COLUMN water_point_id TO water_point_id_legacy;

ALTER TABLE chem_protocols
  RENAME COLUMN registry_id TO water_point_id;

-- ── Шаг 5: Проверочные запросы ───────────────────────────────────
-- Запустите их отдельно чтобы убедиться что всё правильно:

-- Сколько протоколов успешно переключено:
-- SELECT count(*) FROM chem_protocols WHERE water_point_id IS NOT NULL;

-- Сколько осталось без привязки (должно быть 0):
-- SELECT count(*) FROM chem_protocols WHERE water_point_id IS NULL AND water_point_id_legacy IS NOT NULL;

-- Список водопунктов из water_points и их аналогов в wp_registry:
-- SELECT wp.name, wp.code, wp.type, r.id as registry_id, r.coord_x, r.coord_y
-- FROM water_points wp
-- LEFT JOIN wp_registry r ON (r.name = wp.name OR (r.code IS NOT NULL AND r.code = wp.code));
