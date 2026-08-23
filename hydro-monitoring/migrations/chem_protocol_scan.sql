-- ═══════════════════════════════════════════════════════════════
-- Migration: Скан-копия протокола (CHEM-07)
--
-- Позволяет прикрепить исходный PDF/скан лабораторного протокола к
-- записи — используется тот же Supabase Storage, что и для фото точек
-- (см. supabase/02_storage.sql), просто отдельный публичный бакет.
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ: выполните весь скрипт в Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE chem_protocols
  ADD COLUMN IF NOT EXISTS scan_url  text,
  ADD COLUMN IF NOT EXISTS scan_name text;

COMMENT ON COLUMN chem_protocols.scan_url  IS 'Публичный URL скан-копии протокола (Supabase Storage, бакет chem-scans)';
COMMENT ON COLUMN chem_protocols.scan_name IS 'Исходное имя файла скана (для отображения)';

-- Бакет для скан-копий протоколов (публичный — прямые URL в scan_url)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chem-scans',
  'chem-scans',
  true,
  20971520,  -- 20 MB
  array['application/pdf','image/jpeg','image/png','image/webp']
)
on conflict (id) do nothing;

-- anon читает / загружает / удаляет — тот же паттерн, что у бакета photos
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
