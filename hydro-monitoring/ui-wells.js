// ── Горизонтальные скважины ───────────────────────────────

var WellsState = {
  list:         [],
  measurements: {},
  selectedId:   null,
  editingWell:  null,
  editingMeas:  null,
  measWellId:   null,
  subTab:       'view',
  filterType:   '',
  _fetchingId:  null,
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

  // Сворачиваемые блоки левой колонки
  function _makeCollapsible(btnId, contentId, startCollapsed) {
    var btn     = document.getElementById(btnId);
    var content = document.getElementById(contentId);
    if (!btn || !content) return;
    if (startCollapsed) content.style.display = 'none';
    btn.textContent = startCollapsed ? '+' : '−';
    btn.addEventListener('click', function() {
      var hidden = content.style.display === 'none';
      content.style.display = hidden ? '' : 'none';
      btn.textContent = hidden ? '−' : '+';
    });
  }
  _makeCollapsible('btn-wells-legend-toggle',   'wells-legend-content',   true);
  _makeCollapsible('btn-wells-passport-toggle', 'wells-passport-content', false);
  _makeCollapsible('btn-wells-coords-toggle',   'wells-coords-content',   false);
  _makeCollapsible('btn-wells-list-toggle',     'wells-list-content',     false);

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

  _renderWellFilters();

  if (!WellsState.list.length) {
    wrap.innerHTML = '<p class="form-hint" style="font-size:12px">Скважины не добавлены.<br>Перейдите во вкладку «Реестр».</p>';
    return;
  }

  var filtered = WellsState.list.filter(function(w) {
    if (WellsState.filterType === 'drainage'    && w.wellType !== 'drainage')    return false;
    if (WellsState.filterType === 'piezometric' && w.wellType !== 'piezometric') return false;
    return true;
  });

  var countEl = document.getElementById('wells-list-count');
  if (countEl) {
    var total = WellsState.list.length;
    countEl.textContent = filtered.length < total
      ? filtered.length + ' / ' + total
      : total + ' шт.';
  }

  if (!filtered.length) {
    wrap.innerHTML = '<p class="form-hint" style="font-size:12px">Нет скважин по фильтру</p>';
    return;
  }

  var html = '';
  filtered.forEach(function(w) {
    var isSelected  = w.id === WellsState.selectedId;
    var statusColor = WELL_STATUS_COLORS[w.status] || 'var(--txt-3)';
    var isPiezo     = w.wellType === 'piezometric';
    html += '<div class="well-list-item" data-well-id="' + escHTML(w.id) + '" style="' +
      'padding:8px 10px;border-radius:6px;cursor:pointer;margin-bottom:4px;' +
      'border:1px solid ' + (isSelected ? (isPiezo ? '#7c4dff' : '#f9ab00') : 'rgba(255,255,255,.07)') + ';' +
      'background:' + (isSelected ? (isPiezo ? 'rgba(124,77,255,.1)' : 'rgba(249,171,0,.1)') : 'rgba(255,255,255,.02)') + '">' +
      '<div style="font-size:13px;font-weight:' + (isSelected ? '600' : '400') + ';color:' + (isSelected ? (isPiezo ? '#7c4dff' : '#f9ab00') : 'var(--txt-1)') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        escHTML(w.name) +
        (isPiezo ? '<span style="font-size:9px;background:#7c4dff22;color:#7c4dff;border-radius:3px;padding:1px 4px;margin-left:5px;font-weight:600;vertical-align:middle">VWP</span>' : '') +
      '</div>' +
      (w.quarry ? '<div style="font-size:11px;color:var(--txt-3);margin-top:1px">' + escHTML(w.quarry) + (w.quarrySection ? ' · ' + escHTML(w.quarrySection) : '') + '</div>' : '') +
      '<div style="display:flex;gap:6px;margin-top:2px;align-items:center">' +
        (w.depth != null ? '<span style="font-size:11px;color:var(--txt-3)">⬇ ' + w.depth + ' м</span>' : '') +
        (w.status ? '<span style="font-size:10px;color:' + statusColor + ';font-weight:500">● ' + escHTML(w.status) + '</span>' : '') +
        (isPiezo && w.sensors && w.sensors.length ? '<span style="font-size:10px;color:#7c4dff">◆ ' + w.sensors.length + ' дат.</span>' : '') +
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

function _renderWellFilters() {
  var filterWrap = document.getElementById('wells-filters');
  if (!filterWrap) return;

  var types = [
    { value: '',             label: 'Все' },
    { value: 'drainage',    label: '⬇ Дрен.' },
    { value: 'piezometric', label: '◆ Пьезо' },
  ];

  filterWrap.innerHTML = '<div style="display:flex;gap:4px">' +
    types.map(function(t) {
      var active = WellsState.filterType === t.value;
      return '<button class="btn btn-sm ' + (active ? 'btn-primary' : 'btn-outline') + ' wf-type-btn" ' +
        'data-type="' + t.value + '" style="flex:1;padding:4px 6px;font-size:11px">' + t.label + '</button>';
    }).join('') + '</div>';

  filterWrap.querySelectorAll('.wf-type-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      WellsState.filterType = this.dataset.type;
      renderWellRegistryList();
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

  var n = WellsState.list.length;
  var btnCsv = document.getElementById('btn-wells-export-csv');
  if (btnCsv) {
    btnCsv.textContent = '⬇ CSV' + (n ? ' (' + n + ' скв.)' : '');
    btnCsv.onclick = exportWellsCSV;
    btnCsv.style.display = n ? '' : 'none';
  }
  var btnXls = document.getElementById('btn-wells-export-xlsx');
  if (btnXls) {
    btnXls.textContent = '⬇ Excel' + (n ? ' (' + n + ' скв.)' : '');
    btnXls.onclick = exportWellsXLSX;
    btnXls.style.display = n ? '' : 'none';
  }

  if (!WellsState.list.length) {
    wrap.innerHTML = '<p class="form-hint">Скважины не добавлены</p>';
    return;
  }

  var html = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px">' +
    '<thead><tr style="border-bottom:1px solid var(--line)">' +
      '<th style="text-align:left;padding:8px 10px;color:var(--txt-3);font-weight:500">Название</th>' +
      '<th style="text-align:left;padding:8px 10px;color:var(--txt-3);font-weight:500">Тип</th>' +
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
    var isPiezoRow = w.wellType === 'piezometric';
    html += '<tr style="border-bottom:1px solid rgba(255,255,255,.05)">' +
      '<td style="padding:8px 10px;font-weight:500">' + escHTML(w.name) + '</td>' +
      '<td style="padding:8px 10px">' +
        (isPiezoRow
          ? '<span style="color:#7c4dff;font-weight:500">◆ Пьезо</span>' +
            (w.sensors && w.sensors.length ? '<span style="font-size:11px;color:var(--txt-3);margin-left:4px">(' + w.sensors.length + ' дат.)</span>' : '')
          : '<span style="color:var(--txt-3)">Дренажная</span>') +
      '</td>' +
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
  var isPiezo = well.wellType === 'piezometric';
  var html = '';
  html += row('Название', well.name);
  html += row('Тип', isPiezo ? '◆ Пьезометрическая' : 'Дренажная', isPiezo ? '#7c4dff' : 'var(--txt-3)');
  html += row('Статус', well.status ? '● ' + well.status : null, statusColor);
  html += row('Карьер', well.quarry);
  html += row('Участок', well.quarrySection);
  html += row('Домен', well.domain);
  html += row('Глубина', well.depth != null ? well.depth + ' м' : null);
  html += row('Угол наклона', well.inclination != null ? well.inclination + '° (справочно)' : null);
  html += row('Азимут', well.azimuth != null ? well.azimuth + '°' : null);
  html += row('Диаметр', well.drillDiameter != null ? well.drillDiameter + ' мм' : null);
  html += row('Обсадка', well.casing);
  html += row('Дата бурения', well.drillDate ? formatDate(well.drillDate) : null);
  html += row('Оголовок', well.hasWellhead ? 'Да' : 'Нет');
  html += row('Дебит (бурение)', well.flowAfterDrill != null ? well.flowAfterDrill + ' м³/ч' : null);
  html += row('Дебит (посл.)', lastMeas ? lastMeas.flowRate + ' м³/ч' : null);

  if (isPiezo && well.sensors && well.sensors.length) {
    html += '<div style="border-top:1px solid rgba(255,255,255,.07);margin-top:8px;padding-top:8px">' +
      '<div style="font-size:11px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Датчики VWP (' + well.sensors.length + ' шт.)</div>';
    well.sensors.forEach(function(s) {
      var isConn = s.connectedToLogger;
      var connColor = isConn ? '#4caf7d' : '#9aa0a6';
      html += '<div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">' +
        '<div style="display:flex;justify-content:space-between;align-items:center">' +
          '<span style="font-size:12px;font-weight:500">' + escHTML(s.name || '—') + '</span>' +
          '<span style="font-size:11px;color:' + connColor + ';font-weight:500">' +
            (isConn ? '● Логгер' : '○ Нет связи') +
          '</span>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--txt-3);margin-top:2px">' +
          'Гл.: ' + (s.depth != null ? s.depth + ' м' : '—') +
          (s.serialNumber ? ' · S/N датч.: ' + escHTML(s.serialNumber) : '') +
          (isConn && s.loggerSN ? ' · S/N лог.: ' + escHTML(s.loggerSN) : '') +
        '</div>' +
      '</div>';
    });
    html += '</div>';
  } else if (isPiezo) {
    html += '<div style="border-top:1px solid rgba(255,255,255,.07);margin-top:8px;padding-top:8px;font-size:12px;color:var(--txt-3)">Датчики не добавлены</div>';
  }

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

var _WELL_BOUNDS_FALLBACK = { Xmin: 45850, Xmax: 47350, Ymin: 15800, Ymax: 17350 };
var WELL_BOUNDS = _WELL_BOUNDS_FALLBACK;

function _refreshWellBounds() {
  if (window.AppState && AppState.quarries && AppState.activeQuarry) {
    var q = AppState.quarries.find(function(q) { return q.name === AppState.activeQuarry; });
    if (q && q.xMin != null && q.xMax != null && q.yMin != null && q.yMax != null) {
      WELL_BOUNDS = { Xmin: q.xMin, Xmax: q.xMax, Ymin: q.yMin, Ymax: q.yMax };
      return;
    }
  }
  WELL_BOUNDS = _WELL_BOUNDS_FALLBACK;
}

var _wellsMap = {
  schemeUrl: null,
  imgW: 0, imgH: 0,
  vbX: 0, vbY: 0, vbW: 0, vbH: 0,
  tvbX: 0, tvbY: 0, tvbW: 0, tvbH: 0,
  animating: false, ready: false,
  pdfPage: null, pdfRendering: false, pdfLastScale: 0,
  card: { offX: 85, offY: -120, collapsed: false },
};

function renderWellMapCard() {
  _refreshWellBounds();
  var body = document.getElementById('wells-map-body');
  if (!body) return;

  if (_wellsMap.ready && document.getElementById('wells-map-svg')) {
    _renderWellMapMarkers();
    return;
  }

  body.innerHTML = '<p class="form-hint" style="padding:12px 0">Загрузка схемы...</p>';
  Schemes.getCurrentImage().then(function(url) {
    if (!url) { body.innerHTML = '<p class="form-hint" style="padding:20px 0">Схема не загружена</p>'; return; }
    _wellsMap.schemeUrl   = url;
    _wellsMap.ready       = false;
    _wellsMap.pdfPage     = null;
    _wellsMap.pdfLastScale = 0;
    _buildWellMapDOM(body, url);
  });
}

function _buildWellMapDOM(body, url) {
  body.innerHTML = '';
  var NS = 'http://www.w3.org/2000/svg';

  // SVG fills the card; height set after natural image dimensions are known
  var svg = document.createElementNS(NS, 'svg');
  svg.id = 'wells-map-svg';
  svg.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;cursor:crosshair';

  var bgImg = document.createElementNS(NS, 'image');
  bgImg.id = 'wells-map-bg';
  bgImg.setAttribute('x', '0');  bgImg.setAttribute('y', '0');
  bgImg.setAttribute('preserveAspectRatio', 'none');
  bgImg.setAttribute('href', url);
  bgImg.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);

  var shaftsG = document.createElementNS(NS, 'g');
  shaftsG.id = 'wells-map-shafts';

  var marksG = document.createElementNS(NS, 'g');
  marksG.id = 'wells-map-markers';

  svg.appendChild(bgImg);
  svg.appendChild(shaftsG);  // shafts always below markers
  svg.appendChild(marksG);
  body.appendChild(svg);

  // PDF: render via PDF.js (re-rasterise at current zoom DPI on each zoom step)
  if (/\.pdf(\?|#|$)/i.test(url)) {
    _loadPdfScheme(url, body, svg, bgImg);
    return;
  }

  // Raster image (PNG / JPEG / SVG)
  var tmp = new Image();
  tmp.onload = function() {
    var iw = tmp.naturalWidth  || 1500;
    var ih = tmp.naturalHeight || 1000;
    _wellsMap.imgW = iw;
    _wellsMap.imgH = ih;
    bgImg.setAttribute('width',  iw);
    bgImg.setAttribute('height', ih);

    _wellsMap.vbX  = 0; _wellsMap.vbY  = 0; _wellsMap.vbW  = iw; _wellsMap.vbH  = ih;
    _wellsMap.tvbX = 0; _wellsMap.tvbY = 0; _wellsMap.tvbW = iw; _wellsMap.tvbH = ih;
    _applyViewBox();

    _wellsMap.ready = true;
    _renderWellMapMarkers();
    _setupWellMapZoom(body, svg);
  };
  tmp.src = url;
}

// ── PDF loading & rendering ───────────────────────────────

function _loadPdfScheme(url, body, svg, bgImg) {
  if (!window.pdfjsLib) {
    body.innerHTML = '<p class="form-hint" style="color:var(--red)">PDF.js не загружен</p>';
    return;
  }
  pdfjsLib.getDocument(url).promise.then(function(pdfDoc) {
    return pdfDoc.getPage(1);
  }).then(function(page) {
    _wellsMap.pdfPage = page;
    var vp = page.getViewport({ scale: 1 });
    var iw = vp.width, ih = vp.height;
    _wellsMap.imgW = iw;
    _wellsMap.imgH = ih;

    bgImg.setAttribute('width',  iw);
    bgImg.setAttribute('height', ih);
    svg.setAttribute('height', Math.round((body.offsetWidth || 600) * ih / iw));

    _wellsMap.vbX  = 0; _wellsMap.vbY  = 0; _wellsMap.vbW  = iw; _wellsMap.vbH  = ih;
    _wellsMap.tvbX = 0; _wellsMap.tvbY = 0; _wellsMap.tvbW = iw; _wellsMap.tvbH = ih;
    _applyViewBox();

    // Initial render at display resolution
    var sw = body.offsetWidth || 600;
    var dpr = window.devicePixelRatio || 1;
    return _renderPdfPage(bgImg, sw / iw * dpr);
  }).then(function() {
    _wellsMap.ready = true;
    _renderWellMapMarkers();
    _setupWellMapZoom(body, document.getElementById('wells-map-svg'));
  }).catch(function(err) {
    var body2 = document.getElementById('wells-map-body');
    if (body2) body2.innerHTML = '<p class="form-hint" style="color:var(--red)">Ошибка PDF: ' + escHTML(err.message) + '</p>';
  });
}

function _renderPdfPage(bgImg, scale) {
  var page = _wellsMap.pdfPage;
  if (!page || _wellsMap.pdfRendering) return Promise.resolve();
  _wellsMap.pdfRendering = true;
  var vp      = page.getViewport({ scale: scale });
  var canvas  = document.createElement('canvas');
  canvas.width  = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  return page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise.then(function() {
    _wellsMap.pdfRendering  = false;
    _wellsMap.pdfLastScale  = scale;
    var dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    bgImg.setAttribute('href', dataUrl);
    bgImg.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', dataUrl);
  }).catch(function() { _wellsMap.pdfRendering = false; });
}

function _maybePdfRerender() {
  if (!_wellsMap.pdfPage || _wellsMap.pdfRendering) return;
  var svg   = document.getElementById('wells-map-svg');
  var bgImg = document.getElementById('wells-map-bg');
  if (!svg || !bgImg) return;
  var sw       = svg.getBoundingClientRect().width || 600;
  var dpr      = window.devicePixelRatio || 1;
  var newScale = sw / _wellsMap.vbW * dpr;   // higher zoom → bigger scale → more detail
  var last     = _wellsMap.pdfLastScale;
  // Only re-render if zoom changed by > 15 % (avoids thrashing on tiny adjustments)
  if (last === 0 || Math.abs(newScale - last) / last > 0.15) {
    _renderPdfPage(bgImg, newScale);
  }
}

function _applyViewBox() {
  var svg = document.getElementById('wells-map-svg');
  if (svg) svg.setAttribute('viewBox',
    _wellsMap.vbX.toFixed(1) + ' ' + _wellsMap.vbY.toFixed(1) + ' ' +
    _wellsMap.vbW.toFixed(1) + ' ' + _wellsMap.vbH.toFixed(1));
}

// ── Tooltip helpers ───────────────────────────────────────

var _wmTip = null;
function _getWmTip() {
  if (!_wmTip) {
    _wmTip = document.createElement('div');
    _wmTip.style.cssText = [
      'position:fixed;pointer-events:none;display:none;z-index:9999',
      'max-width:280px;min-width:160px',
      'background:rgba(8,12,22,.96)',
      'border-radius:12px',
      'border:1px solid rgba(255,255,255,.1)',
      'box-shadow:0 12px 40px rgba(0,0,0,.6),0 2px 8px rgba(0,0,0,.4)',
      'backdrop-filter:blur(16px)',
      'overflow:hidden',
      'font-family:Inter,system-ui,sans-serif',
      'transition:opacity 100ms',
    ].join(';');
    document.body.appendChild(_wmTip);
  }
  return _wmTip;
}
function _showWmTip(html, e) {
  var t = _getWmTip();
  t.innerHTML = html;
  t.style.display = '';
  t.style.opacity = '0';
  _moveWmTip(e);
  requestAnimationFrame(function() { t.style.opacity = '1'; });
}
function _moveWmTip(e) {
  var t = _getWmTip();
  if (t.style.display === 'none') return;
  var tx = e.clientX + 16, ty = e.clientY - 8;
  if (tx + t.offsetWidth  > window.innerWidth  - 12) tx = e.clientX - t.offsetWidth  - 12;
  if (ty + t.offsetHeight > window.innerHeight - 12) ty = e.clientY - t.offsetHeight - 8;
  t.style.left = tx + 'px'; t.style.top = ty + 'px';
}
function _hideWmTip() {
  var t = _getWmTip();
  t.style.opacity = '0';
  setTimeout(function() { t.style.display = 'none'; }, 100);
}

function _buildWmTipHtml(w) {
  var isPiezo   = w.wellType === 'piezometric';
  var color     = isPiezo ? '#a78bfa' : (WELL_STATUS_COLORS[w.status] || '#9aa0a6');
  var statusBg  = color + '22';
  var meas      = WellsState.measurements[w.id] || [];
  var lastMeas  = _getLastMeasurement(w.id);
  var connCount = isPiezo && Array.isArray(w.sensors)
    ? w.sensors.filter(function(s) { return s.connectedToLogger; }).length : 0;

  var rows = '';
  if (w.depth    != null) rows += _tipRow('⬇', 'Глубина',   w.depth + ' м');
  if (w.azimuth  != null) rows += _tipRow('🧭', 'Азимут',    w.azimuth + '°');
  if (w.horizon)          rows += _tipRow('⛰', 'Горизонт',  escHTML(w.horizon));
  if (w.section)          rows += _tipRow('📍', 'Борт',      escHTML(w.section));
  if (lastMeas)           rows += _tipRow('💧', 'Дебит',     '<b style="color:' + color + '">' + lastMeas.flowRate + ' м³/ч</b>');
  if (isPiezo && w.sensors && w.sensors.length)
    rows += _tipRow('◆', 'Датчики', w.sensors.length + ' шт. (' + connCount + ' к лог.)');

  var spark = _buildMiniSparkline(meas, color);

  return '<div style="border-left:3px solid ' + color + ';padding:0">' +
    '<div style="padding:10px 14px 8px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid rgba(255,255,255,.07)">' +
      '<div>' +
        '<div style="font-size:14px;font-weight:700;color:#fff;margin-bottom:2px">' + escHTML(w.name) + '</div>' +
        '<div style="font-size:10px;color:#6e7681">' + (isPiezo ? 'Пьезометрическая' : 'Дренажная') + '</div>' +
      '</div>' +
      (w.status ? '<div style="font-size:10px;font-weight:700;color:' + color + ';background:' + statusBg + ';border:1px solid ' + color + '44;border-radius:99px;padding:2px 9px;white-space:nowrap">● ' + escHTML(w.status) + '</div>' : '') +
    '</div>' +
    (rows ? '<div style="padding:8px 14px;display:flex;flex-direction:column;gap:4px">' + rows + '</div>' : '') +
    (spark ? '<div style="padding:2px 14px 10px;border-top:1px solid rgba(255,255,255,.05)">' +
      '<div style="font-size:9px;color:#6e7681;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;margin-top:6px">Дебит (м³/ч)</div>' +
      spark + '</div>' : '') +
  '</div>';
}

function _tipRow(icon, label, value) {
  return '<div style="display:flex;align-items:center;gap:8px;font-size:11px">' +
    '<span style="width:16px;text-align:center;opacity:.6">' + icon + '</span>' +
    '<span style="color:#6e7681;min-width:64px">' + label + '</span>' +
    '<span style="color:#e8eaed">' + value + '</span>' +
  '</div>';
}

function _cardRow(icon, label, value) {
  return '<div style="display:flex;align-items:center;gap:7px;font-size:10px">' +
    '<span style="opacity:.5;font-size:11px">' + icon + '</span>' +
    '<span style="color:#6e7681;min-width:52px">' + label + '</span>' +
    '<span>' + value + '</span>' +
  '</div>';
}

function _buildClusterTipHtml(wells) {
  var names = wells.map(function(w) {
    var c = WELL_STATUS_COLORS[w.status] || '#9aa0a6';
    return '<div style="display:flex;align-items:center;gap:7px;font-size:11px;color:#e8eaed">' +
      '<span style="width:7px;height:7px;border-radius:50%;background:' + c + ';flex-shrink:0;display:inline-block"></span>' +
      escHTML(w.name) +
    '</div>';
  }).join('');
  return '<div style="padding:10px 14px">' +
    '<div style="font-size:12px;font-weight:700;color:#9aa0a6;margin-bottom:8px">Скважин в кластере: ' + wells.length + '</div>' +
    '<div style="display:flex;flex-direction:column;gap:4px">' + names + '</div>' +
    '<div style="font-size:10px;color:#6e7681;margin-top:8px;border-top:1px solid rgba(255,255,255,.06);padding-top:6px">Клик — приблизить</div>' +
  '</div>';
}

// ── Clustering ────────────────────────────────────────────

var _CLUSTER_THRESH = 28; // screen-px distance to group markers

function _clusterWells(svg) {
  var rect = svg.getBoundingClientRect();
  var sw = rect.width || 600, sh = rect.height || 400;
  var z = _wellsMap;

  var items = [];
  WellsState.list.forEach(function(w) {
    if (w.xLocal == null || w.yLocal == null) return;
    var cx = (w.xLocal - WELL_BOUNDS.Xmin) / (WELL_BOUNDS.Xmax - WELL_BOUNDS.Xmin) * z.imgW;
    var cy = (WELL_BOUNDS.Ymax - w.yLocal)  / (WELL_BOUNDS.Ymax - WELL_BOUNDS.Ymin) * z.imgH;
    var sx = (cx - z.vbX) / z.vbW * sw;
    var sy = (cy - z.vbY) / z.vbH * sh;
    items.push({ w: w, cx: cx, cy: cy, sx: sx, sy: sy });
  });

  var used = items.map(function() { return false; });
  var result = [];

  for (var i = 0; i < items.length; i++) {
    if (used[i]) continue;
    var seed = items[i];
    // Selected well is never clustered — always shown individually
    if (seed.w.id === WellsState.selectedId) {
      used[i] = true;
      result.push({ type: 'single', well: seed.w, cx: seed.cx, cy: seed.cy });
      continue;
    }

    var members = [seed];
    used[i] = true;
    for (var j = i + 1; j < items.length; j++) {
      if (used[j] || items[j].w.id === WellsState.selectedId) continue;
      var dx = seed.sx - items[j].sx, dy = seed.sy - items[j].sy;
      if (Math.sqrt(dx * dx + dy * dy) < _CLUSTER_THRESH) {
        members.push(items[j]);
        used[j] = true;
      }
    }

    if (members.length === 1) {
      result.push({ type: 'single', well: seed.w, cx: seed.cx, cy: seed.cy });
    } else {
      var sumCx = 0, sumCy = 0;
      members.forEach(function(m) { sumCx += m.cx; sumCy += m.cy; });
      result.push({ type: 'cluster', wells: members.map(function(m) { return m.w; }),
        cx: sumCx / members.length, cy: sumCy / members.length });
    }
  }
  return result;
}

function _zoomToCluster(cluster) {
  var z = _wellsMap;
  var wells = cluster.wells;
  var cxArr = wells.map(function(w) {
    return (w.xLocal - WELL_BOUNDS.Xmin) / (WELL_BOUNDS.Xmax - WELL_BOUNDS.Xmin) * z.imgW;
  });
  var cyArr = wells.map(function(w) {
    return (WELL_BOUNDS.Ymax - w.yLocal) / (WELL_BOUNDS.Ymax - WELL_BOUNDS.Ymin) * z.imgH;
  });
  var mnX = Math.min.apply(null, cxArr), mxX = Math.max.apply(null, cxArr);
  var mnY = Math.min.apply(null, cyArr), mxY = Math.max.apply(null, cyArr);

  var rangeX = Math.max(mxX - mnX, z.imgW * 0.04);
  var rangeY = Math.max(mxY - mnY, z.imgH * 0.04);
  var pad = Math.max(rangeX, rangeY) * 0.6;

  var svg = document.getElementById('wells-map-svg');
  var r   = svg ? svg.getBoundingClientRect() : { width: 600, height: 400 };
  var asp = (r.width || 600) / (r.height || 400);

  var vbW = rangeX + pad * 2;
  var vbH = rangeY + pad * 2;
  if (vbW / vbH > asp) { vbH = vbW / asp; } else { vbW = vbH * asp; }
  vbW = Math.min(vbW, z.imgW); vbH = Math.min(vbH, z.imgH);

  var cx = (mnX + mxX) / 2, cy = (mnY + mxY) / 2;
  z.tvbX = Math.max(0, Math.min(z.imgW - vbW, cx - vbW / 2));
  z.tvbY = Math.max(0, Math.min(z.imgH - vbH, cy - vbH / 2));
  z.tvbW = vbW; z.tvbH = vbH;
  if (z._startAnim) z._startAnim();
}

function _zoomToWell(w) {
  if (w.xLocal == null || w.yLocal == null) return;
  var z   = _wellsMap;
  var svg = document.getElementById('wells-map-svg');
  if (!svg) return;
  var r   = svg.getBoundingClientRect();
  var asp = (r.width || 600) / (r.height || 400);
  var vbW = z.imgW * 0.14;
  var vbH = vbW / asp;
  var cx  = (w.xLocal - WELL_BOUNDS.Xmin) / (WELL_BOUNDS.Xmax - WELL_BOUNDS.Xmin) * z.imgW;
  var cy  = (WELL_BOUNDS.Ymax - w.yLocal)  / (WELL_BOUNDS.Ymax - WELL_BOUNDS.Ymin) * z.imgH;
  z.tvbX = Math.max(0, Math.min(z.imgW - vbW, cx - vbW / 2));
  z.tvbY = Math.max(0, Math.min(z.imgH - vbH, cy - vbH / 2));
  z.tvbW = vbW; z.tvbH = vbH;
  if (z._startAnim) z._startAnim();
}

// ── Marker rendering ──────────────────────────────────────

function _renderWellShafts(p2s) {
  var shaftsG = document.getElementById('wells-map-shafts');
  if (!shaftsG || !_wellsMap.imgW) return;
  while (shaftsG.firstChild) shaftsG.removeChild(shaftsG.firstChild);

  var NS = 'http://www.w3.org/2000/svg';
  var z  = _wellsMap;
  var scaleX = z.imgW / (WELL_BOUNDS.Xmax - WELL_BOUNDS.Xmin);
  var scaleY = z.imgH / (WELL_BOUNDS.Ymax - WELL_BOUNDS.Ymin);

  WellsState.list.forEach(function(w) {
    if (w.xLocal == null || w.yLocal == null) return;
    if (w.azimuth == null || w.depth == null || w.depth <= 0) return;

    var cx  = (w.xLocal - WELL_BOUNDS.Xmin) / (WELL_BOUNDS.Xmax - WELL_BOUNDS.Xmin) * z.imgW;
    var cy  = (WELL_BOUNDS.Ymax - w.yLocal)  / (WELL_BOUNDS.Ymax - WELL_BOUNDS.Ymin) * z.imgH;
    var color   = WELL_STATUS_COLORS[w.status] || '#9aa0a6';
    var isSel   = w.id === WellsState.selectedId;
    var isPiezo = w.wellType === 'piezometric';
    var azRad   = w.azimuth * Math.PI / 180;
    var reach   = w.depth;
    var eCx     = cx + reach * Math.sin(azRad) * scaleX;
    var eCy     = cy - reach * Math.cos(azRad) * scaleY;
    var shaftColor = isPiezo ? '#7c4dff' : color;

    var line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', cx.toFixed(2));  line.setAttribute('y1', cy.toFixed(2));
    line.setAttribute('x2', eCx.toFixed(2)); line.setAttribute('y2', eCy.toFixed(2));
    line.setAttribute('stroke', shaftColor);
    line.setAttribute('stroke-width', isSel ? '3' : '2');
    if (isPiezo) line.setAttribute('stroke-dasharray', '5,3');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('vector-effect', 'non-scaling-stroke');
    line.setAttribute('pointer-events', 'none');
    line.setAttribute('opacity', isSel ? '1' : '0.7');
    shaftsG.appendChild(line);

    if (isPiezo && Array.isArray(w.sensors) && w.sensors.length) {
      var perpX = Math.cos(azRad);
      var perpY = Math.sin(azRad);
      w.sensors.forEach(function(s) {
        if (s.depth == null || s.depth <= 0 || s.depth > w.depth) return;
        var ratio = s.depth / w.depth;
        var sx = cx + reach * ratio * Math.sin(azRad) * scaleX;
        var sy = cy - reach * ratio * Math.cos(azRad) * scaleY;
        var sColor = s.connectedToLogger ? '#4caf7d' : '#9aa0a6';

        var sDot = document.createElementNS(NS, 'circle');
        sDot.setAttribute('cx', sx.toFixed(2));
        sDot.setAttribute('cy', sy.toFixed(2));
        sDot.setAttribute('r',  (3.5 * p2s).toFixed(2));
        sDot.setAttribute('fill', sColor);
        sDot.setAttribute('stroke', 'rgba(0,0,0,.5)');
        sDot.setAttribute('stroke-width', (0.8 * p2s).toFixed(2));
        sDot.setAttribute('pointer-events', 'none');
        shaftsG.appendChild(sDot);

        var lbl = document.createElementNS(NS, 'text');
        lbl.setAttribute('x', (sx + perpX * 8 * p2s).toFixed(2));
        lbl.setAttribute('y', (sy + perpY * 8 * p2s).toFixed(2));
        lbl.setAttribute('font-size', (8 * p2s).toFixed(2));
        lbl.setAttribute('font-family', 'sans-serif');
        lbl.setAttribute('fill', sColor);
        lbl.setAttribute('stroke', 'rgba(0,0,0,.7)');
        lbl.setAttribute('stroke-width', (1.5 * p2s).toFixed(2));
        lbl.setAttribute('paint-order', 'stroke');
        lbl.setAttribute('pointer-events', 'none');
        lbl.textContent = s.depth + 'м';
        shaftsG.appendChild(lbl);
      });
    }

    var dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', eCx.toFixed(2)); dot.setAttribute('cy', eCy.toFixed(2));
    dot.setAttribute('r',  (4 * p2s).toFixed(2));
    dot.setAttribute('fill', shaftColor);
    dot.setAttribute('stroke', 'rgba(0,0,0,.6)');
    dot.setAttribute('stroke-width', (1 * p2s).toFixed(2));
    dot.setAttribute('pointer-events', 'none');
    shaftsG.appendChild(dot);
  });
}

function _renderWellMapMarkers() {
  var marksG = document.getElementById('wells-map-markers');
  var svg    = document.getElementById('wells-map-svg');
  if (!marksG || !svg || !_wellsMap.imgW) return;

  while (marksG.firstChild) marksG.removeChild(marksG.firstChild);

  var NS   = 'http://www.w3.org/2000/svg';
  var sw   = svg.getBoundingClientRect().width || 600;
  var p2s  = _wellsMap.vbW / sw;

  _renderWellShafts(p2s);

  var clusters = _clusterWells(svg);

  clusters.forEach(function(entry) {
    if (entry.type === 'cluster') {
      _appendClusterMarker(marksG, entry, NS, p2s);
    } else {
      _appendSingleMarker(marksG, entry.well, entry.cx, entry.cy, NS, p2s);
    }
  });

  _refreshDataCard();
}

function _mkC(NS, cx, cy, r2, fill, stroke, sw2, cls) {
  var c = document.createElementNS(NS, 'circle');
  c.setAttribute('cx', cx.toFixed(1)); c.setAttribute('cy', cy.toFixed(1));
  c.setAttribute('r', r2.toFixed(2));
  c.setAttribute('fill', fill);
  if (stroke) { c.setAttribute('stroke', stroke); c.setAttribute('stroke-width', sw2.toFixed(2)); }
  if (cls) c.setAttribute('class', cls);
  return c;
}

function _diamondPoints(cx, cy, r) {
  return cx.toFixed(2)+','+(cy-r).toFixed(2)+' '+(cx+r).toFixed(2)+','+cy.toFixed(2)+' '+cx.toFixed(2)+','+(cy+r).toFixed(2)+' '+(cx-r).toFixed(2)+','+cy.toFixed(2);
}

function _hexPoints(cx, cy, r) {
  var pts = [];
  for (var i = 0; i < 6; i++) {
    var a = (i * 60 - 90) * Math.PI / 180;
    pts.push((cx + r * Math.cos(a)).toFixed(2) + ',' + (cy + r * Math.sin(a)).toFixed(2));
  }
  return pts.join(' ');
}

function _appendSingleMarker(marksG, w, cx, cy, NS, p2s) {
  var isSel   = w.id === WellsState.selectedId;
  var isPiezo = w.wellType === 'piezometric';
  var color   = isPiezo ? '#a78bfa' : (WELL_STATUS_COLORS[w.status] || '#9aa0a6');
  var r       = (isSel ? 14 : 10) * p2s;

  var g = document.createElementNS(NS, 'g');
  g.setAttribute('data-well-id', w.id);
  g.setAttribute('data-sel',     isSel ? '1' : '0');
  g.setAttribute('data-cx',      cx.toFixed(2));
  g.setAttribute('data-cy',      cy.toFixed(2));
  g.setAttribute('data-azimuth', w.azimuth != null ? String(w.azimuth) : '');
  g.setAttribute('data-depth',   w.depth   != null ? String(w.depth)   : '');
  g.setAttribute('data-piezo',   isPiezo ? '1' : '0');
  g.style.cursor = 'pointer';

  // ── Pulse / glow rings (selected) ──
  if (isSel) {
    // Outer glow
    var glowEl = document.createElementNS(NS, 'circle');
    glowEl.setAttribute('cx', cx.toFixed(2)); glowEl.setAttribute('cy', cy.toFixed(2));
    glowEl.setAttribute('r', (r * 2.8).toFixed(2));
    glowEl.setAttribute('fill', color); glowEl.setAttribute('opacity', '.08');
    glowEl.setAttribute('class', 'wm-glow'); glowEl.setAttribute('pointer-events', 'none');
    g.appendChild(glowEl);

    // Animated pulse ring
    var pulseEl = document.createElementNS(NS, 'circle');
    pulseEl.setAttribute('cx', cx.toFixed(2)); pulseEl.setAttribute('cy', cy.toFixed(2));
    pulseEl.setAttribute('r', (r * 1.9).toFixed(2));
    pulseEl.setAttribute('fill', 'none');
    pulseEl.setAttribute('stroke', color); pulseEl.setAttribute('stroke-width', (1.2 * p2s).toFixed(2));
    pulseEl.setAttribute('opacity', '.5');
    pulseEl.setAttribute('class', 'wm-pulse'); pulseEl.setAttribute('pointer-events', 'none');
    var animR = document.createElementNS(NS, 'animate');
    animR.setAttribute('attributeName', 'r');
    animR.setAttribute('values', (r*1.9).toFixed(2)+';'+(r*3.2).toFixed(2)+';'+(r*1.9).toFixed(2));
    animR.setAttribute('dur', '2.5s'); animR.setAttribute('repeatCount', 'indefinite');
    var animO = document.createElementNS(NS, 'animate');
    animO.setAttribute('attributeName', 'opacity');
    animO.setAttribute('values', '.5;0;.5'); animO.setAttribute('dur', '2.5s');
    animO.setAttribute('repeatCount', 'indefinite');
    pulseEl.appendChild(animR); pulseEl.appendChild(animO);
    g.appendChild(pulseEl);

    // Radar sweep
    var radarSweep = document.createElementNS(NS, 'circle');
    radarSweep.setAttribute('cx', cx.toFixed(2)); radarSweep.setAttribute('cy', cy.toFixed(2));
    radarSweep.setAttribute('r', (r * 2.6).toFixed(2));
    radarSweep.setAttribute('fill', 'none');
    radarSweep.setAttribute('stroke', color); radarSweep.setAttribute('stroke-width', (1.5 * p2s).toFixed(2));
    radarSweep.setAttribute('stroke-dasharray', (r * 4).toFixed(2)+','+(r * 14).toFixed(2));
    radarSweep.setAttribute('opacity', '.6');
    radarSweep.setAttribute('class', 'wm-radar-sweep'); radarSweep.setAttribute('pointer-events', 'none');
    var animEl = document.createElementNS(NS, 'animateTransform');
    animEl.setAttribute('attributeName', 'transform'); animEl.setAttribute('type', 'rotate');
    animEl.setAttribute('from', '0 '+cx.toFixed(2)+' '+cy.toFixed(2));
    animEl.setAttribute('to',   '360 '+cx.toFixed(2)+' '+cy.toFixed(2));
    animEl.setAttribute('dur', '5s'); animEl.setAttribute('repeatCount', 'indefinite');
    radarSweep.appendChild(animEl);
    g.appendChild(radarSweep);
  } else {
    // Non-selected: subtle glow on hover (static ring)
    var hoverRing = document.createElementNS(NS, 'circle');
    hoverRing.setAttribute('cx', cx.toFixed(2)); hoverRing.setAttribute('cy', cy.toFixed(2));
    hoverRing.setAttribute('r', (r * 1.6).toFixed(2));
    hoverRing.setAttribute('fill', color); hoverRing.setAttribute('opacity', '.08');
    hoverRing.setAttribute('class', 'wm-hover-ring'); hoverRing.setAttribute('pointer-events', 'none');
    g.appendChild(hoverRing);
  }

  // ── Azimuth ray ──
  if (w.azimuth != null) {
    var azRad    = w.azimuth * Math.PI / 180;
    var adx      = Math.sin(azRad);
    var ady      = -Math.cos(azRad);
    var arrowLen = (w.depth != null ? Math.min(70, Math.max(14, w.depth * 0.28)) : 22) * p2s;
    var ax2 = cx + adx * arrowLen;
    var ay2 = cy + ady * arrowLen;
    var headSz = 5.5 * p2s;
    var pvx = -ady, pvy = adx;

    // Shaft glow (wider, blurred effect via opacity)
    var shaftGlow = document.createElementNS(NS, 'line');
    shaftGlow.setAttribute('x1', cx.toFixed(2)); shaftGlow.setAttribute('y1', cy.toFixed(2));
    shaftGlow.setAttribute('x2', ax2.toFixed(2)); shaftGlow.setAttribute('y2', ay2.toFixed(2));
    shaftGlow.setAttribute('stroke', color); shaftGlow.setAttribute('stroke-width', (6 * p2s).toFixed(2));
    shaftGlow.setAttribute('stroke-linecap', 'round'); shaftGlow.setAttribute('opacity', isSel ? '.15' : '.08');
    shaftGlow.setAttribute('pointer-events', 'none'); shaftGlow.setAttribute('class', 'wm-shaft-glow');
    g.appendChild(shaftGlow);

    var shaft = document.createElementNS(NS, 'line');
    shaft.setAttribute('x1', cx.toFixed(2)); shaft.setAttribute('y1', cy.toFixed(2));
    shaft.setAttribute('x2', ax2.toFixed(2)); shaft.setAttribute('y2', ay2.toFixed(2));
    shaft.setAttribute('stroke', color); shaft.setAttribute('stroke-width', (isSel ? 2.5 : 1.8) * p2s + '');
    shaft.setAttribute('stroke-linecap', 'round'); shaft.setAttribute('pointer-events', 'none');
    shaft.setAttribute('opacity', isSel ? '1' : '0.7');
    shaft.setAttribute('class', 'wm-arrow-shaft');
    g.appendChild(shaft);

    // Depth ticks every 50 m
    if (w.depth != null && w.depth > 50) {
      var numTicks = Math.min(5, Math.floor(w.depth / 50) - 1);
      for (var ti = 1; ti <= numTicks; ti++) {
        var tratio = (ti * 50) / w.depth;
        var tickEl = document.createElementNS(NS, 'circle');
        tickEl.setAttribute('cx', (cx + adx * arrowLen * tratio).toFixed(2));
        tickEl.setAttribute('cy', (cy + ady * arrowLen * tratio).toFixed(2));
        tickEl.setAttribute('r',  (2 * p2s).toFixed(2));
        tickEl.setAttribute('fill', color); tickEl.setAttribute('opacity', '0.6');
        tickEl.setAttribute('pointer-events', 'none'); tickEl.setAttribute('class', 'wm-depth-tick');
        g.appendChild(tickEl);
      }
    }

    // Arrowhead
    var arHead = document.createElementNS(NS, 'polygon');
    arHead.setAttribute('points',
      ax2.toFixed(2)+','+ay2.toFixed(2)+' '+
      (ax2 - adx*headSz + pvx*headSz*0.55).toFixed(2)+','+(ay2 - ady*headSz + pvy*headSz*0.55).toFixed(2)+' '+
      (ax2 - adx*headSz - pvx*headSz*0.55).toFixed(2)+','+(ay2 - ady*headSz - pvy*headSz*0.55).toFixed(2));
    arHead.setAttribute('fill', color); arHead.setAttribute('pointer-events', 'none');
    arHead.setAttribute('class', 'wm-arrow-head');
    g.appendChild(arHead);

    // Depth label (selected only — at ray tip)
    if (isSel && w.depth != null) {
      var depFS   = 9 * p2s;
      var depText = w.depth + ' м';
      var depBgW  = depText.length * depFS * 0.52 + 8 * p2s;
      var depBgH  = depFS * 1.6;
      var depBgX  = ax2 + adx * (8 * p2s) - depBgW / 2;
      var depBgY  = ay2 + ady * (8 * p2s) - depBgH / 2;

      var depBg = document.createElementNS(NS, 'rect');
      depBg.setAttribute('x', depBgX.toFixed(2)); depBg.setAttribute('y', depBgY.toFixed(2));
      depBg.setAttribute('width', depBgW.toFixed(2)); depBg.setAttribute('height', depBgH.toFixed(2));
      depBg.setAttribute('rx', (depBgH / 2).toFixed(2));
      depBg.setAttribute('fill', color); depBg.setAttribute('opacity', '.18');
      depBg.setAttribute('pointer-events', 'none'); depBg.setAttribute('class', 'wm-dep-bg');
      g.appendChild(depBg);

      var depLbl = document.createElementNS(NS, 'text');
      depLbl.setAttribute('x', (ax2 + adx * 8 * p2s).toFixed(2));
      depLbl.setAttribute('y', (ay2 + ady * 8 * p2s + depFS * 0.36).toFixed(2));
      depLbl.setAttribute('text-anchor', 'middle');
      depLbl.setAttribute('font-size', depFS.toFixed(2)); depLbl.setAttribute('font-weight', '700');
      depLbl.setAttribute('font-family', 'Inter,sans-serif');
      depLbl.setAttribute('fill', color);
      depLbl.setAttribute('stroke', 'rgba(0,0,0,.8)'); depLbl.setAttribute('stroke-width', (1.8 * p2s).toFixed(2));
      depLbl.setAttribute('paint-order', 'stroke'); depLbl.setAttribute('pointer-events', 'none');
      depLbl.setAttribute('class', 'wm-depth-lbl');
      depLbl.textContent = depText;
      g.appendChild(depLbl);
    }
  }

  // ── Main shape: circle ──
  // Outer stroke ring
  var ringEl = document.createElementNS(NS, 'circle');
  ringEl.setAttribute('cx', cx.toFixed(2)); ringEl.setAttribute('cy', cy.toFixed(2));
  ringEl.setAttribute('r', (r + 2 * p2s).toFixed(2));
  ringEl.setAttribute('fill', 'none');
  ringEl.setAttribute('stroke', color); ringEl.setAttribute('stroke-width', (1 * p2s).toFixed(2));
  ringEl.setAttribute('opacity', isSel ? '.6' : '.3');
  ringEl.setAttribute('pointer-events', 'none'); ringEl.setAttribute('class', 'wm-ring');
  g.appendChild(ringEl);

  // Circle body
  var circle = document.createElementNS(NS, 'circle');
  circle.setAttribute('cx', cx.toFixed(2)); circle.setAttribute('cy', cy.toFixed(2));
  circle.setAttribute('r', r.toFixed(2));
  circle.setAttribute('fill', color);
  circle.setAttribute('stroke', 'rgba(255,255,255,' + (isSel ? '.9' : '.6') + ')');
  circle.setAttribute('stroke-width', (isSel ? 2.2 : 1.5) * p2s + '');
  circle.setAttribute('class', 'wm-shape');
  // Piezometric: dashed stroke
  if (isPiezo) circle.setAttribute('stroke-dasharray', (3*p2s).toFixed(2)+','+(2*p2s).toFixed(2));
  g.appendChild(circle);

  // Inner dot (center)
  var dotEl = document.createElementNS(NS, 'circle');
  dotEl.setAttribute('cx', cx.toFixed(2)); dotEl.setAttribute('cy', cy.toFixed(2));
  dotEl.setAttribute('r', (r * 0.28).toFixed(2));
  dotEl.setAttribute('fill', 'rgba(0,0,0,.5)'); dotEl.setAttribute('pointer-events', 'none');
  g.appendChild(dotEl);

  // ── Number inside circle ──
  var numMatch = w.name ? w.name.match(/(\d+)/) : null;
  var numLabel = numMatch ? numMatch[1].slice(-2) : (w.name ? w.name.slice(0, 2) : '?');
  var numFS    = Math.min(isSel ? 10 : 8, r * 0.75) * p2s;
  var numEl    = document.createElementNS(NS, 'text');
  numEl.setAttribute('x', cx.toFixed(1));
  numEl.setAttribute('y', (cy + numFS * 0.38).toFixed(1));
  numEl.setAttribute('text-anchor', 'middle');
  numEl.setAttribute('font-size', numFS.toFixed(2)); numEl.setAttribute('font-weight', '800');
  numEl.setAttribute('font-family', 'Inter,sans-serif');
  numEl.setAttribute('fill', '#ffffff'); numEl.setAttribute('pointer-events', 'none');
  numEl.setAttribute('class', 'wm-num');
  numEl.textContent = numLabel;
  g.appendChild(numEl);

  // ── Name label (ALL wells — pill with background) ──
  var nameFS   = (isSel ? 10 : 8.5) * p2s;
  var nameText = w.name || '';
  var pillW    = nameText.length * nameFS * 0.55 + 10 * p2s;
  var pillH    = nameFS * 1.7;
  var pillX    = cx - pillW / 2;
  var pillY    = cy + r + 3 * p2s;

  var pillBg = document.createElementNS(NS, 'rect');
  pillBg.setAttribute('x', pillX.toFixed(2)); pillBg.setAttribute('y', pillY.toFixed(2));
  pillBg.setAttribute('width', pillW.toFixed(2)); pillBg.setAttribute('height', pillH.toFixed(2));
  pillBg.setAttribute('rx', (pillH / 2).toFixed(2));
  pillBg.setAttribute('fill', isSel ? color : 'rgba(8,12,22,.82)');
  pillBg.setAttribute('stroke', color);
  pillBg.setAttribute('stroke-width', (isSel ? 1.2 : 0.8) * p2s + '');
  pillBg.setAttribute('opacity', isSel ? '.9' : '.75');
  pillBg.setAttribute('pointer-events', 'none'); pillBg.setAttribute('class', 'wm-pill-bg');
  g.appendChild(pillBg);

  var lbl = document.createElementNS(NS, 'text');
  lbl.setAttribute('x',             cx.toFixed(1));
  lbl.setAttribute('y',             (pillY + pillH * 0.68).toFixed(1));
  lbl.setAttribute('text-anchor',   'middle');
  lbl.setAttribute('font-size',     nameFS.toFixed(2));
  lbl.setAttribute('font-weight',   isSel ? '700' : '600');
  lbl.setAttribute('font-family',   'Inter,sans-serif');
  lbl.setAttribute('fill',          isSel ? '#fff' : color);
  lbl.setAttribute('pointer-events','none');
  lbl.setAttribute('class', 'wm-label');
  lbl.textContent = nameText;
  g.appendChild(lbl);

  // ── Hit area ──
  g.appendChild(_mkC(NS, cx, cy, r * 2.2, 'transparent', null, 0, 'wm-hit'));

  // ── Tooltip ──
  var tipHtml = _buildWmTipHtml(w);
  g.addEventListener('mouseenter', function(e) { _showWmTip(tipHtml, e); });
  g.addEventListener('mousemove',  function(e) { _moveWmTip(e); });
  g.addEventListener('mouseleave', _hideWmTip);
  g.addEventListener('click', function(e) {
    e.stopPropagation();
    _hideWmTip();
    WellsState.selectedId = w.id;
    _wellsMap.card.hidden = false;
    renderWellRegistryList();
    renderWellDetail();
  });
  g.addEventListener('dblclick', function(e) {
    e.stopPropagation();
    _zoomToWell(w);
  });
  marksG.appendChild(g);
}

function _appendClusterMarker(marksG, cluster, NS, p2s) {
  var cx = cluster.cx, cy = cluster.cy;
  var n  = cluster.wells.length;
  var r  = 13 * p2s;
  var fs = Math.min(13, 8 + n) * p2s;

  var g = document.createElementNS(NS, 'g');
  g.setAttribute('data-cluster', '1');
  g.setAttribute('data-cx', cx.toFixed(2));
  g.setAttribute('data-cy', cy.toFixed(2));
  g.setAttribute('data-n',  String(n));
  g.style.cursor = 'pointer';

  // Glow ring
  g.appendChild(_mkC(NS, cx, cy, r * 1.6, 'rgba(26,115,232,.12)', null, 0, 'wm-cl-glow'));
  // Blue cluster body
  g.appendChild(_mkC(NS, cx, cy, r, '#1a73e8', 'rgba(255,255,255,.2)', 1.5 * p2s, 'wm-cluster-dot'));

  // Count text
  var txt = document.createElementNS(NS, 'text');
  txt.setAttribute('x',              cx.toFixed(1));
  txt.setAttribute('y',              (cy + fs * 0.36).toFixed(1));
  txt.setAttribute('text-anchor',    'middle');
  txt.setAttribute('font-size',      fs.toFixed(2));
  txt.setAttribute('font-weight',    '700');
  txt.setAttribute('font-family',    'sans-serif');
  txt.setAttribute('fill',           '#ffffff');
  txt.setAttribute('pointer-events', 'none');
  txt.setAttribute('class',          'wm-cl-txt');
  txt.textContent = n;
  g.appendChild(txt);

  // Status dots on perimeter (up to 8)
  var dotsN = Math.min(n, 8);
  for (var i = 0; i < dotsN; i++) {
    var ang = (i / dotsN) * 2 * Math.PI - Math.PI / 2;
    var ddx = Math.cos(ang) * (r + 4.5 * p2s);
    var ddy = Math.sin(ang) * (r + 4.5 * p2s);
    var dc  = WELL_STATUS_COLORS[cluster.wells[i].status] || '#9aa0a6';
    g.appendChild(_mkC(NS, cx + ddx, cy + ddy, 3 * p2s, dc, '#0f1420', 1 * p2s, 'wm-cl-sdot'));
  }

  // Hit area
  g.appendChild(_mkC(NS, cx, cy, r * 2, 'transparent', null, 0, 'wm-cl-hit'));

  var tipHtml = _buildClusterTipHtml(cluster.wells);

  g.addEventListener('mouseenter', function(e) { _showWmTip(tipHtml, e); });
  g.addEventListener('mousemove',  function(e) { _moveWmTip(e); });
  g.addEventListener('mouseleave', _hideWmTip);
  g.addEventListener('click', function(e) {
    e.stopPropagation();
    _hideWmTip();
    _zoomToCluster(cluster);
  });
  marksG.appendChild(g);
}

// Updates marker sizes during zoom animation (attribute-only, no DOM rebuild).
function _updateMarkerSizes() {
  var marksG = document.getElementById('wells-map-markers');
  var svg    = document.getElementById('wells-map-svg');
  if (!marksG || !svg) return;
  var sw  = svg.getBoundingClientRect().width || 600;
  var p2s = _wellsMap.vbW / sw;

  marksG.querySelectorAll('g[data-well-id]').forEach(function(g) {
    var isSel   = g.getAttribute('data-sel') === '1';
    var isPiezo = g.getAttribute('data-piezo') === '1';
    var cx      = parseFloat(g.getAttribute('data-cx'));
    var cy      = parseFloat(g.getAttribute('data-cy'));
    var azAttr  = g.getAttribute('data-azimuth');
    var depAttr = g.getAttribute('data-depth');
    var azimuth = azAttr !== '' ? parseFloat(azAttr)  : null;
    var depth   = depAttr !== '' ? parseFloat(depAttr) : null;
    var r = (isSel ? 14 : 10) * p2s;

    // Glow / pulse / radar
    var glowEl  = g.querySelector('.wm-glow');
    var pulseEl = g.querySelector('.wm-pulse');
    var rs      = g.querySelector('.wm-radar-sweep');
    var hring   = g.querySelector('.wm-hover-ring');
    if (glowEl)  { glowEl.setAttribute('cx', cx.toFixed(2)); glowEl.setAttribute('cy', cy.toFixed(2)); glowEl.setAttribute('r', (r * 2.8).toFixed(2)); }
    if (pulseEl) { pulseEl.setAttribute('cx', cx.toFixed(2)); pulseEl.setAttribute('cy', cy.toFixed(2)); }
    if (hring)   { hring.setAttribute('cx', cx.toFixed(2)); hring.setAttribute('cy', cy.toFixed(2)); hring.setAttribute('r', (r * 1.6).toFixed(2)); }
    if (rs) {
      rs.setAttribute('cx', cx.toFixed(2)); rs.setAttribute('cy', cy.toFixed(2));
      rs.setAttribute('r', (r * 2.6).toFixed(2));
      rs.setAttribute('stroke-width', (1.5 * p2s).toFixed(2));
      rs.setAttribute('stroke-dasharray', (r*4).toFixed(2)+','+(r*14).toFixed(2));
      var animEl = rs.querySelector('animateTransform');
      if (animEl) { animEl.setAttribute('from', '0 '+cx.toFixed(2)+' '+cy.toFixed(2)); animEl.setAttribute('to', '360 '+cx.toFixed(2)+' '+cy.toFixed(2)); }
    }

    // Ring + shape (circle)
    var ring  = g.querySelector('.wm-ring');
    var shape = g.querySelector('.wm-shape');
    if (ring)  { ring.setAttribute('cx', cx.toFixed(2)); ring.setAttribute('cy', cy.toFixed(2)); ring.setAttribute('r', (r + 2 * p2s).toFixed(2)); ring.setAttribute('stroke-width', (1 * p2s).toFixed(2)); }
    if (shape) { shape.setAttribute('cx', cx.toFixed(2)); shape.setAttribute('cy', cy.toFixed(2)); shape.setAttribute('r', r.toFixed(2)); shape.setAttribute('stroke-width', (isSel ? 2.2 : 1.5) * p2s + ''); }

    // Number
    var num = g.querySelector('.wm-num');
    if (num) {
      var numFS = Math.min(isSel ? 10 : 8, r * 0.75) * p2s;
      num.setAttribute('x', cx.toFixed(1)); num.setAttribute('y', (cy + numFS * 0.38).toFixed(1));
      num.setAttribute('font-size', numFS.toFixed(2));
    }

    // Name label pill — clamp font size so labels stay readable at any zoom
    var lbl    = g.querySelector('.wm-label');
    var pillBg = g.querySelector('.wm-pill-bg');
    if (lbl) {
      var rawFS   = (isSel ? 10 : 8.5) * p2s;
      var minFS   = isSel ? 9 : 7.5;   // minimum px in SVG units when zoomed out
      var maxFS   = isSel ? 14 : 11;   // cap when zoomed in
      var nameFS  = Math.max(minFS, Math.min(maxFS, rawFS));
      var nameLen = (lbl.textContent || '').length;
      var pillPad = Math.max(6, 10 * p2s);
      var pillW   = nameLen * nameFS * 0.55 + pillPad;
      var pillH   = nameFS * 1.7;
      var pillGap = Math.max(2, 3 * p2s);
      var pillY   = cy + r + pillGap;
      if (pillBg) {
        pillBg.setAttribute('x', (cx - pillW / 2).toFixed(2)); pillBg.setAttribute('y', pillY.toFixed(2));
        pillBg.setAttribute('width', pillW.toFixed(2)); pillBg.setAttribute('height', pillH.toFixed(2));
        pillBg.setAttribute('rx', (pillH / 2).toFixed(2));
        pillBg.setAttribute('stroke-width', Math.max(0.6, (isSel ? 1.2 : 0.8) * p2s) + '');
      }
      lbl.setAttribute('x', cx.toFixed(1)); lbl.setAttribute('y', (pillY + pillH * 0.68).toFixed(1));
      lbl.setAttribute('font-size', nameFS.toFixed(2));
    }

    // Hit area
    var hit = g.querySelector('.wm-hit');
    if (hit) { hit.setAttribute('cx', cx.toFixed(1)); hit.setAttribute('cy', cy.toFixed(1)); hit.setAttribute('r', (r * 2.2).toFixed(2)); }

    // Azimuth shaft
    var shaftGlow = g.querySelector('.wm-shaft-glow');
    var shaft     = g.querySelector('.wm-arrow-shaft');
    var arHead    = g.querySelector('.wm-arrow-head');
    var depLbl    = g.querySelector('.wm-depth-lbl');
    var depBg     = g.querySelector('.wm-dep-bg');
    if (shaft && azimuth != null) {
      var azRad    = azimuth * Math.PI / 180;
      var adx      = Math.sin(azRad);
      var ady      = -Math.cos(azRad);
      var arrowLen = (depth != null ? Math.min(70, Math.max(14, depth * 0.28)) : 22) * p2s;
      var ax2 = cx + adx * arrowLen;
      var ay2 = cy + ady * arrowLen;
      if (shaftGlow) { shaftGlow.setAttribute('x1', cx.toFixed(2)); shaftGlow.setAttribute('y1', cy.toFixed(2)); shaftGlow.setAttribute('x2', ax2.toFixed(2)); shaftGlow.setAttribute('y2', ay2.toFixed(2)); shaftGlow.setAttribute('stroke-width', (6 * p2s).toFixed(2)); }
      shaft.setAttribute('x1', cx.toFixed(2)); shaft.setAttribute('y1', cy.toFixed(2));
      shaft.setAttribute('x2', ax2.toFixed(2)); shaft.setAttribute('y2', ay2.toFixed(2));
      shaft.setAttribute('stroke-width', (isSel ? 2.5 : 1.8) * p2s + '');
      if (arHead) {
        var headSz = 5.5 * p2s;
        var pvx = -ady, pvy = adx;
        arHead.setAttribute('points',
          ax2.toFixed(2)+','+ay2.toFixed(2)+' '+
          (ax2-adx*headSz+pvx*headSz*0.55).toFixed(2)+','+(ay2-ady*headSz+pvy*headSz*0.55).toFixed(2)+' '+
          (ax2-adx*headSz-pvx*headSz*0.55).toFixed(2)+','+(ay2-ady*headSz-pvy*headSz*0.55).toFixed(2));
      }
      if (depLbl) {
        var depFS2 = 9 * p2s;
        depLbl.setAttribute('x', (ax2 + adx * 8 * p2s).toFixed(2));
        depLbl.setAttribute('y', (ay2 + ady * 8 * p2s + depFS2 * 0.36).toFixed(2));
        depLbl.setAttribute('font-size', depFS2.toFixed(2));
        depLbl.setAttribute('stroke-width', (1.8 * p2s).toFixed(2));
      }
      if (depBg) {
        var depFS3 = 9 * p2s;
        var depTxt = depLbl ? depLbl.textContent : '';
        var dBgW = depTxt.length * depFS3 * 0.52 + 8 * p2s;
        var dBgH = depFS3 * 1.6;
        depBg.setAttribute('x', (ax2 + adx * 8 * p2s - dBgW / 2).toFixed(2));
        depBg.setAttribute('y', (ay2 + ady * 8 * p2s - dBgH / 2).toFixed(2));
        depBg.setAttribute('width', dBgW.toFixed(2)); depBg.setAttribute('height', dBgH.toFixed(2));
        depBg.setAttribute('rx', (dBgH / 2).toFixed(2));
      }
    }

    // Depth ticks
    var ticks = g.querySelectorAll('.wm-depth-tick');
    if (ticks.length && azimuth != null && depth != null) {
      var azRad2 = azimuth * Math.PI / 180;
      var adx2   = Math.sin(azRad2); var ady2 = -Math.cos(azRad2);
      var len2   = (Math.min(70, Math.max(14, depth * 0.28))) * p2s;
      ticks.forEach(function(tick, ti) {
        var ratio = ((ti + 1) * 50) / depth;
        if (ratio >= 1) return;
        tick.setAttribute('cx', (cx + adx2 * len2 * ratio).toFixed(2));
        tick.setAttribute('cy', (cy + ady2 * len2 * ratio).toFixed(2));
        tick.setAttribute('r',  (2 * p2s).toFixed(2));
      });
    }
  });

  // Shaft-layer endpoint dots
  var shaftsG = document.getElementById('wells-map-shafts');
  if (shaftsG) {
    shaftsG.querySelectorAll('circle').forEach(function(c) {
      c.setAttribute('r', (4 * p2s).toFixed(2));
      c.setAttribute('stroke-width', (1 * p2s).toFixed(2));
    });
  }

  // Cluster markers
  marksG.querySelectorAll('g[data-cluster]').forEach(function(g) {
    var r  = 13 * p2s;
    var cx = parseFloat(g.getAttribute('data-cx') || 0);
    var cy = parseFloat(g.getAttribute('data-cy') || 0);
    var n  = parseInt(g.getAttribute('data-n') || 1);

    var glow = g.querySelector('.wm-cl-glow');
    var cd   = g.querySelector('.wm-cluster-dot');
    var txt  = g.querySelector('.wm-cl-txt');
    var hit  = g.querySelector('.wm-cl-hit');

    if (glow) glow.setAttribute('r', (r * 1.6).toFixed(2));
    if (cd) {
      cd.setAttribute('r', r.toFixed(2));
      cd.setAttribute('stroke-width', (1.5 * p2s).toFixed(2));
    }
    if (txt) {
      var fs = Math.min(13, 8 + n) * p2s;
      txt.setAttribute('font-size', fs.toFixed(2));
      txt.setAttribute('y', (cy + fs * 0.36).toFixed(1));
    }
    if (hit) hit.setAttribute('r', (r * 2).toFixed(2));

    var sdots = g.querySelectorAll('.wm-cl-sdot');
    var dotsN = sdots.length;
    sdots.forEach(function(dot, i) {
      var ang = (i / dotsN) * 2 * Math.PI - Math.PI / 2;
      dot.setAttribute('cx', (cx + Math.cos(ang) * (r + 4.5 * p2s)).toFixed(2));
      dot.setAttribute('cy', (cy + Math.sin(ang) * (r + 4.5 * p2s)).toFixed(2));
      dot.setAttribute('r',  (3 * p2s).toFixed(2));
      dot.setAttribute('stroke-width', (1 * p2s).toFixed(2));
    });
  });
}

function _setupWellMapZoom(body, svg) {
  var z = _wellsMap;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function clampVB(x, y, w, h) {
    w = clamp(w, z.imgW * 0.05, z.imgW);
    h = clamp(h, z.imgH * 0.05, z.imgH);
    x = clamp(x, 0, z.imgW - w);
    y = clamp(y, 0, z.imgH - h);
    return { x: x, y: y, w: w, h: h };
  }

  function tick() {
    if (!z.animating) return;
    var L = 0.16;
    z.vbX += (z.tvbX - z.vbX) * L;
    z.vbY += (z.tvbY - z.vbY) * L;
    z.vbW += (z.tvbW - z.vbW) * L;
    z.vbH += (z.tvbH - z.vbH) * L;
    _applyViewBox();
    _updateMarkerSizes();
    _updateDataCard();
    var done = Math.abs(z.tvbX - z.vbX) < 0.05 && Math.abs(z.tvbY - z.vbY) < 0.05 &&
               Math.abs(z.tvbW - z.vbW) < 0.05 && Math.abs(z.tvbH - z.vbH) < 0.05;
    if (done) {
      z.vbX = z.tvbX; z.vbY = z.tvbY; z.vbW = z.tvbW; z.vbH = z.tvbH;
      z.animating = false;
      _applyViewBox();
      _renderWellMapMarkers(); // recluster after zoom settles
      _maybePdfRerender();     // re-render PDF at new zoom resolution
    } else { requestAnimationFrame(tick); }
  }

  function startAnim() { if (!z.animating) { z.animating = true; requestAnimationFrame(tick); } }
  z._startAnim = startAnim;

  // Wheel zoom
  svg.addEventListener('wheel', function(e) {
    e.preventDefault();
    var rect   = svg.getBoundingClientRect();
    var mx     = e.clientX - rect.left;
    var my     = e.clientY - rect.top;
    var sw     = rect.width  || 1;
    var sh     = rect.height || 1;
    var svgX   = z.tvbX + mx / sw * z.tvbW;
    var svgY   = z.tvbY + my / sh * z.tvbH;
    var factor = e.deltaY > 0 ? 0.84 : 1.19;
    var newW   = z.tvbW / factor;
    var newH   = z.tvbH / factor;
    var vb     = clampVB(svgX - mx / sw * newW, svgY - my / sh * newH, newW, newH);
    z.tvbX = vb.x; z.tvbY = vb.y; z.tvbW = vb.w; z.tvbH = vb.h;
    startAnim();
  }, { passive: false });

  // Drag pan
  var dragging = false, dsx, dsy, dvbx, dvby;
  svg.addEventListener('mousedown', function(e) {
    if (z.imgW / z.tvbW <= 1.02) return;
    dragging = true;
    dsx = e.clientX; dsy = e.clientY;
    dvbx = z.tvbX; dvby = z.tvbY;
    svg.style.cursor = 'grabbing';
    e.preventDefault();
  });
  var _wmPanMove = function(e) {
    if (!dragging) return;
    var rect  = svg.getBoundingClientRect();
    var dxSvg = -(e.clientX - dsx) / (rect.width  || 1) * z.vbW;
    var dySvg = -(e.clientY - dsy) / (rect.height || 1) * z.vbH;
    var vb = clampVB(dvbx + dxSvg, dvby + dySvg, z.tvbW, z.tvbH);
    z.tvbX = z.vbX = vb.x;
    z.tvbY = z.vbY = vb.y;
    _applyViewBox();
  };
  var _wmPanUp = function() {
    if (!dragging) return;
    dragging = false;
    svg.style.cursor = z.imgW / z.tvbW > 1.02 ? 'grab' : 'crosshair';
  };
  if (z._wmPanMove) document.removeEventListener('mousemove', z._wmPanMove);
  if (z._wmPanUp)   document.removeEventListener('mouseup',   z._wmPanUp);
  z._wmPanMove = _wmPanMove;
  z._wmPanUp   = _wmPanUp;
  document.addEventListener('mousemove', _wmPanMove);
  document.addEventListener('mouseup',   _wmPanUp);

  // Double-click reset
  svg.addEventListener('dblclick', function() {
    z.tvbX = 0; z.tvbY = 0; z.tvbW = z.imgW; z.tvbH = z.imgH;
    startAnim();
  });

  // ── Touch: pinch-to-zoom + single-finger pan ──────────────
  var _touches = {};
  var _pinch0  = null;

  function _touchPt(t) { return { cx: t.clientX, cy: t.clientY }; }
  function _activeTouches() {
    return Object.keys(_touches).map(function(k) { return _touches[k]; });
  }

  svg.addEventListener('touchstart', function(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      _touches[t.identifier] = _touchPt(t);
    }
    var pts = _activeTouches();
    if (pts.length === 2) {
      var dx = pts[1].cx - pts[0].cx;
      var dy = pts[1].cy - pts[0].cy;
      _pinch0 = {
        dist:  Math.sqrt(dx * dx + dy * dy) || 1,
        midCx: (pts[0].cx + pts[1].cx) / 2,
        midCy: (pts[0].cy + pts[1].cy) / 2,
        tvbX: z.tvbX, tvbY: z.tvbY, tvbW: z.tvbW, tvbH: z.tvbH
      };
    } else if (pts.length === 1) {
      _pinch0 = null;
    }
  }, { passive: false });

  svg.addEventListener('touchmove', function(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (_touches[t.identifier]) _touches[t.identifier] = _touchPt(t);
    }
    var pts  = _activeTouches();
    var rect = svg.getBoundingClientRect();
    var sw   = rect.width  || 1;
    var sh   = rect.height || 1;

    if (pts.length === 2 && _pinch0) {
      var dx = pts[1].cx - pts[0].cx;
      var dy = pts[1].cy - pts[0].cy;
      var dist  = Math.sqrt(dx * dx + dy * dy) || 1;
      var scale = _pinch0.dist / dist;
      var midCx = (pts[0].cx + pts[1].cx) / 2;
      var midCy = (pts[0].cy + pts[1].cy) / 2;
      var svgMx = _pinch0.tvbX + (_pinch0.midCx - rect.left) / sw * _pinch0.tvbW;
      var svgMy = _pinch0.tvbY + (_pinch0.midCy - rect.top)  / sh * _pinch0.tvbH;
      var newW  = _pinch0.tvbW * scale;
      var newH  = _pinch0.tvbH * scale;
      var panDx = (midCx - _pinch0.midCx) / sw * newW;
      var panDy = (midCy - _pinch0.midCy) / sh * newH;
      var vb    = clampVB(svgMx - midCx / sw * newW - panDx, svgMy - midCy / sh * newH - panDy, newW, newH);
      z.tvbX = z.vbX = vb.x; z.tvbY = z.vbY = vb.y; z.tvbW = z.vbW = vb.w; z.tvbH = z.vbH = vb.h;
      _applyViewBox();
      _updateMarkerSizes();
    } else if (pts.length === 1) {
      if (z.imgW / z.tvbW <= 1.02) return;
      var pt   = pts[0];
      var prev = _pinch0 && _pinch0.singlePrev;
      if (!prev) { _pinch0 = { singlePrev: pt }; return; }
      var dxSvg = -(pt.cx - prev.cx) / sw * z.vbW;
      var dySvg = -(pt.cy - prev.cy) / sh * z.vbH;
      var vb2   = clampVB(z.tvbX + dxSvg, z.tvbY + dySvg, z.tvbW, z.tvbH);
      z.tvbX = z.vbX = vb2.x; z.tvbY = z.vbY = vb2.y;
      _applyViewBox();
      _pinch0 = { singlePrev: pt };
    }
  }, { passive: false });

  function _touchEnd(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      delete _touches[e.changedTouches[i].identifier];
    }
    var pts = _activeTouches();
    if (pts.length < 2) {
      if (pts.length === 1) _pinch0 = { singlePrev: pts[0] };
      else { _pinch0 = null; startAnim(); }
    }
  }
  svg.addEventListener('touchend',    _touchEnd, { passive: false });
  svg.addEventListener('touchcancel', _touchEnd, { passive: false });
}

// ── Плавающая карточка данных (концепция D) ───────────────

function _svgToBodyCoords(cx, cy) {
  var svg  = document.getElementById('wells-map-svg');
  var body = document.getElementById('wells-map-body');
  if (!svg || !body) return { x: 0, y: 0 };
  var sr = svg.getBoundingClientRect();
  var br = body.getBoundingClientRect();
  var z  = _wellsMap;
  return {
    x: (cx - z.vbX) / z.vbW * sr.width  + (sr.left - br.left),
    y: (cy - z.vbY) / z.vbH * sr.height + (sr.top  - br.top),
  };
}

function _getSelWellInfo() {
  if (!WellsState.selectedId) return null;
  var w = WellsState.list.find(function(w2) { return w2.id === WellsState.selectedId; });
  if (!w || w.xLocal == null || w.yLocal == null) return null;
  var z  = _wellsMap;
  var cx = (w.xLocal - WELL_BOUNDS.Xmin) / (WELL_BOUNDS.Xmax - WELL_BOUNDS.Xmin) * z.imgW;
  var cy = (WELL_BOUNDS.Ymax - w.yLocal)  / (WELL_BOUNDS.Ymax - WELL_BOUNDS.Ymin) * z.imgH;
  return { w: w, cx: cx, cy: cy };
}

function _buildMiniSparkline(meas, color) {
  if (!meas || !meas.length) return '';
  var data = meas.filter(function(m) { return m.flowRate != null; })
    .sort(function(a, b) { return (a.measurementDate||'') > (b.measurementDate||'') ? 1 : -1; })
    .slice(-10);
  if (data.length < 2) return '';
  var flows = data.map(function(m) { return m.flowRate; });
  var minV = Math.min.apply(null, flows), maxV = Math.max.apply(null, flows);
  var range = maxV - minV || 1;
  var W = 148, H = 28, PAD = 2;
  var pts = data.map(function(m, i) {
    var x = PAD + i / (data.length - 1) * (W - PAD * 2);
    var y = PAD + (1 - (m.flowRate - minV) / range) * (H - PAD * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  var pathD = 'M' + pts.join(' L');
  var lp = pts[pts.length - 1].split(',');
  var areaD = pathD + ' L' + lp[0] + ',' + (H-PAD) + ' L' + PAD + ',' + (H-PAD) + ' Z';
  var cid = 'wdc-sg-' + color.replace(/[^a-f0-9]/gi, '');
  return '<svg width="' + W + '" height="' + H + '" style="display:block;margin-bottom:2px">' +
    '<defs><linearGradient id="' + cid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity=".25"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/>' +
    '</linearGradient></defs>' +
    '<path d="' + areaD + '" fill="url(#' + cid + ')"/>' +
    '<path d="' + pathD + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<circle cx="' + lp[0] + '" cy="' + lp[1] + '" r="3" fill="' + color + '"/>' +
  '</svg>';
}

function _refreshDataCard() {
  var body = document.getElementById('wells-map-body');
  if (!body || !_wellsMap.ready) return;

  var card    = document.getElementById('wells-data-card');
  var connSvg = document.getElementById('wells-card-connector');
  var sel     = _getSelWellInfo();

  if (!sel || _wellsMap.card.hidden) {
    if (card)    card.style.display    = 'none';
    if (connSvg) connSvg.style.display = 'none';
    return;
  }

  var w          = sel.w;
  var isPiezo    = w.wellType === 'piezometric';
  var color      = isPiezo ? '#7c4dff' : (WELL_STATUS_COLORS[w.status] || '#9aa0a6');
  var statusColor = WELL_STATUS_COLORS[w.status] || '#9aa0a6';

  if (!card) {
    body.style.position = 'relative';
    card = document.createElement('div');
    card.id = 'wells-data-card';
    card.style.cssText = [
      'position:absolute;z-index:20;min-width:200px;max-width:240px',
      'border-radius:14px;overflow:hidden',
      'backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)',
      'user-select:none',
      'font-family:Inter,system-ui,sans-serif',
      'transition:box-shadow 300ms',
    ].join(';');
    body.appendChild(card);
  }
  if (!connSvg) {
    var tmp = document.createElement('div');
    tmp.innerHTML = '<svg id="wells-card-connector" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:10"><line id="wells-connector-line"/></svg>';
    body.insertBefore(tmp.firstChild, body.firstChild);
    connSvg = document.getElementById('wells-card-connector');
  }

  card.style.display    = '';
  connSvg.style.display = '';
  card.style.background = 'rgba(8,12,22,.94)';
  card.style.border     = '1px solid ' + color + '55';
  card.style.boxShadow  = '0 0 32px ' + color + '28, 0 8px 32px rgba(0,0,0,.7), 0 0 0 1px ' + color + '15';

  var meas      = WellsState.measurements[w.id] || [];
  var spark     = _buildMiniSparkline(meas, color);
  var lastMeas  = _getLastMeasurement(w.id);
  var collapsed = _wellsMap.card.collapsed;

  // ── Header ──
  var html = '<div id="wells-card-hdr" style="' +
    'display:flex;justify-content:space-between;align-items:flex-start;' +
    'padding:11px 13px ' + (collapsed ? '11px' : '9px') + ';' +
    'cursor:move;gap:8px;' +
    'background:linear-gradient(135deg,' + color + '18 0%,transparent 70%);' +
    'border-bottom:1px solid rgba(255,255,255,.06)" >' +
    '<div style="min-width:0">' +
      '<div style="font-size:13px;font-weight:700;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:2px">' + escHTML(w.name) + '</div>' +
      '<div style="font-size:10px;color:#6e7681">' + (isPiezo ? '◆ Пьезометрическая' : '⊛ Дренажная') + '</div>' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">' +
      (w.status ? '<div style="font-size:9px;font-weight:700;color:' + statusColor + ';background:' + statusColor + '20;border:1px solid ' + statusColor + '44;border-radius:99px;padding:2px 7px;white-space:nowrap">● ' + escHTML(w.status) + '</div>' : '') +
      '<div style="display:flex;gap:4px">' +
      '<button id="wells-card-col-btn" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.45);cursor:pointer;border-radius:6px;padding:1px 7px;font-size:11px;line-height:1.6;flex-shrink:0;font-family:inherit">' + (collapsed ? '＋' : '－') + '</button>' +
      '<button id="wells-card-close-btn" title="Скрыть карточку" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.45);cursor:pointer;border-radius:6px;padding:1px 7px;font-size:11px;line-height:1.6;flex-shrink:0;font-family:inherit">✕</button>' +
      '</div>' +
    '</div>' +
  '</div>';

  if (!collapsed) {
    // ── Meta rows ──
    if (w.depth != null || w.azimuth != null || w.horizon || (isPiezo && w.sensors && w.sensors.length)) {
      html += '<div style="padding:8px 13px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid rgba(255,255,255,.06)">';
      if (w.depth    != null) html += _cardRow('⬇', 'Глубина',  '<b style="color:#e8eaed">' + w.depth + ' м</b>');
      if (w.azimuth  != null) html += _cardRow('🧭', 'Азимут',  '<b style="color:#e8eaed">' + w.azimuth + '°</b>');
      if (w.horizon)           html += _cardRow('⛰', 'Гориз.',  '<span style="color:#e8eaed">' + escHTML(w.horizon) + '</span>');
      if (isPiezo && w.sensors && w.sensors.length) html += _cardRow('◆', 'Датчики', '<span style="color:' + color + '">' + w.sensors.length + ' шт.</span>');
      html += '</div>';
    }

    // ── Sparkline ──
    if (spark) {
      html += '<div style="padding:8px 13px 6px">';
      html += '<div style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#6e7681;margin-bottom:5px">Дебит (м³/ч)</div>';
      html += spark;
      if (lastMeas) {
        html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;margin-top:4px">' +
          '<span style="color:#6e7681">' + (lastMeas.measurementDate ? formatDate(lastMeas.measurementDate) : '') + '</span>' +
          '<span style="color:' + color + ';font-weight:700;font-size:12px">' + lastMeas.flowRate + ' м³/ч</span>' +
        '</div>';
      }
      html += '</div>';
    } else if (!isPiezo) {
      html += '<div style="padding:8px 13px;font-size:10px;color:#6e7681;font-style:italic">Замеры отсутствуют</div>';
    }

    // ── Piezometric sensors ──
    if (isPiezo && w.sensors && w.sensors.length) {
      html += '<div style="padding:6px 13px 10px;border-top:1px solid rgba(255,255,255,.06)">';
      html += '<div style="font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:#6e7681;margin-bottom:5px">Датчики VWP</div>';
      w.sensors.forEach(function(s) {
        var sc = s.connectedToLogger ? '#4caf7d' : '#9aa0a6';
        html += '<div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;margin-top:4px">' +
          '<span style="color:' + sc + ';display:flex;align-items:center;gap:4px"><span style="width:6px;height:6px;border-radius:50%;background:' + sc + ';display:inline-block"></span>' + escHTML(s.name || '—') + '</span>' +
          '<span style="color:#6e7681">' + (s.depth != null ? s.depth + ' м' : '') + (s.connectedToLogger ? ' · <span style="color:#4caf7d">лог.</span>' : ' · нет') + '</span>' +
        '</div>';
      });
      html += '</div>';
    }

    // ── Footer hint ──
    html += '<div style="padding:5px 13px 8px;font-size:9px;color:#4a5060;border-top:1px solid rgba(255,255,255,.04)">Тянуть за заголовок · Дбл-клик — приблизить</div>';
  }

  card.innerHTML = html;

  // Drag card header
  var hdr = card.querySelector('#wells-card-hdr');
  if (hdr) {
    var cd = { on: false, sx: 0, sy: 0, ox: 0, oy: 0 };
    hdr.addEventListener('mousedown', function(e) {
      if (e.button !== 0) return;
      cd.on = true; cd.sx = e.clientX; cd.sy = e.clientY;
      cd.ox = _wellsMap.card.offX; cd.oy = _wellsMap.card.offY;
      e.preventDefault(); e.stopPropagation();
    });
    var _cardDragMove = function(e) {
      if (!cd.on) return;
      _wellsMap.card.offX = cd.ox + (e.clientX - cd.sx);
      _wellsMap.card.offY = cd.oy + (e.clientY - cd.sy);
      _updateDataCard();
    };
    var _cardDragUp = function() { cd.on = false; };
    if (_wellsMap._cardDragMove) document.removeEventListener('mousemove', _wellsMap._cardDragMove);
    if (_wellsMap._cardDragUp)   document.removeEventListener('mouseup',   _wellsMap._cardDragUp);
    _wellsMap._cardDragMove = _cardDragMove;
    _wellsMap._cardDragUp   = _cardDragUp;
    document.addEventListener('mousemove', _cardDragMove);
    document.addEventListener('mouseup',   _cardDragUp);
  }

  // Collapse toggle
  var colBtn = card.querySelector('#wells-card-col-btn');
  if (colBtn) {
    colBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      _wellsMap.card.collapsed = !_wellsMap.card.collapsed;
      _refreshDataCard();
    });
  }

  // Close (hide) card
  var closeBtn = card.querySelector('#wells-card-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      _wellsMap.card.hidden = true;
      var c = document.getElementById('wells-data-card');
      var conn = document.getElementById('wells-card-connector');
      if (c) c.style.display = 'none';
      if (conn) conn.style.display = 'none';
    });
  }

  _updateDataCard();
}

function _updateDataCard() {
  var card     = document.getElementById('wells-data-card');
  var connLine = document.getElementById('wells-connector-line');
  if (!card || !connLine) return;

  var sel = _getSelWellInfo();
  if (!sel) { card.style.display = 'none'; return; }

  var sc = _svgToBodyCoords(sel.cx, sel.cy);
  var ox = _wellsMap.card.offX;
  var oy = _wellsMap.card.offY;

  card.style.left = (sc.x + ox) + 'px';
  card.style.top  = (sc.y + oy) + 'px';

  var cw = card.offsetWidth  || 170;
  var ch = card.offsetHeight || 90;
  var anchorX, anchorY;
  if (oy + ch < 0) {
    anchorX = sc.x + ox + cw / 2; anchorY = sc.y + oy + ch;
  } else if (oy > 0) {
    anchorX = sc.x + ox + cw / 2; anchorY = sc.y + oy;
  } else if (ox > 0) {
    anchorX = sc.x + ox; anchorY = sc.y + oy + ch / 2;
  } else {
    anchorX = sc.x + ox + cw; anchorY = sc.y + oy + ch / 2;
  }

  var isPiezo = sel.w.wellType === 'piezometric';
  var color   = isPiezo ? '#7c4dff' : (WELL_STATUS_COLORS[sel.w.status] || '#9aa0a6');
  connLine.setAttribute('x1', anchorX.toFixed(1));
  connLine.setAttribute('y1', anchorY.toFixed(1));
  connLine.setAttribute('x2', sc.x.toFixed(1));
  connLine.setAttribute('y2', sc.y.toFixed(1));
  connLine.setAttribute('stroke', color);
  connLine.setAttribute('stroke-width', '1.5');
  connLine.setAttribute('stroke-dasharray', '5,3');
  connLine.setAttribute('opacity', '.55');
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
  WellsState._fetchingId = well.id;
  Api.getWellMeasurements(well.id).then(function(meas) {
    WellsState._fetchingId = null;
    WellsState.measurements[well.id] = meas;
    if (WellsState.selectedId === well.id) {
      _drawWellChart(body, meas);
      renderMeasurementsTable(well);
      _refreshDataCard();
    }
  }).catch(function(err) {
    WellsState._fetchingId = null;
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
    if (WellsState._fetchingId === well.id) return; // renderWellChartCard already fetching
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

  var isPiezo = w.wellType === 'piezometric';
  var wellTypeOpts =
    '<option value="drainage"'   + (!isPiezo ? ' selected' : '') + '>Дренажная</option>' +
    '<option value="piezometric"' + (isPiezo  ? ' selected' : '') + '>Пьезометрическая (VWP)</option>';

  modal.innerHTML = [
    '<div style="background:var(--card-bg,#1e2530);border-radius:14px;padding:24px;width:min(640px,95vw);border:1px solid rgba(255,255,255,.08);margin:auto">',
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">',
        '<span style="font-size:16px;font-weight:600">' + escHTML(title) + '</span>',
        '<button id="wells-modal-close" style="background:none;border:none;color:var(--txt-2);font-size:22px;cursor:pointer">✕</button>',
      '</div>',

      '<div class="form-group" style="margin-bottom:14px">',
        '<label class="form-label">Тип скважины</label>',
        '<select id="wells-f-type" class="form-control" style="width:100%;box-sizing:border-box">' + wellTypeOpts + '</select>',
      '</div>',

      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">',
        _wf('Название *', 'wells-f-name', 'text', w.name || '', false, 'col-span'),
        _wf('Карьер', 'wells-f-quarry', 'text', w.quarry || ''),
        _wfSel('Участок карьера', 'wells-f-section', sectionOpts),
        _wfSel('Статус', 'wells-f-status', statusOpts),
        _wf('Домен', 'wells-f-domain', 'text', w.domain || ''),
        _wf('Глубина, м', 'wells-f-depth', 'number', w.depth != null ? w.depth : ''),
        _wf('Угол наклона, ° (справочно)', 'wells-f-inclination', 'number', w.inclination != null ? w.inclination : ''),
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

      '<div id="wells-sensors-wrap"' + (!isPiezo ? ' style="display:none"' : '') + '>',
        _buildSensorsBlockHTML(w.sensors),
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
  document.getElementById('wells-f-type').addEventListener('change', function() {
    var wrap = document.getElementById('wells-sensors-wrap');
    if (wrap) wrap.style.display = this.value === 'piezometric' ? '' : 'none';
  });
  document.getElementById('wells-add-sensor').addEventListener('click', function() {
    var list   = document.getElementById('wells-sensors-list');
    var emptyP = document.getElementById('wells-sensors-empty');
    list.insertAdjacentHTML('beforeend', _sensorRowHTML({}));
    if (emptyP) emptyP.style.display = 'none';
  });
  document.getElementById('wells-sensors-list').addEventListener('click', function(e) {
    var btn = e.target.closest('.sensor-del-btn');
    if (!btn) return;
    var row = btn.closest('.wells-sensor-row');
    if (row) row.remove();
    var list   = document.getElementById('wells-sensors-list');
    var emptyP = document.getElementById('wells-sensors-empty');
    if (list && emptyP && !list.querySelector('.wells-sensor-row')) emptyP.style.display = '';
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

function _buildSensorsBlockHTML(sensors) {
  var rows = (sensors || []).map(function(s) { return _sensorRowHTML(s); }).join('');
  var isEmpty = !rows;
  return '<div style="border-top:1px solid rgba(255,255,255,.08);margin-top:14px;padding-top:12px">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<div style="font-size:12px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em">Датчики VWP</div>' +
      '<button type="button" id="wells-add-sensor" class="btn btn-sm btn-outline" style="padding:2px 10px;font-size:12px">+ Добавить датчик</button>' +
    '</div>' +
    '<div id="wells-sensors-list">' + rows + '</div>' +
    '<p id="wells-sensors-empty" style="font-size:12px;color:var(--txt-3);margin:0' + (isEmpty ? '' : ';display:none') + '">Датчики не добавлены. Нажмите «+ Добавить датчик».</p>' +
  '</div>';
}

function _sensorRowHTML(s) {
  return '<div class="wells-sensor-row" style="display:grid;grid-template-columns:1fr 70px 1fr 1fr 28px;gap:6px;margin-bottom:8px;align-items:end">' +
    '<div><label style="font-size:11px;color:var(--txt-3);display:block;margin-bottom:3px">Название датчика</label>' +
      '<input type="text" class="form-control sensor-name" value="' + escHTML((s && s.name) || '') + '" placeholder="HBS-13-VWP-1" style="width:100%;box-sizing:border-box;font-size:12px"></div>' +
    '<div><label style="font-size:11px;color:var(--txt-3);display:block;margin-bottom:3px">Глубина, м</label>' +
      '<input type="number" step="any" class="form-control sensor-depth" value="' + ((s && s.depth != null) ? s.depth : '') + '" style="width:100%;box-sizing:border-box;font-size:12px"></div>' +
    '<div><label style="font-size:11px;color:var(--txt-3);display:block;margin-bottom:3px">S/N датчика</label>' +
      '<input type="text" class="form-control sensor-sn" value="' + escHTML((s && s.serialNumber) || '') + '" style="width:100%;box-sizing:border-box;font-size:12px"></div>' +
    '<div><label style="font-size:11px;color:var(--txt-3);display:block;margin-bottom:3px">S/N логгера (пусто = нет)</label>' +
      '<input type="text" class="form-control sensor-logger-sn" value="' + escHTML((s && s.loggerSN) || '') + '" placeholder="нет связи" style="width:100%;box-sizing:border-box;font-size:12px"></div>' +
    '<div><button type="button" class="sensor-del-btn btn btn-sm btn-danger" style="padding:4px 0;width:28px;text-align:center">✕</button></div>' +
  '</div>';
}

function _collectSensors() {
  var sensors = [];
  document.querySelectorAll('#wells-sensors-list .wells-sensor-row').forEach(function(row, i) {
    var name      = row.querySelector('.sensor-name').value.trim();
    var depth     = parseFloat(row.querySelector('.sensor-depth').value);
    var sn        = row.querySelector('.sensor-sn').value.trim();
    var loggerSN  = row.querySelector('.sensor-logger-sn').value.trim();
    sensors.push({
      id:               'sensor_' + Date.now() + '_' + i,
      name:             name,
      depth:            isNaN(depth) ? null : depth,
      serialNumber:     sn,
      loggerSN:         loggerSN,
      connectedToLogger: loggerSN.length > 0,
    });
  });
  return sensors;
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

  var wellType = document.getElementById('wells-f-type').value || 'drainage';
  var well = {
    id:             (WellsState.editingWell && WellsState.editingWell.id) || ('well_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
    name:           name,
    wellType:       wellType,
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
    sensors: wellType === 'piezometric' ? _collectSensors() : [],
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
  var latest = meas.reduce(function(best, m) {
    return (m.measurementDate || '') > (best.measurementDate || '') ? m : best;
  });
  return latest.flowRate != null ? latest : null;
}

// ════════════════════════════════════════════════════════════
// ЭКСПОРТ ДАННЫХ ПО СКВАЖИНАМ
// ════════════════════════════════════════════════════════════

function _csvEscape(val) {
  var s = String(val == null ? '' : val);
  if (s.indexOf('"') >= 0 || s.indexOf(';') >= 0 || s.indexOf('\n') >= 0) {
    s = '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function _csvNum(val) {
  return val != null ? String(val).replace('.', ',') : '';
}

function _tsNow() {
  var d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}

// ── CSV: плоская таблица (скважина × замер) ───────────────
function exportWellsCSV() {
  var wells = WellsState.list;
  if (!wells.length) { Toast.show('Нет скважин для экспорта', 'error'); return; }

  var hdrs = [
    'Скважина', 'Карьер', 'Участок', 'Домен', 'Статус',
    'Глубина, м', 'Азимут, °', 'Наклон, °', 'Диаметр, мм', 'Обсадка',
    'Дата бурения', 'Q после бурения, м³/ч',
    'X лок.', 'Y лок.', 'Z лок.', 'Широта', 'Долгота',
    'Дата замера', 'Q замера, м³/ч', 'Сотрудник', 'Комментарий к замеру'
  ];

  function wellMeasRow(w, m) {
    return [
      w.name || '', w.quarry || '', w.quarrySection || '', w.domain || '', w.status || '',
      _csvNum(w.depth), _csvNum(w.azimuth), _csvNum(w.inclination),
      _csvNum(w.drillDiameter), w.casing || '',
      w.drillDate ? formatDate(w.drillDate) : '', _csvNum(w.flowAfterDrill),
      _csvNum(w.xLocal), _csvNum(w.yLocal), _csvNum(w.zLocal),
      _csvNum(w.lat), _csvNum(w.lon),
      m ? (m.measurementDate ? formatDate(m.measurementDate) : '') : '',
      m ? _csvNum(m.flowRate) : '',
      m ? (m.worker || '') : '',
      m ? (m.comment || '') : ''
    ];
  }

  var rows = [hdrs];
  wells.forEach(function(w) {
    var meas = (WellsState.measurements[w.id] || []).slice().sort(function(a, b) {
      return (b.measurementDate||'') < (a.measurementDate||'') ? -1 : 1;
    });
    if (meas.length) {
      meas.forEach(function(m) { rows.push(wellMeasRow(w, m)); });
    } else {
      rows.push(wellMeasRow(w, null));
    }
  });

  var bom = '﻿';
  var csv = rows.map(function(r) { return r.map(_csvEscape).join(';'); }).join('\r\n');
  var blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' });
  var url  = URL.createObjectURL(blob);
  var a    = document.createElement('a');
  a.href = url; a.download = 'skvazhiny-' + _tsNow() + '.csv';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  Toast.show('CSV сохранён', 'success');
}

// ── Excel: три листа (Скважины / Замеры / Сводка) ─────────
function exportWellsXLSX() {
  var wells = WellsState.list;
  if (!wells.length) { Toast.show('Нет скважин для экспорта', 'error'); return; }

  function doExport() {
    var XLSX = window.XLSX;
    if (!XLSX) { Toast.show('Библиотека Excel не загрузилась', 'error'); return; }
    var ts = _tsNow();

    // ── Лист 1: Скважины (реестр) ──────────────────────────
    var wHdrs = [
      'Скважина', 'Карьер', 'Участок', 'Домен', 'Статус',
      'Глубина, м', 'Азимут, °', 'Наклон, °', 'Диаметр, мм', 'Обсадка',
      'Дата бурения', 'Q после бурения, м³/ч',
      'X лок.', 'Y лок.', 'Z лок.', 'Широта', 'Долгота',
      'Последний замер', 'Q посл. замер, м³/ч', 'Всего замеров'
    ];
    var wData = [wHdrs];
    wells.forEach(function(w) {
      var lastM  = _getLastMeasurement(w.id);
      var measCnt = (WellsState.measurements[w.id] || []).length;
      wData.push([
        w.name || '', w.quarry || '', w.quarrySection || '', w.domain || '', w.status || '',
        w.depth != null ? w.depth : '',
        w.azimuth != null ? w.azimuth : '',
        w.inclination != null ? w.inclination : '',
        w.drillDiameter != null ? w.drillDiameter : '',
        w.casing || '',
        w.drillDate ? formatDate(w.drillDate) : '',
        w.flowAfterDrill != null ? w.flowAfterDrill : '',
        w.xLocal != null ? w.xLocal : '',
        w.yLocal != null ? w.yLocal : '',
        w.zLocal != null ? w.zLocal : '',
        w.lat != null ? w.lat : '',
        w.lon != null ? w.lon : '',
        lastM ? formatDate(lastM.measurementDate) : '',
        lastM ? (lastM.flowRate != null ? lastM.flowRate : '') : '',
        measCnt
      ]);
    });
    var ws1 = XLSX.utils.aoa_to_sheet(wData);
    ws1['!cols'] = [
      {wch:14},{wch:12},{wch:16},{wch:10},{wch:12},
      {wch:10},{wch:10},{wch:10},{wch:10},{wch:14},
      {wch:14},{wch:16},{wch:10},{wch:10},{wch:10},{wch:12},{wch:12},
      {wch:14},{wch:14},{wch:12}
    ];
    wHdrs.forEach(function(_, ci) {
      var addr = XLSX.utils.encode_cell({r:0, c:ci});
      if (ws1[addr]) ws1[addr].s = { font:{bold:true}, fill:{fgColor:{rgb:'D9E1F2'}} };
    });

    // ── Лист 2: Замеры (хронология) ────────────────────────
    var mHdrs = ['Скважина','Домен','Участок','Статус','Дата замера','Q, м³/ч','Сотрудник','Комментарий'];
    var mData = [mHdrs];
    wells.forEach(function(w) {
      var meas = (WellsState.measurements[w.id] || []).slice().sort(function(a,b) {
        return (a.measurementDate||'') < (b.measurementDate||'') ? -1 : 1;
      });
      meas.forEach(function(m) {
        mData.push([
          w.name || '', w.domain || '', w.quarrySection || '', w.status || '',
          m.measurementDate ? formatDate(m.measurementDate) : '',
          m.flowRate != null ? m.flowRate : '',
          m.worker || '', m.comment || ''
        ]);
      });
    });
    var ws2 = XLSX.utils.aoa_to_sheet(mData);
    ws2['!cols'] = [{wch:14},{wch:10},{wch:16},{wch:12},{wch:14},{wch:10},{wch:20},{wch:36}];
    mHdrs.forEach(function(_, ci) {
      var addr = XLSX.utils.encode_cell({r:0, c:ci});
      if (ws2[addr]) ws2[addr].s = { font:{bold:true}, fill:{fgColor:{rgb:'D9E1F2'}} };
    });

    // ── Лист 3: Сводка ─────────────────────────────────────
    var activeN = 0, dryN = 0, dryingN = 0, totalQ = 0, measTotal = 0;
    var byDomain = {}, bySection = {}, byStatus = {};
    var depths = [];
    wells.forEach(function(w) {
      if (w.status === 'Активная') activeN++;
      else if (w.status === 'Сухая') dryN++;
      else if (w.status === 'Иссякает') dryingN++;
      byStatus[w.status||'—'] = (byStatus[w.status||'—']||0) + 1;
      byDomain[w.domain||'—']  = (byDomain[w.domain||'—']||0) + 1;
      bySection[w.quarrySection||'—'] = (bySection[w.quarrySection||'—']||0) + 1;
      if (w.depth > 0) depths.push(w.depth);
      var lm = _getLastMeasurement(w.id);
      if (lm && lm.flowRate != null) totalQ += parseFloat(lm.flowRate) || 0;
      measTotal += (WellsState.measurements[w.id] || []).length;
    });
    var avgDepth = depths.length ? Math.round(depths.reduce(function(a,b){return a+b;},0)/depths.length*10)/10 : null;

    var summary = [
      ['Параметр', 'Значение'],
      ['Дата выгрузки', ts],
      ['Всего скважин', wells.length],
      ['Активных', activeN],
      ['Иссякает', dryingN],
      ['Сухих', dryN],
      ['Суммарный Q (посл. замеры), м³/ч', Math.round(totalQ*100)/100],
      ['Средняя глубина, м', avgDepth != null ? avgDepth : '—'],
      ['Всего замеров в БД', measTotal],
      [],
      ['Статус', 'Скважин']
    ];
    Object.keys(byStatus).sort().forEach(function(k){ summary.push([k, byStatus[k]]); });
    summary.push([]);
    summary.push(['Домен', 'Скважин']);
    Object.keys(byDomain).sort().forEach(function(k){ summary.push([k, byDomain[k]]); });
    summary.push([]);
    summary.push(['Участок', 'Скважин']);
    Object.keys(bySection).sort().forEach(function(k){ summary.push([k, bySection[k]]); });

    var ws3 = XLSX.utils.aoa_to_sheet(summary);
    ws3['!cols'] = [{wch:36},{wch:16}];

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, 'Скважины');
    XLSX.utils.book_append_sheet(wb, ws2, 'Замеры');
    XLSX.utils.book_append_sheet(wb, ws3, 'Сводка');
    XLSX.writeFile(wb, 'skvazhiny-' + ts + '.xlsx');
    Toast.show('Excel сохранён', 'success');
  }

  if (window.XLSX) { doExport(); return; }
  var script = document.createElement('script');
  script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  script.onload = doExport;
  script.onerror = function() { Toast.show('Не удалось загрузить библиотеку Excel', 'error'); };
  document.head.appendChild(script);
}
