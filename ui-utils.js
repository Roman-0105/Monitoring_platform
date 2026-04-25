/**
 * ui-utils.js — вспомогательные функции UI.
 * Извлечены из app.js. Используются всеми ui-*.js модулями.
 */

// ── Лоадер ────────────────────────────────────────────────
function showLoader(msg) {
  var el  = document.getElementById('loader');
  var txt = document.getElementById('loader-text');
  if (txt) txt.textContent = msg || 'Загрузка...';
  if (el)  el.style.display = 'flex';
}

function hideLoader() {
  var el = document.getElementById('loader');
  if (el) el.style.display = 'none';
}

// ── Поля формы ────────────────────────────────────────────
function setField(id, v) {
  var el = document.getElementById(id);
  if (el) el.value = (v != null) ? v : '';
}

function getField(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : '';
}

function parseFloatOrNull(v) {
  if (v == null || String(v).trim() === '') return null;
  var n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function readFormFields(prefix) {
  return {
    monitoringDate: getField(prefix + '-monitoring-date') || todayISO(),
    pointNumber:    getField(prefix + '-num'),
    worker:         getField(prefix + '-worker'),
    lat:            parseFloatOrNull(getField(prefix + '-lat')),
    lon:            parseFloatOrNull(getField(prefix + '-lon')),
    xLocal:         parseFloatOrNull(getField(prefix + '-xlocal')),
    yLocal:         parseFloatOrNull(getField(prefix + '-ylocal')),
    intensity:      getField(prefix + '-intensity'),
    flowRate:       parseFloatOrNull(getField(prefix + '-flowrate')),
    waterColor:     getField(prefix + '-color'),
    wall:           getField(prefix + '-wall'),
    domain:         getField(prefix + '-domain'),
    status:         getField(prefix + '-status') || 'Новая',
    measureMethod:  getField(prefix + '-measure'),
    horizon:        getField(prefix + '-horizon'),
    comment:        getField(prefix + '-comment'),
  };
}

// ── Форматирование ────────────────────────────────────────
function lpsToM3h(lps) {
  var n = parseFloat(lps);
  if (isNaN(n)) return null;
  return n * 3.6;
}

function formatFlowBothUnits(lps) {
  var n = parseFloat(lps);
  if (isNaN(n)) return '—';
  var m3h = lpsToM3h(n);
  return n.toFixed(2) + ' л/с (' + m3h.toFixed(2) + ' м³/ч)';
}

function initials(name) {
  return (name || '').split(' ').map(function(s) { return s[0] || ''; }).join('').slice(0, 2).toUpperCase();
}

function escAttr(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function formatCoord(v) {
  if (v == null || v === '') return '—';
  var n = parseFloat(v);
  return isNaN(n) ? String(v) : n.toFixed(4);
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso).slice(0, 10) || '—';
    return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch(e) { return '—'; }
}

// ── Фильтры — общие ──────────────────────────────────────
/**
 * Возвращает { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' } для weekKey вида '2026-W13'.
 * Неделя начинается в понедельник (ISO 8601).
 */
function getWeekDateRange(weekKey) {
  if (!weekKey) return null;
  var parts = weekKey.split('-W');
  if (parts.length !== 2) return null;
  var year = parseInt(parts[0]);
  var week = parseInt(parts[1]);
  if (isNaN(year) || isNaN(week)) return null;

  // Находим 4 января (всегда в 1-й неделе ISO)
  var jan4 = new Date(year, 0, 4);
  // Понедельник 1-й недели
  var dayOfWeek = jan4.getDay() || 7; // 1=пн..7=вс
  var monday1 = new Date(jan4);
  monday1.setDate(jan4.getDate() - (dayOfWeek - 1));

  // Понедельник нужной недели
  var start = new Date(monday1);
  start.setDate(monday1.getDate() + (week - 1) * 7);

  var end = new Date(start);
  end.setDate(start.getDate() + 6); // воскресенье

  function fmt(d) {
    return d.getFullYear() + '-' +
           String(d.getMonth()+1).padStart(2,'0') + '-' +
           String(d.getDate()).padStart(2,'0');
  }

  return { start: fmt(start), end: fmt(end) };
}

/**
 * Возвращает дату понедельника недели в формате YYYY-MM-DD.
 */
function getWeekStartDate(weekKey) {
  var range = getWeekDateRange(weekKey);
  return range ? range.start : null;
}

function getWeekKeyFromDate(iso) {
  if (!iso) return null;
  var d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  var dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  var dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  var yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  var weekNo = Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  return dt.getUTCFullYear() + '-W' + (weekNo < 10 ? '0' + weekNo : weekNo);
}

function getAllWeekKeys() {
  var set = {};
  Points.getList().forEach(function(p) {
    var wk = getWeekKeyFromDate(p.createdAt);
    if (wk) set[wk] = true;
  });
  Schemes.getList().forEach(function(s) {
    if (s.weekKey) set[s.weekKey] = true;
  });
  return Object.keys(set).sort().reverse();
}

function fillSelectOptions(selectEl, options, selectedValue, fallbackLabel) {
  if (!selectEl) return;
  var html = '<option value="all">' + (fallbackLabel || 'Все') + '</option>';
  options.forEach(function(opt) {
    html += '<option value="' + escAttr(opt.value) + '">' + opt.label + '</option>';
  });
  selectEl.innerHTML = html;
  selectEl.value = selectedValue || 'all';
}

function getFilteredPoints(filterState) {
  var state = filterState || { dates: [], worker: 'all', search: '' };
  var search = (state.search || '').toLowerCase().trim();
  return Points.getList().filter(function(p) {
    // Фильтр по сотруднику
    if (state.worker && state.worker !== 'all' && (p.worker || '') !== state.worker) return false;
    // Фильтр по датам
    if (state.dates && state.dates.length > 0) {
      var pDate = (p.monitoringDate || '').slice(0, 10);
      if (state.dates.indexOf(pDate) < 0) return false;
    }
    // Поиск по тексту — номер точки, сотрудник, комментарий, домен, борт
    if (search) {
      var hay = [
        p.pointNumber || '',
        p.worker      || '',
        p.comment     || '',
        p.domain      || '',
        p.wall        || '',
        p.status      || '',
        p.waterColor  || '',
        p.intensity     || '',
        p.horizon       || '',
        p.measureMethod || '',
      ].join(' ').toLowerCase();
      if (hay.indexOf(search) < 0) return false;
    }
    return true;
  });
}

// ── Дедупликация: оставляем только последний замер каждой точки ──

function getLatestByPointNumber(points) {
  // Группируем по pointNumber, оставляем запись с максимальным monitoringDate
  var map = {};
  points.forEach(function(p) {
    var num = String(p.pointNumber || '').trim();
    if (!num) return;
    if (!map[num]) { map[num] = p; return; }
    var dCur = normalizeHistDate(map[num].monitoringDate || '');
    var dNew = normalizeHistDate(p.monitoringDate || '');
    // Если дата одинакова — берём ту что создана позже (по createdAt)
    if (dNew > dCur) {
      map[num] = p;
    } else if (dNew === dCur) {
      var tCur = map[num].createdAt || '';
      var tNew = p.createdAt || '';
      if (tNew > tCur) map[num] = p;
    }
  });
  // Сортируем по числовому значению номера точки
  return Object.keys(map).sort(function(a, b) {
    var na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  }).map(function(k) { return map[k]; });
}

// ── Даты мониторинга ──────────────────────────────────────

// Возвращает массив уникальных дат мониторинга, отсортированных от новых к старым
function getAllMonitoringDates() {
  var set = {};
  Points.getList().forEach(function(p) {
    var d = (p.monitoringDate || '').slice(0, 10);
    if (d) set[d] = true;
  });
  return Object.keys(set).sort().reverse();
}

// Форматирует YYYY-MM-DD → "15 апр 2026"
function formatMonitoringDate(dateStr) {
  if (!dateStr) return '—';
  try {
    var s = String(dateStr);
    var d;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      d = new Date(s + 'T00:00:00');        // YYYY-MM-DD — добавляем время
    } else {
      d = new Date(s);                       // всё остальное: "Thu Apr 02 2026...", ISO и т.д.
    }
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch(e) { return String(dateStr); }
}

// Нормализует дату любого формата -> YYYY-MM-DD строка (для сравнений)
function normalizeHistDate(dateStr) {
  if (!dateStr) return '';
  try {
    var s = String(dateStr);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var d = new Date(s);
    if (isNaN(d.getTime())) return s;
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  } catch(e) { return String(dateStr); }
}

// Сегодня в формате YYYY-MM-DD
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// ── GPS ───────────────────────────────────────────────────
function getGPSForForm(prefix) {
  if (!navigator.geolocation) { alert('GPS не поддерживается'); return; }
  var btnId = (prefix === 'f') ? 'btn-gps' : (prefix + '-btn-gps');
  var btn   = document.getElementById(btnId);
  if (btn) { btn.textContent = '⏳...'; btn.disabled = true; }
  navigator.geolocation.getCurrentPosition(function(pos) {
    var lat = pos.coords.latitude;
    var lon = pos.coords.longitude;
    setField(prefix + '-lat', lat.toFixed(7));
    setField(prefix + '-lon', lon.toFixed(7));
    if (typeof MapModule !== 'undefined') {
      var sk = MapModule.wgs84ToXY(lat, lon);
      setField(prefix + '-xlocal', sk.x.toFixed(4));
      setField(prefix + '-ylocal', sk.y.toFixed(4));
      var info = document.getElementById(prefix + '-map-coord-info');
      if (info) info.textContent = 'X: ' + sk.x.toFixed(4) + '  Y: ' + sk.y.toFixed(4) + ' (из GPS)';
    }
    if (btn) { btn.textContent = '📍 GPS'; btn.disabled = false; }
  }, function(err) {
    alert('GPS: ' + err.message);
    if (btn) { btn.textContent = '📍 GPS'; btn.disabled = false; }
  }, { enableHighAccuracy: true, timeout: 15000 });
}

function recalcLocalCoords(prefix) {
  var lat = parseFloatOrNull(getField(prefix + '-lat'));
  var lon = parseFloatOrNull(getField(prefix + '-lon'));
  if (lat && lon && typeof MapModule !== 'undefined') {
    var sk = MapModule.wgs84ToXY(lat, lon);
    setField(prefix + '-xlocal', sk.x.toFixed(4));
    setField(prefix + '-ylocal', sk.y.toFixed(4));
    var info = document.getElementById(prefix + '-map-coord-info');
    if (info) info.textContent = 'X: ' + sk.x.toFixed(4) + '  Y: ' + sk.y.toFixed(4);
  }
}

function updateFlowHint(prefix) {
  var flow = parseFloatOrNull(getField(prefix + '-flowrate'));
  var hint = document.getElementById(prefix + '-flowrate-m3h');
  if (!hint) return;
  if (flow == null) {
    hint.textContent = 'Эквивалент: — м³/ч';
    return;
  }
  hint.textContent = 'Эквивалент: ' + lpsToM3h(flow).toFixed(2) + ' м³/ч';
}

function updateWorkerSelects() {
  var workers = Workers.getList();
  ['f-worker', 'e-worker', 'dm-worker', 'ditch-filter-worker'].forEach(function(id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var cur = sel.value;
    var defaultOpt = id === 'ditch-filter-worker'
      ? '<option value="all">Все сотрудники</option>'
      : '<option value="">— выберите —</option>';
    sel.innerHTML = defaultOpt;
    workers.forEach(function(w) {
      var opt = document.createElement('option');
      opt.value = w.name;
      opt.textContent = w.name;
      sel.appendChild(opt);
    });
    if (cur) sel.value = cur;
  });
}

// ── Чекбокс-фильтр дат ────────────────────────────────────

/**
 * Строит виджет выбора дат с чекбоксами.
 * @param {string} containerId  — id элемента куда вставить кнопку
 * @param {Array}  selectedDates — текущий массив выбранных дат ['2026-03-28', ...]
 * @param {Function} onChange   — callback(newDatesArray) при изменении
 */
function buildDateFilterWidget(containerId, selectedDates, onChange) {
  var container = document.getElementById(containerId);
  if (!container) return;

  var dates = getAllMonitoringDates(); // ['2026-03-29', '2026-03-28', ...]
  var selected = selectedDates ? selectedDates.slice() : [];

  function getLabel() {
    if (!selected.length) return '📅 Все даты';
    if (selected.length === 1) return '📅 ' + formatMonitoringDate(selected[0]);
    return '📅 ' + selected.length + ' даты';
  }

  function renderWidget() {
    container.innerHTML = '';

    var wrap = document.createElement('div');
    wrap.className = 'date-filter-wrap';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'date-filter-btn' + (selected.length ? ' has-selection' : '');
    btn.innerHTML = '<span class="df-label">' + getLabel() + '</span><span class="df-arrow">▾</span>';

    var dropdown = document.createElement('div');
    dropdown.className = 'date-filter-dropdown';

    // Пункт "Все даты"
    var allItem = document.createElement('label');
    allItem.className = 'df-item df-all';
    var allCb = document.createElement('input');
    allCb.type = 'checkbox';
    allCb.checked = selected.length === 0;
    allItem.appendChild(allCb);
    allItem.appendChild(document.createTextNode('Все даты'));
    dropdown.appendChild(allItem);

    // Чекбоксы для каждой даты
    dates.forEach(function(d) {
      var item = document.createElement('label');
      item.className = 'df-item';
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = d;
      cb.checked = selected.indexOf(d) >= 0;

      cb.addEventListener('change', function() {
        if (cb.checked) {
          if (selected.indexOf(d) < 0) selected.push(d);
        } else {
          selected = selected.filter(function(x) { return x !== d; });
        }
        selected.sort();
        onChange(selected.slice());
        renderWidget(); // перерисовываем кнопку
        // Переоткрываем дропдаун
        var newDropdown = container.querySelector('.date-filter-dropdown');
        if (newDropdown) newDropdown.classList.add('open');
      });

      item.appendChild(cb);
      item.appendChild(document.createTextNode(formatMonitoringDate(d)));
      dropdown.appendChild(item);
    });

    // "Сбросить" если что-то выбрано
    if (selected.length) {
      var divider = document.createElement('div');
      divider.className = 'df-divider';
      dropdown.appendChild(divider);
      var resetItem = document.createElement('div');
      resetItem.className = 'df-item df-all';
      resetItem.style.cssText = 'color:var(--blue);cursor:pointer;font-size:12px';
      resetItem.textContent = '✕ Сбросить фильтр';
      resetItem.addEventListener('click', function() {
        selected = [];
        onChange([]);
        renderWidget();
      });
      dropdown.appendChild(resetItem);
    }

    // Переключение дропдауна
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      dropdown.classList.toggle('open');
    });

    // Закрытие по клику вне
    document.addEventListener('click', function closeHandler(e) {
      if (!wrap.contains(e.target)) {
        dropdown.classList.remove('open');
        document.removeEventListener('click', closeHandler);
      }
    });

    wrap.appendChild(btn);
    wrap.appendChild(dropdown);
    container.appendChild(wrap);
  }

  renderWidget();
}
