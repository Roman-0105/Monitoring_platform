/**
 * auth.js — авторизация через Supabase Auth.
 * Должен подключаться ПОСЛЕ api.js.
 *
 * Экспортирует: Auth.signIn, Auth.signOut, Auth.getProfile,
 *               Auth.callAdminFunction, Auth.onAuthChange
 */

var Auth = (function() {

  // ── Состояние ─────────────────────────────────────────────
  var _profile = null; // { id, email, displayName, role }

  function _client() { return Api.client(); }

  // ── Вход ─────────────────────────────────────────────────
  async function signIn(email, password) {
    var { data, error } = await _client().auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    _profile = null; // сбросим кэш профиля
    return data.user;
  }

  // ── Выход ─────────────────────────────────────────────────
  async function signOut() {
    await _client().auth.signOut();
    _profile = null;
    AppState.currentUser = null;
  }

  // ── Текущая сессия ────────────────────────────────────────
  async function getSession() {
    var { data } = await _client().auth.getSession();
    return data.session;
  }

  // ── Профиль текущего пользователя ────────────────────────
  async function getProfile() {
    if (_profile) return _profile;
    var res = await _client().auth.getUser();
    if (res.error) throw new Error(res.error.message);
    var user = res.data && res.data.user;
    if (!user) return null;
    var { data: prof } = await _client()
      .from('profiles').select('display_name, role').eq('id', user.id).maybeSingle();
    _profile = {
      id:          user.id,
      email:       user.email,
      displayName: prof ? prof.display_name : (user.email || ''),
      role:        prof ? prof.role : 'user',
    };
    return _profile;
  }

  // ── Вызов Edge Function admin-users ──────────────────────
  async function callAdminFunction(body) {
    var sr = await _client().auth.getSession();
    var session = sr.data && sr.data.session;
    if (!session) throw new Error('Нет сессии');
    var cfg = window.APP_CONFIG || {};
    var resp = await fetch(cfg.SUPABASE_URL + '/functions/v1/admin-users', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + session.access_token,
        'apikey':        cfg.SUPABASE_KEY,
      },
      body: JSON.stringify(body),
    });
    var json = await resp.json();
    if (!resp.ok) throw new Error(json.error || 'Ошибка сервера');
    return json;
  }

  // ── Слушатель изменений auth-состояния ────────────────────
  function onAuthChange(callback) {
    _client().auth.onAuthStateChange(function(event, session) {
      if (event === 'SIGNED_OUT' || !session) {
        _profile = null;
        AppState.currentUser = null;
      }
      callback(event, session);
    });
  }

  return { signIn, signOut, getSession, getProfile, callAdminFunction, onAuthChange };
})();
