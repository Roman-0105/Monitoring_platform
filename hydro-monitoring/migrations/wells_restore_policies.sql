-- ═══════════════════════════════════════════════════════════════
-- Восстановление политик RLS на чтение/запись для таблиц "Гор. скважины"
-- (wells) и показаний датчиков VWP (well_sensor_readings).
--
-- Похоже на ту же проблему, что уже была с dew_* и dust_* таблицами:
-- well_sensor_readings содержит реальные показания (ссылаются на
-- well_id), но сама таблица wells возвращает 0 строк через anon-ключ —
-- похоже на отсутствующую/сломанную политику чтения именно на wells.
-- Идемпотентно: безопасно выполнять повторно, данные не удаляет.
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ: выполните весь скрипт в Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['wells', 'well_sensor_readings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "wells_read_all" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "wells_write_all" ON %I', t);
    EXECUTE format('CREATE POLICY "wells_read_all" ON %I FOR SELECT USING (true)', t);
    EXECUTE format('CREATE POLICY "wells_write_all" ON %I FOR ALL USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Проверка после выполнения: должно быть по 2 строки на каждую таблицу.
SELECT tablename, policyname, cmd FROM pg_policies
WHERE tablename IN ('wells', 'well_sensor_readings')
ORDER BY tablename, policyname;

-- Заодно проверим, видна ли теперь скважина, на которую уже есть показания датчиков:
SELECT id, name, well_type FROM wells
WHERE id IN (SELECT DISTINCT well_id FROM well_sensor_readings);
