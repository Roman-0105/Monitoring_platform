import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { Button, Card, CardHeader, CardTitle, CardContent, Input, Badge, Skeleton } from '../components/ui.js';

function genId() { return 'wk' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function WorkersCard() {
  const [workers, setWorkers] = useState(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data } = await supabase.from('workers').select('*').eq('active', true).order('name');
    setWorkers(data || []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    await supabase.from('workers').upsert({ id: genId(), name: name.trim(), active: true, created_at: new Date().toISOString() });
    setSaving(false);
    setName('');
    load();
  }

  async function remove(w) {
    if (!confirm(`Убрать сотрудника «${w.name}» из списка?`)) return;
    await supabase.from('workers').update({ active: false }).eq('id', w.id);
    load();
  }

  return html`
    <${Card}>
      <${CardHeader}><${CardTitle} subtitle="Список для выбора при вводе замеров">Сотрудники<//><//>
      <${CardContent}>
        <div style=${{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          <${Input} placeholder="Имя сотрудника" value=${name} onChange=${(e) => setName(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && add()} />
          <${Button} onClick=${add} disabled=${saving}><${Plus} size=${15} /> Добавить<//>
        </div>
        ${workers === null ? html`<${Skeleton} height="120px" />` : html`
          <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            ${workers.length === 0 && html`<div style=${{ fontSize: '13px', color: 'var(--text-tertiary)' }}>Сотрудников нет</div>`}
            ${workers.map((w) => html`
              <div key=${w.id} style=${{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 4px', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style=${{ flex: 1, fontSize: '13px', fontWeight: 600 }}>${w.name}</span>
                <${Button} variant="ghost" size="sm" icon onClick=${() => remove(w)}><${Trash2} size=${13} style=${{ color: 'var(--red-500)' }} /><//>
              </div>
            `)}
          </div>
        `}
      <//>
    <//>
  `;
}

function QuarryBoundsCard() {
  const [quarries, setQuarries] = useState(null);
  const [edited, setEdited] = useState({});
  const [saving, setSaving] = useState(null);

  async function load() {
    const { data } = await supabase.from('quarries').select('*').order('id');
    setQuarries(data || []);
  }
  useEffect(() => { load(); }, []);

  function field(q, key) { return edited[q.id]?.[key] ?? (q[key] ?? ''); }
  function setField(q, key, val) { setEdited((e) => ({ ...e, [q.id]: { ...e[q.id], [key]: val } })); }

  async function save(q) {
    setSaving(q.id);
    const patch = edited[q.id] || {};
    await supabase.from('quarries').update({
      x_min: patch.x_min !== undefined ? parseFloat(patch.x_min) : q.x_min,
      x_max: patch.x_max !== undefined ? parseFloat(patch.x_max) : q.x_max,
      y_min: patch.y_min !== undefined ? parseFloat(patch.y_min) : q.y_min,
      y_max: patch.y_max !== undefined ? parseFloat(patch.y_max) : q.y_max,
    }).eq('id', q.id);
    setSaving(null);
    load();
  }

  return html`
    <${Card}>
      <${CardHeader}><${CardTitle} subtitle="Калибровка координат для схематичных карт (Карта, Карта водопунктов)">Границы карьеров<//><//>
      <${CardContent}>
        ${quarries === null ? html`<${Skeleton} height="120px" />` : quarries.map((q) => html`
          <div key=${q.id} style=${{ marginBottom: '16px', paddingBottom: '16px', borderBottom: '1px solid var(--border-subtle)' }}>
            <div style=${{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <${Badge} variant="accent">${q.name}<//>
            </div>
            <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: '8px', alignItems: 'end' }}>
              <div><label style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>X мин</label><${Input} type="number" value=${field(q, 'x_min')} onChange=${(e) => setField(q, 'x_min', e.target.value)} /></div>
              <div><label style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>X макс</label><${Input} type="number" value=${field(q, 'x_max')} onChange=${(e) => setField(q, 'x_max', e.target.value)} /></div>
              <div><label style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Y мин</label><${Input} type="number" value=${field(q, 'y_min')} onChange=${(e) => setField(q, 'y_min', e.target.value)} /></div>
              <div><label style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Y макс</label><${Input} type="number" value=${field(q, 'y_max')} onChange=${(e) => setField(q, 'y_max', e.target.value)} /></div>
              <${Button} size="sm" onClick=${() => save(q)} disabled=${saving === q.id}><${Save} size=${14} /><//>
            </div>
          </div>
        `)}
      <//>
    <//>
  `;
}

export function SettingsPage() {
  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Настройки</div>
          <div class="page-desc">Справочники и калибровка платформы.</div>
        </div>
      </div>
      <div class="grid grid-2">
        <${WorkersCard} />
        <${QuarryBoundsCard} />
      </div>
    </div>
  `;
}
