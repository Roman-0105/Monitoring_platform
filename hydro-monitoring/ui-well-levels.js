// ── Замеры УПВ (уровня подземных вод), потурово ────────────────────────────
// Отдельная вкладка для быстрого ввода глубины до воды по всем наблюдательным/
// эксплуатационным скважинам разом, за один выбранный день ("тур"), по аналогии
// с турами замеров в Журнале Водоотлива/Пылеподавления.
// Зависит от: ui-registry.js (RegistryState.items — скважины, RegistryApi.getAllWellLevels/
// upsertWellLevel), ui-utils.js (escHTML/escAttr).

var WellLevelsState = {
  date: null,          // выбранная дата тура, 'YYYY-MM-DD'
  byWellDate: {},       // { [wellId]: { [date]: row } } — индекс всех замеров УПВ
  filterQ:    '',        // поиск по коду/названию скважины
  filterType: '',        // '' | 'well_obs' | 'well_exp'
  pendingDepths: {},      // { [wellId]: string } — введённые, ещё не сохранённые значения;
                          // хранится отдельно от DOM, чтобы фильтр не "терял" уже заполненные строки
};

function _wlvToday() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function _wlvLoadAll() {
  var res = await RegistryApi.getAllWellLevels();
  if (res.error) { WellLevelsState.byWellDate = {}; return; }
  var idx = {};
  (res.data || []).forEach(function(row) {
    if (!idx[row.well_id]) idx[row.well_id] = {};
    idx[row.well_id][row.date] = row;
  });
  WellLevelsState.byWellDate = idx;
}

async function initWellLevelsTab() {
  if (typeof RegistryState !== 'undefined' && !RegistryState.loaded && !RegistryState.loading && typeof RegistryApi !== 'undefined') {
    RegistryState.loading = true;
    try {
      var r = await RegistryApi.getAll();
      if (!r.error) RegistryState.items = r.data || [];
    } catch (e) { console.warn('[wellLevels] registry load failed', e); }
    RegistryState.loaded = true;
    RegistryState.loading = false;
  }
  if (!WellLevelsState.date) WellLevelsState.date = _wlvToday();
  _wlvRenderPanel();
  var tableEl = document.getElementById('wlv-table');
  if (tableEl) tableEl.innerHTML = '<div style="color:var(--txt-3);font-size:13px;padding:20px 0">Загрузка…</div>';
  await _wlvLoadAll();
  _wlvRenderTable();
}

// Количество введённых, но ещё не сохранённых значений — для бейджа рядом с кнопкой сохранения
function _wlvPendingCount() {
  return Object.keys(WellLevelsState.pendingDepths).filter(function(id) {
    return String(WellLevelsState.pendingDepths[id]).trim() !== '';
  }).length;
}

function _wlvUpdatePendingBadge() {
  var el = document.getElementById('wlv-pending-count');
  if (!el) return;
  var n = _wlvPendingCount();
  el.textContent = n ? ('Не сохранено: ' + n) : '';
}

// Полный список скважин без каких-либо фильтров — источник истины для сохранения, чтобы
// "Сохранить всё" не теряло значения, введённые на строках, скрытых поиском/фильтром типа
function _wlvAllWells() {
  return (RegistryState.items || [])
    .filter(function(w) { return w.wp_type === 'well_obs' || w.wp_type === 'well_exp'; })
    .sort(function(a, b) { return (a.name || a.code || '').localeCompare(b.name || b.code || '', 'ru'); });
}

// То же самое + фильтр по типу и текстовый поиск — то, что реально показывается в таблице
function _wlvWells() {
  var q = WellLevelsState.filterQ.trim().toLowerCase();
  return _wlvAllWells()
    .filter(function(w) { return !WellLevelsState.filterType || w.wp_type === WellLevelsState.filterType; })
    .filter(function(w) {
      if (!q) return true;
      return (w.name || '').toLowerCase().indexOf(q) !== -1 || (w.code || '').toLowerCase().indexOf(q) !== -1;
    });
}

function _wlvSetDate(val) {
  WellLevelsState.date = val || _wlvToday();
  WellLevelsState.pendingDepths = {}; // ввод относится к предыдущей дате тура — не переносим на новую
  _wlvRenderTable();
}

function _wlvSetFilterQ(val) {
  WellLevelsState.filterQ = val || '';
  _wlvRenderTable();
}

function _wlvSetFilterType(val) {
  WellLevelsState.filterType = val || '';
  _wlvRenderPanel();
  _wlvRenderTable();
}

function _wlvTypeChip(value, label) {
  var active = WellLevelsState.filterType === value;
  return '<button class="btn btn-sm' + (active ? ' btn-primary' : ' btn-outline') + '" onclick="_wlvSetFilterType(\'' + value + '\')">' + label + '</button>';
}

function _wlvRenderPanel() {
  var root = document.getElementById('wlv-content');
  if (!root) return;
  var html = '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap">';
  html += '<label style="font-size:12px;color:var(--txt-2)">Дата тура</label>';
  html += '<input type="date" id="wlv-date" value="' + escAttr(WellLevelsState.date) + '" onchange="_wlvSetDate(this.value)" ' +
    'style="background:var(--bg-1);color:var(--txt-1);border:1px solid var(--line);border-radius:5px;padding:5px 9px;font-size:13px">';
  html += '<span style="font-size:11px;color:var(--txt-3)">Глубина до воды измеряется от устья скважины. Абс. отметка воды считается автоматически (отметка устья − глубина).</span>';
  html += '<span id="wlv-pending-count" style="font-size:11px;color:var(--gold,#c99a5b);font-weight:600;margin-left:auto"></span>';
  html += '<button class="btn btn-sm btn-primary" onclick="_wlvSaveAll()">💾 Сохранить всё</button>';
  html += '</div>';
  html += '<div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap">';
  html += '<input type="text" id="wlv-search" placeholder="Поиск по коду или названию…" value="' + escAttr(WellLevelsState.filterQ) + '" ' +
    'oninput="_wlvSetFilterQ(this.value)" style="flex:1;min-width:180px;max-width:280px;background:var(--bg-1);color:var(--txt-1);' +
    'border:1px solid var(--line);border-radius:5px;padding:5px 9px;font-size:13px">';
  html += _wlvTypeChip('', 'Все типы');
  html += _wlvTypeChip('well_obs', 'Наблюдательные');
  html += _wlvTypeChip('well_exp', 'Эксплуатационные');
  html += '<span id="wlv-shown-count" style="font-size:11px;color:var(--txt-3);margin-left:auto"></span>';
  html += '</div>';
  html += '<div id="wlv-status" style="padding:0 16px;font-size:12px;color:var(--txt-2);min-height:20px"></div>';
  html += '<div id="wlv-table" style="flex:1;overflow:auto;padding:0 16px 16px"></div>';
  root.innerHTML = html;
}

function _wlvElevPreviewText(elevZ, depth) {
  var d = parseFloat(depth);
  if (isNaN(elevZ) || isNaN(d)) return '—';
  return (elevZ - d).toFixed(2);
}

function _wlvRenderTable() {
  var el = document.getElementById('wlv-table');
  if (!el) return;
  var wells = _wlvWells();
  var total = _wlvAllWells().length;
  var shownEl = document.getElementById('wlv-shown-count');
  if (shownEl) shownEl.textContent = (WellLevelsState.filterQ || WellLevelsState.filterType) ? ('Показано ' + wells.length + ' из ' + total) : (total + ' скважин');
  _wlvUpdatePendingBadge();
  if (!wells.length) {
    el.innerHTML = '<div style="color:var(--txt-3);font-size:13px;padding:20px 0">' +
      (WellLevelsState.filterQ || WellLevelsState.filterType ? 'Ничего не найдено по текущему фильтру.' : 'Нет скважин типа «Наблюдательная»/«Эксплуатационная» в реестре водопунктов.') +
      '</div>';
    return;
  }
  var date = WellLevelsState.date;
  var html = '<table style="width:100%;border-collapse:collapse;font-size:12px">';
  html += '<thead><tr style="text-align:left;color:var(--txt-3);border-bottom:1px solid var(--line)">' +
    '<th style="padding:7px 8px">Скважина</th><th style="padding:7px 8px">Отметка устья, м</th>' +
    '<th style="padding:7px 8px">Глубина до воды, м</th><th style="padding:7px 8px">Абс. отметка воды, м</th>' +
    '<th style="padding:7px 8px">Последний замер</th></tr></thead><tbody>';
  wells.forEach(function(w) {
    var byDate = WellLevelsState.byWellDate[w.id] || {};
    var existing = byDate[date];
    var elevZ = parseFloat(w.elev_z);
    var lastDates = Object.keys(byDate).sort();
    var lastRow = lastDates.length ? byDate[lastDates[lastDates.length - 1]] : null;
    // Введённое, но ещё не сохранённое значение — приоритетнее уже сохранённого в БД
    var pending = WellLevelsState.pendingDepths[w.id];
    var isDirty = pending != null && String(pending).trim() !== '';
    var depthVal = pending != null ? pending : (existing ? existing.depth_to_water : '');
    html += '<tr style="border-bottom:1px solid var(--line);' + (isDirty ? 'background:rgba(201,154,91,0.12)' : '') + '" ' +
      'data-well-id="' + escAttr(w.id) + '" data-existing-id="' + escAttr(existing ? existing.id : '') + '">' +
      '<td style="padding:6px 8px;color:var(--txt-1)">' + escHTML(w.name || w.code || w.id) + (isDirty ? ' <span title="Есть несохранённые изменения" style="color:#c99a5b">●</span>' : '') + '</td>' +
      '<td style="padding:6px 8px;color:var(--txt-3)">' + (isNaN(elevZ) ? '—' : elevZ.toFixed(2)) + '</td>' +
      '<td style="padding:6px 8px"><input type="number" step="0.01" class="wlv-depth-input" value="' + depthVal + '" ' +
        'oninput="_wlvUpdateElevPreview(this)" style="width:90px;background:var(--bg-1);color:var(--txt-1);border:1px solid var(--line);border-radius:4px;padding:3px 6px"></td>' +
      '<td class="wlv-elev-preview" style="padding:6px 8px">' + _wlvElevPreviewText(elevZ, depthVal) + '</td>' +
      '<td style="padding:6px 8px;color:var(--txt-3)">' + (lastRow ? escHTML(lastRow.date) + ' (' + parseFloat(lastRow.depth_to_water).toFixed(2) + ' м)' : '—') + '</td>' +
    '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function _wlvUpdateElevPreview(inputEl) {
  var row = inputEl.closest('tr');
  var wellId = row.dataset.wellId;
  // Запоминаем ввод независимо от текущего фильтра — иначе значение "теряется",
  // если пользователь потом сузит список поиском/типом до сохранения
  WellLevelsState.pendingDepths[wellId] = inputEl.value;
  var well = (RegistryState.items || []).find(function(w) { return w.id === wellId; });
  var elevZ = well ? parseFloat(well.elev_z) : NaN;
  row.querySelector('.wlv-elev-preview').textContent = _wlvElevPreviewText(elevZ, inputEl.value);

  // Подсветка "есть несохранённые изменения" — без полной перерисовки таблицы, чтобы не терять фокус
  var isDirty = inputEl.value.trim() !== '';
  row.style.background = isDirty ? 'rgba(201,154,91,0.12)' : '';
  var nameCell = row.children[0];
  var dot = nameCell.querySelector('.wlv-dirty-dot');
  if (isDirty && !dot) {
    dot = document.createElement('span');
    dot.className = 'wlv-dirty-dot';
    dot.title = 'Есть несохранённые изменения';
    dot.style.color = '#c99a5b';
    dot.textContent = ' ●';
    nameCell.appendChild(dot);
  } else if (!isDirty && dot) {
    dot.remove();
  }
  _wlvUpdatePendingBadge();
}

async function _wlvSaveAll() {
  var date = WellLevelsState.date;
  var statusEl = document.getElementById('wlv-status');
  // Берём АБСОЛЮТНО ВСЕ скважины (без учёта поиска/фильтра типа) и введённые значения
  // из pendingDepths — так фильтры, применённые после ввода, не "теряют" скрытые строки
  var toSave = [];
  _wlvAllWells().forEach(function(w) {
    var val = WellLevelsState.pendingDepths[w.id];
    if (val == null) return;
    val = String(val).trim();
    if (val === '') return;
    var depth = parseFloat(val);
    if (isNaN(depth)) return;
    var existing = (WellLevelsState.byWellDate[w.id] || {})[date];
    var row = { well_id: w.id, date: date, depth_to_water: depth };
    if (existing) row.id = existing.id;
    toSave.push(row);
  });
  if (!toSave.length) {
    if (statusEl) statusEl.textContent = 'Нет заполненных значений для сохранения.';
    return;
  }
  if (statusEl) statusEl.textContent = 'Сохранение...';
  var okCount = 0, errCount = 0;
  for (var i = 0; i < toSave.length; i++) {
    var res = await RegistryApi.upsertWellLevel(toSave[i]);
    if (res.error) { errCount++; console.error('[wellLevels] save failed', toSave[i], res.error); }
    else okCount++;
  }
  // Сбрасываем кэши, которые зависят от замеров УПВ — сводку для изогипс и модалку
  // отдельной скважины в Реестре, чтобы они увидели только что сохранённые данные
  if (typeof RegistryState !== 'undefined') {
    RegistryState.wellLevelsLatestLoaded = false;
    toSave.forEach(function(r) { RegistryState.wellLevels[r.well_id] = null; });
  }
  if (!errCount) WellLevelsState.pendingDepths = {}; // сохранено — byWellDate теперь источник истины
  await _wlvLoadAll();
  _wlvRenderTable();
  if (statusEl) statusEl.textContent = errCount ? ('Сохранено: ' + okCount + ', ошибок: ' + errCount) : ('Сохранено: ' + okCount + '.');
}
