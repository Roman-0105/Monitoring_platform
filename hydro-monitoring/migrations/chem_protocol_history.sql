-- ═══════════════════════════════════════════════════════════════
-- Migration: Журнал изменений протокола (CHEM-08)
--
-- Кто и когда редактировал протокол и что именно изменилось (поля
-- шапки протокола + сколько значений результатов поменялось) —
-- для регуляторной прослеживаемости данных.
--
-- ПОРЯДОК ВЫПОЛНЕНИЯ: выполните весь скрипт в Supabase SQL Editor.
-- ═══════════════════════════════════════════════════════════════

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
