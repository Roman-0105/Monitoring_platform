import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, KeyRound, Copy, Check, ShieldCheck } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { callAdminFunction } from '../lib/auth.js';
import { ROLE_LABELS, ASSIGNABLE_ROLES } from '../lib/permissions.js';
import { NAV_SECTIONS } from '../nav-config.js';
import { Button, Card, CardHeader, CardTitle, CardContent, Badge, Input, Select, Field, Dialog, Skeleton, EmptyState } from '../components/ui.js';

// ── Копируемое поле для одноразового показа временного пароля ────────────
function TempPasswordBox({ password }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  }
  return html`
    <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--amber-100)', border: '1px solid var(--amber-500)' }}>
      <div style=${{ flex: 1 }}>
        <div style=${{ fontSize: '11px', fontWeight: 700, color: 'var(--amber-600)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Временный пароль (показывается один раз)</div>
        <div class="mono" style=${{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>${password}</div>
      </div>
      <${Button} variant="outline" size="sm" onClick=${copy}>${copied ? html`<${Check} size=${13} />` : html`<${Copy} size=${13} />`} ${copied ? 'Скопировано' : 'Копировать'}<//>
    </div>
  `;
}

// ── Диалог: создать/изменить пользователя ────────────────────────────────
function UserFormDialog({ open, editing, onClose, onSaved }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('guest');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [tempPassword, setTempPassword] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr(''); setTempPassword('');
    if (editing) {
      setEmail(editing.email || ''); setDisplayName(editing.displayName || '');
      setRole(editing.role || 'guest'); setActive(editing.active !== false);
    } else {
      setEmail(''); setDisplayName(''); setRole('guest'); setActive(true);
    }
  }, [open, editing]);

  async function save() {
    setErr('');
    if (!editing && !email.trim()) { setErr('Укажите email'); return; }
    if (!displayName.trim()) { setErr('Укажите имя'); return; }
    setSaving(true);
    try {
      if (editing) {
        await callAdminFunction({ action: 'update', userId: editing.id, displayName: displayName.trim(), role, active });
        onSaved();
      } else {
        const res = await callAdminFunction({ action: 'create', email: email.trim(), displayName: displayName.trim(), role });
        setTempPassword(res.tempPassword);
        onSaved();
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${editing ? 'Изменить пользователя' : 'Новый пользователь'} width="440px"
      footer=${tempPassword ? html`<${Button} onClick=${onClose}>Готово<//>` : html`
        ${err && html`<span style=${{ fontSize: '12px', color: 'var(--red-500)', marginRight: 'auto' }}>${err}</span>`}
        <${Button} variant="outline" onClick=${onClose} disabled=${saving}>Отмена<//>
        <${Button} onClick=${save} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить'}<//>
      `}>
      ${tempPassword ? html`
        <div style=${{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          Пользователь <b>${displayName}</b> создан. Передайте ему email и пароль ниже — после входа он сможет сменить пароль сам.
        </div>
        <${TempPasswordBox} password=${tempPassword} />
      ` : html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <${Field} label="Email *">
            <${Input} type="email" value=${email} disabled=${!!editing} placeholder="user@rggold.kz" onChange=${(e) => setEmail(e.target.value)} />
          <//>
          <${Field} label="Имя *">
            <${Input} value=${displayName} placeholder="Иван Иванов" onChange=${(e) => setDisplayName(e.target.value)} />
          <//>
          <${Field} label="Роль">
            <${Select} value=${role} onChange=${(e) => setRole(e.target.value)}>
              ${ASSIGNABLE_ROLES.map((r) => html`<option key=${r} value=${r}>${ROLE_LABELS[r]}<//>`)}
            <//>
          <//>
          ${editing && html`
            <label style=${{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12.5px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked=${active} onChange=${(e) => setActive(e.target.checked)} /> Активен (может входить в систему)
            </label>
          `}
        </div>
      `}
    <//>
  `;
}

// ── Карточка: список пользователей ────────────────────────────────────────
function UsersCard() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [formState, setFormState] = useState(null); // null | {mode:'new'} | {mode:'edit', user}
  const [resetFor, setResetFor] = useState(null); // {id, displayName} | null
  const [resetPassword, setResetPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [deleteFor, setDeleteFor] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function load() {
    setError('');
    try {
      const res = await callAdminFunction({ action: 'list' });
      setUsers((res.users || []).sort((a, b) => a.email.localeCompare(b.email)));
    } catch (e) {
      setError(e.message);
      setUsers([]);
    }
  }
  useEffect(() => { load(); }, []);

  async function doResetPassword() {
    setResetBusy(true);
    try {
      const res = await callAdminFunction({ action: 'reset_password', userId: resetFor.id });
      setResetPassword(res.tempPassword);
    } catch (e) {
      setError(e.message);
      setResetFor(null);
    } finally {
      setResetBusy(false);
    }
  }

  async function doDelete() {
    setDeleteBusy(true);
    try {
      await callAdminFunction({ action: 'delete', userId: deleteFor.id });
      setDeleteFor(null);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setDeleteBusy(false);
    }
  }

  return html`
    <${Card}>
      <${CardHeader}>
        <${CardTitle} subtitle="Все аккаунты, кроме Главного Админа — он один и назначается напрямую в базе">Пользователи<//>
        <${Button} size="sm" onClick=${() => setFormState({ mode: 'new' })}><${Plus} size=${14} /> Новый пользователь<//>
      <//>
      <${CardContent}>
        ${error && html`<div style=${{ fontSize: '12.5px', color: 'var(--red-500)', marginBottom: '10px' }}>${error}</div>`}
        ${users === null ? html`<${Skeleton} height="140px" />` : !users.length ? html`<${EmptyState} title="Пользователей пока нет" description="Добавьте первого через «Новый пользователь»" />` : html`
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Имя</th><th>Email</th><th>Роль</th><th>Статус</th><th></th></tr></thead>
              <tbody>
                ${users.map((u) => html`
                  <tr key=${u.id}>
                    <td>${u.displayName || '—'}</td>
                    <td class="mono" style=${{ fontSize: '12px' }}>${u.email}</td>
                    <td><${Badge} variant=${u.role === 'admin' ? 'accent' : 'default'}>${ROLE_LABELS[u.role] || u.role}<//></td>
                    <td>${u.active ? html`<${Badge} variant="success">Активен<//>` : html`<${Badge} variant="danger">Отключён<//>`}</td>
                    <td style=${{ whiteSpace: 'nowrap', display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                      <${Button} variant="ghost" size="sm" icon title="Сбросить пароль" onClick=${() => { setResetFor(u); setResetPassword(''); }}><${KeyRound} size=${13} /><//>
                      <${Button} variant="ghost" size="sm" icon title="Изменить" onClick=${() => setFormState({ mode: 'edit', user: u })}><${Pencil} size=${13} /><//>
                      <${Button} variant="ghost" size="sm" icon title="Удалить" onClick=${() => setDeleteFor(u)}><${Trash2} size=${13} style=${{ color: 'var(--red-500)' }} /><//>
                    </td>
                  </tr>
                `)}
              </tbody>
            </table>
          </div>
        `}
      <//>
    <//>
    <${UserFormDialog} open=${!!formState} editing=${formState && formState.mode === 'edit' ? formState.user : null}
      onClose=${() => setFormState(null)} onSaved=${load} />
    ${resetFor && html`
      <${Dialog} open=${true} onClose=${() => setResetFor(null)} title=${'Сбросить пароль — ' + resetFor.displayName} width="420px"
        footer=${resetPassword ? html`<${Button} onClick=${() => setResetFor(null)}>Готово<//>` : html`
          <${Button} variant="outline" onClick=${() => setResetFor(null)} disabled=${resetBusy}>Отмена<//>
          <${Button} onClick=${doResetPassword} disabled=${resetBusy}>${resetBusy ? 'Генерация…' : 'Сгенерировать новый пароль'}<//>
        `}>
        ${resetPassword ? html`<${TempPasswordBox} password=${resetPassword} />` : html`<div style=${{ fontSize: '13px', color: 'var(--text-secondary)' }}>Старый пароль перестанет работать сразу после подтверждения.</div>`}
      <//>
    `}
    ${deleteFor && html`
      <${Dialog} open=${true} onClose=${() => setDeleteFor(null)} title="Удалить пользователя?" width="420px"
        footer=${html`
          <${Button} variant="outline" onClick=${() => setDeleteFor(null)} disabled=${deleteBusy}>Отмена<//>
          <${Button} onClick=${doDelete} disabled=${deleteBusy} style=${{ background: 'var(--red-500)', borderColor: 'var(--red-500)' }}>${deleteBusy ? 'Удаление…' : 'Удалить'}<//>
        `}>
        <div style=${{ fontSize: '13px', color: 'var(--text-secondary)' }}>Пользователь <b>${deleteFor.displayName || deleteFor.email}</b> потеряет доступ немедленно и без возможности восстановления.</div>
      <//>
    `}
  `;
}

// ── Карточка: матрица доступа по ролям ────────────────────────────────────
function levelOf(row) {
  if (!row) return 'none';
  if (row.can_edit) return 'edit';
  if (row.can_view) return 'view';
  return 'none';
}

function PermissionMatrixCard() {
  const [rows, setRows] = useState(null); // [{role, nav_key, can_view, can_edit}]
  const [error, setError] = useState('');
  const [savingKey, setSavingKey] = useState(''); // `${role}:${navKey}` while saving

  async function load() {
    const { data, error: err } = await supabase.from('role_permissions').select('*');
    if (err) { setError(err.message); setRows([]); return; }
    setRows(data || []);
  }
  useEffect(() => { load(); }, []);

  const navItems = useMemo(() => {
    const out = [];
    NAV_SECTIONS.forEach((section) => {
      section.items.forEach((item) => { if (item.key !== 'roles') out.push({ ...item, sectionLabel: section.label || '' }); });
    });
    return out;
  }, []);

  const byKey = useMemo(() => {
    const m = {};
    (rows || []).forEach((r) => { m[r.role + ':' + r.nav_key] = r; });
    return m;
  }, [rows]);

  async function setLevel(role, navKey, level) {
    const can_view = level !== 'none';
    const can_edit = level === 'edit';
    setSavingKey(role + ':' + navKey);
    setRows((prev) => {
      const next = (prev || []).filter((r) => !(r.role === role && r.nav_key === navKey));
      next.push({ role, nav_key: navKey, can_view, can_edit });
      return next;
    });
    const { error: err } = await supabase.from('role_permissions').upsert({ role, nav_key: navKey, can_view, can_edit });
    if (err) setError(err.message);
    setSavingKey('');
  }

  if (rows === null) return html`<${Card}><${CardContent}><${Skeleton} height="300px" /><//><//>`;

  let lastSection = null;
  return html`
    <${Card}>
      <${CardHeader}><${CardTitle} subtitle="Нет / Просмотр / Просмотр и редактирование — применяется сразу, дополнительное сохранение не нужно">Матрица доступа по ролям<//><//>
      <${CardContent} tight>
        ${error && html`<div style=${{ fontSize: '12.5px', color: 'var(--red-500)', padding: '10px 14px' }}>${error}</div>`}
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Раздел</th>${ASSIGNABLE_ROLES.map((r) => html`<th key=${r}>${ROLE_LABELS[r]}<//>`)}</tr></thead>
            <tbody>
              ${navItems.map((item) => {
                const sectionHeader = item.sectionLabel !== lastSection ? item.sectionLabel : null;
                lastSection = item.sectionLabel;
                return html`
                  ${sectionHeader && html`<tr key=${'sec-' + item.key}><td colspan=${ASSIGNABLE_ROLES.length + 1} style=${{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-tertiary)', background: 'var(--bg-sunken)', padding: '6px 12px' }}>${sectionHeader}<//></tr>`}
                  <tr key=${item.key}>
                    <td>${item.label}</td>
                    ${ASSIGNABLE_ROLES.map((role) => {
                      const level = levelOf(byKey[role + ':' + item.key]);
                      const busy = savingKey === role + ':' + item.key;
                      return html`
                        <td key=${role}>
                          <${Select} value=${level} disabled=${busy} onChange=${(e) => setLevel(role, item.key, e.target.value)} style=${{ fontSize: '12px', opacity: busy ? 0.6 : 1 }}>
                            <option value="none">Нет</option>
                            <option value="view">Просмотр</option>
                            <option value="edit">Редактирование</option>
                          <//>
                        </td>
                      `;
                    })}
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      <//>
    <//>
  `;
}

export function RolesPage() {
  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title"><${ShieldCheck} size=${22} style=${{ verticalAlign: '-4px', marginRight: '8px', color: 'var(--gold-500)' }} />Роли и доступ<//>
          <div class="page-desc">Видна и редактируется только Главным Админом. Управление пользователями и тем, что видит и может менять каждая роль.</div>
        </div>
      </div>
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <${UsersCard} />
        <${PermissionMatrixCard} />
      </div>
    </div>
  `;
}
