// Расчёт видимости/редактируемости разделов меню по роли текущего пользователя.
// 'super_admin' полный доступ ко всему всегда — зашито в коде, а не в таблице
// role_permissions, чтобы это в принципе нельзя было отключить через UI.
import { supabase } from './supabase.js';

export const ROLE_LABELS = {
  super_admin: 'Главный Админ',
  admin: 'Админ',
  senior_engineer: 'Ст. Гидрогеолог',
  engineer: 'Инженер Гидрогеолог',
  guest: 'Гость',
};

// Порядок ролей для матрицы/списков — от старшей к младшей.
export const ASSIGNABLE_ROLES = ['admin', 'senior_engineer', 'engineer', 'guest'];

export async function fetchRolePermissions() {
  const { data, error } = await supabase.from('role_permissions').select('*');
  if (error) throw new Error(error.message);
  return data || [];
}

// nav_key 'roles' намеренно не участвует в этой функции — его видимость
// решается отдельной жёсткой проверкой role === 'super_admin' в App.js.
export function buildPermissionMap(role, rows) {
  if (role === 'super_admin') {
    // Полный доступ к любому nav_key без необходимости перечислять их все.
    return new Proxy({}, { get: () => ({ can_view: true, can_edit: true }) });
  }
  const map = {};
  (rows || []).filter((r) => r.role === role).forEach((r) => {
    map[r.nav_key] = { can_view: !!r.can_view, can_edit: !!r.can_edit };
  });
  return map;
}

export function canView(permMap, navKey) {
  const p = permMap[navKey];
  return !!(p && p.can_view);
}
export function canEdit(permMap, navKey) {
  const p = permMap[navKey];
  return !!(p && p.can_edit);
}
