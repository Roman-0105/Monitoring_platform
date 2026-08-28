-- ═══════════════════════════════════════════════════════════════
-- Migration: Прогноз зумпфов — версии кривой V(H) + bucket для .tridb
--
-- dew_sumps.{tridb_path,total_volume,z_min,z_max,critical_level,volume_curve}
-- уже существуют (созданы старым приложением) — не трогаем.
-- Здесь добавляется только:
--   1) таблица истории версий кривой V(H) (пересчёт модели зумпфа со временем)
--   2) storage bucket 'sump-models' для файлов .tridb (публичный, как остальные
--      bucket'ы этого приложения — доступ через anon-ключ, без отдельной авторизации)
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ: выполните весь скрипт в Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dew_sump_curve_versions (
  id            text PRIMARY KEY,
  sump_id       text NOT NULL REFERENCES dew_sumps(id) ON DELETE CASCADE,
  valid_from    date NOT NULL,
  total_volume  numeric,
  z_min         numeric,
  z_max         numeric,
  tridb_path    text,
  volume_curve  jsonb,
  notes         text DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE dew_sump_curve_versions IS
  'История версий кривой V(H) зумпфа — при пересъёмке/переразбивке карьера объём на ту же отметку меняется, поэтому кривая версионируется по дате начала действия (valid_from)';

ALTER TABLE dew_sump_curve_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dew_read_all"  ON dew_sump_curve_versions;
DROP POLICY IF EXISTS "dew_write_all" ON dew_sump_curve_versions;

CREATE POLICY "dew_read_all"  ON dew_sump_curve_versions FOR SELECT USING (true);
CREATE POLICY "dew_write_all" ON dew_sump_curve_versions FOR ALL USING (true) WITH CHECK (true);

-- ── Storage bucket для .tridb-файлов ──────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('sump-models', 'sump-models', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "sump_models_read"  ON storage.objects;
DROP POLICY IF EXISTS "sump_models_write" ON storage.objects;

CREATE POLICY "sump_models_read"  ON storage.objects FOR SELECT USING (bucket_id = 'sump-models');
CREATE POLICY "sump_models_write" ON storage.objects FOR ALL USING (bucket_id = 'sump-models') WITH CHECK (bucket_id = 'sump-models');

-- Проверка после выполнения:
SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'dew_sump_curve_versions' ORDER BY policyname;
SELECT id, name, public FROM storage.buckets WHERE id = 'sump-models';
