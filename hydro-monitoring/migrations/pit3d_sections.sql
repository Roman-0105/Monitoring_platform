-- ═══════════════════════════════════════════════════════════════
-- Migration: Сохранённые вертикальные разрезы модели карьера
--
-- Раньше разрезы хранились в IndexedDB браузера (та же проблема, что и с
-- самой моделью — видел только тот, кто их создал). Переносим на Supabase,
-- чтобы разрезы были общими и не терялись при очистке браузера.
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ: выполните весь скрипт в Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS pit3d_sections (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  ax         numeric NOT NULL,
  ay         numeric NOT NULL,
  bx         numeric NOT NULL,
  by         numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE pit3d_sections IS
  'Сохранённые линии вертикального разреза модели карьера (точки A/B в мировых координатах) — сам профиль пересчитывается заново при открытии из текущей модели рельефа';

ALTER TABLE pit3d_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pit3d_sections_read"  ON pit3d_sections;
DROP POLICY IF EXISTS "pit3d_sections_write" ON pit3d_sections;

CREATE POLICY "pit3d_sections_read"  ON pit3d_sections FOR SELECT USING (true);
CREATE POLICY "pit3d_sections_write" ON pit3d_sections FOR ALL USING (true) WITH CHECK (true);

SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'pit3d_sections' ORDER BY policyname;
