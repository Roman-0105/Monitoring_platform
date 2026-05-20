// ── Горизонтальные скважины ───────────────────────────────

var WellsState = {
  list:         [],
  measurements: {},
  selectedId:   null,
  editingWell:  null,
  editingMeas:  null,
  measWellId:   null,
  subTab:       'view',
};

var _wellsTabInited = false;
var _wellsChartZoom = { xScale: 1, yScale: 1 };

var WELL_SECTION_OPTIONS = [
  '', 'Восточный', 'Западный', 'Северный',
  'Северо-восточный', 'Северо-западный',
  'Южный', 'Юго-восточный', 'Юго-западный',
];

var WELL_STATUS_OPTIONS = ['Активная', 'Иссякает', 'Сухая'];

var WELL_STATUS_COLORS = {
  'Активная': '#4caf7d',
  'Иссякает': '#f9ab00',
  'Сухая':    '#ea4335',
};

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
    _switchWellsSubTab(WellsState.subTab);
    return;
  }
  _wellsTabInited = true;

  // Подвкладки
  document.querySelectorAll('[data-wells-tab]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      _switchWellsSubTab(this.dataset.wellsTab);
    });
  });

  // Кнопка + замер
  var addMeasBtn = document.getElementById('btn-add-meas');
  if (addMeasBtn) {
    addMeasBtn.addEventListener('click', function() {
      if (!WellsState.selectedId) { Toast.show('Выберите скважину', 'warning'); return; }
      openAddMeasurementForm(WellsState.selectedId);
    });
  }

  if (!WellsState.selectedId && WellsState.list.length) {
    WellsState.selectedId = WellsState.list[0].id;
  }

  _switchWellsSubTab('view');
}

function _switchWellsSubTab(name) {
  WellsState.subTab = name;
  document.querySelectorAll('[data-wells-tab]').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.wellsTab === name);
  });
  var panels = { view: 'wells-panel-view', registry: 'wells-panel-registry' };
  Object.keys(panels).forEach(function(k) {
    var el = document.getElementById(panels[k]);
    if (el) el.style.display = k === name ? '' : 'none';
  });
  if (name === 'view') {
    renderWellsPage();
  } else if (name === 'registry') {
    renderWellsRegistryPanel();
  }
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
  renderWellMapCard();
  renderWellChartCard(well);
  renderMeasurementsTable(well);
}

// ── Реестр: список для выбора (правая колонка) ────────────

function renderWellRegistryList() {
  var wrap = document.getElementById('wells-registry-list');
  if (!wrap) return;

  if (!WellsState.list.length) {
    wrap.innerHTML = '<p class="form-hint" style="font-size:12px">Скважины не добавлены.<br>Перейдите во вкладку «Реестр».</p>';
    return;
  }

  var html = '';
  WellsState.list.forEach(function(w) {
    var isSelected = w.id === WellsState.selectedId;
    var statusColor = WELL_STATUS_COLORS[w.status] || 'var(--txt-3)';
    html += '<div class="well-list-item" data-well-id="' + escHTML(w.id) + '" style="' +
      'padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;' +
      'border:1px solid ' + (isSelected ? '#f9ab00' : 'rgba(255,255,255,.07)') + ';' +
      'background:' + (isSelected ? 'rgba(249,171,0,.1)' : 'rgba(255,255,255,.02)') + '">' +
      '<div style="font-size:13px;font-weight:' + (isSelected ? '600' : '400') + ';color:' + (isSelected ? '#f9ab00' : 'var(--txt-1)') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        escHTML(w.name) +
      '</div>' +
      (w.quarry ? '<div style="font-size:11px;color:var(--txt-3);margin-top:1px">' + escHTML(w.quarry) + (w.quarrySection ? ' · ' + escHTML(w.quarrySection) : '') + '</div>' : '') +
      '<div style="display:flex;gap:6px;margin-top:2px;align-items:center">' +
        (w.depth != null ? '<span style="font-size:11px;color:var(--txt-3)">⬇ ' + w.depth + ' м</span>' : '') +
        (w.status ? '<span style="font-size:10px;color:' + statusColor + ';font-weight:500">● ' + escHTML(w.status) + '</span>' : '') +
      '</div>' +
    '</div>';
  });

  wrap.innerHTML = html;

  wrap.querySelectorAll('.well-list-item').forEach(function(item) {
    item.addEventListener('click', function() {
      WellsState.selectedId = this.dataset.wellId;
      renderWellRegistryList();
      renderWellDetail();
    });
  });
}

// ── Реестр: панель управления (подвкладка) ────────────────

function renderWellsRegistryPanel() {
  var wrap = document.getElementById('wells-registry-full-table');
  if (!wrap) return;

  var isAdmin = AppState.currentUser && AppState.currentUser.role === 'admin';
  var addBtn = document.getElementById('btn-add-well');
  if (addBtn) {
    addBtn.style.display = isAdmin ? '' : 'none';
    addBtn.onclick = openAddWellForm;
  }

  if (!WellsState.list.length) {
    wrap.innerHTML = '<p class="form-hint">Скважины не добавлены</p>';
    return;
  }

  var html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr style="border-bottom:1px solid var(--line)">' +
      '<th style="text-align:left;padding:8px 10px;color:var(--txt-3);font-weight:500">Название</th>' +
      '<th style="text-align:left;padding:8px 10px;color:var(--txt-3);font-weight:500">Карьер</th>' +
      '<th style="text-align:left;padding:8px 10px;color:var(--txt-3);font-weight:500">Участок</th>' +
      '<th style="text-align:left;padding:8px 10px;color:var(--txt-3);font-weight:500">Статус</th>' +
      '<th style="text-align:right;padding:8px 10px;color:var(--txt-3);font-weight:500">Глубина</th>' +
      '<th style="text-align:left;padding:8px 10px;color:var(--txt-3);font-weight:500">Дата бурения</th>' +
      '<th style="text-align:right;padding:8px 10px;color:var(--txt-3);font-weight:500">Дебит (посл.)</th>' +
      (isAdmin ? '<th style="padding:8px 10px"></th>' : '') +
    '</tr></thead><tbody>';

  WellsState.list.forEach(function(w) {
    var lastMeas = _getLastMeasurement(w.id);
    var statusColor = WELL_STATUS_COLORS[w.status] || 'var(--txt-3)';
    html += '<tr style="border-bottom:1px solid rgba(255,255,255,.05)">' +
      '<td style="padding:8px 10px;font-weight:500">' + escHTML(w.name) + '</td>' +
      '<td style="padding:8px 10px;color:var(--txt-2)">' + escHTML(w.quarry || '—') + '</td>' +
      '<td style="padding:8px 10px;color:var(--txt-2)">' + escHTML(w.quarrySection || '—') + '</td>' +
      '<td style="padding:8px 10px"><span style="color:' + statusColor + ';font-weight:500">● ' + escHTML(w.status || '—') + '</span></td>' +
      '<td style="padding:8px 10px;text-align:right">' + (w.depth != null ? w.depth + ' м' : '—') + '</td>' +
      '<td style="padding:8px 10px;color:var(--txt-2)">' + (w.drillDate ? formatDate(w.drillDate) : '—') + '</td>' +
      '<td style="padding:8px 10px;text-align:right">' + (lastMeas ? lastMeas.flowRate + ' м³/ч' : '—') + '</td>' +
      (isAdmin ? '<td style="padding:8px 10px;white-space:nowrap">' +
        '<button class="well-edit-btn btn btn-sm btn-outline" data-well-id="' + escHTML(w.id) + '" style="padding:2px 8px;margin-right:4px">✏ Изменить</button>' +
        '<button class="well-del-btn btn btn-sm btn-danger" data-well-id="' + escHTML(w.id) + '" style="padding:2px 8px">Удалить</button>' +
      '</td>' : '') +
    '</tr>';
  });

  html += '</tbody></table></div>';
  wrap.innerHTML = html;

  if (isAdmin) {
    wrap.querySelectorAll('.well-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var well = WellsState.list.find(function(w) { return w.id === btn.dataset.wellId; });
        if (well) openEditWellForm(well);
      });
    });
    wrap.querySelectorAll('.well-del-btn').forEach(function(btn) {
      btn.addEventListener('click', function() { deleteWellConfirm(btn.dataset.wellId); });
    });
  }
}

// ── Карточка паспорта ─────────────────────────────────────

function renderWellInfoCard(well) {
  var body = document.getElementById('wells-info-body');
  if (!body) return;
  if (!well) { body.innerHTML = '<p class="form-hint">Скважина не выбрана</p>'; return; }

  function row(label, value, color) {
    return '<div class="diag-row" style="padding:4px 0">' +
      '<span style="color:var(--txt-3);font-size:12px">' + escHTML(label) + '</span>' +
      '<span style="font-weight:500;font-size:13px;' + (color ? 'color:' + color : '') + '">' +
        (value !== null && value !== undefined && value !== ''
          ? escHTML(String(value)) : '<span style="color:var(--txt-3)">—</span>') +
      '</span></div>';
  }

  var lastMeas = _getLastMeasurement(well.id);
  var statusColor = WELL_STATUS_COLORS[well.status] || '';
  var html = '';
  html += row('Название', well.name);
  html += row('Статус', well.status ? '● ' + well.status : null, statusColor);
  html += row('Карьер', well.quarry);
  html += row('Участок', well.quarrySection);
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
  if (!well) { body.innerHTML = '<p class="form-hint">Скважина не выбрана</p>'; return; }

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

var _wellsMap = {
  schemeUrl:   null,
  imgW:        0,
  imgH:        0,
  scale:       1,  tx: 0,  ty: 0,
  targetScale: 1,  targetTx: 0, targetTy: 0,
  animating:   false,
  zoomReady:   false,
};

function renderWellMapCard() {
  var body = document.getElementById('wells-map-body');
  if (!body) return;

  if (_wellsMap.schemeUrl && _wellsMap.imgW && document.getElementById('wells-map-inner')) {
    _renderWellMapMarkers();
    return;
  }

  body.innerHTML = '<p class="form-hint" style="padding:12px 0">Загрузка схемы...</p>';
  Schemes.getCurrentImage().then(function(url) {
    if (!url) { body.innerHTML = '<p class="form-hint" style="padding:20px 0">Схема не загружена</p>'; return; }
    _wellsMap.schemeUrl  = url;
    _wellsMap.scale      = 1; _wellsMap.tx      = 0; _wellsMap.ty      = 0;
    _wellsMap.targetScale= 1; _wellsMap.targetTx= 0; _wellsMap.targetTy= 0;
    _wellsMap.zoomReady  = false;
    _buildWellMapDOM(body, url);
  });
}

function _buildWellMapDOM(body, url) {
  body.innerHTML = '';

  var inner = document.createElement('div');
  inner.id = 'wells-map-inner';
  inner.style.cssText = 'position:relative;transform-origin:0 0;will-change:transform;line-height:0';

  var img = document.createElement('img');
  img.src = url;
  img.style.cssText = 'width:100%;height:auto;display:block;pointer-events:none;user-select:none;-webkit-user-drag:none;border-radius:4px';
  img.draggable = false;
  img.alt = 'Схема карьера';

  inner.appendChild(img);
  body.appendChild(inner);

  function onImgReady() {
    _wellsMap.imgW = img.offsetWidth  || img.naturalWidth  || 400;
    _wellsMap.imgH = img.offsetHeight || img.naturalHeight || 300;
    _renderWellMapMarkers();
    if (!_wellsMap.zoomReady) { _wellsMap.zoomReady = true; _setupWellMapZoom(body, inner); }
  }

  if (img.complete && img.naturalWidth) { onImgReady(); }
  else { img.onload = onImgReady; }
}

function _renderWellMapMarkers() {
  var inner = document.getElementById('wells-map-inner');
  if (!inner || !_wellsMap.imgW) return;

  inner.querySelectorAll('.wm-marker,.wm-label').forEach(function(el) { el.remove(); });

  WellsState.list.forEach(function(w) {
    if (w.xLocal == null || w.yLocal == null) return;

    var fracX = (w.xLocal - WELL_BOUNDS.Xmin) / (WELL_BOUNDS.Xmax - WELL_BOUNDS.Xmin);
    var fracY = (WELL_BOUNDS.Ymax - w.yLocal)  / (WELL_BOUNDS.Ymax - WELL_BOUNDS.Ymin);
    var left  = fracX * _wellsMap.imgW;
    var top   = fracY * _wellsMap.imgH;

    var isSel   = w.id === WellsState.selectedId;
    var color   = isSel ? (WELL_STATUS_COLORS[w.status] || '#9aa0a6') : '#8a9099';
    var opacity = isSel ? 1 : 0.52;
    var r       = isSel ? 10 : 7;
    var svgSz   = r * 2 + 12;
    var half    = svgSz / 2;

    var wrap = document.createElement('div');
    wrap.className = 'wm-marker';
    wrap.dataset.wellId = w.id;
    wrap.style.cssText =
      'position:absolute;left:' + left.toFixed(1) + 'px;top:' + top.toFixed(1) + 'px;' +
      'transform:translate(-50%,-50%);cursor:pointer;z-index:' + (isSel ? 10 : 5) +
      ';opacity:' + opacity;
    wrap.title = w.name + (w.status ? ' — ' + w.status : '');

    wrap.innerHTML =
      '<svg width="' + svgSz + '" height="' + svgSz + '" viewBox="' + (-half) + ' ' + (-half) + ' ' + svgSz + ' ' + svgSz + '" ' +
        'xmlns="http://www.w3.org/2000/svg" style="overflow:visible;display:block">' +
        (isSel ? '<circle cx="0" cy="0" r="' + (r + 5) + '" fill="' + color + '" opacity=".22"/>' : '') +
        '<circle cx="0" cy="0" r="' + r + '" fill="' + color + '" stroke="rgba(0,0,0,.65)" stroke-width="1.5"/>' +
        '<circle cx="0" cy="0" r="3" fill="rgba(0,0,0,.7)"/>' +
      '</svg>';

    wrap.addEventListener('click', function(e) {
      e.stopPropagation();
      WellsState.selectedId = w.id;
      renderWellRegistryList();
      renderWellDetail();
    });

    inner.appendChild(wrap);

    if (isSel) {
      var lbl = document.createElement('div');
      lbl.className = 'wm-label';
      lbl.textContent = w.name;
      lbl.style.cssText =
        'position:absolute;left:' + left.toFixed(1) + 'px;top:' + (top + r + 5).toFixed(1) + 'px;' +
        'transform:translateX(-50%);background:rgba(0,0,0,.82);color:' + color + ';' +
        'font-size:11px;font-weight:600;padding:2px 6px;border-radius:3px;white-space:nowrap;pointer-events:none;z-index:11';
      inner.appendChild(lbl);
    }
  });
}

function _setupWellMapZoom(body, inner) {
  var z = _wellsMap;

  function applyTransform() {
    inner.style.transform =
      'translate(' + z.tx.toFixed(2) + 'px,' + z.ty.toFixed(2) + 'px) scale(' + z.scale.toFixed(5) + ')';
  }

  function clamp(val, lo, hi) { return val < lo ? lo : val > hi ? hi : val; }

  function clampTx(tx, s) { return clamp(tx, body.offsetWidth  * (1 - s), 0); }
  function clampTy(ty, s) { return clamp(ty, z.imgH             * (1 - s), 0); }

  function tick() {
    if (!z.animating) return;
    var LERP = 0.16;
    z.scale += (z.targetScale - z.scale) * LERP;
    z.tx    += (z.targetTx    - z.tx)    * LERP;
    z.ty    += (z.targetTy    - z.ty)    * LERP;
    applyTransform();
    var done = Math.abs(z.targetScale - z.scale) < 3e-4 &&
               Math.abs(z.targetTx - z.tx) < 0.05 &&
               Math.abs(z.targetTy - z.ty) < 0.05;
    if (done) {
      z.scale = z.targetScale; z.tx = z.targetTx; z.ty = z.targetTy;
      z.animating = false; applyTransform();
    } else {
      requestAnimationFrame(tick);
    }
  }

  function startAnim() { if (!z.animating) { z.animating = true; requestAnimationFrame(tick); } }

  // ── Wheel zoom ────────────────────────────────────────────
  body.addEventListener('wheel', function(e) {
    e.preventDefault();
    var rect = body.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var factor    = e.deltaY > 0 ? 0.84 : 1.19;
    var newScale  = clamp(z.targetScale * factor, 1, 10);
    var sr        = newScale / z.targetScale;
    var newTx     = clampTx(mx - (mx - z.targetTx) * sr, newScale);
    var newTy     = clampTy(my - (my - z.targetTy) * sr, newScale);
    z.targetScale = newScale;
    z.targetTx    = newTx;
    z.targetTy    = newTy;
    startAnim();
  }, { passive: false });

  // ── Drag pan ──────────────────────────────────────────────
  var dragging = false, dsx, dsy, dtx, dty;

  body.addEventListener('mousedown', function(e) {
    if (z.scale <= 1.02) return;
    dragging = true;
    dsx = e.clientX; dsy = e.clientY;
    dtx = z.tx;      dty = z.ty;
    body.style.cursor = 'grabbing';
    e.preventDefault();
  });

  function onMove(e) {
    if (!dragging) return;
    var nx = clampTx(dtx + e.clientX - dsx, z.scale);
    var ny = clampTy(dty + e.clientY - dsy, z.scale);
    z.tx = z.targetTx = nx;
    z.ty = z.targetTy = ny;
    applyTransform();
  }

  function onUp() {
    if (!dragging) return;
    dragging = false;
    body.style.cursor = z.scale > 1.02 ? 'grab' : 'crosshair';
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup',   onUp);

  // ── Double-click reset ────────────────────────────────────
  body.addEventListener('dblclick', function() {
    z.targetScale = 1; z.targetTx = 0; z.targetTy = 0;
    startAnim();
  });
}

// ── График замеров ────────────────────────────────────────

function renderWellChartCard(well) {
  var body = document.getElementById('wells-chart-body');
  if (!body) return;
  if (!well) { body.innerHTML = '<p class="form-hint">Скважина не выбрана</p>'; return; }

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
  if (!pts.length) return '';
  if (pts.length === 1) return 'M' + pts[0].x + ',' + pts[0].y;
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
  data.sort(function(a, b) { return (a.measurementDate || '') > (b.measurementDate || '') ? 1 : -1; });
  if (!data.length) { container.innerHTML = '<p class="form-hint">Нет данных дебита</p>'; return; }

  var xScale = _wellsChartZoom.xScale;
  var yScale = _wellsChartZoom.yScale;

  var PAD = { t: 20, r: 24, b: 42, l: 54 };
  var n = data.length;
  var pointSpacing = Math.round(90 * xScale);
  var dynW = Math.max(700, n * pointSpacing + PAD.l + PAD.r);
  var baseH = 200;
  var W = dynW;
  var cH = Math.round(baseH * yScale);
  var H = cH + PAD.t + PAD.b;
  var cW = W - PAD.l - PAD.r;

  var flows = data.map(function(m) { return m.flowRate; });
  var maxFlow = Math.max.apply(null, flows), minFlow = Math.min.apply(null, flows);
  var range = maxFlow - minFlow || 1;
  var yMax = maxFlow + range * 0.15, yMin = Math.max(0, minFlow - range * 0.15);

  function px(i) { return PAD.l + (n === 1 ? cW / 2 : i / (n - 1) * cW); }
  function py(v)  { return PAD.t + cH - (v - yMin) / (yMax - yMin) * cH; }

  var pts = data.map(function(m, i) { return { x: px(i), y: py(m.flowRate) }; });
  var linePath = _smoothCurve(pts);
  var areaPath = linePath + ' L' + pts[pts.length-1].x.toFixed(1) + ',' + (PAD.t+cH) + ' L' + pts[0].x.toFixed(1) + ',' + (PAD.t+cH) + ' Z';

  var grid = '', yLbls = '', xLbls = '';
  for (var ti = 0; ti <= 5; ti++) {
    var yv = yMin + (yMax - yMin) * ti / 5;
    var yp = py(yv);
    grid  += '<line x1="' + PAD.l + '" y1="' + yp.toFixed(1) + '" x2="' + (PAD.l+cW) + '" y2="' + yp.toFixed(1) + '" stroke="rgba(255,255,255,.07)" stroke-width="1"/>';
    yLbls += '<text x="' + (PAD.l-6) + '" y="' + (yp+4).toFixed(1) + '" fill="var(--txt-3)" font-size="11" text-anchor="end">' + yv.toFixed(1) + '</text>';
  }
  var step = Math.max(1, Math.ceil(n / Math.max(6, Math.floor(cW / 70))));
  data.forEach(function(m, i) {
    if (i % step === 0 || i === n - 1) {
      xLbls += '<text x="' + px(i).toFixed(1) + '" y="' + (H - 8) + '" fill="var(--txt-3)" font-size="11" text-anchor="middle">' +
        escHTML((m.measurementDate || '').slice(5)) + '</text>';
    }
  });

  var vertLines = '';
  data.forEach(function(m, i) {
    if (i % step === 0 || i === n - 1) {
      vertLines += '<line x1="' + px(i).toFixed(1) + '" y1="' + PAD.t + '" x2="' + px(i).toFixed(1) + '" y2="' + (PAD.t+cH) + '" stroke="rgba(255,255,255,.04)" stroke-width="1"/>';
    }
  });

  var dots = data.map(function(m, i) {
    return '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(m.flowRate).toFixed(1) + '" r="5" fill="#f9ab00" stroke="var(--card-bg,#1e2530)" stroke-width="2" style="cursor:pointer"/>';
  }).join('');

  var zoomControls =
    '<div style="display:flex;gap:4px;align-items:center;margin-bottom:8px;flex-wrap:wrap">' +
      '<span style="font-size:11px;color:var(--txt-3);margin-right:2px">Ось X:</span>' +
      '<button class="btn btn-sm btn-outline wc-zoom" data-axis="x" data-dir="-1" style="padding:1px 8px;font-size:13px;line-height:1.4" title="Уменьшить масштаб X">−</button>' +
      '<button class="btn btn-sm btn-outline wc-zoom" data-axis="x" data-dir="1"  style="padding:1px 8px;font-size:13px;line-height:1.4" title="Увеличить масштаб X">+</button>' +
      '<span style="font-size:11px;color:var(--txt-3);margin:0 2px 0 10px">Ось Y:</span>' +
      '<button class="btn btn-sm btn-outline wc-zoom" data-axis="y" data-dir="-1" style="padding:1px 8px;font-size:13px;line-height:1.4" title="Уменьшить масштаб Y">−</button>' +
      '<button class="btn btn-sm btn-outline wc-zoom" data-axis="y" data-dir="1"  style="padding:1px 8px;font-size:13px;line-height:1.4" title="Увеличить масштаб Y">+</button>' +
      '<button class="btn btn-sm btn-outline wc-zoom" data-axis="reset" style="padding:1px 8px;font-size:11px;margin-left:8px" title="Сбросить масштаб">↺ Сброс</button>' +
      '<span style="font-size:11px;color:var(--txt-3);margin-left:10px">X:' + xScale.toFixed(2) + '× Y:' + yScale.toFixed(2) + '×</span>' +
    '</div>';

  container.innerHTML =
    zoomControls +
    '<div style="overflow-x:auto">' +
      '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg" style="display:block;min-width:' + W + 'px">' +
        '<defs><linearGradient id="wg-fill" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#f9ab00" stop-opacity=".25"/>' +
          '<stop offset="100%" stop-color="#f9ab00" stop-opacity=".02"/>' +
        '</linearGradient></defs>' +
        grid + vertLines + yLbls +
        '<path d="' + areaPath + '" fill="url(#wg-fill)"/>' +
        '<path d="' + linePath + '" fill="none" stroke="#f9ab00" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>' +
        dots + xLbls +
        '<text x="' + (PAD.l - 32) + '" y="' + (PAD.t + cH / 2) + '" fill="var(--txt-3)" font-size="11" text-anchor="middle" ' +
          'transform="rotate(-90,' + (PAD.l - 32) + ',' + (PAD.t + cH / 2) + ')">м³/ч</text>' +
      '</svg>' +
    '</div>' +
    '<div id="wells-chart-tip" style="position:fixed;pointer-events:none;display:none;background:rgba(20,25,35,.95);color:#e8eaed;font-size:12px;padding:7px 11px;border-radius:7px;white-space:nowrap;z-index:9999;border:1px solid rgba(249,171,0,.5);box-shadow:0 3px 12px rgba(0,0,0,.6)"></div>';

  // Zoom buttons
  container.querySelectorAll('.wc-zoom').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var axis = btn.dataset.axis;
      var dir  = parseFloat(btn.dataset.dir || '0');
      if (axis === 'reset') {
        _wellsChartZoom.xScale = 1;
        _wellsChartZoom.yScale = 1;
      } else if (axis === 'x') {
        _wellsChartZoom.xScale = Math.max(0.4, Math.min(6, _wellsChartZoom.xScale + dir * 0.25));
      } else if (axis === 'y') {
        _wellsChartZoom.yScale = Math.max(0.4, Math.min(5, _wellsChartZoom.yScale + dir * 0.25));
      }
      _drawWellChart(container, measurements);
    });
  });

  // Tooltip — SVG has fixed pixel coords so e.clientX - rect.left = SVG X directly
  var tip   = container.querySelector('#wells-chart-tip');
  var svgEl = container.querySelector('svg');

  svgEl.addEventListener('mousemove', function(e) {
    var rect   = svgEl.getBoundingClientRect();
    var mouseX = e.clientX - rect.left;

    var closest = -1, minDist = Infinity;
    pts.forEach(function(pt, i) {
      var d = Math.abs(pt.x - mouseX);
      if (d < minDist) { minDist = d; closest = i; }
    });

    if (closest >= 0 && minDist < 36) {
      var m      = data[closest];
      var date   = m.measurementDate ? formatDate(m.measurementDate) : '—';
      var worker = m.worker ? '<br><span style="color:#9aa0a6">' + escHTML(m.worker) + '</span>' : '';
      tip.innerHTML = '<b style="color:#f9ab00">' + date + '</b><br>' + m.flowRate + ' м³/ч' + worker;
      tip.style.display = '';
      var tipW = tip.offsetWidth, tipH = tip.offsetHeight;
      var tx = e.clientX + 14;
      var ty = e.clientY - tipH - 10;
      if (tx + tipW > window.innerWidth - 8) tx = e.clientX - tipW - 14;
      if (ty < 8) ty = e.clientY + 16;
      tip.style.left = tx + 'px';
      tip.style.top  = ty + 'px';
    } else {
      tip.style.display = 'none';
    }
  });

  svgEl.addEventListener('mouseleave', function() { tip.style.display = 'none'; });
}

// ── Таблица замеров ───────────────────────────────────────

function renderMeasurementsTable(well) {
  var wrap = document.getElementById('wells-meas-table');
  if (!wrap) return;
  if (!well) { wrap.innerHTML = '<p class="form-hint">Скважина не выбрана</p>'; return; }

  var meas = WellsState.measurements[well.id];
  if (!meas) {
    wrap.innerHTML = '<p class="form-hint">Загрузка...</p>';
    Api.getWellMeasurements(well.id).then(function(list) {
      WellsState.measurements[well.id] = list;
      if (WellsState.selectedId === well.id) renderMeasurementsTable(well);
    });
    return;
  }

  if (!meas.length) { wrap.innerHTML = '<p class="form-hint">Замеры не добавлены</p>'; return; }

  var isAdmin = AppState.currentUser && AppState.currentUser.role === 'admin';
  var sorted  = meas.slice().sort(function(a, b) { return (b.measurementDate||'') > (a.measurementDate||'') ? 1 : -1; });

  var html = '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
    '<thead><tr style="border-bottom:1px solid var(--line)">' +
      '<th style="text-align:left;padding:5px 8px;color:var(--txt-3);font-weight:500">Дата</th>' +
      '<th style="text-align:right;padding:5px 8px;color:var(--txt-3);font-weight:500">Дебит</th>' +
      '<th style="text-align:left;padding:5px 8px;color:var(--txt-3);font-weight:500">Сотрудник</th>' +
      (isAdmin ? '<th style="padding:5px 4px"></th>' : '') +
    '</tr></thead><tbody>';

  sorted.forEach(function(m) {
    html += '<tr style="border-bottom:1px solid rgba(255,255,255,.04)">' +
      '<td style="padding:5px 8px">' + (m.measurementDate ? formatDate(m.measurementDate) : '—') + '</td>' +
      '<td style="padding:5px 8px;text-align:right;font-weight:500">' + (m.flowRate != null ? m.flowRate + ' м³/ч' : '—') + '</td>' +
      '<td style="padding:5px 8px;color:var(--txt-2)">' + escHTML(m.worker || '—') + '</td>' +
      (isAdmin ? '<td style="padding:5px 4px;white-space:nowrap">' +
        '<button class="meas-edit-btn btn btn-sm btn-outline" data-meas-id="' + escHTML(m.id) + '" style="padding:1px 5px;font-size:11px">✏</button> ' +
        '<button class="meas-del-btn btn btn-sm btn-danger" data-meas-id="' + escHTML(m.id) + '" style="padding:1px 5px;font-size:11px">✕</button>' +
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
      btn.addEventListener('click', function() { deleteMeasurementConfirm(btn.dataset.measId, well.id); });
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

  var sectionOpts = WELL_SECTION_OPTIONS.map(function(o) {
    return '<option value="' + escHTML(o) + '"' + (o === (w.quarrySection||'') ? ' selected' : '') + '>' + (o || '—') + '</option>';
  }).join('');

  var statusOpts = WELL_STATUS_OPTIONS.map(function(o) {
    return '<option value="' + escHTML(o) + '"' + (o === (w.status||'Активная') ? ' selected' : '') + '>' + escHTML(o) + '</option>';
  }).join('');

  modal.innerHTML = [
    '<div style="background:var(--card-bg,#1e2530);border-radius:14px;padding:24px;width:min(640px,95vw);border:1px solid rgba(255,255,255,.08);margin:auto">',
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">',
        '<span style="font-size:16px;font-weight:600">' + escHTML(title) + '</span>',
        '<button id="wells-modal-close" style="background:none;border:none;color:var(--txt-2);font-size:22px;cursor:pointer">✕</button>',
      '</div>',

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">',
        _wf('Название *', 'wells-f-name', 'text', w.name || '', false, 'col-span'),
        _wf('Карьер', 'wells-f-quarry', 'text', w.quarry || ''),
        _wfSel('Участок карьера', 'wells-f-section', sectionOpts),
        _wfSel('Статус', 'wells-f-status', statusOpts),
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

function _wfSel(label, id, options) {
  return '<div class="form-group" style="margin:0">' +
    '<label class="form-label">' + escHTML(label) + '</label>' +
    '<select id="' + id + '" class="form-control" style="width:100%;box-sizing:border-box">' + options + '</select></div>';
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
  saveBtn.disabled = true; saveBtn.textContent = 'Сохранение...';

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
    quarry:         (document.getElementById('wells-f-quarry').value || '').trim(),
    quarrySection:  document.getElementById('wells-f-section').value || '',
    status:         document.getElementById('wells-f-status').value || 'Активная',
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
    if (WellsState.subTab === 'registry') {
      renderWellsRegistryPanel();
    } else {
      renderWellsPage();
    }
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
    if (WellsState.subTab === 'registry') {
      renderWellsRegistryPanel();
    } else {
      renderWellsPage();
    }
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
  var sorted = meas.slice().sort(function(a, b) { return (b.measurementDate||'') > (a.measurementDate||'') ? 1 : -1; });
  return sorted[0].flowRate != null ? sorted[0] : null;
}
