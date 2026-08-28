import React, { useState } from 'react';
import { LogOut, KeyRound } from 'lucide-react';
import { html } from '../lib/html.js';
import { changeOwnPassword } from '../lib/auth.js';
import { Button, Dialog, Field, Input } from '../components/ui.js';

function ChangePasswordDialog({ open, onClose }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);

  async function save() {
    setErr('');
    if (password.length < 6) { setErr('Минимум 6 символов'); return; }
    if (password !== confirm) { setErr('Пароли не совпадают'); return; }
    setBusy(true);
    try { await changeOwnPassword(password); setDone(true); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (!open) return null;
  return html`
    <${Dialog} open=${true} onClose=${onClose} title="Сменить пароль" width="380px"
      footer=${done ? html`<${Button} onClick=${onClose}>Готово<//>` : html`
        ${err && html`<span style=${{ fontSize: '12px', color: 'var(--red-500)', marginRight: 'auto' }}>${err}</span>`}
        <${Button} variant="outline" onClick=${onClose} disabled=${busy}>Отмена<//>
        <${Button} onClick=${save} disabled=${busy}>${busy ? 'Сохранение…' : 'Сохранить'}<//>
      `}>
      ${done ? html`<div style=${{ fontSize: '13px', color: 'var(--text-secondary)' }}>Пароль изменён.</div>` : html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <${Field} label="Новый пароль"><${Input} type="password" autoFocus value=${password} onChange=${(e) => setPassword(e.target.value)} /><//>
          <${Field} label="Повторите пароль"><${Input} type="password" value=${confirm} onChange=${(e) => setConfirm(e.target.value)} /><//>
        </div>
      `}
    <//>
  `;
}

export function Topbar({ title, crumb, quarry, onQuarryChange, userName, roleLabel, onSignOut }) {
  const [pwOpen, setPwOpen] = useState(false);
  const initials = (userName || 'U').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase();
  return html`
    <header class="topbar">
      <div>
        ${crumb && html`<div class="topbar-crumb">${crumb}</div>`}
        <div class="topbar-title">${title}</div>
      </div>
      <div class="topbar-spacer" />
      <div class="quarry-switch">
        ${['ЮРГ', 'СРГ'].map((q) => html`
          <button key=${q} class=${quarry === q ? 'active' : ''} onClick=${() => onQuarryChange(q)}>${q}</button>
        `)}
      </div>
      <div class="topbar-user">
        <div class="topbar-avatar">${initials}</div>
        <div>
          <div class="topbar-user-name">${userName}</div>
          <div class="topbar-user-role">${roleLabel || ''}</div>
        </div>
      </div>
      <${Button} variant="ghost" size="sm" icon title="Сменить пароль" onClick=${() => setPwOpen(true)}><${KeyRound} size=${15} /><//>
      <${Button} variant="ghost" size="sm" icon title="Выйти" onClick=${onSignOut}><${LogOut} size=${15} /><//>
      <${ChangePasswordDialog} open=${pwOpen} onClose=${() => setPwOpen(false)} />
    </header>
  `;
}
