// Ядро схемы водного баланса — framework-agnostic, точный порт логики модели/раскладки
// из hydro-monitoring/ui-dewatering-diagram.js (тот же X6 + dagre, тот же расчёт потоков через
// computeFlows). React-компонент (components/DewateringDiagram.js) только монтирует контейнер,
// толкает тулбар и дёргает методы DiagramEngine — как pit3d-core.js/PitScene для 3D-модели.
import { computedVolume, getDistributions, computeFlows, destTypeInfo, PUMP_STATUS } from './dewatering-core.js';
import { loadPdfJs } from './pdfjs-loader.js';

export const DEWD_POS_KEY = 'dew_diagram_pos_v2';
export const DEWD_EDGES_KEY = 'dew_diagram_edges_v2';

export function loadPositions() {
  try { return JSON.parse(localStorage.getItem(DEWD_POS_KEY) || '{}'); } catch { return {}; }
}
export function savePositions(pos) {
  try { localStorage.setItem(DEWD_POS_KEY, JSON.stringify(pos)); } catch {}
}
export function loadEdgeOverrides() {
  try { return JSON.parse(localStorage.getItem(DEWD_EDGES_KEY) || '{}'); } catch { return {}; }
}
export function saveEdgeOverrides(edges) {
  try { localStorage.setItem(DEWD_EDGES_KEY, JSON.stringify(edges)); } catch {}
}

export function nodeId(type, id) { return type + '_' + id; }

const SIZE = {
  sump: { w: 190, h: 100 }, sumpInExtra: 24,
  pump: { w: 84, h: 84 },
  dest: { w: 176, h: 78 },
  nozzle: { w: 92, h: 80 },
};

const QUARRY_COLORS = ['#2E6DAE', '#2F8F52', '#B5851C', '#7C5CBF', '#1E9BA8'];

export function pumpExistsOn(pump, date) {
  return !pump.install_date || pump.install_date <= date;
}

// ── Диапазон дат тулбара ─────────────────────────────────────────────────────
export function resolveDateRange(preset, customFrom, customTo) {
  const today = new Date();
  const yest = new Date(today); yest.setDate(yest.getDate() - 1);
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const back = (days) => { const d = new Date(yest); d.setDate(d.getDate() - days + 1); return d; };
  switch (preset) {
    case 'yesterday': return { from: iso(yest), to: iso(yest) };
    case '7d': return { from: iso(back(7)), to: iso(yest) };
    case '2w': return { from: iso(back(14)), to: iso(yest) };
    case '1m': return { from: iso(back(30)), to: iso(yest) };
    default: return { from: customFrom || iso(yest), to: customTo || iso(yest) };
  }
}
export function periodLabel(preset, from, to) {
  switch (preset) {
    case 'yesterday': return 'Вчера';
    case '7d': return '7 дней';
    case '2w': return '2 недели';
    case '1m': return '30 дней';
    default: return from + ' — ' + to;
  }
}

// ── Модель узлов/связей для текущего периода ─────────────────────────────────
function latestBy(rows, filterFn, dateKey = 'date', timeKey) {
  const hist = rows.filter(filterFn).sort((a, b) => {
    if (a[dateKey] !== b[dateKey]) return b[dateKey] < a[dateKey] ? -1 : 1;
    if (timeKey) return (b[timeKey] || '').localeCompare(a[timeKey] || '');
    return 0;
  });
  return hist.length ? hist[0] : null;
}

function logVolume(l, vehiclesById) {
  if (l.is_manual_volume) return parseFloat(l.manual_volume) || 0;
  const v = vehiclesById[l.vehicle_id];
  return (parseFloat(l.trips) || 0) * (v ? parseFloat(v.capacity) || 0 : 0);
}

export function buildDiagramModel(data, dateFrom, dateTo) {
  const { sumps, pumps, destinations, readings, levels = [], elevationHistory = [], nozzles = [], dustLogs = [], dustVehicles = [] } = data;

  const flows = computeFlows(readings, destinations, dateFrom, dateTo);
  const livePumps = pumps.filter((p) => pumpExistsOn(p, dateTo));
  const termDests = destinations.filter((d) => !(d.type === 'intermediate_sump' && d.target_sump_id));

  const sumpIdSet = new Set(sumps.map((s) => s.id));
  const myNozzles = nozzles.filter((n) => n.source_type === 'sump' && n.source_id && sumpIdSet.has(n.source_id));
  const vehiclesById = Object.fromEntries(dustVehicles.map((v) => [v.id, v]));
  const nozzleVolumes = {};
  myNozzles.forEach((n) => {
    const logs = dustLogs.filter((l) => l.nozzle_id === n.id);
    const volTotal = logs.reduce((acc, l) => acc + logVolume(l, vehiclesById), 0);
    const volDate = logs.filter((l) => l.date >= dateFrom && l.date <= dateTo).reduce((acc, l) => acc + logVolume(l, vehiclesById), 0);
    nozzleVolumes[n.id] = { volDate, volTotal };
  });

  const quarryNames = Array.from(new Set(sumps.map((s) => s.quarry).filter(Boolean)));

  return { dateFrom, dateTo, flows, sumps, pumps: livePumps, termDests, nozzles: myNozzles, nozzleVolumes, quarryNames, levels, elevationHistory };
}

function sumByPump(flows, pumpId, field) {
  let sum = 0;
  Object.values(flows).forEach((f) => { if (f.pumpId === pumpId) sum += f[field]; });
  return sum;
}
function sumByTarget(flows, targetNodeId, field) {
  let sum = 0, has = false;
  Object.values(flows).forEach((f) => { if (f.targetNodeId === targetNodeId) { has = true; sum += f[field]; } });
  return { sum, has };
}

function sumpNodeData(model, sump) {
  const myPumps = model.pumps.filter((p) => p.sump_id === sump.id);
  const volDate = myPumps.reduce((acc, p) => acc + sumByPump(model.flows, p.id, 'volDate'), 0);
  const volTotal = myPumps.reduce((acc, p) => acc + sumByPump(model.flows, p.id, 'volTotal'), 0);
  const inflow = sumByTarget(model.flows, nodeId('smp', sump.id), 'volDate');
  const lvl = latestBy(model.levels, (l) => l.sumpId === sump.id && l.elevation != null, 'date', 'time');
  const elev = latestBy(model.elevationHistory, (e) => e.sumpId === sump.id && e.elevation != null, 'date');
  const depth = lvl && elev ? lvl.elevation - elev.elevation : null;
  return { id: sump.id, name: sump.name, quarry: sump.quarry, volDate, volTotal, hasInflow: inflow.has, inVolDate: inflow.sum, depth, pumpCount: myPumps.length };
}
function pumpNodeData(model, pump) {
  const st = PUMP_STATUS[pump.status] || PUMP_STATUS.off;
  const volDate = sumByPump(model.flows, pump.id, 'volDate');
  const volTotal = sumByPump(model.flows, pump.id, 'volTotal');
  return { id: pump.id, name: pump.name, status: pump.status, statusLabel: st.label, statusColor: st.color, volDate, volTotal };
}
function destNodeData(model, dest) {
  const info = destTypeInfo(dest.type);
  const t = sumByTarget(model.flows, nodeId('dst', dest.id), 'volDate');
  const tTotal = sumByTarget(model.flows, nodeId('dst', dest.id), 'volTotal');
  return { id: dest.id, name: dest.name, typeLabel: info.label, color: dest.color || info.color, volDate: t.sum, volTotal: tTotal.sum };
}
function nozzleNodeData(nozzle, vols) {
  return { id: nozzle.id, name: nozzle.name, volDate: (vols[nozzle.id] || {}).volDate || 0 };
}

// ── Авто-раскладка (dagre) + разрешение позиций ───────────────────────────────
export function sumpSize(model, sumpId) {
  const has = sumByTarget(model.flows, nodeId('smp', sumpId), 'volDate').has;
  return { w: SIZE.sump.w, h: SIZE.sump.h + (has ? SIZE.sumpInExtra : 0) };
}

export function autoLayout(model) {
  if (!window.dagre) return {};
  const g = new window.dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'LR', nodesep: 34, ranksep: 90 });
  g.setDefaultEdgeLabel(() => ({}));

  model.sumps.forEach((s) => { const sz = sumpSize(model, s.id); g.setNode(nodeId('smp', s.id), { width: sz.w, height: sz.h }); });
  model.pumps.forEach((p) => { g.setNode(nodeId('pmp', p.id), { width: SIZE.pump.w, height: SIZE.pump.h }); if (p.sump_id) g.setEdge(nodeId('smp', p.sump_id), nodeId('pmp', p.id)); });
  model.termDests.forEach((d) => g.setNode(nodeId('dst', d.id), { width: SIZE.dest.w, height: SIZE.dest.h }));
  model.nozzles.forEach((n) => { g.setNode(nodeId('nzl', n.id), { width: SIZE.nozzle.w, height: SIZE.nozzle.h }); if (n.source_id) g.setEdge(nodeId('smp', n.source_id), nodeId('nzl', n.id)); });
  Object.values(model.flows).forEach((f) => { g.setEdge(nodeId('pmp', f.pumpId), f.targetNodeId); });

  window.dagre.layout(g);
  const out = {};
  g.nodes().forEach((id) => {
    const n = g.node(id);
    if (n) out[id] = { x: Math.round(n.x - n.width / 2), y: Math.round(n.y - n.height / 2) };
  });
  return out;
}

export function resolvePositions(model, manualPositions) {
  const auto = autoLayout(model);
  const out = {};
  Object.keys(auto).forEach((id) => { out[id] = manualPositions[id] || auto[id]; });
  return out;
}

export function computeQuarryBoxes(model, positions) {
  const boxes = {};
  model.quarryNames.forEach((q, i) => {
    const mine = model.sumps.filter((s) => s.quarry === q);
    if (!mine.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    mine.forEach((s) => {
      const pos = positions[nodeId('smp', s.id)];
      if (!pos) return;
      const sz = sumpSize(model, s.id);
      x0 = Math.min(x0, pos.x); y0 = Math.min(y0, pos.y);
      x1 = Math.max(x1, pos.x + sz.w); y1 = Math.max(y1, pos.y + sz.h);
    });
    if (x0 === Infinity) return;
    const pad = 26;
    boxes[q] = { x: x0 - pad, y: y0 - pad - 22, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 + 22, color: QUARRY_COLORS[i % QUARRY_COLORS.length] };
  });
  return boxes;
}

// ── HTML-шаблоны узлов ────────────────────────────────────────────────────────
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(n) { return (Math.round((n || 0) * 10) / 10).toLocaleString('ru-RU'); }

function sumpHtml(d) {
  return `
    <div class="dewd-sump" title="Открыть в Журнале">
      <div class="dewd-sump-title">${esc(d.name)}</div>
      <div class="dewd-sump-sub">${esc(d.quarry || 'зумпф')}</div>
      ${d.hasInflow ? `<div class="dewd-sump-in">⬇ Пришло: <b>${fmt(d.inVolDate)}</b> м³</div>` : ''}
      ${d.depth != null ? `<div class="dewd-depth-bar"><div class="dewd-depth-fill" style="width:${Math.max(0, Math.min(100, (d.depth / 5) * 100))}%; background:${d.depth > 2 ? 'var(--red-500)' : d.depth > 1 ? 'var(--amber-500)' : 'var(--blue-500)'}"></div></div>` : ''}
      <div class="dewd-sump-stats">
        <span class="dewd-stat-gold">⬆ ${fmt(d.volDate)} м³</span>
        <span class="dewd-stat-muted">Всего ${fmt(d.volTotal)} м³</span>
      </div>
    </div>`;
}
function pumpHtml(d) {
  const active = d.volDate > 0;
  return `
    <div class="dewd-pump" style="--pump-color:${d.statusColor}" title="${esc(d.statusLabel)}">
      ${active ? '<span class="dewd-pump-pulse"></span><span class="dewd-pump-pulse" style="animation-delay:.9s"></span>' : ''}
      <div class="dewd-pump-ring">
        <div class="dewd-pump-name">${esc(d.name)}</div>
        <div class="dewd-pump-vol">${fmt(d.volDate)}</div>
      </div>
    </div>`;
}
function destHtml(d) {
  return `
    <div class="dewd-dest" style="--dest-color:${d.color}">
      <div class="dewd-dest-head"><span class="dewd-dest-dot"></span>${esc(d.name)}</div>
      <div class="dewd-dest-sub">${esc(d.typeLabel)}</div>
      <div class="dewd-dest-stats">
        <span class=${'dewd-stat-gold' /* period vol, dim if 0 handled via CSS opacity below */}>${fmt(d.volDate)} м³</span>
        <span class="dewd-stat-muted">Всего ${fmt(d.volTotal)} м³</span>
      </div>
    </div>`;
}
function nozzleHtml(d) {
  return `
    <div class="dewd-nozzle">
      <div class="dewd-nozzle-icon">💦</div>
      <div class="dewd-nozzle-name">${esc(d.name)}</div>
      <div class="dewd-nozzle-vol">${fmt(d.volDate)} м³</div>
    </div>`;
}
function bgHtml(d) {
  return `<div class="dewd-bg${d.movable ? ' dewd-bg-movable' : ''}" style="opacity:${d.opacity}"><img src="${esc(d.url)}" draggable="false" /></div>`;
}

// ── CSS (инжектится один раз) ──────────────────────────────────────────────────
let _cssInjected = false;
export function injectDiagramCss() {
  if (_cssInjected) return;
  _cssInjected = true;
  const css = `
@keyframes dewd-flow { to { stroke-dashoffset: -40; } }
@keyframes dewd-pulse { 0% { transform: scale(.82); opacity:.65; } 100% { transform: scale(1.3); opacity: 0; } }
.dewd-sump, .dewd-dest, .dewd-nozzle { width:100%; height:100%; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:var(--radius-md); box-shadow:var(--shadow-sm); padding:9px 12px; box-sizing:border-box; cursor:pointer; user-select:none; overflow:hidden; }
.dewd-sump { border-left:3px solid var(--accent-strong); cursor:pointer; }
.dewd-sump-title { font-size:13px; font-weight:700; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dewd-sump-sub { font-size:10.5px; color:var(--text-tertiary); margin-top:1px; }
.dewd-sump-in { font-size:10.5px; color:var(--blue-500); font-weight:600; margin-top:4px; }
.dewd-depth-bar { height:4px; border-radius:99px; background:var(--stone-150); margin-top:6px; overflow:hidden; }
.dewd-depth-fill { height:100%; border-radius:99px; }
.dewd-sump-stats { display:flex; justify-content:space-between; align-items:baseline; margin-top:6px; font-size:11px; }
.dewd-stat-gold { color:var(--accent-hover); font-weight:700; }
.dewd-stat-muted { color:var(--text-tertiary); }
.dewd-pump { width:100%; height:100%; position:relative; display:flex; align-items:center; justify-content:center; cursor:default; user-select:none; }
.dewd-pump-ring { width:78px; height:78px; border-radius:50%; background:var(--bg-surface); border:3px solid var(--pump-color); display:flex; flex-direction:column; align-items:center; justify-content:center; box-shadow:var(--shadow-sm); text-align:center; padding:4px; box-sizing:border-box; }
.dewd-pump-name { font-size:10px; font-weight:700; color:var(--text-primary); line-height:1.15; max-width:68px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dewd-pump-vol { font-size:10.5px; font-weight:700; color:var(--accent-hover); margin-top:2px; }
.dewd-pump-pulse { position:absolute; inset:0; border-radius:50%; border:2px solid var(--pump-color); animation:dewd-pulse 1.8s ease-out infinite; }
.dewd-dest { border-top:3px solid var(--dest-color); }
.dewd-dest-head { display:flex; align-items:center; gap:6px; font-size:12.5px; font-weight:700; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dewd-dest-dot { width:8px; height:8px; border-radius:50%; background:var(--dest-color); flex-shrink:0; }
.dewd-dest-sub { font-size:10.5px; color:var(--text-tertiary); margin-top:1px; }
.dewd-dest-stats { display:flex; justify-content:space-between; align-items:baseline; margin-top:6px; font-size:11px; }
.dewd-nozzle { border:1.5px dashed var(--blue-500); text-align:center; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; }
.dewd-nozzle-icon { font-size:16px; }
.dewd-nozzle-name { font-size:10px; font-weight:600; max-width:80px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dewd-nozzle-vol { font-size:10px; font-weight:700; color:var(--accent-hover); }
.dewd-quarry-box { border:1.5px dashed; border-radius:16px; opacity:.55; pointer-events:none; }
.dewd-quarry-label { position:absolute; top:4px; left:10px; font-size:11px; font-weight:700; letter-spacing:.03em; text-transform:uppercase; pointer-events:none; }
.dewd-bg { width:100%; height:100%; }
.dewd-bg img { width:100%; height:100%; object-fit:fill; user-select:none; pointer-events:none; display:block; }
.dewd-bg-movable img { outline:2px dashed var(--accent-strong); }
`;
  const style = document.createElement('style');
  style.id = 'dewd-css';
  style.textContent = css;
  document.head.appendChild(style);
}

// ── Именованные шаблоны раскладки (Supabase) ──────────────────────────────────
export async function fetchDiagramTemplates(supabase) {
  const { data, error } = await supabase.from('dew_diagram_templates').select('*').order('name');
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, name: r.name, positions: r.positions || {}, edges: r.edges || {} }));
}
// Конфликт разрешаем по name (там есть UNIQUE), а не по id (PRIMARY KEY по умолчанию для
// .upsert()) — иначе сохранение под уже занятым именем не находит "старую" строку по id
// (id всегда свежесгенерированный) и падает в INSERT, который Postgres отклоняет из-за
// UNIQUE(name), а клиент не видит из-за какого именно конфликта. По name upsert всегда
// корректно обновляет существующую запись, даже если локальный список шаблонов устарел.
export async function upsertDiagramTemplate(supabase, row) {
  const { error } = await supabase.from('dew_diagram_templates').upsert(row, { onConflict: 'name' });
  if (error) throw error;
}
export async function deleteDiagramTemplate(supabase, id) {
  const { error } = await supabase.from('dew_diagram_templates').delete().eq('id', id);
  if (error) throw error;
}
export function genTemplateId() { return 'dgt' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ── Схема (план) участка — фон под диаграммой (Supabase) ──────────────────────
// Переиспользуем bucket 'schemes' (уже публичный, уже используется для еженедельных
// схем карьеров в старом приложении) — файлы плана кладём под отдельным префиксом,
// чтобы не пересекаться с существующими данными. Метаданные (путь, прозрачность,
// смещение, масштаб) — в отдельной таблице dew_diagram_background, одна строка id='default'.
const BG_BUCKET = 'schemes';
const BG_PREFIX = 'diagram-bg/';

export async function fetchBackground(supabase) {
  const { data, error } = await supabase.from('dew_diagram_background').select('*').eq('id', 'default').maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: urlData } = supabase.storage.from(BG_BUCKET).getPublicUrl(data.storage_path);
  return {
    storagePath: data.storage_path,
    url: urlData ? urlData.publicUrl : '',
    opacity: data.opacity ?? 0.55,
    offsetX: data.offset_x ?? 0,
    offsetY: data.offset_y ?? 0,
    naturalWidth: data.natural_width || 800,
    naturalHeight: data.natural_height || 600,
    scale: data.scale ?? 1,
  };
}

// Сжимает изображение до разумного размера перед загрузкой (площадка/скан могут быть
// огромными) — canvas resize + JPEG, аналогично _dewCompressImage в старом приложении.
// 3600px/0.92 — компромисс между резкостью при зуме схемы (до x3) и весом файла;
// растр всё равно размажется на очень сильном приближении, это не векторная картинка.
export function resizeImageFile(file, maxDim = 3600, quality = 0.92) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, maxDim / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url);
        if (!blob) { reject(new Error('Не удалось обработать изображение')); return; }
        resolve({ blob, mimeType: 'image/jpeg', width, height });
      }, 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать файл изображения')); };
    img.src = url;
  });
}

// Растеризует первую страницу PDF в картинку (сам PDF на схеме не показывается —
// только рендер страницы), тем же canvas-конвейером, что и обычные изображения.
export async function rasterizePdfFile(file, maxDim = 3600, quality = 0.92) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(4, maxDim / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error('Не удалось обработать PDF')); return; }
      resolve({ blob, mimeType: 'image/jpeg', width: canvas.width, height: canvas.height });
    }, 'image/jpeg', quality);
  });
}

function isPdfFile(file) {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

export async function uploadBackground(supabase, file, prevStoragePath) {
  const resized = isPdfFile(file) ? await rasterizePdfFile(file) : await resizeImageFile(file);
  const path = BG_PREFIX + 'bg_' + Date.now() + '.jpg';
  if (prevStoragePath) await supabase.storage.from(BG_BUCKET).remove([prevStoragePath]).catch(() => {});
  const { error: upErr } = await supabase.storage.from(BG_BUCKET).upload(path, resized.blob, { upsert: true, contentType: resized.mimeType });
  if (upErr) throw upErr;
  const row = {
    id: 'default', storage_path: path, opacity: 0.55, offset_x: 0, offset_y: 0, scale: 1,
    natural_width: resized.width, natural_height: resized.height, updated_at: new Date().toISOString(),
  };
  const { error: dbErr } = await supabase.from('dew_diagram_background').upsert(row);
  if (dbErr) throw dbErr;
  return fetchBackground(supabase);
}

export async function updateBackgroundSettings(supabase, patch) {
  const row = { id: 'default', updated_at: new Date().toISOString() };
  if (patch.opacity != null) row.opacity = patch.opacity;
  if (patch.offsetX != null) row.offset_x = patch.offsetX;
  if (patch.offsetY != null) row.offset_y = patch.offsetY;
  if (patch.scale != null) row.scale = patch.scale;
  const { error } = await supabase.from('dew_diagram_background').update(row).eq('id', 'default');
  if (error) throw error;
}

export async function deleteBackground(supabase, storagePath) {
  if (storagePath) await supabase.storage.from(BG_BUCKET).remove([storagePath]).catch(() => {});
  const { error } = await supabase.from('dew_diagram_background').delete().eq('id', 'default');
  if (error) throw error;
}

// ── X6-движок ──────────────────────────────────────────────────────────────────
// Несколько точек связи на каждой стороне блока (не одна) — распределены равномерно
// по периметру через position:'absolute' (координаты в системе самого узла, 0..w/0..h).
// Индекс средней точки (для порта по умолчанию) — Math.floor(PORTS_PER_SIDE/2).
export const PORTS_PER_SIDE = 3;
export const DEFAULT_PORT_INDEX = Math.floor(PORTS_PER_SIDE / 2);

export function perimeterPorts(w, h, visible) {
  const items = [];
  for (let i = 0; i < PORTS_PER_SIDE; i++) {
    const t = (i + 1) / (PORTS_PER_SIDE + 1);
    items.push({ id: 'top' + i, group: 'p', args: { x: w * t, y: 0 } });
    items.push({ id: 'bottom' + i, group: 'p', args: { x: w * t, y: h } });
    items.push({ id: 'left' + i, group: 'p', args: { x: 0, y: h * t } });
    items.push({ id: 'right' + i, group: 'p', args: { x: w, y: h * t } });
  }
  return {
    groups: {
      p: {
        position: 'absolute',
        attrs: { circle: { r: 3.5, magnet: true, stroke: '#B5851C', strokeWidth: 1, fill: '#fff', opacity: visible ? 1 : 0, cursor: 'crosshair' } },
      },
    },
    items,
  };
}
const DEFAULT_SOURCE_PORT = 'right' + DEFAULT_PORT_INDEX;
const DEFAULT_TARGET_PORT = 'left' + DEFAULT_PORT_INDEX;

// 'vertices' — точки изгиба на самой линии; 'source-arrowhead'/'target-arrowhead' — те самые
// перетаскиваемые кружки НА КОНЦАХ линии, которыми меняют точку подключения (без них клик по
// концу линии просто пытается завести новую связь от порта-магнита и гаснет, а сама линия
// остаётся на месте — порт сам по себе не является ручкой для переноса уже существующего ребра).
const EDGE_EDIT_TOOLS = [
  'vertices',
  { name: 'source-arrowhead', args: { attrs: { fill: '#B5851C', stroke: '#fff', 'stroke-width': 1.5 } } },
  { name: 'target-arrowhead', args: { attrs: { fill: '#B5851C', stroke: '#fff', 'stroke-width': 1.5 } } },
];

let _shapesRegistered = false;
function registerShapes(X6) {
  if (_shapesRegistered) return;
  _shapesRegistered = true;
  const { Shape } = X6;
  const reg = (shape, render) => Shape.HTML.register({
    shape, effect: ['data'],
    html(cell) { const div = document.createElement('div'); div.innerHTML = render(cell.getData() || {}); return div.firstElementChild; },
  });
  reg('dewd-sump', sumpHtml);
  reg('dewd-pump', pumpHtml);
  reg('dewd-dest', destHtml);
  reg('dewd-nozzle', nozzleHtml);
  reg('dewd-bg', bgHtml);
}

export class DiagramEngine {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.graph = null;
    this.editMode = false;
  }

  render(model, opts) {
    injectDiagramCss();
    const X6 = window.X6;
    if (!X6) return;
    registerShapes(X6);
    this.dispose();

    const positions = resolvePositions(model, opts.positions || {});
    const edgeOverrides = opts.edgeOverrides || {};
    this.editMode = !!opts.editMode;
    const animEnabled = opts.animEnabled !== false;
    const quarryBoxes = computeQuarryBoxes(model, positions);

    const graph = new X6.Graph({
      container: this.container,
      background: { color: 'transparent' },
      panning: { enabled: true },
      mousewheel: { enabled: true, modifiers: [], minScale: 0.2, maxScale: 3, factor: 1.1 },
      interacting: (cellView) => {
        const cell = cellView.cell;
        if (cell.isNode()) {
          if (cell.shape === 'rect') return { nodeMovable: false };
          if (cell.shape === 'dewd-bg') return { nodeMovable: !!(opts.background && opts.background.moveMode) };
          return { nodeMovable: true };
        }
        return this.editMode ? { edgeMovable: true, vertexMovable: true, vertexAddable: true, vertexDeletable: true } : {};
      },
      connecting: { allowBlank: false, allowNode: false, allowEdge: false, allowPort: true, router: { name: 'normal' }, connector: { name: 'normal' } },
      validateConnection: ({ edge, type, cell }) => {
        if (!edge || !cell) return false;
        const data = edge.getData() || {};
        return cell.id === (type === 'source' ? data.origSource : data.origTarget);
      },
    });
    this.graph = graph;

    // План участка — фоновая картинка, ниже всего остального
    if (opts.background && opts.background.url && opts.background.visible !== false) {
      const bg = opts.background;
      const w = Math.max(10, bg.naturalWidth * (bg.scale || 1));
      const h = Math.max(10, bg.naturalHeight * (bg.scale || 1));
      graph.addNode({
        id: 'dewd-bg', shape: 'dewd-bg', x: bg.offsetX || 0, y: bg.offsetY || 0, width: w, height: h, zIndex: -10,
        data: { url: bg.url, opacity: bg.opacity ?? 0.55, movable: !!bg.moveMode },
      });
    }

    // Фон-боксы карьеров — behind everything, не интерактивны
    Object.entries(quarryBoxes).forEach(([q, box]) => {
      graph.addNode({
        shape: 'rect', x: box.x, y: box.y, width: box.w, height: box.h, zIndex: 0,
        attrs: { body: { fill: box.color + '14', stroke: box.color, strokeDasharray: 5, rx: 16, ry: 16 }, label: { text: q, refX: 10, refY: 8, textAnchor: 'start', textVerticalAnchor: 'top', fontSize: 11, fontWeight: 700, fill: box.color } },
        markup: [{ tagName: 'rect', selector: 'body' }, { tagName: 'text', selector: 'label' }],
      });
    });

    const maxVolTotal = Math.max(1, ...Object.values(model.flows).map((f) => f.volTotal));

    // Зумпфы
    model.sumps.forEach((s) => {
      const pos = positions[nodeId('smp', s.id)] || { x: 0, y: 0 };
      const sz = sumpSize(model, s.id);
      graph.addNode({ id: nodeId('smp', s.id), shape: 'dewd-sump', x: pos.x, y: pos.y, width: sz.w, height: sz.h, zIndex: 10, data: sumpNodeData(model, s), ports: perimeterPorts(sz.w, sz.h, this.editMode) });
    });
    // Насосы + структурное ребро зумпф→насос
    model.pumps.forEach((p) => {
      const pos = positions[nodeId('pmp', p.id)] || { x: 0, y: 0 };
      graph.addNode({ id: nodeId('pmp', p.id), shape: 'dewd-pump', x: pos.x, y: pos.y, width: SIZE.pump.w, height: SIZE.pump.h, zIndex: 10, data: pumpNodeData(model, p), ports: perimeterPorts(SIZE.pump.w, SIZE.pump.h, this.editMode) });
      if (p.sump_id && positions[nodeId('smp', p.sump_id)]) {
        this._addStructEdge(graph, nodeId('smp', p.sump_id), nodeId('pmp', p.id), edgeOverrides);
      }
    });
    // Направления откачки
    model.termDests.forEach((d) => {
      const pos = positions[nodeId('dst', d.id)] || { x: 0, y: 0 };
      graph.addNode({ id: nodeId('dst', d.id), shape: 'dewd-dest', x: pos.x, y: pos.y, width: SIZE.dest.w, height: SIZE.dest.h, zIndex: 10, data: destNodeData(model, d), ports: perimeterPorts(SIZE.dest.w, SIZE.dest.h, this.editMode) });
    });
    // Форсунки пылеподавления
    model.nozzles.forEach((n) => {
      const pos = positions[nodeId('nzl', n.id)] || { x: 0, y: 0 };
      graph.addNode({ id: nodeId('nzl', n.id), shape: 'dewd-nozzle', x: pos.x, y: pos.y, width: SIZE.nozzle.w, height: SIZE.nozzle.h, zIndex: 10, data: nozzleNodeData(n, model.nozzleVolumes), ports: perimeterPorts(SIZE.nozzle.w, SIZE.nozzle.h, this.editMode) });
      if (n.source_id && positions[nodeId('smp', n.source_id)]) {
        this._addStructEdge(graph, nodeId('smp', n.source_id), nodeId('nzl', n.id), edgeOverrides);
      }
    });

    // Потоки насос → направление/зумпф — связи, ведущие на "Рельеф", подсвечиваются красным.
    // Тип направления 'relief' в справочнике почти не используется — на практике такие
    // направления заводят с типом 'outside' и названием вроде "Рельеф СРГ", поэтому здесь
    // проверяем и тип, и вхождение слова "рельеф" в название.
    const isReliefDest = (id) => {
      const dest = model.termDests.find((d) => d.id === id);
      if (!dest) return false;
      return dest.type === 'relief' || /рельеф/i.test(dest.name || '');
    };
    const reliefByNodeId = {};
    model.termDests.forEach((d) => { reliefByNodeId[nodeId('dst', d.id)] = isReliefDest(d.id); });

    const animatedEdges = [];
    Object.entries(model.flows).forEach(([key, f]) => {
      const source = nodeId('pmp', f.pumpId);
      if (!positions[source] || !positions[f.targetNodeId]) return;
      const isRelief = !!reliefByNodeId[f.targetNodeId];
      const stroke = isRelief ? 'var(--red-500)' : 'var(--accent-strong)';
      const sw = 1.5 + (f.volTotal / maxVolTotal) * 3.5;
      const animated = animEnabled && f.volDate > 0;
      const dur = Math.max(0.6, 2.2 - (f.volTotal / maxVolTotal) * 1.6);
      const edge = this._addFlowEdge(graph, key, source, f.targetNodeId, edgeOverrides, {
        stroke, strokeWidth: sw,
        dash: animated ? 6 : 0, animDur: animated ? dur : 0,
      });
      if (animated) {
        const speed = Math.max(1.2, 4 - (f.volTotal / maxVolTotal) * 2.6);
        animatedEdges.push({ edge, speed, dropCount: speed < 2 ? 2 : 1, color: isRelief ? '#B5301B' : '#2E6DAE' });
      }
    });

    // Взаимодействия
    let dragStart = null;
    graph.on('node:mousedown', ({ node }) => { dragStart = node.position(); });
    graph.on('node:moved', ({ node }) => {
      if (node.shape === 'dewd-bg') {
        const { x, y } = node.position();
        this.callbacks.onBackgroundMoved && this.callbacks.onBackgroundMoved({ x: Math.round(x), y: Math.round(y) });
        return;
      }
      if (node.shape === 'rect') return;
      const { x, y } = node.position();
      const next = { ...(this.callbacks.getPositions ? this.callbacks.getPositions() : {}) };
      next[node.id] = { x: Math.round(x), y: Math.round(y) };
      this.callbacks.onPositionsChange && this.callbacks.onPositionsChange(next);
    });
    graph.on('node:click', ({ node }) => {
      if (this.editMode) return;
      if (!node.id || !node.id.startsWith('smp_')) return;
      const pos = node.position();
      if (dragStart && (Math.abs(pos.x - dragStart.x) > 2 || Math.abs(pos.y - dragStart.y) > 2)) return;
      this.callbacks.onSumpClick && this.callbacks.onSumpClick(node.id.slice(4));
    });
    const persistEdge = (edge) => {
      if (!this.editMode) return;
      const src = edge.getSource() || {}, tgt = edge.getTarget() || {};
      const next = { ...(this.callbacks.getEdgeOverrides ? this.callbacks.getEdgeOverrides() : {}) };
      next[edge.id] = { vertices: edge.getVertices() || [], sourcePort: src.port, targetPort: tgt.port };
      this.callbacks.onEdgesChange && this.callbacks.onEdgesChange(next);
    };
    graph.on('edge:change:vertices', ({ edge }) => persistEdge(edge));
    graph.on('edge:change:source', ({ edge }) => persistEdge(edge));
    graph.on('edge:change:target', ({ edge }) => persistEdge(edge));
    graph.on('scale', () => this.callbacks.onZoomChange && this.callbacks.onZoomChange(graph.zoom()));
    graph.on('translate', () => {});

    this.callbacks.onZoomChange && this.callbacks.onZoomChange(graph.zoom());

    if (animatedEdges.length) this._waitAndAddDroplets(graph, animatedEdges);
  }

  _addStructEdge(graph, source, target, overrides) {
    const id = source + '→' + target;
    const ov = overrides[id];
    graph.addEdge({
      id, source: { cell: source, port: ov?.sourcePort || DEFAULT_SOURCE_PORT }, target: { cell: target, port: ov?.targetPort || DEFAULT_TARGET_PORT },
      vertices: ov?.vertices || [], zIndex: 3,
      router: { name: 'normal' }, connector: { name: 'normal' },
      attrs: { line: { stroke: 'var(--border-strong)', strokeWidth: 1.5, targetMarker: null } },
      data: { origSource: source, origTarget: target },
      tools: this.editMode ? EDGE_EDIT_TOOLS : [],
    });
  }

  _addFlowEdge(graph, id, source, target, overrides, style) {
    const ov = overrides[id];
    const edge = graph.addEdge({
      id, source: { cell: source, port: ov?.sourcePort || DEFAULT_SOURCE_PORT }, target: { cell: target, port: ov?.targetPort || DEFAULT_TARGET_PORT },
      vertices: ov?.vertices || [], zIndex: 5,
      router: { name: 'normal' }, connector: { name: 'normal' },
      attrs: {
        line: {
          stroke: style.stroke, strokeWidth: style.strokeWidth, targetMarker: null,
          strokeDasharray: style.dash || 0,
          style: style.animDur ? { animation: `dewd-flow ${style.animDur}s linear infinite` } : {},
        },
      },
      data: { origSource: source, origTarget: target },
      tools: this.editMode ? EDGE_EDIT_TOOLS : [],
    });
    return edge;
  }

  _waitAndAddDroplets(graph, animatedEdges, attempt = 0) {
    const ready = animatedEdges.every(({ edge }) => {
      const view = graph.findViewByCell(edge);
      const path = view && view.container && view.container.querySelector('path.x6-edge-connection, path.x6-edge');
      return path && path.getAttribute('d');
    });
    if (!ready && attempt < 10) { setTimeout(() => this._waitAndAddDroplets(graph, animatedEdges, attempt + 1), 60); return; }
    this._addDroplets(graph, animatedEdges);
  }

  _addDroplets(graph, animatedEdges) {
    const svg = this.container.querySelector('svg.x6-graph-svg');
    const viewport = svg && (svg.querySelector('.x6-graph-svg-viewport') || svg);
    if (!viewport) return;
    const ns = 'http://www.w3.org/2000/svg';
    animatedEdges.forEach(({ edge, speed, dropCount, color }) => {
      const view = graph.findViewByCell(edge);
      const path = view && view.container && view.container.querySelector('path.x6-edge-connection, path.x6-edge');
      if (!path) return;
      const pathId = 'dewd-path-' + edge.id.replace(/[^a-zA-Z0-9_-]/g, '_');
      path.setAttribute('id', pathId);
      for (let i = 0; i < dropCount; i++) {
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('r', '3');
        circle.setAttribute('fill', color || '#2E6DAE');
        circle.setAttribute('opacity', '0.85');
        const anim = document.createElementNS(ns, 'animateMotion');
        anim.setAttribute('dur', speed + 's');
        anim.setAttribute('repeatCount', 'indefinite');
        anim.setAttribute('rotate', 'auto');
        anim.setAttribute('begin', (i * speed / dropCount) + 's');
        const mpath = document.createElementNS(ns, 'mpath');
        mpath.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#' + pathId);
        anim.appendChild(mpath);
        circle.appendChild(anim);
        viewport.appendChild(circle);
      }
    });
  }

  zoomIn() { this.graph && this.graph.zoom(0.15, { minScale: 0.2, maxScale: 3 }); }
  zoomOut() { this.graph && this.graph.zoom(-0.15, { minScale: 0.2, maxScale: 3 }); }
  zoomFit() { this.graph && this.graph.zoomToFit({ padding: 30, maxScale: 1 }); }
  resize() { this.graph && this.graph.resize(); }
  getZoom() { return this.graph ? this.graph.zoom() : 1; }
  dispose() { if (this.graph) { this.graph.dispose(); this.graph = null; } }
}
