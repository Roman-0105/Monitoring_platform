/**
 * ui-points.js — список точек, фильтры, сотрудники.
 * Извлечено из app.js.
 * Зависит от: ui-utils.js, Points, Workers, Photos, MapModule, Schemes
 */

var _pointsFilters = { dates: [], worker: 'all', search: '' };

// Кэш историй графиков: { pointId: [ ...history ] }
// Хранится вне DOM — не теряется при перерисовке списка
var _chartCache = {};

// Подсвечивает вхождения строки поиска в тексте
function highlightSearch(text, search) {
  if (!search || !text) return escAttr(String(text || ''));
  var escaped = escAttr(String(text));
  var searchEsc = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return escaped.replace(new RegExp('(' + escAttr(search).replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi'),
      '<span class="search-highlight">$1</span>');
  } catch(e) { return escaped; }
}

// ── Список точек ──────────────────────────────────────────

function initPointsFilters() {
  var bar = document.getElementById('filter-bar');
  if (!bar) return;

  // Пересоздаём HTML если структура устарела (нет поля поиска)
  if (!bar._built || !document.getElementById('points-search')) {
    bar._built = true;
    bar.innerHTML =
      '<div class="points-search-wrap">' +
        '<span class="points-search-icon">🔍</span>' +
        '<input id="points-search" type="text" class="points-search-input" placeholder="Поиск по номеру, сотруднику, комментарию...">' +
        '<button class="points-search-clear" id="points-search-clear" title="Очистить" style="display:none">✕</button>' +
      '</div>' +
      '<div class="points-filter-row">' +
        '<div id="points-date-filter-wrap"></div>' +
        '<select id="points-filter-worker" class="filter-select filter-select--full-mobile"></select>' +
      '</div>';
  }

  // Поиск — вешаем обработчик один раз
  var searchInp = document.getElementById('points-search');
  var searchClear = document.getElementById('points-search-clear');
  if (searchInp && !searchInp._bound) {
    searchInp._bound = true;
    // Восстанавливаем текущее значение
    if (_pointsFilters.search) {
      searchInp.value = _pointsFilters.search;
      if (searchClear) searchClear.style.display = 'flex';
    }
    searchInp.addEventListener('input', function() {
      _pointsFilters.search = this.value.trim().toLowerCase();
      if (searchClear) searchClear.style.display = _pointsFilters.search ? 'flex' : 'none';
      renderPointsList();
    });
  }
  if (searchClear && !searchClear._bound) {
    searchClear._bound = true;
    searchClear.addEventListener('click', function() {
      _pointsFilters.search = '';
      if (searchInp) searchInp.value = '';
      this.style.display = 'none';
      renderPointsList();
    });
  }

  // Виджет дат пересобираем каждый раз (могут появиться новые даты после синхронизации)
  buildDateFilterWidget('points-date-filter-wrap', _pointsFilters.dates, function(newDates) {
    _pointsFilters.dates = newDates;
    renderPointsList();
  });

  // Список сотрудников тоже пересобираем
  var workerSel = document.getElementById('points-filter-worker');
  if (!workerSel) return;

  var workerSet = {};
  Points.getList().forEach(function(p) { if (p.worker) workerSet[p.worker] = true; });
  Workers.getList().forEach(function(w) { if (w.name) workerSet[w.name] = true; });
  var workers = Object.keys(workerSet).sort().map(function(w) { return { value: w, label: w }; });
  fillSelectOptions(workerSel, workers, _pointsFilters.worker, 'Все сотрудники');

  if (!workerSel._bound) {
    workerSel._bound = true;
    workerSel.addEventListener('change', function() {
      _pointsFilters.worker = workerSel.value || 'all';
      renderPointsList();
    });
  }
}

// ── Вспомогательные функции рендера карточек ──────────────

function _diRow(label, val) {
  return '<div style="display:flex;justify-content:space-between;gap:4px;font-size:10px;line-height:1.4;' +
         'border-bottom:1px solid rgba(48,54,61,.3);padding:1px 0">' +
         '<span style="color:var(--txt-3);flex-shrink:0">' + label + '</span>' +
         '<span style="color:var(--txt-2);font-weight:500;text-align:right;white-space:nowrap;' +
         'overflow:hidden;text-overflow:ellipsis">' + val + '</span></div>';
}

function _dmRow(label, val) {
  return '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;' +
         'padding:3px 0;border-bottom:1px solid rgba(48,54,61,.35);font-size:11px">' +
         '<span style="color:var(--txt-3);flex-shrink:0;font-size:10px">' + label + '</span>' +
         '<span style="color:var(--txt-2);font-weight:500;text-align:right">' + val + '</span></div>';
}

function _secHdr(title) {
  return '<div style="display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;' +
         'color:var(--txt-2);letter-spacing:.06em;text-transform:uppercase;' +
         'padding-bottom:6px;border-bottom:1px solid var(--line-2);margin-bottom:8px">' +
         '<span style="display:inline-block;width:3px;height:12px;border-radius:2px;' +
         'background:var(--gold);flex-shrink:0"></span>' + title + '</div>';
}

function _kpiCard(idSuffix, label, unit) {
  return '<div style="background:var(--bg-2);border:1px solid var(--line-2);border-radius:5px;padding:8px 10px">' +
         '<div style="font-size:9px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">' + label + '</div>' +
         '<div style="font-size:17px;font-weight:700;color:var(--gold);line-height:1" id="dm-kpi-' + idSuffix + '">—</div>' +
         '<div style="font-size:9px;color:var(--txt-3)" id="dm-kpi-' + idSuffix + '-sub">' + unit + '</div>' +
         '</div>';
}

function renderPointsList() {
  var container = document.getElementById('points-list');
  if (!container) return;
  initPointsFilters();
  var points    = getFilteredPoints(_pointsFilters);
  var allPoints = Points.getList();

  if (!points.length) {
    container.innerHTML = '<p class="empty-msg">Нет точек по выбранному фильтру</p>';
    var c0 = document.getElementById('points-count-badge');
    if (c0) c0.textContent = '0 / ' + allPoints.length + ' точек';
    return;
  }

  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';

  for (var i = 0; i < points.length; i++) {
    var p          = points[i];
    var syncStatus = p.syncStatus || 'pending';
    var hasPhoto   = p.photoUrls && p.photoUrls[0];
    var _s         = _pointsFilters.search || '';

    var statusClass = p.status === 'Новая'    ? 'badge-new'    :
                      p.status === 'Активная' ? 'badge-active' :
                      p.status === 'Иссякает' ? 'badge-fading' :
                      p.status === 'Пересохла'? 'badge-dry'    : '';

    var syncColor = syncStatus === 'synced' ? 'var(--ok)' :
                    syncStatus === 'error'  ? 'var(--bad)' : 'var(--warn)';
    var syncTitle = syncStatus === 'synced' ? 'Синхронизировано' :
                    syncStatus === 'error'  ? 'Ошибка синхронизации' : 'Ожидает отправки';

    var m3h = '';
    if (p.flowRate != null && !isNaN(parseFloat(p.flowRate))) {
      m3h = (parseFloat(p.flowRate) * 3.6).toFixed(2) + ' м³/ч';
    }

    var pendingBorder = syncStatus !== 'synced' ? 'border-left:3px solid var(--warn);' : '';
    html += '<div class="point-card" style="display:flex;height:160px;position:relative;' + pendingBorder + '">';

    html += '<span title="' + syncTitle + '" style="' +
            'position:absolute;top:7px;left:7px;z-index:2;' +
            'width:7px;height:7px;border-radius:50%;' +
            'background:' + syncColor + ';' +
            'border:1px solid rgba(13,17,23,.5)"></span>';

    // Левая 1/3 — данные
    html += '<div style="flex:1;padding:8px 10px 8px 16px;display:flex;flex-direction:column;' +
            'gap:3px;min-width:0;border-right:1px solid var(--line-2)">';

    html += '<div style="font-size:18px;font-weight:700;color:var(--gold);line-height:1;margin-bottom:2px">' +
            highlightSearch(p.pointNumber || '—', _s) + '</div>';

    html += '<div style="font-size:11px;color:var(--txt-1);font-weight:500;' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
            highlightSearch(p.wall || p.domain || '—', _s) + '</div>';

    if (p.horizon)      html += _diRow('Горизонт', highlightSearch(p.horizon, _s));
    if (m3h)            html += _diRow('Дебит', '<span style="color:var(--ok)">' + m3h + '</span>');
    else                html += _diRow('Дебит', '—');
    html += _diRow('Дата', formatMonitoringDate(p.monitoringDate));
    if (p.measureMethod) html += _diRow('Способ',  escAttr(p.measureMethod));
    if (p.intensity)     html += _diRow('Интенс.', escAttr(p.intensity));

    html += '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:3px;margin-top:auto">';
    if (p.status) html += '<span class="badge ' + statusClass + '">' + escAttr(p.status) + '</span>';
    if (p.domain) html += '<span class="badge badge-new">' + escAttr(p.domain) + '</span>';
    html += '<button class="btn-details-card" data-pid="' + p.id + '" ' +
            'style="margin-left:auto;height:20px;padding:0 7px;border-radius:3px;' +
            'border:1px solid rgba(88,166,255,.4);background:rgba(88,166,255,.1);' +
            'color:var(--gold);font-size:9px;font-weight:500;cursor:pointer;white-space:nowrap;' +
            'font-family:inherit">▶ Подробнее</button>';
    html += '</div>';

    html += '</div>';

    // Правая 2/3 — фото
    html += '<div style="flex:2;position:relative;background:var(--bg-0);overflow:hidden">';

    if (hasPhoto) {
      html += '<img class="card-photo-grid" data-url="' + escAttr(p.photoUrls[0]) + '" src="" alt="фото" ' +
              'style="width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in">';
    } else {
      html += '<div style="width:100%;height:100%;display:flex;flex-direction:column;' +
              'align-items:center;justify-content:center;gap:6px;' +
              'color:var(--txt-3);font-size:10px">' +
              '<div style="width:30px;height:24px;border:1px dashed var(--txt-3);' +
              'border-radius:3px;display:flex;align-items:center;justify-content:center">' +
              '<span style="font-size:12px">—</span></div>' +
              'нет фото</div>';
    }

    if (p.horizon) {
      html += '<div style="position:absolute;top:6px;left:6px;' +
              'background:rgba(13,17,23,.82);border:1px solid var(--line);' +
              'border-radius:3px;padding:2px 5px;font-size:9px;color:var(--txt-3)">' +
              escAttr(p.horizon) + '</div>';
    }

    if (m3h) {
      var qColor = p.status === 'Пересохла' ? 'var(--bad)' :
                   p.status === 'Иссякает'  ? 'var(--warn)' :
                   p.status === 'Активная'  ? 'var(--ok)' : 'var(--txt-1)';
      html += '<div style="position:absolute;bottom:6px;right:6px;' +
              'background:rgba(13,17,23,.82);border:1px solid var(--line);' +
              'border-radius:3px;padding:2px 6px;font-size:10px;font-weight:600;color:' + qColor + '">' +
              m3h + '</div>';
    }

    html += '</div>';
    html += '</div>';
  }

  html += '</div>';
  container.innerHTML = html;

  container.querySelectorAll('.card-photo-grid').forEach(function(img) {
    Photos.setImageSrc(img, img.dataset.url);
  });

  container.querySelectorAll('.btn-details-card').forEach(function(btn) {
    btn.addEventListener('click', function() { openDetailModal(this.dataset.pid); });
  });

  var countEl    = document.getElementById('points-count-badge');
  var countLabel = points.length + ' / ' + allPoints.length + ' точек';
  if (_pointsFilters.search) countLabel += ' · поиск: «' + _pointsFilters.search + '»';
  if (countEl) countEl.textContent = countLabel;

  updateMapLegendPoints();
}

// ── Карточка подробностей ──────────────────────────────────

function openDetailModal(pointId) {
  var p = Points.getList().filter(function(x) { return x.id === pointId; })[0];
  if (!p) return;

  var hasPhoto    = p.photoUrls && p.photoUrls[0];
  var m3h         = (p.flowRate != null && !isNaN(parseFloat(p.flowRate)))
                    ? (parseFloat(p.flowRate) * 3.6).toFixed(2) + ' м³/ч' : '—';
  var statusClass = p.status === 'Новая'    ? 'badge-new'    :
                    p.status === 'Активная' ? 'badge-active' :
                    p.status === 'Иссякает' ? 'badge-fading' :
                    p.status === 'Пересохла'? 'badge-dry'    : '';

  var overlay = document.createElement('div');
  overlay.id  = 'detail-modal-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.65);' +
                           'display:flex;align-items:flex-start;justify-content:center;' +
                           'padding:20px;overflow-y:auto';

  var box = document.createElement('div');
  box.style.cssText = 'width:100%;max-width:720px;background:var(--bg-1);' +
                       'border:1px solid var(--line);border-radius:8px;overflow:hidden;' +
                       'margin:auto;flex-shrink:0';

  var hdrHtml =
    '<div style="display:flex;align-items:center;padding:10px 14px;' +
    'border-bottom:1px solid var(--line);background:var(--bg-0);gap:10px">' +
      '<div style="min-width:0;flex:1">' +
        '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">' +
          '<span style="font-size:20px;font-weight:700;color:var(--gold)">' + escAttr(p.pointNumber || '—') + '</span>' +
          '<span style="font-size:13px;font-weight:500;color:var(--txt-1)">' + escAttr(p.wall || p.domain || '—') + '</span>' +
          (p.status ? '<span class="badge ' + statusClass + '">' + escAttr(p.status) + '</span>' : '') +
        '</div>' +
        '<div style="font-size:11px;color:var(--txt-3);margin-top:2px">' +
          escAttr((p.domain || '') + (p.domain && p.horizon ? ' · ' : '') + (p.horizon || '')) +
          ' · последний замер ' + formatMonitoringDate(p.monitoringDate) +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-shrink:0">' +
        '<button id="dm-print-btn" class="btn btn-sm btn-outline" data-pid="' + p.id + '">⎙ Печать</button>' +
        '<button id="dm-edit-btn"  class="btn btn-sm btn-outline" data-pid="' + p.id + '" ' +
        'style="border-color:rgba(88,166,255,.4);color:var(--gold)">✎ Изменить</button>' +
        '<button id="dm-del-btn"   class="btn btn-sm btn-danger"  data-pid="' + p.id + '">✕ Удалить</button>' +
        '<button id="dm-close-btn" class="btn btn-sm btn-outline" style="padding:0 8px">✕</button>' +
      '</div>' +
    '</div>';

  var bodyHtml = '<div style="padding:12px 14px;display:flex;flex-direction:column;gap:12px">';

  // Фото + данные
  bodyHtml +=
    '<div style="display:flex;gap:10px;height:160px">' +
      '<div style="flex:2;border-radius:5px;overflow:hidden;background:var(--bg-0);position:relative">';
  if (hasPhoto) {
    bodyHtml += '<img id="dm-photo" data-url="' + escAttr(p.photoUrls[0]) + '" src="" alt="фото" ' +
                'style="width:100%;height:100%;object-fit:cover;display:block">';
  } else {
    bodyHtml += '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
                'flex-direction:column;gap:6px;color:var(--txt-3);font-size:11px">' +
                '<span style="font-size:24px">📷</span>нет фото</div>';
  }
  bodyHtml += '<div style="position:absolute;bottom:6px;right:6px;background:rgba(13,17,23,.82);' +
              'border:1px solid var(--line);border-radius:3px;padding:2px 7px;' +
              'font-size:11px;font-weight:600;color:var(--txt-1)">Q: ' + m3h + '</div>';
  bodyHtml += '</div>';

  bodyHtml += '<div style="flex:3;display:flex;flex-direction:column;gap:0;' +
              'background:var(--bg-2);border-radius:5px;border:1px solid var(--line-2);padding:10px 12px">' +
              '<div style="font-size:10px;font-weight:600;letter-spacing:.06em;color:var(--txt-3);' +
              'text-transform:uppercase;margin-bottom:6px">Данные последнего замера</div>';

  if (p.horizon)      bodyHtml += _dmRow('Горизонт',      escAttr(p.horizon));
  bodyHtml += _dmRow('Дебит', m3h);
  bodyHtml += _dmRow('Дата замера', formatMonitoringDate(p.monitoringDate));
  if (p.measureMethod) bodyHtml += _dmRow('Способ',       escAttr(p.measureMethod));
  if (p.intensity)     bodyHtml += _dmRow('Интенсивность', escAttr(p.intensity));
  if (p.worker)        bodyHtml += _dmRow('Замерщик',      escAttr(p.worker));
  if (p.xLocal != null) bodyHtml += _dmRow('Координаты',
    'X: ' + Number(p.xLocal).toFixed(1) + ' Y: ' + Number(p.yLocal).toFixed(1));
  if (p.waterColor)   bodyHtml += _dmRow('Цвет воды',    escAttr(p.waterColor));
  if (p.comment)      bodyHtml += _dmRow('Примечание',   escAttr(p.comment));

  bodyHtml += '</div></div>';

  bodyHtml +=
    '<div>' + _secHdr('Аналитика') +
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">' +
      _kpiCard('avg',   'Среднее Q',   'м³/ч') +
      _kpiCard('max',   'Максимум',    'м³/ч') +
      _kpiCard('min',   'Минимум',     'м³/ч') +
      _kpiCard('count', 'Замеров',     'всего') +
    '</div></div>';

  bodyHtml +=
    '<div>' + _secHdr('История дебита') +
    '<div id="dm-chart-wrap" style="background:var(--bg-2);border:1px solid var(--line-2);' +
    'border-radius:5px;padding:10px 12px;min-height:80px">' +
    '<p style="font-size:11px;color:var(--txt-3);text-align:center;padding:16px 0">⏳ Загрузка...</p>' +
    '</div></div>';

  bodyHtml +=
    '<div>' + _secHdr('Журнал замеров') +
    '<div id="dm-history-wrap" style="background:var(--bg-2);border:1px solid var(--line-2);' +
    'border-radius:5px;overflow:hidden">' +
    '<p style="font-size:11px;color:var(--txt-3);text-align:center;padding:16px 0">⏳ Загрузка...</p>' +
    '</div></div>';

  bodyHtml += '</div>';

  box.innerHTML = hdrHtml + bodyHtml;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  var dmPhoto = box.querySelector('#dm-photo');
  if (dmPhoto) Photos.setImageSrc(dmPhoto, dmPhoto.dataset.url);

  function closeDetail() {
    var ol = document.getElementById('detail-modal-overlay');
    if (ol) ol.remove();
  }
  box.querySelector('#dm-close-btn').addEventListener('click', closeDetail);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeDetail(); });

  box.querySelector('#dm-print-btn').addEventListener('click', function() {
    closeDetail(); printPointCard(this.dataset.pid);
  });
  box.querySelector('#dm-edit-btn').addEventListener('click', function() {
    closeDetail(); openEditModal(this.dataset.pid);
  });
  box.querySelector('#dm-del-btn').addEventListener('click', function() {
    closeDetail(); confirmDelete(this.dataset.pid);
  });

  var cachedHistory = _chartCache[pointId];
  if (cachedHistory && cachedHistory.length) {
    renderDetailHistory(box, cachedHistory, p.pointNumber);
  } else {
    Api.getHistory(p.pointNumber).then(function(history) {
      _chartCache[pointId] = history || [];
      renderDetailHistory(box, _chartCache[pointId], p.pointNumber);
    }).catch(function(err) {
      var cw = box.querySelector('#dm-chart-wrap');
      if (cw) cw.innerHTML = '<p style="font-size:11px;color:var(--bad);padding:10px">Ошибка: ' + err.message + '</p>';
    });
  }
}

function renderDetailHistory(box, history, pointNumber) {
  var defined = (history || []).filter(function(r) { return r.flowRate != null; });
  var avg = 0, maxVal = 0, minVal = Infinity, maxDate = '', minDate = '';
  if (defined.length) {
    var sum = 0;
    defined.forEach(function(r) {
      var v = parseFloat(r.flowRate) * 3.6;
      sum += v;
      if (v > maxVal) { maxVal = v; maxDate = r.monitoringDate || r.date || ''; }
      if (v < minVal) { minVal = v; minDate = r.monitoringDate || r.date || ''; }
    });
    avg = sum / defined.length;
    if (minVal === Infinity) minVal = 0;
  }

  function kpiSet(id, val) { var el = box.querySelector(id); if (el) el.textContent = val; }
  kpiSet('#dm-kpi-avg',       defined.length ? avg.toFixed(2) : '—');
  kpiSet('#dm-kpi-avg-sub',   'м³/ч');
  kpiSet('#dm-kpi-max',       defined.length ? maxVal.toFixed(2) : '—');
  kpiSet('#dm-kpi-max-sub',   maxDate ? formatMonitoringDate(maxDate) : 'м³/ч');
  kpiSet('#dm-kpi-min',       defined.length ? minVal.toFixed(2) : '—');
  kpiSet('#dm-kpi-min-sub',   minDate ? formatMonitoringDate(minDate) : 'м³/ч');
  kpiSet('#dm-kpi-count',     String(history.length));
  kpiSet('#dm-kpi-count-sub', 'всего');

  var chartWrap = box.querySelector('#dm-chart-wrap');
  if (chartWrap) renderPointChart(chartWrap, history, pointNumber);

  var histWrap = box.querySelector('#dm-history-wrap');
  if (!histWrap) return;
  if (!history.length) {
    histWrap.innerHTML = '<p style="font-size:11px;color:var(--txt-3);text-align:center;padding:16px 0">История замеров пуста</p>';
    return;
  }

  var SHOW = 5;
  function buildTable(all) {
    var rows  = all ? history : history.slice(0, SHOW);
    var thSt  = 'background:var(--bg-3);color:var(--txt-3);font-weight:600;font-size:9px;' +
                'letter-spacing:.05em;text-transform:uppercase;padding:5px 8px;' +
                'border-bottom:1px solid var(--line);text-align:left';
    var thead = '<thead><tr>' +
                '<th style="' + thSt + '">#</th>' +
                '<th style="' + thSt + '">Дата</th>' +
                '<th style="' + thSt + '">Q м³/ч</th>' +
                '<th style="' + thSt + '">Интенсивность</th>' +
                '<th style="' + thSt + '">Способ</th>' +
                '<th style="' + thSt + '">Замерщик</th>' +
                '<th style="' + thSt + '">St</th>' +
                '</tr></thead>';
    var tbody = '<tbody>';
    rows.forEach(function(r, idx) {
      var qVal   = (r.flowRate != null && !isNaN(parseFloat(r.flowRate)))
                   ? (parseFloat(r.flowRate) * 3.6).toFixed(2) : '—';
      var qColor = r.status === 'Пересохла' ? 'var(--bad)' :
                   r.status === 'Иссякает'  ? 'var(--warn)' :
                   r.status === 'Активная'  ? 'var(--ok)' : 'var(--txt-2)';
      var dotClr = r.status === 'Активная' ? 'var(--ok)' :
                   r.status === 'Иссякает' ? 'var(--warn)' : 'var(--txt-3)';
      var bg     = idx % 2 ? 'background:rgba(255,255,255,.01)' : '';
      var tdSt   = 'padding:5px 8px;border-bottom:1px solid var(--line-2)';
      tbody +=
        '<tr style="' + bg + '">' +
        '<td style="' + tdSt + ';color:var(--txt-3);font-size:10px">' + (history.length - idx) + '</td>' +
        '<td style="' + tdSt + ';color:var(--gold);font-size:10px">' + formatMonitoringDate(r.monitoringDate || r.date) + '</td>' +
        '<td style="' + tdSt + ';color:' + qColor + ';font-weight:500;font-size:10px">' + qVal + '</td>' +
        '<td style="' + tdSt + ';color:var(--txt-2);font-size:10px">' + escAttr(r.intensity || '—') + '</td>' +
        '<td style="' + tdSt + ';color:var(--txt-2);font-size:10px">' + escAttr(r.measureMethod || '—') + '</td>' +
        '<td style="' + tdSt + ';color:var(--txt-2);font-size:10px">' + escAttr(r.worker || '—') + '</td>' +
        '<td style="' + tdSt + ';text-align:center"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + dotClr + '"></span></td>' +
        '</tr>';
    });
    tbody += '</tbody>';
    var footer = (!all && history.length > SHOW)
      ? '<div id="dm-show-all" style="padding:6px 10px;border-top:1px solid var(--line-2);' +
        'font-size:10px;color:var(--txt-3);display:flex;justify-content:space-between;cursor:pointer">' +
        '<span>Показано ' + SHOW + ' из ' + history.length + '</span>' +
        '<span style="color:var(--gold)">Показать все ▾</span></div>' : '';
    return '<table style="width:100%;border-collapse:collapse">' + thead + tbody + '</table>' + footer;
  }

  histWrap.innerHTML = buildTable(false);
  var btn = histWrap.querySelector('#dm-show-all');
  if (btn) btn.addEventListener('click', function() { histWrap.innerHTML = buildTable(true); });
}


// ── Сотрудники ────────────────────────────────────────────

function renderWorkers() {
  var grid = document.getElementById('worker-grid');
  if (grid) {
    var workers = Workers.getList();
    var html = '';
    for (var i = 0; i < workers.length; i++) {
      var w = workers[i];
      html += '<div class="worker-btn" data-wname="' + escAttr(w.name) + '">';
      html += '<span class="worker-btn__avatar">' + initials(w.name) + '</span>';
      html += '<span>' + w.name + '</span></div>';
    }
    grid.innerHTML = html || '<p class="empty-msg" style="padding:8px 0">Нет сотрудников</p>';
  }
  updateWorkerSelects();
}

function renderWorkerManageList() {
  var container = document.getElementById('workers-manage-list');
  if (!container) return;
  var workers = Workers.getList();
  if (!workers.length) {
    container.innerHTML = '<p class="empty-msg" style="padding:8px 0">Список пуст</p>';
    return;
  }
  var html = '';
  for (var i = 0; i < workers.length; i++) {
    var w = workers[i];
    html += '<div class="worker-manage-row" data-wid="' + w.id + '">';
    html += '<input type="text" value="' + escAttr(w.name) + '">';
    html += '<button class="btn-icon btn-icon-del" type="button">×</button>';
    html += '</div>';
  }
  container.innerHTML = html;
  container.querySelectorAll('.worker-manage-row').forEach(function(row) {
    var wid = row.dataset.wid;
    row.querySelector('input').addEventListener('change', function() {
      renameWorker(wid, this.value);
    });
    row.querySelector('.btn-icon-del').addEventListener('click', function() {
      removeWorker(wid);
    });
  });

  var addBtn = document.getElementById('btn-add-worker');
  if (addBtn && !addBtn._bound) {
    addBtn._bound = true;
    addBtn.addEventListener('click', addWorker);
    document.getElementById('new-worker-name').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); addWorker(); }
    });
  }
}

function addWorker() {
  var inp  = document.getElementById('new-worker-name');
  var name = inp ? inp.value.trim() : '';
  if (!name) { alert('Введите имя'); return; }
  Workers.add(name).then(function() {
    if (inp) inp.value = '';
    renderWorkers();
    renderWorkerManageList();
  });
}

function removeWorker(id) {
  if (!confirm('Удалить сотрудника?')) return;
  Workers.remove(id).then(function() {
    renderWorkers();
    renderWorkerManageList();
  });
}

function renameWorker(id, newName) {
  if (!newName.trim()) return;
  var list = Workers.getList();
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      list[i].name      = newName.trim();
      list[i].updatedAt = new Date().toISOString();
      Storage.cacheWorkers(list);
      Api.saveWorker(list[i]).catch(function(e) { console.warn(e); });
      renderWorkers();
      break;
    }
  }
}

// ── Форма добавления ──────────────────────────────────────

function initAddForm() {
  var form = document.getElementById('add-form');
  if (form) form.addEventListener('submit', function(e) { e.preventDefault(); saveNewPoint(); });

  var gps = document.getElementById('btn-gps');
  if (gps) gps.addEventListener('click', function() { getGPSForForm('f'); });

  var fLat = document.getElementById('f-lat');
  var fLon = document.getElementById('f-lon');
  if (fLat) fLat.addEventListener('change', function() { recalcLocalCoords('f'); });
  if (fLon) fLon.addEventListener('change', function() { recalcLocalCoords('f'); });

  var fFlow = document.getElementById('f-flowrate');
  if (fFlow) fFlow.addEventListener('input', function() { updateFlowHint('f'); });
  updateFlowHint('f');

  // Ставим сегодняшнюю дату по умолчанию
  var fDate = document.getElementById('f-monitoring-date');
  if (fDate && !fDate.value) fDate.value = todayISO();

  // Заполняем datalist горизонтов
  fillHorizonsDatalist();
}

function fillHorizonsDatalist() {
  var dl = document.getElementById('horizons-datalist');
  if (!dl || typeof Storage === 'undefined') return;
  var horizons = Storage.getHorizons();
  dl.innerHTML = horizons.map(function(h) {
    return '<option value="' + escAttr(h) + '">';
  }).join('');
}

function resetAddForm() {
  var form = document.getElementById('add-form');
  if (form) form.reset();
  Photos.clearInput('f-photo', 'f-photo-preview');
  updateFlowHint('f');
  // После reset восстанавливаем сегодняшнюю дату
  var fDate = document.getElementById('f-monitoring-date');
  if (fDate) fDate.value = todayISO();
}

function saveNewPoint() {
  var data      = readFormFields('f');
  if (!data.pointNumber) { alert('Укажите номер точки'); return; }
  AppState.syncing = true;
  showLoader('Сохранение...');

  var photoFile = Photos.getFile('f-photo');
  var tid = Toast.progress('save-point', 'Сохранение точки...');
  Points.create(data).then(function(savedPoint) {
    if (!photoFile || !savedPoint || !savedPoint.id) return null;
    Toast.progress('save-point', 'Загрузка фото на Drive...', 50);
    var sizeMb = photoFile ? (photoFile.size/1024/1024).toFixed(2) + ' МБ' : '';
    showPhotoProgress('f-photo-progress', 'compressing', sizeMb);
    return Photos.upload(photoFile, savedPoint.id).then(function(driveUrl) {
      showPhotoProgress('f-photo-progress', 'done');
      var pt = Points.getById(savedPoint.id);
      if (pt) { pt.photoUrls = [driveUrl]; Storage.cachePoints(Points.getList()); }
    }).catch(function(photoErr) {
      showPhotoProgress('f-photo-progress', 'error', photoErr.message);
      Diagnostics.setError('photo', photoErr.message);
      Toast.show('Точка сохранена, фото не загрузилось', 'warning');
    });
  }).then(function() {
    resetAddForm();
    return Points.load();
  }).then(function() {
    renderPointsList();
    if (typeof _mapSchemeImg !== 'undefined' && _mapSchemeImg) redrawMap();
    switchTab('points');
    Diagnostics.set('pointsLoaded', Points.getList().length);
    AppState.syncing = false;
    hideLoader();
    Toast.done('save-point', 'Точка сохранена');
  }).catch(function(err) {
    Diagnostics.setError('sync', err.message);
    Toast.fail('save-point', 'Ошибка: ' + err.message);
    AppState.syncing = false;
    hideLoader();
  });
}

// ── Модал редактирования ──────────────────────────────────

function initEditModal() {
  var closeBtn = document.getElementById('edit-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', closeEditModal);
  var overlay  = document.getElementById('edit-modal');
  if (overlay) overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeEditModal();
  });
  var form = document.getElementById('edit-form');
  if (form) form.addEventListener('submit', function(e) { e.preventDefault(); saveEditedPoint(); });
  var delBtn = document.getElementById('e-delete-photo-btn');
  if (delBtn) delBtn.addEventListener('click', deletePointPhoto);

  var gpsEditBtn = document.getElementById('e-btn-gps');
  if (gpsEditBtn) gpsEditBtn.addEventListener('click', function() { getGPSForForm('e'); });

  var eLat = document.getElementById('e-lat');
  var eLon = document.getElementById('e-lon');
  if (eLat) eLat.addEventListener('change', function() { recalcLocalCoords('e'); });
  if (eLon) eLon.addEventListener('change', function() { recalcLocalCoords('e'); });

  var eFlow = document.getElementById('e-flowrate');
  if (eFlow) eFlow.addEventListener('input', function() { updateFlowHint('e'); });

  var addMapBtn = document.getElementById('btn-map-add-point');
  if (addMapBtn) addMapBtn.addEventListener('click', toggleMapAddMode);

  Photos.initPhotoInput('e-photo', 'e-new-photo-preview');
}

function openEditModal(id) {
  var p = Points.getById(id);
  if (!p) return;
  AppState.editingPointId = id;
  document.getElementById('edit-modal-title').textContent = 'Редактирование #' + p.pointNumber;
  setField('e-monitoring-date', p.monitoringDate || todayISO());
  setField('e-num',       p.pointNumber);
  setField('e-lat',       p.lat  != null ? p.lat  : '');
  setField('e-lon',       p.lon  != null ? p.lon  : '');
  setField('e-xlocal',    p.xLocal != null ? Number(p.xLocal).toFixed(4) : '');
  setField('e-ylocal',    p.yLocal != null ? Number(p.yLocal).toFixed(4) : '');
  setField('e-intensity', p.intensity   || '');
  setField('e-flowrate',  p.flowRate != null ? p.flowRate : '');
  updateFlowHint('e');
  setField('e-color',     p.waterColor  || '');
  setField('e-wall',      p.wall        || '');
  setField('e-domain',    p.domain      || '');
  setField('e-status',    p.status      || 'Новая');
  setField('e-measure',   p.measureMethod || '');
  setField('e-horizon',   p.horizon       || '');
  fillHorizonsDatalist();
  setField('e-comment',   p.comment     || '');
  updateWorkerSelects();
  setField('e-worker', p.worker || '');

  var coordInfo = document.getElementById('e-map-coord-info');
  if (coordInfo) coordInfo.textContent = '';

  var preview = document.getElementById('e-photo-preview');
  if (preview) {
    preview.innerHTML = '';
    if (p.photoUrls && p.photoUrls[0]) {
      var img = document.createElement('img');
      img.alt = 'текущее фото';
      img.style.cssText = 'max-width:100%;max-height:160px;border-radius:6px;display:block;margin-bottom:4px';
      var lbl = document.createElement('p');
      lbl.className   = 'form-hint';
      lbl.textContent = 'Загрузка фото...';
      preview.appendChild(img);
      preview.appendChild(lbl);
      Photos.setImageSrc(img, p.photoUrls[0]);
      img.onload  = function() { lbl.textContent = 'Текущее фото'; };
      img.onerror = function() { lbl.textContent = 'Фото недоступно'; };
    }
  }

  var delBtn2 = document.getElementById('e-delete-photo-btn');
  // Инициализируем галерею редактирования с существующими фото
  var hasPhoto = !!(p.photoUrls && p.photoUrls[0]);
  if (delBtn2) delBtn2.style.display = hasPhoto ? 'inline-flex' : 'none';

  var ePhotoBtn = document.getElementById('e-photo-btn');
  if (ePhotoBtn) {
    ePhotoBtn.textContent = hasPhoto ? '📷 Заменить фото' : '📷 Загрузить фото';
    if (!ePhotoBtn._photoModalBound) {
      ePhotoBtn._photoModalBound = true;
      ePhotoBtn.addEventListener('click', function() {
        var curHasPhoto = !!(document.getElementById('e-photo-preview') &&
          document.getElementById('e-photo-preview').querySelector('img'));
        showPhotoSourceModal('e-photo', 'e-new-photo-preview', 'e-photo-progress', curHasPhoto);
      });
    }
  }

  Photos.clearInput('e-photo', 'e-new-photo-preview');
  document.getElementById('edit-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none';
  document.body.style.overflow = '';
  AppState.editingPointId = null;
  var form = document.getElementById('edit-form');
  if (form) form._mapCoords = null;
  var title = document.getElementById('edit-modal-title');
  if (title) title.textContent = 'Редактирование';
  var submitBtn = form && form.querySelector('[type=submit]');
  if (submitBtn) submitBtn.textContent = 'Сохранить изменения';
  var coordInfo = document.getElementById('e-map-coord-info');
  if (coordInfo) coordInfo.textContent = '';
}

function saveEditedPoint() {
  var form      = document.getElementById('edit-form');
  var mapCoords = form ? form._mapCoords : null;
  var isMapAdd  = !AppState.editingPointId && !!mapCoords;
  var id        = AppState.editingPointId;
  var data = readFormFields('e');
  if (!data.pointNumber) { alert('Укажите номер точки'); return; }

  if (mapCoords) {
    data.xLocal = mapCoords.xLocal;
    data.yLocal = mapCoords.yLocal;
  }
  if ((data.xLocal == null || data.yLocal == null) && data.lat && data.lon &&
      typeof MapModule !== 'undefined') {
    var sk = MapModule.wgs84ToXY(data.lat, data.lon);
    data.xLocal = sk.x; data.yLocal = sk.y;
  }

  showLoader('Сохранение...');
  closeEditModal();
  AppState.syncing = true;
  var chain;

  var ePhotoFile = Photos.getFile('e-photo');

  if (isMapAdd) {
    chain = Points.create(data).then(function(savedPoint) {
      if (!ePhotoFile || !savedPoint || !savedPoint.id) return null;
      showLoader('Загрузка фото...');
      return Photos.upload(ePhotoFile, savedPoint.id).catch(function(photoErr) {
        Diagnostics.setError('photo', photoErr.message);
        alert('Точка сохранена, но фото не загрузилось: ' + photoErr.message);
      });
    }).then(function() {
      if (typeof _mapSchemeImg !== 'undefined' && _mapSchemeImg) redrawMap();
    });
  } else if (ePhotoFile) {
    showLoader('Загрузка фото...');
    chain = Photos.upload(ePhotoFile, id).then(function(driveUrl) {
      data.photoUrls = [driveUrl];
      return Points.update(id, data);
    }).catch(function(photoErr) {
      Diagnostics.setError('photo', photoErr.message);
      alert('Фото не загрузилось: ' + photoErr.message);
      return Points.update(id, data);
    });
  } else {
    chain = Points.update(id, data);
  }

  var etid = Toast.progress('edit-point', 'Сохранение изменений...');
  chain.then(function() {
    return Points.load();
  }).then(function() {
    renderPointsList();
    if (typeof _mapSchemeImg !== 'undefined' && _mapSchemeImg) redrawMap();
    Diagnostics.set('pointsLoaded', Points.getList().length);
    AppState.syncing = false;
    hideLoader();
    Toast.done('edit-point', 'Изменения сохранены');
  }).catch(function(err) {
    Diagnostics.setError('sync', err.message);
    Toast.fail('edit-point', 'Ошибка: ' + err.message);
    AppState.syncing = false;
    hideLoader();
  });
}

function deletePointPhoto() {
  if (!AppState.editingPointId) return;
  if (!confirm('Удалить фото этой точки?')) return;
  var id = AppState.editingPointId;
  AppState.syncing = true;
  showLoader('Удаление фото...');

  var pt = Points.getById(id);
  if (pt && pt.photoUrls && pt.photoUrls[0] && typeof Photos !== 'undefined') {
    Photos.clearCache(pt.photoUrls[0]);
  }
  if (pt) { pt.photoUrls = []; Storage.cachePoints(Points.getList()); }

  var preview = document.getElementById('e-photo-preview');
  if (preview) preview.innerHTML = '';
  var delBtn = document.getElementById('e-delete-photo-btn');
  if (delBtn) delBtn.style.display = 'none';
  renderPointsList();
  hideLoader();
  AppState.syncing = false;

  Api.deletePhoto(id).then(function() {
    return Points.update(id, { photoUrls: [] });
  }).catch(function(err) {
    Diagnostics.setError('photo', 'Удаление фото: ' + err.message);
  });
}

function confirmDelete(id) {
  var p = Points.getById(id);
  if (!p) return;
  if (!confirm('Удалить точку #' + p.pointNumber + '?')) return;
  showLoader('Удаление...');
  Points.remove(id).then(function() {
    return Points.load();
  }).then(function() {
    renderPointsList();
    Diagnostics.set('pointsLoaded', Points.getList().length);
    hideLoader();
  }).catch(function(err) {
    Diagnostics.setError('sync', err.message);
    alert('Ошибка: ' + err.message);
    hideLoader();
  });
}
