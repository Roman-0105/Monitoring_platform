-- ═══════════════════════════════════════════════════════════════
-- Migration: Ядро протоколов хим. анализа (web-next) — объединяет 4 ранее
-- написанные, но ещё не выполненные миграции старого приложения:
--   wp_default_template.sql, chem_protocol_scan.sql,
--   chem_protocol_history.sql, chem_protocol_quarter.sql
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ: выполните весь скрипт в Supabase SQL Editor.
-- Идемпотентно — можно выполнять повторно без риска.
-- ═══════════════════════════════════════════════════════════════

-- 1) Шаблон лаборатории по умолчанию для водопункта (CHEM-04)
ALTER TABLE wp_registry
  ADD COLUMN IF NOT EXISTS default_template_id uuid REFERENCES chem_lab_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN wp_registry.default_template_id IS
  'Шаблон лаборатории (chem_lab_templates), подставляемый по умолчанию при создании нового протокола для этого водопункта';

-- 2) Скан-копия протокола (CHEM-07)
ALTER TABLE chem_protocols
  ADD COLUMN IF NOT EXISTS scan_url  text,
  ADD COLUMN IF NOT EXISTS scan_name text;

COMMENT ON COLUMN chem_protocols.scan_url  IS 'Публичный URL скан-копии протокола (Supabase Storage, бакет chem-scans)';
COMMENT ON COLUMN chem_protocols.scan_name IS 'Исходное имя файла скана (для отображения)';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chem-scans',
  'chem-scans',
  true,
  20971520,  -- 20 MB
  array['application/pdf','image/jpeg','image/png','image/webp']
)
on conflict (id) do nothing;

drop policy if exists "anon read chem-scans" on storage.objects;
drop policy if exists "anon upload chem-scans" on storage.objects;
drop policy if exists "anon delete chem-scans" on storage.objects;

create policy "anon read chem-scans"
  on storage.objects for select to anon
  using (bucket_id = 'chem-scans');

create policy "anon upload chem-scans"
  on storage.objects for insert to anon
  with check (bucket_id = 'chem-scans');

create policy "anon delete chem-scans"
  on storage.objects for delete to anon
  using (bucket_id = 'chem-scans');

-- 3) Журнал изменений протокола (CHEM-08)
CREATE TABLE IF NOT EXISTS chem_protocol_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id  uuid NOT NULL REFERENCES chem_protocols(id) ON DELETE CASCADE,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  changed_by   text,
  action       text NOT NULL,        -- 'created' | 'updated'
  changes      jsonb NOT NULL DEFAULT '[]'::jsonb  -- [{field, label, old, new}, ...]
);

CREATE INDEX IF NOT EXISTS idx_chem_protocol_history_proto ON chem_protocol_history(protocol_id, changed_at DESC);

COMMENT ON TABLE chem_protocol_history IS
  'Журнал изменений протокола: кто/когда/что изменил (CHEM-08)';

ALTER TABLE chem_protocol_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chem_read_all"  ON chem_protocol_history;
DROP POLICY IF EXISTS "chem_write_all" ON chem_protocol_history;

CREATE POLICY "chem_read_all"  ON chem_protocol_history FOR SELECT USING (true);
CREATE POLICY "chem_write_all" ON chem_protocol_history FOR ALL USING (true) WITH CHECK (true);

-- 4) Квартал пробы
ALTER TABLE chem_protocols
  ADD COLUMN IF NOT EXISTS quarter smallint CHECK (quarter BETWEEN 1 AND 4);

COMMENT ON COLUMN chem_protocols.quarter IS
  'Квартал пробы (1-4) — автоматически из sampled_at при сохранении, можно задать вручную';

UPDATE chem_protocols
SET quarter = CEIL(EXTRACT(MONTH FROM sampled_at)::numeric / 3)
WHERE quarter IS NULL AND sampled_at IS NOT NULL;

-- Проверка после выполнения:
SELECT column_name FROM information_schema.columns WHERE table_name = 'wp_registry' AND column_name = 'default_template_id';
SELECT column_name FROM information_schema.columns WHERE table_name = 'chem_protocols' AND column_name IN ('scan_url','scan_name','quarter');
SELECT tablename, policyname FROM pg_policies WHERE tablename = 'chem_protocol_history';
