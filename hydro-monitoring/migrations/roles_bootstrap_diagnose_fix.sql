-- Диагностика + починка назначения роли super_admin (регистронезависимо).
-- Выполнить в Supabase SQL Editor.

-- 1) Что реально хранится в auth.users и что в profiles сейчас:
SELECT u.id, u.email AS auth_email, p.role, p.active
FROM auth.users u
LEFT JOIN profiles p ON p.id = u.id
WHERE u.email ILIKE 'Roman.Yukin@rggold.kz';

-- 2) Назначить/поправить роль (регистронезависимое сравнение — сработает
-- даже если email в auth.users хранится в другом регистре):
INSERT INTO profiles (id, display_name, role, active)
SELECT id, 'Роман Юкин', 'super_admin', true
FROM auth.users WHERE email ILIKE 'Roman.Yukin@rggold.kz'
ON CONFLICT (id) DO UPDATE SET role = 'super_admin', active = true;

-- 3) Проверка результата — role должен быть super_admin:
SELECT u.email, p.role, p.active FROM auth.users u
JOIN profiles p ON p.id = u.id WHERE u.email ILIKE 'Roman.Yukin@rggold.kz';
