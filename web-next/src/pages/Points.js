import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, Droplets, Pencil, Trash2, ImageOff, X, ChevronDown, ChevronLeft, ChevronRight, Camera, Image as ImageIcon } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { POINT_STATUSES, INTENSITY_OPTIONS, WALL_OPTIONS, DOMAIN_OPTIONS, WATER_COLOR_OPTIONS, MEASURE_METHOD_OPTIONS } from '../lib/point-status.js';
import { getLatestByPointNumber, matchesSearch, flowToM3h, getAllDates } from '../lib/points-utils.js';
import { STATUS_COLORS } from '../lib/map-style.js';
import { Button, Input, Select, Badge, Dialog, Field, EmptyState, Skeleton } from '../components/ui.js';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Dot } from 'recharts';

function fmtDate(d) {
  if (!d) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : d;
}

function highlightParts(text, search) {
  const s = String(text || '');
  if (!search) return s;
  const idx = s.toLowerCase().indexOf(search.toLowerCase());
  if (idx < 0) return s;
  return html`${s.slice(0, idx)}<mark style=${{ background: 'var(--gold-200)', color: 'var(--stone-900)', borderRadius: '2px', padding: '0 1px' }}>${s.slice(idx, idx + search.length)}<//>${s.slice(idx + search.length)}`;
}

async function compressImage(file, maxSize = 1200, quality = 0.8) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Ошибка чтения изображения'));
      i.src = url;
    });
    let w = img.width, h = img.height;
    if (w > maxSize || h > maxSize) {
      if (w >= h) { h = Math.round(h * maxSize / w); w = maxSize; } else { w = Math.round(w * maxSize / h); h = maxSize; }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadPointPhoto(pointId, file, pointNumber, monitoringDate) {
  const blob = await compressImage(file);
  const dateStr = (monitoringDate || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const fileName = `${pointNumber || pointId.slice(0, 8)}_${dateStr}.jpg`;
  const path = `${pointId}/${Date.now()}_${fileName}`;
  const { error: upErr } = await supabase.storage.from('photos').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
  if (upErr) throw new Error(upErr.message);
  const { data: urlData } = supabase.storage.from('photos').getPublicUrl(path);
  const photoUrl = urlData ? urlData.publicUrl : path;
  const { data: row } = await supabase.from('points').select('photos').eq('id', pointId).maybeSingle();
  const updated = [photoUrl, ...((row && row.photos) || [])];
  const { error: updErr } = await supabase.from('points').update({ photos: updated }).eq('id', pointId);
  if (updErr) throw new Error(updErr.message);
  return photoUrl;
}

async function deleteAllPointPhotos(pointId) {
  await supabase.from('points').update({ photos: [] }).eq('id', pointId);
}

// ── Выпадающий фильтр по датам (мультивыбор) ───────────────────────────────
function DateFilterDropdown({ dates, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);
  const label = selected.length === 0 ? 'Все даты' : selected.length === 1 ? fmtDate(selected[0]) : `${selected.length} дат`;
  function toggle(d) { onChange(selected.includes(d) ? selected.filter((x) => x !== d) : [...selected, d]); }
  return html`
    <div ref=${ref} style=${{ position: 'relative' }}>
      <${Button} variant=${selected.length ? 'primary' : 'outline'} size="sm" onClick=${() => setOpen((v) => !v)}>
        ${label} <${ChevronDown} size=${13} />
      <//>
      ${open && html`
        <div style=${{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, minWidth: '210px', maxHeight: '280px', overflowY: 'auto', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)', zIndex: 50, padding: '4px 0' }}>
          <div onClick=${() => onChange([])} style=${{ padding: '7px 12px', fontSize: '12px', color: 'var(--text-tertiary)', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)', marginBottom: '2px' }}>Все даты</div>
          ${dates.map((d) => html`
            <label key=${d} style=${{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '12.5px' }}>
              <input type="checkbox" checked=${selected.includes(d)} onChange=${() => toggle(d)} />
              ${fmtDate(d)}
            </label>
          `)}
        </div>
      `}
    </div>
  `;
}

// ── Карточка точки ───────────────────────────────────────────────────────
function PointCard({ p, search, onOpen }) {
  const [broken, setBroken] = useState(false);
  const photo = Array.isArray(p.photos) && p.photos[0];
  const hasPhoto = photo && !broken;
  const m3h = flowToM3h(p.flow_rate);
  const statusInfo = POINT_STATUSES[p.status] || {};
  const statusColor = STATUS_COLORS[p.status] || 'var(--text-tertiary)';

  return html`
    <div onClick=${() => onOpen(p)} style=${{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', cursor: 'pointer', transition: 'box-shadow .15s, border-color .15s', display: 'flex', flexDirection: 'column' }}
      onMouseEnter=${(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-md)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; }}
      onMouseLeave=${(e) => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}>
      <div style=${{ position: 'relative', height: '128px', background: 'var(--bg-sunken)', borderBottom: `3px solid ${statusColor}` }}>
        ${hasPhoto
          ? html`<img src=${photo} onError=${() => setBroken(true)} style=${{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />`
          : html`<div style=${{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--border-strong)' }}><${ImageIcon} size=${30} /><//>`}
        <div style=${{ position: 'absolute', top: '8px', left: '8px', fontWeight: 800, fontSize: '15px', color: hasPhoto ? '#fff' : 'var(--text-primary)', textShadow: hasPhoto ? '0 1px 4px rgba(0,0,0,.55)' : 'none' }}>${highlightParts(p.point_number || '—', search)}</div>
        ${m3h && html`<div style=${{ position: 'absolute', bottom: '8px', right: '8px', background: hasPhoto ? 'rgba(20,17,12,0.72)' : 'var(--bg-surface)', color: hasPhoto ? '#fff' : 'var(--text-primary)', border: hasPhoto ? 'none' : '1px solid var(--border)', borderRadius: '6px', padding: '2px 7px', fontSize: '12px', fontWeight: 700 }}>${m3h} м³/ч<//>`}
      </div>
      <div style=${{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
        <div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)' }}>${[p.wall, p.domain].filter(Boolean).join(' · ') || '—'}</div>
        <div style=${{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          <${Badge} variant=${statusInfo.badge || 'default'}>${p.status || '—'}<//>
          ${p.intensity && html`<${Badge}>${p.intensity}<//>`}
        </div>
        <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-tertiary)', marginTop: 'auto', paddingTop: '2px' }}>
          <span>${fmtDate(p.monitoring_date)}</span>
          ${p.horizon && html`<span>гор. ${p.horizon}</span>`}
        </div>
      </div>
    </div>
  `;
}

// ── Лайтбокс галереи фото ───────────────────────────────────────────────
function PhotoLightbox({ photos, startIdx, onClose }) {
  const [idx, setIdx] = useState(startIdx);
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && idx > 0) setIdx((i) => i - 1);
      if (e.key === 'ArrowRight' && idx < photos.length - 1) setIdx((i) => i + 1);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [idx, photos.length, onClose]);

  const ph = photos[idx];
  const m3h = flowToM3h(ph.flow_rate);
  const hasMulti = photos.length > 1;

  return html`
    <div style=${{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(20,17,12,0.92)', display: 'flex' }} onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style=${{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', position: 'relative', minWidth: 0 }}>
        ${hasMulti && idx > 0 && html`
          <button onClick=${() => setIdx((i) => i - 1)} style=${{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', width: '38px', height: '38px', borderRadius: '50%', border: '1px solid rgba(255,255,255,.25)', background: 'rgba(0,0,0,.5)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><${ChevronLeft} size=${20} /><//>
        `}
        <img src=${ph.photoUrl} style=${{ maxWidth: '100%', maxHeight: 'calc(100vh - 48px)', objectFit: 'contain', borderRadius: '6px' }} />
        ${hasMulti && html`<div style=${{ position: 'absolute', bottom: '16px', left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,.55)', borderRadius: '20px', padding: '4px 12px', fontSize: '11px', color: '#fff' }}>${idx + 1} / ${photos.length}<//>`}
        ${hasMulti && idx < photos.length - 1 && html`
          <button onClick=${() => setIdx((i) => i + 1)} style=${{ position: 'absolute', right: '16px', top: '50%', transform: 'translateY(-50%)', width: '38px', height: '38px', borderRadius: '50%', border: '1px solid rgba(255,255,255,.25)', background: 'rgba(0,0,0,.5)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><${ChevronRight} size=${20} /><//>
        `}
      </div>
      <div style=${{ width: '270px', flexShrink: 0, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderBottom: '1px solid var(--border-subtle)' }}>
          <span style=${{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-tertiary)' }}>Данные замера</span>
          <button onClick=${onClose} style=${{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}><${X} size=${16} /><//>
        </div>
        <div style=${{ padding: '12px 14px', display: 'flex', flexDirection: 'column', flex: 1 }}>
          ${[
            ['Дата замера', fmtDate(ph.monitoring_date)],
            ['Дебит', m3h ? m3h + ' м³/ч' : '—'],
            ['Статус', ph.status || '—'],
            ['Интенсивность', ph.intensity || '—'],
            ['Способ', ph.measure_method || '—'],
            ['Замерщик', ph.worker || '—'],
          ].filter(([, v]) => v && v !== '—').map(([label, val]) => html`
            <div key=${label} style=${{ display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '11.5px' }}>
              <span style=${{ color: 'var(--text-tertiary)' }}>${label}</span>
              <span style=${{ fontWeight: 600, textAlign: 'right' }}>${val}</span>
            </div>
          `)}
          <div style=${{ marginTop: 'auto', paddingTop: '14px' }}>
            <a href=${ph.photoUrl} target="_blank" rel="noopener" style=${{ display: 'block', textAlign: 'center', padding: '8px', borderRadius: '8px', border: '1px solid var(--border)', color: 'var(--text-accent)', fontSize: '11.5px', textDecoration: 'none' }}>↗ Открыть оригинал</a>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Модалка подробностей точки ─────────────────────────────────────────
function DetailModal({ point, onClose, onEdit, onDelete }) {
  const [history, setHistory] = useState(null);
  const [showAllJournal, setShowAllJournal] = useState(false);
  const [lightbox, setLightbox] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setShowAllJournal(false);
    supabase.from('points').select('*').eq('point_number', point.point_number).order('monitoring_date', { ascending: false }).then(({ data }) => {
      if (!cancelled) setHistory(data || []);
    });
    return () => { cancelled = true; };
  }, [point.point_number]);

  const kpi = useMemo(() => {
    if (!history) return null;
    const defined = history.filter((r) => r.flow_rate != null);
    if (!defined.length) return { avg: null, max: null, min: null, count: history.length };
    const vals = defined.map((r) => Number(r.flow_rate) * 3.6);
    const maxIdx = vals.indexOf(Math.max(...vals)), minIdx = vals.indexOf(Math.min(...vals));
    return {
      avg: (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2),
      max: vals[maxIdx].toFixed(2), maxDate: defined[maxIdx].monitoring_date,
      min: vals[minIdx].toFixed(2), minDate: defined[minIdx].monitoring_date,
      count: history.length,
    };
  }, [history]);

  const chartData = useMemo(() => {
    if (!history) return [];
    return [...history].reverse().map((r) => ({
      date: fmtDate(r.monitoring_date), m3h: r.flow_rate != null ? Number((r.flow_rate * 3.6).toFixed(2)) : null, status: r.status,
    }));
  }, [history]);

  const gallery = useMemo(() => {
    if (!history) return [];
    const out = [];
    history.forEach((r) => { (r.photos || []).forEach((url) => out.push({ photoUrl: url, monitoring_date: r.monitoring_date, flow_rate: r.flow_rate, status: r.status, intensity: r.intensity, measure_method: r.measure_method, worker: r.worker })); });
    return out;
  }, [history]);

  const journalRows = showAllJournal ? (history || []) : (history || []).slice(0, 6);
  const m3h = flowToM3h(point.flow_rate);
  const statusColor = STATUS_COLORS[point.status] || 'var(--text-tertiary)';

  function CustomDot(props) {
    const { cx, cy, payload } = props;
    if (payload.m3h == null) return null;
    return html`<circle cx=${cx} cy=${cy} r=${3.5} fill=${STATUS_COLORS[payload.status] || 'var(--accent-strong)'} stroke="#fff" stroke-width=${1.2} />`;
  }

  return html`
    <div style=${{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(20,17,12,.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px 14px', overflowY: 'auto' }} onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style=${{ width: '100%', maxWidth: '760px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', margin: 'auto', boxShadow: 'var(--shadow-lg)' }}>
        <div style=${{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-surface-2)' }}>
          <div style=${{ flex: 1, minWidth: 0 }}>
            <div style=${{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
              <span style=${{ fontSize: '20px', fontWeight: 800, color: 'var(--text-accent)' }}>${point.point_number || '—'}</span>
              <span style=${{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>${point.wall || point.domain || ''}</span>
              <${Badge} variant=${(POINT_STATUSES[point.status] || {}).badge || 'default'}>${point.status || '—'}<//>
            </div>
            <div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)', marginTop: '2px' }}>последний замер ${fmtDate(point.monitoring_date)}</div>
          </div>
          <div style=${{ display: 'flex', gap: '6px', flexShrink: 0 }}>
            <${Button} variant="outline" size="sm" onClick=${() => onEdit(point)}><${Pencil} size=${14} /> Изменить<//>
            <${Button} variant="outline" size="sm" onClick=${() => onDelete(point)}><${Trash2} size=${14} style=${{ color: 'var(--red-500)' }} /><//>
            <${Button} variant="ghost" size="sm" icon onClick=${onClose}><${X} size=${16} /><//>
          </div>
        </div>

        <div style=${{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div style=${{ display: 'flex', gap: '12px', height: '170px' }}>
            <div style=${{ flex: '0 0 40%', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-sunken)', position: 'relative', borderBottom: `3px solid ${statusColor}` }}>
              ${point.photos && point.photos[0]
                ? html`<img src=${point.photos[0]} style=${{ width: '100%', height: '100%', objectFit: 'cover' }} />`
                : html`<div style=${{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', color: 'var(--text-tertiary)', fontSize: '11px' }}><${ImageOff} size=${26} />нет фото<//>`}
              ${m3h && html`<div style=${{ position: 'absolute', bottom: '6px', right: '6px', background: 'rgba(20,17,12,.72)', color: '#fff', borderRadius: '6px', padding: '2px 7px', fontSize: '11px', fontWeight: 700 }}>Q: ${m3h}<//>`}
            </div>
            <div style=${{ flex: 1, background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)', padding: '10px 14px', overflowY: 'auto' }}>
              <div style=${{ fontSize: '10px', fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: '6px' }}>Данные последнего замера</div>
              ${[
                ['Горизонт', point.horizon],
                ['Дебит', m3h ? m3h + ' м³/ч' : null],
                ['Дата замера', fmtDate(point.monitoring_date)],
                ['Способ', point.measure_method],
                ['Интенсивность', point.intensity],
                ['Замерщик', point.worker],
                ['Координаты', point.x_local != null ? `X: ${Number(point.x_local).toFixed(1)}  Y: ${Number(point.y_local).toFixed(1)}` : null],
                ['Цвет воды', point.water_color],
                ['Примечание', point.comment],
              ].filter(([, v]) => v).map(([label, val]) => html`
                <div key=${label} style=${{ display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '3px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: '11px' }}>
                  <span style=${{ color: 'var(--text-tertiary)', flexShrink: 0 }}>${label}</span>
                  <span style=${{ fontWeight: 600, textAlign: 'right' }}>${val}</span>
                </div>
              `)}
            </div>
          </div>

          <div>
            <div class="section-label">История фотографий</div>
            ${!history ? html`<${Skeleton} height="80px" />` : !gallery.length ? html`<div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)', textAlign: 'center', padding: '14px 0' }}>Фотографии ещё не загружены<//>` : html`
              <div style=${{ fontSize: '10.5px', color: 'var(--text-tertiary)', marginBottom: '8px' }}>${gallery.length} ${gallery.length === 1 ? 'фотография' : gallery.length < 5 ? 'фотографии' : 'фотографий'} · от новых к старым</div>
              <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: '8px' }}>
                ${gallery.map((ph, i) => html`
                  <div key=${i} onClick=${() => setLightbox(i)} style=${{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', cursor: 'pointer', background: 'var(--bg-sunken)' }}>
                    <div style=${{ height: '72px' }}><img src=${ph.photoUrl} style=${{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /><//>
                    <div style=${{ padding: '4px 6px' }}>
                      <div style=${{ fontSize: '9.5px', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>${fmtDate(ph.monitoring_date)}<//>
                      <div style=${{ fontSize: '9.5px', color: 'var(--green-600)', fontWeight: 700 }}>${flowToM3h(ph.flow_rate) || '—'} м³/ч<//>
                    </div>
                  </div>
                `)}
              </div>
            `}
          </div>

          <div>
            <div class="section-label">Аналитика</div>
            ${!kpi ? html`<${Skeleton} height="60px" />` : html`
              <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                ${[['Среднее Q', kpi.avg, 'м³/ч'], ['Максимум', kpi.max, kpi.maxDate ? fmtDate(kpi.maxDate) : 'м³/ч'], ['Минимум', kpi.min, kpi.minDate ? fmtDate(kpi.minDate) : 'м³/ч'], ['Замеров', kpi.count, 'всего']].map(([label, val, sub]) => html`
                  <div key=${label} style=${{ background: 'var(--bg-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
                    <div style=${{ fontSize: '9.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: '3px' }}>${label}<//>
                    <div style=${{ fontSize: '17px', fontWeight: 800, color: 'var(--text-accent)', lineHeight: 1 }}>${val != null ? val : '—'}<//>
                    <div style=${{ fontSize: '9.5px', color: 'var(--text-tertiary)', marginTop: '2px' }}>${sub}<//>
                  </div>
                `)}
              </div>
            `}
          </div>

          <div>
            <div class="section-label">История дебита</div>
            ${!history ? html`<${Skeleton} height="140px" />` : chartData.filter((d) => d.m3h != null).length < 2 ? html`<div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)', textAlign: 'center', padding: '20px 0', background: 'var(--bg-sunken)', borderRadius: 'var(--radius-sm)' }}>Недостаточно данных для графика<//>` : html`
              <div style=${{ background: 'var(--bg-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', padding: '10px 6px 4px' }}>
                <${ResponsiveContainer} width="100%" height=${150}>
                  <${AreaChart} data=${chartData} margin=${{ top: 8, right: 16, left: -12, bottom: 0 }}>
                    <${CartesianGrid} strokeDasharray="3 3" stroke="var(--border-subtle)" vertical=${false} />
                    <${XAxis} dataKey="date" tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} />
                    <${YAxis} tick=${{ fontSize: 10, fill: 'var(--text-tertiary)' }} width=${34} />
                    <${Tooltip} formatter=${(v) => [v + ' м³/ч', 'Дебит']} contentStyle=${{ fontSize: '11px', borderRadius: '8px' }} />
                    <${Area} type="monotone" dataKey="m3h" stroke="var(--accent-strong)" fill="var(--accent)" fillOpacity=${0.18} strokeWidth=${1.8} dot=${CustomDot} connectNulls />
                  <//>
                <//>
              </div>
            `}
          </div>

          <div>
            <div class="section-label">Журнал замеров</div>
            ${!history ? html`<${Skeleton} height="120px" />` : !history.length ? html`<div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)', textAlign: 'center', padding: '14px 0' }}>История замеров пуста<//>` : html`
              <div style=${{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
                <table style=${{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                  <thead><tr style=${{ background: 'var(--bg-sunken)' }}>
                    ${['#', 'Дата', 'Q м³/ч', 'Интенсивность', 'Способ', 'Замерщик', 'St'].map((h) => html`<th key=${h} style=${{ padding: '5px 8px', textAlign: h === 'St' ? 'center' : 'left', fontSize: '9.5px', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontWeight: 700 }}>${h}<//>`)}
                  </tr></thead>
                  <tbody>
                    ${journalRows.map((r, i) => html`
                      <tr key=${r.id} style=${{ borderTop: '1px solid var(--border-subtle)' }}>
                        <td style=${{ padding: '5px 8px', color: 'var(--text-tertiary)' }}>${history.length - i}<//>
                        <td style=${{ padding: '5px 8px', color: 'var(--text-accent)' }}>${fmtDate(r.monitoring_date)}<//>
                        <td style=${{ padding: '5px 8px', fontWeight: 700 }}>${flowToM3h(r.flow_rate) || '—'}<//>
                        <td style=${{ padding: '5px 8px' }}>${r.intensity || '—'}<//>
                        <td style=${{ padding: '5px 8px' }}>${r.measure_method || '—'}<//>
                        <td style=${{ padding: '5px 8px' }}>${r.worker || '—'}<//>
                        <td style=${{ padding: '5px 8px', textAlign: 'center' }}><span style=${{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: STATUS_COLORS[r.status] || 'var(--text-tertiary)' }} /><//>
                      </tr>
                    `)}
                  </tbody>
                </table>
                ${!showAllJournal && history.length > 6 && html`
                  <div onClick=${() => setShowAllJournal(true)} style=${{ padding: '6px 10px', borderTop: '1px solid var(--border-subtle)', fontSize: '10.5px', color: 'var(--text-tertiary)', display: 'flex', justifyContent: 'space-between', cursor: 'pointer', background: 'var(--bg-sunken)' }}>
                    <span>Показано 6 из ${history.length} записей</span><span style=${{ color: 'var(--text-accent)' }}>Показать все ▾</span>
                  </div>
                `}
              </div>
            `}
          </div>
        </div>
      </div>
      ${lightbox != null && html`<${PhotoLightbox} photos=${gallery} startIdx=${lightbox} onClose=${() => setLightbox(null)} />`}
    </div>
  `;
}

// ── Диалог добавления/редактирования (с фото) ───────────────────────────
function PointFormDialog({ open, form, onChange, onClose, onSave, saving }) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  if (!form) return null;

  async function handleFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (!form.id) { onChange({ ...form, _pendingFile: file, _pendingPreview: URL.createObjectURL(file) }); return; }
    setUploading(true);
    try {
      const url = await uploadPointPhoto(form.id, file, form.point_number, form.monitoring_date);
      onChange({ ...form, photos: [url, ...(form.photos || [])] });
    } catch (err) {
      alert('Ошибка загрузки фото: ' + err.message);
    } finally {
      setUploading(false);
    }
  }
  async function handleDeletePhoto() {
    if (!confirm('Удалить фото этой точки?')) return;
    if (form.id) { setUploading(true); await deleteAllPointPhotos(form.id); setUploading(false); }
    onChange({ ...form, photos: [], _pendingFile: null, _pendingPreview: null });
  }

  const currentPhoto = form._pendingPreview || (form.photos && form.photos[0]);

  return html`
    <${Dialog}
      open=${open}
      onClose=${onClose}
      title=${form.id ? `Редактировать точку #${form.point_number || ''}` : 'Новая точка'}
      width="680px"
      footer=${html`
        <${Button} variant="outline" onClick=${onClose}>Отмена<//>
        <${Button} onClick=${onSave} disabled=${saving || uploading}>${saving ? 'Сохранение…' : 'Сохранить'}<//>
      `}
    >
      <div style=${{ display: 'flex', gap: '16px' }}>
        <div style=${{ flex: 1, display: 'flex', flexDirection: 'column', gap: '14px' }}>
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
        </div>
        <div style=${{ width: '170px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style=${{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Фото</div>
          <div style=${{ height: '130px', borderRadius: 'var(--radius-md)', background: 'var(--bg-sunken)', border: '1px solid var(--border-subtle)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
            ${currentPhoto
              ? html`<img src=${currentPhoto} style=${{ width: '100%', height: '100%', objectFit: 'cover' }} />`
              : html`<${ImageOff} size=${26} style=${{ color: 'var(--border-strong)' }} />`}
            ${uploading && html`<div style=${{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', color: 'var(--text-secondary)' }}>Загрузка…<//>`}
          </div>
          <input ref=${fileRef} type="file" accept="image/*" capture="environment" style=${{ display: 'none' }} onChange=${handleFile} />
          <${Button} variant="outline" size="sm" onClick=${() => fileRef.current && fileRef.current.click()} disabled=${uploading}><${Camera} size=${13} /> ${currentPhoto ? 'Заменить' : 'Загрузить'}<//>
          ${currentPhoto && html`<${Button} variant="outline" size="sm" onClick=${handleDeletePhoto} disabled=${uploading}><${Trash2} size=${13} style=${{ color: 'var(--red-500)' }} /> Удалить<//>`}
        </div>
      </div>
    <//>
  `;
}

const EMPTY_FORM = {
  id: null, point_number: '', monitoring_date: '', worker: '', status: 'Новая', intensity: '',
  flow_rate: '', water_color: '', wall: '', domain: '', measure_method: '', horizon: '', comment: '', photos: [],
};

export function PointsPage() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState([]);
  const [workerFilter, setWorkerFilter] = useState('');
  const [workers, setWorkers] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState(null);

  async function load() {
    setError(null);
    const [ptsRes, workersRes] = await Promise.all([
      supabase.from('points').select('*').order('monitoring_date', { ascending: false }).limit(3000),
      supabase.from('workers').select('name').eq('active', true).order('name'),
    ]);
    if (ptsRes.error) { setError(ptsRes.error.message); return; }
    setItems(ptsRes.data || []);
    setWorkers((workersRes.data || []).map((w) => w.name));
  }
  useEffect(() => { load(); }, []);

  const allDates = useMemo(() => (items ? getAllDates(items) : []), [items]);

  const filtered = useMemo(() => {
    if (!items) return [];
    let list = items;
    if (statusFilter) list = list.filter((p) => p.status === statusFilter);
    if (workerFilter) list = list.filter((p) => p.worker === workerFilter);
    if (dateFilter.length) list = list.filter((p) => dateFilter.includes((p.monitoring_date || '').slice(0, 10)));
    if (query.trim()) list = list.filter((p) => matchesSearch(p, query.trim()));
    return getLatestByPointNumber(list);
  }, [items, statusFilter, workerFilter, dateFilter, query]);

  const totalUniq = useMemo(() => (items ? getLatestByPointNumber(items).length : 0), [items]);

  function openAdd() { setForm(EMPTY_FORM); setDialogOpen(true); }
  function openEdit(row) {
    setForm({
      id: row.id, point_number: row.point_number || '', monitoring_date: (row.monitoring_date || '').slice(0, 10),
      worker: row.worker || '', status: row.status || 'Новая', intensity: row.intensity || '',
      flow_rate: row.flow_rate ?? '', water_color: row.water_color || '', wall: row.wall || '',
      domain: row.domain || '', measure_method: row.measure_method || '', horizon: row.horizon || '',
      comment: row.comment || '', photos: row.photos || [],
    });
    setDialogOpen(true);
    setDetail(null);
  }

  async function save() {
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
    };
    let pointId = form.id;
    if (form.id) {
      row.id = form.id;
      const { error: err } = await supabase.from('points').upsert(row);
      if (err) { setSaving(false); setError(err.message); return; }
    } else {
      const { data, error: err } = await supabase.from('points').insert(row).select('id').single();
      if (err) { setSaving(false); setError(err.message); return; }
      pointId = data.id;
    }
    if (form._pendingFile && pointId) {
      try {
        const url = await uploadPointPhoto(pointId, form._pendingFile, form.point_number, form.monitoring_date);
        await supabase.from('points').update({ photos: [url] }).eq('id', pointId);
      } catch (err) {
        alert('Точка сохранена, но фото не загрузилось: ' + err.message);
      }
    }
    setSaving(false);
    setDialogOpen(false);
    load();
  }

  async function remove(row) {
    if (!confirm(`Удалить точку «${row.point_number}»?`)) return;
    const { error: err } = await supabase.from('points').delete().eq('id', row.id);
    if (err) { setError(err.message); return; }
    setDetail(null);
    load();
  }

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Список точек</div>
          <div class="page-desc">${filtered.length} / ${totalUniq} точек (по последнему замеру)${query ? ` · поиск: «${query}»` : ''}</div>
        </div>
        <${Button} onClick=${openAdd}><${Plus} size=${16} /> Добавить<//>
      </div>

      ${error && html`<div style=${{ color: 'var(--red-500)', fontSize: '13px', marginBottom: '12px' }}>Ошибка: ${error}</div>`}

      <div style=${{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div style=${{ maxWidth: '320px', flex: 1, minWidth: '220px' }}>
          <${Input} icon=${html`<${Search} size=${15} />`} placeholder="Поиск по номеру, сотруднику, комментарию…" value=${query} onChange=${(e) => setQuery(e.target.value)} />
        </div>
        <${DateFilterDropdown} dates=${allDates} selected=${dateFilter} onChange=${setDateFilter} />
        <${Select} style=${{ width: '170px' }} value=${statusFilter} onChange=${(e) => setStatusFilter(e.target.value)}>
          <option value="">Все статусы</option>
          ${Object.keys(POINT_STATUSES).map((s) => html`<option key=${s} value=${s}>${s}<//>`)}
        <//>
        <${Select} style=${{ width: '170px' }} value=${workerFilter} onChange=${(e) => setWorkerFilter(e.target.value)}>
          <option value="">Все сотрудники</option>
          ${workers.map((w) => html`<option key=${w} value=${w}>${w}<//>`)}
        <//>
      </div>

      ${items === null ? html`
        <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
          ${[0, 1, 2, 3, 4, 5].map((i) => html`<${Skeleton} key=${i} height="220px" style=${{ borderRadius: 'var(--radius-lg)' }} />`)}
        </div>
      ` : !filtered.length ? html`
        <${EmptyState} icon=${html`<${Droplets} size=${40} />`} title="Ничего не найдено" description="Попробуйте изменить поиск или фильтры." />
      ` : html`
        <div style=${{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
          ${filtered.map((p) => html`<${PointCard} key=${p.id} p=${p} search=${query.trim()} onOpen=${setDetail} />`)}
        </div>
      `}

      ${detail && html`<${DetailModal} point=${detail} onClose=${() => setDetail(null)} onEdit=${openEdit} onDelete=${remove} />`}

      <${PointFormDialog}
        open=${dialogOpen}
        form=${form}
        onChange=${setForm}
        onClose=${() => setDialogOpen(false)}
        onSave=${save}
        saving=${saving}
      />
    </div>
  `;
}
