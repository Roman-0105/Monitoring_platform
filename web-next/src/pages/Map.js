import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ZoomIn, ZoomOut, Maximize2, X, MapPin, Layers, Plus, Pencil, Trash2,
  Eye, EyeOff, Thermometer, Target, ChevronLeft, ChevronRight, GitBranch, Waves,
} from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { getQuarryBounds } from '../lib/quarries.js';
import { getSchemesForQuarry, getCurrentOrLatestScheme, formatWeekKey, getWeekDateRange } from '../lib/schemes.js';
import { STATUS_COLORS, DITCH_STATUS_COLORS, MARKER_MODES, getMarkerStyle } from '../lib/map-style.js';
import { POINT_STATUSES, INTENSITY_OPTIONS, WALL_OPTIONS, DOMAIN_OPTIONS, WATER_COLOR_OPTIONS, MEASURE_METHOD_OPTIONS } from '../lib/point-status.js';
import { drawDomens, findDomenAt } from '../lib/domens.js';
import { drawFaults } from '../lib/faults.js';
import { buildHeatmapCanvas, drawHeatmapLegendBar } from '../lib/heatmap.js';
import { Button, Select, Input, Field, Badge, Dialog, EmptyState } from '../components/ui.js';

const ZOOM_MIN = 0.3, ZOOM_MAX = 6;

function xyToPixel(x, y, bounds, imgW, imgH) {
  return {
    px: (x - bounds.xMin) / (bounds.xMax - bounds.xMin) * imgW,
    py: (bounds.yMax - y) / (bounds.yMax - bounds.yMin) * imgH,
  };
}
function pixelToXY(px, py, bounds, imgW, imgH) {
  return { x: bounds.xMin + px / imgW * (bounds.xMax - bounds.xMin), y: bounds.yMax - py / imgH * (bounds.yMax - bounds.yMin) };
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function fmtDate(d) {
  if (!d) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d;
}

function drawPointMarkers(ctx, points, bounds, imgW, imgH, scale, mode) {
  points.forEach((p) => {
    if (p.x_local == null || p.y_local == null) return;
    const pos = xyToPixel(p.x_local, p.y_local, bounds, imgW, imgH);
    const st = getMarkerStyle(p, mode, scale);
    const radius = st.size;

    ctx.beginPath(); ctx.arc(pos.px, pos.py, radius * 1.6, 0, Math.PI * 2);
    ctx.fillStyle = st.color + '30'; ctx.fill();

    ctx.beginPath(); ctx.arc(pos.px, pos.py, radius, 0, Math.PI * 2);
    ctx.fillStyle = st.color; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5 / scale; ctx.stroke();

    const fs = clamp(radius * 1.05, 4.5 / scale, 12 / scale);
    ctx.fillStyle = '#fff'; ctx.font = `700 ${fs.toFixed(1)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(p.point_number || '?'), pos.px, pos.py + 0.5 / scale);
  });
}

function drawDitchMarkers(ctx, ditches, bounds, imgW, imgH, scale) {
  ditches.forEach((d) => {
    if (d.x_local == null || d.y_local == null) return;
    const pos = xyToPixel(d.x_local, d.y_local, bounds, imgW, imgH);
    const col = DITCH_STATUS_COLORS[d.status] || '#4090e8';
    const ph = clamp(20 / scale, 10, 24), pw = clamp(52 / scale, 28, 58), pr = ph / 2;
    const cx = pos.px, cy = pos.py;

    ctx.beginPath();
    ctx.moveTo(cx - pw / 2 + pr, cy - ph / 2);
    ctx.lineTo(cx + pw / 2 - pr, cy - ph / 2);
    ctx.arc(cx + pw / 2 - pr, cy, pr, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(cx - pw / 2 + pr, cy + ph / 2);
    ctx.arc(cx - pw / 2 + pr, cy, pr, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
    const grd = ctx.createLinearGradient(cx - pw / 2, cy, cx + pw / 2, cy);
    grd.addColorStop(0, col); grd.addColorStop(1, col + 'cc');
    ctx.fillStyle = grd; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.2 / scale; ctx.stroke();

    const fs = clamp(ph * 0.5, 5 / scale, 11 / scale);
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.font = `700 ${fs.toFixed(1)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('≈ ' + (d.ditch_name || d.point_number || ''), cx, cy);
  });
}

function drawPoiMarkers(ctx, poiPoints, doneNums, bounds, imgW, imgH, scale) {
  const R = Math.max(8, 10 / scale);
  const fontSize = Math.max(7, 9 / scale);
  poiPoints.forEach((p) => {
    if (p.x_local == null || p.y_local == null) return;
    const pos = xyToPixel(p.x_local, p.y_local, bounds, imgW, imgH);
    const done = doneNums[p.point_number];
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 3;
    ctx.strokeStyle = done ? 'rgba(52,168,83,.7)' : 'rgba(140,140,140,.7)';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 1.4 / scale;
    ctx.beginPath(); ctx.arc(pos.px, pos.py, R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = done ? '#2f9e4a' : '#888';
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(p.point_number), pos.px, pos.py);
    ctx.restore();
  });
}

function findPointAt(imgX, imgY, points, bounds, imgW, imgH, scale, mode) {
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p.x_local == null || p.y_local == null) continue;
    const pos = xyToPixel(p.x_local, p.y_local, bounds, imgW, imgH);
    const dx = imgX - pos.px, dy = imgY - pos.py;
    const hit = getMarkerStyle(p, mode, scale).size + 4;
    if (Math.sqrt(dx * dx + dy * dy) <= hit) return p;
  }
  return null;
}
function findDitchAt(imgX, imgY, ditches, bounds, imgW, imgH, scale) {
  for (let i = ditches.length - 1; i >= 0; i--) {
    const d = ditches[i];
    if (d.x_local == null || d.y_local == null) continue;
    const pos = xyToPixel(d.x_local, d.y_local, bounds, imgW, imgH);
    const dx = imgX - pos.px, dy = imgY - pos.py;
    if (Math.abs(dx) <= 28 / scale && Math.abs(dy) <= 12 / scale) return d;
  }
  return null;
}
function findPoiAt(imgX, imgY, poiPoints, bounds, imgW, imgH, scale) {
  const R = Math.max(10, 12 / scale);
  for (let i = poiPoints.length - 1; i >= 0; i--) {
    const p = poiPoints[i];
    if (p.x_local == null || p.y_local == null) continue;
    const pos = xyToPixel(p.x_local, p.y_local, bounds, imgW, imgH);
    const dx = imgX - pos.px, dy = imgY - pos.py;
    if (dx * dx + dy * dy <= R * R) return p;
  }
  return null;
}

// ── Мини-подсказка при наведении ──────────────────────────────────────────
function HoverTooltip({ hover }) {
  if (!hover) return null;
  const { kind, item, x, y } = hover;
  const isPoint = kind === 'point';
  const color = (isPoint ? STATUS_COLORS : DITCH_STATUS_COLORS)[item.status] || '#888';
  return html`
    <div style=${{ position: 'fixed', left: (x + 14) + 'px', top: (y - 10) + 'px', zIndex: 200, pointerEvents: 'none', minWidth: '150px', maxWidth: '230px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--shadow-md)', padding: '8px 10px', fontSize: '12px' }}>
      <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
        <span style=${{ width: '9px', height: '9px', borderRadius: '50%', background: color, border: '1.5px solid #fff', boxShadow: '0 1px 3px rgba(0,0,0,.3)', flexShrink: 0 }} />
        <strong>${isPoint ? '#' + (item.point_number || '?') : (item.ditch_name || item.point_number)}</strong>
        <span style=${{ color, fontSize: '11px' }}>${item.status || ''}</span>
      </div>
      ${isPoint && item.worker && html`<div>👤 ${item.worker}</div>`}
      ${isPoint && item.flow_rate != null && html`<div>💧 ${Number(item.flow_rate).toFixed(2)} м³/ч</div>`}
      ${isPoint && item.intensity && html`<div>${item.intensity}</div>`}
      ${!isPoint && item.flow_m3h != null && html`<div style=${{ color: '#f9ab00' }}>${Number(item.flow_m3h).toFixed(3)} м³/ч</div>`}
      <div style=${{ color: 'var(--text-tertiary)', fontSize: '11px' }}>${fmtDate(item.monitoring_date)}</div>
    </div>
  `;
}

// ── Перетаскиваемая карточка точки/канавы/ТИ ──────────────────────────────
function InfoCard({ selected, containerRef, onClose, onEdit, onDelete, onAddMeasurement }) {
  const cardRef = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => { setPos(null); }, [selected]);

  if (!selected) return null;
  const { kind, item } = selected;
  const isPoint = kind === 'point';
  const isPoi = kind === 'poi';
  const statusColor = (isPoint || isPoi ? STATUS_COLORS : DITCH_STATUS_COLORS)[item.status] || '#888';
  const photo = (isPoint || isPoi) && Array.isArray(item.photos) && item.photos[0];

  const rows = (isPoint || isPoi) ? [
    ['Сотрудник', item.worker || '—'],
    ['Дата мониторинга', fmtDate(item.monitoring_date)],
    ['Домен', item.domain || '—'],
    ['Борт', item.wall || '—'],
    ['Интенсивность', item.intensity || '—'],
    ['Дебит', item.flow_rate != null ? Number(item.flow_rate).toFixed(2) + ' м³/ч' : '—'],
    ['Цвет воды', item.water_color || '—'],
    ['Горизонт', item.horizon || '—'],
    ['X / Y', item.x_local != null ? `${Number(item.x_local).toFixed(2)} / ${Number(item.y_local).toFixed(2)}` : '—'],
  ] : [
    ['Сотрудник', item.worker || '—'],
    ['Дата', fmtDate(item.monitoring_date)],
    ['Ширина', item.width != null ? item.width + ' м' : '—'],
    ['Расход', item.flow_m3h != null ? Number(item.flow_m3h).toFixed(3) + ' м³/ч' : '—'],
    ['X / Y', item.x_local != null ? `${Number(item.x_local).toFixed(2)} / ${Number(item.y_local).toFixed(2)}` : '—'],
  ];

  function startDrag(e) {
    e.preventDefault();
    const cardEl = cardRef.current, contEl = containerRef.current;
    if (!cardEl || !contEl) return;
    const cardRect = cardEl.getBoundingClientRect();
    const contRect = contEl.getBoundingClientRect();
    const offX = e.clientX - cardRect.left, offY = e.clientY - cardRect.top;
    function onMove(ev) {
      const left = clamp(ev.clientX - contRect.left - offX, 0, contRect.width - cardRect.width);
      const top = clamp(ev.clientY - contRect.top - offY, 0, contRect.height - cardRect.height);
      setPos({ left, top });
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  const posStyle = pos ? { left: pos.left + 'px', top: pos.top + 'px' } : { top: '14px', right: '14px' };

  return html`
    <div ref=${cardRef} style=${{ position: 'absolute', width: '300px', maxHeight: 'calc(100% - 28px)', overflow: 'auto', background: 'var(--bg-surface)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)', zIndex: 20, ...posStyle }}>
      <div onMouseDown=${startDrag} style=${{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)', cursor: 'grab', userSelect: 'none' }}>
        <span style=${{ fontWeight: 800, fontSize: '14px' }}>${isPoint || isPoi ? '#' + (item.point_number || '—') : (item.ditch_name || item.point_number)}</span>
        <span style=${{ marginLeft: 'auto' }}><${Badge} style=${{ background: statusColor + '22', color: statusColor }}>${item.status || '—'}<//></span>
        <button onClick=${onClose} style=${{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '2px' }}><${X} size=${16} /></button>
      </div>
      ${photo && html`<img src=${photo} style=${{ width: '100%', height: '160px', objectFit: 'cover', display: 'block' }} />`}
      <div style=${{ padding: '10px 14px' }}>
        ${rows.map(([label, val]) => html`
          <div key=${label} style=${{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '12.5px' }}>
            <span style=${{ color: 'var(--text-tertiary)' }}>${label}</span>
            <span style=${{ fontWeight: 600, textAlign: 'right' }}>${val}</span>
          </div>
        `)}
        ${(isPoint || isPoi) && item.comment && html`<div style=${{ marginTop: '8px', fontSize: '12.5px', color: 'var(--text-secondary)', fontStyle: 'italic' }}>«${item.comment}»</div>`}
      </div>
      <div style=${{ display: 'flex', gap: '6px', padding: '10px 14px', borderTop: '1px solid var(--border-subtle)' }}>
        ${isPoi ? html`
          <${Button} size="sm" style=${{ flex: 1 }} onClick=${() => onAddMeasurement(item)}><${Plus} size=${14} /> Новый замер<//>
        ` : html`
          <${Button} variant="outline" size="sm" onClick=${() => onEdit(kind, item)}><${Pencil} size=${14} /> Изменить<//>
          <${Button} variant="outline" size="sm" onClick=${() => onDelete(kind, item)}><${Trash2} size=${14} style=${{ color: 'var(--red-500)' }} /><//>
        `}
      </div>
    </div>
  `;
}

// ── Диалог добавления/редактирования точки ────────────────────────────────
function PointDialog({ open, form, onChange, onClose, onSave, saving }) {
  if (!form) return null;
  return html`
    <${Dialog}
      open=${open}
      onClose=${onClose}
      title=${form.id ? `Редактировать точку #${form.point_number || ''}` : 'Новая точка на карте'}
      width="640px"
      footer=${html`
        <${Button} variant="outline" onClick=${onClose}>Отмена<//>
        <${Button} onClick=${onSave} disabled=${saving}>${saving ? 'Сохранение…' : 'Сохранить'}<//>
      `}
    >
      <div style=${{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
          <${Field} label="№ точки *"><${Input} value=${form.point_number} onChange=${(e) => onChange({ ...form, point_number: e.target.value })} /><//>
          <${Field} label="Дата"><${Input} type="date" value=${form.monitoring_date} onChange=${(e) => onChange({ ...form, monitoring_date: e.target.value })} /><//>
          <${Field} label="Сотрудник"><${Input} value=${form.worker} onChange=${(e) => onChange({ ...form, worker: e.target.value })} /><//>
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
          <${Field} label="Статус">
            <${Select} value=${form.status} onChange=${(e) => onChange({ ...form, status: e.target.value })}>
              ${Object.keys(POINT_STATUSES).map((s) => html`<option key=${s} value=${s}>${s}<//>`)}
            <//>
          <//>
          <${Field} label="Интенсивность">
            <${Select} value=${form.intensity} onChange=${(e) => onChange({ ...form, intensity: e.target.value })}>
              <option value="">—</option>
              ${INTENSITY_OPTIONS.map((s) => html`<option key=${s} value=${s}>${s}<//>`)}
            <//>
          <//>
          <${Field} label="Дебит, м³/ч"><${Input} type="number" step="0.01" value=${form.flow_rate} onChange=${(e) => onChange({ ...form, flow_rate: e.target.value })} /><//>
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
          <${Field} label="Домен">
            <${Select} value=${form.domain} onChange=${(e) => onChange({ ...form, domain: e.target.value })}>
              <option value="">—</option>
              ${DOMAIN_OPTIONS.map((s) => html`<option key=${s} value=${s}>${s}<//>`)}
            <//>
          <//>
          <${Field} label="Борт">
            <${Select} value=${form.wall} onChange=${(e) => onChange({ ...form, wall: e.target.value })}>
              <option value="">—</option>
              ${WALL_OPTIONS.map((s) => html`<option key=${s} value=${s}>${s}<//>`)}
            <//>
          <//>
          <${Field} label="Горизонт"><${Input} value=${form.horizon} onChange=${(e) => onChange({ ...form, horizon: e.target.value })} /><//>
        </div>
        <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
          <${Field} label="Цвет воды">
            <${Select} value=${form.water_color} onChange=${(e) => onChange({ ...form, water_color: e.target.value })}>
              <option value="">—</option>
              ${WATER_COLOR_OPTIONS.map((s) => html`<option key=${s} value=${s}>${s}<//>`)}
            <//>
          <//>
          <${Field} label="Метод замера">
            <${Select} value=${form.measure_method} onChange=${(e) => onChange({ ...form, measure_method: e.target.value })}>
              <option value="">—</option>
              ${MEASURE_METHOD_OPTIONS.map((s) => html`<option key=${s} value=${s}>${s}<//>`)}
            <//>
          <//>
        </div>
        <${Field} label="Комментарий">
          <textarea class="input" rows="3" style=${{ resize: 'vertical', paddingTop: '8px' }} value=${form.comment} onChange=${(e) => onChange({ ...form, comment: e.target.value })} />
        <//>
        ${form.x_local != null && html`<div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>X: ${Number(form.x_local).toFixed(2)}  Y: ${Number(form.y_local).toFixed(2)}</div>`}
      </div>
    <//>
  `;
}

// ── Панель легенды/слоёв ───────────────────────────────────────────────────
function LegendPanel({ collapsed, onToggle, markerMode, onMarkerMode, domainsVisible, onToggleDomains, faultsVisible, onToggleFaults, filteredPoints, ditches }) {
  const byStatus = {}, byIntensity = {}, byDomain = {};
  filteredPoints.forEach((p) => {
    const s = p.status || 'Неизвестно', it = p.intensity || 'Не указана', d = p.domain || '—';
    byStatus[s] = (byStatus[s] || 0) + 1;
    byIntensity[it] = (byIntensity[it] || 0) + 1;
    byDomain[d] = (byDomain[d] || 0) + 1;
  });
  const byDitchStatus = {};
  ditches.forEach((d) => { const s = d.status || 'Активная'; byDitchStatus[s] = (byDitchStatus[s] || 0) + 1; });

  if (collapsed) {
    return html`
      <div style=${{ width: '34px', flexShrink: 0, borderLeft: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10px' }}>
        <button onClick=${onToggle} style=${{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><${ChevronLeft} size=${16} /><//>
      </div>
    `;
  }
  return html`
    <div style=${{ width: '250px', flexShrink: 0, borderLeft: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
      <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
        <span style=${{ fontSize: '11px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Легенда и слои</span>
        <button onClick=${onToggle} style=${{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><${ChevronRight} size=${16} /><//>
      </div>
      <div style=${{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <div style=${{ fontSize: '10.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>Режим маркеров</div>
          <${Select} value=${markerMode} onChange=${(e) => onMarkerMode(e.target.value)} style=${{ width: '100%' }}>
            ${MARKER_MODES.map((m) => html`<option key=${m.value} value=${m.value}>${m.label}<//>`)}
          <//>
        </div>
        <div style=${{ display: 'flex', gap: '6px' }}>
          <${Button} variant=${domainsVisible ? 'primary' : 'outline'} size="sm" style=${{ flex: 1 }} onClick=${onToggleDomains}><${Layers} size=${13} /> Домены<//>
          <${Button} variant=${faultsVisible ? 'primary' : 'outline'} size="sm" style=${{ flex: 1 }} onClick=${onToggleFaults}><${GitBranch} size=${13} /> Разломы<//>
        </div>
        <div>
          <div style=${{ fontSize: '10.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>Статус точки</div>
          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            ${Object.keys(STATUS_COLORS).map((s) => html`
              <div key=${s} style=${{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', padding: '3px 5px', borderRadius: '5px', background: 'var(--bg-sunken)' }}>
                <span style=${{ width: '8px', height: '8px', borderRadius: '50%', background: STATUS_COLORS[s], flexShrink: 0 }} />
                ${s}
              </div>
            `)}
          </div>
        </div>
        <div>
          <div style=${{ fontSize: '10.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>Интенсивность (размер)</div>
          <div style=${{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            ${INTENSITY_OPTIONS.map((s, i) => html`
              <div key=${s} style=${{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10.5px', padding: '3px 5px', borderRadius: '5px', background: 'var(--bg-sunken)' }}>
                <span style=${{ width: (5 + i * 3) + 'px', height: (5 + i * 3) + 'px', borderRadius: '50%', background: 'var(--accent-strong)', flexShrink: 0 }} />
                ${s}
              </div>
            `)}
          </div>
        </div>
        <div>
          <div style=${{ fontSize: '10.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>Показано: ${filteredPoints.length} точек</div>
          <div style=${{ display: 'grid', gap: '3px' }}>
            ${Object.keys(byStatus).map((s) => html`<div key=${s} style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px' }}><span style=${{ color: 'var(--text-secondary)' }}>${s}</span><b>${byStatus[s]}</b></div>`)}
          </div>
        </div>
        ${ditches.length > 0 && html`
          <div>
            <div style=${{ fontSize: '10.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '6px' }}>Канавы: ${ditches.length}</div>
            <div style=${{ display: 'grid', gap: '3px' }}>
              ${Object.keys(byDitchStatus).map((s) => html`<div key=${s} style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '11.5px' }}><span style=${{ color: 'var(--text-secondary)' }}>${s}</span><b>${byDitchStatus[s]}</b></div>`)}
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

// ── Панель управления тепловой картой ──────────────────────────────────────
function HeatmapControls({ hm, onChange }) {
  const legendRef = useRef(null);
  useEffect(() => { drawHeatmapLegendBar(legendRef.current); }, []);
  return html`
    <div style=${{ display: 'flex', alignItems: 'center', gap: '14px', padding: '8px 16px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap', background: 'var(--bg-sunken)' }}>
      <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Режим:</span>
      <${Select} value=${hm.mode} onChange=${(e) => onChange({ ...hm, mode: e.target.value })} style=${{ width: '170px' }}>
        <option value="q">По Q (водоприток)<//>
        <option value="status">По статусу<//>
        <option value="horizon">По горизонту<//>
      <//>
      <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
        Кривая <input type="range" min="20" max="300" step="5" value=${Math.round(hm.gamma * 100)} onChange=${(e) => onChange({ ...hm, gamma: e.target.value / 100 })} style=${{ width: '80px' }} />
      </span>
      <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
        Радиус <input type="range" min="2" max="15" step="1" value=${Math.round(hm.radius * 100)} onChange=${(e) => onChange({ ...hm, radius: e.target.value / 100 })} style=${{ width: '70px' }} /> ${Math.round(hm.radius * 100)}
      </span>
      <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
        Яркость <input type="range" min="20" max="100" step="5" value=${Math.round(hm.opacity * 100)} onChange=${(e) => onChange({ ...hm, opacity: e.target.value / 100 })} style=${{ width: '70px' }} /> ${Math.round(hm.opacity * 100)}%
      </span>
      <canvas ref=${legendRef} width="90" height="8" style=${{ borderRadius: '3px' }} />
    </div>
  `;
}

const EMPTY_FORM = {
  id: null, point_number: '', monitoring_date: '', worker: '', status: 'Новая', intensity: '',
  flow_rate: '', water_color: '', wall: '', domain: '', measure_method: '', horizon: '', comment: '',
  x_local: null, y_local: null,
};

export function MapPage({ quarry }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const st = useRef({
    scale: 1, offX: 0, offY: 0, scaleT: 1, offXT: 0, offYT: 0, animId: null,
    img: null, points: [], ditches: [], poiPoints: [], poiDone: {}, bounds: null,
    dragging: false, dragStartX: 0, dragStartY: 0, downX: 0, downY: 0, moved: false,
    markerMode: 'combined', pointsVisible: true, domainsVisible: true, faultsVisible: false,
    heatmap: { enabled: false, mode: 'q', radius: 0.06, opacity: 0.7, gamma: 1.0 },
    heatmapCanvas: null, addMode: false,
  });

  const [status, setStatus] = useState('loading');
  const [rawPoints, setRawPoints] = useState([]);
  const [ditches, setDitches] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [schemes, setSchemes] = useState([]);
  const [weekKey, setWeekKey] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [workerFilter, setWorkerFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [hover, setHover] = useState(null);
  const [coords, setCoords] = useState('');

  const [markerMode, setMarkerMode] = useState('combined');
  const [pointsVisible, setPointsVisible] = useState(true);
  const [domainsVisible, setDomainsVisible] = useState(true);
  const [faultsVisible, setFaultsVisible] = useState(false);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const [addMode, setAddMode] = useState(false);
  const [hm, setHm] = useState({ enabled: false, mode: 'q', radius: 0.06, opacity: 0.7, gamma: 1.0 });
  const [poiEnabled, setPoiEnabled] = useState(false);
  const [poiDate, setPoiDate] = useState('');

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const weekRange = useMemo(() => getWeekDateRange(weekKey), [weekKey]);

  const filteredPoints = useMemo(() => {
    return rawPoints.filter((p) => {
      if (statusFilter && p.status !== statusFilter) return false;
      if (workerFilter && p.worker !== workerFilter) return false;
      if (weekRange) {
        const d = (p.monitoring_date || '').slice(0, 10);
        if (!d || d < weekRange.start || d > weekRange.end) return false;
      }
      return true;
    });
  }, [rawPoints, statusFilter, workerFilter, weekRange]);

  const filteredDitches = useMemo(() => {
    return ditches.filter((d) => {
      if (workerFilter && d.worker !== workerFilter) return false;
      if (weekRange) {
        const dt = (d.monitoring_date || '').slice(0, 10);
        if (!dt || dt < weekRange.start || dt > weekRange.end) return false;
      }
      return true;
    });
  }, [ditches, workerFilter, weekRange]);

  const allDates = useMemo(() => {
    const set = new Set();
    rawPoints.forEach((p) => { const d = (p.monitoring_date || '').slice(0, 10); if (d) set.add(d); });
    return Array.from(set).sort().reverse();
  }, [rawPoints]);

  const poiPoints = useMemo(() => {
    if (!poiEnabled || !poiDate) return [];
    return rawPoints.filter((p) => (p.monitoring_date || '').slice(0, 10) === poiDate);
  }, [rawPoints, poiEnabled, poiDate]);

  const poiDoneNums = useMemo(() => {
    if (!poiEnabled || !poiDate) return {};
    const nums = {};
    rawPoints.forEach((p) => {
      const d = (p.monitoring_date || '').slice(0, 10);
      if (d && d > poiDate) nums[p.point_number] = true;
    });
    return nums;
  }, [rawPoints, poiEnabled, poiDate]);

  const poiProgress = useMemo(() => {
    if (!poiEnabled || !poiDate || !poiPoints.length) return null;
    const done = poiPoints.filter((p) => poiDoneNums[p.point_number]).length;
    return { done, total: poiPoints.length };
  }, [poiEnabled, poiDate, poiPoints, poiDoneNums]);

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
    if (s.heatmap.enabled && s.heatmapCanvas) {
      ctx.save();
      ctx.globalAlpha = s.heatmap.opacity;
      ctx.drawImage(s.heatmapCanvas, 0, 0, s.img.width, s.img.height);
      ctx.restore();
    }
    if (s.domainsVisible) drawDomens(ctx, s.bounds, s.img.width, s.img.height, s.scale);
    if (s.faultsVisible) drawFaults(ctx, s.bounds, s.img.width, s.img.height);
    if (s.pointsVisible) drawPointMarkers(ctx, s.points, s.bounds, s.img.width, s.img.height, s.scale, s.markerMode);
    drawDitchMarkers(ctx, s.ditches, s.bounds, s.img.width, s.img.height, s.scale);
    if (s.poiPoints.length) drawPoiMarkers(ctx, s.poiPoints, s.poiDone, s.bounds, s.img.width, s.img.height, s.scale);
    ctx.restore();
  }, []);

  // Плавный зум/панорамирование к цели (rAF + lerp), как в старом приложении
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
      if (!done) {
        s.animId = requestAnimationFrame(tick);
      } else {
        s.scale = s.scaleT; s.offX = s.offXT; s.offY = s.offYT;
        draw();
        s.animId = null;
      }
    }
    s.animId = requestAnimationFrame(tick);
  }, [draw]);

  const setTarget = useCallback((newScale, newOffX, newOffY) => {
    const s = st.current;
    s.scaleT = clamp(newScale, ZOOM_MIN, ZOOM_MAX);
    s.offXT = newOffX;
    s.offYT = newOffY;
    startAnim();
  }, [startAnim]);

  const loadData = useCallback(async () => {
    const [bounds, schemesList, ptsRes, ditchRes, workersRes] = await Promise.all([
      getQuarryBounds(quarry),
      getSchemesForQuarry(quarry),
      supabase.from('points').select('id, point_number, x_local, y_local, status, worker, monitoring_date, domain, wall, intensity, flow_rate, water_color, horizon, measure_method, comment, photos').order('monitoring_date', { ascending: false }).limit(2000),
      supabase.from('ditches').select('id, point_number, ditch_name, x_local, y_local, status, worker, monitoring_date, width, flow_m3h').order('created_at', { ascending: false }).limit(200),
      supabase.from('workers').select('name').eq('active', true).order('name'),
    ]);
    st.current.bounds = bounds;
    setSchemes(schemesList);
    setRawPoints(ptsRes.data || []);
    setDitches(ditchRes.data || []);
    setWorkers((workersRes.data || []).map((w) => w.name));
    return { bounds, schemesList };
  }, [quarry]);

  // Загрузка данных + начальная схема
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus('loading');
      const { schemesList } = await loadData();
      if (cancelled) return;
      const active = getCurrentOrLatestScheme(schemesList);
      setWeekKey(active ? active.weekKey : '');
      if (!active) { setStatus('no-scheme'); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (cancelled) return;
        st.current.img = img;
        const container = containerRef.current;
        const fitScale = container ? Math.min(container.clientWidth / img.width, container.clientHeight / img.height) : 1;
        st.current.scale = fitScale > 0 ? Math.min(ZOOM_MAX, fitScale) : 1;
        st.current.offX = (container ? (container.clientWidth - img.width * st.current.scale) / 2 : 0);
        st.current.offY = (container ? (container.clientHeight - img.height * st.current.scale) / 2 : 0);
        st.current.scaleT = st.current.scale; st.current.offXT = st.current.offX; st.current.offYT = st.current.offY;
        setStatus('ready');
      };
      img.onerror = () => setStatus('no-scheme');
      img.src = active.url;
    })();
    return () => { cancelled = true; };
  }, [quarry]);

  // Смена недели/схемы
  useEffect(() => {
    if (!weekKey || !schemes.length) return;
    const s = schemes.find((x) => x.weekKey === weekKey);
    if (!s) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { st.current.img = img; draw(); };
    img.src = s.url;
  }, [weekKey, schemes]);

  // Синхронизация точек/канав/ТИ/слоёв на канвасе
  useEffect(() => {
    const s = st.current;
    s.points = filteredPoints;
    s.ditches = filteredDitches;
    s.poiPoints = poiPoints;
    s.poiDone = poiDoneNums;
    s.markerMode = markerMode;
    s.pointsVisible = pointsVisible;
    s.domainsVisible = domainsVisible;
    s.faultsVisible = faultsVisible;
    draw();
  }, [filteredPoints, filteredDitches, poiPoints, poiDoneNums, markerMode, pointsVisible, domainsVisible, faultsVisible, draw]);

  // Тепловая карта: пересчёт офскрин-канваса при смене параметров/точек
  useEffect(() => {
    const s = st.current;
    s.heatmap = hm;
    if (hm.enabled && s.img && s.bounds) {
      s.heatmapCanvas = buildHeatmapCanvas(filteredPoints, s.bounds, s.img.width, s.img.height, hm);
    } else {
      s.heatmapCanvas = null;
    }
    draw();
  }, [hm, filteredPoints, status, draw]);

  // Add-mode во ref для обработчиков
  useEffect(() => { st.current.addMode = addMode; }, [addMode]);

  // Канвас: размер + взаимодействие
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
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
      const newScale = clamp(s.scaleT * delta, ZOOM_MIN, ZOOM_MAX);
      const newOffX = mx - (mx - s.offXT) * (newScale / s.scaleT);
      const newOffY = my - (my - s.offYT) * (newScale / s.scaleT);
      setTarget(newScale, newOffX, newOffY);
    }
    function onDown(e) {
      if (st.current.addMode) return;
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
        if (imgX >= 0 && imgX <= s.img.width && imgY >= 0 && imgY <= s.img.height) {
          const loc = pixelToXY(imgX, imgY, s.bounds, s.img.width, s.img.height);
          setCoords(`X: ${loc.x.toFixed(1)}  Y: ${loc.y.toFixed(1)}`);
        }
        if (!s.addMode) {
          const ditch = findDitchAt(imgX, imgY, s.ditches, s.bounds, s.img.width, s.img.height, s.scale);
          if (ditch) { setHover({ kind: 'ditch', item: ditch, x: e.clientX, y: e.clientY }); return; }
          if (s.pointsVisible) {
            const p = findPointAt(imgX, imgY, s.points, s.bounds, s.img.width, s.img.height, s.scale, s.markerMode);
            if (p) { setHover({ kind: 'point', item: p, x: e.clientX, y: e.clientY }); return; }
          }
        }
        setHover(null);
      }
    }
    function onUp(e) {
      const s = st.current;
      s.dragging = false;
      canvas.style.cursor = s.addMode ? 'crosshair' : 'grab';
      if (s.moved) return;
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      if (!s.img || !s.bounds) return;
      const imgX = (cx - s.offX) / s.scale, imgY = (cy - s.offY) / s.scale;

      if (s.addMode) {
        const loc = pixelToXY(imgX, imgY, s.bounds, s.img.width, s.img.height);
        const autoDomain = findDomenAt(loc.x, loc.y);
        setAddMode(false);
        setForm({ ...EMPTY_FORM, x_local: loc.x, y_local: loc.y, domain: autoDomain || '', monitoring_date: new Date().toISOString().slice(0, 10) });
        setDialogOpen(true);
        return;
      }

      const ditch = findDitchAt(imgX, imgY, s.ditches, s.bounds, s.img.width, s.img.height, s.scale);
      if (ditch) { setSelected({ kind: 'ditch', item: ditch }); return; }
      if (s.poiPoints.length) {
        const poi = findPoiAt(imgX, imgY, s.poiPoints, s.bounds, s.img.width, s.img.height, s.scale);
        if (poi) { setSelected({ kind: 'poi', item: poi }); return; }
      }
      if (s.pointsVisible) {
        const p = findPointAt(imgX, imgY, s.points, s.bounds, s.img.width, s.img.height, s.scale, s.markerMode);
        if (p) setSelected({ kind: 'point', item: p });
      }
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
  }, [draw, setTarget]);

  // Escape закрывает карточку
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') { setSelected(null); setAddMode(false); } }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  function zoomBy(mult) {
    const s = st.current;
    const canvas = canvasRef.current;
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const newScale = clamp(s.scaleT * mult, ZOOM_MIN, ZOOM_MAX);
    const newOffX = cx - (cx - s.offXT) * (newScale / s.scaleT);
    const newOffY = cy - (cy - s.offYT) * (newScale / s.scaleT);
    setTarget(newScale, newOffX, newOffY);
  }
  function resetView() {
    const s = st.current, container = containerRef.current;
    if (!s.img || !container) return;
    const fitScale = Math.min(container.clientWidth / s.img.width, container.clientHeight / s.img.height);
    const scale = fitScale > 0 ? Math.min(ZOOM_MAX, fitScale) : 1;
    const offX = (container.clientWidth - s.img.width * scale) / 2;
    const offY = (container.clientHeight - s.img.height * scale) / 2;
    setTarget(scale, offX, offY);
  }

  function openEditFromCard(kind, item) {
    setSelected(null);
    if (kind === 'ditch') return;
    setForm({
      id: item.id, point_number: item.point_number || '', monitoring_date: (item.monitoring_date || '').slice(0, 10),
      worker: item.worker || '', status: item.status || 'Новая', intensity: item.intensity || '',
      flow_rate: item.flow_rate ?? '', water_color: item.water_color || '', wall: item.wall || '',
      domain: item.domain || '', measure_method: item.measure_method || '', horizon: item.horizon || '',
      comment: item.comment || '', x_local: item.x_local, y_local: item.y_local,
    });
    setDialogOpen(true);
  }
  function openAddFromPoi(item) {
    setSelected(null);
    setForm({
      ...EMPTY_FORM, worker: item.worker || '', status: item.status || 'Новая', intensity: item.intensity || '',
      water_color: item.water_color || '', wall: item.wall || '', domain: item.domain || '',
      measure_method: item.measure_method || '', horizon: item.horizon || '', x_local: item.x_local, y_local: item.y_local,
      point_number: item.point_number || '', monitoring_date: new Date().toISOString().slice(0, 10),
    });
    setDialogOpen(true);
  }
  async function deleteFromCard(kind, item) {
    if (kind === 'ditch') return;
    if (!confirm(`Удалить точку #${item.point_number || item.id}?`)) return;
    setSelected(null);
    await supabase.from('points').delete().eq('id', item.id);
    loadData();
  }
  async function saveForm() {
    if (!form.point_number.trim()) return;
    setSaving(true);
    const row = {
      point_number: form.point_number.trim(),
      monitoring_date: form.monitoring_date || null,
      worker: form.worker.trim(),
      status: form.status,
      intensity: form.intensity,
      flow_rate: form.flow_rate === '' ? null : parseFloat(form.flow_rate),
      water_color: form.water_color,
      wall: form.wall,
      domain: form.domain,
      measure_method: form.measure_method,
      horizon: form.horizon,
      comment: form.comment.trim(),
      x_local: form.x_local,
      y_local: form.y_local,
    };
    if (form.id) row.id = form.id;
    else row.quarry = quarry;
    const { error } = await supabase.from('points').upsert(row);
    setSaving(false);
    if (error) { alert('Ошибка: ' + error.message); return; }
    setDialogOpen(false);
    loadData();
  }

  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style=${{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
        ${schemes.length > 1 && html`
          <${Select} style=${{ width: '170px' }} value=${weekKey} onChange=${(e) => setWeekKey(e.target.value)}>
            ${schemes.map((s) => html`<option key=${s.weekKey} value=${s.weekKey}>${formatWeekKey(s.weekKey)}<//>`)}
          <//>
        `}
        <${Select} style=${{ width: '150px' }} value=${statusFilter} onChange=${(e) => setStatusFilter(e.target.value)}>
          <option value="">Все статусы</option>
          ${Object.keys(POINT_STATUSES).map((s) => html`<option key=${s} value=${s}>${s}<//>`)}
        <//>
        <${Select} style=${{ width: '150px' }} value=${workerFilter} onChange=${(e) => setWorkerFilter(e.target.value)}>
          <option value="">Все сотрудники</option>
          ${workers.map((w) => html`<option key=${w} value=${w}>${w}<//>`)}
        <//>
        <span style=${{ width: '1px', height: '20px', background: 'var(--border-subtle)' }} />
        <${Button} variant=${addMode ? 'primary' : 'outline'} size="sm" onClick=${() => setAddMode((v) => !v)}><${Plus} size=${14} /> ${addMode ? 'Кликните на карте…' : 'Добавить точку'}<//>
        <${Button} variant=${pointsVisible ? 'primary' : 'outline'} size="sm" icon onClick=${() => setPointsVisible((v) => !v)} title="Показать/скрыть точки">${pointsVisible ? html`<${Eye} size=${14} />` : html`<${EyeOff} size=${14} />`}<//>
        <${Button} variant=${hm.enabled ? 'primary' : 'outline'} size="sm" onClick=${() => setHm({ ...hm, enabled: !hm.enabled })}><${Thermometer} size=${14} /> Тепло<//>
        <${Button} variant=${poiEnabled ? 'primary' : 'outline'} size="sm" onClick=${() => setPoiEnabled((v) => !v)}><${Target} size=${14} /> Точки интереса<//>
        ${poiEnabled && html`
          <${Select} style=${{ width: '150px' }} value=${poiDate} onChange=${(e) => setPoiDate(e.target.value)}>
            <option value="">— выберите неделю —</option>
            ${allDates.map((d) => html`<option key=${d} value=${d}>${fmtDate(d)}<//>`)}
          <//>
          ${poiProgress && html`<${Badge} variant=${poiProgress.done === poiProgress.total ? 'success' : 'default'}>✓ ${poiProgress.done} / ${poiProgress.total}<//>`}
        `}
        <span style=${{ marginLeft: 'auto', fontSize: '12px', color: 'var(--text-tertiary)' }}>${filteredPoints.length} точек · ${filteredDitches.length} канав</span>
      </div>

      ${hm.enabled && html`<${HeatmapControls} hm=${hm} onChange=${setHm} />`}

      <div style=${{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div ref=${containerRef} style=${{ flex: 1, position: 'relative', minHeight: 0, background: 'var(--bg-sunken)' }}>
          ${status === 'loading' && html`<div style=${{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style=${{ color: 'var(--text-tertiary)', fontSize: 13 }}>Загрузка карты…</div></div>`}
          ${status === 'no-scheme' && html`
            <div style=${{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <${EmptyState} icon=${html`<${Layers} size=${40} />`} title="Схема карьера не загружена" description="Загрузите схему для этого карьера в прежнем интерфейсе." />
            </div>
          `}
          <canvas ref=${canvasRef} style=${{ display: status === 'ready' ? 'block' : 'none', width: '100%', height: '100%', cursor: addMode ? 'crosshair' : 'grab' }} />
          ${status === 'ready' && html`
            <div style=${{ position: 'absolute', left: '14px', bottom: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <${Button} variant="outline" size="sm" icon onClick=${() => zoomBy(1.3)} style=${{ background: 'var(--bg-surface)' }}><${ZoomIn} size=${15} /><//>
              <${Button} variant="outline" size="sm" icon onClick=${() => zoomBy(1 / 1.3)} style=${{ background: 'var(--bg-surface)' }}><${ZoomOut} size=${15} /><//>
              <${Button} variant="outline" size="sm" icon onClick=${resetView} style=${{ background: 'var(--bg-surface)' }}><${Maximize2} size=${15} /><//>
            </div>
            <div style=${{ position: 'absolute', left: '14px', top: '14px', background: 'rgba(255,255,255,0.9)', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 9px', fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>${coords || '—'}</div>
            <${InfoCard} selected=${selected} containerRef=${containerRef} onClose=${() => setSelected(null)} onEdit=${openEditFromCard} onDelete=${deleteFromCard} onAddMeasurement=${openAddFromPoi} />
            <${HoverTooltip} hover=${!selected ? hover : null} />
          `}
        </div>
        <${LegendPanel}
          collapsed=${legendCollapsed} onToggle=${() => setLegendCollapsed((v) => !v)}
          markerMode=${markerMode} onMarkerMode=${setMarkerMode}
          domainsVisible=${domainsVisible} onToggleDomains=${() => setDomainsVisible((v) => !v)}
          faultsVisible=${faultsVisible} onToggleFaults=${() => setFaultsVisible((v) => !v)}
          filteredPoints=${filteredPoints} ditches=${filteredDitches}
        />
      </div>

      <${PointDialog} open=${dialogOpen} form=${form} onChange=${setForm} onClose=${() => setDialogOpen(false)} onSave=${saveForm} saving=${saving} />
    </div>
  `;
}
