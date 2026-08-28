-- ============================================================
-- Система ролей и разграничения доступа (web-next).
-- Идемпотентна — можно запускать повторно без ошибок.
-- Выполнить целиком в Supabase SQL Editor.
-- ============================================================

-- ── 1. profiles: расширяем с 2 ролей (admin/user) до 5 ────────
CREATE TABLE IF NOT EXISTS profiles (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text        NOT NULL DEFAULT '',
  role         text        NOT NULL DEFAULT 'guest',
  active       boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Старый CHECK (если ставился 03_auth.sql) допускал только admin/user —
-- снимаем его, переносим прежних 'user' в безопасный по умолчанию 'guest',
-- затем ставим новый CHECK на 5 актуальных ролей.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
UPDATE profiles SET role = 'guest' WHERE role = 'user';
ALTER TABLE profiles ALTER COLUMN role SET DEFAULT 'guest';
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'admin', 'senior_engineer', 'engineer', 'guest'));

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Гарантия «только один Главный Админ» — на уровне БД, не только UI.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_one_super_admin
  ON profiles (role) WHERE role = 'super_admin';

-- ── 2. Хелперы (SECURITY DEFINER — обходят RLS при самопроверке) ──
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT role = 'super_admin' FROM profiles WHERE id = auth.uid()), false);
$$;

CREATE OR REPLACE FUNCTION current_role_code()
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

-- ── 3. Политики profiles ───────────────────────────────────────
DROP POLICY IF EXISTS "profiles_select" ON profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
DROP POLICY IF EXISTS "profiles_select_self_or_admin" ON profiles;
DROP POLICY IF EXISTS "profiles_update_super_admin_only" ON profiles;

CREATE POLICY "profiles_select_self_or_admin" ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR is_super_admin());

-- Реальные изменения идут через Edge Function admin-users (service-role,
-- обходит RLS) — эта политика подстраховывает от прямых запросов клиента.
CREATE POLICY "profiles_update_super_admin_only" ON profiles FOR UPDATE TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ── 4. role_permissions: матрица «роль × вкладка → нет/просмотр/редактирование» ──
CREATE TABLE IF NOT EXISTS role_permissions (
  role     text NOT NULL CHECK (role IN ('admin', 'senior_engineer', 'engineer', 'guest')),
  nav_key  text NOT NULL,
  can_view boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  PRIMARY KEY (role, nav_key)
);
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_select_all" ON role_permissions;
DROP POLICY IF EXISTS "role_permissions_write_super_admin_only" ON role_permissions;

-- Любой залогиненный должен прочитать матрицу, чтобы понять свои права.
CREATE POLICY "role_permissions_select_all" ON role_permissions FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "role_permissions_write_super_admin_only" ON role_permissions FOR ALL TO authenticated
  USING (is_super_admin()) WITH CHECK (is_super_admin());

-- ── 5. Стартовая матрица (можно менять потом во вкладке «Роли и доступ») ──
INSERT INTO role_permissions (role, nav_key, can_view, can_edit) VALUES
  -- Обзор / Водопроявления / Реестр
  ('admin',           'overview', true, true), ('senior_engineer', 'overview', true, true), ('engineer', 'overview', true, false), ('guest', 'overview', true, false),
  ('admin',           'map',      true, true), ('senior_engineer', 'map',      true, true), ('engineer', 'map',      true, false), ('guest', 'map',      true, false),
  ('admin',           'points',   true, true), ('senior_engineer', 'points',   true, true), ('engineer', 'points',   true, false), ('guest', 'points',   true, false),
  ('admin',           'wpmap',    true, true), ('senior_engineer', 'wpmap',    true, true), ('engineer', 'wpmap',    true, false), ('guest', 'wpmap',    true, false),
  ('admin',           'stats',    true, true), ('senior_engineer', 'stats',    true, true), ('engineer', 'stats',    true, false), ('guest', 'stats',    true, false),
  ('admin',           'registry', true, true), ('senior_engineer', 'registry', true, true), ('engineer', 'registry', true, false), ('guest', 'registry', true, false),
  -- Данные/журналы, которые ведут инженеры
  ('admin',           'well-levels', true, true), ('senior_engineer', 'well-levels', true, true), ('engineer', 'well-levels', true, true), ('guest', 'well-levels', true, false),
  ('admin',           'chem',        true, true), ('senior_engineer', 'chem',        true, true), ('engineer', 'chem',        true, true), ('guest', 'chem',        true, false),
  ('admin',           'wells',       true, true), ('senior_engineer', 'wells',       true, true), ('engineer', 'wells',       true, true), ('guest', 'wells',       true, false),
  ('admin',           'dewatering',  true, true), ('senior_engineer', 'dewatering',  true, true), ('engineer', 'dewatering',  true, true), ('guest', 'dewatering',  true, false),
  ('admin',           'dust',        true, true), ('senior_engineer', 'dust',        true, true), ('engineer', 'dust',        true, true), ('guest', 'dust',        true, false),
  -- 3D / прогноз / отчёт
  ('admin',           'pit3d',         true, true), ('senior_engineer', 'pit3d',         true, true), ('engineer', 'pit3d',         true, false), ('guest', 'pit3d',         true, false),
  ('admin',           'sump-forecast', true, true), ('senior_engineer', 'sump-forecast', true, true), ('engineer', 'sump-forecast', true, false), ('guest', 'sump-forecast', true, false),
  ('admin',           'report',        true, true), ('senior_engineer', 'report',        true, true), ('engineer', 'report',        true, false), ('guest', 'report',        true, false),
  -- Риски (внешняя ссылка)
  ('admin',           'risks', true, true), ('senior_engineer', 'risks', true, false), ('engineer', 'risks', true, false), ('guest', 'risks', false, false),
  -- Система
  ('admin',           'settings', true, true), ('senior_engineer', 'settings', true, false), ('engineer', 'settings', false, false), ('guest', 'settings', false, false),
  ('admin',           'diag',     true, true), ('senior_engineer', 'diag',     false, false), ('engineer', 'diag',     false, false), ('guest', 'diag',     false, false)
ON CONFLICT (role, nav_key) DO NOTHING;

-- ── 6. Bootstrap: назначить вашего пользователя Главным Админом ──
-- Сработает только после того, как вы создадите auth-аккаунт с этим email
-- через Supabase Dashboard → Authentication → Users → Add user.
INSERT INTO profiles (id, display_name, role, active)
SELECT id, 'Роман Юкин', 'super_admin', true FROM auth.users WHERE email = 'Roman.Yukin@rggold.kz'
ON CONFLICT (id) DO UPDATE SET role = 'super_admin', active = true;
