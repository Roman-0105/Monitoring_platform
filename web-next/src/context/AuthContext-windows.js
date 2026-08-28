// ⚠ ПОКА НЕ ПОДКЛЮЧЁН — заготовка на замену AuthContext.js при переходе на
// Windows-аутентификацию. Живой AuthContext.js продолжает работать с
// auth.js (Supabase Auth), не трогать до отдельного шага переключения.
//
// Отличие от Supabase-версии: нет onAuthChange (личность статична на время
// открытой вкладки — IIS аутентифицировал один раз, до захода в приложение),
// поэтому session/profile загружаются один раз при монтировании.
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { html } from '../lib/html.js';
import * as Auth from '../lib/auth-windows.js';
import { fetchRolePermissions, buildPermissionMap } from '../lib/permissions.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [permMap, setPermMap] = useState({});

  const load = useCallback(async () => {
    const sess = await Auth.getSession();
    setSession(sess);
    if (!sess) { setProfile(null); setPermMap({}); return; }
    const prof = await Auth.getProfile(true);
    setProfile(prof);
    if (prof && prof.role) {
      const rows = prof.role === 'super_admin' ? [] : await fetchRolePermissions();
      setPermMap(buildPermissionMap(prof.role, rows));
    } else {
      setPermMap({});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [load]);

  async function signOut() {
    await Auth.signOut();
    setSession(null);
    setProfile(null);
    setPermMap({});
  }

  const value = { loading, session, profile, permMap, signOut, reload: load };
  return html`<${AuthCtx.Provider} value=${value}>${children}<//>`;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth() вне AuthProvider');
  return ctx;
}
