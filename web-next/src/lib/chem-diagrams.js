// Гидрохимические диаграммы (Пайпер, квадрат Толстихина, Стифф, Шёллер) —
// точный порт canvas-отрисовки из hydro-monitoring/ui-chem.js. Framework-agnostic:
// каждая функция рисует в переданный <canvas>, вызывается из React через useEffect.
import { classifyWaterType } from './chem-map-core.js';

// Один цвет = одна проба/дата — тот же порядок, что даёт CHEM_DATE_COLORS в старом
// приложении, используется и точками Пайпера/Толстихина, и линиями Шёллера.
export const CHEM_DATE_COLORS = ['#22d3ee', '#f59e0b', '#10b981', '#f87171', '#a78bfa', '#fb923c', '#38bdf8', '#34d399', '#f472b6', '#fbbf24', '#818cf8', '#fb7185'];

function fmtDate(s) {
  if (!s) return '—';
  const [y, m, d] = String(s).split('-');
  return d && m && y ? `${d}.${m}.${y}` : s;
}

// Готовит canvas к отрисовке в логических (CSS) пикселях cssW×cssH с поправкой на devicePixelRatio.
function prepCanvas(canvas, cssW, cssH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// Приложение не поддерживает тёмную тему (нет data-theme/токенов) — используем светлую палитру.
function isDarkTheme() { return false; }

// ── Словесное название типа воды + короткий бейдж (для панели рядом с Пайпером) ──
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
const ION_ADJ = { 'HCO₃': { pre: 'гидрокарбонатно', full: 'гидрокарбонатная' }, 'SO₄': { pre: 'сульфатно', full: 'сульфатная' }, 'Cl': { pre: 'хлоридно', full: 'хлоридная' }, 'Ca': { pre: 'кальциево', full: 'кальциевая' }, 'Mg': { pre: 'магниево', full: 'магниевая' }, 'Na+K': { pre: 'натриево', full: 'натриевая' } };
function ionPhrase(sortedDesc) {
  if (!sortedDesc.length) return '';
  const asc = sortedDesc.slice().reverse();
  return asc.map((x, i) => {
    const adj = ION_ADJ[x.sym];
    if (!adj) return x.sym;
    const isLast = i === asc.length - 1;
    const word = isLast ? adj.full : adj.pre + '-';
    return isLast ? `<strong>${word}</strong>` : word;
  }).join('');
}
function waterTypeName(meq) {
  const ions = meqIons(meq);
  if (!ions.anions.length && !ions.cations.length) return 'Недостаточно данных для классификации';
  const name = (ionPhrase(ions.anions) + ' ' + ionPhrase(ions.cations) + ' вода').replace(/\s+/g, ' ').trim();
  return name.replace(/^(<strong>)?([а-яё])/i, (_, tag, ch) => (tag || '') + ch.toUpperCase());
}
// HTML-строка: полное словесное название + бейдж короткой формулы (Ca-HCO₃ и т.п.) — для dangerouslySetInnerHTML.
// Формула Курлова уже реализована в chem-map-core.js (buildKurlovHtml) — реэкспорта здесь не требуется, импортируйте оттуда напрямую.
export function wtypeHtml(meq) {
  const wt = classifyWaterType(meq);
  return waterTypeName(meq) + ` <span class="badge" style="background:${wt.color}18;color:${wt.color}">${wt.label}</span>`;
}

// ── Общая геометрия для подписей осей ─────────────────────────────────────
function lineIntersect(p1, d1, p2, d2) {
  const det = d1.x * d2.y - d1.y * d2.x;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((p2.x - p1.x) * d2.y - (p2.y - p1.y) * d2.x) / det;
  return { x: p1.x + t * d1.x, y: p1.y + t * d1.y };
}
function outwardNormal(p0, p1, opp) {
  const d = { x: p1.x - p0.x, y: p1.y - p0.y };
  const n0 = { x: -d.y, y: d.x };
  const len = Math.hypot(n0.x, n0.y) || 1;
  const n = { x: n0.x / len, y: n0.y / len };
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const toOpp = { x: opp.x - mid.x, y: opp.y - mid.y };
  if (n.x * toOpp.x + n.y * toOpp.y > 0) { n.x = -n.x; n.y = -n.y; }
  return n;
}

// ── Диаграмма Пайпера ──────────────────────────────────────────────────────
// allMeqs — [{meq, id, date}] всех проб одного водопункта. currentId — какая
// выделена по умолчанию (крупная точка). onSelect(id) — необязательный колбэк
// при клике по точке (диаграмма перерисовывает себя сама независимо от него).
export function drawPiper(canvas, allMeqs, currentId, cssW, onSelect) {
  const W = cssW || 580;
  const dark = isDarkTheme();
  const COL_LINE = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
  const COL_TXT = dark ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.62)';
  const COL_AXIS = dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
  const COL_FILL = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  const HALO = dark ? 'rgba(13,17,26,0.85)' : 'rgba(255,255,255,0.85)';

  const MARGIN = 56;
  const S = Math.max(95, Math.min(190, (W - MARGIN * 2) * 0.28));
  const H3 = S * Math.sqrt(3) / 2;
  const GAP = Math.max(90, S * 0.55);
  const OX = W / 2;
  const TOP_PAD = 30, BOTTOM_PAD = 50;
  const H = Math.round(TOP_PAD + 3 * H3 + BOTTOM_PAD);
  const ctx = prepCanvas(canvas, W, H);
  ctx.clearRect(0, 0, W, H);
  const BY = H - BOTTOM_PAD;

  const LBL = { x: OX - GAP / 2 - S, y: BY };
  const LBR = { x: OX - GAP / 2, y: BY };
  const LBT = { x: OX - GAP / 2 - S / 2, y: BY - H3 };
  const RBL = { x: OX + GAP / 2, y: BY };
  const RBR = { x: OX + GAP / 2 + S, y: BY };
  const RBT = { x: OX + GAP / 2 + S / 2, y: BY - H3 };

  const DH = H3 * 2;
  const D_BOT = { x: OX, y: BY - H3 };
  const D_TOP = { x: OX, y: D_BOT.y - DH };
  const D_LEFT = { x: OX - S / 2, y: D_BOT.y - DH / 2 };
  const D_RIGHT = { x: OX + S / 2, y: D_BOT.y - DH / 2 };

  function tri(v0, v1, v2) { ctx.beginPath(); ctx.moveTo(v0.x, v0.y); ctx.lineTo(v1.x, v1.y); ctx.lineTo(v2.x, v2.y); ctx.closePath(); }
  function rhombus() { ctx.beginPath(); ctx.moveTo(D_BOT.x, D_BOT.y); ctx.lineTo(D_RIGHT.x, D_RIGHT.y); ctx.lineTo(D_TOP.x, D_TOP.y); ctx.lineTo(D_LEFT.x, D_LEFT.y); ctx.closePath(); }
  function gridLines(v0, v1, v2, steps) {
    ctx.save(); ctx.strokeStyle = COL_LINE; ctx.lineWidth = 0.8;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      ctx.beginPath(); ctx.moveTo(v0.x * (1 - t) + v1.x * t, v0.y * (1 - t) + v1.y * t); ctx.lineTo(v0.x * (1 - t) + v2.x * t, v0.y * (1 - t) + v2.y * t); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(v1.x * (1 - t) + v0.x * t, v1.y * (1 - t) + v0.y * t); ctx.lineTo(v1.x * (1 - t) + v2.x * t, v1.y * (1 - t) + v2.y * t); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(v2.x * (1 - t) + v0.x * t, v2.y * (1 - t) + v0.y * t); ctx.lineTo(v2.x * (1 - t) + v1.x * t, v2.y * (1 - t) + v1.y * t); ctx.stroke();
    }
    ctx.restore();
  }

  ctx.fillStyle = COL_FILL; ctx.strokeStyle = COL_AXIS; ctx.lineWidth = 1.2;
  tri(LBL, LBR, LBT); ctx.fill(); ctx.stroke();
  tri(RBL, RBR, RBT); ctx.fill(); ctx.stroke();
  rhombus(); ctx.fill(); ctx.stroke();
  gridLines(LBL, LBR, LBT, 5);
  gridLines(RBL, RBR, RBT, 5);

  ctx.save(); ctx.strokeStyle = COL_LINE; ctx.lineWidth = 0.8;
  for (let gi = 1; gi < 5; gi++) {
    const gt = gi / 5;
    const p1 = { x: D_BOT.x + gt * (D_RIGHT.x - D_BOT.x), y: D_BOT.y + gt * (D_RIGHT.y - D_BOT.y) };
    const p2 = { x: p1.x + (D_LEFT.x - D_BOT.x), y: p1.y + (D_LEFT.y - D_BOT.y) };
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    const q1 = { x: D_BOT.x + gt * (D_LEFT.x - D_BOT.x), y: D_BOT.y + gt * (D_LEFT.y - D_BOT.y) };
    const q2 = { x: q1.x + (D_RIGHT.x - D_BOT.x), y: q1.y + (D_RIGHT.y - D_BOT.y) };
    ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
  }
  ctx.restore();

  function drawAxisTicks(vFrom, vTo, vOpp, label) {
    const n = outwardNormal(vFrom, vTo, vOpp);
    let angle = Math.atan2(vTo.y - vFrom.y, vTo.x - vFrom.x);
    if (angle > Math.PI / 2) angle -= Math.PI;
    if (angle < -Math.PI / 2) angle += Math.PI;
    ctx.save(); ctx.fillStyle = COL_TXT;
    for (let pct = 20; pct <= 80; pct += 20) {
      const t = pct / 100;
      const px = vFrom.x + (vTo.x - vFrom.x) * t, py = vFrom.y + (vTo.y - vFrom.y) * t;
      ctx.save(); ctx.translate(px + n.x * 9, py + n.y * 9); ctx.rotate(angle);
      ctx.font = '7px Inter,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(pct + '%', 0, 0); ctx.restore();
    }
    const mid = { x: (vFrom.x + vTo.x) / 2, y: (vFrom.y + vTo.y) / 2 };
    ctx.save(); ctx.translate(mid.x + n.x * 22, mid.y + n.y * 22); ctx.rotate(angle);
    ctx.font = 'bold 10px Inter,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0); ctx.restore();
    ctx.restore();
  }
  drawAxisTicks(LBL, LBT, LBR, 'Mg'); drawAxisTicks(LBR, LBL, LBT, 'Ca'); drawAxisTicks(LBT, LBR, LBL, 'Na+K');
  drawAxisTicks(RBL, RBT, RBR, 'SO₄'); drawAxisTicks(RBR, RBL, RBT, 'HCO₃+CO₃'); drawAxisTicks(RBT, RBR, RBL, 'Cl');
  drawAxisTicks(D_BOT, D_RIGHT, D_LEFT, 'Na+K'); drawAxisTicks(D_BOT, D_LEFT, D_RIGHT, 'SO₄+Cl');

  function bary(v0, v1, v2, b0, b1, b2) { const s = b0 + b1 + b2 || 1; return { x: (v0.x * b0 + v1.x * b1 + v2.x * b2) / s, y: (v0.y * b0 + v1.y * b1 + v2.y * b2) / s }; }
  function diamondPt(m) {
    const u = m._catSum > 0 ? m.nak / m._catSum : 0;
    const v = m._anSum > 0 ? (m.so4 + m.cl) / m._anSum : 0;
    return { x: D_BOT.x + u * (D_RIGHT.x - D_BOT.x) + v * (D_LEFT.x - D_BOT.x), y: D_BOT.y + u * (D_RIGHT.y - D_BOT.y) + v * (D_LEFT.y - D_BOT.y) };
  }

  if (canvas._piperSelectedId === undefined || !allMeqs.some((a) => a.id === canvas._piperSelectedId)) canvas._piperSelectedId = currentId;
  const selectedId = canvas._piperSelectedId;
  const hitPoints = [];

  // Легенда дат — активная (выбранная) проба выделена жирным и обведена, чтобы клик по точке
  // диаграммы был явно виден как переключение, а не терялся среди остальных дат.
  let legX = W - 8, legY = 10;
  ctx.save();
  ctx.font = 'bold 9.5px Inter,sans-serif'; ctx.fillStyle = COL_TXT; ctx.textAlign = 'right';
  ctx.fillText('Дата пробы', legX, legY);
  legY += 14;
  allMeqs.forEach((item, idx) => {
    const col = CHEM_DATE_COLORS[idx % CHEM_DATE_COLORS.length];
    const isSel = item.id === selectedId;
    ctx.font = isSel ? 'bold 9px Inter,sans-serif' : '9px Inter,sans-serif';
    ctx.fillStyle = isSel ? col : COL_TXT; ctx.textAlign = 'right';
    ctx.fillText(item.date ? fmtDate(item.date) : '—', legX - 10, legY);
    ctx.beginPath(); ctx.arc(legX - 3, legY - 3, isSel ? 4.5 : 3.5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill();
    if (isSel) { ctx.lineWidth = 1.3; ctx.strokeStyle = COL_TXT; ctx.stroke(); }
    legY += 13;
  });
  ctx.restore();

  allMeqs.forEach((item, idx) => {
    const m = item.meq;
    const col = CHEM_DATE_COLORS[idx % CHEM_DATE_COLORS.length];
    const isSel = item.id === selectedId;
    const r = isSel ? 6.5 : 4.5;
    const cp = bary(LBL, LBT, LBR, m.ca, m.mg, m.nak);
    const ap = bary(RBL, RBT, RBR, m.hco3, m.so4, m.cl);
    const dp = diamondPt(m);
    [cp, ap, dp].forEach((pt) => {
      ctx.save();
      ctx.globalAlpha = isSel ? 1 : 0.32;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fillStyle = col;
      if (isSel) { ctx.shadowColor = col; ctx.shadowBlur = 9; }
      ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
      hitPoints.push({ x: pt.x, y: pt.y, id: item.id });
    });
  });

  const selIdx = allMeqs.findIndex((a) => a.id === selectedId);
  const sel = selIdx !== -1 ? allMeqs[selIdx] : null;
  if (sel) {
    const m = sel.meq;
    const selColor = CHEM_DATE_COLORS[selIdx % CHEM_DATE_COLORS.length];
    const cp = bary(LBL, LBT, LBR, m.ca, m.mg, m.nak);
    const ap = bary(RBL, RBT, RBR, m.hco3, m.so4, m.cl);
    const dp = diamondPt(m);

    function axisValue(pt, vFrom, vTo, vOpp, otherDir, pctVal) {
      const hit = lineIntersect(pt, otherDir, vFrom, { x: vTo.x - vFrom.x, y: vTo.y - vFrom.y });
      if (!hit) return;
      ctx.save(); ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.strokeStyle = selColor;
      ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(hit.x, hit.y); ctx.stroke(); ctx.restore();
      const n = outwardNormal(vFrom, vTo, vOpp);
      const lx = hit.x + n.x * 34, ly = hit.y + n.y * 34;
      ctx.save(); ctx.font = 'bold 9px Inter,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = HALO; ctx.strokeText(pctVal.toFixed(1) + '%', lx, ly);
      ctx.fillStyle = selColor; ctx.fillText(pctVal.toFixed(1) + '%', lx, ly); ctx.restore();
    }
    axisValue(cp, LBL, LBT, LBR, { x: LBR.x - LBL.x, y: LBR.y - LBL.y }, m.mg_pct || 0);
    axisValue(cp, LBR, LBL, LBT, { x: LBR.x - LBT.x, y: LBR.y - LBT.y }, m.ca_pct || 0);
    axisValue(cp, LBT, LBR, LBL, { x: LBT.x - LBL.x, y: LBT.y - LBL.y }, m.nak_pct || 0);
    const hco3Total = (m.hco3_pct || 0) + (m.co3_pct || 0);
    axisValue(ap, RBL, RBT, RBR, { x: RBR.x - RBL.x, y: RBR.y - RBL.y }, m.so4_pct || 0);
    axisValue(ap, RBR, RBL, RBT, { x: RBT.x - RBR.x, y: RBT.y - RBR.y }, hco3Total);
    axisValue(ap, RBT, RBR, RBL, { x: RBL.x - RBT.x, y: RBL.y - RBT.y }, m.cl_pct || 0);
    const so4ClTotal = (m.so4_pct || 0) + (m.cl_pct || 0);
    axisValue(dp, D_BOT, D_RIGHT, D_LEFT, { x: D_LEFT.x - D_BOT.x, y: D_LEFT.y - D_BOT.y }, m.nak_pct || 0);
    axisValue(dp, D_BOT, D_LEFT, D_RIGHT, { x: D_RIGHT.x - D_BOT.x, y: D_RIGHT.y - D_BOT.y }, so4ClTotal);
  }

  canvas.style.cursor = 'pointer';
  canvas.onclick = (e) => {
    const mx = e.offsetX, my = e.offsetY;
    let best = null, bestD2 = 14 * 14;
    hitPoints.forEach((hp) => { const dx = mx - hp.x, dy = my - hp.y, d2 = dx * dx + dy * dy; if (d2 < bestD2) { bestD2 = d2; best = hp; } });
    if (best) {
      canvas._piperSelectedId = best.id;
      drawPiper(canvas, allMeqs, currentId, cssW, onSelect);
      if (onSelect) onSelect(best.id);
    }
  };
}

// ── Квадрат Толстихина ─────────────────────────────────────────────────────
export function drawTolstikhin(canvas, allMeqs, currentId, cssW, onSelect) {
  const W = cssW || 560;
  const dark = isDarkTheme();
  const COL_LINE = dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)';
  const COL_LINE2 = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  const COL_TXT = dark ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.62)';
  const COL_AXIS = dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
  const HALO = dark ? 'rgba(13,17,26,0.85)' : 'rgba(255,255,255,0.85)';

  const MARGIN_X = 60, MARGIN_TOP = 34, MARGIN_BOT = 46;
  const SIZE = Math.max(220, Math.min(420, W - MARGIN_X * 2));
  const H = MARGIN_TOP + SIZE + MARGIN_BOT;
  const ctx = prepCanvas(canvas, W, H);
  ctx.clearRect(0, 0, W, H);
  const OX = Math.round((W - SIZE) / 2), OY = MARGIN_TOP;

  ctx.strokeStyle = COL_AXIS; ctx.lineWidth = 1.4;
  ctx.strokeRect(OX, OY, SIZE, SIZE);
  ctx.strokeStyle = COL_LINE2; ctx.lineWidth = 0.7;
  for (let i = 1; i < 10; i++) {
    const gx = OX + SIZE * i / 10, gy = OY + SIZE * i / 10;
    ctx.beginPath(); ctx.moveTo(gx, OY); ctx.lineTo(gx, OY + SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(OX, gy); ctx.lineTo(OX + SIZE, gy); ctx.stroke();
  }
  ctx.strokeStyle = COL_LINE; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(OX + SIZE / 2, OY); ctx.lineTo(OX + SIZE / 2, OY + SIZE); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(OX, OY + SIZE / 2); ctx.lineTo(OX + SIZE, OY + SIZE / 2); ctx.stroke();

  ctx.font = '7px Inter,sans-serif'; ctx.fillStyle = COL_TXT;
  for (let pct = 10; pct <= 90; pct += 10) {
    const tx = OX + SIZE * pct / 100;
    ctx.textAlign = 'center'; ctx.fillText(pct, tx, OY + SIZE + 12);
    const ty = OY + SIZE - SIZE * pct / 100;
    ctx.textAlign = 'right'; ctx.fillText(pct, OX - 6, ty + 3);
  }

  ctx.font = 'bold 10px Inter,sans-serif'; ctx.fillStyle = COL_TXT; ctx.textAlign = 'center';
  ctx.fillText('Ca²⁺+Mg²⁺ 100%', OX + SIZE / 2, OY - 18);
  ctx.fillText('Na⁺+K⁺ 100%', OX + SIZE / 2, OY + SIZE + 30);
  ctx.save(); ctx.translate(OX - 42, OY + SIZE / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('HCO₃⁻+CO₃²⁻ 100%', 0, 0); ctx.restore();
  ctx.save(); ctx.translate(OX + SIZE + 42, OY + SIZE / 2); ctx.rotate(-Math.PI / 2); ctx.fillText('Cl⁻+SO₄²⁻ 100%', 0, 0); ctx.restore();

  function coords(m) {
    const x = (m.so4_pct || 0) + (m.cl_pct || 0);
    const y = (m.ca_pct || 0) + (m.mg_pct || 0);
    return { px: OX + SIZE * x / 100, py: OY + SIZE - SIZE * y / 100, x, y };
  }

  if (canvas._tolstSelectedId === undefined || !allMeqs.some((a) => a.id === canvas._tolstSelectedId)) canvas._tolstSelectedId = currentId;
  const selectedId = canvas._tolstSelectedId;
  const hitPoints = [];

  allMeqs.forEach((item, idx) => {
    const col = CHEM_DATE_COLORS[idx % CHEM_DATE_COLORS.length];
    const isSel = item.id === selectedId;
    const r = isSel ? 6.5 : 4.5;
    const pt = coords(item.meq);
    ctx.save();
    ctx.globalAlpha = isSel ? 1 : 0.32;
    ctx.beginPath(); ctx.arc(pt.px, pt.py, r, 0, Math.PI * 2);
    ctx.fillStyle = col;
    if (isSel) { ctx.shadowColor = col; ctx.shadowBlur = 9; }
    ctx.fill(); ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    hitPoints.push({ x: pt.px, y: pt.py, id: item.id });
  });

  const sel = allMeqs.find((a) => a.id === selectedId);
  if (sel) {
    const spt = coords(sel.meq);
    const selIdx = allMeqs.indexOf(sel);
    const selColor = CHEM_DATE_COLORS[selIdx % CHEM_DATE_COLORS.length];
    ctx.save(); ctx.setLineDash([4, 3]); ctx.lineWidth = 0.9; ctx.strokeStyle = selColor;
    ctx.beginPath(); ctx.moveTo(OX, spt.py); ctx.lineTo(OX + SIZE, spt.py); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(spt.px, OY); ctx.lineTo(spt.px, OY + SIZE); ctx.stroke();
    ctx.restore();
    const label = spt.x.toFixed(0) + '% / ' + spt.y.toFixed(0) + '%';
    ctx.save(); ctx.font = 'bold 9px Inter,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const lx = Math.min(spt.px + 10, OX + SIZE - 4), ly = spt.py - 10;
    ctx.lineWidth = 3; ctx.strokeStyle = HALO; ctx.strokeText(label, lx, ly);
    ctx.fillStyle = selColor; ctx.fillText(label, lx, ly); ctx.restore();
  }

  canvas.style.cursor = 'pointer';
  canvas.onclick = (e) => {
    const mx = e.offsetX, my = e.offsetY;
    let best = null, bestD2 = 14 * 14;
    hitPoints.forEach((hp) => { const dx = mx - hp.x, dy = my - hp.y, d2 = dx * dx + dy * dy; if (d2 < bestD2) { bestD2 = d2; best = hp; } });
    if (best) {
      canvas._tolstSelectedId = best.id;
      drawTolstikhin(canvas, allMeqs, currentId, cssW, onSelect);
      if (onSelect) onSelect(best.id);
    }
  };
}

// Текст под квадратом Толстихина — позиционный номер ячейки сетки 10×10 + проценты.
export function tolstCellInfoHtml(sel) {
  if (!sel) return '—';
  const m = sel.meq;
  const x = (m.so4_pct || 0) + (m.cl_pct || 0);
  const y = (m.ca_pct || 0) + (m.mg_pct || 0);
  const col = Math.min(10, Math.max(1, Math.ceil(x / 10) || 1));
  const row = Math.min(10, Math.max(1, Math.ceil(y / 10) || 1));
  return `Ячейка ${col}-${row} <span style="font-weight:400;color:var(--text-tertiary)">· Ca+Mg ${y.toFixed(0)}% · Cl+SO₄ ${x.toFixed(0)}%${sel.date ? ' · ' + fmtDate(sel.date) : ''}</span>`;
}

// ── Диаграмма Стиффа ───────────────────────────────────────────────────────
export function drawStiff(canvas, meq, cssW, cssH) {
  const W = cssW || 500, H = cssH || 220;
  const ctx = prepCanvas(canvas, W, H);
  ctx.clearRect(0, 0, W, H);
  const dark = isDarkTheme();
  const COL_TXT = dark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.65)';
  const COL_GRID = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  const GOLD = '#22d3ee';

  const rows = [
    { left: meq.ca, right: meq.hco3, catLbl: 'Ca²⁺', anLbl: 'HCO₃⁻' },
    { left: meq.mg, right: meq.so4, catLbl: 'Mg²⁺', anLbl: 'SO₄²⁻' },
    { left: meq.nak, right: meq.cl, catLbl: 'Na⁺+K⁺', anLbl: 'Cl⁻' },
  ];
  let maxVal = 0;
  rows.forEach((r) => { maxVal = Math.max(maxVal, r.left, r.right); });
  if (maxVal <= 0) return;

  const lblW = 56, padT = 14, padB = 28;
  const cx = W / 2;
  const areaW = cx - lblW - 38 - 4;
  const scale = areaW / (maxVal * 1.05);
  const rowH = (H - padT - padB) / rows.length;

  const nTicks = 4;
  for (let ti = 1; ti <= nTicks; ti++) {
    const tv = ti / nTicks * maxVal;
    const gxR = cx + tv * scale, gxL = cx - tv * scale;
    ctx.strokeStyle = COL_GRID; ctx.lineWidth = 0.6;
    [gxR, gxL].forEach((gx) => { ctx.beginPath(); ctx.moveTo(gx, padT); ctx.lineTo(gx, H - padB); ctx.stroke(); });
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
    ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(tv.toFixed(tv < 1 ? 1 : 0), gxR, H - padB + 11);
    ctx.fillText(tv.toFixed(tv < 1 ? 1 : 0), gxL, H - padB + 11);
  }

  ctx.strokeStyle = dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(cx, padT - 4); ctx.lineTo(cx, H - padB); ctx.stroke();

  rows.forEach((_, i) => {
    if (i === 0) return;
    const y = padT + rowH * i;
    ctx.strokeStyle = COL_GRID; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(lblW, y); ctx.lineTo(W - lblW, y); ctx.stroke();
  });

  const pts = [];
  rows.forEach((r, i) => { const y = padT + rowH * (i + 0.5); pts.push({ x: cx - r.left * scale, y }); });
  rows.slice().reverse().forEach((r, i) => { const j = rows.length - 1 - i; const y = padT + rowH * (j + 0.5); pts.push({ x: cx + r.right * scale, y }); });
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach((p) => ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fillStyle = GOLD + '28'; ctx.fill();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.stroke();

  ctx.font = '10px Inter,sans-serif';
  rows.forEach((r, i) => {
    const y = padT + rowH * (i + 0.5);
    const xL = cx - r.left * scale, xR = cx + r.right * scale;
    [xL, xR].forEach((x) => { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fillStyle = GOLD; ctx.fill(); });
    ctx.fillStyle = COL_TXT;
    ctx.textAlign = 'right'; ctx.fillText(r.left.toFixed(2), xL - 6, y + 4);
    ctx.textAlign = 'left'; ctx.fillText(r.right.toFixed(2), xR + 6, y + 4);
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
    ctx.textAlign = 'right'; ctx.fillText(r.catLbl, cx - areaW - 8, y + 4);
    ctx.textAlign = 'left'; ctx.fillText(r.anLbl, cx + areaW + 8, y + 4);
  });

  ctx.fillStyle = dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
  ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('мг-экв/л', cx, H - 4);

  ctx.fillStyle = dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
  ctx.font = '10px Inter,sans-serif';
  ctx.textAlign = 'left'; ctx.fillText('Катионы', 4, padT + 10);
  ctx.textAlign = 'right'; ctx.fillText('Анионы', W - 4, padT + 10);
}

// ── График Шёллера ─────────────────────────────────────────────────────────
export function drawSchoeller(canvas, allMeqs, currentId, cssW, cssH) {
  const W = cssW || 560, H = cssH || 280;
  const ctx = prepCanvas(canvas, W, H);
  ctx.clearRect(0, 0, W, H);
  const dark = isDarkTheme();
  const COL_TXT = dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
  const COL_GRID = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  const ions = ['ca', 'mg', 'nak', 'hco3', 'so4', 'cl'];
  const ionLbl = ['Ca²⁺', 'Mg²⁺', 'Na⁺+K⁺', 'HCO₃⁻', 'SO₄²⁻', 'Cl⁻'];
  const padL = 42, padR = 12, padT = 12, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const logMin = Math.log10(0.05), logMax = Math.log10(30);
  function yOf(v) { if (!v || v <= 0) v = 0.05; return padT + plotH * (1 - (Math.log10(v) - logMin) / (logMax - logMin)); }
  function xOf(i) { return padL + (i / (ions.length - 1)) * plotW; }

  [0.1, 0.2, 0.5, 1, 2, 5, 10, 20].forEach((v) => {
    const y = yOf(v);
    ctx.strokeStyle = COL_GRID; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillStyle = COL_TXT; ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(v < 1 ? v.toFixed(1) : v, padL - 3, y + 3);
  });

  ctx.fillStyle = COL_TXT; ctx.font = '10px Inter,sans-serif'; ctx.textAlign = 'center';
  ionLbl.forEach((l, i) => ctx.fillText(l, xOf(i), H - 6));

  allMeqs.forEach((item, idx) => {
    const m = item.meq;
    const isCurrent = item.id === currentId;
    const col = CHEM_DATE_COLORS[idx % CHEM_DATE_COLORS.length];
    ctx.beginPath();
    ions.forEach((k, i) => { const y = yOf(m[k] || 0.05); if (i === 0) ctx.moveTo(xOf(i), y); else ctx.lineTo(xOf(i), y); });
    ctx.strokeStyle = col;
    ctx.lineWidth = isCurrent ? 2 : 1.2;
    ctx.setLineDash(isCurrent ? [] : [4, 3]);
    ctx.stroke(); ctx.setLineDash([]);
    if (isCurrent) {
      ions.forEach((k, i) => { const y = yOf(m[k] || 0.05); ctx.beginPath(); ctx.arc(xOf(i), y, 3.5, 0, Math.PI * 2); ctx.fillStyle = col; ctx.fill(); });
    }
  });

  ctx.save(); ctx.translate(10, padT + plotH / 2); ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = COL_TXT; ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('мг-экв/л (log)', 0, 0); ctx.restore();
}
