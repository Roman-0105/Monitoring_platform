// ── Горизонтальные скважины ───────────────────────────────

var WellsState = {
  list:         [],
  measurements: {},  // { wellId: [measurement, ...] }
  selectedId:   null,
  editingWell:  null,
  editingMeas:  null,
  measWellId:   null,
};

var _wellsTabInited = false;

function initWellsModule(callback) {
  Api.getWells().then(function(wells) {
    WellsState.list = wells;
    if (typeof callback === 'function') callback();
  }).catch(function(err) {
    console.error('Wells load error:', err.message);
    if (typeof callback === 'function') callback();
  });
}

function initWellsTab() {
  if (_wellsTabInited) {
    renderWellsPage();
    return;
  }
  _wellsTabInited = true;

  var sel = document.getElementById('wells-selector');
  if (sel) {
    sel.addEventListener('change', function() {
      WellsState.selectedId = this.value || null;
      renderWellDetail();
      renderWellRegistryHighlight();
    });
  }

  var addBtn = document.getElementById('btn-add-well');
  if (addBtn) {
    if (AppState.currentUser && AppState.currentUser.role === 'admin') {
      addBtn.style.display = '';
    }
    addBtn.addEventListener('click', openAddWellForm);
  }

  renderWellsPage();
}

function renderWellsPage() {
  _populateWellSelector();
  renderWellDetail();
  renderWellRegistryTable();
}

function _populateWellSelector() {
  var sel = document.getElementById('wells-selector');
  if (!sel) return;
  var prev = WellsState.selectedId;
  sel.innerHTML = '';
  if (!WellsState.list.length) {
    sel.innerHTML = '<option value="">— Скважины не добавлены —</option>';
    WellsState.selectedId = null;
    return;
  }
  WellsState.list.forEach(function(w) {
    var opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = w.name + (w.domain ? ' (' + w.domain + ')' : '');
    sel.appendChild(opt);
  });
  if (prev && WellsState.list.some(function(w) { return w.id === prev; })) {
    sel.value = prev;
    WellsState.selectedId = prev;
  } else {
    WellsState.selectedId = WellsState.list[0].id;
    sel.value = WellsState.selectedId;
  }
}

function renderWellDetail() {
  var well = WellsState.list.find(function(w) { return w.id === WellsState.selectedId; }) || null;
  renderWellInfoCard(well);
  renderWellCoordsCard(well);
  renderWellMapCard(well);
  renderWellChartCard(well);
}

// ── Карточка паспорта скважины ────────────────────────────

function renderWellInfoCard(well) {
  var body = document.getElementById('wells-info-body');
  if (!body) return;
  if (!well) {
    body.innerHTML = '<p class="form-hint">Скважина не выбрана</p>';
    return;
  }

  function row(label, value) {
    return '<div class="diag-row"><span style="color:var(--txt-3)">' + escHTML(label) + '</span>' +
      '<span style="font-weight:500">' + (value !== null && value !== undefined && value !== '' ? escHTML(String(value)) : '<span style="color:var(--txt-3)">—</span>') + '</span></div>';
  }

  var html = '';
  html += row('Название', well.name);
  html += row('Домен', well.domain);
  html += row('Глубина', well.depth != null ? well.depth + ' м' : null);
  html += row('Угол наклона', well.inclination != null ? well.inclination + '°' : null);
  html += row('Азимут', well.azimuth != null ? well.azimuth + '°' : null);
  html += row('Диаметр бурения', well.drillDiameter != null ? well.drillDiameter + ' мм' : null);
  html += row('Обсадка', well.casing);
  html += row('Дата бурения', well.drillDate ? formatDate(well.drillDate) : null);
  html += row('Оголовок', well.hasWellhead ? 'Да' : 'Нет');
  html += row('Дебит после бурения', well.flowAfterDrill != null ? well.flowAfterDrill + ' м³/ч' : null);

  var lastMeas = _getLastMeasurement(well.id);
  html += row('Дебит (посл. замер)', lastMeas ? lastMeas.flowRate + ' м³/ч' : null);

  body.innerHTML = html;
}

// ── Карточка координат ────────────────────────────────────

function renderWellCoordsCard(well) {
  var body = document.getElementById('wells-coords-body');
  if (!body) return;
  if (!well) {
    body.innerHTML = '<p class="form-hint">Скважина не выбрана</p>';
    return;
  }

  function row(label, value, note) {
    return '<div class="diag-row"><span style="color:var(--txt-3)">' + escHTML(label) + '</span>' +
      '<span style="font-weight:500">' + (value !== null && value !== undefined && value !== '' ? escHTML(String(value)) : '<span style="color:var(--txt-3)">—</span>') +
      (note ? '<span style="color:var(--txt-3);font-size:11px;margin-left:4px">' + escHTML(note) + '</span>' : '') +
      '</span></div>';
  }

  var html = '<div style="margin-bottom:10px"><span style="font-size:12px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em">Местная система</span></div>';
  html += row('X', well.xLocal != null ? well.xLocal.toFixed(2) : null);
  html += row('Y', well.yLocal != null ? well.yLocal.toFixed(2) : null);
  html += row('Z', well.zLocal != null ? well.zLocal.toFixed(2) + ' м' : null);
  html += '<div style="margin:10px 0"><span style="font-size:12px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em">WGS-84</span></div>';
  html += row('Широта', well.lat != null ? well.lat.toFixed(7) : null, well.lat != null ? '°N' : '');
  html += row('Долгота', well.lon != null ? well.lon.toFixed(7) : null, well.lon != null ? '°E' : '');

  body.innerHTML = html;
}

// ── Карточка карты ────────────────────────────────────────

var WELL_BOUNDS = { Xmin: 45850, Xmax: 47350, Ymin: 15800, Ymax: 17350 };

function renderWellMapCard(well) {
  var body = document.getElementById('wells-map-body');
  if (!body) return;
  if (!well || well.xLocal == null || well.yLocal == null) {
    body.innerHTML = '<p class="form-hint" style="padding:20px 0">' +
      (well ? 'Координаты скважины не заданы' : 'Скважина не выбрана') + '</p>';
    return;
  }

  body.innerHTML = '<p class="form-hint" style="padding:12px 0">Загрузка схемы...</p>';

  Schemes.getCurrentImage().then(function(url) {
    if (!url) {
      body.innerHTML = '<p class="form-hint" style="padding:20px 0">Схема не загружена</p>';
      return;
    }
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'position:relative;display:inline-block;width:100%;';

    var img = document.createElement('img');
    img.src = url;
    img.style.cssText = 'width:100%;height:auto;display:block;border-radius:6px;';
    img.alt = 'Схема карьера';

    wrapper.appendChild(img);
    body.innerHTML = '';
    body.appendChild(wrapper);

    img.onload = function() {
      var W = img.naturalWidth, H = img.naturalHeight;
      var px = (well.xLocal - WELL_BOUNDS.Xmin) / (WELL_BOUNDS.Xmax - WELL_BOUNDS.Xmin) * 100;
      var py = (WELL_BOUNDS.Ymax - well.yLocal) / (WELL_BOUNDS.Ymax - WELL_BOUNDS.Ymin) * 100;

      var marker = document.createElement('div');
      marker.title = well.name;
      marker.style.cssText = 'position:absolute;left:' + px.toFixed(3) + '%;top:' + py.toFixed(3) + '%;' +
        'transform:translate(-50%,-50%);cursor:default;';
      marker.innerHTML =
        '<svg width="22" height="22" viewBox="-11 -11 22 22" xmlns="http://www.w3.org/2000/svg">' +
          '<circle cx="0" cy="0" r="7" fill="#f9ab00" stroke="#1a1200" stroke-width="1.5" opacity=".9"/>' +
          '<circle cx="0" cy="0" r="2.5" fill="#1a1200"/>' +
        '</svg>';

      var label = document.createElement('div');
      label.textContent = well.name;
      label.style.cssText = 'position:absolute;left:' + px.toFixed(3) + '%;top:calc(' + py.toFixed(3) + '% + 14px);' +
        'transform:translateX(-50%);background:rgba(0,0,0,.7);color:#f9ab00;font-size:11px;' +
        'padding:2px 5px;border-radius:3px;white-space:nowrap;pointer-events:none;';

      wrapper.appendChild(marker);
      wrapper.appendChild(label);
    };
  });
}

// ── График замеров ────────────────────────────────────────

function renderWellChartCard(well) {
  var body = document.getElementById('wells-chart-body');
  if (!body) return;
  if (!well) {
    body.innerHTML = '<p class="form-hint">Скважина не выбрана</p>';
    return;
  }

  if (WellsState.measurements[well.id]) {
    _drawWellChart(body, WellsState.measurements[well.id]);
    return;
  }

  body.innerHTML = '<p class="form-hint">Загрузка замеров...</p>';
  Api.getWellMeasurements(well.id).then(function(meas) {
    WellsState.measurements[well.id] = meas;
    if (WellsState.selectedId === well.id) {
      _drawWellChart(body, meas);
    }
  }).catch(function(err) {
    body.innerHTML = '<p class="form-hint" style="color:var(--red)">Ошибка: ' + escHTML(err.message) + '</p>';
  });
}

function _drawWellChart(container, measurements) {
  if (!measurements || !measurements.length) {
    container.innerHTML = '<p class="form-hint">Замеры отсутствуют</p>';
    return;
  }

  var W = 520, H = 160;
  var pad = { t: 16, r: 20, b: 40, l: 52 };
  var cW = W - pad.l - pad.r;
  var cH = H - pad.t - pad.b;

  var data = measurements.filter(function(m) { return m.flowRate != null && m.measurementDate; });
  if (!data.length) {
    container.innerHTML = '<p class="form-hint">Нет данных дебита</p>';
    return;
  }

  var maxFlow = Math.max.apply(null, data.map(function(m) { return m.flowRate; }));
  var minFlow = Math.min.apply(null, data.map(function(m) { return m.flowRate; }));
  var range = maxFlow - minFlow || 1;
  var yMax = maxFlow + range * 0.1;
  var yMin = Math.max(0, minFlow - range * 0.1);

  var n = data.length;

  function px(i) { return pad.l + (n === 1 ? cW / 2 : i / (n - 1) * cW); }
  function py(v) { return pad.t + cH - (v - yMin) / (yMax - yMin) * cH; }

  var polyPts = data.map(function(m, i) { return px(i) + ',' + py(m.flowRate); }).join(' ');
  var areaFirst = px(0) + ',' + (pad.t + cH);
  var areaLast  = px(n - 1) + ',' + (pad.t + cH);

  var Y_TICKS = 4;
  var gridLines = '';
  var yLabels = '';
  for (var ti = 0; ti <= Y_TICKS; ti++) {
    var yv = yMin + (yMax - yMin) * ti / Y_TICKS;
    var yp = py(yv);
    gridLines += '<line x1="' + pad.l + '" y1="' + yp.toFixed(1) + '" x2="' + (pad.l + cW) + '" y2="' + yp.toFixed(1) + '" stroke="rgba(255,255,255,.07)" stroke-width="1"/>';
    yLabels   += '<text x="' + (pad.l - 6) + '" y="' + (yp + 4).toFixed(1) + '" fill="var(--txt-3)" font-size="10" text-anchor="end">' + yv.toFixed(1) + '</text>';
  }

  var xLabels = '';
  var step = Math.max(1, Math.floor(n / 6));
  data.forEach(function(m, i) {
    if (i % step === 0 || i === n - 1) {
      var d = m.measurementDate ? m.measurementDate.slice(5) : '';
      xLabels += '<text x="' + px(i).toFixed(1) + '" y="' + (H - 8) + '" fill="var(--txt-3)" font-size="10" text-anchor="middle">' + escHTML(d) + '</text>';
    }
  });

  var dots = data.map(function(m, i) {
    return '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(m.flowRate).toFixed(1) + '" r="4" fill="#f9ab00" stroke="var(--card-bg,#1e2530)" stroke-width="1.5">' +
      '<title>' + escHTML(m.measurementDate || '') + ': ' + m.flowRate + ' м³/ч' + (m.worker ? ', ' + m.worker : '') + '</title>' +
      '</circle>';
  }).join('');

  var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-height:200px" xmlns="http://www.w3.org/2000/svg">' +
    gridLines +
    yLabels +
    '<defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#f9ab00" stop-opacity=".35"/>' +
      '<stop offset="100%" stop-color="#f9ab00" stop-opacity=".03"/>' +
    '</linearGradient></defs>' +
    '<polygon points="' + areaFirst + ' ' + polyPts + ' ' + areaLast + '" fill="url(#wg)"/>' +
    '<polyline points="' + polyPts + '" fill="none" stroke="#f9ab00" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    dots +
    xLabels +
    '<text x="' + (pad.l - 28) + '" y="' + (pad.t + cH / 2) + '" fill="var(--txt-3)" font-size="10" text-anchor="middle" transform="rotate(-90,' + (pad.l - 28) + ',' + (pad.t + cH / 2) + ')">м³/ч</text>' +
    '</svg>';

  container.innerHTML = svg;
}

// ── Реестр скважин ────────────────────────────────────────

function renderWellRegistryTable() {
  var wrap = document.getElementById('wells-registry-table');
  if (!wrap) return;

  if (!WellsState.list.length) {
    wrap.innerHTML = '<p class="form-hint">Скважины не добавлены</p>';
    return;
  }

  var isAdmin = AppState.currentUser && AppState.currentUser.role === 'admin';

  var html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr style="border-bottom:1px solid var(--line)">' +
      '<th style="text-align:left;padding:8px 10px;color:var(--txt-3);font-weight:500">Название</th>' +
      '<th style="text-align:left;padding:8px 10px;color:var(--txt-3);font-weight:500">Домен</th>' +
      '<th style="text-align:right;padding:8px 10px;color:var(--txt-3);font-weight:500">Глубина</th>' +
      '<th style="text-align:left;padding:8px 10px;color:var(--txt-3);font-weight:500">Дата бурения</th>' +
      '<th style="text-align:right;padding:8px 10px;color:var(--txt-3);font-weight:500">Дебит (посл.)</th>' +
      '<th style="padding:8px 10px"></th>' +
    '</tr></thead><tbody>';

  WellsState.list.forEach(function(w) {
    var lastMeas = _getLastMeasurement(w.id);
    var lastFlow = lastMeas ? lastMeas.flowRate + ' м³/ч' : '—';
    var isSelected = w.id === WellsState.selectedId;
    html += '<tr class="well-reg-row" data-well-id="' + escHTML(w.id) + '" style="border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer;' +
      (isSelected ? 'background:rgba(249,171,0,.07)' : '') + '">' +
      '<td style="padding:8px 10px;font-weight:500;color:' + (isSelected ? '#f9ab00' : 'inherit') + '">' + escHTML(w.name) + '</td>' +
      '<td style="padding:8px 10px;color:var(--txt-2)">' + escHTML(w.domain || '—') + '</td>' +
      '<td style="padding:8px 10px;text-align:right">' + (w.depth != null ? w.depth + ' м' : '—') + '</td>' +
      '<td style="padding:8px 10px;color:var(--txt-2)">' + (w.drillDate ? formatDate(w.drillDate) : '—') + '</td>' +
      '<td style="padding:8px 10px;text-align:right">' + escHTML(lastFlow) + '</td>' +
      '<td style="padding:8px 10px;white-space:nowrap">' +
        '<button class="btn btn-sm btn-outline well-add-meas-btn" data-well-id="' + escHTML(w.id) + '" style="padding:3px 8px;margin-right:4px">+ Замер</button>' +
        (isAdmin ? '<button class="btn btn-sm btn-outline well-edit-btn" data-well-id="' + escHTML(w.id) + '" style="padding:3px 8px;margin-right:4px">✏</button>' : '') +
        (isAdmin ? '<button class="btn btn-sm btn-danger well-del-btn" data-well-id="' + escHTML(w.id) + '" style="padding:3px 8px">✕</button>' : '') +
      '</td>' +
    '</tr>';
  });

  html += '</tbody></table></div>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('.well-reg-row').forEach(function(row) {
    row.addEventListener('click', function(e) {
      if (e.target.closest('button')) return;
      var id = this.dataset.wellId;
      WellsState.selectedId = id;
      var sel = document.getElementById('wells-selector');
      if (sel) sel.value = id;
      renderWellDetail();
      renderWellRegistryHighlight();
    });
  });

  wrap.querySelectorAll('.well-add-meas-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      openAddMeasurementForm(this.dataset.wellId);
    });
  });

  if (isAdmin) {
    wrap.querySelectorAll('.well-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var well = WellsState.list.find(function(w) { return w.id === btn.dataset.wellId; });
        if (well) openEditWellForm(well);
      });
    });

    wrap.querySelectorAll('.well-del-btn').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        deleteWellConfirm(btn.dataset.wellId);
      });
    });
  }
}

function renderWellRegistryHighlight() {
  document.querySelectorAll('.well-reg-row').forEach(function(row) {
    var isSelected = row.dataset.wellId === WellsState.selectedId;
    row.style.background = isSelected ? 'rgba(249,171,0,.07)' : '';
    var nameCell = row.querySelector('td:first-child');
    if (nameCell) nameCell.style.color = isSelected ? '#f9ab00' : '';
  });
}

function _getLastMeasurement(wellId) {
  var meas = WellsState.measurements[wellId];
  if (!meas || !meas.length) return null;
  var sorted = meas.slice().sort(function(a, b) {
    return (b.measurementDate || '') > (a.measurementDate || '') ? 1 : -1;
  });
  return sorted[0].flowRate != null ? sorted[0] : null;
}

// ── Модальное окно: скважина ──────────────────────────────

function openAddWellForm() {
  WellsState.editingWell = null;
  _buildWellModal('Новая скважина', null);
}

function openEditWellForm(well) {
  WellsState.editingWell = well;
  _buildWellModal('Изменить скважину', well);
}

function _buildWellModal(title, well) {
  var ex = document.getElementById('wells-modal');
  if (ex) ex.remove();

  var modal = document.createElement('div');
  modal.id = 'wells-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9000;display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px 0';

  var w = well || {};

  modal.innerHTML = [
    '<div style="background:var(--card-bg,#1e2530);border-radius:14px;padding:24px;width:min(620px,95vw);border:1px solid rgba(255,255,255,.08);margin:auto">',
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">',
        '<span style="font-size:16px;font-weight:600">' + escHTML(title) + '</span>',
        '<button id="wells-modal-close" style="background:none;border:none;color:var(--txt-2);font-size:22px;cursor:pointer">✕</button>',
      '</div>',

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">',
        _wf('Название *', 'wells-f-name', 'text', w.name || '', false, 'col-span'),
        _wf('Домен', 'wells-f-domain', 'text', w.domain || ''),
        _wf('Глубина, м', 'wells-f-depth', 'number', w.depth != null ? w.depth : ''),
        _wf('Угол наклона, °', 'wells-f-inclination', 'number', w.inclination != null ? w.inclination : ''),
        _wf('Азимут, °', 'wells-f-azimuth', 'number', w.azimuth != null ? w.azimuth : ''),
        _wf('Диаметр бурения, мм', 'wells-f-drill-diameter', 'number', w.drillDiameter != null ? w.drillDiameter : ''),
        _wf('Обсадка', 'wells-f-casing', 'text', w.casing || ''),
        _wf('Дата бурения', 'wells-f-drill-date', 'date', w.drillDate || ''),
        _wf('Дебит после бурения, м³/ч', 'wells-f-flow-after-drill', 'number', w.flowAfterDrill != null ? w.flowAfterDrill : ''),
        _wfCheck('Оголовок установлен', 'wells-f-has-wellhead', w.hasWellhead || false),
      '</div>',

      '<div style="border-top:1px solid rgba(255,255,255,.08);margin:14px 0 12px;padding-top:12px;font-size:12px;color:var(--txt-3)">КООРДИНАТЫ (местная система)</div>',
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">',
        _wf('X', 'wells-f-x', 'number', w.xLocal != null ? w.xLocal : ''),
        _wf('Y', 'wells-f-y', 'number', w.yLocal != null ? w.yLocal : ''),
        _wf('Z, м', 'wells-f-z', 'number', w.zLocal != null ? w.zLocal : ''),
      '</div>',
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">',
        '<div class="form-group" style="margin:0">',
          '<label class="form-label">Широта (WGS-84, авто)</label>',
          '<input id="wells-f-lat" type="text" class="form-control" readonly placeholder="Вычисляется из X/Y" style="width:100%;box-sizing:border-box;opacity:.7" value="' + (w.lat != null ? w.lat : '') + '">',
        '</div>',
        '<div class="form-group" style="margin:0">',
          '<label class="form-label">Долгота (WGS-84, авто)</label>',
          '<input id="wells-f-lon" type="text" class="form-control" readonly placeholder="Вычисляется из X/Y" style="width:100%;box-sizing:border-box;opacity:.7" value="' + (w.lon != null ? w.lon : '') + '">',
        '</div>',
      '</div>',

      '<p id="wells-modal-err" style="color:var(--red,#ea4335);font-size:13px;margin-bottom:10px;display:none"></p>',
      '<button id="wells-modal-save" class="btn btn-primary btn-full">' + (well ? 'Сохранить изменения' : 'Добавить скважину') + '</button>',
    '</div>',
  ].join('');

  document.body.appendChild(modal);

  document.getElementById('wells-modal-close').addEventListener('click', closeWellModal);
  modal.addEventListener('click', function(e) { if (e.target === modal) closeWellModal(); });

  // Авто-конвертация X/Y → WGS-84
  ['wells-f-x', 'wells-f-y'].forEach(function(id) {
    document.getElementById(id).addEventListener('input', _updateWellLatLon);
  });

  document.getElementById('wells-modal-save').addEventListener('click', saveWell);
}

function _wf(label, id, type, value, readOnly, extra) {
  var span = extra === 'col-span' ? ' style="grid-column:1/-1"' : '';
  return '<div class="form-group" style="margin:0"' + span + '>' +
    '<label class="form-label">' + escHTML(label) + '</label>' +
    '<input id="' + id + '" type="' + type + '" class="form-control" value="' + escHTML(String(value)) + '"' +
      (readOnly ? ' readonly' : '') +
      (type === 'number' ? ' step="any"' : '') +
    ' style="width:100%;box-sizing:border-box">' +
    '</div>';
}

function _wfCheck(label, id, checked) {
  return '<div class="form-group" style="margin:0;display:flex;align-items:center;gap:8px;padding-top:20px">' +
    '<input id="' + id + '" type="checkbox"' + (checked ? ' checked' : '') + ' style="width:16px;height:16px;cursor:pointer">' +
    '<label for="' + id + '" class="form-label" style="margin:0;cursor:pointer">' + escHTML(label) + '</label>' +
    '</div>';
}

function _updateWellLatLon() {
  var x = parseFloat(document.getElementById('wells-f-x').value);
  var y = parseFloat(document.getElementById('wells-f-y').value);
  var latEl = document.getElementById('wells-f-lat');
  var lonEl = document.getElementById('wells-f-lon');
  if (!latEl || !lonEl) return;
  if (isNaN(x) || isNaN(y)) {
    latEl.value = '';
    lonEl.value = '';
    return;
  }
  var wgs = MapModule.xyToWgs84(x, y);
  latEl.value = wgs.lat;
  lonEl.value = wgs.lon;
}

function saveWell() {
  var name = (document.getElementById('wells-f-name').value || '').trim();
  var errEl = document.getElementById('wells-modal-err');
  var saveBtn = document.getElementById('wells-modal-save');
  if (!name) {
    errEl.textContent = 'Название обязательно';
    errEl.style.display = '';
    return;
  }
  errEl.style.display = 'none';
  saveBtn.disabled = true;
  saveBtn.textContent = 'Сохранение...';

  function num(id) {
    var v = parseFloat(document.getElementById(id).value);
    return isNaN(v) ? null : v;
  }

  var xLocal = num('wells-f-x');
  var yLocal = num('wells-f-y');
  var lat = null, lon = null;
  if (xLocal != null && yLocal != null) {
    var wgs = MapModule.xyToWgs84(xLocal, yLocal);
    lat = wgs.lat;
    lon = wgs.lon;
  }

  var well = {
    id:             (WellsState.editingWell && WellsState.editingWell.id) || ('well_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
    name:           name,
    domain:         (document.getElementById('wells-f-domain').value || '').trim(),
    depth:          num('wells-f-depth'),
    inclination:    num('wells-f-inclination'),
    azimuth:        num('wells-f-azimuth'),
    drillDiameter:  num('wells-f-drill-diameter'),
    casing:         (document.getElementById('wells-f-casing').value || '').trim(),
    drillDate:      document.getElementById('wells-f-drill-date').value || null,
    hasWellhead:    document.getElementById('wells-f-has-wellhead').checked,
    flowAfterDrill: num('wells-f-flow-after-drill'),
    xLocal:         xLocal,
    yLocal:         yLocal,
    zLocal:         num('wells-f-z'),
    lat:            lat,
    lon:            lon,
  };

  var op = WellsState.editingWell ? Api.updateWell(well) : Api.createWell(well);
  op.then(function() {
    closeWellModal();
    Toast.show(WellsState.editingWell ? 'Скважина обновлена' : 'Скважина добавлена', 'success');
    return Api.getWells();
  }).then(function(list) {
    WellsState.list = list;
    if (!WellsState.selectedId) WellsState.selectedId = well.id;
    renderWellsPage();
  }).catch(function(err) {
    errEl.textContent = err.message;
    errEl.style.display = '';
    saveBtn.disabled = false;
    saveBtn.textContent = WellsState.editingWell ? 'Сохранить изменения' : 'Добавить скважину';
  });
}

function deleteWellConfirm(id) {
  var well = WellsState.list.find(function(w) { return w.id === id; });
  if (!well) return;
  if (!confirm('Удалить скважину "' + well.name + '" и все её замеры?')) return;
  Api.deleteWell(id).then(function() {
    Toast.show('Скважина удалена', 'success');
    delete WellsState.measurements[id];
    if (WellsState.selectedId === id) WellsState.selectedId = null;
    return Api.getWells();
  }).then(function(list) {
    WellsState.list = list;
    renderWellsPage();
  }).catch(function(err) {
    Toast.show('Ошибка: ' + err.message, 'error');
  });
}

function closeWellModal() {
  var m = document.getElementById('wells-modal');
  if (m) m.remove();
}

// ── Модальное окно: замер ─────────────────────────────────

function openAddMeasurementForm(wellId) {
  WellsState.editingMeas = null;
  WellsState.measWellId  = wellId;
  _buildMeasurementModal(wellId, null);
}

function openEditMeasurementForm(meas) {
  WellsState.editingMeas = meas;
  WellsState.measWellId  = meas.wellId;
  _buildMeasurementModal(meas.wellId, meas);
}

function _buildMeasurementModal(wellId, meas) {
  var ex = document.getElementById('wells-meas-modal');
  if (ex) ex.remove();

  var well = WellsState.list.find(function(w) { return w.id === wellId; }) || {};
  var m = meas || {};
  var modal = document.createElement('div');
  modal.id = 'wells-meas-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9000;display:flex;align-items:center;justify-content:center';

  var workerOptions = '';
  var workers = typeof Workers !== 'undefined' ? Workers.getList() : [];
  var currentWorker = m.worker || (AppState.currentUser ? AppState.currentUser.displayName : '');
  workers.forEach(function(wk) {
    workerOptions += '<option value="' + escHTML(wk.name) + '"' + (wk.name === currentWorker ? ' selected' : '') + '>' + escHTML(wk.name) + '</option>';
  });

  modal.innerHTML = [
    '<div style="background:var(--card-bg,#1e2530);border-radius:14px;padding:24px;width:min(440px,94vw);border:1px solid rgba(255,255,255,.08)">',
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">',
        '<span style="font-size:15px;font-weight:600">Замер дебита — ' + escHTML(well.name || '') + '</span>',
        '<button id="wells-meas-close" style="background:none;border:none;color:var(--txt-2);font-size:22px;cursor:pointer">✕</button>',
      '</div>',
      '<div class="form-group" style="margin-bottom:12px">',
        '<label class="form-label">Дата замера</label>',
        '<input id="wells-mf-date" type="date" class="form-control" value="' + (m.measurementDate || todayISO()) + '" style="width:100%;box-sizing:border-box">',
      '</div>',
      '<div class="form-group" style="margin-bottom:12px">',
        '<label class="form-label">Дебит, м³/ч</label>',
        '<input id="wells-mf-flow" type="number" step="any" class="form-control" value="' + (m.flowRate != null ? m.flowRate : '') + '" style="width:100%;box-sizing:border-box">',
      '</div>',
      '<div class="form-group" style="margin-bottom:12px">',
        '<label class="form-label">Сотрудник</label>',
        '<select id="wells-mf-worker" class="form-control" style="width:100%;box-sizing:border-box">' + workerOptions + '</select>',
      '</div>',
      '<div class="form-group" style="margin-bottom:16px">',
        '<label class="form-label">Комментарий</label>',
        '<textarea id="wells-mf-comment" class="form-control" rows="2" style="width:100%;box-sizing:border-box;resize:vertical">' + escHTML(m.comment || '') + '</textarea>',
      '</div>',
      '<p id="wells-meas-err" style="color:var(--red,#ea4335);font-size:13px;margin-bottom:10px;display:none"></p>',
      '<button id="wells-meas-save" class="btn btn-primary btn-full">' + (meas ? 'Сохранить' : 'Добавить замер') + '</button>',
    '</div>',
  ].join('');

  document.body.appendChild(modal);

  document.getElementById('wells-meas-close').addEventListener('click', closeMeasurementModal);
  modal.addEventListener('click', function(e) { if (e.target === modal) closeMeasurementModal(); });
  document.getElementById('wells-meas-save').addEventListener('click', saveMeasurement);
}

function saveMeasurement() {
  var date    = document.getElementById('wells-mf-date').value;
  var flowRaw = document.getElementById('wells-mf-flow').value;
  var worker  = document.getElementById('wells-mf-worker').value;
  var comment = document.getElementById('wells-mf-comment').value;
  var errEl   = document.getElementById('wells-meas-err');
  var saveBtn = document.getElementById('wells-meas-save');

  var flowRate = parseFloat(flowRaw);
  if (!date || isNaN(flowRate)) {
    errEl.textContent = 'Укажите дату и дебит';
    errEl.style.display = '';
    return;
  }
  errEl.style.display = 'none';
  saveBtn.disabled = true;
  saveBtn.textContent = 'Сохранение...';

  var meas = {
    id:              (WellsState.editingMeas && WellsState.editingMeas.id) || ('wm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
    wellId:          WellsState.measWellId,
    measurementDate: date,
    flowRate:        flowRate,
    worker:          worker,
    comment:         comment,
  };

  var op = WellsState.editingMeas ? Api.updateMeasurement(meas) : Api.createMeasurement(meas);
  op.then(function() {
    closeMeasurementModal();
    Toast.show('Замер сохранён', 'success');
    delete WellsState.measurements[meas.wellId];
    if (WellsState.selectedId === meas.wellId) {
      return Api.getWellMeasurements(meas.wellId).then(function(list) {
        WellsState.measurements[meas.wellId] = list;
        renderWellDetail();
        renderWellRegistryTable();
      });
    }
  }).catch(function(err) {
    errEl.textContent = err.message;
    errEl.style.display = '';
    saveBtn.disabled = false;
    saveBtn.textContent = WellsState.editingMeas ? 'Сохранить' : 'Добавить замер';
  });
}

function closeMeasurementModal() {
  var m = document.getElementById('wells-meas-modal');
  if (m) m.remove();
}
