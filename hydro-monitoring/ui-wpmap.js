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

    /* Calc panel */
    '.wpm-calc-panel{position:absolute;top:50px;right:12px;z-index:2000;width:330px;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;overflow:hidden;pointer-events:all;backdrop-filter:blur(8px);display:none;box-shadow:0 12px 40px rgba(0,0,0,.5)}',
    '.wpm-calc-panel.open{display:flex;flex-direction:column}',
    '.wpm-calc-hdr{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--line)}',
    '.wpm-calc-title{font-size:13px;font-weight:700;color:var(--txt-1)}',
    '.wpm-calc-close{background:none;border:none;color:var(--txt-3);cursor:pointer;font-size:16px;padding:2px 6px;border-radius:5px}',
    '.wpm-calc-body{padding:12px 14px;overflow-y:auto;max-height:80vh;display:flex;flex-direction:column;gap:14px}',
    '.wpm-calc-section{border:1px solid var(--line);border-radius:8px;overflow:hidden}',
    '.wpm-calc-sec-hdr{display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:rgba(255,255,255,.03);border-bottom:1px solid var(--line)}',
    '.wpm-calc-sec-title{font-size:11px;font-weight:700;color:var(--txt-2);text-transform:uppercase;letter-spacing:.06em}',
    '.wpm-calc-sec-body{padding:10px}',
    '.wpm-calc-field{display:flex;flex-direction:column;gap:3px;margin-bottom:8px}',
    '.wpm-calc-field:last-child{margin-bottom:0}',
    '.wpm-calc-lbl{font-size:10px;color:var(--txt-3);font-weight:600;text-transform:uppercase;letter-spacing:.05em}',
    '.wpm-calc-inp{background:var(--bg-3,#0f172a);border:1px solid var(--line);border-radius:6px;color:var(--txt-1);font-size:12px;font-family:monospace;padding:5px 8px;outline:none;width:100%;box-sizing:border-box}',
    '.wpm-calc-inp:focus{border-color:rgba(59,130,246,.5)}',
    '.wpm-calc-inp.readonly{color:var(--txt-2);background:rgba(255,255,255,.02);cursor:default}',
    '.wpm-calc-dms{font-size:10px;color:var(--txt-3);font-family:monospace;margin-top:2px;min-height:14px}',
    '.wpm-calc-from-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;border:1px solid rgba(59,130,246,.4);background:rgba(59,130,246,.1);color:var(--blue);font-size:11px;font-weight:700;cursor:pointer;margin-top:2px}',
    '.wpm-calc-from-btn:hover{background:rgba(59,130,246,.22)}',
    '.wpm-calc-note{font-size:10px;color:var(--txt-3);line-height:1.5;margin-top:8px;padding-top:8px;border-top:1px solid var(--line)}',

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
        '<button class="wpm-btn" id="wpm-calc-btn" onclick="wpmOpenCalc()" title="Калькулятор координат">📐 Пересчёт</button>' +
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

      // Calc panel
      '<div class="wpm-calc-panel" id="wpm-calc-panel">' +
        '<div class="wpm-calc-hdr">' +
          '<span class="wpm-calc-title">📐 Пересчёт координат</span>' +
          '<button class="wpm-calc-close" onclick="wpmCloseCalc()">✕</button>' +
        '</div>' +
        '<div class="wpm-calc-body">' +

          // WGS-84 block
          '<div class="wpm-calc-section">' +
            '<div class="wpm-calc-sec-hdr">' +
              '<span class="wpm-calc-sec-title">WGS-84 (GPS)</span>' +
              '<button class="wpm-calc-from-btn" onclick="wpmCalcFrom(\'wgs\')">↕ Пересчитать</button>' +
            '</div>' +
            '<div class="wpm-calc-sec-body">' +
              '<div class="wpm-calc-field">' +
                '<span class="wpm-calc-lbl">Широта (lat)</span>' +
                '<input id="wc-lat" class="wpm-calc-inp" type="text" placeholder="52.488520" oninput="wpmCalcHint(\'wgs\')">' +
                '<span class="wpm-calc-dms" id="wc-lat-dms"></span>' +
              '</div>' +
              '<div class="wpm-calc-field">' +
                '<span class="wpm-calc-lbl">Долгота (lon)</span>' +
                '<input id="wc-lon" class="wpm-calc-inp" type="text" placeholder="69.711210" oninput="wpmCalcHint(\'wgs\')">' +
                '<span class="wpm-calc-dms" id="wc-lon-dms"></span>' +
              '</div>' +
            '</div>' +
          '</div>' +

          // SK-42 block
          '<div class="wpm-calc-section">' +
            '<div class="wpm-calc-sec-hdr">' +
              '<span class="wpm-calc-sec-title">СК-42 / Пулково-1942</span>' +
              '<button class="wpm-calc-from-btn" onclick="wpmCalcFrom(\'sk42\')">↕ Пересчитать</button>' +
            '</div>' +
            '<div class="wpm-calc-sec-body">' +
              '<div class="wpm-calc-field">' +
                '<span class="wpm-calc-lbl">Северная X (N), м</span>' +
                '<input id="wc-sk42n" class="wpm-calc-inp" type="text" placeholder="5815200.000">' +
              '</div>' +
              '<div class="wpm-calc-field">' +
                '<span class="wpm-calc-lbl">Восточная Y (E) с номером зоны, м</span>' +
                '<input id="wc-sk42e" class="wpm-calc-inp" type="text" placeholder="12546300.000">' +
              '</div>' +
              '<div class="wpm-calc-field">' +
                '<span class="wpm-calc-lbl">Зона (авто по долготе)</span>' +
                '<input id="wc-sk42z" class="wpm-calc-inp" type="text" placeholder="12" style="width:60px">' +
              '</div>' +
            '</div>' +
          '</div>' +

          // Local coords block
          '<div class="wpm-calc-section">' +
            '<div class="wpm-calc-sec-hdr">' +
              '<span class="wpm-calc-sec-title">Местные (схема карьера)</span>' +
              '<button class="wpm-calc-from-btn" onclick="wpmCalcFrom(\'local\')">↕ Пересчитать</button>' +
            '</div>' +
            '<div class="wpm-calc-sec-body">' +
              '<div class="wpm-calc-field">' +
                '<span class="wpm-calc-lbl">X (запад–восток)</span>' +
                '<input id="wc-lx" class="wpm-calc-inp" type="text" placeholder="46100.000">' +
              '</div>' +
              '<div class="wpm-calc-field">' +
                '<span class="wpm-calc-lbl">Y (север–юг)</span>' +
                '<input id="wc-ly" class="wpm-calc-inp" type="text" placeholder="16400.000">' +
              '</div>' +
              '<div class="wpm-calc-note">X = СК-42 E − зона·10⁶ − 500 000<br>Y = СК-42 N − 5 800 000<br>Зона карьера: 12, OFF_Y = 5 800 000</div>' +
            '</div>' +
          '</div>' +

        '</div>' +
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
  wpmCloseCalc();
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

// ═══════════════════════════════════════════════════════════════
//  Калькулятор координат
//  WGS-84 ↔ СК-42 (Пулково-1942, Гаусс-Крюгер) ↔ Местные
//
//  Параметры эллипсоида Красовского:
//    a = 6 378 245.0, b = 6 356 863.019
//  OFF_Y = 5 800 000 (смещение Северной координаты)
//  Зона карьера = 12 (L0 = 69°)
// ═══════════════════════════════════════════════════════════════

var CALC_KRAS_A   = 6378245.0;
var CALC_KRAS_B   = 6356863.019;
var CALC_OFF_Y    = 5800000;
var CALC_ZONE_DEF = 12;

function _calcE2() {
  var a = CALC_KRAS_A, b = CALC_KRAS_B;
  return (a * a - b * b) / (a * a);
}

// WGS-84 (lat°, lon°) → СК-42 {north, east, zone}
function calcWgsToSk42(latDeg, lonDeg) {
  var a  = CALC_KRAS_A;
  var e2 = _calcE2();
  var e4 = e2 * e2, e6 = e4 * e2;
  var latR = latDeg * Math.PI / 180;
  var lonR = lonDeg * Math.PI / 180;
  var zone = Math.floor(lonDeg / 6) + 1;
  var L0   = (zone * 6 - 3) * Math.PI / 180;
  var dL   = lonR - L0;
  var sinL = Math.sin(latR), cosL = Math.cos(latR), tanL = Math.tan(latR);
  var t    = tanL * tanL;
  var eta2 = e2 * cosL * cosL / (1 - e2);
  var N    = a / Math.sqrt(1 - e2 * sinL * sinL);
  var M    = a * (
    (1 - e2/4 - 3*e4/64 - 5*e6/256) * latR
    - (3*e2/8 + 3*e4/32 + 45*e6/1024) * Math.sin(2*latR)
    + (15*e4/256 + 45*e6/1024) * Math.sin(4*latR)
    - (35*e6/3072) * Math.sin(6*latR)
  );
  var north = M
    + N*sinL*cosL*dL*dL/2
    + N*sinL*Math.pow(cosL,3)*(5-t+9*eta2+4*eta2*eta2)*Math.pow(dL,4)/24
    + N*sinL*Math.pow(cosL,5)*(61-58*t+t*t)*Math.pow(dL,6)/720;
  var east_local = N*cosL*dL
    + N*Math.pow(cosL,3)*(1-t+eta2)*Math.pow(dL,3)/6
    + N*Math.pow(cosL,5)*(5-18*t+t*t+14*eta2-58*t*eta2)*Math.pow(dL,5)/120;
  var east = east_local + zone * 1000000 + 500000;
  return { north: north, east: east, zone: zone };
}

// СК-42 {north, east, zone} → WGS-84 {lat°, lon°}
function calcSk42ToWgs(north, east, zone) {
  var a  = CALC_KRAS_A;
  var e2 = _calcE2();
  var east_local = east - zone * 1000000 - 500000;
  var lat = north / (a * (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256));
  for (var i = 0; i < 10; i++) {
    var M = a * (
      (1-e2/4-3*e2*e2/64-5*e2*e2*e2/256)*lat
      -(3*e2/8+3*e2*e2/32+45*e2*e2*e2/1024)*Math.sin(2*lat)
      +(15*e2*e2/256+45*e2*e2*e2/1024)*Math.sin(4*lat)
      -(35*e2*e2*e2/3072)*Math.sin(6*lat)
    );
    lat += (north - M) / (a * (1 - e2 * Math.sin(lat) * Math.sin(lat)));
  }
  var sinL = Math.sin(lat), cosL = Math.cos(lat), tanL = Math.tan(lat);
  var eta2 = e2 * cosL * cosL / (1 - e2);
  var N    = a / Math.sqrt(1 - e2 * sinL * sinL);
  var t    = tanL * tanL;
  var dL   = east_local / (N*cosL)
    - Math.pow(east_local,3) / (6*Math.pow(N,3)*cosL) * (1+2*t+eta2)
    + Math.pow(east_local,5) / (120*Math.pow(N,5)*cosL) * (5+28*t+24*t*t);
  var L0 = (zone * 6 - 3) * Math.PI / 180;
  return {
    lat: parseFloat((lat * 180 / Math.PI).toFixed(7)),
    lon: parseFloat(((L0 + dL) * 180 / Math.PI).toFixed(7)),
  };
}

// Decimal degrees → "D° M' S.sss""
function _ddToDms(dd, isLat) {
  var sign = dd < 0 ? -1 : 1;
  var abs  = Math.abs(dd);
  var d    = Math.floor(abs);
  var m    = Math.floor((abs - d) * 60);
  var s    = ((abs - d - m/60) * 3600).toFixed(3);
  var hem  = isLat ? (sign >= 0 ? 'N' : 'S') : (sign >= 0 ? 'E' : 'W');
  return hem + ' ' + d + '° ' + m + '\' ' + s + '"';
}

// Populate all fields given source system
function wpmCalcFrom(source) {
  var err = null;

  if (source === 'wgs') {
    var lat = parseFloat(document.getElementById('wc-lat').value);
    var lon = parseFloat(document.getElementById('wc-lon').value);
    if (isNaN(lat) || isNaN(lon)) { err = 'Введите корректные lat и lon'; }
    else {
      var sk = calcWgsToSk42(lat, lon);
      _calcSetSk42(sk.north, sk.east, sk.zone);
      _calcSetLocal(sk.east - sk.zone*1e6 - 500000, sk.north - CALC_OFF_Y);
      _calcSetDms(lat, lon);
    }
  } else if (source === 'sk42') {
    var north = parseFloat(document.getElementById('wc-sk42n').value);
    var east  = parseFloat(document.getElementById('wc-sk42e').value);
    var zone  = parseInt(document.getElementById('wc-sk42z').value) || CALC_ZONE_DEF;
    if (isNaN(north) || isNaN(east)) { err = 'Введите N и E'; }
    else {
      var wgs = calcSk42ToWgs(north, east, zone);
      _calcSetWgs(wgs.lat, wgs.lon);
      _calcSetLocal(east - zone*1e6 - 500000, north - CALC_OFF_Y);
      document.getElementById('wc-sk42z').value = zone;
    }
  } else if (source === 'local') {
    var lx = parseFloat(document.getElementById('wc-lx').value);
    var ly = parseFloat(document.getElementById('wc-ly').value);
    var zone = CALC_ZONE_DEF;
    if (isNaN(lx) || isNaN(ly)) { err = 'Введите X и Y'; }
    else {
      var north = ly + CALC_OFF_Y;
      var east  = lx + zone*1e6 + 500000;
      var wgs = calcSk42ToWgs(north, east, zone);
      _calcSetWgs(wgs.lat, wgs.lon);
      _calcSetSk42(north, east, zone);
    }
  }

  if (err && typeof Toast !== 'undefined') Toast.done(err, 'error');
}

function _calcSetWgs(lat, lon) {
  document.getElementById('wc-lat').value = lat;
  document.getElementById('wc-lon').value = lon;
  _calcSetDms(lat, lon);
}
function _calcSetSk42(north, east, zone) {
  document.getElementById('wc-sk42n').value = north.toFixed(3);
  document.getElementById('wc-sk42e').value = east.toFixed(3);
  document.getElementById('wc-sk42z').value = zone;
}
function _calcSetLocal(x, y) {
  document.getElementById('wc-lx').value = x.toFixed(4);
  document.getElementById('wc-ly').value = y.toFixed(4);
}
function _calcSetDms(lat, lon) {
  var ld = document.getElementById('wc-lat-dms');
  var lo = document.getElementById('wc-lon-dms');
  if (ld) ld.textContent = !isNaN(lat) ? _ddToDms(lat, true)  : '';
  if (lo) lo.textContent = !isNaN(lon) ? _ddToDms(lon, false) : '';
}

// Live DMS hint while typing WGS
function wpmCalcHint(source) {
  if (source === 'wgs') {
    var lat = parseFloat(document.getElementById('wc-lat').value);
    var lon = parseFloat(document.getElementById('wc-lon').value);
    _calcSetDms(lat, lon);
  }
}

function wpmOpenCalc() {
  var p = document.getElementById('wpm-calc-panel');
  if (p) {
    var isOpen = p.classList.contains('open');
    // Close settings if open
    wpmCloseSettings();
    p.classList.toggle('open', !isOpen);
    var btn = document.getElementById('wpm-calc-btn');
    if (btn) btn.classList.toggle('active', !isOpen);
  }
}
function wpmCloseCalc() {
  var p = document.getElementById('wpm-calc-panel');
  if (p) p.classList.remove('open');
  var btn = document.getElementById('wpm-calc-btn');
  if (btn) btn.classList.remove('active');
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
window.wpmOpenCalc      = wpmOpenCalc;
window.wpmCloseCalc     = wpmCloseCalc;
window.wpmCalcFrom      = wpmCalcFrom;
window.wpmCalcHint      = wpmCalcHint;
window.wpmReload        = wpmReload;
window.wpmGoToChem      = wpmGoToChem;
window.wpmGoToRegistry  = wpmGoToRegistry;
window._wpmCloseInfo    = _wpmCloseInfo;
