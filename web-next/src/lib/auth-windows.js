// ⚠ ПОКА НЕ ПОДКЛЮЧЁН — заготовка на замену web-next/src/lib/auth.js при
// переходе на Windows-аутентификацию (IIS + AD-группа). Живой auth.js
// продолжает работать на Supabase Auth, не трогать до отдельного шага
// переключения (см. server/README.md и mssql-client.js).
//
// Отличие от Supabase-версии: нет отдельного входа/выхода — IIS уже
// аутентифицировал пользователя (Windows Auth + AD-группа) до того, как
// запрос дошёл до приложения. "Профиль" — просто ответ /api/whoami:
// Windows-логин + роль из APP_USERS. Нет событий смены сессии (onAuthChange) —
// личность статична на время открытой вкладки.
const API_BASE = './api';

let _cached = null;

async function fetchWhoAmI() {
  const res = await fetch(`${API_BASE}/whoami`);
  if (!res.ok) {
    const err = new Error(res.status === 401 ? 'Не удалось определить пользователя (Windows-аутентификация)' : `Ошибка сервера (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json(); // {login, displayName, role, active}
}

export async function getSession() {
  try {
    const who = _cached || await fetchWhoAmI();
    _cached = who;
    return { user: { id: who.login } };
  } catch {
    return null;
  }
}

export async function getProfile(forceRefresh = false) {
  if (!_cached || forceRefresh) _cached = await fetchWhoAmI();
  const who = _cached;
  return { id: who.login, email: null, displayName: who.displayName, role: who.role, active: who.active !== false };
}

export function clearProfileCache() { _cached = null; }

// Реального "выхода" на уровне приложения нет — Windows Auth управляется IIS.
// Оставлено для совместимости вызовов из Topbar.js (кнопка ведёт на info-страницу
// "чтобы выйти — закройте браузер или обратитесь к администратору", а не дёргает API).
export async function signOut() { clearProfileCache(); }
