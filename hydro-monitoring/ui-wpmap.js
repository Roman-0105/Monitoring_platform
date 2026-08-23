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

  // Химическая карта (IDW-интерполяция / полигоны Вороного)
  chemMode:        null,   // null | 'mineral' | 'ph' | 'wtype'
  chemLoading:     false,
  chemPoints:      [],     // [{item, proto, meq, wtype}] — представительная проба на в/п
  chemRasterLayer: null,   // L.ImageOverlay
  chemIsoLayer:    null,   // L.LayerGroup изолиний
  _chemLast:       null,   // последний построенный растр (для легенды)
  chemSmooth:      false,  // true — гладкий градиент без ступеней/изолиний
  chemStep:        { mineral: 1, ph: 0.5 },  // шаг квантования по слою (г/л, ед. pH)
  chemExcluded:    {},      // { itemId: true } — пробы, исключённые из интерполяции (напр. аномалии)
  chemParamKey:    null,    // ключ CHEM_PARAMS для режима chemMode==='param' (любой показатель каталога)
  chemDivisions:   10,      // число ступеней для режима 'param' (диапазон проб / N)
  chemAsOfDate:    null,    // MAP-02: null — последняя доступная проба, иначе YYYY-MM-DD — срез "на дату"
  chemFilterYear:    '',    // '' — все годы, иначе 'YYYY' — карта только по пробам этого года
  chemFilterQuarter: '',    // '' — все кварталы, иначе '1'..'4' — карта только по пробам этого квартала
  chemPalette:     'classic', // MAP-07: 'classic' | 'viridis' | 'mono' — палитра непрерывной шкалы

  // Границы водных объектов (озёра/реки) — вырезаются из карты химии
  boundaryLayer:   null,   // L.LayerGroup сохранённых границ (контуры)
  boundaryEdit:    null,   // { itemId, points:[[lat,lng],...], layer } — активное рисование
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

// ── Химическая карта: непрерывная цветовая шкала минерализации и pH ──
// Цвета на концах и середине те же, что раньше были у классов Алёкина
// (пресные→рассолы / кислая→щелочная) — теперь это опорные точки
// градиента, а не жёсткие пороги, диапазон подстраивается под фактические
// данные, шаг квантования (ступенчатый режим) настраивается пользователем.
var WPM_MINERAL_RAMP = [
  { stop: 0,    color: '#3b82f6', label: 'пресная' },
  { stop: 0.25, color: '#22c55e' },
  { stop: 0.5,  color: '#eab308' },
  { stop: 0.75, color: '#f97316' },
  { stop: 1,    color: '#ef4444', label: 'солёная / рассол' },
];
var WPM_PH_RAMP = [
  { stop: 0,    color: '#dc2626', label: 'кислая' },
  { stop: 0.25, color: '#f97316' },
  { stop: 0.5,  color: '#22c55e' },
  { stop: 0.75, color: '#3b82f6' },
  { stop: 1,    color: '#8b5cf6', label: 'щелочная' },
];
// Пресеты шага квантования: г/л для минерализации, ед. pH для pH.
var WPM_STEP_PRESETS = { mineral: [1, 0.5, 0.1, 0.05, 0.01], ph: [1, 0.5, 0.1, 0.05, 0.01] };

// Универсальная шкала для карты по произвольному показателю каталога
// CHEM_PARAMS (металлы, радиология, органика и т.д.) — масштаб значений
// у разных показателей отличается на порядки, поэтому у неё нет своих
// смысловых подписей на концах (как «пресная/солёная») — просто
// низкое→высокое значение относительно фактического диапазона проб.
// Полная сетка фаций Алёкина (3 катиона × 3 аниона = 9) — легенда всегда
// показывает все 9, а не только те, что нашлись в текущих пробах (MAP-06):
// иначе пользователь не может понять, "здесь нет натриевых вод" это факт
// геохимии участка или просто их пока не пробурили/не опробовали.
var WPM_ALEKIN_FACIES = [
  { key: 'Ca-HCO3', label: 'Ca-HCO₃' }, { key: 'Mg-HCO3', label: 'Mg-HCO₃' }, { key: 'Na-HCO3', label: 'Na-HCO₃' },
  { key: 'Ca-SO4',  label: 'Ca-SO₄'  }, { key: 'Mg-SO4',  label: 'Mg-SO₄'  }, { key: 'Na-SO4',  label: 'Na-SO₄'  },
  { key: 'Ca-Cl',   label: 'Ca-Cl'   }, { key: 'Mg-Cl',   label: 'Mg-Cl'   }, { key: 'Na-Cl',   label: 'Na-Cl'   },
];

var WPM_GENERIC_RAMP = [
  { stop: 0,    color: '#3b82f6', label: 'минимум' },
  { stop: 0.25, color: '#22c55e' },
  { stop: 0.5,  color: '#eab308' },
  { stop: 0.75, color: '#f97316' },
  { stop: 1,    color: '#ef4444', label: 'максимум' },
];

// Альтернативные палитры непрерывной шкалы (MAP-07) — «Классика» (по
// умолчанию, разная семантика по режимам выше) неразличима при дальтонизме
// (красно-зелёная слепота путает середину со краями шкалы) и плохо читается
// на ч/б распечатке отчёта. Viridis — перцептивно равномерная и безопасная
// для всех типов дальтонизма шкала (стандарт matplotlib); Монохром — один
// тон разной светлоты, безопасен и для дальтоников, и для ч/б печати.
var WPM_PALETTES = {
  classic: { label: '🎨 Классика' }, // ramp берётся из WPM_MINERAL_RAMP/WPM_PH_RAMP/WPM_GENERIC_RAMP по режиму
  viridis: {
    label: '🟣 Viridis (дальтоники)',
    ramp: [
      { stop: 0,    color: '#440154', label: 'минимум' },
      { stop: 0.25, color: '#3b528b' },
      { stop: 0.5,  color: '#21918c' },
      { stop: 0.75, color: '#5ec962' },
      { stop: 1,    color: '#fde725', label: 'максимум' },
    ],
  },
  mono: {
    label: '⬛ Монохром (печать)',
    ramp: [
      { stop: 0,    color: '#eff6ff', label: 'минимум' },
      { stop: 0.25, color: '#93c5fd' },
      { stop: 0.5,  color: '#3b82f6' },
      { stop: 0.75, color: '#1d4ed8' },
      { stop: 1,    color: '#172554', label: 'максимум' },
    ],
  },
};
function _wpmGetRamp(mode) {
  var pal = WpmState.chemPalette || 'classic';
  if (pal !== 'classic' && WPM_PALETTES[pal]) return WPM_PALETTES[pal].ramp;
  return mode === 'mineral' ? WPM_MINERAL_RAMP : mode === 'ph' ? WPM_PH_RAMP : WPM_GENERIC_RAMP;
}
// Число ступеней (не абсолютный шаг — масштаб показателей разный):
// диапазон проб делится на столько интервалов.
var WPM_DIVISION_PRESETS = [5, 10, 20, 40, 80];

function _wpmRampColor(ramp, t) {
  t = Math.max(0, Math.min(1, t));
  for (var i = 0; i < ramp.length - 1; i++) {
    var a = ramp[i], b = ramp[i + 1];
    if (t >= a.stop && t <= b.stop) {
      var lt = (b.stop === a.stop) ? 0 : (t - a.stop) / (b.stop - a.stop);
      var ca = _wpmHexToRgb(a.color), cb = _wpmHexToRgb(b.color);
      return [
        Math.round(ca[0] + (cb[0] - ca[0]) * lt),
        Math.round(ca[1] + (cb[1] - ca[1]) * lt),
        Math.round(ca[2] + (cb[2] - ca[2]) * lt),
      ];
    }
  }
  return _wpmHexToRgb(ramp[ramp.length - 1].color);
}
// Квантование значения на сетку шага step (для ступенчатого режима).
function _wpmQuantize(val, step) {
  if (!step || step <= 0) return val;
  return Math.round(val / step) * step;
}
function _wpmHexToRgb(hex) {
  var h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map(function(c) { return c + c; }).join('');
  var num = parseInt(h, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

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

// ── Исключённые из карты химии пробы (напр. аномальная минерализация) ──
var WPM_CHEM_EXCLUDE_KEY = 'wpm-chem-excluded';
function _wpmLoadChemExcluded() {
  try {
    var raw = localStorage.getItem(WPM_CHEM_EXCLUDE_KEY);
    if (raw) WpmState.chemExcluded = JSON.parse(raw) || {};
  } catch(e) {}
}
function _wpmSaveChemExcluded() {
  try { localStorage.setItem(WPM_CHEM_EXCLUDE_KEY, JSON.stringify(WpmState.chemExcluded)); } catch(e) {}
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

    /* Кластер маркеров (MAP-03) */
    '.wpm-cluster-wrap{background:transparent!important;border:none!important}',
    '.wpm-cluster-icon{display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(59,130,246,.85);color:#fff;font-weight:700;font-size:13px;border:2px solid rgba(255,255,255,.9);box-shadow:0 2px 8px rgba(0,0,0,.35)}',

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

    /* Подсказка по клику на слое химии (MAP-04) */
    '.wpm-click-title{font-size:12px;font-weight:700;color:var(--txt-2);margin-bottom:4px}',
    '.wpm-click-val{font-size:20px;font-weight:800;color:var(--txt-1);line-height:1.2}',
    // #f87171 — тот же красный, что и везде для превышения ПДК (бейджи,
    // таблица результатов, линия ПДК на графике в «Хим. мониторинге»),
    // а не отдельный оттенок #ef4444 (UX-04: единая цветовая семантика).
    '.wpm-click-val.flag{color:#f87171}',
    '.wpm-click-note{font-size:10px;color:var(--txt-3);margin-top:2px}',
    '.wpm-click-near-title{font-size:10px;color:var(--txt-3);margin-top:8px;margin-bottom:2px;text-transform:uppercase;letter-spacing:.03em}',
    '.wpm-click-near{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--txt-2);padding:2px 0}',

    /* Info panel */
    // Нижний правый угол — своя зона, отдельная и от тулбара с выпадающими
    // меню (верх-право), и от легенды химии (низ-лево): раньше карточка
    // точки была закреплена в тот же угол, что и тулбар (top:12;right:12),
    // и при открытии перекрывала его правые кнопки (UX-02).
    '.wpm-info{position:absolute;bottom:12px;right:12px;z-index:1000;width:260px;max-height:calc(100% - 24px);overflow-y:auto;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;overflow-x:hidden;pointer-events:all;backdrop-filter:blur(6px);display:none;box-shadow:0 12px 40px rgba(0,0,0,.5)}',
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

    /* Химическая карта: переключатель слоя */
    '.wpm-chem-group{display:flex;background:var(--bg-2);border:1px solid var(--line);border-radius:8px;overflow:hidden;backdrop-filter:blur(6px)}',
    '.wpm-chem-btn{padding:6px 10px;border:none;background:transparent;color:var(--txt-3);font-size:11px;font-weight:600;cursor:pointer;transition:all .15s;border-right:1px solid var(--line);white-space:nowrap}',
    '.wpm-chem-btn:last-child{border-right:none}',
    '.wpm-chem-btn:hover{color:var(--txt-1);background:rgba(255,255,255,.05)}',
    '.wpm-chem-btn.active{background:rgba(236,72,153,.18);color:#ec4899}',

    /* Химическая карта: растровый слой поверх тайлов */
    '.wpm-chem-crisp{image-rendering:pixelated;image-rendering:crisp-edges}',

    /* Химическая карта: легенда (низ-лево) */
    '.wpm-chem-legend{position:absolute;bottom:12px;left:12px;z-index:1000;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:10px 14px;backdrop-filter:blur(6px);pointer-events:all;max-width:270px;display:none}',
    '.wpm-chem-legend.open{display:block}',
    '.wpm-chem-legend-title{font-size:11px;font-weight:700;color:var(--txt-1);margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em}',
    '.wpm-chem-legend-row{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--txt-2);margin-bottom:3px}',
    '.wpm-chem-legend-sw{width:12px;height:12px;border-radius:3px;flex-shrink:0}',
    '.wpm-chem-legend-note{font-size:10px;color:var(--txt-3);line-height:1.45;margin-top:6px;padding-top:6px;border-top:1px solid var(--line)}',
    '.wpm-chem-step-select{background:var(--bg-1,#0f172a);border:1px solid var(--line);border-radius:5px;color:var(--txt-1);font-size:11px;padding:2px 5px;cursor:pointer}',
    '.wpm-chem-step-select:disabled{opacity:.4;cursor:default}',

    /* Химическая карта: сворачиваемое меню слоёв (UX-01) — раньше все элементы
       управления слоем жили прямо в тулбаре и не помещались на экране при
       добавлении новых инструментов (срез по дате, экспорт PNG и т.п.) */
    '.wpm-chem-menu{position:absolute;top:50px;right:12px;z-index:2000;width:300px;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;overflow:hidden;pointer-events:all;backdrop-filter:blur(8px);display:none;box-shadow:0 12px 40px rgba(0,0,0,.5)}',
    '.wpm-chem-menu.open{display:flex;flex-direction:column}',
    '.wpm-chem-menu-body{padding:12px 14px;display:flex;flex-direction:column;gap:10px}',
    '.wpm-chem-menu-row{display:flex;align-items:center;gap:6px}',
    '.wpm-chem-menu-lbl{font-size:11px;color:var(--txt-3);white-space:nowrap;min-width:62px}',

    /* Химическая карта: панель выбора проб */
    '.wpm-chem-points-panel{position:absolute;top:50px;right:12px;z-index:2000;width:320px;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;overflow:hidden;pointer-events:all;backdrop-filter:blur(8px);display:none;box-shadow:0 12px 40px rgba(0,0,0,.5)}',
    '.wpm-chem-points-panel.open{display:flex;flex-direction:column}',
    '.wpm-chem-points-body{padding:12px 14px;overflow-y:auto;max-height:70vh}',
    '.wpm-chem-pt-row{display:flex;align-items:center;gap:8px;padding:6px 4px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--txt-1)}',
    '.wpm-chem-pt-row:hover{background:rgba(255,255,255,.05)}',
    '.wpm-chem-pt-row.excluded{opacity:.4}',
    '.wpm-chem-pt-row input{accent-color:var(--blue);flex-shrink:0}',
    '.wpm-chem-pt-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.wpm-chem-pt-val{font-size:10px;color:var(--txt-3);font-family:monospace;flex-shrink:0}',
    '.wpm-chem-pt-val.flag{color:#f87171;font-weight:700}',
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
        '<button class="wpm-btn" id="wpm-chem-menu-btn" onclick="wpmToggleChemMenu()" title="Слои химического мониторинга">🧪 Химия</button>' +
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

      // Chem layer legend (bottom-left)
      '<div class="wpm-chem-legend" id="wpm-chem-legend"></div>' +

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

      // Меню слоёв химического мониторинга (UX-01)
      '<div class="wpm-chem-menu" id="wpm-chem-menu">' +
        '<div class="wpm-stt-hdr">' +
          '<span class="wpm-stt-title">🧪 Слой химического мониторинга</span>' +
          '<button class="wpm-stt-close" onclick="wpmCloseChemMenu()">✕</button>' +
        '</div>' +
        '<div class="wpm-chem-menu-body">' +
          '<div class="wpm-chem-group" style="width:100%">' +
            '<button class="wpm-chem-btn active" id="wpm-chem-off" onclick="wpmSetChemLayer(null)" title="Выключить карту химии" style="flex:1">выкл</button>' +
            '<button class="wpm-chem-btn" id="wpm-chem-mineral" onclick="wpmSetChemLayer(\'mineral\')" title="Минерализация — интерполяция IDW по протоколам" style="flex:1">🧂 Минер.</button>' +
            '<button class="wpm-chem-btn" id="wpm-chem-ph" onclick="wpmSetChemLayer(\'ph\')" title="pH — интерполяция IDW по протоколам" style="flex:1">⚗️ pH</button>' +
            '<button class="wpm-chem-btn" id="wpm-chem-wtype" onclick="wpmSetChemLayer(\'wtype\')" title="Тип воды по Пайперу — полигоны Вороного (ближайшая проба)" style="flex:1">💧 Тип</button>' +
          '</div>' +
          '<button class="wpm-btn" id="wpm-chem-smooth" onclick="wpmToggleChemSmooth()" title="Гладкий градиент без ступеней и изолиний (для минерализации и pH)" style="width:100%">🌈 Гладкий градиент</button>' +
          '<select class="wpm-chem-step-select" id="wpm-chem-param-select" style="width:100%" onchange="wpmSetChemParam(this.value)" title="Карта по любому измеренному показателю (металлы, радиология, органика и т.д.)">' +
            '<option value="">🔬 Показатель…</option>' +
            Object.keys(CHEM_GROUPS).map(function(g) {
              var gopts = CHEM_PARAMS.filter(function(p){ return p.group === g; }).map(function(p) {
                return '<option value="' + p.key + '">' + escHTML(p.name) + '</option>';
              }).join('');
              return gopts ? '<optgroup label="' + CHEM_GROUPS[g].icon + ' ' + CHEM_GROUPS[g].label + '">' + gopts + '</optgroup>' : '';
            }).join('') +
          '</select>' +
          '<button class="wpm-btn" id="wpm-chem-points-btn" onclick="wpmToggleChemPoints()" title="Включить/исключить отдельные пробы из карты химии" style="width:100%">☑ Выбрать пробы</button>' +
          '<div class="wpm-chem-menu-row" title="Построить карту по пробам не позже указанной даты (срез во времени). Пусто — последняя доступная проба.">' +
            '<span class="wpm-chem-menu-lbl">На дату:</span>' +
            '<input type="date" id="wpm-chem-asof" class="wpm-chem-step-select" style="flex:1" onchange="wpmSetChemAsOf(this.value)">' +
            '<button id="wpm-chem-asof-clear" onclick="wpmClearChemAsOf()" title="Сбросить — последняя проба" style="display:none;background:none;border:none;color:var(--txt-3);cursor:pointer;font-size:13px;padding:0 4px">✕</button>' +
          '</div>' +
          '<div class="wpm-chem-menu-row" title="Показать карту только по пробам выбранного года/квартала — под квартальную периодичность отбора. «Год…»/«Кв…» — не фильтровать.">' +
            '<span class="wpm-chem-menu-lbl">Период:</span>' +
            '<select class="wpm-chem-step-select" id="wpm-chem-year" style="flex:1" onchange="wpmSetChemPeriod()"><option value="">Год…</option></select>' +
            '<select class="wpm-chem-step-select" id="wpm-chem-quarter" style="flex:1" onchange="wpmSetChemPeriod()">' +
              '<option value="">Кв…</option>' +
              '<option value="1">I</option><option value="2">II</option><option value="3">III</option><option value="4">IV</option>' +
            '</select>' +
          '</div>' +
          '<button class="wpm-btn" id="wpm-chem-png-btn" onclick="wpmExportChemPng()" title="Экспортировать слой химии в PNG (для отчёта)" style="width:100%">⬇ Экспорт в PNG</button>' +
        '</div>' +
      '</div>' +

      // Панель выбора проб для карты химии
      '<div class="wpm-chem-points-panel" id="wpm-chem-points-panel">' +
        '<div class="wpm-calc-hdr">' +
          '<span class="wpm-calc-title">☑ Пробы для карты химии</span>' +
          '<button class="wpm-calc-close" onclick="wpmCloseChemPoints()">✕</button>' +
        '</div>' +
        '<div class="wpm-chem-points-body" id="wpm-chem-points-body"></div>' +
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
    WpmState.chemRasterLayer = null;
    WpmState.chemIsoLayer = null;
    WpmState.boundaryLayer = null;
    if (WpmState.boundaryEdit) _wpmEndBoundaryDraw();
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

  WpmState.layerGroup = _wpmMakeMarkerLayer().addTo(map);
  _wpmRenderMarkers();
  map.on('click', _wpmChemMapClickHandler);

  // Слой химии переживает пересоздание карты (при возврате на вкладку) —
  // данные уже в кэше (WpmState.chemPoints), просто перерисовываем растр.
  if (WpmState.chemMode && WpmState.chemPoints && WpmState.chemPoints.length) {
    _wpmRenderChemLayer();
  }
  _wpmUpdateChemButtons();
  _wpmRenderBoundaries();
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

// ── Кластеризация маркеров (MAP-03) ──────────────────────────────
// При отдалении десятки точек сливаются в один пин с числом — иначе
// плотная группа скважин на промплощадке превращается в кашу иконок.
function _wpmMakeMarkerLayer() {
  if (typeof L.markerClusterGroup !== 'function') return L.layerGroup();
  return L.markerClusterGroup({
    maxClusterRadius: 55,
    disableClusteringAtZoom: 18,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: function(cluster) {
      var n = cluster.getChildCount();
      var sz = n < 10 ? 34 : (n < 30 ? 42 : 50);
      return L.divIcon({
        html: '<div class="wpm-cluster-icon" style="width:' + sz + 'px;height:' + sz + 'px">' + n + '</div>',
        className: 'wpm-cluster-wrap',
        iconSize: [sz, sz],
      });
    },
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
    '<button class="wpm-popup-btn" style="margin-top:6px;background:rgba(139,148,158,.1);color:var(--txt-2)" onclick="wpmGoToRegistry(\'' + escHTML(item.id).replace(/'/g,"\\'") + '\')">◫ Открыть в реестре</button>' +
    _wpmBoundaryPanelHtml(item);

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
  wpmCloseChemPoints();
  wpmCloseChemMenu();
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
//  Химическая карта — IDW-интерполяция (минерализация, pH) и
//  полигоны Вороного (тип воды по Пайперу) поверх карты водопунктов.
//
//  Источник данных: для каждого водопункта берётся самый свежий из
//  последних 5 протоколов, у которого есть валидные макрокомпоненты
//  (см. ui-chem.js: ChemState / _chemCalcMeq / _chemClassifyWaterType).
//  Метод растеризации один для всех трёх слоёв (canvas → ImageOverlay):
//  для непрерывных полей (минерализация, pH) значение в узле сетки —
//  это IDW-интерполяция по представительным пробам, для типа воды —
//  цвет ближайшей по расстоянию пробы (растеризованный эквивалент
//  диаграммы Вороного). Для непрерывных полей дополнительно строятся
//  изолинии по границам классов методом marching squares.
// ═══════════════════════════════════════════════════════════════

async function _wpmChemEnsureData() {
  if (typeof loadChemData !== 'function' || typeof ChemState === 'undefined') return false;
  if (!ChemState.loaded && !ChemState.loading) await loadChemData();

  var byWp = {};
  (ChemState.protocols || []).forEach(function(p) {
    if (!p.water_point_id) return;
    if (!byWp[p.water_point_id]) byWp[p.water_point_id] = [];
    byWp[p.water_point_id].push(p);
  });
  var asOf = WpmState.chemAsOfDate;
  var fYear = WpmState.chemFilterYear, fQuarter = WpmState.chemFilterQuarter;
  Object.keys(byWp).forEach(function(k) {
    byWp[k].sort(function(a, b) { return (b.sampled_at || '').localeCompare(a.sampled_at || ''); });
    // MAP-02: временной срез — учитываем только протоколы на дату среза или раньше
    if (asOf) byWp[k] = byWp[k].filter(function(p) { return p.sampled_at && p.sampled_at <= asOf; });
    // Фильтр по году/кварталу — карта строится только по пробам выбранного отчётного периода
    if (fYear || fQuarter) {
      byWp[k] = byWp[k].filter(function(p) {
        if (fYear && (!p.sampled_at || p.sampled_at.substring(0, 4) !== fYear)) return false;
        if (fQuarter && String(chemQuarterOf(p)) !== fQuarter) return false;
        return true;
      });
    }
  });
  _wpmRefreshChemPeriodOptions();

  // Ленивая подгрузка chem.js кэширует результаты только для первых 50
  // протоколов — догружаем недостающие для кандидатов (последние 5 на в/п).
  var needIds = [];
  Object.keys(byWp).forEach(function(k) {
    byWp[k].slice(0, 5).forEach(function(p) {
      if (!ChemState.results[p.id]) needIds.push(p.id);
    });
  });
  if (needIds.length) {
    var resArr = await Promise.all(needIds.map(function(id) { return ChemApi.getResults(id); }));
    resArr.forEach(function(res, i) {
      ChemState.results[needIds[i]] = (!res.error && res.data) ? res.data : [];
    });
  }

  var points = [];
  WpmState.items.forEach(function(item) {
    if (!item.lat || !item.lng) return;
    var list = byWp[item.id] || [];
    for (var i = 0; i < Math.min(list.length, 5); i++) {
      var meq = _chemCalcMeq(list[i].id);
      if (meq._valid) {
        points.push({ item: item, proto: list[i], meq: meq, wtype: _chemClassifyWaterType(meq) });
        break;
      }
    }
  });
  WpmState.chemPoints = points;
  return true;
}

// ── IDW (Inverse Distance Weighting), степень 2 ─────────────────
// queryLat/queryLng/boundaries — необязательные (MAP-01): если заданы,
// пробы, отрезок до которых пересекает границу водоёма, получают
// сильный штраф к весу — интерполяция «не течёт» сквозь реку/озеро.
function _wpmIdw(x, y, pts, getVal, queryLat, queryLng, boundaries) {
  var wsum = 0, vsum = 0;
  for (var i = 0; i < pts.length; i++) {
    var v = getVal(pts[i]);
    if (v == null || isNaN(v)) continue;
    var dx = x - pts[i].x, dy = y - pts[i].y;
    var d2 = dx * dx + dy * dy;
    if (d2 < 1e-10) return v;
    var w = 1 / d2;
    if (boundaries && boundaries.length && queryLat != null && pts[i].lat != null &&
        _wpmSegmentCrossesBoundary([queryLat, queryLng], [pts[i].lat, pts[i].lng], boundaries)) {
      w *= 1e-4;
    }
    wsum += w; vsum += w * v;
  }
  return wsum > 0 ? vsum / wsum : NaN;
}

// ── Marching squares: сегменты линии уровня threshold по сетке values ──
function _wpmMarchingSquares(values, nx, ny, threshold, xAt, yAt) {
  var segs = [];
  function edgePt(v1, v2, p1, p2) {
    var t = (threshold - v1) / (v2 - v1);
    return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
  }
  for (var j = 0; j < ny - 1; j++) {
    for (var i = 0; i < nx - 1; i++) {
      var vTL = values[j * nx + i],       vTR = values[j * nx + i + 1];
      var vBL = values[(j + 1) * nx + i], vBR = values[(j + 1) * nx + i + 1];
      if (isNaN(vTL) || isNaN(vTR) || isNaN(vBL) || isNaN(vBR)) continue;
      var pTL = [xAt(i), yAt(j)],     pTR = [xAt(i + 1), yAt(j)];
      var pBL = [xAt(i), yAt(j + 1)], pBR = [xAt(i + 1), yAt(j + 1)];
      var above = [vTL > threshold, vTR > threshold, vBR > threshold, vBL > threshold];
      var cnt = (above[0]?1:0) + (above[1]?1:0) + (above[2]?1:0) + (above[3]?1:0);
      if (cnt === 0 || cnt === 4) continue;
      var top    = above[0] !== above[1] ? edgePt(vTL, vTR, pTL, pTR) : null;
      var right  = above[1] !== above[2] ? edgePt(vTR, vBR, pTR, pBR) : null;
      var bottom = above[3] !== above[2] ? edgePt(vBL, vBR, pBL, pBR) : null;
      var left   = above[0] !== above[3] ? edgePt(vTL, vBL, pTL, pBL) : null;
      var pts = [top, right, bottom, left].filter(function(p) { return p; });
      if (pts.length === 2) {
        segs.push([pts[0], pts[1]]);
      } else if (pts.length === 4) {
        // Седловая неоднозначность — разрешаем по среднему значению ячейки
        var avg = (vTL + vTR + vBL + vBR) / 4;
        if (avg > threshold) { segs.push([top, left]); segs.push([right, bottom]); }
        else { segs.push([top, right]); segs.push([left, bottom]); }
      }
    }
  }
  return segs;
}

// Значение произвольного показателя каталога CHEM_PARAMS из результатов
// представительного протокола пробы (для карты «Показатель»).
function _wpmGetParamValue(protoId, key) {
  if (!key) return NaN;
  var rows = (typeof ChemState !== 'undefined' && ChemState.results[protoId]) || [];
  var row = rows.find(function(r) { return r.param_key === key; });
  if (!row) return NaN;
  if (row.value_num != null) return row.value_num;
  if (row.below_detection) return 0; // ниже предела обнаружения — принимаем за ~0
  return NaN;
}

// ── Построение растра слоя (canvas RGBA) + изолиний для непрерывных полей ──
function _wpmBuildChemRaster(mode) {
  var isCont = (mode === 'mineral' || mode === 'ph' || mode === 'param');
  var ramp = mode === 'wtype' ? null : _wpmGetRamp(mode);
  var smooth = !!WpmState.chemSmooth;
  var paramKey = WpmState.chemParamKey;
  var paramDef = (mode === 'param' && typeof CHEM_PARAM_MAP !== 'undefined') ? CHEM_PARAM_MAP[paramKey] : null;

  var getV;
  if (mode === 'mineral') getV = function(p) { return p.meq.m_gl; };
  else if (mode === 'ph') getV = function(p) { return p.meq.ph; };
  else if (mode === 'param') getV = function(p) { return _wpmGetParamValue(p.proto.id, paramKey); };

  var pts = WpmState.chemPoints.filter(function(p) {
    if (WpmState.chemExcluded[p.item.id]) return false;
    if (mode === 'mineral') return !isNaN(p.meq.m_gl);
    if (mode === 'ph')      return !isNaN(p.meq.ph);
    if (mode === 'param')   return !isNaN(getV(p));
    return true;
  });
  if (pts.length < 2) return null;

  // Диапазон шкалы — по фактическим значениям проб (IDW-интерполяция —
  // взвешенное среднее, поэтому все промежуточные значения гарантированно
  // лежат внутри [min,max] проб — шкала не тратится впустую).
  var domain = null;
  var step = mode === 'param' ? null : (WpmState.chemStep[mode] || 1);
  if (isCont) {
    var vals = pts.map(getV);
    var vMin = Math.min.apply(null, vals), vMax = Math.max.apply(null, vals);
    if (vMax - vMin < 1e-9) { var pad0 = (step || vMax * 0.05 || 0.1) / 2; vMin -= pad0; vMax += pad0; }
    domain = { min: vMin, max: vMax };
    if (mode === 'param') {
      var divisions = WpmState.chemDivisions || 10;
      step = (domain.max - domain.min) / divisions || 1;
    }
  }

  var lats = pts.map(function(p) { return p.item.lat; });
  var lngs = pts.map(function(p) { return p.item.lng; });
  var latMin = Math.min.apply(null, lats), latMax = Math.max.apply(null, lats);
  var lngMin = Math.min.apply(null, lngs), lngMax = Math.max.apply(null, lngs);
  var padLat = Math.max((latMax - latMin) * 0.3, 0.004);
  var padLng = Math.max((lngMax - lngMin) * 0.3, 0.006);
  latMin -= padLat; latMax += padLat; lngMin -= padLng; lngMax += padLng;

  // Простая проекция (коррекция по cos(lat)), чтобы IDW не искажался
  // вытянутостью градуса долготы на широте карьера (~51°).
  var cosLat = Math.cos((latMin + latMax) / 2 * Math.PI / 180) || 1;
  var proj = pts.map(function(p) {
    return { x: p.item.lng * cosLat, y: p.item.lat, lat: p.item.lat, lng: p.item.lng, meq: p.meq, wtype: p.wtype, proto: p.proto, item: p.item };
  });

  // Границы водных объектов (озёра/реки) — вырезаются из закраски,
  // т.к. интерполяция подземных вод по соседним пробам там неприменима.
  var boundaries = WpmState.items
    .filter(function(i) { return i.boundary && i.boundary.length >= 3; })
    .map(function(i) { return i.boundary; });

  var RES = 90;
  var raw = isCont ? new Array(RES * RES) : null;
  var canvas = document.createElement('canvas');
  canvas.width = RES; canvas.height = RES;
  var ctx = canvas.getContext('2d');
  var img = ctx.createImageData(RES, RES);

  for (var row = 0; row < RES; row++) {
    var lat = latMax - (row / (RES - 1)) * (latMax - latMin);
    for (var col = 0; col < RES; col++) {
      var lng = lngMin + (col / (RES - 1)) * (lngMax - lngMin);
      var x = lng * cosLat, y = lat;
      var color, gi = row * RES + col;
      if (mode === 'wtype') {
        var best = null, bestD = Infinity;
        for (var i = 0; i < proj.length; i++) {
          var dx = x - proj[i].x, dy = y - proj[i].y, d2 = dx * dx + dy * dy;
          if (boundaries.length && _wpmSegmentCrossesBoundary([lat, lng], [proj[i].lat, proj[i].lng], boundaries)) d2 *= 1e4;
          if (d2 < bestD) { bestD = d2; best = proj[i]; }
        }
        color = _wpmHexToRgb(best.wtype.color);
      } else {
        var val = _wpmIdw(x, y, proj, getV, lat, lng, boundaries);
        raw[gi] = val;
        var useVal = smooth ? val : _wpmQuantize(val, step);
        var t = (domain.max > domain.min) ? (useVal - domain.min) / (domain.max - domain.min) : 0.5;
        color = _wpmRampColor(ramp, t);
      }
      var idx = gi * 4;
      var alpha = (boundaries.length && _wpmInAnyBoundary(lat, lng, boundaries)) ? 0 : 168;
      img.data[idx] = color[0]; img.data[idx + 1] = color[1]; img.data[idx + 2] = color[2]; img.data[idx + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);

  var isoLevels = [];
  if (isCont && !smooth) {
    var xAt = function(col) { return lngMin + (col / (RES - 1)) * (lngMax - lngMin); };
    var yAt = function(row) { return latMax - (row / (RES - 1)) * (latMax - latMin); };
    // Изолинии должны идти ровно по границам цветовых ступеней растра.
    // _wpmQuantize() округляет к БЛИЖАЙШЕМУ кратному step (Math.round),
    // поэтому сама ступень "kk·step" занимает интервал [kk·step − step/2,
    // kk·step + step/2) — её границы лежат на полшага в стороне от
    // кратных step, а не точно на них. Прежний расчёт брал уровни ровно
    // по kk·step, и линия проходила через середину ступени, а не по её
    // видимой границе — отсюда "пропавшие" изолинии на некоторых шагах.
    var levelStart = (Math.ceil(domain.min / step - 0.5) + 0.5) * step;
    var levels = [];
    for (var k = 0; ; k++) {
      var lvVal = Math.round((levelStart + k * step) * 1e6) / 1e6;
      if (lvVal >= domain.max - 1e-9) break;
      levels.push(lvVal);
    }
    // Защита от чрезмерного числа изолиний при очень мелком шаге —
    // прореживаем сами линии (заливка при этом остаётся точной).
    var MAX_ISO_LEVELS = 150;
    if (levels.length > MAX_ISO_LEVELS) {
      var stride = Math.ceil(levels.length / MAX_ISO_LEVELS);
      levels = levels.filter(function(_, idx) { return idx % stride === 0; });
    }
    levels.forEach(function(lvVal) {
      var segs = _wpmMarchingSquares(raw, RES, RES, lvVal, xAt, yAt);
      if (boundaries.length) {
        segs = segs.filter(function(seg) {
          var mLng = (seg[0][0] + seg[1][0]) / 2, mLat = (seg[0][1] + seg[1][1]) / 2;
          return !_wpmInAnyBoundary(mLat, mLng, boundaries);
        });
      }
      if (segs.length) isoLevels.push({ value: lvVal, segs: segs });
    });
  }

  return {
    dataUrl: canvas.toDataURL(),
    bounds: [[latMin, lngMin], [latMax, lngMax]],
    isoLevels: isoLevels,
    n: pts.length,
    domain: domain,
    step: step,
    smooth: smooth,
    // Для запроса значения по клику (MAP-04) — те же точки/веса, что и растр.
    mode: mode, proj: proj, getV: getV, boundaries: boundaries, cosLat: cosLat, paramDef: paramDef,
  };
}

function _wpmClearChemLayer() {
  if (WpmState.map && WpmState.chemRasterLayer) WpmState.map.removeLayer(WpmState.chemRasterLayer);
  if (WpmState.map && WpmState.chemIsoLayer)    WpmState.map.removeLayer(WpmState.chemIsoLayer);
  WpmState.chemRasterLayer = null;
  WpmState.chemIsoLayer = null;
}

function _wpmRenderChemLayer() {
  _wpmClearChemLayer();
  if (!WpmState.map || !WpmState.chemMode) { WpmState._chemLast = null; _wpmRenderChemLegend(); return true; }

  var built = _wpmBuildChemRaster(WpmState.chemMode);
  if (!built) { WpmState._chemLast = null; return false; }

  var cls = 'wpm-chem-raster' + (WpmState.chemMode === 'wtype' ? ' wpm-chem-crisp' : '');
  var overlay = L.imageOverlay(built.dataUrl, built.bounds, { opacity: 1, interactive: false, className: cls });
  overlay.addTo(WpmState.map);
  WpmState.chemRasterLayer = overlay;

  if (built.isoLevels.length) {
    var grp = L.layerGroup();
    built.isoLevels.forEach(function(level) {
      level.segs.forEach(function(seg) {
        L.polyline([[seg[0][1], seg[0][0]], [seg[1][1], seg[1][0]]], {
          color: '#ffffff', weight: 1.1, opacity: 0.8, interactive: false,
        }).addTo(grp);
      });
    });
    grp.addTo(WpmState.map);
    WpmState.chemIsoLayer = grp;
  }

  WpmState._chemLast = built;
  _wpmRenderChemLegend();
  return true;
}

// ── Клик по карте — значение в точке + ближайшие пробы (MAP-04) ──
// Работает поверх уже построенного растра (WpmState._chemLast), поэтому
// не требует пересчёта IDW-сетки — только точечный запрос под курсором.
function _wpmChemMapClickHandler(e) {
  if (WpmState.boundaryEdit) return; // рисование границы — приоритетнее
  if (!WpmState.chemMode) return;
  var built = WpmState._chemLast;
  if (!built || !built.proj || !built.proj.length) return;

  var lat = e.latlng.lat, lng = e.latlng.lng;
  var mode = built.mode;

  var withDist = built.proj.map(function(p) {
    var dLat = p.lat - lat, dLng = (p.lng - lng) * built.cosLat;
    return { p: p, km: Math.sqrt(dLat * dLat + dLng * dLng) * 111.2 };
  }).sort(function(a, b) { return a.km - b.km; });
  var nearest = withDist.slice(0, 3);

  var title, valueHtml;
  if (mode === 'wtype') {
    var best = nearest[0] ? nearest[0].p : null;
    title = '💧 Тип воды (ближайшая проба)';
    if (best) {
      valueHtml = '<div class="wpm-click-val" style="color:' + best.wtype.color + '">' + escHTML(best.wtype.label) + '</div>' +
        '<div class="wpm-click-note">' + escHTML(best.item.name) + (best.proto && best.proto.sampled_at ? ' · ' + _chemFmtDate(best.proto.sampled_at) : '') + '</div>' +
        '<div style="margin-top:8px">' + _chemBuildKurlov(best.meq) + '</div>';
    } else {
      valueHtml = '—';
    }
  } else {
    var x = lng * built.cosLat, y = lat;
    var val = _wpmIdw(x, y, built.proj, built.getV, lat, lng, built.boundaries);
    var pd = built.paramDef;
    var unit = mode === 'mineral' ? ' г/л' : mode === 'param' ? (' ' + (pd ? pd.unit : '')) : '';
    var decimals = mode === 'ph' ? 2 : (mode === 'param' && built.domain && (built.domain.max - built.domain.min) < 1 ? 4 : 3);
    title = mode === 'mineral' ? '🧂 Минерализация (интерполяция)' : mode === 'ph' ? '⚗️ pH (интерполяция)' :
      '🔬 ' + (pd ? pd.name : WpmState.chemParamKey) + ' (интерполяция)';
    var flagged = mode === 'param' && pd && pd.pdk_type === 'max' && pd.pdk_drink != null && !isNaN(val) && val > pd.pdk_drink;
    valueHtml = '<div class="wpm-click-val' + (flagged ? ' flag' : '') + '">' + (isNaN(val) ? '—' : val.toFixed(decimals) + unit) + '</div>';
    if (flagged) valueHtml += '<div class="wpm-click-note">Выше ПДК (' + pd.pdk_drink + unit + ')</div>';
  }

  var nearHtml = nearest.map(function(n) {
    return '<div class="wpm-click-near"><span>' + escHTML(n.p.item.name) + '</span><span>' + n.km.toFixed(2) + ' км</span></div>';
  }).join('');

  var html = '<div class="wpm-click-title">' + title + '</div>' + valueHtml +
    '<div class="wpm-click-near-title">Ближайшие пробы:</div>' + nearHtml +
    '<div class="wpm-click-note" style="margin-top:6px">Оценка по IDW — не измеренное значение.</div>';

  L.popup({ maxWidth: 300, className: 'wpm-click-popup' })
    .setLatLng(e.latlng)
    .setContent(html)
    .openOn(WpmState.map);
}

function _wpmRenderChemLegend() {
  var el = document.getElementById('wpm-chem-legend');
  if (!el) return;
  var mode = WpmState.chemMode;
  if (!mode) { el.classList.remove('open'); el.innerHTML = ''; return; }

  var built = WpmState._chemLast;
  var n = built ? built.n : (WpmState.chemPoints || []).length;
  var paramDef = (mode === 'param' && typeof CHEM_PARAM_MAP !== 'undefined') ? CHEM_PARAM_MAP[WpmState.chemParamKey] : null;
  var title = mode === 'mineral' ? '🧂 Минерализация (IDW)' : mode === 'ph' ? '⚗️ pH (IDW)' :
    mode === 'param' ? '🔬 ' + (paramDef ? paramDef.name : WpmState.chemParamKey) + ' (IDW)' :
    '💧 Тип воды по Пайперу (Вороной)';
  var html = '<div class="wpm-chem-legend-title">' + title + '</div>';

  var excludedCount = Object.keys(WpmState.chemExcluded).length;
  html += '<div style="margin-bottom:6px"><a href="#" onclick="wpmToggleChemPoints();return false" style="font-size:10px;color:var(--blue)">☑ Выбрать пробы' +
    (excludedCount ? ' (' + excludedCount + ' искл.)' : '') + '</a></div>';

  if (mode === 'wtype') {
    var seenKeys = {};
    (WpmState.chemPoints || []).forEach(function(p) { seenKeys[p.wtype.key] = true; });
    WPM_ALEKIN_FACIES.forEach(function(f) {
      var present = !!seenKeys[f.key];
      var color = (typeof _CHEM_WTYPE_COLORS !== 'undefined' && _CHEM_WTYPE_COLORS[f.key]) || '#94a3b8';
      html += '<div class="wpm-chem-legend-row"' + (present ? '' : ' style="opacity:.35"') + '>' +
        '<span class="wpm-chem-legend-sw" style="background:' + color + '"></span>' + f.label +
        (present ? '' : ' <span style="font-size:9px">— нет проб</span>') +
      '</div>';
    });
    html += '<div class="wpm-chem-legend-note">Полная классификация по Алёкину (9 фаций: 3 катиона × 3 аниона). Область закрашена цветом ближайшей по расстоянию пробы (полигоны Вороного). Проб: ' + n + '. Клик по карте — формула Курлова ближайшей пробы.</div>';
  } else {
    var ramp = _wpmGetRamp(mode);
    var unit = mode === 'mineral' ? ' г/л' : mode === 'param' ? (' ' + (paramDef ? paramDef.unit : '')) : '';
    var domain = built ? built.domain : null;
    var curStep = mode === 'param' ? (built ? built.step : null) : WpmState.chemStep[mode];
    var decimals = mode === 'param'
      ? (domain && (domain.max - domain.min) < 1 ? 4 : (domain && (domain.max - domain.min) < 10 ? 3 : 2))
      : (WpmState.chemStep[mode] < 0.1 ? 2 : (WpmState.chemStep[mode] < 1 ? 1 : 2));
    var stops = ramp.map(function(s) { return s.color + ' ' + (s.stop * 100) + '%'; }).join(', ');

    html += '<div style="position:relative;height:12px;border-radius:4px;background:linear-gradient(to right,' + stops + ')">';
    if (mode === 'param' && paramDef && paramDef.pdk_type === 'max' && paramDef.pdk_drink != null && domain && domain.max > domain.min) {
      var pdkT = Math.max(0, Math.min(1, (paramDef.pdk_drink - domain.min) / (domain.max - domain.min)));
      html += '<div title="ПДК (питьевая): ' + paramDef.pdk_drink + unit + '" style="position:absolute;top:-2px;bottom:-2px;left:' + (pdkT * 100) + '%;width:2px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.5)"></div>';
    }
    html += '</div>';
    if (domain) {
      html += '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--txt-2);margin-top:3px;font-weight:600">' +
        '<span>' + domain.min.toFixed(decimals) + unit + '</span>' +
        '<span>' + domain.max.toFixed(decimals) + unit + '</span>' +
      '</div>';
    }
    html += '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--txt-3);margin-bottom:8px">' +
      '<span>' + (ramp[0].label || '') + '</span><span>' + (ramp[ramp.length - 1].label || '') + '</span>' +
    '</div>';

    if (mode === 'param') {
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
        '<span style="font-size:11px;color:var(--txt-3)">Число ступеней:</span>' +
        '<select class="wpm-chem-step-select"' + (WpmState.chemSmooth ? ' disabled' : '') + ' onchange="wpmSetChemDivisions(this.value)">' +
          WPM_DIVISION_PRESETS.map(function(d) {
            return '<option value="' + d + '"' + (WpmState.chemDivisions === d ? ' selected' : '') + '>' + d + '</option>';
          }).join('') +
        '</select>' +
      '</div>';
    } else {
      html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
        '<span style="font-size:11px;color:var(--txt-3)">Шаг ступени:</span>' +
        '<select class="wpm-chem-step-select"' + (WpmState.chemSmooth ? ' disabled' : '') + ' onchange="wpmSetChemStep(\'' + mode + '\', this.value)">' +
          WPM_STEP_PRESETS[mode].map(function(s) {
            return '<option value="' + s + '"' + (WpmState.chemStep[mode] === s ? ' selected' : '') + '>' + s + unit + '</option>';
          }).join('') +
        '</select>' +
      '</div>';
    }

    html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
      '<span style="font-size:11px;color:var(--txt-3)">Палитра:</span>' +
      '<select class="wpm-chem-step-select" onchange="wpmSetChemPalette(this.value)">' +
        Object.keys(WPM_PALETTES).map(function(k) {
          return '<option value="' + k + '"' + ((WpmState.chemPalette || 'classic') === k ? ' selected' : '') + '>' + WPM_PALETTES[k].label + '</option>';
        }).join('') +
      '</select>' +
    '</div>';

    var pdkNote = (mode === 'param' && paramDef && paramDef.pdk_type === 'max' && paramDef.pdk_drink != null)
      ? ' Белая метка на шкале — ПДК (питьевая): ' + paramDef.pdk_drink + unit + '.' : '';
    var hasBoundary = WpmState.items.some(function(i) { return i.boundary && i.boundary.length >= 3; });
    html += '<div class="wpm-chem-legend-note">' +
      (WpmState.chemSmooth
        ? 'Гладкий градиент без ступеней и изолиний.'
        : 'Ступенчатая заливка с шагом ' + (curStep != null ? curStep.toFixed(decimals) : '') + unit + ' (белые линии — границы ступеней).') +
      pdkNote +
      ' Приближённая интерполяция IDW по ' + n + ' пробам.' +
      (hasBoundary ? ' Границы водоёмов учтены как барьер — интерполяция не «перетекает» через них.' : '') +
      ' При малом числе проб — оценочно, не заменяет специализированные геохимические изыскания.' +
    '</div>';
  }

  el.innerHTML = html;
  el.classList.add('open');
}

// ── Подложка (спутник/карта/рельеф) для PNG-экспорта ──────────────
// Растр химии в canvas — свой (без CORS-проблем), но сами тайлы подложки
// подгружаются с внешних серверов, поэтому рисуем их через img.crossOrigin=
// 'anonymous': тайл, который сервер не отдаёт с CORS-заголовком, просто не
// загрузится (onerror) и останется как есть на нейтральной заливке — так
// холст никогда не "запятнается" и export не падает целиком из-за одного
// неудачного слоя (у OSM/OpenTopoMap CORS не всегда есть, у Esri обычно есть).
function _wpmTileXY(lat, lng, z) {
  var n = Math.pow(2, z);
  var x = Math.floor((lng + 180) / 360 * n);
  var latRad = lat * Math.PI / 180;
  var y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x: x, y: y };
}
function _wpmTileLng(x, z) { return x / Math.pow(2, z) * 360 - 180; }
function _wpmTileLat(y, z) {
  var n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
function _wpmTileUrl(layer, z, x, y) {
  if (layer === 'satellite') return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + y + '/' + x;
  if (layer === 'street') return 'https://a.tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png';
  if (layer === 'topo') return 'https://a.tile.opentopomap.org/' + z + '/' + x + '/' + y + '.png';
  return null;
}
function _wpmLoadTileImg(url) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() { resolve(img); };
    img.onerror = function() { resolve(null); };
    img.src = url;
  });
}
// Рисует мозаику тайлов слоя layerName, покрывающую bounds, в прямоугольник
// [dx,dy,dw,dh] на ctx. Возвращает {attempted, loaded} для сообщения пользователю.
async function _wpmDrawBasemap(ctx, bounds, dx, dy, dw, dh, layerName) {
  var TILE = 256;
  if (!layerName || !_wpmTileUrl(layerName, 1, 0, 0)) return { attempted: 0, loaded: 0 };

  var lngSpan = bounds[1][1] - bounds[0][1];
  var z = 19;
  while (z > 1) {
    var tilesAcross = lngSpan / 360 * Math.pow(2, z);
    if (tilesAcross * TILE <= dw * 1.3) break;
    z--;
  }
  if (layerName === 'topo') z = Math.min(z, 17);

  var tl = _wpmTileXY(bounds[1][0], bounds[0][1], z);
  var br = _wpmTileXY(bounds[0][0], bounds[1][1], z);
  var x0 = tl.x, y0 = Math.min(tl.y, br.y), x1 = br.x, y1 = Math.max(tl.y, br.y);
  // Защита от огромной мозаики (напр. очень широкая область при мелком z).
  while ((x1 - x0 + 1) * (y1 - y0 + 1) > 400 && z > 1) {
    z--;
    tl = _wpmTileXY(bounds[1][0], bounds[0][1], z);
    br = _wpmTileXY(bounds[0][0], bounds[1][1], z);
    x0 = tl.x; y0 = Math.min(tl.y, br.y); x1 = br.x; y1 = Math.max(tl.y, br.y);
  }

  var mosaic = document.createElement('canvas');
  mosaic.width = (x1 - x0 + 1) * TILE;
  mosaic.height = (y1 - y0 + 1) * TILE;
  var mctx = mosaic.getContext('2d');

  var attempted = 0, loaded = 0, jobs = [];
  for (var ty = y0; ty <= y1; ty++) {
    for (var tx = x0; tx <= x1; tx++) {
      attempted++;
      (function(tx, ty) {
        jobs.push(_wpmLoadTileImg(_wpmTileUrl(layerName, z, tx, ty)).then(function(img) {
          if (img) { mctx.drawImage(img, (tx - x0) * TILE, (ty - y0) * TILE, TILE, TILE); loaded++; }
        }));
      })(tx, ty);
    }
  }
  await Promise.all(jobs);
  if (!loaded) return { attempted: attempted, loaded: 0 };

  var mosaicWestLng = _wpmTileLng(x0, z), mosaicEastLng = _wpmTileLng(x1 + 1, z);
  var mosaicNorthLat = _wpmTileLat(y0, z), mosaicSouthLat = _wpmTileLat(y1 + 1, z);
  var srcX    = (bounds[0][1] - mosaicWestLng) / (mosaicEastLng - mosaicWestLng) * mosaic.width;
  var srcXEnd = (bounds[1][1] - mosaicWestLng) / (mosaicEastLng - mosaicWestLng) * mosaic.width;
  var srcYTop = (mosaicNorthLat - bounds[1][0]) / (mosaicNorthLat - mosaicSouthLat) * mosaic.height;
  var srcYBot = (mosaicNorthLat - bounds[0][0]) / (mosaicNorthLat - mosaicSouthLat) * mosaic.height;
  ctx.drawImage(mosaic, srcX, srcYTop, srcXEnd - srcX, srcYBot - srcYTop, dx, dy, dw, dh);
  return { attempted: attempted, loaded: loaded };
}

// ── Экспорт слоя химии в PNG (MAP-05) ─────────────────────────────
// Печатный вид: подложка (спутник/карта/рельеф — как на экране) + растр химии
// (полупрозрачный, как и в самом приложении) + изолинии + точки проб.
function wpmExportChemPng() {
  var built = WpmState._chemLast;
  if (!WpmState.chemMode || !built) {
    if (typeof Toast !== 'undefined') Toast.show('Сначала включите слой химии на карте', 'error');
    return;
  }
  var mode = built.mode;
  var pd = built.paramDef;

  var img = new Image();
  img.onload = function() { _wpmDrawChemPng(built, mode, pd, img); };
  img.src = built.dataUrl;
}

async function _wpmDrawChemPng(built, mode, pd, rasterImg) {
  var PAD = 30, TITLE_H = 74, W = 1300;
  var latSpan = built.bounds[1][0] - built.bounds[0][0];
  var lngSpan = built.bounds[1][1] - built.bounds[0][1];
  var aspect = (lngSpan * built.cosLat) / latSpan;
  var mapW = W - PAD * 2;
  var mapH = Math.round(mapW / aspect);
  var LEGEND_H = 90;
  var H = TITLE_H + mapH + LEGEND_H + PAD;

  var canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');

  ctx.fillStyle = '#eef2f7';
  ctx.fillRect(0, 0, W, H);

  var title = mode === 'mineral' ? 'Минерализация подземных вод (IDW)' :
    mode === 'ph' ? 'Водородный показатель pH (IDW)' :
    mode === 'param' ? (pd ? pd.name : WpmState.chemParamKey) + ' (IDW)' :
    'Тип воды по классификации Алёкина (Вороной)';
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 22px Segoe UI, Arial, sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText('Карьер ЮРГ — ' + title, PAD, 16);

  var asOfTxt = WpmState.chemAsOfDate ? ('срез на ' + _chemFmtDate(WpmState.chemAsOfDate)) : 'по последним пробам';
  ctx.font = '400 13px Segoe UI, Arial, sans-serif';
  ctx.fillStyle = '#64748b';
  ctx.fillText('Проб: ' + built.n + ' · ' + asOfTxt + ' · сформировано ' + new Date().toLocaleDateString('ru-RU'), PAD, 44);

  var mapX = PAD, mapY = TITLE_H;
  ctx.save();
  ctx.beginPath();
  ctx.rect(mapX, mapY, mapW, mapH);
  ctx.clip();
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(mapX, mapY, mapW, mapH);
  var tileStats = { attempted: 0, loaded: 0 };
  try {
    tileStats = await _wpmDrawBasemap(ctx, built.bounds, mapX, mapY, mapW, mapH, WpmState.activeLayer);
  } catch (e) { /* подложка недоступна — остаётся нейтральная заливка */ }
  ctx.drawImage(rasterImg, mapX, mapY, mapW, mapH);

  function toPx(lat, lng) {
    var tx = (lng - built.bounds[0][1]) / lngSpan;
    var ty = 1 - (lat - built.bounds[0][0]) / latSpan;
    return [mapX + tx * mapW, mapY + ty * mapH];
  }

  // Изолинии
  if (built.isoLevels && built.isoLevels.length) {
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 1;
    built.isoLevels.forEach(function(level) {
      level.segs.forEach(function(seg) {
        var p1 = toPx(seg[0][1], seg[0][0]), p2 = toPx(seg[1][1], seg[1][0]);
        ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
      });
    });
  }

  // Точки проб, участвовавшие в интерполяции
  built.proj.forEach(function(p) {
    var pt = toPx(p.lat, p.lng);
    ctx.beginPath();
    ctx.arc(pt[0], pt[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(pt[0], pt[1], 4, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    var name = p.item.name.length > 12 ? p.item.name.slice(0, 11) + '…' : p.item.name;
    ctx.font = '600 10px Segoe UI, Arial, sans-serif';
    var tw = ctx.measureText(name).width;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.fillRect(pt[0] - tw / 2 - 3, pt[1] + 6, tw + 6, 13);
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    ctx.fillText(name, pt[0], pt[1] + 8);
    ctx.textAlign = 'left';
  });

  ctx.restore();
  ctx.strokeStyle = 'rgba(15,23,42,.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(mapX, mapY, mapW, mapH);

  // Легенда
  var legY = TITLE_H + mapH + 16;
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 13px Segoe UI, Arial, sans-serif';
  ctx.fillText(title, PAD, legY);

  if (mode === 'wtype') {
    var seenKeys = {};
    built.proj.forEach(function(p) { seenKeys[p.wtype.key] = true; });
    var lx = PAD;
    WPM_ALEKIN_FACIES.forEach(function(f) {
      var present = !!seenKeys[f.key];
      var color = (typeof _CHEM_WTYPE_COLORS !== 'undefined' && _CHEM_WTYPE_COLORS[f.key]) || '#94a3b8';
      ctx.globalAlpha = present ? 1 : 0.35;
      ctx.fillStyle = color;
      ctx.fillRect(lx, legY + 22, 12, 12);
      ctx.fillStyle = '#334155';
      ctx.font = '400 12px Segoe UI, Arial, sans-serif';
      ctx.fillText(f.label, lx + 16, legY + 22);
      ctx.globalAlpha = 1;
      lx += 18 + ctx.measureText(f.label).width + 20;
    });
  } else {
    var ramp = _wpmGetRamp(mode);
    var unit = mode === 'mineral' ? ' г/л' : mode === 'param' ? (' ' + (pd ? pd.unit : '')) : '';
    var domain = built.domain;
    var decimals = mode === 'param'
      ? (domain && (domain.max - domain.min) < 1 ? 4 : (domain && (domain.max - domain.min) < 10 ? 3 : 2))
      : (WpmState.chemStep[mode] < 0.1 ? 2 : (WpmState.chemStep[mode] < 1 ? 1 : 2));
    var barW = 400, barX = PAD, barY = legY + 18, barH = 14;
    var grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    ramp.forEach(function(s) { grad.addColorStop(s.stop, s.color); });
    ctx.fillStyle = grad;
    ctx.fillRect(barX, barY, barW, barH);
    ctx.strokeStyle = 'rgba(15,23,42,.2)';
    ctx.strokeRect(barX, barY, barW, barH);
    if (mode === 'param' && pd && pd.pdk_type === 'max' && pd.pdk_drink != null && domain && domain.max > domain.min) {
      var pdkT = Math.max(0, Math.min(1, (pd.pdk_drink - domain.min) / (domain.max - domain.min)));
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(barX + pdkT * barW - 1, barY - 3, 2, barH + 6);
      ctx.font = '600 10px Segoe UI, Arial, sans-serif';
      ctx.fillText('ПДК', barX + pdkT * barW - 10, barY - 15);
    }
    if (domain) {
      ctx.fillStyle = '#334155';
      ctx.font = '600 11px Segoe UI, Arial, sans-serif';
      ctx.fillText(domain.min.toFixed(decimals) + unit, barX, barY + barH + 4);
      ctx.textAlign = 'right';
      ctx.fillText(domain.max.toFixed(decimals) + unit, barX + barW, barY + barH + 4);
      ctx.textAlign = 'left';
    }
  }

  var fname = 'химия_' + mode + (WpmState.chemAsOfDate ? '_' + WpmState.chemAsOfDate : '') + '.png';
  canvas.toBlob(function(blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
    if (typeof Toast !== 'undefined') {
      if (tileStats.attempted > 0 && tileStats.loaded === 0) {
        Toast.show('PNG сохранён, но подложка карты не загрузилась (сервер тайлов не поддерживает экспорт) — сохранены только данные химии', 'warning');
      } else if (tileStats.loaded < tileStats.attempted) {
        Toast.show('PNG сохранён (часть подложки не загрузилась: ' + tileStats.loaded + '/' + tileStats.attempted + ' тайлов)', 'warning');
      } else {
        Toast.show('PNG сохранён', 'success');
      }
    }
  }, 'image/png');
}

function _wpmUpdateChemButtons() {
  var ids = { 'null': 'wpm-chem-off', mineral: 'wpm-chem-mineral', ph: 'wpm-chem-ph', wtype: 'wpm-chem-wtype' };
  Object.keys(ids).forEach(function(k) {
    var btn = document.getElementById(ids[k]);
    if (btn) btn.classList.toggle('active', (k === 'null' ? null : k) === WpmState.chemMode);
  });
  var smoothBtn = document.getElementById('wpm-chem-smooth');
  if (smoothBtn) smoothBtn.classList.toggle('active', WpmState.chemSmooth);
  var paramSel = document.getElementById('wpm-chem-param-select');
  if (paramSel) paramSel.value = (WpmState.chemMode === 'param') ? (WpmState.chemParamKey || '') : '';
  _wpmUpdateAsOfLabel();
  var menuBtn = document.getElementById('wpm-chem-menu-btn');
  if (menuBtn) menuBtn.classList.toggle('active', !!WpmState.chemMode);
}

// ── Меню слоёв химии (UX-01) ──────────────────────────────────────
function wpmToggleChemMenu() {
  var p = document.getElementById('wpm-chem-menu');
  if (!p) return;
  var isOpen = p.classList.contains('open');
  wpmCloseSettings();
  wpmCloseCalc();
  wpmCloseChemPoints();
  p.classList.toggle('open', !isOpen);
  if (!isOpen && typeof loadChemData === 'function') {
    // Открыли меню — подгружаем список протоколов (если ещё не грузили),
    // чтобы селект "Год" в фильтре периода не оставался пустым.
    Promise.resolve(ChemState.loaded ? null : loadChemData()).then(_wpmRefreshChemPeriodOptions);
  }
}
function wpmCloseChemMenu() {
  var p = document.getElementById('wpm-chem-menu');
  if (p) p.classList.remove('open');
}

// Шаг ступени квантования (влияет на минерализацию/pH — «Тип воды» категориален).
function wpmSetChemStep(mode, step) {
  var v = parseFloat(step);
  if (!v || v <= 0) return;
  WpmState.chemStep[mode] = v;
  if (WpmState.chemMode === mode) _wpmRenderChemLayer();
}

// Гладкий градиент (без ступеней/изолиний) — переключатель, независимый
// от выбранного слоя, но действует только для минерализации/pH.
function wpmToggleChemSmooth() {
  WpmState.chemSmooth = !WpmState.chemSmooth;
  _wpmUpdateChemButtons();
  if (WpmState.chemMode === 'mineral' || WpmState.chemMode === 'ph' || WpmState.chemMode === 'param') _wpmRenderChemLayer();
}

async function wpmSetChemLayer(mode) {
  if (WpmState.chemLoading) return;
  if (WpmState.chemMode === mode) mode = null; // повторный клик по активной кнопке — выключить

  if (!mode) {
    WpmState.chemMode = null;
    WpmState.chemParamKey = null;
    _wpmClearChemLayer();
    _wpmRenderChemLegend();
    _wpmUpdateChemButtons();
    return;
  }

  WpmState.chemLoading = true;
  _wpmUpdateChemButtons();
  try {
    await _wpmChemEnsureData();
    WpmState.chemMode = mode;
    WpmState.chemParamKey = null;
    var ok = _wpmRenderChemLayer();
    if (!ok) {
      WpmState.chemMode = null;
      _wpmClearChemLayer();
      if (typeof Toast !== 'undefined') Toast.show('Недостаточно данных для этого слоя (нужно ≥2 проб с координатами и нужным показателем)', 'error');
    }
  } finally {
    WpmState.chemLoading = false;
    _wpmUpdateChemButtons();
  }
}

// Карта по произвольному показателю каталога CHEM_PARAMS (металлы,
// радиология, органика и т.д.) — та же механика (IDW/ступени/градиент/
// изолинии/исключение проб/границы водоёмов), что и у минерализации/pH.
async function wpmSetChemParam(key) {
  if (WpmState.chemLoading) return;
  if (!key) { await wpmSetChemLayer(null); return; }
  if (WpmState.chemMode === 'param' && WpmState.chemParamKey === key) { await wpmSetChemLayer(null); return; }

  WpmState.chemLoading = true;
  _wpmUpdateChemButtons();
  try {
    await _wpmChemEnsureData();
    WpmState.chemMode = 'param';
    WpmState.chemParamKey = key;
    var ok = _wpmRenderChemLayer();
    if (!ok) {
      WpmState.chemMode = null;
      WpmState.chemParamKey = null;
      _wpmClearChemLayer();
      var pDef = (typeof CHEM_PARAM_MAP !== 'undefined') ? CHEM_PARAM_MAP[key] : null;
      if (typeof Toast !== 'undefined') Toast.show('Недостаточно данных по показателю «' + (pDef ? pDef.name : key) + '» (нужно ≥2 проб с этим значением)', 'error');
    }
  } finally {
    WpmState.chemLoading = false;
    _wpmUpdateChemButtons();
  }
}

// ── MAP-02: временной срез карты химии ───────────────────────────
// По умолчанию карта строится по последней доступной пробе каждого
// водопункта; здесь можно «отмотать» на дату — тогда для каждого в/п
// берётся последняя проба НЕ ПОЗЖЕ выбранной даты (сравнение сезонов/лет).
async function wpmSetChemAsOf(dateStr) {
  WpmState.chemAsOfDate = dateStr || null;
  _wpmUpdateAsOfLabel();
  if (!WpmState.chemMode) return;
  WpmState.chemLoading = true;
  _wpmUpdateChemButtons();
  try {
    await _wpmChemEnsureData();
    var ok = _wpmRenderChemLayer();
    if (!ok && typeof Toast !== 'undefined') {
      Toast.show('На эту дату недостаточно данных для текущего слоя', 'error');
    }
  } finally {
    WpmState.chemLoading = false;
    _wpmUpdateChemButtons();
  }
}
function wpmClearChemAsOf() {
  var inp = document.getElementById('wpm-chem-asof');
  if (inp) inp.value = '';
  wpmSetChemAsOf(null);
}
function _wpmUpdateAsOfLabel() {
  var btn = document.getElementById('wpm-chem-asof-clear');
  if (btn) btn.style.display = WpmState.chemAsOfDate ? 'inline-flex' : 'none';
}

// Фильтр карты химии по году/кварталу — под квартальную периодичность
// отбора проб: карта строится только по пробам выбранного периода, а не
// "последней доступной" (в отличие от MAP-02 "На дату" — здесь именно
// изоляция конкретного отчётного квартала, оба фильтра можно сочетать).
async function wpmSetChemPeriod() {
  var yearSel = document.getElementById('wpm-chem-year');
  var qSel    = document.getElementById('wpm-chem-quarter');
  WpmState.chemFilterYear    = yearSel ? yearSel.value : '';
  WpmState.chemFilterQuarter = qSel    ? qSel.value    : '';
  if (!WpmState.chemMode) return;
  WpmState.chemLoading = true;
  _wpmUpdateChemButtons();
  try {
    await _wpmChemEnsureData();
    var ok = _wpmRenderChemLayer();
    if (!ok && typeof Toast !== 'undefined') {
      Toast.show('За выбранный период недостаточно данных для текущего слоя', 'error');
    }
  } finally {
    WpmState.chemLoading = false;
    _wpmUpdateChemButtons();
  }
}

// Список годов в select #wpm-chem-year собирается из уже загруженных
// протоколов — на момент первого рендера меню (в _wpmPageHtml) данные
// химии ещё могли не подгрузиться, поэтому пересобираем при каждом
// _wpmChemEnsureData(), сохраняя текущий выбор пользователя.
function _wpmRefreshChemPeriodOptions() {
  var sel = document.getElementById('wpm-chem-year');
  if (!sel || typeof ChemState === 'undefined') return;
  var cur = WpmState.chemFilterYear || sel.value;
  var years = {};
  (ChemState.protocols || []).forEach(function(p) { if (p.sampled_at) years[p.sampled_at.substring(0, 4)] = true; });
  var opts = Object.keys(years).sort(function(a, b) { return b - a; }).map(function(y) {
    return '<option value="' + y + '"' + (cur === y ? ' selected' : '') + '>' + y + '</option>';
  }).join('');
  sel.innerHTML = '<option value="">Год…</option>' + opts;
}

// Число ступеней для карты «Показатель» (масштаб у показателей разный,
// поэтому вместо абсолютного шага — доля от фактического диапазона проб).
function wpmSetChemDivisions(val) {
  var v = parseInt(val, 10);
  if (!v || v <= 0) return;
  WpmState.chemDivisions = v;
  if (WpmState.chemMode === 'param') _wpmRenderChemLayer();
}

// Палитра шкалы (MAP-07) — сохраняется в localStorage, т.к. это личное
// предпочтение пользователя (напр. для дальтоников), а не свойство данных.
var WPM_CHEM_PALETTE_KEY = 'wpm-chem-palette';
function wpmSetChemPalette(val) {
  if (!WPM_PALETTES[val]) return;
  WpmState.chemPalette = val;
  try { localStorage.setItem(WPM_CHEM_PALETTE_KEY, val); } catch(e) {}
  if (WpmState.chemMode && WpmState.chemMode !== 'wtype') _wpmRenderChemLayer();
}
function _wpmLoadChemPalette() {
  try {
    var v = localStorage.getItem(WPM_CHEM_PALETTE_KEY);
    if (v && WPM_PALETTES[v]) WpmState.chemPalette = v;
  } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════
//  Границы водных объектов (озёра/реки) — рисуются вручную на карте
//  и привязываются к водопункту (wp_registry.boundary, JSON [[lat,lng],...]).
//  Карта химии вырезает эти области из закраски (см. _wpmBuildChemRaster) —
//  интерполяция по соседним пробам подземных вод не должна «дорисовывать»
//  цвет поверх открытой воды, с которой она гидравлически не связана.
// ═══════════════════════════════════════════════════════════════

function _wpmBoundaryPanelHtml(item) {
  var has = item.boundary && item.boundary.length >= 3;
  var idArg = "'" + escHTML(item.id).replace(/'/g, "\\'") + "'";
  return (
    '<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line)">' +
      '<div class="wpm-info-lbl" style="margin-bottom:6px">Граница объекта (озеро/река)</div>' +
      (has
        ? '<div style="font-size:12px;color:var(--txt-2);margin-bottom:6px">✓ задана (' + item.boundary.length + ' точек) — вырезается из карты химии</div>'
        : '<div style="font-size:12px;color:var(--txt-3);margin-bottom:6px">не задана</div>') +
      '<div style="display:flex;gap:6px">' +
        '<button class="wpm-popup-btn" style="width:auto;flex:1" onclick="wpmStartBoundaryDraw(' + idArg + ')">🖊 ' + (has ? 'Изменить' : 'Нарисовать') + '</button>' +
        (has ? '<button class="wpm-popup-btn" style="width:auto;background:rgba(248,113,113,.12);color:#f87171" onclick="wpmBoundaryClear(' + idArg + ')">🗑</button>' : '') +
      '</div>' +
    '</div>'
  );
}

// ── Рисование ─────────────────────────────────────────────────
function wpmStartBoundaryDraw(itemId) {
  if (!WpmState.map) return;
  if (WpmState.boundaryEdit) _wpmEndBoundaryDraw();

  var item = WpmState.items.find(function(i) { return i.id === itemId; });
  if (!item) return;

  // Popup маркера перехватывает клики по карте в своей области — закрываем,
  // иначе первые точки рядом с маркером не засчитываются.
  WpmState.map.closePopup();

  WpmState.boundaryEdit = {
    itemId: itemId,
    points: (item.boundary || []).slice(),
    layer: L.layerGroup().addTo(WpmState.map),
  };
  _wpmRenderBoundaryDraft();
  _wpmShowBoundaryToolbar(item);
  WpmState.map.getContainer().style.cursor = 'crosshair';
  WpmState.map.on('click', _wpmBoundaryClickHandler);
}

function _wpmBoundaryClickHandler(e) {
  if (!WpmState.boundaryEdit) return;
  WpmState.boundaryEdit.points.push([e.latlng.lat, e.latlng.lng]);
  _wpmRenderBoundaryDraft();
}

function _wpmRenderBoundaryDraft() {
  var ed = WpmState.boundaryEdit;
  if (!ed) return;
  ed.layer.clearLayers();
  if (ed.points.length >= 3) {
    L.polygon(ed.points, { color: '#22d3ee', weight: 2, dashArray: '5,4', fillOpacity: .15, interactive: false }).addTo(ed.layer);
  } else if (ed.points.length === 2) {
    L.polyline(ed.points, { color: '#22d3ee', weight: 2, dashArray: '5,4', interactive: false }).addTo(ed.layer);
  }
  ed.points.forEach(function(p) {
    L.circleMarker(p, { radius: 4, color: '#22d3ee', fillColor: '#0e7490', fillOpacity: 1, weight: 2, interactive: false }).addTo(ed.layer);
  });
  var cnt = document.getElementById('wpm-bnd-count');
  if (cnt) cnt.textContent = ed.points.length;
}

function wpmBoundaryUndo() {
  var ed = WpmState.boundaryEdit;
  if (!ed || !ed.points.length) return;
  ed.points.pop();
  _wpmRenderBoundaryDraft();
}

async function wpmBoundarySave() {
  var ed = WpmState.boundaryEdit;
  if (!ed) return;
  if (ed.points.length < 3) {
    if (typeof Toast !== 'undefined') Toast.show('Нужно минимум 3 точки', 'error');
    return;
  }
  var res = await Api.client().from('wp_registry').update({ boundary: ed.points }).eq('id', ed.itemId);
  if (res.error) {
    if (typeof Toast !== 'undefined') Toast.show('Не удалось сохранить границу', 'error');
    return;
  }
  var item = WpmState.items.find(function(i) { return i.id === ed.itemId; });
  if (item) item.boundary = ed.points;
  _wpmEndBoundaryDraw();
  _wpmRenderBoundaries();
  if (WpmState.chemMode) _wpmRenderChemLayer();
  if (item) _wpmOpenInfo(item, WPM_TYPES[item.wp_type] || WPM_TYPES.other);
  if (typeof Toast !== 'undefined') Toast.show('Граница сохранена', 'success');
}

function wpmBoundaryCancel() {
  _wpmEndBoundaryDraw();
}

async function wpmBoundaryClear(itemId) {
  var res = await Api.client().from('wp_registry').update({ boundary: null }).eq('id', itemId);
  if (res.error) {
    if (typeof Toast !== 'undefined') Toast.show('Ошибка удаления границы', 'error');
    return;
  }
  var item = WpmState.items.find(function(i) { return i.id === itemId; });
  if (item) item.boundary = null;
  _wpmRenderBoundaries();
  if (WpmState.chemMode) _wpmRenderChemLayer();
  if (typeof Toast !== 'undefined') Toast.show('Граница удалена', 'success');
  if (item) _wpmOpenInfo(item, WPM_TYPES[item.wp_type] || WPM_TYPES.other);
}

function _wpmEndBoundaryDraw() {
  var ed = WpmState.boundaryEdit;
  if (ed && ed.layer) ed.layer.remove();
  WpmState.boundaryEdit = null;
  if (WpmState.map) {
    WpmState.map.off('click', _wpmBoundaryClickHandler);
    WpmState.map.getContainer().style.cursor = '';
  }
  _wpmHideBoundaryToolbar();
}

function _wpmShowBoundaryToolbar(item) {
  _wpmHideBoundaryToolbar();
  var shell = document.getElementById('wpm-shell');
  if (!shell || !WpmState.boundaryEdit) return;
  var bar = document.createElement('div');
  bar.id = 'wpm-bnd-toolbar';
  bar.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:2500;' +
    'background:var(--bg-2);border:1px solid #22d3ee;border-radius:10px;padding:8px 14px;display:flex;' +
    'align-items:center;gap:10px;font-size:12px;color:var(--txt-1);backdrop-filter:blur(6px);' +
    'box-shadow:0 8px 24px rgba(0,0,0,.4);pointer-events:all;white-space:nowrap';
  bar.innerHTML =
    '<span>🖊 Граница «' + escHTML(item.name) + '»: клик по карте — точка (<b id="wpm-bnd-count">' + WpmState.boundaryEdit.points.length + '</b>)</span>' +
    '<button class="wpm-btn" onclick="wpmBoundaryUndo()">↩ Отменить точку</button>' +
    '<button class="wpm-btn" style="background:rgba(34,197,94,.15);color:#22c55e" onclick="wpmBoundarySave()">✓ Сохранить</button>' +
    '<button class="wpm-btn" style="background:rgba(248,113,113,.12);color:#f87171" onclick="wpmBoundaryCancel()">✕ Отмена</button>';
  shell.appendChild(bar);
}

function _wpmHideBoundaryToolbar() {
  var bar = document.getElementById('wpm-bnd-toolbar');
  if (bar) bar.remove();
}

// ── Отрисовка сохранённых границ (тонкий контур, всегда видимый) ──
function _wpmRenderBoundaries() {
  if (!WpmState.map) return;
  if (WpmState.boundaryLayer) { WpmState.boundaryLayer.remove(); WpmState.boundaryLayer = null; }
  var grp = L.layerGroup();
  WpmState.items.forEach(function(item) {
    if (item.boundary && item.boundary.length >= 3) {
      L.polygon(item.boundary, {
        color: '#22d3ee', weight: 1.5, opacity: .5, fillOpacity: .04, dashArray: '4,4', interactive: false,
      }).addTo(grp);
    }
  });
  grp.addTo(WpmState.map);
  WpmState.boundaryLayer = grp;
}

// ── Point-in-polygon (ray casting) — для маскирования растра химии ──
function _wpmPointInPolygon(lat, lng, poly) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var yi = poly[i][0], xi = poly[i][1];
    var yj = poly[j][0], xj = poly[j][1];
    var intersect = ((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
function _wpmInAnyBoundary(lat, lng, boundaries) {
  for (var i = 0; i < boundaries.length; i++) {
    if (_wpmPointInPolygon(lat, lng, boundaries[i])) return true;
  }
  return false;
}

// ── MAP-01: граница водоёма как барьер для интерполяции ─────────
// Проверяет, пересекает ли отрезок a–b (каждый [lat,lng]) хотя бы одно
// ребро полигона границы — используется, чтобы IDW не «перетекал» между
// пробами по разные стороны реки/озера, как будто они гидравлически связаны.
function _wpmSegSegIntersect(p1, p2, p3, p4) {
  function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
  var d1 = cross(p3, p4, p1), d2 = cross(p3, p4, p2);
  var d3 = cross(p1, p2, p3), d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function _wpmSegmentCrossesBoundary(a, b, boundaries) {
  for (var bi = 0; bi < boundaries.length; bi++) {
    var poly = boundaries[bi];
    for (var i = 0; i < poly.length; i++) {
      if (_wpmSegSegIntersect(a, b, poly[i], poly[(i + 1) % poly.length])) return true;
    }
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════
//  Калькулятор координат
//  WGS-84 ↔ СК-42 (Пулково-1942, Гаусс-Крюгер) ↔ Местные (схема)
//
//  Алгоритм идентичен map.js (wgs84ToXY / xyToWgs84):
//    Эллипсоид Красовского: a=6378245, b=6356863.019
//    Гаусс-Крюгер, зона 12 (L0=69 градусов)
//    OFF = 5 800 000 (смещение северной координаты)
//
//  Связь систем координат:
//    СК-42 X (северная) = Местная Y + 5 800 000
//    СК-42 Y (восточная, ПОЛНАЯ) = Местная X + зона * 1 000 000 + 500 000
//                                = Местная X + 12 500 000  (для зоны 12)
//  Обратно:
//    Местная X = СК-42 Y − 12 500 000
//    Местная Y = СК-42 X − 5 800 000
// ═══════════════════════════════════════════════════════════════

// Константы — идентично map.js
var _KA  = 6378245.0;
var _KB  = 6356863.019;
var _KE2 = (_KA*_KA - _KB*_KB) / (_KA*_KA);
var _CALC_ZONE = 12;    // зона карьера (lon ≈ 69°, L0 = 69°)
var _CALC_OFF  = 5800000;  // смещение северной координаты

// WGS-84 (lat°, lon°) → все три системы
// Структурно идентично map.js wgs84ToXY, + восстановление полной СК-42
function _calcWgsToAll(lat, lon) {
  var a = _KA, e2 = _KE2;
  var e4 = e2*e2, e6 = e4*e2;
  var latR = lat * Math.PI/180;
  var lonR = lon * Math.PI/180;
  var zone = Math.floor(lon / 6) + 1;
  var L0   = (zone*6 - 3) * Math.PI/180;
  var dL   = lonR - L0;
  var sinL = Math.sin(latR), cosL = Math.cos(latR), tanL = Math.tan(latR);
  var t    = tanL*tanL;
  var eta2 = e2*cosL*cosL/(1-e2);
  var N    = a/Math.sqrt(1 - e2*sinL*sinL);
  var M    = a*((1-e2/4-3*e4/64-5*e6/256)*latR
               -(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*latR)
               +(15*e4/256+45*e6/1024)*Math.sin(4*latR)
               -(35*e6/3072)*Math.sin(6*latR));
  // sk42x = северная координата
  var sk42x = M
    + N*sinL*cosL*dL*dL/2
    + N*sinL*Math.pow(cosL,3)*(5-t+9*eta2+4*eta2*eta2)*Math.pow(dL,4)/24
    + N*sinL*Math.pow(cosL,5)*(61-58*t+t*t)*Math.pow(dL,6)/720;
  // sk42y_local = восточная БЕЗ номера зоны (map.js передаёт именно это в dL)
  var sk42y_local = N*cosL*dL
    + N*Math.pow(cosL,3)*(1-t+eta2)*Math.pow(dL,3)/6
    + N*Math.pow(cosL,5)*(5-18*t+t*t+14*eta2-58*t*eta2)*Math.pow(dL,5)/120;
  // sk42y_full = полная восточная с номером зоны
  var sk42y_full = sk42y_local + zone*1000000 + 500000;

  return {
    zone:      zone,
    sk42x:     sk42x,                                     // СК-42 X (северная)
    sk42y_f:   sk42y_full,                                // СК-42 Y (полная, с зоной)
    sk42y_l:   sk42y_local,                               // восточная без зоны
    localX:    parseFloat(sk42y_local.toFixed(4)),        // = sk42y_f − зона·1e6 − 500000
    localY:    parseFloat((sk42x - _CALC_OFF).toFixed(4)),// = sk42x − 5800000
  };
}

// СК-42 {northing=sk42x, localEast=sk42y_local, zone} → WGS-84
// Структурно идентично map.js xyToWgs84(localX, localY):
//   sk42x = localY + 5800000  (northing)
//   sk42y_local = localX       (восточная БЕЗ зоны)
function _calcSk42ToWgs(sk42x, sk42y_local, zone) {
  var a = _KA, e2 = _KE2;
  var lat = sk42x / (a*(1-e2/4-3*e2*e2/64-5*e2*e2*e2/256));
  for (var i = 0; i < 10; i++) {
    var M = a*(
      (1-e2/4-3*e2*e2/64-5*e2*e2*e2/256)*lat
      -(3*e2/8+3*e2*e2/32+45*e2*e2*e2/1024)*Math.sin(2*lat)
      +(15*e2*e2/256+45*e2*e2*e2/1024)*Math.sin(4*lat)
      -(35*e2*e2*e2/3072)*Math.sin(6*lat)
    );
    lat += (sk42x - M) / (a*(1 - e2*Math.sin(lat)*Math.sin(lat)));
  }
  var sinL = Math.sin(lat), cosL = Math.cos(lat), tanL = Math.tan(lat);
  var eta2 = e2*cosL*cosL/(1-e2);
  var N    = a/Math.sqrt(1-e2*sinL*sinL);
  var t    = tanL*tanL;
  // ВАЖНО: в dL используется sk42y_local (без зоны), как в map.js
  var dL = sk42y_local/(N*cosL)
    - Math.pow(sk42y_local,3)/(6*Math.pow(N,3)*cosL)*(1+2*t+eta2)
    + Math.pow(sk42y_local,5)/(120*Math.pow(N,5)*cosL)*(5+28*t+24*t*t);
  var L0 = (zone*6 - 3)*Math.PI/180;
  return {
    lat: parseFloat((lat * 180/Math.PI).toFixed(7)),
    lon: parseFloat(((L0 + dL) * 180/Math.PI).toFixed(7)),
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
  return hem + ' ' + d + '° ' + m + '\'' + ' ' + s + '"';
}

// ── Пересчёт ────────────────────────────────────────────────────
function wpmCalcFrom(source) {
  var err = null;

  if (source === 'wgs') {
    // WGS-84 → СК-42 → Местные
    var lat = parseFloat(document.getElementById('wc-lat').value);
    var lon = parseFloat(document.getElementById('wc-lon').value);
    if (isNaN(lat) || isNaN(lon)) { err = 'Введите корректные широту и долготу'; }
    else {
      var r = _calcWgsToAll(lat, lon);
      // СК-42: X (северная), Y (восточная ПОЛНАЯ с зоной)
      document.getElementById('wc-sk42n').value = r.sk42x.toFixed(3);
      document.getElementById('wc-sk42e').value = r.sk42y_f.toFixed(3);
      document.getElementById('wc-sk42z').value = r.zone;
      // Местные: X = sk42y_local, Y = sk42x − 5800000
      document.getElementById('wc-lx').value = r.localX.toFixed(4);
      document.getElementById('wc-ly').value = r.localY.toFixed(4);
      _calcSetDms(lat, lon);
    }

  } else if (source === 'sk42') {
    // СК-42 → Местные → WGS-84
    // sk42n = СК-42 X (северная), sk42e = СК-42 Y (восточная ПОЛНАЯ с зоной)
    var sk42x  = parseFloat(document.getElementById('wc-sk42n').value);
    var sk42y_f = parseFloat(document.getElementById('wc-sk42e').value);
    var zone   = parseInt(document.getElementById('wc-sk42z').value) || _CALC_ZONE;
    if (isNaN(sk42x) || isNaN(sk42y_f)) { err = 'Введите X и Y СК-42'; }
    else {
      // Местная X = СК-42 Y − зона·1е6 − 500000 = sk42y_local
      var localX = sk42y_f - zone*1e6 - 500000;
      // Местная Y = СК-42 X − 5 800 000
      var localY = sk42x - _CALC_OFF;
      document.getElementById('wc-lx').value = localX.toFixed(4);
      document.getElementById('wc-ly').value = localY.toFixed(4);
      // WGS: передаём sk42x (северная) и localX (восточная БЕЗ зоны)
      var wgs = _calcSk42ToWgs(sk42x, localX, zone);
      _calcSetWgs(wgs.lat, wgs.lon);
    }

  } else if (source === 'local') {
    // Местные → СК-42 → WGS-84
    var localX = parseFloat(document.getElementById('wc-lx').value);
    var localY = parseFloat(document.getElementById('wc-ly').value);
    if (isNaN(localX) || isNaN(localY)) { err = 'Введите X и Y'; }
    else {
      var zone = _CALC_ZONE;
      // СК-42 X (северная) = Местная Y + 5 800 000
      var sk42x = localY + _CALC_OFF;
      // СК-42 Y (восточная ПОЛНАЯ) = Местная X + зона·1е6 + 500 000
      var sk42y_f = localX + zone*1e6 + 500000;
      // Заполняем СК-42
      document.getElementById('wc-sk42n').value = sk42x.toFixed(3);
      document.getElementById('wc-sk42e').value = sk42y_f.toFixed(3);
      document.getElementById('wc-sk42z').value = zone;
      // WGS: sk42x = северная, localX = восточная БЕЗ зоны (sk42y_local)
      var wgs = _calcSk42ToWgs(sk42x, localX, zone);
      _calcSetWgs(wgs.lat, wgs.lon);
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
    wpmCloseChemPoints();
    wpmCloseChemMenu();
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

// ── Выбор проб для карты химии ───────────────────────────────────
function wpmToggleChemPoints() {
  var panel = document.getElementById('wpm-chem-points-panel');
  if (!panel) return;
  var isOpen = panel.classList.contains('open');
  wpmCloseCalc();
  wpmCloseSettings();
  wpmCloseChemMenu();
  if (isOpen) { panel.classList.remove('open'); return; }
  var body = document.getElementById('wpm-chem-points-body');
  if (body) body.innerHTML = _wpmChemPointsHtml();
  panel.classList.add('open');
}
function wpmCloseChemPoints() {
  var panel = document.getElementById('wpm-chem-points-panel');
  if (panel) panel.classList.remove('open');
}
function _wpmChemPointsHtml() {
  var mode = WpmState.chemMode;
  var paramKey = WpmState.chemParamKey;
  var paramDef = (mode === 'param' && typeof CHEM_PARAM_MAP !== 'undefined') ? CHEM_PARAM_MAP[paramKey] : null;
  var pts = WpmState.chemPoints.slice();
  var getV = mode === 'ph' ? function(p) { return p.meq.ph; }
    : mode === 'param' ? function(p) { return _wpmGetParamValue(p.proto.id, paramKey); }
    : function(p) { return p.meq.m_gl; };
  pts.sort(function(a, b) {
    var va = getV(a), vb = getV(b);
    if (isNaN(va) && isNaN(vb)) return a.item.name.localeCompare(b.item.name);
    if (isNaN(va)) return 1;
    if (isNaN(vb)) return -1;
    return vb - va; // по убыванию — аномалии сразу видны наверху списка
  });
  if (!pts.length) {
    return '<div style="font-size:12px;color:var(--txt-3)">Нет проб с данными макрокомпонентов</div>';
  }
  var html = '<div style="font-size:11px;color:var(--txt-3);line-height:1.5;margin-bottom:10px">' +
    'Снимите галочку, чтобы исключить пробу из интерполяции карты химии (например, аномальное значение) — сама проба и её данные в протоколе не удаляются.' +
  '</div>';
  html += pts.map(function(p) {
    var excluded = !!WpmState.chemExcluded[p.item.id];
    var mVal = isNaN(p.meq.m_gl) ? '—' : p.meq.m_gl.toFixed(3) + ' г/л';
    var phVal = isNaN(p.meq.ph) ? '—' : p.meq.ph.toFixed(2);
    var flaggedMineral = !isNaN(p.meq.m_gl) && p.meq.m_gl >= 4; // ≥4 г/л = ≥4000 мг/дм³ — подсветим как вероятную аномалию
    var extraCol = '';
    if (mode === 'param') {
      var pv = getV(p);
      var pTxt = isNaN(pv) ? '—' : pv + (paramDef ? ' ' + paramDef.unit : '');
      var pFlagged = !isNaN(pv) && paramDef && paramDef.pdk_type === 'max' && paramDef.pdk_drink != null && pv > paramDef.pdk_drink;
      extraCol = '<span class="wpm-chem-pt-val' + (pFlagged ? ' flag' : '') + '">' + (paramDef ? paramDef.name : paramKey) + ': ' + pTxt + '</span>';
    }
    return '<label class="wpm-chem-pt-row' + (excluded ? ' excluded' : '') + '">' +
      '<input type="checkbox"' + (excluded ? '' : ' checked') + ' onchange="wpmToggleChemPoint(\'' + p.item.id + '\', this.checked)">' +
      '<span class="wpm-chem-pt-name" title="' + escHTML(p.item.name) + '">' + escHTML(p.item.name) + '</span>' +
      (mode === 'param' ? extraCol : '<span class="wpm-chem-pt-val' + (flaggedMineral ? ' flag' : '') + '">М: ' + mVal + '</span><span class="wpm-chem-pt-val">pH: ' + phVal + '</span>') +
    '</label>';
  }).join('');
  return html;
}
function wpmToggleChemPoint(itemId, included) {
  if (included) delete WpmState.chemExcluded[itemId];
  else WpmState.chemExcluded[itemId] = true;
  _wpmSaveChemExcluded();
  var body = document.getElementById('wpm-chem-points-body');
  if (body) body.innerHTML = _wpmChemPointsHtml();
  if (WpmState.chemMode) _wpmRenderChemLayer();
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
  if (WpmState.chemMode) {
    await _wpmChemEnsureData();
    _wpmRenderChemLayer();
  }
  if (typeof Toast !== 'undefined') Toast.done('Данные обновлены', 'success');
}

// ── Инициализация вкладки ──────────────────────────────────────
async function initWpMapTab() {
  _wpmLoadTypeSettings();
  _wpmLoadChemExcluded();
  _wpmLoadChemPalette();
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
window.wpmSetChemLayer  = wpmSetChemLayer;
window.wpmSetChemStep    = wpmSetChemStep;
window.wpmSetChemParam     = wpmSetChemParam;
window.wpmSetChemDivisions = wpmSetChemDivisions;
window.wpmToggleChemSmooth = wpmToggleChemSmooth;
window.wpmToggleChemPoints = wpmToggleChemPoints;
window.wpmCloseChemPoints  = wpmCloseChemPoints;
window.wpmToggleChemPoint  = wpmToggleChemPoint;
window.wpmSetChemAsOf   = wpmSetChemAsOf;
window.wpmClearChemAsOf = wpmClearChemAsOf;
window.wpmExportChemPng = wpmExportChemPng;
window.wpmSetChemPalette = wpmSetChemPalette;
window.wpmToggleChemMenu = wpmToggleChemMenu;
window.wpmCloseChemMenu  = wpmCloseChemMenu;
window.wpmStartBoundaryDraw = wpmStartBoundaryDraw;
window.wpmBoundaryUndo      = wpmBoundaryUndo;
window.wpmBoundarySave      = wpmBoundarySave;
window.wpmBoundaryCancel    = wpmBoundaryCancel;
window.wpmBoundaryClear     = wpmBoundaryClear;
window.wpmGoToChem      = wpmGoToChem;
window.wpmGoToRegistry  = wpmGoToRegistry;
window._wpmCloseInfo    = _wpmCloseInfo;
