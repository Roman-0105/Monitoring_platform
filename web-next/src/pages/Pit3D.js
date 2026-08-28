import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Box, Layers, Upload, RotateCcw, Trash2, Table2, Settings2, Scissors, ListTree, ListChecks } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import {
  PitScene, PIT3D_LAYER_DEFS, defaultLayerStyle, fetchModel, uploadModel, deleteModel,
  parseDXF, buildTIN, computeBBox, computeRobustBBox, countOutliers,
  getWeekDateRange, getWeekKeyFromDate, weekLabel,
  fetchSections, saveSection, deleteSection,
} from '../lib/pit3d-core.js';
import { Button, Card, CardContent, EmptyState, Dialog, Select, Input } from '../components/ui.js';

const LS_KEY = 'pit3d_layer_style'; // тот же ключ, что и в старом приложении — настройки общие
const LS_STEP = 'pit3d_contour_step';
const LS_EXCL = 'pit3d_contour_excluded';

function loadLayerStyle() {
  const defaults = defaultLayerStyle();
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    Object.keys(defaults).forEach((k) => { defaults[k] = { ...defaults[k], ...(saved[k] || {}) }; });
  } catch (e) {}
  return defaults;
}
function saveLayerStyle(style) { try { localStorage.setItem(LS_KEY, JSON.stringify(style)); } catch (e) {} }
function loadManualStep() { try { const v = localStorage.getItem(LS_STEP); return v ? parseFloat(v) : null; } catch (e) { return null; } }
function saveManualStep(v) { try { v == null ? localStorage.removeItem(LS_STEP) : localStorage.setItem(LS_STEP, String(v)); } catch (e) {} }
function loadExcluded() { try { return JSON.parse(localStorage.getItem(LS_EXCL) || '[]'); } catch (e) { return []; } }
function saveExcluded(arr) { try { localStorage.setItem(LS_EXCL, JSON.stringify(arr)); } catch (e) {} }

const WP_TYPE_LABEL = { well_obs: 'Наблюд. скважина', well_exp: 'Эксплуат. скважина', sump: 'Зумпф', pond: 'Накопитель', seep: 'Водопроявление', ditch: 'Канава', other: 'Прочее' };

// Точки для расчёта изогипс группируются по тем же слоям, что в панели «Слои» (а не по
// собственной короткой метке кандидата) — так группа в списке точек однозначно соответствует
// конкретному слою модели. У точек без привязки к слою (датчики VWP) группа — их же метка.
const LAYER_LABEL_BY_KEY = Object.fromEntries(PIT3D_LAYER_DEFS.map((d) => [d.key, d.label]));
function pointGroupLabel(p) { return (p.layerKey && LAYER_LABEL_BY_KEY[p.layerKey]) || p.label; }

// Статические источники точек мониторинга — грузятся один раз за сеанс просмотра модели;
// история "Список точек" тянется целиком (не только последняя запись), чтобы фильтр по неделе
// работал без повторных запросов к Supabase.
async function fetchWaterPointSources() {
  const [{ data: registry, error: e1 }, { data: levels, error: e2 }, { data: points, error: e3 }, { data: sumps, error: e4 }, { data: sumpLevels, error: e5 }] = await Promise.all([
    supabase.from('wp_registry').select('id, name, wp_type, coord_x, coord_y, elev_z, depth, filter_intervals, pump_model, pump_depth, pump_capacity, pump_head'),
    supabase.from('wp_well_levels').select('well_id, date, depth_to_water').order('date', { ascending: false }),
    supabase.from('points').select('point_number, x_local, y_local, horizon, monitoring_date, photos').order('monitoring_date', { ascending: false }),
    supabase.from('dew_sumps').select('id, name, coord_x, coord_y'),
    supabase.from('dew_water_levels').select('sump_id, date, elevation').order('date', { ascending: false }),
  ]);
  if (e1) throw e1; if (e2) throw e2; if (e3) throw e3; if (e4) throw e4; if (e5) throw e5;
  return { registry: registry || [], levels: levels || [], points: points || [], sumps: sumps || [], sumpLevels: sumpLevels || [] };
}

function availableWeeks(points) {
  const set = new Set();
  points.forEach((p) => { if (p.monitoring_date) set.add(getWeekKeyFromDate(p.monitoring_date)); });
  return Array.from(set).sort().reverse();
}

// Точки "Список точек" на дату фильтра по неделе (null = последняя запись на физическую точку)
function pointsForWeek(points, weekKey) {
  const byNum = {};
  if (weekKey) {
    const range = getWeekDateRange(weekKey);
    points.forEach((p) => {
      if (!p.monitoring_date || !range || p.monitoring_date < range.start || p.monitoring_date > range.end) return;
      const cur = byNum[p.point_number];
      if (!cur || p.monitoring_date > cur.monitoring_date) byNum[p.point_number] = p;
    });
  } else {
    points.forEach((p) => { if (!byNum[p.point_number]) byNum[p.point_number] = p; }); // уже отсортировано по убыванию даты
  }
  return Object.values(byNum);
}

// Собирает единый список точек мониторинга из статических источников (без сетевых запросов) —
// пересчитывается локально при смене недельного фильтра. z остаётся null, если реальная отметка
// неизвестна (для изогипс это исключает точку; для маркеров позже подставляется ближайшая по TIN).
function buildWaterPoints(sources, weekKey) {
  const { registry, levels, points, sumps, sumpLevels } = sources;
  const out = [];

  const latestByWell = {};
  levels.forEach((r) => { if (!latestByWell[r.well_id]) latestByWell[r.well_id] = r; });
  registry.forEach((w) => {
    const x = parseFloat(w.coord_x), y = parseFloat(w.coord_y);
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    let z = null;
    if (w.wp_type === 'well_obs' || w.wp_type === 'well_exp') {
      const lvl = latestByWell[w.id];
      if (!lvl || w.elev_z == null) return;
      z = w.elev_z - parseFloat(lvl.depth_to_water);
    } else {
      z = parseFloat(w.elev_z);
      if (Number.isNaN(z)) return;
    }
    const layerKey = 'reg_' + (PIT3D_LAYER_DEFS.some((d) => d.key === 'reg_' + w.wp_type) ? w.wp_type : 'other');
    out.push({ id: 'reg:' + w.id, x, y, z, name: w.name || 'Точка', label: WP_TYPE_LABEL[w.wp_type] || 'Прочее', layerKey });
  });

  pointsForWeek(points, weekKey).forEach((p) => {
    if (p.x_local == null || p.y_local == null) return;
    const z = parseFloat(p.horizon);
    out.push({
      id: 'pt:' + p.point_number, x: p.x_local, y: p.y_local, z: Number.isNaN(z) ? null : z, name: p.point_number || 'Точка', label: 'Водопроявление', layerKey: 'points',
      photoUrl: Array.isArray(p.photos) && p.photos.length ? p.photos[0] : null,
    });
  });

  const latestSumpLevel = {};
  sumpLevels.forEach((r) => { if (!latestSumpLevel[r.sump_id]) latestSumpLevel[r.sump_id] = r; });
  sumps.forEach((s) => {
    const x = parseFloat(s.coord_x), y = parseFloat(s.coord_y);
    if (Number.isNaN(x) || Number.isNaN(y)) return;
    const lvl = latestSumpLevel[s.id];
    out.push({ id: 'dsp:' + s.id, x, y, z: lvl ? parseFloat(lvl.elevation) : null, name: s.name || 'Зумпф', label: 'Зумпф (водоотлив)', layerKey: 'dewsump' });
  });

  return out;
}

// Ствол наблюдательных/эксплуатационных скважин (Реестр водопунктов) — вертикальный,
// от устья (elev_z) вниз на depth; интервалы фильтра и глубина насоса уже вводятся
// в форме реестра (filter_intervals: [{from,to,diameter}], pump_depth/model/capacity/head) —
// здесь только строится геометрия для 3D. skipHead — точку устья уже рисует rebuildMarkers
// (те же reg_well_obs/reg_well_exp), поэтому rebuildWells не дублирует маркер.
function buildRegistryWellShafts(sources, nearestZ) {
  return sources.registry
    .filter((w) => (w.wp_type === 'well_obs' || w.wp_type === 'well_exp') && w.coord_x != null && w.coord_y != null && w.depth != null && w.depth > 0)
    .map((w) => {
      const x = parseFloat(w.coord_x), y = parseFloat(w.coord_y);
      const collarZ = w.elev_z != null ? parseFloat(w.elev_z) : nearestZ(x, y);
      const depth = parseFloat(w.depth);
      const pumpNotes = [w.pump_model, w.pump_capacity != null ? w.pump_capacity + ' м³/ч' : null, w.pump_head != null ? 'напор ' + w.pump_head + ' м' : null].filter(Boolean).join(', ');
      return {
        name: w.name || 'Скважина',
        layerKey: w.wp_type === 'well_obs' ? 'reg_well_obs' : 'reg_well_exp',
        kindLabel: w.wp_type === 'well_obs' ? 'Наблюдательная скважина' : 'Эксплуатационная скважина',
        collar: { x, y, z: collarZ }, end: { x, y, z: collarZ - depth },
        depth,
        filterIntervals: (Array.isArray(w.filter_intervals) ? w.filter_intervals : []).map((f) => ({ top: f.from, bottom: f.to, notes: f.diameter ? 'Ø' + f.diameter + ' мм' : '' })),
        pumpDepth: w.pump_depth != null ? parseFloat(w.pump_depth) : null,
        pumpNotes: pumpNotes || null,
        skipHead: true,
      };
    });
}

async function fetchLatestSensorReadings() {
  const { data, error } = await supabase.from('well_sensor_readings').select('sensor_id, date, level_above_sensor').order('date', { ascending: false });
  if (error) throw error;
  const latest = {};
  (data || []).forEach((r) => { if (!latest[r.sensor_id]) latest[r.sensor_id] = r; });
  return latest;
}

// Абсолютная отметка уровня воды по датчикам VWP пьезометрических скважин — участвует
// в расчёте изогипс наравне с обычными замерами УПВ, хотя своей отдельной точки-маркера
// на модели не получает (датчик уже виден как точка на стволе скважины).
// Отметка датчика = Z устья − глубина датчика; абс. отметка воды = отметка датчика + "уровень над датчиком".
function buildVwpCandidates(wellTrajectories, sensorReadings) {
  const out = [];
  wellTrajectories.forEach((w) => {
    if (!Array.isArray(w.sensors)) return;
    w.sensors.forEach((s) => {
      if (s.depth == null) return;
      const reading = sensorReadings[s.id];
      if (!reading || reading.level_above_sensor == null) return;
      const sensorZ = w.collar.z - parseFloat(s.depth);
      const waterZ = sensorZ + parseFloat(reading.level_above_sensor);
      if (Number.isNaN(waterZ)) return;
      out.push({ id: 'vwp:' + s.id, x: w.collar.x, y: w.collar.y, z: waterZ, name: (s.name || 'Датчик') + ' — ' + w.name, label: 'Пьезометр (VWP)' });
    });
  });
  return out;
}

async function fetchWellTrajectories(nearestZ) {
  const { data, error } = await supabase.from('wells').select('id, name, x_local, y_local, z_local, azimuth, depth, inclination, well_type, sensors');
  if (error) throw error;
  return (data || []).filter((w) => w.x_local != null && w.y_local != null).map((w) => {
    const z = w.z_local != null ? w.z_local : nearestZ(w.x_local, w.y_local);
    const hasReach = w.azimuth != null && w.depth != null && w.depth > 0;
    const inclRad = (w.inclination || 0) * Math.PI / 180;
    const reach = hasReach ? w.depth * Math.cos(inclRad) : 0;
    const dz = hasReach ? w.depth * Math.sin(inclRad) : 0;
    const az = (w.azimuth || 0) * Math.PI / 180;
    const endX = w.x_local + reach * Math.sin(az), endY = w.y_local + reach * Math.cos(az);
    return {
      name: w.name || 'Скважина', isPiezo: w.well_type === 'piezometric', layerKey: w.well_type === 'piezometric' ? 'wells_piezo' : 'wells_drainage',
      collar: { x: w.x_local, y: w.y_local, z }, end: { x: endX, y: endY, z: z + dz },
      depth: w.depth, azimuth: w.azimuth, inclination: w.inclination,
      sensors: w.well_type === 'piezometric' && Array.isArray(w.sensors) ? w.sensors : [],
    };
  });
}

function GeomSelect({ value, onChange }) {
  return html`
    <select value=${value} onChange=${(e) => onChange(e.target.value)} style=${{ fontSize: '11px', border: '1px solid var(--border)', borderRadius: '5px', padding: '3px 5px', background: 'var(--bg-surface)' }}>
      <option value="sphere">Сфера</option>
      <option value="cube">Куб</option>
      <option value="cone">Конус</option>
      <option value="diamond">Ромб</option>
    </select>
  `;
}

function LayerRow({ def, style, onChange, onOpenTable }) {
  const st = style[def.key];
  return html`
    <div style=${{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 4px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
      <label style=${{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12.5px', fontWeight: 600, minWidth: '190px', cursor: 'pointer' }}>
        <input type="checkbox" checked=${st.visible} onChange=${(e) => onChange({ ...st, visible: e.target.checked })} />
        ${def.label}
      </label>
      <input type="color" value=${st.color} onChange=${(e) => onChange({ ...st, color: e.target.value })} style=${{ width: '26px', height: '22px', border: '1px solid var(--border)', borderRadius: '4px', padding: 0, cursor: 'pointer' }} />
      <${GeomSelect} value=${st.geometry} onChange=${(v) => onChange({ ...st, geometry: v })} />
      <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
        Размер <input type="range" min="0.3" max="3" step="0.1" value=${st.size} onChange=${(e) => onChange({ ...st, size: parseFloat(e.target.value) })} style=${{ width: '60px' }} /> ${st.size.toFixed(1)}×
      </span>
      <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
        Прозр. <input type="range" min="0" max="100" value=${Math.round(st.opacity * 100)} onChange=${(e) => onChange({ ...st, opacity: e.target.value / 100 })} style=${{ width: '60px' }} /> ${Math.round(st.opacity * 100)}%
      </span>
      <${Button} variant="ghost" size="sm" style=${{ marginLeft: 'auto' }} onClick=${() => onOpenTable(def)}><${Table2} size=${13} /> Таблица<//>
    </div>
  `;
}

function LayerTableDialog({ def, rows, onClose }) {
  return html`
    <${Dialog} open=${!!def} onClose=${onClose} title=${(def ? def.label : '') + ' — ' + rows.length} width="640px">
      <div style=${{ maxHeight: '440px', overflow: 'auto' }}>
        ${!rows.length ? html`<p style=${{ color: 'var(--text-tertiary)', fontSize: '13px', padding: '8px 0' }}>Нет данных для этого слоя.</p>` : html`
          <table style=${{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
            <thead><tr style=${{ textAlign: 'left', color: 'var(--text-tertiary)' }}>
              <th style=${{ padding: '7px 10px' }}>Название</th><th style=${{ padding: '7px 10px' }}>Тип</th>
              <th style=${{ padding: '7px 10px' }}>X</th><th style=${{ padding: '7px 10px' }}>Y</th><th style=${{ padding: '7px 10px' }}>Z</th>
            </tr></thead>
            <tbody>
              ${rows.map((r, i) => html`
                <tr key=${i} style=${{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style=${{ padding: '6px 10px' }}>${r.name || ''}</td>
                  <td style=${{ padding: '6px 10px', color: 'var(--text-tertiary)' }}>${r.label || ''}</td>
                  <td style=${{ padding: '6px 10px', fontVariantNumeric: 'tabular-nums' }}>${r.x != null ? r.x.toFixed(2) : '—'}</td>
                  <td style=${{ padding: '6px 10px', fontVariantNumeric: 'tabular-nums' }}>${r.y != null ? r.y.toFixed(2) : '—'}</td>
                  <td style=${{ padding: '6px 10px', fontVariantNumeric: 'tabular-nums' }}>${r.z != null ? r.z.toFixed(2) : '—'}</td>
                </tr>
              `)}
            </tbody>
          </table>
        `}
      </div>
    <//>
  `;
}

function SectionsListPanel({ open, onClose, sections, onOpen, onDelete }) {
  if (!open) return null;
  return html`
    <div style=${{ position: 'absolute', top: '44px', right: '16px', zIndex: 20, width: '260px', maxHeight: '60vh', overflow: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', padding: '12px', fontSize: '12px' }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <span style=${{ fontWeight: 700, color: 'var(--text-primary)' }}>Сохранённые разрезы</span>
        <${Button} variant="ghost" size="sm" icon onClick=${onClose}>✕<//>
      </div>
      ${!sections.length
        ? html`<div style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Пока нет сохранённых разрезов.</div>`
        : sections.map((s) => html`
          <div key=${s.id} style=${{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 0', borderBottom: '1px solid var(--border-subtle)' }}>
            <span style=${{ flex: 1, cursor: 'pointer', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick=${() => onOpen(s)}>${s.name}</span>
            <${Button} variant="ghost" size="sm" icon onClick=${() => onDelete(s.id)}><${Trash2} size=${12} style=${{ color: 'var(--red-500)' }} /><//>
          </div>
        `)}
    <//>
  `;
}

function SectionModal({ data, sectionRec, name, setName, onSave, onDelete, onClose, saving, error }) {
  if (!data) return null;
  const chartData = data.terrain.points.map((p) => ({ s: Math.round(p.s), z: p.z }));
  const waterByS = {};
  if (data.water) data.water.points.forEach((p) => { waterByS[Math.round(p.s)] = p.z; });
  const merged = chartData.map((p) => ({ ...p, water: waterByS[p.s] }));
  const zs = data.terrain.points.map((p) => p.z);
  const zMin = Math.min(...zs), zMax = Math.max(...zs);

  return html`
    <${Dialog} open=${true} onClose=${onClose} title="Вертикальный разрез" width="min(900px, 95vw)"
      footer=${html`
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, marginRight: '8px' }}>
          <${Input} value=${name} onChange=${(e) => setName(e.target.value)} placeholder="Название разреза" />
          ${error && html`<span style=${{ fontSize: '11px', color: 'var(--red-500)' }}>${error}</span>`}
        </div>
        ${sectionRec && html`<${Button} variant="ghost" onClick=${() => onDelete(sectionRec.id)}><${Trash2} size=${14} style=${{ color: 'var(--red-500)' }} /> Удалить<//>`}
        <${Button} onClick=${onSave} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить'}<//>
      `}>
      <div style=${{ display: 'flex', gap: '18px', flexWrap: 'wrap', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' }}>
        <span>Длина: <b style=${{ color: 'var(--text-primary)' }}>${data.terrain.length.toFixed(0)} м</b></span>
        <span>Рельеф: <b style=${{ color: 'var(--text-primary)' }}>${zMin.toFixed(1)} – ${zMax.toFixed(1)} м</b></span>
        ${data.water && data.water.points.length
          ? html`<span style=${{ color: 'var(--blue-600)' }}>● уровень подземных вод показан на графике</span>`
          : html`<span style=${{ color: 'var(--text-tertiary)' }}>Изогипсы не построены — показан только рельеф</span>`}
      </div>
      <div style=${{ width: '100%', height: '380px' }}>
        <${ResponsiveContainer}>
          <${ComposedChart} data=${merged} margin=${{ left: 0, right: 10, top: 4, bottom: 0 }}>
            <${CartesianGrid} vertical=${false} stroke="var(--border-subtle)" />
            <${XAxis} dataKey="s" tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} label=${{ value: 'Расстояние, м', position: 'insideBottom', offset: -2, fontSize: 11, fill: 'var(--text-tertiary)' }} />
            <${YAxis} domain=${['auto', 'auto']} tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} axisLine=${false} tickLine=${false} width=${46} label=${{ value: 'Отметка, м', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--text-tertiary)' }} />
            <${Tooltip} contentStyle=${{ fontSize: 11, borderRadius: 8, border: '1px solid var(--border)' }} formatter=${(v, n) => [v != null ? v.toFixed(1) + ' м' : '—', n]} />
            <${Legend} wrapperStyle=${{ fontSize: 11 }} />
            <${Area} type="monotone" dataKey="z" name="Рельеф" stroke="var(--gold-600)" fill="var(--gold-400)" fillOpacity=${0.35} strokeWidth=${2} dot=${false} isAnimationActive=${false} />
            ${data.water && html`<${Line} type="monotone" dataKey="water" name="Уровень подземных вод" stroke="var(--blue-500)" strokeDasharray="6 4" strokeWidth=${2} dot=${false} connectNulls isAnimationActive=${false} />`}
          <//>
        <//>
      </div>
    <//>
  `;
}

function ContourSettingsPanel({ open, onClose, style, onChange, manualStep, setManualStep, lastAutoStep }) {
  if (!open) return null;
  const isAuto = manualStep == null;
  const isGradientLike = style.renderMode === 'fill' || style.renderMode === 'gradient';

  return html`
    <div style=${{ position: 'absolute', top: '44px', right: '16px', zIndex: 20, width: '280px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', padding: '14px', fontSize: '12px' }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style=${{ fontWeight: 700, color: 'var(--text-primary)' }}>Настройки изогипс</span>
        <${Button} variant="ghost" size="sm" icon onClick=${onClose}>✕<//>
      </div>

      <div style=${{ marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid var(--border-subtle)' }}>
        <label style=${{ display: 'flex', alignItems: 'center', gap: '7px', fontWeight: 600, marginBottom: '8px', cursor: 'pointer' }}>
          <input type="checkbox" checked=${style.visible} onChange=${(e) => onChange({ ...style, visible: e.target.checked })} />
          Показывать изогипсы
        </label>
        <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <span style=${{ color: 'var(--text-tertiary)' }}>Отображение</span>
          <${Select} value=${style.renderMode} onChange=${(e) => onChange({ ...style, renderMode: e.target.value })} style=${{ fontSize: '12px', padding: '3px 6px' }}>
            <option value="lines">Линии</option>
            <option value="fill">Заливка (по уровням)</option>
            <option value="gradient">Градиент</option>
          <//>
        </div>
        <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          Прозр. <input type="range" min="0" max="100" value=${Math.round(style.opacity * 100)} onChange=${(e) => onChange({ ...style, opacity: e.target.value / 100 })} style=${{ width: '90px' }} /> ${Math.round(style.opacity * 100)}%
        </span>
        ${isGradientLike && html`
          <label style=${{ display: 'flex', alignItems: 'center', gap: '7px', marginTop: '8px', cursor: 'pointer' }}>
            <input type="checkbox" checked=${!!style.showBoundaries} onChange=${(e) => onChange({ ...style, showBoundaries: e.target.checked })} />
            Показывать границы уровней
          </label>
        `}
      </div>

      <div style=${{ marginBottom: '10px', paddingBottom: '10px', borderBottom: '1px solid var(--border-subtle)' }}>
        <div style=${{ color: 'var(--text-tertiary)', marginBottom: '6px' }}>Цвет по высотным отметкам (мин. → макс. уровень)</div>
        <div style=${{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          ${style.colors.map((c, i) => html`
            <div key=${i} style=${{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <input type="color" value=${c} onChange=${(e) => { const next = style.colors.slice(); next[i] = e.target.value; onChange({ ...style, colors: next }); }} style=${{ width: '26px', height: '22px', border: '1px solid var(--border)', borderRadius: '4px', padding: 0, cursor: 'pointer' }} />
              <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)', flex: 1 }}>${i === 0 ? 'мин. уровень' : i === style.colors.length - 1 ? 'макс. уровень' : 'ступень ' + i}</span>
              ${style.colors.length > 2 && html`<${Button} variant="ghost" size="sm" icon onClick=${() => onChange({ ...style, colors: style.colors.filter((_, j) => j !== i) })}>✕<//>`}
            </div>
          `)}
        </div>
        <div style=${{ height: '12px', borderRadius: '4px', marginTop: '8px', background: 'linear-gradient(to right, ' + style.colors.join(', ') + ')' }} />
        <a href="#" onClick=${(e) => { e.preventDefault(); onChange({ ...style, colors: [...style.colors, '#ffffff'] }); }} style=${{ display: 'inline-block', marginTop: '8px', fontSize: '11px', color: 'var(--gold-600)' }}>+ добавить цвет</a>
        ${!isGradientLike && html`<div style=${{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '6px' }}>Применяется и к линиям — переключите «Отображение» на «Заливку» или «Градиент», чтобы увидеть закрашенную поверхность.</div>`}
      </div>

      <div>
        <label style=${{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', cursor: 'pointer' }}>
          <input type="radio" name="pit3d-step-mode" checked=${isAuto} onChange=${() => setManualStep(null)} />
          Автоматический шаг${lastAutoStep ? ' (сейчас: ' + lastAutoStep + ' м)' : ''}
        </label>
        <label style=${{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
          <input type="radio" name="pit3d-step-mode" checked=${!isAuto} onChange=${() => setManualStep(lastAutoStep || 5)} />
          Свой шаг, м:
          <input type="number" min="0.1" step="0.1" value=${isAuto ? '' : manualStep} disabled=${isAuto}
            onChange=${(e) => { const n = parseFloat(e.target.value); if (!isNaN(n) && n > 0) setManualStep(n); }}
            style=${{ width: '64px', border: '1px solid var(--border)', borderRadius: '4px', padding: '2px 5px' }} />
        </label>
      </div>
    <//>
  `;
}

// Отдельная панель (своя кнопка в тулбаре) — какие именно точки замеров участвуют в расчёте
// изогипс. Раньше жила внутри «Настроек изогипс» вместе с видом отображения — разнесена, так
// как это разные по смыслу настройки: одна про то, КАК рисовать, другая про то, ПО ЧЕМ считать.
// Группировка — по слою (см. pointGroupLabel), чтобы совпадать с панелью «Слои» внизу экрана.
function ContourPointsPanel({ open, onClose, excludedIds, setExcludedIds, candidates }) {
  if (!open) return null;
  const groups = {};
  candidates.forEach((p) => { const g = pointGroupLabel(p); (groups[g] = groups[g] || []).push(p); });

  return html`
    <div style=${{ position: 'absolute', top: '44px', right: '16px', zIndex: 20, width: '300px', maxHeight: '70vh', overflow: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', padding: '14px', fontSize: '12px' }}>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style=${{ fontWeight: 700, color: 'var(--text-primary)' }}>Точки для расчёта</span>
        <${Button} variant="ghost" size="sm" icon onClick=${onClose}>✕<//>
      </div>

      <div style=${{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '6px' }}>
        ${candidates.length - excludedIds.length} из ${candidates.length}
      </div>
      <div style=${{ marginBottom: '8px', fontSize: '11px' }}>
        <a href="#" onClick=${(e) => { e.preventDefault(); setExcludedIds([]); }} style=${{ color: 'var(--gold-600)' }}>все</a>
        ·
        <a href="#" onClick=${(e) => { e.preventDefault(); setExcludedIds(candidates.map((p) => p.id)); }} style=${{ color: 'var(--gold-600)' }}>ничего</a>
      </div>

      ${!candidates.length && html`<div style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Нет точек с координатами и известной отметкой.</div>`}
      ${Object.keys(groups).sort().map((label) => html`
        <div key=${label + '-h'} style=${{ fontSize: '11px', color: 'var(--text-tertiary)', margin: '8px 0 4px' }}>${label}</div>
        ${groups[label].map((p) => html`
          <label key=${p.id} style=${{ display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked=${!excludedIds.includes(p.id)}
              onChange=${(e) => setExcludedIds(e.target.checked ? excludedIds.filter((id) => id !== p.id) : [...excludedIds, p.id])} />
            <span style=${{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${p.name}</span>
            <span style=${{ color: 'var(--text-tertiary)', flexShrink: 0 }}>${p.z.toFixed(1)} м</span>
          </label>
        `)}
      `)}
    <//>
  `;
}

function StatsPanel({ model, waterPoints, contourPointCount }) {
  const b = model.bbox;
  const byLabel = {};
  waterPoints.forEach((p) => { byLabel[p.label] = (byLabel[p.label] || 0) + 1; });
  function row(label, val) {
    return html`<div style=${{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}><span>${label}</span><span style=${{ color: 'var(--text-primary)', fontWeight: 600, textAlign: 'right' }}>${val}</span></div>`;
  }
  return html`
    <div style=${{ width: '230px', flexShrink: 0, padding: '14px', fontSize: '12px', color: 'var(--text-tertiary)', borderLeft: '1px solid var(--border-subtle)', overflow: 'auto' }}>
      <div style=${{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '10px' }}>Модель рельефа</div>
      ${row('Файл', model.fileName || '—')}
      ${row('Стринги', (model.stringerCount || 0).toLocaleString('ru-RU'))}
      ${row('Вершины', (model.vertexCount || 0).toLocaleString('ru-RU'))}
      ${row('Треугольники TIN', Math.round(model.triangles.length / 3).toLocaleString('ru-RU'))}
      ${b && row('Z мин / макс', b.zMin.toFixed(1) + ' / ' + b.zMax.toFixed(1) + ' м')}
      ${b && row('Размер X×Y', Math.round(b.xMax - b.xMin).toLocaleString('ru-RU') + ' × ' + Math.round(b.yMax - b.yMin).toLocaleString('ru-RU') + ' м')}
      ${model.outlierCount ? html`
        <div style=${{ fontSize: '11px', color: 'var(--amber-600)', marginTop: '8px', lineHeight: 1.5 }}>
          ⚠ ${model.outlierCount.toLocaleString('ru-RU')} точек лежат далеко за пределами основного массива (возможно, отдельный объект в файле). Вид и масштаб построены по основному скоплению точек — эти данные не потеряны, но могут быть не видны в исходном ракурсе.
        </div>
      ` : ''}

      <div style=${{ fontWeight: 700, color: 'var(--text-primary)', margin: '16px 0 8px' }}>Точки на модели</div>
      ${row('Всего', waterPoints.length)}
      ${Object.keys(byLabel).sort().map((k) => row(k, byLabel[k]))}
      ${!waterPoints.length ? html`<div style=${{ fontSize: '11px', marginTop: '6px' }}>Нет точек реестра/списка точек с координатами внутри границ модели.</div>` : ''}

      <div style=${{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', fontSize: '11px' }}>
        <span style=${{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#60a5fa', marginRight: '5px' }} />Реестр водопунктов<br />
        <span style=${{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#22d3ee', marginRight: '5px', marginTop: '4px' }} />Список точек (водопроявления)<br />
        <span style=${{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#fb923c', marginRight: '5px', marginTop: '4px' }} />Зумпфы (Журнал Водоотлива)
      </div>

      <div style=${{ fontWeight: 700, color: 'var(--text-primary)', margin: '16px 0 8px' }}>Изогипсы подземных вод</div>
      ${contourPointCount
        ? html`<div style=${{ fontSize: '11px', lineHeight: 1.5 }}>Построены по ${contourPointCount} точкам с известной отметкой уровня воды — при малом числе точек изогипсы приблизительные.</div>`
        : html`<div style=${{ fontSize: '11px', lineHeight: 1.5 }}>Включите отображение в панели «Изогипсы» (кнопка в тулбаре), чтобы построить.</div>`}
    </div>
  `;
}

export function Pit3DPage() {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const nearestZRef = useRef(() => 0);
  const [status, setStatus] = useState('loading'); // loading | no-model | ready | error
  const [errorMsg, setErrorMsg] = useState('');
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploadBusy, setUploadBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [terrainOpacity, setTerrainOpacity] = useState(1);
  const [layerStyle, setLayerStyle] = useState(loadLayerStyle);
  const [tableDef, setTableDef] = useState(null);
  const [model, setModel] = useState(null);
  const [waterPoints, setWaterPoints] = useState([]);
  const [sources, setSources] = useState(null);
  const [weekFilter, setWeekFilter] = useState(null);
  const [manualStep, setManualStep] = useState(loadManualStep);
  const [excludedIds, setExcludedIds] = useState(loadExcluded);
  const [lastAutoStep, setLastAutoStep] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [sectionPicking, setSectionPickingState] = useState(false);
  const [sectionData, setSectionData] = useState(null);
  const [sectionRec, setSectionRec] = useState(null); // сохранённый разрез, если открыт из списка (для переименования/удаления)
  const [sectionName, setSectionName] = useState('');
  const [sectionSaving, setSectionSaving] = useState(false);
  const [sectionError, setSectionError] = useState('');
  const [savedSections, setSavedSections] = useState([]);
  const [sectionsListOpen, setSectionsListOpen] = useState(false);
  const [sensorReadings, setSensorReadings] = useState({});
  const layerStyleRef = useRef(layerStyle);
  layerStyleRef.current = layerStyle;
  const sectionPointsRef = useRef({ a: null, b: null });
  const horizontalWellsRef = useRef([]); // скважины из "Гор. скважины" (wells) — грузятся один раз при монтировании модели

  function updateLayer(key, next) {
    setLayerStyle((prev) => {
      const merged = { ...prev, [key]: next };
      saveLayerStyle(merged);
      return merged;
    });
  }
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.rebuildMarkers(layerStyleRef.current);
    scene.rebuildWells(layerStyleRef.current);
    if (scene.contourData) {
      const st = layerStyleRef.current.isohypses;
      scene.addContourToScene(st.opacity, st.renderMode, st.colors, st.showBoundaries);
      scene.setContourVisible(st.visible);
    }
  }, [layerStyle]);
  useEffect(() => { if (sceneRef.current) sceneRef.current.setWireframeVisible(wireframe); }, [wireframe]);
  useEffect(() => { if (sceneRef.current) sceneRef.current.setTerrainOpacity(terrainOpacity); }, [terrainOpacity]);
  useEffect(() => { saveManualStep(manualStep); }, [manualStep]);
  useEffect(() => { saveExcluded(excludedIds); }, [excludedIds]);

  // Точки VWP-датчиков пьезометрических скважин, переведённые в абс. отметку уровня воды —
  // участвуют в расчёте изогипс так же, как обычные замеры УПВ (своего маркера на модели нет,
  // датчик уже виден как точка на стволе скважины).
  const vwpCandidates = useMemo(() => buildVwpCandidates(horizontalWellsRef.current, sensorReadings), [model, sensorReadings]);

  // Пересобирает точки мониторинга + изогипсы при смене источников, недели или настроек
  // изогипс — без повторной загрузки самой 3D-модели рельефа.
  useEffect(() => {
    if (!sources || !sceneRef.current) return;
    const scene = sceneRef.current;
    const wp = buildWaterPoints(sources, weekFilter);
    const markerPoints = wp.map((p) => (p.z == null ? { ...p, z: nearestZRef.current(p.x, p.y) } : p));
    const registryShafts = buildRegistryWellShafts(sources, nearestZRef.current);
    scene.setData({ waterPoints: markerPoints, wellTrajectories: [...horizontalWellsRef.current, ...registryShafts] });
    scene.rebuildMarkers(layerStyleRef.current);
    scene.rebuildWells(layerStyleRef.current);
    setWaterPoints(markerPoints);

    const candidates = [...wp.filter((p) => p.z != null), ...vwpCandidates].filter((p) => !excludedIds.includes(p.id));
    scene.buildContours(candidates, manualStep).then((contourData) => {
      setLastAutoStep(scene.lastAutoStep || null);
      setLayerStyle((prev) => ({ ...prev, isohypses: { ...prev.isohypses, _pointCount: contourData ? contourData.pointCount : 0 } }));
      if (contourData) {
        const st = layerStyleRef.current.isohypses;
        scene.addContourToScene(st.opacity, st.renderMode, st.colors, st.showBoundaries);
        scene.setContourVisible(st.visible);
      }
    });
  }, [sources, weekFilter, manualStep, excludedIds, vwpCandidates]);

  async function mountModel(m) {
    const scene = new PitScene(containerRef.current);
    await scene.init(m);
    sceneRef.current = scene;
    scene.setWireframeVisible(wireframe);
    scene.setTerrainOpacity(terrainOpacity);
    setModel(m);

    function nearestZ(x, y) {
      let best = Infinity, bestZ = m.bbox ? (m.bbox.zMin + m.bbox.zMax) / 2 : 0;
      for (let i = 0; i < m.xs.length; i += Math.max(1, Math.floor(m.xs.length / 4000))) {
        const dx = m.xs[i] - x, dy = m.ys[i] - y, d = dx * dx + dy * dy;
        if (d < best) { best = d; bestZ = m.zs[i]; }
      }
      return bestZ;
    }
    nearestZRef.current = nearestZ;

    const [wpSources, wellTrajectories, sections, readings] = await Promise.all([
      fetchWaterPointSources(),
      fetchWellTrajectories(nearestZ).catch((e) => { console.warn('[pit3d] wells fetch failed:', e.message); return []; }),
      fetchSections().catch(() => []),
      fetchLatestSensorReadings().catch((e) => { console.warn('[pit3d] sensor readings fetch failed:', e.message); return {}; }),
    ]);
    horizontalWellsRef.current = wellTrajectories;
    scene.setData({ waterPoints: [], wellTrajectories });
    scene.rebuildWells(layerStyleRef.current);
    setSavedSections(sections);
    setSensorReadings(readings);
    setStatus('ready');
    setSources(wpSources); // триггерит эффект выше — построит точки и изогипсы
  }

  function startSectionPicking() {
    const scene = sceneRef.current;
    if (!scene) return;
    if (sectionPicking) { scene.setSectionPicking(false); setSectionPickingState(false); return; } // повторный клик — отмена
    scene.clearSectionMarkers();
    sectionPointsRef.current = { a: null, b: null };
    setSectionPickingState(true);
    scene.setSectionPicking(true, handleSectionPick);
  }

  function handleSectionPick(x, y) {
    const scene = sceneRef.current;
    if (!scene) return;
    const pts = sectionPointsRef.current;
    if (!pts.a) {
      pts.a = { x, y };
      scene.addSectionMarker(x, y, 0xf59e0b);
    } else if (!pts.b) {
      pts.b = { x, y };
      scene.addSectionMarker(x, y, 0xef4444);
      scene.addSectionLine(pts.a, pts.b);
      scene.setSectionPicking(false);
      setSectionPickingState(false);
      const data = scene.computeSectionData(pts.a.x, pts.a.y, pts.b.x, pts.b.y);
      setSectionRec(null);
      setSectionName('Разрез ' + new Date().toLocaleDateString('ru-RU'));
      setSectionData(data);
    }
  }

  function openSavedSection(rec) {
    setSectionsListOpen(false);
    const scene = sceneRef.current;
    if (!scene) return;
    scene.clearSectionMarkers();
    scene.addSectionMarker(rec.ax, rec.ay, 0xf59e0b);
    scene.addSectionMarker(rec.bx, rec.by, 0xef4444);
    scene.addSectionLine({ x: rec.ax, y: rec.ay }, { x: rec.bx, y: rec.by });
    sectionPointsRef.current = { a: { x: rec.ax, y: rec.ay }, b: { x: rec.bx, y: rec.by } };
    const data = scene.computeSectionData(rec.ax, rec.ay, rec.bx, rec.by);
    setSectionRec(rec);
    setSectionName(rec.name);
    setSectionData(data);
  }

  async function handleSaveSection() {
    const pts = sectionPointsRef.current;
    if (!pts.a || !pts.b) return;
    setSectionSaving(true);
    setSectionError('');
    try {
      const id = sectionRec ? sectionRec.id : ('sec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
      const rec = { id, name: sectionName.trim() || 'Разрез ' + new Date().toLocaleDateString('ru-RU'), ax: pts.a.x, ay: pts.a.y, bx: pts.b.x, by: pts.b.y };
      await saveSection(rec);
      setSavedSections((prev) => { const idx = prev.findIndex((s) => s.id === id); const next = idx === -1 ? [rec, ...prev] : prev.map((s) => (s.id === id ? rec : s)); return next; });
      setSectionRec(rec);
    } catch (e) {
      setSectionError(e.message || String(e));
    } finally {
      setSectionSaving(false);
    }
  }

  async function handleDeleteSection(id) {
    try {
      await deleteSection(id);
      setSavedSections((prev) => prev.filter((s) => s.id !== id));
      if (sectionRec && sectionRec.id === id) { setSectionData(null); setSectionRec(null); }
    } catch (e) {
      setSectionError(e.message || String(e));
    }
  }

  function closeSectionModal() {
    setSectionData(null);
    setSectionRec(null);
    setSectionError('');
    if (sceneRef.current) sceneRef.current.clearSectionMarkers();
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await fetchModel();
        if (!m || !m.xs || !m.xs.length) { if (!cancelled) setStatus('no-model'); return; }
        if (!cancelled) await mountModel(m);
      } catch (e) {
        if (!cancelled) { setErrorMsg(e.message || String(e)); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; if (sceneRef.current) sceneRef.current.dispose(); };
  }, []);

  async function onFileInput(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setUploadBusy(true);
    try {
      setUploadStatus(`Чтение файла (${(file.size / 1024 / 1024).toFixed(1)} МБ)...`);
      const text = await file.text();
      setUploadStatus('Парсинг DXF... для больших файлов может занять до минуты');
      await new Promise((r) => setTimeout(r, 20));
      const parsed = parseDXF(text);
      if (!parsed.vertexCount) { setUploadStatus('В файле не найдено 3D-полилиний (стрингов POLYLINE/VERTEX). Проверьте формат экспорта.'); setUploadBusy(false); return; }

      setUploadStatus(`Триангуляция рельефа (${parsed.vertexCount.toLocaleString('ru-RU')} точек)...`);
      await new Promise((r) => setTimeout(r, 20));
      const tin = await buildTIN(parsed.xs, parsed.ys, parsed.zs);
      const bbox = computeBBox(tin.xs, tin.ys, tin.zs);
      const robustBBox = computeRobustBBox(tin.xs, tin.ys, tin.zs);
      const outlierCount = countOutliers(tin.xs, tin.ys, robustBBox);

      const newModel = {
        xs: tin.xs, ys: tin.ys, zs: tin.zs, triangles: tin.triangles, bbox, robustBBox, outlierCount,
        stringerCount: parsed.stringerCount, vertexCount: parsed.vertexCount,
        fileName: file.name, uploadedAt: new Date().toISOString(),
      };

      setUploadStatus('Сохранение модели в общем хранилище...');
      await uploadModel(newModel);

      if (sceneRef.current) sceneRef.current.dispose();
      sceneRef.current = null;
      await mountModel(newModel);
      setUploadStatus(`✓ Готово! ${parsed.vertexCount.toLocaleString('ru-RU')} точек, ${Math.round(tin.triangles.length / 3).toLocaleString('ru-RU')} треугольников`);
    } catch (err) {
      setUploadStatus('Ошибка обработки файла: ' + err.message);
    } finally {
      setUploadBusy(false);
    }
  }

  async function handleDelete() {
    setConfirmDelete(false);
    if (sceneRef.current) { sceneRef.current.dispose(); sceneRef.current = null; }
    await deleteModel();
    setModel(null);
    setWaterPoints([]);
    setSources(null);
    setWeekFilter(null);
    setStatus('no-model');
  }

  const weeks = useMemo(() => (sources ? availableWeeks(sources.points) : []), [sources]);
  const contourCandidates = useMemo(() => (sources ? [...buildWaterPoints(sources, weekFilter).filter((p) => p.z != null), ...vwpCandidates] : []), [sources, weekFilter, vwpCandidates]);

  const tableRows = tableDef ? (() => {
    if (tableDef.special) return [];
    if (tableDef.key === 'wells_drainage' || tableDef.key === 'wells_piezo') {
      const scene = sceneRef.current;
      if (!scene) return [];
      const isPiezo = tableDef.key === 'wells_piezo';
      return scene.wellTrajectories.filter((w) => w.isPiezo === isPiezo).map((w) => {
        const extra = [];
        if (w.depth != null) extra.push(w.depth + ' м');
        if (w.azimuth != null) extra.push('аз. ' + w.azimuth + '°');
        if (w.inclination != null) extra.push('накл. ' + w.inclination + '°');
        return { name: w.name, label: (isPiezo ? 'Пьезометрическая' : 'Дренажная') + (extra.length ? ' · ' + extra.join(', ') : ''), x: w.collar.x, y: w.collar.y, z: w.collar.z };
      });
    }
    return waterPoints.filter((p) => p.layerKey === tableDef.key);
  })() : [];

  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div class="pilot-strip">
        <${Box} size=${14} />
        Пилот: модель и разрезы хранятся в общем облаке (видны всем) — раньше жили только в браузере того, кто их создал.
      </div>

      ${status === 'ready' && html`
        <div style=${{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap', position: 'relative' }}>
          <label class="btn btn-outline btn-sm" style=${{ cursor: uploadBusy ? 'default' : 'pointer' }}>
            <input type="file" accept=".dxf" style=${{ display: 'none' }} onChange=${onFileInput} disabled=${uploadBusy} />
            <${Upload} size=${13} /> Загрузить другой DXF
          </label>
          <label style=${{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            <input type="checkbox" checked=${wireframe} onChange=${(e) => setWireframe(e.target.checked)} /> Каркас
          </label>
          <span style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }} title="Прозрачность поверхности рельефа — чтобы видеть изогипсы сквозь модель">
            Прозрачность
            <input type="range" min="0" max="100" value=${Math.round((1 - terrainOpacity) * 100)} onChange=${(e) => setTerrainOpacity(1 - e.target.value / 100)} style=${{ width: '80px' }} />
            <span style=${{ minWidth: '34px', color: 'var(--text-tertiary)' }}>${Math.round((1 - terrainOpacity) * 100)}%</span>
          </span>
          ${weeks.length > 0 && html`
            <${Select} value=${weekFilter || ''} onChange=${(e) => setWeekFilter(e.target.value || null)} style=${{ fontSize: '12px', padding: '4px 8px' }} title="Показать точки водопроявлений за выбранную неделю">
              <option value="">Неделя: последние данные</option>
              ${weeks.map((w) => html`<option key=${w} value=${w}>${weekLabel(w)}<//>`)}
            <//>
          `}
          <${Button} variant=${settingsOpen ? 'outline' : 'ghost'} size="sm" onClick=${() => { setSettingsOpen((v) => !v); setPointsOpen(false); setSectionsListOpen(false); }}><${Settings2} size=${13} /> Изогипсы<//>
          <${Button} variant=${pointsOpen ? 'outline' : 'ghost'} size="sm" onClick=${() => { setPointsOpen((v) => !v); setSettingsOpen(false); setSectionsListOpen(false); }}><${ListChecks} size=${13} /> Точки для расчёта<//>
          <${Button} variant="ghost" size="sm" onClick=${() => sceneRef.current && sceneRef.current.resetView()}><${RotateCcw} size=${13} /> Сброс вида<//>
          <${Button} variant=${sectionPicking ? 'outline' : 'ghost'} size="sm" onClick=${startSectionPicking}><${Scissors} size=${13} /> ${sectionPicking ? 'Кликните на модель… (ещё раз — отмена)' : 'Разрез'}<//>
          <${Button} variant=${sectionsListOpen ? 'outline' : 'ghost'} size="sm" onClick=${() => { setSectionsListOpen((v) => !v); setSettingsOpen(false); setPointsOpen(false); }}><${ListTree} size=${13} /> Разрезы (${savedSections.length})<//>
          <${Button} variant="ghost" size="sm" onClick=${() => setConfirmDelete(true)} style=${{ marginLeft: 'auto' }}><${Trash2} size=${13} style=${{ color: 'var(--red-500)' }} /> Удалить модель<//>
          ${uploadStatus && html`<span style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>${uploadStatus}</span>`}
          <${ContourSettingsPanel} open=${settingsOpen} onClose=${() => setSettingsOpen(false)} style=${layerStyle.isohypses} onChange=${(next) => updateLayer('isohypses', next)} manualStep=${manualStep} setManualStep=${setManualStep} lastAutoStep=${lastAutoStep} />
          <${ContourPointsPanel} open=${pointsOpen} onClose=${() => setPointsOpen(false)} excludedIds=${excludedIds} setExcludedIds=${setExcludedIds} candidates=${contourCandidates} />
          <${SectionsListPanel} open=${sectionsListOpen} onClose=${() => setSectionsListOpen(false)} sections=${savedSections} onOpen=${openSavedSection} onDelete=${handleDeleteSection} />
        </div>
      `}
      ${status !== 'ready' && uploadStatus && html`<div style=${{ padding: '8px 16px', fontSize: '12px', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-subtle)' }}>${uploadStatus}</div>`}

      ${status === 'loading' && html`
        <div style=${{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style=${{ color: 'var(--text-tertiary)', fontSize: 13 }}>Загрузка модели…</div>
        </div>
      `}
      ${status === 'no-model' && html`
        <div style=${{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <${EmptyState}
            icon=${html`<${Box} size=${40} />`}
            title="Модель карьера не найдена"
            description=${html`
              <div style=${{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <span>Загрузите файл DXF со стрингами рельефа карьера (POLYLINE/VERTEX), чтобы построить 3D-модель.</span>
                <label class="btn btn-outline btn-sm" style=${{ cursor: uploadBusy ? 'default' : 'pointer' }}>
                  <input type="file" accept=".dxf" style=${{ display: 'none' }} onChange=${onFileInput} disabled=${uploadBusy} />
                  <${Upload} size=${13} /> Загрузить DXF
                </label>
              </div>
            `}
          />
        </div>
      `}
      ${status === 'error' && html`
        <div style=${{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <${EmptyState} icon=${html`<${Box} size=${40} />`} title="Не удалось загрузить модель" description=${errorMsg} />
        </div>
      `}

      <div style=${{ flex: 1, minHeight: 0, display: status === 'ready' ? 'flex' : 'none' }}>
        <div ref=${containerRef} style=${{ flex: 1, position: 'relative', minWidth: 0 }} />
        ${status === 'ready' && model && html`<${StatsPanel} model=${model} waterPoints=${waterPoints.filter((p) => { const st = layerStyle[p.layerKey]; return !st || st.visible; })} contourPointCount=${layerStyle.isohypses._pointCount} />`}
      </div>

      ${status === 'ready' && html`
        <div style=${{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', maxHeight: '32%', overflow: 'auto', flexShrink: 0 }}>
          <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', fontWeight: 700, fontSize: '13px' }}>
            <${Layers} size=${15} /> Слои
          </div>
          <div style=${{ padding: '0 16px' }}>
            ${PIT3D_LAYER_DEFS.filter((def) => !def.special).map((def) => html`<${LayerRow} key=${def.key} def=${def} style=${layerStyle} onChange=${(next) => updateLayer(def.key, next)} onOpenTable=${setTableDef} />`)}
          </div>
        </div>
      `}

      <${LayerTableDialog} def=${tableDef} rows=${tableRows} onClose=${() => setTableDef(null)} />

      <${Dialog} open=${confirmDelete} onClose=${() => setConfirmDelete(false)} title="Удалить 3D-модель карьера?"
        footer=${html`
          <${Button} variant="ghost" onClick=${() => setConfirmDelete(false)}>Отмена<//>
          <${Button} onClick=${handleDelete} style=${{ background: 'var(--red-500)', borderColor: 'var(--red-500)' }}>Удалить<//>
        `}>
        <p style=${{ fontSize: '13px', color: 'var(--text-secondary)' }}>Модель будет удалена из общего хранилища для всех пользователей. Понадобится загрузить DXF заново.</p>
      <//>

      <${SectionModal} data=${sectionData} sectionRec=${sectionRec} name=${sectionName} setName=${setSectionName} onSave=${handleSaveSection} onDelete=${handleDeleteSection} onClose=${closeSectionModal} saving=${sectionSaving} error=${sectionError} />
    </div>
  `;
}
