// Прогноз зумпфов — точный порт расчётной части hydro-monitoring/ui-sump-forecast.js
// (_sfParseGeomBlob, _sfCrossSectionArea, _sfBuildVolumeCurve, _sfComputeInflowHistory,
// _sfSimulateForecast и т.д.), чтобы цифры совпадали со старым приложением. Плюс
// Supabase-обёртки для версий кривой V(H) и хранилища .tridb (bucket 'sump-models').
import { supabase } from './supabase.js';
import { loadSqlJs } from './sqljs-loader.js';
import { computedVolume } from './dewatering-core.js';

// ── Парсинг Geometry BLOB из .tridb (формат Micromine) ──────────────────────
// Заголовок 60 байт (GUID и пр.) → блоки [size(4),0(4),type(4),0(4)] + данные.
// type 1/2/3 = X/Y/Z float64[], type 4 = индексы треугольников uint32×3.
export function parseGeomBlob(blob) {
  const buf = blob.buffer ? blob.buffer : blob;
  const dv = new DataView(buf instanceof ArrayBuffer ? buf : buf.slice(0));
  let off = 60;
  let xs, ys, zs, tris;

  while (off < dv.byteLength - 16) {
    const blockSize = dv.getUint32(off, true);
    const blockType = dv.getUint32(off + 8, true);
    off += 16;
    if (blockSize === 0) break;
    const count = blockSize / 8;

    if (blockType === 1 || blockType === 2 || blockType === 3) {
      const arr = new Float64Array(count);
      for (let i = 0; i < count; i++) arr[i] = dv.getFloat64(off + i * 8, true);
      if (blockType === 1) xs = arr; else if (blockType === 2) ys = arr; else zs = arr;
    } else if (blockType === 4) {
      const nTri = (blockSize / 4) / 3;
      tris = [];
      for (let j = 0; j < nTri; j++) {
        tris.push([dv.getUint32(off + j * 12, true), dv.getUint32(off + j * 12 + 4, true), dv.getUint32(off + j * 12 + 8, true)]);
      }
    }
    off += blockSize;
  }
  return { xs, ys, zs, tris };
}

// ── Площадь горизонтального сечения меша на отметке H ───────────────────────
// Топологический обход контуров (не зависит от ориентации нормалей треугольников):
// находим все отрезки пересечения треугольников с плоскостью Z=H, строим граф
// смежности их концов, обходим замкнутые контуры, суммируем площади по Шнурку.
// Координаты квантуются с точностью 1мм, чтобы близкие концы отрезков слипались.
export function crossSectionArea(lxs, lys, zs, tris, H) {
  const Q = 1000;
  const ptKey = (x, y) => (Math.round(x * Q) + 4000000) + '|' + (Math.round(y * Q) + 4000000);
  const graph = {};

  for (let i = 0; i < tris.length; i++) {
    const t = tris[i];
    const vx = [lxs[t[0]], lxs[t[1]], lxs[t[2]]];
    const vy = [lys[t[0]], lys[t[1]], lys[t[2]]];
    const vz = [zs[t[0]], zs[t[1]], zs[t[2]]];
    const pts = [];
    for (let e = 0; e < 3; e++) {
      const ne = (e + 1) % 3;
      const az = vz[e], bz = vz[ne];
      if ((az < H) === (bz < H)) continue;
      const tt = (H - az) / (bz - az);
      pts.push([vx[e] + tt * (vx[ne] - vx[e]), vy[e] + tt * (vy[ne] - vy[e])]);
    }
    if (pts.length !== 2) continue;
    const k0 = ptKey(pts[0][0], pts[0][1]);
    const k1 = ptKey(pts[1][0], pts[1][1]);
    if (k0 === k1) continue;
    if (!graph[k0]) graph[k0] = { x: pts[0][0], y: pts[0][1], nb: [] };
    if (!graph[k1]) graph[k1] = { x: pts[1][0], y: pts[1][1], nb: [] };
    graph[k0].nb.push(k1);
    graph[k1].nb.push(k0);
  }

  const keys = Object.keys(graph);
  if (keys.length < 3) return 0;

  const usedEdge = {};
  let totalArea = 0;

  for (const startKey of keys) {
    const startNbs = graph[startKey].nb;
    let firstNb = null;
    for (const nb of startNbs) { if (!usedEdge[startKey + '>' + nb]) { firstNb = nb; break; } }
    if (!firstNb) continue;

    const loop = [graph[startKey]];
    let prev = startKey, cur = firstNb;
    usedEdge[startKey + '>' + firstNb] = true;
    usedEdge[firstNb + '>' + startKey] = true;

    let guard = keys.length + 4;
    while (cur !== startKey && guard-- > 0) {
      const nd = graph[cur];
      if (!nd) break;
      loop.push(nd);
      let nextKey = null;
      for (const nb of nd.nb) { if (nb !== prev && !usedEdge[cur + '>' + nb]) { nextKey = nb; break; } }
      if (!nextKey) { for (const nb of nd.nb) { if (!usedEdge[cur + '>' + nb]) { nextKey = nb; break; } } }
      if (!nextKey) break;
      usedEdge[cur + '>' + nextKey] = true;
      usedEdge[nextKey + '>' + cur] = true;
      prev = cur; cur = nextKey;
    }

    if (loop.length < 3) continue;
    let area = 0;
    for (let j = 0; j < loop.length; j++) {
      const pa = loop[j], pb = loop[(j + 1) % loop.length];
      area += pa.x * pb.y - pb.x * pa.y;
    }
    totalArea += Math.abs(area) * 0.5;
  }
  return totalArea;
}

// ── Кривая V(H): интегрирование площадей сечений (правило средней точки, шаг 10см) ──
// XY центрируются относительно центроида меша — иначе большие абсолютные координаты
// (x≈46000м) при квантовании ключей сечений могут давать коллизии.
export function buildVolumeCurve(xs, ys, zs, tris, zMin, zMax) {
  let xSum = 0, ySum = 0;
  const nv = xs.length;
  for (let k = 0; k < nv; k++) { xSum += xs[k]; ySum += ys[k]; }
  const xOff = xSum / nv, yOff = ySum / nv;
  const lxs = new Float64Array(nv), lys = new Float64Array(nv);
  for (let k = 0; k < nv; k++) { lxs[k] = xs[k] - xOff; lys[k] = ys[k] - yOff; }

  const step = 0.1;
  const curve = [{ h: zMin, v: 0 }];
  let V = 0, H = zMin + step;
  while (H <= zMax + step * 0.01) {
    H = Math.round(H * 10) / 10;
    const A = crossSectionArea(lxs, lys, zs, tris, H - step * 0.5);
    V += A * step;
    curve.push({ h: H, v: V });
    H += step;
  }
  return curve;
}

export function volumeAt(curve, level) {
  if (!curve || curve.length === 0 || level == null) return null;
  if (level <= curve[0].h) return 0;
  if (level >= curve[curve.length - 1].h) return curve[curve.length - 1].v;
  for (let i = 1; i < curve.length; i++) {
    if (level <= curve[i].h) {
      const t = (level - curve[i - 1].h) / (curve[i].h - curve[i - 1].h);
      return curve[i - 1].v + t * (curve[i].v - curve[i - 1].v);
    }
  }
  return null;
}

export function levelAt(curve, targetV) {
  if (!curve || curve.length === 0) return null;
  if (targetV <= 0) return curve[0].h;
  if (targetV >= curve[curve.length - 1].v) return curve[curve.length - 1].h;
  for (let i = 1; i < curve.length; i++) {
    if (curve[i].v >= targetV) {
      const t = (targetV - curve[i - 1].v) / (curve[i].v - curve[i - 1].v);
      return curve[i - 1].h + t * (curve[i].h - curve[i - 1].h);
    }
  }
  return null;
}

// ── Версии кривой V(H) по датам ──────────────────────────────────────────────
// Версия с наибольшей valid_from <= date. Без версий — используем sump.volume_curve
// напрямую (обратная совместимость с одноразовой загрузкой без версионирования).
export function getCurveForDate(sump, curveVersions, date) {
  const versions = (curveVersions || [])
    .filter((v) => v.sumpId === sump.id && v.validFrom <= date && v.volumeCurve && v.volumeCurve.length > 0)
    .sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0));
  if (versions.length > 0) return versions[versions.length - 1].volumeCurve;
  return sump.volume_curve || null;
}

export function sumpHasCurve(sump, curveVersions) {
  if (sump.volume_curve && sump.volume_curve.length > 0) return true;
  return (curveVersions || []).some((v) => v.sumpId === sump.id && v.volumeCurve && v.volumeCurve.length > 0);
}

// ── Средний суточный приток по истории уровней и откачки ────────────────────
// Q_приток = (V_откачано + ΔV_зумпф) / часы, по парам последовательных замеров уровня.
// Если внутри пары сменилась кривая V(H) — пара делится пропорционально на две.
export function computeInflowHistory({ sump, curveVersions, waterLevels, pumps, readings, dateFrom, dateTo }) {
  const result = [];
  if (!sumpHasCurve(sump, curveVersions) || !dateFrom) return result;

  const levByDate = {};
  waterLevels
    .filter((l) => l.sumpId === sump.id && l.date >= dateFrom && l.date <= dateTo)
    .forEach((l) => { if (!levByDate[l.date] || l.time < levByDate[l.date].time) levByDate[l.date] = l; });

  const pumpIds = pumps.filter((p) => p.sumpId === sump.id).map((p) => p.id);
  const pumpedByDate = {};
  readings.forEach((r) => {
    if (!pumpIds.includes(r.pumpId) || r.date < dateFrom || r.date > dateTo) return;
    pumpedByDate[r.date] = (pumpedByDate[r.date] || 0) + (computedVolume(readings, r) || 0);
  });

  const curveChangeDates = (curveVersions || [])
    .filter((v) => v.sumpId === sump.id && v.volumeCurve && v.volumeCurve.length > 0)
    .map((v) => v.validFrom).sort();

  const dates = Object.keys(levByDate).sort();
  for (let i = 1; i < dates.length; i++) {
    const d1 = dates[i - 1], d2 = dates[i];
    const H1 = parseFloat(levByDate[d1].elevation), H2 = parseFloat(levByDate[d2].elevation);
    if (isNaN(H1) || isNaN(H2)) continue;

    const d1ms = new Date(d1).getTime(), d2ms = new Date(d2).getTime(), dayMs = 86400000;
    const nDays = (d2ms - d1ms) / dayMs;

    let Vpumped = 0;
    for (let t = d1ms; t < d2ms; t += dayMs) {
      Vpumped += pumpedByDate[new Date(t).toISOString().slice(0, 10)] || 0;
    }

    let splitDate = null;
    for (const cd of curveChangeDates) { if (cd > d1 && cd <= d2) { splitDate = cd; break; } }

    if (splitDate) {
      const splitMs = new Date(splitDate).getTime();
      const frac = (splitMs - d1ms) / (d2ms - d1ms);
      const Hmid = H1 + frac * (H2 - H1);
      const curve1 = getCurveForDate(sump, curveVersions, d1);
      const curve2 = getCurveForDate(sump, curveVersions, splitDate);
      const Va = volumeAt(curve1, H1), Vb = volumeAt(curve1, Hmid), Vc = volumeAt(curve2, Hmid), Vd = volumeAt(curve2, H2);
      if (Va === null || Vb === null || Vc === null || Vd === null) continue;

      const Vp1 = Vpumped * frac, Vp2 = Vpumped * (1 - frac);
      const nDays1 = nDays * frac, nDays2 = nDays * (1 - frac);
      const dV1 = Vb - Va, dV2 = Vd - Vc;
      const Qraw1 = nDays1 > 0 ? (Vp1 + dV1) / (nDays1 * 24) : 0;
      const Qraw2 = nDays2 > 0 ? (Vp2 + dV2) / (nDays2 * 24) : 0;

      result.push({ date: d1, q: Math.round(Math.max(0, Qraw1) * 10) / 10, qRaw: Math.round(Qraw1 * 10) / 10, vpumped: Math.round(Vp1), h1: H1, h2: Hmid, v1: Math.round(Va), v2: Math.round(Vb), dv: Math.round(dV1), splitNote: '→' + splitDate });
      result.push({ date: splitDate, q: Math.round(Math.max(0, Qraw2) * 10) / 10, qRaw: Math.round(Qraw2 * 10) / 10, vpumped: Math.round(Vp2), h1: Hmid, h2: H2, v1: Math.round(Vc), v2: Math.round(Vd), dv: Math.round(dV2), splitNote: splitDate + '→' });
    } else {
      const curve = getCurveForDate(sump, curveVersions, d1);
      const V1 = volumeAt(curve, H1), V2 = volumeAt(curve, H2);
      if (V1 === null || V2 === null) continue;
      const deltaV = V2 - V1;
      const QinRaw = (Vpumped + deltaV) / (nDays * 24);
      result.push({ date: d1, q: Math.round(Math.max(0, QinRaw) * 10) / 10, qRaw: Math.round(QinRaw * 10) / 10, vpumped: Math.round(Vpumped), h1: H1, h2: H2, v1: Math.round(V1), v2: Math.round(V2), dv: Math.round(deltaV) });
    }
  }
  return result.slice(-60);
}

// ── Фактическая производительность насосов зумпфа за период ─────────────────
export function pumpPerformance({ sump, pumps, readings, dateFrom, dateTo }) {
  return pumps.filter((p) => p.sumpId === sump.id).map((p) => {
    const recs = readings.filter((r) => r.pumpId === p.id && r.date >= dateFrom && r.date <= dateTo && !r.isStopped);
    const totalVol = recs.reduce((s, r) => s + (computedVolume(readings, r) || 0), 0);
    const totalH = recs.reduce((s, r) => s + (parseFloat(r.hoursWorked) || 0), 0);
    const q = totalH > 0 ? totalVol / totalH : 0;
    return { id: p.id, name: p.name, model: p.model, status: p.status, q: Math.round(q * 10) / 10, totalVol: Math.round(totalVol), totalH: Math.round(totalH) };
  });
}

// ── Часовой имитатор баланса: dV = (Q_приток − Q_насосы) × 1ч ────────────────
export function simulateForecast({ curve, totalVolume, zMin, pumps, forecastParams, avgQin, H0 }) {
  const fp = forecastParams;
  const startMs = new Date(fp.startDt).getTime();
  const endMs = new Date(fp.endDt).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return [];

  const V0 = volumeAt(curve, H0 != null ? H0 : zMin);
  const total = totalVolume || curve[curve.length - 1].v;
  let V = V0 !== null ? V0 : 0;
  let H = H0 != null ? H0 : zMin;

  const result = [];
  const step = 3600000;
  for (let t = startMs; t <= endMs; t += step) {
    let Qpump = 0;
    pumps.forEach((p) => {
      const pq = fp.pumpQ[p.id] !== undefined ? fp.pumpQ[p.id] : p.q;
      const stopped = fp.stops.some((s) => {
        if (s.pumpId !== p.id) return false;
        const sStart = new Date(s.startDt).getTime();
        const sEnd = sStart + s.durationH * 3600000;
        return t >= sStart && t < sEnd;
      });
      if (!stopped) Qpump += pq;
    });

    result.push({ t, H, V, Qpump });
    const dV = (avgQin - Qpump) * 1;
    V = Math.min(Math.max(V + dV, 0), total);
    const newH = levelAt(curve, V);
    if (newH !== null) H = newH;
  }
  return result;
}

export function latestLevel(sumpId, waterLevels) {
  const levs = waterLevels.filter((l) => l.sumpId === sumpId && l.elevation != null).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  return levs.length ? parseFloat(levs[levs.length - 1].elevation) : null;
}

// ── Supabase: версии кривой V(H) ─────────────────────────────────────────────
export async function fetchCurveVersions() {
  const { data, error } = await supabase.from('dew_sump_curve_versions').select('*').order('valid_from');
  if (error) throw error;
  return (data || []).map((v) => ({ ...v, sumpId: v.sump_id, validFrom: v.valid_from, totalVolume: v.total_volume, zMin: v.z_min, zMax: v.z_max, tridbPath: v.tridb_path, volumeCurve: v.volume_curve }));
}

export async function deleteCurveVersion(id) {
  const { error } = await supabase.from('dew_sump_curve_versions').delete().eq('id', id);
  if (error) throw error;
}

export async function saveCriticalLevel(sumpId, value) {
  const { error } = await supabase.from('dew_sumps').update({ critical_level: value }).eq('id', sumpId);
  if (error) throw error;
}

function genId(prefix) { return prefix + Date.now() + '_' + Math.random().toString(36).slice(2, 6); }

// ── Загрузка .tridb: парсинг геометрии, построение V(H), сохранение файла+версии ──
export async function handleTridbUpload({ file, sump, validFrom, onStatus }) {
  const status = onStatus || (() => {});
  status('Загрузка sql.js...');
  const SQL = await loadSqlJs();

  status('Чтение файла...');
  const ab = await file.arrayBuffer();
  let db;
  try { db = new SQL.Database(new Uint8Array(ab)); }
  catch { throw new Error('Не удалось открыть файл как SQLite. Проверьте формат .tridb'); }

  try {
    const infoRow = db.exec('SELECT Volume,ZMinimum,ZMaximum,Name FROM GeneralInformation LIMIT 1')[0].values[0];
    const totalVol = infoRow[0], zMin = infoRow[1], zMax = infoRow[2];

    status(`Парсинг геометрии (${zMin.toFixed(1)} — ${zMax.toFixed(1)} м)...`);
    const geomBlob = db.exec('SELECT Geometry FROM Geometry LIMIT 1')[0].values[0][0];
    const geom = parseGeomBlob(geomBlob);
    if (!geom.xs || !geom.tris) throw new Error('Геометрия не найдена в файле');

    status('Построение кривой V(H)...');
    const curve = buildVolumeCurve(geom.xs, geom.ys, geom.zs, geom.tris, zMin, zMax);

    const computedMax = curve[curve.length - 1].v;
    const errFrac = totalVol > 0 ? Math.abs(computedMax - totalVol) / totalVol : 1;
    const verifyWarning = errFrac > 0.10
      ? `V(zMax)=${Math.round(computedMax).toLocaleString('ru')} м³, паспорт=${Math.round(totalVol).toLocaleString('ru')} м³ (расхождение ${(errFrac * 100).toFixed(0)}%). Проверьте меш.`
      : null;

    status('Загрузка файла в хранилище...');
    const path = `${sump.id}/${Date.now()}.tridb`;
    let uploaded = false;
    const { error: upErr } = await supabase.storage.from('sump-models').upload(path, file, { upsert: true });
    if (!upErr) uploaded = true;

    const totalVolume = Math.round(totalVol * 10) / 10;

    status('Сохранение в базу...');
    const { error: sumpErr } = await supabase.from('dew_sumps').update({
      tridb_path: uploaded ? path : sump.tridb_path,
      total_volume: totalVolume, z_min: zMin, z_max: zMax, volume_curve: curve,
    }).eq('id', sump.id);
    if (sumpErr) throw sumpErr;

    const newVersion = { id: genId('scv_'), sump_id: sump.id, valid_from: validFrom, total_volume: totalVolume, z_min: zMin, z_max: zMax, tridb_path: uploaded ? path : null, volume_curve: curve, notes: '' };
    const { data: existing } = await supabase.from('dew_sump_curve_versions').select('id').eq('sump_id', sump.id).eq('valid_from', validFrom).maybeSingle();
    if (existing) newVersion.id = existing.id;
    const { error: verErr } = await supabase.from('dew_sump_curve_versions').upsert(newVersion);
    if (verErr) throw verErr;

    status(`✓ Готово! Объём: ${totalVolume.toFixed(0)} м³ · Z: ${zMin.toFixed(1)}–${zMax.toFixed(1)} м`);
    return { totalVolume, zMin, zMax, curve, geom, verifyWarning };
  } finally {
    db.close();
  }
}

// ── Загрузка геометрии из уже сохранённого .tridb (для 3D, без повторного парсинга V(H)) ──
export async function fetchTridbGeometry(tridbPath) {
  const [SQL, fileRes] = await Promise.all([
    loadSqlJs(),
    supabase.storage.from('sump-models').download(tridbPath),
  ]);
  if (fileRes.error || !fileRes.data) throw new Error('Не удалось скачать файл модели');
  const ab = await fileRes.data.arrayBuffer();
  const db = new SQL.Database(new Uint8Array(ab));
  try {
    const row = db.exec('SELECT Geometry FROM Geometry LIMIT 1')[0].values[0][0];
    return parseGeomBlob(row);
  } finally {
    db.close();
  }
}
