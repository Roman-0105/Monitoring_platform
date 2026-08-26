// Схема водного баланса — React-обёртка над DiagramEngine (X6 + dagre), точный порт
// тулбара/режимов hydro-monitoring/ui-dewatering-diagram.js (см. dewatering-diagram-core.js
// для модели/раскладки/движка). Компонент лишь монтирует контейнер и управляет состоянием
// тулбара (период, зум, анимация, редактирование связей, шаблоны, полный экран).
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Maximize2, Minimize2, Pencil, LayoutGrid, Play, Pause, ZoomIn, ZoomOut, Scan, X, Save } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { loadX6 } from '../lib/x6-loader.js';
import { Button, Input } from '../components/ui.js';
import { destTypeInfo } from '../lib/dewatering-core.js';
import {
  DiagramEngine, buildDiagramModel, resolveDateRange, periodLabel,
  loadPositions, savePositions, loadEdgeOverrides, saveEdgeOverrides,
  fetchDiagramTemplates, upsertDiagramTemplate, deleteDiagramTemplate, genTemplateId,
} from '../lib/dewatering-diagram-core.js';

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

  useEffect(() => { loadX6().then(() => setX6Ready(true)).catch((e) => console.error(e)); }, []);

  const range = useMemo(() => resolveDateRange(preset, customFrom, customTo), [preset, customFrom, customTo]);

  const model = useMemo(() => buildDiagramModel({
    sumps: data.sumps, pumps: data.pumps, destinations: data.destinations, readings: data.readings,
    levels: data.levels, elevationHistory: data.elevationHistory,
    nozzles: dust.nozzles, dustLogs: dust.dustLogs, dustVehicles: dust.dustVehicles,
  }, range.from, range.to), [data, dust, range.from, range.to]);

  function persistPositions(next) { setPositions(next); savePositions(next); }
  function persistEdges(next) { setEdgeOverrides(next); saveEdgeOverrides(next); }

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
      });
    }
    engineRef.current.render(model, { positions, edgeOverrides, editMode, animEnabled });
    return undefined;
  }, [x6Ready, model, editMode, animEnabled, fullscreen]);

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
  async function saveAsTemplate() {
    const name = prompt('Название шаблона:');
    if (!name || !name.trim()) return;
    const existing = templates.find((t) => t.name === name.trim());
    if (existing && !confirm(`Шаблон «${name.trim()}» уже существует. Перезаписать?`)) return;
    setTemplateBusy(true);
    try {
      const row = { id: existing ? existing.id : genTemplateId(), name: name.trim(), positions: positionsRef.current, edges: edgeOverridesRef.current };
      await upsertDiagramTemplate(supabase, row);
      setTemplates(await fetchDiagramTemplates(supabase));
    } catch (e) { alert('Ошибка сохранения шаблона: ' + e.message); } finally { setTemplateBusy(false); }
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
            <${Button} size="sm" onClick=${saveAsTemplate} disabled=${templateBusy}><${Save} size=${13} /> Сохранить текущую как шаблон…<//>
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
