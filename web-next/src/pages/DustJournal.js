import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Wind, Pencil, Trash2 } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { Button, Card, CardContent, Input, Select, Table, Badge, Dialog, Field } from '../components/ui.js';

function genId() { return 'dl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

const EMPTY_FORM = { id: null, date: today(), orgId: '', vehicleId: '', nozzleId: '', trips: '', notes: '' };

export function DustJournalPage() {
  const [logs, setLogs] = useState(null);
  const [orgs, setOrgs] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [nozzles, setNozzles] = useState([]);
  const [error, setError] = useState(null);
  const [dateFilter, setDateFilter] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function loadAll() {
    setError(null);
    const [logsRes, orgsRes, vehiclesRes, nozzlesRes] = await Promise.all([
      supabase.from('dust_logs').select('*').order('date', { ascending: false }).limit(300),
      supabase.from('dust_orgs').select('*').order('name'),
      supabase.from('dust_vehicles').select('*').order('name'),
      supabase.from('dust_nozzles').select('*').order('name'),
    ]);
    const err = logsRes.error || orgsRes.error || vehiclesRes.error || nozzlesRes.error;
    if (err) { setError(err.message); return; }
    setLogs(logsRes.data || []);
    setOrgs(orgsRes.data || []);
    setVehicles(vehiclesRes.data || []);
    setNozzles(nozzlesRes.data || []);
  }
  useEffect(() => { loadAll(); }, []);

  const orgById = useMemo(() => Object.fromEntries(orgs.map((o) => [o.id, o])), [orgs]);
  const vehicleById = useMemo(() => Object.fromEntries(vehicles.map((v) => [v.id, v])), [vehicles]);
  const nozzleById = useMemo(() => Object.fromEntries(nozzles.map((n) => [n.id, n])), [nozzles]);

  function computeVolume(l) {
    if (l.is_manual_volume) return parseFloat(l.manual_volume) || 0;
    const v = vehicleById[l.vehicle_id];
    return (parseFloat(l.trips) || 0) * (v ? parseFloat(v.capacity) || 0 : 0);
  }

  const filtered = useMemo(() => {
    if (!logs) return [];
    if (!dateFilter) return logs;
    return logs.filter((l) => l.date === dateFilter);
  }, [logs, dateFilter]);

  function openAdd() { setForm(EMPTY_FORM); setDialogOpen(true); }
  function openEdit(row) {
    setForm({
      id: row.id, date: row.date, orgId: row.org_id || '', vehicleId: row.vehicle_id || '',
      nozzleId: row.nozzle_id || '', trips: row.trips ?? '', notes: row.notes || '',
    });
    setDialogOpen(true);
  }

  async function save() {
    if (!form.vehicleId || !form.trips) return;
    setSaving(true);
    const vehicle = vehicleById[form.vehicleId];
    const trips = parseFloat(form.trips) || 0;
    const row = {
      id: form.id || genId(),
      date: form.date,
      org_id: form.orgId || (vehicle ? vehicle.org_id : null),
      vehicle_id: form.vehicleId,
      nozzle_id: form.nozzleId || null,
      trips,
      total_volume: trips * (vehicle ? parseFloat(vehicle.capacity) || 0 : 0),
      is_manual_volume: false,
      manual_volume: null,
      notes: form.notes.trim(),
    };
    const { error: err } = await supabase.from('dust_logs').upsert(row);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setDialogOpen(false);
    loadAll();
  }

  async function remove(row) {
    if (!confirm('Удалить запись журнала?')) return;
    const { error: err } = await supabase.from('dust_logs').delete().eq('id', row.id);
    if (err) { setError(err.message); return; }
    loadAll();
  }

  const columns = [
    { key: 'date', header: 'Дата', width: '110px', render: (l) => html`<span class="mono">${l.date}</span>` },
    { key: 'org', header: 'Организация', render: (l) => (orgById[l.org_id] || {}).name || '—' },
    { key: 'vehicle', header: 'Машина', render: (l) => { const v = vehicleById[l.vehicle_id]; return v ? html`${v.name}${v.plate_number ? html`<span style=${{ color: 'var(--text-tertiary)' }}> (${v.plate_number})</span>` : ''}` : '—'; } },
    { key: 'nozzle', header: 'Гусак', width: '120px', render: (l) => (nozzleById[l.nozzle_id] || {}).name || '—' },
    { key: 'trips', header: 'Рейсов', width: '80px', render: (l) => html`<span class="mono">${l.trips}</span>` },
    { key: 'volume', header: 'Объём, м³', width: '100px', render: (l) => html`<${Badge} variant="accent">${computeVolume(l).toFixed(1)}<//>` },
    { key: 'notes', header: 'Примечание', render: (l) => l.notes || '—' },
    {
      key: 'actions', header: '', width: '90px',
      render: (l) => html`
        <div style=${{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
          <${Button} variant="ghost" size="sm" icon onClick=${() => openEdit(l)}><${Pencil} size=${14} /><//>
          <${Button} variant="ghost" size="sm" icon onClick=${() => remove(l)}><${Trash2} size=${14} style=${{ color: 'var(--red-500)' }} /><//>
        </div>
      `,
    },
  ];

  const filteredVehicles = form.orgId ? vehicles.filter((v) => v.org_id === form.orgId) : vehicles;

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Журнал Пылеподавления</div>
          <div class="page-desc">Рейсы поливочных машин — ${logs ? logs.length : '…'} записей (последние 300).</div>
        </div>
        <${Button} onClick=${openAdd}><${Plus} size=${16} /> Добавить<//>
      </div>

      ${error && html`<div style=${{ color: 'var(--red-500)', fontSize: '13px', marginBottom: '12px' }}>Ошибка: ${error}</div>`}

      <${Card}>
        <div style=${{ display: 'flex', gap: '10px', padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          <${Input} type="date" value=${dateFilter} onChange=${(e) => setDateFilter(e.target.value)} style=${{ width: '160px' }} />
          ${dateFilter && html`<${Button} variant="outline" size="sm" onClick=${() => setDateFilter('')}>Сбросить дату<//>`}
        </div>
        <${CardContent} tight>
          <${Table}
            columns=${columns}
            rows=${filtered}
            rowKey=${(l) => l.id}
            loading=${logs === null}
            emptyIcon=${html`<${Wind} size=${40} />`}
            emptyTitle="Записей нет"
            emptyDescription="За выбранную дату записей не найдено."
          />
        <//>
      <//>

      <${Dialog}
        open=${dialogOpen}
        onClose=${() => setDialogOpen(false)}
        title=${form.id ? 'Редактировать запись' : 'Новая запись'}
        footer=${html`
          <${Button} variant="outline" onClick=${() => setDialogOpen(false)}>Отмена<//>
          <${Button} onClick=${save} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить'}<//>
        `}
      >
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <${Field} label="Дата"><${Input} type="date" value=${form.date} onChange=${(e) => setForm({ ...form, date: e.target.value })} /><//>
            <${Field} label="Организация">
              <${Select} value=${form.orgId} onChange=${(e) => setForm({ ...form, orgId: e.target.value, vehicleId: '' })}>
                <option value="">—</option>
                ${orgs.map((o) => html`<option key=${o.id} value=${o.id}>${o.name}<//>`)}
              <//>
            <//>
          </div>
          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <${Field} label="Машина *">
              <${Select} value=${form.vehicleId} onChange=${(e) => setForm({ ...form, vehicleId: e.target.value })}>
                <option value="">— выберите —</option>
                ${filteredVehicles.map((v) => html`<option key=${v.id} value=${v.id}>${v.name}<//>`)}
              <//>
            <//>
            <${Field} label="Гусак">
              <${Select} value=${form.nozzleId} onChange=${(e) => setForm({ ...form, nozzleId: e.target.value })}>
                <option value="">—</option>
                ${nozzles.map((n) => html`<option key=${n.id} value=${n.id}>${n.name}<//>`)}
              <//>
            <//>
          </div>
          <${Field} label="Число рейсов *"><${Input} type="number" min="0" value=${form.trips} onChange=${(e) => setForm({ ...form, trips: e.target.value })} /><//>
          <${Field} label="Примечание">
            <textarea class="input" rows="2" style=${{ resize: 'vertical', paddingTop: '8px' }} value=${form.notes} onChange=${(e) => setForm({ ...form, notes: e.target.value })} />
          <//>
        </div>
      <//>
    </div>
  `;
}
