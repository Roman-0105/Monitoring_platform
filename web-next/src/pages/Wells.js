import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, GitCommitHorizontal, Pencil, Trash2, Radio, Download, Upload, FileSpreadsheet, ZoomIn, ZoomOut, Maximize2, X } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { fetchAllRows } from '../lib/db-utils.js';
import { WALL_OPTIONS } from '../lib/point-status.js';
import { sk42ToWgs, CALC_ZONE, CALC_OFF } from '../lib/coord-calc.js';
import { exportWellsCsv, exportWellsXlsx } from '../lib/wells-export.js';
import { downloadVwpTemplate, parseVwpImportFile } from '../lib/vwp-import.js';
import { getQuarryBounds } from '../lib/quarries.js';
import { getSchemesForQuarry, getCurrentOrLatestScheme } from '../lib/schemes.js';
import { smoothPath, formatMonitoringDate, shortMonitoringDate, formatMonitoringDateTime, shortMonitoringDateTime } from '../lib/analytics-core.js';
import { Button, Card, CardHeader, CardTitle, CardContent, Input, Select, Table, Badge, Dialog, Field, Tabs, EmptyState } from '../components/ui.js';

const WELL_STATUS_OPTIONS = ['Активная', 'Иссякает', 'Сухая'];
const WELL_STATUS_BADGE = { 'Активная': 'success', 'Иссякает': 'warning', 'Сухая': 'danger' };
const QUARRY_OPTIONS = ['ЮРГ', 'СРГ'];

const EMPTY_FORM = {
  name: '', well_type: 'drainage', status: 'Активная', quarry: '', quarry_section: '', domain: '',
  depth: '', azimuth: '', inclination: '', drill_diameter: '', casing: '', drill_date: '', has_wellhead: false, flow_after_drill: '',
  x_local: '', y_local: '', z_local: '', sensors: [],
};

function genId() { return 'well_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function genSensorId() { return 'sensor_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

function rowToForm(row) {
  return {
    name: row.name || '', well_type: row.well_type || 'drainage', status: row.status || 'Активная',
    quarry: row.quarry || '', quarry_section: row.quarry_section || '', domain: row.domain || '',
    depth: row.depth ?? '', azimuth: row.azimuth ?? '', inclination: row.inclination ?? '',
    drill_diameter: row.drill_diameter ?? '', casing: row.casing || '', drill_date: row.drill_date || '',
    has_wellhead: !!row.has_wellhead, flow_after_drill: row.flow_after_drill ?? '',
    x_local: row.x_local ?? '', y_local: row.y_local ?? '', z_local: row.z_local ?? '',
    sensors: Array.isArray(row.sensors) ? row.sensors : [],
  };
}

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

// Значение по умолчанию для <input type="datetime-local"> — локальное время,
// а не UTC (в отличие от toISOString()), т.к. VWP-показания вводятся почасово
// и должны по умолчанию указывать на текущий локальный час.
function nowLocalDatetimeInput() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
// "YYYY-MM-DDTHH:mm" из datetime-local → "YYYY-MM-DDTHH:mm:00" для хранения.
function toStorageDateTime(v) {
  if (!v) return '';
  return v.length === 16 ? v + ':00' : v;
}

// Местные X/Y → WGS-84, тем же путём, что и в WpMap (SK-42 как промежуточная система)
function localToWgs(x, y) {
  try {
    const sk42x = numOrNull(y) + CALC_OFF;
    const sk42yLocal = numOrNull(x);
    if (sk42x == null || sk42yLocal == null) return null;
    return sk42ToWgs(sk42x, sk42yLocal, CALC_ZONE);
  } catch { return null; }
}

function buildSaveRow(form, existingId) {
  const row = {
    id: existingId || genId(),
    name: form.name.trim(),
    well_type: form.well_type,
    status: form.status,
    quarry: form.quarry || null,
    quarry_section: form.quarry_section || null,
    domain: form.domain.trim() || null,
    depth: numOrNull(form.depth),
    azimuth: numOrNull(form.azimuth),
    inclination: numOrNull(form.inclination),
    drill_diameter: numOrNull(form.drill_diameter),
    casing: form.casing.trim() || null,
    drill_date: form.drill_date || null,
    has_wellhead: !!form.has_wellhead,
    flow_after_drill: numOrNull(form.flow_after_drill),
    x_local: numOrNull(form.x_local),
    y_local: numOrNull(form.y_local),
    z_local: numOrNull(form.z_local),
    sensors: form.sensors.map((s) => ({ ...s, connectedToLogger: !!(s.loggerSN && String(s.loggerSN).trim()) })),
  };
  const wgs = (row.x_local != null && row.y_local != null) ? localToWgs(row.x_local, row.y_local) : null;
  row.lat = wgs ? wgs.lat : null;
  row.lon = wgs ? wgs.lon : null;
  if (!existingId) row.created_at = new Date().toISOString();
  return row;
}

// ═════════════════════════ Мелкие компоненты ═════════════════════════

function SensorsTable({ sensors, onChange }) {
  function update(i, field, val) { const next = sensors.slice(); next[i] = { ...next[i], [field]: val }; onChange(next); }
  function add() { onChange([...sensors, { id: genSensorId(), name: '', depth: '', serialNumber: '', loggerSN: '' }]); }
  function remove(i) { onChange(sensors.filter((_, idx) => idx !== i)); }

  return html`
    <div class="reg-itbl">
      ${sensors.length > 0 && html`<div class="wells-sensor-head"><span>Название</span><span>Глубина, м</span><span>S/N датчика</span><span>S/N логгера</span><span></span></div>`}
      ${sensors.map((s, i) => html`
        <div key=${s.id || i} class="wells-sensor-row">
          <${Input} value=${s.name} onChange=${(e) => update(i, 'name', e.target.value)} placeholder="VWP-1" />
          <${Input} type="number" step="0.1" value=${s.depth} onChange=${(e) => update(i, 'depth', e.target.value)} placeholder="10" />
          <${Input} value=${s.serialNumber} onChange=${(e) => update(i, 'serialNumber', e.target.value)} placeholder="—" />
          <${Input} value=${s.loggerSN} onChange=${(e) => update(i, 'loggerSN', e.target.value)} placeholder="нет связи" />
          <button type="button" class="reg-itbl-del" title="Удалить" onClick=${() => remove(i)}>✕</button>
        </div>
      `)}
      <button type="button" class="reg-itbl-add" onClick=${add}>+ Добавить датчик</button>
    </div>
  `;
}

function WellFormBody({ form, setForm }) {
  const isPiezo = form.well_type === 'piezometric';
  const set = (patch) => setForm({ ...form, ...patch });
  const wgs = (form.x_local !== '' && form.y_local !== '') ? localToWgs(form.x_local, form.y_local) : null;

  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <div class="field-section">
        <div class="section-label">Основные данные</div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <${Field} label="Тип скважины">
            <${Select} value=${form.well_type} onChange=${(e) => set({ well_type: e.target.value })}>
              <option value="drainage">Дренажная</option>
              <option value="piezometric">Пьезометрическая (VWP)</option>
            <//>
          <//>
          <${Field} label="Название *"><${Input} value=${form.name} onChange=${(e) => set({ name: e.target.value })} placeholder="HBS-11" /><//>
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
          <${Field} label="Карьер">
            <${Select} value=${form.quarry} onChange=${(e) => set({ quarry: e.target.value })}>
              <option value="">—</option>
              ${QUARRY_OPTIONS.map((q) => html`<option key=${q} value=${q}>${q}<//>`)}
            <//>
          <//>
          <${Field} label="Участок карьера">
            <${Select} value=${form.quarry_section} onChange=${(e) => set({ quarry_section: e.target.value })}>
              <option value="">—</option>
              ${WALL_OPTIONS.map((s) => html`<option key=${s} value=${s}>${s}<//>`)}
            <//>
          <//>
          <${Field} label="Домен"><${Input} value=${form.domain} onChange=${(e) => set({ domain: e.target.value })} placeholder="5" /><//>
        </div>
      </div>

      <div class="field-section">
        <div class="section-label">Статус</div>
        <${Select} value=${form.status} onChange=${(e) => set({ status: e.target.value })} style=${{ maxWidth: '220px' }}>
          ${WELL_STATUS_OPTIONS.map((s) => html`<option key=${s} value=${s}>${s}<//>`)}
        <//>
      </div>

      <div class="field-section">
        <div class="section-label">Параметры бурения</div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>
          <${Field} label="Глубина, м"><${Input} type="number" step="0.1" value=${form.depth} onChange=${(e) => set({ depth: e.target.value })} /><//>
          <${Field} label="Азимут, °"><${Input} type="number" step="1" value=${form.azimuth} onChange=${(e) => set({ azimuth: e.target.value })} /><//>
          <${Field} label="Наклон, ° (справочно)"><${Input} type="number" step="0.5" value=${form.inclination} onChange=${(e) => set({ inclination: e.target.value })} /><//>
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '14px', alignItems: 'end' }}>
          <${Field} label="Диаметр, мм"><${Input} type="number" step="1" value=${form.drill_diameter} onChange=${(e) => set({ drill_diameter: e.target.value })} /><//>
          <${Field} label="Обсадка"><${Input} value=${form.casing} onChange=${(e) => set({ casing: e.target.value })} placeholder="Нет" /><//>
          <${Field} label="Дата бурения"><${Input} type="date" value=${form.drill_date} onChange=${(e) => set({ drill_date: e.target.value })} /><//>
          <${Field} label="Q после бурения, м³/ч"><${Input} type="number" step="0.01" value=${form.flow_after_drill} onChange=${(e) => set({ flow_after_drill: e.target.value })} /><//>
        </div>
        <label style=${{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', fontSize: '13px', cursor: 'pointer' }}>
          <input type="checkbox" checked=${form.has_wellhead} onChange=${(e) => set({ has_wellhead: e.target.checked })} />
          Оголовок установлен
        </label>
      </div>

      <div class="field-section">
        <div class="section-label">Координаты местные (система карьера)</div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
          <${Field} label="X"><${Input} type="number" step="0.01" value=${form.x_local} onChange=${(e) => set({ x_local: e.target.value })} /><//>
          <${Field} label="Y"><${Input} type="number" step="0.01" value=${form.y_local} onChange=${(e) => set({ y_local: e.target.value })} /><//>
          <${Field} label="Z"><${Input} type="number" step="0.01" value=${form.z_local} onChange=${(e) => set({ z_local: e.target.value })} /><//>
        </div>
        <div class="wells-wgs-hint">
          WGS-84 (автоматически): ${wgs ? `${wgs.lat.toFixed(6)}, ${wgs.lon.toFixed(6)}` : '—'}
        </div>
      </div>

      ${isPiezo && html`
        <div class="field-section">
          <div class="section-label">Датчики VWP</div>
          <${SensorsTable} sensors=${form.sensors} onChange=${(sensors) => set({ sensors })} />
        </div>
      `}
    </div>
  `;
}

// ═════════════════════════ Вкладка «Реестр» ═════════════════════════

function WellsRegistryTab({ quarry, items, measByWell, openAdd, openEdit, remove }) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const typeCounts = useMemo(() => {
    const c = { drainage: 0, piezometric: 0 };
    (items || []).forEach((w) => { c[w.well_type] = (c[w.well_type] || 0) + 1; });
    return c;
  }, [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return items.filter((w) => {
      if (typeFilter && w.well_type !== typeFilter) return false;
      if (!q) return true;
      return (w.name || '').toLowerCase().includes(q) || (w.domain || '').toLowerCase().includes(q);
    });
  }, [items, query, typeFilter]);

  function lastFlow(wellId) {
    const arr = measByWell[wellId];
    if (!arr || !arr.length) return null;
    return arr.reduce((latest, m) => (!latest || (m.measurement_date || '') > (latest.measurement_date || '')) ? m : latest, null);
  }

  const columns = [
    { key: 'type', header: 'Тип', width: '130px', render: (w) => html`<${Badge} variant=${w.well_type === 'piezometric' ? 'accent' : 'success'}>${w.well_type === 'piezometric' ? 'Пьезометр.' : 'Дренажная'}<//>` },
    { key: 'name', header: 'Название', render: (w) => html`<span style=${{ fontWeight: 600 }}>${w.name}</span>` },
    { key: 'quarry', header: 'Карьер', width: '80px', render: (w) => w.quarry || '—' },
    { key: 'section', header: 'Участок', width: '130px', render: (w) => html`<span style=${{ fontSize: '12px' }}>${w.quarry_section || '—'}</span>` },
    { key: 'status', header: 'Статус', width: '100px', render: (w) => html`<${Badge} variant=${WELL_STATUS_BADGE[w.status] || 'default'}>${w.status || '—'}<//>` },
    { key: 'depth', header: 'Глубина, м', width: '90px', render: (w) => html`<span class="mono">${w.depth != null ? Number(w.depth).toFixed(1) : '—'}</span>` },
    { key: 'drill_date', header: 'Дата бурения', width: '100px', render: (w) => w.drill_date || '—' },
    { key: 'lastq', header: 'Дебит (посл.), м³/ч', width: '120px', render: (w) => { const lm = lastFlow(w.id); return lm && lm.flow_rate != null ? html`<span class="mono">${Number(lm.flow_rate).toFixed(2)}</span>` : html`<span style=${{ color: 'var(--text-tertiary)' }}>—</span>`; } },
    { key: 'sensors', header: 'Датчики', width: '90px', render: (w) => {
      if (!Array.isArray(w.sensors) || !w.sensors.length) return '—';
      const connected = w.sensors.filter((s) => s.connectedToLogger).length;
      return html`<${Badge}><${Radio} size=${11} /> ${w.sensors.length}<//>${w.well_type === 'piezometric' && html`<div style=${{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>${connected} подкл.</div>`}`;
    } },
    {
      key: 'actions', header: '', width: '90px',
      render: (w) => html`
        <div style=${{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
          <${Button} variant="ghost" size="sm" icon title="Изменить" onClick=${() => openEdit(w)}><${Pencil} size=${14} /><//>
          <${Button} variant="ghost" size="sm" icon title="Удалить" onClick=${() => remove(w)}><${Trash2} size=${14} style=${{ color: 'var(--red-500)' }} /><//>
        </div>
      `,
    },
  ];

  return html`
    <div>
      <div class="page-header">
        <div style=${{ fontSize: '13px', color: 'var(--text-secondary)' }}>${items ? items.length : '…'} записей (${quarry})</div>
        <div style=${{ display: 'flex', gap: '8px' }}>
          <${Button} variant="outline" onClick=${() => exportWellsCsv(filtered, measByWell)} disabled=${!filtered.length}><${Download} size=${15} /> CSV<//>
          <${Button} variant="outline" onClick=${() => exportWellsXlsx(filtered, measByWell)} disabled=${!filtered.length}><${FileSpreadsheet} size=${15} /> Excel<//>
          <${Button} onClick=${openAdd}><${Plus} size=${16} /> Добавить скважину<//>
        </div>
      </div>

      <${Card}>
        <div class="reg-toolbar">
          <div style=${{ maxWidth: '280px', flex: 1, minWidth: '180px' }}>
            <${Input} icon=${html`<${Search} size=${15} />`} placeholder="Поиск по названию или домену…" value=${query} onChange=${(e) => setQuery(e.target.value)} />
          </div>
          <div class="reg-chips">
            <button type="button" class=${'reg-chip' + (!typeFilter ? ' active' : '')} onClick=${() => setTypeFilter('')}>Все <span class="reg-chip-count">${items ? items.length : 0}</span></button>
            <button type="button" class=${'reg-chip' + (typeFilter === 'drainage' ? ' active' : '')} onClick=${() => setTypeFilter('drainage')}>Дренажная <span class="reg-chip-count">${typeCounts.drainage || 0}</span></button>
            <button type="button" class=${'reg-chip' + (typeFilter === 'piezometric' ? ' active' : '')} onClick=${() => setTypeFilter('piezometric')}>Пьезометрическая <span class="reg-chip-count">${typeCounts.piezometric || 0}</span></button>
          </div>
        </div>
        <${CardContent} tight>
          <${Table}
            columns=${columns}
            rows=${filtered}
            rowKey=${(w) => w.id}
            loading=${items === null}
            emptyIcon=${html`<${GitCommitHorizontal} size=${40} />`}
            emptyTitle="Скважин нет"
            emptyDescription="Нажмите «Добавить скважину», чтобы начать заполнять реестр."
          />
        <//>
      <//>
    </div>
  `;
}

// ═════════════════════════ Вкладка «Скважина» ═════════════════════════

const WELL_STATUS_HEX = { 'Активная': '#2F8F52', 'Иссякает': '#C08420', 'Сухая': '#B5301B' };
const DETAIL_ZOOM_MIN = 0.3, DETAIL_ZOOM_MAX = 8;

function xyToPixelW(x, y, bounds, imgW, imgH) {
  return { px: (x - bounds.xMin) / (bounds.xMax - bounds.xMin) * imgW, py: (bounds.yMax - y) / (bounds.yMax - bounds.yMin) * imgH };
}
function pixelToXYW(px, py, bounds, imgW, imgH) {
  return { x: bounds.xMin + (px / imgW) * (bounds.xMax - bounds.xMin), y: bounds.yMax - (py / imgH) * (bounds.yMax - bounds.yMin) };
}
function clampW(v, min, max) { return Math.max(min, Math.min(max, v)); }

// Конец ствола в плане (2D) — азимут + глубина; наклон, как и в старом приложении, справочный и на проекцию не влияет.
function wellShaftEnd(w) {
  if (w.azimuth == null || w.depth == null || w.x_local == null || w.y_local == null) return null;
  const az = (w.azimuth * Math.PI) / 180;
  return { x: w.x_local + w.depth * Math.sin(az), y: w.y_local + w.depth * Math.cos(az) };
}

function drawWellMarkers(ctx, wells, bounds, imgW, imgH, scale, selectedId, hoverId) {
  wells.forEach((w) => {
    if (w.x_local == null || w.y_local == null) return;
    const pos = xyToPixelW(w.x_local, w.y_local, bounds, imgW, imgH);
    const color = WELL_STATUS_HEX[w.status] || '#857A6B';
    const isPiezo = w.well_type === 'piezometric';
    const isSel = w.id === selectedId, isHover = w.id === hoverId;

    const end = wellShaftEnd(w);
    if (end) {
      const endPos = xyToPixelW(end.x, end.y, bounds, imgW, imgH);
      ctx.beginPath();
      ctx.moveTo(pos.px, pos.py);
      ctx.lineTo(endPos.px, endPos.py);
      ctx.strokeStyle = color;
      ctx.lineWidth = (isSel ? 2.4 : 1.6) / scale;
      if (isPiezo) ctx.setLineDash([4 / scale, 3 / scale]); else ctx.setLineDash([]);
      ctx.globalAlpha = isSel ? 1 : 0.7;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      if (isPiezo && Array.isArray(w.sensors) && w.depth) {
        w.sensors.forEach((sn) => {
          const d = parseFloat(sn.depth);
          if (Number.isNaN(d)) return;
          const frac = clampW(d / w.depth, 0, 1);
          const sx = w.x_local + (end.x - w.x_local) * frac, sy = w.y_local + (end.y - w.y_local) * frac;
          const sp = xyToPixelW(sx, sy, bounds, imgW, imgH);
          ctx.beginPath(); ctx.arc(sp.px, sp.py, 3 / scale, 0, Math.PI * 2);
          ctx.fillStyle = sn.connectedToLogger ? '#2F8F52' : '#A79E90';
          ctx.fill();
        });
      }
    }

    const R = (isSel ? 9 : isHover ? 8 : 6.5) / scale;
    ctx.beginPath(); ctx.arc(pos.px, pos.py, R * 1.7, 0, Math.PI * 2);
    ctx.fillStyle = color + '30'; ctx.fill();
    ctx.beginPath();
    if (isPiezo) ctx.rect(pos.px - R * 0.85, pos.py - R * 0.85, R * 1.7, R * 1.7);
    else ctx.arc(pos.px, pos.py, R, 0, Math.PI * 2);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = isSel ? '#211E19' : 'rgba(255,255,255,0.9)';
    ctx.lineWidth = (isSel ? 2.2 : 1.5) / scale;
    ctx.stroke();
  });
}

function findWellAt(imgX, imgY, wells, bounds, imgW, imgH, scale) {
  for (let i = wells.length - 1; i >= 0; i--) {
    const w = wells[i];
    if (w.x_local == null || w.y_local == null) continue;
    const pos = xyToPixelW(w.x_local, w.y_local, bounds, imgW, imgH);
    const dx = imgX - pos.px, dy = imgY - pos.py;
    if (Math.sqrt(dx * dx + dy * dy) <= 10 / scale) return w;
  }
  return null;
}

function WellSchemeMap({ quarry, wells, selectedId, onSelect }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const st = useRef({ scale: 1, offX: 0, offY: 0, scaleT: 1, offXT: 0, offYT: 0, animId: null, img: null, bounds: null, wells: [], selectedId: null, hoverId: null, dragging: false, dragStartX: 0, dragStartY: 0, downX: 0, downY: 0, moved: false });
  const [status, setStatus] = useState('loading');
  const [hover, setHover] = useState(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const s = st.current;
    if (!canvas || !s.img) return;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(s.offX, s.offY);
    ctx.scale(s.scale, s.scale);
    ctx.drawImage(s.img, 0, 0);
    drawWellMarkers(ctx, s.wells, s.bounds, s.img.width, s.img.height, s.scale, s.selectedId, s.hoverId);
    ctx.restore();
  }, []);

  const startAnim = useCallback(() => {
    const s = st.current;
    if (s.animId) return;
    const LERP = 0.18, EPS_S = 0.0005, EPS_O = 0.3;
    function tick() {
      s.scale += (s.scaleT - s.scale) * LERP;
      s.offX += (s.offXT - s.offX) * LERP;
      s.offY += (s.offYT - s.offY) * LERP;
      draw();
      const done = Math.abs(s.scaleT - s.scale) < EPS_S && Math.abs(s.offXT - s.offX) < EPS_O && Math.abs(s.offYT - s.offY) < EPS_O;
      if (!done) { s.animId = requestAnimationFrame(tick); } else { s.scale = s.scaleT; s.offX = s.offXT; s.offY = s.offYT; draw(); s.animId = null; }
    }
    s.animId = requestAnimationFrame(tick);
  }, [draw]);

  const setTarget = useCallback((newScale, newOffX, newOffY) => {
    const s = st.current;
    s.scaleT = clampW(newScale, DETAIL_ZOOM_MIN, DETAIL_ZOOM_MAX);
    s.offXT = newOffX; s.offYT = newOffY;
    startAnim();
  }, [startAnim]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      const [bounds, schemesList] = await Promise.all([getQuarryBounds(quarry), getSchemesForQuarry(quarry)]);
      if (cancelled) return;
      st.current.bounds = bounds;
      const active = getCurrentOrLatestScheme(schemesList);
      if (!active) { setStatus('no-scheme'); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (cancelled) return;
        st.current.img = img;
        const container = containerRef.current;
        const fitScale = container ? Math.min(container.clientWidth / img.width, container.clientHeight / img.height) : 1;
        st.current.scale = fitScale > 0 ? Math.min(DETAIL_ZOOM_MAX, fitScale) : 1;
        st.current.offX = container ? (container.clientWidth - img.width * st.current.scale) / 2 : 0;
        st.current.offY = container ? (container.clientHeight - img.height * st.current.scale) / 2 : 0;
        st.current.scaleT = st.current.scale; st.current.offXT = st.current.offX; st.current.offYT = st.current.offY;
        setStatus('ready');
        // Канвас уже смонтирован (status был 'loading'), но его размер выставляется
        // отдельным resize-эффектом только при маунте/ресайзе контейнера — без явного
        // draw() здесь первая отрисовка карты откладывается до следующего чужого триггера.
        requestAnimationFrame(() => {
          const canvas = canvasRef.current;
          const container = containerRef.current;
          if (canvas && container) { canvas.width = container.clientWidth; canvas.height = container.clientHeight; }
          draw();
        });
      };
      img.onerror = () => setStatus('no-scheme');
      img.src = active.url;
    })();
    return () => { cancelled = true; };
  }, [quarry, draw]);

  useEffect(() => { st.current.wells = wells; st.current.selectedId = selectedId; draw(); }, [wells, selectedId, draw]);

  useEffect(() => {
    const canvas = canvasRef.current, container = containerRef.current;
    if (!canvas || !container) return;
    function resize() { canvas.width = container.clientWidth; canvas.height = container.clientHeight; draw(); }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    function onWheel(e) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const s = st.current;
      const delta = e.deltaY > 0 ? 0.85 : 1.18;
      const newScale = clampW(s.scaleT * delta, DETAIL_ZOOM_MIN, DETAIL_ZOOM_MAX);
      setTarget(newScale, mx - (mx - s.offXT) * (newScale / s.scaleT), my - (my - s.offYT) * (newScale / s.scaleT));
    }
    function onDown(e) {
      const s = st.current;
      if (s.animId) { cancelAnimationFrame(s.animId); s.animId = null; }
      s.scale = s.scaleT; s.offX = s.offXT; s.offY = s.offYT;
      s.dragging = true; s.moved = false;
      s.dragStartX = e.clientX - s.offX; s.dragStartY = e.clientY - s.offY;
      s.downX = e.clientX; s.downY = e.clientY;
      canvas.style.cursor = 'grabbing';
    }
    function onMove(e) {
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const s = st.current;
      if (s.dragging) {
        if (Math.abs(e.clientX - s.downX) > 3 || Math.abs(e.clientY - s.downY) > 3) s.moved = true;
        s.offX = e.clientX - s.dragStartX; s.offY = e.clientY - s.dragStartY;
        s.offXT = s.offX; s.offYT = s.offY;
        draw();
        return;
      }
      if (s.img && s.bounds) {
        const imgX = (cx - s.offX) / s.scale, imgY = (cy - s.offY) / s.scale;
        const w = findWellAt(imgX, imgY, s.wells, s.bounds, s.img.width, s.img.height, s.scale);
        s.hoverId = w ? w.id : null;
        setHover(w ? { item: w, x: e.clientX, y: e.clientY } : null);
        draw();
      }
    }
    function onUp(e) {
      const s = st.current;
      s.dragging = false;
      canvas.style.cursor = 'grab';
      if (s.moved) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      if (!s.img || !s.bounds) return;
      const imgX = (cx - s.offX) / s.scale, imgY = (cy - s.offY) / s.scale;
      const w = findWellAt(imgX, imgY, s.wells, s.bounds, s.img.width, s.img.height, s.scale);
      onSelect(w ? w.id : null);
    }

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.style.cursor = 'grab';
    return () => {
      ro.disconnect();
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draw, setTarget, onSelect]);

  function zoomBy(mult) {
    const s = st.current, canvas = canvasRef.current;
    if (!canvas) return;
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const newScale = clampW(s.scaleT * mult, DETAIL_ZOOM_MIN, DETAIL_ZOOM_MAX);
    setTarget(newScale, cx - (cx - s.offXT) * (newScale / s.scaleT), cy - (cy - s.offYT) * (newScale / s.scaleT));
  }
  function resetView() {
    const s = st.current, container = containerRef.current;
    if (!s.img || !container) return;
    const fitScale = Math.min(container.clientWidth / s.img.width, container.clientHeight / s.img.height);
    const scale = fitScale > 0 ? Math.min(DETAIL_ZOOM_MAX, fitScale) : 1;
    setTarget(scale, (container.clientWidth - s.img.width * scale) / 2, (container.clientHeight - s.img.height * scale) / 2);
  }

  return html`
    <div ref=${containerRef} style=${{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)' }}>
      ${status === 'loading' && html`<div class="anl-empty" style=${{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Загрузка схемы…</div>`}
      ${status === 'no-scheme' && html`<div class="anl-empty" style=${{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Схема карьера не загружена</div>`}
      <canvas ref=${canvasRef} style=${{ display: status === 'ready' ? 'block' : 'none', width: '100%', height: '100%' }} />
      ${status === 'ready' && html`
        <div style=${{ position: 'absolute', top: '10px', right: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <${Button} variant="outline" size="sm" icon onClick=${() => zoomBy(1.3)}><${ZoomIn} size=${14} /><//>
          <${Button} variant="outline" size="sm" icon onClick=${() => zoomBy(0.77)}><${ZoomOut} size=${14} /><//>
          <${Button} variant="outline" size="sm" icon onClick=${resetView}><${Maximize2} size=${14} /><//>
        </div>
      `}
      ${hover && html`
        <div style=${{ position: 'fixed', left: (hover.x + 14) + 'px', top: (hover.y - 10) + 'px', zIndex: 200, pointerEvents: 'none', minWidth: '150px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--shadow-md)', padding: '8px 10px', fontSize: '12px' }}>
          <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
            <span style=${{ width: '9px', height: '9px', borderRadius: '50%', background: WELL_STATUS_HEX[hover.item.status] || '#857A6B', flexShrink: 0 }} />
            <strong>${hover.item.name}</strong>
          </div>
          <div>${hover.item.well_type === 'piezometric' ? 'Пьезометрическая' : 'Дренажная'} · ${hover.item.status || '—'}</div>
          ${hover.item.depth != null && html`<div>H=${hover.item.depth} м${hover.item.azimuth != null ? ` · аз. ${hover.item.azimuth}°` : ''}</div>`}
        </div>
      `}
    </div>
  `;
}

function WellPassportCard({ well, measByWell, onEdit, onDelete, onAddSensorReading }) {
  if (!well) {
    return html`<${Card} style=${{ height: '100%' }}><${CardContent}><${EmptyState} icon=${html`<${GitCommitHorizontal} size=${36} />`} title="Скважина не выбрана" description="Выберите скважину на схеме или в списке." /><//><//>`;
  }
  const lastM = (measByWell[well.id] || []).reduce((latest, m) => (!latest || (m.measurement_date || '') > (latest.measurement_date || '')) ? m : latest, null);
  const wgs = (well.x_local != null && well.y_local != null) ? localToWgs(well.x_local, well.y_local) : null;

  return html`
    <${Card} style=${{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <${CardHeader}>
        <div>
          <${CardTitle}>${well.name}<//>
          <div class="card-subtitle">${well.well_type === 'piezometric' ? 'Пьезометрическая (VWP)' : 'Дренажная'} · ${well.quarry || '—'}</div>
        </div>
        <${Badge} variant=${WELL_STATUS_BADGE[well.status] || 'default'}>${well.status || '—'}<//>
      <//>
      <div style=${{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '18px' }}>
        <div class="wells-passport-grid">
          <div><span>Участок</span><b>${well.quarry_section || '—'}</b></div>
          <div><span>Домен</span><b>${well.domain || '—'}</b></div>
          <div><span>Глубина</span><b>${well.depth != null ? well.depth + ' м' : '—'}</b></div>
          <div><span>Азимут</span><b>${well.azimuth != null ? well.azimuth + '°' : '—'}</b></div>
          <div><span>Наклон (справ.)</span><b>${well.inclination != null ? well.inclination + '°' : '—'}</b></div>
          <div><span>Диаметр</span><b>${well.drill_diameter != null ? well.drill_diameter + ' мм' : '—'}</b></div>
          <div><span>Обсадка</span><b>${well.casing || '—'}</b></div>
          <div><span>Дата бурения</span><b>${well.drill_date || '—'}</b></div>
          <div><span>Оголовок</span><b>${well.has_wellhead ? 'Да' : 'Нет'}</b></div>
          <div><span>Q после бурения</span><b>${well.flow_after_drill != null ? well.flow_after_drill + ' м³/ч' : '—'}</b></div>
          <div><span>Дебит (посл.)</span><b>${lastM && lastM.flow_rate != null ? Number(lastM.flow_rate).toFixed(2) + ' м³/ч' : '—'}</b></div>
        </div>
        <div class="section-label" style=${{ marginTop: '14px' }}>Координаты</div>
        <div class="wells-passport-grid">
          <div><span>X / Y / Z</span><b>${well.x_local != null ? `${Number(well.x_local).toFixed(2)} / ${Number(well.y_local).toFixed(2)} / ${well.z_local != null ? Number(well.z_local).toFixed(2) : '—'}` : '—'}</b></div>
          <div><span>WGS-84</span><b>${wgs ? `${wgs.lat.toFixed(6)}, ${wgs.lon.toFixed(6)}` : (well.lat != null ? `${Number(well.lat).toFixed(6)}, ${Number(well.lon).toFixed(6)}` : '—')}</b></div>
        </div>
        ${well.well_type === 'piezometric' && html`
          <div class="section-label" style=${{ marginTop: '14px' }}>Датчики VWP</div>
          ${!well.sensors || !well.sensors.length ? html`<div class="anl-empty" style=${{ padding: '10px 0' }}>Нет датчиков</div>` : html`
            <div style=${{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              ${well.sensors.map((s) => html`
                <div key=${s.id} class="wells-sensor-item">
                  <div>
                    <div style=${{ fontWeight: 600, fontSize: '12.5px' }}>${s.name || '—'}</div>
                    <div style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Глубина ${s.depth ?? '—'} м · ${s.connectedToLogger ? `логгер ${s.loggerSN}` : 'нет связи'}</div>
                  </div>
                  <${Button} variant="outline" size="sm" onClick=${() => onAddSensorReading(well, s)}>+ Показание<//>
                </div>
              `)}
            </div>
          `}
        `}
      <//>
      <div style=${{ display: 'flex', gap: '6px', padding: '12px 18px', borderTop: '1px solid var(--border-subtle)' }}>
        <${Button} variant="outline" size="sm" onClick=${() => onEdit(well)}><${Pencil} size=${14} /> Изменить<//>
        <${Button} variant="outline" size="sm" onClick=${() => onDelete(well)}><${Trash2} size=${14} style=${{ color: 'var(--red-500)' }} /><//>
      </div>
    <//>
  `;
}

function WellListPanel({ wells, selectedId, onSelect, typeFilter, onTypeFilter, typeCounts }) {
  return html`
    <${Card} style=${{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <${CardHeader}><${CardTitle}>Скважины<//><span style=${{ fontSize: '12px', color: 'var(--text-tertiary)' }}>${wells.length}<//><//>
      <div style=${{ padding: '0 14px 10px', flexShrink: 0 }}>
        <div class="reg-chips">
          <button type="button" class=${'reg-chip' + (!typeFilter ? ' active' : '')} onClick=${() => onTypeFilter('')}>Все<//>
          <button type="button" class=${'reg-chip' + (typeFilter === 'drainage' ? ' active' : '')} onClick=${() => onTypeFilter('drainage')}>⬇ Дрен.<//>
          <button type="button" class=${'reg-chip' + (typeFilter === 'piezometric' ? ' active' : '')} onClick=${() => onTypeFilter('piezometric')}>◆ Пьезо<//>
        </div>
      </div>
      <div style=${{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        ${wells.map((w) => html`
          <div key=${w.id} class=${'wells-list-row' + (w.id === selectedId ? ' active' : '')} onClick=${() => onSelect(w.id)}>
            <span class="wells-list-dot" style=${{ background: WELL_STATUS_HEX[w.status] || '#857A6B' }} />
            <div style=${{ flex: 1, minWidth: 0 }}>
              <div style=${{ fontWeight: 600, fontSize: '12.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${w.name}${w.well_type === 'piezometric' ? ' ◆' : ''}</div>
              <div style=${{ fontSize: '10.5px', color: 'var(--text-tertiary)' }}>${w.quarry_section || '—'} · ${w.depth != null ? w.depth + ' м' : '—'}</div>
            </div>
          </div>
        `)}
      </div>
    <//>
  `;
}

function WellFlowChart({ days }) {
  const [hover, setHover] = useState(null);
  if (!days.length) return html`<div class="anl-empty">Нет замеров дебита</div>`;
  const PAD = { top: 20, right: 20, bottom: 30, left: 44 };
  const W = 640, H = 220;
  const cW = W - PAD.left - PAD.right, cH = H - PAD.top - PAD.bottom;
  const n = days.length;
  const maxQ = (Math.max(...days.map((d) => d.flow_rate || 0)) || 1) * 1.15;
  const px = (i) => (n === 1 ? PAD.left + cW / 2 : PAD.left + (i / (n - 1)) * cW);
  const py = (v) => PAD.top + cH - (v / maxQ) * cH;
  const pts = days.map((d, i) => ({ x: px(i), y: py(d.flow_rate || 0) }));
  const line = smoothPath(pts);
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${(PAD.top + cH).toFixed(1)} L${pts[0].x.toFixed(1)},${(PAD.top + cH).toFixed(1)} Z`;
  const step = Math.max(1, Math.ceil(n / 7));
  const hitW = cW / Math.max(n - 1, 1);
  const hovered = hover != null ? days[hover] : null;

  return html`
    <div style=${{ position: 'relative' }}>
      <svg viewBox=${`0 0 ${W} ${H}`} style=${{ width: '100%', display: 'block' }}>
        ${[0, 0.5, 1].map((f) => html`<line key=${f} x1=${PAD.left} y1=${py(maxQ * f).toFixed(1)} x2=${PAD.left + cW} y2=${py(maxQ * f).toFixed(1)} stroke="var(--border-subtle)" stroke-width="1" />`)}
        ${[0, 0.5, 1].map((f) => html`<text key=${'t' + f} x=${PAD.left - 6} y=${(py(maxQ * f) + 3).toFixed(1)} text-anchor="end" font-size="9" fill="var(--text-tertiary)">${(maxQ * f).toFixed(1)}</text>`)}
        <path d=${area} fill="var(--blue-500)" opacity="0.1" />
        <path d=${line} fill="none" stroke="var(--blue-500)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />
        ${hover != null && html`<line x1=${px(hover).toFixed(1)} y1=${PAD.top} x2=${px(hover).toFixed(1)} y2=${PAD.top + cH} stroke="var(--stone-400)" stroke-width="1" stroke-dasharray="3,3" />`}
        ${days.map((d, i) => html`<circle key=${d.id} cx=${px(i).toFixed(1)} cy=${py(d.flow_rate || 0).toFixed(1)} r=${i === hover ? 4.5 : 3.5} fill="var(--blue-500)" stroke="#fff" stroke-width="1.5" />`)}
        ${days.map((d, i) => (i % step === 0 || i === n - 1) ? html`<text key=${'d' + d.id} x=${px(i).toFixed(1)} y=${H - 6} text-anchor="middle" font-size="9" fill="var(--text-tertiary)">${shortMonitoringDate(d.measurement_date)}</text>` : null)}
        ${days.map((d, i) => html`<rect key=${'hit-' + d.id} x=${(px(i) - hitW / 2).toFixed(1)} y=${PAD.top} width=${hitW.toFixed(1)} height=${cH} fill="transparent" style=${{ cursor: 'crosshair' }} onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)} />`)}
      </svg>
      ${hovered && html`
        <div class="anl-wt-tip" style=${{ left: ((px(hover) > W * 0.6 ? px(hover) - 150 : px(hover) + 10) / W) * 100 + '%', top: '6%' }}>
          <div class="anl-wt-tip-date">${formatMonitoringDate(hovered.measurement_date)}</div>
          <div class="anl-wt-tip-row"><span>Дебит</span><b style=${{ color: 'var(--blue-500)' }}>${hovered.flow_rate != null ? Number(hovered.flow_rate).toFixed(2) + ' м³/ч' : '—'}</b></div>
          ${hovered.worker && html`<div class="anl-wt-tip-row"><span>Сотрудник</span><b>${hovered.worker}</b></div>`}
          ${hovered.comment && html`<div class="anl-wt-tip-row"><span>Коммент.</span><b style=${{ fontWeight: 500 }}>${hovered.comment}</b></div>`}
        </div>
      `}
    </div>
  `;
}

const VWP_COLORS = ['var(--blue-500)', 'var(--green-500)', 'var(--amber-600)', 'var(--red-500)', 'var(--gold-500)', 'var(--stone-600)'];

function WellVwpChart({ well, readingsBySensor }) {
  const [hover, setHover] = useState(null);
  const sensors = well.sensors || [];

  const allDates = useMemo(() => {
    const set = new Set();
    sensors.forEach((s) => (readingsBySensor[s.id] || []).forEach((r) => set.add(r.date)));
    return Array.from(set).sort();
  }, [sensors, readingsBySensor]);

  if (!sensors.length) return html`<div class="anl-empty">У скважины нет датчиков VWP</div>`;
  if (!allDates.length) return html`<div class="anl-empty">Показаний пока нет</div>`;

  const PAD = { top: 20, right: 20, bottom: 30, left: 48 };
  const W = 640, H = 220;
  const cW = W - PAD.left - PAD.right, cH = H - PAD.top - PAD.bottom;
  const n = allDates.length;
  const allVals = [];
  sensors.forEach((s) => (readingsBySensor[s.id] || []).forEach((r) => { if (r.level_above_sensor != null) allVals.push(parseFloat(r.level_above_sensor)); }));
  const maxV = (allVals.length ? Math.max(...allVals) : 1) * 1.15 || 1;
  const minV = Math.min(0, allVals.length ? Math.min(...allVals) : 0);
  const range = (maxV - minV) || 1;
  const px = (i) => (n === 1 ? PAD.left + cW / 2 : PAD.left + (i / (n - 1)) * cW);
  const py = (v) => PAD.top + cH - ((v - minV) / range) * cH;
  const step = Math.max(1, Math.ceil(n / 7));
  const hitW = cW / Math.max(n - 1, 1);
  const hoveredDate = hover != null ? allDates[hover] : null;

  const series = sensors.map((s, si) => {
    const map = {};
    (readingsBySensor[s.id] || []).forEach((r) => { if (r.level_above_sensor != null) map[r.date] = parseFloat(r.level_above_sensor); });
    const pts = [];
    allDates.forEach((d, i) => { if (map[d] != null) pts.push({ x: px(i), y: py(map[d]) }); });
    return { sensor: s, color: VWP_COLORS[si % VWP_COLORS.length], pts, map };
  });

  return html`
    <div>
      <div class="anl-hist-legend">
        ${series.map((sd) => html`<span key=${sd.sensor.id}><span class="anl-legend-swatch" style=${{ background: sd.color }} />${sd.sensor.name || '—'}</span>`)}
      </div>
      <div style=${{ position: 'relative' }}>
        <svg viewBox=${`0 0 ${W} ${H}`} style=${{ width: '100%', display: 'block' }}>
          ${[0, 0.5, 1].map((f) => html`<line key=${f} x1=${PAD.left} y1=${py(minV + range * f).toFixed(1)} x2=${PAD.left + cW} y2=${py(minV + range * f).toFixed(1)} stroke="var(--border-subtle)" stroke-width="1" />`)}
          ${[0, 0.5, 1].map((f) => html`<text key=${'t' + f} x=${PAD.left - 6} y=${(py(minV + range * f) + 3).toFixed(1)} text-anchor="end" font-size="9" fill="var(--text-tertiary)">${(minV + range * f).toFixed(1)}</text>`)}
          ${hover != null && html`<line x1=${px(hover).toFixed(1)} y1=${PAD.top} x2=${px(hover).toFixed(1)} y2=${PAD.top + cH} stroke="var(--stone-400)" stroke-width="1" stroke-dasharray="3,3" />`}
          ${series.map((sd) => sd.pts.length ? html`<path key=${'l' + sd.sensor.id} d=${smoothPath(sd.pts)} fill="none" stroke=${sd.color} stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />` : null)}
          ${series.map((sd) => sd.pts.map((p, pi) => html`<circle key=${sd.sensor.id + '-' + pi} cx=${p.x.toFixed(1)} cy=${p.y.toFixed(1)} r="3" fill=${sd.color} stroke="#fff" stroke-width="1.3" />`))}
          ${allDates.map((d, i) => (i % step === 0 || i === n - 1) ? html`<text key=${'d' + d} x=${px(i).toFixed(1)} y=${H - 6} text-anchor="middle" font-size="9" fill="var(--text-tertiary)">${shortMonitoringDateTime(d)}</text>` : null)}
          ${allDates.map((d, i) => html`<rect key=${'hit-' + d} x=${(px(i) - hitW / 2).toFixed(1)} y=${PAD.top} width=${hitW.toFixed(1)} height=${cH} fill="transparent" style=${{ cursor: 'crosshair' }} onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)} />`)}
        </svg>
        ${hoveredDate && html`
          <div class="anl-wt-tip" style=${{ left: ((px(hover) > W * 0.6 ? px(hover) - 150 : px(hover) + 10) / W) * 100 + '%', top: '6%' }}>
            <div class="anl-wt-tip-date">${formatMonitoringDateTime(hoveredDate)}</div>
            ${series.map((sd) => html`
              <div key=${sd.sensor.id} class="anl-wt-tip-row">
                <span><span class="anl-legend-swatch" style=${{ background: sd.color, borderRadius: '50%', width: '8px', height: '8px' }} />${sd.sensor.name || '—'}</span>
                <b style=${{ color: sd.color }}>${sd.map[hoveredDate] != null ? sd.map[hoveredDate].toFixed(2) + ' м' : '—'}</b>
              </div>
            `)}
          </div>
        `}
      </div>
    </div>
  `;
}

function SensorReadingDialog({ well, sensor, initial, onClose, onSave }) {
  const [date, setDate] = useState((initial && initial.date) ? String(initial.date).slice(0, 16) : nowLocalDatetimeInput());
  const [level, setLevel] = useState(initial && initial.level_above_sensor != null ? String(initial.level_above_sensor) : '');
  const [notes, setNotes] = useState((initial && initial.notes) || '');
  const [saving, setSaving] = useState(false);
  const elevHint = well.z_local != null && sensor.depth != null ? (well.z_local - parseFloat(sensor.depth)).toFixed(2) : null;

  async function handleSave() {
    if (!date || level === '') { alert('Укажите дату/время и уровень'); return; }
    setSaving(true);
    const row = {
      id: (initial && initial.id) || ('wsr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
      well_id: well.id, sensor_id: sensor.id, date: toStorageDateTime(date), level_above_sensor: numOrNull(level), notes: notes.trim() || null,
    };
    try { await onSave(row); onClose(); } catch (e) { alert('Ошибка сохранения: ' + e.message); } finally { setSaving(false); }
  }

  return html`
    <${Dialog}
      open=${true} onClose=${onClose}
      title=${`Показание — ${well.name} / ${sensor.name || ''}`}
      footer=${html`<${Button} variant="outline" onClick=${onClose}>Отмена<//><${Button} onClick=${handleSave} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить'}<//>`}
    >
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        ${elevHint && html`<div class="wells-wgs-hint">Отметка датчика: ${elevHint} м (Z устья − глубина датчика)</div>`}
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <${Field} label="Дата и время"><${Input} type="datetime-local" value=${date} onChange=${(e) => setDate(e.target.value)} /><//>
          <${Field} label="Уровень воды над датчиком, м"><${Input} type="number" step="0.01" value=${level} onChange=${(e) => setLevel(e.target.value)} /><//>
        </div>
        <${Field} label="Примечание"><${Input} value=${notes} onChange=${(e) => setNotes(e.target.value)} /><//>
      </div>
    <//>
  `;
}

const EMPTY_MEAS_FORM = { id: null, measurement_date: '', flow_rate: '', worker: '', comment: '' };

function WellDetailTab({ quarry, items, measByWell, sensorReadings, openEdit, remove, reload, saveSensorReadingRow }) {
  const [selectedId, setSelectedId] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [measDialogOpen, setMeasDialogOpen] = useState(false);
  const [measForm, setMeasForm] = useState(EMPTY_MEAS_FORM);
  const [measSaving, setMeasSaving] = useState(false);
  const [sensorReadingCtx, setSensorReadingCtx] = useState(null); // { well, sensor }

  const typeCounts = useMemo(() => {
    const c = { drainage: 0, piezometric: 0 };
    (items || []).forEach((w) => { c[w.well_type] = (c[w.well_type] || 0) + 1; });
    return c;
  }, [items]);

  const filteredWells = useMemo(() => (items || []).filter((w) => !typeFilter || w.well_type === typeFilter), [items, typeFilter]);

  useEffect(() => {
    if (!items || !items.length) return;
    if (!selectedId || !items.some((w) => w.id === selectedId)) setSelectedId(items[0].id);
  }, [items]);

  const selectedWell = useMemo(() => (items || []).find((w) => w.id === selectedId) || null, [items, selectedId]);
  const isPiezo = selectedWell && selectedWell.well_type === 'piezometric';
  const days = useMemo(() => {
    if (!selectedWell) return [];
    return (measByWell[selectedWell.id] || []).slice().sort((a, b) => (a.measurement_date || '') < (b.measurement_date || '') ? -1 : 1);
  }, [selectedWell, measByWell]);

  const readingsBySensor = useMemo(() => {
    const m = {};
    (sensorReadings || []).forEach((r) => { (m[r.sensor_id] = m[r.sensor_id] || []).push(r); });
    Object.keys(m).forEach((k) => m[k].sort((a, b) => (a.date < b.date ? -1 : 1)));
    return m;
  }, [sensorReadings]);

  function openAddMeasurement() {
    setMeasForm({ ...EMPTY_MEAS_FORM, measurement_date: new Date().toISOString().slice(0, 10) });
    setMeasDialogOpen(true);
  }
  function openEditMeasurement(m) {
    setMeasForm({ id: m.id, measurement_date: m.measurement_date || '', flow_rate: m.flow_rate ?? '', worker: m.worker || '', comment: m.comment || '' });
    setMeasDialogOpen(true);
  }
  async function saveMeasurement() {
    if (!selectedWell || !measForm.measurement_date || measForm.flow_rate === '') { alert('Укажите дату и дебит'); return; }
    setMeasSaving(true);
    const row = {
      well_id: selectedWell.id, measurement_date: measForm.measurement_date,
      flow_rate: numOrNull(measForm.flow_rate), worker: measForm.worker.trim(), comment: measForm.comment.trim(),
    };
    if (measForm.id) row.id = measForm.id;
    const { error } = await supabase.from('well_measurements').upsert(row);
    setMeasSaving(false);
    if (error) { alert('Ошибка сохранения: ' + error.message); return; }
    setMeasDialogOpen(false);
    reload();
  }
  async function deleteMeasurement(m) {
    if (!confirm('Удалить этот замер?')) return;
    await supabase.from('well_measurements').delete().eq('id', m.id);
    reload();
  }

  return html`
    <div>
      <div class="wells-detail-top">
        <div class="wells-detail-passport"><${WellPassportCard} well=${selectedWell} measByWell=${measByWell} onEdit=${openEdit} onDelete=${remove} onAddSensorReading=${(well, sensor) => setSensorReadingCtx({ well, sensor })} /></div>
        <div class="wells-detail-map"><${WellSchemeMap} quarry=${quarry} wells=${filteredWells} selectedId=${selectedId} onSelect=${setSelectedId} /></div>
        <div class="wells-detail-list"><${WellListPanel} wells=${filteredWells} selectedId=${selectedId} onSelect=${setSelectedId} typeFilter=${typeFilter} onTypeFilter=${setTypeFilter} typeCounts=${typeCounts} /></div>
      </div>

      <div class="grid grid-2" style=${{ marginTop: '16px', alignItems: 'start' }}>
        <${Card}>
          <${CardHeader}><${CardTitle}>${isPiezo ? 'Показания VWP' : 'График дебита'}<//><//>
          <${CardContent}>
            ${isPiezo
              ? html`<${WellVwpChart} well=${selectedWell} readingsBySensor=${readingsBySensor} />`
              : html`<${WellFlowChart} days=${days} />`}
          <//>
        <//>
        <${Card}>
          <${CardHeader}>
            <${CardTitle}>Замеры<//>
            ${selectedWell && html`<${Button} size="sm" onClick=${openAddMeasurement}><${Plus} size=${14} /> Замер<//>`}
          <//>
          <${CardContent} tight>
            ${!days.length ? html`<div class="anl-empty" style=${{ padding: '24px' }}>Замеров нет</div>` : html`
              <div class="table-wrap" style=${{ maxHeight: '260px', overflow: 'auto' }}>
                <table class="data-table">
                  <thead><tr><th>Дата</th><th>Q, м³/ч</th><th>Сотрудник</th><th>Комментарий</th><th></th></tr></thead>
                  <tbody>
                    ${days.slice().reverse().map((m) => html`
                      <tr key=${m.id}>
                        <td>${formatMonitoringDate(m.measurement_date)}</td>
                        <td class="mono">${m.flow_rate != null ? Number(m.flow_rate).toFixed(2) : '—'}</td>
                        <td>${m.worker || '—'}</td>
                        <td style=${{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${m.comment || '—'}</td>
                        <td>
                          <div style=${{ display: 'flex', gap: '2px', justifyContent: 'flex-end' }}>
                            <${Button} variant="ghost" size="sm" icon onClick=${() => openEditMeasurement(m)}><${Pencil} size=${12} /><//>
                            <${Button} variant="ghost" size="sm" icon onClick=${() => deleteMeasurement(m)}><${X} size=${12} style=${{ color: 'var(--red-500)' }} /><//>
                          </div>
                        </td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>
            `}
          <//>
        <//>
      </div>

      <${Dialog}
        open=${measDialogOpen} onClose=${() => setMeasDialogOpen(false)}
        title=${measForm.id ? 'Редактировать замер' : `Новый замер — ${selectedWell ? selectedWell.name : ''}`}
        footer=${html`<${Button} variant="outline" onClick=${() => setMeasDialogOpen(false)}>Отмена<//><${Button} onClick=${saveMeasurement} disabled=${measSaving}>${measSaving ? 'Сохранение…' : 'Сохранить'}<//>`}
      >
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <${Field} label="Дата замера"><${Input} type="date" value=${measForm.measurement_date} onChange=${(e) => setMeasForm({ ...measForm, measurement_date: e.target.value })} /><//>
            <${Field} label="Дебит, м³/ч"><${Input} type="number" step="0.01" value=${measForm.flow_rate} onChange=${(e) => setMeasForm({ ...measForm, flow_rate: e.target.value })} /><//>
          </div>
          <${Field} label="Сотрудник"><${Input} value=${measForm.worker} onChange=${(e) => setMeasForm({ ...measForm, worker: e.target.value })} /><//>
          <${Field} label="Комментарий"><${Input} value=${measForm.comment} onChange=${(e) => setMeasForm({ ...measForm, comment: e.target.value })} /><//>
        </div>
      <//>

      ${sensorReadingCtx && html`
        <${SensorReadingDialog} well=${sensorReadingCtx.well} sensor=${sensorReadingCtx.sensor} onClose=${() => setSensorReadingCtx(null)} onSave=${saveSensorReadingRow} />
      `}
    </div>
  `;
}

// ═════════════════════════ Вкладка «Показания VWP» ═════════════════════════

const EMPTY_VWP_FORM = { wellId: '', sensorId: '', date: '', level: '', notes: '' };

function VwpReadingsTab({ items, sensorReadings, saveSensorReadingRow, deleteSensorReadingRow, bulkUpsertSensorReadings }) {
  const piezoWells = useMemo(() => (items || []).filter((w) => w.well_type === 'piezometric' && Array.isArray(w.sensors) && w.sensors.length), [items]);
  const wellById = useMemo(() => { const m = {}; (items || []).forEach((w) => { m[w.id] = w; }); return m; }, [items]);

  const [form, setForm] = useState({ ...EMPTY_VWP_FORM, date: nowLocalDatetimeInput() });
  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filterWellId, setFilterWellId] = useState('');
  const [filterSensorId, setFilterSensorId] = useState('');
  const [bulkStatus, setBulkStatus] = useState(null); // { type: 'info'|'success'|'warn'|'error', text }
  const [bulkBusy, setBulkBusy] = useState(false);
  const fileInputRef = useRef(null);

  const formWell = wellById[form.wellId] || null;
  const formSensors = formWell ? (formWell.sensors || []) : [];
  const formSensor = formSensors.find((s) => s.id === form.sensorId) || null;
  const elevHint = formWell && formSensor && formWell.z_local != null && formSensor.depth != null
    ? (formWell.z_local - parseFloat(formSensor.depth)).toFixed(2) : null;

  function resetForm() { setForm({ ...EMPTY_VWP_FORM, date: nowLocalDatetimeInput() }); setEditingId(null); }
  function startEdit(r) {
    setForm({ wellId: r.well_id, sensorId: r.sensor_id, date: r.date ? String(r.date).slice(0, 16) : nowLocalDatetimeInput(), level: r.level_above_sensor ?? '', notes: r.notes || '' });
    setEditingId(r.id);
  }

  async function submit() {
    if (!form.wellId || !form.sensorId || !form.date || form.level === '') { alert('Заполните скважину, датчик, дату/время и уровень'); return; }
    setSaving(true);
    const row = {
      id: editingId || ('wsr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)),
      well_id: form.wellId, sensor_id: form.sensorId, date: toStorageDateTime(form.date),
      level_above_sensor: numOrNull(form.level), notes: form.notes.trim() || null,
    };
    try { await saveSensorReadingRow(row); resetForm(); } catch (e) { alert('Ошибка сохранения: ' + e.message); } finally { setSaving(false); }
  }

  async function remove(r) {
    if (!confirm('Удалить это показание?')) return;
    try { await deleteSensorReadingRow(r.id); } catch (e) { alert('Ошибка удаления: ' + e.message); }
  }

  async function handleDownloadTemplate() {
    try { await downloadVwpTemplate(piezoWells); } catch (e) { alert('Ошибка: ' + e.message); }
  }

  async function handleImport() {
    const file = fileInputRef.current && fileInputRef.current.files[0];
    if (!file) { setBulkStatus({ type: 'warn', text: 'Выберите файл.' }); return; }
    setBulkBusy(true);
    setBulkStatus({ type: 'info', text: 'Обработка файла…' });
    try {
      const { rows, created, updated, errors, unknownCols } = await parseVwpImportFile(file, piezoWells, sensorReadings);
      if (!rows.length) { setBulkStatus({ type: 'error', text: 'Не найдено ни одной строки с данными для загрузки.' }); return; }
      await bulkUpsertSensorReadings(rows);
      let text = `Загрузка завершена: создано ${created}, обновлено ${updated}`;
      if (errors) text += `, ошибок ${errors}`;
      if (unknownCols.length) text += `, не распознано колонок: ${unknownCols.length}`;
      setBulkStatus({ type: (errors || unknownCols.length) ? 'warn' : 'success', text });
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e) {
      setBulkStatus({ type: 'error', text: 'Ошибка: ' + e.message });
    } finally {
      setBulkBusy(false);
    }
  }

  function sensorName(wellId, sensorId) {
    const w = wellById[wellId];
    const s = w && w.sensors && w.sensors.find((x) => x.id === sensorId);
    return s ? (s.name || sensorId) : sensorId;
  }
  function sensorDepth(wellId, sensorId) {
    const w = wellById[wellId];
    const s = w && w.sensors && w.sensors.find((x) => x.id === sensorId);
    return s ? s.depth : null;
  }
  function absElevation(r) {
    const w = wellById[r.well_id];
    const d = sensorDepth(r.well_id, r.sensor_id);
    if (!w || w.z_local == null || d == null || r.level_above_sensor == null) return null;
    return (w.z_local - parseFloat(d) + parseFloat(r.level_above_sensor)).toFixed(2);
  }

  const filterWell = wellById[filterWellId] || null;
  const filteredReadings = useMemo(() => {
    return (sensorReadings || []).filter((r) => {
      if (filterWellId && r.well_id !== filterWellId) return false;
      if (filterSensorId && r.sensor_id !== filterSensorId) return false;
      return true;
    }).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [sensorReadings, filterWellId, filterSensorId]);

  return html`
    <div>
      <${Card} style=${{ marginBottom: '16px' }}>
        <${CardHeader}><${CardTitle}>${editingId ? 'Изменить показание' : 'Добавить показание'}<//><//>
        <${CardContent}>
          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '14px', marginBottom: '12px' }}>
            <${Field} label="Скважина">
              <${Select} value=${form.wellId} onChange=${(e) => setForm({ ...form, wellId: e.target.value, sensorId: '' })}>
                <option value="">— выберите —</option>
                ${piezoWells.map((w) => html`<option key=${w.id} value=${w.id}>${w.name}<//>`)}
              <//>
            <//>
            <${Field} label="Датчик">
              <${Select} value=${form.sensorId} onChange=${(e) => setForm({ ...form, sensorId: e.target.value })} disabled=${!formWell}>
                <option value="">— выберите —</option>
                ${formSensors.map((s) => html`<option key=${s.id} value=${s.id}>${s.name || s.id}<//>`)}
              <//>
            <//>
            <${Field} label="Дата и время"><${Input} type="datetime-local" value=${form.date} onChange=${(e) => setForm({ ...form, date: e.target.value })} /><//>
            <${Field} label="Уровень над датчиком, м"><${Input} type="number" step="0.01" value=${form.level} onChange=${(e) => setForm({ ...form, level: e.target.value })} /><//>
          </div>
          ${elevHint && html`<div class="wells-wgs-hint" style=${{ marginBottom: '12px' }}>Отметка датчика: ${elevHint} м · абс. отметка воды при вводе будет равна ${(parseFloat(elevHint) + (numOrNull(form.level) || 0)).toFixed(2)} м</div>`}
          <div style=${{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
            <div style=${{ flex: 1 }}><${Field} label="Примечание"><${Input} value=${form.notes} onChange=${(e) => setForm({ ...form, notes: e.target.value })} /><//></div>
            ${editingId && html`<${Button} variant="outline" onClick=${resetForm}>Отмена<//>`}
            <${Button} onClick=${submit} disabled=${saving}>${saving ? 'Сохранение…' : (editingId ? 'Сохранить' : '+ Добавить')}<//>
          </div>
        <//>
      <//>

      <${Card} style=${{ marginBottom: '16px' }}>
        <${CardHeader}><${CardTitle}>Массовая загрузка (Excel)<//><//>
        <${CardContent}>
          <p style=${{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.6 }}>
            В шаблоне — отдельный столбец на каждый датчик каждой пьезометрической скважины, строка — на одну дату-время. Данные собираются почасово, формат: <span class="mono">2026-07-06 12:00:00</span>. Пустая ячейка — этот замер не трогаем; если на эту дату-время для датчика уже есть показание — оно обновится, если нет — создастся новое.
          </p>
          <div style=${{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
            <${Button} variant="outline" onClick=${handleDownloadTemplate} disabled=${!piezoWells.length}><${Download} size=${15} /> Скачать шаблон .xlsx<//>
          </div>
          ${!piezoWells.length && html`<div class="wells-wgs-hint" style=${{ marginBottom: '12px' }}>Нет пьезометрических скважин с датчиками — сначала добавьте их в реестре.</div>`}
          <div style=${{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input ref=${fileInputRef} type="file" accept=".xlsx,.xls" class="form-control" style=${{ maxWidth: '280px' }} />
            <${Button} onClick=${handleImport} disabled=${bulkBusy || !piezoWells.length}><${Upload} size=${15} /> ${bulkBusy ? 'Загрузка…' : 'Импортировать'}<//>
          </div>
          ${bulkStatus && html`
            <div style=${{ marginTop: '10px', fontSize: '12.5px', color: bulkStatus.type === 'error' ? 'var(--red-500)' : bulkStatus.type === 'warn' ? 'var(--amber-600)' : bulkStatus.type === 'success' ? 'var(--green-500)' : 'var(--text-secondary)' }}>${bulkStatus.text}<//>
          `}
        <//>
      <//>

      <${Card}>
        <div class="reg-toolbar">
          <${Select} value=${filterWellId} onChange=${(e) => { setFilterWellId(e.target.value); setFilterSensorId(''); }} style=${{ maxWidth: '220px' }}>
            <option value="">Все скважины</option>
            ${piezoWells.map((w) => html`<option key=${w.id} value=${w.id}>${w.name}<//>`)}
          <//>
          ${filterWell && html`
            <${Select} value=${filterSensorId} onChange=${(e) => setFilterSensorId(e.target.value)} style=${{ maxWidth: '200px' }}>
              <option value="">Все датчики</option>
              ${(filterWell.sensors || []).map((s) => html`<option key=${s.id} value=${s.id}>${s.name || s.id}<//>`)}
            <//>
          `}
        </div>
        <${CardContent} tight>
          ${!filteredReadings.length ? html`<${EmptyState} icon=${html`<${Radio} size=${36} />`} title="Показаний нет" description="Добавьте первое показание датчика формой выше." />` : html`
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr><th>Дата и время</th><th>Скважина</th><th>Датчик</th><th>Уровень над датчиком, м</th><th>Абс. отметка, м</th><th>Примечание</th><th></th></tr></thead>
                <tbody>
                  ${filteredReadings.map((r) => html`
                    <tr key=${r.id}>
                      <td>${formatMonitoringDateTime(r.date)}</td>
                      <td style=${{ fontWeight: 600 }}>${wellById[r.well_id] ? wellById[r.well_id].name : r.well_id}</td>
                      <td>${sensorName(r.well_id, r.sensor_id)}</td>
                      <td class="mono">${r.level_above_sensor != null ? Number(r.level_above_sensor).toFixed(2) : '—'}</td>
                      <td class="mono" style=${{ color: 'var(--blue-500)' }}>${absElevation(r) ?? '—'}</td>
                      <td style=${{ maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${r.notes || '—'}</td>
                      <td>
                        <div style=${{ display: 'flex', gap: '2px', justifyContent: 'flex-end' }}>
                          <${Button} variant="ghost" size="sm" icon onClick=${() => startEdit(r)}><${Pencil} size=${12} /><//>
                          <${Button} variant="ghost" size="sm" icon onClick=${() => remove(r)}><${X} size=${12} style=${{ color: 'var(--red-500)' }} /><//>
                        </div>
                      </td>
                    </tr>
                  `)}
                </tbody>
              </table>
            </div>
          `}
        <//>
      <//>
    </div>
  `;
}

// ═════════════════════════ Страница ═════════════════════════

export function WellsPage({ quarry }) {
  const [tab, setTab] = useState('registry');
  const [items, setItems] = useState(null);
  const [measByWell, setMeasByWell] = useState({});
  const [sensorReadings, setSensorReadings] = useState([]);
  const [error, setError] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  async function load() {
    setError(null);
    try {
      const [wells, meas, readings] = await Promise.all([
        fetchAllRows('wells', { order: 'name', filter: (q) => q.eq('quarry', quarry) }),
        fetchAllRows('well_measurements', { order: 'measurement_date' }),
        fetchAllRows('well_sensor_readings', { order: 'date' }),
      ]);
      setItems(wells);
      const byWell = {};
      meas.forEach((m) => { (byWell[m.well_id] = byWell[m.well_id] || []).push(m); });
      setMeasByWell(byWell);
      const wellIds = new Set(wells.map((w) => w.id));
      setSensorReadings(readings.filter((r) => wellIds.has(r.well_id)));
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { setItems(null); load(); }, [quarry]);

  function openAdd() { setEditingId(null); setForm({ ...EMPTY_FORM, quarry }); setDialogOpen(true); }
  function openEdit(row) { setEditingId(row.id); setForm(rowToForm(row)); setDialogOpen(true); }

  async function save() {
    if (!form.name.trim()) { alert('Введите название'); return; }
    setSaving(true);
    const row = buildSaveRow(form, editingId);
    const { error: err } = await supabase.from('wells').upsert(row);
    setSaving(false);
    if (err) { setError(err.message); return; }
    setDialogOpen(false);
    load();
  }

  async function remove(row) {
    const measCount = (measByWell[row.id] || []).length;
    const warn = measCount ? ` и все её замеры (${measCount})` : '';
    if (!confirm(`Удалить скважину «${row.name}»${warn}?`)) return;
    const { error: err } = await supabase.from('wells').delete().eq('id', row.id);
    if (err) { setError(err.message); return; }
    load();
  }

  async function saveSensorReadingRow(row) {
    const { error: err } = await supabase.from('well_sensor_readings').upsert(row);
    if (err) throw err;
    await load();
  }
  async function deleteSensorReadingRow(id) {
    const { error: err } = await supabase.from('well_sensor_readings').delete().eq('id', id);
    if (err) throw err;
    await load();
  }
  async function bulkUpsertSensorReadings(rows) {
    const { error: err } = await supabase.from('well_sensor_readings').upsert(rows);
    if (err) throw err;
    await load();
  }

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Гор. скважины</div>
          <div class="page-desc">Дренажные и пьезометрические скважины пит-схемы.</div>
        </div>
      </div>

      ${error && html`<div style=${{ color: 'var(--red-500)', fontSize: '13px', marginBottom: '12px' }}>Ошибка: ${error}</div>`}

      <div style=${{ marginBottom: '16px' }}>
        <${Tabs} tabs=${[{ value: 'registry', label: 'Реестр' }, { value: 'detail', label: 'Скважина' }, { value: 'vwp', label: 'Показания VWP' }]} value=${tab} onChange=${setTab} />
      </div>

      ${tab === 'registry' && html`<${WellsRegistryTab} quarry=${quarry} items=${items} measByWell=${measByWell} openAdd=${openAdd} openEdit=${openEdit} remove=${remove} />`}
      ${tab === 'detail' && html`<${WellDetailTab} quarry=${quarry} items=${items || []} measByWell=${measByWell} sensorReadings=${sensorReadings} openEdit=${openEdit} remove=${remove} reload=${load} saveSensorReadingRow=${saveSensorReadingRow} />`}
      ${tab === 'vwp' && html`<${VwpReadingsTab} items=${items || []} sensorReadings=${sensorReadings} saveSensorReadingRow=${saveSensorReadingRow} deleteSensorReadingRow=${deleteSensorReadingRow} bulkUpsertSensorReadings=${bulkUpsertSensorReadings} />`}

      <${Dialog}
        open=${dialogOpen}
        onClose=${() => setDialogOpen(false)}
        title=${editingId ? 'Редактировать скважину' : 'Новая скважина'}
        width="760px"
        footer=${html`
          <${Button} variant="outline" onClick=${() => setDialogOpen(false)}>Отмена<//>
          <${Button} onClick=${save} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить'}<//>
        `}
      >
        <${WellFormBody} form=${form} setForm=${setForm} />
      <//>
    </div>
  `;
}
