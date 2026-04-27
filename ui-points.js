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

// ── Вспомогательные шаблоны ───────────────────────────────

function _row(label, val) {
  return '<div style="display:flex;justify-content:space-between;gap:4px;' +
         'padding:2px 0;border-bottom:1px solid rgba(48,54,61,.25)">' +
         '<span style="font-size:10px;color:var(--txt-3);flex-shrink:0;line-height:1.4">' + label + '</span>' +
         '<span style="font-size:10px;color:var(--txt-2);font-weight:500;text-align:right;' +
         'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.4">' + val + '</span></div>';
}

function _dmRow(label, val) {
  return '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;' +
         'padding:4px 0;border-bottom:1px solid rgba(48,54,61,.3)">' +
         '<span style="font-size:11px;color:var(--txt-3);flex-shrink:0">' + label + '</span>' +
         '<span style="font-size:11px;color:var(--txt-2);font-weight:500;text-align:right">' + val + '</span></div>';
}

function _secTitle(title) {
  return '<div style="display:flex;align-items:center;gap:8px;font-size:11px;font-weight:600;' +
         'color:var(--txt-2);letter-spacing:.06em;text-transform:uppercase;' +
         'padding-bottom:6px;border-bottom:1px solid var(--line-2);margin-bottom:8px">' +
         '<span style="display:inline-block;width:3px;height:12px;border-radius:2px;' +
         'background:var(--gold);flex-shrink:0"></span>' + title + '</div>';
}

function _kpiBox(suffix, label, unit) {
  return '<div style="background:var(--bg-2);border:1px solid var(--line-2);border-radius:5px;padding:8px 10px">' +
         '<div style="font-size:9px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">' + label + '</div>' +
         '<div style="font-size:17px;font-weight:700;color:var(--gold);line-height:1" id="dm-kpi-' + suffix + '">—</div>' +
         '<div style="font-size:9px;color:var(--txt-3);margin-top:2px" id="dm-kpi-' + suffix + '-sub">' + unit + '</div>' +
         '</div>';
}

function _statusClass(status) {
  return status === 'Новая'    ? 'badge-new'    :
         status === 'Активная' ? 'badge-active' :
         status === 'Иссякает' ? 'badge-fading' :
         status === 'Пересохла'? 'badge-dry'    : '';
}

function _flowM3h(flowRate) {
  var n = parseFloat(flowRate);
  return (!isNaN(n) && flowRate != null) ? (n * 3.6).toFixed(2) + ' м³/ч' : '';
}

// ── Список точек — 2 колонки ───────────────────────────────

function renderPointsList() {
  var container = document.getElementById('points-list');
  if (!container) return;
  initPointsFilters();

  var allPoints  = Points.getList();
  var filtered   = getFilteredPoints(_pointsFilters);
  var points     = getLatestByPointNumber(filtered);
  var totalUniq  = getLatestByPointNumber(allPoints).length;

  if (!points.length) {
    container.innerHTML = '<p class="empty-msg">Нет точек по выбранному фильтру</p>';
    var c0 = document.getElementById('points-count-badge');
    if (c0) c0.textContent = '0 / ' + totalUniq + ' точек';
    return;
  }

  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">';
  var _s   = _pointsFilters.search || '';

  for (var i = 0; i < points.length; i++) {
    var p          = points[i];
    var syncStatus = p.syncStatus || 'pending';
    var hasPhoto   = p.photoUrls && p.photoUrls[0];
    var m3h        = _flowM3h(p.flowRate);
    var stClass    = _statusClass(p.status);

    var syncColor  = syncStatus === 'synced' ? 'var(--ok)' :
                     syncStatus === 'error'  ? 'var(--bad)' : 'var(--warn)';
    var syncTitle  = syncStatus === 'synced' ? 'Синхронизировано' :
                     syncStatus === 'error'  ? 'Ошибка синхронизации' : 'Ожидает отправки';
    var qColor     = p.status === 'Пересохла' ? 'var(--bad)'  :
                     p.status === 'Иссякает'  ? 'var(--warn)' :
                     p.status === 'Активная'  ? 'var(--ok)'   : 'var(--txt-1)';
    var leftBorder = syncStatus !== 'synced'  ? 'border-left:3px solid var(--warn);' : '';

    // ── Карточка ──
    html += '<div class="point-card" style="display:flex;height:170px;position:relative;' + leftBorder + '">';

    // Точка синхронизации
    html += '<span title="' + syncTitle + '" style="position:absolute;top:7px;left:7px;z-index:3;' +
            'width:7px;height:7px;border-radius:50%;background:' + syncColor + ';' +
            'border:1px solid rgba(0,0,0,.4)"></span>';

    // ── Левая панель (1/3) ──
    // Делим на: верх (данные, overflow:hidden) + низ (бейджи + кнопка, фиксированный)
    html += '<div style="flex:1;display:flex;flex-direction:column;min-width:0;' +
            'border-right:1px solid var(--line-2)">';

    // Верхняя часть — данные
    html += '<div style="flex:1;overflow:hidden;padding:8px 8px 4px 16px;display:flex;flex-direction:column;gap:2px">';
    html += '<div style="font-size:19px;font-weight:700;color:var(--gold);line-height:1;margin-bottom:1px">' +
            highlightSearch(p.pointNumber || '—', _s) + '</div>';
    if (p.wall || p.domain) {
      html += '<div style="font-size:11px;color:var(--txt-1);font-weight:500;' +
              'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px">' +
              highlightSearch(p.wall || p.domain, _s) + '</div>';
    }
    if (p.horizon)       html += _row('Горизонт', highlightSearch(p.horizon, _s));
    if (m3h)             html += _row('Дебит', '<span style="color:var(--ok)">' + m3h + '</span>');
    else                 html += _row('Дебит', '—');
                         html += _row('Дата', formatMonitoringDate(p.monitoringDate));
    if (p.measureMethod) html += _row('Способ', escAttr(p.measureMethod));
    if (p.intensity)     html += _row('Интенс.', escAttr(p.intensity));
    html += '</div>';

    // Нижняя часть — бейджи + кнопка (всегда видна)
    html += '<div style="flex-shrink:0;padding:4px 6px 6px 8px;' +
            'border-top:1px solid var(--line-2);display:flex;align-items:center;' +
            'flex-wrap:nowrap;gap:3px;min-height:30px">';
    if (p.status) html += '<span class="badge ' + stClass + '" style="white-space:nowrap;font-size:9px">' +
                           escAttr(p.status) + '</span>';
    if (p.domain) html += '<span class="badge badge-new" style="white-space:nowrap;font-size:9px">' +
                           escAttr(p.domain) + '</span>';
    html += '<button class="btn-open-detail" data-pid="' + p.id + '" ' +
            'style="margin-left:auto;flex-shrink:0;height:20px;padding:0 7px;border-radius:3px;' +
            'border:1px solid rgba(88,166,255,.45);background:rgba(88,166,255,.12);' +
            'color:var(--gold);font-size:9px;font-weight:600;cursor:pointer;' +
            'white-space:nowrap;font-family:inherit;line-height:1">▶ Подробнее</button>';
    html += '</div>';

    html += '</div>'; // /левая панель

    // ── Правая панель (2/3) — фото ──
    html += '<div style="flex:2;position:relative;background:var(--bg-0);overflow:hidden">';

    if (hasPhoto) {
      html += '<img class="card-photo-grid" data-url="' + escAttr(p.photoUrls[0]) + '" src="" alt="фото" ' +
              'style="width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in">';
    } else {
      html += '<div style="width:100%;height:100%;display:flex;flex-direction:column;' +
              'align-items:center;justify-content:center;gap:5px;color:var(--txt-3);font-size:10px">' +
              '<div style="width:28px;height:22px;border:1px dashed var(--txt-3);border-radius:3px;' +
              'display:flex;align-items:center;justify-content:center;font-size:13px">—</div>' +
              'нет фото</div>';
    }

    // Горизонт поверх фото (левый верх)
    if (p.horizon) {
      html += '<div style="position:absolute;top:6px;left:6px;' +
              'background:rgba(13,17,23,.82);border:1px solid var(--line);' +
              'border-radius:3px;padding:2px 5px;font-size:9px;color:var(--txt-3)">' +
              escAttr(p.horizon) + '</div>';
    }

    // Дебит поверх фото (правый низ)
    if (m3h) {
      html += '<div style="position:absolute;bottom:6px;right:6px;' +
              'background:rgba(13,17,23,.82);border:1px solid var(--line);' +
              'border-radius:3px;padding:2px 6px;font-size:10px;font-weight:600;color:' + qColor + '">' +
              m3h + '</div>';
    }

    html += '</div>'; // /правая панель
    html += '</div>'; // /карточка
  }

  html += '</div>'; // /grid
  container.innerHTML = html;

  // Загружаем фото
  container.querySelectorAll('.card-photo-grid').forEach(function(img) {
    Photos.setImageSrc(img, img.dataset.url);
  });

  // Кнопки «Подробнее»
  container.querySelectorAll('.btn-open-detail').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      openDetailModal(this.dataset.pid);
    });
  });

  // Счётчик
  var countEl    = document.getElementById('points-count-badge');
  var countLabel = points.length + ' / ' + totalUniq + ' точек';
  if (_pointsFilters.search) countLabel += ' · поиск: «' + _pointsFilters.search + '»';
  if (countEl) countEl.textContent = countLabel;

  updateMapLegendPoints();
}

// ── Модалка подробностей точки ─────────────────────────────

function openDetailModal(pointId) {
  // Удаляем предыдущую модалку если есть
  var existing = document.getElementById('detail-modal-overlay');
  if (existing) existing.remove();

  // Находим точку
  var allPts = Points.getList();
  var p = null;
  for (var i = 0; i < allPts.length; i++) {
    if (allPts[i].id === pointId) { p = allPts[i]; break; }
  }
  if (!p) { console.warn('openDetailModal: точка не найдена, id=', pointId); return; }

  var hasPhoto = !!(p.photoUrls && p.photoUrls[0]);
  var m3h      = _flowM3h(p.flowRate) || '—';
  var stClass  = _statusClass(p.status);

  // ── Оверлей ──
  var overlay = document.createElement('div');
  overlay.id  = 'detail-modal-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.65);' +
    'display:flex;align-items:flex-start;justify-content:center;' +
    'padding:20px 14px;overflow-y:auto';

  // ── Окно ──
  var box = document.createElement('div');
  box.style.cssText =
    'width:100%;max-width:720px;background:var(--bg-1);' +
    'border:1px solid var(--line);border-radius:8px;overflow:hidden;' +
    'margin:auto;flex-shrink:0;box-shadow:0 16px 40px rgba(0,0,0,.5)';

  // ── Шапка ──
  var domainHorizon = (p.domain || '') +
                      (p.domain && p.horizon ? ' · ' : '') +
                      (p.horizon || '');

  var hdr =
    '<div style="display:flex;align-items:center;padding:10px 14px;' +
    'border-bottom:1px solid var(--line);background:var(--bg-0);gap:10px">' +
      '<div style="min-width:0;flex:1">' +
        '<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:2px">' +
          '<span style="font-size:20px;font-weight:700;color:var(--gold)">' + escAttr(p.pointNumber || '—') + '</span>' +
          '<span style="font-size:13px;font-weight:500;color:var(--txt-1)">' + escAttr(p.wall || p.domain || '—') + '</span>' +
          (p.status ? '<span class="badge ' + stClass + '">' + escAttr(p.status) + '</span>' : '') +
        '</div>' +
        '<div style="font-size:11px;color:var(--txt-3)">' +
          escAttr(domainHorizon) +
          (domainHorizon ? ' · ' : '') +
          'последний замер ' + formatMonitoringDate(p.monitoringDate) +
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:5px;flex-shrink:0;flex-wrap:wrap">' +
        '<button id="dm-print" class="btn btn-sm btn-outline" data-pid="' + p.id + '" type="button">⎙ Печать</button>' +
        '<button id="dm-edit"  class="btn btn-sm btn-outline" data-pid="' + p.id + '" type="button" ' +
        'style="border-color:rgba(88,166,255,.4);color:var(--gold)">✎ Изменить</button>' +
        '<button id="dm-del"   class="btn btn-sm btn-danger"  data-pid="' + p.id + '" type="button">✕ Удалить</button>' +
        '<button id="dm-close" class="btn btn-sm btn-outline" type="button" style="padding:0 8px">✕</button>' +
      '</div>' +
    '</div>';

  // ── Тело ──
  var body = '<div style="padding:12px 14px;display:flex;flex-direction:column;gap:12px">';

  // Блок: фото + данные
  body +=
    '<div style="display:flex;gap:10px;height:160px">' +
      // Фото
      '<div style="flex:2;border-radius:5px;overflow:hidden;background:var(--bg-0);position:relative">';

  if (hasPhoto) {
    body += '<img id="dm-photo" data-url="' + escAttr(p.photoUrls[0]) + '" src="" alt="фото" ' +
            'style="width:100%;height:100%;object-fit:cover;display:block">';
  } else {
    body += '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;' +
            'flex-direction:column;gap:6px;color:var(--txt-3);font-size:11px">' +
            '<span style="font-size:28px">📷</span>нет фото</div>';
  }
  body += '<div style="position:absolute;bottom:6px;right:6px;background:rgba(13,17,23,.82);' +
          'border:1px solid var(--line);border-radius:3px;padding:2px 7px;' +
          'font-size:11px;font-weight:600;color:var(--txt-1)">Q: ' + m3h + '</div>';
  body += '</div>'; // /фото

  // Данные
  body +=
    '<div style="flex:3;background:var(--bg-2);border-radius:5px;border:1px solid var(--line-2);' +
    'padding:10px 12px;display:flex;flex-direction:column;gap:0;overflow-y:auto">' +
    '<div style="font-size:10px;font-weight:600;letter-spacing:.06em;color:var(--txt-3);' +
    'text-transform:uppercase;margin-bottom:5px">Данные последнего замера</div>';

  if (p.horizon)       body += _dmRow('Горизонт',       escAttr(p.horizon));
                       body += _dmRow('Дебит',           m3h);
                       body += _dmRow('Дата замера',     formatMonitoringDate(p.monitoringDate));
  if (p.measureMethod) body += _dmRow('Способ',          escAttr(p.measureMethod));
  if (p.intensity)     body += _dmRow('Интенсивность',   escAttr(p.intensity));
  if (p.worker)        body += _dmRow('Замерщик',        escAttr(p.worker));
  if (p.xLocal != null) body += _dmRow('Координаты',
    'X: ' + Number(p.xLocal).toFixed(1) + '  Y: ' + Number(p.yLocal).toFixed(1));
  if (p.waterColor)    body += _dmRow('Цвет воды',       escAttr(p.waterColor));
  if (p.comment)       body += _dmRow('Примечание',      escAttr(p.comment));

  body += '</div>'; // /данные
  body += '</div>'; // /блок фото+данные

  // Блок: Галерея фотографий
  body +=
    '<div>' + _secTitle('История фотографий') +
    '<div id="dm-gallery" style="min-height:60px">' +
    '<p style="font-size:11px;color:var(--txt-3);text-align:center;padding:14px 0">⏳ Загрузка фотографий...</p>' +
    '</div></div>';

  // Блок: Аналитика (KPI)
  body +=
    '<div>' + _secTitle('Аналитика') +
    '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px">' +
      _kpiBox('avg',   'Среднее Q',  'м³/ч') +
      _kpiBox('max',   'Максимум',   'м³/ч') +
      _kpiBox('min',   'Минимум',    'м³/ч') +
      _kpiBox('count', 'Замеров',    'всего') +
    '</div></div>';

  // Блок: График
  body +=
    '<div>' + _secTitle('История дебита') +
    '<div id="dm-chart" style="background:var(--bg-2);border:1px solid var(--line-2);' +
    'border-radius:5px;padding:10px 12px;min-height:80px">' +
    '<p style="font-size:11px;color:var(--txt-3);text-align:center;padding:16px 0">⏳ Загрузка истории...</p>' +
    '</div></div>';

  // Блок: Таблица замеров
  body +=
    '<div>' + _secTitle('Журнал замеров') +
    '<div id="dm-journal" style="background:var(--bg-2);border:1px solid var(--line-2);' +
    'border-radius:5px;overflow:hidden">' +
    '<p style="font-size:11px;color:var(--txt-3);text-align:center;padding:16px 0">⏳ Загрузка...</p>' +
    '</div></div>';

  body += '</div>'; // /тело

  box.innerHTML = hdr + body;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Загружаем фото
  var photoEl = box.querySelector('#dm-photo');
  if (photoEl) Photos.setImageSrc(photoEl, photoEl.dataset.url);

  // Закрытие
  function closeDetail() {
    var ol = document.getElementById('detail-modal-overlay');
    if (ol) { ol.remove(); }
  }
  box.querySelector('#dm-close').addEventListener('click', closeDetail);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) closeDetail(); });

  // Кнопки действий
  box.querySelector('#dm-print').addEventListener('click', function() {
    closeDetail();
    printPointCard(this.dataset.pid);
  });
  box.querySelector('#dm-edit').addEventListener('click', function() {
    closeDetail();
    openEditModal(this.dataset.pid);
  });
  box.querySelector('#dm-del').addEventListener('click', function() {
    closeDetail();
    confirmDelete(this.dataset.pid);
  });

  // Загружаем историю → заполняем KPI + график + журнал
  var cached = _chartCache[pointId];
  if (cached && cached.length) {
    _fillDetailHistory(box, cached, p.pointNumber);
  } else {
    _loadDetailHistory(box, pointId, p.pointNumber);
  }

  // Загружаем галерею фотографий
  _loadPhotoGallery(box, p.pointNumber);
}

// Загрузка истории с показом ошибки во всех секциях + кнопка Повторить
function _loadDetailHistory(box, pointId, pointNumber) {
  // Показываем «загрузка» во всех трёх секциях
  var elChart   = box.querySelector('#dm-chart');
  var elJournal = box.querySelector('#dm-journal');
  if (elChart)   elChart.innerHTML   = '<p style="font-size:11px;color:var(--txt-3);text-align:center;padding:16px 0">⏳ Загрузка истории...</p>';
  if (elJournal) elJournal.innerHTML = '<p style="font-size:11px;color:var(--txt-3);text-align:center;padding:16px 0">⏳ Загрузка...</p>';

  Api.getHistory(pointNumber).then(function(hist) {
    _chartCache[pointId] = hist || [];
    _fillDetailHistory(box, _chartCache[pointId], pointNumber);
  }).catch(function(err) {
    var errMsg = err && err.message ? err.message : String(err);
    var isTimeout = errMsg.indexOf('timeout') >= 0 || errMsg.indexOf('Timeout') >= 0;
    var errHtml =
      '<div style="padding:14px;text-align:center">' +
        '<div style="color:var(--bad);font-size:12px;margin-bottom:8px">' +
          (isTimeout
            ? '⏱ Сервер не ответил вовремя — история замеров загружается дольше обычного'
            : '⚠ Ошибка загрузки: ' + errMsg) +
        '</div>' +
        '<button class="btn-retry-history" type="button" ' +
        'style="height:26px;padding:0 12px;border-radius:3px;border:1px solid var(--gold);' +
        'background:rgba(88,166,255,.1);color:var(--gold);font-size:11px;cursor:pointer;font-family:inherit">' +
        '↺ Повторить загрузку</button>' +
      '</div>';
    var elC = box.querySelector('#dm-chart');
    var elJ = box.querySelector('#dm-journal');
    if (elC) elC.innerHTML = errHtml;
    if (elJ) elJ.innerHTML = '<div style="padding:10px;text-align:center;font-size:11px;color:var(--txt-3)">Ожидание загрузки истории...</div>';

    // Кнопка «Повторить» — удаляем кэш и пробуем снова
    var retryBtn = box.querySelector('.btn-retry-history');
    if (retryBtn) {
      retryBtn.addEventListener('click', function() {
        delete _chartCache[pointId];
        _loadDetailHistory(box, pointId, pointNumber);
      });
    }
  });
}


// ── Галерея фотографий в карточке подробностей ────────────

function _loadPhotoGallery(box, pointNumber) {
  var wrap = box.querySelector('#dm-gallery');
  if (!wrap) return;

  Api.getPhotos(pointNumber).then(function(photos) {
    if (!photos || !photos.length) {
      wrap.innerHTML = '<p style="font-size:11px;color:var(--txt-3);text-align:center;padding:14px 0">Фотографии ещё не загружены</p>';
      return;
    }
    _renderPhotoGallery(wrap, photos);
  }).catch(function() {
    wrap.innerHTML = '<p style="font-size:11px;color:var(--txt-3);text-align:center;padding:14px 0">Не удалось загрузить фотографии</p>';
  });
}

function _renderPhotoGallery(wrap, photos) {
  // Сохраняем весь массив в замыкании для лайтбокса
  var _photos = photos;

  var html = '<div style="font-size:10px;color:var(--txt-3);margin-bottom:8px">' +
    photos.length + ' ' + (photos.length === 1 ? 'фотография' : photos.length < 5 ? 'фотографии' : 'фотографий') +
    ' · от новых к старым</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">';

  photos.forEach(function(ph, idx) {
    var m3h  = ph.flowRate != null ? (ph.flowRate * 3.6).toFixed(2) + ' м³/ч' : '—';
    var date = formatMonitoringDate(ph.monitoringDate);
    html +=
      '<div style="border:1px solid var(--line-2);border-radius:5px;overflow:hidden;' +
      'background:var(--bg-2);cursor:pointer;transition:border-color .15s" ' +
      'class="dm-photo-card" data-idx="' + idx + '">' +
        '<div style="height:80px;background:var(--bg-0);overflow:hidden">' +
          '<img data-url="' + escAttr(ph.photoUrl) + '" src="" alt="фото" ' +
          'style="width:100%;height:100%;object-fit:cover;display:block">' +
        '</div>' +
        '<div style="padding:5px 6px">' +
          '<div style="font-size:10px;font-weight:500;color:var(--txt-1);white-space:nowrap;' +
          'overflow:hidden;text-overflow:ellipsis">' + date + '</div>' +
          '<div style="font-size:10px;color:var(--ok);font-weight:600">' + m3h + '</div>' +
        '</div>' +
      '</div>';
  });

  html += '</div>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('img[data-url]').forEach(function(img) {
    Photos.setImageSrc(img, img.dataset.url);
  });

  wrap.querySelectorAll('.dm-photo-card').forEach(function(card) {
    card.addEventListener('click', function() {
      var idx = parseInt(this.dataset.idx, 10);
      _openPhotoLightbox(_photos, idx);
    });
    card.addEventListener('mouseenter', function() { this.style.borderColor = 'rgba(88,166,255,.5)'; });
    card.addEventListener('mouseleave', function() { this.style.borderColor = ''; });
  });
}

// Лайтбокс с боковой панелью данных + навигация prev/next
function _openPhotoLightbox(photos, startIdx) {
  var existing = document.getElementById('photo-lightbox');
  if (existing) existing.remove();

  var idx = startIdx || 0;

  var lb = document.createElement('div');
  lb.id = 'photo-lightbox';
  lb.style.cssText =
    'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);' +
    'display:flex;align-items:stretch';

  // Функция отрисовки текущего фото
  function render() {
    var ph   = photos[idx];
    var m3h  = ph.flowRate != null ? (ph.flowRate * 3.6).toFixed(2) : '—';
    var date = formatMonitoringDate(ph.monitoringDate);
    var hasP = photos.length > 1;

    lb.innerHTML =
      // ── Фото (левая часть) ──
      '<div style="flex:1;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;padding:20px;position:relative;min-width:0">' +

        // Кнопка ← (prev)
        (hasP ? '<button id="lb-prev" style="position:absolute;left:12px;top:50%;transform:translateY(-50%);' +
        'width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.2);' +
        'background:rgba(13,17,23,.7);color:var(--txt-1);font-size:18px;cursor:pointer;' +
        'display:flex;align-items:center;justify-content:center;z-index:2;' +
        (idx === 0 ? 'opacity:.3;pointer-events:none' : '') + '">‹</button>' : '') +

        // Фото
        '<img id="lb-img" src="" alt="фото" style="max-width:100%;max-height:calc(100vh - 40px);' +
        'object-fit:contain;display:block;border-radius:4px">' +

        // Счётчик
        (hasP ? '<div style="position:absolute;bottom:12px;left:50%;transform:translateX(-50%);' +
        'background:rgba(13,17,23,.7);border-radius:20px;padding:3px 10px;font-size:10px;' +
        'color:var(--txt-2)">' + (idx+1) + ' / ' + photos.length + '</div>' : '') +

        // Кнопка → (next)
        (hasP ? '<button id="lb-next" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);' +
        'width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.2);' +
        'background:rgba(13,17,23,.7);color:var(--txt-1);font-size:18px;cursor:pointer;' +
        'display:flex;align-items:center;justify-content:center;z-index:2;' +
        (idx === photos.length-1 ? 'opacity:.3;pointer-events:none' : '') + '">›</button>' : '') +

      '</div>' +

      // ── Правая панель с данными ──
      '<div style="width:260px;flex-shrink:0;background:rgba(13,17,23,.95);' +
      'border-left:1px solid rgba(48,54,61,.8);display:flex;flex-direction:column;' +
      'overflow-y:auto">' +

        // Шапка панели
        '<div style="display:flex;align-items:center;justify-content:space-between;' +
        'padding:12px 14px;border-bottom:1px solid rgba(48,54,61,.6)">' +
          '<span style="font-size:11px;font-weight:600;letter-spacing:.06em;' +
          'text-transform:uppercase;color:var(--txt-3)">Данные замера</span>' +
          '<button id="lb-close" style="width:26px;height:26px;border-radius:4px;' +
          'border:1px solid rgba(48,54,61,.8);background:transparent;' +
          'color:var(--txt-2);font-size:14px;cursor:pointer;display:flex;' +
          'align-items:center;justify-content:center">✕</button>' +
        '</div>' +

        // Данные
        '<div style="padding:12px 14px;display:flex;flex-direction:column;gap:0;flex:1">' +

          _lbRow('Дата замера',   date,  'var(--gold)') +
          _lbRow('Дебит',        (ph.flowRate != null ? m3h + ' м³/ч' : '—'), 'var(--ok)') +

          (ph.status      ? _lbRow('Статус',        ph.status)      : '') +
          (ph.intensity   ? _lbRow('Интенсивность', ph.intensity)   : '') +
          (ph.measureMethod ? _lbRow('Способ',      ph.measureMethod) : '') +
          (ph.worker      ? _lbRow('Замерщик',      ph.worker)      : '') +
          (ph.comment     ? _lbRow('Примечание',    ph.comment)     : '') +

          // Загрузить оригинал
          '<div style="margin-top:auto;padding-top:14px">' +
            '<a href="' + escAttr(ph.photoUrl) + '" target="_blank" rel="noopener" ' +
            'style="display:block;text-align:center;padding:8px;border-radius:4px;' +
            'border:1px solid rgba(88,166,255,.35);color:var(--gold);font-size:11px;' +
            'text-decoration:none;transition:background .15s" ' +
            'onmouseover="this.style.background=\'rgba(88,166,255,.1)\'" ' +
            'onmouseout="this.style.background=\'transparent\'">↗ Открыть оригинал</a>' +
          '</div>' +

        '</div>' +
      '</div>';

    // Загружаем фото
    var imgEl = lb.querySelector('#lb-img');
    if (imgEl) Photos.setImageSrc(imgEl, ph.photoUrl);

    // Навигация
    var prev = lb.querySelector('#lb-prev');
    var next = lb.querySelector('#lb-next');
    if (prev) prev.addEventListener('click', function(e) { e.stopPropagation(); if (idx > 0) { idx--; render(); } });
    if (next) next.addEventListener('click', function(e) { e.stopPropagation(); if (idx < photos.length-1) { idx++; render(); } });

    // Закрытие
    lb.querySelector('#lb-close').addEventListener('click', closeLb);
  }

  function closeLb() {
    lb.remove();
    document.removeEventListener('keydown', onKey);
  }

  function onKey(e) {
    if (e.key === 'Escape')      closeLb();
    if (e.key === 'ArrowLeft'  && idx > 0)              { idx--; render(); }
    if (e.key === 'ArrowRight' && idx < photos.length-1) { idx++; render(); }
  }

  document.body.appendChild(lb);
  render();
  document.addEventListener('keydown', onKey);
}

// Строка данных в панели лайтбокса
function _lbRow(label, val, valColor) {
  return '<div style="display:flex;justify-content:space-between;align-items:flex-start;' +
    'gap:8px;padding:6px 0;border-bottom:1px solid rgba(48,54,61,.35);font-size:11px">' +
    '<span style="color:var(--txt-3);flex-shrink:0;font-size:10px">' + label + '</span>' +
    '<span style="color:' + (valColor || 'var(--txt-2)') + ';font-weight:500;' +
    'text-align:right;word-break:break-word">' + escAttr(String(val)) + '</span>' +
    '</div>';
}

// Заполняет KPI, график и журнал внутри detail-modal

// ── График дебита точки ────────────────────────────────────
// Используется из карточки подробностей и с карты (ui-map.js)

function renderPointChart(container, history, pointNumber) {
  var STATUS_COLORS = (typeof MapModule !== 'undefined') ? MapModule.STATUS_COLORS : {
    'Новая': '#58a6ff', 'Активная': '#3fb950', 'Иссякает': '#d29922', 'Пересохла': '#f85149'
  };

  var W = 560, H = 130;
  var PAD = { top: 18, right: 20, bottom: 36, left: 44 };
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
    areaPath = 'M' + xPos(fi).toFixed(1) + ',' + base + ' L' +
               linePath.replace(/^M/, '').trim() +
               ' L' + xPos(li).toFixed(1) + ',' + base + ' Z';
  }

  // Оси Y
  var yTicks = [0, maxLps / 2, maxLps];
  var svg = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg" style="display:block;overflow:visible;max-width:100%">';

  // Сетка и метки
  yTicks.forEach(function(v) {
    var y = yPos(v).toFixed(1);
    svg += '<line x1="' + PAD.left + '" y1="' + y + '" x2="' + (PAD.left + chartW) + '" y2="' + y +
           '" stroke="rgba(255,255,255,.07)" stroke-width="1"/>';
    svg += '<text x="' + (PAD.left - 4) + '" y="' + (Number(y) + 4) + '" text-anchor="end" font-size="8" fill="rgba(139,148,158,.8)">' +
           v.toFixed(2) + '</text>';
    svg += '<text x="' + (PAD.left + chartW + 4) + '" y="' + (Number(y) + 4) + '" text-anchor="start" font-size="8" fill="rgba(88,166,255,.6)">' +
           (v * 3.6).toFixed(2) + '</text>';
  });

  // Подписи осей
  svg += '<text x="' + (PAD.left - 4) + '" y="' + (PAD.top - 6) + '" text-anchor="end" font-size="7" fill="rgba(139,148,158,.5)">л/с</text>';
  svg += '<text x="' + (PAD.left + chartW + 4) + '" y="' + (PAD.top - 6) + '" text-anchor="start" font-size="7" fill="rgba(88,166,255,.4)">м³/ч</text>';

  // Заливка
  if (areaPath) svg += '<path d="' + areaPath + '" fill="rgba(88,166,255,.08)"/>';

  // Линия
  if (linePath) svg += '<path d="' + linePath + '" fill="none" stroke="#58a6ff" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>';

  // Точки
  history.forEach(function(r, i) {
    var y = yPos(r.flowRate);
    if (y == null) return;
    var clr = STATUS_COLORS[r.status] || '#58a6ff';
    var isLast = (i === n - 1);
    svg += '<circle cx="' + xPos(i).toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (isLast ? 4 : 3) + '" ' +
           'fill="' + (isLast ? clr : '#0d1117') + '" stroke="' + clr + '" stroke-width="1.5"/>';
    if (isLast) {
      svg += '<text x="' + xPos(i).toFixed(1) + '" y="' + (y - 8).toFixed(1) + '" text-anchor="middle" font-size="8" fill="' + clr + '">' +
             (r.flowRate * 3.6).toFixed(2) + '</text>';
    }
  });

  // Метки дат по оси X (равномерно, не более 6)
  var step = Math.max(1, Math.ceil(n / 6));
  for (var i = 0; i < n; i += step) {
    var r = history[i];
    var _rd = normalizeHistDate(r.monitoringDate || r.date || '');
    var d = _rd.length >= 10 ? _rd.slice(5) : _rd; // MM-DD
    svg += '<text x="' + xPos(i).toFixed(1) + '" y="' + (PAD.top + chartH + 14) + '" ' +
           'text-anchor="middle" font-size="8" fill="rgba(139,148,158,.7)">' + d + '</text>';
  }

  svg += '</svg>';

  // Легенда статусов
  var seen = {};
  history.forEach(function(r) { if (r.status) seen[r.status] = STATUS_COLORS[r.status] || '#888'; });
  var legend = Object.keys(seen).map(function(s) {
    return '<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;' +
           'color:rgba(139,148,158,.8);margin-right:8px">' +
           '<span style="width:7px;height:7px;border-radius:50%;flex-shrink:0;background:' + seen[s] + '"></span>' + s + '</span>';
  }).join('');

  container.innerHTML =
    '<div style="padding:8px 12px 6px;overflow-x:auto">' +
    (legend ? '<div style="margin-bottom:5px">' + legend + '</div>' : '') +
    svg +
    '</div>';
}

function _fillDetailHistory(box, history, pointNumber) {
  var defined = (history || []).filter(function(r) {
    return r.flowRate != null && !isNaN(parseFloat(r.flowRate));
  });

  // KPI
  var avg = 0, maxV = 0, minV = Infinity, maxD = '', minD = '';
  if (defined.length) {
    var sum = 0;
    defined.forEach(function(r) {
      var v = parseFloat(r.flowRate) * 3.6;
      sum += v;
      if (v > maxV) { maxV = v; maxD = r.monitoringDate || r.date || ''; }
      if (v < minV) { minV = v; minD = r.monitoringDate || r.date || ''; }
    });
    avg  = sum / defined.length;
    if (minV === Infinity) minV = 0;
  }

  function kSet(id, txt) { var el = box.querySelector(id); if (el) el.textContent = txt; }
  kSet('#dm-kpi-avg',       defined.length ? avg.toFixed(2)  : '—');
  kSet('#dm-kpi-avg-sub',   'м³/ч');
  kSet('#dm-kpi-max',       defined.length ? maxV.toFixed(2) : '—');
  kSet('#dm-kpi-max-sub',   maxD ? formatMonitoringDate(maxD) : 'м³/ч');
  kSet('#dm-kpi-min',       defined.length ? minV.toFixed(2) : '—');
  kSet('#dm-kpi-min-sub',   minD ? formatMonitoringDate(minD) : 'м³/ч');
  kSet('#dm-kpi-count',     String((history || []).length));
  kSet('#dm-kpi-count-sub', 'всего');

  // График
  var chartWrap = box.querySelector('#dm-chart');
  if (chartWrap) renderPointChart(chartWrap, history || [], pointNumber);

  // Журнал
  var journal = box.querySelector('#dm-journal');
  if (!journal) return;

  if (!history || !history.length) {
    journal.innerHTML = '<p style="font-size:11px;color:var(--txt-3);text-align:center;padding:16px 0">История замеров пуста</p>';
    return;
  }

  var SHOW = 6;
  var thSt = 'background:var(--bg-3);color:var(--txt-3);font-size:9px;font-weight:600;' +
             'text-transform:uppercase;letter-spacing:.05em;padding:5px 8px;' +
             'border-bottom:1px solid var(--line);text-align:left';
  var thead =
    '<thead><tr>' +
    '<th style="' + thSt + '">#</th>' +
    '<th style="' + thSt + '">Дата</th>' +
    '<th style="' + thSt + '">Q м³/ч</th>' +
    '<th style="' + thSt + '">Интенсивность</th>' +
    '<th style="' + thSt + '">Способ</th>' +
    '<th style="' + thSt + '">Замерщик</th>' +
    '<th style="' + thSt + ';text-align:center">St</th>' +
    '</tr></thead>';

  function buildRows(all) {
    var rows  = all ? history : history.slice(0, SHOW);
    var tdSt  = 'padding:5px 8px;border-bottom:1px solid var(--line-2);vertical-align:middle';
    var tbody = '<tbody>';
    rows.forEach(function(r, idx) {
      var qVal   = _flowM3h(r.flowRate) || '—';
      var qColor = r.status === 'Пересохла' ? 'var(--bad)'  :
                   r.status === 'Иссякает'  ? 'var(--warn)' :
                   r.status === 'Активная'  ? 'var(--ok)'   : 'var(--txt-2)';
      var dotClr = r.status === 'Активная'  ? 'var(--ok)'   :
                   r.status === 'Иссякает'  ? 'var(--warn)' : 'var(--txt-3)';
      var bg     = idx % 2 ? 'background:rgba(255,255,255,.015)' : '';
      tbody +=
        '<tr style="' + bg + '">' +
        '<td style="' + tdSt + ';color:var(--txt-3);font-size:10px">' + (history.length - idx) + '</td>' +
        '<td style="' + tdSt + ';color:var(--gold);font-size:10px">' + formatMonitoringDate(r.monitoringDate || r.date) + '</td>' +
        '<td style="' + tdSt + ';color:' + qColor + ';font-weight:600;font-size:10px">' + qVal + '</td>' +
        '<td style="' + tdSt + ';color:var(--txt-2);font-size:10px">' + escAttr(r.intensity || '—') + '</td>' +
        '<td style="' + tdSt + ';color:var(--txt-2);font-size:10px">' + escAttr(r.measureMethod || '—') + '</td>' +
        '<td style="' + tdSt + ';color:var(--txt-2);font-size:10px">' + escAttr(r.worker || '—') + '</td>' +
        '<td style="' + tdSt + ';text-align:center">' +
          '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;' +
          'background:' + dotClr + '"></span></td>' +
        '</tr>';
    });
    tbody += '</tbody>';
    return tbody;
  }

  function renderTable(showAll) {
    var footer = (!showAll && history.length > SHOW)
      ? '<div id="dm-show-all" style="padding:6px 10px;border-top:1px solid var(--line-2);' +
        'font-size:10px;color:var(--txt-3);display:flex;justify-content:space-between;cursor:pointer">' +
        '<span>Показано ' + SHOW + ' из ' + history.length + ' записей</span>' +
        '<span style="color:var(--gold)">Показать все ▾</span></div>'
      : '';
    journal.innerHTML =
      '<table style="width:100%;border-collapse:collapse">' + thead + buildRows(showAll) + '</table>' +
      footer;

    var btn = journal.querySelector('#dm-show-all');
    if (btn) btn.addEventListener('click', function() { renderTable(true); });
  }

  renderTable(false);
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
    var _extra1 = { pointNumber: data.pointNumber, monitoringDate: data.monitoringDate, flowRate: data.flowRate };
    return Photos.upload(photoFile, savedPoint.id, _extra1).then(function(driveUrl) {
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
      var _extra2 = { pointNumber: eData.pointNumber, monitoringDate: eData.monitoringDate, flowRate: eData.flowRate };
      return Photos.upload(ePhotoFile, savedPoint.id, _extra2).catch(function(photoErr) {
        Diagnostics.setError('photo', photoErr.message);
        alert('Точка сохранена, но фото не загрузилось: ' + photoErr.message);
      });
    }).then(function() {
      if (typeof _mapSchemeImg !== 'undefined' && _mapSchemeImg) redrawMap();
    });
  } else if (ePhotoFile) {
    showLoader('Загрузка фото...');
    var _extra3 = { pointNumber: eData.pointNumber, monitoringDate: eData.monitoringDate, flowRate: eData.flowRate };
    chain = Photos.upload(ePhotoFile, id, _extra3).then(function(driveUrl) {
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
    // Сбрасываем кэш графика для этой точки — данные изменились
    delete _chartCache[id];
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
