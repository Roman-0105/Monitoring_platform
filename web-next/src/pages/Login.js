import React, { useState } from 'react';
import { LogIn } from 'lucide-react';
import { html } from '../lib/html.js';
import { signIn } from '../lib/auth.js';
import { Button, Field, Input } from '../components/ui.js';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) { setError('Введите email и пароль'); return; }
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      // Дальше AuthProvider сам подхватит сессию через onAuthChange.
    } catch (err) {
      setBusy(false);
      setError(/invalid login credentials/i.test(err.message) ? 'Неверный email или пароль' : err.message);
    }
  }

  return html`
    <div style=${{
      position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-sunken)', zIndex: 1000,
    }}>
      <form onSubmit=${handleSubmit} style=${{
        width: 'min(380px, 92vw)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)', padding: '36px 32px', boxShadow: '0 8px 32px rgba(0,0,0,.08)',
      }}>
        <div style=${{ textAlign: 'center', marginBottom: '28px' }}>
          <img src="./public/logo.png" alt="" style=${{ height: '40px', marginBottom: '10px' }} />
          <div style=${{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>Мониторинг карьера</div>
        </div>

        <${Field} label="Email">
          <${Input} type="email" autoComplete="email" placeholder="user@rggold.kz" value=${email}
            onChange=${(e) => setEmail(e.target.value)} autoFocus />
        <//>
        <div style=${{ height: '12px' }} />
        <${Field} label="Пароль">
          <${Input} type="password" autoComplete="current-password" placeholder="••••••••" value=${password}
            onChange=${(e) => setPassword(e.target.value)} />
        <//>

        ${error && html`<div style=${{ marginTop: '12px', padding: '9px 12px', borderRadius: 'var(--radius-md)', background: 'var(--red-100)', color: 'var(--red-500)', fontSize: '12.5px' }}>${error}</div>`}

        <${Button} type="submit" disabled=${busy} style=${{ width: '100%', marginTop: '20px', justifyContent: 'center' }}>
          <${LogIn} size=${15} /> ${busy ? 'Вход…' : 'Войти'}
        <//>
      </form>
    </div>
  `;
}
