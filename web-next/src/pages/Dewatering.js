import React, { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Waves, Save, Plus, Droplet, Gauge, RefreshCw, PenLine, Wrench, History, Pencil, Trash2, X } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { computedVolume, finalVolume, lastActualReading, PUMP_STATUS, DEST_TYPES, destTypeInfo, totalVolumePump, distColor } from '../lib/dewatering-core.js';
import { Button, Card, CardHeader, CardTitle, CardContent, Input, Select, Tabs, Badge, KpiCard, Skeleton, EmptyState, Table, Dialog, Field } from '../components/ui.js';
import { DewateringDiagram } from '../components/DewateringDiagram.js';

function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

// ── Загрузка и приведение данных ────────────────────────────────────────────
function useDewateringData() {
  const [state, setState] = useState({ loading: true, error: null, sumps: [], pumps: [], readings: [], destinations: [], levels: [], elevationHistory: [], pumpEvents: [] });

  async function reload() {
    const [sumpsR, pumpsR, readingsR, destR, levelsR, elevR, eventsR] = await Promise.all([
      supabase.from('dew_sumps').select('*').order('name'),
      supabase.from('dew_pumps').select('*').order('name'),
      supabase.from('dew_meter_readings').select('*').order('date', { ascending: false }).limit(1500),
      supabase.from('dew_destinations').select('*').order('name'),
      supabase.from('dew_water_levels').select('*').order('date', { ascending: false }).limit(1500),
      supabase.from('dew_elevation_history').select('*').order('date', { ascending: false }),
      supabase.from('dew_pump_events').select('*').order('date', { ascending: false }),
    ]);
    const err = sumpsR.error || pumpsR.error || readingsR.error || destR.error || levelsR.error || elevR.error || eventsR.error;
    if (err) { setState((s) => ({ ...s, loading: false, error: err.message })); return; }
    setState({
      loading: false, error: null,
      sumps: sumpsR.data || [],
      pumps: pumpsR.data.map((p) => ({ ...p, sumpId: p.sump_id })) || [],
      readings: (readingsR.data || []).map((r) => ({
        ...r, pumpId: r.pump_id, isReset: r.is_reset, isStopped: r.is_stopped,
        resetStartValue: r.reset_start_value, hoursWorked: r.hours_worked,
        isManualVolume: r.is_manual_volume, manualVolume: r.manual_volume,
      })),
      destinations: destR.data || [],
      levels: (levelsR.data || []).map((l) => ({ ...l, sumpId: l.sump_id, measuredBy: l.measured_by })),
      elevationHistory: (elevR.data || []).map((e) => ({ ...e, sumpId: e.sump_id })),
      pumpEvents: (eventsR.data || []).map((e) => ({ ...e, sumpId: e.sump_id, removedPumpId: e.removed_pump_id, installedPumpId: e.installed_pump_id, performedBy: e.performed_by })),
    });
  }
  useEffect(() => { reload(); }, []);
  return { ...state, reload };
}

function genId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function pumpsOfSump(pumps, sumpId) { return pumps.filter((p) => p.sump_id === sumpId); }
function latestLevel(levels, sumpId) {
  const hist = levels.filter((l) => l.sumpId === sumpId && l.elevation != null).sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : (b.time || '').localeCompare(a.time || '')));
  return hist.length ? hist[0] : null;
}

// ── Обзор: схема водного баланса ──────────────────────────────────────────────
function OverviewTab({ data, onSumpClick }) {
  const { sumps } = data;
  if (!sumps.length) return html`<${EmptyState} icon=${html`<${Waves} size=${40} />`} title="Зумпфов пока нет" />`;
  return html`<${DewateringDiagram} data=${data} onSumpClick=${onSumpClick} />`;
}

// ── Зумпфы: справочники (зумпфы, насосы, направления откачки) ────────────────

const EVENT_TYPE_LABELS = { install: 'Установка', remove: 'Снятие', replace: 'Замена', repair_out: 'Отправлен в ремонт', repair_in: 'Возврат из ремонта' };

function SumpFormDialog({ initial, onClose, onSave }) {
  const [form, setForm] = useState({
    name: initial?.name || '', quarry: initial?.quarry || '',
    coord_x: initial?.coord_x ?? '', coord_y: initial?.coord_y ?? '', notes: initial?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  async function save() {
    if (!form.name.trim()) { alert('Укажите название'); return; }
    setSaving(true);
    try {
      await onSave({
        id: initial?.id || genId('smp'),
        name: form.name.trim(), quarry: form.quarry.trim() || null,
        coord_x: form.coord_x === '' ? null : parseFloat(form.coord_x),
        coord_y: form.coord_y === '' ? null : parseFloat(form.coord_y),
        notes: form.notes.trim() || null,
      });
      onClose();
    } catch (e) { alert('Ошибка сохранения: ' + e.message); } finally { setSaving(false); }
  }
  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${initial ? 'Изменить зумпф' : 'Новый зумпф'}
      footer=${html`<${Button} variant="outline" onClick=${onClose}>Отмена<//><${Button} onClick=${save} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить'}<//>`}>
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <${Field} label="Название *"><${Input} value=${form.name} onChange=${(e) => setForm({ ...form, name: e.target.value })} /><//>
        <${Field} label="Карьер / участок"><${Input} value=${form.quarry} onChange=${(e) => setForm({ ...form, quarry: e.target.value })} /><//>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <${Field} label="X (местная сетка)"><${Input} type="number" step="0.01" value=${form.coord_x} onChange=${(e) => setForm({ ...form, coord_x: e.target.value })} /><//>
          <${Field} label="Y (местная сетка)"><${Input} type="number" step="0.01" value=${form.coord_y} onChange=${(e) => setForm({ ...form, coord_y: e.target.value })} /><//>
        </div>
        <${Field} label="Примечание"><${Input} value=${form.notes} onChange=${(e) => setForm({ ...form, notes: e.target.value })} /><//>
      </div>
    <//>
  `;
}

function ElevationHistoryDialog({ sump, history, onClose, onSave, onDelete }) {
  const rows = history.filter((h) => h.sumpId === sump.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const [form, setForm] = useState({ date: today(), elevation: '', notes: '' });
  const [saving, setSaving] = useState(false);
  async function add() {
    if (form.elevation === '') { alert('Укажите отметку'); return; }
    setSaving(true);
    try {
      await onSave({ id: genId('elv'), sump_id: sump.id, date: form.date, elevation: parseFloat(form.elevation), notes: form.notes.trim() || null });
      setForm({ date: today(), elevation: '', notes: '' });
    } catch (e) { alert('Ошибка: ' + e.message); } finally { setSaving(false); }
  }
  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${`История отметок дна — ${sump.name}`} width="600px">
      <div style=${{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '14px', flexWrap: 'wrap' }}>
        <${Field} label="Дата"><${Input} type="date" value=${form.date} onChange=${(e) => setForm({ ...form, date: e.target.value })} style=${{ width: '150px' }} /><//>
        <${Field} label="Отметка дна, м абс."><${Input} type="number" step="0.01" value=${form.elevation} onChange=${(e) => setForm({ ...form, elevation: e.target.value })} style=${{ width: '150px' }} /><//>
        <div style=${{ flex: 1, minWidth: '120px' }}><${Field} label="Примечание"><${Input} value=${form.notes} onChange=${(e) => setForm({ ...form, notes: e.target.value })} /><//></div>
        <${Button} size="sm" onClick=${add} disabled=${saving}><${Plus} size=${14} /> Добавить<//>
      </div>
      ${!rows.length ? html`<div style=${{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>Записей нет</div>` : html`
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Дата</th><th>Отметка, м</th><th>Примечание</th><th></th></tr></thead>
          <tbody>
            ${rows.map((r) => html`
              <tr key=${r.id}>
                <td>${r.date}</td>
                <td class="mono">${Number(r.elevation).toFixed(2)}</td>
                <td>${r.notes || '—'}</td>
                <td><${Button} variant="ghost" size="sm" icon onClick=${() => { if (confirm('Удалить запись?')) onDelete(r.id); }}><${Trash2} size=${13} style=${{ color: 'var(--red-500)' }} /><//></td>
              </tr>
            `)}
          </tbody>
        </table></div>
      `}
    <//>
  `;
}

function PumpEventsDialog({ pump, events, onClose, onSave, onDelete }) {
  const rows = events.filter((e) => e.installedPumpId === pump.id || e.removedPumpId === pump.id).sort((a, b) => (a.date < b.date ? 1 : -1));
  const [form, setForm] = useState({ date: today(), type: 'install', reason: '', performedBy: '' });
  const [saving, setSaving] = useState(false);
  async function add() {
    setSaving(true);
    try {
      const row = {
        id: genId('pev'), sump_id: pump.sump_id, date: form.date, type: form.type,
        installed_pump_id: (form.type === 'install' || form.type === 'replace' || form.type === 'repair_in') ? pump.id : null,
        removed_pump_id: (form.type === 'remove' || form.type === 'replace' || form.type === 'repair_out') ? pump.id : null,
        reason: form.reason.trim() || null, performed_by: form.performedBy.trim() || null, notes: null,
      };
      await onSave(row);
      setForm({ date: today(), type: 'install', reason: '', performedBy: '' });
    } catch (e) { alert('Ошибка: ' + e.message); } finally { setSaving(false); }
  }
  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${`События насоса — ${pump.name}`} width="660px">
      <div style=${{ display: 'flex', gap: '8px', alignItems: 'flex-end', marginBottom: '14px', flexWrap: 'wrap' }}>
        <${Field} label="Дата"><${Input} type="date" value=${form.date} onChange=${(e) => setForm({ ...form, date: e.target.value })} style=${{ width: '150px' }} /><//>
        <${Field} label="Тип">
          <${Select} value=${form.type} onChange=${(e) => setForm({ ...form, type: e.target.value })} style=${{ width: '190px' }}>
            ${Object.entries(EVENT_TYPE_LABELS).map(([v, l]) => html`<option key=${v} value=${v}>${l}<//>`)}
          <//>
        <//>
        <div style=${{ flex: 1, minWidth: '100px' }}><${Field} label="Причина"><${Input} value=${form.reason} onChange=${(e) => setForm({ ...form, reason: e.target.value })} /><//></div>
        <${Field} label="Выполнил"><${Input} value=${form.performedBy} onChange=${(e) => setForm({ ...form, performedBy: e.target.value })} style=${{ width: '140px' }} /><//>
        <${Button} size="sm" onClick=${add} disabled=${saving}><${Plus} size=${14} /> Добавить<//>
      </div>
      ${!rows.length ? html`<div style=${{ padding: '16px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>Событий нет</div>` : html`
        <div class="table-wrap"><table class="data-table">
          <thead><tr><th>Дата</th><th>Тип</th><th>Причина</th><th>Выполнил</th><th></th></tr></thead>
          <tbody>
            ${rows.map((r) => html`
              <tr key=${r.id}>
                <td>${r.date}</td>
                <td>${EVENT_TYPE_LABELS[r.type] || r.type}</td>
                <td>${r.reason || '—'}</td>
                <td>${r.performedBy || '—'}</td>
                <td><${Button} variant="ghost" size="sm" icon onClick=${() => { if (confirm('Удалить событие?')) onDelete(r.id); }}><${Trash2} size=${13} style=${{ color: 'var(--red-500)' }} /><//></td>
              </tr>
            `)}
          </tbody>
        </table></div>
      `}
    <//>
  `;
}

function PumpFormDialog({ initial, sumps, destinations, onClose, onSave }) {
  const [form, setForm] = useState({
    name: initial?.name || '', model: initial?.model || '', serial_number: initial?.serial_number || '',
    inventory_number: initial?.inventory_number || '', quarry: initial?.quarry || '',
    capacity: initial?.capacity ?? '', head: initial?.head ?? '', install_date: initial?.install_date || '',
    sump_id: initial?.sump_id || (sumps[0]?.id || ''), type: initial?.type || 'main', status: initial?.status || 'off',
    count_in_volume: initial?.count_in_volume !== false,
    distributions: initial?.default_distributions || [],
  });
  const [saving, setSaving] = useState(false);

  function addDist() { setForm((f) => ({ ...f, distributions: [...f.distributions, { destinationId: destinations[0]?.id || '', pct: f.distributions.length ? 0 : 100 }] })); }
  function updateDist(idx, patch) { setForm((f) => ({ ...f, distributions: f.distributions.map((d, i) => (i === idx ? { ...d, ...patch } : d)) })); }
  function removeDist(idx) { setForm((f) => ({ ...f, distributions: f.distributions.filter((_, i) => i !== idx) })); }
  const distTotal = form.distributions.reduce((acc, d) => acc + (parseFloat(d.pct) || 0), 0);

  async function save() {
    if (!form.name.trim()) { alert('Укажите название/№'); return; }
    if (!form.sump_id) { alert('Выберите зумпф'); return; }
    setSaving(true);
    try {
      await onSave({
        id: initial?.id || genId('pmp'),
        sump_id: form.sump_id, name: form.name.trim(), model: form.model.trim() || null,
        serial_number: form.serial_number.trim() || null, inventory_number: form.inventory_number.trim() || null,
        quarry: form.quarry.trim() || null,
        capacity: form.capacity === '' ? null : parseFloat(form.capacity),
        head: form.head === '' ? null : parseFloat(form.head),
        type: form.type, status: form.status,
        install_date: form.install_date || null,
        count_in_volume: form.count_in_volume,
        default_distributions: form.distributions,
      });
      onClose();
    } catch (e) { alert('Ошибка сохранения: ' + e.message); } finally { setSaving(false); }
  }

  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${initial ? 'Изменить насос' : 'Новый насос'} width="640px"
      footer=${html`<${Button} variant="outline" onClick=${onClose}>Отмена<//><${Button} onClick=${save} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить'}<//>`}>
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <${Field} label="Название / № *"><${Input} value=${form.name} onChange=${(e) => setForm({ ...form, name: e.target.value })} /><//>
          <${Field} label="Марка / модель"><${Input} value=${form.model} onChange=${(e) => setForm({ ...form, model: e.target.value })} /><//>
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <${Field} label="Серийный №"><${Input} value=${form.serial_number} onChange=${(e) => setForm({ ...form, serial_number: e.target.value })} /><//>
          <${Field} label="Инв. №"><${Input} value=${form.inventory_number} onChange=${(e) => setForm({ ...form, inventory_number: e.target.value })} /><//>
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
          <${Field} label="Произв., м³/ч"><${Input} type="number" step="0.1" value=${form.capacity} onChange=${(e) => setForm({ ...form, capacity: e.target.value })} /><//>
          <${Field} label="Напор, м"><${Input} type="number" step="1" value=${form.head} onChange=${(e) => setForm({ ...form, head: e.target.value })} /><//>
          <${Field} label="Дата установки"><${Input} type="date" value=${form.install_date} onChange=${(e) => setForm({ ...form, install_date: e.target.value })} /><//>
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
          <${Field} label="Зумпф *">
            <${Select} value=${form.sump_id} onChange=${(e) => setForm({ ...form, sump_id: e.target.value })}>
              <option value="">— выберите —<//>
              ${sumps.map((s) => html`<option key=${s.id} value=${s.id}>${s.name}<//>`)}
            <//>
          <//>
          <${Field} label="Тип">
            <${Select} value=${form.type} onChange=${(e) => setForm({ ...form, type: e.target.value })}>
              <option value="main">Основной<//>
              <option value="standby">Резервный<//>
            <//>
          <//>
          <${Field} label="Статус">
            <${Select} value=${form.status} onChange=${(e) => setForm({ ...form, status: e.target.value })}>
              ${Object.entries(PUMP_STATUS).map(([v, s]) => html`<option key=${v} value=${v}>${s.label}<//>`)}
            <//>
          <//>
        </div>
        <label style=${{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
          <input type="checkbox" checked=${form.count_in_volume} onChange=${(e) => setForm({ ...form, count_in_volume: e.target.checked })} />
          Учитывать показания насоса в суммарном объёме
        </label>
        <div class="field-section">
          <div class="section-label" style=${{ marginBottom: '8px' }}>Направление откачки по умолчанию</div>
          <div style=${{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
            ${form.distributions.map((d, idx) => html`
              <div key=${idx} style=${{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <${Select} value=${d.destinationId} onChange=${(e) => updateDist(idx, { destinationId: e.target.value })} style=${{ width: '220px' }}>
                  <option value="">— направление —<//>
                  ${destinations.map((dst) => html`<option key=${dst.id} value=${dst.id}>${dst.name}<//>`)}
                <//>
                <input type="number" min="0" max="100" step="1" class="input" style=${{ width: '80px' }} value=${d.pct} onChange=${(e) => updateDist(idx, { pct: e.target.value === '' ? '' : parseFloat(e.target.value) })} />
                <span style=${{ fontSize: '12px', color: 'var(--text-tertiary)' }}>%</span>
                <button type="button" onClick=${() => removeDist(idx)} style=${{ background: 'none', border: 'none', color: 'var(--red-500)', cursor: 'pointer', fontSize: '14px' }}>✕</button>
              </div>
            `)}
          </div>
          <div style=${{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <${Button} variant="outline" size="sm" onClick=${addDist}>+ Направление<//>
            <span style=${{ fontSize: '12px', fontWeight: 700, color: distColor(distTotal) }}>Итого: ${distTotal}%</span>
          </div>
        </div>
      </div>
    <//>
  `;
}

function DestFormDialog({ initial, sumps, onClose, onSave }) {
  const [form, setForm] = useState({
    name: initial?.name || '', type: initial?.type || 'zif', target_sump_id: initial?.target_sump_id || '', color: initial?.color || '',
  });
  const [saving, setSaving] = useState(false);
  const typeInfo = destTypeInfo(form.type);
  async function save() {
    if (!form.name.trim()) { alert('Укажите название'); return; }
    setSaving(true);
    try {
      await onSave({
        id: initial?.id || genId('dst'),
        name: form.name.trim(), type: form.type,
        target_sump_id: form.type === 'intermediate_sump' ? (form.target_sump_id || null) : null,
        color: form.color && form.color !== typeInfo.color ? form.color : null,
      });
      onClose();
    } catch (e) { alert('Ошибка сохранения: ' + e.message); } finally { setSaving(false); }
  }
  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${initial ? 'Изменить направление' : 'Новое направление откачки'}
      footer=${html`<${Button} variant="outline" onClick=${onClose}>Отмена<//><${Button} onClick=${save} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить'}<//>`}>
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <${Field} label="Название *"><${Input} value=${form.name} onChange=${(e) => setForm({ ...form, name: e.target.value })} /><//>
        <${Field} label="Тип">
          <${Select} value=${form.type} onChange=${(e) => setForm({ ...form, type: e.target.value, target_sump_id: '' })}>
            ${DEST_TYPES.map((t) => html`<option key=${t.value} value=${t.value}>${t.label}<//>`)}
          <//>
        <//>
        ${form.type === 'intermediate_sump' && html`
          <${Field} label="Целевой зумпф">
            <${Select} value=${form.target_sump_id} onChange=${(e) => setForm({ ...form, target_sump_id: e.target.value })}>
              <option value="">— выберите —<//>
              ${sumps.map((s) => html`<option key=${s.id} value=${s.id}>${s.name}<//>`)}
            <//>
          <//>
        `}
        <${Field} label="Цвет">
          <input type="color" value=${form.color || typeInfo.color} onChange=${(e) => setForm({ ...form, color: e.target.value })} style=${{ width: '60px', height: '34px', border: '1px solid var(--border)', borderRadius: '6px', cursor: 'pointer', padding: '2px' }} />
        <//>
      </div>
    <//>
  `;
}

function DeleteSumpDialog({ sump, pumps, readings, elevationHistory, pumpEvents, levels, onClose, onConfirm }) {
  const sumpPumps = pumps.filter((p) => p.sump_id === sump.id);
  const pumpIds = sumpPumps.map((p) => p.id);
  const readingsCount = readings.filter((r) => pumpIds.includes(r.pumpId)).length;
  const elevCount = elevationHistory.filter((e) => e.sumpId === sump.id).length;
  const eventsCount = pumpEvents.filter((e) => e.sumpId === sump.id).length;
  const levelsCount = levels.filter((l) => l.sumpId === sump.id).length;
  const hasData = sumpPumps.length > 0;
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const canDelete = !hasData || confirmText.trim() === sump.name;

  async function go() {
    setBusy(true);
    try { await onConfirm(); onClose(); } catch (e) { alert('Ошибка удаления: ' + e.message); setBusy(false); }
  }

  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${`Удалить зумпф «${sump.name}»?`}
      footer=${html`
        <${Button} variant="outline" onClick=${onClose}>Отмена<//>
        <${Button} onClick=${go} disabled=${!canDelete || busy} style=${{ background: 'var(--red-500)', borderColor: 'var(--red-500)' }}>${busy ? 'Удаление…' : 'Удалить безвозвратно'}<//>
      `}>
      ${hasData ? html`
        <div style=${{ background: 'var(--red-50)', border: '1px solid var(--red-100)', borderRadius: 'var(--radius-md)', padding: '12px 14px', marginBottom: '14px', fontSize: '13px', color: 'var(--red-600)', lineHeight: 1.6 }}>
          <strong>У этого зумпфа есть данные.</strong> При удалении безвозвратно будут стёрты:
          <ul style=${{ margin: '6px 0 0', paddingLeft: '18px' }}>
            <li>${sumpPumps.length} насос(ов)</li>
            <li>${readingsCount} показани(й) расходомеров</li>
            ${eventsCount > 0 && html`<li>${eventsCount} событи(й) по насосам</li>`}
            ${elevCount > 0 && html`<li>${elevCount} запис(ей) истории отметок дна</li>`}
            ${levelsCount > 0 && html`<li>${levelsCount} замер(ов) уровня воды</li>`}
          </ul>
        </div>
        <div style=${{ fontSize: '13px', marginBottom: '8px' }}>Чтобы подтвердить, введите название зумпфа: <strong>${sump.name}</strong></div>
        <${Input} value=${confirmText} onChange=${(e) => setConfirmText(e.target.value)} placeholder=${sump.name} />
      ` : html`<div style=${{ fontSize: '13px', color: 'var(--text-secondary)' }}>У зумпфа нет насосов и данных — можно удалить без потерь.</div>`}
    <//>
  `;
}

function SumpCard({ sump, pumpCount, onEdit, onDelete, onHistory }) {
  return html`
    <${Card}>
      <div style=${{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style=${{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div style=${{ minWidth: 0 }}>
            <div style=${{ fontWeight: 700, fontSize: '14px' }}>${sump.name}</div>
            ${sump.quarry && html`<div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)', marginTop: '2px' }}>${sump.quarry}</div>`}
          </div>
          <span style=${{ flexShrink: 0 }}><${Badge} variant=${pumpCount ? 'accent' : 'default'}>${pumpCount} насос.<//></span>
        </div>
        ${sump.notes && html`<div style=${{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>${sump.notes}</div>`}
        ${(sump.coord_x != null && sump.coord_x !== '' && sump.coord_y != null && sump.coord_y !== '') && html`
          <div style=${{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>X ${sump.coord_x} · Y ${sump.coord_y}</div>
        `}
        <div style=${{ display: 'flex', gap: '4px', justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px', marginTop: '2px' }}>
          <${Button} variant="ghost" size="sm" onClick=${onHistory}><${History} size=${13} /> Дно<//>
          <${Button} variant="ghost" size="sm" icon onClick=${onEdit} title="Изменить"><${Pencil} size=${14} /><//>
          <${Button} variant="ghost" size="sm" icon onClick=${onDelete} title="Удалить"><${Trash2} size=${14} style=${{ color: 'var(--red-500)' }} /><//>
        </div>
      </div>
    <//>
  `;
}

function PumpCard({ pump, sump, totalVolume, onEdit, onDelete, onEvents }) {
  const st = PUMP_STATUS[pump.status] || PUMP_STATUS.off;
  return html`
    <${Card}>
      <div style=${{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style=${{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
          <div style=${{ minWidth: 0 }}>
            <div style=${{ fontWeight: 700, fontSize: '14px' }}>${pump.name}</div>
            <div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)', marginTop: '2px' }}>${pump.model || 'Модель не указана'}${pump.inventory_number ? ' · инв. ' + pump.inventory_number : ''}</div>
          </div>
          <${Badge} variant=${st.badge}>${st.label}<//>
        </div>
        <div style=${{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
          ${pump.capacity != null && pump.capacity !== '' && html`<span><strong style=${{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>${pump.capacity}</strong> м³/ч</span>`}
          ${pump.head != null && pump.head !== '' && html`<span><strong style=${{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>${pump.head}</strong> м напор</span>`}
          <span style=${{ marginLeft: 'auto', color: 'var(--text-tertiary)' }}>∑ <strong style=${{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>${totalVolume.toFixed(0)}</strong> м³</span>
        </div>
        <div style=${{ display: 'flex', gap: '4px', justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px' }}>
          <${Button} variant="ghost" size="sm" onClick=${onEvents}><${Wrench} size=${13} /> События<//>
          <${Button} variant="ghost" size="sm" icon onClick=${onEdit} title="Изменить"><${Pencil} size=${14} /><//>
          <${Button} variant="ghost" size="sm" icon onClick=${onDelete} title="Удалить"><${Trash2} size=${14} style=${{ color: 'var(--red-500)' }} /><//>
        </div>
      </div>
    <//>
  `;
}

function DestCard({ dest, sumps, onEdit, onDelete }) {
  const info = destTypeInfo(dest.type);
  const color = dest.color || info.color;
  const target = dest.target_sump_id ? sumps.find((s) => s.id === dest.target_sump_id) : null;
  return html`
    <${Card}>
      <div style=${{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style=${{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style=${{ width: '10px', height: '10px', borderRadius: '50%', background: color, flexShrink: 0 }} />
          <div style=${{ fontWeight: 700, fontSize: '13.5px' }}>${dest.name}</div>
        </div>
        <div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)' }}>${info.label}${target ? ' → ' + target.name : ''}</div>
        <div style=${{ display: 'flex', gap: '4px', justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px' }}>
          <${Button} variant="ghost" size="sm" icon onClick=${onEdit} title="Изменить"><${Pencil} size=${13} /><//>
          <${Button} variant="ghost" size="sm" icon onClick=${onDelete} title="Удалить"><${Trash2} size=${13} style=${{ color: 'var(--red-500)' }} /><//>
        </div>
      </div>
    <//>
  `;
}

function PumpRegistryView({ pumps, sumps, readings, onEdit, onDelete, onEvents }) {
  const rows = pumps.slice().sort((a, b) => {
    const sa = sumps.find((s) => s.id === a.sump_id), sb = sumps.find((s) => s.id === b.sump_id);
    const qa = (sa && sa.quarry) || '', qb = (sb && sb.quarry) || '';
    if (qa !== qb) return qa < qb ? -1 : 1;
    const na = (sa && sa.name) || '', nb = (sb && sb.name) || '';
    if (na !== nb) return na < nb ? -1 : 1;
    return (a.name || '') < (b.name || '') ? -1 : 1;
  });
  const working = pumps.filter((p) => p.status === 'working').length;
  const repair = pumps.filter((p) => p.status === 'repair').length;

  return html`
    <div>
      <div style=${{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>Всего: <strong>${pumps.length}</strong> · Работают: <strong style=${{ color: 'var(--green-600)' }}>${working}</strong> · Ремонт: <strong style=${{ color: 'var(--amber-600)' }}>${repair}</strong></div>
      <${Card}>
        <${CardHeader}><${CardTitle}>Все насосы<//><//>
        <${CardContent} tight>
          ${!rows.length ? html`<${EmptyState} icon=${html`<${Gauge} size=${36} />`} title="Насосов нет" />` : html`
            <div class="table-wrap"><table class="data-table">
              <thead><tr>
                <th>Насос</th><th>Инв. №</th><th>Марка / Модель</th><th>Зумпф</th><th>Карьер</th><th>Статус</th><th>Q, м³/ч</th><th>Напор, м</th><th>∑ м³</th><th></th>
              </tr></thead>
              <tbody>
                ${rows.map((p) => {
                  const sump = sumps.find((s) => s.id === p.sump_id);
                  const st = PUMP_STATUS[p.status] || PUMP_STATUS.off;
                  const total = totalVolumePump(readings, p.id);
                  return html`
                    <tr key=${p.id}>
                      <td style=${{ fontWeight: 600 }}>${p.name}</td>
                      <td>${p.inventory_number || '—'}</td>
                      <td>${p.model || '—'}${p.serial_number ? html`<div style=${{ fontSize: '10.5px', color: 'var(--text-tertiary)' }}>№ ${p.serial_number}</div>` : ''}</td>
                      <td>${sump ? sump.name : '—'}</td>
                      <td>${p.quarry || (sump && sump.quarry) || '—'}</td>
                      <td><${Badge} variant=${st.badge}>${st.label}<//></td>
                      <td class="mono">${p.capacity ?? '—'}</td>
                      <td class="mono">${p.head ?? '—'}</td>
                      <td class="mono">${total.toFixed(0)}</td>
                      <td>
                        <div style=${{ display: 'flex', gap: '2px', justifyContent: 'flex-end' }}>
                          <${Button} variant="ghost" size="sm" icon onClick=${() => onEvents(p)} title="События"><${Wrench} size=${13} /><//>
                          <${Button} variant="ghost" size="sm" icon onClick=${() => onEdit(p)} title="Изменить"><${Pencil} size=${13} /><//>
                          <${Button} variant="ghost" size="sm" icon onClick=${() => onDelete(p)} title="Удалить"><${Trash2} size=${13} style=${{ color: 'var(--red-500)' }} /><//>
                        </div>
                      </td>
                    </tr>
                  `;
                })}
              </tbody>
            </table></div>
          `}
        <//>
      <//>
    </div>
  `;
}

function SumpsTab({ data, onSaved }) {
  const { sumps, pumps, destinations, readings, levels, elevationHistory, pumpEvents } = data;

  const [subTab, setSubTab] = useState('sumps');

  const [sumpForm, setSumpForm] = useState(null);
  const [pumpForm, setPumpForm] = useState(null);
  const [destForm, setDestForm] = useState(null);
  const [historyFor, setHistoryFor] = useState(null);
  const [eventsFor, setEventsFor] = useState(null);
  const [deleteSump, setDeleteSumpState] = useState(null);

  async function saveSump(row) { const { error } = await supabase.from('dew_sumps').upsert(row); if (error) throw error; await onSaved(); }
  async function saveElevation(row) { const { error } = await supabase.from('dew_elevation_history').upsert(row); if (error) throw error; await onSaved(); }
  async function deleteElevation(id) { await supabase.from('dew_elevation_history').delete().eq('id', id); await onSaved(); }

  async function savePump(row) { const { error } = await supabase.from('dew_pumps').upsert(row); if (error) throw error; await onSaved(); }
  async function deletePump(pump) {
    if (!confirm(`Удалить насос «${pump.name}» и все его показания?`)) return;
    await supabase.from('dew_meter_readings').delete().eq('pump_id', pump.id);
    await supabase.from('dew_pumps').delete().eq('id', pump.id);
    await onSaved();
  }
  async function saveEvent(row) { const { error } = await supabase.from('dew_pump_events').upsert(row); if (error) throw error; await onSaved(); }
  async function deleteEvent(id) { await supabase.from('dew_pump_events').delete().eq('id', id); await onSaved(); }

  async function saveDest(row) { const { error } = await supabase.from('dew_destinations').upsert(row); if (error) throw error; await onSaved(); }
  async function deleteDest(dest) {
    if (!confirm(`Удалить направление «${dest.name}»?`)) return;
    await supabase.from('dew_destinations').delete().eq('id', dest.id);
    await onSaved();
  }

  async function confirmDeleteSump(sump) {
    const pumpIds = pumps.filter((p) => p.sump_id === sump.id).map((p) => p.id);
    if (pumpIds.length) {
      await supabase.from('dew_meter_readings').delete().in('pump_id', pumpIds);
      await supabase.from('dew_pumps').delete().in('id', pumpIds);
    }
    await supabase.from('dew_pump_events').delete().eq('sump_id', sump.id);
    await supabase.from('dew_elevation_history').delete().eq('sump_id', sump.id);
    await supabase.from('dew_water_levels').delete().eq('sump_id', sump.id);
    await supabase.from('dew_sumps').delete().eq('id', sump.id);
    await onSaved();
  }

  const working = pumps.filter((p) => p.status === 'working').length;
  const repair = pumps.filter((p) => p.status === 'repair').length;

  const pumpGroups = useMemo(() => {
    const bySump = new Map();
    const orphan = [];
    pumps.forEach((p) => {
      const hasSump = p.sump_id && sumps.some((s) => s.id === p.sump_id);
      if (hasSump) {
        if (!bySump.has(p.sump_id)) bySump.set(p.sump_id, []);
        bySump.get(p.sump_id).push(p);
      } else orphan.push(p);
    });
    const groups = sumps
      .filter((s) => bySump.has(s.id))
      .slice()
      .sort((a, b) => (a.quarry || '').localeCompare(b.quarry || '') || (a.name || '').localeCompare(b.name || ''))
      .map((s) => ({ sump: s, pumps: bySump.get(s.id) }));
    if (orphan.length) groups.push({ sump: null, pumps: orphan });
    return groups;
  }, [pumps, sumps]);

  return html`
    <div>
      <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        <${KpiCard} label="Зумпфы" value=${sumps.length} />
        <${KpiCard} label="Насосы" value=${pumps.length} trend=${pumps.length ? Math.round((working / pumps.length) * 100) : 0} trendLabel="в работе" />
        <${KpiCard} label="В ремонте" value=${repair} unit="насос.(ов)" />
        <${KpiCard} label="Направления откачки" value=${destinations.length} />
      </div>

      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <${Tabs} tabs=${[
          { value: 'sumps', label: 'Зумпфы', badge: sumps.length },
          { value: 'pumps', label: 'Насосы', badge: pumps.length },
          { value: 'destinations', label: 'Направления', badge: destinations.length },
          { value: 'registry', label: 'Реестр насосов' },
        ]} value=${subTab} onChange=${setSubTab} />
        ${subTab === 'sumps' && html`<${Button} size="sm" onClick=${() => setSumpForm('new')}><${Plus} size=${14} /> Добавить зумпф<//>`}
        ${subTab === 'pumps' && html`<${Button} size="sm" onClick=${() => setPumpForm('new')} disabled=${!sumps.length} title=${!sumps.length ? 'Сначала добавьте зумпф' : ''}><${Plus} size=${14} /> Добавить насос<//>`}
        ${subTab === 'destinations' && html`<${Button} size="sm" onClick=${() => setDestForm('new')}><${Plus} size=${14} /> Добавить направление<//>`}
      </div>

      ${subTab === 'sumps' && (!sumps.length ? html`
        <${EmptyState} icon=${html`<${Waves} size=${36} />`} title="Зумпфов нет" description="Добавьте первый зумпф, чтобы начать учёт насосов и показаний" />
      ` : html`
        <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
          ${sumps.map((s) => html`
            <${SumpCard} key=${s.id} sump=${s} pumpCount=${pumps.filter((p) => p.sump_id === s.id).length}
              onEdit=${() => setSumpForm(s)} onDelete=${() => setDeleteSumpState(s)} onHistory=${() => setHistoryFor(s)} />
          `)}
        </div>
      `)}

      ${subTab === 'pumps' && (!pumps.length ? html`
        <${EmptyState} icon=${html`<${Gauge} size=${36} />`} title="Насосов нет" description=${sumps.length ? 'Добавьте первый насос' : 'Сначала добавьте зумпф'} />
      ` : html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '22px' }}>
          ${pumpGroups.map((g) => html`
            <div key=${g.sump ? g.sump.id : 'orphan'}>
              <div class="section-label">${g.sump ? g.sump.name + (g.sump.quarry ? ' · ' + g.sump.quarry : '') : 'Без привязки к зумпфу'}</div>
              <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
                ${g.pumps.map((p) => html`
                  <${PumpCard} key=${p.id} pump=${p} sump=${g.sump} totalVolume=${totalVolumePump(readings, p.id)}
                    onEdit=${() => setPumpForm(p)} onDelete=${() => deletePump(p)} onEvents=${() => setEventsFor(p)} />
                `)}
              </div>
            </div>
          `)}
        </div>
      `)}

      ${subTab === 'destinations' && (!destinations.length ? html`
        <${EmptyState} icon=${html`<${Droplet} size=${36} />`} title="Направлений нет" description="Добавьте направление откачки, чтобы распределять объём по показаниям" />
      ` : html`
        <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' }}>
          ${destinations.map((d) => html`<${DestCard} key=${d.id} dest=${d} sumps=${sumps} onEdit=${() => setDestForm(d)} onDelete=${() => deleteDest(d)} />`)}
        </div>
      `)}

      ${subTab === 'registry' && html`<${PumpRegistryView} pumps=${pumps} sumps=${sumps} readings=${readings}
        onEdit=${(p) => setPumpForm(p)} onDelete=${deletePump} onEvents=${(p) => setEventsFor(p)} />`}

      ${sumpForm && html`<${SumpFormDialog} initial=${sumpForm === 'new' ? null : sumpForm} onClose=${() => setSumpForm(null)} onSave=${saveSump} />`}
      ${pumpForm && html`<${PumpFormDialog} initial=${pumpForm === 'new' ? null : pumpForm} sumps=${sumps} destinations=${destinations} onClose=${() => setPumpForm(null)} onSave=${savePump} />`}
      ${destForm && html`<${DestFormDialog} initial=${destForm === 'new' ? null : destForm} sumps=${sumps} onClose=${() => setDestForm(null)} onSave=${saveDest} />`}
      ${historyFor && html`<${ElevationHistoryDialog} sump=${historyFor} history=${elevationHistory} onClose=${() => setHistoryFor(null)} onSave=${saveElevation} onDelete=${deleteElevation} />`}
      ${eventsFor && html`<${PumpEventsDialog} pump=${eventsFor} events=${pumpEvents} onClose=${() => setEventsFor(null)} onSave=${saveEvent} onDelete=${deleteEvent} />`}
      ${deleteSump && html`<${DeleteSumpDialog} sump=${deleteSump} pumps=${pumps} readings=${readings} elevationHistory=${elevationHistory} pumpEvents=${pumpEvents} levels=${levels} onClose=${() => setDeleteSumpState(null)} onConfirm=${() => confirmDeleteSump(deleteSump)} />`}
    </div>
  `;
}

// ── Журнал: потуровый ввод показаний насосов ─────────────────────────────────
function JournalTab({ data, onSaved, jumpSumpId, onJumpConsumed }) {
  const { sumps, pumps, readings, destinations } = data;
  const [date, setDate] = useState(today());
  const [pending, setPending] = useState({}); // { [pumpId]: { reading, isStopped, hoursWorked } }
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [quarryFilter, setQuarryFilter] = useState('');
  const [sumpFilter, setSumpFilter] = useState('');
  const [openDist, setOpenDist] = useState({}); // { [pumpId]: bool }

  useEffect(() => {
    if (!jumpSumpId) return;
    const s = sumps.find((x) => x.id === jumpSumpId);
    if (s) { setQuarryFilter(s.quarry || ''); setSumpFilter(s.id); }
    onJumpConsumed && onJumpConsumed();
  }, [jumpSumpId]);

  function changeDate(newDate) { setDate(newDate); setPending({}); }
  function shiftDate(delta) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    changeDate(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
  }

  const quarryOptions = useMemo(() => Array.from(new Set(sumps.map((s) => s.quarry).filter(Boolean))).sort(), [sumps]);
  const sumpOptions = useMemo(() => sumps.filter((s) => !quarryFilter || s.quarry === quarryFilter), [sumps, quarryFilter]);
  const visibleSumps = useMemo(() => sumps.filter((s) => (!quarryFilter || s.quarry === quarryFilter) && (!sumpFilter || s.id === sumpFilter)), [sumps, quarryFilter, sumpFilter]);

  function existingFor(pumpId) { return readings.find((r) => r.pumpId === pumpId && r.date === date) || null; }
  function fieldVal(pumpId, key, fallback) {
    const p = pending[pumpId];
    if (p && p[key] !== undefined) return p[key];
    const ex = existingFor(pumpId);
    return ex ? ex[key] ?? fallback : fallback;
  }
  function setField(pumpId, key, val) {
    setPending((prev) => ({ ...prev, [pumpId]: { ...prev[pumpId], [key]: val } }));
  }

  // Распределение откачки по направлениям (в процентах) — переносится в pending
  // при первом изменении, до этого читается из уже сохранённой записи.
  function distFor(pumpId) { return fieldVal(pumpId, 'distributions', (existingFor(pumpId) && existingFor(pumpId).distributions) || []); }
  function addDistRow(pumpId) {
    const cur = distFor(pumpId);
    setField(pumpId, 'distributions', [...cur, { destinationId: destinations[0]?.id || '', pct: cur.length ? 0 : 100 }]);
  }
  function updateDistRow(pumpId, idx, patch) {
    const cur = distFor(pumpId);
    setField(pumpId, 'distributions', cur.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }
  function removeDistRow(pumpId, idx) {
    setField(pumpId, 'distributions', distFor(pumpId).filter((_, i) => i !== idx));
  }
  function distTotalColor(sum) {
    if (sum === 0) return 'var(--text-tertiary)';
    if (Math.round(sum) === 100) return 'var(--green-600)';
    if (sum > 100) return 'var(--red-500)';
    return 'var(--amber-600)';
  }

  // Режим счётчика на этот день: normal (обычное показание) | stopped (простой) |
  // reset (расходомер заменили) | manual (расходомер не работал, объём оценили вручную).
  function currentMode(pumpId) {
    const p = pending[pumpId];
    if (p && p.mode !== undefined) return p.mode;
    const ex = existingFor(pumpId);
    if (ex) {
      if (ex.isStopped) return 'stopped';
      if (ex.isReset) return 'reset';
      if (ex.isManualVolume) return 'manual';
    }
    return 'normal';
  }
  function setMode(pumpId, mode) { setPending((prev) => ({ ...prev, [pumpId]: { ...prev[pumpId], mode } })); }
  function toggleMode(pumpId, mode) { setMode(pumpId, currentMode(pumpId) === mode ? 'normal' : mode); }

  function previewVolume(pumpId) {
    const mode = currentMode(pumpId);
    if (mode === 'stopped') return 0;
    if (mode === 'manual') {
      const manualVal = fieldVal(pumpId, 'manualVolume', '');
      if (manualVal === '' || manualVal == null) return null;
      return computedVolume(readings, { pumpId, date, isManualVolume: true, manualVolume: parseFloat(manualVal) });
    }
    if (mode === 'reset') {
      const startVal = fieldVal(pumpId, 'resetStartValue', '');
      const endVal = fieldVal(pumpId, 'manualVolume', '');
      if (startVal === '' || startVal == null) return null;
      return computedVolume(readings, { pumpId, date, isReset: true, resetStartValue: parseFloat(startVal), manualVolume: endVal === '' || endVal == null ? null : parseFloat(endVal) });
    }
    const readingVal = fieldVal(pumpId, 'reading', '');
    if (readingVal === '' || readingVal == null) return null;
    return computedVolume(readings, { pumpId, date, reading: parseFloat(readingVal), isStopped: false, isManualVolume: false, isReset: false });
  }

  const workingPumps = pumps.filter((p) => p.status === 'working' || existingFor(p.id));
  const pendingCount = Object.keys(pending).length;

  async function saveAll() {
    const toSave = [];
    workingPumps.forEach((p) => {
      const edited = pending[p.id];
      if (!edited) return;
      const ex = existingFor(p.id);
      const mode = edited.mode !== undefined ? edited.mode : currentMode(p.id);

      let reading = null, resetStartValue = null, manualVolume = null;
      if (mode === 'normal') {
        const readingVal = edited.reading !== undefined ? edited.reading : (ex ? ex.reading : '');
        if (readingVal === '' || readingVal == null) return;
        reading = parseFloat(readingVal);
      } else if (mode === 'reset') {
        const startVal = edited.resetStartValue !== undefined ? edited.resetStartValue : (ex ? ex.resetStartValue : '');
        const endVal = edited.manualVolume !== undefined ? edited.manualVolume : (ex ? ex.manualVolume : '');
        if (startVal === '' || startVal == null) return;
        resetStartValue = parseFloat(startVal);
        manualVolume = (endVal === '' || endVal == null) ? null : parseFloat(endVal);
      } else if (mode === 'manual') {
        const manualVal = edited.manualVolume !== undefined ? edited.manualVolume : (ex ? ex.manualVolume : '');
        if (manualVal === '' || manualVal == null) return;
        manualVolume = parseFloat(manualVal);
      }
      // mode === 'stopped': reading/resetStartValue/manualVolume остаются null

      toSave.push({
        id: ex ? ex.id : ('mr' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + p.id.slice(0, 4)),
        pump_id: p.id, date,
        reading,
        is_reset: mode === 'reset', is_stopped: mode === 'stopped',
        reset_start_value: resetStartValue,
        downtime_reason: mode === 'stopped' ? (edited.downtimeReason || ex?.downtimeReason || '') : '',
        hours_worked: edited.hoursWorked !== undefined ? (edited.hoursWorked === '' ? null : parseFloat(edited.hoursWorked)) : (ex ? ex.hoursWorked : null),
        distributions: edited.distributions !== undefined ? edited.distributions : (ex ? ex.distributions : []),
        is_manual_volume: mode === 'manual', manual_volume: manualVolume,
        notes: ex ? ex.notes : '',
      });
    });
    if (!toSave.length) { setStatus('Нет изменений для сохранения.'); return; }
    setSaving(true); setStatus('Сохранение…');
    let ok = 0, err = 0;
    for (const row of toSave) {
      const { error } = await supabase.from('dew_meter_readings').upsert(row);
      if (error) err++; else ok++;
    }
    setSaving(false);
    if (!err) setPending({});
    setStatus(err ? `Сохранено: ${ok}, ошибок: ${err}` : `Сохранено: ${ok}.`);
    onSaved();
  }

  return html`
    <div>
      <div style=${{ display: 'flex', alignItems: 'flex-end', gap: '14px', marginBottom: '14px', flexWrap: 'wrap' }}>
        <div>
          <label style=${{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Дата</label>
          <div style=${{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <${Button} variant="outline" size="sm" icon title="Предыдущий день" onClick=${() => shiftDate(-1)}>‹<//>
            <${Input} type="date" value=${date} onChange=${(e) => changeDate(e.target.value)} style=${{ width: '160px' }} />
            <${Button} variant="outline" size="sm" icon title="Следующий день" onClick=${() => shiftDate(1)}>›<//>
          </div>
        </div>
        <div>
          <label style=${{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Участок</label>
          <${Select} value=${quarryFilter} onChange=${(e) => { setQuarryFilter(e.target.value); setSumpFilter(''); }} style=${{ width: '160px' }}>
            <option value="">Все участки</option>
            ${quarryOptions.map((q) => html`<option key=${q} value=${q}>${q}<//>`)}
          <//>
        </div>
        <div>
          <label style=${{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Точка забора</label>
          <${Select} value=${sumpFilter} onChange=${(e) => setSumpFilter(e.target.value)} style=${{ width: '180px' }}>
            <option value="">Все точки забора</option>
            ${sumpOptions.map((s) => html`<option key=${s.id} value=${s.id}>${s.name}<//>`)}
          <//>
        </div>
        <div style=${{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
          ${pendingCount > 0 && html`<span style=${{ fontSize: '12px', fontWeight: 700, color: 'var(--gold-600)' }}>Изменено: ${pendingCount}</span>`}
          <${Button} onClick=${saveAll} disabled=${saving}><${Save} size=${15} /> ${saving ? 'Сохранение…' : 'Сохранить всё'}<//>
        </div>
      </div>
      ${status && html`<div style=${{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>${status}</div>`}

      ${visibleSumps.map((s) => {
        const sp = pumpsOfSump(pumps, s.id).filter((p) => workingPumps.includes(p));
        if (!sp.length) return null;
        return html`
          <${Card} key=${s.id} style=${{ marginBottom: '14px' }}>
            <${CardHeader}><${CardTitle}>${s.name}<//><//>
            <${CardContent} tight>
              <div class="table-wrap"><table class="data-table">
                <thead><tr><th>Насос</th><th style=${{ width: '96px' }}>Режим</th><th style=${{ width: '190px' }}>Показание / расходомер</th><th style=${{ width: '100px' }}>Часы работы</th><th style=${{ width: '100px' }}>Объём, м³</th><th style=${{ width: '180px' }}>Направление</th></tr></thead>
                <tbody>
                  ${sp.map((p) => {
                    const mode = currentMode(p.id);
                    const vol = previewVolume(p.id);
                    const dirty = !!pending[p.id];
                    const dists = distFor(p.id);
                    const distTotal = dists.reduce((acc, d) => acc + (parseFloat(d.pct) || 0), 0);
                    const distSummary = dists.length
                      ? dists.map((d) => (destinations.find((x) => x.id === d.destinationId)?.name || '—') + ' ' + (d.pct || 0) + '%').join(', ')
                      : 'Не указано';
                    const modeBtn = (m, Icon, title) => html`
                      <button type="button" title=${title} onClick=${() => toggleMode(p.id, m)}
                        style=${{
                          width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          borderRadius: '6px', border: '1px solid ' + (mode === m ? 'transparent' : 'var(--border)'),
                          background: mode === m ? (m === 'reset' ? 'var(--gold-500)' : 'var(--blue-500)') : 'var(--bg-surface)',
                          color: mode === m ? '#fff' : 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0,
                        }}>
                        <${Icon} size=${13} />
                      <//>
                    `;
                    return html`
                      <tr key=${p.id} style=${dirty ? { background: 'rgba(201,154,91,0.10)' } : undefined}>
                        <td style=${{ fontWeight: 600 }}>
                          ${p.name}${p.model ? html`<span style=${{ color: 'var(--text-tertiary)', fontWeight: 400 }}> · ${p.model}</span>` : ''}
                          ${mode === 'reset' && html`<span style=${{ marginLeft: '6px', display: 'inline-block' }}><${Badge} variant="warning">замена<//></span>`}
                          ${mode === 'manual' && html`<span style=${{ marginLeft: '6px', display: 'inline-block' }}><${Badge} variant="info">вручную<//></span>`}
                        </td>
                        <td>
                          <div style=${{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <label title="Простой (насос не работал)" style=${{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                              <input type="checkbox" checked=${mode === 'stopped'} onChange=${(e) => setMode(p.id, e.target.checked ? 'stopped' : 'normal')} />
                            <//>
                            ${modeBtn('reset', RefreshCw, 'Замена расходомера')}
                            ${modeBtn('manual', PenLine, 'Расходомер не работал — ввести объём вручную')}
                          </div>
                        </td>
                        <td>
                          ${mode === 'stopped' && html`<span style=${{ color: 'var(--text-tertiary)', fontSize: '12.5px' }}>—</span>`}
                          ${mode === 'normal' && html`<input type="number" step="0.01" class="input" style=${{ width: '120px' }} value=${fieldVal(p.id, 'reading', '')} onChange=${(e) => setField(p.id, 'reading', e.target.value)} />`}
                          ${mode === 'reset' && html`
                            <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <input type="number" step="0.01" class="input" placeholder="Нач. нового счётчика" title="Начальное показание нового счётчика" style=${{ width: '175px' }} value=${fieldVal(p.id, 'resetStartValue', '')} onChange=${(e) => setField(p.id, 'resetStartValue', e.target.value)} />
                              <input type="number" step="0.01" class="input" placeholder="Показание на конец дня" title="Показание нового счётчика на конец дня (необязательно)" style=${{ width: '175px' }} value=${fieldVal(p.id, 'manualVolume', '')} onChange=${(e) => setField(p.id, 'manualVolume', e.target.value)} />
                            </div>
                          `}
                          ${mode === 'manual' && html`<input type="number" step="0.1" class="input" placeholder="Оценка объёма, м³" style=${{ width: '175px' }} value=${fieldVal(p.id, 'manualVolume', '')} onChange=${(e) => setField(p.id, 'manualVolume', e.target.value)} />`}
                        </td>
                        <td><input type="number" step="0.5" class="input" style=${{ width: '90px' }} value=${fieldVal(p.id, 'hoursWorked', '')} onChange=${(e) => setField(p.id, 'hoursWorked', e.target.value)} /></td>
                        <td class="mono" style=${vol != null && vol < 0 ? { color: 'var(--red-500)', fontWeight: 700 } : undefined}>${vol == null ? '—' : vol.toFixed(1)}</td>
                        <td>
                          <button type="button" onClick=${() => setOpenDist((o) => ({ ...o, [p.id]: !o[p.id] }))}
                            style=${{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '12px', color: dists.length ? 'var(--text-primary)' : 'var(--text-tertiary)', textAlign: 'left', textDecoration: 'underline dotted' }}>
                            ${distSummary}
                          <//>
                        </td>
                      </tr>
                      ${openDist[p.id] && html`
                        <tr key=${p.id + '-dist'}>
                          <td colSpan="6" style=${{ background: 'var(--bg-surface-2)', padding: '12px 16px' }}>
                            <div style=${{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                              <span style=${{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.03em' }}>Распределение откачки<//>
                              <span style=${{ fontSize: '12px', fontWeight: 700, color: distTotalColor(distTotal) }}>Итого: ${distTotal}%<//>
                            </div>
                            <div style=${{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                              ${dists.map((d, idx) => html`
                                <div key=${idx} style=${{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                  <${Select} value=${d.destinationId} onChange=${(e) => updateDistRow(p.id, idx, { destinationId: e.target.value })} style=${{ width: '220px' }}>
                                    <option value="">— направление —</option>
                                    ${destinations.map((dst) => html`<option key=${dst.id} value=${dst.id}>${dst.name}<//>`)}
                                  <//>
                                  <input type="number" min="0" max="100" step="1" class="input" style=${{ width: '80px' }} value=${d.pct} onChange=${(e) => updateDistRow(p.id, idx, { pct: e.target.value === '' ? '' : parseFloat(e.target.value) })} />
                                  <span style=${{ fontSize: '12px', color: 'var(--text-tertiary)' }}>%<//>
                                  <button type="button" title="Удалить направление" onClick=${() => removeDistRow(p.id, idx)} style=${{ background: 'none', border: 'none', color: 'var(--red-500)', cursor: 'pointer', fontSize: '14px' }}>✕<//>
                                </div>
                              `)}
                            </div>
                            <${Button} variant="outline" size="sm" onClick=${() => addDistRow(p.id)}>+ Направление<//>
                          </td>
                        </tr>
                      `}
                    `;
                  })}
                </tbody>
              </table></div>
            <//>
          <//>
        `;
      })}
    </div>
  `;
}

// ── Уровни воды: график + таблица ────────────────────────────────────────────
function WaterLevelsTab({ data, onSaved }) {
  const { sumps, levels } = data;
  const [sumpId, setSumpId] = useState(sumps[0]?.id || '');
  useEffect(() => { if (!sumpId && sumps.length) setSumpId(sumps[0].id); }, [sumps]);
  const [form, setForm] = useState({ date: today(), elevation: '', measuredBy: '' });
  const [saving, setSaving] = useState(false);

  const rows = useMemo(() => levels.filter((l) => l.sumpId === sumpId).sort((a, b) => (a.date < b.date ? -1 : 1)), [levels, sumpId]);
  const chartData = rows.map((r) => ({ date: r.date.slice(5), Уровень: r.elevation }));

  async function save() {
    if (!sumpId || form.elevation === '') return;
    setSaving(true);
    const row = { id: 'wl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), sump_id: sumpId, date: form.date, time: '', elevation: parseFloat(form.elevation), measured_by: form.measuredBy, notes: '' };
    const { error } = await supabase.from('dew_water_levels').upsert(row);
    setSaving(false);
    if (!error) { setForm({ date: today(), elevation: '', measuredBy: '' }); onSaved(); }
  }

  return html`
    <div>
      <div style=${{ marginBottom: '14px', maxWidth: '260px' }}>
        <label style=${{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Зумпф</label>
        <${Select} value=${sumpId} onChange=${(e) => setSumpId(e.target.value)}>
          ${sumps.map((s) => html`<option key=${s.id} value=${s.id}>${s.name}<//>`)}
        <//>
      </div>

      <${Card} style=${{ marginBottom: '16px' }}>
        <${CardHeader}><${CardTitle} subtitle="Абсолютная отметка уровня воды">Динамика уровня<//><//>
        <${CardContent}>
          ${rows.length < 2 ? html`<div style=${{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>Недостаточно данных для графика (нужно минимум 2 замера)</div>` : html`
            <div style=${{ width: '100%', height: '220px' }}>
              <${ResponsiveContainer}>
                <${LineChart} data=${chartData} margin=${{ left: -8, right: 16, top: 8, bottom: 0 }}>
                  <${CartesianGrid} vertical=${false} stroke="var(--border-subtle)" />
                  <${XAxis} dataKey="date" tick=${{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} />
                  <${YAxis} domain=${['auto', 'auto']} tick=${{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} />
                  <${Tooltip} contentStyle=${{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }} />
                  <${Line} type="monotone" dataKey="Уровень" stroke="var(--gold-500)" strokeWidth=${2} dot=${{ r: 3 }} />
                <//>
              <//>
            </div>
          `}
        <//>
      <//>

      <${Card}>
        <${CardHeader}>
          <${CardTitle}>Замеры<//>
          <div style=${{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input type="date" class="input" style=${{ width: '140px' }} value=${form.date} onChange=${(e) => setForm({ ...form, date: e.target.value })} />
            <input type="number" step="0.01" class="input" placeholder="Отметка, м" style=${{ width: '120px' }} value=${form.elevation} onChange=${(e) => setForm({ ...form, elevation: e.target.value })} />
            <${Button} size="sm" onClick=${save} disabled=${saving}><${Plus} size=${14} /> Добавить<//>
          </div>
        <//>
        <${CardContent} tight>
          <${Table}
            columns=${[
              { key: 'date', header: 'Дата', render: (r) => r.date },
              { key: 'elevation', header: 'Отметка, м', render: (r) => html`<span class="mono">${r.elevation?.toFixed(2)}</span>` },
              { key: 'by', header: 'Замерил', render: (r) => r.measuredBy || '—' },
            ]}
            rows=${rows.slice().reverse().slice(0, 30)}
            rowKey=${(r) => r.id}
            emptyIcon=${html`<${Droplet} size=${36} />`}
            emptyTitle="Замеров нет"
          />
        <//>
      <//>
    </div>
  `;
}

// ── Аналитика: KPI + флот насосов + направления ──────────────────────────────
function AnalyticsTab({ data }) {
  const { sumps, pumps, readings, destinations } = data;
  const [days, setDays] = useState(30);

  const cutoff = useMemo(() => { const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString().slice(0, 10); }, [days]);
  const periodReadings = useMemo(() => days === 0 ? readings : readings.filter((r) => r.date >= cutoff), [readings, days, cutoff]);

  const kpi = useMemo(() => {
    let total = 0;
    periodReadings.forEach((r) => { total += finalVolume(readings, destinations, r); });
    const working = pumps.filter((p) => p.status === 'working').length;
    const atRisk = sumps.filter((s) => {
      const lvl = latestLevel(data.levels, s.id);
      return s.critical_level != null && lvl && lvl.elevation <= s.critical_level;
    }).length;
    const dayCount = days === 0 ? new Set(periodReadings.map((r) => r.date)).size || 1 : days;
    return { total, working, atRisk, avgDaily: total / Math.max(1, dayCount) };
  }, [periodReadings, pumps, sumps, data.levels, days]);

  const byDestination = useMemo(() => {
    const map = {};
    periodReadings.forEach((r) => {
      const dists = r.distributions && r.distributions.length ? r.distributions : (r.destinationId ? [{ destinationId: r.destinationId, pct: 100 }] : []);
      const total = computedVolume(readings, r) || 0;
      dists.forEach((d) => {
        const dest = destinations.find((x) => x.id === d.destinationId);
        const name = dest ? dest.name : 'Не указано';
        map[name] = (map[name] || 0) + total * (d.pct || 0) / 100;
      });
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [periodReadings, readings, destinations]);

  const fleet = useMemo(() => pumps.map((p) => {
    const pReadings = readings.filter((r) => r.pumpId === p.id);
    const total = pReadings.reduce((acc, r) => acc + (computedVolume(readings, r) || 0), 0);
    const last = pReadings.slice().sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    return { ...p, totalVolume: total, lastDate: last ? last.date : null };
  }), [pumps, readings]);

  return html`
    <div>
      <${Tabs} tabs=${[{ value: 7, label: '7д' }, { value: 30, label: '30д' }, { value: 90, label: '90д' }, { value: 0, label: 'Всё' }]} value=${days} onChange=${setDays} />

      <div class="grid grid-4" style=${{ margin: '16px 0' }}>
        <${KpiCard} label="Объём за период" value=${kpi.total.toFixed(0)} unit="м³" />
        <${KpiCard} label="Средний суточный" value=${kpi.avgDaily.toFixed(1)} unit="м³/сут" />
        <${KpiCard} label="Насосов в работе" value=${kpi.working} />
        <${KpiCard} label="Зумпфов в риске" value=${kpi.atRisk} />
      </div>

      <${Card} style=${{ marginBottom: '16px' }}>
        <${CardHeader}><${CardTitle}>Флот насосов<//><//>
        <${CardContent} tight>
          <${Table}
            columns=${[
              { key: 'name', header: 'Насос', render: (p) => html`<span style=${{ fontWeight: 600 }}>${p.name}</span>` },
              { key: 'sump', header: 'Зумпф', render: (p) => (sumps.find((s) => s.id === p.sump_id) || {}).name || '—' },
              { key: 'status', header: 'Статус', render: (p) => { const st = PUMP_STATUS[p.status] || PUMP_STATUS.off; return html`<${Badge} variant=${st.badge}>${st.label}<//>`; } },
              { key: 'total', header: 'Суммарный объём, м³', render: (p) => html`<span class="mono">${p.totalVolume.toFixed(0)}</span>` },
              { key: 'last', header: 'Последнее показание', render: (p) => p.lastDate || '—' },
            ]}
            rows=${fleet}
            rowKey=${(p) => p.id}
            emptyIcon=${html`<${Gauge} size=${36} />`}
            emptyTitle="Насосов нет"
          />
        <//>
      <//>

      <${Card}>
        <${CardHeader}><${CardTitle} subtitle="Куда уходит откачанная вода за выбранный период">По направлениям<//><//>
        <${CardContent} tight>
          ${!byDestination.length ? html`<div style=${{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>Нет данных за период</div>` : byDestination.map(([name, vol]) => html`
            <div key=${name} style=${{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style=${{ flex: 1, fontSize: 13, fontWeight: 600 }}>${name}</div>
              <${Badge} variant="accent">${vol.toFixed(0)} м³<//>
            </div>
          `)}
        <//>
      <//>
    </div>
  `;
}

export function DewateringPage() {
  const data = useDewateringData();
  const [tab, setTab] = useState('overview');
  const [jumpSumpId, setJumpSumpId] = useState(null);

  function jumpToSumpJournal(sumpId) { setJumpSumpId(sumpId); setTab('journal'); }

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Журнал Водоотлива</div>
          <div class="page-desc">Зумпфы, насосы, показания и водный баланс.</div>
        </div>
      </div>

      ${data.error && html`<div style=${{ color: 'var(--red-500)', fontSize: '13px', marginBottom: '12px' }}>Ошибка: ${data.error}</div>`}

      <div style=${{ marginBottom: '16px' }}>
        <${Tabs}
          tabs=${[{ value: 'overview', label: 'Обзор' }, { value: 'sumps', label: 'Зумпфы' }, { value: 'journal', label: 'Журнал' }, { value: 'levels', label: 'Уровни воды' }, { value: 'analytics', label: 'Аналитика' }]}
          value=${tab} onChange=${setTab}
        />
      </div>

      ${data.loading ? html`<${Skeleton} height="300px" />` : html`
        ${tab === 'overview' && html`<${OverviewTab} data=${data} onSumpClick=${jumpToSumpJournal} />`}
        ${tab === 'sumps' && html`<${SumpsTab} data=${data} onSaved=${data.reload} />`}
        ${tab === 'journal' && html`<${JournalTab} data=${data} onSaved=${data.reload} jumpSumpId=${jumpSumpId} onJumpConsumed=${() => setJumpSumpId(null)} />`}
        ${tab === 'levels' && html`<${WaterLevelsTab} data=${data} onSaved=${data.reload} />`}
        ${tab === 'analytics' && html`<${AnalyticsTab} data=${data} />`}
      `}
    </div>
  `;
}
