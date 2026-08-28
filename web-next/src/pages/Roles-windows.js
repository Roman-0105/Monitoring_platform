// ⚠ ПОКА НЕ ПОДКЛЮЧЁН — заготовка на замену web-next/src/pages/Roles.js при
// переходе на Windows-аутентификацию. Живой Roles.js продолжает работать
// с Supabase Auth (Edge Function admin-users, временные пароли), не трогать
// до отдельного шага переключения.
//
// Отличия от Supabase-версии:
//   - Нет паролей вообще — Windows Auth/AD решают вопрос входа, приложение
//     только сопоставляет Windows-логин с ролью. Поэтому нет ни временного
//     пароля при создании, ни отдельного действия "Сбросить пароль".
//   - Пользователь = строка в APP_USERS (login, display_name, role, active),
//     читается/пишется через тот же общий supabase.from(...), что и любая
//     другая таблица — отдельный Edge Function/callAdminFunction не нужен.
//   - PermissionMatrixCard не изменился ни на строку — матрица не завязана
//     на способ аутентификации, работает как есть через supabase.from('role_permissions').
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, ShieldCheck } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { ROLE_LABELS, ASSIGNABLE_ROLES } from '../lib/permissions.js';
import { NAV_SECTIONS } from '../nav-config.js';
import { Button, Card, CardHeader, CardTitle, CardContent, Badge, Input, Select, Field, Dialog, Skeleton, EmptyState } from '../components/ui.js';

// ── Диалог: создать/изменить пользователя ────────────────────────────────
function UserFormDialog({ open, editing, onClose, onSaved }) {
  const [login, setLogin] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('guest');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (editing) {
      setLogin(editing.login || ''); setDisplayName(editing.display_name || '');
      setRole(editing.role || 'guest'); setActive(editing.active !== false);
    } else {
      setLogin(''); setDisplayName(''); setRole('guest'); setActive(true);
    }
  }, [open, editing]);

  async function save() {
    setErr('');
    if (!login.trim()) { setErr('Укажите Windows-логин (DOMAIN\\username)'); return; }
    if (!displayName.trim()) { setErr('Укажите имя'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('APP_USERS').upsert({ login: login.trim(), display_name: displayName.trim(), role, active });
      if (error) { setErr(error.message); return; }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;
  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${editing ? 'Изменить пользователя' : 'Новый пользователь'} width="440px"
      footer=${html`
        ${err && html`<span style=${{ fontSize: '12px', color: 'var(--red-500)', marginRight: 'auto' }}>${err}</span>`}
        <${Button} variant="outline" onClick=${onClose} disabled=${saving}>Отмена<//>
        <${Button} onClick=${save} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить'}<//>
      `}>
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <${Field} label="Windows-логин *">
          <${Input} value=${login} disabled=${!!editing} placeholder="DOMAIN\\ivanov" onChange=${(e) => setLogin(e.target.value)} />
        <//>
        <${Field} label="Имя *">
          <${Input} value=${displayName} placeholder="Иван Иванов" onChange=${(e) => setDisplayName(e.target.value)} />
        <//>
        <${Field} label="Роль">
          <${Select} value=${role} onChange=${(e) => setRole(e.target.value)}>
            ${ASSIGNABLE_ROLES.map((r) => html`<option key=${r} value=${r}>${ROLE_LABELS[r]}<//>`)}
          <//>
        <//>
        <label style=${{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12.5px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked=${active} onChange=${(e) => setActive(e.target.checked)} /> Активен (может входить в систему)
        </label>
      </div>
    <//>
  `;
}

// ── Карточка: список пользователей ────────────────────────────────────────
function UsersCard() {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [formState, setFormState] = useState(null); // null | {mode:'new'} | {mode:'edit', user}
  const [deleteFor, setDeleteFor] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  async function load() {
    setError('');
    const { data, error: err } = await supabase.from('APP_USERS').select('*').order('display_name');
    if (err) { setError(err.message); setUsers([]); return; }
    setUsers(data || []);
  }
  useEffect(() => { load(); }, []);

  async function doDelete() {
    setDeleteBusy(true);
    try {
      const { error } = await supabase.from('APP_USERS').delete().eq('login', deleteFor.login);
      if (error) { setError(error.message); return; }
      setDeleteFor(null);
      load();
    } finally {
      setDeleteBusy(false);
    }
  }

  return html`
    <${Card}>
      <${CardHeader}>
        <${CardTitle} subtitle="Все аккаунты, кроме Главного Админа — он один и назначается напрямую в базе. Пароли не хранятся — вход по Windows-логину через IIS/AD">Пользователи<//>
        <${Button} size="sm" onClick=${() => setFormState({ mode: 'new' })}><${Plus} size=${14} /> Новый пользователь<//>
      <//>
      <${CardContent}>
        ${error && html`<div style=${{ fontSize: '12.5px', color: 'var(--red-500)', marginBottom: '10px' }}>${error}</div>`}
        ${users === null ? html`<${Skeleton} height="140px" />` : !users.length ? html`<${EmptyState} title="Пользователей пока нет" description="Добавьте первого через «Новый пользователь»" />` : html`
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Имя</th><th>Логин</th><th>Роль</th><th>Статус</th><th></th></tr></thead>
              <tbody>
                ${users.map((u) => html`
                  <tr key=${u.login}>
                    <td>${u.display_name || '—'}</td>
                    <td class="mono" style=${{ fontSize: '12px' }}>${u.login}</td>
                    <td><${Badge} variant=${u.role === 'admin' ? 'accent' : 'default'}>${ROLE_LABELS[u.role] || u.role}<//></td>
                    <td>${u.active ? html`<${Badge} variant="success">Активен<//>` : html`<${Badge} variant="danger">Отключён<//>`}</td>
                    <td style=${{ whiteSpace: 'nowrap', display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
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
    ${deleteFor && html`
      <${Dialog} open=${true} onClose=${() => setDeleteFor(null)} title="Удалить пользователя?" width="420px"
        footer=${html`
          <${Button} variant="outline" onClick=${() => setDeleteFor(null)} disabled=${deleteBusy}>Отмена<//>
          <${Button} onClick=${doDelete} disabled=${deleteBusy} style=${{ background: 'var(--red-500)', borderColor: 'var(--red-500)' }}>${deleteBusy ? 'Удаление…' : 'Удалить'}<//>
        `}>
        <div style=${{ fontSize: '13px', color: 'var(--text-secondary)' }}>Пользователь <b>${deleteFor.display_name || deleteFor.login}</b> потеряет доступ немедленно и без возможности восстановления.</div>
      <//>
    `}
  `;
}

// ── Карточка: матрица доступа по ролям (не меняется относительно Supabase-версии) ──
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
