// Ядро 3D-сцены карьера — framework-agnostic, переиспользует ту же геометрию/математику,
// что и hydro-monitoring/ui-pit3d.js (тот же алгоритм изогипс с k-ближайшими точками,
// та же логика стволов скважин с учётом угла наклона). React-компонент (pages/Pit3D.js)
// лишь монтирует канвас и дёргает методы этого класса.
//
// Модель рельефа (распарсенный DXF) хранится в Supabase Storage одним JSON-файлом
// (bucket 'pit3d-models', путь 'current.json') — раньше лежала в IndexedDB браузера,
// т.е. её видел только тот, кто сам загрузил файл, на том же компьютере.
import { supabase } from './supabase.js';

const PIT3D_MODEL_PATH = 'current.json';

export function loadThree() {
  if (window.THREE && window._sfOrbitControls) return Promise.resolve();
  return new Promise((resolve, reject) => {
    function loadScript(src, cb) {
      const s = document.createElement('script');
      s.src = src; s.onload = cb;
      s.onerror = () => reject(new Error('Не удалось загрузить ' + src));
      document.head.appendChild(s);
    }
    const base = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/';
    loadScript(base + 'three.min.js', () => {
      loadScript('https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js', () => {
        window._sfOrbitControls = window.THREE.OrbitControls;
        resolve();
      });
    });
  });
}

export function loadDelaunay() {
  if (window.d3 && window.d3.Delaunay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/d3-delaunay@6/dist/d3-delaunay.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить d3-delaunay'));
    document.head.appendChild(s);
  });
}

// ── Хранилище модели рельефа (Supabase Storage, JSON) ────────────────────────
export async function fetchModel() {
  const { data, error } = await supabase.storage.from('pit3d-models').download(PIT3D_MODEL_PATH);
  if (error || !data) return null;
  const raw = JSON.parse(await data.text());
  return {
    ...raw,
    xs: Float64Array.from(raw.xs), ys: Float64Array.from(raw.ys), zs: Float64Array.from(raw.zs),
    triangles: Uint32Array.from(raw.triangles),
  };
}

export async function uploadModel(model) {
  const payload = {
    ...model,
    xs: Array.from(model.xs), ys: Array.from(model.ys), zs: Array.from(model.zs),
    triangles: Array.from(model.triangles),
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const { error } = await supabase.storage.from('pit3d-models').upload(PIT3D_MODEL_PATH, blob, { upsert: true, contentType: 'application/json' });
  if (error) throw error;
}

export async function deleteModel() {
  await supabase.storage.from('pit3d-models').remove([PIT3D_MODEL_PATH]);
}

// ── Сохранённые вертикальные разрезы (Supabase) ───────────────────────────────
export async function fetchSections() {
  const { data, error } = await supabase.from('pit3d_sections').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((r) => ({ id: r.id, name: r.name, ax: Number(r.ax), ay: Number(r.ay), bx: Number(r.bx), by: Number(r.by), createdAt: r.created_at }));
}
export async function saveSection(rec) {
  const { error } = await supabase.from('pit3d_sections').upsert({ id: rec.id, name: rec.name, ax: rec.ax, ay: rec.ay, bx: rec.bx, by: rec.by });
  if (error) throw error;
}
export async function deleteSection(id) {
  await supabase.from('pit3d_sections').delete().eq('id', id);
}

// ── Профиль вертикального разреза по линии A→B: пересечения рёбер треугольников
// с вертикальной плоскостью через AB, спроецированные на расстояние вдоль линии ──
export function sectionProfile(xs, ys, zs, tris, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / L, uy = dy / L;
  const side = (i) => dx * (ys[i] - ay) - dy * (xs[i] - ax);
  const proj = (x, y) => (x - ax) * ux + (y - ay) * uy;

  const pts = [];
  const numTri = tris.length / 3;
  for (let j = 0; j < numTri; j++) {
    const ia = tris[j * 3], ib = tris[j * 3 + 1], ic = tris[j * 3 + 2];
    const da = side(ia), db = side(ib), dc = side(ic);
    const hit = [];
    const edge = (i1, i2, d1, d2) => {
      if (d1 * d2 < 0) {
        const t = d1 / (d1 - d2);
        const x = xs[i1] + (xs[i2] - xs[i1]) * t, y = ys[i1] + (ys[i2] - ys[i1]) * t, z = zs[i1] + (zs[i2] - zs[i1]) * t;
        hit.push({ s: proj(x, y), z });
      }
    };
    edge(ia, ib, da, db); edge(ib, ic, db, dc); edge(ic, ia, dc, da);
    if (hit.length === 2) {
      if (hit[0].s >= -1e-6 && hit[0].s <= L + 1e-6) pts.push(hit[0]);
      if (hit[1].s >= -1e-6 && hit[1].s <= L + 1e-6) pts.push(hit[1]);
    }
  }
  pts.sort((a, b) => a.s - b.s);
  return { points: pts, length: L };
}

// ── Парсинг DXF (стринги рельефа: POLYLINE → VERTEX(10/20/30=X/Y/Z) → SEQEND) ──
export function parseDXF(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const n = lines.length;
  const xsArr = [], ysArr = [], zsArr = [];
  let stringerCount = 0, curEntity = null, vx = 0, vy = 0, vz = 0;

  function flush() { if (curEntity === 'VERTEX') { xsArr.push(vx); ysArr.push(vy); zsArr.push(vz); } }

  for (let i = 0; i + 1 < n; i += 2) {
    const code = parseInt(lines[i], 10);
    const val = lines[i + 1];
    if (code === 0) {
      flush();
      const etype = val.trim();
      vx = vy = vz = 0;
      if (etype === 'POLYLINE') { stringerCount++; curEntity = null; }
      else if (etype === 'VERTEX') { curEntity = 'VERTEX'; }
      else { curEntity = null; }
    } else if (curEntity === 'VERTEX') {
      if (code === 10) vx = parseFloat(val);
      else if (code === 20) vy = parseFloat(val);
      else if (code === 30) vz = parseFloat(val);
    }
  }
  flush();
  return { xs: xsArr, ys: ysArr, zs: zsArr, stringerCount, vertexCount: xsArr.length };
}

// ── Триангуляция Делоне по X/Y (Z берётся из исходных точек) ─────────────────
export async function buildTIN(xsArr, ysArr, zsArr) {
  await loadDelaunay();
  const count = xsArr.length;
  const coords = new Float64Array(count * 2);
  for (let i = 0; i < count; i++) { coords[i * 2] = xsArr[i]; coords[i * 2 + 1] = ysArr[i]; }
  const delaunay = new window.d3.Delaunay(coords);
  return { xs: Float64Array.from(xsArr), ys: Float64Array.from(ysArr), zs: Float64Array.from(zsArr), triangles: delaunay.triangles };
}

export function computeBBox(xs, ys, zs) {
  let xMin = xs[0], xMax = xs[0], yMin = ys[0], yMax = ys[0], zMin = zs[0], zMax = zs[0];
  for (let i = 1; i < xs.length; i++) {
    if (xs[i] < xMin) xMin = xs[i]; if (xs[i] > xMax) xMax = xs[i];
    if (ys[i] < yMin) yMin = ys[i]; if (ys[i] > yMax) yMax = ys[i];
    if (zs[i] < zMin) zMin = zs[i]; if (zs[i] > zMax) zMax = zs[i];
  }
  return { xMin, xMax, yMin, yMax, zMin, zMax };
}

// Устойчивый охват по X/Y — метод Тьюки (K=3, "дальние" выбросы), не режет непрерывный
// массив точек, срабатывает только на реально обособленные кластеры.
export function computeRobustBBox(xs, ys, zs) {
  function quartiles(arr) {
    const sorted = Array.from(arr).sort((a, b) => a - b);
    return { q1: sorted[Math.floor(sorted.length * 0.25)], q3: sorted[Math.floor(sorted.length * 0.75)] };
  }
  const K = 3;
  const qx = quartiles(xs), qy = quartiles(ys);
  const xFence = { lo: qx.q1 - K * (qx.q3 - qx.q1), hi: qx.q3 + K * (qx.q3 - qx.q1) };
  const yFence = { lo: qy.q1 - K * (qy.q3 - qy.q1), hi: qy.q3 + K * (qy.q3 - qy.q1) };
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity, zMin = Infinity, zMax = -Infinity, kept = false;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < xFence.lo || xs[i] > xFence.hi || ys[i] < yFence.lo || ys[i] > yFence.hi) continue;
    kept = true;
    if (xs[i] < xMin) xMin = xs[i]; if (xs[i] > xMax) xMax = xs[i];
    if (ys[i] < yMin) yMin = ys[i]; if (ys[i] > yMax) yMax = ys[i];
    if (zs[i] < zMin) zMin = zs[i]; if (zs[i] > zMax) zMax = zs[i];
  }
  return kept ? { xMin, xMax, yMin, yMax, zMin, zMax } : computeBBox(xs, ys, zs);
}

// ── ISO-недели (Пн-Вс) — фильтр замеров водопроявлений по неделе ─────────────
export function getWeekDateRange(weekKey) {
  if (!weekKey) return null;
  const parts = weekKey.split('-W');
  if (parts.length !== 2) return null;
  const year = parseInt(parts[0]), week = parseInt(parts[1]);
  if (isNaN(year) || isNaN(week)) return null;
  const jan4 = new Date(year, 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday1 = new Date(jan4);
  monday1.setDate(jan4.getDate() - (dayOfWeek - 1));
  const start = new Date(monday1);
  start.setDate(monday1.getDate() + (week - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  return { start: iso(start), end: iso(end) };
}

export function getWeekKeyFromDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return dt.getUTCFullYear() + '-W' + (weekNo < 10 ? '0' + weekNo : weekNo);
}

export function weekLabel(weekKey) {
  const r = getWeekDateRange(weekKey);
  if (!r) return weekKey;
  const short = (d) => new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return short(r.start) + '–' + short(r.end);
}

export function countOutliers(xs, ys, robust) {
  let n = 0;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < robust.xMin || xs[i] > robust.xMax || ys[i] < robust.yMin || ys[i] > robust.yMax) n++;
  }
  return n;
}

export const PIT3D_LAYER_DEFS = [
  { key: 'reg_well_obs', label: 'Наблюд. скважина', color: '#60a5fa', geometry: 'sphere', group: 'Реестр водопунктов' },
  { key: 'reg_well_exp', label: 'Эксплуат. скважина', color: '#34d399', geometry: 'sphere', group: 'Реестр водопунктов' },
  { key: 'reg_sump',     label: 'Зумпф (реестр)',      color: '#f59e0b', geometry: 'cube',   group: 'Реестр водопунктов' },
  { key: 'reg_pond',     label: 'Накопитель',           color: '#a78bfa', geometry: 'cube',   group: 'Реестр водопунктов' },
  { key: 'reg_seep',     label: 'Водопроявление',       color: '#22d3ee', geometry: 'cone',   group: 'Реестр водопунктов' },
  { key: 'reg_other',    label: 'Прочее',               color: '#9aa0a6', geometry: 'sphere', group: 'Реестр водопунктов' },
  { key: 'points',       label: 'Водопроявления (Список точек)', color: '#22d3ee', geometry: 'sphere', group: 'Прочие источники данных' },
  { key: 'dewsump',      label: 'Зумпфы (Журнал Водоотлива)',    color: '#fb923c', geometry: 'sphere', group: 'Прочие источники данных' },
  { key: 'wells_drainage', label: 'Скважины дренажные',       color: '#4caf7d', geometry: 'sphere', isWell: true, group: 'Гор. скважины' },
  { key: 'wells_piezo',    label: 'Скважины пьезометрические', color: '#9d6bff', geometry: 'sphere', isWell: true, group: 'Гор. скважины' },
  { key: 'isohypses',    label: 'Изогипсы подземных вод', special: true, group: 'Расчётные слои' },
];

export function defaultLayerStyle() {
  const out = {};
  PIT3D_LAYER_DEFS.forEach((d) => { out[d.key] = { visible: d.key !== 'isohypses', color: d.color || null, geometry: d.geometry || null, opacity: 1, size: 1 }; });
  out.isohypses.renderMode = 'lines'; // 'lines' | 'fill' (заливка по уровням) | 'gradient' (плавный градиент)
  out.isohypses.colors = DEFAULT_CONTOUR_COLORS.slice(); // мультистоповый градиент (2+ цветов), равномерно от нижнего до верхнего уровня
  out.isohypses.showBoundaries = false; // границы уровней (изолинии) поверх заливки/градиента
  return out;
}

function makeGeometry(THREE, shape, r) {
  switch (shape) {
    case 'cube': return new THREE.BoxGeometry(r * 1.6, r * 1.6, r * 1.6);
    case 'cone': return new THREE.ConeGeometry(r * 1.1, r * 2.2, 10);
    case 'diamond': return new THREE.OctahedronGeometry(r * 1.3);
    default: return new THREE.SphereGeometry(r, 12, 12);
  }
}

// IDW по k ближайшим точкам — устраняет ложную просадку/подъём уровня между близкими
// точками из-за влияния далёких замеров с совсем другим уровнем воды.
const IDW_K = 6;
function idwZ(x, y, pts, power, k) {
  let candidates = pts;
  if (k && pts.length > k) {
    candidates = pts.map((p) => { const dx = p.x - x, dy = p.y - y; return { p, d2: dx * dx + dy * dy }; })
      .sort((a, b) => a.d2 - b.d2).slice(0, k).map((e) => e.p);
  }
  let wsum = 0, zsum = 0;
  for (const p of candidates) {
    const dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy;
    if (d2 < 1e-6) return p.z;
    const w = 1 / Math.pow(d2, power / 2);
    wsum += w; zsum += w * p.z;
  }
  return wsum > 0 ? zsum / wsum : pts[0].z;
}

// ── Профиль уровня воды вдоль линии A→B: ПРЯМАЯ выборка IDW через каждые step
// метров, а не пересечение с триангулированной сеткой. Так строят разрезы по
// интерполированным поверхностям и в специализированных геологических пакетах
// (Leapfrog Geo и подобные): поверхность там — непрерывная функция (RBF/implicit
// modeling), а не конечная сетка треугольников, поэтому у среза не может быть
// "дыр" — значение есть в любой точке XY. IDW по k ближайшим точкам обладает тем
// же свойством (определён всюду), в отличие от TIN, где интерполяция стоит только
// внутри охваченной сеткой области и зависит от того, задел ли луч сечения нужный
// треугольник. Гарантированно покрывает всю длину линии независимо от плотности/
// границ сетки изогипс.
export function sampleWaterProfile(waterPts, ax, ay, bx, by, step = 2) {
  const dx = bx - ax, dy = by - ay;
  const L = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / L, uy = dy / L;
  const n = Math.max(1, Math.round(L / step));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const s = (L * i) / n;
    const x = ax + ux * s, y = ay + uy * s;
    pts.push({ s, z: idwZ(x, y, waterPts, 2, IDW_K) });
  }
  return { points: pts, length: L };
}

function convexHull(pts) {
  const sorted = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) { const p = sorted[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

// bounds (необязательно) — если задан (обычно bbox всей модели рельефа), сетка строится
// на весь этот прямоугольник, а не только внутри выпуклой оболочки точек с известным уровнем.
// Иначе разрез или изогипсы, выходящие за пределы охвата скважин/замеров, обрывались бы —
// IDW по k ближайшим точкам продолжает давать оценку и за пределами оболочки (менее точную
// по мере удаления от реальных данных, но непрерывную по всей модели).
function densifyWaterTable(wtPts, bounds) {
  if (wtPts.length < 3) return { points: wtPts, cell: 1 };
  const xs = wtPts.map((p) => p.x), ys = wtPts.map((p) => p.y);
  const dataXMin = Math.min(...xs), dataXMax = Math.max(...xs), dataYMin = Math.min(...ys), dataYMax = Math.max(...ys);
  const xMin = bounds ? Math.min(bounds.xMin, dataXMin) : dataXMin;
  const xMax = bounds ? Math.max(bounds.xMax, dataXMax) : dataXMax;
  const yMin = bounds ? Math.min(bounds.yMin, dataYMin) : dataYMin;
  const yMax = bounds ? Math.max(bounds.yMax, dataYMax) : dataYMax;
  const spanX = xMax - xMin || 1, spanY = yMax - yMin || 1;
  const gridN = 45;
  const cell = Math.max(spanX, spanY) / gridN;
  const nx = Math.max(1, Math.round(spanX / cell)), ny = Math.max(1, Math.round(spanY / cell));
  const hull = bounds ? null : convexHull(wtPts);
  const out = wtPts.slice();
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const x = xMin + spanX * i / nx, y = yMin + spanY * j / ny;
      if (hull && !pointInPolygon(x, y, hull)) continue;
      out.push({ x, y, z: idwZ(x, y, wtPts, 2, IDW_K) });
    }
  }
  return { points: out, cell };
}

function filterLongTriangles(xs, ys, triangles, maxEdge) {
  const maxEdge2 = maxEdge * maxEdge;
  const dist2 = (i, j) => { const dx = xs[i] - xs[j], dy = ys[i] - ys[j]; return dx * dx + dy * dy; };
  const out = [];
  const numTri = triangles.length / 3;
  for (let j = 0; j < numTri; j++) {
    const ia = triangles[j * 3], ib = triangles[j * 3 + 1], ic = triangles[j * 3 + 2];
    if (dist2(ia, ib) <= maxEdge2 && dist2(ib, ic) <= maxEdge2 && dist2(ic, ia) <= maxEdge2) out.push(ia, ib, ic);
  }
  return Uint32Array.from(out);
}

function traceContourSegments(xs, ys, zs, tris, level) {
  const segs = [];
  const numTri = tris.length / 3;
  for (let j = 0; j < numTri; j++) {
    const ia = tris[j * 3], ib = tris[j * 3 + 1], ic = tris[j * 3 + 2];
    const za = zs[ia], zb = zs[ib], zc = zs[ic];
    let px = null, py = null, qx = null, qy = null, found = 0;
    if ((za - level) * (zb - level) < 0) { const t = (level - za) / (zb - za); px = xs[ia] + (xs[ib] - xs[ia]) * t; py = ys[ia] + (ys[ib] - ys[ia]) * t; found++; }
    if ((zb - level) * (zc - level) < 0) {
      const t = (level - zb) / (zc - zb); const x2 = xs[ib] + (xs[ic] - xs[ib]) * t, y2 = ys[ib] + (ys[ic] - ys[ib]) * t;
      if (found === 0) { px = x2; py = y2; } else { qx = x2; qy = y2; } found++;
    }
    if (found < 2 && (zc - level) * (za - level) < 0) {
      const t = (level - zc) / (za - zc); const x3 = xs[ic] + (xs[ia] - xs[ic]) * t, y3 = ys[ic] + (ys[ia] - ys[ic]) * t;
      if (found === 0) { px = x3; py = y3; } else { qx = x3; qy = y3; } found++;
    }
    if (found === 2) segs.push(px, py, qx, qy);
  }
  return segs;
}

function chooseContourStep(zMin, zMax) {
  const range = zMax - zMin;
  if (!(range > 0)) return 1;
  const raw = range / 10;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return norm < 1.5 ? 1 * mag : norm < 3.5 ? 2 * mag : norm < 7.5 ? 5 * mag : 10 * mag;
}

const FILTER_COLOR = 0x22d3ee; // бирюзовый — та же семантика "вода", что и у изогипс/водопроявлений

// Ствол строится по стволу от устья (c0) до конца (c1) как последовательность цилиндров —
// в обычных местах цвет скважины (обсадка), на интервалах фильтра — бирюзовый и чуть толще
// (визуально "перфорация"). Глубины интервалов — measured depth от устья, как и w.depth.
function buildShaftSegments(THREE, c0, c1, w, color, opacity, sizeMul, markerR, label) {
  const meshes = [];
  const depth = w.depth;
  const intervals = (Array.isArray(w.filterIntervals) ? w.filterIntervals : [])
    .map((f) => ({ top: parseFloat(f.top), bottom: parseFloat(f.bottom), notes: f.notes }))
    .filter((f) => !Number.isNaN(f.top) && !Number.isNaN(f.bottom) && f.bottom > f.top)
    .map((f) => ({ top: Math.max(0, Math.min(depth, f.top)), bottom: Math.max(0, Math.min(depth, f.bottom)), notes: f.notes }))
    .sort((a, b) => a.top - b.top);

  // Собираем полный список сегментов [from,to,isFilter], заполняя обсадкой промежутки между фильтрами
  const segs = [];
  let cursor = 0;
  intervals.forEach((f) => {
    if (f.top > cursor) segs.push({ from: cursor, to: f.top, filter: false });
    segs.push({ from: f.top, to: f.bottom, filter: true, notes: f.notes });
    cursor = Math.max(cursor, f.bottom);
  });
  if (cursor < depth) segs.push({ from: cursor, to: depth, filter: false });
  if (!segs.length) segs.push({ from: 0, to: depth, filter: false });

  segs.forEach((seg) => {
    const r0 = seg.from / depth, r1 = seg.to / depth;
    const p0 = new THREE.Vector3().lerpVectors(c0, c1, r0);
    const p1 = new THREE.Vector3().lerpVectors(c0, c1, r1);
    const dir = new THREE.Vector3().subVectors(p1, p0);
    const len = dir.length();
    if (len < 1e-5) return;
    const radius = markerR * 0.28 * sizeMul * (seg.filter ? 1.5 : 1);
    const mat = new THREE.MeshBasicMaterial({ color: seg.filter ? FILTER_COLOR : color, transparent: true, opacity: seg.filter ? Math.min(1, opacity + 0.15) : opacity * 0.75 });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 8), mat);
    mesh.position.copy(p0).addScaledVector(dir, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    mesh.userData = seg.filter
      ? { name: w.name, label: 'Фильтр ' + seg.from.toFixed(1) + '–' + seg.to.toFixed(1) + ' м' + (seg.notes ? ' · ' + seg.notes : ''), z: w.collar.z + (r0 + r1) / 2 * (w.end.z - w.collar.z) }
      : { name: w.name, label, z: w.collar.z + (r0 + r1) / 2 * (w.end.z - w.collar.z) };
    meshes.push(mesh);
  });
  return meshes;
}

function hexToRgb(hex) {
  const n = parseInt((hex || '').replace('#', ''), 16);
  return Number.isNaN(n) ? { r: 0, g: 0, b: 0 } : { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

const DEFAULT_CONTOUR_COLORS = ['#8ec7e8', '#133a6b'];

// colors — список HEX-цветов (2 и больше), равномерно распределённых от zMin до zMax —
// мультистоповый градиент (настраивается пользователем), не только 2 цвета. При 2 цветах
// ведёт себя как раньше (простой переход низкий→высокий уровень).
function contourColor(level, zMin, zMax, colors) {
  const stops = (colors && colors.length >= 2) ? colors : DEFAULT_CONTOUR_COLORS;
  const t = zMax > zMin ? (level - zMin) / (zMax - zMin) : 0.5;
  const tc = Math.min(1, Math.max(0, t));
  const seg = tc * (stops.length - 1);
  const i0 = Math.min(stops.length - 2, Math.floor(seg));
  const frac = seg - i0;
  const c0 = hexToRgb(stops[i0]), c1 = hexToRgb(stops[i0 + 1]);
  const r = Math.round(c0.r + (c1.r - c0.r) * frac), g = Math.round(c0.g + (c1.g - c0.g) * frac), b = Math.round(c0.b + (c1.b - c0.b) * frac);
  return (r << 16) | (g << 8) | b;
}

export class PitScene {
  constructor(container) {
    this.container = container;
    this.three = null;
    this.markerR = 1;
    this.wellTrajectories = [];
    this.waterPoints = [];
    this.contourData = null;
    this.contourGroup = null;
    this.onHover = null;
    this.model = null;
    this.sectionPicking = false;
    this.onSectionPick = null;
    this.sectionGroup = null;
  }

  nearestZ(x, y) {
    const m = this.model;
    if (!m || !m.xs.length) return 0;
    let best = Infinity, bestZ = m.zs[0];
    for (let i = 0; i < m.xs.length; i += Math.max(1, Math.floor(m.xs.length / 4000))) {
      const dx = m.xs[i] - x, dy = m.ys[i] - y, d = dx * dx + dy * dy;
      if (d < best) { best = d; bestZ = m.zs[i]; }
    }
    return bestZ;
  }

  worldToLocal(x, y, z) {
    const THREE = window.THREE;
    const tr = this.three.transform;
    return new THREE.Vector3((x - tr.cx) * tr.scale, (z - tr.cz) * tr.scale, -(y - tr.cy) * tr.scale);
  }

  // Точки/линия разреза выбираются кликом по рельефу — режим включает/выключает вращение
  // камеры (иначе обычный клик мышью распознаётся OrbitControls как начало вращения).
  setSectionPicking(enabled, onPick) {
    this.sectionPicking = enabled;
    this.onSectionPick = onPick || null;
    if (this.three) this.three.controls.enableRotate = !enabled;
  }

  clearSectionMarkers() {
    if (this.sectionGroup && this.three) {
      this.three.scene.remove(this.sectionGroup);
      this.sectionGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    this.sectionGroup = null;
  }

  addSectionMarker(x, y, color) {
    const THREE = window.THREE;
    if (!this.sectionGroup) { this.sectionGroup = new THREE.Group(); this.three.scene.add(this.sectionGroup); }
    const loc = this.worldToLocal(x, y, this.nearestZ(x, y));
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(this.markerR * 1.3, 12, 12), new THREE.MeshBasicMaterial({ color }));
    mesh.position.copy(loc);
    this.sectionGroup.add(mesh);
  }

  addSectionLine(a, b) {
    const THREE = window.THREE;
    if (!this.sectionGroup) { this.sectionGroup = new THREE.Group(); this.three.scene.add(this.sectionGroup); }
    const bb = (this.model && (this.model.robustBBox || this.model.bbox)) || { zMax: 1, zMin: 0 };
    const lift = (bb.zMax - bb.zMin) * 0.01 || 1;
    const N = 24;
    const positions = new Float32Array((N + 1) * 3);
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
      const loc = this.worldToLocal(x, y, this.nearestZ(x, y) + lift);
      positions[i * 3] = loc.x; positions[i * 3 + 1] = loc.y; positions[i * 3 + 2] = loc.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.sectionGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2 })));
  }

  // terrain — сечение реальной TIN рельефа (сетка реально есть везде, разрывов не бывает).
  // water — НЕ через триангуляцию: прямая выборка IDW (sampleWaterProfile) по реальным точкам
  // уровня воды (this.contourData.waterPoints), см. комментарий у sampleWaterProfile. Покрывает
  // всю длину линии разреза, даже если изогипсы ещё не построены за пределами их сетки.
  computeSectionData(ax, ay, bx, by) {
    const m = this.model;
    const terrain = sectionProfile(m.xs, m.ys, m.zs, m.triangles, ax, ay, bx, by);
    let water = null;
    if (this.contourData && this.contourData.waterPoints && this.contourData.waterPoints.length >= 3) {
      water = sampleWaterProfile(this.contourData.waterPoints, ax, ay, bx, by);
    }
    return { terrain, water };
  }

  async init(model) {
    await loadThree();
    const THREE = window.THREE;
    const container = this.container;
    const W = container.clientWidth || 480, H = container.clientHeight || 600;
    this.model = model;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0xf4f2ef, 1);
    container.innerHTML = '';
    container.style.position = 'relative';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(1, 2, 3);
    scene.add(dirLight);

    const { xs, ys, zs, triangles, bbox } = model;
    const b = model.robustBBox || bbox;
    const cx = (b.xMin + b.xMax) / 2, cy = (b.yMin + b.yMax) / 2, cz = (b.zMin + b.zMax) / 2;
    const span = Math.max(b.xMax - b.xMin, b.yMax - b.yMin, b.zMax - b.zMin) || 1;
    const scale = 80 / span;

    const numTri = triangles.length / 3;
    const positions = new Float32Array(numTri * 9);
    for (let j = 0; j < numTri; j++) {
      const i0 = triangles[j * 3], i1 = triangles[j * 3 + 1], i2 = triangles[j * 3 + 2];
      positions[j * 9 + 0] = (xs[i0] - cx) * scale; positions[j * 9 + 1] = (zs[i0] - cz) * scale; positions[j * 9 + 2] = -(ys[i0] - cy) * scale;
      positions[j * 9 + 3] = (xs[i1] - cx) * scale; positions[j * 9 + 4] = (zs[i1] - cz) * scale; positions[j * 9 + 5] = -(ys[i1] - cy) * scale;
      positions[j * 9 + 6] = (xs[i2] - cx) * scale; positions[j * 9 + 7] = (zs[i2] - cz) * scale; positions[j * 9 + 8] = -(ys[i2] - cy) * scale;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const solidMat = new THREE.MeshPhongMaterial({ color: 0xcbb387, side: THREE.DoubleSide, flatShading: true });
    const mesh = new THREE.Mesh(geo, solidMat);
    scene.add(mesh);

    const wireframe = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08 }));
    wireframe.visible = false;
    scene.add(wireframe);

    this.markerR = Math.max(span * scale * 0.006, 0.6);

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 5000);
    const d = span * scale;
    const initialCamPos = new THREE.Vector3(d * 0.9, d * 0.85, d * 1.1);
    camera.position.copy(initialCamPos);
    camera.lookAt(0, 0, 0);

    const controls = new window._sfOrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.panSpeed = 0.8;
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    this._stopped = false;
    const animate = () => {
      if (this._stopped) return;
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const nw = container.clientWidth, nh = container.clientHeight || nw;
      if (!nw || !nh) return;
      camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh);
    });
    ro.observe(container);

    this.three = { renderer, scene, camera, controls, mesh, wireframe, solidMat, markerGroup: null, wellsGroup: null, transform: { cx, cy, cz, scale }, resizeObserver: ro, initialCamPos };

    // Тултип по наведению (+ фото, если у точки есть photoUrl — водопроявления)
    const tooltip = document.createElement('div');
    tooltip.style.cssText = 'position:absolute;pointer-events:none;background:rgba(33,30,25,0.94);color:#fff;font-size:11px;line-height:1.5;padding:6px 9px;border-radius:6px;display:none;z-index:5;max-width:220px;box-shadow:0 4px 12px rgba(0,0,0,.2)';
    const tooltipText = document.createElement('div');
    tooltipText.style.cssText = 'white-space:nowrap';
    const tooltipImg = document.createElement('img');
    tooltipImg.style.cssText = 'display:none;width:100%;max-width:200px;border-radius:4px;margin-top:6px';
    tooltip.appendChild(tooltipText);
    tooltip.appendChild(tooltipImg);
    container.appendChild(tooltip);
    let tooltipPhotoKey = null;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    renderer.domElement.addEventListener('mousemove', (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const mg = this.three.markerGroup;
      const hits = mg && mg.visible ? raycaster.intersectObjects(mg.children) : [];
      const wg = this.three.wellsGroup;
      const wHits = !hits.length && wg && wg.visible ? raycaster.intersectObjects(wg.children) : [];
      const hit = hits[0] || wHits[0];
      if (hit) {
        const ud = hit.object.userData;
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
        tooltip.style.top = (e.clientY - rect.top + 14) + 'px';
        tooltipText.innerHTML = `<b>${ud.name || ''}</b><br>${ud.label || ''}${ud.z != null ? '<br>Z ≈ ' + ud.z.toFixed(1) + ' м' : ''}`;
        if (ud.photoUrl) {
          if (tooltipPhotoKey !== ud.photoUrl) { tooltipPhotoKey = ud.photoUrl; tooltipImg.src = ud.photoUrl; }
          tooltipImg.style.display = 'block';
        } else {
          tooltipImg.style.display = 'none';
          tooltipPhotoKey = null;
        }
      } else {
        tooltip.style.display = 'none';
      }
    });

    // Клик по рельефу в режиме "разрез" — задаёт точки A/B линии разреза. Слушаем
    // pointerdown/pointerup (не click) с порогом смещения — иначе конец вращения камеры
    // мышью засчитывался бы как клик по модели.
    let secDown = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { secDown = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      const down = secDown; secDown = null;
      if (!this.sectionPicking || !down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 12) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hits = raycaster.intersectObject(mesh);
      if (!hits.length) return;
      const lp = hits[0].point;
      const tr = this.three.transform;
      if (this.onSectionPick) this.onSectionPick(lp.x / tr.scale + tr.cx, tr.cy - lp.z / tr.scale);
    });

    return this;
  }

  setData({ waterPoints, wellTrajectories }) {
    this.waterPoints = waterPoints;
    this.wellTrajectories = wellTrajectories;
  }

  toLocal(p) {
    const THREE = window.THREE;
    const tr = this.three.transform;
    return new THREE.Vector3((p.x - tr.cx) * tr.scale, (p.z - tr.cz) * tr.scale, -(p.y - tr.cy) * tr.scale);
  }

  rebuildMarkers(layerStyle) {
    const THREE = window.THREE;
    const t = this.three;
    if (t.markerGroup) { t.scene.remove(t.markerGroup); t.markerGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    const group = new THREE.Group();
    this.waterPoints.forEach((p) => {
      const st = layerStyle[p.layerKey];
      if (!st || !st.visible) return;
      const color = st.color || '#999';
      const mat = new THREE.MeshBasicMaterial({ color, transparent: st.opacity < 1, opacity: st.opacity != null ? st.opacity : 1 });
      const geo = makeGeometry(THREE, st.geometry, this.markerR * (st.size || 1));
      const mesh = new THREE.Mesh(geo, mat);
      const local = this.toLocal(p);
      mesh.position.copy(local);
      mesh.userData = p;
      group.add(mesh);
    });
    t.scene.add(group);
    t.markerGroup = group;
  }

  rebuildWells(layerStyle) {
    const THREE = window.THREE;
    const t = this.three;
    if (t.wellsGroup) { t.scene.remove(t.wellsGroup); t.wellsGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    const group = new THREE.Group();
    this.wellTrajectories.forEach((w) => {
      const key = w.layerKey || (w.isPiezo ? 'wells_piezo' : 'wells_drainage');
      const st = layerStyle[key];
      if (!st || !st.visible) return;
      const label = w.kindLabel || (w.isPiezo ? 'Пьезометрическая скважина' : 'Дренажная скважина');
      const color = st.color || (w.isPiezo ? '#9d6bff' : '#4caf7d');
      const opacity = st.opacity != null ? st.opacity : 1;
      const sizeMul = st.size || 1;
      const c0 = this.toLocal(w.collar), c1 = this.toLocal(w.end);
      const dir = new THREE.Vector3().subVectors(c1, c0);
      const len = dir.length();
      if (len > 1e-4 && w.depth) {
        buildShaftSegments(THREE, c0, c1, w, color, opacity, sizeMul, this.markerR, label).forEach((mesh) => group.add(mesh));
      } else if (len > 1e-4) {
        // Нет данных о глубине для сегментации — как раньше, один сплошной цилиндр
        const shaftGeo = new THREE.CylinderGeometry(this.markerR * 0.28 * sizeMul, this.markerR * 0.28 * sizeMul, len, 6);
        const shaftMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity * (w.isPiezo ? 0.9 : 0.75) });
        const shaft = new THREE.Mesh(shaftGeo, shaftMat);
        shaft.position.copy(c0).addScaledVector(dir, 0.5);
        shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        shaft.userData = { name: w.name, label, z: w.collar.z };
        group.add(shaft);
      }
      if (!w.skipHead) {
        const headMat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
        const head = new THREE.Mesh(makeGeometry(THREE, st.geometry, this.markerR * 0.7 * sizeMul), headMat);
        head.position.copy(c0);
        head.userData = { name: w.name, label: label + ' (устье)', z: w.collar.z };
        group.add(head);
      }

      // Датчики VWP вдоль ствола пьезометрической скважины
      if (Array.isArray(w.sensors) && w.sensors.length && w.depth) {
        w.sensors.forEach((s) => {
          if (s.depth == null || s.depth <= 0 || s.depth > w.depth) return;
          const ratio = s.depth / w.depth;
          const sp = new THREE.Vector3().lerpVectors(c0, c1, ratio);
          const sMat = new THREE.MeshBasicMaterial({ color: s.connectedToLogger ? 0x4caf7d : 0x9aa0a6 });
          const sDot = new THREE.Mesh(new THREE.SphereGeometry(this.markerR * 0.45 * sizeMul, 8, 8), sMat);
          sDot.position.copy(sp);
          sDot.userData = { name: (s.name || 'Датчик') + ' — ' + w.name, label: 'Датчик VWP, глубина ' + s.depth + ' м', z: w.collar.z + ratio * (w.end.z - w.collar.z) };
          group.add(sDot);
        });
      }

      // Насос, если установлен в этой скважине
      if (w.pumpDepth != null && w.pumpDepth > 0 && w.depth && w.pumpDepth <= w.depth) {
        const ratio = w.pumpDepth / w.depth;
        const pp = new THREE.Vector3().lerpVectors(c0, c1, ratio);
        const pMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
        const pMesh = new THREE.Mesh(new THREE.ConeGeometry(this.markerR * 0.5 * sizeMul, this.markerR * 1 * sizeMul, 8), pMat);
        pMesh.position.copy(pp);
        pMesh.userData = { name: 'Насос — ' + w.name, label: 'Глубина установки ' + w.pumpDepth + ' м' + (w.pumpNotes ? ' · ' + w.pumpNotes : ''), z: w.collar.z + ratio * (w.end.z - w.collar.z) };
        group.add(pMesh);
      }
    });
    t.scene.add(group);
    t.wellsGroup = group;
  }

  setTerrainOpacity(opacity) {
    if (!this.three) return;
    this.three.solidMat.transparent = opacity < 1;
    this.three.solidMat.opacity = opacity;
  }

  resetView() {
    if (!this.three) return;
    this.three.camera.position.copy(this.three.initialCamPos);
    this.three.controls.target.set(0, 0, 0);
    this.three.controls.update();
  }

  // candidatePoints — необязательный явный список точек (для исключения части точек из
  // расчёта через настройки изогипс); по умолчанию — все точки с известной отметкой.
  // manualStep — фиксированный шаг вместо автоматического подбора.
  async buildContours(candidatePoints, manualStep) {
    await loadDelaunay();
    const wtPts = (candidatePoints || this.waterPoints.filter((p) => p.z != null)).map((p) => ({ x: p.x, y: p.y, z: p.z }));
    if (wtPts.length < 3) return null;
    // Полный bbox (не robustBBox) — тот специально обрезает статистические выбросы рельефа
    // для кадрирования камеры и может быть уже, чем фактическая модель, что обрывало сетку
    // изогипс/разреза у края. Для покрытия уровня воды нужен именно полный охват модели.
    const modelBounds = this.model ? (this.model.bbox || this.model.robustBBox) : null;
    const dense = densifyWaterTable(wtPts, modelBounds);
    const densePts = dense.points;
    const coords = new Float64Array(densePts.length * 2);
    densePts.forEach((p, i) => { coords[i * 2] = p.x; coords[i * 2 + 1] = p.y; });
    const delaunay = new window.d3.Delaunay(coords);
    const xs = Float64Array.from(densePts.map((p) => p.x)), ys = Float64Array.from(densePts.map((p) => p.y)), zs = Float64Array.from(densePts.map((p) => p.z));
    const triangles = filterLongTriangles(xs, ys, delaunay.triangles, dense.cell * 2.5);

    let zMin = wtPts[0].z, zMax = wtPts[0].z;
    wtPts.forEach((p) => { if (p.z < zMin) zMin = p.z; if (p.z > zMax) zMax = p.z; });
    this.lastAutoStep = chooseContourStep(zMin, zMax);
    const step = manualStep && manualStep > 0 ? manualStep : this.lastAutoStep;
    const levels = [];
    for (let L = Math.ceil(zMin / step) * step; L <= zMax + 1e-6; L += step) levels.push(Math.round(L * 100) /100);
    const byLevel = levels.map((level) => ({ level, segs: traceContourSegments(xs, ys, zs, triangles, level) })).filter((l) => l.segs.length > 0);
    // waterPoints (реальные точки уровня воды, до уплотнения) сохраняются отдельно —
    // используются для прямой IDW-выборки профиля разреза (sampleWaterProfile), а не tin.
    this.contourData = { levels: byLevel, zMin, zMax, pointCount: wtPts.length, step, tin: { xs, ys, zs, triangles }, waterPoints: wtPts };
    return this.contourData;
  }

  // renderMode: 'lines' (изолинии на своей высоте), 'fill' (сплошная заливка поверхности УПВ по
  // ступеням уровней — плоский цвет на треугольник, видны границы ступеней), 'gradient' (та же
  // поверхность, но цвет плавно интерполируется по вершинам). colors — мультистоповый градиент
  // (2+ HEX-цветов). showBoundaries — для 'fill'/'gradient' дополнительно рисует границы уровней
  // (те же изолинии, что в режиме 'lines') поверх заливки, слегка приподнятые (lift), чтобы не
  // мерцать (z-fighting) с самой поверхностью, на которой они физически лежат.
  addContourToScene(opacity, renderMode, colors, showBoundaries) {
    const THREE = window.THREE;
    const t = this.three;
    if (!this.contourData) return;
    const tr = t.transform;
    const group = new THREE.Group();
    const op = opacity != null ? opacity : 1;
    const mode = renderMode || 'lines';
    const { zMin, zMax } = this.contourData;
    const wantSurface = mode === 'fill' || mode === 'gradient';
    const wantLines = mode === 'lines' || (wantSurface && showBoundaries);
    const lift = (zMax - zMin) * 0.003 || 0.05;

    if (wantSurface) {
      const { xs, ys, zs, triangles } = this.contourData.tin;
      const { step } = this.contourData;
      const numTri = triangles.length / 3;
      // Не индексированная геометрия (3 своих вершины на треугольник) — нужна для 'fill', где
      // все 3 вершины треугольника красятся ОДНИМ цветом (плоская заливка без интерполяции на
      // границах ступеней); для 'gradient' работает так же, просто цвета вершин уже сами разные.
      const positions = new Float32Array(numTri * 9);
      const vColors = new Float32Array(numTri * 9);
      const tmpColor = new THREE.Color();
      for (let j = 0; j < numTri; j++) {
        const idx = [triangles[j * 3], triangles[j * 3 + 1], triangles[j * 3 + 2]];
        idx.forEach((vi, corner) => {
          const p = j * 9 + corner * 3;
          positions[p] = (xs[vi] - tr.cx) * tr.scale;
          positions[p + 1] = (zs[vi] - tr.cz) * tr.scale;
          positions[p + 2] = -(ys[vi] - tr.cy) * tr.scale;
        });
        if (mode === 'fill') {
          const zAvg = (zs[idx[0]] + zs[idx[1]] + zs[idx[2]]) / 3;
          const band = Math.min(zMax, Math.max(zMin, Math.floor((zAvg - zMin) / step) * step + zMin));
          tmpColor.setHex(contourColor(band, zMin, zMax, colors));
          for (let c = 0; c < 3; c++) { const p = j * 9 + c * 3; vColors[p] = tmpColor.r; vColors[p + 1] = tmpColor.g; vColors[p + 2] = tmpColor.b; }
        } else {
          idx.forEach((vi, corner) => {
            tmpColor.setHex(contourColor(zs[vi], zMin, zMax, colors));
            const p = j * 9 + corner * 3;
            vColors[p] = tmpColor.r; vColors[p + 1] = tmpColor.g; vColors[p + 2] = tmpColor.b;
          });
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(vColors, 3));
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false });
      group.add(new THREE.Mesh(geo, mat));
    }

    if (wantLines) {
      const lineOp = wantSurface ? 1 : op; // поверх заливки границы рисуем непрозрачными — иначе теряются
      this.contourData.levels.forEach((lvl) => {
        const color = contourColor(lvl.level, zMin, zMax, colors);
        const positions = new Float32Array(lvl.segs.length / 2 * 3);
        for (let i = 0, k = 0; i < lvl.segs.length; i += 2, k += 3) {
          const x = lvl.segs[i], y = lvl.segs[i + 1];
          positions[k] = (x - tr.cx) * tr.scale; positions[k + 1] = (lvl.level + (wantSurface ? lift : 0) - tr.cz) * tr.scale; positions[k + 2] = -(y - tr.cy) * tr.scale;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.LineBasicMaterial({ color, linewidth: 2, transparent: lineOp < 1, opacity: lineOp });
        group.add(new THREE.LineSegments(geo, mat));
      });
    }

    if (this.contourGroup) {
      t.scene.remove(this.contourGroup);
      this.contourGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    t.scene.add(group);
    this.contourGroup = group;
  }

  setContourVisible(visible) { if (this.contourGroup) this.contourGroup.visible = visible; }
  setWireframeVisible(visible) { if (this.three && this.three.wireframe) this.three.wireframe.visible = visible; }

  dispose() {
    this._stopped = true;
    if (!this.three) return;
    if (this.three.resizeObserver) this.three.resizeObserver.disconnect();
    if (this.three.renderer) { this.three.renderer.dispose(); this.three.renderer.domElement.remove(); }
    this.three = null;
  }
}
