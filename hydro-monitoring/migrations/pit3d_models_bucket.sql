-- ═══════════════════════════════════════════════════════════════
-- Migration: Bucket для модели карьера (3D)
--
-- Раньше распарсенная DXF-модель (рельеф) сохранялась только в IndexedDB
-- браузера — её видел только тот, кто сам загрузил файл, на том же
-- компьютере. Переносим на общее хранилище Supabase (как .tridb-модели
-- зумпфов и план участка схемы), чтобы модель была одна на всех.
--
-- Модель хранится одним JSON-файлом (координаты + треугольники + метаданные) —
-- отдельная таблица не нужна.
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ: выполните весь скрипт в Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('pit3d-models', 'pit3d-models', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "pit3d_models_read"  ON storage.objects;
DROP POLICY IF EXISTS "pit3d_models_write" ON storage.objects;

CREATE POLICY "pit3d_models_read"  ON storage.objects FOR SELECT USING (bucket_id = 'pit3d-models');
CREATE POLICY "pit3d_models_write" ON storage.objects FOR ALL USING (bucket_id = 'pit3d-models') WITH CHECK (bucket_id = 'pit3d-models');

SELECT id, name, public FROM storage.buckets WHERE id = 'pit3d-models';
