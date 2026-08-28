// Схема водного баланса — React-обёртка над DiagramEngine (X6 + dagre), точный порт
// тулбара/режимов hydro-monitoring/ui-dewatering-diagram.js (см. dewatering-diagram-core.js
// для модели/раскладки/движка). Компонент лишь монтирует контейнер и управляет состоянием
// тулбара (период, зум, анимация, редактирование связей, шаблоны, полный экран).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Maximize2, Minimize2, Pencil, LayoutGrid, Play, Pause, ZoomIn, ZoomOut, Scan, X, Save, Image as ImageIcon, Move, Trash2, Upload } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { loadX6 } from '../lib/x6-loader.js';
import { Button, Input } from '../components/ui.js';
import { destTypeInfo } from '../lib/dewatering-core.js';
import {
  DiagramEngine, buildDiagramModel, resolveDateRange, periodLabel,
  loadPositions, savePositions, loadEdgeOverrides, saveEdgeOverrides,
  fetchDiagramTemplates, upsertDiagramTemplate, deleteDiagramTemplate, genTemplateId,
  fetchBackground, uploadBackground, updateBackgroundSettings, deleteBackground,
} from '../lib/dewatering-diagram-core.js';

const BG_VISIBLE_KEY = 'dew_diagram_bg_visible';

const PRESETS = [
  { value: 'yesterday', label: 'Вчера' },
  { value: '7d', label: '7 дней' },
  { value: '2w', label: '2 нед' },
  { value: '1m', label: '1 мес' },
  { value: 'custom', label: 'Период' },
];

function todayIso() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function useDustSource() {
  const [state, setState] = useState({ nozzles: [], dustLogs: [], dustVehicles: [] });
  useEffect(() => {
    (async () => {
      const [nozzlesR, logsR, vehiclesR] = await Promise.all([
        supabase.from('dust_nozzles').select('*'),
        supabase.from('dust_logs').select('*'),
        supabase.from('dust_vehicles').select('*'),
      ]);
      setState({ nozzles: nozzlesR.data || [], dustLogs: logsR.data || [], dustVehicles: vehiclesR.data || [] });
    })();
  }, []);
  return state;
}

export function DewateringDiagram({ data, onSumpClick }) {
  const dust = useDustSource();
  const containerRef = useRef(null);
  const engineRef = useRef(null);
  const [x6Ready, setX6Ready] = useState(!!(window.X6 && window.dagre));

  const [preset, setPreset] = useState('yesterday');
  const [customFrom, setCustomFrom] = useState(todayIso());
  const [customTo, setCustomTo] = useState(todayIso());
  const [editMode, setEditMode] = useState(false);
  const [animEnabled, setAnimEnabled] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [zoomPct, setZoomPct] = useState(100);
  const [positions, setPositions] = useState(() => loadPositions());
  const [edgeOverrides, setEdgeOverrides] = useState(() => loadEdgeOverrides());
  const positionsRef = useRef(positions); positionsRef.current = positions;
  const edgeOverridesRef = useRef(edgeOverrides); edgeOverridesRef.current = edgeOverrides;

  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [saveDraft, setSaveDraft] = useState(null); // null = скрыта форма; строка = имя, которое печатают
  const [saveError, setSaveError] = useState('');

  const [bg, setBg] = useState(null);
  const [bgPanelOpen, setBgPanelOpen] = useState(false);
  const [bgMoveMode, setBgMoveMode] = useState(false);
  const [bgVisible, setBgVisible] = useState(() => { try { return localStorage.getItem(BG_VISIBLE_KEY) !== '0'; } catch { return true; } });
  const [bgBusy, setBgBusy] = useState(false);
  const bgFileRef = useRef(null);

  useEffect(() => { loadX6().then(() => setX6Ready(true)).catch((e) => console.error(e)); }, []);
  useEffect(() => { fetchBackground(supabase).then(setBg).catch((e) => console.error(e)); }, []);

  const range = useMemo(() => resolveDateRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  const model = useMemo(() => buildDiagramModel({
    sumps: data.sumps, pumps: data.pumps, destinations: data.destinations, readings: data.readings,
    levels: data.levels, elevationHistory: data.elevationHistory,
    nozzles: dust.nozzles, dustLogs: dust.dustLogs, dustVehicles: dust.dustVehicles,
  }, range.from, range.to), [data, dust, range.from, range.to]);

  function persistPositions(next) { setPositions(next); savePositions(next); }
  function persistEdges(next) { setEdgeOverrides(next); saveEdgeOverrides(next); }
  async function handleBgMoved({ x, y }) {
    setBg((prev) => (prev ? { ...prev, offsetX: x, offsetY: y } : prev));
    try { await updateBackgroundSettings(supabase, { offsetX: x, offsetY: y }); } catch (e) { console.error(e); }
  }

  useEffect(() => {
    if (!x6Ready || !containerRef.current) return;
    if (!engineRef.current) {
      engineRef.current = new DiagramEngine(containerRef.current, {
        getPositions: () => positionsRef.current,
        getEdgeOverrides: () => edgeOverridesRef.current,
        onPositionsChange: persistPositions,
        onEdgesChange: persistEdges,
        onZoomChange: (z) => setZoomPct(Math.round(z * 100)),
        onSumpClick: onSumpClick,
        onBackgroundMoved: handleBgMoved,
      });
    }
    const background = bg ? { ...bg, moveMode: bgMoveMode, visible: bgVisible } : null;
    engineRef.current.render(model, { positions, edgeOverrides, editMode, animEnabled, background });
    return undefined;
  }, [x6Ready, model, editMode, animEnabled, fullscreen, bg, bgMoveMode, bgVisible]);

  useEffect(() => () => { if (engineRef.current) engineRef.current.dispose(); }, []);

  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e) { if (e.key === 'Escape') setFullscreen(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  useEffect(() => { engineRef.current && engineRef.current.resize(); }, [fullscreen]);

  function resetLayout() { persistPositions({}); }
  function resetEdges() { persistEdges({}); }

  async function openTemplates() {
    setTemplatesOpen((v) => !v);
    if (!templatesLoaded) {
      try { setTemplates(await fetchDiagramTemplates(supabase)); setTemplatesLoaded(true); }
      catch (e) { console.error(e); }
    }
  }
  async function confirmSaveTemplate() {
    const name = (saveDraft || '').trim();
    if (!name) { setSaveError('Укажите название'); return; }
    setTemplateBusy(true);
    setSaveError('');
    try {
      const existing = templates.find((t) => t.name === name);
      const row = { id: existing ? existing.id : genTemplateId(), name, positions: positionsRef.current, edges: edgeOverridesRef.current };
      await upsertDiagramTemplate(supabase, row);
      setTemplates(await fetchDiagramTemplates(supabase));
      setSaveDraft(null);
    } catch (e) { setSaveError('Ошибка сохранения: ' + e.message); } finally { setTemplateBusy(false); }
  }
  function applyTemplate(t) {
    persistPositions({ ...t.positions });
    persistEdges({ ...t.edges });
  }
  async function removeTemplate(t) {
    if (!confirm(`Удалить шаблон «${t.name}»?`)) return;
    try { await deleteDiagramTemplate(supabase, t.id); setTemplates(await fetchDiagramTemplates(supabase)); }
    catch (e) { alert('Ошибка: ' + e.message); }
  }

  function toggleBgVisible() {
    setBgVisible((v) => { const next = !v; try { localStorage.setItem(BG_VISIBLE_KEY, next ? '1' : '0'); } catch {} return next; });
  }
  async function handleBgFile(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setBgBusy(true);
    try {
      const next = await uploadBackground(supabase, file, bg?.storagePath);
      setBg(next);
      setBgMoveMode(false);
      if (!bgVisible) toggleBgVisible();
    } catch (err) { alert('Ошибка загрузки плана: ' + err.message); } finally { setBgBusy(false); }
  }
  async function handleBgOpacity(v) {
    setBg((prev) => (prev ? { ...prev, opacity: v } : prev));
    try { await updateBackgroundSettings(supabase, { opacity: v }); } catch (e) { console.error(e); }
  }
  async function handleBgScale(v) {
    setBg((prev) => (prev ? { ...prev, scale: v } : prev));
    try { await updateBackgroundSettings(supabase, { scale: v }); } catch (e) { console.error(e); }
  }
  async function handleBgDelete() {
    if (!bg || !confirm('Удалить план участка?')) return;
    setBgBusy(true);
    try { await deleteBackground(supabase, bg.storagePath); setBg(null); setBgMoveMode(false); }
    catch (e) { alert('Ошибка: ' + e.message); } finally { setBgBusy(false); }
  }

  const legendTypes = useMemo(() => {
    const seen = new Set();
    return model.termDests.map((d) => d.type).filter((t) => { if (seen.has(t)) return false; seen.add(t); return true; }).map(destTypeInfo);
  }, [model.termDests]);

  return html`
    <div style=${fullscreen ? { position: 'fixed', inset: 0, zIndex: 1300, background: 'var(--bg-canvas)', padding: '14px', display: 'flex', flexDirection: 'column' } : { display: 'flex', flexDirection: 'column' }}>
      <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
        <div style=${{ display: 'flex', gap: '2px', padding: '3px', background: 'var(--stone-100)', borderRadius: 'var(--radius-sm)' }}>
          ${PRESETS.map((p) => html`
            <button key=${p.value} onClick=${() => setPreset(p.value)}
              style=${{ padding: '6px 12px', borderRadius: '7px', fontSize: '12.5px', fontWeight: 600, border: 'none', cursor: 'pointer', background: preset === p.value ? 'var(--bg-surface)' : 'transparent', color: preset === p.value ? 'var(--text-primary)' : 'var(--text-secondary)', boxShadow: preset === p.value ? 'var(--shadow-xs)' : 'none' }}>
              ${p.label}
            <//>
          `)}
        </div>
        ${preset === 'custom' && html`
          <${Input} type="date" value=${customFrom} onChange=${(e) => setCustomFrom(e.target.value)} style=${{ width: '150px' }} />
          <${Input} type="date" value=${customTo} onChange=${(e) => setCustomTo(e.target.value)} style=${{ width: '150px' }} />
        `}
        <span style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)', marginRight: 'auto' }}>${periodLabel(preset, range.from, range.to)}</span>

        <${Button} variant="ghost" size="sm" icon onClick=${() => engineRef.current && engineRef.current.zoomOut()} title="Уменьшить"><${ZoomOut} size=${15} /><//>
        <span style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)', minWidth: '34px', textAlign: 'center' }}>${zoomPct}%</span>
        <${Button} variant="ghost" size="sm" icon onClick=${() => engineRef.current && engineRef.current.zoomIn()} title="Увеличить"><${ZoomIn} size=${15} /><//>
        <${Button} variant="ghost" size="sm" onClick=${() => engineRef.current && engineRef.current.zoomFit()}><${Scan} size=${14} /> Центр<//>

        <${Button} variant=${animEnabled ? 'outline' : 'ghost'} size="sm" onClick=${() => setAnimEnabled((v) => !v)}>${animEnabled ? html`<${Pause} size=${14} />` : html`<${Play} size=${14} />`} Анимация<//>
        <${Button} variant="ghost" size="sm" onClick=${resetLayout} title="Сбросить позиции узлов к авто-раскладке"><${RotateCcw} size=${14} /> Авто-раскладка<//>
        <${Button} variant=${templatesOpen ? 'outline' : 'ghost'} size="sm" onClick=${openTemplates}><${LayoutGrid} size=${14} /> Шаблоны<//>
        <${Button} variant=${bgPanelOpen ? 'outline' : 'ghost'} size="sm" onClick=${() => setBgPanelOpen((v) => !v)}><${ImageIcon} size=${14} /> План участка<//>

        <${Button} variant=${editMode ? 'outline' : 'ghost'} size="sm" onClick=${() => setEditMode((v) => !v)}><${Pencil} size=${14} /> Редактировать связи<//>
        ${editMode && html`<${Button} variant="ghost" size="sm" onClick=${resetEdges}><${RotateCcw} size=${14} /> Сбросить связи<//>`}

        <${Button} variant="ghost" size="sm" icon onClick=${() => setFullscreen((v) => !v)} title=${fullscreen ? 'Свернуть' : 'На весь экран'}>
          ${fullscreen ? html`<${Minimize2} size=${15} />` : html`<${Maximize2} size=${15} />`}
        <//>
      </div>

      ${editMode && html`
        <div style=${{ background: 'var(--amber-100)', color: 'var(--amber-600)', fontSize: '12px', padding: '8px 12px', borderRadius: 'var(--radius-sm)', marginBottom: '10px' }}>
          Перетащите жёлтый кружок на конце линии на другую сторону узла, чтобы изменить точку подключения. Двойной клик по линии — добавить точку изгиба, двойной клик по точке — убрать её.
        </div>
      `}

      <div style=${{ position: 'relative', flex: 1, minHeight: fullscreen ? 0 : '640px' }}>
        <div ref=${containerRef} style=${{ width: '100%', height: fullscreen ? '100%' : '640px', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-surface-2)', overflow: 'hidden' }} />
        ${!x6Ready && html`<div style=${{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', color: 'var(--text-tertiary)' }}>Загрузка схемы…</div>`}

        ${templatesOpen && html`
          <div style=${{ position: 'absolute', top: '10px', right: '10px', width: '260px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', padding: '10px', maxHeight: '360px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style=${{ fontSize: '12.5px', fontWeight: 700 }}>Шаблоны раскладки</span>
              <${Button} variant="ghost" size="sm" icon onClick=${() => setTemplatesOpen(false)}><${X} size=${13} /><//>
            </div>
            <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'auto', maxHeight: '220px' }}>
              ${!templates.length && html`<div style=${{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Шаблонов нет</div>`}
              ${templates.map((t) => html`
                <div key=${t.id} style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px' }}>
                  <span style=${{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${t.name}</span>
                  <${Button} variant="outline" size="sm" onClick=${() => applyTemplate(t)}>Применить<//>
                  <${Button} variant="ghost" size="sm" icon onClick=${() => removeTemplate(t)}><${X} size=${13} style=${{ color: 'var(--red-500)' }} /><//>
                </div>
              `)}
            </div>
            ${saveDraft === null ? html`
              <${Button} size="sm" onClick=${() => { setSaveDraft(''); setSaveError(''); }}><${Save} size=${13} /> Сохранить текущую как шаблон…<//>
            ` : html`
              <div style=${{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <${Input} value=${saveDraft} onChange=${(e) => setSaveDraft(e.target.value)} placeholder="Название шаблона" autoFocus
                  onKeyDown=${(e) => { if (e.key === 'Enter') confirmSaveTemplate(); if (e.key === 'Escape') setSaveDraft(null); }} />
                ${saveError && html`<div style=${{ fontSize: '11px', color: 'var(--red-500)' }}>${saveError}<//>`}
                <div style=${{ display: 'flex', gap: '6px' }}>
                  <${Button} size="sm" onClick=${confirmSaveTemplate} disabled=${templateBusy} style=${{ flex: 1 }}>${templateBusy ? 'Сохранение…' : 'Сохранить'}<//>
                  <${Button} variant="ghost" size="sm" onClick=${() => { setSaveDraft(null); setSaveError(''); }}>Отмена<//>
                </div>
              </div>
            `}
          </div>
        `}

        ${bgPanelOpen && html`
          <div style=${{ position: 'absolute', top: '10px', left: '10px', width: '280px', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-md)', padding: '10px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style=${{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style=${{ fontSize: '12.5px', fontWeight: 700 }}>План участка</span>
              <${Button} variant="ghost" size="sm" icon onClick=${() => setBgPanelOpen(false)}><${X} size=${13} /><//>
            </div>

            ${!bg ? html`
              <div style=${{ fontSize: '11.5px', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                Загрузите изображение или PDF ситуационного плана — он ляжет фоном под схему, чтобы можно было расставить зумпфы, насосы и связи по факту. Из PDF берётся первая страница.
              </div>
              <label class="btn btn-sm btn-outline" style=${{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', cursor: bgBusy ? 'not-allowed' : 'pointer' }}>
                <${Upload} size=${13} /> ${bgBusy ? 'Загрузка…' : 'Загрузить план'}
                <input type="file" accept="image/*,.pdf,application/pdf" onChange=${handleBgFile} disabled=${bgBusy} style=${{ display: 'none' }} />
              </label>
            ` : html`
              <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  <span>Прозрачность</span><span>${Math.round(bg.opacity * 100)}%</span>
                </div>
                <input type="range" min="0.1" max="1" step="0.05" value=${bg.opacity} onChange=${(e) => handleBgOpacity(parseFloat(e.target.value))} />
              </div>
              <div style=${{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style=${{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  <span>Масштаб</span><span>${Math.round(bg.scale * 100)}%</span>
                </div>
                <input type="range" min="0.2" max="3" step="0.05" value=${bg.scale} onChange=${(e) => handleBgScale(parseFloat(e.target.value))} />
              </div>

              <label style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked=${bgVisible} onChange=${toggleBgVisible} /> Показывать план
              </label>

              <${Button} variant=${bgMoveMode ? 'outline' : 'ghost'} size="sm" onClick=${() => setBgMoveMode((v) => !v)} disabled=${!bgVisible}>
                <${Move} size=${13} /> ${bgMoveMode ? 'Готово — план закреплён' : 'Переместить план'}
              <//>
              ${bgMoveMode && html`<div style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>Перетащите план мышью, чтобы совместить его с узлами схемы.</div>`}

              <div style=${{ display: 'flex', gap: '6px' }}>
                <label class="btn btn-sm btn-outline" style=${{ flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', cursor: bgBusy ? 'not-allowed' : 'pointer' }}>
                  <${Upload} size=${13} /> Заменить
                  <input type="file" accept="image/*,.pdf,application/pdf" onChange=${handleBgFile} disabled=${bgBusy} style=${{ display: 'none' }} />
                </label>
                <${Button} variant="ghost" size="sm" onClick=${handleBgDelete} disabled=${bgBusy}><${Trash2} size=${13} style=${{ color: 'var(--red-500)' }} /><//>
              </div>
            `}
          </div>
        `}
      </div>

      ${!!legendTypes.length && html`
        <div style=${{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '10px', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
          ${legendTypes.map((info) => html`
            <span key=${info.value} style=${{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style=${{ width: '8px', height: '8px', borderRadius: '50%', background: info.color }} />${info.label}
            </span>
          `)}
        </div>
      `}
    </div>
  `;
}
