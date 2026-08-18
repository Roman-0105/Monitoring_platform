// ═══════════════════════════════════════════════════════════════
//  Карта водопунктов — ui-wpmap.js
//  Leaflet-карта реестра wp_registry:
//  • Маркеры по форме/цвету конфигурируются на тип водопункта
//  • Подпись названия водопункта под маркером
//  • Фильтры: тип, поиск по коду/наименованию
//  • Переключение слоёв: Спутник / Карта / Рельеф
// ═══════════════════════════════════════════════════════════════

var WpmState = {
  items:        [],      // [{id, name, code, wp_type, lat, lng, ...}]
  loading:      false,
  loaded:       false,
  filterType:   '',      // '' = все типы
  filterSearch: '',      // строка поиска по name/code
  showLabels:   true,    // показывать подписи под маркерами
  activeLayer:  'satellite',
  map:          null,    // Leaflet map instance
  layerGroup:   null,
  refLayer:     null,    // подписи поверх спутника
  markers:      [],      // [{item, marker}]
  tileLayers:   {},      // {satellite, street, topo}
};

// ── Типы водопунктов (цвет/форма/метка) ───────────────────────
// shape: 'circle' | 'square' | 'diamond' | 'triangle' | 'hexagon'
var WPM_TYPES = {
  well_obs: { color: '#3b82f6', label: 'Наблюд. скважина',   shape: 'circle'  },
  well_exp: { color: '#f97316', label: 'Эксплуат. скважина', shape: 'square'  },
  sump:     { color: '#22d3ee', label: 'Зумпф',               shape: 'diamond' },
  pond:     { color: '#22c55e', label: 'Накопитель',          shape: 'triangle'},
  seep:     { color: '#a855f7', label: 'Водопроявление',      shape: 'hexagon' },
  ditch:    { color: '#eab308', label: 'Дренажная канава',    shape: 'circle'  },
  other:    { color: '#9ca3af', label: 'Прочее',              shape: 'circle'  },
};

// ── localStorage ключ для пользовательских настроек типов ──────
var WPM_SETTINGS_KEY = 'wpm-type-settings';

function _wpmLoadTypeSettings() {
  try {
    var raw = localStorage.getItem(WPM_SETTINGS_KEY);
    if (!raw) return;
    var saved = JSON.parse(raw);
    Object.keys(saved).forEach(function(k) {
      if (WPM_TYPES[k]) Object.assign(WPM_TYPES[k], saved[k]);
    });
  } catch(e) {}
}
function _wpmSaveTypeSettings() {
  try {
    var out = {};
    Object.keys(WPM_TYPES).forEach(function(k) {
      out[k] = { color: WPM_TYPES[k].color, shape: WPM_TYPES[k].shape };
    });
    localStorage.setItem(WPM_SETTINGS_KEY, JSON.stringify(out));
  } catch(e) {}
}

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
    '#page-wpmap{padding:0!important;overflow:hidden!important}',
    '#page-wpmap.active{display:flex!important;flex-direction:column!important}',
    '.wpm-shell{position:relative;flex:1;min-height:0;overflow:hidden}',
    '#wpm-leaflet{position:absolute;inset:0;z-index:0}',

    /* Control panel (top-left) */
    '.wpm-ctrl{position:absolute;top:12px;left:12px;z-index:1000;display:flex;flex-direction:column;gap:8px;pointer-events:none;max-width:360px}',
    '.wpm-panel{background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:10px 14px;backdrop-filter:blur(6px);pointer-events:all}',

    /* Search input */
    '.wpm-search-wrap{display:flex;align-items:center;gap:6px;pointer-events:all}',
    '.wpm-search{flex:1;background:var(--bg-2);border:1px solid var(--line);border-radius:8px;color:var(--txt-1);font-size:12px;padding:6px 10px;outline:none;backdrop-filter:blur(6px)}',
    '.wpm-search:focus{border-color:rgba(59,130,246,.5)}',
    '.wpm-search::placeholder{color:var(--txt-3)}',

    /* KPI row */
    '.wpm-kpi-row{display:flex;gap:8px;flex-wrap:wrap;pointer-events:all}',
    '.wpm-kpi{background:var(--bg-2);border:1px solid var(--line);border-radius:8px;padding:6px 10px;display:flex;align-items:center;gap:8px;backdrop-filter:blur(6px)}',
    '.wpm-kpi-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}',
    '.wpm-kpi-val{font-size:16px;font-weight:700;color:var(--txt-1);line-height:1}',
    '.wpm-kpi-lbl{font-size:11px;color:var(--txt-3)}',

    /* Filter chips */
    '.wpm-filters{display:flex;gap:6px;flex-wrap:wrap;pointer-events:all}',
    '.wpm-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:99px;border:1px solid var(--line);background:var(--bg-2);color:var(--txt-3);font-size:11px;font-weight:500;cursor:pointer;transition:all .15s;white-space:nowrap;backdrop-filter:blur(6px)}',
    '.wpm-chip:hover{border-color:rgba(255,255,255,.3);color:var(--txt-1)}',
    '.wpm-chip.active{background:rgba(59,130,246,.15);border-color:rgba(59,130,246,.5);color:var(--blue);font-weight:700}',
    '.wpm-chip-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}',

    /* Top-right toolbar */
    '.wpm-toolbar{position:absolute;top:12px;right:12px;z-index:1000;display:flex;gap:6px;align-items:center;pointer-events:all}',
    '.wpm-btn{display:inline-flex;align-items:center;gap:5px;padding:6px 11px;background:var(--bg-2);border:1px solid var(--line);border-radius:8px;color:var(--txt-2);font-size:12px;cursor:pointer;pointer-events:all;backdrop-filter:blur(6px);transition:all .15s;white-space:nowrap}',
    '.wpm-btn:hover{color:var(--txt-1);border-color:rgba(255,255,255,.3)}',
    '.wpm-btn.active{background:rgba(59,130,246,.15);border-color:rgba(59,130,246,.5);color:var(--blue)}',

    /* Layer switcher group */
    '.wpm-layer-group{display:flex;background:var(--bg-2);border:1px solid var(--line);border-radius:8px;overflow:hidden;backdrop-filter:blur(6px)}',
    '.wpm-layer-btn{padding:6px 11px;border:none;background:transparent;color:var(--txt-3);font-size:11px;font-weight:600;cursor:pointer;transition:all .15s;border-right:1px solid var(--line)}',
    '.wpm-layer-btn:last-child{border-right:none}',
    '.wpm-layer-btn:hover{color:var(--txt-1);background:rgba(255,255,255,.05)}',
    '.wpm-layer-btn.active{background:rgba(59,130,246,.15);color:var(--blue)}',

    /* Marker label */
    '.wpm-lbl{background:rgba(15,23,42,.75);color:#fff;font-size:10px;font-weight:600;border-radius:3px;padding:1px 4px;margin-top:2px;white-space:nowrap;max-width:100px;overflow:hidden;text-overflow:ellipsis;backdrop-filter:blur(2px);line-height:1.4;text-align:center}',
    '.wpm-marker-wrap{display:flex;flex-direction:column;align-items:center;cursor:pointer}',

    /* Empty state */
    '.wpm-empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--txt-3);pointer-events:none;z-index:500}',
    '.wpm-empty-ico{font-size:48px}',
    '.wpm-empty-txt{font-size:15px;font-weight:500}',
    '.wpm-empty-sub{font-size:12px;text-align:center;max-width:300px;line-height:1.5}',

    /* Leaflet popup */
    '.leaflet-popup-content-wrapper{background:var(--bg-2)!important;border:1px solid var(--line)!important;border-radius:10px!important;box-shadow:0 8px 32px rgba(0,0,0,.4)!important;color:var(--txt-1)!important}',
    '.leaflet-popup-tip{background:var(--bg-2)!important}',
    '.leaflet-popup-content{margin:12px 16px!important}',
    '.wpm-popup-title{font-size:14px;font-weight:700;color:var(--txt-1);margin-bottom:4px}',
    '.wpm-popup-type{display:inline-block;padding:2px 8px;border-radius:5px;font-size:10px;font-weight:700;margin-bottom:8px}',
    '.wpm-popup-row{display:flex;align-items:flex-start;gap:8px;margin-bottom:4px;font-size:12px}',
    '.wpm-popup-lbl{color:var(--txt-3);min-width:80px;flex-shrink:0}',
    '.wpm-popup-val{color:var(--txt-1)}',
    '.wpm-popup-btn{display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:6px 12px;border-radius:7px;border:none;background:rgba(59,130,246,.15);color:var(--blue);font-size:12px;font-weight:600;cursor:pointer;transition:background .15s;width:100%;justify-content:center}',
    '.wpm-popup-btn:hover{background:rgba(59,130,246,.25)}',

    /* Info panel */
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

    /* Settings panel */
    '.wpm-settings-panel{position:absolute;top:50px;right:12px;z-index:2000;width:320px;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;overflow:hidden;pointer-events:all;backdrop-filter:blur(8px);display:none;box-shadow:0 12px 40px rgba(0,0,0,.5)}',
    '.wpm-settings-panel.open{display:flex;flex-direction:column}',
    '.wpm-stt-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--line)}',
    '.wpm-stt-title{font-size:13px;font-weight:700;color:var(--txt-1)}',
    '.wpm-stt-close{background:none;border:none;color:var(--txt-3);cursor:pointer;font-size:16px;padding:2px 6px;border-radius:5px}',
    '.wpm-stt-body{padding:12px 14px;overflow-y:auto;max-height:70vh;display:flex;flex-direction:column;gap:10px}',
    '.wpm-stt-row{display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:8px}',
    '.wpm-stt-lbl{font-size:12px;color:var(--txt-2);font-weight:500}',
    '.wpm-stt-shape{background:var(--bg-3,#0f172a);border:1px solid var(--line);border-radius:6px;color:var(--txt-1);font-size:11px;padding:3px 6px;cursor:pointer}',
    '.wpm-stt-color{width:28px;height:28px;border-radius:6px;border:2px solid var(--line);cursor:pointer;padding:0}',
    '.wpm-stt-save{display:flex;justify-content:flex-end;padding:10px 14px;border-top:1px solid var(--line)}',
    '.wpm-stt-save button{padding:6px 16px;border-radius:7px;border:none;background:rgba(59,130,246,.2);color:var(--blue);font-size:12px;font-weight:700;cursor:pointer}',
    '.wpm-stt-save button:hover{background:rgba(59,130,246,.35)}',
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

      // Top-left: search + filters + KPI
      '<div class="wpm-ctrl" id="wpm-ctrl">' +
        '<div class="wpm-search-wrap">' +
          '<input class="wpm-search" id="wpm-search" type="text" placeholder="🔍 Поиск по названию или коду…" oninput="wpmSearchChange(this.value)">' +
        '</div>' +
        '<div class="wpm-filters" id="wpm-filter-chips"></div>' +
        '<div class="wpm-kpi-row" id="wpm-kpi-row"></div>' +
      '</div>' +

      // Top-right: layer switcher + labels toggle + settings + reload
      '<div class="wpm-toolbar" id="wpm-toolbar">' +
        '<div class="wpm-layer-group">' +
          '<button class="wpm-layer-btn active" id="wpm-layer-satellite" onclick="wpmSetLayer(\'satellite\')" title="Спутниковый снимок">🛰 Спутник</button>' +
          '<button class="wpm-layer-btn" id="wpm-layer-street" onclick="wpmSetLayer(\'street\')" title="Карта улиц">🗺 Карта</button>' +
          '<button class="wpm-layer-btn" id="wpm-layer-topo" onclick="wpmSetLayer(\'topo\')" title="Топографическая карта">🏔 Рельеф</button>' +
        '</div>' +
        '<button class="wpm-btn" id="wpm-labels-btn" onclick="wpmToggleLabels()" title="Показать/скрыть подписи">🏷 Подписи</button>' +
        '<button class="wpm-btn" onclick="wpmOpenSettings()" title="Настройки маркеров">⚙️</button>' +
        '<button class="wpm-btn" onclick="wpmReload()">⟳ Обновить</button>' +
      '</div>' +

      // Info panel (right side, shown on marker click)
      '<div class="wpm-info" id="wpm-info">' +
        '<div class="wpm-info-hdr">' +
          '<span class="wpm-info-title" id="wpm-info-title">Водопункт</span>' +
          '<button class="wpm-info-close" onclick="_wpmCloseInfo()">✕</button>' +
        '</div>' +
        '<div class="wpm-info-body" id="wpm-info-body"></div>' +
      '</div>' +

      // Settings panel
      '<div class="wpm-settings-panel" id="wpm-settings-panel">' +
        '<div class="wpm-stt-hdr">' +
          '<span class="wpm-stt-title">⚙️ Настройки маркеров</span>' +
          '<button class="wpm-stt-close" onclick="wpmCloseSettings()">✕</button>' +
        '</div>' +
        '<div class="wpm-stt-body" id="wpm-stt-body"></div>' +
        '<div class="wpm-stt-save"><button onclick="wpmSaveSettings()">💾 Применить</button></div>' +
      '</div>' +

    '</div>';
}

// ── Leaflet init ───────────────────────────────────────────────
function _wpmInitLeaflet() {
  if (!window.L) { setTimeout(_wpmInitLeaflet, 300); return; }
  var container = document.getElementById('wpm-leaflet');
  if (!container) return;

  if (WpmState.map) {
    WpmState.map.remove();
    WpmState.map = null;
    WpmState.layerGroup = null;
    WpmState.refLayer = null;
    WpmState.markers = [];
    WpmState.tileLayers = {};
  }

  if (container.offsetWidth === 0 || container.offsetHeight === 0) {
    setTimeout(_wpmInitLeaflet, 250);
    return;
  }

  var map = L.map('wpm-leaflet', {
    center: [51.1, 71.4],
    zoom: 13,
    zoomControl: true,
    attributionControl: true,
  });
  WpmState.map = map;

  // ── Tile layers ───────────────────────────────────────────
  WpmState.tileLayers.satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'Tiles © Esri' }
  );
  WpmState.tileLayers.street = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: '© OpenStreetMap contributors' }
  );
  WpmState.tileLayers.topo = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { maxZoom: 17, attribution: '© OpenTopoMap contributors' }
  );

  // Reference labels overlay (only for satellite)
  WpmState.refLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, opacity: 0.6, attribution: '' }
  );

  // Apply active layer
  _wpmApplyTileLayer(WpmState.activeLayer);

  WpmState.layerGroup = L.layerGroup().addTo(map);
  _wpmRenderMarkers();
}

function _wpmApplyTileLayer(name) {
  var map = WpmState.map;
  if (!map) return;

  // Remove all base layers
  Object.values(WpmState.tileLayers).forEach(function(l) {
    if (map.hasLayer(l)) map.removeLayer(l);
  });
  if (WpmState.refLayer && map.hasLayer(WpmState.refLayer)) {
    map.removeLayer(WpmState.refLayer);
  }

  var layer = WpmState.tileLayers[name];
  if (layer) map.addLayer(layer);

  // Add reference overlay only for satellite
  if (name === 'satellite' && WpmState.refLayer) {
    map.addLayer(WpmState.refLayer);
  }

  // Ensure layerGroup is on top
  if (WpmState.layerGroup) {
    WpmState.layerGroup.remove();
    WpmState.layerGroup.addTo(map);
  }

  WpmState.activeLayer = name;

  // Update button states
  ['satellite', 'street', 'topo'].forEach(function(k) {
    var btn = document.getElementById('wpm-layer-' + k);
    if (btn) btn.classList.toggle('active', k === name);
  });
}

function wpmSetLayer(name) {
  _wpmApplyTileLayer(name);
}

// ── Marker SVG shapes ──────────────────────────────────────────
var WPM_SHAPES = {
  circle: function(color, sz) {
    var h = sz / 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + sz + '" height="' + (sz + 8) + '" overflow="visible">' +
      '<circle cx="' + h + '" cy="' + h + '" r="' + (h - 2) + '" fill="' + color + '" stroke="rgba(255,255,255,.9)" stroke-width="2"/>' +
      '<polygon points="' + (h-4) + ',' + (sz-4) + ' ' + (h+4) + ',' + (sz-4) + ' ' + h + ',' + (sz+7) + '" fill="' + color + '"/>' +
    '</svg>';
  },
  square: function(color, sz) {
    var h = sz / 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + sz + '" height="' + (sz + 8) + '" overflow="visible">' +
      '<rect x="2" y="2" width="' + (sz-4) + '" height="' + (sz-4) + '" rx="3" fill="' + color + '" stroke="rgba(255,255,255,.9)" stroke-width="2"/>' +
      '<polygon points="' + (h-4) + ',' + (sz-4) + ' ' + (h+4) + ',' + (sz-4) + ' ' + h + ',' + (sz+7) + '" fill="' + color + '"/>' +
    '</svg>';
  },
  diamond: function(color, sz) {
    var h = sz / 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + sz + '" height="' + sz + '" overflow="visible">' +
      '<polygon points="' + h + ',2 ' + (sz-2) + ',' + h + ' ' + h + ',' + (sz-2) + ' 2,' + h + '" fill="' + color + '" stroke="rgba(255,255,255,.9)" stroke-width="2"/>' +
    '</svg>';
  },
  triangle: function(color, sz) {
    var h = sz / 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + sz + '" height="' + sz + '" overflow="visible">' +
      '<polygon points="' + h + ',2 ' + (sz-2) + ',' + (sz-2) + ' 2,' + (sz-2) + '" fill="' + color + '" stroke="rgba(255,255,255,.9)" stroke-width="2"/>' +
    '</svg>';
  },
  hexagon: function(color, sz) {
    var h = sz / 2, q = sz / 4 * 1.5;
    var pts = [
      [h, 2], [sz-2, h - q/2], [sz-2, h + q/2],
      [h, sz-2], [2, h + q/2], [2, h - q/2]
    ].map(function(p){ return p[0] + ',' + p[1]; }).join(' ');
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + sz + '" height="' + sz + '" overflow="visible">' +
      '<polygon points="' + pts + '" fill="' + color + '" stroke="rgba(255,255,255,.9)" stroke-width="2"/>' +
    '</svg>';
  },
};

function _wpmMakeIcon(type, showLabel, name) {
  var sz = 28;
  var t  = WPM_TYPES[type] || WPM_TYPES.other;
  var shapeFn = WPM_SHAPES[t.shape] || WPM_SHAPES.circle;
  var svgHtml = shapeFn(t.color, sz);

  var extraH = 8; // tail for circle/square
  if (t.shape === 'diamond' || t.shape === 'triangle' || t.shape === 'hexagon') extraH = 0;

  var labelHtml = '';
  var labelH = 0;
  if (showLabel && name) {
    var shortName = name.length > 14 ? name.slice(0, 13) + '…' : name;
    labelHtml = '<div class="wpm-lbl">' + escHTML(shortName) + '</div>';
    labelH = 18;
  }

  var totalH = sz + extraH + labelH;
  var anchorY = sz + extraH; // tip of the pin

  return L.divIcon({
    className: '',
    html: '<div class="wpm-marker-wrap">' + svgHtml + labelHtml + '</div>',
    iconSize:   [sz, totalH],
    iconAnchor: [sz / 2, anchorY],
    popupAnchor:[0, -(anchorY)],
  });
}

// ── Markers ────────────────────────────────────────────────────
function _wpmRenderMarkers() {
  if (!WpmState.map || !WpmState.layerGroup) return;
  WpmState.layerGroup.clearLayers();
  WpmState.markers = [];

  var search = (WpmState.filterSearch || '').toLowerCase().trim();

  var items = WpmState.items.filter(function(item) {
    if (!item.lat || !item.lng) return false;
    if (WpmState.filterType && item.wp_type !== WpmState.filterType) return false;
    if (search) {
      var nameMatch = (item.name || '').toLowerCase().indexOf(search) >= 0;
      var codeMatch = (item.code || '').toLowerCase().indexOf(search) >= 0;
      if (!nameMatch && !codeMatch) return false;
    }
    return true;
  });

  var bounds = [];

  items.forEach(function(item) {
    var icon = _wpmMakeIcon(item.wp_type, WpmState.showLabels, item.name);
    var marker = L.marker([item.lat, item.lng], { icon: icon });

    var t = WPM_TYPES[item.wp_type] || WPM_TYPES.other;
    marker.bindPopup(_wpmPopupHtml(item, t), { maxWidth: 280 });
    marker.on('click', function() { _wpmOpenInfo(item, t); });

    marker.addTo(WpmState.layerGroup);
    WpmState.markers.push({ item: item, marker: marker });
    bounds.push([item.lat, item.lng]);
  });

  if (bounds.length === 1) {
    WpmState.map.setView(bounds[0], 15);
  } else if (bounds.length > 1) {
    WpmState.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }

  _wpmUpdateEmptyState();
}

function _wpmPopupHtml(item, t) {
  var rows = '';
  if (item.code)               rows += _wpmPopRow('Код',      item.code);
  if (item.aquifer)            rows += _wpmPopRow('Водонос.', item.aquifer);
  if (item.depth)              rows += _wpmPopRow('Глубина',  item.depth + ' м');
  if (item.lat && item.lng)    rows += _wpmPopRow('WGS-84',   item.lat.toFixed(5) + ', ' + item.lng.toFixed(5));
  if (item.coord_x && item.coord_y) rows += _wpmPopRow('Местн.', 'X:' + item.coord_x + ' Y:' + item.coord_y);

  return '<div class="wpm-popup-title">' + escHTML(item.name) + '</div>' +
    '<div class="wpm-popup-type" style="background:' + t.color + '22;color:' + t.color + '">' + escHTML(t.label) + '</div>' +
    rows +
    '<button class="wpm-popup-btn" onclick="wpmGoToChem(\'' + escHTML(item.name).replace(/'/g,"\\'") + '\')">🔬 Хим. мониторинг</button>';
}

function _wpmPopRow(lbl, val) {
  return '<div class="wpm-popup-row"><span class="wpm-popup-lbl">' + escHTML(lbl) +
    '</span><span class="wpm-popup-val">' + escHTML(String(val)) + '</span></div>';
}

// ── Labels toggle ──────────────────────────────────────────────
function wpmToggleLabels() {
  WpmState.showLabels = !WpmState.showLabels;
  var btn = document.getElementById('wpm-labels-btn');
  if (btn) btn.classList.toggle('active', WpmState.showLabels);
  _wpmRenderMarkers();
  _wpmRenderFilterChips();
  _wpmRenderKpi();
}

// ── Info panel ─────────────────────────────────────────────────
function _wpmOpenInfo(item, t) {
  var panel = document.getElementById('wpm-info');
  var title = document.getElementById('wpm-info-title');
  var body  = document.getElementById('wpm-info-body');
  if (!panel || !title || !body) return;

  title.textContent = item.name;

  var rows = [
    { l: 'Тип',           v: t.label },
    { l: 'Код',           v: item.code || '—' },
    item.aquifer    ? { l: 'Водоносный гор.',  v: item.aquifer } : null,
    item.depth      ? { l: 'Глубина',          v: item.depth + ' м' } : null,
    item.diameter   ? { l: 'Диаметр',          v: item.diameter + ' мм' } : null,
    (item.filter_from != null) ? { l: 'Фильтр', v: item.filter_from + '–' + item.filter_to + ' м' } : null,
    item.drilled_at ? { l: 'Дата бурения',     v: item.drilled_at } : null,
    item.pump_model ? { l: 'Насос',            v: item.pump_model } : null,
    item.pump_depth ? { l: 'Гл. насоса',       v: item.pump_depth + ' м' } : null,
    item.pump_capacity ? { l: 'Подача',        v: item.pump_capacity + ' м³/ч' } : null,
    item.lat && item.lng ? { l: 'WGS-84',      v: item.lat.toFixed(6) + ', ' + item.lng.toFixed(6) } : null,
    item.coord_x    ? { l: 'Местн. X',         v: item.coord_x } : null,
    item.coord_y    ? { l: 'Местн. Y',         v: item.coord_y } : null,
    item.notes      ? { l: 'Примечание',        v: item.notes } : null,
  ].filter(Boolean);

  body.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:10px;border-bottom:1px solid var(--line)">' +
      '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + t.color + ';flex-shrink:0"></span>' +
      '<span style="font-size:12px;color:' + t.color + ';font-weight:700">' + escHTML(t.label) + '</span>' +
      (!item.active ? '<span style="font-size:10px;background:rgba(248,113,113,.12);color:#f87171;padding:1px 6px;border-radius:4px;margin-left:auto">Неактивен</span>' : '') +
    '</div>' +
    rows.map(function(r) {
      return '<div class="wpm-info-row"><span class="wpm-info-lbl">' + escHTML(r.l) +
        '</span><span class="wpm-info-val">' + escHTML(String(r.v)) + '</span></div>';
    }).join('') +
    '<button class="wpm-popup-btn" style="margin-top:6px" onclick="wpmGoToChem(\'' + escHTML(item.name).replace(/'/g,"\\'") + '\')">🔬 Хим. мониторинг</button>' +
    '<button class="wpm-popup-btn" style="margin-top:6px;background:rgba(139,148,158,.1);color:var(--txt-2)" onclick="wpmGoToRegistry(\'' + escHTML(item.id).replace(/'/g,"\\'") + '\')">◫ Открыть в реестре</button>';

  panel.classList.add('open');
}

function _wpmCloseInfo() {
  var panel = document.getElementById('wpm-info');
  if (panel) panel.classList.remove('open');
}

// ── Settings panel ─────────────────────────────────────────────
var SHAPE_OPTIONS = ['circle', 'square', 'diamond', 'triangle', 'hexagon'];
var SHAPE_LABELS  = { circle:'Круг', square:'Квадрат', diamond:'Ромб', triangle:'Треугольник', hexagon:'Шестиугольник' };

function wpmOpenSettings() {
  var panel = document.getElementById('wpm-settings-panel');
  var body  = document.getElementById('wpm-stt-body');
  if (!panel || !body) return;

  var html = '';
  Object.keys(WPM_TYPES).forEach(function(k) {
    var t = WPM_TYPES[k];
    var shapeOpts = SHAPE_OPTIONS.map(function(s) {
      return '<option value="' + s + '"' + (t.shape === s ? ' selected' : '') + '>' + SHAPE_LABELS[s] + '</option>';
    }).join('');
    html +=
      '<div class="wpm-stt-row">' +
        '<span class="wpm-stt-lbl">' + escHTML(t.label) + '</span>' +
        '<select class="wpm-stt-shape" data-type="' + k + '" onchange="wpmSettingChange(\'' + k + '\',\'shape\',this.value)">' + shapeOpts + '</select>' +
        '<input type="color" class="wpm-stt-color" data-type="' + k + '" value="' + t.color + '" oninput="wpmSettingChange(\'' + k + '\',\'color\',this.value)" title="Цвет">' +
      '</div>';
  });
  body.innerHTML = html;
  panel.classList.add('open');
}

function wpmCloseSettings() {
  var panel = document.getElementById('wpm-settings-panel');
  if (panel) panel.classList.remove('open');
}

function wpmSettingChange(type, field, value) {
  if (WPM_TYPES[type]) WPM_TYPES[type][field] = value;
}

function wpmSaveSettings() {
  _wpmSaveTypeSettings();
  wpmCloseSettings();
  _wpmRenderMarkers();
  _wpmRenderFilterChips();
  if (typeof Toast !== 'undefined') Toast.done('Настройки маркеров сохранены', 'success');
}

// ── Filter chips ───────────────────────────────────────────────
function _wpmRenderFilterChips() {
  var wrap = document.getElementById('wpm-filter-chips');
  if (!wrap) return;

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

function wpmSearchChange(val) {
  WpmState.filterSearch = val;
  _wpmRenderMarkers();
  _wpmRenderKpi();
}

// ── KPI row ────────────────────────────────────────────────────
function _wpmRenderKpi() {
  var wrap = document.getElementById('wpm-kpi-row');
  if (!wrap) return;

  var search = (WpmState.filterSearch || '').toLowerCase().trim();

  var items = WpmState.items.filter(function(i) {
    if (WpmState.filterType && i.wp_type !== WpmState.filterType) return false;
    if (search) {
      var nm = (i.name || '').toLowerCase().indexOf(search) >= 0;
      var cd = (i.code || '').toLowerCase().indexOf(search) >= 0;
      if (!nm && !cd) return false;
    }
    return true;
  });

  var withCoords    = items.filter(function(i){ return i.lat && i.lng; }).length;
  var withoutCoords = items.length - withCoords;

  wrap.innerHTML =
    _wpmKpi('#6b7280', items.length, 'всего / карте: ' + withCoords) +
    (withoutCoords > 0 ? _wpmKpi('#f87171', withoutCoords, 'без WGS-84') : '');
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

  var withWgs   = WpmState.items.filter(function(i){ return i.lat && i.lng; });
  var withLocal = WpmState.items.filter(function(i){ return !i.lat && !i.lng && (i.coord_x || i.coord_y); });

  if (!withWgs.length && WpmState.loaded) {
    var el = document.createElement('div');
    el.id = 'wpm-empty';
    el.className = 'wpm-empty';
    el.innerHTML =
      '<div class="wpm-empty-ico">📍</div>' +
      '<div class="wpm-empty-txt">Координаты не заданы</div>' +
      '<div class="wpm-empty-sub">Откройте Реестр водопунктов и укажите WGS-84 (Широта / Долгота) для отображения на карте</div>';
    shell.appendChild(el);
  } else if (withLocal.length > 0 && WpmState.loaded) {
    var names = withLocal.slice(0, 3).map(function(i){ return i.name; }).join(', ');
    if (withLocal.length > 3) names += ' и ещё ' + (withLocal.length - 3);
    var el = document.createElement('div');
    el.id = 'wpm-empty';
    el.style.cssText = 'position:absolute;bottom:16px;left:50%;transform:translateX(-50%);z-index:1000;' +
      'background:var(--bg-2,#1e293b);border:1px solid #f59e0b;border-radius:10px;padding:10px 16px;' +
      'max-width:480px;text-align:center;pointer-events:all;font-size:12px;color:var(--txt-1,#e2e8f0)';
    el.innerHTML =
      '<span style="font-size:16px">⚠️</span> ' +
      '<strong>' + withLocal.length + ' водопункт' + (withLocal.length < 2 ? '' : withLocal.length < 5 ? 'а' : 'ов') + '</strong>' +
      ' ' + (withLocal.length === 1 ? 'имеет' : 'имеют') + ' только местные координаты (X/Y) и не отображаются на карте.<br>' +
      '<span style="opacity:.75">' + names + '</span><br>' +
      '<span style="opacity:.6">Откройте карточку и укажите <b>Широта / Долгота</b> (WGS-84).</span>';
    shell.appendChild(el);
  }
}

// ── Переходы ───────────────────────────────────────────────────
function wpmGoToChem(wpName) {
  if (typeof switchTab === 'function') switchTab('chem');
}
function wpmGoToRegistry(wpId) {
  if (typeof switchTab === 'function') switchTab('registry');
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
  if (typeof Toast !== 'undefined') Toast.done('Данные обновлены', 'success');
}

// ── Инициализация вкладки ──────────────────────────────────────
async function initWpMapTab() {
  _wpmLoadTypeSettings();
  _wpmInitCSS();

  if (!_wpmInited) {
    _wpmInited = true;
    _wpmBuildLayout();
  }

  if (!WpmState.loaded && !WpmState.loading) {
    await _wpmLoadData();
  }

  requestAnimationFrame(function() {
    setTimeout(_wpmInitLeaflet, 50);
  });

  // Sync label button state
  var btn = document.getElementById('wpm-labels-btn');
  if (btn) btn.classList.toggle('active', WpmState.showLabels);
}

// ── Экспорт ────────────────────────────────────────────────────
window.initWpMapTab     = initWpMapTab;
window.wpmSetFilter     = wpmSetFilter;
window.wpmSearchChange  = wpmSearchChange;
window.wpmSetLayer      = wpmSetLayer;
window.wpmToggleLabels  = wpmToggleLabels;
window.wpmOpenSettings  = wpmOpenSettings;
window.wpmCloseSettings = wpmCloseSettings;
window.wpmSettingChange = wpmSettingChange;
window.wpmSaveSettings  = wpmSaveSettings;
window.wpmReload        = wpmReload;
window.wpmGoToChem      = wpmGoToChem;
window.wpmGoToRegistry  = wpmGoToRegistry;
window._wpmCloseInfo    = _wpmCloseInfo;
