import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Box, RotateCcw, Layers } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { PitScene, PIT3D_LAYER_DEFS, defaultLayerStyle, dbLoadModel } from '../lib/pit3d-core.js';
import { Button, Card, CardContent, EmptyState, Badge } from '../components/ui.js';

const LS_KEY = 'pit3d_layer_style'; // тот же ключ, что и в старом приложении — настройки общие

function loadLayerStyle() {
  const defaults = defaultLayerStyle();
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    Object.keys(defaults).forEach((k) => { defaults[k] = { ...defaults[k], ...(saved[k] || {}) }; });
  } catch (e) {}
  return defaults;
}
function saveLayerStyle(style) { try { localStorage.setItem(LS_KEY, JSON.stringify(style)); } catch (e) {} }

async function fetchWaterPoints() {
  const { data: registry, error: e1 } = await supabase.from('wp_registry').select('id, name, wp_type, coord_x, coord_y, elev_z');
  if (e1) throw e1;
  const { data: levels, error: e2 } = await supabase.from('wp_well_levels').select('well_id, date, depth_to_water').order('date', { ascending: false });
  if (e2) throw e2;
  const latestByWell = {};
  (levels || []).forEach((r) => { if (!latestByWell[r.well_id]) latestByWell[r.well_id] = r; });

  const typeLabel = { well_obs: 'Наблюд. скважина', well_exp: 'Эксплуат. скважина', sump: 'Зумпф', pond: 'Накопитель', seep: 'Водопроявление', ditch: 'Канава', other: 'Прочее' };
  const out = [];
  (registry || []).forEach((w) => {
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
    out.push({ x, y, z, name: w.name || 'Точка', label: typeLabel[w.wp_type] || 'Прочее', layerKey });
  });
  return out;
}

async function fetchWellTrajectories(nearestZ) {
  const { data, error } = await supabase.from('wells').select('id, name, x_local, y_local, z_local, azimuth, depth, inclination, well_type');
  if (error) throw error;
  return (data || []).filter((w) => w.x_local != null && w.y_local != null).map((w) => {
    const z = w.z_local != null ? w.z_local : nearestZ(w.x_local, w.y_local);
    const hasReach = w.azimuth != null && w.depth != null && w.depth > 0;
    const inclRad = (w.inclination || 0) * Math.PI / 180;
    const reach = hasReach ? w.depth * Math.cos(inclRad) : 0;
    const dz = hasReach ? w.depth * Math.sin(inclRad) : 0;
    const az = (w.azimuth || 0) * Math.PI / 180;
    const endX = w.x_local + reach * Math.sin(az), endY = w.y_local + reach * Math.cos(az);
    return { name: w.name || 'Скважина', isPiezo: w.well_type === 'piezometric', collar: { x: w.x_local, y: w.y_local, z }, end: { x: endX, y: endY, z: z + dz } };
  });
}

function GeomSelect({ value, onChange }) {
  return html`
    <select value=${value} onChange=${(e) => onChange(e.target.value)} style=${{ fontSize: '11px', border: '1px solid var(--border)', borderRadius: '5px', padding: '3px 5px', background: 'var(--bg-surface)' }}>
      <option value="sphere">Сфера</option>
      <option value="cube">Куб</option>
      <option value="cone">Конус</option>
    </select>
  `;
}

function LayerRow({ def, style, onChange, onOpenIsohypsesInfo }) {
  const st = style[def.key];
  return html`
    <div style=${{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 4px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
      <label style=${{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12.5px', fontWeight: 600, minWidth: '190px', cursor: 'pointer' }}>
        <input type="checkbox" checked=${st.visible} onChange=${(e) => onChange({ ...st, visible: e.target.checked })} />
        ${def.label}
      </label>
      ${def.special
        ? html`<span style=${{ fontSize: '11px', color: 'var(--text-tertiary)' }}>линии по уровню воды, ${style.isohypses._pointCount || 0} точек</span>`
        : html`
          <input type="color" value=${st.color} onChange=${(e) => onChange({ ...st, color: e.target.value })} style=${{ width: '26px', height: '22px', border: '1px solid var(--border)', borderRadius: '4px', padding: 0, cursor: 'pointer' }} />
          <${GeomSelect} value=${st.geometry} onChange=${(v) => onChange({ ...st, geometry: v })} />
          <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            Размер <input type="range" min="0.3" max="3" step="0.1" value=${st.size} onChange=${(e) => onChange({ ...st, size: parseFloat(e.target.value) })} style=${{ width: '60px' }} /> ${st.size.toFixed(1)}×
          </span>
        `}
      <span style=${{ fontSize: '11px', color: 'var(--text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
        Прозр. <input type="range" min="0" max="100" value=${Math.round(st.opacity * 100)} onChange=${(e) => onChange({ ...st, opacity: e.target.value / 100 })} style=${{ width: '60px' }} /> ${Math.round(st.opacity * 100)}%
      </span>
    </div>
  `;
}

export function Pit3DPage() {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | no-model | ready | error
  const [errorMsg, setErrorMsg] = useState('');
  const [layerStyle, setLayerStyle] = useState(loadLayerStyle);
  const layerStyleRef = useRef(layerStyle);
  layerStyleRef.current = layerStyle;

  // Один проход по слоям на любое изменение стиля: каждая rebuild-функция сама читает
  // актуальный layerStyle целиком, поэтому дёргать её отдельно на каждый ключ слоя не нужно —
  // иначе один клик по чекбоксу лишний раз пересобирал бы маркеры/скважины по несколько раз.
  const refreshAll = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.rebuildMarkers(layerStyleRef.current);
    scene.rebuildWells(layerStyleRef.current);
    if (scene.contourData) {
      scene.setContourVisible(layerStyleRef.current.isohypses.visible);
      scene.addContourToScene(layerStyleRef.current.isohypses.opacity);
      scene.setContourVisible(layerStyleRef.current.isohypses.visible);
    }
  }, []);

  function updateLayer(key, next) {
    setLayerStyle((prev) => {
      const merged = { ...prev, [key]: next };
      saveLayerStyle(merged);
      return merged;
    });
  }
  useEffect(() => { refreshAll(); }, [layerStyle]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const model = await dbLoadModel();
        if (!model || !model.xs || !model.xs.length) { if (!cancelled) setStatus('no-model'); return; }
        const scene = new PitScene(containerRef.current);
        await scene.init(model);
        sceneRef.current = scene;

        function nearestZ(x, y) {
          let best = Infinity, bestZ = model.bbox ? (model.bbox.zMin + model.bbox.zMax) / 2 : 0;
          for (let i = 0; i < model.xs.length; i += Math.max(1, Math.floor(model.xs.length / 4000))) {
            const dx = model.xs[i] - x, dy = model.ys[i] - y, d = dx * dx + dy * dy;
            if (d < best) { best = d; bestZ = model.zs[i]; }
          }
          return bestZ;
        }

        const [waterPoints, wellTrajectories] = await Promise.all([fetchWaterPoints(), fetchWellTrajectories(nearestZ)]);
        if (cancelled) return;
        scene.setData({ waterPoints, wellTrajectories });
        scene.rebuildMarkers(layerStyleRef.current);
        scene.rebuildWells(layerStyleRef.current);
        const contourData = await scene.buildContours();
        setLayerStyle((prev) => ({ ...prev, isohypses: { ...prev.isohypses, _pointCount: contourData ? contourData.pointCount : 0 } }));
        if (contourData) { scene.addContourToScene(layerStyleRef.current.isohypses.opacity); scene.setContourVisible(layerStyleRef.current.isohypses.visible); }

        setStatus('ready');
      } catch (e) {
        if (!cancelled) { setErrorMsg(e.message || String(e)); setStatus('error'); }
      }
    })();
    return () => { cancelled = true; if (sceneRef.current) sceneRef.current.dispose(); };
  }, []);

  return html`
    <div style=${{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div class="pilot-strip">
        <${Box} size=${14} />
        Пилот: 3D-модель с новым интерфейсом панели «Слои». Изогипсы считаются по 6 ближайшим точкам (без ложных просадок). Загрузка новой DXF-модели пока доступна только в прежнем интерфейсе.
      </div>

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
            description=${html`В этом браузере ещё нет загруженной DXF-модели. Откройте раздел «Модель карьера» в прежнем интерфейсе и загрузите DXF один раз — пилот использует те же локальные данные (тот же браузер, тот же адрес сервера).`}
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
      </div>

      ${status === 'ready' && html`
        <div style=${{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', maxHeight: '38%', overflow: 'auto', flexShrink: 0 }}>
          <div style=${{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', fontWeight: 700, fontSize: '13px' }}>
            <${Layers} size=${15} /> Слои
          </div>
          <div style=${{ padding: '0 16px' }}>
            ${PIT3D_LAYER_DEFS.map((def) => html`<${LayerRow} key=${def.key} def=${def} style=${layerStyle} onChange=${(next) => updateLayer(def.key, next)} />`)}
          </div>
        </div>
      `}
    </div>
  `;
}
