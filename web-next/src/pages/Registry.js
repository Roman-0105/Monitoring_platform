import React, { useEffect, useMemo, useState } from 'react';
import { Search, Plus, Database, Pencil, Trash2, History, X, Circle, Square, Diamond, Triangle, Hexagon } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { fetchAllRows } from '../lib/db-utils.js';
import { WP_TYPES } from '../lib/wp-types.js';
import { Button, Card, CardContent, Input, Select, Table, Dialog, Field } from '../components/ui.js';

const SHAPE_ICONS = { circle: Circle, square: Square, diamond: Diamond, triangle: Triangle, hexagon: Hexagon };

function WpTypeIcon({ type, size = 16 }) {
  const t = WP_TYPES[type] || WP_TYPES.other;
  const Cmp = SHAPE_ICONS[t.shape] || Circle;
  return html`<${Cmp} size=${size} style=${{ color: t.color, flexShrink: 0 }} />`;
}

const EMPTY_FORM = {
  name: '', code: '', coord_x: '', coord_y: '', lat: '', lng: '', elev_z: '',
  depth: '', aquifer: '', drill_company: '', drill_date_start: '', drill_date_end: '',
  filter_intervals: [], drill_intervals: [], casing_intervals: [],
  pump_model: '', pump_depth: '', pump_capacity: '', pump_head: '',
  notes: '',
};

function rowToForm(row) {
  return {
    name: row.name || '', code: row.code || '',
    coord_x: row.coord_x ?? '', coord_y: row.coord_y ?? '', lat: row.lat ?? '', lng: row.lng ?? '', elev_z: row.elev_z ?? '',
    depth: row.depth ?? '', aquifer: row.aquifer || '', drill_company: row.drill_company || '',
    drill_date_start: row.drill_date_start || '', drill_date_end: row.drill_date_end || '',
    filter_intervals: Array.isArray(row.filter_intervals) ? row.filter_intervals : [],
    drill_intervals: Array.isArray(row.drill_intervals) ? row.drill_intervals : [],
    casing_intervals: Array.isArray(row.casing_intervals) ? row.casing_intervals : [],
    pump_model: row.pump_model || '', pump_depth: row.pump_depth ?? '', pump_capacity: row.pump_capacity ?? '', pump_head: row.pump_head ?? '',
    notes: row.notes || '',
  };
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

function buildSaveRow(formType, form, existingId) {
  const isWell = formType === 'well_obs' || formType === 'well_exp';
  const isExp = formType === 'well_exp';
  const isElevType = isWell || formType === 'seep';

  const row = {
    wp_type: formType,
    name: form.name.trim(),
    code: form.code.trim() || null,
    coord_x: numOrNull(form.coord_x),
    coord_y: numOrNull(form.coord_y),
    lat: numOrNull(form.lat),
    lng: numOrNull(form.lng),
    notes: form.notes.trim() || null,
    active: true,
  };
  if (isElevType) row.elev_z = numOrNull(form.elev_z);
  if (isWell) {
    row.depth = numOrNull(form.depth);
    row.aquifer = form.aquifer.trim() || null;
    row.drill_company = form.drill_company.trim() || null;
    row.drill_date_start = form.drill_date_start || null;
    row.drill_date_end = form.drill_date_end || null;
    row.filter_intervals = cleanIntervals(form.filter_intervals);
    row.drill_intervals = cleanIntervals(form.drill_intervals);
    row.casing_intervals = cleanIntervals(form.casing_intervals);
  }
  if (isExp) {
    row.pump_model = form.pump_model.trim() || null;
    row.pump_depth = numOrNull(form.pump_depth);
    row.pump_capacity = numOrNull(form.pump_capacity);
    row.pump_head = numOrNull(form.pump_head);
  }
  if (existingId) row.id = existingId;
  return row;
}

function cleanIntervals(rows) {
  return rows
    .map((r) => ({ from: numOrNull(r.from), to: numOrNull(r.to), diameter: numOrNull(r.diameter) }))
    .filter((r) => r.from != null || r.to != null || r.diameter != null);
}

function paramSummary(w) {
  const parts = [];
  if (w.depth) parts.push(`H=${w.depth} м`);
  if (w.elev_z != null) parts.push(`Z=${w.elev_z} м`);
  if (w.aquifer) parts.push(w.aquifer);
  if (w.drill_company) parts.push(w.drill_company);
  if (Array.isArray(w.filter_intervals) && w.filter_intervals.length) {
    parts.push('фильтр: ' + w.filter_intervals.map((r) => `${r.from ?? '?'}–${r.to ?? '?'} м${r.diameter ? ' Ø' + r.diameter : ''}`).join(', '));
  }
  if (Array.isArray(w.drill_intervals) && w.drill_intervals.length) {
    parts.push('бур: ' + w.drill_intervals.map((r) => `${r.from ?? '?'}–${r.to ?? '?'} м${r.diameter ? ' Ø' + r.diameter : ''}`).join(', '));
  }
  if (w.pump_model) parts.push(`Насос: ${w.pump_model}`);
  if (w.pump_capacity) parts.push(`${w.pump_capacity} м³/ч`);
  return parts.join(' · ') || '—';
}

// ═════════════════════════ Мелкие компоненты ═════════════════════════

function RegKpiTile({ type, label, value }) {
  const t = WP_TYPES[type] || WP_TYPES.other;
  return html`
    <div class="card reg-kpi">
      <div class="reg-kpi-ico" style=${{ background: t.color + '1a', color: t.color }}><${WpTypeIcon} type=${type} size=${18} /></div>
      <div>
        <div class="reg-kpi-lbl">${label}</div>
        <div class="reg-kpi-val">${value}</div>
      </div>
    </div>
  `;
}

function TypeChips({ typeCounts, total, active, onChange }) {
  return html`
    <div class="reg-chips">
      <button type="button" class=${'reg-chip' + (!active ? ' active' : '')} onClick=${() => onChange('')}>Все <span class="reg-chip-count">${total}</span></button>
      ${Object.keys(WP_TYPES).map((t) => {
        const cnt = typeCounts[t] || 0;
        if (!cnt) return null;
        return html`
          <button key=${t} type="button" class=${'reg-chip' + (active === t ? ' active' : '')} onClick=${() => onChange(t)}>
            <${WpTypeIcon} type=${t} size=${13} /> ${WP_TYPES[t].short} <span class="reg-chip-count">${cnt}</span>
          </button>
        `;
      })}
    </div>
  `;
}

function TypeSelectorGrid({ onSelect }) {
  return html`
    <div>
      <div class="reg-type-hint">Выберите тип водопункта — форма заполнения адаптируется под него</div>
      <div class="reg-type-grid">
        ${Object.keys(WP_TYPES).map((t) => html`
          <button key=${t} type="button" class="reg-type-opt" onClick=${() => onSelect(t)}>
            <${WpTypeIcon} type=${t} size=${26} />
            <span class="reg-type-opt-lbl">${WP_TYPES[t].label}</span>
          </button>
        `)}
      </div>
    </div>
  `;
}

function IntervalTable({ rows, onChange }) {
  function update(i, field, val) { const next = rows.slice(); next[i] = { ...next[i], [field]: val }; onChange(next); }
  function add() { onChange([...rows, { from: '', to: '', diameter: '' }]); }
  function remove(i) { onChange(rows.filter((_, idx) => idx !== i)); }

  return html`
    <div class="reg-itbl">
      ${rows.length > 0 && html`<div class="reg-itbl-head"><span>От, м</span><span>До, м</span><span>Диаметр, мм</span><span></span></div>`}
      ${rows.map((r, i) => html`
        <div key=${i} class="reg-itbl-row">
          <${Input} value=${r.from} onChange=${(e) => update(i, 'from', e.target.value)} placeholder="0.0" />
          <${Input} value=${r.to} onChange=${(e) => update(i, 'to', e.target.value)} placeholder="0.0" />
          <${Input} value=${r.diameter} onChange=${(e) => update(i, 'diameter', e.target.value)} placeholder="168" />
          <button type="button" class="reg-itbl-del" title="Удалить" onClick=${() => remove(i)}>✕</button>
        </div>
      `)}
      <button type="button" class="reg-itbl-add" onClick=${add}>+ Добавить интервал</button>
    </div>
  `;
}

function RegistryFormBody({ formType, form, setForm }) {
  const isWell = formType === 'well_obs' || formType === 'well_exp';
  const isExp = formType === 'well_exp';
  const isElevType = isWell || formType === 'seep';
  const set = (patch) => setForm({ ...form, ...patch });

  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div class="field-section">
        <div class="section-label">Основные данные</div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <${Field} label="Наименование *"><${Input} value=${form.name} onChange=${(e) => set({ name: e.target.value })} placeholder="Скважина ПН-1" /><//>
          <${Field} label="Код / Шифр"><${Input} value=${form.code} onChange=${(e) => set({ code: e.target.value })} placeholder="ПН-1" /><//>
        </div>
      </div>

      <div class="field-section">
        <div class="section-label">Координаты местные (система карьера)</div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <${Field} label="X"><${Input} type="number" step="0.01" value=${form.coord_x} onChange=${(e) => set({ coord_x: e.target.value })} /><//>
          <${Field} label="Y"><${Input} type="number" step="0.01" value=${form.coord_y} onChange=${(e) => set({ coord_y: e.target.value })} /><//>
        </div>
      </div>

      <div class="field-section">
        <div class="section-label">Координаты WGS-84</div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <${Field} label="Широта (lat)"><${Input} type="number" step="0.000001" value=${form.lat} onChange=${(e) => set({ lat: e.target.value })} placeholder="52.488520" /><//>
          <${Field} label="Долгота (lng)"><${Input} type="number" step="0.000001" value=${form.lng} onChange=${(e) => set({ lng: e.target.value })} placeholder="69.711210" /><//>
        </div>
      </div>

      ${isElevType && html`
        <div class="field-section">
          <div class="section-label">Абсолютная отметка</div>
          <${Field} label="Абс. отметка (Z), м"><${Input} type="number" step="0.01" value=${form.elev_z} onChange=${(e) => set({ elev_z: e.target.value })} placeholder="245.60" /><//>
        </div>
      `}

      ${isWell && html`
        <${React.Fragment}>
          <div class="field-section">
            <div class="section-label">Общие параметры скважины</div>
            <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <${Field} label="Глубина скв., м"><${Input} type="number" step="0.1" value=${form.depth} onChange=${(e) => set({ depth: e.target.value })} placeholder="120.0" /><//>
              <${Field} label="Водоносный горизонт"><${Input} value=${form.aquifer} onChange=${(e) => set({ aquifer: e.target.value })} placeholder="Юрский в/г" /><//>
            </div>
          </div>
          <div class="field-section">
            <div class="section-label">Буровая компания</div>
            <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
              <${Field} label="Наименование компании"><${Input} value=${form.drill_company} onChange=${(e) => set({ drill_company: e.target.value })} placeholder="ООО «БурСервис»" /><//>
              <${Field} label="Начало бурения"><${Input} type="date" value=${form.drill_date_start} onChange=${(e) => set({ drill_date_start: e.target.value })} /><//>
              <${Field} label="Окончание бурения"><${Input} type="date" value=${form.drill_date_end} onChange=${(e) => set({ drill_date_end: e.target.value })} /><//>
            </div>
          </div>
          <div class="field-section">
            <div class="section-label">Интервалы фильтров</div>
            <${IntervalTable} rows=${form.filter_intervals} onChange=${(rows) => set({ filter_intervals: rows })} />
          </div>
          <div class="field-section">
            <div class="section-label">Диаметры бурения по интервалам</div>
            <${IntervalTable} rows=${form.drill_intervals} onChange=${(rows) => set({ drill_intervals: rows })} />
          </div>
          <div class="field-section">
            <div class="section-label">Обсадные трубы по интервалам</div>
            <${IntervalTable} rows=${form.casing_intervals} onChange=${(rows) => set({ casing_intervals: rows })} />
          </div>
        <//>
      `}

      ${isExp && html`
        <div class="field-section">
          <div class="section-label">Насосное оборудование</div>
          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '14px' }}>
            <${Field} label="Марка насоса"><${Input} value=${form.pump_model} onChange=${(e) => set({ pump_model: e.target.value })} placeholder="ЭЦВ 8-25-110" /><//>
            <${Field} label="Глубина уст., м"><${Input} type="number" step="0.1" value=${form.pump_depth} onChange=${(e) => set({ pump_depth: e.target.value })} placeholder="80.0" /><//>
            <${Field} label="Произв., м³/ч"><${Input} type="number" step="0.1" value=${form.pump_capacity} onChange=${(e) => set({ pump_capacity: e.target.value })} placeholder="25.0" /><//>
            <${Field} label="Напор, м"><${Input} type="number" step="0.1" value=${form.pump_head} onChange=${(e) => set({ pump_head: e.target.value })} placeholder="110.0" /><//>
          </div>
        </div>
      `}

      <div class="field-section">
        <${Field} label="Примечание"><${Input} value=${form.notes} onChange=${(e) => set({ notes: e.target.value })} placeholder="Дополнительная информация" /><//>
      </div>
    </div>
  `;
}

// ── Модалка истории замеров УПВ по скважине ────────────────────────
function WellLevelsModal({ well, onClose }) {
  const [levels, setLevels] = useState(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [depth, setDepth] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const { data, error } = await supabase.from('wp_well_levels').select('id, well_id, date, depth_to_water').eq('well_id', well.id).order('date', { ascending: false });
    setLevels(error ? [] : (data || []));
  }
  useEffect(() => { load(); }, [well.id]);

  async function add() {
    const d = numOrNull(depth);
    if (!date || d == null) { alert('Укажите дату и глубину до воды'); return; }
    setSaving(true);
    const { error } = await supabase.from('wp_well_levels').upsert({ well_id: well.id, date, depth_to_water: d });
    setSaving(false);
    if (error) { alert('Ошибка сохранения: ' + error.message); return; }
    setDepth('');
    load();
  }

  async function remove(id) {
    if (!confirm('Удалить этот замер?')) return;
    await supabase.from('wp_well_levels').delete().eq('id', id);
    load();
  }

  return html`
    <${Dialog} open=${true} onClose=${onClose} title=${`История замеров УПВ — ${well.name}`} width="560px">
      ${well.elev_z == null && html`
        <div class="reg-warn">Сначала укажите абс. отметку устья (Z) в карточке скважины — без неё глубину до воды не перевести в абсолютную отметку.</div>
      `}
      <div style=${{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '14px' }}>
        <${Field} label="Дата замера"><${Input} type="date" value=${date} onChange=${(e) => setDate(e.target.value)} /><//>
        <${Field} label="Глубина до воды, м"><${Input} type="number" step="0.01" value=${depth} onChange=${(e) => setDepth(e.target.value)} placeholder="12.45" /><//>
        <${Button} onClick=${add} disabled=${saving}>+ Добавить<//>
      </div>
      ${levels === null ? html`<div class="anl-empty">Загрузка…</div>` : !levels.length ? html`<div class="anl-empty">Замеров пока нет</div>` : html`
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Дата</th><th>Глубина, м</th><th>Абс. отметка, м</th><th></th></tr></thead>
            <tbody>
              ${levels.map((l, i) => {
                const d = parseFloat(l.depth_to_water);
                const elev = well.elev_z != null && !Number.isNaN(d) ? (well.elev_z - d).toFixed(2) : '—';
                return html`
                  <tr key=${l.id}>
                    <td>${l.date} ${i === 0 && html`<span class="reg-latest-tag">последний</span>`}</td>
                    <td class="mono">${Number.isNaN(d) ? '—' : d.toFixed(2)}</td>
                    <td class="mono" style=${{ color: 'var(--blue-500)', fontWeight: 700 }}>${elev}</td>
                    <td><${Button} variant="ghost" size="sm" icon onClick=${() => remove(l.id)}><${X} size=${13} style=${{ color: 'var(--red-500)' }} /><//></td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      `}
    <//>
  `;
}

// ═════════════════════════ Страница ═════════════════════════

export function RegistryPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [step, setStep] = useState(null); // null | 'select-type' | 'form'
  const [formType, setFormType] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [levelsWell, setLevelsWell] = useState(null);

  async function load() {
    setError(null);
    try {
      const data = await fetchAllRows('wp_registry', { order: 'name' });
      setItems(data);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  const typeCounts = useMemo(() => {
    const counts = {};
    (items || []).forEach((w) => { counts[w.wp_type] = (counts[w.wp_type] || 0) + 1; });
    return counts;
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return items.filter((w) => {
      if (typeFilter && w.wp_type !== typeFilter) return false;
      if (!q) return true;
      return (w.name || '').toLowerCase().includes(q) || (w.code || '').toLowerCase().includes(q) || (w.notes || '').toLowerCase().includes(q);
    });
  }, [items, query, typeFilter]);

  function openAdd() { setEditingId(null); setStep('select-type'); }
  function selectType(t) { setFormType(t); setForm(EMPTY_FORM); setStep('form'); }
  function openEdit(row) { setEditingId(row.id); setFormType(row.wp_type); setForm(rowToForm(row)); setStep('form'); }
  function closeModal() { setStep(null); }

  async function save() {
    if (!form.name.trim()) { alert('Введите наименование'); return; }
    setSaving(true);
    const row = buildSaveRow(formType, form, editingId);
    const { error: err } = await supabase.from('wp_registry').upsert(row);
    setSaving(false);
    if (err) { setError(err.message); return; }
    closeModal();
    load();
  }

  async function remove(row) {
    if (!confirm(`Удалить водопункт «${row.name || row.code}»?`)) return;
    const { error: err } = await supabase.from('wp_registry').delete().eq('id', row.id);
    if (err) { setError(err.message); return; }
    load();
  }

  const columns = [
    { key: 'status', header: '', width: '20px', render: (w) => html`<span class=${'reg-status-dot' + (w.active !== false ? ' on' : '')} title=${w.active !== false ? 'Активен' : 'Неактивен'} />` },
    { key: 'code', header: 'Код', width: '90px', render: (w) => w.code ? html`<span class="reg-code">${w.code}</span>` : html`<span style=${{ color: 'var(--text-tertiary)' }}>—</span>` },
    { key: 'name', header: 'Наименование', render: (w) => html`
      <div>
        <div style=${{ fontWeight: 600 }}>${w.name || '—'}</div>
        ${w.notes && html`<div class="reg-notes-preview">${w.notes.length > 60 ? w.notes.slice(0, 60) + '…' : w.notes}</div>`}
      </div>
    ` },
    { key: 'type', header: 'Тип', width: '170px', render: (w) => html`<div class="reg-type-cell"><${WpTypeIcon} type=${w.wp_type} size=${15} /> ${(WP_TYPES[w.wp_type] || WP_TYPES.other).short}</div>` },
    { key: 'coords', header: 'Координаты', width: '160px', render: (w) => {
      const hasLocal = w.coord_x != null || w.coord_y != null;
      const hasWgs = w.lat != null || w.lng != null;
      if (!hasLocal && !hasWgs) return html`<span style=${{ color: 'var(--text-tertiary)' }}>—</span>`;
      return html`
        <div class="reg-coords">
          ${hasLocal && html`<div>X: ${w.coord_x != null ? Number(w.coord_x).toFixed(2) : '—'} · Y: ${w.coord_y != null ? Number(w.coord_y).toFixed(2) : '—'}</div>`}
          ${hasWgs && html`<div class="reg-coords-wgs">${w.lat != null ? Number(w.lat).toFixed(5) : '—'}, ${w.lng != null ? Number(w.lng).toFixed(5) : '—'}</div>`}
        </div>
      `;
    } },
    { key: 'params', header: 'Параметры', render: (w) => html`<span class="reg-params">${paramSummary(w)}</span>` },
    {
      key: 'actions', header: '', width: '150px',
      render: (w) => html`
        <div style=${{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
          ${(w.wp_type === 'well_obs' || w.wp_type === 'well_exp') && html`<${Button} variant="ghost" size="sm" icon title="История УПВ" onClick=${() => setLevelsWell(w)}><${History} size=${14} /><//>`}
          <${Button} variant="ghost" size="sm" icon title="Изменить" onClick=${() => openEdit(w)}><${Pencil} size=${14} /><//>
          <${Button} variant="ghost" size="sm" icon title="Удалить" onClick=${() => remove(w)}><${Trash2} size=${14} style=${{ color: 'var(--red-500)' }} /><//>
        </div>
      `,
    },
  ];

  const dialogTitle = step === 'select-type' ? 'Добавить водопункт'
    : editingId ? html`<span style=${{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><${WpTypeIcon} type=${formType} size=${16} /> Редактировать водопункт<//>`
    : html`<span style=${{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><${WpTypeIcon} type=${formType} size=${16} /> ${(WP_TYPES[formType] || WP_TYPES.other).label}<//>`;

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Реестр водопунктов</div>
          <div class="page-desc">Единый справочник скважин, зумпфов, накопителей и водопроявлений — ${items ? items.length : '…'} записей.</div>
        </div>
        <${Button} onClick=${openAdd}><${Plus} size=${16} /> Добавить водопункт<//>
      </div>

      ${error && html`<div style=${{ color: 'var(--red-500)', fontSize: '13px', marginBottom: '12px' }}>Ошибка: ${error}</div>`}

      <div class="grid grid-4" style=${{ marginBottom: '16px' }}>
        <${RegKpiTile} type="well_obs" label="Набл. скважины" value=${typeCounts.well_obs || 0} />
        <${RegKpiTile} type="well_exp" label="Эксп. скважины" value=${typeCounts.well_exp || 0} />
        <${RegKpiTile} type="sump" label="Зумпфы" value=${typeCounts.sump || 0} />
        <${RegKpiTile} type="pond" label="Накопители и прочее" value=${(typeCounts.pond || 0) + (typeCounts.seep || 0) + (typeCounts.ditch || 0) + (typeCounts.other || 0)} />
      </div>

      <${Card}>
        <div class="reg-toolbar">
          <div style=${{ maxWidth: '280px', flex: 1, minWidth: '180px' }}>
            <${Input} icon=${html`<${Search} size=${15} />`} placeholder="Поиск по коду, названию или примечанию…" value=${query} onChange=${(e) => setQuery(e.target.value)} />
          </div>
          <${TypeChips} typeCounts=${typeCounts} total=${items ? items.length : 0} active=${typeFilter} onChange=${setTypeFilter} />
        </div>
        <${CardContent} tight>
          <${Table}
            columns=${columns}
            rows=${filtered}
            rowKey=${(w) => w.id}
            loading=${items === null}
            emptyIcon=${html`<${Database} size=${40} />`}
            emptyTitle=${typeFilter || query ? 'Ничего не найдено' : 'Водопунктов нет'}
            emptyDescription=${typeFilter || query ? 'Попробуйте изменить поиск или фильтр по типу.' : 'Нажмите «Добавить водопункт», чтобы начать заполнять реестр.'}
          />
        <//>
      <//>

      <${Dialog}
        open=${step !== null}
        onClose=${closeModal}
        title=${dialogTitle}
        width="720px"
        footer=${step === 'form' && html`
          <${Button} variant="outline" onClick=${closeModal}>Отмена<//>
          <${Button} onClick=${save} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить'}<//>
        `}
      >
        ${step === 'select-type' && html`<${TypeSelectorGrid} onSelect=${selectType} />`}
        ${step === 'form' && html`<${RegistryFormBody} formType=${formType} form=${form} setForm=${setForm} />`}
      <//>

      ${levelsWell && html`<${WellLevelsModal} well=${levelsWell} onClose=${() => setLevelsWell(null)} />`}
    </div>
  `;
}
