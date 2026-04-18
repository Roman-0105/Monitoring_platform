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

  var html = '';
  for (var i = 0; i < points.length; i++) {
    var p        = points[i];
    var syncStatus   = p.syncStatus || 'pending';
    var statusColors = (typeof MapModule !== 'undefined') ? MapModule.STATUS_COLORS : {};
    var statusClass  = p.status === 'Новая'    ? 'badge-new'    :
                       p.status === 'Активная' ? 'badge-active' :
                       p.status === 'Иссякает' ? 'badge-fading' :
                       p.status === 'Пересохла'? 'badge-dry'    : '';
    var hasPhoto = p.photoUrls && p.photoUrls[0];

    var syncIcon, syncStyle;
    if (syncStatus === 'synced') {
      syncIcon  = '✓';
      syncStyle = 'display:inline-flex;align-items:center;justify-content:center;' +
                  'width:22px;height:22px;border-radius:50%;font-size:12px;font-weight:700;' +
                  'flex-shrink:0;margin-left:auto;cursor:default;' +
                  'background:rgba(52,168,83,.18);color:#34a853;border:1.5px solid rgba(52,168,83,.4)';
    } else if (syncStatus === 'error') {
      syncIcon  = '✕';
      syncStyle = 'display:inline-flex;align-items:center;justify-content:center;' +
                  'width:22px;height:22px;border-radius:50%;font-size:12px;font-weight:700;' +
                  'flex-shrink:0;margin-left:auto;cursor:default;' +
                  'background:rgba(234,67,53,.18);color:#ea4335;border:1.5px solid rgba(234,67,53,.4)';
    } else {
      syncIcon  = '⏳';
      syncStyle = 'display:inline-flex;align-items:center;justify-content:center;' +
                  'width:22px;height:22px;border-radius:50%;font-size:13px;' +
                  'flex-shrink:0;margin-left:auto;cursor:default;' +
                  'background:rgba(251,188,5,.15);color:#f9ab00;border:1.5px solid rgba(251,188,5,.4)';
    }

    html += '<div class="point-card' + (syncStatus !== 'synced' ? ' point-pending' : '') + '">';
    var _s = _pointsFilters.search || '';
    html += '<div class="point-card__header">';
    html += '<span class="point-card__num">#' + highlightSearch(p.pointNumber || '—', _s) + '</span>';
    html += '<span class="badge ' + statusClass + '">' + (p.status || '') + '</span>';
    html += '<span style="' + syncStyle + '" title="' +
            (syncStatus === 'synced' ? 'Синхронизировано' :
             syncStatus === 'error'  ? 'Ошибка синхронизации' : 'Ожидает отправки') +
            '">' + syncIcon + '</span>';
    html += '</div>';

    if (hasPhoto) {
      html += '<div class="point-card__photo-wrap">';
      html += '<img class="card-photo-thumb" data-url="' + escAttr(p.photoUrls[0]) + '" src="" alt="фото">';
      html += '</div>';
    }

    html += '<div class="point-card__body">';
    html += '<div class="pc-row"><span class="pc-lbl">👤</span><span>' + highlightSearch(p.worker || '—', _s) + '</span></div>';
    html += '<div class="pc-row"><span class="pc-lbl">📅</span><span>' + formatMonitoringDate(p.monitoringDate) + '</span></div>';
    html += '<div class="pc-row pc-row--muted"><span class="pc-lbl">🕐</span><span>' + formatDate(p.createdAt) + '</span></div>';
    if (p.domain || p.wall) {
      html += '<div class="pc-row">';
      if (p.domain) html += '<span class="pc-tag pc-domain">' + p.domain + '</span>';
      if (p.wall)   html += '<span class="pc-tag pc-wall">' + p.wall + '</span>';
      html += '</div>';
    }
    if (p.intensity || p.flowRate != null) {
      html += '<div class="pc-row"><span class="pc-lbl">💧</span><span>';
      if (p.intensity) html += p.intensity;
      if (p.flowRate != null) html += (p.intensity ? ' · ' : '') + formatFlowBothUnits(p.flowRate);
      html += '</span></div>';
    }
    if (p.waterColor) html += '<div class="pc-row"><span class="pc-lbl">🎨</span><span>' + p.waterColor + '</span></div>';
    if (p.xLocal != null) {
      html += '<div class="pc-row pc-coords"><span>X: ' + Number(p.xLocal).toFixed(2) +
              '  Y: ' + Number(p.yLocal).toFixed(2) + '</span></div>';
    }
    if (p.horizon) html += '<div class="pc-row"><span class="pc-lbl">⛰️</span><span style="font-size:12px;color:var(--txt-2)">' + highlightSearch(p.horizon, _s) + '</span></div>';
    if (p.measureMethod) html += '<div class="pc-row"><span class="pc-lbl">📐</span><span style="font-size:12px;color:var(--txt-3)">' + escAttr(p.measureMethod) + '</span></div>';
    if (p.comment) html += '<div class="point-card__comment">' + highlightSearch(p.comment, _s) + '</div>';
    html += '</div>';

    html += '<div class="point-card__actions">';
    html += '<button class="btn btn-sm btn-outline btn-edit"  data-pid="' + p.id + '">✏️ Изменить</button>';
    html += '<button class="btn btn-sm btn-danger  btn-del"   data-pid="' + p.id + '">🗑 Удалить</button>';
    html += '<button class="btn btn-sm btn-outline btn-chart"  data-pnum="' + escAttr(p.pointNumber) + '" data-pid="' + p.id + '" title="График дебита">📈</button>';
    html += '<button class="btn btn-sm btn-outline btn-print"  data-pid="' + p.id + '" title="Печать">🖨️</button>';
    html += '</div>';
    html += '<div class="point-chart-wrap" id="chart-' + p.id + '" style="display:none"></div>';
    html += '</div>';
  }
  container.innerHTML = html;

  // Восстанавливаем открытые графики после перерисовки
  // Данные берём из _chartCache — он не зависит от DOM
  container.querySelectorAll('.point-chart-wrap').forEach(function(wrap) {
    var pid = wrap.id.replace('chart-', '');
    if (_openCharts[pid] && _chartCache[pid]) {
      renderPointChart(wrap, _chartCache[pid], pid);
      wrap.style.display = 'block';
      var btn = container.querySelector('.btn-chart[data-pid="' + pid + '"]');
      if (btn) {
        btn.style.background = 'var(--blue, #1a73e8)';
        btn.style.color = '#fff';
        btn.style.borderColor = 'var(--blue, #1a73e8)';
      }
    }
  });

  var countEl = document.getElementById('points-count-badge');
  var searchActive = !!(_pointsFilters.search);
  var filterActive  = _pointsFilters.dates.length > 0 || _pointsFilters.worker !== 'all';
  var countLabel    = points.length + ' / ' + allPoints.length + ' точек';
  if (searchActive) countLabel += ' · поиск: «' + _pointsFilters.search + '»';
  if (countEl) countEl.textContent = countLabel;

  container.querySelectorAll('.btn-edit').forEach(function(btn) {
    btn.addEventListener('click', function() { openEditModal(this.dataset.pid); });
  });
  container.querySelectorAll('.btn-del').forEach(function(btn) {
    btn.addEventListener('click', function() { confirmDelete(this.dataset.pid); });
  });
  container.querySelectorAll('.btn-chart').forEach(function(btn) {
    btn.addEventListener('click', function() {
      togglePointChart(this.dataset.pid, this.dataset.pnum, this);
    });
  });
  container.querySelectorAll('.btn-print').forEach(function(btn) {
    btn.addEventListener('click', function() {
      printPointCard(this.dataset.pid);
    });
  });
  container.querySelectorAll('.card-photo-thumb').forEach(function(img) {
    Photos.setImageSrc(img, img.dataset.url);
  });
  updateMapLegendPoints();
}

// ── График дебита точки ───────────────────────────────────

function togglePointChart(pointId, pointNumber, btn) {
  var wrap = document.getElementById('chart-' + pointId);
  if (!wrap) return;

  if (wrap.style.display !== 'none') {
    wrap.style.display = 'none';
    btn.style.background = '';
    btn.style.color = '';
    btn.style.borderColor = '';
    if (typeof _openCharts !== 'undefined') delete _openCharts[pointId];
    return;
  }

  wrap.style.display = 'block';
  btn.style.background = 'var(--blue, #1a73e8)';
  btn.style.color = '#fff';
  btn.style.borderColor = 'var(--blue, #1a73e8)';
  if (typeof _openCharts !== 'undefined') _openCharts[pointId] = true;

  // Если данные уже закэшированы — не перезапрашиваем API
  if (_chartCache[pointId] && _chartCache[pointId].length) {
    renderPointChart(wrap, _chartCache[pointId], pointNumber);
    return;
  }

  wrap.innerHTML = '<p style="font-size:11px;color:rgba(180,190,210,.6);padding:8px 14px">⏳ Загрузка истории...</p>';

  Api.getHistory(pointNumber).then(function(history) {
    if (!history || !history.length) {
      wrap.innerHTML = '<p style="font-size:11px;color:rgba(180,190,210,.5);padding:8px 14px 10px">Нет истории замеров. Данные появятся после следующего сохранения точки.</p>';
      return;
    }
    _chartCache[pointId] = history;
    renderPointChart(wrap, history, pointNumber);
  }).catch(function(err) {
    wrap.innerHTML = '<p style="font-size:11px;color:#ea4335;padding:8px 14px 10px">Ошибка загрузки: ' + err.message + '</p>';
  });
}

function renderPointChart(container, history, pointNumber) {
  var STATUS_COLORS = (typeof MapModule !== 'undefined') ? MapModule.STATUS_COLORS : {
    'Новая': '#1a73e8', 'Активная': '#34a853', 'Иссякает': '#f9ab00', 'Пересохла': '#ea4335'
  };
  var INTENSITY_SIZES = { 'Слабая (капёж)': 5, 'Умеренная': 7, 'Сильная (поток)': 9, 'Очень сильная': 12 };

  var W = 300, H = 130;
  var PAD = { top: 18, right: 16, bottom: 36, left: 42 };
  var chartW = W - PAD.left - PAD.right;
  var chartH = H - PAD.top - PAD.bottom;

  var defined = history.filter(function(r) { return r.flowRate != null; });
  var maxLps  = defined.length ? Math.max.apply(null, defined.map(function(r) { return r.flowRate; })) : 1;
  if (maxLps === 0) maxLps = 1;

  var n = history.length;
  function xPos(i) { return n === 1 ? PAD.left + chartW / 2 : PAD.left + (i / (n - 1)) * chartW; }
  function yPos(v)  { return v == null ? null : PAD.top + chartH - (v / maxLps) * chartH; }

  // Линия дебита
  var linePath = '';
  var firstPt  = true;
  history.forEach(function(r, i) {
    var y = yPos(r.flowRate);
    if (y == null) { firstPt = true; return; }
    linePath += (firstPt ? 'M' : 'L') + xPos(i).toFixed(1) + ',' + y.toFixed(1) + ' ';
    firstPt = false;
  });

  // Область под линией
  var areaPath = '';
  var fi = -1, li = -1;
  history.forEach(function(r, i) { if (r.flowRate != null) { if (fi < 0) fi = i; li = i; } });
  if (fi >= 0) {
    var base = (PAD.top + chartH).toFixed(1);
    areaPath = 'M' + xPos(fi).toFixed(1) + ',' + base + ' ' +
               linePath.replace(/^M/, 'L') +
               'L' + xPos(li).toFixed(1) + ',' + base + ' Z';
  }

  // Оси Y — 3 метки
  var yTicks = [0, maxLps / 2, maxLps];

  var svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible">';

  // Сетка
  yTicks.forEach(function(v) {
    var y = yPos(v).toFixed(1);
    svg += '<line x1="' + PAD.left + '" y1="' + y + '" x2="' + (PAD.left + chartW) + '" y2="' + y + '" stroke="rgba(255,255,255,.07)" stroke-width="1"/>';
    // л/с слева
    svg += '<text x="' + (PAD.left - 4) + '" y="' + (Number(y) + 4) + '" text-anchor="end" font-size="8" fill="rgba(180,190,210,.5)">' + v.toFixed(1) + '</text>';
    // м³/ч справа
    var m3h = (v * 3.6).toFixed(1);
    svg += '<text x="' + (PAD.left + chartW + 4) + '" y="' + (Number(y) + 4) + '" text-anchor="start" font-size="8" fill="rgba(251,188,5,.45)">' + m3h + '</text>';
  });

  // Область
  if (areaPath) svg += '<path d="' + areaPath + '" fill="rgba(26,115,232,.1)"/>';

  // Линия
  if (linePath) svg += '<path d="' + linePath + '" fill="none" stroke="#1a73e8" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>';

  // Маркеры и даты
  history.forEach(function(r, i) {
    var x = xPos(i);
    var y = yPos(r.flowRate);
    var sc = STATUS_COLORS[r.status] || '#888';
    var radius = (INTENSITY_SIZES[r.intensity] || 6);
    var _md = (r.monitoringDate || '');
    var dateStr = _md.length >= 10
      ? _md.slice(8,10) + '.' + _md.slice(5,7) + '.' + _md.slice(0,4)
      : _md;

    // Дата снизу
    svg += '<text x="' + x.toFixed(1) + '" y="' + (H - 2) + '" text-anchor="middle" font-size="8" fill="rgba(180,190,210,.55)">' + dateStr + '</text>';

    if (y != null) {
      // Внешний кружок — интенсивность (размер)
      svg += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (radius + 2) + '" fill="' + sc + '" opacity="0.2"/>';
      // Маркер — цвет статуса
      svg += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + radius + '" fill="' + sc + '" stroke="#1e2530" stroke-width="1.5"/>';
      // Значение над маркером
      var lbl = r.flowRate != null ? r.flowRate.toFixed(2) : '';
      if (lbl) {
        svg += '<text x="' + x.toFixed(1) + '" y="' + (Number(y) - radius - 3) + '" text-anchor="middle" font-size="8" font-weight="600" fill="rgba(200,210,230,.8)">' + lbl + '</text>';
      }
    } else {
      // Нет данных
      svg += '<text x="' + x.toFixed(1) + '" y="' + (PAD.top + chartH / 2) + '" text-anchor="middle" font-size="9" fill="rgba(180,190,210,.3)">—</text>';
    }
  });

  // Подписи осей
  svg += '<text x="' + (PAD.left - 4) + '" y="' + (PAD.top - 6) + '" text-anchor="end" font-size="7" fill="rgba(180,190,210,.4)">л/с</text>';
  svg += '<text x="' + (PAD.left + chartW + 4) + '" y="' + (PAD.top - 6) + '" text-anchor="start" font-size="7" fill="rgba(251,188,5,.35)">м³/ч</text>';

  svg += '</svg>';

  // Легенда статусов
  var seen = {};
  history.forEach(function(r) { if (r.status) seen[r.status] = STATUS_COLORS[r.status] || '#888'; });
  var legend = '';
  Object.keys(seen).forEach(function(s) {
    legend += '<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;color:rgba(180,190,210,.7);margin-right:8px">' +
              '<span style="width:7px;height:7px;border-radius:50%;background:' + seen[s] + ';flex-shrink:0"></span>' + s + '</span>';
  });

  // Подсказка по размеру маркера
  var hasIntensity = history.some(function(r) { return !!r.intensity; });
  var hint = hasIntensity ? '<span style="font-size:10px;color:rgba(180,190,210,.4)">размер = интенсивность</span>' : '';

  container.innerHTML =
    '<div style="padding:10px 14px 8px;background:rgba(0,0,0,.18);border-top:1px solid rgba(255,255,255,.05)">' +
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">' +
    (legend ? '<div>' + legend + '</div>' : '<div></div>') +
    hint +
    '</div>' +
    svg +
    '</div>';
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
