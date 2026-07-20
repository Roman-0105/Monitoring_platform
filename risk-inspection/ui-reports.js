/* Отчёты: агрегированная сводка по журналу обращений за период —
 * KPI, разбивки по уровням/рискам, просроченные критические обращения,
 * снимки карты по каждой неделе периода (с точками) — постранично по
 * каждому выбранному участку. Формируется по клику ("автоматический" в
 * смысле "не нужно вручную считать" — не по расписанию: рассылка по
 * расписанию требует бэкенда с планировщиком, см. BACKEND_INTEGRATION.md).
 *
 * Снимки карты рисуются той же функцией renderMapScene, что и живая карта
 * (см. ui-map.js) — на офскрин-канвас, без zoom/pan, в data:-картинку.
 */

var ReportsState = { plots: [], levels: [], risks: [] };

async function initReportsPanel(panelEl) {
  panelEl.innerHTML =
    '<div class="ri-panel-card">' +
      '<div class="ri-panel-toolbar">' +
        '<span class="ri-panel-title">Отчёты</span>' +
      '</div>' +
      '<div class="ri-panel-body" style="padding:20px;overflow:auto">' +
        '<div class="ri-report-settings ri-no-print" id="ri-report-settings">' +
          '<div class="ri-report-settings-row">' +
            '<div class="ri-form-group">' +
              '<label class="ri-form-label">Период</label>' +
              '<div class="ri-report-presets" id="ri-rep-presets">' +
                '<button type="button" class="ri-report-preset-btn" data-preset="today">Сегодня</button>' +
                '<button type="button" class="ri-report-preset-btn" data-preset="week">Неделя</button>' +
                '<button type="button" class="ri-report-preset-btn active" data-preset="month">Месяц</button>' +
                '<button type="button" class="ri-report-preset-btn" data-preset="quarter">Квартал</button>' +
              '</div>' +
            '</div>' +
            '<div class="ri-form-group"><label class="ri-form-label">С</label><input type="date" class="ri-input" id="ri-rep-from"></div>' +
            '<div class="ri-form-group"><label class="ri-form-label">По</label><input type="date" class="ri-input" id="ri-rep-to"></div>' +
            '<div class="ri-form-group"><label class="ri-form-label">Просрочка «СТОП!», дн.</label><input type="number" min="0" class="ri-input" id="ri-rep-overdue-days" value="3" style="max-width:90px"></div>' +
          '</div>' +
          '<div class="ri-report-settings-row">' +
            '<div class="ri-form-group"><label class="ri-form-label">Статус</label>' +
              '<select class="ri-input" id="ri-rep-status">' +
                '<option value="">Все</option><option value="open">Открытые</option><option value="closed">Закрытые</option>' +
              '</select></div>' +
            '<div class="ri-form-group"><label class="ri-form-label">Уровень опасности</label><select class="ri-input" id="ri-rep-level"></select></div>' +
            '<div class="ri-form-group"><label class="ri-form-label">Тип риска</label><select class="ri-input" id="ri-rep-risk"></select></div>' +
            '<div class="ri-form-group"><label class="ri-form-label">Слои карты</label>' +
              '<div class="ri-report-layer-toggles">' +
                '<label><input type="checkbox" id="ri-rep-show-faults"> Разломы</label>' +
                '<label><input type="checkbox" id="ri-rep-show-domains" checked> Домены</label>' +
              '</div></div>' +
          '</div>' +
          '<div class="ri-form-group"><label class="ri-form-label">Участки</label><div class="ri-report-plot-checklist" id="ri-rep-plots"></div></div>' +
          '<div class="ri-modal-actions" style="justify-content:flex-start">' +
            '<button type="button" class="ri-btn ri-btn-primary" id="ri-report-generate">📊 Сформировать отчёт</button>' +
            '<button type="button" class="ri-btn ri-btn-outline" id="ri-report-print" hidden>🖨️ Печать / PDF</button>' +
          '</div>' +
        '</div>' +
        '<div id="ri-report-output"></div>' +
      '</div>' +
    '</div>';

  ReportsState.plots = await RiskApi.plotNames.list();
  ReportsState.levels = await RiskApi.levels.list();
  ReportsState.risks = await RiskApi.fixedRisks.list();

  panelEl.querySelector('#ri-rep-plots').innerHTML = ReportsState.plots.map(function(p) {
    return '<label><input type="checkbox" class="ri-rep-plot-cb" value="' + p.id + '" checked> ' + escHTML(p.plotName) + '</label>';
  }).join('');

  panelEl.querySelector('#ri-rep-level').innerHTML = '<option value="">Все</option>' +
    ReportsState.levels.map(function(l) { return '<option value="' + l.id + '">' + escHTML(l.level) + '</option>'; }).join('');
  panelEl.querySelector('#ri-rep-risk').innerHTML = '<option value="">Все</option>' +
    ReportsState.risks.map(function(r) { return '<option value="' + r.id + '">' + escHTML(r.fixedRisk) + '</option>'; }).join('');

  panelEl.querySelectorAll('.ri-report-preset-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { applyReportPreset(panelEl, btn.dataset.preset); });
  });
  panelEl.querySelector('#ri-report-generate').addEventListener('click', function() { generateReport(panelEl); });
  panelEl.querySelector('#ri-report-print').addEventListener('click', function() { window.print(); });

  applyReportPreset(panelEl, 'month');
}

/* ---------------- Период: пресеты ---------------- */

function toDateInputValue(d) {
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function applyReportPreset(panelEl, preset) {
  var to = new Date();
  var from = new Date();
  var daysBack = { today: 0, week: 6, month: 29, quarter: 89 }[preset];
  if (daysBack === undefined) return;
  from.setDate(from.getDate() - daysBack);
  panelEl.querySelector('#ri-rep-from').value = toDateInputValue(from);
  panelEl.querySelector('#ri-rep-to').value = toDateInputValue(to);
  panelEl.querySelectorAll('.ri-report-preset-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.preset === preset);
  });
}

/* ---------------- Сбор настроек из формы ---------------- */

function readReportSettings(panelEl) {
  var fromVal = panelEl.querySelector('#ri-rep-from').value;
  var toVal = panelEl.querySelector('#ri-rep-to').value;
  var plotIds = [];
  panelEl.querySelectorAll('.ri-rep-plot-cb:checked').forEach(function(cb) { plotIds.push(Number(cb.value)); });
  var levelVal = panelEl.querySelector('#ri-rep-level').value;
  var riskVal = panelEl.querySelector('#ri-rep-risk').value;
  return {
    from: fromVal ? new Date(fromVal + 'T00:00:00') : null,
    to: toVal ? new Date(toVal + 'T00:00:00') : null,
    plotIds: plotIds,
    status: panelEl.querySelector('#ri-rep-status').value,
    levelId: levelVal ? Number(levelVal) : null,
    riskId: riskVal ? Number(riskVal) : null,
    overdueDays: Number(panelEl.querySelector('#ri-rep-overdue-days').value) || 0,
    showFaults: panelEl.querySelector('#ri-rep-show-faults').checked,
    showDomains: panelEl.querySelector('#ri-rep-show-domains').checked,
  };
}

/* ---------------- Данные: фильтрация, группировка, KPI ---------------- */

function filterReportRows(allRows, settings) {
  var fromTime = settings.from.getTime();
  var toTime = settings.to.getTime() + 86399999; // включаем весь день "по"
  return allRows.filter(function(r) {
    if (!r.ddate) return false;
    var t = new Date(r.ddate).getTime();
    if (isNaN(t) || t < fromTime || t > toTime) return false;
    if (settings.plotIds.indexOf(r.plotNameId) === -1) return false;
    if (settings.status === 'open' && r.closed) return false;
    if (settings.status === 'closed' && !r.closed) return false;
    if (settings.levelId && r.levelId !== settings.levelId) return false;
    if (settings.riskId && r.fixedRiskId !== settings.riskId) return false;
    return true;
  });
}

function weeksInRange(from, to) {
  var weeks = [], seen = {};
  var d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  var last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  while (d <= last) {
    var wk = weekKeyForDate(d);
    if (!seen[wk]) { seen[wk] = true; weeks.push(wk); }
    d.setDate(d.getDate() + 1);
  }
  return weeks;
}

function computeKpis(rows) {
  var total = rows.length;
  var closed = rows.filter(function(r) { return r.closed; }).length;
  return { total: total, open: total - closed, closed: closed, pctClosed: total ? Math.round(closed / total * 100) : 0 };
}

// actions отсортированы по убыванию даты (см. data.js getActionsByCallLogId) —
// actions[0] это самое недавнее действие по обращению (закрытие).
async function computeAvgResolutionHours(closedRows) {
  var totalHours = 0, n = 0;
  await Promise.all(closedRows.map(async function(row) {
    var actions = await RiskApi.calllog.actions(row.id);
    if (!actions.length) return;
    var hours = (new Date(actions[0].date) - new Date(row.ddate)) / 3600000;
    if (hours > 0) { totalHours += hours; n++; }
  }));
  return n ? (totalHours / n) : null;
}

function groupCount(rows, labelField) {
  var map = {};
  rows.forEach(function(r) {
    var label = r[labelField] || '—';
    if (!map[label]) map[label] = { label: label, total: 0, open: 0, closed: 0 };
    map[label].total++;
    if (r.closed) map[label].closed++; else map[label].open++;
  });
  return Object.keys(map).map(function(k) { return map[k]; }).sort(function(a, b) { return b.total - a.total; });
}

function overdueCritical(rows, overdueDays) {
  var thresholdMs = overdueDays * 86400000;
  var now = Date.now();
  return rows.filter(function(r) {
    return !r.closed && r.level && r.level.indexOf('СТОП') !== -1 && (now - new Date(r.ddate).getTime()) >= thresholdMs;
  }).sort(function(a, b) { return new Date(a.ddate) - new Date(b.ddate); });
}

/* ---------------- Снимки карты по неделям ---------------- */

function loadImageAsync(src) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.onload = function() { resolve(img); };
    img.onerror = function() { reject(new Error('Не удалось загрузить изображение схемы')); };
    img.src = src;
  });
}

// Компактный снимок для отчёта: без zoom/pan, раскраска точек всегда "по
// статусу" (открыто/закрыто — то, что и так волнует читателя сводки;
// уровень/риск уже показаны отдельными таблицами разбивки на той же странице).
async function renderWeekSnapshot(scheme, weekPoints, faults, domains, settings, colorMaps) {
  var img = await loadImageAsync(scheme.image);
  var bounds = { xMin: scheme.xMin, xMax: scheme.xMax, yMin: scheme.yMin, yMax: scheme.yMax };
  var TARGET_W = 720;
  var scale = Math.min(TARGET_W / img.width, 1);
  var canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  var ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  renderMapScene(ctx, {
    img: img, bounds: bounds, scale: scale, points: weekPoints,
    faults: faults, domains: domains,
    showFaults: settings.showFaults, showDomains: settings.showDomains,
    faultColor: colorMaps.faultColor, colorMode: 'status', statusFilter: 'all',
    levelColorMap: colorMaps.levelColorMap, riskColorMap: colorMaps.riskColorMap,
  });
  return canvas.toDataURL('image/jpeg', 0.82);
}

async function buildPlotMapSnapshots(plot, plotRows, weeks, settings, colorMaps) {
  var faults = await RiskApi.faults.listByPlot(plot.id);
  var domains = await RiskApi.domains.listByPlot(plot.id);
  var snapshots = [];
  for (var i = 0; i < weeks.length; i++) {
    var wk = weeks[i];
    var weekRows = plotRows.filter(function(r) { return r.ddate && weekKeyForDate(new Date(r.ddate)) === wk; });
    if (!weekRows.length) continue; // недели без обращений в отчёт не попадают
    var scheme = await RiskApi.schemes.getByPlotWeek(plot.id, wk);
    if (!scheme || scheme.xMin == null || scheme.xMax == null || scheme.yMin == null || scheme.yMax == null) continue; // схемы нет/не откалибрована — эта неделя без картинки (данные всё равно учтены в KPI/таблицах выше)
    try {
      var dataUrl = await renderWeekSnapshot(scheme, weekRows, faults, domains, settings, colorMaps);
      snapshots.push({ weekKey: wk, dataUrl: dataUrl, count: weekRows.length });
    } catch (e) { /* битое изображение схемы — пропускаем неделю, не роняем весь отчёт */ }
  }
  return snapshots;
}

/* ---------------- Сборка HTML ---------------- */

function formatDateOnly(d) {
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear();
}

function kpiCardsHTML(kpis, avgHours) {
  return '<div class="ri-report-kpi-grid">' +
    '<div class="ri-report-kpi-card"><span class="ri-report-kpi-value">' + kpis.total + '</span><span class="ri-report-kpi-label">Всего обращений</span></div>' +
    '<div class="ri-report-kpi-card"><span class="ri-report-kpi-value" style="color:var(--ri-bad)">' + kpis.open + '</span><span class="ri-report-kpi-label">Открыто</span></div>' +
    '<div class="ri-report-kpi-card"><span class="ri-report-kpi-value" style="color:var(--ri-ok)">' + kpis.closed + '</span><span class="ri-report-kpi-label">Закрыто</span></div>' +
    '<div class="ri-report-kpi-card"><span class="ri-report-kpi-value">' + kpis.pctClosed + '%</span><span class="ri-report-kpi-label">Доля закрытых</span></div>' +
    '<div class="ri-report-kpi-card"><span class="ri-report-kpi-value">' + (avgHours != null ? Math.round(avgHours) + ' ч' : '—') + '</span><span class="ri-report-kpi-label">Среднее время закрытия</span></div>' +
  '</div>';
}

function groupTableHTML(title, groups) {
  if (!groups.length) return '';
  return '<div class="ri-report-block">' +
    '<h3 class="ri-report-block-title">' + escHTML(title) + '</h3>' +
    '<table class="ri-report-table"><thead><tr><th>' + escHTML(title.indexOf('уров') !== -1 ? 'Уровень' : 'Тип риска') + '</th><th>Всего</th><th>Открыто</th><th>Закрыто</th></tr></thead><tbody>' +
    groups.map(function(g) {
      return '<tr><td>' + escHTML(g.label) + '</td><td>' + g.total + '</td><td>' + g.open + '</td><td>' + g.closed + '</td></tr>';
    }).join('') +
    '</tbody></table></div>';
}

function overdueTableHTML(overdue, overdueDays) {
  return '<div class="ri-report-block">' +
    '<h3 class="ri-report-block-title">⚠️ Открыто более ' + overdueDays + ' дн. (уровень «СТОП!»)</h3>' +
    '<table class="ri-report-table"><thead><tr><th>ФИО</th><th>Риск</th><th>Дата обращения</th></tr></thead><tbody>' +
    overdue.map(function(r) {
      return '<tr><td>' + escHTML(r.fname) + '</td><td>' + escHTML(r.fixedRisk) + '</td><td>' + formatDate(r.ddate) + '</td></tr>';
    }).join('') +
    '</tbody></table></div>';
}

async function renderPlotSection(plot, rows, settings, colorMaps) {
  var kpis = computeKpis(rows);
  var avgHours = await computeAvgResolutionHours(rows.filter(function(r) { return r.closed; }));
  var byLevel = groupCount(rows, 'level');
  var byRisk = groupCount(rows, 'fixedRisk');
  var overdue = overdueCritical(rows, settings.overdueDays);
  var weeks = weeksInRange(settings.from, settings.to);
  var snapshots = await buildPlotMapSnapshots(plot, rows, weeks, settings, colorMaps);

  var html = '<section class="ri-report-plot-section">';
  html += '<h2 class="ri-report-plot-title">' + escHTML(plot.plotName) + '</h2>';
  html += kpiCardsHTML(kpis, avgHours);
  html += groupTableHTML('Разбивка по уровням опасности', byLevel);
  html += groupTableHTML('Разбивка по типам рисков', byRisk);
  if (overdue.length) html += overdueTableHTML(overdue, settings.overdueDays);
  if (snapshots.length) {
    html += '<div class="ri-report-block"><h3 class="ri-report-block-title">Карта по неделям</h3>' +
      '<div class="ri-report-maps-grid">' + snapshots.map(function(s) {
        return '<figure class="ri-report-map-card"><img src="' + escAttr(s.dataUrl) + '" alt="Карта, ' + escAttr(formatWeekKey(s.weekKey)) + '">' +
          '<figcaption>' + escHTML(formatWeekKey(s.weekKey)) + ' — обращений: ' + s.count + '</figcaption></figure>';
      }).join('') + '</div></div>';
  } else {
    html += '<p class="ri-form-hint">Для этого участка нет откалиброванных схем за выбранный период — карта не построена.</p>';
  }
  html += '</section>';
  return html;
}

async function generateReport(panelEl) {
  var settings = readReportSettings(panelEl);
  if (!settings.from || !settings.to || settings.from > settings.to) {
    Toast.show('Проверьте период отчёта (дата "с" не может быть позже даты "по")', 'warning');
    return;
  }
  if (!settings.plotIds.length) {
    Toast.show('Выберите хотя бы один участок', 'warning');
    return;
  }

  var outputEl = panelEl.querySelector('#ri-report-output');
  var printBtn = panelEl.querySelector('#ri-report-print');
  printBtn.hidden = true;
  outputEl.innerHTML = '<p class="ri-form-hint" style="margin-top:16px">Формирование отчёта…</p>';

  var allRows = filterReportRows(await RiskApi.calllog.list(), settings);
  var colorMaps = {
    levelColorMap: await RiskApi.colors.getLevelColorMap(),
    riskColorMap: await RiskApi.colors.getRiskColorMap(),
    faultColor: await RiskApi.colors.getFaultColor(),
  };
  var selectedPlots = ReportsState.plots.filter(function(p) { return settings.plotIds.indexOf(p.id) !== -1; });

  var overallKpis = computeKpis(allRows);
  var overallAvgHours = await computeAvgResolutionHours(allRows.filter(function(r) { return r.closed; }));

  var sectionsHtml = '';
  for (var i = 0; i < selectedPlots.length; i++) {
    var plotRows = allRows.filter(function(r) { return r.plotNameId === selectedPlots[i].id; });
    if (!plotRows.length) continue; // участок без единого обращения за период — раздел не строим
    sectionsHtml += await renderPlotSection(selectedPlots[i], plotRows, settings, colorMaps);
  }

  var headerHtml =
    '<div class="ri-report-header">' +
      '<h1 class="ri-report-title">Отчёт по обращениям</h1>' +
      '<p class="ri-report-period">Период: ' + formatDateOnly(settings.from) + ' — ' + formatDateOnly(settings.to) +
        ' · сформирован ' + formatDateOnly(new Date()) + '</p>' +
    '</div>' +
    '<h3 class="ri-report-block-title">Сводка по всем выбранным участкам</h3>' +
    kpiCardsHTML(overallKpis, overallAvgHours);

  outputEl.innerHTML = headerHtml + (sectionsHtml || '<p class="ri-form-hint">Нет обращений, соответствующих выбранным фильтрам за этот период.</p>');
  printBtn.hidden = false;
}
