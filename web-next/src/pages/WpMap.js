import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, Settings, RefreshCw, Tag, Ruler, X, MapPin, Satellite, Map as MapIcon, Mountain, AlertTriangle,
  FlaskConical, Pencil, Trash2, ListChecks, Download,
} from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { WP_TYPES, WP_SHAPE_OPTIONS, WP_SHAPE_LABELS, loadWpTypeSettings, saveWpTypeSettings } from '../lib/wp-types.js';
import { loadLeaflet } from '../lib/leaflet-loader.js';
import { makeWpIcon, makeClusterLayer } from '../lib/wpmap-markers.js';
import { wgsToAll, sk42ToWgs, ddToDms, CALC_ZONE, CALC_OFF } from '../lib/coord-calc.js';
import { CHEM_PARAMS, CHEM_PARAM_MAP, CHEM_GROUPS } from '../lib/chem-params.js';
import {
  calcMeq, classifyWaterType, buildKurlovHtml, idw, buildChemRaster, exportChemMapPng,
  getRamp, ALEKIN_FACIES, PALETTES, STEP_PRESETS, DIVISION_PRESETS,
} from '../lib/chem-map-core.js';
import { Button, Select, Input, Badge, EmptyState } from '../components/ui.js';

const TILE_LAYERS = {
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 19, attribution: 'Tiles © Esri' },
  street: { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: '© OpenStreetMap contributors' },
  topo: { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', maxZoom: 17, attribution: '© OpenTopoMap contributors' },
};
const REF_LAYER_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const BOUNDARY_COLOR = '#B5851C';
const CHEM_EXCLUDE_KEY = 'wpm-chem-excluded';
const CHEM_PALETTE_KEY = 'wpm-chem-palette';

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(str) {
  if (!str) return '—';
  const parts = str.slice(0, 10).split('-');
  return parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : str;
}
function quarterOf(p) {
  if (p.quarter) return p.quarter;
  if (!p.sampled_at) return null;
  const m = parseInt(p.sampled_at.slice(5, 7), 10);
  return m ? Math.ceil(m / 3) : null;
}
function loadChemExcluded() {
  try { return JSON.parse(localStorage.getItem(CHEM_EXCLUDE_KEY) || '{}'); } catch { return {}; }
}
function saveChemExcluded(v) { try { localStorage.setItem(CHEM_EXCLUDE_KEY, JSON.stringify(v)); } catch { /* ignore */ } }
function loadChemPalette() { try { return localStorage.getItem(CHEM_PALETTE_KEY) || 'classic'; } catch { return 'classic'; } }
function saveChemPalette(v) { try { localStorage.setItem(CHEM_PALETTE_KEY, v); } catch { /* ignore */ } }

function popupHtml(item, t) {
  let rows = '';
  const row = (l, v) => `<div class="wpm-popup-row"><span class="wpm-popup-lbl">${esc(l)}</span><span class="wpm-popup-val">${esc(v)}</span></div>`;
  if (item.code) rows += row('Код', item.code);
  if (item.aquifer) rows += row('Водонос.', item.aquifer);
  if (item.depth) rows += row('Глубина', item.depth + ' м');
  if (item.lat && item.lng) rows += row('WGS-84', Number(item.lat).toFixed(5) + ', ' + Number(item.lng).toFixed(5));
  if (item.coord_x != null && item.coord_y != null) rows += row('Местн.', `X:${item.coord_x} Y:${item.coord_y}`);
  return `<div class="wpm-popup-title">${esc(item.name)}</div>` +
    `<div class="wpm-popup-type" style="background:${t.color}22;color:${t.color}">${esc(t.label)}</div>` + rows;
}

function chemClickPopupHtml(e, built, chemParamKey) {
  const lat = e.latlng.lat, lng = e.latlng.lng;
  const withDist = built.proj.map((p) => {
    const dLat = p.lat - lat, dLng = (p.lng - lng) * built.cosLat;
    return { p, km: Math.sqrt(dLat * dLat + dLng * dLng) * 111.2 };
  }).sort((a, b) => a.km - b.km);
  const nearest = withDist.slice(0, 3);

  let title, valueHtml;
  if (built.mode === 'wtype') {
    const best = nearest[0] ? nearest[0].p : null;
    title = 'Тип воды (ближайшая проба)';
    valueHtml = best
      ? `<div style="font-size:17px;font-weight:800;color:${best.wtype.color}">${esc(best.wtype.label)}</div>` +
        `<div style="font-size:10.5px;color:var(--text-tertiary);margin-top:2px">${esc(best.item.name)}${best.proto && best.proto.sampled_at ? ' · ' + fmtDate(best.proto.sampled_at) : ''}</div>` +
        `<div style="margin-top:8px">${buildKurlovHtml(best.meq)}</div>`
      : '—';
  } else {
    const x = lng * built.cosLat, y = lat;
    const val = idw(x, y, built.proj, built.getV, lat, lng, built.boundaries);
    const pd = built.paramDef;
    const unit = built.mode === 'mineral' ? ' г/л' : built.mode === 'param' ? ' ' + (pd ? pd.unit : '') : '';
    const decimals = built.mode === 'ph' ? 2 : (built.mode === 'param' && built.domain && (built.domain.max - built.domain.min) < 1 ? 4 : 3);
    title = built.mode === 'mineral' ? 'Минерализация (интерполяция)' : built.mode === 'ph' ? 'pH (интерполяция)' : `${pd ? pd.name : chemParamKey} (интерполяция)`;
    const flagged = built.mode === 'param' && pd && pd.pdk_type === 'max' && pd.pdk_drink != null && !Number.isNaN(val) && val > pd.pdk_drink;
    valueHtml = `<div style="font-size:19px;font-weight:800;${flagged ? 'color:var(--red-500)' : ''}">${Number.isNaN(val) ? '—' : val.toFixed(decimals) + unit}</div>` +
      (flagged ? `<div style="font-size:10.5px;color:var(--red-500);margin-top:2px">Выше ПДК (${pd.pdk_drink}${unit})</div>` : '');
  }
  const nearHtml = nearest.map((n) => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--text-secondary);padding:2px 0">${esc(n.p.item.name)}<span>${n.km.toFixed(2)} км</span></div>`).join('');
  return `<div style="font-size:11.5px;font-weight:700;color:var(--text-secondary);margin-bottom:4px">${title}</div>${valueHtml}` +
    `<div style="font-size:9.5px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.04em;margin-top:9px;margin-bottom:2px">Ближайшие пробы</div>${nearHtml}` +
    `<div style="font-size:10px;color:var(--text-tertiary);margin-top:6px">Оценка по IDW — не измеренное значение.</div>`;
}

// ── Панель настроек маркеров ────────────────────────────────────────────
function SettingsPanel({ onClose, onApply }) {
  const [, force] = useState(0);
  function change(type, field, value) { WP_TYPES[type][field] = value; force((v) => v + 1); }
  return html`
    <div style=${{ position: 'absolute', top: '54px', right: '12px', zIndex: 1200, width: '300px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
      <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span style=${{ fontSize: '13px', fontWeight: 700 }}>Настройки маркеров</span>
        <button onClick=${onClose} style=${{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><${X} size=${15} /><//>
      </div>
      <div style=${{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '60vh', overflowY: 'auto' }}>
        ${Object.keys(WP_TYPES).map((k) => {
          const t = WP_TYPES[k];
          return html`
            <div key=${k} style=${{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: '8px' }}>
              <span style=${{ fontSize: '12px', color: 'var(--text-secondary)' }}>${t.label}<//>
              <select value=${t.shape} onChange=${(e) => change(k, 'shape', e.target.value)} style=${{ fontSize: '11px', padding: '3px 5px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                ${WP_SHAPE_OPTIONS.map((s) => html`<option key=${s} value=${s}>${WP_SHAPE_LABELS[s]}<//>`)}
              <//>
              <input type="color" value=${t.color} onInput=${(e) => change(k, 'color', e.target.value)} style=${{ width: '28px', height: '28px', borderRadius: '6px', border: '1px solid var(--border)', padding: 0, cursor: 'pointer' }} />
            </div>
          `;
        })}
      </div>
      <div style=${{ display: 'flex', justifyContent: 'flex-end', padding: '10px 14px', borderTop: '1px solid var(--border-subtle)' }}>
        <${Button} size="sm" onClick=${onApply}>Применить<//>
      </div>
    </div>
  `;
}

// ── Панель пересчёта координат ──────────────────────────────────────────
function CalcPanel({ onClose }) {
  const [f, setF] = useState({ lat: '', lon: '', sk42n: '', sk42e: '', sk42z: String(CALC_ZONE), lx: '', ly: '' });
  const [dms, setDms] = useState({ lat: '', lon: '' });

  function fromWgs() {
    const lat = parseFloat(f.lat), lon = parseFloat(f.lon);
    if (Number.isNaN(lat) || Number.isNaN(lon)) return;
    const r = wgsToAll(lat, lon);
    setF({ ...f, sk42n: r.sk42x.toFixed(3), sk42e: r.sk42yFull.toFixed(3), sk42z: String(r.zone), lx: r.localX.toFixed(4), ly: r.localY.toFixed(4) });
    setDms({ lat: ddToDms(lat, true), lon: ddToDms(lon, false) });
  }
  function fromSk42() {
    const sk42x = parseFloat(f.sk42n), sk42yFull = parseFloat(f.sk42e), zone = parseInt(f.sk42z, 10) || CALC_ZONE;
    if (Number.isNaN(sk42x) || Number.isNaN(sk42yFull)) return;
    const localX = sk42yFull - zone * 1e6 - 500000;
    const localY = sk42x - CALC_OFF;
    const wgs = sk42ToWgs(sk42x, localX, zone);
    setF({ ...f, lx: localX.toFixed(4), ly: localY.toFixed(4), lat: String(wgs.lat), lon: String(wgs.lon) });
    setDms({ lat: ddToDms(wgs.lat, true), lon: ddToDms(wgs.lon, false) });
  }
  function fromLocal() {
    const localX = parseFloat(f.lx), localY = parseFloat(f.ly);
    if (Number.isNaN(localX) || Number.isNaN(localY)) return;
    const zone = CALC_ZONE;
    const sk42x = localY + CALC_OFF;
    const sk42yFull = localX + zone * 1e6 + 500000;
    const wgs = sk42ToWgs(sk42x, localX, zone);
    setF({ ...f, sk42n: sk42x.toFixed(3), sk42e: sk42yFull.toFixed(3), sk42z: String(zone), lat: String(wgs.lat), lon: String(wgs.lon) });
    setDms({ lat: ddToDms(wgs.lat, true), lon: ddToDms(wgs.lon, false) });
  }

  function Section({ title, onConvert, children }) {
    return html`
      <div style=${{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px', background: 'var(--bg-sunken)', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style=${{ fontSize: '11px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '.04em' }}>${title}<//>
          <${Button} size="sm" variant="outline" onClick=${onConvert} style=${{ height: '24px', padding: '0 8px', fontSize: '10.5px' }}>↕ Пересчитать<//>
        </div>
        <div style=${{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>${children}<//>
      </div>
    `;
  }
  function FieldRow({ label, value, onChange, hint, placeholder }) {
    return html`
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style=${{ fontSize: '10px', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em' }}>${label}<//>
        <input value=${value} onInput=${onChange} placeholder=${placeholder || ''} style=${{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '6px', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '5px 8px' }} />
        ${hint && html`<span style=${{ fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', minHeight: '13px' }}>${hint}<//>`}
      </div>
    `;
  }

  return html`
    <div style=${{ position: 'absolute', top: '54px', right: '12px', zIndex: 1200, width: '320px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
      <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span style=${{ fontSize: '13px', fontWeight: 700 }}>Пересчёт координат</span>
        <button onClick=${onClose} style=${{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><${X} size=${15} /><//>
      </div>
      <div style=${{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '75vh', overflowY: 'auto' }}>
        <${Section} title="WGS-84 (GPS)" onConvert=${fromWgs}>
          <${FieldRow} label="Широта (lat)" value=${f.lat} onChange=${(e) => setF({ ...f, lat: e.target.value })} hint=${dms.lat} placeholder="52.488520" />
          <${FieldRow} label="Долгота (lon)" value=${f.lon} onChange=${(e) => setF({ ...f, lon: e.target.value })} hint=${dms.lon} placeholder="69.711210" />
        <//>
        <${Section} title="СК-42 / Пулково-1942" onConvert=${fromSk42}>
          <${FieldRow} label="Северная X (N), м" value=${f.sk42n} onChange=${(e) => setF({ ...f, sk42n: e.target.value })} placeholder="5815200.000" />
          <${FieldRow} label="Восточная Y (E) с зоной, м" value=${f.sk42e} onChange=${(e) => setF({ ...f, sk42e: e.target.value })} placeholder="12546300.000" />
          <${FieldRow} label="Зона" value=${f.sk42z} onChange=${(e) => setF({ ...f, sk42z: e.target.value })} />
        <//>
        <${Section} title="Местные (схема карьера)" onConvert=${fromLocal}>
          <${FieldRow} label="X (запад–восток)" value=${f.lx} onChange=${(e) => setF({ ...f, lx: e.target.value })} placeholder="46100.000" />
          <${FieldRow} label="Y (север–юг)" value=${f.ly} onChange=${(e) => setF({ ...f, ly: e.target.value })} placeholder="16400.000" />
          <div style=${{ fontSize: '10px', color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: '2px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
            X = СК-42 E − зона·10⁶ − 500 000<br />Y = СК-42 N − 5 800 000<br />Зона карьера: ${CALC_ZONE}, смещение Y: ${CALC_OFF}
          </div>
        <//>
      </div>
    </div>
  `;
}

// ── Меню слоя химического мониторинга ───────────────────────────────────
function ChemMenu({ chemMode, chemParamKey, chemSmooth, chemAsOfDate, chemFilterYear, chemFilterQuarter, years, loading, onSetMode, onSetParam, onToggleSmooth, onSetAsOf, onSetYear, onSetQuarter, onOpenPoints, onClose }) {
  const modeBtn = (key, label) => html`
    <button onClick=${() => onSetMode(key)} disabled=${loading} style=${{ flex: 1, padding: '6px 4px', border: 'none', borderRight: '1px solid var(--border-subtle)', background: chemMode === key ? 'var(--bg-active)' : 'transparent', color: chemMode === key ? 'var(--text-accent)' : 'var(--text-secondary)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>${label}<//>
  `;
  return html`
    <div style=${{ position: 'absolute', top: '54px', right: '12px', zIndex: 1200, width: '310px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
      <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span style=${{ fontSize: '13px', fontWeight: 700 }}>Слой химического мониторинга<//>
        <button onClick=${onClose} style=${{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><${X} size=${15} /><//>
      </div>
      <div style=${{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style=${{ display: 'flex', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
          ${modeBtn(null, 'Выкл')}${modeBtn('mineral', 'Минер.')}${modeBtn('ph', 'pH')}${modeBtn('wtype', 'Тип')}
        </div>
        <${Button} size="sm" variant=${chemSmooth ? 'primary' : 'outline'} onClick=${onToggleSmooth} disabled=${!chemMode || chemMode === 'wtype'}>Гладкий градиент<//>
        <select value=${chemMode === 'param' ? (chemParamKey || '') : ''} onChange=${(e) => onSetParam(e.target.value)} disabled=${loading} style=${{ fontSize: '12px', padding: '6px 8px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          <option value="">Показатель…</option>
          ${Object.keys(CHEM_GROUPS).map((g) => {
            const opts = CHEM_PARAMS.filter((p) => p.group === g);
            return opts.length ? html`<optgroup key=${g} label=${CHEM_GROUPS[g].label}>${opts.map((p) => html`<option key=${p.key} value=${p.key}>${p.name}<//>`)}<//>` : null;
          })}
        <//>
        <${Button} size="sm" variant="outline" onClick=${onOpenPoints}><${ListChecks} size=${13} /> Выбрать пробы<//>
        <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)', width: '58px', flexShrink: 0 }}>На дату:<//>
          <input type="date" value=${chemAsOfDate || ''} onChange=${(e) => onSetAsOf(e.target.value)} style=${{ flex: 1, fontSize: '11.5px', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border)' }} />
          ${chemAsOfDate && html`<button onClick=${() => onSetAsOf('')} style=${{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><${X} size=${13} /><//>`}
        </div>
        <div style=${{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)', width: '58px', flexShrink: 0 }}>Период:<//>
          <select value=${chemFilterYear} onChange=${(e) => onSetYear(e.target.value)} style=${{ flex: 1, fontSize: '11.5px', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border)' }}>
            <option value="">Год…</option>
            ${years.map((y) => html`<option key=${y} value=${y}>${y}<//>`)}
          <//>
          <select value=${chemFilterQuarter} onChange=${(e) => onSetQuarter(e.target.value)} style=${{ flex: 1, fontSize: '11.5px', padding: '4px 6px', borderRadius: '6px', border: '1px solid var(--border)' }}>
            <option value="">Кв…</option>
            <option value="1">I<//><option value="2">II<//><option value="3">III<//><option value="4">IV<//>
          <//>
        </div>
      </div>
    </div>
  `;
}

// ── Легенда слоя химии (низ-лево) ────────────────────────────────────────
function ChemLegend({ chemMode, chemParamKey, built, palette, step, divisions, chemSmooth, hasBoundary, excludedCount, chemPointsN, onSetStep, onSetDivisions, onSetPalette, onOpenPoints, onExportPng, pngBusy, pngMsg }) {
  if (!chemMode) return null;
  const paramDef = chemParamKey ? CHEM_PARAM_MAP[chemParamKey] : null;
  const n = built ? built.n : chemPointsN;
  const title = chemMode === 'mineral' ? 'Минерализация (IDW)' : chemMode === 'ph' ? 'pH (IDW)' :
    chemMode === 'param' ? `${paramDef ? paramDef.name : chemParamKey} (IDW)` : 'Тип воды по Пайперу (Вороной)';

  return html`
    <div style=${{ position: 'absolute', bottom: '12px', left: '12px', zIndex: 1100, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', padding: '12px 14px', maxWidth: '280px' }}>
      <div style=${{ fontSize: '11.5px', fontWeight: 700, marginBottom: '7px' }}>${title}<//>
      <div style=${{ marginBottom: '7px' }}>
        <button onClick=${onOpenPoints} style=${{ background: 'none', border: 'none', color: 'var(--text-accent)', fontSize: '10.5px', cursor: 'pointer', padding: 0 }}>Выбрать пробы${excludedCount ? ` (${excludedCount} искл.)` : ''}<//>
      </div>
      ${!built ? html`<div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)' }}>Недостаточно данных для построения слоя (нужно ≥2 проб).<//>` : chemMode === 'wtype' ? html`
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px' }}>
          ${ALEKIN_FACIES.map((f) => {
            const present = built.proj.some((p) => p.wtype.key === f.key);
            return html`
              <div key=${f.key} style=${{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', opacity: present ? 1 : 0.35 }}>
                <span style=${{ width: '9px', height: '9px', borderRadius: '3px', background: built.proj.find((p) => p.wtype.key === f.key)?.wtype.color || '#94a3b8', flexShrink: 0 }} />
                ${f.label}
              </div>
            `;
          })}
        </div>
        <div style=${{ fontSize: '10px', color: 'var(--text-tertiary)', lineHeight: 1.5, marginTop: '8px' }}>Полная классификация Алёкина (9 фаций). Область — цвет ближайшей пробы (Вороной). Проб: ${n}. Клик по карте — формула Курлова ближайшей пробы.<//>
      ` : html`
        ${(() => {
          const ramp = getRamp(chemMode, palette);
          const unit = chemMode === 'mineral' ? ' г/л' : chemMode === 'param' ? ' ' + (paramDef ? paramDef.unit : '') : '';
          const domain = built.domain;
          const decimals = chemMode === 'param'
            ? (domain && domain.max - domain.min < 1 ? 4 : domain && domain.max - domain.min < 10 ? 3 : 2)
            : (step < 0.1 ? 2 : step < 1 ? 1 : 2);
          const stops = ramp.map((s) => `${s.color} ${s.stop * 100}%`).join(', ');
          const pdkT = chemMode === 'param' && paramDef && paramDef.pdk_type === 'max' && paramDef.pdk_drink != null && domain && domain.max > domain.min
            ? Math.max(0, Math.min(1, (paramDef.pdk_drink - domain.min) / (domain.max - domain.min))) : null;
          return html`
            <div style=${{ position: 'relative', height: '12px', borderRadius: '4px', background: `linear-gradient(to right, ${stops})` }}>
              ${pdkT != null && html`<div title=${'ПДК: ' + paramDef.pdk_drink + unit} style=${{ position: 'absolute', top: '-2px', bottom: '-2px', left: pdkT * 100 + '%', width: '2px', background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,.5)' }} />`}
            </div>
            ${domain && html`
              <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-secondary)', marginTop: '3px', fontWeight: 700 }}>
                <span>${domain.min.toFixed(decimals)}${unit}<//><span>${domain.max.toFixed(decimals)}${unit}<//>
              </div>
            `}
            <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', margin: '8px 0 4px' }}>
              <span style=${{ fontSize: '10.5px', color: 'var(--text-tertiary)' }}>${chemMode === 'param' ? 'Ступеней:' : 'Шаг:'}<//>
              <select disabled=${chemSmooth} value=${chemMode === 'param' ? divisions : step} onChange=${(e) => (chemMode === 'param' ? onSetDivisions(e.target.value) : onSetStep(e.target.value))} style=${{ fontSize: '10.5px', padding: '2px 5px', borderRadius: '5px', border: '1px solid var(--border)' }}>
                ${(chemMode === 'param' ? DIVISION_PRESETS : STEP_PRESETS[chemMode]).map((v) => html`<option key=${v} value=${v}>${v}${chemMode !== 'param' ? unit : ''}<//>`)}
              <//>
            </div>
            <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <span style=${{ fontSize: '10.5px', color: 'var(--text-tertiary)' }}>Палитра:<//>
              <select value=${palette} onChange=${(e) => onSetPalette(e.target.value)} style=${{ fontSize: '10.5px', padding: '2px 5px', borderRadius: '5px', border: '1px solid var(--border)' }}>
                ${Object.keys(PALETTES).map((k) => html`<option key=${k} value=${k}>${PALETTES[k].label}<//>`)}
              <//>
            </div>
            <div style=${{ fontSize: '10px', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
              ${chemSmooth ? 'Гладкий градиент без ступеней и изолиний.' : `Ступенчатая заливка, белые линии — границы ступеней.`}
              ${pdkT != null ? ' Белая метка — ПДК (питьевая).' : ''}
              Приближённая интерполяция IDW по ${n} пробам.
              ${hasBoundary ? ' Границы водоёмов учтены как барьер.' : ''}
            <//>
          `;
        })()}
      `}
      ${built && html`
        <div style=${{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
          <button onClick=${onExportPng} disabled=${pngBusy} style=${{ display: 'flex', alignItems: 'center', gap: '5px', background: 'none', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 9px', color: 'var(--text-secondary)', fontSize: '10.5px', cursor: pngBusy ? 'default' : 'pointer' }}>
            <${Download} size=${11} /> ${pngBusy ? 'Формирование…' : 'Экспорт PNG'}
          <//>
          ${pngMsg && html`<div style=${{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '5px' }}>${pngMsg}<//>`}
        </div>
      `}
    </div>
  `;
}

// ── Панель выбора проб для карты химии ──────────────────────────────────
function ChemPointsPanel({ points, excluded, onToggle, onClose }) {
  return html`
    <div style=${{ position: 'absolute', top: '54px', right: '12px', zIndex: 1300, width: '300px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
      <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span style=${{ fontSize: '13px', fontWeight: 700 }}>Пробы для карты химии<//>
        <button onClick=${onClose} style=${{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><${X} size=${15} /><//>
      </div>
      <div style=${{ padding: '8px', maxHeight: '60vh', overflowY: 'auto' }}>
        ${!points.length && html`<div style=${{ fontSize: '12px', color: 'var(--text-tertiary)', padding: '10px' }}>Нет проб для текущих фильтров.<//>`}
        ${points.map((p) => html`
          <label key=${p.item.id} style=${{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', borderRadius: '6px', cursor: 'pointer', opacity: excluded[p.item.id] ? 0.4 : 1, fontSize: '12px' }}>
            <input type="checkbox" checked=${!excluded[p.item.id]} onChange=${() => onToggle(p.item.id)} />
            <span style=${{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${p.item.name}<//>
            <span style=${{ fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>${p.proto.sampled_at ? fmtDate(p.proto.sampled_at) : ''}<//>
          </label>
        `)}
      </div>
    </div>
  `;
}

// ── Информационная панель выбранного водопункта ─────────────────────────
function InfoPanel({ item, t, onClose, onNavigate, onDrawBoundary, onClearBoundary }) {
  const rows = [
    ['Тип', t.label],
    ['Код', item.code || '—'],
    item.aquifer && ['Водоносный гор.', item.aquifer],
    item.depth && ['Глубина', item.depth + ' м'],
    item.diameter && ['Диаметр', item.diameter + ' мм'],
    (item.filter_from != null) && ['Фильтр', `${item.filter_from}–${item.filter_to} м`],
    item.drilled_at && ['Дата бурения', item.drilled_at],
    item.pump_model && ['Насос', item.pump_model],
    item.pump_depth && ['Гл. насоса', item.pump_depth + ' м'],
    item.pump_capacity && ['Подача', item.pump_capacity + ' м³/ч'],
    (item.lat && item.lng) && ['WGS-84', `${Number(item.lat).toFixed(6)}, ${Number(item.lng).toFixed(6)}`],
    (item.coord_x != null) && ['Местн. X', item.coord_x],
    (item.coord_y != null) && ['Местн. Y', item.coord_y],
    item.notes && ['Примечание', item.notes],
  ].filter(Boolean);
  const hasBoundary = item.boundary && item.boundary.length >= 3;

  return html`
    <div style=${{ position: 'absolute', bottom: '12px', right: '12px', zIndex: 1200, width: '270px', maxHeight: 'calc(100% - 24px)', overflowY: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)' }}>
      <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span style=${{ fontSize: '13px', fontWeight: 700 }}>${item.name}<//>
        <button onClick=${onClose} style=${{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><${X} size=${15} /><//>
      </div>
      <div style=${{ padding: '12px 14px' }}>
        <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', paddingBottom: '10px', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style=${{ width: '10px', height: '10px', borderRadius: '50%', background: t.color, flexShrink: 0 }} />
          <span style=${{ fontSize: '12px', fontWeight: 700, color: t.color }}>${t.label}<//>
          ${item.active === false && html`<${Badge} variant="danger" style=${{ marginLeft: 'auto' }}>Неактивен<//>`}
        </div>
        ${rows.map(([l, v]) => html`
          <div key=${l} style=${{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '9px' }}>
            <span style=${{ fontSize: '9.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>${l}<//>
            <span style=${{ fontSize: '12.5px' }}>${v}<//>
          </div>
        `)}
        <${Button} variant="outline" size="sm" style=${{ width: '100%', marginTop: '4px' }} onClick=${() => onNavigate && onNavigate('registry')}><${MapPin} size=${13} /> Открыть в реестре<//>

        <div style=${{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
          <div style=${{ fontSize: '9.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700, marginBottom: '6px' }}>Граница объекта (озеро/река)<//>
          <div style=${{ fontSize: '11.5px', color: hasBoundary ? 'var(--green-600)' : 'var(--text-tertiary)', marginBottom: '6px' }}>${hasBoundary ? `✓ задана (${item.boundary.length} точек) — вырезается из карты химии` : 'не задана'}<//>
          <div style=${{ display: 'flex', gap: '6px' }}>
            <${Button} variant="outline" size="sm" style=${{ flex: 1 }} onClick=${() => onDrawBoundary(item)}><${Pencil} size=${12} /> ${hasBoundary ? 'Изменить' : 'Нарисовать'}<//>
            ${hasBoundary && html`<${Button} variant="outline" size="sm" onClick=${() => onClearBoundary(item.id)}><${Trash2} size=${12} style=${{ color: 'var(--red-500)' }} /><//>`}
          </div>
        </div>
      </div>
    </div>
  `;
}

export function WpMapPage({ onNavigate }) {
  const containerRef = useRef(null);
  const st = useRef({ map: null, layerGroup: null, tileLayers: {}, refLayer: null, chemRasterLayer: null, chemIsoLayer: null, boundaryLayer: null, boundaryDraftLayer: null });

  const [leafletReady, setLeafletReady] = useState(false);
  const [items, setItems] = useState(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showLabels, setShowLabels] = useState(true);
  const [activeLayer, setActiveLayer] = useState('satellite');
  const [selected, setSelected] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calcOpen, setCalcOpen] = useState(false);
  const [typeVersion, setTypeVersion] = useState(0);
  const [reloading, setReloading] = useState(false);

  // ── Химический слой ──
  const [chemMenuOpen, setChemMenuOpen] = useState(false);
  const [chemPointsOpen, setChemPointsOpen] = useState(false);
  const [chemMode, setChemModeState] = useState(null);
  const [chemParamKey, setChemParamKey] = useState(null);
  const [chemSmooth, setChemSmooth] = useState(false);
  const [chemStep, setChemStepState] = useState({ mineral: 1, ph: 1 });
  const [chemDivisions, setChemDivisions] = useState(10);
  const [chemAsOfDate, setChemAsOfDate] = useState('');
  const [chemFilterYear, setChemFilterYear] = useState('');
  const [chemFilterQuarter, setChemFilterQuarter] = useState('');
  const [chemPalette, setChemPaletteState] = useState('classic');
  const [chemExcluded, setChemExcluded] = useState({});
  const [protocols, setProtocols] = useState(null);
  const [resultsByProto, setResultsByProto] = useState({});
  const [boundaryEdit, setBoundaryEdit] = useState(null);
  const [pngBusy, setPngBusy] = useState(false);
  const [pngMsg, setPngMsg] = useState('');

  useEffect(() => {
    loadWpTypeSettings();
    setChemExcluded(loadChemExcluded());
    setChemPaletteState(loadChemPalette());
    loadLeaflet().then(() => setLeafletReady(true));
  }, []);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('wp_registry').select('*').order('name');
    if (!error) setItems(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!items) return [];
    const s = search.toLowerCase().trim();
    return items.filter((i) => {
      if (!i.lat || !i.lng) return false;
      if (typeFilter && i.wp_type !== typeFilter) return false;
      if (s && !((i.name || '').toLowerCase().includes(s) || (i.code || '').toLowerCase().includes(s))) return false;
      return true;
    });
  }, [items, typeFilter, search]);

  const kpi = useMemo(() => {
    if (!items) return null;
    const s = search.toLowerCase().trim();
    const scoped = items.filter((i) => {
      if (typeFilter && i.wp_type !== typeFilter) return false;
      if (s && !((i.name || '').toLowerCase().includes(s) || (i.code || '').toLowerCase().includes(s))) return false;
      return true;
    });
    const withCoords = scoped.filter((i) => i.lat && i.lng).length;
    return { total: scoped.length, withCoords, withoutCoords: scoped.length - withCoords };
  }, [items, typeFilter, search]);

  const withLocalOnly = useMemo(() => (items || []).filter((i) => !i.lat && !i.lng && (i.coord_x != null || i.coord_y != null)), [items]);

  // ── Инициализация карты ──
  useEffect(() => {
    if (!leafletReady || !containerRef.current || st.current.map) return;
    const L = window.L;
    const map = L.map(containerRef.current, { center: [51.1, 71.4], zoom: 13, zoomControl: true, attributionControl: true });
    st.current.map = map;
    Object.keys(TILE_LAYERS).forEach((k) => { st.current.tileLayers[k] = L.tileLayer(TILE_LAYERS[k].url, { maxZoom: TILE_LAYERS[k].maxZoom, attribution: TILE_LAYERS[k].attribution }); });
    st.current.refLayer = L.tileLayer(REF_LAYER_URL, { maxZoom: 19, opacity: 0.6, attribution: '' });
    st.current.tileLayers.satellite.addTo(map);
    st.current.refLayer.addTo(map);
    st.current.layerGroup = makeClusterLayer(L).addTo(map);
    return () => { map.remove(); st.current = { map: null, layerGroup: null, tileLayers: {}, refLayer: null, chemRasterLayer: null, chemIsoLayer: null, boundaryLayer: null, boundaryDraftLayer: null }; };
  }, [leafletReady]);

  // ── Смена подложки ──
  useEffect(() => {
    const s = st.current;
    if (!s.map) return;
    Object.values(s.tileLayers).forEach((l) => { if (s.map.hasLayer(l)) s.map.removeLayer(l); });
    if (s.refLayer && s.map.hasLayer(s.refLayer)) s.map.removeLayer(s.refLayer);
    const layer = s.tileLayers[activeLayer];
    if (layer) layer.addTo(s.map);
    if (activeLayer === 'satellite' && s.refLayer) s.refLayer.addTo(s.map);
    if (s.layerGroup) { s.layerGroup.remove(); s.layerGroup.addTo(s.map); }
  }, [activeLayer, leafletReady]);

  // ── Отрисовка маркеров ──
  useEffect(() => {
    const s = st.current;
    if (!s.map || !s.layerGroup) return;
    const L = window.L;
    s.layerGroup.clearLayers();
    const bounds = [];
    filtered.forEach((item) => {
      const t = WP_TYPES[item.wp_type] || WP_TYPES.other;
      const icon = makeWpIcon(L, item.wp_type, showLabels, item.name, WP_TYPES);
      const marker = L.marker([item.lat, item.lng], { icon });
      marker.bindPopup(popupHtml(item, t), { maxWidth: 280, className: 'wpm-popup' });
      marker.on('click', () => setSelected(item));
      marker.addTo(s.layerGroup);
      bounds.push([item.lat, item.lng]);
    });
    if (bounds.length === 1) s.map.setView(bounds[0], 15);
    else if (bounds.length > 1) s.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }, [filtered, showLabels, typeVersion, leafletReady]);

  async function reload() {
    setReloading(true);
    setSelected(null);
    await load();
    setReloading(false);
  }

  const typeCounts = useMemo(() => {
    const counts = {};
    (items || []).forEach((i) => { counts[i.wp_type] = (counts[i.wp_type] || 0) + 1; });
    return counts;
  }, [items]);

  const selectedType = selected ? (WP_TYPES[selected.wp_type] || WP_TYPES.other) : null;
  const showEmptyNoCoords = items && items.length > 0 && filtered.length === 0 && !typeFilter && !search && items.every((i) => !i.lat || !i.lng);

  // ══════════════════════ Химический слой ══════════════════════

  // Загружаем список протоколов один раз при первой активации слоя
  useEffect(() => {
    if (!chemMode || protocols !== null) return;
    supabase.from('chem_protocols').select('id, water_point_id, sampled_at').then(({ data, error }) => {
      if (error) { console.error('[wpmap] chem_protocols load error', error); setProtocols([]); return; }
      setProtocols(data || []);
    });
  }, [chemMode, protocols]);

  const byWpFiltered = useMemo(() => {
    if (!protocols) return {};
    const byWp = {};
    protocols.forEach((p) => { (byWp[p.water_point_id] = byWp[p.water_point_id] || []).push(p); });
    Object.keys(byWp).forEach((k) => {
      byWp[k].sort((a, b) => (b.sampled_at || '').localeCompare(a.sampled_at || ''));
      if (chemAsOfDate) byWp[k] = byWp[k].filter((p) => p.sampled_at && p.sampled_at <= chemAsOfDate);
      if (chemFilterYear || chemFilterQuarter) {
        byWp[k] = byWp[k].filter((p) => {
          if (chemFilterYear && (!p.sampled_at || p.sampled_at.slice(0, 4) !== chemFilterYear)) return false;
          if (chemFilterQuarter && String(quarterOf(p)) !== chemFilterQuarter) return false;
          return true;
        });
      }
    });
    return byWp;
  }, [protocols, chemAsOfDate, chemFilterYear, chemFilterQuarter]);

  const candidateIds = useMemo(() => {
    const ids = [];
    Object.values(byWpFiltered).forEach((list) => list.slice(0, 5).forEach((p) => ids.push(p.id)));
    return ids;
  }, [byWpFiltered]);

  // Догружаем результаты только для проб-кандидатов (последние ≤5 на в/п)
  useEffect(() => {
    if (!chemMode || !candidateIds.length) return;
    const missing = candidateIds.filter((id) => !(id in resultsByProto));
    if (!missing.length) return;
    let cancelled = false;
    (async () => {
      // PostgREST отдаёт максимум 1000 строк за запрос — при большом наборе proto-id
      // результаты нужно дочитывать постранично, иначе «хвост» молча обрезается.
      const all = [];
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from('chem_results')
          .select('protocol_id, param_key, value_raw, value_num, below_detection')
          .in('protocol_id', missing)
          .range(from, from + PAGE - 1);
        if (error) { console.error('[wpmap] chem_results load error', error); break; }
        all.push(...(data || []));
        if (!data || data.length < PAGE) break;
      }
      if (cancelled) return;
      setResultsByProto((prev) => {
        const next = { ...prev };
        missing.forEach((id) => { next[id] = []; });
        all.forEach((r) => { next[r.protocol_id].push(r); });
        return next;
      });
    })();
    return () => { cancelled = true; };
  }, [chemMode, candidateIds]);

  const years = useMemo(() => {
    const s = new Set();
    (protocols || []).forEach((p) => { if (p.sampled_at) s.add(p.sampled_at.slice(0, 4)); });
    return Array.from(s).sort((a, b) => b - a);
  }, [protocols]);

  // Представительная проба на в/п: первая (самая свежая после фильтров) с валидным составом
  const chemPoints = useMemo(() => {
    if (!chemMode || !items) return [];
    const points = [];
    items.forEach((item) => {
      if (!item.lat || !item.lng) return;
      const list = (byWpFiltered[item.id] || []).slice(0, 5);
      for (const proto of list) {
        if (!(proto.id in resultsByProto)) continue;
        const meq = calcMeq(resultsByProto[proto.id]);
        if (meq._valid) { points.push({ item, proto, meq, wtype: classifyWaterType(meq) }); break; }
      }
    });
    return points;
  }, [chemMode, items, byWpFiltered, resultsByProto]);

  const boundaries = useMemo(() => (items || []).filter((i) => i.boundary && i.boundary.length >= 3).map((i) => i.boundary), [items]);
  const paramDef = chemParamKey ? CHEM_PARAM_MAP[chemParamKey] : null;

  function getParamValue(p) {
    if (!chemParamKey) return NaN;
    const rows = resultsByProto[p.proto.id] || [];
    const row = rows.find((r) => r.param_key === chemParamKey);
    if (!row) return NaN;
    if (row.value_num != null) return row.value_num;
    if (row.below_detection) return 0;
    return NaN;
  }

  const chemBuilt = useMemo(() => {
    if (!chemMode || chemPoints.length < 2) return null;
    return buildChemRaster(chemMode, chemPoints, {
      palette: chemPalette, smooth: chemSmooth,
      step: chemMode === 'mineral' ? chemStep.mineral : chemStep.ph,
      divisions: chemDivisions, excluded: chemExcluded, boundaries, paramDef, getParamValue,
    });
  }, [chemMode, chemPoints, chemPalette, chemSmooth, chemStep, chemDivisions, chemExcluded, boundaries, chemParamKey]);

  // Рендер растра + изолиний на карте
  useEffect(() => {
    const s = st.current;
    if (!s.map) return;
    const L = window.L;
    if (s.chemRasterLayer) { s.map.removeLayer(s.chemRasterLayer); s.chemRasterLayer = null; }
    if (s.chemIsoLayer) { s.map.removeLayer(s.chemIsoLayer); s.chemIsoLayer = null; }
    if (!chemBuilt) return;
    const overlay = L.imageOverlay(chemBuilt.dataUrl, chemBuilt.bounds, { opacity: 1, interactive: false, className: chemMode === 'wtype' ? 'wpm-chem-crisp' : '' });
    overlay.addTo(s.map);
    s.chemRasterLayer = overlay;
    if (chemBuilt.isoLevels.length) {
      const grp = L.layerGroup();
      chemBuilt.isoLevels.forEach((level) => level.segs.forEach((seg) => {
        L.polyline([[seg[0][1], seg[0][0]], [seg[1][1], seg[1][0]]], { color: '#ffffff', weight: 1.1, opacity: 0.8, interactive: false }).addTo(grp);
      }));
      grp.addTo(s.map);
      s.chemIsoLayer = grp;
    }
  }, [chemBuilt, leafletReady, chemMode]);

  // Сохранённые границы водоёмов (тонкий контур)
  useEffect(() => {
    const s = st.current;
    if (!s.map) return;
    const L = window.L;
    if (s.boundaryLayer) { s.boundaryLayer.remove(); s.boundaryLayer = null; }
    const grp = L.layerGroup();
    (items || []).forEach((item) => {
      if (item.boundary && item.boundary.length >= 3) {
        L.polygon(item.boundary, { color: BOUNDARY_COLOR, weight: 1.5, opacity: 0.5, fillOpacity: 0.04, dashArray: '4,4', interactive: false }).addTo(grp);
      }
    });
    grp.addTo(s.map);
    s.boundaryLayer = grp;
  }, [items, leafletReady]);

  // Черновик рисуемой границы
  useEffect(() => {
    const s = st.current;
    if (!s.map) return;
    const L = window.L;
    if (s.boundaryDraftLayer) { s.boundaryDraftLayer.remove(); s.boundaryDraftLayer = null; }
    if (!boundaryEdit) return;
    const grp = L.layerGroup().addTo(s.map);
    const pts = boundaryEdit.points;
    if (pts.length >= 3) L.polygon(pts, { color: BOUNDARY_COLOR, weight: 2, dashArray: '5,4', fillOpacity: 0.15, interactive: false }).addTo(grp);
    else if (pts.length === 2) L.polyline(pts, { color: BOUNDARY_COLOR, weight: 2, dashArray: '5,4', interactive: false }).addTo(grp);
    pts.forEach((p) => L.circleMarker(p, { radius: 4, color: BOUNDARY_COLOR, fillColor: '#946B16', fillOpacity: 1, weight: 2, interactive: false }).addTo(grp));
    s.boundaryDraftLayer = grp;
  }, [boundaryEdit]);

  // Клик по карте: точка границы (в режиме рисования) либо запрос значения химии
  useEffect(() => {
    const s = st.current;
    if (!s.map) return;
    function onMapClick(e) {
      if (boundaryEdit) {
        setBoundaryEdit((prev) => (prev ? { ...prev, points: [...prev.points, [e.latlng.lat, e.latlng.lng]] } : prev));
        return;
      }
      if (chemMode && chemBuilt) {
        window.L.popup({ maxWidth: 280, className: 'wpm-popup' }).setLatLng(e.latlng).setContent(chemClickPopupHtml(e, chemBuilt, chemParamKey)).openOn(s.map);
      }
    }
    s.map.on('click', onMapClick);
    return () => s.map.off('click', onMapClick);
  }, [leafletReady, boundaryEdit, chemMode, chemBuilt, chemParamKey]);

  function setChemMode(mode) {
    setChemParamKey(null);
    setChemModeState((cur) => (cur === mode ? null : mode));
  }
  function setChemParam(key) {
    if (!key) { setChemModeState(null); setChemParamKey(null); return; }
    setChemModeState('param');
    setChemParamKey((cur) => (cur === key ? null : key));
  }
  function toggleChemSmooth() { setChemSmooth((v) => !v); }
  function setChemStepFor(mode, v) { setChemStepState((prev) => ({ ...prev, [mode]: parseFloat(v) })); }
  function setPalette(v) { setChemPaletteState(v); saveChemPalette(v); }
  function toggleExcluded(id) {
    setChemExcluded((prev) => { const next = { ...prev, [id]: !prev[id] }; if (!next[id]) delete next[id]; saveChemExcluded(next); return next; });
  }

  // MAP-05: экспорт текущего слоя химии (подложка + растр + изолинии + точки + легенда) в PNG.
  async function handleExportPng() {
    if (!chemMode || !chemBuilt) { setPngMsg('Сначала включите слой химии на карте'); return; }
    setPngBusy(true); setPngMsg('');
    try {
      const paramDef = chemParamKey ? CHEM_PARAM_MAP[chemParamKey] : null;
      const title = chemMode === 'mineral' ? 'Минерализация подземных вод (IDW)' : chemMode === 'ph' ? 'Водородный показатель pH (IDW)' :
        chemMode === 'param' ? (paramDef ? paramDef.name : chemParamKey) + ' (IDW)' : 'Тип воды по классификации Алёкина (Вороной)';
      const asOfLabel = chemAsOfDate ? ('срез на ' + fmtDate(chemAsOfDate)) : 'по последним пробам';
      const { blob, tileStats } = await exportChemMapPng(chemBuilt, { layerConfig: TILE_LAYERS[activeLayer], title, asOfLabel, palette: chemPalette });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'химия_' + chemMode + (chemAsOfDate ? '_' + chemAsOfDate : '') + '.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (tileStats.attempted > 0 && tileStats.loaded === 0) setPngMsg('PNG сохранён, но подложка карты не загрузилась — сохранены только данные химии');
      else if (tileStats.loaded < tileStats.attempted) setPngMsg(`PNG сохранён (часть подложки не загрузилась: ${tileStats.loaded}/${tileStats.attempted})`);
      else setPngMsg('PNG сохранён');
    } catch (e) {
      setPngMsg('Ошибка экспорта: ' + e.message);
    }
    setPngBusy(false);
  }

  function startBoundaryDraw(item) {
    if (st.current.map) st.current.map.closePopup();
    setSettingsOpen(false); setCalcOpen(false); setChemMenuOpen(false); setChemPointsOpen(false);
    setBoundaryEdit({ itemId: item.id, points: (item.boundary || []).slice() });
  }
  function boundaryUndo() { setBoundaryEdit((prev) => (prev ? { ...prev, points: prev.points.slice(0, -1) } : prev)); }
  function boundaryCancel() { setBoundaryEdit(null); }
  async function boundarySave() {
    if (!boundaryEdit || boundaryEdit.points.length < 3) { alert('Нужно минимум 3 точки'); return; }
    const { error } = await supabase.from('wp_registry').update({ boundary: boundaryEdit.points }).eq('id', boundaryEdit.itemId);
    if (error) { alert('Не удалось сохранить границу: ' + error.message); return; }
    setItems((prev) => prev.map((i) => (i.id === boundaryEdit.itemId ? { ...i, boundary: boundaryEdit.points } : i)));
    setSelected((prev) => (prev && prev.id === boundaryEdit.itemId ? { ...prev, boundary: boundaryEdit.points } : prev));
    setBoundaryEdit(null);
  }
  async function clearBoundary(itemId) {
    const { error } = await supabase.from('wp_registry').update({ boundary: null }).eq('id', itemId);
    if (error) { alert('Ошибка удаления границы: ' + error.message); return; }
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, boundary: null } : i)));
    setSelected((prev) => (prev && prev.id === itemId ? { ...prev, boundary: null } : prev));
  }

  const boundaryItem = boundaryEdit ? (items || []).find((i) => i.id === boundaryEdit.itemId) : null;
  const hasAnyBoundary = boundaries.length > 0;

  return html`
    <div style=${{ position: 'relative', height: '100%', overflow: 'hidden' }}>
      <div ref=${containerRef} style=${{ position: 'absolute', inset: 0, background: 'var(--bg-sunken)' }} />

      ${!leafletReady && html`<div style=${{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: 'var(--text-tertiary)' }}>Загрузка карты…<//>`}

      <div style=${{ position: 'absolute', top: '12px', left: '12px', zIndex: 1100, display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '380px' }}>
        <${Input} icon=${html`<${Search} size=${14} />`} placeholder="Поиск по названию или коду…" value=${search} onChange=${(e) => setSearch(e.target.value)} style=${{ background: 'var(--bg-surface)' }} />
        <div style=${{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <${Button} size="sm" variant=${!typeFilter ? 'primary' : 'outline'} onClick=${() => setTypeFilter('')} style=${{ background: !typeFilter ? undefined : 'var(--bg-surface)' }}>Все (${items ? items.length : 0})<//>
          ${Object.keys(WP_TYPES).filter((k) => typeCounts[k]).map((k) => html`
            <${Button} key=${k} size="sm" variant=${typeFilter === k ? 'primary' : 'outline'} onClick=${() => setTypeFilter(k)} style=${{ background: typeFilter === k ? undefined : 'var(--bg-surface)' }}>
              <span style=${{ width: '7px', height: '7px', borderRadius: '50%', background: WP_TYPES[k].color, display: 'inline-block' }} /> ${WP_TYPES[k].short} (${typeCounts[k]})
            <//>
          `)}
        </div>
        ${kpi && html`
          <div style=${{ display: 'flex', gap: '8px' }}>
            <div style=${{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', padding: '5px 10px', fontSize: '12px' }}>
              <b>${kpi.withCoords}</b> <span style=${{ color: 'var(--text-tertiary)' }}>на карте / ${kpi.total} всего</span>
            </div>
            ${kpi.withoutCoords > 0 && html`<div style=${{ background: 'var(--red-50)', border: '1px solid var(--red-100)', color: 'var(--red-500)', borderRadius: '8px', padding: '5px 10px', fontSize: '12px', fontWeight: 700 }}>${kpi.withoutCoords} без WGS-84<//>`}
          </div>
        `}
      </div>

      <div style=${{ position: 'absolute', top: '12px', right: '12px', zIndex: 1100, display: 'flex', gap: '6px', alignItems: 'center' }}>
        <div style=${{ display: 'flex', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
          ${[['satellite', Satellite, 'Спутник'], ['street', MapIcon, 'Карта'], ['topo', Mountain, 'Рельеф']].map(([k, Icon, lbl]) => html`
            <button key=${k} onClick=${() => setActiveLayer(k)} style=${{ display: 'flex', alignItems: 'center', gap: '5px', padding: '6px 11px', border: 'none', borderRight: '1px solid var(--border-subtle)', background: activeLayer === k ? 'var(--bg-active)' : 'transparent', color: activeLayer === k ? 'var(--text-accent)' : 'var(--text-secondary)', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}><${Icon} size=${13} /> ${lbl}<//>
          `)}
        </div>
        <${Button} size="sm" variant=${chemMode ? 'primary' : 'outline'} onClick=${() => { setChemMenuOpen((v) => !v); setSettingsOpen(false); setCalcOpen(false); }} style=${{ background: chemMode ? undefined : 'var(--bg-surface)' }} title="Слой химического мониторинга"><${FlaskConical} size=${14} /> Химия<//>
        <${Button} size="sm" variant=${showLabels ? 'primary' : 'outline'} onClick=${() => setShowLabels((v) => !v)} style=${{ background: showLabels ? undefined : 'var(--bg-surface)' }} title="Показать/скрыть подписи"><${Tag} size=${14} /><//>
        <${Button} size="sm" variant=${calcOpen ? 'primary' : 'outline'} onClick=${() => { setCalcOpen((v) => !v); setSettingsOpen(false); setChemMenuOpen(false); }} style=${{ background: calcOpen ? undefined : 'var(--bg-surface)' }} title="Калькулятор координат"><${Ruler} size=${14} /><//>
        <${Button} size="sm" variant="outline" icon onClick=${() => { setSettingsOpen((v) => !v); setCalcOpen(false); setChemMenuOpen(false); }} style=${{ background: 'var(--bg-surface)' }} title="Настройки маркеров"><${Settings} size=${14} /><//>
        <${Button} size="sm" variant="outline" icon onClick=${reload} disabled=${reloading} style=${{ background: 'var(--bg-surface)' }} title="Обновить"><${RefreshCw} size=${14} style=${reloading ? { animation: 'spin 1s linear infinite' } : undefined} /><//>
      </div>

      ${settingsOpen && html`<${SettingsPanel} onClose=${() => setSettingsOpen(false)} onApply=${() => { saveWpTypeSettings(); setSettingsOpen(false); setTypeVersion((v) => v + 1); }} />`}
      ${calcOpen && html`<${CalcPanel} onClose=${() => setCalcOpen(false)} />`}
      ${chemMenuOpen && html`
        <${ChemMenu}
          chemMode=${chemMode} chemParamKey=${chemParamKey} chemSmooth=${chemSmooth}
          chemAsOfDate=${chemAsOfDate} chemFilterYear=${chemFilterYear} chemFilterQuarter=${chemFilterQuarter}
          years=${years} loading=${false}
          onSetMode=${setChemMode} onSetParam=${setChemParam} onToggleSmooth=${toggleChemSmooth}
          onSetAsOf=${setChemAsOfDate} onSetYear=${setChemFilterYear} onSetQuarter=${setChemFilterQuarter}
          onOpenPoints=${() => setChemPointsOpen(true)} onClose=${() => setChemMenuOpen(false)}
        />
      `}
      ${chemPointsOpen && html`<${ChemPointsPanel} points=${chemPoints} excluded=${chemExcluded} onToggle=${toggleExcluded} onClose=${() => setChemPointsOpen(false)} />`}
      ${selected && !boundaryEdit && html`<${InfoPanel} item=${selected} t=${selectedType} onClose=${() => setSelected(null)} onNavigate=${onNavigate} onDrawBoundary=${startBoundaryDraw} onClearBoundary=${clearBoundary} />`}
      ${chemMode && !boundaryEdit && html`
        <${ChemLegend}
          chemMode=${chemMode} chemParamKey=${chemParamKey} built=${chemBuilt} palette=${chemPalette}
          step=${chemMode === 'mineral' ? chemStep.mineral : chemStep.ph} divisions=${chemDivisions} chemSmooth=${chemSmooth}
          hasBoundary=${hasAnyBoundary} excludedCount=${Object.keys(chemExcluded).length} chemPointsN=${chemPoints.length}
          onSetStep=${(v) => setChemStepFor(chemMode, v)} onSetDivisions=${(v) => setChemDivisions(parseInt(v, 10))}
          onSetPalette=${setPalette} onOpenPoints=${() => setChemPointsOpen(true)}
          onExportPng=${handleExportPng} pngBusy=${pngBusy} pngMsg=${pngMsg}
        />
      `}

      ${boundaryEdit && html`
        <div style=${{ position: 'absolute', top: '12px', left: '50%', transform: 'translateX(-50%)', zIndex: 2500, display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg-surface)', border: `1px solid ${BOUNDARY_COLOR}`, borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', padding: '8px 14px', fontSize: '12px', whiteSpace: 'nowrap' }}>
          <span>Граница «${boundaryItem ? boundaryItem.name : ''}»: клик по карте — точка (<b>${boundaryEdit.points.length}</b>)<//>
          <${Button} size="sm" variant="outline" onClick=${boundaryUndo}>Отменить точку<//>
          <${Button} size="sm" onClick=${boundarySave}>Сохранить<//>
          <${Button} size="sm" variant="outline" onClick=${boundaryCancel}>Отмена<//>
        </div>
      `}

      ${showEmptyNoCoords && html`
        <div style=${{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 900 }}>
          <${EmptyState} icon=${html`<${MapPin} size=${40} />`} title="Координаты не заданы" description="Откройте Реестр водопунктов и укажите WGS-84 (широта/долгота) для отображения на карте." />
        </div>
      `}
      ${withLocalOnly.length > 0 && html`
        <div style=${{ position: 'absolute', bottom: '14px', left: '50%', transform: 'translateX(-50%)', zIndex: 1100, display: 'flex', alignItems: 'flex-start', gap: '8px', background: 'var(--bg-surface)', border: '1px solid var(--amber-500)', borderRadius: '10px', padding: '9px 16px', maxWidth: '480px', textAlign: 'left', fontSize: '12px' }}>
          <${AlertTriangle} size=${15} style=${{ color: 'var(--amber-500)', flexShrink: 0, marginTop: '1px' }} />
          <span>
            <b>${withLocalOnly.length}</b> ${withLocalOnly.length === 1 ? 'водопункт имеет' : 'водопунктов имеют'} только местные координаты (X/Y) и не отображаются на карте.
            <span style=${{ display: 'block', color: 'var(--text-tertiary)', marginTop: '2px' }}>${withLocalOnly.slice(0, 3).map((i) => i.name).join(', ')}${withLocalOnly.length > 3 ? ` и ещё ${withLocalOnly.length - 3}` : ''}<//>
          </span>
        </div>
      `}
    </div>
  `;
}
