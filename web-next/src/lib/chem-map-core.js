// Химический слой карты водопунктов — порт алгоритмов из hydro-monitoring/ui-wpmap.js
// (IDW/marching squares/палитры) и ui-chem.js (meq, классификация по Алёкину, Курлов).
// Framework-agnostic — используется из WpMap.js.

// ── Эквивалентные веса ионов (мг/л → мг-экв/л) ────────────────────────────
const CHEM_EW = { ca: 20.04, mg: 12.15, na: 23.0, k: 39.1, hco3: 61.0, co3: 30.0, so4: 48.0, cl: 35.45 };

export function calcMeq(results) {
  const v = {};
  (results || []).forEach((r) => {
    if (CHEM_EW[r.param_key] !== undefined) {
      const num = parseFloat(r.value_raw);
      if (!Number.isNaN(num) && num >= 0) v[r.param_key] = num;
    }
  });
  const meq = {};
  Object.keys(v).forEach((k) => { meq[k] = v[k] / CHEM_EW[k]; });
  meq.nak = (meq.na || 0) + (meq.k || 0);
  meq.ca = meq.ca || 0; meq.mg = meq.mg || 0; meq.hco3 = meq.hco3 || 0;
  meq.so4 = meq.so4 || 0; meq.cl = meq.cl || 0; meq.co3 = meq.co3 || 0;
  meq._raw = v;
  const catSum = meq.ca + meq.mg + meq.nak;
  const anSum = meq.hco3 + meq.so4 + meq.cl + meq.co3;
  meq._valid = catSum > 0 && anSum > 0;
  meq._catSum = catSum; meq._anSum = anSum;
  if (catSum > 0) { meq.ca_pct = meq.ca / catSum * 100; meq.mg_pct = meq.mg / catSum * 100; meq.nak_pct = meq.nak / catSum * 100; }
  if (anSum > 0) { meq.hco3_pct = meq.hco3 / anSum * 100; meq.so4_pct = meq.so4 / anSum * 100; meq.cl_pct = meq.cl / anSum * 100; meq.co3_pct = meq.co3 / anSum * 100; }
  const phRow = (results || []).find((r) => r.param_key === 'ph_lab' || r.param_key === 'ph_field');
  meq.ph = phRow ? parseFloat(phRow.value_raw) : NaN;
  const tdsRow = (results || []).find((r) => r.param_key === 'tds' || r.param_key === 'dry_res');
  meq.m_gl = tdsRow ? parseFloat(tdsRow.value_raw) / 1000 : NaN;
  return meq;
}

// ── Классификация по Алёкину (преобладающий катион-анион) ─────────────────
export const CHEM_WTYPE_COLORS = {
  'Ca-HCO3': '#4a9fe8', 'Ca-SO4': '#1e3a8a', 'Ca-Cl': '#0ea5b0',
  'Mg-HCO3': '#22c55e', 'Mg-SO4': '#f97316', 'Mg-Cl': '#84cc16',
  'Na-HCO3': '#a78bfa', 'Na-SO4': '#eab308', 'Na-Cl': '#ec4899',
};
export const ALEKIN_FACIES = [
  { key: 'Ca-HCO3', label: 'Ca-HCO₃' }, { key: 'Mg-HCO3', label: 'Mg-HCO₃' }, { key: 'Na-HCO3', label: 'Na-HCO₃' },
  { key: 'Ca-SO4', label: 'Ca-SO₄' }, { key: 'Mg-SO4', label: 'Mg-SO₄' }, { key: 'Na-SO4', label: 'Na-SO₄' },
  { key: 'Ca-Cl', label: 'Ca-Cl' }, { key: 'Mg-Cl', label: 'Mg-Cl' }, { key: 'Na-Cl', label: 'Na-Cl' },
];

export function classifyWaterType(meq) {
  const cats = [{ sym: 'Ca', pct: meq.ca_pct || 0 }, { sym: 'Mg', pct: meq.mg_pct || 0 }, { sym: 'Na', pct: meq.nak_pct || 0 }];
  const ans = [{ sym: 'HCO3', pct: (meq.hco3_pct || 0) + (meq.co3_pct || 0) }, { sym: 'SO4', pct: meq.so4_pct || 0 }, { sym: 'Cl', pct: meq.cl_pct || 0 }];
  const cat = cats.reduce((a, b) => (b.pct > a.pct ? b : a));
  const an = ans.reduce((a, b) => (b.pct > a.pct ? b : a));
  const key = cat.sym + '-' + an.sym;
  const label = key.replace('HCO3', 'HCO₃').replace('SO4', 'SO₄');
  return { key, label, color: CHEM_WTYPE_COLORS[key] || '#94a3b8' };
}

// ── Формула Курлова ─────────────────────────────────────────────────────
function meqIons(meq) {
  const anions = [
    { sym: 'HCO₃', pct: (meq.hco3_pct || 0) + (meq.co3_pct || 0) },
    { sym: 'SO₄', pct: meq.so4_pct || 0 },
    { sym: 'Cl', pct: meq.cl_pct || 0 },
  ].filter((x) => x.pct > 10).sort((a, b) => b.pct - a.pct);
  const cations = [
    { sym: 'Ca', pct: meq.ca_pct || 0 },
    { sym: 'Mg', pct: meq.mg_pct || 0 },
    { sym: 'Na+K', pct: meq.nak_pct || 0 },
  ].filter((x) => x.pct > 10).sort((a, b) => b.pct - a.pct);
  return { anions, cations };
}

export function buildKurlovHtml(meq) {
  const fmt1 = (v) => (v < 10 ? v.toFixed(1) : Math.round(v).toString());
  const { anions, cations } = meqIons(meq);
  const numStr = anions.map((x) => `${x.sym}<sup>${fmt1(x.pct)}</sup>`).join(' ');
  const denStr = cations.map((x) => `${x.sym}<sub>${fmt1(x.pct)}</sub>`).join(' ');
  const mStr = Number.isNaN(meq.m_gl) ? '' : `M<sub>${meq.m_gl.toFixed(2)}</sub> · `;
  const phStr = Number.isNaN(meq.ph) ? '' : `  pH ${meq.ph.toFixed(1)}`;
  const tdStr = Number.isNaN(meq.m_gl) ? '' : `<div style="font-size:11px;color:var(--text-tertiary);margin-top:8px">Минерализация: ${(meq.m_gl * 1000).toFixed(0)} мг/л</div>`;
  return `<div style="font-family:var(--font-mono);font-size:15px;line-height:1.3">${mStr}<span style="display:inline-flex;flex-direction:column;vertical-align:middle;text-align:center;border-bottom:1.5px solid currentColor;padding:0 3px;line-height:1.5"><span>${numStr || '—'}</span><span>${denStr || '—'}</span></span>${phStr}</div>${tdStr}`;
}

// ── IDW (степень 2), с учётом барьера-границы (MAP-01) ─────────────────
export function idw(x, y, pts, getVal, queryLat, queryLng, boundaries) {
  let wsum = 0, vsum = 0;
  for (let i = 0; i < pts.length; i++) {
    const v = getVal(pts[i]);
    if (v == null || Number.isNaN(v)) continue;
    const dx = x - pts[i].x, dy = y - pts[i].y;
    const d2 = dx * dx + dy * dy;
    if (d2 < 1e-10) return v;
    let w = 1 / d2;
    if (boundaries && boundaries.length && queryLat != null && pts[i].lat != null &&
        segmentCrossesBoundary([queryLat, queryLng], [pts[i].lat, pts[i].lng], boundaries)) {
      w *= 1e-4;
    }
    wsum += w; vsum += w * v;
  }
  return wsum > 0 ? vsum / wsum : NaN;
}

// ── Marching squares ─────────────────────────────────────────────────────
export function marchingSquares(values, nx, ny, threshold, xAt, yAt) {
  const segs = [];
  function edgePt(v1, v2, p1, p2) {
    const t = (threshold - v1) / (v2 - v1);
    return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
  }
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const vTL = values[j * nx + i], vTR = values[j * nx + i + 1];
      const vBL = values[(j + 1) * nx + i], vBR = values[(j + 1) * nx + i + 1];
      if (Number.isNaN(vTL) || Number.isNaN(vTR) || Number.isNaN(vBL) || Number.isNaN(vBR)) continue;
      const pTL = [xAt(i), yAt(j)], pTR = [xAt(i + 1), yAt(j)];
      const pBL = [xAt(i), yAt(j + 1)], pBR = [xAt(i + 1), yAt(j + 1)];
      const above = [vTL > threshold, vTR > threshold, vBR > threshold, vBL > threshold];
      const cnt = above.filter(Boolean).length;
      if (cnt === 0 || cnt === 4) continue;
      const top = above[0] !== above[1] ? edgePt(vTL, vTR, pTL, pTR) : null;
      const right = above[1] !== above[2] ? edgePt(vTR, vBR, pTR, pBR) : null;
      const bottom = above[3] !== above[2] ? edgePt(vBL, vBR, pBL, pBR) : null;
      const left = above[0] !== above[3] ? edgePt(vTL, vBL, pTL, pBL) : null;
      const pts = [top, right, bottom, left].filter(Boolean);
      if (pts.length === 2) {
        segs.push([pts[0], pts[1]]);
      } else if (pts.length === 4) {
        const avg = (vTL + vTR + vBL + vBR) / 4;
        if (avg > threshold) { segs.push([top, left]); segs.push([right, bottom]); }
        else { segs.push([top, right]); segs.push([left, bottom]); }
      }
    }
  }
  return segs;
}

// ── Точка-в-полигоне / пересечение отрезков (барьер интерполяции, MAP-01) ─
export function pointInPolygon(lat, lng, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][0], xi = poly[i][1];
    const yj = poly[j][0], xj = poly[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
export function inAnyBoundary(lat, lng, boundaries) {
  for (let i = 0; i < boundaries.length; i++) if (pointInPolygon(lat, lng, boundaries[i])) return true;
  return false;
}
function crossProd(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
function segSegIntersect(p1, p2, p3, p4) {
  const d1 = crossProd(p3, p4, p1), d2 = crossProd(p3, p4, p2);
  const d3 = crossProd(p1, p2, p3), d4 = crossProd(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
export function segmentCrossesBoundary(a, b, boundaries) {
  for (let bi = 0; bi < boundaries.length; bi++) {
    const poly = boundaries[bi];
    for (let i = 0; i < poly.length; i++) {
      if (segSegIntersect(a, b, poly[i], poly[(i + 1) % poly.length])) return true;
    }
  }
  return false;
}

// ── Палитры / шкалы ──────────────────────────────────────────────────────
export const MINERAL_RAMP = [
  { stop: 0, color: '#3b82f6', label: 'пресная' }, { stop: 0.25, color: '#22c55e' },
  { stop: 0.5, color: '#eab308' }, { stop: 0.75, color: '#f97316' },
  { stop: 1, color: '#ef4444', label: 'солёная / рассол' },
];
export const PH_RAMP = [
  { stop: 0, color: '#dc2626', label: 'кислая' }, { stop: 0.25, color: '#f97316' },
  { stop: 0.5, color: '#22c55e' }, { stop: 0.75, color: '#3b82f6' },
  { stop: 1, color: '#8b5cf6', label: 'щелочная' },
];
export const GENERIC_RAMP = [
  { stop: 0, color: '#3b82f6', label: 'минимум' }, { stop: 0.25, color: '#22c55e' },
  { stop: 0.5, color: '#eab308' }, { stop: 0.75, color: '#f97316' },
  { stop: 1, color: '#ef4444', label: 'максимум' },
];
export const PALETTES = {
  classic: { label: 'Классика' },
  viridis: { label: 'Viridis (дальтоники)', ramp: [{ stop: 0, color: '#440154', label: 'минимум' }, { stop: 0.25, color: '#3b528b' }, { stop: 0.5, color: '#21918c' }, { stop: 0.75, color: '#5ec962' }, { stop: 1, color: '#fde725', label: 'максимум' }] },
  mono: { label: 'Монохром (печать)', ramp: [{ stop: 0, color: '#eff6ff', label: 'минимум' }, { stop: 0.25, color: '#93c5fd' }, { stop: 0.5, color: '#3b82f6' }, { stop: 0.75, color: '#1d4ed8' }, { stop: 1, color: '#172554', label: 'максимум' }] },
};
export const STEP_PRESETS = { mineral: [1, 0.5, 0.1, 0.05, 0.01], ph: [1, 0.5, 0.1, 0.05, 0.01] };
export const DIVISION_PRESETS = [5, 10, 20, 40, 80];

export function getRamp(mode, palette) {
  const pal = palette || 'classic';
  if (pal !== 'classic' && PALETTES[pal]) return PALETTES[pal].ramp;
  return mode === 'mineral' ? MINERAL_RAMP : mode === 'ph' ? PH_RAMP : GENERIC_RAMP;
}
export function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}
export function rampColor(ramp, t) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < ramp.length - 1; i++) {
    const a = ramp[i], b = ramp[i + 1];
    if (t >= a.stop && t <= b.stop) {
      const lt = b.stop === a.stop ? 0 : (t - a.stop) / (b.stop - a.stop);
      const ca = hexToRgb(a.color), cb = hexToRgb(b.color);
      return [Math.round(ca[0] + (cb[0] - ca[0]) * lt), Math.round(ca[1] + (cb[1] - ca[1]) * lt), Math.round(ca[2] + (cb[2] - ca[2]) * lt)];
    }
  }
  return hexToRgb(ramp[ramp.length - 1].color);
}
export function quantize(val, step) {
  if (!step || step <= 0) return val;
  return Math.round(val / step) * step;
}

// ── Построение растра (canvas dataURL) + изолиний ────────────────────────
// pts: [{ x, y, lat, lng, meq, wtype, item, proto }] — x/y уже спроецированы (lng*cosLat, lat).
export function buildChemRaster(mode, pts, opts) {
  const isCont = mode === 'mineral' || mode === 'ph' || mode === 'param';
  const ramp = mode === 'wtype' ? null : getRamp(mode, opts.palette);
  const smooth = !!opts.smooth;
  const paramDef = opts.paramDef;

  let getV;
  if (mode === 'mineral') getV = (p) => p.meq.m_gl;
  else if (mode === 'ph') getV = (p) => p.meq.ph;
  else if (mode === 'param') getV = (p) => opts.getParamValue(p);

  const filtered = pts.filter((p) => {
    if (opts.excluded && opts.excluded[p.item.id]) return false;
    if (mode === 'mineral') return !Number.isNaN(p.meq.m_gl);
    if (mode === 'ph') return !Number.isNaN(p.meq.ph);
    if (mode === 'param') return !Number.isNaN(getV(p));
    return true;
  });
  if (filtered.length < 2) return null;

  let domain = null;
  let step = mode === 'param' ? null : (opts.step || 1);
  if (isCont) {
    const vals = filtered.map(getV);
    let vMin = Math.min(...vals), vMax = Math.max(...vals);
    if (vMax - vMin < 1e-9) { const pad0 = (step || vMax * 0.05 || 0.1) / 2; vMin -= pad0; vMax += pad0; }
    domain = { min: vMin, max: vMax };
    if (mode === 'param') {
      const divisions = opts.divisions || 10;
      step = (domain.max - domain.min) / divisions || 1;
    }
  }

  const lats = filtered.map((p) => p.item.lat), lngs = filtered.map((p) => p.item.lng);
  let latMin = Math.min(...lats), latMax = Math.max(...lats);
  let lngMin = Math.min(...lngs), lngMax = Math.max(...lngs);
  const padLat = Math.max((latMax - latMin) * 0.3, 0.004);
  const padLng = Math.max((lngMax - lngMin) * 0.3, 0.006);
  latMin -= padLat; latMax += padLat; lngMin -= padLng; lngMax += padLng;

  const cosLat = Math.cos((latMin + latMax) / 2 * Math.PI / 180) || 1;
  const proj = filtered.map((p) => ({ x: p.item.lng * cosLat, y: p.item.lat, lat: p.item.lat, lng: p.item.lng, meq: p.meq, wtype: p.wtype, proto: p.proto, item: p.item }));

  const boundaries = opts.boundaries || [];

  const RES = 90;
  const raw = isCont ? new Array(RES * RES) : null;
  const canvas = document.createElement('canvas');
  canvas.width = RES; canvas.height = RES;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(RES, RES);

  for (let row = 0; row < RES; row++) {
    const lat = latMax - (row / (RES - 1)) * (latMax - latMin);
    for (let col = 0; col < RES; col++) {
      const lng = lngMin + (col / (RES - 1)) * (lngMax - lngMin);
      const x = lng * cosLat, y = lat;
      let color; const gi = row * RES + col;
      if (mode === 'wtype') {
        let best = null, bestD = Infinity;
        for (let i = 0; i < proj.length; i++) {
          const dx = x - proj[i].x, dy = y - proj[i].y; let d2 = dx * dx + dy * dy;
          if (boundaries.length && segmentCrossesBoundary([lat, lng], [proj[i].lat, proj[i].lng], boundaries)) d2 *= 1e4;
          if (d2 < bestD) { bestD = d2; best = proj[i]; }
        }
        color = hexToRgb(best.wtype.color);
      } else {
        const val = idw(x, y, proj, getV, lat, lng, boundaries);
        raw[gi] = val;
        const useVal = smooth ? val : quantize(val, step);
        const t = domain.max > domain.min ? (useVal - domain.min) / (domain.max - domain.min) : 0.5;
        color = rampColor(ramp, t);
      }
      const idx = gi * 4;
      const alpha = boundaries.length && inAnyBoundary(lat, lng, boundaries) ? 0 : 168;
      img.data[idx] = color[0]; img.data[idx + 1] = color[1]; img.data[idx + 2] = color[2]; img.data[idx + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);

  const isoLevels = [];
  if (isCont && !smooth) {
    const xAt = (col) => lngMin + (col / (RES - 1)) * (lngMax - lngMin);
    const yAt = (row) => latMax - (row / (RES - 1)) * (latMax - latMin);
    const levelStart = (Math.ceil(domain.min / step - 0.5) + 0.5) * step;
    let levels = [];
    for (let k = 0; ; k++) {
      const lvVal = Math.round((levelStart + k * step) * 1e6) / 1e6;
      if (lvVal >= domain.max - 1e-9) break;
      levels.push(lvVal);
    }
    const MAX_ISO_LEVELS = 150;
    if (levels.length > MAX_ISO_LEVELS) {
      const stride = Math.ceil(levels.length / MAX_ISO_LEVELS);
      levels = levels.filter((_, idx) => idx % stride === 0);
    }
    levels.forEach((lvVal) => {
      let segs = marchingSquares(raw, RES, RES, lvVal, xAt, yAt);
      if (boundaries.length) {
        segs = segs.filter((seg) => {
          const mLng = (seg[0][0] + seg[1][0]) / 2, mLat = (seg[0][1] + seg[1][1]) / 2;
          return !inAnyBoundary(mLat, mLng, boundaries);
        });
      }
      if (segs.length) isoLevels.push({ value: lvVal, segs });
    });
  }

  return {
    dataUrl: canvas.toDataURL(),
    bounds: [[latMin, lngMin], [latMax, lngMax]],
    isoLevels, n: filtered.length, domain, step, smooth,
    mode, proj, getV, boundaries, cosLat, paramDef,
  };
}
