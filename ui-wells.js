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

  var addBtn = document.getElementById('btn-add-well');
  if (addBtn) {
    if (AppState.currentUser && AppState.currentUser.role === 'admin') {
      addBtn.style.display = '';
    }
    addBtn.addEventListener('click', openAddWellForm);
  }

  var addMeasBtn = document.getElementById('btn-add-meas');
  if (addMeasBtn) {
    addMeasBtn.addEventListener('click', function() {
      if (!WellsState.selectedId) { Toast.show('Выберите скважину', 'warning'); return; }
      openAddMeasurementForm(WellsState.selectedId);
    });
  }

  renderWellsPage();
}

function renderWellsPage() {
  if (!WellsState.selectedId && WellsState.list.length) {
    WellsState.selectedId = WellsState.list[0].id;
  }
  renderWellRegistryList();
  renderWellDetail();
}

function renderWellDetail() {
  var well = WellsState.list.find(function(w) { return w.id === WellsState.selectedId; }) || null;
  renderWellInfoCard(well);
  renderWellCoordsCard(well);
  renderWellMapCard(well);
  renderWellChartCard(well);
  renderMeasurementsTable(well);
}

// ── Реестр скважин (список-колонка) ──────────────────────

function renderWellRegistryList() {
  var wrap = document.getElementById('wells-registry-list');
  if (!wrap) return;

  if (!WellsState.list.length) {
    wrap.innerHTML = '<p class="form-hint" style="font-size:12px">Скважины не добавлены</p>';
    return;
  }

  var isAdmin = AppState.currentUser && AppState.currentUser.role === 'admin';
  var html = '';

  WellsState.list.forEach(function(w) {
    var isSelected = w.id === WellsState.selectedId;
    html += '<div class="well-list-item" data-well-id="' + escHTML(w.id) + '" style="' +
      'padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;' +
      'border:1px solid ' + (isSelected ? '#f9ab00' : 'rgba(255,255,255,.07)') + ';' +
      'background:' + (isSelected ? 'rgba(249,171,0,.1)' : 'rgba(255,255,255,.02)') + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;font-weight:' + (isSelected ? '600' : '400') + ';color:' + (isSelected ? '#f9ab00' : 'var(--txt-1)') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
            escHTML(w.name) +
          '</div>' +
          (w.domain ? '<div style="font-size:11px;color:var(--txt-3);margin-top:1px">' + escHTML(w.domain) + '</div>' : '') +
          (w.depth != null ? '<div style="font-size:11px;color:var(--txt-3)">⬇ ' + w.depth + ' м</div>' : '') +
        '</div>' +
        (isAdmin ? '<div style="display:flex;gap:3px;margin-left:4px;flex-shrink:0">' +
          '<button class="well-edit-btn btn btn-sm btn-outline" data-well-id="' + escHTML(w.id) + '" style="padding:1px 6px;font-size:11px" title="Редактировать">✏</button>' +
          '<button class="well-del-btn btn btn-sm btn-danger" data-well-id="' + escHTML(w.id) + '" style="padding:1px 6px;font-size:11px" title="Удалить">✕</button>' +
        '</div>' : '') +
      '</div>' +
    '</div>';
  });

  wrap.innerHTML = html;

  wrap.querySelectorAll('.well-list-item').forEach(function(item) {
    item.addEventListener('click', function(e) {
      if (e.target.closest('button')) return;
      WellsState.selectedId = this.dataset.wellId;
      renderWellRegistryList();
      renderWellDetail();
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

// ── Карточка паспорта скважины ────────────────────────────

function renderWellInfoCard(well) {
  var body = document.getElementById('wells-info-body');
  if (!body) return;
  if (!well) {
    body.innerHTML = '<p class="form-hint">Скважина не выбрана</p>';
    return;
  }

  function row(label, value) {
    return '<div class="diag-row" style="padding:4px 0">' +
      '<span style="color:var(--txt-3);font-size:12px">' + escHTML(label) + '</span>' +
      '<span style="font-weight:500;font-size:13px">' +
        (value !== null && value !== undefined && value !== ''
          ? escHTML(String(value))
          : '<span style="color:var(--txt-3)">—</span>') +
      '</span></div>';
  }

  var lastMeas = _getLastMeasurement(well.id);
  var html = '';
  html += row('Название', well.name);
  html += row('Домен', well.domain);
  html += row('Глубина', well.depth != null ? well.depth + ' м' : null);
  html += row('Угол наклона', well.inclination != null ? well.inclination + '°' : null);
  html += row('Азимут', well.azimuth != null ? well.azimuth + '°' : null);
  html += row('Диаметр', well.drillDiameter != null ? well.drillDiameter + ' мм' : null);
  html += row('Обсадка', well.casing);
  html += row('Дата бурения', well.drillDate ? formatDate(well.drillDate) : null);
  html += row('Оголовок', well.hasWellhead ? 'Да' : 'Нет');
  html += row('Дебит (бурение)', well.flowAfterDrill != null ? well.flowAfterDrill + ' м³/ч' : null);
  html += row('Дебит (посл.)', lastMeas ? lastMeas.flowRate + ' м³/ч' : null);
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
    return '<div class="diag-row" style="padding:4px 0">' +
      '<span style="color:var(--txt-3);font-size:12px">' + escHTML(label) + '</span>' +
      '<span style="font-weight:500;font-size:13px">' +
        (value !== null && value !== undefined && value !== ''
          ? escHTML(String(value)) + (note ? '<span style="color:var(--txt-3);font-size:11px"> ' + escHTML(note) + '</span>' : '')
          : '<span style="color:var(--txt-3)">—</span>') +
      '</span></div>';
  }

  var html = '<div style="font-size:11px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Местная система</div>';
  html += row('X', well.xLocal != null ? well.xLocal.toFixed(2) : null);
  html += row('Y', well.yLocal != null ? well.yLocal.toFixed(2) : null);
  html += row('Z', well.zLocal != null ? well.zLocal.toFixed(2) : null, 'м');
  html += '<div style="font-size:11px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em;margin:8px 0 4px">WGS-84</div>';
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
    wrapper.style.cssText = 'position:relative;display:inline-block;width:100%';

    var img = document.createElement('img');
    img.src = url;
    img.style.cssText = 'width:100%;height:auto;display:block;border-radius:6px';
    img.alt = 'Схема карьера';
    wrapper.appendChild(img);

    body.innerHTML = '';
    body.appendChild(wrapper);

    img.onload = function() {
      var px = (well.xLocal - WELL_BOUNDS.Xmin) / (WELL_BOUNDS.Xmax - WELL_BOUNDS.Xmin) * 100;
      var py = (WELL_BOUNDS.Ymax - well.yLocal) / (WELL_BOUNDS.Ymax - WELL_BOUNDS.Ymin) * 100;

      var marker = document.createElement('div');
      marker.title = well.name;
      marker.style.cssText = 'position:absolute;left:' + px.toFixed(3) + '%;top:' + py.toFixed(3) +
        '%;transform:translate(-50%,-50%);pointer-events:none';
      marker.innerHTML =
        '<svg width="22" height="22" viewBox="-11 -11 22 22" xmlns="http://www.w3.org/2000/svg">' +
          '<circle cx="0" cy="0" r="8" fill="#f9ab00" stroke="#1a1200" stroke-width="1.5" opacity=".9"/>' +
          '<circle cx="0" cy="0" r="3" fill="#1a1200"/>' +
        '</svg>';

      var label = document.createElement('div');
      label.textContent = well.name;
      label.style.cssText = 'position:absolute;left:' + px.toFixed(3) + '%;top:calc(' + py.toFixed(3) +
        '% + 14px);transform:translateX(-50%);background:rgba(0,0,0,.75);color:#f9ab00;' +
        'font-size:11px;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none';

      wrapper.appendChild(marker);
      wrapper.appendChild(label);
    };
  });
}

// ── График замеров (сглаженный, с tooltip) ────────────────

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
      renderMeasurementsTable(well);
    }
  }).catch(function(err) {
    body.innerHTML = '<p class="form-hint" style="color:var(--red)">Ошибка: ' + escHTML(err.message) + '</p>';
  });
}

function _smoothCurve(pts) {
  if (pts.length < 2) return pts.length === 1 ? 'M' + pts[0].x + ',' + pts[0].y : '';
  var d = 'M' + pts[0].x.toFixed(1) + ',' + pts[0].y.toFixed(1);
  for (var i = 0; i < pts.length - 1; i++) {
    var p0 = pts[Math.max(0, i - 1)];
    var p1 = pts[i];
    var p2 = pts[i + 1];
    var p3 = pts[Math.min(pts.length - 1, i + 2)];
    var cp1x = p1.x + (p2.x - p0.x) / 6;
    var cp1y = p1.y + (p2.y - p0.y) / 6;
    var cp2x = p2.x - (p3.x - p1.x) / 6;
    var cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ' C' + cp1x.toFixed(1) + ',' + cp1y.toFixed(1) + ' ' + cp2x.toFixed(1) + ',' + cp2y.toFixed(1) + ' ' + p2.x.toFixed(1) + ',' + p2.y.toFixed(1);
  }
  return d;
}

function _drawWellChart(container, measurements) {
  if (!measurements || !measurements.length) {
    container.innerHTML = '<p class="form-hint">Замеры отсутствуют</p>';
    return;
  }

  var data = measurements.filter(function(m) { return m.flowRate != null && m.measurementDate; });
  if (!data.length) {
    container.innerHTML = '<p class="form-hint">Нет данных дебита</p>';
    return;
  }

  var W = 500, H = 170;
  var pad = { t: 16, r: 16, b: 38, l: 50 };
  var cW = W - pad.l - pad.r;
  var cH = H - pad.t - pad.b;

  var flows = data.map(function(m) { return m.flowRate; });
  var maxFlow = Math.max.apply(null, flows);
  var minFlow = Math.min.apply(null, flows);
  var range   = maxFlow - minFlow || 1;
  var yMax    = maxFlow + range * 0.15;
  var yMin    = Math.max(0, minFlow - range * 0.15);
  var n = data.length;

  function px(i) { return pad.l + (n === 1 ? cW / 2 : i / (n - 1) * cW); }
  function py(v)  { return pad.t + cH - (v - yMin) / (yMax - yMin) * cH; }

  var pts = data.map(function(m, i) { return { x: px(i), y: py(m.flowRate) }; });
  var linePath = _smoothCurve(pts);
  var areaPath = linePath +
    ' L' + pts[pts.length - 1].x.toFixed(1) + ',' + (pad.t + cH) +
    ' L' + pts[0].x.toFixed(1) + ',' + (pad.t + cH) + ' Z';

  // Grid & labels
  var grid = '', yLbls = '', xLbls = '';
  var Y_TICKS = 4;
  for (var ti = 0; ti <= Y_TICKS; ti++) {
    var yv = yMin + (yMax - yMin) * ti / Y_TICKS;
    var yp = py(yv);
    grid  += '<line x1="' + pad.l + '" y1="' + yp.toFixed(1) + '" x2="' + (pad.l + cW) + '" y2="' + yp.toFixed(1) + '" stroke="rgba(255,255,255,.07)" stroke-width="1"/>';
    yLbls += '<text x="' + (pad.l - 6) + '" y="' + (yp + 4).toFixed(1) + '" fill="var(--txt-3)" font-size="10" text-anchor="end">' + yv.toFixed(1) + '</text>';
  }
  var step = Math.max(1, Math.floor(n / 5));
  data.forEach(function(m, i) {
    if (i % step === 0 || i === n - 1) {
      var d = m.measurementDate ? m.measurementDate.slice(5) : '';
      xLbls += '<text x="' + px(i).toFixed(1) + '" y="' + (H - 8) + '" fill="var(--txt-3)" font-size="10" text-anchor="middle">' + escHTML(d) + '</text>';
    }
  });

  // Hit-area circles for tooltip (rendered invisibly over data points)
  var hitCircles = data.map(function(m, i) {
    return '<circle class="wc-dot" cx="' + px(i).toFixed(1) + '" cy="' + py(m.flowRate).toFixed(1) + '" r="12" fill="transparent"' +
      ' data-date="' + escHTML(m.measurementDate || '') + '" data-flow="' + m.flowRate + '"' +
      ' data-worker="' + escHTML(m.worker || '') + '"/>';
  }).join('');

  // Visible dots
  var dots = data.map(function(m, i) {
    return '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(m.flowRate).toFixed(1) + '" r="4" fill="#f9ab00" stroke="var(--card-bg,#1e2530)" stroke-width="1.5" pointer-events="none"/>';
  }).join('');

  var svgContent =
    '<defs>' +
      '<linearGradient id="wg-fill" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="#f9ab00" stop-opacity=".3"/>' +
        '<stop offset="100%" stop-color="#f9ab00" stop-opacity=".03"/>' +
      '</linearGradient>' +
    '</defs>' +
    grid + yLbls +
    '<path d="' + areaPath + '" fill="url(#wg-fill)"/>' +
    '<path d="' + linePath + '" fill="none" stroke="#f9ab00" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
    dots +
    hitCircles +
    xLbls +
    '<text x="' + (pad.l - 30) + '" y="' + (pad.t + cH / 2) + '" fill="var(--txt-3)" font-size="10" text-anchor="middle"' +
      ' transform="rotate(-90,' + (pad.l - 30) + ',' + (pad.t + cH / 2) + ')">м³/ч</text>';

  container.innerHTML =
    '<div style="position:relative">' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-height:180px" xmlns="http://www.w3.org/2000/svg">' +
        svgContent +
      '</svg>' +
      '<div id="wells-chart-tip" style="position:absolute;pointer-events:none;display:none;' +
        'background:rgba(20,25,35,.95);color:var(--txt-1);font-size:12px;padding:6px 10px;' +
        'border-radius:7px;white-space:nowrap;z-index:20;border:1px solid rgba(249,171,0,.4);box-shadow:0 2px 8px rgba(0,0,0,.5)">' +
      '</div>' +
    '</div>';

  // Tooltip events
  var tip = container.querySelector('#wells-chart-tip');
  var svgEl = container.querySelector('svg');

  container.querySelectorAll('.wc-dot').forEach(function(dot) {
    dot.addEventListener('mouseenter', function(e) {
      var date   = dot.dataset.date   ? formatDate(dot.dataset.date) : '—';
      var flow   = dot.dataset.flow;
      var worker = dot.dataset.worker ? '<br><span style="color:var(--txt-3)">' + escHTML(dot.dataset.worker) + '</span>' : '';
      tip.innerHTML = '<b>' + date + '</b><br>' + flow + ' м³/ч' + worker;
      tip.style.display = '';
    });
    dot.addEventListener('mousemove', function(e) {
      var rect = container.querySelector('div').getBoundingClientRect();
      var tx = e.clientX - rect.left + 10;
      var ty = e.clientY - rect.top  - 38;
      if (tx + 160 > rect.width) tx = e.clientX - rect.left - 160;
      tip.style.left = tx + 'px';
      tip.style.top  = ty + 'px';
    });
    dot.addEventListener('mouseleave', function() {
      tip.style.display = 'none';
    });
  });
}

// ── Таблица замеров ───────────────────────────────────────

function renderMeasurementsTable(well) {
  var wrap = document.getElementById('wells-meas-table');
  if (!wrap) return;
  if (!well) {
    wrap.innerHTML = '<p class="form-hint">Скважина не выбрана</p>';
    return;
  }

  var meas = WellsState.measurements[well.id];
  if (!meas) {
    wrap.innerHTML = '<p class="form-hint">Загрузка...</p>';
    Api.getWellMeasurements(well.id).then(function(list) {
      WellsState.measurements[well.id] = list;
      if (WellsState.selectedId === well.id) renderMeasurementsTable(well);
    });
    return;
  }

  if (!meas.length) {
    wrap.innerHTML = '<p class="form-hint">Замеры не добавлены</p>';
    return;
  }

  var isAdmin = AppState.currentUser && AppState.currentUser.role === 'admin';
  var sorted  = meas.slice().sort(function(a, b) {
    return (b.measurementDate || '') > (a.measurementDate || '') ? 1 : -1;
  });

  var html = '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
    '<thead><tr style="border-bottom:1px solid var(--line)">' +
      '<th style="text-align:left;padding:5px 8px;color:var(--txt-3);font-weight:500">Дата</th>' +
      '<th style="text-align:right;padding:5px 8px;color:var(--txt-3);font-weight:500">Дебит</th>' +
      '<th style="text-align:left;padding:5px 8px;color:var(--txt-3);font-weight:500">Сотрудник</th>' +
      (isAdmin ? '<th style="padding:5px 8px"></th>' : '') +
    '</tr></thead><tbody>';

  sorted.forEach(function(m) {
    html += '<tr style="border-bottom:1px solid rgba(255,255,255,.04)">' +
      '<td style="padding:5px 8px">' + (m.measurementDate ? formatDate(m.measurementDate) : '—') + '</td>' +
      '<td style="padding:5px 8px;text-align:right;font-weight:500">' + (m.flowRate != null ? m.flowRate + ' м³/ч' : '—') + '</td>' +
      '<td style="padding:5px 8px;color:var(--txt-2)">' + escHTML(m.worker || '—') + '</td>' +
      (isAdmin ? '<td style="padding:5px 8px;white-space:nowrap">' +
        '<button class="meas-edit-btn btn btn-sm btn-outline" data-meas-id="' + escHTML(m.id) + '" style="padding:1px 6px;font-size:11px">✏</button> ' +
        '<button class="meas-del-btn btn btn-sm btn-danger" data-meas-id="' + escHTML(m.id) + '" style="padding:1px 6px;font-size:11px">✕</button>' +
      '</td>' : '') +
    '</tr>';
  });

  html += '</tbody></table>';
  wrap.innerHTML = html;

  if (isAdmin) {
    wrap.querySelectorAll('.meas-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var m = meas.find(function(x) { return x.id === btn.dataset.measId; });
        if (m) openEditMeasurementForm(m);
      });
    });
    wrap.querySelectorAll('.meas-del-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        deleteMeasurementConfirm(btn.dataset.measId, well.id);
      });
    });
  }
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
        '<div class="form-group" style="margin:0"><label class="form-label">Широта WGS-84 (авто)</label>' +
          '<input id="wells-f-lat" type="text" class="form-control" readonly placeholder="из X/Y" style="width:100%;box-sizing:border-box;opacity:.7" value="' + (w.lat != null ? w.lat : '') + '"></div>',
        '<div class="form-group" style="margin:0"><label class="form-label">Долгота WGS-84 (авто)</label>' +
          '<input id="wells-f-lon" type="text" class="form-control" readonly placeholder="из X/Y" style="width:100%;box-sizing:border-box;opacity:.7" value="' + (w.lon != null ? w.lon : '') + '"></div>',
      '</div>',

      '<p id="wells-modal-err" style="color:var(--red,#ea4335);font-size:13px;margin-bottom:10px;display:none"></p>',
      '<button id="wells-modal-save" class="btn btn-primary btn-full">' + (well ? 'Сохранить изменения' : 'Добавить скважину') + '</button>',
    '</div>',
  ].join('');

  document.body.appendChild(modal);

  document.getElementById('wells-modal-close').addEventListener('click', closeWellModal);
  modal.addEventListener('click', function(e) { if (e.target === modal) closeWellModal(); });

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
      (readOnly ? ' readonly' : '') + (type === 'number' ? ' step="any"' : '') +
    ' style="width:100%;box-sizing:border-box"></div>';
}

function _wfCheck(label, id, checked) {
  return '<div class="form-group" style="margin:0;display:flex;align-items:center;gap:8px;padding-top:20px">' +
    '<input id="' + id + '" type="checkbox"' + (checked ? ' checked' : '') + ' style="width:16px;height:16px;cursor:pointer">' +
    '<label for="' + id + '" class="form-label" style="margin:0;cursor:pointer">' + escHTML(label) + '</label></div>';
}

function _updateWellLatLon() {
  var x = parseFloat(document.getElementById('wells-f-x').value);
  var y = parseFloat(document.getElementById('wells-f-y').value);
  var latEl = document.getElementById('wells-f-lat');
  var lonEl = document.getElementById('wells-f-lon');
  if (!latEl || !lonEl) return;
  if (isNaN(x) || isNaN(y)) { latEl.value = ''; lonEl.value = ''; return; }
  var wgs = MapModule.xyToWgs84(x, y);
  latEl.value = wgs.lat;
  lonEl.value = wgs.lon;
}

function saveWell() {
  var name = (document.getElementById('wells-f-name').value || '').trim();
  var errEl = document.getElementById('wells-modal-err');
  var saveBtn = document.getElementById('wells-modal-save');
  if (!name) { errEl.textContent = 'Название обязательно'; errEl.style.display = ''; return; }
  errEl.style.display = 'none';
  saveBtn.disabled = true;
  saveBtn.textContent = 'Сохранение...';

  function num(id) { var v = parseFloat(document.getElementById(id).value); return isNaN(v) ? null : v; }

  var xLocal = num('wells-f-x'), yLocal = num('wells-f-y');
  var lat = null, lon = null;
  if (xLocal != null && yLocal != null) {
    var wgs = MapModule.xyToWgs84(xLocal, yLocal);
    lat = wgs.lat; lon = wgs.lon;
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
    xLocal: xLocal, yLocal: yLocal, zLocal: num('wells-f-z'), lat: lat, lon: lon,
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
    errEl.textContent = err.message; errEl.style.display = '';
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
  }).catch(function(err) { Toast.show('Ошибка: ' + err.message, 'error'); });
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
        '<span style="font-size:15px;font-weight:600">Замер — ' + escHTML(well.name || '') + '</span>',
        '<button id="wells-meas-close" style="background:none;border:none;color:var(--txt-2);font-size:22px;cursor:pointer">✕</button>',
      '</div>',
      '<div class="form-group" style="margin-bottom:12px"><label class="form-label">Дата замера</label>' +
        '<input id="wells-mf-date" type="date" class="form-control" value="' + (m.measurementDate || todayISO()) + '" style="width:100%;box-sizing:border-box"></div>',
      '<div class="form-group" style="margin-bottom:12px"><label class="form-label">Дебит, м³/ч</label>' +
        '<input id="wells-mf-flow" type="number" step="any" class="form-control" value="' + (m.flowRate != null ? m.flowRate : '') + '" style="width:100%;box-sizing:border-box"></div>',
      '<div class="form-group" style="margin-bottom:12px"><label class="form-label">Сотрудник</label>' +
        '<select id="wells-mf-worker" class="form-control" style="width:100%;box-sizing:border-box">' + workerOptions + '</select></div>',
      '<div class="form-group" style="margin-bottom:16px"><label class="form-label">Комментарий</label>' +
        '<textarea id="wells-mf-comment" class="form-control" rows="2" style="width:100%;box-sizing:border-box;resize:vertical">' + escHTML(m.comment || '') + '</textarea></div>',
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

  if (!date || isNaN(flowRate)) { errEl.textContent = 'Укажите дату и дебит'; errEl.style.display = ''; return; }
  errEl.style.display = 'none';
  saveBtn.disabled = true; saveBtn.textContent = 'Сохранение...';

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
        var well = WellsState.list.find(function(w) { return w.id === meas.wellId; });
        _drawWellChart(document.getElementById('wells-chart-body'), list);
        renderMeasurementsTable(well);
        renderWellInfoCard(well);
      });
    }
  }).catch(function(err) {
    errEl.textContent = err.message; errEl.style.display = '';
    saveBtn.disabled = false;
    saveBtn.textContent = WellsState.editingMeas ? 'Сохранить' : 'Добавить замер';
  });
}

function deleteMeasurementConfirm(id, wellId) {
  if (!confirm('Удалить замер?')) return;
  Api.deleteMeasurement(id).then(function() {
    Toast.show('Замер удалён', 'success');
    delete WellsState.measurements[wellId];
    var well = WellsState.list.find(function(w) { return w.id === wellId; });
    return Api.getWellMeasurements(wellId).then(function(list) {
      WellsState.measurements[wellId] = list;
      _drawWellChart(document.getElementById('wells-chart-body'), list);
      renderMeasurementsTable(well);
      renderWellInfoCard(well);
    });
  }).catch(function(err) { Toast.show('Ошибка: ' + err.message, 'error'); });
}

function closeMeasurementModal() {
  var m = document.getElementById('wells-meas-modal');
  if (m) m.remove();
}

function _getLastMeasurement(wellId) {
  var meas = WellsState.measurements[wellId];
  if (!meas || !meas.length) return null;
  var sorted = meas.slice().sort(function(a, b) {
    return (b.measurementDate || '') > (a.measurementDate || '') ? 1 : -1;
  });
  return sorted[0].flowRate != null ? sorted[0] : null;
}
