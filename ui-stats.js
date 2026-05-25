/**
 * ui-stats.js — страница аналитики.
 * Зависит от: ui-utils.js, Points, Workers, WellsState
 */

// ════════════════════════════════════════════════════════════
// НОВАЯ АНАЛИТИЧЕСКАЯ ПАНЕЛЬ
// ════════════════════════════════════════════════════════════

var _anlDate    = '';   // выбранный обход (YYYY-MM-DD)
var _anlCompare = '';   // сравниваемый обход
var _anlDomain  = 'all';
var _anlWorker  = 'all';

// ── Вспомогательные ─────────────────────────────────────────

function _anlPtsForDate(date) {
  return Points.getList().filter(function(p) {
    return (p.monitoringDate || '').slice(0, 10) === date;
  });
}

function _anlCurrentPts() {
  var pts = _anlPtsForDate(_anlDate);
  if (_anlDomain !== 'all') pts = pts.filter(function(p) { return p.domain === _anlDomain; });
  if (_anlWorker !== 'all') pts = pts.filter(function(p) { return p.worker === _anlWorker; });
  return pts;
}

function _anlTotalQ(pts) {
  var q = 0;
  pts.forEach(function(p) { var f = parseFloat(p.flowRate); if (!isNaN(f) && f > 0) q += f; });
  return q;
}

function _anlPeriods(n) {
  return getAllMonitoringDates().slice(0, n).map(function(d) {
    var pts = _anlPtsForDate(d);
    var byStatus = {};
    pts.forEach(function(p) { var s = p.status || 'Неизвестно'; byStatus[s] = (byStatus[s] || 0) + 1; });
    return { date: d, pts: pts, totalQ: _anlTotalQ(pts), byStatus: byStatus, count: pts.length };
  });
}

function _anlGetDomains() {
  var set = {};
  Points.getList().forEach(function(p) { if (p.domain) set[p.domain] = true; });
  return Object.keys(set).sort();
}

function _anlSparkPoints(values, w, h) {
  if (!values.length) return '';
  var max = Math.max.apply(null, values) || 1;
  var step = w / Math.max(values.length - 1, 1);
  return values.map(function(v, i) {
    return (i * step).toFixed(1) + ',' + ((1 - v / max) * h * 0.85 + h * 0.075).toFixed(1);
  }).join(' ');
}

// Converts "x1,y1 x2,y2 ..." coordinate string into a smooth Catmull-Rom bezier SVG path
function _anlPtsToSmooth(ptsStr) {
  if (!ptsStr) return '';
  var coords = ptsStr.trim().split(' ').map(function(p) {
    var xy = p.split(',');
    return { x: parseFloat(xy[0]), y: parseFloat(xy[1]) };
  }).filter(function(c) { return !isNaN(c.x) && !isNaN(c.y); });
  if (!coords.length) return '';
  if (coords.length === 1) return 'M' + coords[0].x.toFixed(1) + ',' + coords[0].y.toFixed(1);
  var d = 'M' + coords[0].x.toFixed(1) + ',' + coords[0].y.toFixed(1);
  for (var i = 0; i < coords.length - 1; i++) {
    var p0 = coords[Math.max(i - 1, 0)];
    var p1 = coords[i];
    var p2 = coords[i + 1];
    var p3 = coords[Math.min(i + 2, coords.length - 1)];
    var cp1x = p1.x + (p2.x - p0.x) / 6;
    var cp1y = p1.y + (p2.y - p0.y) / 6;
    var cp2x = p2.x - (p3.x - p1.x) / 6;
    var cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ' C' + cp1x.toFixed(1) + ',' + cp1y.toFixed(1) + ' ' + cp2x.toFixed(1) + ',' + cp2y.toFixed(1) + ' ' + p2.x.toFixed(1) + ',' + p2.y.toFixed(1);
  }
  return d;
}

// Returns well measurements that fall within the monitoring period for a given date
function _anlGetWellMeasurementsForDate(meas, date) {
  if (!meas || !date) return [];
  var dates = getAllMonitoringDates(); // newest first
  var idx = dates.indexOf(date);
  var prevDate = (idx >= 0 && idx < dates.length - 1) ? dates[idx + 1] : '';
  return meas.filter(function(m) {
    var d = (m.measurementDate || '').slice(0, 10);
    return d <= date && (prevDate === '' || d > prevDate);
  });
}

// Loads measurements for all wells that haven't been fetched yet
function _anlEnsureWellMeasurements() {
  var wells = (typeof WellsState !== 'undefined') ? WellsState.list : [];
  if (!wells.length) return Promise.resolve();
  var toLoad = wells.filter(function(w) { return !WellsState.measurements[w.id]; });
  if (!toLoad.length) return Promise.resolve();
  return Promise.all(toLoad.map(function(w) {
    return Api.getWellMeasurements(w.id).then(function(meas) {
      WellsState.measurements[w.id] = meas;
    }).catch(function() {
      WellsState.measurements[w.id] = [];
    });
  }));
}

// ── Инициализация фильтров ───────────────────────────────────

function initStatsFilters() {
  var periodSel  = document.getElementById('anl-period');
  var compareSel = document.getElementById('anl-compare');
  var domainSel  = document.getElementById('anl-domain');
  var workerSel  = document.getElementById('anl-worker');
  if (!periodSel) return;

  var dates = getAllMonitoringDates();

  // Период
  var savedPeriod = _anlDate || (dates[0] || '');
  periodSel.innerHTML = dates.map(function(d, i) {
    return '<option value="' + d + '"' + (d === savedPeriod ? ' selected' : '') + '>' +
      formatMonitoringDate(d) + (i === 0 ? ' (тек.)' : '') + '</option>';
  }).join('') || '<option value="">— нет данных —</option>';
  _anlDate = periodSel.value || savedPeriod;

  // Сравнение
  var savedCompare = _anlCompare || (dates[1] || '');
  compareSel.innerHTML = '<option value="">— без сравнения —</option>' +
    dates.filter(function(d) { return d !== _anlDate; }).map(function(d) {
      return '<option value="' + d + '"' + (d === savedCompare ? ' selected' : '') + '>' +
        formatMonitoringDate(d) + '</option>';
    }).join('');
  if (!_anlCompare && dates[1]) { _anlCompare = dates[1]; compareSel.value = dates[1]; }

  // Домены
  var domains = _anlGetDomains();
  domainSel.innerHTML = '<option value="all">Все домены</option>' + domains.map(function(d) {
    return '<option value="' + d + '"' + (d === _anlDomain ? ' selected' : '') + '>' + escHTML(d) + '</option>';
  }).join('');

  // Сотрудники
  var workerSet = {};
  Points.getList().forEach(function(p) { if (p.worker) workerSet[p.worker] = true; });
  workerSel.innerHTML = '<option value="all">Все сотрудники</option>' + Object.keys(workerSet).sort().map(function(w) {
    return '<option value="' + escAttr(w) + '"' + (w === _anlWorker ? ' selected' : '') + '>' + escHTML(w) + '</option>';
  }).join('');

  // Чип
  var chip = document.getElementById('anl-chip');
  if (chip) chip.textContent = formatMonitoringDate(_anlDate) + ' · ' + _anlCurrentPts().length + ' замеров';

  // Привязка событий (один раз)
  if (periodSel._anlBound) return;
  periodSel._anlBound = true;

  periodSel.addEventListener('change',  function() { _anlDate    = this.value; renderStatsPage(); });
  compareSel.addEventListener('change', function() { _anlCompare = this.value; renderStatsPage(); });
  domainSel.addEventListener('change',  function() { _anlDomain  = this.value; renderStatsPage(); });
  workerSel.addEventListener('change',  function() { _anlWorker  = this.value; renderStatsPage(); });

  var resetBtn = document.getElementById('anl-reset');
  if (resetBtn) resetBtn.addEventListener('click', function() {
    _anlDomain = 'all'; _anlWorker = 'all';
    domainSel.value = 'all'; workerSel.value = 'all';
    renderStatsPage();
  });

  var btnCsv = document.getElementById('btn-export-csv');
  var btnXls = document.getElementById('btn-export-xlsx');
  if (btnCsv) btnCsv.addEventListener('click', function() { exportPointsCSV(_anlCurrentPts()); });
  if (btnXls) btnXls.addEventListener('click', function() { exportPointsXLSX(_anlCurrentPts()); });
}

// Возвращает актуальную палитру статусов — единый источник из MapModule
function getStatusPalette() {
  var palette = { 'Неизвестно': '#8f9aae' };
  if (typeof MapModule !== 'undefined') {
    var cfg = MapModule.getStyleConfig();
    if (cfg && cfg.statusColors) {
      Object.keys(cfg.statusColors).forEach(function(s) {
        palette[s] = cfg.statusColors[s];
      });
    }
  }
  return palette;
}

function renderStatsPage() {
  initStatsFilters();
  _anlRenderKpis();
  _anlRenderTrend();
  _anlRenderAlerts();
  _anlRenderStatusBars();
  _anlRenderCoverage();
  _anlRenderDomains();
  _anlRenderMatrix();
  _anlRenderWalls();
  _anlRenderHorizons();
  _anlRenderWells();
  _anlEnsureWellMeasurements().then(function() {
    _anlRenderWells();
    _anlRenderKpis();
  });
}

// ── KPI-строка ───────────────────────────────────────────────
function _anlRenderKpis() {
  var el = document.getElementById('anl-kpi-grid');
  if (!el) return;
  var pts     = _anlCurrentPts();
  var prevPts = _anlCompare ? _anlPtsForDate(_anlCompare) : [];

  var totalQ = _anlTotalQ(pts);
  var prevQ  = _anlTotalQ(prevPts);

  // Wells Q for the current and previous monitoring period
  var wells = (typeof WellsState !== 'undefined') ? WellsState.list : [];
  var wellsQ = 0, prevWellsQ = 0;
  wells.forEach(function(w) {
    var meas = WellsState.measurements[w.id];
    if (meas) {
      var wm = _anlGetWellMeasurementsForDate(meas, _anlDate);
      if (wm.length) { var f = parseFloat(wm[wm.length - 1].flowRate); if (!isNaN(f) && f > 0) wellsQ += f; }
      if (_anlCompare) {
        var pm = _anlGetWellMeasurementsForDate(meas, _anlCompare);
        if (pm.length) { var pf = parseFloat(pm[pm.length - 1].flowRate); if (!isNaN(pf) && pf > 0) prevWellsQ += pf; }
      }
    }
  });
  // wellsQ is in м³/ч (well measurements are stored in м³/ч, not л/с)
  // Convert to л/с before combining with points totalQ (which is in л/с)
  var combinedQ     = totalQ + wellsQ / 3.6;
  var prevCombinedQ = prevQ  + prevWellsQ / 3.6;
  var qDiff  = prevCombinedQ > 0 ? ((combinedQ - prevCombinedQ) / prevCombinedQ * 100) : null;

  var active = pts.filter(function(p) { return p.status === 'Активная' || p.status === 'Паводковая' || p.status === 'Перелив'; }).length;
  var drying = pts.filter(function(p) { return p.status === 'Иссякает'; }).length;
  var prevDrying = prevPts.filter(function(p) { return p.status === 'Иссякает'; }).length;

  // Покрытие: текущий обход vs предыдущий
  var allDates  = getAllMonitoringDates();
  var refDate   = allDates[1] || '';
  var refNums   = {}; (refDate ? _anlPtsForDate(refDate) : pts).forEach(function(p) { refNums[p.pointNumber] = true; });
  var currNums  = {}; pts.forEach(function(p) { currNums[p.pointNumber] = true; });
  var refCount  = Math.max(Object.keys(refNums).length, 1);
  var coverage  = Math.min(100, Math.round(Object.keys(currNums).length / refCount * 100));

  var periods8  = _anlPeriods(8).reverse();
  var qVals     = periods8.map(function(p) { return p.totalQ; });
  var dryVals   = periods8.map(function(p) { return p.byStatus['Иссякает'] || 0; });
  var covVals   = periods8.map(function(p) { return p.count; });

  function trendHtml(diff, invertColor) {
    if (diff === null) return '<span class="anl-eq">→</span>';
    var up = invertColor ? 'anl-dn' : 'anl-up';
    var dn = invertColor ? 'anl-up' : 'anl-dn';
    if (diff > 5)  return '<span class="' + up + '">↑ +' + diff.toFixed(0) + '%</span>';
    if (diff < -5) return '<span class="' + dn + '">↓ ' + diff.toFixed(0) + '%</span>';
    return '<span class="anl-eq">→ стабильно</span>';
  }

  function kpi(lbl, val, sub, trend, sparkPts, color, areaClr) {
    var sp = sparkPts ? sparkPts : '';
    var linePath = sp ? _anlPtsToSmooth(sp) : '';
    var poly = linePath ? '<path d="' + linePath + '" fill="none" stroke="' + color + '" stroke-width="1.8"/>' : '';
    var area = '';
    if (linePath) {
      var pts2 = sp.trim().split(' ');
      var lastX = pts2[pts2.length - 1].split(',')[0];
      area = '<path d="' + linePath + ' L' + lastX + ',32 L0,32 Z" fill="' + areaClr + '" stroke="none"/>';
    }
    return '<div class="anl-kpi">' +
      '<div class="anl-kpi-lbl">' + lbl + '</div>' +
      '<div class="anl-kpi-val" style="color:' + color + '">' + val + '</div>' +
      '<div class="anl-kpi-sub">' + sub + '</div>' +
      '<div class="anl-kpi-trend">' + trend + '</div>' +
      '<svg class="anl-spark" viewBox="0 0 120 32">' + area + poly + '</svg>' +
    '</div>';
  }

  var qSubParts = ['точки: ' + totalQ.toFixed(2) + ' л/с'];
  if (wellsQ > 0) qSubParts.push('скважины: ' + wellsQ.toFixed(2) + ' м³/ч');

  el.innerHTML =
    kpi('Всего точек', pts.length,
        'активных: ' + active,
        '<span class="anl-eq">→ без изм.</span>',
        _anlSparkPoints(covVals, 120, 32), '#58a6ff', 'rgba(88,166,255,.07)') +
    kpi('Суммарный дебит', combinedQ.toFixed(2) + ' <small>л/с</small>',
        qSubParts.join(' · ') + ' · ' + lpsToM3h(combinedQ).toFixed(2) + ' м³/ч',
        trendHtml(qDiff, false),
        _anlSparkPoints(qVals, 120, 32), '#f9ab00', 'rgba(249,171,0,.07)') +
    kpi('Иссякающих', drying,
        'было ' + prevDrying + ' в прошлом обходе',
        prevDrying > drying ? '<span class="anl-dn">↓ −' + (prevDrying - drying) + ' улучшение</span>' :
        prevDrying < drying ? '<span class="anl-up">↑ +' + (drying - prevDrying) + '</span>' : '<span class="anl-eq">→</span>',
        _anlSparkPoints(dryVals, 120, 32), '#3fb950', 'rgba(63,185,80,.07)') +
    kpi('Покрытие обхода', coverage + '<small>%</small>',
        Object.keys(currNums).length + ' из ' + refCount + ' точек',
        coverage < 100 ? '<span class="anl-eq">→ цель: 100%</span>' : '<span class="anl-dn">✓ Полное</span>',
        _anlSparkPoints(covVals, 120, 32), '#bc8cff', 'rgba(188,140,255,.07)');
}

// ── Тренд дебита ─────────────────────────────────────────────
function _anlRenderTrend() {
  var el = document.getElementById('anl-trend');
  if (!el) return;
  var periods = _anlPeriods(12).reverse();
  if (!periods.length) { el.innerHTML = '<p style="color:var(--txt-3);font-size:12px;padding:20px">Нет данных</p>'; return; }

  var maxQ = (Math.max.apply(null, periods.map(function(p) { return p.totalQ; })) || 1) * 1.2;
  var W = 680, H = 170, PL = 44, PR = 12, PT = 10, PB = 28;
  var cW = W - PL - PR, cH = H - PT - PB;
  var n  = periods.length;

  function px(i) { return PL + (i / Math.max(n - 1, 1)) * cW; }
  function py(q)  { return PT + (1 - q / maxQ) * cH; }

  var ySteps = [0, maxQ / 3, 2 * maxQ / 3, maxQ];
  var grid = ySteps.map(function(q) {
    var y = py(q).toFixed(1);
    return '<line x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y + '" stroke="rgba(255,255,255,.05)" stroke-width="1"/>' +
           '<text x="' + (PL - 4) + '" y="' + (parseFloat(y) + 3) + '" fill="var(--txt-3)" font-size="9" text-anchor="end">' + q.toFixed(1) + '</text>';
  }).join('');

  var linePts = periods.map(function(p, i) { return px(i).toFixed(1) + ',' + py(p.totalQ).toFixed(1); }).join(' ');
  var smoothLine = _anlPtsToSmooth(linePts);
  var areaPts = smoothLine + ' L' + px(n - 1).toFixed(1) + ',' + (PT + cH) + ' L' + PL + ',' + (PT + cH) + ' Z';

  // Dots with pulse ring on current date point
  var dots = periods.map(function(p, i) {
    var isCur = p.date === _anlDate, isCmp = p.date === _anlCompare;
    var cx = px(i).toFixed(1), cy = py(p.totalQ).toFixed(1);
    var fill = isCmp ? 'var(--data-gold)' : 'var(--gold)';
    var out = '';
    if (isCur) {
      out += '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="none" stroke="var(--gold)" stroke-width="1.5" opacity=".5">' +
             '<animate attributeName="r" values="5;10;5" dur="2.2s" repeatCount="indefinite"/>' +
             '<animate attributeName="opacity" values=".5;.08;.5" dur="2.2s" repeatCount="indefinite"/>' +
             '</circle>';
    }
    out += '<circle class="anl-tr-dot" data-i="' + i + '" cx="' + cx + '" cy="' + cy + '" r="' + (isCur ? 4.5 : 2.5) + '" fill="' + fill + '"' + (isCur ? ' stroke="var(--bg-0)" stroke-width="1.5"' : '') + '/>';
    return out;
  }).join('');

  // Invisible hover rects for tooltip
  var halfGap = cW / Math.max(n - 1, 1) / 2;
  var hoverRects = periods.map(function(p, i) {
    var x = px(i);
    return '<rect class="anl-tr-hit" data-i="' + i + '" x="' + (x - halfGap).toFixed(1) + '" y="' + PT + '" width="' + (halfGap * 2).toFixed(1) + '" height="' + cH + '" fill="transparent" style="cursor:crosshair"/>';
  }).join('');

  var step = Math.ceil(n / 7);
  var xLbls = periods.map(function(p, i) {
    if (i % step !== 0 && i !== n - 1) return '';
    var isCurDate = p.date === _anlDate;
    return '<text x="' + px(i).toFixed(1) + '" y="' + (H - 5) + '" fill="' + (isCurDate ? 'var(--gold)' : 'var(--txt-3)') +
           '" font-size="8" text-anchor="middle" font-weight="' + (isCurDate ? '700' : '400') + '">' +
           formatMonitoringDate(p.date).replace(/\s\d{4}/, '') + '</text>';
  }).join('');

  // Legend above chart (HTML) — built as part of outer container
  var legendHtml =
    '<div style="display:flex;align-items:center;justify-content:space-between;' +
    'margin-bottom:4px;font-size:10px;color:var(--txt-2)">' +
      '<div style="display:flex;gap:14px;align-items:center">' +
        '<span style="display:flex;align-items:center;gap:5px">' +
          '<span style="display:inline-block;width:18px;height:2px;background:var(--gold);vertical-align:middle"></span>' +
          'текущий обход' +
        '</span>' +
        (_anlCompare ?
          '<span style="display:flex;align-items:center;gap:5px;color:var(--data-gold)">' +
            '<span style="display:inline-block;width:18px;height:2px;background:var(--data-gold);vertical-align:middle"></span>' +
            'сравниваемый' +
          '</span>' : '') +
      '</div>' +
      '<span style="color:var(--txt-3)">Последние ' + n + ' обходов</span>' +
    '</div>';

  el.innerHTML = legendHtml + '<div style="position:relative">' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block">' +
    '<defs><linearGradient id="anlTG" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0%" stop-color="var(--gold)" stop-opacity=".22"/><stop offset="100%" stop-color="var(--gold)" stop-opacity="0"/>' +
    '</linearGradient></defs>' +
    grid +
    '<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (PT + cH) + '" stroke="rgba(255,255,255,.05)" stroke-width="1"/>' +
    '<line id="anl-trend-xhair" x1="0" y1="' + PT + '" x2="0" y2="' + (PT + cH) +
    '" stroke="rgba(34,211,238,.25)" stroke-width="1" stroke-dasharray="3,3" opacity="0" style="pointer-events:none"/>' +
    '<path d="' + areaPts + '" fill="url(#anlTG)"/>' +
    '<path d="' + smoothLine + '" fill="none" stroke="var(--gold)" stroke-width="2"/>' +
    dots + xLbls +
    '<text x="14" y="' + (PT + cH / 2) + '" fill="var(--txt-3)" font-size="9" text-anchor="middle" transform="rotate(-90 14 ' + (PT + cH / 2) + ')">л/с</text>' +
    hoverRects +
    '</svg>' +
    '<div class="chart-tooltip chart-tooltip-card" id="anl-trend-tip"></div>' +
    '</div>';

  // Wire up tooltip + crosshair
  var tip    = el.querySelector('#anl-trend-tip');
  var svgEl  = el.querySelector('svg');
  var xhair  = svgEl.querySelector('#anl-trend-xhair');
  el.querySelectorAll('.anl-tr-hit').forEach(function(rect) {
    rect.addEventListener('mouseenter', function() {
      var i = parseInt(this.getAttribute('data-i'));
      var p = periods[i];
      if (!p || !tip) return;

      // Crosshair
      if (xhair) { xhair.setAttribute('x1', px(i).toFixed(1)); xhair.setAttribute('x2', px(i).toFixed(1)); xhair.setAttribute('opacity', '1'); }

      // Delta vs previous period in series
      var prevP = i > 0 ? periods[i - 1] : null;
      var delta = prevP ? (p.totalQ - prevP.totalQ) : null;
      var deltaHtml = '';
      if (delta !== null && Math.abs(delta) > 0.001) {
        var up = delta >= 0;
        var dClr = up ? 'var(--bad)' : 'var(--ok)';
        deltaHtml = '<div style="margin-top:6px;padding-top:5px;border-top:1px solid var(--line-2);' +
          'font-size:10px;color:' + dClr + '">' +
          (up ? '▲ +' : '▼ ') + Math.abs(delta).toFixed(2) + ' л/с к пред. обходу</div>';
      }

      var scale = svgEl.offsetWidth / W;
      var domX  = px(i) * scale;
      var domY  = py(p.totalQ) * scale;

      tip.innerHTML =
        '<div class="chart-tooltip-head">' + formatMonitoringDate(p.date) + '</div>' +
        '<div class="chart-tooltip-big">' + p.totalQ.toFixed(2) +
          ' <span style="font-size:11px;font-weight:400;color:var(--txt-2)">л/с</span></div>' +
        '<div class="chart-tooltip-sub">' + lpsToM3h(p.totalQ).toFixed(2) + ' м³/ч · ' + p.count + ' т.</div>' +
        deltaHtml;

      var tipW = 155;
      tip.style.left = (domX + tipW > svgEl.offsetWidth ? domX - tipW - 4 : domX + 8) + 'px';
      tip.style.top  = Math.max(0, domY - 44) + 'px';
      tip.classList.add('visible');
    });
    rect.addEventListener('mouseleave', function() { if (tip) tip.classList.remove('visible'); });
  });
}

// ── Алерты ───────────────────────────────────────────────────
function _anlRenderAlerts() {
  var el = document.getElementById('anl-alerts');
  if (!el) return;

  var curPts   = _anlCurrentPts();
  var prevDate = getAllMonitoringDates()[1] || '';
  var prevPts  = prevDate ? _anlPtsForDate(prevDate) : [];
  var curMap = {}, prevMap = {};
  curPts.forEach(function(p)  { curMap[p.pointNumber]  = p; });
  prevPts.forEach(function(p) { prevMap[p.pointNumber] = p; });

  var alerts = [];

  // Резкий рост дебита
  var risers = [];
  Object.keys(curMap).forEach(function(num) {
    var c = parseFloat(curMap[num].flowRate);
    var pv = prevMap[num] ? parseFloat(prevMap[num].flowRate) : NaN;
    if (!isNaN(c) && !isNaN(pv) && pv > 0 && c > pv * 1.3)
      risers.push({ num: num, pct: Math.round((c - pv) / pv * 100) });
  });
  risers.sort(function(a, b) { return b.pct - a.pct; });
  if (risers.length) {
    var top = risers.slice(0, 3).map(function(r) { return '№' + r.num + ' (+' + r.pct + '%)'; }).join(', ');
    alerts.push({ cls: 'err', ico: '🔴', ttl: 'Резкий рост дебита: ' + top, desc: risers.length + ' точек требуют проверки' });
  }

  // Незамеренные точки
  var missing = Object.keys(prevMap).filter(function(num) { return !curMap[num]; });
  if (missing.length)
    alerts.push({ cls: 'warn', ico: '🟡', ttl: missing.length + ' точек не замерено в этом обходе',
      desc: '№' + missing.slice(0, 5).join(', №') + (missing.length > 5 ? '...' : '') });

  // Смена статуса → Иссякает
  var driers = Object.keys(curMap).filter(function(num) {
    return curMap[num].status === 'Иссякает' && prevMap[num] && prevMap[num].status === 'Активная';
  });
  if (driers.length)
    alerts.push({ cls: 'warn', ico: '🟡', ttl: driers.length + ' точек: «Активная» → «Иссякает»',
      desc: driers.slice(0, 4).map(function(n) { return '№' + n; }).join(', ') });

  // Снижение суммарного дебита (хорошая новость)
  var tQ = _anlTotalQ(curPts), pQ = _anlTotalQ(prevPts);
  if (pQ > 0 && tQ < pQ * 0.9)
    alerts.push({ cls: 'ok', ico: '🟢', ttl: 'Дебит снизился на ' + Math.round((pQ - tQ) / pQ * 100) + '%',
      desc: 'Относительно предыдущего обхода · позитивная динамика' });

  if (!alerts.length)
    alerts.push({ cls: 'ok', ico: '🟢', ttl: 'Аномалий не обнаружено', desc: 'Все показатели в норме' });

  var html = alerts.map(function(a) {
    return '<div class="anl-alert anl-alert-' + a.cls + '">' +
      '<div class="anl-alert-ico">' + a.ico + '</div>' +
      '<div><div class="anl-alert-ttl">' + escHTML(a.ttl) + '</div>' +
      '<div class="anl-alert-desc">' + escHTML(a.desc) + '</div></div></div>';
  }).join('');

  if (missing.length) {
    html += '<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.06)">' +
      '<div style="font-size:10px;color:var(--txt-3);margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">Незамеренные точки</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:4px">' +
      missing.slice(0, 10).map(function(n) { return '<span class="anl-pill anl-pill-r">№' + escHTML(n) + '</span>'; }).join('') +
      (missing.length > 10 ? '<span class="anl-pill anl-pill-gray">+' + (missing.length - 10) + '</span>' : '') +
      '</div></div>';
  }

  el.innerHTML = html;
}

// ── Стекованные статусы ──────────────────────────────────────
function _anlRenderStatusBars() {
  var el = document.getElementById('anl-status-bars');
  if (!el) return;
  var periods = _anlPeriods(7).reverse();
  if (!periods.length) { el.innerHTML = ''; return; }

  var statuses = ['Активная', 'Паводковая', 'Иссякает', 'Пересохла', 'Новая'];
  var clrs     = { 'Активная': '#3fb950', 'Паводковая': '#58a6ff', 'Иссякает': '#f9ab00', 'Пересохла': '#ea4335', 'Новая': '#8b949e' };
  var maxTotal = Math.max.apply(null, periods.map(function(p) { return p.count; })) || 1;

  var W = 420, H = 165, PL = 6, PB = 22, PT = 20, PR = 6;
  var cW = W - PL - PR, cH = H - PT - PB;
  var gap = cW / periods.length, barW = Math.max(10, Math.floor(gap * 0.68));

  var bars = '';
  periods.forEach(function(p, i) {
    var x = PL + i * gap + (gap - barW) / 2;
    var isCur = p.date === _anlDate, yOff = PT + cH;
    var topY = yOff;
    statuses.forEach(function(s) {
      var cnt = p.byStatus[s] || 0;
      if (!cnt) return;
      var bH = (cnt / maxTotal) * cH;
      yOff -= bH;
      topY = yOff;
      bars += '<rect x="' + x.toFixed(1) + '" y="' + yOff.toFixed(1) + '" width="' + barW + '" height="' + bH.toFixed(1) + '" fill="' + clrs[s] + '" opacity="' + (isCur ? '1' : '.72') + '" rx="1">' +
              '<title>' + formatMonitoringDate(p.date) + ' · ' + escHTML(s) + ': ' + cnt + '</title></rect>';
    });
    // Total count above bar
    if (p.count > 0)
      bars += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (topY - 2).toFixed(1) + '" fill="' + (isCur ? 'var(--gold)' : 'var(--txt-3)') + '" font-size="8" text-anchor="middle" font-weight="' + (isCur ? '700' : '400') + '">' + p.count + '</text>';
    bars += '<text x="' + (x + barW / 2).toFixed(1) + '" y="' + (H - 5) + '" fill="' + (isCur ? 'var(--gold)' : 'var(--txt-3)') + '" font-size="8" text-anchor="middle">' +
      formatMonitoringDate(p.date).replace(/\s\d{4}/, '') + '</text>';
    if (isCur)
      bars += '<rect x="' + (x - 1).toFixed(1) + '" y="' + (PT + (1 - p.count / maxTotal) * cH - 2).toFixed(1) + '" width="' + (barW + 2) + '" height="' + (p.count / maxTotal * cH + 2).toFixed(1) + '" fill="none" stroke="rgba(34,211,238,.35)" stroke-width="1.5" rx="2"/>';
  });

  var legHtml = '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:6px">' + statuses.map(function(s) {
    return '<span style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--txt-2)">' +
      '<span style="width:9px;height:9px;border-radius:2px;background:' + clrs[s] + ';display:inline-block"></span>' + escHTML(s) + '</span>';
  }).join('') + '</div>';

  el.innerHTML = '<div style="position:relative"><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block">' +
    '<line x1="' + PL + '" y1="' + (PT + cH) + '" x2="' + (W - PR) + '" y2="' + (PT + cH) + '" stroke="rgba(255,255,255,.06)" stroke-width="1"/>' +
    bars + '</svg></div>' + legHtml;
}

// ── Тепловой календарь покрытия ──────────────────────────────
function _anlRenderCoverage() {
  var el = document.getElementById('anl-coverage');
  if (!el) return;
  var periods  = _anlPeriods(13).reverse();
  var maxCount = Math.max.apply(null, periods.map(function(p) { return p.count; })) || 1;

  var cells = periods.map(function(p) {
    var alpha = Math.max(0.05, p.count / maxCount).toFixed(2);
    var isCur = p.date === _anlDate;
    return '<div title="' + escAttr(formatMonitoringDate(p.date)) + ': ' + p.count + ' замеров" style="aspect-ratio:1;border-radius:3px;background:rgba(63,185,80,' + alpha + ');' + (isCur ? 'outline:2px solid rgba(88,166,255,.6);outline-offset:1px' : '') + '"></div>';
  }).join('');

  // Сотрудники текущего обхода
  var curPts = _anlCurrentPts(), wcnt = {};
  curPts.forEach(function(p) { var w = p.worker || '—'; wcnt[w] = (wcnt[w] || 0) + 1; });
  var topW = Object.keys(wcnt).sort(function(a, b) { return wcnt[b] - wcnt[a]; }).slice(0, 3);
  var maxW = topW.length ? wcnt[topW[0]] : 1;

  var wRows = topW.map(function(w) {
    var pct = Math.round(wcnt[w] / maxW * 100);
    return '<div class="anl-pb-row">' +
      '<span class="anl-pb-lbl">' + escHTML((w + '').split(' ')[0]) + '</span>' +
      '<div class="anl-pb-trk"><div style="width:' + pct + '%;height:100%;border-radius:3px;background:#58a6ff"></div></div>' +
      '<span style="font-size:11px;color:var(--txt-2)">' + wcnt[w] + '</span></div>';
  }).join('');

  var missed = periods.filter(function(p) { return p.count === 0; }).length;
  var avg    = periods.length ? Math.round(periods.reduce(function(s, p) { return s + p.count; }, 0) / periods.length) : 0;

  el.innerHTML =
    '<div style="font-size:10px;color:var(--txt-3);margin-bottom:6px">Интенсивность замеров (темнее = больше)</div>' +
    '<div style="display:grid;grid-template-columns:repeat(13,1fr);gap:3px;margin-bottom:8px">' + cells + '</div>' +
    '<div style="display:flex;gap:4px;align-items:center;font-size:10px;color:var(--txt-3);margin-bottom:10px">' +
      '<span>Меньше</span>' +
      '<div style="width:10px;height:10px;border-radius:2px;background:rgba(63,185,80,.06)"></div>' +
      '<div style="width:10px;height:10px;border-radius:2px;background:rgba(63,185,80,.35)"></div>' +
      '<div style="width:10px;height:10px;border-radius:2px;background:rgba(63,185,80,.7)"></div>' +
      '<div style="width:10px;height:10px;border-radius:2px;background:rgba(63,185,80,1)"></div>' +
      '<span>Больше</span>' +
      (missed ? '<span style="margin-left:8px;color:#ea4335">⚠ ' + missed + ' пропуск(а)</span>' : '') +
    '</div>' +
    '<div style="font-size:10px;color:var(--txt-2);margin-bottom:5px;text-transform:uppercase;letter-spacing:.05em">По сотруднику (тек. обход)</div>' +
    wRows +
    '<div style="font-size:11px;color:var(--txt-3);margin-top:8px">Среднее: ' + avg + ' замеров/обход</div>';
}

// ── Карточки доменов ─────────────────────────────────────────
function _anlRenderDomains() {
  var el = document.getElementById('anl-domain-cards');
  if (!el) return;
  var pts  = _anlCurrentPts();
  var prev = _anlCompare ? _anlPtsForDate(_anlCompare) : [];
  var domains = _anlGetDomains();
  if (!domains.length) { el.innerHTML = ''; return; }

  var clrs = { 'Активная': '#3fb950', 'Паводковая': '#58a6ff', 'Иссякает': '#f9ab00', 'Пересохла': '#ea4335' };

  el.innerHTML = domains.map(function(d) {
    var dPts = pts.filter(function(p) { return p.domain === d; });
    var prevQ = _anlTotalQ(prev.filter(function(p) { return p.domain === d; }));
    var q = _anlTotalQ(dPts);
    var diff = prevQ > 0 ? ((q - prevQ) / prevQ * 100) : null;
    var isAlert = diff !== null && diff > 15;
    var trendTxt = diff === null ? '' : diff > 5 ? ' · <span class="anl-up">↑ +' + diff.toFixed(0) + '%</span>' :
      diff < -5 ? ' · <span class="anl-dn">↓ ' + diff.toFixed(0) + '%</span>' : ' · <span class="anl-eq">→</span>';
    var bars = ['Активная', 'Иссякает', 'Пересохла'].map(function(s) {
      var cnt = dPts.filter(function(p) { return p.status === s; }).length;
      var pct = dPts.length ? Math.round(cnt / dPts.length * 100) : 0;
      return '<div class="anl-pb-row" style="margin-bottom:2px">' +
        '<span class="anl-pb-lbl" style="font-size:10px">' + escHTML(s.slice(0, 6)) + '.</span>' +
        '<div class="anl-pb-trk"><div style="width:' + pct + '%;height:100%;border-radius:3px;background:' + (clrs[s] || '#8b949e') + '"></div></div>' +
        '<span style="font-size:10px;color:var(--txt-2)">' + cnt + '</span></div>';
    }).join('');
    return '<div class="anl-dc' + (isAlert ? ' anl-dc-alert' : '') + '">' +
      '<div class="anl-dc-name">' + escHTML(d) + ' <span style="font-weight:400;color:var(--txt-2);font-size:10px">' + dPts.length + ' т.</span></div>' +
      '<div class="anl-dc-q" style="color:' + (isAlert ? '#ea4335' : 'var(--gold)') + '">' + q.toFixed(2) + ' л/с</div>' +
      '<div class="anl-dc-sub">' + lpsToM3h(q).toFixed(2) + ' м³/ч' + trendTxt + '</div>' +
      bars + '</div>';
  }).join('');
}

// ── Матрица Домен × Статус ───────────────────────────────────
function _anlRenderMatrix() {
  var el = document.getElementById('anl-matrix');
  if (!el) return;
  var pts = _anlCurrentPts();
  var domains  = _anlGetDomains();
  var statuses = ['Активная', 'Паводковая', 'Иссякает', 'Пересохла'];
  var sClrs    = { 'Активная': '#3fb950', 'Паводковая': '#58a6ff', 'Иссякает': '#f9ab00', 'Пересохла': '#ea4335' };
  if (!domains.length) { el.innerHTML = '<p style="color:var(--txt-3);font-size:12px">Нет данных</p>'; return; }

  var mx = {}, dQ = {}, dTotal = {}, sTot = {};
  domains.forEach(function(d) { mx[d] = {}; dQ[d] = 0; dTotal[d] = 0; });
  pts.forEach(function(p) {
    var d = p.domain || '—', s = p.status || 'Неизвестно';
    if (!mx[d]) { mx[d] = {}; dQ[d] = 0; dTotal[d] = 0; }
    mx[d][s] = (mx[d][s] || 0) + 1; dTotal[d]++;
    var q = parseFloat(p.flowRate); if (!isNaN(q) && q > 0) dQ[d] += q;
    if (statuses.indexOf(s) >= 0) sTot[s] = (sTot[s] || 0) + 1;
  });

  var maxCell = 0;
  domains.forEach(function(d) { statuses.forEach(function(s) { if ((mx[d][s] || 0) > maxCell) maxCell = mx[d][s]; }); });

  function hc(v) {
    if (!v) return 'anl-h0';
    var r = v / (maxCell || 1);
    return r < .15 ? 'anl-h1' : r < .35 ? 'anl-h2' : r < .55 ? 'anl-h3' : r < .75 ? 'anl-h4' : 'anl-h5';
  }

  var hdr = '<tr><th>Домен</th>' + statuses.map(function(s) {
    return '<th style="color:' + sClrs[s] + '">' + escHTML(s.slice(0, 4)) + '.</th>';
  }).join('') + '<th>∑</th><th>Q л/с</th></tr>';

  var rows = domains.map(function(d) {
    return '<tr><td><b>' + escHTML(d.replace(/[Дd]омен-?/i, 'Д-').replace(/[Dd]omen-?/i, 'Д-')) + '</b></td>' +
      statuses.map(function(s) { var v = mx[d][s] || 0; return '<td class="' + hc(v) + '">' + (v || '—') + '</td>'; }).join('') +
      '<td><b>' + dTotal[d] + '</b></td><td style="color:var(--gold)">' + dQ[d].toFixed(2) + '</td></tr>';
  }).join('');

  var foot = '<tr style="background:rgba(255,255,255,.025)"><td><b>∑</b></td>' +
    statuses.map(function(s) { return '<td><b>' + (sTot[s] || 0) + '</b></td>'; }).join('') +
    '<td><b>' + pts.length + '</b></td><td><b>' + _anlTotalQ(pts).toFixed(2) + '</b></td></tr>';

  el.innerHTML = '<div style="overflow-x:auto"><table class="anl-mx"><thead>' + hdr + '</thead><tbody>' + rows + foot + '</tbody></table></div>';
}

// ── Распределение по бортам (роза ветров — секторные клинья) ─
function _anlRenderWalls() {
  var el = document.getElementById('anl-walls');
  if (!el) return;
  var pts = _anlCurrentPts();
  var wallDefs = [
    { key: 'Северный',         lbl: 'С',  lblFull: 'Северный',       angle: -Math.PI / 2,     clr: '#22d3ee' },
    { key: 'Северо-восточный', lbl: 'СВ', lblFull: 'Северо-вост.',   angle: -Math.PI / 4,     clr: '#7ecfff' },
    { key: 'Восточный',        lbl: 'В',  lblFull: 'Восточный',      angle: 0,                 clr: '#ea4335' },
    { key: 'Юго-восточный',    lbl: 'ЮВ', lblFull: 'Юго-вост.',      angle: Math.PI / 4,       clr: '#ff7961' },
    { key: 'Южный',            lbl: 'Ю',  lblFull: 'Южный',          angle: Math.PI / 2,       clr: '#f9ab00' },
    { key: 'Юго-западный',     lbl: 'ЮЗ', lblFull: 'Юго-зап.',       angle: 3 * Math.PI / 4,  clr: '#ffcc57' },
    { key: 'Западный',         lbl: 'З',  lblFull: 'Западный',       angle: Math.PI,           clr: '#3fb950' },
    { key: 'Северо-западный',  lbl: 'СЗ', lblFull: 'Северо-зап.',    angle: -3 * Math.PI / 4, clr: '#85e89d' },
  ];

  var wStats = {};
  wallDefs.forEach(function(w) { wStats[w.key] = { count: 0, q: 0 }; });
  var other = { count: 0, q: 0 };
  pts.forEach(function(p) {
    var w = wallDefs.find(function(wd) { return wd.key === p.wall; });
    var q = parseFloat(p.flowRate) || 0;
    if (w) { wStats[p.wall].count++; wStats[p.wall].q += q; }
    else   { other.count++; other.q += q; }
  });

  var maxQ = Math.max.apply(null, wallDefs.map(function(w) { return wStats[w.key].q; })) || 1;

  // ── Роза ветров: каждый борт — клиновидный сектор 45° ──
  var CX = 120, CY = 120, R = 95;
  var W = 260, H = 260;
  var halfSector = Math.PI / 8; // 22.5° — половина 45° сектора

  // Концентрические кольца (25, 50, 75, 100 %)
  var rings = [.25, .5, .75, 1].map(function(f) {
    return '<circle cx="' + CX + '" cy="' + CY + '" r="' + (R * f).toFixed(1) +
           '" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="1"/>';
  }).join('');

  // Линии направлений (спицы)
  var spokes = wallDefs.map(function(w) {
    var ex = CX + R * Math.cos(w.angle), ey = CY + R * Math.sin(w.angle);
    return '<line x1="' + CX + '" y1="' + CY + '" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) +
           '" stroke="rgba(255,255,255,.06)" stroke-width="1" stroke-dasharray="3,3"/>';
  }).join('');

  // Секторы-клинья
  var sectors = wallDefs.map(function(w) {
    var s = wStats[w.key];
    if (!s.q) return '';
    var r = Math.max(4, (s.q / maxQ) * R);
    var a0 = w.angle - halfSector, a1 = w.angle + halfSector;
    var x0 = (CX + r * Math.cos(a0)).toFixed(2), y0 = (CY + r * Math.sin(a0)).toFixed(2);
    var x1 = (CX + r * Math.cos(a1)).toFixed(2), y1 = (CY + r * Math.sin(a1)).toFixed(2);
    // M center → L start-arc-point → A radius radius 0 small-arc clockwise end-arc-point → Z
    return '<path d="M ' + CX + ' ' + CY +
           ' L ' + x0 + ' ' + y0 +
           ' A ' + r.toFixed(2) + ' ' + r.toFixed(2) + ' 0 0 1 ' + x1 + ' ' + y1 +
           ' Z" fill="' + w.clr + '" opacity="0.88"/>';
  }).join('');

  // Подписи направлений у внешнего края
  var dirLabels = wallDefs.map(function(w) {
    var d = R + 15;
    var lx = (CX + d * Math.cos(w.angle)).toFixed(1);
    var ly = (CY + d * Math.sin(w.angle) + 3.5).toFixed(1);
    var ta = Math.abs(Math.cos(w.angle)) < 0.2 ? 'middle'
           : Math.cos(w.angle) > 0 ? 'start' : 'end';
    return '<text x="' + lx + '" y="' + ly +
           '" fill="var(--txt-2)" font-size="9.5" text-anchor="' + ta +
           '" font-weight="500">' + w.lbl + '</text>';
  }).join('');

  // Центральная точка
  var centerDot = '<circle cx="' + CX + '" cy="' + CY + '" r="2.5" fill="var(--txt-3)"/>';

  var svgHtml =
    '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:240px;max-width:100%;display:block">' +
    rings + spokes + sectors + centerDot + dirLabels +
    '</svg>';

  // Легенда: только борты с Q > 0, по убыванию
  var withQ = wallDefs.filter(function(w) { return wStats[w.key].q > 0; });
  withQ.sort(function(a, b) { return wStats[b.key].q - wStats[a.key].q; });

  var legendHtml = withQ.map(function(w) {
    var s = wStats[w.key];
    var isMax = s.q === maxQ;
    return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;' +
           'border-bottom:1px solid var(--line-2)">' +
      '<span style="width:11px;height:11px;border-radius:2px;flex-shrink:0;background:' + w.clr + '"></span>' +
      '<span style="font-size:12px;font-weight:500;color:var(--txt-1);flex:1">' + escHTML(w.lblFull) + '</span>' +
      '<span style="font-size:12px;font-weight:700;color:var(--txt-1);white-space:nowrap">' +
        s.q.toFixed(1) + ' <span style="font-size:10px;color:var(--txt-3);font-weight:400">л/с</span>' +
        (isMax ? ' <span style="color:var(--bad);font-size:10px">↑↑</span>' : '') +
      '</span>' +
    '</div>';
  }).join('');

  if (other.count)
    legendHtml += '<div style="padding:5px 0;font-size:10px;color:var(--txt-3)">' +
      'Прочие/не указан: ' + other.count + ' т. · ' + other.q.toFixed(2) + ' л/с</div>';

  if (!withQ.length && !pts.length) {
    el.innerHTML = '<p style="color:var(--txt-3);font-size:12px">Нет данных о бортах</p>';
    return;
  }

  el.innerHTML =
    '<div style="display:flex;gap:20px;align-items:flex-start">' +
      '<div style="flex-shrink:0">' + svgHtml + '</div>' +
      '<div style="flex:1;min-width:0;padding-top:6px">' +
        (legendHtml || '<p style="color:var(--txt-3);font-size:12px">Нет данных</p>') +
      '</div>' +
    '</div>';
}

// ── Горизонты ────────────────────────────────────────────────
function _anlRenderHorizons() {
  var el = document.getElementById('anl-horizons');
  if (!el) return;
  var allDates = getAllMonitoringDates();
  var periods  = allDates.slice(0, 3).map(function(d) { return { date: d, pts: _anlPtsForDate(d) }; });
  var curPts   = _anlCurrentPts();

  var horizSet = {};
  curPts.forEach(function(p) { if (p.horizon) horizSet[p.horizon] = true; });
  var horizons = Object.keys(horizSet).sort();
  if (!horizons.length) { el.innerHTML = '<p style="color:var(--txt-3);font-size:12px">Нет данных о горизонтах</p>'; return; }

  function hQ(pts, h) {
    var q = 0;
    pts.forEach(function(p) { if (p.horizon === h) { var f = parseFloat(p.flowRate); if (!isNaN(f) && f > 0) q += f; } });
    return q;
  }

  var maxBarQ = Math.max.apply(null, horizons.map(function(h) { return hQ(curPts, h); })) || 1;

  var hdr = '<tr><th>Горизонт</th>' + periods.map(function(p) {
    return '<th>' + formatMonitoringDate(p.date).replace(/\s\d{4}/, '') + '</th>';
  }).join('') + '<th>↕</th></tr>';

  var rows = horizons.map(function(h) {
    var qs   = periods.map(function(p) { return hQ(p.pts, h); });
    var cur  = qs[0], prev = qs[1] || 0;
    var diff = prev > 0 ? ((cur - prev) / prev * 100) : null;
    var td   = diff === null ? '<span class="anl-eq">—</span>' :
      diff > 5 ? '<span class="anl-up">↑ +' + diff.toFixed(0) + '%</span>' :
      diff < -5 ? '<span class="anl-dn">↓ ' + diff.toFixed(0) + '%</span>' : '<span class="anl-eq">→</span>';
    return '<tr><td><b>' + escHTML(h) + '</b></td>' +
      qs.map(function(q) { return '<td>' + (q > 0 ? q.toFixed(2) : '—') + '</td>'; }).join('') +
      '<td>' + td + '</td></tr>';
  }).join('');

  var bars = horizons.map(function(h) {
    var q = hQ(curPts, h), pct = Math.round(q / maxBarQ * 100);
    var prev = periods[1] ? hQ(periods[1].pts, h) : 0;
    var diff = prev > 0 ? ((q - prev) / prev * 100) : null;
    var clr  = diff !== null && diff > 5 ? '#ea4335' : diff !== null && diff < -5 ? '#3fb950' : '#58a6ff';
    return '<div class="anl-pb-row">' +
      '<span class="anl-pb-lbl">' + escHTML(h) + '</span>' +
      '<div class="anl-pb-trk"><div style="width:' + pct + '%;height:100%;border-radius:3px;background:' + clr + '"></div></div>' +
      '<span style="font-size:10px">' + q.toFixed(2) + '</span></div>';
  }).join('');

  el.innerHTML = '<div style="overflow-x:auto;margin-bottom:10px">' +
    '<table class="anl-tbl"><thead>' + hdr + '</thead><tbody>' + rows + '</tbody></table></div>' + bars;
}

// ── Скважины ─────────────────────────────────────────────────
function _anlRenderWells() {
  var wells = (typeof WellsState !== 'undefined') ? WellsState.list : [];

  // KPI
  var kpiEl = document.getElementById('anl-well-kpi-grid');
  if (kpiEl) {
    var active  = wells.filter(function(w) { return w.status === 'Активная'; }).length;
    var dry     = wells.filter(function(w) { return w.status === 'Сухая'; }).length;
    var depths  = wells.filter(function(w) { return w.depth > 0; }).map(function(w) { return w.depth; });
    var avgD    = depths.length ? Math.round(depths.reduce(function(a, b) { return a + b; }, 0) / depths.length) : 0;
    var wTotalQ = 0;
    wells.forEach(function(w) {
      var meas = WellsState.measurements[w.id];
      if (meas) {
        var wm = _anlGetWellMeasurementsForDate(meas, _anlDate);
        if (wm.length) { var f = parseFloat(wm[wm.length - 1].flowRate); if (!isNaN(f) && f > 0) wTotalQ += f; }
      }
    });
    var loaded = Object.keys(WellsState.measurements).length;

    kpiEl.innerHTML =
      '<div class="anl-kpi"><div class="anl-kpi-lbl">Скважин всего</div><div class="anl-kpi-val" style="color:var(--gold)">' + wells.length + '</div><div class="anl-kpi-sub">' + active + ' акт. · ' + dry + ' сухих</div></div>' +
      '<div class="anl-kpi"><div class="anl-kpi-lbl">Q скважин сумм.</div><div class="anl-kpi-val" style="color:var(--warn)">' + wTotalQ.toFixed(2) + ' <small>м³/ч</small></div><div class="anl-kpi-sub">' + (wTotalQ / 3.6).toFixed(2) + ' л/с · за неделю</div></div>' +
      '<div class="anl-kpi"><div class="anl-kpi-lbl">Средняя глубина</div><div class="anl-kpi-val">' + (avgD || '—') + ' <small>' + (avgD ? 'м' : '') + '</small></div><div class="anl-kpi-sub">мин: ' + (Math.min.apply(null, depths.length ? depths : [0]) || '—') + ' · макс: ' + (Math.max.apply(null, depths.length ? depths : [0]) || '—') + '</div></div>' +
      '<div class="anl-kpi"><div class="anl-kpi-lbl">Замеры загружены</div><div class="anl-kpi-val" style="color:var(--ok)">' + loaded + '</div><div class="anl-kpi-sub">из ' + wells.length + ' скважин</div></div>';
  }

  // Рейтинг скважин
  var listEl = document.getElementById('anl-well-list');
  if (listEl) {
    var sorted = wells.slice().sort(function(a, b) {
      var qa = 0, qb = 0;
      var ma = WellsState.measurements[a.id], mb = WellsState.measurements[b.id];
      if (ma) { var wma = _anlGetWellMeasurementsForDate(ma, _anlDate); if (wma.length) { var fa = parseFloat(wma[wma.length - 1].flowRate); if (!isNaN(fa)) qa = fa; } }
      if (mb) { var wmb = _anlGetWellMeasurementsForDate(mb, _anlDate); if (wmb.length) { var fb = parseFloat(wmb[wmb.length - 1].flowRate); if (!isNaN(fb)) qb = fb; } }
      return qb - qa;
    });
    var sPills = { 'Активная': 'pg', 'Иссякает': 'py', 'Сухая': 'pr' };

    listEl.innerHTML = sorted.slice(0, 8).map(function(w) {
      var meas = WellsState.measurements[w.id];
      var q = 0;
      if (meas) {
        var wm = _anlGetWellMeasurementsForDate(meas, _anlDate);
        if (wm.length) { var fq = parseFloat(wm[wm.length - 1].flowRate); if (!isNaN(fq) && fq > 0) q = fq; }
      }
      var pill = sPills[w.status] || 'p_';
      var spark = '';
      if (meas && meas.length >= 2) {
        var vals = meas.slice(-6).map(function(m) { return parseFloat(m.flowRate) || 0; });
        var maxV = Math.max.apply(null, vals) || 1;
        var spts = vals.map(function(v, i) { return (i / (vals.length - 1) * 70).toFixed(1) + ',' + ((1 - v / maxV) * 20 + 1).toFixed(1); }).join(' ');
        var sclr = vals[vals.length - 1] >= vals[0] ? '#ea4335' : '#3fb950';
        spark = '<svg viewBox="0 0 70 22" width="70" height="22"><path d="' + _anlPtsToSmooth(spts) + '" fill="none" stroke="' + sclr + '" stroke-width="1.8"/></svg>';
      } else {
        spark = '<svg viewBox="0 0 70 22" width="70" height="22"><line x1="0" y1="11" x2="70" y2="11" stroke="rgba(255,255,255,.1)" stroke-width="1.5" stroke-dasharray="3,3"/></svg>';
      }
      return '<div class="anl-wr"><div style="flex:1">' +
        '<div class="anl-wr-name">' + escHTML(w.name) + ' <span class="anl-pill anl-pill-' + pill + '">' + escHTML(w.status || '—') + '</span></div>' +
        '<div class="anl-wr-info">' + (w.depth || '—') + ' м' + (w.azimuth != null ? ' · аз. ' + w.azimuth + '°' : '') + (w.inclination != null ? ' · нак. ' + w.inclination + '°' : '') + '</div>' +
        '</div>' + spark +
        '<div style="text-align:right"><div class="anl-wr-q">' + q.toFixed(2) + '</div><div class="anl-wr-qu">м³/ч</div></div>' +
      '</div>';
    }).join('') || '<p style="color:var(--txt-3);font-size:12px;padding:10px">Нет данных о скважинах</p>';
  }

  // Тренд скважин
  var trendEl = document.getElementById('anl-well-trend');
  if (trendEl) {
    // Фильтруем скважины с ≥2 замерами, сортируем по последнему дебиту (как в рейтинге)
    var withMeas = wells.filter(function(w) {
      return WellsState.measurements[w.id] && WellsState.measurements[w.id].length >= 2;
    });
    withMeas.sort(function(a, b) {
      var ma = WellsState.measurements[a.id], mb = WellsState.measurements[b.id];
      var qa = 0, qb = 0;
      if (ma && ma.length) { var fa = parseFloat(ma[ma.length - 1].flowRate); if (!isNaN(fa)) qa = fa; }
      if (mb && mb.length) { var fb = parseFloat(mb[mb.length - 1].flowRate); if (!isNaN(fb)) qb = fb; }
      return qb - qa;
    });
    withMeas = withMeas.slice(0, 3);

    if (!withMeas.length) {
      var anyLoaded = wells.some(function(w) { return WellsState.measurements[w.id] !== undefined; });
      trendEl.innerHTML = '<p style="color:var(--txt-3);font-size:12px;padding:16px;text-align:center">' +
        (anyLoaded ? 'Недостаточно данных для тренда (нужно ≥2 замера на скважину)' : 'Замеры загружаются…') + '</p>';
      return;
    }

    var clrs = ['#58a6ff', '#3fb950', '#f9ab00'];
    var allD = [];
    withMeas.forEach(function(w) {
      WellsState.measurements[w.id].forEach(function(m) {
        var d = (m.measurementDate || '').slice(0, 10);
        if (d && allD.indexOf(d) < 0) allD.push(d);
      });
    });
    allD.sort();

    var allQ = [];
    withMeas.forEach(function(w) { WellsState.measurements[w.id].forEach(function(m) { var f = parseFloat(m.flowRate); if (!isNaN(f)) allQ.push(f); }); });
    var maxQ = (Math.max.apply(null, allQ) || 1) * 1.15;

    var W = 440, H = 185, PL = 40, PR = 10, PT = 10, PB = 30;
    var cW = W - PL - PR, cH = H - PT - PB;
    var n  = allD.length;
    function px(i) { return PL + (i / Math.max(n - 1, 1)) * cW; }
    function py(q)  { return PT + (1 - q / maxQ) * cH; }

    var grid = [0, maxQ / 2, maxQ].map(function(q) {
      return '<line x1="' + PL + '" y1="' + py(q).toFixed(1) + '" x2="' + (W - PR) + '" y2="' + py(q).toFixed(1) + '" stroke="rgba(255,255,255,.05)" stroke-width="1"/>' +
             '<text x="' + (PL - 4) + '" y="' + (py(q) + 3).toFixed(1) + '" fill="var(--txt-3)" font-size="9" text-anchor="end">' + q.toFixed(1) + '</text>';
    }).join('') +
    '<text x="14" y="' + (PT + cH / 2) + '" fill="var(--txt-3)" font-size="9" text-anchor="middle" transform="rotate(-90 14 ' + (PT + cH / 2) + ')">м³/ч</text>';

    var gradDefs = withMeas.map(function(w, si) {
      var clr = clrs[si];
      return '<linearGradient id="wTG' + si + '" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="' + clr + '" stop-opacity=".18"/>' +
        '<stop offset="100%" stop-color="' + clr + '" stop-opacity="0"/>' +
        '</linearGradient>';
    }).join('');

    var series = withMeas.map(function(w, si) {
      var clr = clrs[si], mMap = {};
      WellsState.measurements[w.id].forEach(function(m) { mMap[(m.measurementDate || '').slice(0, 10)] = parseFloat(m.flowRate) || 0; });
      var validPts = allD.map(function(d, i) { return mMap[d] != null ? { x: px(i), y: py(mMap[d]), q: mMap[d] } : null; }).filter(Boolean);
      var spts = validPts.map(function(pt) { return pt.x.toFixed(1) + ',' + pt.y.toFixed(1); }).join(' ');
      var smoothPath = _anlPtsToSmooth(spts);
      var dashAttr = si > 0 ? ' stroke-dasharray="' + (si * 4 + 4) + ',3"' : '';
      // Area fill
      var lastX = validPts.length ? validPts[validPts.length - 1].x : px(n - 1);
      var firstX = validPts.length ? validPts[0].x : px(0);
      var areaPath = smoothPath + ' L' + lastX.toFixed(1) + ',' + (PT + cH) + ' L' + firstX.toFixed(1) + ',' + (PT + cH) + ' Z';
      // Value label: left-anchored when near right edge to avoid SVG clipping
      var lastPt = validPts.length ? validPts[validPts.length - 1] : null;
      var valLabel = '';
      if (lastPt && lastPt.q > 0) {
        var nearRight = lastPt.x > W - PR - 28;
        var lx = nearRight ? (lastPt.x - 3).toFixed(1) : (lastPt.x + 3).toFixed(1);
        var anchor = nearRight ? 'end' : 'start';
        var ly = Math.max(PT + 8, lastPt.y - 4).toFixed(1);
        valLabel = '<text x="' + lx + '" y="' + ly + '" fill="' + clr + '" font-size="8" font-weight="700" text-anchor="' + anchor + '">' + lastPt.q.toFixed(1) + '</text>';
      }
      return '<path d="' + areaPath + '" fill="url(#wTG' + si + ')"/>' +
             '<path d="' + smoothPath + '" fill="none" stroke="' + clr + '" stroke-width="2"' + dashAttr + '/>' +
             valLabel;
    }).join('');

    var step = Math.ceil(n / 5);
    var xL = allD.filter(function(_, i) { return i % step === 0 || i === n - 1; }).map(function(d) {
      return '<text x="' + px(allD.indexOf(d)).toFixed(1) + '" y="' + (H - PB + 14) + '" fill="var(--txt-3)" font-size="8" text-anchor="middle">' + formatMonitoringDate(d).replace(/\s\d{4}/, '') + '</text>';
    }).join('');

    // Highlight rings at last data point per series
    var rings = withMeas.map(function(w, si) {
      var clr = clrs[si], mMap = {};
      WellsState.measurements[w.id].forEach(function(m) { mMap[(m.measurementDate || '').slice(0, 10)] = parseFloat(m.flowRate) || 0; });
      var validPts = allD.map(function(d, i) { return mMap[d] != null ? { x: px(i), y: py(mMap[d]) } : null; }).filter(Boolean);
      if (!validPts.length) return '';
      var lp = validPts[validPts.length - 1];
      return '<circle cx="' + lp.x.toFixed(1) + '" cy="' + lp.y.toFixed(1) + '" r="6" fill="none" stroke="' + clr + '" stroke-width="1.5" opacity=".45"/>' +
             '<circle cx="' + lp.x.toFixed(1) + '" cy="' + lp.y.toFixed(1) + '" r="3" fill="' + clr + '"/>';
    }).join('');

    // HTML legend above SVG
    var legHtml =
      '<div style="display:flex;align-items:center;justify-content:space-between;' +
      'margin-bottom:4px;font-size:10px;color:var(--txt-2)">' +
        '<div style="display:flex;gap:12px;align-items:center">' +
          withMeas.map(function(w, i) {
            var dashStyle = i > 0 ? 'border-bottom:2px dashed ' + clrs[i] : 'border-bottom:2px solid ' + clrs[i];
            return '<span style="display:flex;align-items:center;gap:5px">' +
              '<span style="display:inline-block;width:18px;height:2px;' + dashStyle + ';vertical-align:middle"></span>' +
              escHTML(w.name) +
            '</span>';
          }).join('') +
        '</div>' +
        '<span style="color:var(--txt-3)">Последние ' + n + ' замеров</span>' +
      '</div>';

    trendEl.innerHTML = legHtml + '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block">' +
      '<defs>' + gradDefs + '</defs>' +
      '<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (PT + cH) + '" stroke="rgba(255,255,255,.05)" stroke-width="1"/>' +
      grid + series + rings + xL + '</svg>';
  }
}

function renderHorizonBreakdown(byHorizon) {
  var keys = Object.keys(byHorizon);
  if (!keys.length) return '<p class="form-hint">Нет точек с указанным горизонтом.</p>';

  // Сортируем: сначала по суммарному дебиту убыванию, затем по количеству
  keys.sort(function(a, b) {
    return byHorizon[b].totalLps - byHorizon[a].totalLps ||
           byHorizon[b].count    - byHorizon[a].count;
  });

  // Считаем максимум для столбца прогресса
  var maxLps = Math.max.apply(null, keys.map(function(k) { return byHorizon[k].totalLps; })) || 1;

  var html =
    '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr style="color:var(--txt-3);border-bottom:1px solid var(--line);font-size:11px;text-transform:uppercase;letter-spacing:.04em">' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Горизонт</th>' +
      '<th style="padding:6px 8px;text-align:center;font-weight:500">Точек</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Σ л/с</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Σ м³/ч</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Ср. л/с</th>' +
      '<th style="padding:6px 8px;min-width:80px;font-weight:500"></th>' +
    '</tr></thead><tbody>';

  keys.forEach(function(h) {
    var d      = byHorizon[h];
    var sumLps = Math.round(d.totalLps * 100) / 100;
    var sumM3h = Math.round(lpsToM3h(d.totalLps) * 100) / 100;
    var avgLps = d.withFlow ? Math.round(d.totalLps / d.withFlow * 100) / 100 : null;
    var barPct = maxLps > 0 ? Math.round(d.totalLps / maxLps * 100) : 0;
    var isUnknown = h === '—';

    html +=
      '<tr style="border-bottom:1px solid rgba(255,255,255,.04)">' +
        '<td style="padding:8px 8px;font-weight:' + (isUnknown ? '400' : '600') + ';color:' + (isUnknown ? 'var(--txt-3)' : 'var(--txt-1)') + '">' +
          (isUnknown ? '— не указан —' : '⛰️ ' + h) +
        '</td>' +
        '<td style="padding:8px;text-align:center;color:var(--txt-1)">' + d.count + '</td>' +
        '<td style="padding:8px;text-align:right;color:#1a73e8;font-weight:600">' + (d.withFlow ? sumLps : '—') + '</td>' +
        '<td style="padding:8px;text-align:right;color:#f9ab00">' + (d.withFlow ? sumM3h : '—') + '</td>' +
        '<td style="padding:8px;text-align:right;color:var(--txt-2)">' + (avgLps != null ? avgLps : '—') + '</td>' +
        '<td style="padding:8px 8px 8px 4px">' +
          '<div style="height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden">' +
            '<div style="height:6px;border-radius:3px;background:#1a73e8;width:' + barPct + '%;transition:width .3s"></div>' +
          '</div>' +
        '</td>' +
      '</tr>';
  });

  html += '</tbody></table>';

  // Итоговая строка если больше одного горизонта с данными
  var totalKeys = keys.filter(function(k){ return k !== '—'; });
  if (totalKeys.length > 1) {
    var grandTotal = totalKeys.reduce(function(acc, k) { return acc + byHorizon[k].totalLps; }, 0);
    var grandCount = totalKeys.reduce(function(acc, k) { return acc + byHorizon[k].count; }, 0);
    html +=
      '<div style="display:flex;gap:16px;padding:10px 8px 4px;border-top:1px solid var(--line);font-size:12px;color:var(--txt-3)">' +
        '<span>Итого по горизонтам: <b style="color:var(--txt-1)">' + grandCount + ' точек</b></span>' +
        '<span><b style="color:#1a73e8">' + Math.round(grandTotal*100)/100 + ' л/с</b> · ' +
        '<b style="color:#f9ab00">' + Math.round(lpsToM3h(grandTotal)*100)/100 + ' м³/ч</b></span>' +
      '</div>';
  }

  return html;
}

function renderPieChart(container, statsObj, palette) {
  if (!container) return;
  var keys  = Object.keys(statsObj).filter(function(k) { return statsObj[k] > 0; });
  var total = keys.reduce(function(acc, k) { return acc + statsObj[k]; }, 0);
  if (!total) {
    container.innerHTML = '<p class="form-hint">Нет данных по выбранному фильтру.</p>';
    return;
  }
  var cx = 90, cy = 90, r = 70;
  var offset  = 0;
  var circles = '';
  keys.forEach(function(k) {
    var val   = statsObj[k];
    var frac  = val / total;
    var len   = frac * (2 * Math.PI * r);
    var color = (palette && palette[k]) ? palette[k] : '#9aa3b2';
    circles += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r +
      '" fill="none" stroke="' + color + '" stroke-width="22" stroke-linecap="butt" ' +
      'stroke-dasharray="' + len.toFixed(2) + ' ' + (2 * Math.PI * r).toFixed(2) + '" ' +
      'stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 90 90)"></circle>';
    offset += len;
  });

  var legend = '<div class="pie-legend">';
  keys.forEach(function(k) {
    var color = (palette && palette[k]) ? palette[k] : '#9aa3b2';
    legend += '<div class="pie-legend-row">' +
      '<span class="pie-legend-name"><span class="pie-legend-dot" style="background:' + color + '"></span>' + k + '</span>' +
      '<b>' + statsObj[k] + '</b></div>';
  });
  legend += '</div>';

  container.innerHTML =
    '<div class="pie-chart-wrap">' +
      '<svg class="pie-chart-svg" viewBox="0 0 180 180" aria-label="Круговая диаграмма">' +
        '<circle cx="90" cy="90" r="70" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="22"></circle>' +
        circles +
        '<text x="90" y="88" text-anchor="middle" fill="#ffd08b" style="font-size:22px;font-weight:800">' + total + '</text>' +
        '<text x="90" y="106" text-anchor="middle" fill="#95a0af" style="font-size:11px">точек</text>' +
      '</svg>' +
      legend +
    '</div>';
}


// ── Экспорт в CSV ─────────────────────────────────────────

function renderExportButton(points) {
  var wrap = document.getElementById('stats-export-wrap');
  if (!wrap) return;

  var label = points.length + ' точек';

  var btnCsv = document.getElementById('btn-export-csv');
  if (btnCsv) {
    btnCsv.textContent = '⬇️ CSV (' + label + ')';
    btnCsv.onclick = function() { exportPointsCSV(points); };
  }

  var btnXls = document.getElementById('btn-export-xlsx');
  if (btnXls) {
    btnXls.textContent = '⬇️ Excel (' + label + ')';
    btnXls.onclick = function() { exportPointsXLSX(points); };
  }
}

function exportPointsCSV(points) {
  if (!points || !points.length) {
    alert('Нет точек для экспорта');
    return;
  }

  // Заголовок
  var cols = [
    'Номер точки', 'Дата мониторинга', 'Сотрудник',
    'Статус', 'Интенсивность', 'Дебит л/с', 'Дебит м³/ч',
    'Цвет воды', 'Борт', 'Домен', 'Горизонт', 'Метод замера',
    'X локальный', 'Y локальный', 'Широта', 'Долгота',
    'Комментарий', 'Есть фото', 'Создана', 'Обновлена'
  ];

  var rows = [cols];

  points.forEach(function(p) {
    var monDate = (p.monitoringDate || '');
    // Нормализуем дату если нужно
    if (monDate.length >= 10 && monDate.indexOf('-') === 4) {
      monDate = monDate.slice(8,10) + '.' + monDate.slice(5,7) + '.' + monDate.slice(0,4);
    }
    var flowLps = p.flowRate != null ? String(p.flowRate).replace('.', ',') : '';
    var flowM3h = p.flowRate != null ? String(lpsToM3h(p.flowRate).toFixed(3)).replace('.', ',') : '';
    var hasPhoto = (p.photoUrls && p.photoUrls[0]) ? 'Да' : 'Нет';

    rows.push([
      p.pointNumber   || '',
      monDate,
      p.worker        || '',
      p.status        || '',
      p.intensity     || '',
      flowLps,
      flowM3h,
      p.waterColor    || '',
      p.wall          || '',
      p.domain        || '',
      p.horizon       || '',
      p.measureMethod || '',
      p.xLocal        != null ? String(p.xLocal).replace('.', ',') : '',
      p.yLocal        != null ? String(p.yLocal).replace('.', ',') : '',
      p.lat           != null ? String(p.lat).replace('.', ',')   : '',
      p.lon           != null ? String(p.lon).replace('.', ',')   : '',
      p.comment       || '',
      hasPhoto,
      formatDate(p.createdAt),
      formatDate(p.updatedAt),
    ]);
  });

  // Строим CSV (кодировка UTF-8 с BOM для корректного открытия в Excel)
  var csv = rows.map(function(row) {
    return row.map(function(cell) {
      var s = String(cell == null ? '' : cell);
      // Экранируем кавычки и оборачиваем если есть спецсимволы
      if (s.indexOf('"') >= 0 || s.indexOf(';') >= 0 || s.indexOf('\n') >= 0) {
        s = '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(';');
  }).join('\r\n');

  // BOM для Excel
  var bom = '﻿';
  var blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  var now  = new Date();
  var ts   = now.getFullYear() + '-' +
             String(now.getMonth()+1).padStart(2,'0') + '-' +
             String(now.getDate()).padStart(2,'0');
  a.href     = url;
  a.download = 'karyer-urg-points-' + ts + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Экспорт в Excel (XLSX через SheetJS) ─────────────────

function exportPointsXLSX(points) {
  if (!points || !points.length) { alert('Нет точек для экспорта'); return; }

  // Загружаем SheetJS если ещё не загружен
  function doExport() {
    var XLSX = window.XLSX;
    if (!XLSX) { alert('Библиотека экспорта не загрузилась. Проверьте интернет.'); return; }

    var now = new Date();
    var ts  = now.getFullYear() + '-' +
              String(now.getMonth()+1).padStart(2,'0') + '-' +
              String(now.getDate()).padStart(2,'0');

    // ── Лист 1: Точки ──────────────────────────────────────
    var headers = [
      'Номер точки', 'Дата мониторинга', 'Сотрудник',
      'Статус', 'Интенсивность', 'Дебит л/с', 'Дебит м³/ч',
      'Цвет воды', 'Борт', 'Домен', 'Горизонт', 'Метод замера',
      'X локальный', 'Y локальный', 'Широта', 'Долгота',
      'Комментарий', 'Есть фото', 'Создана', 'Обновлена'
    ];

    var data = [headers];
    points.forEach(function(p) {
      var monDate = (p.monitoringDate || '');
      if (monDate.length >= 10 && monDate.indexOf('-') === 4) {
        monDate = monDate.slice(8,10) + '.' + monDate.slice(5,7) + '.' + monDate.slice(0,4);
      }
      var flowLps = p.flowRate != null ? p.flowRate : '';
      var flowM3h = p.flowRate != null ? Math.round(lpsToM3h(p.flowRate) * 1000) / 1000 : '';
      data.push([
        p.pointNumber  || '',
        monDate,
        p.worker       || '',
        p.status       || '',
        p.intensity    || '',
        flowLps,
        flowM3h,
        p.waterColor   || '',
        p.wall         || '',
        p.domain       || '',
        p.horizon       || '',
        p.measureMethod || '',
        p.xLocal       != null ? p.xLocal   : '',
        p.yLocal       != null ? p.yLocal   : '',
        p.lat          != null ? p.lat      : '',
        p.lon          != null ? p.lon      : '',
        p.comment      || '',
        (p.photoUrls && p.photoUrls[0]) ? 'Да' : 'Нет',
        formatDate(p.createdAt),
        formatDate(p.updatedAt),
      ]);
    });

    var ws1 = XLSX.utils.aoa_to_sheet(data);

    // Ширина колонок
    var colWidths = [
      {wch:12},{wch:16},{wch:20},{wch:14},{wch:20},
      {wch:10},{wch:10},{wch:14},{wch:18},{wch:10},{wch:14},{wch:22},
      {wch:12},{wch:12},{wch:12},{wch:12},
      {wch:30},{wch:10},{wch:18},{wch:18}
    ];
    ws1['!cols'] = colWidths;

    // Стиль заголовка — жирный
    headers.forEach(function(_, ci) {
      var cellAddr = XLSX.utils.encode_cell({ r:0, c:ci });
      if (!ws1[cellAddr]) return;
      ws1[cellAddr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'D9E1F2' } } };
    });

    // ── Лист 2: Сводка ─────────────────────────────────────
    var byStatus = {}, byDomain = {};
    var totalFlow = 0, withFlow = 0, active = 0;
    points.forEach(function(p) {
      var s = p.status || 'Неизвестно';
      var d = p.domain || '—';
      byStatus[s] = (byStatus[s] || 0) + 1;
      byDomain[d] = (byDomain[d] || 0) + 1;
      var f = parseFloat(p.flowRate);
      if (!isNaN(f)) { totalFlow += f; withFlow++; }
      if (p.status === 'Активная' || p.status === 'Паводковая' || p.status === 'Перелив') active++;
    });

    var summary = [
      ['Параметр', 'Значение'],
      ['Дата выгрузки', ts],
      ['Всего точек', points.length],
      ['Активных точек', active],
      ['Суммарный дебит, л/с', Math.round(totalFlow * 100) / 100],
      ['Суммарный дебит, м³/ч', Math.round(lpsToM3h(totalFlow) * 100) / 100],
      ['Средний дебит, л/с', withFlow ? Math.round(totalFlow / withFlow * 100) / 100 : '—'],
      [],
      ['Статус', 'Количество'],
    ];
    Object.keys(byStatus).sort().forEach(function(s) {
      summary.push([s, byStatus[s]]);
    });
    summary.push([]);
    summary.push(['Домен', 'Количество']);
    Object.keys(byDomain).sort().forEach(function(d) {
      summary.push([d, byDomain[d]]);
    });

    var ws2 = XLSX.utils.aoa_to_sheet(summary);
    ws2['!cols'] = [{wch:30}, {wch:16}];

    // Книга
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Точки');
    XLSX.utils.book_append_sheet(wb, ws2, 'Сводка');

    XLSX.writeFile(wb, 'karyer-urg-' + ts + '.xlsx');
  }

  // Если SheetJS уже загружен — сразу экспортируем
  if (window.XLSX) { doExport(); return; }

  // Иначе — загружаем динамически
  var script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  script.onload = doExport;
  script.onerror = function() { alert('Не удалось загрузить библиотеку Excel. Проверьте интернет.'); };
  document.head.appendChild(script);
}

// ════════════════════════════════════════════════════════════
// АНАЛИТИКА КАНАВ
// ════════════════════════════════════════════════════════════

// ── Инициализация подвкладки ─────────────────────────────
function initDitchStatsTab() {
  // Заполняем фильтр сотрудников
  var workerSel = document.getElementById('ditch-filter-worker');
  if (workerSel) {
    var workers = Workers.getList();
    workerSel.innerHTML = '<option value="all">Все сотрудники</option>';
    workers.forEach(function(w) {
      var opt = document.createElement('option');
      opt.value = w.name; opt.textContent = w.name;
      workerSel.appendChild(opt);
    });
  }
  renderDitchStatsPanel();
}


// ── Поиск канавы по названию ──────────────────────────────
function onDitchNameSearch(input) {
  var val = (input.value || '').trim().toLowerCase();
  var dropdown = document.getElementById('ditch-name-dropdown');
  if (!dropdown) return;

  // Фильтруем список канав
  renderDitchStatsPanel();

  if (!val) {
    dropdown.style.display = 'none';
    return;
  }

  var matches = (typeof DitchState !== 'undefined' ? DitchState.list : [])
    .filter(function(d) {
      return d.ditchName && d.ditchName.toLowerCase().indexOf(val) >= 0;
    })
    .slice(0, 10);

  if (!matches.length) {
    dropdown.style.display = 'none';
    return;
  }

  dropdown.innerHTML = '';
  matches.forEach(function(d) {
    var item = document.createElement('div');
    item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:12px;' +
      'color:var(--txt-1);border-bottom:1px solid rgba(255,255,255,.05);transition:background .1s';
    item.innerHTML = '🌊 <b>' + escAttr(d.ditchName) + '</b>' +
      (d.pointNumber ? '<span style="color:var(--txt-3);margin-left:6px">· T'+escAttr(d.pointNumber)+'</span>' : '') +
      '<span style="float:right;color:var(--gold);font-size:11px">' +
      (d.flowM3h != null ? d.flowM3h.toFixed(2)+' м³/ч' : '') + '</span>';
    item.addEventListener('mouseenter', function(){ this.style.background='rgba(64,144,232,.12)'; });
    item.addEventListener('mouseleave', function(){ this.style.background=''; });
    item.addEventListener('mousedown', function(e) {
      e.preventDefault();
      document.getElementById('ditch-filter-name').value = d.ditchName;
      dropdown.style.display = 'none';
      renderDitchStatsPanel();
    });
    dropdown.appendChild(item);
  });
  dropdown.style.display = '';

  // Закрываем при клике вне
  setTimeout(function() {
    document.addEventListener('click', function hideDrop(ev) {
      if (!dropdown.contains(ev.target) && ev.target !== input) {
        dropdown.style.display = 'none';
        document.removeEventListener('click', hideDrop);
      }
    });
  }, 0);
}

// ── Сброс фильтров ───────────────────────────────────────
function clearDitchFilters() {
  var d = document.getElementById('ditch-filter-date');
  var w = document.getElementById('ditch-filter-worker');
  var n = document.getElementById('ditch-filter-name');
  var dd = document.getElementById('ditch-name-dropdown');
  if (d)  d.value  = '';
  if (w)  w.value  = 'all';
  if (n)  n.value  = '';
  if (dd) dd.style.display = 'none';
  renderDitchStatsPanel();
}

// ── Главный рендер панели ────────────────────────────────
function renderDitchStatsPanel() {
  if (typeof DitchState === 'undefined') return;

  var list = DitchState.list.slice();

  // Фильтры
  var fDate   = (document.getElementById('ditch-filter-date')   || {}).value || '';
  var fWorker = (document.getElementById('ditch-filter-worker') || {}).value || 'all';
  var fName   = ((document.getElementById('ditch-filter-name')  || {}).value || '').trim().toLowerCase();

  if (fDate)             list = list.filter(function(d){ return d.monitoringDate === fDate; });
  if (fWorker !== 'all') list = list.filter(function(d){ return d.worker === fWorker; });
  if (fName)             list = list.filter(function(d){
    return d.ditchName && d.ditchName.toLowerCase().indexOf(fName) >= 0;
  });

  renderDitchKpi(list);
  renderDitchList(list);
}

// ── KPI ──────────────────────────────────────────────────
function renderDitchKpi(list) {
  var grid = document.getElementById('ditch-kpi-grid');
  if (!grid) return;

  var total   = list.length;
  var totalQ  = list.reduce(function(s,d){ return s + (d.flowM3h||0); }, 0);
  var avgQ    = total ? totalQ / total : 0;
  var maxQ    = total ? Math.max.apply(null, list.map(function(d){ return d.flowM3h||0; })) : 0;

  var statuses = {};
  list.forEach(function(d) {
    var s = d.status || 'Активная';
    statuses[s] = (statuses[s]||0) + 1;
  });

  grid.innerHTML =
    kpiCard('Всего канав',    total,           '') +
    kpiCard('Σ Q, м³/ч',     totalQ.toFixed(3),'') +
    kpiCard('Ср. Q, м³/ч',   avgQ.toFixed(3), '') +
    kpiCard('Макс. Q, м³/ч', maxQ.toFixed(3), '');
}

function kpiCard(label, value, sub) {
  return '<div class="stats-kpi-card">' +
    '<div class="stats-kpi-value">' + value + '</div>' +
    '<div class="stats-kpi-label">' + label + '</div>' +
    (sub ? '<div class="stats-kpi-sub">' + sub + '</div>' : '') +
    '</div>';
}

// ── Список канав ─────────────────────────────────────────
function renderDitchList(list) {
  var container = document.getElementById('ditch-list-container');
  if (!container) return;

  if (!list.length) {
    container.innerHTML =
      '<div style="padding:20px;text-align:center;color:var(--txt-3);font-size:12px">' +
      'Нет канав по выбранным фильтрам</div>';
    document.getElementById('ditch-detail-panel').style.display = 'none';
    return;
  }

  // Таблица
  var html = '<div style="overflow-x:auto">' +
    '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
    '<thead><tr>' +
    '<th style="text-align:left;padding:7px 10px;color:var(--txt-3);font-size:10px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--line);font-weight:600">Название</th>' +
    '<th style="text-align:left;padding:7px 10px;color:var(--txt-3);font-size:10px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--line);font-weight:600">Статус</th>' +
    '<th style="text-align:left;padding:7px 10px;color:var(--txt-3);font-size:10px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--line);font-weight:600">Дата</th>' +
    '<th style="text-align:left;padding:7px 10px;color:var(--txt-3);font-size:10px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--line);font-weight:600">Сотрудник</th>' +
    '<th style="text-align:right;padding:7px 10px;color:var(--txt-3);font-size:10px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--line);font-weight:600">S, м²</th>' +
    '<th style="text-align:right;padding:7px 10px;color:var(--txt-3);font-size:10px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--line);font-weight:600">Q, м³/ч</th>' +
    '<th style="padding:7px 10px;border-bottom:1px solid var(--line)"></th>' +
    '</tr></thead><tbody id="ditch-table-body"></tbody></table></div>';

  container.innerHTML = html;

  var tbody = document.getElementById('ditch-table-body');
  var statusColors = {
    'Активная':'#4090e8','Новая':'#40b8ff','Пересохла':'#e8a030','Заилилась':'#8060c0'
  };

  list.forEach(function(d, idx) {
    var tr = document.createElement('tr');
    tr.style.cssText = 'cursor:pointer;transition:background .12s';
    tr.dataset.did = d.id;

    var col = statusColors[d.status] || '#4090e8';
    var dateStr = formatDitchDate(d.monitoringDate);

    tr.innerHTML =
      '<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04)">' +
        '<span style="font-weight:600;color:var(--txt-1)">🌊 ' + escAttr(d.ditchName) + '</span>' +
        (d.pointNumber ? '<span style="font-size:10px;color:var(--txt-3);margin-left:6px">· T' + escAttr(d.pointNumber) + '</span>' : '') +
      '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04)">' +
        '<span style="font-size:11px;padding:2px 8px;border-radius:10px;background:' + col + '1a;color:' + col + ';border:1px solid ' + col + '44">' + escAttr(d.status||'Активная') + '</span>' +
      '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04);color:var(--txt-2)">' + dateStr + '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04);color:var(--txt-2)">' + escAttr(d.worker||'—') + '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04);text-align:right;color:var(--txt-2)">' +
        (d.area != null ? d.area.toFixed(3) : '—') +
      '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04);text-align:right;font-weight:600;color:var(--gold)">' +
        (d.flowM3h != null ? d.flowM3h.toFixed(3) : '—') +
      '</td>' +
      '<td style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04)">' +
        '<button class="btn btn-sm btn-outline" data-did="' + escAttr(d.id) + '" data-dname="' + escAttr(d.ditchName) + '" style="white-space:nowrap">📈 История</button>' +
      '</td>';

    // Клик по строке — показываем детали
    tr.addEventListener('click', function(e) {
      if (e.target.tagName === 'BUTTON') return;
      document.querySelectorAll('#ditch-table-body tr').forEach(function(r){
        r.style.background = '';
      });
      tr.style.background = 'rgba(64,144,232,.08)';
      showDitchDetail(d);
    });

    // Клик по кнопке истории
    tr.querySelector('button').addEventListener('click', function(e) {
      e.stopPropagation();
      var did   = this.dataset.did;
      var dname = this.dataset.dname;
      // Выделяем строку и показываем детали с историей
      document.querySelectorAll('#ditch-table-body tr').forEach(function(r){
        r.style.background = '';
      });
      tr.style.background = 'rgba(64,144,232,.08)';
      var dobj = DitchState.list.find(function(x){ return x.id === did; });
      if (dobj) showDitchDetail(dobj, true);
    });

    tbody.appendChild(tr);
  });
}

// ── Детали выбранной канавы ──────────────────────────────
function showDitchDetail(ditch, autoHistory) {
  var panel = document.getElementById('ditch-detail-panel');
  var title = document.getElementById('ditch-detail-title');
  var info  = document.getElementById('ditch-detail-info');
  if (!panel) return;

  panel.style.display = '';
  title.textContent = '🌊 ' + ditch.ditchName;

  // Параметры
  var velLabels = { single:'Вертушка (одна скорость)', multi:'По точкам', float:'Поплавок' };
  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:12px">';

  function row(label, val) {
    return '<div style="color:var(--txt-3)">' + label + '</div>' +
           '<div style="color:var(--txt-1);font-weight:500">' + val + '</div>';
  }

  html += row('Дата мониторинга', formatDitchDate(ditch.monitoringDate));
  html += row('Сотрудник',        ditch.worker || '—');
  html += row('Статус',           ditch.status || '—');
  if (ditch.pointNumber) html += row('Привязка к точке', 'T' + ditch.pointNumber);
  html += row('Ширина B',         ditch.width != null ? ditch.width.toFixed(3) + ' м' : '—');
  html += row('Метод скорости',   velLabels[ditch.velMethod] || ditch.velMethod || '—');
  html += row('Скорость v',       ditch.velocity != null ? ditch.velocity.toFixed(3) + ' м/с' : '—');
  if (ditch.velMethod === 'float') {
    html += row('L / t / k',
      (ditch.floatL||'—') + ' м / ' + (ditch.floatT||'—') + ' с / ' + (ditch.floatK||'—'));
  }
  html += row('Точек замера',     ditch.nPoints != null ? ditch.nPoints + ' (+ Тн и Тк)' : '—');
  if (ditch.depths && ditch.depths.length) {
    var hStr = ditch.depths.map(function(h){ return (h*100).toFixed(1)+'см'; }).join(', ');
    html += row('Глубины', '[0, ' + hStr + ', 0]');
  }
  html += '</div>';

  // Результаты крупно
  html += '<div style="display:flex;gap:20px;margin-top:14px;padding:12px 16px;' +
    'background:rgba(64,144,232,.07);border:1px solid rgba(64,144,232,.18);border-radius:10px;flex-wrap:wrap">';
  html += '<div><div style="font-size:10px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.06em">Площадь сечения</div>' +
    '<div style="font-size:22px;font-weight:700;color:var(--txt-1)">' + (ditch.area != null ? ditch.area.toFixed(3) : '—') + '</div>' +
    '<div style="font-size:10px;color:var(--txt-3)">м²</div></div>';
  html += '<div><div style="font-size:10px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.06em">Водоприток</div>' +
    '<div style="font-size:22px;font-weight:700;color:#f9ab00">' + (ditch.flowM3h != null ? ditch.flowM3h.toFixed(3) : '—') + '</div>' +
    '<div style="font-size:10px;color:var(--txt-3)">м³/ч</div></div>';
  if (ditch.comment) {
    html += '<div style="flex:1;min-width:160px"><div style="font-size:10px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.06em">Комментарий</div>' +
      '<div style="font-size:12px;color:var(--txt-2);margin-top:4px">' + escAttr(ditch.comment) + '</div></div>';
  }
  html += '</div>';

  // Кнопки действий
  html += '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">';
  html += '<button class="btn btn-sm btn-outline" id="ditch-detail-edit-btn">✏️ Изменить</button>';
  html += '<button class="btn btn-sm btn-outline" id="ditch-detail-hist-btn">📈 Загрузить историю</button>';
  html += '<button class="btn btn-sm btn-outline" id="ditch-detail-del-btn" style="color:var(--red,#e05050);border-color:rgba(224,80,80,.3)">🗑 Удалить</button>';
  html += '</div>';

  info.innerHTML = html;

  // Навешиваем обработчики
  document.getElementById('ditch-detail-edit-btn').addEventListener('click', function() {
    if (typeof openEditDitchForm === 'function') openEditDitchForm(ditch);
  });
  document.getElementById('ditch-detail-hist-btn').addEventListener('click', function() {
    loadDitchHistory(ditch.ditchName);
  });
  document.getElementById('ditch-detail-del-btn').addEventListener('click', function() {
    if (typeof deleteDitch === 'function') {
      deleteDitch(ditch.id, ditch.ditchName);
      // Скрываем панель после удаления
      var panel = document.getElementById('ditch-detail-panel');
      var vizWrap = document.getElementById('ditch-viz-wrap');
      if (panel) panel.style.display = 'none';
      if (vizWrap) vizWrap.style.display = 'none';
      // Обновляем список
      if (typeof renderDitchStatsPanel === 'function') {
        setTimeout(function() { renderDitchStatsPanel(); }, 2500);
      }
    }
  });

  // Показываем визуализацию
  showDitchViz(ditch);

  // Скроллим к деталям
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Автозагрузка истории если запрошена
  if (autoHistory) loadDitchHistory(ditch.ditchName);
}

// ── История канавы (таблица + SVG-график) ────────────────
function loadDitchHistory(ditchName) {
  var chartArea = document.getElementById('ditch-history-chart-area');
  var tableArea = document.getElementById('ditch-history-table');
  if (!chartArea) return;

  chartArea.innerHTML = '<div style="padding:12px;color:var(--txt-3);font-size:12px">Загрузка истории...</div>';

  Api.getDitchHistory(ditchName).then(function(resp) {
    var hist = (resp && resp.history) ? resp.history : [];

    if (!hist.length) {
      chartArea.innerHTML = '<div style="padding:12px;color:var(--txt-3);font-size:12px">История пуста</div>';
      if (tableArea) tableArea.innerHTML = '';
      return;
    }

    // График SVG
    renderDitchHistoryChart(hist, chartArea);

    // Таблица
    var html = '<table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:8px">' +
      '<thead><tr>' +
      '<th style="text-align:left;padding:6px 10px;color:var(--txt-3);font-size:10px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--line)">Дата</th>' +
      '<th style="text-align:left;padding:6px 10px;color:var(--txt-3);font-size:10px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--line)">Сотрудник</th>' +
      '<th style="text-align:left;padding:6px 10px;color:var(--txt-3);font-size:10px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--line)">Метод</th>' +
      '<th style="text-align:right;padding:6px 10px;color:var(--txt-3);font-size:10px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--line)">Ширина, м</th>' +
      '<th style="text-align:right;padding:6px 10px;color:var(--txt-3);font-size:10px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--line)">S, м²</th>' +
      '<th style="text-align:right;padding:6px 10px;color:var(--txt-3);font-size:10px;text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid var(--line)">Q, м³/ч</th>' +
      '</tr></thead><tbody>';

    hist.forEach(function(h) {
      var velNames = { single:'Вертушка', multi:'По точкам', float:'Поплавок' };
      html += '<tr>' +
        '<td style="padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.04);color:var(--txt-2)">' + formatDitchDate(h.monitoringDate) + '</td>' +
        '<td style="padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.04);color:var(--txt-2)">' + escAttr(h.worker||'—') + '</td>' +
        '<td style="padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.04);color:var(--txt-2)">' + (velNames[h.velMethod]||h.velMethod||'—') + '</td>' +
        '<td style="padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.04);text-align:right;color:var(--txt-2)">' + (h.width != null ? h.width.toFixed(2) : '—') + '</td>' +
        '<td style="padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.04);text-align:right;color:var(--txt-2)">' + (h.area != null ? h.area.toFixed(3) : '—') + '</td>' +
        '<td style="padding:6px 10px;border-bottom:1px solid rgba(255,255,255,.04);text-align:right;font-weight:600;color:var(--gold)">' + (h.flowM3h != null ? h.flowM3h.toFixed(3) : '—') + '</td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    if (tableArea) tableArea.innerHTML = html;

  }).catch(function() {
    chartArea.innerHTML = '<div style="padding:12px;color:var(--red);font-size:12px">Ошибка загрузки истории</div>';
  });
}

// ── SVG-график истории канавы ────────────────────────────
function renderDitchHistoryChart(hist, container) {
  var W = container.offsetWidth || 500;
  var H = 160;
  var PAD = { t:18, r:20, b:36, l:54 };
  var cW = W - PAD.l - PAD.r;
  var cH = H - PAD.t - PAD.b;

  var values = hist.map(function(h){ return h.flowM3h || 0; });
  var maxV   = Math.max.apply(null, values) || 1;
  var minV   = 0;

  var drawLen = hist.length === 1 ? 1 : hist.length - 1;
  function px(i) { return PAD.l + (i / Math.max(drawLen, 1)) * cW; }
  function py(v) { return PAD.t + cH - ((v - minV) / (maxV - minV || 1)) * cH; }

  // Линия
  // Если одна точка — дублируем для корректного рисования линии
  var histDraw = hist.length === 1
    ? [hist[0], { monitoringDate: hist[0].monitoringDate, flowM3h: hist[0].flowM3h, worker: hist[0].worker, area: hist[0].area }]
    : hist;

  var points = histDraw.map(function(h, i){ return px(i) + ',' + py(h.flowM3h||0); }).join(' ');

  // Область под линией
  var areaPoints = [PAD.l + ',' + (PAD.t + cH)];
  histDraw.forEach(function(h, i){ areaPoints.push(px(i) + ',' + py(h.flowM3h||0)); });
  areaPoints.push((PAD.l + cW) + ',' + (PAD.t + cH));

  // Подписи X
  var xLabels = '';
  hist.forEach(function(h, i) {
    if (hist.length <= 8 || i % Math.ceil(hist.length/6) === 0) {
      xLabels += '<text x="' + px(i) + '" y="' + (H - 4) + '" text-anchor="middle" ' +
        'fill="var(--txt-3)" font-size="9" font-family="monospace">' +
        formatDitchDate(h.monitoringDate) + '</text>';
    }
  });

  // Подписи Y
  var yLabels = '';
  for (var yi = 0; yi <= 4; yi++) {
    var yv  = minV + (maxV - minV) * yi / 4;
    var yyy = py(yv);
    yLabels += '<text x="' + (PAD.l - 4) + '" y="' + (yyy + 3) + '" text-anchor="end" ' +
      'fill="var(--txt-3)" font-size="9" font-family="monospace">' + yv.toFixed(2) + '</text>';
    if (yi > 0 && yi < 4) {
      yLabels += '<line x1="' + PAD.l + '" y1="' + yyy + '" x2="' + (PAD.l + cW) + '" y2="' + yyy +
        '" stroke="rgba(255,255,255,.05)" stroke-dasharray="3,5"/>';
    }
  }

  // Точки на линии
  var dots = hist.map(function(h, i) {
    return '<circle cx="' + px(i) + '" cy="' + py(h.flowM3h||0) + '" r="5" ' +
      'fill="#f9ab00" stroke="var(--bg,#0f1520)" stroke-width="1.5">' +
      '<title>' + formatDitchDate(h.monitoringDate) + ': ' + (h.flowM3h||0).toFixed(3) + ' м³/ч</title>' +
      '</circle>';
  }).join('');

  var svg = '<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' +
      '<linearGradient id="dg" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#f9ab00" stop-opacity="0.3"/>' +
        '<stop offset="100%" stop-color="#f9ab00" stop-opacity="0.02"/>' +
      '</linearGradient>' +
    '</defs>' +
    '<polygon points="' + areaPoints.join(' ') + '" fill="url(#dg)"/>' +
    '<polyline points="' + points + '" fill="none" stroke="#f9ab00" stroke-width="2" stroke-linejoin="round"/>' +
    dots + yLabels + xLabels +
    '<text x="' + (PAD.l - 4) + '" y="' + (PAD.t - 4) + '" text-anchor="end" fill="var(--txt-3)" font-size="8" font-family="monospace">м³/ч</text>' +
    '</svg>';

  container.innerHTML = svg;
}

// ── Вспомогательная функция форматирования даты ──────────
function formatDitchDate(dateStr) {
  if (!dateStr) return '—';
  var s = String(dateStr).split('T')[0].split(' ')[0];
  if (s.match(/^\d{4}-\d{2}-\d{2}$/)) {
    var p = s.split('-');
    return p[2] + '.' + p[1] + '.' + p[0].slice(2);
  }
  return s;
}


// ════════════════════════════════════════════════════════════
// 2D / 3D ВИЗУАЛИЗАЦИЯ КАНАВЫ В АНАЛИТИКЕ
// ════════════════════════════════════════════════════════════

var _dvMode     = 'section'; // 'section' | 'extrude'
var _dvR3       = null;      // Three.js контекст
var _dvAutoRot  = false;
var _dvCurrent  = null;      // текущая канава

function setDitchVizMode(mode, btn) {
  _dvMode = mode;
  document.querySelectorAll('[id^="btn-dv-"]').forEach(function(b){ b.classList.remove('active'); });
  if (btn) btn.classList.add('active');

  if (mode === 'extrude' && _dvCurrent) {
    // Валидация перед 3D
    var missing = dv3dValidate(_dvCurrent);
    if (missing.length) {
      dv3dShowMissing(missing);
      // Возвращаем кнопку в 2D
      document.querySelectorAll('[id^="btn-dv-"]').forEach(function(b){ b.classList.remove('active'); });
      var btn2d = document.getElementById('btn-dv-section');
      if (btn2d) btn2d.classList.add('active');
      _dvMode = 'section';
      document.getElementById('ditch-viz-2d').style.display = '';
      document.getElementById('ditch-viz-3d').style.display = 'none';
      return;
    }
  }

  // Показываем нужный блок СНАЧАЛА — чтобы canvas имел размеры
  document.getElementById('ditch-viz-2d').style.display = mode === 'section' ? '' : 'none';
  document.getElementById('ditch-viz-3d').style.display = mode === 'extrude'  ? '' : 'none';

  if (mode === 'section' && _dvCurrent) {
    dvDraw2d(_dvCurrent);
  }
  if (mode === 'extrude' && _dvCurrent) {
    // Ждём пока браузер применит display и посчитает offsetWidth
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        dvBuild3d(_dvCurrent);
      });
    });
  }
}

// ── Валидация данных для 3D ──────────────────────────────
function dv3dValidate(ditch) {
  var missing = [];

  if (!ditch.width || ditch.width <= 0) {
    missing.push({ field: 'Ширина канавы (B)', hint: 'Укажите ширину в метрах, напр. 1.2' });
  }

  var depths = Array.isArray(ditch.depths) ? ditch.depths : [];
  var hasRealDepths = depths.length > 0 && depths.some(function(h){ return h > 0; });
  if (!hasRealDepths) {
    missing.push({ field: 'Глубины точек замера', hint: 'Хотя бы одна глубина должна быть больше 0' });
  }

  var hasVel = false;
  if (ditch.velMethod === 'float') {
    if (ditch.floatL > 0 && ditch.floatT > 0 && ditch.floatK > 0) hasVel = true;
    else missing.push({ field: 'Параметры поплавка (L, t, k)', hint: 'Укажите длину замера, время и коэффициент' });
  } else {
    if (ditch.velocity > 0) hasVel = true;
    else missing.push({ field: 'Скорость потока', hint: 'Укажите скорость в м/с (напр. 0.34)' });
  }

  return missing;
}

// ── Показываем окно с недостающими данными ───────────────
function dv3dShowMissing(missing) {
  // Удаляем старое окно если есть
  var old = document.getElementById('dv3d-missing-modal');
  if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'dv3d-missing-modal';
  modal.style.cssText = [
    'position:fixed;top:0;left:0;right:0;bottom:0;',
    'background:rgba(0,0,0,.6);z-index:9999;',
    'display:flex;align-items:center;justify-content:center;',
    'backdrop-filter:blur(4px)'
  ].join('');

  var box = document.createElement('div');
  box.style.cssText = [
    'background:var(--card-bg,#161e2e);',
    'border:1px solid var(--line,rgba(255,255,255,.1));',
    'border-radius:14px;padding:24px 28px;max-width:420px;width:90%;',
    'box-shadow:0 20px 60px rgba(0,0,0,.5)'
  ].join('');

  var html = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">';
  html += '<span style="font-size:22px">⚠️</span>';
  html += '<span style="font-size:15px;font-weight:700;color:var(--txt-1,#f0f4ff)">Недостаточно данных для 3D</span>';
  html += '</div>';
  html += '<p style="font-size:12px;color:var(--txt-3,#8a96b0);margin-bottom:14px">Для построения 3D модели канавы заполните:</p>';

  missing.forEach(function(m) {
    html += '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;';
    html +=   'padding:10px 12px;background:rgba(224,80,80,.08);';
    html +=   'border:1px solid rgba(224,80,80,.2);border-radius:8px">';
    html += '<span style="color:#e05050;font-size:16px;flex-shrink:0">✗</span>';
    html += '<div>';
    html += '<div style="font-size:13px;font-weight:600;color:var(--txt-1,#f0f4ff)">' + m.field + '</div>';
    html += '<div style="font-size:11px;color:var(--txt-3,#8a96b0);margin-top:2px">' + m.hint + '</div>';
    html += '</div></div>';
  });

  html += '<div style="display:flex;gap:8px;margin-top:18px">';
  html += '<button id="dv3d-fill-btn" style="flex:1;padding:10px;border-radius:8px;border:none;';
  html +=   'background:var(--gold,#c8a012);color:#1a1200;font-weight:700;font-size:13px;cursor:pointer">';
  html +=   '✏️ Заполнить данные</button>';
  html += '<button id="dv3d-close-btn" style="padding:10px 16px;border-radius:8px;';
  html +=   'border:1px solid var(--line,rgba(255,255,255,.1));';
  html +=   'background:transparent;color:var(--txt-2,#c0c8d8);font-size:13px;cursor:pointer">';
  html +=   'Закрыть</button>';
  html += '</div>';

  box.innerHTML = html;
  modal.appendChild(box);

  // Кнопки
  box.querySelector('#dv3d-fill-btn').addEventListener('click', function() {
    modal.remove();
    if (typeof openEditDitchForm === 'function' && window._dvCurrent) {
      openEditDitchForm(window._dvCurrent);
    }
  });
  box.querySelector('#dv3d-close-btn').addEventListener('click', function() {
    modal.remove();
  });

  // Клик на фоне закрывает
  modal.addEventListener('click', function(e) {
    if (e.target === modal) modal.remove();
  });

  document.body.appendChild(modal);

  // Сохраняем ссылку на текущую канаву для кнопки "Заполнить"
  window._dvCurrent = _dvCurrent;
}

// ── Показать визуализацию ────────────────────────────────
function showDitchViz(ditch) {
  _dvCurrent = ditch;
  var wrap = document.getElementById('ditch-viz-wrap');
  if (!wrap) return;
  wrap.style.display = '';

  // Рисуем 2D профиль
  dvDraw2d(ditch);

  // Подсвечиваем кнопку 2D
  document.getElementById('btn-dv-section').classList.add('active');
  document.getElementById('btn-dv-extrude').classList.remove('active');
  document.getElementById('ditch-viz-2d').style.display = '';
  document.getElementById('ditch-viz-3d').style.display = 'none';
  _dvMode = 'section';

  setTimeout(function(){
    wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 200);
}

// ── 2D профиль (Canvas) ──────────────────────────────────
function dvDraw2d(ditch) {
  var canvas = document.getElementById('ditch-profile-canvas');
  if (!canvas) return;

  var rawDepths = Array.isArray(ditch.depths) ? ditch.depths : [];
  var allDepths = rawDepths.length ? [0].concat(rawDepths).concat([0]) : [0, 0];
  var B = ditch.width || 1;
  var n = allDepths.length;

  var W  = canvas.parentElement.offsetWidth || 500;
  var H  = Math.max(190, Math.min(240, W * 0.38));
  var dpr = window.devicePixelRatio || 1;
  canvas.width  = W * dpr; canvas.height = H * dpr;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';

  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  var P = { t:30, r:20, b:42, l:56 };
  var cW = W - P.l - P.r, cH = H - P.t - P.b;
  ctx.clearRect(0, 0, W, H);

  // Фон
  ctx.fillStyle = '#0b1020'; ctx.fillRect(0, 0, W, H);

  var mx = Math.max.apply(null, allDepths); if (mx === 0) mx = 0.01;
  var dx = B / (n - 1);

  function cx(i) { return P.l + (i / (n-1)) * cW; }
  function cy(h) { return P.t + (h / mx) * cH; }
  var sy = P.t;

  // Грунт
  ctx.save();
  ctx.beginPath(); ctx.moveTo(cx(0), cy(allDepths[0]));
  allDepths.forEach(function(h,i){ ctx.lineTo(cx(i), cy(h)); });
  ctx.lineTo(cx(n-1), H-P.b); ctx.lineTo(cx(0), H-P.b); ctx.closePath();
  ctx.fillStyle = 'rgba(90,70,30,.2)'; ctx.fill();
  ctx.strokeStyle = 'rgba(110,85,35,.25)'; ctx.lineWidth = 1;
  for (var xi=-cH; xi<cW+cH; xi+=9) {
    ctx.beginPath(); ctx.moveTo(P.l+xi,H-P.b); ctx.lineTo(P.l+xi+cH*.5,P.t+cH); ctx.stroke();
  }
  ctx.restore();

  // Вода
  ctx.save();
  ctx.beginPath(); ctx.moveTo(cx(0), sy);
  allDepths.forEach(function(h,i){ ctx.lineTo(cx(i), cy(h)); });
  ctx.lineTo(cx(n-1), sy); ctx.closePath();
  var gr = ctx.createLinearGradient(0,sy,0,sy+cH);
  gr.addColorStop(0,'rgba(64,144,232,.4)'); gr.addColorStop(1,'rgba(30,90,180,.06)');
  ctx.fillStyle = gr; ctx.fill(); ctx.restore();

  // Линия дна
  ctx.beginPath();
  allDepths.forEach(function(h,i){ i===0?ctx.moveTo(cx(i),cy(h)):ctx.lineTo(cx(i),cy(h)); });
  ctx.strokeStyle='#4090e8'; ctx.lineWidth=2.5; ctx.lineJoin='round'; ctx.stroke();

  // Берега
  ctx.strokeStyle='#6a7a8a'; ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.moveTo(P.l-12,sy); ctx.lineTo(cx(0),sy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx(n-1),sy); ctx.lineTo(P.l+cW+12,sy); ctx.stroke();
  ctx.strokeStyle='rgba(100,120,140,.22)'; ctx.lineWidth=1;
  for (var bi=0; bi<12; bi+=4) {
    ctx.beginPath(); ctx.moveTo(P.l-12+bi,sy); ctx.lineTo(P.l-12+bi,sy-7); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(P.l+cW+bi,sy); ctx.lineTo(P.l+cW+bi,sy-7); ctx.stroke();
  }

  // Подпись 0
  ctx.fillStyle='#8a96a8'; ctx.font='9px monospace'; ctx.textAlign='right';
  ctx.fillText('0', P.l-4, sy+3);
  ctx.fillStyle='#3a4a62'; ctx.textAlign='right'; ctx.font='8px monospace';
  ctx.fillText('глубина ↓', P.l-4, sy-5);

  // Точки
  var labels = ['Тн'];
  for (var i=1; i<n-1; i++) labels.push('T'+i);
  labels.push('Тк');

  allDepths.forEach(function(h,i){
    var px2=cx(i), py2=cy(h);
    var isEnd=(i===0||i===n-1);
    // Пунктир
    ctx.save(); ctx.beginPath(); ctx.moveTo(px2,sy); ctx.lineTo(px2,py2);
    ctx.strokeStyle='rgba(200,160,18,.45)'; ctx.lineWidth=1;
    ctx.setLineDash([3,4]); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    // Засечка
    ctx.beginPath(); ctx.moveTo(px2-3,sy); ctx.lineTo(px2+3,sy);
    ctx.strokeStyle='#c8a012'; ctx.lineWidth=2; ctx.stroke();
    // Точка
    ctx.beginPath(); ctx.arc(px2,py2,isEnd?3:4.5,0,Math.PI*2);
    ctx.fillStyle=isEnd?'#556677':'#c8a012'; ctx.fill();
    ctx.strokeStyle='#080c14'; ctx.lineWidth=1.5; ctx.stroke();
    // Глубина
    if (h>0) {
      var hs=(h*100).toFixed(1)+' см';
      var ly=(py2-sy)>22?sy+(py2-sy)/2:py2-10;
      ctx.fillStyle='#c8a012'; ctx.font='bold 10px monospace'; ctx.textAlign='center';
      ctx.fillText(hs,px2,ly);
    }
    // Метка
    ctx.fillStyle=isEnd?'#6688aa':'#3a4a62'; ctx.font=(isEnd?'bold ':'')+'9px monospace';
    ctx.textAlign='center'; ctx.fillText(labels[i],px2,H-P.b+13);
  });

  // Ось Y
  ctx.textAlign='right'; ctx.font='9px monospace';
  for (var si=0; si<=4; si++) {
    var dv=mx/4*si, yy=cy(dv);
    ctx.fillStyle='#3a4a62'; ctx.fillText((dv*100).toFixed(0)+' см',P.l-4,yy+3);
    ctx.beginPath(); ctx.moveTo(P.l-3,yy); ctx.lineTo(P.l,yy);
    ctx.strokeStyle='#3a4a62'; ctx.lineWidth=1; ctx.stroke();
    if(si>0&&si<4){
      ctx.save(); ctx.beginPath(); ctx.moveTo(P.l,yy); ctx.lineTo(P.l+cW,yy);
      ctx.strokeStyle='rgba(255,255,255,.04)'; ctx.setLineDash([3,6]); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
    }
  }

  // Ширина
  ctx.fillStyle='#3a4a62'; ctx.textAlign='center'; ctx.font='9px monospace';
  ctx.fillText('← B = '+B.toFixed(2)+' м →', P.l+cW/2, H-P.b+28);
  var ay=H-P.b+22; ctx.strokeStyle='#3a4a62'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(P.l,ay); ctx.lineTo(P.l+cW,ay); ctx.stroke();
  [[P.l+5,ay-3,P.l,ay,P.l+5,ay+3],[P.l+cW-5,ay-3,P.l+cW,ay,P.l+cW-5,ay+3]].forEach(function(pts){
    ctx.beginPath(); ctx.moveTo(pts[0],pts[1]); ctx.lineTo(pts[2],pts[3]); ctx.lineTo(pts[4],pts[5]); ctx.stroke();
  });
}

// ── 3D (Three.js — уже подключён через map.js) ───────────
var _dvCam = { theta:-0.3, phi:0.75, radius:5, tx:0, ty:0 };
var _dvMouse = { down:false, button:0, lx:0, ly:0 };
var _dvPinch = null;

function dvBuild3d(ditch) {
  // Инициализируем Three.js если ещё нет
  if (!window.THREE) {
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    s.onload = function(){ dvInit3d(ditch); };
    document.head.appendChild(s);
    return;
  }
  dvInit3d(ditch);
}

function dvInit3d(ditch) {
  var canvas = document.getElementById('ditch-3d-canvas');
  if (!canvas) return;

  // Убеждаемся что canvas видим и имеет правильные размеры
  var W = canvas.offsetWidth || canvas.parentElement.offsetWidth || 600;
  if (W < 10) W = canvas.closest('.card') ? canvas.closest('.card').offsetWidth - 40 : 600;
  var H = 380;
  var dpr = Math.min(window.devicePixelRatio||1, 2);
  canvas.width=W*dpr; canvas.height=H*dpr;
  canvas.style.width=W+'px'; canvas.style.height=H+'px';

  // Если рендерер уже есть — только перестраиваем сцену
  if (_dvR3 && _dvR3.renderer) {
    _dvR3.renderer.setSize(W,H);
    _dvR3.camera.aspect=W/H;
    _dvR3.camera.updateProjectionMatrix();
    dvBuildScene(ditch);
    return;
  }

  var renderer=new THREE.WebGLRenderer({canvas:canvas,antialias:true,alpha:false});
  renderer.setPixelRatio(dpr); renderer.setSize(W,H);
  renderer.setClearColor(0x05080f,1);
  renderer.shadowMap.enabled=true;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.1;

  var scene=new THREE.Scene(); scene.fog=new THREE.FogExp2(0x05080f,0.04);
  var camera=new THREE.PerspectiveCamera(42,W/H,0.01,100);

  scene.add(new THREE.AmbientLight(0x203050,1.8));
  var sun=new THREE.DirectionalLight(0xffeedd,2.2);
  sun.position.set(4,8,3); sun.castShadow=true; scene.add(sun);
  var fillLight = new THREE.DirectionalLight(0x4080c0, 0.6);
  fillLight.position.set(-3, 3, -2);
  scene.add(fillLight);

  var clock=new THREE.Clock();
  var waveU=null;
  var animId=null;

  function loop(){
    animId=requestAnimationFrame(loop);
    if(waveU) waveU.uTime.value=clock.getElapsedTime();
    if(_dvAutoRot){ _dvCam.theta+=0.007; dvApplyCam(camera); }
    renderer.render(scene,camera);
  }

  _dvR3={ renderer:renderer, scene:scene, camera:camera, clock:clock,
           group:null, animId:animId, waveU:waveU, loop:loop };

  // Управление
  canvas.addEventListener('mousedown',function(e){ _dvMouse.down=true; _dvMouse.button=e.button; _dvMouse.lx=e.clientX; _dvMouse.ly=e.clientY; e.preventDefault(); });
  canvas.addEventListener('mousemove',function(e){
    if(!_dvMouse.down) return;
    var dx=e.clientX-_dvMouse.lx, dy=e.clientY-_dvMouse.ly;
    _dvMouse.lx=e.clientX; _dvMouse.ly=e.clientY;
    if(_dvMouse.button===0&&!e.shiftKey){ _dvCam.theta-=dx*.008; _dvCam.phi=Math.max(.1,Math.min(Math.PI-.1,_dvCam.phi+dy*.008)); }
    else{ _dvCam.tx-=dx*.004; _dvCam.ty+=dy*.004; }
    dvApplyCam(camera);
  });
  window.addEventListener('mouseup',function(){ _dvMouse.down=false; });
  canvas.addEventListener('wheel',function(e){ e.preventDefault(); _dvCam.radius=Math.max(.8,Math.min(18,_dvCam.radius+e.deltaY*.004)); dvApplyCam(camera); },{passive:false});
  canvas.addEventListener('touchstart',function(e){
    if(e.touches.length===1){ _dvMouse.down=true; _dvMouse.button=0; _dvMouse.lx=e.touches[0].clientX; _dvMouse.ly=e.touches[0].clientY; }
    else if(e.touches.length===2) _dvPinch=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    e.preventDefault();
  },{passive:false});
  canvas.addEventListener('touchmove',function(e){
    if(e.touches.length===1&&_dvMouse.down){
      var dx=e.touches[0].clientX-_dvMouse.lx, dy=e.touches[0].clientY-_dvMouse.ly;
      _dvMouse.lx=e.touches[0].clientX; _dvMouse.ly=e.touches[0].clientY;
      _dvCam.theta-=dx*.01; _dvCam.phi=Math.max(.1,Math.min(Math.PI-.1,_dvCam.phi+dy*.01)); dvApplyCam(camera);
    } else if(e.touches.length===2&&_dvPinch){
      var d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      _dvCam.radius=Math.max(.8,Math.min(18,_dvCam.radius*(_dvPinch/d))); _dvPinch=d; dvApplyCam(camera);
    }
    e.preventDefault();
  },{passive:false});

  dvApplyCam(camera);
  dvBuildScene(ditch);
  loop();
}

function dvApplyCam(camera) {
  if (!camera && _dvR3) camera = _dvR3.camera;
  if (!camera) return;
  var x=_dvCam.radius*Math.sin(_dvCam.phi)*Math.sin(_dvCam.theta);
  var y=_dvCam.radius*Math.cos(_dvCam.phi);
  var z=_dvCam.radius*Math.sin(_dvCam.phi)*Math.cos(_dvCam.theta);
  camera.position.set(x+_dvCam.tx, y+_dvCam.ty, z);
  camera.lookAt(_dvCam.tx, _dvCam.ty, 0);
}

function dvCamPreset(p) {
  if(p==='front') { _dvCam.theta=0;   _dvCam.phi=Math.PI/2; _dvCam.radius=4.5; _dvCam.tx=0; _dvCam.ty=0; }
  if(p==='iso')   { _dvCam.theta=-.5; _dvCam.phi=0.75;      _dvCam.radius=5.5; _dvCam.tx=0; _dvCam.ty=.2; }
  if(p==='top')   { _dvCam.theta=0;   _dvCam.phi=0.08;      _dvCam.radius=5;   _dvCam.tx=0; _dvCam.ty=0; }
  if (_dvR3) dvApplyCam(_dvR3.camera);
}

function dvToggleRotate() {
  _dvAutoRot=!_dvAutoRot;
  var btn=document.getElementById('dv-rotate-btn');
  if(btn) btn.classList.toggle('active',_dvAutoRot);
}

function dvBuildScene(ditch) {
  if (!_dvR3 || !window.THREE) return;
  var scene = _dvR3.scene;
  if (_dvR3.group) scene.remove(_dvR3.group);
  var group = new THREE.Group();
  scene.add(group);
  _dvR3.group = group;

  var rawDepths = Array.isArray(ditch.depths) ? ditch.depths : [0.05];
  var allDepths = [0].concat(rawDepths).concat([0]);
  var n = allDepths.length;
  var maxH = Math.max.apply(null, allDepths) || 0.01;
  var scY = 1.4 / maxH;
  var DEPTH = 0.5;

  var xn = allDepths.map(function(_, i) { return (i / Math.max(n-1,1)) * 2 - 1; });
  var yn = allDepths.map(function(h) { return h * scY; });
  var gndDepth = Math.max.apply(null, yn) + 0.4;
  var extSettings = { depth: DEPTH, bevelEnabled: false };

  // ── ГРУНТ ──────────────────────────────────────────────
  var gShape = new THREE.Shape();
  gShape.moveTo(xn[0], 0);
  for (var i = 0; i < n; i++) gShape.lineTo(xn[i], -yn[i]);
  gShape.lineTo(xn[n-1], -gndDepth);
  gShape.lineTo(xn[0], -gndDepth);
  gShape.closePath();
  group.add(new THREE.Mesh(
    new THREE.ExtrudeGeometry(gShape, extSettings),
    new THREE.MeshLambertMaterial({ color: 0x6b4c2a, side: THREE.FrontSide })
  ));

  // ── ВОДА ───────────────────────────────────────────────
  var wShape = new THREE.Shape();
  wShape.moveTo(xn[0], 0);
  for (var i = 0; i < n; i++) wShape.lineTo(xn[i], -yn[i]);
  wShape.lineTo(xn[n-1], 0);
  wShape.closePath();
  var wMesh = new THREE.Mesh(
    new THREE.ExtrudeGeometry(wShape, { depth: DEPTH*0.98, bevelEnabled:false }),
    new THREE.MeshPhongMaterial({
      color: 0x1565c0, transparent:true, opacity:0.80,
      side:THREE.FrontSide, shininess:180, specular:0x64b5f6
    })
  );
  wMesh.position.z = DEPTH * 0.01;
  group.add(wMesh);

  // ── ПОВЕРХНОСТЬ ВОДЫ ───────────────────────────────────
  var vel = ditch.velocity || 0.34;
  var waveAmp = Math.min(0.015, 0.006 + vel * 0.012); // амплитуда зависит от скорости
  var waveU = { uTime:{value:0}, uColor:{value:new THREE.Color(0x42a5f5)}, uOpacity:{value:0.6}, uAmp:{value:waveAmp} };
  _dvR3.waveU = waveU;
  var waveMat = new THREE.ShaderMaterial({
    uniforms: waveU, transparent:true, side:THREE.DoubleSide,
    vertexShader:'uniform float uTime;uniform float uAmp;varying vec2 vUv;void main(){vUv=uv;vec3 p=position;p.z+=sin(p.x*8.+uTime*2.5)*uAmp+sin(p.x*4.+uTime*1.8)*uAmp*.5;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
    fragmentShader:'uniform vec3 uColor;uniform float uOpacity;varying vec2 vUv;void main(){float g=sin(vUv.x*18.)*.05;gl_FragColor=vec4(uColor+g,uOpacity);}'
  });
  var surfMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, DEPTH, 40, 4), waveMat);
  surfMesh.rotation.x = Math.PI/2;
  surfMesh.position.set(0, 0.003, DEPTH/2);
  group.add(surfMesh);

  // ── ТРАВА ──────────────────────────────────────────────
  [-1.08, 1.08].forEach(function(sx) {
    var bm = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.05, DEPTH),
      new THREE.MeshLambertMaterial({ color: 0x388e3c })
    );
    bm.position.set(sx, 0.025, DEPTH/2);
    group.add(bm);
  });

  // ── ЛИНИЯ ДНА ──────────────────────────────────────────
  var dnaPoints = [];
  for (var i = 0; i < n; i++) dnaPoints.push(new THREE.Vector3(xn[i], -yn[i], DEPTH/2));
  if (dnaPoints.length >= 2) {
    var tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(dnaPoints), 60, 0.016, 8, false);
    group.add(new THREE.Mesh(tube, new THREE.MeshPhongMaterial({ color:0x1e88e5, shininess:160 })));
  }

  // ── ПРОМЕРНЫЕ СТОЙКИ ───────────────────────────────────
  var labels = ['Тн'];
  for (var li = 1; li < n-1; li++) labels.push('T'+li);
  labels.push('Тк');

  for (var i = 0; i < n; i++) {
    var dep = yn[i];
    var isEnd = (i === 0 || i === n-1);
    if (dep > 0.04) {
      var rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, dep, 8),
        new THREE.MeshPhongMaterial({ color:isEnd?0x546e7a:0xfbc02d, opacity:0.85, transparent:true })
      );
      rod.position.set(xn[i], -dep/2, DEPTH/2);
      group.add(rod);
    }
    var sph = new THREE.Mesh(
      new THREE.SphereGeometry(isEnd?0.035:0.05, 16, 16),
      new THREE.MeshPhongMaterial({ color:isEnd?0x78909c:0xfdd835, shininess:200 })
    );
    sph.position.set(xn[i], -dep, DEPTH/2);
    group.add(sph);

    // ── Подпись глубины над стойкой (Sprite) ─────────────
    if (dep > 0.04 || !isEnd) {
      var depCm = (allDepths[i] * 100).toFixed(1) + ' см';
      var sp = dvMakeLabel(depCm, isEnd ? '#90a4ae' : '#fdd835', 13);
      sp.position.set(xn[i], 0.18, DEPTH/2);
      group.add(sp);
    }
    // ── Метка Тн/Тк/T1... ────────────────────────────────
    var nameLabel = dvMakeLabel(labels[i], isEnd ? '#78909c' : '#fbc02d', 11);
    nameLabel.position.set(xn[i], -dep - 0.18, DEPTH/2);
    group.add(nameLabel);
  }

  // ── РАЗМЕРНАЯ ЛИНИЯ ШИРИНЫ B ───────────────────────────
  var B = ditch.width || 1;
  var yLine = 0.28;
  var arrowLen = 0.12;
  // Горизонтальная линия
  var lineMat = new THREE.LineBasicMaterial({ color:0xffffff, opacity:0.7, transparent:true });
  var lineGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(xn[0], yLine, DEPTH/2),
    new THREE.Vector3(xn[n-1], yLine, DEPTH/2)
  ]);
  group.add(new THREE.Line(lineGeo, lineMat));
  // Засечки по краям
  [xn[0], xn[n-1]].forEach(function(xv) {
    var tickGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(xv, yLine-0.06, DEPTH/2),
      new THREE.Vector3(xv, yLine+0.06, DEPTH/2)
    ]);
    group.add(new THREE.Line(tickGeo, lineMat));
  });
  // Подпись ширины по центру
  var bLabel = dvMakeLabel('B = ' + B.toFixed(2) + ' м', '#ffffff', 14);
  bLabel.position.set(0, yLine + 0.14, DEPTH/2);
  group.add(bLabel);

  // ── СТРЕЛКИ ПОТОКА С ПОДПИСЬЮ ──────────────────────────
  var arLen = 0.15 + Math.min(1, vel/1.5) * 0.2;
  var velLabel = dvMakeLabel('v = ' + vel.toFixed(3) + ' м/с', '#fbc02d', 13);
  var midX = xn[Math.floor(n/2)];
  velLabel.position.set(midX, -yn[Math.floor(n/2)]*0.4 - 0.22, DEPTH + 0.1);
  group.add(velLabel);

  for (var i = 1; i < n-1; i++) {
    if (yn[i] < 0.06) continue;
    group.add(new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(xn[i], -yn[i]*0.4, 0),
      arLen, 0xfbc02d, 0.08, 0.05
    ));
  }

  // ── РЕШЁТКА ────────────────────────────────────────────
  var grid = new THREE.GridHelper(4, 16, 0x0d47a1, 0x0a2040);
  grid.position.set(0, -gndDepth, DEPTH/2);
  group.add(grid);

  // ── HUD панель поверх canvas ────────────────────────────
  dvUpdateHUD(ditch);

  // ── Оси координат + масштаб ──────────────────────────────
  dvAddAxes(ditch, allDepths, scY, DEPTH);

  // ── Тултип для стоек ────────────────────────────────────
  dvInitTooltip(ditch, allDepths, xn, yn, n, DEPTH);

  _dvCam.theta=-0.45; _dvCam.phi=0.70; _dvCam.radius=4.5; _dvCam.tx=0; _dvCam.ty=-0.5;
  if (_dvR3) dvApplyCam(_dvR3.camera);
}

// ── Оси координат + масштабная метка ─────────────────────
function dvAddAxes(ditch, allDepths, scY, DEPTH) {
  if (!_dvR3 || !_dvR3.scene) return;
  if (_dvR3.axesGroup) { _dvR3.scene.remove(_dvR3.axesGroup); _dvR3.axesGroup = null; }

  var B = ditch.width || 1;
  var gndDepth = Math.max.apply(null, allDepths) * scY + 0.4;
  var unitsPerMeter = 2.0 / B;

  var axGrp = new THREE.Group();
  _dvR3.scene.add(axGrp);
  _dvR3.axesGroup = axGrp;

  // Позиция начала осей — левый нижний ближний угол
  var AX = -1.35, AY = -(gndDepth + 0.15), AZ = -0.05;
  var LEN = 0.5;

  function line3(p1, p2, color) {
    var geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    return new THREE.Line(geo, new THREE.LineBasicMaterial({ color: color }));
  }

  // Оси X, Y, Z
  axGrp.add(line3(new THREE.Vector3(AX,AY,AZ), new THREE.Vector3(AX+LEN,AY,AZ), 0xff4444));
  axGrp.add(line3(new THREE.Vector3(AX,AY,AZ), new THREE.Vector3(AX,AY+LEN,AZ), 0x44dd44));
  axGrp.add(line3(new THREE.Vector3(AX,AY,AZ), new THREE.Vector3(AX,AY,AZ+LEN), 0x4488ff));

  // Конусы-наконечники
  function addCone(x, y, z, rz, rx, color) {
    var m = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.08, 8),
      new THREE.MeshBasicMaterial({ color: color }));
    m.position.set(x, y, z);
    if (rz) m.rotation.z = rz;
    if (rx) m.rotation.x = rx;
    axGrp.add(m);
  }
  addCone(AX+LEN, AY, AZ, -Math.PI/2, 0, 0xff4444);
  addCone(AX, AY+LEN, AZ, 0, 0, 0x44dd44);
  addCone(AX, AY, AZ+LEN, 0, Math.PI/2, 0x4488ff);

  // Спрайт-подписи
  function axSprite(text, color, size, x, y, z, sw, sh) {
    var cv = document.createElement('canvas'); cv.width=size*4; cv.height=size*2;
    var ctx = cv.getContext('2d');
    ctx.font = 'bold '+size+'px monospace'; ctx.fillStyle=color;
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.shadowColor='rgba(0,0,0,0.95)'; ctx.shadowBlur=5;
    ctx.fillText(text, size*2, size);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(cv), transparent:true, depthTest:false
    }));
    sp.scale.set(sw||0.22, sh||0.11, 1);
    sp.position.set(x, y, z);
    axGrp.add(sp);
  }

  // Буквы осей
  axSprite('X', '#ff6666', 32, AX+LEN+0.14, AY+0.03, AZ);
  axSprite('Y', '#66ff66', 32, AX-0.02, AY+LEN+0.13, AZ);
  axSprite('Z', '#6699ff', 32, AX, AY+0.03, AZ+LEN+0.14);

  // Пояснения (мелко)
  axSprite('ширина', 'rgba(160,175,200,0.8)', 20, AX+LEN/2, AY+0.10, AZ, 0.38, 0.08);
  axSprite('глубина', 'rgba(160,175,200,0.8)', 20, AX-0.26, AY+LEN/2, AZ, 0.42, 0.08);
  axSprite('длина', 'rgba(160,175,200,0.8)', 20, AX, AY+0.10, AZ+LEN/2, 0.32, 0.08);

  // ── МАСШТАБНАЯ ЛИНИЯ ────────────────────────────────────
  var scaleM = 0.5; // показываем 0.5 м
  var scaleU = scaleM * unitsPerMeter;
  var SX = 0.45, SY = AY - 0.02, SZ = AZ;

  axGrp.add(line3(new THREE.Vector3(SX,SY,SZ), new THREE.Vector3(SX+scaleU,SY,SZ), 0xffd700));
  [SX, SX+scaleU].forEach(function(xv) {
    axGrp.add(line3(new THREE.Vector3(xv,SY-0.07,SZ), new THREE.Vector3(xv,SY+0.07,SZ), 0xffd700));
  });
  axSprite(scaleM + ' м', '#ffd700', 24, SX+scaleU/2, SY+0.18, SZ, 0.30, 0.09);
}


// ── Инициализация тултипа для 3D стоек ────────────────────
function dvInitTooltip(ditch, allDepths, xn, yn, n, DEPTH) {
  var canvas = document.getElementById('ditch-3d-canvas');
  if (!canvas || !_dvR3 || !_dvR3.group) return;

  // DOM-тултип
  var old = document.getElementById('dv-tooltip');
  if (old) old.remove();
  var tooltip = document.createElement('div');
  tooltip.id = 'dv-tooltip';
  tooltip.style.cssText = [
    'position:absolute;display:none;pointer-events:none;z-index:20;',
    'background:rgba(5,10,22,0.92);border:1px solid rgba(66,165,245,0.45);',
    'border-radius:8px;padding:9px 13px;font-family:monospace;font-size:12px;',
    'line-height:1.75;color:#e0e8f0;backdrop-filter:blur(6px);',
    'box-shadow:0 4px 20px rgba(0,0,0,0.5);min-width:170px;'
  ].join('');
  var parent = canvas.parentElement;
  if (parent) { parent.style.position='relative'; parent.appendChild(tooltip); }

  // Raycaster
  var raycaster = new THREE.Raycaster();
  var mouse = new THREE.Vector2();

  // Невидимые хитбоксы над стойками
  var hitObjects = [];
  _dvR3.group.children.forEach(function(c) {
    if (c.userData && c.userData.isHitbox) _dvR3.group.remove(c);
  });
  for (var i = 0; i < n; i++) {
    var dep = yn[i];
    var isEnd = (i === 0 || i === n-1);
    var label = i === 0 ? 'Тн' : (i === n-1 ? 'Тк' : 'T'+i);
    var distM = (xn[i] - xn[0]) / (xn[n-1] - xn[0]) * (ditch.width || 1);
    var hitGeo = new THREE.SphereGeometry(0.15, 8, 8);
    var hitMat = new THREE.MeshBasicMaterial({ transparent:true, opacity:0, depthWrite:false });
    var hit = new THREE.Mesh(hitGeo, hitMat);
    hit.position.set(xn[i], -dep/2, DEPTH/2);
    hit.userData = { isHitbox:true, label:label, depthCm:(allDepths[i]*100).toFixed(1),
      distM:distM.toFixed(3), isEnd:isEnd, idx:i };
    _dvR3.group.add(hit);
    hitObjects.push(hit);
  }

  // mousemove handler
  function onMove(e) {
    if (!_dvR3 || !_dvR3.camera) return;
    var rect = canvas.getBoundingClientRect();
    mouse.set(
      ((e.clientX-rect.left)/rect.width)*2-1,
      -((e.clientY-rect.top)/rect.height)*2+1
    );
    raycaster.setFromCamera(mouse, _dvR3.camera);
    var hits = raycaster.intersectObjects(hitObjects, false);
    if (hits.length > 0) {
      var d = hits[0].object.userData;
      canvas.style.cursor = 'crosshair';
      var rows = '';
      if (d.isEnd) {
        rows = '<div style="color:rgba(255,255,255,0.45);font-size:11px;margin-bottom:4px">'+d.label+' — береговая точка</div>';
        rows += row('Глубина', d.depthCm+' см', '#90a4ae');
        rows += row('От начала', d.distM+' м', '#90a4ae');
      } else {
        rows = '<div style="color:#fbc02d;font-size:11px;font-weight:bold;margin-bottom:4px">Точка '+d.label+'</div>';
        rows += row('Глубина h', d.depthCm+' см', '#fdd835');
        rows += row('От начала', d.distM+' м', '#80cbc4');
        if (d.idx > 0 && d.idx < n-1) {
          var h1=allDepths[d.idx-1], h2=allDepths[d.idx], h3=allDepths[d.idx+1];
          var segW=(ditch.width||1)/(n-1);
          var trap=((h1+h2)/2*segW+(h2+h3)/2*segW).toFixed(4);
          rows += row('S трапеции', trap+' м²', '#42a5f5');
        }
      }
      tooltip.innerHTML = rows;
      tooltip.style.display = 'block';
      var tx = e.clientX-rect.left+14;
      var ty = e.clientY-rect.top-10;
      if (tx+190 > rect.width) tx = e.clientX-rect.left-200;
      tooltip.style.left = tx+'px';
      tooltip.style.top  = ty+'px';
    } else {
      tooltip.style.display = 'none';
      canvas.style.cursor = 'grab';
    }
  }
  function row(label, val, color) {
    return '<div style="display:flex;justify-content:space-between;gap:12px">'+
      '<span style="color:rgba(255,255,255,0.45);font-size:11px">'+label+'</span>'+
      '<span style="color:'+color+';font-weight:bold">'+val+'</span></div>';
  }
  function onLeave() { tooltip.style.display='none'; canvas.style.cursor='grab'; }

  if (canvas._dvTooltipHandler) canvas.removeEventListener('mousemove', canvas._dvTooltipHandler);
  if (canvas._dvLeaveHandler)   canvas.removeEventListener('mouseleave', canvas._dvLeaveHandler);
  canvas._dvTooltipHandler = onMove;
  canvas._dvLeaveHandler   = onLeave;
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
}

// ── Вспомогательная: создать текстовый Sprite ─────────────
function dvMakeLabel(text, color, fontSize) {
  var canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0,0,256,64);
  ctx.font = 'bold ' + (fontSize||13) + 'px monospace';
  ctx.fillStyle = color || '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Фон-тень для читаемости
  ctx.shadowColor = 'rgba(0,0,0,0.85)';
  ctx.shadowBlur = 6;
  ctx.fillText(text, 128, 32);
  var tex = new THREE.CanvasTexture(canvas);
  var mat = new THREE.SpriteMaterial({ map:tex, transparent:true, depthTest:false });
  var sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.7, 0.175, 1);
  return sprite;
}

// ── HUD панель поверх canvas ──────────────────────────────
function dvUpdateHUD(ditch) {
  var canvas = document.getElementById('ditch-3d-canvas');
  if (!canvas) return;
  // Удаляем старый HUD
  var old = document.getElementById('dv-hud');
  if (old) old.remove();

  var hud = document.createElement('div');
  hud.id = 'dv-hud';
  hud.style.cssText = [
    'position:absolute;top:10px;right:10px;',
    'background:rgba(5,10,20,0.75);',
    'border:1px solid rgba(66,165,245,0.3);',
    'border-radius:8px;padding:8px 12px;',
    'font-family:monospace;font-size:12px;line-height:1.7;',
    'color:#e0e8f0;pointer-events:none;backdrop-filter:blur(4px);',
    'min-width:160px;'
  ].join('');

  var rows = [
    ['S', (ditch.area != null ? ditch.area.toFixed(3) : '—') + ' м²', '#42a5f5'],
    ['Q', (ditch.flowM3h != null ? ditch.flowM3h.toFixed(3) : '—') + ' м³/ч', '#fbc02d'],
    ['v', (ditch.velocity != null ? ditch.velocity.toFixed(3) : '—') + ' м/с', '#81c784'],
    ['B', (ditch.width != null ? ditch.width.toFixed(2) : '—') + ' м', '#ce93d8'],
    ['hmax', ((Math.max.apply(null, Array.isArray(ditch.depths)?ditch.depths:[0]))*100).toFixed(1) + ' см', '#80cbc4'],
    ['Метод', ditch.velMethod === 'float' ? 'Поплавок' : ditch.velMethod === 'multi' ? 'По точкам' : 'Вертушка', '#a5d6a7'],
  ];

  hud.innerHTML = rows.map(function(r) {
    return '<div style="display:flex;justify-content:space-between;gap:16px">' +
      '<span style="color:rgba(255,255,255,0.45);font-size:11px">' + r[0] + '</span>' +
      '<span style="color:' + r[2] + ';font-weight:bold">' + r[1] + '</span>' +
      '</div>';
  }).join('');

  // Вставляем HUD в родительский контейнер canvas (который position:relative)
  var parent = canvas.parentElement;
  if (parent) {
    parent.style.position = 'relative';
    parent.appendChild(hud);
  }
}
