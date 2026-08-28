import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet, RotateCcw, TrendingDown, AlertTriangle, CheckCircle2, Hammer } from 'lucide-react';
import { html } from '../lib/html.js';
import { supabase } from '../lib/supabase.js';
import { fetchAllRows } from '../lib/db-utils.js';
import {
  formatMonitoringDate, shortMonitoringDate, lpsToM3h, smoothPath, sparkPoints,
  exportPointsCsv, exportPointsXlsx,
} from '../lib/analytics-core.js';
import { Card, CardHeader, CardTitle, CardContent, Skeleton, Badge, Button, Select, Tabs, EmptyState } from '../components/ui.js';

const STATUS_ORDER = ['Активная', 'Иссякает', 'Новая', 'Пересохла'];
const STATUS_COLORS = {
  'Активная':  'var(--green-500)',
  'Иссякает':  'var(--amber-500)',
  'Новая':     'var(--blue-500)',
  'Пересохла': 'var(--red-500)',
};

function sumQ(pts) {
  return pts.reduce((s, p) => { const f = parseFloat(p.flow_rate); return (!Number.isNaN(f) && f > 0) ? s + f : s; }, 0);
}

// Замеры скважины, относящиеся к обходу `date` — окно (пред. обход, date].
function wellMeasurementsInRound(measArr, date, dates) {
  if (!measArr || !date) return [];
  const idx = dates.indexOf(date);
  const prevDate = (idx >= 0 && idx < dates.length - 1) ? dates[idx + 1] : '';
  return measArr.filter((m) => { const d = (m.measurement_date || '').slice(0, 10); return d <= date && (prevDate === '' || d > prevDate); });
}

// ═════════════════════════ Загрузка данных ═════════════════════════

function useAnalyticsData(quarry) {
  const [points, setPoints] = useState(null);
  const [wells, setWells] = useState([]);
  const [measByWell, setMeasByWell] = useState({});
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    setError(null);
    (async () => {
      try {
        const pts = await fetchAllRows('points', { filter: (q) => q.eq('quarry', quarry) });
        if (cancelled) return;
        setPoints(pts);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
      try {
        const wellRows = await fetchAllRows('wells', { order: 'name', filter: (q) => q.eq('quarry', quarry) });
        if (cancelled) return;
        setWells(wellRows);
        if (wellRows.length) {
          const meas = await fetchAllRows('well_measurements', { order: 'measurement_date' });
          if (cancelled) return;
          const byWell = {};
          meas.forEach((m) => { (byWell[m.well_id] = byWell[m.well_id] || []).push(m); });
          setMeasByWell(byWell);
        } else {
          setMeasByWell({});
        }
      } catch {
        setWells([]);
        setMeasByWell({});
      }
    })();
    return () => { cancelled = true; };
  }, [quarry]);

  return { points, wells, measByWell, error };
}

// ═════════════════════════ Мелкие визуальные блоки ═════════════════════════

function KpiSpark({ values, color }) {
  const pts = sparkPoints(values, 100, 30);
  if (!pts.length) return null;
  const line = smoothPath(pts);
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},30 L0,30 Z`;
  return html`
    <svg class="anl-kpi-spark" viewBox="0 0 100 30" preserveAspectRatio="none">
      <path d=${area} fill=${color} opacity="0.12" stroke="none" />
      <path d=${line} fill="none" stroke=${color} stroke-width="1.8" />
    </svg>
  `;
}

function AnlKpiCard({ label, value, unit, sub, trend, values, color }) {
  return html`
    <div class="card anl-kpi">
      <div class="anl-kpi-lbl">${label}</div>
      <div class="anl-kpi-val" style=${{ color }}>${value}${unit && html`<small>${unit}</small>`}</div>
      <div class="anl-kpi-sub">${sub}</div>
      <div class="anl-kpi-trend">${trend}</div>
      <${KpiSpark} values=${values} color=${color} />
    </div>
  `;
}

function TrendLabel({ diff, goodWhen }) {
  if (diff == null) return html`<span class="anl-trend-eq">→<//>`;
  if (Math.abs(diff) <= 5) return html`<span class="anl-trend-eq">→ стабильно<//>`;
  const isUp = diff > 0;
  const isGood = (goodWhen === 'up' && isUp) || (goodWhen === 'down' && !isUp);
  return html`<span class=${'anl-trend-' + (isGood ? 'good' : 'bad')}>${isUp ? '↑ +' : '↓ '}${Math.abs(diff).toFixed(0)}%<//>`;
}

function TrendChart({ periods, roundDate, compareDate }) {
  const [hover, setHover] = useState(null);
  if (!periods.length) return html`<div class="anl-empty">Нет данных</div>`;

  const W = 680, H = 190, PL = 44, PR = 12, PT = 14, PB = 28;
  const cW = W - PL - PR, cH = H - PT - PB;
  const n = periods.length;
  const maxQ = (Math.max(...periods.map((p) => p.totalQ)) || 1) * 1.2;
  const px = (i) => PL + (i / Math.max(n - 1, 1)) * cW;
  const py = (q) => PT + (1 - q / maxQ) * cH;
  const ySteps = [0, maxQ / 3, (2 * maxQ) / 3, maxQ];
  const linePts = periods.map((p, i) => ({ x: px(i), y: py(p.totalQ) }));
  const smooth = smoothPath(linePts);
  const areaPath = `${smooth} L${px(n - 1).toFixed(1)},${(PT + cH).toFixed(1)} L${PL},${(PT + cH).toFixed(1)} Z`;
  const step = Math.max(1, Math.ceil(n / 7));
  const hitW = cW / Math.max(n - 1, 1);

  const hoveredP = hover != null ? periods[hover] : null;
  const prevHoveredP = hover != null && hover > 0 ? periods[hover - 1] : null;
  const delta = hoveredP && prevHoveredP ? hoveredP.totalQ - prevHoveredP.totalQ : null;
  const tipLeftPct = hover != null ? ((px(hover) > W * 0.6 ? px(hover) - 165 : px(hover) + 8) / W) * 100 : 0;
  const tipTopPct = hoveredP ? (Math.max(0, py(hoveredP.totalQ) - 54) / H) * 100 : 0;

  return html`
    <div>
      <div class="anl-trend-legend">
        <span><span class="anl-legend-swatch" style=${{ background: 'var(--gold-500)' }} />текущий обход</span>
        ${compareDate && html`<span style=${{ color: 'var(--blue-600)' }}><span class="anl-legend-swatch" style=${{ background: 'var(--blue-500)' }} />сравниваемый</span>`}
        <span class="anl-trend-legend-right">Последние ${n} обходов</span>
      </div>
      <div style=${{ position: 'relative' }}>
        <svg viewBox=${`0 0 ${W} ${H}`} style=${{ width: '100%', display: 'block' }}>
          <defs>
            <linearGradient id="anlTrendGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--gold-400)" stop-opacity="0.28" />
              <stop offset="100%" stop-color="var(--gold-400)" stop-opacity="0" />
            </linearGradient>
          </defs>
          ${ySteps.map((q) => html`
            <g key=${q}>
              <line x1=${PL} y1=${py(q).toFixed(1)} x2=${W - PR} y2=${py(q).toFixed(1)} stroke="var(--border-subtle)" stroke-width="1" />
              <text x=${PL - 6} y=${(py(q) + 3).toFixed(1)} fill="var(--text-tertiary)" font-size="9" text-anchor="end">${q.toFixed(1)}</text>
            </g>
          `)}
          <path d=${areaPath} fill="url(#anlTrendGrad)" />
          <path d=${smooth} fill="none" stroke="var(--gold-500)" stroke-width="2" />
          ${hover != null && html`<line x1=${px(hover).toFixed(1)} y1=${PT} x2=${px(hover).toFixed(1)} y2=${PT + cH} stroke="var(--stone-400)" stroke-width="1" stroke-dasharray="3,3" />`}
          ${periods.map((p, i) => {
            const isCur = p.date === roundDate, isCmp = p.date === compareDate;
            const cx = px(i).toFixed(1), cy = py(p.totalQ).toFixed(1);
            const fill = isCmp ? 'var(--blue-500)' : 'var(--gold-500)';
            return html`
              <g key=${'dot-' + p.date}>
                ${isCur && html`<circle cx=${cx} cy=${cy} r="7" fill="none" stroke="var(--gold-500)" stroke-width="1.5" opacity="0.4" />`}
                <circle cx=${cx} cy=${cy} r=${isCur ? 4.5 : 2.5} fill=${fill} stroke=${isCur ? '#fff' : 'none'} stroke-width=${isCur ? 1.5 : 0} />
              </g>
            `;
          })}
          ${periods.map((p, i) => (i % step === 0 || i === n - 1) ? html`
            <text key=${'lbl-' + p.date} x=${px(i).toFixed(1)} y=${H - 6} fill=${p.date === roundDate ? 'var(--gold-600)' : 'var(--text-tertiary)'} font-size="9" text-anchor="middle" font-weight=${p.date === roundDate ? 700 : 400}>${shortMonitoringDate(p.date)}</text>
          ` : null)}
          ${periods.map((p, i) => html`
            <rect key=${'hit-' + p.date} x=${(px(i) - hitW / 2).toFixed(1)} y=${PT} width=${hitW.toFixed(1)} height=${cH} fill="transparent" style=${{ cursor: 'crosshair' }}
              onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)} />
          `)}
        </svg>
        ${hoveredP && html`
          <div class="anl-trend-tip" style=${{ left: tipLeftPct + '%', top: tipTopPct + '%' }}>
            <div class="anl-trend-tip-date">${formatMonitoringDate(hoveredP.date)}</div>
            <div class="anl-trend-tip-val">${hoveredP.totalQ.toFixed(2)} <small>л/с</small></div>
            <div class="anl-trend-tip-sub">${lpsToM3h(hoveredP.totalQ).toFixed(2)} м³/ч · ${hoveredP.count} т.</div>
            ${delta != null && Math.abs(delta) > 0.001 && html`
              <div class=${'anl-trend-tip-delta ' + (delta >= 0 ? 'up' : 'down')}>${delta >= 0 ? '▲ +' : '▼ '}${Math.abs(delta).toFixed(2)} л/с к пред. обходу</div>
            `}
          </div>
        `}
      </div>
    </div>
  `;
}

function StatusBarsChart({ periods, roundDate }) {
  if (!periods.length) return html`<div class="anl-empty">Нет данных</div>`;
  const maxTotal = Math.max(...periods.map((p) => p.count)) || 1;
  const W = 420, H = 170, PL = 6, PB = 22, PT = 20, PR = 6;
  const cW = W - PL - PR, cH = H - PT - PB;
  const gap = cW / periods.length, barW = Math.max(10, Math.floor(gap * 0.68));

  return html`
    <div>
      <svg viewBox=${`0 0 ${W} ${H}`} style=${{ width: '100%', display: 'block' }}>
        <line x1=${PL} y1=${PT + cH} x2=${W - PR} y2=${PT + cH} stroke="var(--border)" stroke-width="1" />
        ${periods.map((p) => {
          const x = PL + periods.indexOf(p) * gap + (gap - barW) / 2;
          const isCur = p.date === roundDate;
          let yOff = PT + cH;
          const segs = STATUS_ORDER.map((s) => {
            const cnt = p.byStatus[s] || 0;
            if (!cnt) return null;
            const bH = (cnt / maxTotal) * cH;
            yOff -= bH;
            return html`<rect key=${s} x=${x.toFixed(1)} y=${yOff.toFixed(1)} width=${barW} height=${bH.toFixed(1)} fill=${STATUS_COLORS[s] || 'var(--stone-400)'} opacity=${isCur ? 1 : 0.72} rx="1"><title>${formatMonitoringDate(p.date)} · ${s}: ${cnt}</title></rect>`;
          });
          return html`
            <g key=${p.date}>
              ${segs}
              ${p.count > 0 && html`<text x=${(x + barW / 2).toFixed(1)} y=${(yOff - 4).toFixed(1)} fill=${isCur ? 'var(--gold-600)' : 'var(--text-tertiary)'} font-size="8" text-anchor="middle" font-weight=${isCur ? 700 : 400}>${p.count}</text>`}
              <text x=${(x + barW / 2).toFixed(1)} y=${H - 6} fill=${isCur ? 'var(--gold-600)' : 'var(--text-tertiary)'} font-size="8" text-anchor="middle">${shortMonitoringDate(p.date)}</text>
            </g>
          `;
        })}
      </svg>
      <div class="anl-status-legend">
        ${STATUS_ORDER.map((s) => html`<span key=${s}><span class="anl-legend-swatch" style=${{ background: STATUS_COLORS[s] }} />${s}</span>`)}
      </div>
    </div>
  `;
}

function CoverageHeatmap({ periods, currentPts, roundDate }) {
  const maxCount = Math.max(...periods.map((p) => p.count)) || 1;
  const wcnt = {};
  currentPts.forEach((p) => { const w = p.worker || '—'; wcnt[w] = (wcnt[w] || 0) + 1; });
  const topW = Object.keys(wcnt).sort((a, b) => wcnt[b] - wcnt[a]).slice(0, 3);
  const maxW = topW.length ? wcnt[topW[0]] : 1;
  const missed = periods.filter((p) => p.count === 0).length;
  const avg = periods.length ? Math.round(periods.reduce((s, p) => s + p.count, 0) / periods.length) : 0;

  return html`
    <div>
      <div class="anl-coverage-hint">Интенсивность замеров (темнее = больше)</div>
      <div class="anl-coverage-grid">
        ${periods.map((p) => {
          const alpha = Math.max(0.08, p.count / maxCount);
          const isCur = p.date === roundDate;
          return html`<div key=${p.date} title=${`${formatMonitoringDate(p.date)}: ${p.count} замеров`} class=${'anl-coverage-cell' + (isCur ? ' current' : '')} style=${{ background: `rgba(47,143,82,${alpha.toFixed(2)})` }}></div>`;
        })}
      </div>
      <div class="anl-coverage-legend">
        <span>Меньше</span>
        <span class="anl-coverage-sw" style=${{ background: 'rgba(47,143,82,.08)' }}></span>
        <span class="anl-coverage-sw" style=${{ background: 'rgba(47,143,82,.35)' }}></span>
        <span class="anl-coverage-sw" style=${{ background: 'rgba(47,143,82,.7)' }}></span>
        <span class="anl-coverage-sw" style=${{ background: 'rgba(47,143,82,1)' }}></span>
        <span>Больше</span>
        ${missed > 0 && html`<span class="anl-coverage-missed">⚠ ${missed} пропуск(а)</span>`}
      </div>
      <div class="anl-coverage-workers-title">По сотруднику (тек. обход)</div>
      ${topW.length ? topW.map((w) => html`
        <div key=${w} class="anl-pb-row">
          <span class="anl-pb-lbl">${(w + '').split(' ')[0]}</span>
          <div class="anl-pb-trk"><div class="anl-pb-fill" style=${{ width: Math.round((wcnt[w] / maxW) * 100) + '%' }}></div></div>
          <span class="anl-pb-count">${wcnt[w]}</span>
        </div>
      `) : html`<div class="anl-empty" style=${{ padding: '8px 0' }}>Нет замеров в текущем обходе</div>`}
      <div class="anl-coverage-avg">Среднее: ${avg} замеров/обход</div>
    </div>
  `;
}

function AlertsPanel({ alerts }) {
  return html`
    <div class="anl-alerts">
      ${alerts.map((a, i) => html`
        <div key=${i} class=${'anl-alert anl-alert-' + a.level}>
          <${a.icon} size=${16} />
          <div>
            <div class="anl-alert-title">${a.title}</div>
            <div class="anl-alert-desc">${a.desc}</div>
          </div>
        </div>
      `)}
      ${alerts.some((a) => a.missing) && html`
        <div class="anl-alert-missing-wrap">
          <div class="anl-alert-missing-title">Незамеренные точки</div>
          <div class="anl-alert-missing-pills">
            ${alerts.find((a) => a.missing).missing.slice(0, 10).map((n) => html`<span key=${n} class="badge">№${n}</span>`)}
            ${alerts.find((a) => a.missing).missing.length > 10 && html`<span class="badge">+${alerts.find((a) => a.missing).missing.length - 10}</span>`}
          </div>
        </div>
      `}
    </div>
  `;
}

// ═════════════════════════ Вкладка «Домены» ═════════════════════════

const DOMAIN_CARD_STATUSES = ['Активная', 'Иссякает', 'Пересохла'];

const WALL_DEFS = [
  { key: 'Северный',         lbl: 'С',  lblFull: 'Северный',     angle: -Math.PI / 2,      color: '#2E6DAE' },
  { key: 'Северо-восточный', lbl: 'СВ', lblFull: 'Северо-вост.', angle: -Math.PI / 4,      color: '#1E9BA8' },
  { key: 'Восточный',        lbl: 'В',  lblFull: 'Восточный',    angle: 0,                  color: '#B5301B' },
  { key: 'Юго-восточный',    lbl: 'ЮВ', lblFull: 'Юго-вост.',    angle: Math.PI / 4,        color: '#C2622E' },
  { key: 'Южный',            lbl: 'Ю',  lblFull: 'Южный',        angle: Math.PI / 2,        color: '#C08420' },
  { key: 'Юго-западный',     lbl: 'ЮЗ', lblFull: 'Юго-зап.',     angle: (3 * Math.PI) / 4,  color: '#CF9E2D' },
  { key: 'Западный',         lbl: 'З',  lblFull: 'Западный',     angle: Math.PI,            color: '#2F8F52' },
  { key: 'Северо-западный',  lbl: 'СЗ', lblFull: 'Северо-зап.',  angle: -(3 * Math.PI) / 4, color: '#6B8E3D' },
];

function DomainCard({ domain, pts, prevPts }) {
  const q = sumQ(pts);
  const prevQ = sumQ(prevPts);
  const diff = prevQ > 0 ? ((q - prevQ) / prevQ) * 100 : null;
  const isAlert = diff !== null && diff > 15;
  return html`
    <div class=${'card anl-domain-card' + (isAlert ? ' alert' : '')}>
      <div class="anl-dc-name">${domain} <span class="anl-dc-count">${pts.length} т.</span></div>
      <div class="anl-dc-q" style=${{ color: isAlert ? 'var(--red-500)' : 'var(--gold-600)' }}>${q.toFixed(2)} <small>л/с</small></div>
      <div class="anl-dc-sub">${lpsToM3h(q).toFixed(2)} м³/ч${diff != null ? html` · <${TrendLabel} diff=${diff} goodWhen="down" />` : ''}</div>
      <div class="anl-dc-bars">
        ${DOMAIN_CARD_STATUSES.map((s) => {
          const cnt = pts.filter((p) => p.status === s).length;
          const pct = pts.length ? Math.round((cnt / pts.length) * 100) : 0;
          return html`
            <div key=${s} class="anl-pb-row anl-pb-row-sm">
              <span class="anl-pb-lbl anl-pb-lbl-sm">${s.slice(0, 6)}.</span>
              <div class="anl-pb-trk"><div class="anl-pb-fill" style=${{ width: pct + '%', background: STATUS_COLORS[s] }}></div></div>
              <span class="anl-pb-count">${cnt}</span>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

function DomainMatrix({ domains, pts }) {
  if (!domains.length) return html`<div class="anl-empty">Нет данных</div>`;
  const statuses = STATUS_ORDER;
  const mx = {}, dQ = {}, dTotal = {}, sTot = {};
  domains.forEach((d) => { mx[d] = {}; dQ[d] = 0; dTotal[d] = 0; });
  pts.forEach((p) => {
    const d = p.domain || '—', s = p.status || 'Неизвестно';
    if (!mx[d]) { mx[d] = {}; dQ[d] = 0; dTotal[d] = 0; }
    mx[d][s] = (mx[d][s] || 0) + 1;
    dTotal[d]++;
    const q = parseFloat(p.flow_rate);
    if (!Number.isNaN(q) && q > 0) dQ[d] += q;
    if (statuses.includes(s)) sTot[s] = (sTot[s] || 0) + 1;
  });
  let maxCell = 0;
  domains.forEach((d) => statuses.forEach((s) => { if ((mx[d][s] || 0) > maxCell) maxCell = mx[d][s]; }));
  function cellStyle(v) {
    if (!v) return {};
    const r = v / (maxCell || 1);
    return { background: `rgba(46,109,174,${(0.08 + r * 0.42).toFixed(2)})`, fontWeight: r > 0.55 ? 700 : 500 };
  }
  return html`
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Домен</th>
            ${statuses.map((s) => html`<th key=${s} style=${{ color: STATUS_COLORS[s] }}>${s.slice(0, 4)}.</th>`)}
            <th>∑</th><th>Q л/с</th>
          </tr>
        </thead>
        <tbody>
          ${domains.map((d) => html`
            <tr key=${d}>
              <td><b>${d.replace(/[Dd]omen-?/i, 'Д-')}</b></td>
              ${statuses.map((s) => html`<td key=${s} class="mono" style=${cellStyle(mx[d][s])}>${mx[d][s] || '—'}</td>`)}
              <td><b>${dTotal[d]}</b></td>
              <td class="mono" style=${{ color: 'var(--gold-600)' }}>${dQ[d].toFixed(2)}</td>
            </tr>
          `)}
          <tr class="anl-mx-foot">
            <td><b>∑</b></td>
            ${statuses.map((s) => html`<td key=${s} class="mono"><b>${sTot[s] || 0}</b></td>`)}
            <td><b>${pts.length}</b></td>
            <td class="mono"><b>${sumQ(pts).toFixed(2)}</b></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

function WindRose({ pts }) {
  const wStats = {};
  WALL_DEFS.forEach((w) => { wStats[w.key] = { count: 0, q: 0 }; });
  const other = { count: 0, q: 0 };
  pts.forEach((p) => {
    const w = WALL_DEFS.find((wd) => wd.key === p.wall);
    const q = parseFloat(p.flow_rate) || 0;
    if (w) { wStats[p.wall].count++; wStats[p.wall].q += q; } else { other.count++; other.q += q; }
  });
  const maxQ = Math.max(...WALL_DEFS.map((w) => wStats[w.key].q)) || 1;
  const CX = 120, CY = 120, R = 95, W = 260, H = 260;
  const halfSector = Math.PI / 8;
  const withQ = WALL_DEFS.filter((w) => wStats[w.key].q > 0).sort((a, b) => wStats[b.key].q - wStats[a.key].q);

  if (!withQ.length && !pts.length) return html`<div class="anl-empty">Нет данных о бортах</div>`;

  return html`
    <div style=${{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <svg viewBox=${`0 0 ${W} ${H}`} style=${{ width: '220px', maxWidth: '100%', flexShrink: 0, display: 'block' }}>
        ${[0.25, 0.5, 0.75, 1].map((f) => html`<circle key=${f} cx=${CX} cy=${CY} r=${(R * f).toFixed(1)} fill="none" stroke="var(--border-subtle)" stroke-width="1" />`)}
        ${WALL_DEFS.map((w) => html`<line key=${'sp-' + w.key} x1=${CX} y1=${CY} x2=${(CX + R * Math.cos(w.angle)).toFixed(1)} y2=${(CY + R * Math.sin(w.angle)).toFixed(1)} stroke="var(--border)" stroke-width="1" stroke-dasharray="3,3" />`)}
        ${WALL_DEFS.map((w) => {
          const s = wStats[w.key];
          if (!s.q) return null;
          const r = Math.max(4, (s.q / maxQ) * R);
          const a0 = w.angle - halfSector, a1 = w.angle + halfSector;
          const x0 = (CX + r * Math.cos(a0)).toFixed(2), y0 = (CY + r * Math.sin(a0)).toFixed(2);
          const x1 = (CX + r * Math.cos(a1)).toFixed(2), y1 = (CY + r * Math.sin(a1)).toFixed(2);
          return html`<path key=${'sec-' + w.key} d=${`M ${CX} ${CY} L ${x0} ${y0} A ${r.toFixed(2)} ${r.toFixed(2)} 0 0 1 ${x1} ${y1} Z`} fill=${w.color} opacity="0.88"><title>${w.lblFull}: ${s.q.toFixed(2)} л/с</title></path>`;
        })}
        <circle cx=${CX} cy=${CY} r="2.5" fill="var(--text-tertiary)" />
        ${WALL_DEFS.map((w) => {
          const d = R + 15;
          const lx = (CX + d * Math.cos(w.angle)).toFixed(1);
          const ly = (CY + d * Math.sin(w.angle) + 3.5).toFixed(1);
          const ta = Math.abs(Math.cos(w.angle)) < 0.2 ? 'middle' : Math.cos(w.angle) > 0 ? 'start' : 'end';
          return html`<text key=${'lbl-' + w.key} x=${lx} y=${ly} fill="var(--text-secondary)" font-size="9.5" text-anchor=${ta} font-weight="600">${w.lbl}</text>`;
        })}
      </svg>
      <div style=${{ flex: 1, minWidth: '160px' }}>
        ${withQ.map((w) => {
          const s = wStats[w.key];
          const isMax = s.q === maxQ;
          return html`
            <div key=${w.key} class="anl-wall-row">
              <span class="anl-legend-swatch anl-wall-swatch" style=${{ background: w.color }} />
              <span class="anl-wall-name">${w.lblFull}</span>
              <span class="anl-wall-q">${s.q.toFixed(1)} <small>л/с</small>${isMax ? html` <span class="anl-wall-max">↑↑</span>` : ''}</span>
            </div>
          `;
        })}
        ${other.count > 0 && html`<div class="anl-wall-other">Прочие/не указан: ${other.count} т. · ${other.q.toFixed(2)} л/с</div>`}
      </div>
    </div>
  `;
}

function HorizonsPanel({ periods3, currentPts }) {
  const horizSet = new Set();
  currentPts.forEach((p) => { if (p.horizon) horizSet.add(p.horizon); });
  const horizons = Array.from(horizSet).sort();
  if (!horizons.length) return html`<div class="anl-empty">Нет данных о горизонтах</div>`;

  function hQ(pts, h) {
    let q = 0;
    pts.forEach((p) => { if (p.horizon === h) { const f = parseFloat(p.flow_rate); if (!Number.isNaN(f) && f > 0) q += f; } });
    return q;
  }
  const maxBarQ = Math.max(...horizons.map((h) => hQ(currentPts, h))) || 1;

  return html`
    <div>
      <div class="table-wrap" style=${{ marginBottom: '12px' }}>
        <table class="data-table">
          <thead>
            <tr>
              <th>Горизонт</th>
              ${periods3.map((p) => html`<th key=${p.date}>${shortMonitoringDate(p.date)}</th>`)}
              <th>↕</th>
            </tr>
          </thead>
          <tbody>
            ${horizons.map((h) => {
              const qs = periods3.map((p) => hQ(p.pts, h));
              const cur = qs[0] || 0, prev = qs[1] || 0;
              const diff = prev > 0 ? ((cur - prev) / prev) * 100 : null;
              return html`
                <tr key=${h}>
                  <td><b>${h}</b></td>
                  ${qs.map((q, i) => html`<td key=${i} class="mono">${q > 0 ? q.toFixed(2) : '—'}</td>`)}
                  <td><${TrendLabel} diff=${diff} goodWhen="down" /></td>
                </tr>
              `;
            })}
          </tbody>
        </table>
      </div>
      ${horizons.map((h) => {
        const q = hQ(currentPts, h);
        const pct = Math.round((q / maxBarQ) * 100);
        const prev = periods3[1] ? hQ(periods3[1].pts, h) : 0;
        const diff = prev > 0 ? ((q - prev) / prev) * 100 : null;
        const color = diff != null && diff > 5 ? 'var(--red-500)' : diff != null && diff < -5 ? 'var(--green-500)' : 'var(--blue-500)';
        return html`
          <div key=${h} class="anl-pb-row">
            <span class="anl-pb-lbl">${h}</span>
            <div class="anl-pb-trk"><div class="anl-pb-fill" style=${{ width: pct + '%', background: color }}></div></div>
            <span class="anl-pb-count">${q.toFixed(2)}</span>
          </div>
        `;
      })}
    </div>
  `;
}

function DomainsTab({ points, dates, domains, currentPts, compareDate }) {
  const ptsForDate = useCallback((date) => (points || []).filter((p) => (p.monitoring_date || '').slice(0, 10) === date), [points]);
  const prevPts = useMemo(() => (compareDate ? ptsForDate(compareDate) : []), [compareDate, ptsForDate]);
  const periods3 = useMemo(() => dates.slice(0, 3).map((d) => ({ date: d, pts: ptsForDate(d) })), [dates, ptsForDate]);

  if (!domains.length) return html`<${Card}><${CardContent}><div class="anl-empty">Нет данных о доменах</div><//><//>`;

  return html`
    <div>
      <div class="anl-domain-cards">
        ${domains.map((d) => html`<${DomainCard} key=${d} domain=${d} pts=${currentPts.filter((p) => p.domain === d)} prevPts=${prevPts.filter((p) => p.domain === d)} />`)}
      </div>
      <div class="grid grid-3">
        <${Card}>
          <${CardHeader}><${CardTitle}>Матрица: Домен × Статус<//><//>
          <${CardContent} tight><${DomainMatrix} domains=${domains} pts=${currentPts} /><//>
        <//>
        <${Card}>
          <${CardHeader}><${CardTitle}>Распределение по бортам<//><//>
          <${CardContent}><${WindRose} pts=${currentPts} /><//>
        <//>
        <${Card}>
          <${CardHeader}><${CardTitle}>Дебит по горизонтам<//><//>
          <${CardContent}><${HorizonsPanel} periods3=${periods3} currentPts=${currentPts} /><//>
        <//>
      </div>
    </div>
  `;
}

// ═════════════════════════ Вкладка «Скважины» ═════════════════════════

const WELL_TREND_COLORS = ['var(--gold-500)', 'var(--blue-500)', 'var(--green-500)', 'var(--amber-600)', 'var(--red-500)'];
const WELL_STATUS_BADGE = { 'Активная': 'success', 'Иссякает': 'warning', 'Сухая': 'danger' };

function WellKpis({ wells, measByWell, roundDate, dates }) {
  const active = wells.filter((w) => w.status === 'Активная').length;
  const dry = wells.filter((w) => w.status === 'Сухая').length;
  const depths = wells.filter((w) => w.depth > 0).map((w) => w.depth);
  const avgD = depths.length ? Math.round(depths.reduce((a, b) => a + b, 0) / depths.length) : 0;
  let wTotalQ = 0;
  wells.forEach((w) => {
    const wm = wellMeasurementsInRound(measByWell[w.id], roundDate, dates);
    if (wm.length) { const f = parseFloat(wm[wm.length - 1].flow_rate); if (!Number.isNaN(f) && f > 0) wTotalQ += f; }
  });
  const withMeas = wells.filter((w) => measByWell[w.id] && measByWell[w.id].length).length;

  return html`
    <div class="grid grid-4" style=${{ marginBottom: '16px' }}>
      <${AnlKpiCard} label="Скважин всего" value=${wells.length} sub=${`${active} акт. · ${dry} сухих`} trend=${html`<span class="anl-trend-eq">→</span>`} values=${[]} color="var(--gold-500)" />
      <${AnlKpiCard} label="Q скважин сумм." value=${wTotalQ.toFixed(2)} unit="м³/ч" sub=${`${(wTotalQ / 3.6).toFixed(2)} л/с`} trend=${html`<span class="anl-trend-eq">→</span>`} values=${[]} color="var(--amber-600)" />
      <${AnlKpiCard} label="Средняя глубина" value=${avgD || '—'} unit=${avgD ? 'м' : ''} sub=${`мин: ${depths.length ? Math.min(...depths) : '—'} · макс: ${depths.length ? Math.max(...depths) : '—'}`} trend=${html`<span class="anl-trend-eq">→</span>`} values=${[]} color="var(--blue-500)" />
      <${AnlKpiCard} label="Скважин с замерами" value=${withMeas} sub=${`из ${wells.length} скважин`} trend=${html`<span class="anl-trend-eq">→</span>`} values=${[]} color="var(--green-500)" />
    </div>
  `;
}

function WellRankingList({ wells, measByWell, roundDate, dates }) {
  const sorted = useMemo(() => wells.slice().sort((a, b) => {
    const wa = wellMeasurementsInRound(measByWell[a.id], roundDate, dates);
    const wb = wellMeasurementsInRound(measByWell[b.id], roundDate, dates);
    const qa = wa.length ? (parseFloat(wa[wa.length - 1].flow_rate) || 0) : 0;
    const qb = wb.length ? (parseFloat(wb[wb.length - 1].flow_rate) || 0) : 0;
    return qb - qa;
  }), [wells, measByWell, roundDate, dates]);

  if (!sorted.length) return html`<div class="anl-empty">Нет данных о скважинах</div>`;

  return html`
    <div class="anl-wr-list">
      ${sorted.slice(0, 8).map((w) => {
        const wm = wellMeasurementsInRound(measByWell[w.id], roundDate, dates);
        const q = wm.length ? (parseFloat(wm[wm.length - 1].flow_rate) || 0) : 0;
        const meas = measByWell[w.id];
        let spark = null;
        if (meas && meas.length >= 2) {
          const vals = meas.slice(-6).map((m) => parseFloat(m.flow_rate) || 0);
          const maxV = Math.max(...vals) || 1;
          const pts = vals.map((v, i) => ({ x: (i / (vals.length - 1)) * 70, y: (1 - v / maxV) * 20 + 1 }));
          const sclr = vals[vals.length - 1] >= vals[0] ? 'var(--red-500)' : 'var(--green-500)';
          spark = html`<svg viewBox="0 0 70 22" width="70" height="22"><path d=${smoothPath(pts)} fill="none" stroke=${sclr} stroke-width="1.8" /></svg>`;
        } else {
          spark = html`<svg viewBox="0 0 70 22" width="70" height="22"><line x1="0" y1="11" x2="70" y2="11" stroke="var(--border)" stroke-width="1.5" stroke-dasharray="3,3" /></svg>`;
        }
        return html`
          <div key=${w.id} class="anl-wr">
            <div style=${{ flex: 1, minWidth: 0 }}>
              <div class="anl-wr-name">${w.name} <${Badge} variant=${WELL_STATUS_BADGE[w.status] || 'default'}>${w.status || '—'}<//></div>
              <div class="anl-wr-info">${w.depth || '—'} м${w.azimuth != null ? ` · аз. ${w.azimuth}°` : ''}${w.inclination != null ? ` · накл. ${w.inclination}°` : ''}</div>
            </div>
            ${spark}
            <div style=${{ textAlign: 'right' }}>
              <div class="anl-wr-q">${q.toFixed(2)}</div>
              <div class="anl-wr-qu">м³/ч</div>
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

function wellTrendDatesFor(wells, measByWell, period) {
  let cutoff = null;
  if (period !== 'all') {
    const days = parseInt(period, 10);
    const d = new Date(); d.setDate(d.getDate() - days);
    cutoff = d.toISOString().slice(0, 10);
  }
  const set = new Set();
  wells.forEach((w) => (measByWell[w.id] || []).forEach((m) => {
    const d = (m.measurement_date || '').slice(0, 10);
    if (d && (!cutoff || d >= cutoff)) set.add(d);
  }));
  return Array.from(set).sort();
}

function brushSlice(allD, st, en) {
  if (allD.length < 2) return allD;
  let s = Math.floor(st * (allD.length - 1));
  let e = Math.ceil(en * (allD.length - 1));
  s = Math.max(0, Math.min(s, allD.length - 1));
  e = Math.max(s + 1, Math.min(e, allD.length - 1));
  return allD.slice(s, e + 1);
}

function WellTrendBrush({ wells, measByWell, allDFull, hidden, brush, onBrushChange }) {
  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const BW = 440, BH = 40, BPL = 42, BPR = 12, BPT = 4, BPB = 4;
  const bcW = BW - BPL - BPR, bcH = BH - BPT - BPB;
  const n = allDFull.length;

  const bpx = (i) => BPL + (n > 1 ? (i / (n - 1)) * bcW : bcW / 2);
  const allQ = [];
  wells.forEach((w) => (measByWell[w.id] || []).forEach((m) => { const f = parseFloat(m.flow_rate); if (!Number.isNaN(f)) allQ.push(f); }));
  const maxQ = Math.max(...(allQ.length ? allQ : [1])) || 1;
  const bpy = (q) => BPT + (1 - q / maxQ) * bcH;

  function fracFromClientX(clientX) {
    const el = svgRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const svgX = ((clientX - r.left) / (r.width || 1)) * BW;
    return Math.max(0, Math.min(1, (svgX - BPL) / bcW));
  }

  useEffect(() => {
    function onMove(e) {
      const drag = dragRef.current;
      if (!drag) return;
      const fx = fracFromClientX(e.clientX);
      if (drag.mode === 'left') onBrushChange({ st: Math.max(0, Math.min(fx, brush.en - 0.04)), en: brush.en });
      else if (drag.mode === 'right') onBrushChange({ st: brush.st, en: Math.min(1, Math.max(fx, brush.st + 0.04)) });
      else if (drag.mode === 'move') {
        const span = drag.startEn - drag.startSt;
        const newSt = Math.max(0, Math.min(1 - span, drag.startSt + (fx - drag.startFrac)));
        onBrushChange({ st: newSt, en: newSt + span });
      } else if (drag.mode === 'new') {
        if (fx > drag.startFrac) onBrushChange({ st: drag.startFrac, en: Math.min(1, fx) });
        else onBrushChange({ st: Math.max(0, fx), en: drag.startFrac });
      }
    }
    function onUp() { dragRef.current = null; }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [brush, onBrushChange]);

  function onMouseDown(e) {
    const el = svgRef.current;
    const r = el.getBoundingClientRect();
    const svgX = ((e.clientX - r.left) / (r.width || 1)) * BW;
    const fx = fracFromClientX(e.clientX);
    const lhX = BPL + brush.st * bcW, rhX = BPL + brush.en * bcW;
    const mode = Math.abs(svgX - lhX) < 10 ? 'left' : Math.abs(svgX - rhX) < 10 ? 'right' : (svgX > lhX && svgX < rhX) ? 'move' : 'new';
    dragRef.current = { mode, startFrac: fx, startSt: brush.st, startEn: brush.en };
    e.preventDefault();
  }

  if (n < 2) return null;

  return html`
    <svg ref=${svgRef} viewBox=${`0 0 ${BW} ${BH}`} style=${{ width: '100%', display: 'block', cursor: 'crosshair', marginTop: '6px' }} onMouseDown=${onMouseDown}>
      <rect x=${BPL} y=${BPT} width=${bcW} height=${bcH} fill="var(--bg-sunken)" rx="3" />
      ${wells.map((w, i) => {
        if (hidden[w.id]) return null;
        const clr = WELL_TREND_COLORS[i % WELL_TREND_COLORS.length];
        const mMap = {};
        (measByWell[w.id] || []).forEach((m) => { mMap[(m.measurement_date || '').slice(0, 10)] = parseFloat(m.flow_rate) || 0; });
        const pts = [];
        for (let idx = 0; idx < n; idx++) { const d = allDFull[idx]; if (mMap[d] != null) pts.push(`${bpx(idx).toFixed(1)},${bpy(mMap[d]).toFixed(1)}`); }
        if (pts.length < 2) return null;
        return html`<polyline key=${w.id} points=${pts.join(' ')} fill="none" stroke=${clr} stroke-width=${i === 0 ? 1.4 : 0.9} opacity=${i === 0 ? 0.6 : 0.35} />`;
      })}
      <rect x=${(BPL + brush.st * bcW).toFixed(1)} y=${BPT} width=${Math.max(4, (brush.en - brush.st) * bcW).toFixed(1)} height=${bcH} fill="var(--blue-100)" stroke="var(--blue-500)" stroke-width="1" rx="2" opacity="0.75" />
      <rect x=${(BPL + brush.st * bcW - 2).toFixed(1)} y=${(BPT + bcH * 0.2).toFixed(1)} width="4" height=${(bcH * 0.6).toFixed(1)} fill="var(--blue-500)" rx="2" />
      <rect x=${(BPL + brush.en * bcW - 2).toFixed(1)} y=${(BPT + bcH * 0.2).toFixed(1)} width="4" height=${(bcH * 0.6).toFixed(1)} fill="var(--blue-500)" rx="2" />
    </svg>
  `;
}

function WellTrendTable({ visWells, measByWell, allD }) {
  return html`
    <div class="anl-wt-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Дата</th>
            ${visWells.map((w, i) => html`<th key=${w.id} style=${{ color: WELL_TREND_COLORS[i % WELL_TREND_COLORS.length] }}>${w.name}</th>`)}
            <th>Итого</th>
          </tr>
        </thead>
        <tbody>
          ${allD.map((d) => {
            let total = 0;
            const cells = visWells.map((w) => {
              const meas = measByWell[w.id] || [];
              const m = meas.find((x) => (x.measurement_date || '').slice(0, 10) === d);
              const q = m ? (parseFloat(m.flow_rate) || 0) : null;
              if (q !== null) total += q;
              return q;
            });
            return html`
              <tr key=${d}>
                <td>${shortMonitoringDate(d)}</td>
                ${cells.map((q, i) => html`<td key=${i} class="mono">${q != null ? q.toFixed(2) : '—'}</td>`)}
                <td class="mono"><b>${total.toFixed(2)}</b></td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </div>
  `;
}

function WellTrendChart({ wells, measByWell }) {
  const [period, setPeriod] = useState('all');
  const [chartType, setChartType] = useState('area');
  const [hidden, setHidden] = useState({});
  const [showWells, setShowWells] = useState(null);
  const [tableMode, setTableMode] = useState(false);
  const [brush, setBrush] = useState({ st: 0, en: 1 });
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [hover, setHover] = useState(null);
  const selectorRef = useRef(null);

  useEffect(() => {
    function onDoc(e) { if (selectorRef.current && !selectorRef.current.contains(e.target)) setSelectorOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const poolWells = useMemo(() => (showWells ? wells.filter((w) => showWells.includes(w.id)) : wells), [wells, showWells]);
  const withMeas = useMemo(() => {
    const arr = poolWells.filter((w) => measByWell[w.id] && measByWell[w.id].length >= 2);
    arr.sort((a, b) => {
      const ma = measByWell[a.id], mb = measByWell[b.id];
      const qa = ma.length ? (parseFloat(ma[ma.length - 1].flow_rate) || 0) : 0;
      const qb = mb.length ? (parseFloat(mb[mb.length - 1].flow_rate) || 0) : 0;
      return qb - qa;
    });
    return arr;
  }, [poolWells, measByWell]);
  const visWells = useMemo(() => (showWells ? withMeas : withMeas.slice(0, 5)), [withMeas, showWells]);

  const allDFull = useMemo(() => wellTrendDatesFor(visWells, measByWell, period), [visWells, measByWell, period]);
  const allD = useMemo(() => brushSlice(allDFull, brush.st, brush.en), [allDFull, brush]);

  useEffect(() => { setBrush({ st: 0, en: 1 }); }, [period, showWells]);

  const wellsWithAnyMeas = useMemo(() => wells.filter((w) => measByWell[w.id] && measByWell[w.id].length >= 1), [wells, measByWell]);

  function toggleHidden(id) { setHidden((h) => ({ ...h, [id]: !h[id] })); }
  function toggleShowWell(id) {
    setShowWells((cur) => {
      const base = cur || wellsWithAnyMeas.map((w) => w.id);
      const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      return next.length ? next : null;
    });
  }

  if (!visWells.length) {
    const anyLoaded = wells.some((w) => measByWell[w.id] !== undefined);
    return html`<div class="anl-empty">${anyLoaded ? 'Недостаточно данных (нужно ≥2 замера на скважину)' : 'Замеры загружаются…'}</div>`;
  }

  const W = 640, H = 220, PL = 46, PR = 60, PT = 14, PB = 30;
  const cW = W - PL - PR, cH = H - PT - PB;
  const n = allD.length;
  const px = (i) => PL + (n > 1 ? (i / (n - 1)) * cW : cW / 2);
  const shown = visWells.filter((w) => !hidden[w.id]);
  const allQ = [];
  shown.forEach((w) => (measByWell[w.id] || []).forEach((m) => {
    const d = (m.measurement_date || '').slice(0, 10);
    if (allD.includes(d)) { const f = parseFloat(m.flow_rate); if (!Number.isNaN(f)) allQ.push(f); }
  }));
  const maxQ = (Math.max(...(allQ.length ? allQ : [1])) || 1) * 1.15;
  const py = (q) => PT + (1 - q / maxQ) * cH;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => maxQ * f);
  const step = Math.max(1, Math.ceil(n / 6));
  const hitW = cW / Math.max(n - 1, 1);

  function seriesFor(w, i) {
    const clr = WELL_TREND_COLORS[i % WELL_TREND_COLORS.length];
    const mMap = {};
    (measByWell[w.id] || []).forEach((m) => { mMap[(m.measurement_date || '').slice(0, 10)] = parseFloat(m.flow_rate) || 0; });
    const pts = [];
    allD.forEach((d, idx) => { if (mMap[d] != null) pts.push({ x: px(idx), y: py(mMap[d]), q: mMap[d] }); });
    return { clr, pts };
  }

  const hoveredDate = hover != null ? allD[hover] : null;

  return html`
    <div>
      <div class="anl-wt-toolbar">
        <div class="anl-wt-toolbar-group">
          <span class="anl-wt-toolbar-lbl">Период:</span>
          ${['7d', '14d', '30d', 'all'].map((p) => html`<button key=${p} class=${'anl-wt-btn' + (period === p ? ' active' : '')} onClick=${() => setPeriod(p)}>${p === 'all' ? 'Всё' : p.replace('d', 'д')}</button>`)}
          <span class="anl-wt-toolbar-lbl" style=${{ marginLeft: '8px' }}>Тип:</span>
          ${[['area', 'Область'], ['line', 'Линия'], ['step', 'Ступень']].map(([v, l]) => html`<button key=${v} class=${'anl-wt-btn' + (chartType === v ? ' active' : '')} onClick=${() => setChartType(v)}>${l}</button>`)}
        </div>
        <div class="anl-wt-toolbar-group">
          <div ref=${selectorRef} style=${{ position: 'relative' }}>
            <button class="anl-wt-btn" onClick=${() => setSelectorOpen((v) => !v)}>Скважины ▾</button>
            ${selectorOpen && html`
              <div class="anl-wt-select-drop">
                ${wellsWithAnyMeas.map((w) => {
                  const sel = !showWells || showWells.includes(w.id);
                  return html`
                    <label key=${w.id} class="anl-wt-select-opt">
                      <input type="checkbox" checked=${sel} onChange=${() => toggleShowWell(w.id)} />
                      <span>${w.name}</span>
                    </label>
                  `;
                })}
              </div>
            `}
          </div>
          <button class="anl-wt-btn" onClick=${() => setTableMode((v) => !v)}>${tableMode ? 'График' : 'Таблица'}</button>
        </div>
      </div>

      <div class="anl-wt-legend">
        ${visWells.map((w, i) => {
          const clr = WELL_TREND_COLORS[i % WELL_TREND_COLORS.length];
          const meas = measByWell[w.id];
          const lastQ = meas && meas.length ? parseFloat(meas[meas.length - 1].flow_rate) : NaN;
          return html`
            <span key=${w.id} class="anl-wt-legend-chip" style=${{ borderColor: clr + '55', background: clr + '14', opacity: hidden[w.id] ? 0.4 : 1 }} onClick=${() => toggleHidden(w.id)}>
              <span class="anl-legend-swatch" style=${{ background: clr }} />
              ${w.name}
              ${!Number.isNaN(lastQ) && html`<b style=${{ color: clr }}>${lastQ.toFixed(2)}</b>`}
            </span>
          `;
        })}
      </div>

      ${tableMode ? html`<${WellTrendTable} visWells=${shown} measByWell=${measByWell} allD=${allD} />` : html`
        <div style=${{ position: 'relative' }}>
          <svg viewBox=${`0 0 ${W} ${H}`} style=${{ width: '100%', display: 'block', overflow: 'visible' }}>
            ${yTicks.map((q) => html`
              <g key=${q}>
                <line x1=${PL} y1=${py(q).toFixed(1)} x2=${PL + cW} y2=${py(q).toFixed(1)} stroke="var(--border-subtle)" stroke-width=${q === 0 ? 1 : 0.6} stroke-dasharray=${q === 0 ? undefined : '4,4'} />
                <text x=${PL - 6} y=${(py(q) + 3).toFixed(1)} fill="var(--text-tertiary)" font-size="9" text-anchor="end">${q.toFixed(1)}</text>
              </g>
            `)}
            <text x="12" y=${PT + cH / 2} fill="var(--text-tertiary)" font-size="9" text-anchor="middle" transform=${`rotate(-90 12 ${PT + cH / 2})`}>м³/ч</text>
            <line x1=${PL} y1=${PT} x2=${PL} y2=${PT + cH} stroke="var(--border)" stroke-width="1" />
            <line x1=${PL} y1=${PT + cH} x2=${PL + cW} y2=${PT + cH} stroke="var(--border)" stroke-width="1" />
            ${hover != null && html`<line x1=${px(hover).toFixed(1)} y1=${PT} x2=${px(hover).toFixed(1)} y2=${PT + cH} stroke="var(--stone-400)" stroke-width="1" stroke-dasharray="3,3" />`}
            ${shown.map((w, i) => {
              const { clr, pts } = seriesFor(w, visWells.indexOf(w));
              if (!pts.length) return null;
              const linePath = chartType === 'step'
                ? 'M' + pts.map((p, j) => (j ? `H${p.x.toFixed(1)}V` : '') + `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
                : smoothPath(pts);
              const areaPath = `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${(PT + cH).toFixed(1)} L${pts[0].x.toFixed(1)},${(PT + cH).toFixed(1)} Z`;
              const lp = pts[pts.length - 1];
              const si = visWells.indexOf(w);
              return html`
                <g key=${w.id}>
                  ${chartType === 'area' && html`<path d=${areaPath} fill=${clr} opacity="0.12" />`}
                  <path d=${linePath} fill="none" stroke=${clr} stroke-width=${si === 0 ? 2.2 : 1.4} stroke-linejoin="round" stroke-linecap="round" opacity=${si > 0 ? Math.max(0.6, 1 - si * 0.08).toFixed(2) : 1} stroke-dasharray=${si >= 3 ? '5,3' : undefined} />
                  <circle cx=${lp.x.toFixed(1)} cy=${lp.y.toFixed(1)} r="4" fill=${clr} stroke="#fff" stroke-width="1.5" />
                  <rect x=${(lp.x + 6).toFixed(1)} y=${(lp.y - 16).toFixed(1)} width="38" height="15" fill=${clr} fill-opacity="0.15" rx="3" />
                  <text x=${(lp.x + 25).toFixed(1)} y=${(lp.y - 5.5).toFixed(1)} fill=${clr} font-size="9" font-weight="700" text-anchor="middle">${lp.q.toFixed(2)}</text>
                </g>
              `;
            })}
            ${allD.map((d, i) => (i % step === 0 || i === n - 1) ? html`<text key=${d} x=${px(i).toFixed(1)} y=${H - 8} fill="var(--text-tertiary)" font-size="9" text-anchor="middle">${shortMonitoringDate(d)}</text>` : null)}
            ${allD.map((d, i) => html`<rect key=${'hit-' + d} x=${(px(i) - hitW / 2).toFixed(1)} y=${PT} width=${hitW.toFixed(1)} height=${cH} fill="transparent" style=${{ cursor: 'crosshair' }} onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)} />`)}
          </svg>
          ${hoveredDate && html`
            <div class="anl-wt-tip" style=${{ left: ((px(hover) > W * 0.6 ? px(hover) - 150 : px(hover) + 10) / W) * 100 + '%', top: '6%' }}>
              <div class="anl-wt-tip-date">${formatMonitoringDate(hoveredDate)}</div>
              ${shown.map((w) => {
                const i = visWells.indexOf(w);
                const clr = WELL_TREND_COLORS[i % WELL_TREND_COLORS.length];
                const meas = measByWell[w.id] || [];
                const m = meas.find((x) => (x.measurement_date || '').slice(0, 10) === hoveredDate);
                const q = m ? (parseFloat(m.flow_rate) || 0) : null;
                return html`
                  <div key=${w.id} class="anl-wt-tip-row">
                    <span><span class="anl-legend-swatch" style=${{ background: clr, borderRadius: '50%', width: '8px', height: '8px' }} />${w.name}</span>
                    <b style=${{ color: clr }}>${q != null ? q.toFixed(2) + ' м³/ч' : '—'}</b>
                  </div>
                `;
              })}
            </div>
          `}
          ${!tableMode && html`<${WellTrendBrush} wells=${visWells} measByWell=${measByWell} allDFull=${allDFull} hidden=${hidden} brush=${brush} onBrushChange=${setBrush} />`}
        </div>
      `}
    </div>
  `;
}

function WellsTab({ wells, measByWell, roundDate, dates }) {
  if (!wells.length) {
    return html`<${Card}><${CardContent}><div class="anl-empty">Скважин пока нет — добавьте их на странице «Гор. скважины».</div><//><//>`;
  }
  return html`
    <div>
      <${WellKpis} wells=${wells} measByWell=${measByWell} roundDate=${roundDate} dates=${dates} />
      <div class="grid grid-2" style=${{ alignItems: 'start' }}>
        <${Card}>
          <${CardHeader}><${CardTitle}>Рейтинг скважин по дебиту<//><//>
          <${CardContent} tight><${WellRankingList} wells=${wells} measByWell=${measByWell} roundDate=${roundDate} dates=${dates} /><//>
        <//>
        <${Card}>
          <${CardHeader}><${CardTitle}>Динамика дебита по скважинам<//><//>
          <${CardContent}><${WellTrendChart} wells=${wells} measByWell=${measByWell} /><//>
        <//>
      </div>
    </div>
  `;
}

// ═════════════════════════ Вкладка «История» ═════════════════════════

const HIST_LINE1 = 'var(--blue-500)';
const HIST_LINE2 = 'var(--red-500)';

function histAggregateByDay(rows) {
  const days = {};
  rows.forEach((r) => {
    const dk = (r.monitoring_date || '').slice(0, 10);
    if (!dk) return;
    (days[dk] = days[dk] || { dateKey: dk, records: [] }).records.push(r);
  });
  return Object.keys(days).sort().map((dk) => {
    const recs = days[dk].records;
    let totalLps = null;
    recs.forEach((r) => { if (r.flow_rate != null) totalLps = (totalLps || 0) + parseFloat(r.flow_rate); });
    return {
      dateKey: dk,
      totalLps: totalLps != null ? Math.round(totalLps * 100) / 100 : null,
      totalM3h: totalLps != null ? Math.round(totalLps * 3.6 * 100) / 100 : null,
      records: recs,
    };
  });
}

function HistoryDayDetail({ day, label, color }) {
  const accent = color || HIST_LINE1;
  return html`
    <div class="anl-hist-detail">
      <div class="anl-hist-detail-title">${label && html`<span style=${{ color: accent }}>${label}</span> · `}${formatMonitoringDate(day.dateKey)}</div>
      <div class="anl-hist-detail-stats">
        <div class="anl-hist-detail-stat" style=${{ background: 'var(--blue-100)' }}>
          <div class="anl-hist-detail-stat-val" style=${{ color: accent }}>${day.totalLps != null ? day.totalLps.toFixed(2) : '—'}</div>
          <div class="anl-hist-detail-stat-lbl">л/с</div>
        </div>
        <div class="anl-hist-detail-stat" style=${{ background: 'var(--gold-50)' }}>
          <div class="anl-hist-detail-stat-val" style=${{ color: 'var(--gold-600)' }}>${day.totalM3h != null ? day.totalM3h.toFixed(2) : '—'}</div>
          <div class="anl-hist-detail-stat-lbl">м³/ч</div>
        </div>
        <div class="anl-hist-detail-stat" style=${{ background: 'var(--bg-sunken)' }}>
          <div class="anl-hist-detail-stat-val">${day.records.length}</div>
          <div class="anl-hist-detail-stat-lbl">замеров</div>
        </div>
      </div>
      <div class="anl-hist-detail-sub">Детализация</div>
      <div class="table-wrap">
        <table class="data-table anl-hist-detail-table">
          <thead><tr><th>Точка</th><th>л/с</th><th>м³/ч</th><th>Статус</th><th>Метод</th><th>Сотрудник</th></tr></thead>
          <tbody>
            ${day.records.map((r, i) => html`
              <tr key=${i}>
                <td><b>№${r.point_number}</b></td>
                <td class="mono">${r.flow_rate != null ? parseFloat(r.flow_rate).toFixed(2) : '—'}</td>
                <td class="mono">${r.flow_rate != null ? (parseFloat(r.flow_rate) * 3.6).toFixed(2) : '—'}</td>
                <td><span class="anl-legend-swatch" style=${{ background: STATUS_COLORS[r.status] || 'var(--stone-400)', borderRadius: '50%', width: '8px', height: '8px' }} />${r.status || '—'}</td>
                <td>${r.measure_method || '—'}</td>
                <td>${r.worker || '—'}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function HistorySingleChart({ days, clickedDayKey, onDayClick }) {
  if (!days.length) return html`<div class="anl-empty">Нет данных истории.<br/>Данные появятся после следующего сохранения точки.</div>`;

  const PAD = { top: 28, right: 56, bottom: 68, left: 52 };
  const n = days.length;
  const W = Math.max(480, n * 80 + PAD.left + PAD.right);
  const H = 280;
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const defined = days.filter((d) => d.totalLps != null);
  const maxLps = (defined.length ? Math.max(...defined.map((d) => d.totalLps)) : 1) || 1;

  const xPos = (i) => (n === 1 ? PAD.left + chartW / 2 : PAD.left + (i / (n - 1)) * chartW);
  const yPos = (v) => (v == null ? null : PAD.top + chartH - (v / maxLps) * chartH);

  let linePath = '', firstPt = true, fi = -1, li = -1;
  days.forEach((d, i) => {
    if (d.totalLps != null) { if (fi < 0) fi = i; li = i; }
    const y = yPos(d.totalLps);
    if (y == null) { firstPt = true; return; }
    linePath += (firstPt ? 'M' : 'L') + xPos(i).toFixed(1) + ',' + y.toFixed(1) + ' ';
    firstPt = false;
  });
  let areaPath = '';
  if (fi >= 0) {
    const base = (PAD.top + chartH).toFixed(1);
    areaPath = `M${xPos(fi).toFixed(1)},${base} ${linePath.replace(/^M/, 'L')}L${xPos(li).toFixed(1)},${base} Z`;
  }

  const yTicks = [0, maxLps / 2, maxLps];
  const seenStatuses = {};
  days.forEach((d) => d.records.forEach((r) => { if (r.status) seenStatuses[r.status] = STATUS_COLORS[r.status] || 'var(--stone-400)'; }));

  return html`
    <div>
      <div class="anl-hist-legend">
        ${Object.keys(seenStatuses).map((s) => html`<span key=${s}><span class="anl-legend-swatch" style=${{ background: seenStatuses[s], borderRadius: '50%', width: '10px', height: '10px' }} />${s}</span>`)}
        <span class="anl-hist-legend-hint">цифра = кол-во замеров · нажми на маркер</span>
      </div>
      <div style=${{ overflowX: 'auto' }}>
        <svg width=${W} height=${H} style=${{ display: 'block', minWidth: W + 'px' }}>
          ${yTicks.map((v) => html`
            <g key=${v}>
              <line x1=${PAD.left} y1=${yPos(v).toFixed(1)} x2=${PAD.left + chartW} y2=${yPos(v).toFixed(1)} stroke="var(--border-subtle)" stroke-width="1" />
              <text x=${PAD.left - 6} y=${(yPos(v) + 4).toFixed(1)} text-anchor="end" font-size="11" fill="var(--text-tertiary)">${v.toFixed(2)}</text>
              <text x=${PAD.left + chartW + 6} y=${(yPos(v) + 4).toFixed(1)} text-anchor="start" font-size="10" fill="var(--gold-600)">${(v * 3.6).toFixed(2)}</text>
            </g>
          `)}
          <text x=${PAD.left - 6} y=${PAD.top - 10} text-anchor="end" font-size="10" fill="var(--text-tertiary)">л/с</text>
          <text x=${PAD.left + chartW + 6} y=${PAD.top - 10} text-anchor="start" font-size="10" fill="var(--gold-600)">м³/ч</text>
          ${areaPath && html`<path d=${areaPath} fill=${HIST_LINE1} opacity="0.1" />`}
          ${linePath && html`<path d=${linePath} fill="none" stroke=${HIST_LINE1} stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />`}
          ${days.map((d, i) => {
            const x = xPos(i), y = yPos(d.totalLps);
            const isSelected = clickedDayKey === d.dateKey;
            const statusCount = {};
            d.records.forEach((r) => { statusCount[r.status || ''] = (statusCount[r.status || ''] || 0) + 1; });
            const dom = Object.keys(statusCount).sort((a, b) => statusCount[b] - statusCount[a])[0] || '';
            const sc = STATUS_COLORS[dom] || HIST_LINE1;
            const cnt = d.records.length;
            const dateY = H - 6;
            return html`
              <g key=${d.dateKey}>
                <text x=${x.toFixed(1)} y=${dateY} text-anchor="end" font-size="10" fill="var(--text-tertiary)" transform=${`rotate(-45,${x.toFixed(1)},${dateY})`}>${shortMonitoringDate(d.dateKey)}</text>
                ${isSelected && y != null && html`<circle cx=${x.toFixed(1)} cy=${y.toFixed(1)} r="18" fill=${sc} opacity="0.18" />`}
                ${y != null && html`<circle cx=${x.toFixed(1)} cy=${y.toFixed(1)} r=${cnt > 1 ? 12 : 9} fill=${sc} stroke="#fff" stroke-width="2" style=${{ cursor: 'pointer' }} onClick=${() => onDayClick(d)} />`}
                ${y != null && html`<text x=${x.toFixed(1)} y=${(y - 16).toFixed(1)} text-anchor="middle" font-size="10" font-weight="700" fill="var(--text-primary)" style=${{ pointerEvents: 'none' }}>${d.totalLps.toFixed(2)}</text>`}
                ${y != null && cnt > 1 && html`<text x=${x.toFixed(1)} y=${(y + 4).toFixed(1)} text-anchor="middle" font-size="9" font-weight="700" fill="#fff" style=${{ pointerEvents: 'none' }}>${cnt}</text>`}
              </g>
            `;
          })}
        </svg>
      </div>
    </div>
  `;
}

function HistoryCompareChart({ days1, days2, label1, label2, onMarkerClick }) {
  if (!days1.length && !days2.length) return html`<div class="anl-empty">Нет данных истории для выбранных точек</div>`;

  const map1 = {}; days1.forEach((d) => { map1[d.dateKey] = d; });
  const map2 = {}; days2.forEach((d) => { map2[d.dateKey] = d; });
  const allKeys = Array.from(new Set([...days1.map((d) => d.dateKey), ...days2.map((d) => d.dateKey)])).sort();

  const PAD = { top: 28, right: 60, bottom: 72, left: 52 };
  const n = allKeys.length;
  const W = Math.max(480, n * 80 + PAD.left + PAD.right);
  const H = 280;
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const allVals = [...days1, ...days2].filter((d) => d.totalLps != null).map((d) => d.totalLps);
  const maxLps = (allVals.length ? Math.max(...allVals) : 1) || 1;

  const xPos = (i) => (n === 1 ? PAD.left + chartW / 2 : PAD.left + (i / (n - 1)) * chartW);
  const yPos = (v) => (v == null ? null : PAD.top + chartH - (v / maxLps) * chartH);

  function buildLine(map) {
    let path = '', firstPt = true, fi = -1, li = -1;
    allKeys.forEach((dk, i) => {
      const d = map[dk];
      const v = d ? d.totalLps : null;
      if (v != null) { if (fi < 0) fi = i; li = i; }
      const y = yPos(v);
      if (y == null) { firstPt = true; return; }
      path += (firstPt ? 'M' : 'L') + xPos(i).toFixed(1) + ',' + y.toFixed(1) + ' ';
      firstPt = false;
    });
    let area = '';
    if (fi >= 0) {
      const base = (PAD.top + chartH).toFixed(1);
      area = `M${xPos(fi).toFixed(1)},${base} ${path.replace(/^M/, 'L')}L${xPos(li).toFixed(1)},${base} Z`;
    }
    return { path, area };
  }
  const L1 = buildLine(map1), L2 = buildLine(map2);
  const yTicks = [0, maxLps / 2, maxLps];

  return html`
    <div>
      <div class="anl-hist-legend">
        <span><span class="anl-legend-swatch" style=${{ background: HIST_LINE1 }} />${label1}</span>
        <span style=${{ color: HIST_LINE2 }}><span class="anl-legend-swatch" style=${{ background: HIST_LINE2 }} />${label2} <small style=${{ color: 'var(--text-tertiary)' }}>(штрих)</small></span>
        <span class="anl-hist-legend-hint">нажми на маркер для деталей</span>
      </div>
      <div style=${{ overflowX: 'auto' }}>
        <svg width=${W} height=${H} style=${{ display: 'block', minWidth: W + 'px' }}>
          ${yTicks.map((v) => html`
            <g key=${v}>
              <line x1=${PAD.left} y1=${yPos(v).toFixed(1)} x2=${PAD.left + chartW} y2=${yPos(v).toFixed(1)} stroke="var(--border-subtle)" stroke-width="1" />
              <text x=${PAD.left - 6} y=${(yPos(v) + 4).toFixed(1)} text-anchor="end" font-size="11" fill="var(--text-tertiary)">${v.toFixed(2)}</text>
              <text x=${PAD.left + chartW + 6} y=${(yPos(v) + 4).toFixed(1)} text-anchor="start" font-size="10" fill="var(--gold-600)">${(v * 3.6).toFixed(2)}</text>
            </g>
          `)}
          <text x=${PAD.left - 6} y=${PAD.top - 10} text-anchor="end" font-size="10" fill="var(--text-tertiary)">л/с</text>
          <text x=${PAD.left + chartW + 6} y=${PAD.top - 10} text-anchor="start" font-size="10" fill="var(--gold-600)">м³/ч</text>
          ${L1.area && html`<path d=${L1.area} fill=${HIST_LINE1} opacity="0.08" />`}
          ${L2.area && html`<path d=${L2.area} fill=${HIST_LINE2} opacity="0.08" />`}
          ${L1.path && html`<path d=${L1.path} fill="none" stroke=${HIST_LINE1} stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" />`}
          ${L2.path && html`<path d=${L2.path} fill="none" stroke=${HIST_LINE2} stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="6 3" />`}
          ${allKeys.map((dk, i) => {
            const x = xPos(i);
            const d1 = map1[dk], d2 = map2[dk];
            const y1 = d1 ? yPos(d1.totalLps) : null;
            const y2 = d2 ? yPos(d2.totalLps) : null;
            const offset2 = (y1 != null && y2 != null && Math.abs(y1 - y2) < 14) ? 14 : 0;
            const dateY = H - 6;
            return html`
              <g key=${dk}>
                <text x=${x.toFixed(1)} y=${dateY} text-anchor="end" font-size="10" fill="var(--text-tertiary)" transform=${`rotate(-45,${x.toFixed(1)},${dateY})`}>${shortMonitoringDate(dk)}</text>
                ${y1 != null && html`<circle cx=${x.toFixed(1)} cy=${y1.toFixed(1)} r="8" fill=${HIST_LINE1} stroke="#fff" stroke-width="2" style=${{ cursor: 'pointer' }} onClick=${() => onMarkerClick(d1, label1, HIST_LINE1)} />`}
                ${y1 != null && html`<text x=${x.toFixed(1)} y=${(y1 - 13).toFixed(1)} text-anchor="middle" font-size="10" font-weight="700" fill=${HIST_LINE1} style=${{ pointerEvents: 'none' }}>${d1.totalLps.toFixed(2)}</text>`}
                ${y2 != null && html`<circle cx=${(x + offset2).toFixed(1)} cy=${y2.toFixed(1)} r="7" fill=${HIST_LINE2} stroke="#fff" stroke-width="2" style=${{ cursor: 'pointer' }} onClick=${() => onMarkerClick(d2, label2, HIST_LINE2)} />`}
                ${y2 != null && html`<text x=${(x + offset2).toFixed(1)} y=${(y2 - 12).toFixed(1)} text-anchor="middle" font-size="10" font-weight="700" fill=${HIST_LINE2} style=${{ pointerEvents: 'none' }}>${d2.totalLps.toFixed(2)}</text>`}
              </g>
            `;
          })}
        </svg>
      </div>
    </div>
  `;
}

function HistoryCompareTable({ days1, days2, label1, label2 }) {
  const map1 = {}; days1.forEach((d) => { map1[d.dateKey] = d; });
  const map2 = {}; days2.forEach((d) => { map2[d.dateKey] = d; });
  const allKeys = Array.from(new Set([...days1.map((d) => d.dateKey), ...days2.map((d) => d.dateKey)])).sort();

  return html`
    <${Card}>
      <${CardHeader}><${CardTitle}>Таблица сравнения<//><//>
      <${CardContent} tight>
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Дата</th>
                <th style=${{ color: HIST_LINE1 }}>${label1}, л/с</th>
                <th style=${{ color: HIST_LINE2 }}>${label2}, л/с</th>
                <th>Разница, л/с</th>
              </tr>
            </thead>
            <tbody>
              ${allKeys.map((dk) => {
                const d1 = map1[dk], d2 = map2[dk];
                const v1 = d1 && d1.totalLps != null ? d1.totalLps : null;
                const v2 = d2 && d2.totalLps != null ? d2.totalLps : null;
                const diff = (v1 != null && v2 != null) ? Math.round((v1 - v2) * 100) / 100 : null;
                return html`
                  <tr key=${dk}>
                    <td>${shortMonitoringDate(dk)}</td>
                    <td class="mono" style=${{ color: HIST_LINE1, fontWeight: v1 != null ? 700 : 400 }}>${v1 != null ? v1.toFixed(2) : '—'}</td>
                    <td class="mono" style=${{ color: HIST_LINE2, fontWeight: v2 != null ? 700 : 400 }}>${v2 != null ? v2.toFixed(2) : '—'}</td>
                    <td class="mono" style=${diff != null ? { color: diff > 0 ? HIST_LINE1 : diff < 0 ? HIST_LINE2 : 'var(--text-tertiary)' } : undefined}>${diff != null ? (diff > 0 ? '+' : '') + diff.toFixed(2) : '—'}</td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      <//>
    <//>
  `;
}

function HistoryTab({ points }) {
  const [point1, setPoint1] = useState('');
  const [point2, setPoint2] = useState('');
  const [clickedDay, setClickedDay] = useState(null);
  const [clickedCompare, setClickedCompare] = useState(null);

  const pointOptions = useMemo(() => {
    const nums = new Set();
    (points || []).forEach((p) => { if (p.point_number) nums.add(String(p.point_number)); });
    return Array.from(nums).sort((a, b) => {
      const na = parseFloat(a), nb = parseFloat(b);
      return (Number.isNaN(na) || Number.isNaN(nb)) ? a.localeCompare(b) : na - nb;
    });
  }, [points]);

  const days1 = useMemo(() => histAggregateByDay((points || []).filter((p) => String(p.point_number) === point1)), [points, point1]);
  const days2 = useMemo(() => histAggregateByDay((points || []).filter((p) => String(p.point_number) === point2)), [points, point2]);

  useEffect(() => { setClickedDay(null); setClickedCompare(null); }, [point1, point2]);

  const compareMode = !!(point2 && days2.length);
  const label1 = point1 ? `Точка №${point1}` : '';
  const label2 = point2 ? `Точка №${point2}` : '';

  function onSingleDayClick(d) { setClickedDay((cur) => (cur === d.dateKey ? null : d.dateKey)); }
  const clickedDayObj = clickedDay ? days1.find((d) => d.dateKey === clickedDay) : null;

  return html`
    <div>
      <${Card} style=${{ marginBottom: '16px' }}>
        <${CardContent}>
          <div class="anl-hist-selectors">
            <div class="field">
              <label class="field-label"><span class="anl-hist-line-sw" style=${{ background: HIST_LINE1 }} /> Точка 1</label>
              <${Select} value=${point1} onChange=${(e) => setPoint1(e.target.value)} style=${{ minWidth: '180px' }}>
                <option value="">— выберите точку —</option>
                ${pointOptions.map((n) => html`<option key=${n} value=${n}>Точка №${n}</option>`)}
              <//>
            </div>
            <div class="field">
              <label class="field-label"><span class="anl-hist-line-sw anl-hist-line-sw-dash" style=${{ borderColor: HIST_LINE2 }} /> Точка 2 <span class="anl-hist-cmp-hint">— для сравнения</span></label>
              <${Select} value=${point2} onChange=${(e) => setPoint2(e.target.value)} style=${{ minWidth: '180px' }}>
                <option value="">— выберите точку —</option>
                ${pointOptions.filter((n) => n !== point1).map((n) => html`<option key=${n} value=${n}>Точка №${n}</option>`)}
              <//>
            </div>
            ${point2 && html`<${Button} variant="outline" size="sm" onClick=${() => setPoint2('')}>✕ Сброс<//>`}
          </div>
        <//>
      <//>

      ${!point1 && !point2 ? html`
        <${Card}><${CardContent}><div class="anl-empty">Выберите точку для просмотра истории замеров</div><//><//>
      ` : html`
        <div class="anl-hist-layout">
          <${Card}>
            <${CardHeader}><${CardTitle}>График водопритока<//><//>
            <${CardContent}>
              ${compareMode
                ? html`<${HistoryCompareChart} days1=${days1} days2=${days2} label1=${label1} label2=${label2} onMarkerClick=${(day, label, color) => setClickedCompare({ day, label, color })} />`
                : html`<${HistorySingleChart} days=${days1} clickedDayKey=${clickedDay} onDayClick=${onSingleDayClick} />`}
            <//>
          <//>
          <div class="anl-hist-side">
            ${compareMode
              ? (clickedCompare && html`<${Card}><${CardContent}><${HistoryDayDetail} day=${clickedCompare.day} label=${clickedCompare.label} color=${clickedCompare.color} /><//><//>`)
              : (clickedDayObj && html`<${Card}><${CardContent}><${HistoryDayDetail} day=${clickedDayObj} /><//><//>`)}
          </div>
        </div>
        ${compareMode && html`<div style=${{ marginTop: '16px' }}><${HistoryCompareTable} days1=${days1} days2=${days2} label1=${label1} label2=${label2} /></div>`}
      `}
    </div>
  `;
}

// ═════════════════════════ Вкладка «Сводка» ═════════════════════════

function SummaryTab({ points, wells, measByWell, dates, currentPts, roundDate, compareDate }) {
  const ptsForDate = useCallback((date) => (points || []).filter((p) => (p.monitoring_date || '').slice(0, 10) === date), [points]);

  const wellsQForDate = useCallback((date) => {
    if (!date) return 0;
    let q = 0;
    wells.forEach((w) => {
      const windowed = wellMeasurementsInRound(measByWell[w.id], date, dates);
      if (windowed.length) {
        const f = parseFloat(windowed[windowed.length - 1].flow_rate);
        if (!Number.isNaN(f) && f > 0) q += f;
      }
    });
    return q;
  }, [wells, measByWell, dates]);

  const buildPeriods = useCallback((n) => dates.slice(0, n).map((d) => {
    const pts = ptsForDate(d);
    const byStatus = {};
    pts.forEach((p) => { const s = p.status || 'Неизвестно'; byStatus[s] = (byStatus[s] || 0) + 1; });
    return { date: d, count: pts.length, totalQ: sumQ(pts), byStatus };
  }).reverse(), [dates, ptsForDate]);

  const periods8 = useMemo(() => buildPeriods(8), [buildPeriods]);
  const periods12 = useMemo(() => buildPeriods(12), [buildPeriods]);
  const periods7 = useMemo(() => buildPeriods(7), [buildPeriods]);
  const periods13 = useMemo(() => buildPeriods(13), [buildPeriods]);

  const kpi = useMemo(() => {
    const prevPts = compareDate ? ptsForDate(compareDate) : [];
    const tQ = sumQ(currentPts), pQ = sumQ(prevPts);
    const wellsQ = wellsQForDate(roundDate), prevWellsQ = compareDate ? wellsQForDate(compareDate) : 0;
    const combinedQ = tQ + wellsQ / 3.6;
    const prevCombinedQ = pQ + prevWellsQ / 3.6;
    const qDiff = prevCombinedQ > 0 ? ((combinedQ - prevCombinedQ) / prevCombinedQ) * 100 : null;

    const active = currentPts.filter((p) => p.status === 'Активная').length;
    const drying = currentPts.filter((p) => p.status === 'Иссякает').length;
    const prevDrying = prevPts.filter((p) => p.status === 'Иссякает').length;

    const refDate = dates[1] || '';
    const refPts = refDate ? ptsForDate(refDate) : currentPts;
    const refCount = Math.max(new Set(refPts.map((p) => p.point_number)).size, 1);
    const currCount = new Set(currentPts.map((p) => p.point_number)).size;
    const coverage = Math.min(100, Math.round((currCount / refCount) * 100));

    return {
      total: currentPts.length, active, drying, prevDrying, coverage, refCount, currCount,
      totalQ: tQ, wellsQ, combinedQ, qDiff,
      qVals: periods8.map((p) => p.totalQ), dryVals: periods8.map((p) => p.byStatus['Иссякает'] || 0), covVals: periods8.map((p) => p.count),
    };
  }, [currentPts, compareDate, roundDate, dates, ptsForDate, wellsQForDate, periods8]);

  const alerts = useMemo(() => {
    const curMap = {}, prevMap = {};
    currentPts.forEach((p) => { curMap[p.point_number] = p; });
    const prevDate = dates[1] || '';
    const prevPts = prevDate ? ptsForDate(prevDate) : [];
    prevPts.forEach((p) => { prevMap[p.point_number] = p; });

    const list = [];
    const risers = [];
    Object.keys(curMap).forEach((num) => {
      const c = parseFloat(curMap[num].flow_rate);
      const pv = prevMap[num] ? parseFloat(prevMap[num].flow_rate) : NaN;
      if (!Number.isNaN(c) && !Number.isNaN(pv) && pv > 0 && c > pv * 1.3) risers.push({ num, pct: Math.round(((c - pv) / pv) * 100) });
    });
    risers.sort((a, b) => b.pct - a.pct);
    if (risers.length) {
      const top = risers.slice(0, 3).map((r) => `№${r.num} (+${r.pct}%)`).join(', ');
      list.push({ level: 'danger', icon: AlertTriangle, title: `Резкий рост дебита: ${top}`, desc: `${risers.length} точек требуют проверки` });
    }
    const missing = Object.keys(prevMap).filter((num) => !curMap[num]);
    if (missing.length) list.push({ level: 'warning', icon: AlertTriangle, title: `${missing.length} точек не замерено в этом обходе`, desc: `№${missing.slice(0, 5).join(', №')}${missing.length > 5 ? '…' : ''}`, missing });
    const driers = Object.keys(curMap).filter((num) => curMap[num].status === 'Иссякает' && prevMap[num] && prevMap[num].status === 'Активная');
    if (driers.length) list.push({ level: 'warning', icon: TrendingDown, title: `${driers.length} точек: «Активная» → «Иссякает»`, desc: driers.slice(0, 4).map((n) => `№${n}`).join(', ') });
    const tQ = sumQ(currentPts), pQ = sumQ(prevPts);
    if (pQ > 0 && tQ < pQ * 0.9) list.push({ level: 'success', icon: TrendingDown, title: `Дебит снизился на ${Math.round(((pQ - tQ) / pQ) * 100)}%`, desc: 'Относительно предыдущего обхода · позитивная динамика' });
    if (!list.length) list.push({ level: 'success', icon: CheckCircle2, title: 'Аномалий не обнаружено', desc: 'Все показатели в норме' });
    return list;
  }, [currentPts, dates, ptsForDate]);

  return html`
    <div>
      <div class="grid grid-4" style=${{ marginBottom: '16px' }}>
        <${AnlKpiCard} label="Всего точек" value=${kpi.total} sub=${`активных: ${kpi.active}`} trend=${html`<span class="anl-trend-eq">→ без изм.</span>`} values=${kpi.covVals} color="var(--blue-500)" />
        <${AnlKpiCard} label="Суммарный дебит" value=${kpi.combinedQ.toFixed(2)} unit="л/с" sub=${`точки: ${kpi.totalQ.toFixed(2)} л/с${kpi.wellsQ > 0 ? ` · скважины: ${kpi.wellsQ.toFixed(2)} м³/ч` : ''} · ${lpsToM3h(kpi.combinedQ).toFixed(2)} м³/ч`} trend=${html`<${TrendLabel} diff=${kpi.qDiff} goodWhen="down" />`} values=${kpi.qVals} color="var(--gold-500)" />
        <${AnlKpiCard} label="Иссякающих" value=${kpi.drying} sub=${`было ${kpi.prevDrying} в прошлом обходе`}
          trend=${kpi.prevDrying > kpi.drying
            ? html`<span class="anl-trend-good">↓ −${kpi.prevDrying - kpi.drying} улучшение</span>`
            : kpi.prevDrying < kpi.drying
              ? html`<span class="anl-trend-bad">↑ +${kpi.drying - kpi.prevDrying}</span>`
              : html`<span class="anl-trend-eq">→</span>`}
          values=${kpi.dryVals} color="var(--amber-500)" />
        <${AnlKpiCard} label="Покрытие обхода" value=${kpi.coverage} unit="%" sub=${`${kpi.currCount} из ${kpi.refCount} точек`}
          trend=${kpi.coverage < 100 ? html`<span class="anl-trend-eq">→ цель: 100%</span>` : html`<span class="anl-trend-good">✓ Полное</span>`}
          values=${kpi.covVals} color="var(--green-500)" />
      </div>

      <div class="grid grid-2" style=${{ marginBottom: '16px', alignItems: 'stretch' }}>
        <${Card}>
          <${CardHeader}><${CardTitle}>Суммарный дебит по обходам<//><//>
          <${CardContent}><${TrendChart} periods=${periods12} roundDate=${roundDate} compareDate=${compareDate} /><//>
        <//>
        <${Card}>
          <${CardHeader}><${CardTitle}>Требует внимания<//><//>
          <${CardContent}><${AlertsPanel} alerts=${alerts} /><//>
        <//>
      </div>

      <div class="grid grid-2">
        <${Card}>
          <${CardHeader}><${CardTitle}>Изменение статусов по обходам<//><//>
          <${CardContent}><${StatusBarsChart} periods=${periods7} roundDate=${roundDate} /><//>
        <//>
        <${Card}>
          <${CardHeader}><${CardTitle} subtitle="Последние 13 обходов">Покрытие мониторинга<//><//>
          <${CardContent}><${CoverageHeatmap} periods=${periods13} currentPts=${currentPts} roundDate=${roundDate} /><//>
        <//>
      </div>
    </div>
  `;
}

function ComingSoonTab({ title, description }) {
  return html`
    <${Card}>
      <${CardContent}>
        <${EmptyState} icon=${html`<${Hammer} size=${40} />`} title=${title} description=${description} />
      <//>
    <//>
  `;
}

// ═════════════════════════ Страница ═════════════════════════

export function StatsPage({ quarry }) {
  const { points, wells, measByWell, error } = useAnalyticsData(quarry);
  const [tab, setTab] = useState('summary');
  const [roundDate, setRoundDate] = useState('');
  const [compareDate, setCompareDate] = useState('');
  const [domainFilter, setDomainFilter] = useState('all');
  const [workerFilter, setWorkerFilter] = useState('all');
  const initedRef = useRef(false);

  const dates = useMemo(() => {
    const set = new Set();
    (points || []).forEach((p) => { const d = (p.monitoring_date || '').slice(0, 10); if (d) set.add(d); });
    return Array.from(set).sort().reverse();
  }, [points]);

  useEffect(() => { initedRef.current = false; }, [quarry]);
  useEffect(() => {
    if (initedRef.current || !dates.length) return;
    initedRef.current = true;
    setRoundDate(dates[0]);
    setCompareDate(dates[1] || '');
    setDomainFilter('all');
    setWorkerFilter('all');
  }, [dates]);

  const domains = useMemo(() => Array.from(new Set((points || []).map((p) => p.domain).filter(Boolean))).sort(), [points]);
  const workers = useMemo(() => Array.from(new Set((points || []).map((p) => p.worker).filter(Boolean))).sort(), [points]);

  const currentPts = useMemo(() => {
    let pts = (points || []).filter((p) => (p.monitoring_date || '').slice(0, 10) === roundDate);
    if (domainFilter !== 'all') pts = pts.filter((p) => p.domain === domainFilter);
    if (workerFilter !== 'all') pts = pts.filter((p) => p.worker === workerFilter);
    return pts;
  }, [points, roundDate, domainFilter, workerFilter]);

  const showFilterBar = tab === 'summary' || tab === 'domains' || tab === 'wells';
  const loading = points === null;

  return html`
    <div>
      <div class="page-header">
        <div>
          <div class="page-title">Аналитика</div>
          <div class="page-desc">Динамика мониторинга водопроявлений: обходы, домены, скважины, история, канавы.</div>
        </div>
      </div>

      ${error && html`<div style=${{ color: 'var(--red-500)', fontSize: '13px', marginBottom: '12px' }}>Ошибка: ${error}</div>`}

      <div style=${{ marginBottom: '16px' }}>
        <${Tabs}
          tabs=${[
            { value: 'summary', label: 'Сводка' },
            { value: 'domains', label: 'Домены' },
            { value: 'wells', label: 'Скважины' },
            { value: 'history', label: 'История' },
            { value: 'ditches', label: 'Канавы', badge: 'скоро' },
          ]}
          value=${tab} onChange=${setTab}
        />
      </div>

      ${showFilterBar && !loading && html`
        <${Card} style=${{ marginBottom: '16px' }}>
          <div class="anl-filter-bar">
            <div class="field"><label class="field-label">Обход</label>
              <${Select} value=${roundDate} onChange=${(e) => setRoundDate(e.target.value)} style=${{ minWidth: '160px' }}>
                ${dates.map((d, i) => html`<option key=${d} value=${d}>${formatMonitoringDate(d)}${i === 0 ? ' (тек.)' : ''}</option>`)}
              <//>
            </div>
            <div class="field"><label class="field-label">Сравнить с</label>
              <${Select} value=${compareDate} onChange=${(e) => setCompareDate(e.target.value)} style=${{ minWidth: '160px' }}>
                <option value="">— без сравнения —</option>
                ${dates.filter((d) => d !== roundDate).map((d) => html`<option key=${d} value=${d}>${formatMonitoringDate(d)}</option>`)}
              <//>
            </div>
            <div class="field"><label class="field-label">Домен</label>
              <${Select} value=${domainFilter} onChange=${(e) => setDomainFilter(e.target.value)} style=${{ minWidth: '140px' }}>
                <option value="all">Все домены</option>
                ${domains.map((d) => html`<option key=${d} value=${d}>${d}</option>`)}
              <//>
            </div>
            <div class="field"><label class="field-label">Сотрудник</label>
              <${Select} value=${workerFilter} onChange=${(e) => setWorkerFilter(e.target.value)} style=${{ minWidth: '140px' }}>
                <option value="all">Все сотрудники</option>
                ${workers.map((w) => html`<option key=${w} value=${w}>${w}</option>`)}
              <//>
            </div>
            <${Button} variant="ghost" size="sm" icon title="Сбросить фильтры" onClick=${() => { setDomainFilter('all'); setWorkerFilter('all'); }}><${RotateCcw} size=${15} /><//>
            <span class="anl-chip">${formatMonitoringDate(roundDate)} · ${currentPts.length} замеров</span>
            <div class="anl-filter-bar-actions">
              <${Button} variant="outline" size="sm" onClick=${() => exportPointsCsv(currentPts)} disabled=${!currentPts.length}><${Download} size=${14} /> CSV<//>
              <${Button} variant="outline" size="sm" onClick=${() => exportPointsXlsx(currentPts)} disabled=${!currentPts.length}><${FileSpreadsheet} size=${14} /> Excel<//>
            </div>
          </div>
        <//>
      `}

      ${loading ? html`
        <div class="grid grid-4" style=${{ marginBottom: '16px' }}>${[0, 1, 2, 3].map((i) => html`<${Card} key=${i}><div class="kpi-card"><${Skeleton} width="60%" height="11px" /><${Skeleton} width="40%" height="26px" style=${{ marginTop: '4px' }} /></div><//>`)}</div>
        <${Skeleton} height="260px" />
      ` : html`
        ${tab === 'summary' && html`<${SummaryTab} points=${points} wells=${wells} measByWell=${measByWell} dates=${dates} currentPts=${currentPts} roundDate=${roundDate} compareDate=${compareDate} />`}
        ${tab === 'domains' && html`<${DomainsTab} points=${points} dates=${dates} domains=${domains} currentPts=${currentPts} compareDate=${compareDate} />`}
        ${tab === 'wells' && html`<${WellsTab} wells=${wells} measByWell=${measByWell} roundDate=${roundDate} dates=${dates} />`}
        ${tab === 'history' && html`<${HistoryTab} points=${points} />`}
        ${tab === 'ditches' && html`<${ComingSoonTab} title="Раздел «Канавы» — скоро" description="Список канав, история водопритока и 2D/3D-визуализация сечения появятся на следующем этапе." />`}
      `}
    </div>
  `;
}
