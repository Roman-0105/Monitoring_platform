import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Save, Droplets, Search, Download, Upload, Maximize2 } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { fetchAllRows } from '../lib/db-utils.js';
import { Button, Card, CardHeader, CardTitle, CardContent, Input, Select, Dialog, Tabs, Skeleton, EmptyState } from '../components/ui.js';
import { formatMonitoringDate, shortMonitoringDate, smoothPath } from '../lib/analytics-core.js';
import { WP_TYPES, loadWpTypeSettings } from '../lib/wp-types.js';
import { loadLeaflet } from '../lib/leaflet-loader.js';
import { makeWpIcon } from '../lib/wpmap-markers.js';
import { downloadWellLevelsTemplate, parseWellLevelsImportFile } from '../lib/well-levels-import.js';

function today() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const LEVEL_COLORS = ['var(--blue-500)', 'var(--green-500)', 'var(--amber-600)', 'var(--red-500)', 'var(--gold-500)', 'var(--stone-600)', '#7C5CBF', '#1E9BA8'];

// ═════════════════════ Компактная встроенная карта водопунктов ═════════════════════

function WellLevelsMap({ wells, selectedIds, onToggle }) {
  const containerRef = useRef(null);
  const st = useRef({ map: null, layerGroup: null });
  const [leafletReady, setLeafletReady] = useState(false);

  useEffect(() => { loadWpTypeSettings(); loadLeaflet().then(() => setLeafletReady(true)); }, []);

  useEffect(() => {
    if (!leafletReady || !containerRef.current || st.current.map) return;
    const L = window.L;
    const map = L.map(containerRef.current, { zoomControl: true, attributionControl: false });
    st.current.map = map;
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
    st.current.layerGroup = L.layerGroup().addTo(map);
    map.setView([51.1, 71.4], 12);
    return () => { map.remove(); st.current = { map: null, layerGroup: null }; };
  }, [leafletReady]);

  // Отрисовка маркеров + подгонка вида. Есть выбранные скважины — карта
  // приближается именно к ним (и с чекбокса в списке, и с клика по маркеру,
  // который тоже меняет selectedIds); выбор снят — обзор всех отфильтрованных
  // водопунктов (в т.ч. при первой загрузке, пока ничего не выбрано).
  useEffect(() => {
    const s = st.current;
    if (!s.map || !s.layerGroup) return;
    const L = window.L;
    s.layerGroup.clearLayers();
    const withCoords = [];
    const selected = [];
    (wells || []).forEach((w) => {
      if (!w.lat || !w.lng) return;
      const isSel = selectedIds.has(w.id);
      const icon = makeWpIcon(L, w.wp_type, isSel, w.name, WP_TYPES);
      const marker = L.marker([w.lat, w.lng], { icon, opacity: isSel ? 1 : 0.6 });
      marker.on('click', () => onToggle(w.id));
      marker.addTo(s.layerGroup);
      withCoords.push(w);
      if (isSel) selected.push(w);
    });
    const source = selected.length ? selected : withCoords;
    const bounds = source.map((w) => [w.lat, w.lng]);
    if (bounds.length === 1) s.map.setView(bounds[0], Math.max(s.map.getZoom() || 0, 15));
    else if (bounds.length > 1) s.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
  }, [wells, selectedIds, leafletReady]);

  return html`
    <div style=${{ position: 'relative', width: '100%', height: '100%', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'var(--bg-sunken)' }}>
      ${!leafletReady && html`<div class="anl-empty" style=${{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Загрузка карты…</div>`}
      <div ref=${containerRef} style=${{ width: '100%', height: '100%' }} />
    </div>
  `;
}

// ═════════════════════ График замеров УПВ (несколько скважин, hover) ═════════════════════

const QUARTERS = [{ value: '1', label: 'I кв.' }, { value: '2', label: 'II кв.' }, { value: '3', label: 'III кв.' }, { value: '4', label: 'IV кв.' }];
const CHART_WINDOW = 90; // точек одновременно на оси X, дальше — прокрутка

function WellLevelsChart({ wells, byWellDate, selectedIds }) {
  const [hover, setHover] = useState(null);
  const [fsHover, setFsHover] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [yearFilter, setYearFilter] = useState('');
  const [quarterFilter, setQuarterFilter] = useState('');
  // 100% = естественный охват данных (как раньше). <100% — сужаем диапазон
  // (растягивает колебания по Y), >100% — расширяем диапазон (сжимает график).
  const [yScale, setYScale] = useState(100);
  const [panStart, setPanStart] = useState(0);

  const selectedWells = useMemo(() => (wells || []).filter((w) => selectedIds.has(w.id)), [wells, selectedIds]);

  const allDatesFull = useMemo(() => {
    const set = new Set();
    selectedWells.forEach((w) => Object.keys(byWellDate[w.id] || {}).forEach((d) => set.add(d)));
    return Array.from(set).sort();
  }, [selectedWells, byWellDate]);

  const availableYears = useMemo(() => Array.from(new Set(allDatesFull.map((d) => d.slice(0, 4)))).sort(), [allDatesFull]);

  const allDatesFiltered = useMemo(() => {
    return allDatesFull.filter((d) => {
      if (yearFilter && d.slice(0, 4) !== yearFilter) return false;
      if (quarterFilter) {
        const month = parseInt(d.slice(5, 7), 10);
        if (Math.ceil(month / 3) !== parseInt(quarterFilter, 10)) return false;
      }
      return true;
    });
  }, [allDatesFull, yearFilter, quarterFilter]);

  useEffect(() => { setPanStart(0); setHover(null); setFsHover(null); }, [yearFilter, quarterFilter, selectedIds]);
  useEffect(() => { if (fullscreen) setFsHover(null); }, [fullscreen]);

  const needsPan = allDatesFiltered.length > CHART_WINDOW;
  const maxPanStart = Math.max(0, allDatesFiltered.length - CHART_WINDOW);
  const clampedPan = Math.min(panStart, maxPanStart);
  const windowedDates = needsPan ? allDatesFiltered.slice(clampedPan, clampedPan + CHART_WINDOW) : allDatesFiltered;

  if (!selectedWells.length) return html`<div class="anl-empty">Выберите одну или несколько скважин на карте или в списке слева</div>`;
  if (!allDatesFull.length) return html`<div class="anl-empty">Замеров пока нет</div>`;

  function elevOf(w, d) {
    const rec = (byWellDate[w.id] || {})[d];
    if (!rec || rec.depth_to_water == null) return null;
    const elevZ = parseFloat(w.elev_z);
    const depth = parseFloat(rec.depth_to_water);
    if (Number.isNaN(elevZ) || Number.isNaN(depth)) return null;
    return elevZ - depth;
  }

  function renderChart(dates, W, H, hoverIdx, onHover, keyPrefix) {
    const PAD = { top: 16, right: 16, bottom: 26, left: 48 };
    const cW = W - PAD.left - PAD.right, cH = H - PAD.top - PAD.bottom;
    const n = dates.length;

    const allVals = [];
    selectedWells.forEach((w) => dates.forEach((d) => { const v = elevOf(w, d); if (v != null) allVals.push(v); }));
    const rawMax = allVals.length ? Math.max(...allVals) : 1;
    const rawMin = allVals.length ? Math.min(...allVals) : 0;
    const center = (rawMax + rawMin) / 2;
    const basePad = (rawMax - rawMin) * 0.12 || 1;
    const naturalHalf = (rawMax - rawMin) / 2 + basePad;
    const half = (naturalHalf * (yScale / 100)) || 1;
    const maxV = center + half, minV = center - half;
    const range = (maxV - minV) || 1;

    const px = (i) => (n === 1 ? PAD.left + cW / 2 : PAD.left + (i / (n - 1)) * cW);
    const py = (v) => PAD.top + cH - ((v - minV) / range) * cH;
    const fontAxis = W > 900 ? 10 : 7;
    const step = Math.max(1, Math.ceil(n / (W > 900 ? 16 : 7)));
    const hitW = cW / Math.max(n - 1, 1);
    const hoveredDate = hoverIdx != null ? dates[hoverIdx] : null;
    const clipId = 'wl-clip-' + keyPrefix;

    const series = selectedWells.map((w, wi) => {
      const pts = [];
      dates.forEach((d, i) => { const v = elevOf(w, d); if (v != null) pts.push({ x: px(i), y: py(v) }); });
      return { well: w, color: LEVEL_COLORS[wi % LEVEL_COLORS.length], pts };
    });

    return html`
      <div style=${{ position: 'relative' }}>
        <svg viewBox=${`0 0 ${W} ${H}`} style=${{ width: '100%', display: 'block' }}>
          <defs><clipPath id=${clipId}><rect x=${PAD.left} y=${PAD.top} width=${cW} height=${cH} /></clipPath></defs>
          ${[0, 0.5, 1].map((f) => html`<line key=${f} x1=${PAD.left} y1=${py(minV + range * f).toFixed(1)} x2=${PAD.left + cW} y2=${py(minV + range * f).toFixed(1)} stroke="var(--border-subtle)" stroke-width="1" />`)}
          ${[0, 0.5, 1].map((f) => html`<text key=${'t' + f} x=${PAD.left - 6} y=${(py(minV + range * f) + 2.5).toFixed(1)} text-anchor="end" font-size=${fontAxis} fill="var(--text-tertiary)">${(minV + range * f).toFixed(1)}</text>`)}
          <g clip-path=${`url(#${clipId})`}>
            ${hoverIdx != null && html`<line x1=${px(hoverIdx).toFixed(1)} y1=${PAD.top} x2=${px(hoverIdx).toFixed(1)} y2=${PAD.top + cH} stroke="var(--stone-400)" stroke-width="1" stroke-dasharray="3,3" />`}
            ${series.map((sd) => sd.pts.length ? html`<path key=${'l' + sd.well.id} d=${smoothPath(sd.pts)} fill="none" stroke=${sd.color} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />` : null)}
            ${series.map((sd) => sd.pts.map((p, pi) => html`<circle key=${sd.well.id + '-' + pi} cx=${p.x.toFixed(1)} cy=${p.y.toFixed(1)} r="2.4" fill=${sd.color} stroke="#fff" stroke-width="1" />`))}
          </g>
          ${dates.map((d, i) => (i % step === 0 || i === n - 1) ? html`<text key=${'d' + d} x=${px(i).toFixed(1)} y=${H - 6} text-anchor="middle" font-size=${fontAxis} fill="var(--text-tertiary)">${shortMonitoringDate(d)}</text>` : null)}
          ${dates.map((d, i) => html`<rect key=${'hit-' + d} x=${(px(i) - hitW / 2).toFixed(1)} y=${PAD.top} width=${hitW.toFixed(1)} height=${cH} fill="transparent" style=${{ cursor: 'crosshair' }} onMouseEnter=${() => onHover(i)} onMouseLeave=${() => onHover(null)} />`)}
        </svg>
        ${hoveredDate && html`
          <div class="anl-wt-tip" style=${{ fontSize: '10px', left: ((px(hoverIdx) > W * 0.6 ? px(hoverIdx) - 190 : px(hoverIdx) + 10) / W) * 100 + '%', top: '6%' }}>
            <div class="anl-wt-tip-date" style=${{ fontSize: '9px' }}>${formatMonitoringDate(hoveredDate)}</div>
            ${series.map((sd) => {
              const rec = (byWellDate[sd.well.id] || {})[hoveredDate];
              const v = elevOf(sd.well, hoveredDate);
              return html`
                <div key=${sd.well.id} class="anl-wt-tip-row">
                  <span><span class="anl-legend-swatch" style=${{ background: sd.color, borderRadius: '50%', width: '8px', height: '8px' }} />${sd.well.name || sd.well.code}<//>
                  <b style=${{ color: sd.color }}>
                    ${v != null ? v.toFixed(2) + ' м' : '—'}
                    ${rec && rec.depth_to_water != null ? html` <span style=${{ color: 'var(--text-tertiary)', fontWeight: 500 }}>(гл. ${Number(rec.depth_to_water).toFixed(2)} м)</span>` : ''}
                  </b>
                </div>
              `;
            })}
          </div>
        `}
      </div>
    `;
  }

  const isYScaled = yScale !== 100;
  const legend = html`
    <div class="anl-hist-legend" style=${{ fontSize: '11px' }}>
      ${selectedWells.map((w, wi) => html`<span key=${w.id}><span class="anl-legend-swatch" style=${{ background: LEVEL_COLORS[wi % LEVEL_COLORS.length] }} />${w.name || w.code}<//>`)}
    </div>
  `;

  return html`
    <div>
      <div style=${{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div style=${{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'nowrap' }}>
          <${Select} value=${yearFilter} onChange=${(e) => setYearFilter(e.target.value)} style=${{ width: '104px', flex: '0 0 auto', fontSize: '12px' }}>
            <option value="">Все годы</option>
            ${availableYears.map((y) => html`<option key=${y} value=${y}>${y}<//>`)}
          <//>
          <${Select} value=${quarterFilter} onChange=${(e) => setQuarterFilter(e.target.value)} style=${{ width: '104px', flex: '0 0 auto', fontSize: '12px' }}>
            <option value="">Все кварталы</option>
            ${QUARTERS.map((q) => html`<option key=${q.value} value=${q.value}>${q.label}<//>`)}
          <//>
          ${(yearFilter || quarterFilter) && html`<${Button} variant="outline" size="sm" style=${{ flexShrink: 0, whiteSpace: 'nowrap' }} onClick=${() => { setYearFilter(''); setQuarterFilter(''); }}>Сбросить период<//>`}
        </div>

        <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'nowrap' }}>
          <span style=${{ fontSize: '10px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>◀ Сжать · Растянуть ▶</span>
          <input type="range" min="25" max="400" step="5" value=${yScale} onChange=${(e) => setYScale(Number(e.target.value))} style=${{ width: '120px' }} />
          <span style=${{ fontSize: '10px', color: 'var(--text-secondary)', minWidth: '34px', textAlign: 'right' }}>${yScale}%</span>
          ${isYScaled && html`<button type="button" onClick=${() => setYScale(100)} style=${{ fontSize: '9px', color: 'var(--text-accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>сброс</button>`}
          <${Button} variant="outline" size="sm" icon title="Развернуть на весь экран" onClick=${() => setFullscreen(true)}><${Maximize2} size=${14} /><//>
        </div>
      </div>

      ${legend}
      ${renderChart(windowedDates, 640, 240, hover, setHover, 'main')}

      ${needsPan && html`
        <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', paddingLeft: '48px' }}>
          <span style=${{ fontSize: '10px', color: 'var(--text-tertiary)', flexShrink: 0 }}>◀ Прокрутка по датам ▶</span>
          <input type="range" min="0" max=${maxPanStart} step="1" value=${clampedPan} onChange=${(e) => setPanStart(Number(e.target.value))} style=${{ flex: 1 }} />
          <span style=${{ fontSize: '10px', color: 'var(--text-tertiary)', flexShrink: 0, whiteSpace: 'nowrap' }}>${shortMonitoringDate(windowedDates[0])} — ${shortMonitoringDate(windowedDates[windowedDates.length - 1])}</span>
        </div>
      `}

      ${fullscreen && html`
        <${Dialog} open=${true} onClose=${() => setFullscreen(false)} title="График замеров УПВ — все данные" width="min(1300px, 96vw)">
          ${legend}
          ${renderChart(allDatesFiltered, 1180, 520, fsHover, setFsHover, 'fs')}
        <//>
      `}
    </div>
  `;
}

// ═════════════════════ Вкладка «Карта и график» ═════════════════════

function WellLevelsMapChartTab({ wells, byWellDate }) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (wells || []).filter((w) => {
      if (typeFilter && w.wp_type !== typeFilter) return false;
      if (!q) return true;
      return (w.name || '').toLowerCase().includes(q) || (w.code || '').toLowerCase().includes(q);
    });
  }, [wells, query, typeFilter]);

  function toggle(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return html`
    <div>
      <${Card} style=${{ marginBottom: '16px' }}>
        <div class="reg-toolbar">
          <div style=${{ maxWidth: '260px', flex: 1, minWidth: '180px' }}>
            <${Input} icon=${html`<${Search} size=${15} />`} placeholder="Код или название…" value=${query} onChange=${(e) => setQuery(e.target.value)} />
          </div>
          <div class="reg-chips">
            <button type="button" class=${'reg-chip' + (!typeFilter ? ' active' : '')} onClick=${() => setTypeFilter('')}>Все<//>
            <button type="button" class=${'reg-chip' + (typeFilter === 'well_obs' ? ' active' : '')} onClick=${() => setTypeFilter('well_obs')}>Наблюдательные<//>
            <button type="button" class=${'reg-chip' + (typeFilter === 'well_exp' ? ' active' : '')} onClick=${() => setTypeFilter('well_exp')}>Эксплуатационные<//>
          </div>
          <div style=${{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '10px' }}>
            ${selectedIds.size > 0 && html`<span style=${{ fontSize: '12px', color: 'var(--text-secondary)' }}>Выбрано: ${selectedIds.size}</span>`}
            ${selectedIds.size > 0 && html`<${Button} variant="outline" size="sm" onClick=${() => setSelectedIds(new Set())}>Сбросить<//>`}
          </div>
        </div>
      <//>

      <div style=${{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '14px', height: '340px' }}>
        <div style=${{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', overflowY: 'auto', background: 'var(--bg-surface)' }}>
          ${!filtered.length ? html`<${EmptyState} icon=${html`<${Droplets} size=${32} />`} title="Ничего не найдено" />` : filtered.map((w) => html`
            <label key=${w.id} class="wells-list-row" style=${{ cursor: 'pointer' }}>
              <input type="checkbox" checked=${selectedIds.has(w.id)} onChange=${() => toggle(w.id)} style=${{ marginRight: '2px' }} />
              <span class="wells-list-dot" style=${{ background: (WP_TYPES[w.wp_type] || WP_TYPES.other).color }} />
              <div style=${{ flex: 1, minWidth: 0 }}>
                <div style=${{ fontWeight: 600, fontSize: '12.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${w.name || w.code}</div>
                <div style=${{ fontSize: '10.5px', color: 'var(--text-tertiary)' }}>${w.code || '—'} · ${(WP_TYPES[w.wp_type] || WP_TYPES.other).short}</div>
              </div>
            </label>
          `)}
        </div>
        <${WellLevelsMap} wells=${filtered} selectedIds=${selectedIds} onToggle=${toggle} />
      </div>

      <${Card} style=${{ marginTop: '16px' }}>
        <${CardHeader}><${CardTitle}>График замеров УПВ (абс. отметка воды)<//><//>
        <${CardContent}>
          <${WellLevelsChart} wells=${wells || []} byWellDate=${byWellDate} selectedIds=${selectedIds} />
        <//>
      <//>
    </div>
  `;
}

// ═════════════════════ Вкладка «Ввод данных» ═════════════════════

function WellLevelsEntryTab({ wells, byWellDate, reload }) {
  const [date, setDate] = useState(today());
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [pending, setPending] = useState({});
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [bulkStatus, setBulkStatus] = useState(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const fileInputRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (wells || []).filter((w) => {
      if (typeFilter && w.wp_type !== typeFilter) return false;
      if (!q) return true;
      return (w.name || '').toLowerCase().includes(q) || (w.code || '').toLowerCase().includes(q);
    });
  }, [wells, query, typeFilter]);

  function setDepth(wellId, val) { setPending((p) => ({ ...p, [wellId]: val })); }
  function onChangeDate(v) { setDate(v || today()); setPending({}); }
  const pendingCount = Object.keys(pending).filter((id) => String(pending[id]).trim() !== '').length;

  async function saveAll() {
    const toSave = [];
    (wells || []).forEach((w) => {
      const val = pending[w.id];
      if (val == null || String(val).trim() === '') return;
      const depth = parseFloat(val);
      if (Number.isNaN(depth)) return;
      const existing = (byWellDate[w.id] || {})[date];
      const row = { well_id: w.id, date, depth_to_water: depth };
      if (existing) row.id = existing.id;
      toSave.push(row);
    });
    if (!toSave.length) { setStatus('Нет заполненных значений для сохранения.'); return; }
    setSaving(true);
    setStatus('Сохранение…');
    let ok = 0, errCount = 0;
    for (const row of toSave) {
      const { error } = await supabase.from('wp_well_levels').upsert(row);
      if (error) errCount++; else ok++;
    }
    setSaving(false);
    if (!errCount) setPending({});
    await reload();
    setStatus(errCount ? `Сохранено: ${ok}, ошибок: ${errCount}` : `Сохранено: ${ok}.`);
  }

  async function handleDownloadTemplate() {
    try { await downloadWellLevelsTemplate(wells || []); } catch (e) { alert('Ошибка: ' + e.message); }
  }

  async function handleImport() {
    const file = fileInputRef.current && fileInputRef.current.files[0];
    if (!file) { setBulkStatus({ type: 'warn', text: 'Выберите файл.' }); return; }
    setBulkBusy(true);
    setBulkStatus({ type: 'info', text: 'Обработка файла…' });
    try {
      const { rows, created, updated, errors, unknownCols } = await parseWellLevelsImportFile(file, wells || [], byWellDate);
      if (!rows.length) { setBulkStatus({ type: 'error', text: 'Не найдено ни одной строки с данными для загрузки.' }); return; }
      const CHUNK = 500;
      let errCount = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        setBulkStatus({ type: 'info', text: `Сохранение… ${Math.min(i + CHUNK, rows.length)} из ${rows.length}` });
        const { error } = await supabase.from('wp_well_levels').upsert(chunk);
        if (error) errCount += chunk.length;
      }
      await reload();
      let text = `Загрузка завершена: создано ${created}, обновлено ${updated}`;
      if (errCount) text += `, ошибок сохранения ${errCount}`;
      if (errors) text += `, ошибок разбора ${errors}`;
      if (unknownCols.length) text += `, не распознано колонок: ${unknownCols.length}`;
      setBulkStatus({ type: (errCount || errors || unknownCols.length) ? 'warn' : 'success', text });
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e) {
      setBulkStatus({ type: 'error', text: 'Ошибка: ' + e.message });
    } finally {
      setBulkBusy(false);
    }
  }

  return html`
    <div>
      <div style=${{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', gap: '12px', flexWrap: 'wrap' }}>
        <div style=${{ fontSize: '13px', color: 'var(--text-secondary)' }}>Потуровый ввод глубины до воды по наблюдательным и эксплуатационным скважинам.</div>
        <${Button} onClick=${saveAll} disabled=${saving}><${Save} size=${16} /> ${saving ? 'Сохранение…' : 'Сохранить всё'}<//>
      </div>

      <${Card} style=${{ marginBottom: '16px' }}>
        <${CardHeader}><${CardTitle}>Массовая загрузка (Excel)<//><//>
        <${CardContent}>
          <p style=${{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.6 }}>
            В шаблоне даты — сверху вниз (строки), скважины — слева направо (столбцы). Пустая ячейка — этот замер не трогаем; если на эту дату для скважины уже есть замер — он обновится, если нет — создастся новый.
          </p>
          <div style=${{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '12px' }}>
            <${Button} variant="outline" onClick=${handleDownloadTemplate} disabled=${!wells || !wells.length}><${Download} size=${15} /> Скачать шаблон .xlsx<//>
          </div>
          <div style=${{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input ref=${fileInputRef} type="file" accept=".xlsx,.xls" />
            <${Button} onClick=${handleImport} disabled=${bulkBusy || !wells || !wells.length}><${Upload} size=${15} /> ${bulkBusy ? 'Загрузка…' : 'Импортировать'}<//>
          </div>
          ${bulkStatus && html`
            <div style=${{ marginTop: '10px', fontSize: '12.5px', color: bulkStatus.type === 'error' ? 'var(--red-500)' : bulkStatus.type === 'warn' ? 'var(--amber-600)' : bulkStatus.type === 'success' ? 'var(--green-500)' : 'var(--text-secondary)' }}>${bulkStatus.text}</div>
          `}
        <//>
      <//>

      <${Card}>
        <div style=${{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 16px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          <div>
            <label style=${{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Дата тура</label>
            <${Input} type="date" value=${date} onChange=${(e) => onChangeDate(e.target.value)} style=${{ width: '160px' }} />
          </div>
          <div style=${{ maxWidth: '260px', flex: 1 }}>
            <label style=${{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Поиск</label>
            <${Input} placeholder="Код или название…" value=${query} onChange=${(e) => setQuery(e.target.value)} />
          </div>
          <${Tabs}
            tabs=${[{ value: '', label: 'Все типы' }, { value: 'well_obs', label: 'Наблюдательные' }, { value: 'well_exp', label: 'Эксплуатационные' }]}
            value=${typeFilter}
            onChange=${setTypeFilter}
          />
          <div style=${{ marginLeft: 'auto', textAlign: 'right' }}>
            ${pendingCount > 0 && html`<div style=${{ fontSize: '12px', fontWeight: 700, color: 'var(--gold-600)' }}>Не сохранено: ${pendingCount}</div>`}
            <div style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>${wells ? `${filtered.length} из ${wells.length}` : ''}</div>
          </div>
        </div>

        ${status && html`<div style=${{ padding: '10px 16px 0', fontSize: '12px', color: 'var(--text-secondary)' }}>${status}</div>`}

        <${CardContent} tight>
          ${wells === null ? html`<div style=${{ padding: '18px' }}><${Skeleton} height="240px" /></div>` : html`
            <div class="table-wrap">
              <table class="data-table">
                <thead><tr>
                  <th>Скважина</th><th>Отметка устья, м</th><th>Глубина до воды, м</th><th>Абс. отметка воды, м</th><th>Последний замер</th>
                </tr></thead>
                <tbody>
                  ${filtered.map((w) => {
                    const wd = byWellDate[w.id] || {};
                    const existing = wd[date];
                    const dates = Object.keys(wd).sort();
                    const lastRow = dates.length ? wd[dates[dates.length - 1]] : null;
                    const pendingVal = pending[w.id];
                    const val = pendingVal != null ? pendingVal : (existing ? existing.depth_to_water : '');
                    const elevZ = parseFloat(w.elev_z);
                    const depthNum = parseFloat(val);
                    const preview = !Number.isNaN(elevZ) && !Number.isNaN(depthNum) ? (elevZ - depthNum).toFixed(2) : '—';
                    const dirty = pendingVal != null && String(pendingVal).trim() !== '';
                    return html`
                      <tr key=${w.id} style=${dirty ? { background: 'rgba(201,154,91,0.12)' } : undefined}>
                        <td style=${{ fontWeight: 600 }}>${w.name || w.code} ${dirty && html`<span style=${{ color: '#c99a5b' }}> ●</span>`}</td>
                        <td class="mono" style=${{ color: 'var(--text-tertiary)' }}>${Number.isNaN(elevZ) ? '—' : elevZ.toFixed(2)}</td>
                        <td><input type="number" step="0.01" class="input" style=${{ width: '100px' }} value=${val} onChange=${(e) => setDepth(w.id, e.target.value)} /></td>
                        <td class="mono">${preview}</td>
                        <td style=${{ color: 'var(--text-tertiary)' }}>${lastRow ? `${lastRow.date} (${parseFloat(lastRow.depth_to_water).toFixed(2)} м)` : '—'}</td>
                      </tr>
                    `;
                  })}
                </tbody>
              </table>
              ${!filtered.length && html`
                <div class="empty-state"><${Droplets} size=${36} /><div class="empty-state-title">Ничего не найдено</div></div>
              `}
            </div>
          `}
        <//>
      <//>
    </div>
  `;
}

// ═════════════════════ Страница ═════════════════════

export function WellLevelsPage() {
  const [tab, setTab] = useState('map');
  const [wells, setWells] = useState(null);
  const [byWellDate, setByWellDate] = useState({});
  const [loadError, setLoadError] = useState('');

  async function loadLevels() {
    let data;
    try {
      data = await fetchAllRows('wp_well_levels', { select: 'id, well_id, date, depth_to_water', order: 'date', ascending: false });
    } catch (e) { setLoadError('Ошибка загрузки замеров: ' + e.message); return; }
    const idx = {};
    (data || []).forEach((r) => { if (!idx[r.well_id]) idx[r.well_id] = {}; idx[r.well_id][r.date] = r; });
    setByWellDate(idx);
  }

  async function loadAll() {
    const { data, error } = await supabase.from('wp_registry').select('id, name, code, wp_type, elev_z, lat, lng').in('wp_type', ['well_obs', 'well_exp']);
    if (error) { setLoadError('Ошибка загрузки скважин: ' + error.message); return; }
    setWells((data || []).sort((a, b) => (a.name || a.code || '').localeCompare(b.name || b.code || '', 'ru')));
    await loadLevels();
  }

  useEffect(() => { loadAll(); }, []);

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Замеры УПВ</div>
          <div class="page-desc">Карта и график замеров, потуровый ввод глубины до воды по наблюдательным и эксплуатационным скважинам.</div>
        </div>
      </div>

      ${loadError && html`<div style=${{ color: 'var(--red-500)', fontSize: '13px', marginBottom: '12px' }}>${loadError}</div>`}

      <div style=${{ marginBottom: '16px' }}>
        <${Tabs} tabs=${[{ value: 'map', label: 'Карта и график' }, { value: 'entry', label: 'Ввод данных' }]} value=${tab} onChange=${setTab} />
      </div>

      ${tab === 'map' && html`<${WellLevelsMapChartTab} wells=${wells} byWellDate=${byWellDate} />`}
      ${tab === 'entry' && html`<${WellLevelsEntryTab} wells=${wells} byWellDate=${byWellDate} reload=${loadAll} />`}
    </div>
  `;
}
