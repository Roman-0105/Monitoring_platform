-- ═══════════════════════════════════════════════════════════════
-- Восстановление политик RLS на чтение/запись для таблиц Пылеподавления.
-- Ничего не удаляет и не меняет в данных — только добавляет политику записи
-- (сейчас у этих таблиц есть только чтение, поэтому INSERT/UPDATE/DELETE
-- отклоняются с ошибкой 42501 "row-level security policy"). Идемпотентно:
-- безопасно выполнять повторно.
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ: выполните весь скрипт в Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['dust_orgs', 'dust_vehicles', 'dust_nozzles', 'dust_logs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "dust_read_all" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "dust_write_all" ON %I', t);
    EXECUTE format('CREATE POLICY "dust_read_all" ON %I FOR SELECT USING (true)', t);
    EXECUTE format('CREATE POLICY "dust_write_all" ON %I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

SELECT tablename, policyname, cmd FROM pg_policies
WHERE tablename IN ('dust_orgs', 'dust_vehicles', 'dust_nozzles', 'dust_logs')
ORDER BY tablename, policyname;
