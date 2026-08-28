// Журнал Пылеподавления — рейсы поливочных машин. Порт функционала
// hydro-monitoring/ui-dustsuppression.js (4 вкладки: журнал/техника/форсунки/аналитика)
// под новую дизайн-систему web-next, с тем же распределением по вкладкам, что и в
// Журнале Водоотлива (KPI-полоса + Tabs). Расчёты — в lib/dust-core.js.
import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  Plus, Pencil, Trash2, Wind, ChevronLeft, ChevronRight, Download, Building2, Truck,
  Droplet, Save, X,
} from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import {
  Button, Card, CardHeader, CardTitle, CardContent, Input, Select, Tabs, Badge,
  KpiCard, Skeleton, EmptyState, Table, Dialog, Field,
} from '../components/ui.js';
import { computeVolume, nozzleVolumeMonth, pluralRu, nozzleLabel, exportDustXLSX } from '../lib/dust-core.js';

function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function genId(prefix) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function shiftDate(dateStr, delta) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + delta);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// ── Загрузка данных ───────────────────────────────────────────────────────────
function useDustData() {
  const [state, setState] = useState({ loading: true, error: null, logs: [], orgs: [], vehicles: [], nozzles: [], sumps: [] });
  async function reload() {
    const [logsR, orgsR, vehiclesR, nozzlesR, sumpsR] = await Promise.all([
      supabase.from('dust_logs').select('*').order('date', { ascending: false }).limit(5000),
      supabase.from('dust_orgs').select('*').order('name'),
      supabase.from('dust_vehicles').select('*').order('name'),
      supabase.from('dust_nozzles').select('*').order('name'),
      supabase.from('dew_sumps').select('id,name,quarry').order('name'),
    ]);
    const err = logsR.error || orgsR.error || vehiclesR.error || nozzlesR.error || sumpsR.error;
    if (err) { setState((s) => ({ ...s, loading: false, error: err.message })); return; }
    setState({
      loading: false, error: null,
      logs: logsR.data || [], orgs: orgsR.data || [], vehicles: vehiclesR.data || [],
      nozzles: nozzlesR.data || [], sumps: sumpsR.data || [],
    });
  }
  useEffect(() => { reload(); }, []);
  return { ...state, reload };
}

// ── Журнал: быстрый ввод по дню + история ─────────────────────────────────────
function JournalTab({ data, onSaved }) {
  const { logs, orgs, vehicles, nozzles, sumps } = data;
  const orgById = useMemo(() => Object.fromEntries(orgs.map((o) => [o.id, o])), [orgs]);
  const vehicleById = useMemo(() => Object.fromEntries(vehicles.map((v) => [v.id, v])), [vehicles]);
  const nozzleById = useMemo(() => Object.fromEntries(nozzles.map((n) => [n.id, n])), [nozzles]);

  const [journalDate, setJournalDate] = useState(today());
  const [journalOrgFilter, setJournalOrgFilter] = useState('');
  const [journalNozzleFilter, setJournalNozzleFilter] = useState('');
  const [rowsByVehicle, setRowsByVehicle] = useState({});
  const [savingAll, setSavingAll] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  useEffect(() => {
    const next = {};
    vehicles.forEach((v) => {
      const existing = logs.filter((l) => l.vehicle_id === v.id && l.date === journalDate && (!journalNozzleFilter || l.nozzle_id === journalNozzleFilter));
      next[v.id] = existing.length
        ? existing.map((l) => ({ key: l.id, nozzleId: l.nozzle_id || '', trips: l.trips != null ? String(l.trips) : '', notes: l.notes || '' }))
        : [{ key: genId('row'), nozzleId: v.default_nozzle_id || journalNozzleFilter || '', trips: '', notes: '' }];
    });
    setRowsByVehicle(next);
    setSaveStatus('');
  }, [journalDate, journalNozzleFilter, logs, vehicles]);

  function addRow(vehicleId) {
    setRowsByVehicle((prev) => ({ ...prev, [vehicleId]: [...(prev[vehicleId] || []), { key: genId('row'), nozzleId: journalNozzleFilter || '', trips: '', notes: '' }] }));
  }
  function removeRow(vehicleId, key) {
    setRowsByVehicle((prev) => ({ ...prev, [vehicleId]: prev[vehicleId].filter((r) => r.key !== key) }));
  }
  function updateRow(vehicleId, key, patch) {
    setRowsByVehicle((prev) => ({ ...prev, [vehicleId]: prev[vehicleId].map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  }

  function vehicleDayVol(vehicleId) {
    return logs.filter((l) => l.vehicle_id === vehicleId && l.date === journalDate && (!journalNozzleFilter || l.nozzle_id === journalNozzleFilter))
      .reduce((acc, l) => acc + computeVolume(l, vehicleById), 0);
  }
  function orgDayVol(orgId) {
    return vehicles.filter((v) => v.org_id === orgId).reduce((acc, v) => acc + vehicleDayVol(v.id), 0);
  }
  function rowPreviewVol(vehicleId, row) {
    const v = vehicleById[vehicleId];
    const cap = v ? parseFloat(v.capacity) || 0 : 0;
    const trips = parseFloat(row.trips) || 0;
    return cap > 0 && trips > 0 ? trips * cap : null;
  }

  async function saveAllJournal() {
    setSavingAll(true); setSaveStatus('');
    let savedCount = 0;
    const toDeleteIds = [];
    const toUpsert = [];
    vehicles.forEach((v) => {
      const rows = rowsByVehicle[v.id] || [];
      const existingIds = logs.filter((l) => l.vehicle_id === v.id && l.date === journalDate && (!journalNozzleFilter || l.nozzle_id === journalNozzleFilter)).map((l) => l.id);
      if (existingIds.length) toDeleteIds.push(...existingIds);
      rows.forEach((r) => {
        const trips = parseFloat(r.trips) || 0;
        if (!r.nozzleId || trips <= 0) return;
        toUpsert.push({
          id: genId('dl'), date: journalDate, org_id: v.org_id, vehicle_id: v.id,
          nozzle_id: r.nozzleId, trips, total_volume: trips * (parseFloat(v.capacity) || 0),
          is_manual_volume: false, manual_volume: null, notes: (r.notes || '').trim(),
        });
        savedCount++;
      });
    });
    try {
      if (toDeleteIds.length) { const { error } = await supabase.from('dust_logs').delete().in('id', toDeleteIds); if (error) throw error; }
      if (toUpsert.length) { const { error } = await supabase.from('dust_logs').upsert(toUpsert); if (error) throw error; }
      setSaveStatus(savedCount ? `Сохранено: ${savedCount} ${pluralRu(savedCount, 'запись', 'записи', 'записей')}` : 'Записи за день очищены');
      await onSaved();
      setJournalDate((d) => shiftDate(d, 1));
    } catch (e) { setSaveStatus('Ошибка: ' + e.message); }
    setSavingAll(false);
  }

  // ── История (правая колонка) ─────────────────────────────────────────────
  const [histFrom, setHistFrom] = useState('');
  const [histTo, setHistTo] = useState('');
  const [histOrg, setHistOrg] = useState('');
  const [histNozzle, setHistNozzle] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const filteredLogs = useMemo(() => {
    return logs.filter((l) => {
      if (histFrom && l.date < histFrom) return false;
      if (histTo && l.date > histTo) return false;
      if (histOrg && l.org_id !== histOrg) return false;
      if (histNozzle && l.nozzle_id !== histNozzle) return false;
      return true;
    }).slice().sort((a, b) => (b.date < a.date ? -1 : 1));
  }, [logs, histFrom, histTo, histOrg, histNozzle]);
  const filteredTotal = useMemo(() => filteredLogs.reduce((acc, l) => acc + computeVolume(l, vehicleById), 0), [filteredLogs, vehicleById]);

  function openAdd() { setForm({ id: null, date: journalDate, orgId: '', vehicleId: '', nozzleId: '', trips: '', isManual: false, manualVolume: '', notes: '' }); setDialogOpen(true); }
  function openEdit(l) {
    setForm({
      id: l.id, date: l.date, orgId: l.org_id || '', vehicleId: l.vehicle_id || '', nozzleId: l.nozzle_id || '',
      trips: l.trips != null ? String(l.trips) : '', isManual: !!l.is_manual_volume,
      manualVolume: l.manual_volume != null ? String(l.manual_volume) : '', notes: l.notes || '',
    });
    setDialogOpen(true);
  }
  async function saveForm() {
    if (!form.vehicleId) return;
    if (!form.isManual && !form.trips) return;
    setSaving(true);
    const vehicle = vehicleById[form.vehicleId];
    const trips = parseFloat(form.trips) || 0;
    const manualVol = parseFloat(form.manualVolume) || 0;
    const row = {
      id: form.id || genId('dl'), date: form.date,
      org_id: form.orgId || (vehicle ? vehicle.org_id : null), vehicle_id: form.vehicleId, nozzle_id: form.nozzleId || null,
      trips: form.trips ? trips : null,
      total_volume: form.isManual ? manualVol : trips * (vehicle ? parseFloat(vehicle.capacity) || 0 : 0),
      is_manual_volume: form.isManual, manual_volume: form.isManual ? manualVol : null,
      notes: form.notes.trim(),
    };
    const { error } = await supabase.from('dust_logs').upsert(row);
    setSaving(false);
    if (error) { alert('Ошибка сохранения: ' + error.message); return; }
    setDialogOpen(false);
    onSaved();
  }
  async function removeLog(l) {
    if (!confirm('Удалить запись журнала?')) return;
    const { error } = await supabase.from('dust_logs').delete().eq('id', l.id);
    if (error) { alert('Ошибка: ' + error.message); return; }
    onSaved();
  }
  async function doExport() {
    setExporting(true);
    try { await exportDustXLSX({ logs: filteredLogs, orgs, vehicles, nozzles, sumps }); }
    catch (e) { alert('Ошибка экспорта: ' + e.message); }
    setExporting(false);
  }

  const formVehicles = form && form.orgId ? vehicles.filter((v) => v.org_id === form.orgId) : vehicles;

  const historyColumns = [
    { key: 'date', header: 'Дата', width: '96px', render: (l) => html`<span class="mono">${l.date}</span>` },
    { key: 'org', header: 'Организация', render: (l) => (orgById[l.org_id] || {}).name || '—' },
    { key: 'vehicle', header: 'Машина', render: (l) => { const v = vehicleById[l.vehicle_id]; return v ? html`${v.name}${v.plate_number ? html`<span style=${{ color: 'var(--text-tertiary)' }}> (${v.plate_number})</span>` : ''}` : '—'; } },
    { key: 'nozzle', header: 'Форсунка', width: '110px', render: (l) => (nozzleById[l.nozzle_id] || {}).name || '—' },
    { key: 'trips', header: 'Рейсов', width: '70px', render: (l) => html`<span class="mono">${l.trips ?? '—'}</span>` },
    { key: 'volume', header: 'Объём, м³', width: '110px', render: (l) => html`<${Badge} variant="accent">${computeVolume(l, vehicleById).toFixed(1)}${l.is_manual_volume ? html`<span title="Введено вручную" style=${{ marginLeft: '3px' }}>✎</span>` : ''}<//>` },
    { key: 'notes', header: 'Примечание', render: (l) => l.notes || '—' },
    {
      key: 'actions', header: '', width: '80px',
      render: (l) => html`
        <div style=${{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
          <${Button} variant="ghost" size="sm" icon onClick=${() => openEdit(l)}><${Pencil} size=${14} /><//>
          <${Button} variant="ghost" size="sm" icon onClick=${() => removeLog(l)}><${Trash2} size=${14} style=${{ color: 'var(--red-500)' }} /><//>
        </div>
      `,
    },
  ];

  return html`
    <div>
      <div style=${{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '16px', alignItems: 'start' }}>
        <div>
          <div class="section-label">Быстрый ввод</div>
          <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px', padding: '10px 12px', background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <${Button} variant="ghost" size="sm" icon onClick=${() => setJournalDate((d) => shiftDate(d, -1))}><${ChevronLeft} size=${16} /><//>
            <${Input} type="date" value=${journalDate} onChange=${(e) => setJournalDate(e.target.value)} style=${{ width: '148px' }} />
            <${Button} variant="ghost" size="sm" icon onClick=${() => setJournalDate((d) => shiftDate(d, 1))}><${ChevronRight} size=${16} /><//>
            <${Select} value=${journalOrgFilter} onChange=${(e) => setJournalOrgFilter(e.target.value)} style=${{ width: '150px' }}>
              <option value="">Все орг.</option>
              ${orgs.map((o) => html`<option key=${o.id} value=${o.id}>${o.name}<//>`)}
            <//>
            <${Select} value=${journalNozzleFilter} onChange=${(e) => setJournalNozzleFilter(e.target.value)} style=${{ width: '150px' }}>
              <option value="">Все форсунки</option>
              ${nozzles.map((n) => html`<option key=${n.id} value=${n.id}>${nozzleLabel(n, sumps)}<//>`)}
            <//>
            <${Button} size="sm" onClick=${saveAllJournal} disabled=${savingAll} style=${{ marginLeft: 'auto' }}>
              <${Save} size=${14} /> ${savingAll ? 'Сохранение…' : 'Сохранить всё'}
            <//>
          </div>
          ${saveStatus && html`<div style=${{ fontSize: '12px', color: saveStatus.startsWith('Ошибка') ? 'var(--red-500)' : 'var(--green-600)', marginBottom: '10px' }}>${saveStatus}<//>`}

          ${!vehicles.length ? html`
            <${EmptyState} icon=${html`<${Truck} size=${36} />`} title="Машин нет" description="Добавьте организацию и машины во вкладке «Организации и техника»." />
          ` : html`
            <div style=${{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              ${(journalOrgFilter ? orgs.filter((o) => o.id === journalOrgFilter) : orgs).map((org) => {
                const orgVehicles = vehicles.filter((v) => v.org_id === org.id);
                if (!orgVehicles.length) return '';
                const dayVol = orgDayVol(org.id);
                return html`
                  <${Card} key=${org.id}>
                    <div style=${{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style=${{ fontWeight: 700, fontSize: '13px' }}>${org.name}</span>
                        ${dayVol > 0 && html`<span style=${{ fontSize: '12px', fontWeight: 700, color: 'var(--accent-hover)' }}>${dayVol.toFixed(1)} м³<//>`}
                      </div>
                      ${orgVehicles.map((v) => {
                        const cap = parseFloat(v.capacity) || 0;
                        const vVol = vehicleDayVol(v.id);
                        const rows = rowsByVehicle[v.id] || [];
                        return html`
                          <div key=${v.id} style=${{ paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                            <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px' }}>
                              <span style=${{ fontSize: '12.5px', fontWeight: 600 }}>${v.name}${v.plate_number ? html`<span style=${{ fontWeight: 400, color: 'var(--text-tertiary)' }}> (${v.plate_number})</span>` : ''}<//>
                              <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>${vVol > 0 ? html`<b style=${{ color: 'var(--accent-hover)' }}>${vVol.toFixed(1)} м³ · </b>` : ''}${cap ? cap + ' м³/рейс' : ''}<//>
                            </div>
                            <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              ${rows.map((r) => {
                                const preview = rowPreviewVol(v.id, r);
                                return html`
                                  <div key=${r.key} style=${{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    <${Select} value=${r.nozzleId} onChange=${(e) => updateRow(v.id, r.key, { nozzleId: e.target.value })} style=${{ flex: 1, minWidth: 0, fontSize: '11.5px', height: '28px' }}>
                                      <option value="">— форсунка —</option>
                                      ${nozzles.map((n) => html`<option key=${n.id} value=${n.id}>${nozzleLabel(n, sumps)}<//>`)}
                                    <//>
                                    <${Input} type="number" min="0" value=${r.trips} onChange=${(e) => updateRow(v.id, r.key, { trips: e.target.value })} style=${{ width: '56px', fontSize: '12px', textAlign: 'right', height: '28px', padding: '0 6px' }} />
                                    <span style=${{ fontSize: '10px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>рейс.<//>
                                    <span style=${{ fontSize: '10px', minWidth: '58px', textAlign: 'right', color: preview ? 'var(--accent-hover)' : 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>${preview ? '→ ' + preview.toFixed(1) : '→ —'}<//>
                                    <${Input} type="text" placeholder="примечание" value=${r.notes} onChange=${(e) => updateRow(v.id, r.key, { notes: e.target.value })} style=${{ width: '92px', fontSize: '10.5px', height: '28px', padding: '0 6px' }} />
                                    <${Button} variant="ghost" size="sm" icon onClick=${() => removeRow(v.id, r.key)} style=${{ width: '24px', height: '24px', flexShrink: 0 }}><${X} size=${12} /><//>
                                  </div>
                                `;
                              })}
                            </div>
                            <${Button} variant="ghost" size="sm" onClick=${() => addRow(v.id)} style=${{ marginTop: '4px', fontSize: '11px', opacity: 0.75 }}><${Plus} size=${12} /> Форсунка<//>
                          </div>
                        `;
                      })}
                    </div>
                  <//>
                `;
              })}
            </div>
          `}
        </div>

        <div>
          <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div class="section-label" style=${{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>История</div>
            <${Button} variant="outline" size="sm" onClick=${doExport} disabled=${exporting}><${Download} size=${13} /> Excel<//>
          </div>
          <div style=${{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '10px', padding: '8px 10px', background: 'var(--bg-surface-2)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <${Input} type="date" value=${histFrom} onChange=${(e) => setHistFrom(e.target.value)} style=${{ width: '132px' }} />
            <${Input} type="date" value=${histTo} onChange=${(e) => setHistTo(e.target.value)} style=${{ width: '132px' }} />
            <${Select} value=${histOrg} onChange=${(e) => setHistOrg(e.target.value)} style=${{ width: '132px' }}>
              <option value="">Все орг.</option>
              ${orgs.map((o) => html`<option key=${o.id} value=${o.id}>${o.name}<//>`)}
            <//>
            <${Select} value=${histNozzle} onChange=${(e) => setHistNozzle(e.target.value)} style=${{ width: '132px' }}>
              <option value="">Все форсунки</option>
              ${nozzles.map((n) => html`<option key=${n.id} value=${n.id}>${n.name}<//>`)}
            <//>
            <${Button} size="sm" onClick=${openAdd}><${Plus} size=${13} /> Добавить<//>
          </div>

          <${Card}>
            <${CardContent} tight>
              <div style=${{ maxHeight: '560px', overflowY: 'auto' }}>
                <${Table}
                  columns=${historyColumns}
                  rows=${filteredLogs}
                  rowKey=${(l) => l.id}
                  emptyIcon=${html`<${Wind} size=${36} />`}
                  emptyTitle="Записей нет"
                  emptyDescription="По выбранным фильтрам ничего не найдено."
                />
              </div>
            <//>
          <//>
          <div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)', marginTop: '8px' }}>
            ${filteredLogs.length} ${pluralRu(filteredLogs.length, 'запись', 'записи', 'записей')} · <b style=${{ color: 'var(--text-primary)' }}>${filteredTotal.toFixed(1)} м³<//> итого
          </div>
        </div>
      </div>

      ${form && html`
        <${Dialog}
          open=${dialogOpen} onClose=${() => setDialogOpen(false)}
          title=${form.id ? 'Редактировать запись' : 'Новая запись'}
          footer=${html`
            <${Button} variant="outline" onClick=${() => setDialogOpen(false)}>Отмена<//>
            <${Button} onClick=${saveForm} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить'}<//>
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
                  ${formVehicles.map((v) => html`<option key=${v.id} value=${v.id}>${v.name}<//>`)}
                <//>
              <//>
              <${Field} label="Форсунка">
                <${Select} value=${form.nozzleId} onChange=${(e) => setForm({ ...form, nozzleId: e.target.value })}>
                  <option value="">—</option>
                  ${nozzles.map((n) => html`<option key=${n.id} value=${n.id}>${nozzleLabel(n, sumps)}<//>`)}
                <//>
              <//>
            </div>
            <${Field} label=${form.isManual ? 'Число рейсов' : 'Число рейсов *'}><${Input} type="number" min="0" value=${form.trips} onChange=${(e) => setForm({ ...form, trips: e.target.value })} /><//>

            <label style=${{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12.5px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <input type="checkbox" checked=${form.isManual} onChange=${(e) => setForm({ ...form, isManual: e.target.checked })} /> Ввести объём вручную
            </label>
            ${form.isManual && html`<${Field} label="Объём, м³ *"><${Input} type="number" step="0.1" min="0" value=${form.manualVolume} onChange=${(e) => setForm({ ...form, manualVolume: e.target.value })} /><//>`}

            <${Field} label="Примечание">
              <textarea class="input" rows="2" style=${{ resize: 'vertical', paddingTop: '8px' }} value=${form.notes} onChange=${(e) => setForm({ ...form, notes: e.target.value })} />
            <//>
          </div>
        <//>
      `}
    </div>
  `;
}

// ── Организации и техника ──────────────────────────────────────────────────────
function FleetTab({ data, onSaved }) {
  const { orgs, vehicles, nozzles, sumps } = data;
  const [vehicleOrgFilter, setVehicleOrgFilter] = useState('');
  const [orgForm, setOrgForm] = useState(null);
  const [vehicleForm, setVehicleForm] = useState(null);
  const [savingOrg, setSavingOrg] = useState(false);
  const [savingVehicle, setSavingVehicle] = useState(false);

  async function saveOrg() {
    if (!orgForm.name.trim()) { alert('Введите название организации'); return; }
    setSavingOrg(true);
    try {
      const { error } = await supabase.from('dust_orgs').upsert({ id: orgForm.id || genId('do'), name: orgForm.name.trim(), notes: orgForm.notes.trim() });
      if (error) throw error;
      setOrgForm(null);
      await onSaved();
    } catch (e) { alert('Ошибка: ' + e.message); } finally { setSavingOrg(false); }
  }
  async function deleteOrg(org) {
    const vIds = vehicles.filter((v) => v.org_id === org.id).map((v) => v.id);
    const msg = `Удалить организацию «${org.name}»?` + (vIds.length ? `\nВместе с ней будет удалено машин: ${vIds.length}.` : '');
    if (!confirm(msg)) return;
    try {
      if (vIds.length) {
        await supabase.from('dust_logs').delete().in('vehicle_id', vIds);
        await supabase.from('dust_vehicles').delete().in('id', vIds);
      }
      await supabase.from('dust_logs').delete().eq('org_id', org.id);
      await supabase.from('dust_orgs').delete().eq('id', org.id);
      await onSaved();
    } catch (e) { alert('Ошибка: ' + e.message); }
  }

  async function saveVehicle() {
    if (!vehicleForm.orgId) { alert('Выберите организацию'); return; }
    if (!vehicleForm.name.trim()) { alert('Введите название машины'); return; }
    setSavingVehicle(true);
    try {
      const row = {
        id: vehicleForm.id || genId('dv'), org_id: vehicleForm.orgId, name: vehicleForm.name.trim(),
        plate_number: vehicleForm.plate.trim(), capacity: vehicleForm.capacity !== '' ? parseFloat(vehicleForm.capacity) : null,
        default_nozzle_id: vehicleForm.defaultNozzleId || null, notes: vehicleForm.notes.trim(),
      };
      const { error } = await supabase.from('dust_vehicles').upsert(row);
      if (error) throw error;
      setVehicleForm(null);
      await onSaved();
    } catch (e) { alert('Ошибка: ' + e.message); } finally { setSavingVehicle(false); }
  }
  async function deleteVehicle(v) {
    if (!confirm(`Удалить машину «${v.name}»? Вместе с ней удалятся её записи в журнале.`)) return;
    try {
      await supabase.from('dust_logs').delete().eq('vehicle_id', v.id);
      await supabase.from('dust_vehicles').delete().eq('id', v.id);
      await onSaved();
    } catch (e) { alert('Ошибка: ' + e.message); }
  }

  const visibleVehicles = vehicleOrgFilter ? vehicles.filter((v) => v.org_id === vehicleOrgFilter) : vehicles;
  const orgById = Object.fromEntries(orgs.map((o) => [o.id, o]));
  const nozzleById = Object.fromEntries(nozzles.map((n) => [n.id, n]));

  const vehicleColumns = [
    { key: 'name', header: 'Машина', render: (v) => html`<span style=${{ fontWeight: 600 }}>${v.name}<//>` },
    { key: 'plate', header: 'Гос. номер', render: (v) => v.plate_number || '—' },
    { key: 'capacity', header: 'Объём, м³', width: '90px', render: (v) => html`<span class="mono">${v.capacity ?? '—'}<//>` },
    { key: 'org', header: 'Организация', render: (v) => (orgById[v.org_id] || {}).name || '—' },
    { key: 'nozzle', header: 'Форсунка по умолч.', render: (v) => (nozzleById[v.default_nozzle_id] || {}).name || '—' },
    { key: 'notes', header: 'Примечание', render: (v) => v.notes || '—' },
    {
      key: 'actions', header: '', width: '80px',
      render: (v) => html`
        <div style=${{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
          <${Button} variant="ghost" size="sm" icon onClick=${() => setVehicleForm({ id: v.id, orgId: v.org_id || '', name: v.name, plate: v.plate_number || '', capacity: v.capacity ?? '', defaultNozzleId: v.default_nozzle_id || '', notes: v.notes || '' })}><${Pencil} size=${14} /><//>
          <${Button} variant="ghost" size="sm" icon onClick=${() => deleteVehicle(v)}><${Trash2} size=${14} style=${{ color: 'var(--red-500)' }} /><//>
        </div>
      `,
    },
  ];

  return html`
    <div style=${{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: '16px', alignItems: 'start' }}>
      <div>
        <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <div class="section-label" style=${{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>Организации<//>
          <${Button} size="sm" onClick=${() => setOrgForm({ id: null, name: '', notes: '' })}><${Plus} size=${13} /><//>
        </div>
        ${!orgs.length ? html`<${EmptyState} icon=${html`<${Building2} size=${32} />`} title="Организаций нет" />` : html`
          <div style=${{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            ${orgs.map((org) => html`
              <${Card} key=${org.id}>
                <div style=${{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style=${{ flex: 1, minWidth: 0 }}>
                    <div style=${{ fontWeight: 700, fontSize: '12.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${org.name}<//>
                    <div style=${{ fontSize: '10.5px', color: 'var(--text-tertiary)' }}>Машин: ${vehicles.filter((v) => v.org_id === org.id).length}${org.notes ? ' · ' + org.notes : ''}<//>
                  </div>
                  <${Button} variant="ghost" size="sm" icon onClick=${() => setOrgForm({ id: org.id, name: org.name, notes: org.notes || '' })}><${Pencil} size=${13} /><//>
                  <${Button} variant="ghost" size="sm" icon onClick=${() => deleteOrg(org)}><${Trash2} size=${13} style=${{ color: 'var(--red-500)' }} /><//>
                </div>
              <//>
            `)}
          </div>
        `}
      </div>

      <div>
        <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', gap: '10px' }}>
          <div class="section-label" style=${{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>Машины / цистерны<//>
          <div style=${{ display: 'flex', gap: '8px' }}>
            <${Select} value=${vehicleOrgFilter} onChange=${(e) => setVehicleOrgFilter(e.target.value)} style=${{ width: '180px' }}>
              <option value="">Все организации</option>
              ${orgs.map((o) => html`<option key=${o.id} value=${o.id}>${o.name}<//>`)}
            <//>
            <${Button} size="sm" onClick=${() => setVehicleForm({ id: null, orgId: vehicleOrgFilter, name: '', plate: '', capacity: '', defaultNozzleId: '', notes: '' })} disabled=${!orgs.length} title=${!orgs.length ? 'Сначала добавьте организацию' : ''}>
              <${Plus} size=${13} /> Добавить
            <//>
          </div>
        </div>
        <${Card}>
          <${CardContent} tight>
            <${Table}
              columns=${vehicleColumns} rows=${visibleVehicles} rowKey=${(v) => v.id}
              emptyIcon=${html`<${Truck} size=${36} />`} emptyTitle="Машин нет"
              emptyDescription=${vehicles.length ? 'Нет машин в выбранной организации' : 'Добавьте первую машину'}
            />
          <//>
        <//>
      </div>

      ${orgForm && html`
        <${Dialog} open=${true} onClose=${() => setOrgForm(null)} title=${orgForm.id ? 'Изменить организацию' : 'Новая организация'}
          footer=${html`<${Button} variant="outline" onClick=${() => setOrgForm(null)}>Отмена<//><${Button} onClick=${saveOrg} disabled=${savingOrg}>${savingOrg ? 'Сохранение…' : 'Сохранить'}<//>`}>
          <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <${Field} label="Название *"><${Input} value=${orgForm.name} onChange=${(e) => setOrgForm({ ...orgForm, name: e.target.value })} placeholder="ООО Транспорт..." /><//>
            <${Field} label="Примечание"><${Input} value=${orgForm.notes} onChange=${(e) => setOrgForm({ ...orgForm, notes: e.target.value })} /><//>
          </div>
        <//>
      `}

      ${vehicleForm && html`
        <${Dialog} open=${true} onClose=${() => setVehicleForm(null)} title=${vehicleForm.id ? 'Изменить машину' : 'Новая машина'}
          footer=${html`<${Button} variant="outline" onClick=${() => setVehicleForm(null)}>Отмена<//><${Button} onClick=${saveVehicle} disabled=${savingVehicle}>${savingVehicle ? 'Сохранение…' : 'Сохранить'}<//>`}>
          <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <${Field} label="Организация *">
              <${Select} value=${vehicleForm.orgId} onChange=${(e) => setVehicleForm({ ...vehicleForm, orgId: e.target.value })}>
                <option value="">— организация —</option>
                ${orgs.map((o) => html`<option key=${o.id} value=${o.id}>${o.name}<//>`)}
              <//>
            <//>
            <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <${Field} label="Название *"><${Input} value=${vehicleForm.name} onChange=${(e) => setVehicleForm({ ...vehicleForm, name: e.target.value })} placeholder="КамАЗ-65115" /><//>
              <${Field} label="Гос. номер"><${Input} value=${vehicleForm.plate} onChange=${(e) => setVehicleForm({ ...vehicleForm, plate: e.target.value })} placeholder="А001АА 15" /><//>
            </div>
            <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <${Field} label="Объём цистерны, м³"><${Input} type="number" step="0.1" min="0" value=${vehicleForm.capacity} onChange=${(e) => setVehicleForm({ ...vehicleForm, capacity: e.target.value })} /><//>
              <${Field} label="Форсунка по умолчанию">
                <${Select} value=${vehicleForm.defaultNozzleId} onChange=${(e) => setVehicleForm({ ...vehicleForm, defaultNozzleId: e.target.value })}>
                  <option value="">Не задана</option>
                  ${nozzles.map((n) => html`<option key=${n.id} value=${n.id}>${nozzleLabel(n, sumps)}<//>`)}
                <//>
              <//>
            </div>
            <${Field} label="Примечание"><${Input} value=${vehicleForm.notes} onChange=${(e) => setVehicleForm({ ...vehicleForm, notes: e.target.value })} /><//>
          </div>
        <//>
      `}
    </div>
  `;
}

// ── Форсунки ────────────────────────────────────────────────────────────────
function NozzlesTab({ data, onSaved }) {
  const { nozzles, sumps, logs, vehicles } = data;
  const vehicleById = useMemo(() => Object.fromEntries(vehicles.map((v) => [v.id, v])), [vehicles]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  async function saveNozzle() {
    if (!form.name.trim()) { alert('Введите название форсунки'); return; }
    setSaving(true);
    try {
      const row = {
        id: form.id || genId('dn'), name: form.name.trim(), source_type: 'sump', source_id: form.sumpId || null,
        location: form.location.trim(), notes: form.notes.trim(),
      };
      const { error } = await supabase.from('dust_nozzles').upsert(row);
      if (error) throw error;
      setForm(null);
      await onSaved();
    } catch (e) { alert('Ошибка: ' + e.message); } finally { setSaving(false); }
  }
  async function deleteNozzle(n) {
    if (!confirm(`Удалить форсунку «${n.name}»? Вместе с ней удалятся её записи в журнале.`)) return;
    try {
      await supabase.from('dust_logs').delete().eq('nozzle_id', n.id);
      await supabase.from('dust_nozzles').delete().eq('id', n.id);
      await onSaved();
    } catch (e) { alert('Ошибка: ' + e.message); }
  }

  return html`
    <div>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
        <div class="section-label" style=${{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>Форсунки (${nozzles.length})<//>
        <${Button} size="sm" onClick=${() => setForm({ id: null, name: '', sumpId: '', location: '', notes: '' })}><${Plus} size=${14} /> Добавить форсунку<//>
      </div>
      ${!nozzles.length ? html`<${EmptyState} icon=${html`<${Droplet} size=${36} />`} title="Форсунок нет" description="Добавьте первую форсунку — точку пылеподавления." />` : html`
        <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
          ${nozzles.map((n) => {
            const sump = n.source_type === 'sump' && n.source_id ? sumps.find((s) => s.id === n.source_id) : null;
            const volMonth = nozzleVolumeMonth(n.id, logs, vehicleById);
            return html`
              <${Card} key=${n.id}>
                <div style=${{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style=${{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                    <div style=${{ fontWeight: 700, fontSize: '13.5px' }}><${Droplet} size=${13} style=${{ verticalAlign: 'middle', marginRight: '4px', color: 'var(--blue-500)' }} />${n.name}<//>
                  </div>
                  <div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)' }}>Источник: <span style=${{ color: 'var(--text-secondary)' }}>${sump ? sump.name : 'не задан'}<//><//>
                  ${n.location && html`<div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)' }}>Место: <span style=${{ color: 'var(--text-secondary)' }}>${n.location}<//><//>`}
                  <div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)' }}>За месяц: <b style=${{ color: volMonth > 0 ? 'var(--green-600)' : 'var(--text-tertiary)' }}>${volMonth.toFixed(1)} м³<//><//>
                  ${n.notes && html`<div style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>${n.notes}<//>`}
                  <div style=${{ display: 'flex', gap: '4px', justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: '8px' }}>
                    <${Button} variant="ghost" size="sm" icon onClick=${() => setForm({ id: n.id, name: n.name, sumpId: n.source_id || '', location: n.location || '', notes: n.notes || '' })}><${Pencil} size=${14} /><//>
                    <${Button} variant="ghost" size="sm" icon onClick=${() => deleteNozzle(n)}><${Trash2} size=${14} style=${{ color: 'var(--red-500)' }} /><//>
                  </div>
                </div>
              <//>
            `;
          })}
        </div>
      `}

      ${form && html`
        <${Dialog} open=${true} onClose=${() => setForm(null)} title=${form.id ? 'Изменить форсунку' : 'Новая форсунка'}
          footer=${html`<${Button} variant="outline" onClick=${() => setForm(null)}>Отмена<//><${Button} onClick=${saveNozzle} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить'}<//>`}>
          <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <${Field} label="Название *"><${Input} value=${form.name} onChange=${(e) => setForm({ ...form, name: e.target.value })} placeholder="Форсунка №1" /><//>
            <${Field} label="Зумпф-источник">
              <${Select} value=${form.sumpId} onChange=${(e) => setForm({ ...form, sumpId: e.target.value })}>
                <option value="">— зумпф —</option>
                ${sumps.map((s) => html`<option key=${s.id} value=${s.id}>${s.name}${s.quarry ? ' · ' + s.quarry : ''}<//>`)}
              <//>
            <//>
            <${Field} label="Местоположение"><${Input} value=${form.location} onChange=${(e) => setForm({ ...form, location: e.target.value })} placeholder="Горизонт -50м" /><//>
            <${Field} label="Примечание"><${Input} value=${form.notes} onChange=${(e) => setForm({ ...form, notes: e.target.value })} /><//>
          </div>
        <//>
      `}
    </div>
  `;
}

// ── Аналитика ──────────────────────────────────────────────────────────────────
function DustAnalyticsTab({ data }) {
  const { logs, orgs, nozzles, vehicles } = data;
  const vehicleById = useMemo(() => Object.fromEntries(vehicles.map((v) => [v.id, v])), [vehicles]);

  const trend = useMemo(() => {
    const days = [];
    for (let i = 29; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(d.toISOString().slice(0, 10)); }
    return days.map((day) => ({
      day, label: day.slice(5),
      vol: logs.filter((l) => l.date === day).reduce((acc, l) => acc + computeVolume(l, vehicleById), 0),
    }));
  }, [logs, vehicleById]);

  const byOrg = useMemo(() => {
    const map = {};
    logs.forEach((l) => { map[l.org_id] = (map[l.org_id] || 0) + computeVolume(l, vehicleById); });
    return orgs.filter((o) => map[o.id]).map((o) => ({ name: o.name, vol: map[o.id] || 0 })).sort((a, b) => b.vol - a.vol);
  }, [logs, orgs, vehicleById]);

  const byNozzle = useMemo(() => {
    const map = {};
    logs.forEach((l) => { map[l.nozzle_id] = (map[l.nozzle_id] || 0) + computeVolume(l, vehicleById); });
    return nozzles.filter((n) => map[n.id]).map((n) => ({ name: n.name, vol: map[n.id] || 0 })).sort((a, b) => b.vol - a.vol);
  }, [logs, nozzles, vehicleById]);

  const byMonth = useMemo(() => {
    const now = new Date();
    const ruM = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    const months = [];
    for (let i = 2; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push({ key: d.toISOString().slice(0, 7), label: ruM[d.getMonth()] }); }
    return nozzles.map((n) => {
      const row = { name: n.name };
      months.forEach((m) => { row[m.label] = logs.filter((l) => l.nozzle_id === n.id && l.date.slice(0, 7) === m.key).reduce((acc, l) => acc + computeVolume(l, vehicleById), 0); });
      return row;
    }).filter((row) => months.some((m) => row[m.label] > 0));
  }, [logs, nozzles, vehicleById]);
  const monthLabels = useMemo(() => { const now = new Date(); const ruM = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']; const out = []; for (let i = 2; i >= 0; i--) out.push(ruM[new Date(now.getFullYear(), now.getMonth() - i, 1).getMonth()]); return out; }, []);
  const monthColors = ['var(--blue-500)', 'var(--gold-500)', 'var(--green-500)'];

  const totalVol = useMemo(() => logs.reduce((acc, l) => acc + computeVolume(l, vehicleById), 0), [logs, vehicleById]);
  const vol30d = useMemo(() => trend.reduce((acc, d) => acc + d.vol, 0), [trend]);

  return html`
    <div>
      <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        <${KpiCard} label="Объём за 30 дней" value=${vol30d.toFixed(0)} unit="м³" />
        <${KpiCard} label="Объём всего" value=${totalVol.toFixed(0)} unit="м³" />
        <${KpiCard} label="Организаций" value=${orgs.length} />
        <${KpiCard} label="Форсунок" value=${nozzles.length} />
      </div>

      <div class="grid grid-2" style=${{ gap: '16px' }}>
        <${Card}>
          <${CardHeader}><${CardTitle}>Объём за последние 30 дней<//><//>
          <${CardContent}>
            <div style=${{ width: '100%', height: '220px' }}>
              <${ResponsiveContainer}>
                <${BarChart} data=${trend} margin=${{ left: 0, right: 8, top: 4, bottom: 0 }}>
                  <${CartesianGrid} vertical=${false} stroke="var(--border-subtle)" />
                  <${XAxis} dataKey="label" interval=${6} tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} />
                  <${YAxis} tick=${{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} allowDecimals=${false} width=${34} />
                  <${Tooltip} contentStyle=${{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }} formatter=${(v) => v.toFixed(1) + ' м³'} labelFormatter=${(l, p) => (p && p[0] ? p[0].payload.day : l)} />
                  <${Bar} dataKey="vol" fill="var(--gold-400)" radius=${[3, 3, 0, 0]} />
                <//>
              <//>
            </div>
          <//>
        <//>

        <${Card}>
          <${CardHeader}><${CardTitle}>По организациям (всё время)<//><//>
          <${CardContent}>
            ${!byOrg.length ? html`<div style=${{ padding: '30px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>Нет данных<//>` : html`
              <div style=${{ width: '100%', height: Math.max(120, byOrg.length * 34) + 'px' }}>
                <${ResponsiveContainer}>
                  <${BarChart} data=${byOrg} layout="vertical" margin=${{ left: 8, right: 24, top: 4, bottom: 4 }}>
                    <${CartesianGrid} horizontal=${false} stroke="var(--border-subtle)" />
                    <${XAxis} type="number" tick=${{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} />
                    <${YAxis} type="category" dataKey="name" width=${110} tick=${{ fontSize: 12, fill: 'var(--text-secondary)' }} axisLine=${false} tickLine=${false} />
                    <${Tooltip} contentStyle=${{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }} formatter=${(v) => v.toFixed(1) + ' м³'} cursor=${{ fill: 'var(--bg-hover)' }} />
                    <${Bar} dataKey="vol" fill="var(--gold-400)" radius=${[0, 6, 6, 0]} barSize=${18} />
                  <//>
                <//>
              </div>
            `}
          <//>
        <//>

        <${Card}>
          <${CardHeader}><${CardTitle}>По форсункам (всё время)<//><//>
          <${CardContent}>
            ${!byNozzle.length ? html`<div style=${{ padding: '30px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>Нет данных<//>` : html`
              <div style=${{ width: '100%', height: Math.max(120, byNozzle.length * 30) + 'px' }}>
                <${ResponsiveContainer}>
                  <${BarChart} data=${byNozzle} layout="vertical" margin=${{ left: 8, right: 24, top: 4, bottom: 4 }}>
                    <${CartesianGrid} horizontal=${false} stroke="var(--border-subtle)" />
                    <${XAxis} type="number" tick=${{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} />
                    <${YAxis} type="category" dataKey="name" width=${100} tick=${{ fontSize: 12, fill: 'var(--text-secondary)' }} axisLine=${false} tickLine=${false} />
                    <${Tooltip} contentStyle=${{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }} formatter=${(v) => v.toFixed(1) + ' м³'} cursor=${{ fill: 'var(--bg-hover)' }} />
                    <${Bar} dataKey="vol" fill="var(--blue-500)" radius=${[0, 6, 6, 0]} barSize=${16} />
                  <//>
                <//>
              </div>
            `}
          <//>
        <//>

        <${Card}>
          <${CardHeader}><${CardTitle} subtitle="Сравнение по форсункам за 3 месяца">Сравнение по месяцам<//><//>
          <${CardContent}>
            ${!byMonth.length ? html`<div style=${{ padding: '30px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '13px' }}>Нет данных<//>` : html`
              <div style=${{ width: '100%', height: Math.max(160, byMonth.length * 40) + 'px' }}>
                <${ResponsiveContainer}>
                  <${BarChart} data=${byMonth} layout="vertical" margin=${{ left: 8, right: 24, top: 4, bottom: 4 }}>
                    <${CartesianGrid} horizontal=${false} stroke="var(--border-subtle)" />
                    <${XAxis} type="number" tick=${{ fontSize: 11, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} />
                    <${YAxis} type="category" dataKey="name" width=${100} tick=${{ fontSize: 12, fill: 'var(--text-secondary)' }} axisLine=${false} tickLine=${false} />
                    <${Tooltip} contentStyle=${{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }} formatter=${(v) => v.toFixed(1) + ' м³'} cursor=${{ fill: 'var(--bg-hover)' }} />
                    <${Legend} wrapperStyle=${{ fontSize: '11px' }} />
                    ${monthLabels.map((m, i) => html`<${Bar} key=${m} dataKey=${m} fill=${monthColors[i % monthColors.length]} radius=${[0, 4, 4, 0]} barSize=${10} />`)}
                  <//>
                <//>
              </div>
            `}
          <//>
        <//>
      </div>
    </div>
  `;
}

// ── Страница ────────────────────────────────────────────────────────────────────
export function DustJournalPage() {
  const data = useDustData();
  const [tab, setTab] = useState('journal');

  const monthVol = useMemo(() => {
    if (!data.logs.length) return 0;
    const vehicleById = Object.fromEntries(data.vehicles.map((v) => [v.id, v]));
    const monthStart = new Date().toISOString().slice(0, 7) + '-01';
    return data.logs.filter((l) => l.date >= monthStart).reduce((acc, l) => acc + computeVolume(l, vehicleById), 0);
  }, [data.logs, data.vehicles]);

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Журнал Пылеподавления<//>
          <div class="page-desc">Рейсы поливочных машин, техника и форсунки.<//>
        </div>
      </div>

      ${data.error && html`<div style=${{ color: 'var(--red-500)', fontSize: '13px', marginBottom: '12px' }}>Ошибка: ${data.error}<//>`}

      <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '18px' }}>
        <${KpiCard} label="Организации" value=${data.orgs.length} />
        <${KpiCard} label="Машины" value=${data.vehicles.length} />
        <${KpiCard} label="Форсунки" value=${data.nozzles.length} />
        <${KpiCard} label="Объём за месяц" value=${monthVol.toFixed(0)} unit="м³" />
      </div>

      <div style=${{ marginBottom: '16px' }}>
        <${Tabs}
          tabs=${[
            { value: 'journal', label: 'Журнал' },
            { value: 'fleet', label: 'Организации и техника' },
            { value: 'nozzles', label: 'Форсунки', badge: data.nozzles.length || undefined },
            { value: 'analytics', label: 'Аналитика' },
          ]}
          value=${tab} onChange=${setTab}
        />
      </div>

      ${data.loading ? html`<${Skeleton} height="300px" />` : html`
        ${tab === 'journal' && html`<${JournalTab} data=${data} onSaved=${data.reload} />`}
        ${tab === 'fleet' && html`<${FleetTab} data=${data} onSaved=${data.reload} />`}
        ${tab === 'nozzles' && html`<${NozzlesTab} data=${data} onSaved=${data.reload} />`}
        ${tab === 'analytics' && html`<${DustAnalyticsTab} data=${data} />`}
      `}
    </div>
  `;
}
