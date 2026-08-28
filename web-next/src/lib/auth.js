// Клиент авторизации поверх Supabase Auth — порт hydro-monitoring/auth.js на
// ESM/промисы. Профиль (display_name/role/active) кэшируется в памяти между
// вызовами getProfile(); сбрасывается при смене сессии.
import { supabase, SUPABASE_URL, SUPABASE_KEY } from './supabase.js';

let _profile = null; // { id, email, displayName, role, active }

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  _profile = null;
  return data.user;
}

export async function signOut() {
  await supabase.auth.signOut();
  _profile = null;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getProfile(forceRefresh = false) {
  if (_profile && !forceRefresh) return _profile;
  const res = await supabase.auth.getUser();
  if (res.error) throw new Error(res.error.message);
  const user = res.data && res.data.user;
  if (!user) return null;
  const { data: prof } = await supabase.from('profiles').select('display_name, role, active').eq('id', user.id).maybeSingle();
  _profile = {
    id: user.id,
    email: user.email,
    displayName: prof ? prof.display_name : (user.email || ''),
    role: prof ? prof.role : null,
    active: prof ? prof.active !== false : false,
  };
  return _profile;
}

export function clearProfileCache() { _profile = null; }

export function onAuthChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || !session) _profile = null;
    callback(event, session);
  });
  return data.subscription;
}

// Вызов Edge Function admin-users (создание/изменение/удаление/список
// пользователей, сброс пароля) — требует активной сессии, права проверяются
// на сервере по service-role ключу (см. supabase/functions/admin-users).
export async function callAdminFunction(body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Нет сессии');
  const resp = await fetch(SUPABASE_URL + '/functions/v1/admin-users', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + session.access_token,
      apikey: SUPABASE_KEY,
    },
    body: JSON.stringify(body),
  });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error || 'Ошибка сервера');
  return json;
}

export async function changeOwnPassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}
