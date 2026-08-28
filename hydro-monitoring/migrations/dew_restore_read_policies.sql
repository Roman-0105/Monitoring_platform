-- ═══════════════════════════════════════════════════════════════
-- Восстановление политик RLS на чтение/запись для таблиц Журнала Водоотлива.
-- Ничего не удаляет и не меняет в данных — только пересоздаёт политики
-- доступа (идемпотентно: безопасно выполнять повторно).
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ: выполните весь скрипт в Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'dew_sumps', 'dew_pumps', 'dew_destinations', 'dew_meter_readings',
    'dew_water_levels', 'dew_pump_events', 'dew_elevation_history'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "dew_read_all" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "dew_write_all" ON %I', t);
    EXECUTE format('CREATE POLICY "dew_read_all" ON %I FOR SELECT USING (true)', t);
    EXECUTE format('CREATE POLICY "dew_write_all" ON %I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Проверка после выполнения: должно быть по 2 строки (dew_read_all, dew_write_all)
-- на каждую из таблиц выше.
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN (
  'dew_sumps', 'dew_pumps', 'dew_destinations', 'dew_meter_readings',
  'dew_water_levels', 'dew_pump_events', 'dew_elevation_history'
)
ORDER BY tablename, policyname;
