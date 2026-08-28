import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { html } from '../lib/html.js';
import * as Auth from '../lib/auth.js';
import { fetchRolePermissions, buildPermissionMap } from '../lib/permissions.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [permMap, setPermMap] = useState({});

  const loadForSession = useCallback(async (sess) => {
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
      const sess = await Auth.getSession();
      if (cancelled) return;
      setSession(sess);
      await loadForSession(sess);
      if (!cancelled) setLoading(false);
    })();

    const sub = Auth.onAuthChange((_event, sess) => {
      setSession(sess);
      loadForSession(sess);
    });
    return () => { cancelled = true; sub && sub.unsubscribe && sub.unsubscribe(); };
  }, [loadForSession]);

  async function signOut() {
    await Auth.signOut();
    setSession(null);
    setProfile(null);
    setPermMap({});
  }

  const value = { loading, session, profile, permMap, signOut, reload: () => loadForSession(session) };
  return html`<${AuthCtx.Provider} value=${value}>${children}<//>`;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth() вне AuthProvider');
  return ctx;
}
