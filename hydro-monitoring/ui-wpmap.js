// ═══════════════════════════════════════════════════════════════
//  Карта водопунктов — ui-wpmap.js
//  Leaflet-карта реестра wp_registry с фильтрацией по типу,
//  попапами и связью с химическим мониторингом
// ═══════════════════════════════════════════════════════════════

var WpmState = {
  items:      [],      // [{id, name, code, wp_type, lat, lng, ...}]
  loading:    false,
  loaded:     false,
  filterType: '',      // '' = все типы
  map:        null,    // Leaflet map instance
  layerGroup: null,    // L.layerGroup для всех маркеров
  markers:    [],      // [{item, marker}]
};

// Цвет и метка по типу водопункта
var WPM_TYPES = {
  well_obs: { color: '#3b82f6', label: 'Наблюд. скважина',   short: 'НС', icon: 'W' },
  well_exp: { color: '#f97316', label: 'Эксплуат. скважина', short: 'ЭС', icon: 'E' },
  sump:     { color: '#22d3ee', label: 'Зумпф',               short: 'З',  icon: 'S' },
  pond:     { color: '#22c55e', label: 'Накопитель',          short: 'Н',  icon: 'P' },
  seep:     { color: '#a855f7', label: 'Водопроявление',      short: 'ВП', icon: 'V' },
  ditch:    { color: '#eab308', label: 'Дренажная канава',    short: 'К',  icon: 'D' },
  other:    { color: '#9ca3af', label: 'Прочее',              short: 'П',  icon: '?' },
};

// ── Загрузка данных ────────────────────────────────────────────
async function _wpmLoadData() {
  if (!window.Api) return;
  WpmState.loading = true;
  try {
    var res = await Api.client().from('wp_registry').select('*').order('name');
    if (!res.error) WpmState.items = res.data || [];
    WpmState.loaded = true;
  } catch(e) {
    console.error('[wpmap] load error', e);
  }
  WpmState.loading = false;
}

// ── CSS ────────────────────────────────────────────────────────
function _wpmInitCSS() {
  if (document.getElementById('wpmap-css')) return;
  var s = document.createElement('style');
  s.id = 'wpmap-css';
  s.textContent = [
    '#page-wpmap{padding:0!important;overflow:hidden!important;position:relative}',
    '#page-wpmap.active{display:flex!important;flex-direction:column!important}',
    '.wpm-shell{position:relative;flex:1;overflow:hidden;display:flex;flex-direction:column}',

    /* Map container */
    '#wpm-leaflet{flex:1;min-height:0;z-index:0}',

    /* Top control panel */
    '.wpm-ctrl{position:absolute;top:12px;left:12px;z-index:1000;display:flex;flex-direction:column;gap:8px;pointer-events:none}',
    '.wpm-panel{background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:10px 14px;backdrop-filter:blur(6px);pointer-events:all;max-width:300px}',

    /* KPI row at top */
    '.wpm-kpi-row{display:flex;gap:10px;flex-wrap:wrap}',
    '.wpm-kpi{background:var(--bg-2);border:1px solid var(--line);border-radius:8px;padding:8px 12px;display:flex;align-items:center;gap:8px;pointer-events:all;backdrop-filter:blur(6px)}',
    '.wpm-kpi-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}',
    '.wpm-kpi-val{font-size:18px;font-weight:700;color:var(--txt-1);line-height:1}',
    '.wpm-kpi-lbl{font-size:11px;color:var(--txt-3)}',

    /* Filter chips */
    '.wpm-filters{display:flex;gap:6px;flex-wrap:wrap;pointer-events:all;backdrop-filter:blur(6px)}',
    '.wpm-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:99px;border:1px solid var(--line);background:var(--bg-2);color:var(--txt-3);font-size:11px;font-weight:500;cursor:pointer;transition:all .15s;white-space:nowrap}',
    '.wpm-chip:hover{border-color:rgba(255,255,255,.3);color:var(--txt-1)}',
    '.wpm-chip.active{background:rgba(59,130,246,.15);border-color:rgba(59,130,246,.5);color:var(--blue);font-weight:700}',
    '.wpm-chip-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}',

    /* Reload button */
    '.wpm-reload-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:var(--bg-2);border:1px solid var(--line);border-radius:8px;color:var(--txt-2);font-size:12px;cursor:pointer;pointer-events:all;backdrop-filter:blur(6px);transition:all .15s}',
    '.wpm-reload-btn:hover{color:var(--txt-1);border-color:rgba(255,255,255,.3)}',

    /* Empty state */
    '.wpm-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--txt-3);pointer-events:none;z-index:500}',
    '.wpm-empty-ico{font-size:48px}',
    '.wpm-empty-txt{font-size:15px;font-weight:500}',
    '.wpm-empty-sub{font-size:12px;text-align:center;max-width:300px;line-height:1.5}',

    /* Leaflet popup override */
    '.leaflet-popup-content-wrapper{background:var(--bg-2)!important;border:1px solid var(--line)!important;border-radius:10px!important;box-shadow:0 8px 32px rgba(0,0,0,.4)!important;color:var(--txt-1)!important}',
    '.leaflet-popup-tip{background:var(--bg-2)!important}',
    '.leaflet-popup-content{margin:12px 16px!important}',
    '.wpm-popup-title{font-size:14px;font-weight:700;color:var(--txt-1);margin-bottom:4px}',
    '.wpm-popup-type{display:inline-block;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;margin-bottom:8px}',
    '.wpm-popup-row{display:flex;align-items:flex-start;gap:8px;margin-bottom:4px;font-size:12px}',
    '.wpm-popup-lbl{color:var(--txt-3);min-width:80px;flex-shrink:0}',
    '.wpm-popup-val{color:var(--txt-1)}',
    '.wpm-popup-btn{display:inline-flex;align-items:center;gap:5px;margin-top:10px;padding:6px 12px;border-radius:7px;border:none;background:rgba(59,130,246,.15);color:var(--blue);font-size:12px;font-weight:600;cursor:pointer;transition:background .15s;width:100%;justify-content:center}',
    '.wpm-popup-btn:hover{background:rgba(59,130,246,.25)}',

    /* Custom marker */
    '.wpm-marker{display:flex;align-items:center;justify-content:center;border-radius:50%;border:2px solid rgba(255,255,255,.8);box-shadow:0 2px 8px rgba(0,0,0,.4);font-size:10px;font-weight:700;color:#fff;cursor:pointer;transition:transform .15s}',
    '.wpm-marker:hover{transform:scale(1.2)}',
    '.wpm-marker.pulse::after{content:"";position:absolute;inset:-4px;border-radius:50%;border:2px solid currentColor;animation:wpm-pulse 1.5s infinite;opacity:.6}',
    '@keyframes wpm-pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(1.8);opacity:0}}',

    /* Info panel (right side) */
    '.wpm-info{position:absolute;top:12px;right:12px;z-index:1000;width:260px;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;overflow:hidden;pointer-events:all;backdrop-filter:blur(6px);display:none}',
    '.wpm-info.open{display:flex;flex-direction:column}',
    '.wpm-info-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--line)}',
    '.wpm-info-title{font-size:13px;font-weight:700;color:var(--txt-1)}',
    '.wpm-info-close{background:none;border:none;color:var(--txt-3);cursor:pointer;font-size:16px;padding:2px 6px;border-radius:5px;line-height:1}',
    '.wpm-info-close:hover{color:var(--txt-1)}',
    '.wpm-info-body{padding:12px 14px;overflow-y:auto;max-height:60vh}',
    '.wpm-info-row{display:flex;flex-direction:column;gap:2px;margin-bottom:10px}',
    '.wpm-info-lbl{font-size:10px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em;font-weight:600}',
    '.wpm-info-val{font-size:13px;color:var(--txt-1)}',
  ].join('\n');
  document.head.appendChild(s);
}

// ── Layout ─────────────────────────────────────────────────────
var _wpmInited = false;
function _wpmBuildLayout() {
  var page = document.getElementById('page-wpmap');
  if (!page) return;
  page.innerHTML =
    '<div class="wpm-shell" id="wpm-shell">' +
      '<div id="wpm-leaflet"></div>' +

      // Top-left: filters + KPI
      '<div class="wpm-ctrl" id="wpm-ctrl">' +
        '<div class="wpm-filters" id="wpm-filter-chips"></div>' +
        '<div class="wpm-kpi-row" id="wpm-kpi-row"></div>' +
      '</div>' +

      // Top-right reload
      '<div style="position:absolute;top:12px;right:12px;z-index:1000;pointer-events:all" id="wpm-top-right">' +
        '<button class="wpm-reload-btn" onclick="wpmReload()">⟳ Обновить</button>' +
      '</div>' +

      // Info panel (shows on marker click)
      '<div class="wpm-info" id="wpm-info">' +
        '<div class="wpm-info-hdr">' +
          '<span class="wpm-info-title" id="wpm-info-title">Водопункт</span>' +
          '<button class="wpm-info-close" onclick="_wpmCloseInfo()">✕</button>' +
        '</div>' +
        '<div class="wpm-info-body" id="wpm-info-body"></div>' +
      '</div>' +

    '</div>';
}

// ── Leaflet init ───────────────────────────────────────────────
function _wpmInitLeaflet() {
  if (!window.L) {
    // Leaflet not loaded yet — retry
    setTimeout(_wpmInitLeaflet, 300);
    return;
  }
  var container = document.getElementById('wpm-leaflet');
  if (!container) return;

  // Destroy previous map if tab re-opened
  if (WpmState.map) {
    WpmState.map.remove();
    WpmState.map = null;
  }

  // Default center — will fit to markers later
  var map = L.map('wpm-leaflet', {
    center: [51.1, 71.4],  // Центр Казахстана как дефолт
    zoom: 13,
    zoomControl: true,
    attributionControl: true,
  });
  WpmState.map = map;

  // Tile layer — Esri World Imagery (спутник)
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
  }).addTo(map);

  // Поверх спутника — дороги и подписи (Esri Reference overlay)
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19,
    opacity: 0.6,
    attribution: '',
  }).addTo(map);

  WpmState.layerGroup = L.layerGroup().addTo(map);

  // Render markers after map is ready
  _wpmRenderMarkers();
  _wpmRenderFilterChips();
  _wpmRenderKpi();
}

// ── Markers ────────────────────────────────────────────────────
function _wpmMakeIcon(type, size) {
  size = size || 32;
  var t = WPM_TYPES[type] || WPM_TYPES.other;
  var color = t.color;
  var letter = t.icon;
  var half = size / 2;
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + (size + 8) + '">' +
    '<circle cx="' + half + '" cy="' + half + '" r="' + (half - 2) + '" fill="' + color + '" stroke="rgba(255,255,255,.9)" stroke-width="2"/>' +
    '<text x="' + half + '" y="' + (half + 4) + '" text-anchor="middle" fill="#fff" font-family="system-ui,sans-serif" font-size="' + Math.round(size * 0.38) + '" font-weight="700">' + letter + '</text>' +
    // pin tail
    '<polygon points="' + (half-4) + ',' + (size-4) + ' ' + (half+4) + ',' + (size-4) + ' ' + half + ',' + (size+7) + '" fill="' + color + '"/>' +
  '</svg>';
  return L.divIcon({
    className: '',
    html: svg,
    iconSize:   [size, size + 8],
    iconAnchor: [half, size + 8],
    popupAnchor:[0, -(size + 8)],
  });
}

function _wpmRenderMarkers() {
  if (!WpmState.map || !WpmState.layerGroup) return;
  WpmState.layerGroup.clearLayers();
  WpmState.markers = [];

  var items = WpmState.items.filter(function(item) {
    if (!item.lat || !item.lng) return false;
    if (WpmState.filterType && item.wp_type !== WpmState.filterType) return false;
    return true;
  });

  var bounds = [];

  items.forEach(function(item) {
    var icon = _wpmMakeIcon(item.wp_type, 30);
    var marker = L.marker([item.lat, item.lng], { icon: icon });

    var t = WPM_TYPES[item.wp_type] || WPM_TYPES.other;
    var popupHtml = _wpmPopupHtml(item, t);
    marker.bindPopup(popupHtml, { maxWidth: 280 });

    marker.on('click', function() {
      _wpmOpenInfo(item, t);
    });

    marker.addTo(WpmState.layerGroup);
    WpmState.markers.push({ item: item, marker: marker });
    bounds.push([item.lat, item.lng]);
  });

  // Fit map to markers
  if (bounds.length === 1) {
    WpmState.map.setView(bounds[0], 15);
  } else if (bounds.length > 1) {
    WpmState.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }

  // Show empty state if no coords
  _wpmUpdateEmptyState();
}

function _wpmPopupHtml(item, t) {
  var rows = '';
  if (item.code)          rows += _wpmPopRow('Код',      item.code);
  if (item.aquifer)       rows += _wpmPopRow('Водонос.',  item.aquifer);
  if (item.depth)         rows += _wpmPopRow('Глубина',   item.depth + ' м');
  if (item.lat && item.lng) rows += _wpmPopRow('WGS-84', item.lat.toFixed(5) + ', ' + item.lng.toFixed(5));
  if (item.coord_x && item.coord_y) rows += _wpmPopRow('Местн.', 'X:' + item.coord_x + ' Y:' + item.coord_y);
  if (item.notes)         rows += _wpmPopRow('Примечание', item.notes);

  return '<div class="wpm-popup-title">' + escHTML(item.name) + '</div>' +
    '<div class="wpm-popup-type" style="background:' + t.color + '22;color:' + t.color + '">' + escHTML(t.label) + '</div>' +
    rows +
    '<button class="wpm-popup-btn" onclick="wpmGoToChem(\'' + item.name + '\')">🔬 Открыть хим. мониторинг</button>';
}

function _wpmPopRow(lbl, val) {
  return '<div class="wpm-popup-row">' +
    '<span class="wpm-popup-lbl">' + escHTML(lbl) + '</span>' +
    '<span class="wpm-popup-val">' + escHTML(String(val)) + '</span>' +
  '</div>';
}

// ── Info panel (right side) ────────────────────────────────────
function _wpmOpenInfo(item, t) {
  var panel = document.getElementById('wpm-info');
  var title = document.getElementById('wpm-info-title');
  var body  = document.getElementById('wpm-info-body');
  if (!panel || !title || !body) return;

  title.textContent = item.name;

  var rows = [
    { l: 'Тип',           v: t.label },
    { l: 'Код',           v: item.code || '—' },
    item.aquifer  ? { l: 'Водоносный гор.',   v: item.aquifer } : null,
    item.depth    ? { l: 'Глубина скважины',  v: item.depth + ' м' } : null,
    item.diameter ? { l: 'Диаметр',           v: item.diameter + ' мм' } : null,
    item.filter_from !== null && item.filter_from !== undefined
                  ? { l: 'Фильтр',            v: item.filter_from + '–' + item.filter_to + ' м' } : null,
    item.drilled_at ? { l: 'Дата бурения',    v: item.drilled_at } : null,
    item.pump_model ? { l: 'Насос',           v: item.pump_model } : null,
    item.pump_depth ? { l: 'Гл. насоса',      v: item.pump_depth + ' м' } : null,
    item.pump_capacity ? { l: 'Подача',       v: item.pump_capacity + ' м³/ч' } : null,
    item.lat && item.lng ? { l: 'WGS-84', v: item.lat.toFixed(6) + ', ' + item.lng.toFixed(6) } : null,
    item.coord_x  ? { l: 'Местн. X',         v: item.coord_x } : null,
    item.coord_y  ? { l: 'Местн. Y',         v: item.coord_y } : null,
    item.notes    ? { l: 'Примечание',        v: item.notes } : null,
  ].filter(Boolean);

  body.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--line)">' +
      '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + t.color + ';flex-shrink:0"></span>' +
      '<span style="font-size:12px;color:' + t.color + ';font-weight:700">' + escHTML(t.label) + '</span>' +
      (!item.active ? '<span style="font-size:10px;background:rgba(248,113,113,.12);color:#f87171;padding:1px 6px;border-radius:4px;margin-left:auto">Неактивен</span>' : '') +
    '</div>' +
    rows.map(function(r) {
      return '<div class="wpm-info-row">' +
        '<span class="wpm-info-lbl">' + escHTML(r.l) + '</span>' +
        '<span class="wpm-info-val">' + escHTML(String(r.v)) + '</span>' +
      '</div>';
    }).join('') +
    '<button class="wpm-popup-btn" style="margin-top:6px" onclick="wpmGoToChem(\'' + escHTML(item.name).replace(/'/g, "\\'") + '\')">🔬 Хим. мониторинг</button>' +
    '<button class="wpm-popup-btn" style="margin-top:6px;background:rgba(139,148,158,.1);color:var(--txt-2)" onclick="wpmGoToRegistry(\'' + escHTML(item.id).replace(/'/g, "\\'") + '\')">◫ Открыть в реестре</button>';

  panel.classList.add('open');
}

function _wpmCloseInfo() {
  var panel = document.getElementById('wpm-info');
  if (panel) panel.classList.remove('open');
}

// ── Переходы в другие модули ───────────────────────────────────
function wpmGoToChem(wpName) {
  if (typeof switchTab === 'function') switchTab('chem');
}

function wpmGoToRegistry(wpId) {
  if (typeof switchTab === 'function') switchTab('registry');
}

// ── Filter chips ───────────────────────────────────────────────
function _wpmRenderFilterChips() {
  var wrap = document.getElementById('wpm-filter-chips');
  if (!wrap) return;

  // Count per type
  var counts = {};
  WpmState.items.forEach(function(item) {
    counts[item.wp_type] = (counts[item.wp_type] || 0) + 1;
  });
  var total = WpmState.items.length;

  var chips = '<button class="wpm-chip' + (!WpmState.filterType ? ' active' : '') + '" onclick="wpmSetFilter(\'\')">' +
    '<span class="wpm-chip-dot" style="background:rgba(139,148,158,.6)"></span>Все (' + total + ')</button>';

  Object.keys(WPM_TYPES).forEach(function(type) {
    var cnt = counts[type] || 0;
    if (!cnt) return;
    var t = WPM_TYPES[type];
    chips += '<button class="wpm-chip' + (WpmState.filterType === type ? ' active' : '') + '" onclick="wpmSetFilter(\'' + type + '\')">' +
      '<span class="wpm-chip-dot" style="background:' + t.color + '"></span>' +
      t.label + ' (' + cnt + ')</button>';
  });

  wrap.innerHTML = chips;
}

function wpmSetFilter(type) {
  WpmState.filterType = type;
  _wpmRenderFilterChips();
  _wpmRenderMarkers();
  _wpmRenderKpi();
}

// ── KPI row ────────────────────────────────────────────────────
function _wpmRenderKpi() {
  var wrap = document.getElementById('wpm-kpi-row');
  if (!wrap) return;

  var items = WpmState.filterType
    ? WpmState.items.filter(function(i){ return i.wp_type === WpmState.filterType; })
    : WpmState.items;

  var withCoords    = items.filter(function(i){ return i.lat && i.lng; }).length;
  var withoutCoords = items.length - withCoords;
  var active        = items.filter(function(i){ return i.active !== false; }).length;

  wrap.innerHTML =
    _wpmKpi('#6b7280', items.length, 'на карте: ' + withCoords) +
    (withoutCoords > 0 ? _wpmKpi('#f87171', withoutCoords, 'без координат') : '') +
    _wpmKpi('#22c55e', active, 'активных');
}

function _wpmKpi(color, val, lbl) {
  return '<div class="wpm-kpi">' +
    '<span class="wpm-kpi-dot" style="background:' + color + '"></span>' +
    '<div><div class="wpm-kpi-val">' + val + '</div><div class="wpm-kpi-lbl">' + lbl + '</div></div>' +
  '</div>';
}

// ── Empty state ────────────────────────────────────────────────
function _wpmUpdateEmptyState() {
  var shell = document.getElementById('wpm-shell');
  if (!shell) return;
  var existing = document.getElementById('wpm-empty');
  if (existing) existing.remove();

  var hasCoords = WpmState.items.some(function(i){ return i.lat && i.lng; });
  if (!hasCoords && WpmState.loaded) {
    var el = document.createElement('div');
    el.id = 'wpm-empty';
    el.className = 'wpm-empty';
    el.innerHTML =
      '<div class="wpm-empty-ico">📍</div>' +
      '<div class="wpm-empty-txt">Координаты не заданы</div>' +
      '<div class="wpm-empty-sub">Откройте Реестр водопунктов и укажите координаты WGS-84 (широта / долгота) для отображения на карте</div>';
    shell.appendChild(el);
  }
}

// ── Reload ─────────────────────────────────────────────────────
async function wpmReload() {
  WpmState.loaded  = false;
  WpmState.loading = false;
  _wpmCloseInfo();
  await _wpmLoadData();
  _wpmRenderMarkers();
  _wpmRenderFilterChips();
  _wpmRenderKpi();
  if (typeof Toast !== 'undefined') Toast.ok('Данные обновлены');
}

// ── Инициализация вкладки ──────────────────────────────────────
async function initWpMapTab() {
  _wpmInitCSS();

  if (!_wpmInited) {
    _wpmInited = true;
    _wpmBuildLayout();
  }

  if (!WpmState.loaded && !WpmState.loading) {
    await _wpmLoadData();
  }

  // Leaflet нужно инициализировать или обновить размер после того,
  // как вкладка стала видимой
  if (!WpmState.map) {
    setTimeout(_wpmInitLeaflet, 80);
  } else {
    setTimeout(function() {
      WpmState.map.invalidateSize();
      _wpmRenderMarkers();
      _wpmRenderFilterChips();
      _wpmRenderKpi();
    }, 80);
  }
}

// Экспорт
window.initWpMapTab  = initWpMapTab;
window.wpmSetFilter  = wpmSetFilter;
window.wpmReload     = wpmReload;
window.wpmGoToChem   = wpmGoToChem;
window.wpmGoToRegistry = wpmGoToRegistry;
window._wpmCloseInfo = _wpmCloseInfo;
