-- ═══════════════════════════════════════════════════════════════
-- Migration: Шаблоны лабораторий для протоколов химического анализа
--
-- Позволяет настроить под конкретную лабораторию (например, EcoExpert)
-- свой набор и порядок параметров — как для ручного ввода протокола,
-- так и для загрузочного Excel-шаблона. Параметры выбираются из уже
-- существующего каталога CHEM_PARAMS (ui-chem.js) — новые параметры
-- эта фича не создаёт, только куратор подмножества + порядок.
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ: выполните весь скрипт в Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS chem_lab_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_name      text NOT NULL,
  template_name text NOT NULL,
  base_type     text NOT NULL DEFAULT 'sha',   -- ключ CHEM_PROTO_TYPE_META (sha/radio/cn/micro/radio_full/full) — только для предзаполнения "Вид протокола"
  params        jsonb NOT NULL DEFAULT '[]'::jsonb,  -- упорядоченный массив ключей параметров: ["smell","ph_lab","ca",...]
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lab_name, template_name)
);

COMMENT ON TABLE chem_lab_templates IS
  'Настраиваемые шаблоны ввода/загрузки протоколов по лабораториям: подмножество и порядок параметров из каталога CHEM_PARAMS';

-- Протокол помнит, каким шаблоном он был введён/импортирован —
-- чтобы при редактировании форма снова открылась в том же порядке полей.
ALTER TABLE chem_protocols
  ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES chem_lab_templates(id) ON DELETE SET NULL;

-- RLS (Row Level Security) — тот же паттерн, что и у chem_protocols/chem_results
-- (см. chem_migration.sql): чтение и запись разрешены всем (безопасность —
-- на уровне Supabase Auth/anon-ключа приложения, не на уровне таблицы).
-- Без этого блока INSERT/UPDATE в таблицу молча отклоняется базой (403,
-- "new row violates row-level security policy") — именно это и произошло
-- при первом запуске миграции без этой секции.
ALTER TABLE chem_lab_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chem_read_all"  ON chem_lab_templates;
DROP POLICY IF EXISTS "chem_write_all" ON chem_lab_templates;

CREATE POLICY "chem_read_all"  ON chem_lab_templates FOR SELECT USING (true);
CREATE POLICY "chem_write_all" ON chem_lab_templates FOR ALL USING (true) WITH CHECK (true);
