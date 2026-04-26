/**
 * ui-stats.js — страница аналитики.
 * Извлечено из app.js.
 * Зависит от: ui-utils.js, Points, Workers, Schemes
 */

var _statsFilters = { dates: [], worker: 'all' };

function initStatsFilters() {
  var workerSel = document.getElementById('stats-worker');
  if (!workerSel) return;

  // Виджет дат — пересобираем каждый раз
  buildDateFilterWidget('stats-date-filter-wrap', _statsFilters.dates, function(newDates) {
    _statsFilters.dates = newDates;
    renderStatsPage();
  });

  // Список сотрудников
  var workerSet = {};
  Points.getList().forEach(function(p) { if (p.worker) workerSet[p.worker] = true; });
  Workers.getList().forEach(function(w) { if (w.name) workerSet[w.name] = true; });
  var workers = Object.keys(workerSet).sort().map(function(w) { return { value: w, label: w }; });
  fillSelectOptions(workerSel, workers, _statsFilters.worker, 'Все сотрудники');

  if (!workerSel._bound) {
    workerSel._bound = true;
    workerSel.addEventListener('change', function() {
      _statsFilters.worker = workerSel.value || 'all';
      renderStatsPage();
    });
  }
}

// Возвращает актуальную палитру статусов с учётом пользовательских настроек
function getStatusPalette() {
  var defaults = {
    'Новая':      '#4f8dff',
    'Активная':   '#39d98a',
    'Иссякает':   '#f3bf4a',
    'Пересохла':  '#ff6b6b',
    'Паводковая': '#a78bfa',
    'Перелив':    '#38bdf8',
    'Неизвестно': '#8f9aae',
  };
  // Подмешиваем пользовательские цвета если есть
  if (typeof MapModule !== 'undefined') {
    var cfg = MapModule.getStyleConfig();
    if (cfg && cfg.statusColors) {
      Object.keys(cfg.statusColors).forEach(function(s) {
        defaults[s] = cfg.statusColors[s];
      });
    }
  }
  return defaults;
}

function renderStatsPage() {
  initStatsFilters();
  var points        = getFilteredPoints(_statsFilters);
  renderExportButton(points);
  var grid          = document.getElementById('stats-grid');
  var statusList    = document.getElementById('stats-status-list');
  var domainList    = document.getElementById('stats-domain-list');
  var horizonList   = document.getElementById('stats-horizon-list');
  var statusChart   = document.getElementById('stats-status-chart');
  var intensityChart = document.getElementById('stats-intensity-chart');
  if (!grid || !statusList || !domainList || !statusChart || !intensityChart) return;

  var totalFlow = 0, withFlow = 0, withPhoto = 0, active = 0;
  points.forEach(function(p) {
    var flow = parseFloat(p.flowRate);
    if (!isNaN(flow)) { totalFlow += flow; withFlow++; }
    if (p.photoUrls && p.photoUrls[0]) withPhoto++;
    if (p.status === 'Активная' || p.status === 'Паводковая' || p.status === 'Перелив') active++;
  });

  var avgFlow = withFlow ? (totalFlow / withFlow) : null;

  grid.innerHTML =
    '<div class="stats-kpi"><div class="stats-kpi__label">Всего точек</div><div class="stats-kpi__value">' + points.length + '</div></div>' +
    '<div class="stats-kpi"><div class="stats-kpi__label">Активных</div><div class="stats-kpi__value">' + active + '</div></div>' +
    '<div class="stats-kpi"><div class="stats-kpi__label">С фото</div><div class="stats-kpi__value">' + withPhoto + '</div></div>' +
    '<div class="stats-kpi"><div class="stats-kpi__label">Средний водоприток</div><div class="stats-kpi__value">' +
      (avgFlow != null ? avgFlow.toFixed(2) : '—') + ' л/с<small>' +
      (avgFlow != null ? lpsToM3h(avgFlow).toFixed(2) : '—') + ' м³/ч</small></div></div>' +
    '<div class="stats-kpi"><div class="stats-kpi__label">Суммарный водоприток</div><div class="stats-kpi__value">' +
      totalFlow.toFixed(2) + ' л/с<small>' + lpsToM3h(totalFlow).toFixed(2) + ' м³/ч</small></div></div>';

  var byStatus    = {};
  var byDomain    = {};
  var byIntensity = {};
  var byHorizon   = {};   // { name: { count, totalLps, withFlow } }

  points.forEach(function(p) {
    var s = p.status    || 'Неизвестно';
    var d = p.domain    || '—';
    var i = p.intensity || 'Не указана';
    var h = p.horizon   || '—';
    byStatus[s]    = (byStatus[s]    || 0) + 1;
    byDomain[d]    = (byDomain[d]    || 0) + 1;
    byIntensity[i] = (byIntensity[i] || 0) + 1;

    if (!byHorizon[h]) byHorizon[h] = { count: 0, totalLps: 0, withFlow: 0, byStatus: {}, topPoints: [] };
    byHorizon[h].count++;
    byHorizon[h].byStatus[p.status || '—'] = (byHorizon[h].byStatus[p.status || '—'] || 0) + 1;
    var flow = parseFloat(p.flowRate);
    if (!isNaN(flow)) {
      byHorizon[h].totalLps += flow;
      byHorizon[h].withFlow++;
    }
    byHorizon[h].topPoints.push({ num: p.pointNumber, status: p.status, flow: isNaN(flow) ? null : flow });
  });

  function renderBreakdown(obj) {
    var keys = Object.keys(obj).sort(function(a, b) { return obj[b] - obj[a]; });
    if (!keys.length) return '<p class="form-hint">Нет данных по фильтру.</p>';
    var html = '<div class="stats-list">';
    keys.forEach(function(k) {
      html += '<div class="stats-list-row"><span>' + k + '</span><b>' + obj[k] + '</b></div>';
    });
    return html + '</div>';
  }

  statusList.innerHTML = renderBreakdown(byStatus);
  domainList.innerHTML = renderBreakdown(byDomain);
  if (horizonList) horizonList.innerHTML = renderHorizonBreakdown(byHorizon);

  renderPieChart(statusChart, byStatus, getStatusPalette());
  renderPieChart(intensityChart, byIntensity, {
    'Слабая (капёж)': '#8bc8ff',
    'Умеренная':      '#39d98a',
    'Сильная (поток)':'#f3bf4a',
    'Очень сильная':  '#ff8a4a',
    'Не указана':     '#8f9aae',
  });
}

function renderHorizonBreakdown(byHorizon) {
  var keys = Object.keys(byHorizon);
  if (!keys.length) return '<p class="form-hint">Нет точек с указанным горизонтом.</p>';

  var STATUS_COLORS = {
    'Активная':   '#3fb950',
    'Новая':      '#58a6ff',
    'Иссякает':   '#d29922',
    'Пересохла':  '#f85149',
    'Паводковая': '#bc8cff',
    'Перелив':    '#79c0ff',
  };

  // Сортируем горизонты: числовые по возрастанию высотной отметки, «—» в конец
  keys.sort(function(a, b) {
    if (a === '—') return 1;
    if (b === '—') return -1;
    var na = parseFloat(String(a).replace(/[^\d.-]/g, ''));
    var nb = parseFloat(String(b).replace(/[^\d.-]/g, ''));
    if (!isNaN(na) && !isNaN(nb)) return nb - na; // выше = первый
    return a < b ? -1 : 1;
  });

  var maxM3h = 0;
  keys.forEach(function(k) {
    var v = lpsToM3h(byHorizon[k].totalLps);
    if (v > maxM3h) maxM3h = v;
  });
  if (maxM3h === 0) maxM3h = 1;

  var grandTotal = 0, grandCount = 0;
  keys.filter(function(k){ return k !== '—'; }).forEach(function(k) {
    grandTotal += byHorizon[k].totalLps;
    grandCount += byHorizon[k].count;
  });

  var html = '';

  keys.forEach(function(h) {
    var d        = byHorizon[h];
    var m3h      = lpsToM3h(d.totalLps);
    var avgM3h   = d.withFlow ? m3h / d.withFlow : null;
    var barPct   = maxM3h > 0 ? Math.round(m3h / maxM3h * 100) : 0;
    var isUnknown = h === '—';
    var shareOfTotal = grandTotal > 0 ? Math.round(d.totalLps / grandTotal * 100) : 0;

    // Топ-3 точки по дебиту
    var sorted = (d.topPoints || []).slice().sort(function(a, b) { return (b.flow || 0) - (a.flow || 0); });
    var top3   = sorted.slice(0, 3);

    html +=
      '<div style="background:var(--bg-2);border:1px solid var(--line-2);border-radius:6px;padding:10px 12px;margin-bottom:8px">' +

        // Заголовок горизонта
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">' +
          '<span style="font-size:14px;font-weight:700;color:var(--gold)">' +
            (isUnknown ? '—' : h) +
          '</span>' +
          '<span style="font-size:10px;color:var(--txt-3)">' +
            (isUnknown ? 'горизонт не указан' : 'м') +
          '</span>' +
          '<span style="margin-left:auto;font-size:11px;font-weight:600;color:var(--txt-2)">' +
            d.count + ' ' + (d.count === 1 ? 'точка' : d.count < 5 ? 'точки' : 'точек') +
          '</span>' +
        '</div>' +

        // Q + прогресс-бар
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
          '<div style="flex:1">' +
            '<div style="height:8px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden;margin-bottom:3px">' +
              '<div style="height:8px;border-radius:4px;background:var(--gold);width:' + barPct + '%;transition:width .4s"></div>' +
            '</div>' +
            '<div style="display:flex;justify-content:space-between;font-size:9px;color:var(--txt-3)">' +
              '<span>' + (d.withFlow ? m3h.toFixed(2) + ' м³/ч суммарно' : 'нет данных по дебиту') + '</span>' +
              (d.withFlow && !isUnknown ? '<span>' + shareOfTotal + '% от итога карьера</span>' : '') +
            '</div>' +
          '</div>' +
          '<div style="text-align:right;flex-shrink:0">' +
            '<div style="font-size:16px;font-weight:700;color:' + (d.withFlow ? 'var(--gold)' : 'var(--txt-3)') + '">' +
              (d.withFlow ? m3h.toFixed(2) : '—') +
            '</div>' +
            '<div style="font-size:9px;color:var(--txt-3)">м³/ч</div>' +
          '</div>' +
        '</div>' +

        // Разбивка по статусам (цветные бейджи-числа)
        '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">' +
          (function() {
            var badges = '';
            var statusOrder = ['Паводковая','Активная','Иссякает','Новая','Пересохла','Перелив'];
            statusOrder.forEach(function(s) {
              if (!d.byStatus[s]) return;
              var clr = STATUS_COLORS[s] || '#8b949e';
              badges +=
                '<span style="display:inline-flex;align-items:center;gap:3px;' +
                'background:' + clr.replace(')', ',.12)').replace('rgb', 'rgba') + ';' +
                'border:1px solid ' + clr.replace(')', ',.35)').replace('rgb', 'rgba') + ';' +
                'border-radius:3px;padding:2px 6px;font-size:9px;font-weight:600;color:' + clr + '">' +
                '<span style="display:inline-block;width:5px;height:5px;border-radius:50%;background:' + clr + ';flex-shrink:0"></span>' +
                s + ' · ' + d.byStatus[s] +
                '</span>';
            });
            // Остальные статусы
            Object.keys(d.byStatus).forEach(function(s) {
              if (statusOrder.indexOf(s) >= 0) return;
              badges +=
                '<span style="background:rgba(139,148,158,.1);border:1px solid rgba(139,148,158,.25);' +
                'border-radius:3px;padding:2px 6px;font-size:9px;color:var(--txt-2)">' +
                s + ' · ' + d.byStatus[s] + '</span>';
            });
            return badges;
          })() +
        '</div>' +

        // Топ-3 точки
        (top3.length ? (
          '<div style="display:flex;gap:5px;align-items:center">' +
            '<span style="font-size:9px;color:var(--txt-3);flex-shrink:0">Топ Q:</span>' +
            top3.map(function(p) {
              var clr = STATUS_COLORS[p.status] || '#8b949e';
              return '<span style="font-size:10px;color:' + clr + ';font-weight:500">' +
                     '№' + p.num + (p.flow != null ? ' · ' + lpsToM3h(p.flow).toFixed(2) + ' м³/ч' : '') +
                     '</span>';
            }).join('<span style="color:var(--txt-3);margin:0 2px">·</span>') +
          '</div>'
        ) : '') +

      '</div>';
  });

  // Итог
  if (keys.filter(function(k){ return k !== '—'; }).length > 1) {
    html +=
      '<div style="display:flex;gap:16px;flex-wrap:wrap;padding:10px 12px;' +
      'background:var(--bg-3);border:1px solid var(--line);border-radius:6px;font-size:12px">' +
        '<span style="color:var(--txt-3)">Итого по карьеру:</span>' +
        '<span><b style="color:var(--txt-1)">' + grandCount + ' точек</b></span>' +
        '<span><b style="color:var(--gold)">' + lpsToM3h(grandTotal).toFixed(2) + ' м³/ч</b></span>' +
        '<span style="color:var(--txt-3)">· ' + grandTotal.toFixed(2) + ' л/с</span>' +
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
