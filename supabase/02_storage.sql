-- ============================================================
-- Storage buckets + policies
-- Run AFTER 01_schema.sql
-- ============================================================

-- Bucket для фотографий точек (публичный — прямые URL в photo_urls)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  true,
  10485760,  -- 10 MB
  array['image/jpeg','image/png','image/webp','image/heic']
)
on conflict (id) do nothing;

-- Bucket для схем карьера (публичный — прямые URL)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'schemes',
  'schemes',
  true,
  52428800,  -- 50 MB
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do nothing;

-- Политики для photos: anon читает и пишет
create policy "anon read photos"
  on storage.objects for select to anon
  using (bucket_id = 'photos');

create policy "anon upload photos"
  on storage.objects for insert to anon
  with check (bucket_id = 'photos');

create policy "anon delete photos"
  on storage.objects for delete to anon
  using (bucket_id = 'photos');

-- Политики для schemes: anon читает и пишет
create policy "anon read schemes"
  on storage.objects for select to anon
  using (bucket_id = 'schemes');

create policy "anon upload schemes"
  on storage.objects for insert to anon
  with check (bucket_id = 'schemes');

create policy "anon delete schemes"
  on storage.objects for delete to anon
  using (bucket_id = 'schemes');
