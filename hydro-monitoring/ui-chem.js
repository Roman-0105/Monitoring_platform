// ═══════════════════════════════════════════════════════════════
//  Химический мониторинг воды — ui-chem.js
//  Модуль: реестр водопунктов, протоколы СХА, тренды, ПДК
// ═══════════════════════════════════════════════════════════════

/* ── Каталог параметров с нормами ПДК ───────────────────────────
   pdk_type: 'max'   — значение ≤ pdk_max  (большинство)
             'min'   — значение ≥ pdk_min  (прозрачность)
             'range' — pdk_min ≤ значение ≤ pdk_max  (pH)
             'score' — органолептика, балл ≤ pdk_max
   pdk_drink / pdk_tech: нормы (null = норма не установлена)
   Источник: СанПиН РК «Вода питьевая», ГОСТ 2874-82, СанПиН 2.1.4.1074-01
─────────────────────────────────────────────────────────────── */
var CHEM_PARAMS = [
  // Органолептика
  { key:'smell',       no:1,  name:'Запах при 20°C',              unit:'балл',           group:'organo',  pdk_type:'score', pdk_drink:2,      pdk_tech:null },
  { key:'taste',       no:2,  name:'Привкус',                     unit:'балл',           group:'organo',  pdk_type:'score', pdk_drink:2,      pdk_tech:null },
  { key:'color',       no:3,  name:'Цветность',                   unit:'гр. цветн.',     group:'organo',  pdk_type:'max',   pdk_drink:20,     pdk_tech:null },
  { key:'turbidity',   no:4,  name:'Мутность',                    unit:'ЕМФ',            group:'organo',  pdk_type:'max',   pdk_drink:2.6,    pdk_tech:null },
  { key:'transp',      no:5,  name:'Прозрачность',                unit:'см',             group:'organo',  pdk_type:'min',   pdk_drink:30,     pdk_tech:null },
  // Физ-химия
  { key:'ph_lab',      no:6,  name:'pH в лаборатории',            unit:'ед. pH',         group:'physico', pdk_type:'range', pdk_drink_min:6.0, pdk_drink_max:9.0, pdk_tech:null },
  { key:'ph_field',    no:7,  name:'pH при отборе',               unit:'ед. pH',         group:'physico', pdk_type:'range', pdk_drink_min:6.0, pdk_drink_max:9.0, pdk_tech:null },
  { key:'tds',         no:8,  name:'Общая минерализация',         unit:'мг/дм³',         group:'physico', pdk_type:'max',   pdk_drink:1000,   pdk_tech:null },
  { key:'hardness',    no:9,  name:'Общая жёсткость',             unit:'мг-экв/дм³',     group:'physico', pdk_type:'max',   pdk_drink:7.0,    pdk_tech:null },
  { key:'oxidability', no:10, name:'Окисляемость перманг.',       unit:'мгО/дм³',        group:'physico', pdk_type:'max',   pdk_drink:5.0,    pdk_tech:null },
  { key:'apav',        no:11, name:'АПАВ',                        unit:'мг/дм³',         group:'physico', pdk_type:'max',   pdk_drink:0.5,    pdk_tech:null },
  // Макрокомпоненты
  { key:'na',          no:12, name:'Натрий (Na⁺)',                unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:200,    pdk_tech:null },
  { key:'k',           no:13, name:'Калий (K⁺)',                  unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'ca',          no:14, name:'Кальций (Ca²⁺)',              unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'mg',          no:15, name:'Магний (Mg²⁺)',               unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:50,     pdk_tech:null },
  { key:'nh4',         no:16, name:'Аммоний (NH₄⁺)',              unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:2.0,    pdk_tech:null },
  { key:'nh3',         no:17, name:'Аммиак и ионы аммония',       unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:0.05,   pdk_tech:null },
  { key:'co3',         no:18, name:'Карбонаты (CO₃²⁻)',           unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'hco3',        no:19, name:'Гидрокарбонаты (HCO₃²⁻)',    unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'no3',         no:20, name:'Нитраты (NO₃⁻)',              unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:45,     pdk_tech:null },
  { key:'no2',         no:21, name:'Нитриты (NO₂⁻)',              unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:3.0,    pdk_tech:null },
  { key:'so4',         no:22, name:'Сульфаты (SO₄²⁻)',            unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:500,    pdk_tech:null },
  { key:'cl',          no:23, name:'Хлориды (Cl⁻)',               unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:350,    pdk_tech:null },
  // Металлы — группа I
  { key:'fe2',         no:24, name:'Железо 2+',                   unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.3,    pdk_tech:null },
  { key:'fe3',         no:25, name:'Железо 3+',                   unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.3,    pdk_tech:null },
  { key:'fe_total',    no:26, name:'Железо общее',                unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.3,    pdk_tech:null },
  { key:'cu',          no:27, name:'Медь',                        unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:1.0,    pdk_tech:null },
  { key:'mo',          no:28, name:'Молибден',                    unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.07,   pdk_tech:null },
  { key:'as',          no:29, name:'Мышьяк',                      unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.01,   pdk_tech:null },
  { key:'pb',          no:30, name:'Свинец',                      unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.01,   pdk_tech:null },
  { key:'se',          no:31, name:'Селен',                       unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.01,   pdk_tech:null },
  { key:'sr',          no:32, name:'Стронций',                    unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:7.0,    pdk_tech:null },
  { key:'ag',          no:33, name:'Серебро',                     unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.05,   pdk_tech:null },
  // Органика
  { key:'cn',          no:34, name:'Цианиды (CN⁻)',               unit:'мг/дм³',         group:'organic', pdk_type:'max',   pdk_drink:0.07,   pdk_tech:null },
  // Металлы — группа II
  { key:'zn',          no:35, name:'Цинк',                        unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:5.0,    pdk_tech:null },
  { key:'tl',          no:36, name:'Таллий',                      unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.0001, pdk_tech:null },
  { key:'li',          no:37, name:'Литий',                       unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.03,   pdk_tech:null },
  { key:'sb',          no:38, name:'Сурьма',                      unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.005,  pdk_tech:null },
  { key:'oil',         no:39, name:'Нефтепродукты',               unit:'мг/дм³',         group:'organic', pdk_type:'max',   pdk_drink:0.1,    pdk_tech:null },
  { key:'phenol',      no:40, name:'Фенолы (C₆H₅OH)',             unit:'мг/дм³',         group:'organic', pdk_type:'max',   pdk_drink:0.001,  pdk_tech:null },
  { key:'al',          no:41, name:'Алюминий',                    unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.2,    pdk_tech:null },
  { key:'ba',          no:42, name:'Барий',                       unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.1,    pdk_tech:null },
  { key:'be',          no:43, name:'Бериллий',                    unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.0002, pdk_tech:null },
  { key:'b',           no:44, name:'Бор',                         unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.5,    pdk_tech:null },
  { key:'mn',          no:45, name:'Марганец',                    unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.1,    pdk_tech:null },
  { key:'dry_res',     no:46, name:'Сухой остаток',               unit:'мг/дм³',         group:'physico', pdk_type:'max',   pdk_drink:1000,   pdk_tech:null },
  { key:'cr3',         no:47, name:'Хром 3+ (Cr³⁺)',              unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.5,    pdk_tech:null },
  { key:'cr6',         no:48, name:'Хром 6+ (Cr⁶⁺)',              unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.05,   pdk_tech:null },
  { key:'ni',          no:49, name:'Никель',                      unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.02,   pdk_tech:null },
  { key:'co_metal',    no:50, name:'Кобальт',                     unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.1,    pdk_tech:null },
  { key:'v',           no:51, name:'Ванадий',                     unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.1,    pdk_tech:null },
  { key:'alkalinity',  no:52, name:'Щёлочность',                  unit:'мг-экв/дм³',     group:'physico', pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'f',           no:53, name:'Фториды (F⁻)',                unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:1.5,    pdk_tech:null },
  { key:'cd',          no:54, name:'Кадмий',                      unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.001,  pdk_tech:null },
  { key:'hg',          no:55, name:'Ртуть',                       unit:'мг/дм³',         group:'metals',  pdk_type:'max',   pdk_drink:0.0005, pdk_tech:null },
  { key:'si',          no:56, name:'Кремний',                     unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:10,     pdk_tech:null },
  { key:'iodide',      no:57, name:'Йодид ионы',                  unit:'мг/дм³',         group:'macro',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
];

var CHEM_PARAM_MAP = {};
CHEM_PARAMS.forEach(function(p) { CHEM_PARAM_MAP[p.key] = p; });

var CHEM_GROUPS = {
  organo:  { label:'Органолептика',    icon:'🫧' },
  physico: { label:'Физ-химия',        icon:'⚗️' },
  macro:   { label:'Макроэлементы',    icon:'🧪' },
  metals:  { label:'Металлы',          icon:'🔩' },
  organic: { label:'Органика',         icon:'🛢️' },
};

var CHEM_WP_TYPES = {
  well_obs: 'Наблюд. скважина',
  well_exp: 'Эксплуат. скважина',
  sump:     'Зумпф',
  pond:     'Накопитель',
  seep:     'Водопроявление',
  other:    'Прочее',
};

// ── Состояние ──────────────────────────────────────────────────
var ChemState = {
  waterPoints: [],    // [{id, name, code, type, ...}]
  protocols:   [],    // [{id, water_point_id, sampled_at, ...}]
  results:     {},    // { protocol_id: [{param_key, value_raw, value_num, below_detection}] }
  loading:     false,
  loaded:      false,
  activeSection: 'protocols', // 'waterpoints' | 'protocols' | 'analytics'
  filterWpId:  '',
  filterType:  '',
  filterYear:  '',
};

// ── API helpers ────────────────────────────────────────────────
var ChemApi = {
  _sb: function() { return Api.client(); },

  getWaterPoints: async function() {
    return this._sb().from('water_points').select('*').order('name');
  },
  upsertWaterPoint: async function(row) {
    return this._sb().from('water_points').upsert(row, { onConflict: 'id' }).select().single();
  },
  deleteWaterPoint: async function(id) {
    return this._sb().from('water_points').delete().eq('id', id);
  },

  getProtocols: async function() {
    return this._sb().from('chem_protocols').select('*').order('sampled_at', { ascending: false });
  },
  upsertProtocol: async function(row) {
    return this._sb().from('chem_protocols').upsert(row, { onConflict: 'id' }).select().single();
  },
  deleteProtocol: async function(id) {
    return this._sb().from('chem_protocols').delete().eq('id', id);
  },

  getResults: async function(protocolId) {
    return this._sb().from('chem_results').select('*').eq('protocol_id', protocolId);
  },
  upsertResults: async function(rows) {
    return this._sb().from('chem_results').upsert(rows, { onConflict: 'protocol_id,param_key' });
  },
  deleteResults: async function(protocolId) {
    return this._sb().from('chem_results').delete().eq('protocol_id', protocolId);
  },
};

// ── Загрузка данных ────────────────────────────────────────────
async function loadChemData() {
  if (!window.Api) return;
  ChemState.loading = true;
  try {
    var [wpRes, prRes] = await Promise.all([
      ChemApi.getWaterPoints(),
      ChemApi.getProtocols(),
    ]);
    if (!wpRes.error) ChemState.waterPoints = wpRes.data || [];
    if (!prRes.error) ChemState.protocols   = prRes.data || [];

    // Загружаем результаты только для первых 50 протоколов (ленивая загрузка остальных)
    var recentIds = ChemState.protocols.slice(0, 50).map(function(p) { return p.id; });
    if (recentIds.length) {
      var rRes = await Api.client().from('chem_results').select('*')
        .in('protocol_id', recentIds);
      if (!rRes.error && rRes.data) {
        rRes.data.forEach(function(row) {
          if (!ChemState.results[row.protocol_id]) ChemState.results[row.protocol_id] = [];
          ChemState.results[row.protocol_id].push(row);
        });
      }
    }

    ChemState.loaded = true;
  } catch (e) {
    console.error('[chem] loadChemData error', e);
  }
  ChemState.loading = false;
}

// ── Инициализация вкладки ──────────────────────────────────────
var _chemInited = false;
async function initChemTab() {
  _chemInitCSS();
  if (!_chemInited) {
    _chemInited = true;
    _chemBuildLayout();
  }
  if (!ChemState.loaded && !ChemState.loading) {
    await loadChemData();
  }
  _chemRenderSection(ChemState.activeSection);
}

// ── CSS ────────────────────────────────────────────────────────
function _chemInitCSS() {
  if (document.getElementById('chem-css')) return;
  var s = document.createElement('style');
  s.id = 'chem-css';
  s.textContent = [
    /* Layout */
    '#page-chem{padding:0!important;overflow:hidden!important}',
    '#page-chem.active{display:flex!important;flex-direction:column!important}',
    '.chem-shell{display:flex;flex:1;overflow:hidden;height:100%}',

    /* Rail */
    '.chem-rail{display:flex;flex-direction:column;width:52px;min-width:52px;background:var(--bg-2);border-right:1px solid var(--line);transition:width .22s cubic-bezier(.4,0,.2,1);overflow:hidden;gap:2px;padding:6px 4px;z-index:10;flex-shrink:0}',
    '.chem-rail:hover{width:200px}',
    '.chem-rail-item{display:flex;align-items:center;gap:10px;padding:8px 8px;border:none;background:none;color:var(--txt-3);border-radius:8px;cursor:pointer;white-space:nowrap;transition:background .15s,color .15s;text-align:left;min-height:40px;width:100%}',
    '.chem-rail-item:hover{background:var(--bg-3);color:var(--txt-1)}',
    '.chem-rail-item.active{background:rgba(59,130,246,.15);color:var(--blue)}',
    '.chem-rail-icon{width:20px;height:20px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:16px}',
    '.chem-rail-label{font-size:12px;font-weight:500;opacity:0;transition:opacity .15s .05s;pointer-events:none;overflow:hidden;text-overflow:ellipsis}',
    '.chem-rail:hover .chem-rail-label{opacity:1}',
    '.chem-rail-sep{height:1px;background:var(--line);margin:4px 2px;flex-shrink:0}',
    '.chem-rail-action{color:var(--txt-3)}',
    '.chem-rail-action:hover{color:var(--ok)}',

    /* Content */
    '.chem-content{flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:12px}',

    /* Header bar */
    '.chem-hdr{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:4px}',
    '.chem-hdr-title{font-size:16px;font-weight:700;color:var(--txt-1)}',
    '.chem-hdr-sub{font-size:12px;color:var(--txt-3);margin-left:4px}',
    '.chem-hdr-gap{flex:1}',

    /* Buttons */
    '.chem-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:none;font-size:12px;font-weight:600;cursor:pointer;transition:background var(--tr),opacity var(--tr);white-space:nowrap}',
    '.chem-btn-prim{background:var(--blue);color:#fff}',
    '.chem-btn-prim:hover{opacity:.88}',
    '.chem-btn-ghost{background:var(--bg-3);color:var(--txt-2);border:1px solid var(--line)}',
    '.chem-btn-ghost:hover{color:var(--txt-1);background:var(--bg-2)}',
    '.chem-btn-danger{background:rgba(248,113,113,.12);color:#f87171;border:1px solid rgba(248,113,113,.2)}',
    '.chem-btn-danger:hover{background:rgba(248,113,113,.2)}',

    /* KPI tiles */
    '.chem-kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}',
    '.chem-kpi{background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:12px 14px}',
    '.chem-kpi-lbl{font-size:10px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px}',
    '.chem-kpi-val{font-size:22px;font-weight:700;color:var(--txt-1);line-height:1}',
    '.chem-kpi-sub{font-size:11px;color:var(--txt-3);margin-top:3px}',
    '.chem-kpi-warn .chem-kpi-val{color:#f87171}',

    /* Filters */
    '.chem-filters{display:flex;align-items:center;gap:8px;flex-wrap:wrap;background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:10px 14px}',
    '.chem-sel{background:var(--bg-1);border:1px solid var(--line);color:var(--txt-1);padding:5px 8px;border-radius:6px;font-size:12px;cursor:pointer;outline:none;transition:border-color var(--tr);color-scheme:dark}',
    '.chem-sel:focus{border-color:rgba(59,130,246,.5)}',
    '.chem-filter-lbl{font-size:11px;color:var(--txt-3);white-space:nowrap}',

    /* Protocol cards */
    '.chem-proto-list{display:flex;flex-direction:column;gap:8px}',
    '.chem-proto-card{background:var(--bg-2);border:1px solid var(--line);border-radius:10px;overflow:hidden;transition:border-color var(--tr)}',
    '.chem-proto-card:hover{border-color:rgba(59,130,246,.35)}',
    '.chem-proto-head{display:flex;align-items:center;gap:10px;padding:12px 14px;cursor:pointer;user-select:none}',
    '.chem-proto-date{font-size:13px;font-weight:700;color:var(--blue);min-width:80px}',
    '.chem-proto-wp{font-size:13px;font-weight:600;color:var(--txt-1)}',
    '.chem-proto-lab{font-size:11px;color:var(--txt-3)}',
    '.chem-proto-badges{display:flex;gap:6px;margin-left:auto;align-items:center}',
    '.chem-badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600;white-space:nowrap}',
    '.chem-badge-ok{background:var(--ok-glow);color:var(--ok)}',
    '.chem-badge-warn{background:rgba(251,146,60,.12);color:var(--warn)}',
    '.chem-badge-err{background:rgba(248,113,113,.12);color:#f87171}',
    '.chem-badge-gray{background:rgba(139,148,158,.1);color:var(--txt-3)}',
    '.chem-proto-body{display:none;border-top:1px solid var(--line);padding:14px}',
    '.chem-proto-body.open{display:block}',

    /* Results table */
    '.chem-rtbl{width:100%;border-collapse:collapse;font-size:12px}',
    '.chem-rtbl th{text-align:left;padding:5px 8px;color:var(--txt-3);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)}',
    '.chem-rtbl td{padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04);font-variant-numeric:tabular-nums}',
    '.chem-rtbl tr:last-child td{border-bottom:none}',
    '.chem-rtbl tr.chem-row-exceed td:first-child{border-left:2px solid #f87171}',
    '.chem-rtbl tr.chem-row-ok td:first-child{border-left:2px solid var(--ok)}',
    '.chem-rtbl tr.chem-row-nonorm td:first-child{border-left:2px solid var(--line)}',
    '.chem-group-hdr td{background:rgba(255,255,255,.03);font-weight:700;font-size:11px;color:var(--txt-2);padding:6px 8px;border-bottom:1px solid var(--line)}',

    /* PDK cell */
    '.chem-pdk-ok{color:var(--ok)}',
    '.chem-pdk-exceed{color:#f87171;font-weight:700}',
    '.chem-pdk-nonorm{color:var(--txt-3)}',
    '.chem-val-below{color:var(--txt-3);font-style:italic}',

    /* Water points table */
    '.chem-wp-tbl{width:100%;border-collapse:collapse;font-size:12px}',
    '.chem-wp-tbl th{text-align:left;padding:7px 10px;color:var(--txt-3);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)}',
    '.chem-wp-tbl td{padding:7px 10px;border-bottom:1px solid rgba(255,255,255,.04)}',
    '.chem-wp-tbl tr:hover td{background:rgba(255,255,255,.02)}',
    '.chem-wp-type{display:inline-block;padding:2px 7px;border-radius:5px;font-size:10px;font-weight:600;background:rgba(59,130,246,.1);color:var(--blue)}',

    /* Empty state */
    '.chem-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;gap:10px;color:var(--txt-3)}',
    '.chem-empty-ico{font-size:40px}',
    '.chem-empty-txt{font-size:14px;font-weight:500}',
    '.chem-empty-sub{font-size:12px;text-align:center;max-width:300px;line-height:1.5}',

    /* Modal */
    '.chem-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:2000;display:flex;align-items:center;justify-content:center;padding:16px}',
    '.chem-modal{background:var(--bg-2);border:1px solid var(--line);border-radius:14px;width:100%;max-width:780px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden}',
    '.chem-modal-hdr{display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line);flex-shrink:0}',
    '.chem-modal-title{font-size:15px;font-weight:700;color:var(--txt-1);flex:1}',
    '.chem-modal-close{background:none;border:none;color:var(--txt-3);font-size:20px;cursor:pointer;padding:4px 8px;border-radius:6px;line-height:1;transition:color var(--tr)}',
    '.chem-modal-close:hover{color:var(--txt-1)}',
    '.chem-modal-body{overflow-y:auto;padding:20px;flex:1}',
    '.chem-modal-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:14px 20px;border-top:1px solid var(--line);flex-shrink:0}',

    /* Form */
    '.chem-form-row{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}',
    '.chem-form-row-3{grid-template-columns:1fr 1fr 1fr}',
    '.chem-form-row-1{grid-template-columns:1fr}',
    '.chem-fld{display:flex;flex-direction:column;gap:4px}',
    '.chem-fld label{font-size:11px;color:var(--txt-3);font-weight:600;text-transform:uppercase;letter-spacing:.05em}',
    '.chem-inp{background:var(--bg-1);border:1px solid var(--line);color:var(--txt-1);padding:7px 10px;border-radius:7px;font-size:13px;transition:border-color var(--tr);outline:none;width:100%;box-sizing:border-box;color-scheme:dark}',
    '.chem-inp:focus{border-color:rgba(59,130,246,.6)}',
    '.chem-inp[type=date]{cursor:pointer}',

    /* Tab groups in form */
    '.chem-gtabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:14px}',
    '.chem-gtab{padding:5px 12px;border-radius:99px;border:1px solid var(--line);background:none;color:var(--txt-3);font-size:12px;cursor:pointer;transition:all .15s}',
    '.chem-gtab.active{background:rgba(59,130,246,.15);border-color:rgba(59,130,246,.4);color:var(--blue);font-weight:600}',
    '.chem-gtab:hover:not(.active){background:var(--bg-3);color:var(--txt-1)}',

    /* Param grid in form */
    '.chem-param-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
    '.chem-param-fld{display:flex;flex-direction:column;gap:3px}',
    '.chem-param-lbl{font-size:10px;color:var(--txt-3);font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.chem-param-lbl span{font-size:9px;opacity:.7;margin-left:3px}',
    '.chem-param-inp{background:var(--bg-1);border:1px solid var(--line);color:var(--txt-1);padding:5px 8px;border-radius:6px;font-size:12px;transition:border-color var(--tr);outline:none;width:100%;box-sizing:border-box;font-variant-numeric:tabular-nums}',
    '.chem-param-inp:focus{border-color:rgba(59,130,246,.5)}',
    '.chem-param-inp.exceed{border-color:rgba(248,113,113,.6);background:rgba(248,113,113,.04)}',

    /* Analytics */
    '.chem-anl-sel-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
    '.chem-anl-chart{background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:14px;overflow:hidden}',
    '.chem-anl-chart svg{width:100%;display:block}',

    /* Responsive */
    '@media(max-width:600px){.chem-kpi-row{grid-template-columns:1fr 1fr}.chem-param-grid{grid-template-columns:1fr}.chem-form-row,.chem-form-row-3{grid-template-columns:1fr}}',
  ].join('\n');
  document.head.appendChild(s);
}

// ── Разметка страницы ──────────────────────────────────────────
function _chemBuildLayout() {
  var page = document.getElementById('page-chem');
  if (!page) return;
  page.innerHTML =
    '<div class="chem-shell">' +
      '<nav class="chem-rail" id="chem-rail">' +
        _chemRailItem('protocols',   '🧾', 'Протоколы') +
        _chemRailItem('waterpoints', '📍', 'Реестр водопунктов') +
        '<div class="chem-rail-sep"></div>' +
        _chemRailItem('analytics',   '📈', 'Аналитика трендов') +
      '</nav>' +
      '<div class="chem-content" id="chem-content"></div>' +
    '</div>';

  document.querySelectorAll('.chem-rail-item[data-csec]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      ChemState.activeSection = this.dataset.csec;
      document.querySelectorAll('.chem-rail-item').forEach(function(b) {
        b.classList.toggle('active', b.dataset.csec === ChemState.activeSection);
      });
      _chemRenderSection(ChemState.activeSection);
    });
  });
}

function _chemRailItem(sec, icon, label) {
  var active = sec === ChemState.activeSection ? ' active' : '';
  return '<button class="chem-rail-item' + active + '" data-csec="' + sec + '">' +
    '<span class="chem-rail-icon">' + icon + '</span>' +
    '<span class="chem-rail-label">' + label + '</span>' +
    '</button>';
}

// ── Рендер секции ──────────────────────────────────────────────
function _chemRenderSection(sec) {
  var cont = document.getElementById('chem-content');
  if (!cont) return;
  if (ChemState.loading) {
    cont.innerHTML = '<div class="chem-empty"><div class="chem-empty-ico">⏳</div><div class="chem-empty-txt">Загрузка данных…</div></div>';
    return;
  }
  if (sec === 'protocols')   _chemRenderProtocols(cont);
  if (sec === 'waterpoints') _chemRenderWaterPoints(cont);
  if (sec === 'analytics')   _chemRenderAnalytics(cont);
}

// ═══════════════════════════════════════════════════════════════
//  СЕКЦИЯ: ПРОТОКОЛЫ
// ═══════════════════════════════════════════════════════════════
function _chemRenderProtocols(cont) {
  // KPI
  var total    = ChemState.protocols.length;
  var exceeded = 0, wpSet = new Set();
  ChemState.protocols.forEach(function(p) {
    wpSet.add(p.water_point_id);
    var rows = ChemState.results[p.id] || [];
    rows.forEach(function(r) {
      var st = _chemPdkStatus(r.param_key, r.value_raw, r.below_detection);
      if (st === 'exceed') exceeded++;
    });
  });
  var years = {};
  ChemState.protocols.forEach(function(p) {
    if (p.sampled_at) years[p.sampled_at.substring(0,4)] = true;
  });
  var yearOpts = Object.keys(years).sort(function(a,b){return b-a;}).map(function(y){
    return '<option value="' + y + '"' + (ChemState.filterYear === y ? ' selected' : '') + '>' + y + '</option>';
  }).join('');

  var wpOpts = '<option value="">Все водопункты</option>' + ChemState.waterPoints.map(function(w) {
    return '<option value="' + w.id + '"' + (ChemState.filterWpId === w.id ? ' selected' : '') + '>' + escHTML(w.name) + '</option>';
  }).join('');

  cont.innerHTML =
    '<div class="chem-hdr">' +
      '<span class="chem-hdr-title">Протоколы химического анализа</span>' +
      '<span class="chem-hdr-sub">СХА / ПХА / Радиология</span>' +
      '<div class="chem-hdr-gap"></div>' +
      '<button class="chem-btn chem-btn-ghost" onclick="showChemExcelImport()">↑ Импорт Excel</button>' +
      '<button class="chem-btn chem-btn-prim" onclick="showChemProtocolForm()">+ Новый протокол</button>' +
    '</div>' +

    '<div class="chem-kpi-row">' +
      _chemKpi('Протоколов', total, 'всего в базе') +
      _chemKpi('Водопунктов', wpSet.size, 'охвачено анализом') +
      _chemKpi('Превышений ПДК', exceeded, 'по всем протоколам', exceeded > 0 ? 'chem-kpi-warn' : '') +
      _chemKpi('Параметров', 57, 'в одном протоколе СХА') +
    '</div>' +

    '<div class="chem-filters">' +
      '<span class="chem-filter-lbl">Водопункт:</span>' +
      '<select class="chem-sel" id="chem-f-wp" onchange="chemFilterChange()">' + wpOpts + '</select>' +
      '<span class="chem-filter-lbl">Год:</span>' +
      '<select class="chem-sel" id="chem-f-year" onchange="chemFilterChange()">' +
        '<option value="">Все годы</option>' + yearOpts +
      '</select>' +
      '<div style="flex:1"></div>' +
      '<span class="chem-filter-lbl" id="chem-count-lbl"></span>' +
    '</div>' +

    '<div class="chem-proto-list" id="chem-proto-list"></div>';

  _chemRenderProtoList();
}

function chemFilterChange() {
  ChemState.filterWpId  = document.getElementById('chem-f-wp')  ? document.getElementById('chem-f-wp').value  : '';
  ChemState.filterYear  = document.getElementById('chem-f-year') ? document.getElementById('chem-f-year').value : '';
  _chemRenderProtoList();
}

function _chemRenderProtoList() {
  var list = document.getElementById('chem-proto-list');
  if (!list) return;

  var filtered = ChemState.protocols.filter(function(p) {
    if (ChemState.filterWpId && p.water_point_id !== ChemState.filterWpId) return false;
    if (ChemState.filterYear && (!p.sampled_at || p.sampled_at.substring(0,4) !== ChemState.filterYear)) return false;
    return true;
  });

  var lbl = document.getElementById('chem-count-lbl');
  if (lbl) lbl.textContent = 'Показано: ' + filtered.length;

  if (!filtered.length) {
    list.innerHTML = '<div class="chem-empty"><div class="chem-empty-ico">🔬</div>' +
      '<div class="chem-empty-txt">Протоколов нет</div>' +
      '<div class="chem-empty-sub">Добавьте первый протокол через кнопку «Новый протокол» или импортируйте из Excel</div></div>';
    return;
  }

  list.innerHTML = filtered.map(function(p) {
    var wp = ChemState.waterPoints.find(function(w) { return w.id === p.water_point_id; });
    var rows = ChemState.results[p.id] || [];
    var exceededRows = rows.filter(function(r) {
      return _chemPdkStatus(r.param_key, r.value_raw, r.below_detection) === 'exceed';
    });
    var badge = exceededRows.length > 0
      ? '<span class="chem-badge chem-badge-err">⚠ ' + exceededRows.length + ' превыш. ПДК</span>'
      : rows.length > 0
        ? '<span class="chem-badge chem-badge-ok">✓ В норме</span>'
        : '<span class="chem-badge chem-badge-gray">Нет данных</span>';

    return '<div class="chem-proto-card" id="cpc-' + p.id + '">' +
      '<div class="chem-proto-head" onclick="chemToggleProto(\'' + p.id + '\')">' +
        '<span class="chem-proto-date">' + _chemFmtDate(p.sampled_at) + '</span>' +
        '<div style="display:flex;flex-direction:column;gap:1px">' +
          '<span class="chem-proto-wp">' + escHTML(wp ? wp.name : '—') + '</span>' +
          '<span class="chem-proto-lab">' +
            (p.lab_name ? escHTML(p.lab_name) : '') +
            (p.lab_protocol_number ? ' №' + escHTML(p.lab_protocol_number) : '') +
          '</span>' +
        '</div>' +
        '<div class="chem-proto-badges">' +
          badge +
          '<span class="chem-badge chem-badge-gray">' + (rows.length || '?') + ' пар.</span>' +
          '<button class="chem-btn chem-btn-ghost" style="padding:4px 8px;font-size:11px" onclick="event.stopPropagation();showChemProtocolForm(\'' + p.id + '\')">✏</button>' +
          '<button class="chem-btn chem-btn-danger" style="padding:4px 8px;font-size:11px" onclick="event.stopPropagation();chemDeleteProtocol(\'' + p.id + '\')">✕</button>' +
        '</div>' +
      '</div>' +
      '<div class="chem-proto-body" id="cpb-' + p.id + '">' +
        _chemRenderResultsTable(p.id) +
      '</div>' +
    '</div>';
  }).join('');
}

function chemToggleProto(id) {
  var body = document.getElementById('cpb-' + id);
  if (!body) return;
  var open = body.classList.toggle('open');
  // Ленивая загрузка результатов если ещё не загружены
  if (open && !ChemState.results[id]) {
    body.innerHTML = '<div style="padding:20px;color:var(--txt-3);text-align:center">Загрузка…</div>';
    ChemApi.getResults(id).then(function(res) {
      if (!res.error && res.data) {
        ChemState.results[id] = res.data;
      } else {
        ChemState.results[id] = [];
      }
      body.innerHTML = _chemRenderResultsTable(id);
    });
  }
}

function _chemRenderResultsTable(protocolId) {
  var rows = ChemState.results[protocolId];
  if (!rows || !rows.length) {
    return '<div style="padding:14px;color:var(--txt-3);font-size:12px">Результаты не введены</div>';
  }

  // Группируем по group
  var byGroup = {};
  rows.forEach(function(r) {
    var param = CHEM_PARAM_MAP[r.param_key];
    var grp = param ? param.group : 'other';
    if (!byGroup[grp]) byGroup[grp] = [];
    byGroup[grp].push({ row: r, param: param });
  });

  var html = '<table class="chem-rtbl"><thead><tr>' +
    '<th>№</th><th>Параметр</th><th>Значение</th><th>Ед. изм.</th>' +
    '<th>ПДК питьев.</th><th>Статус</th></tr></thead><tbody>';

  var groupOrder = ['organo','physico','macro','metals','organic'];
  groupOrder.forEach(function(grp) {
    if (!byGroup[grp] || !byGroup[grp].length) return;
    var grpInfo = CHEM_GROUPS[grp] || { label: grp, icon: '•' };
    html += '<tr class="chem-group-hdr"><td colspan="6">' + grpInfo.icon + ' ' + grpInfo.label + '</td></tr>';
    byGroup[grp].forEach(function(item) {
      var p = item.param;
      var r = item.row;
      if (!p) return;
      var status = _chemPdkStatus(r.param_key, r.value_raw, r.below_detection);
      var pdkStr = _chemPdkStr(p);
      var rowCls = status === 'exceed' ? 'chem-row-exceed' : status === 'ok' ? 'chem-row-ok' : 'chem-row-nonorm';
      var statusHtml = status === 'exceed'
        ? '<span class="chem-pdk-exceed">▲ Превышение</span>'
        : status === 'ok'
          ? '<span class="chem-pdk-ok">✓ Норма</span>'
          : '<span class="chem-pdk-nonorm">—</span>';
      var valHtml = r.below_detection
        ? '<span class="chem-val-below">' + escHTML(r.value_raw || '') + '</span>'
        : escHTML(r.value_raw || '—');

      html += '<tr class="' + rowCls + '">' +
        '<td style="color:var(--txt-3)">' + p.no + '</td>' +
        '<td>' + escHTML(p.name) + '</td>' +
        '<td>' + valHtml + '</td>' +
        '<td style="color:var(--txt-3)">' + escHTML(p.unit) + '</td>' +
        '<td style="color:var(--txt-3);font-variant-numeric:tabular-nums">' + pdkStr + '</td>' +
        '<td>' + statusHtml + '</td>' +
        '</tr>';
    });
  });

  html += '</tbody></table>';
  return html;
}

// ═══════════════════════════════════════════════════════════════
//  СЕКЦИЯ: РЕЕСТР ВОДОПУНКТОВ
// ═══════════════════════════════════════════════════════════════
function _chemRenderWaterPoints(cont) {
  cont.innerHTML =
    '<div class="chem-hdr">' +
      '<span class="chem-hdr-title">Реестр водопунктов</span>' +
      '<div class="chem-hdr-gap"></div>' +
      '<button class="chem-btn chem-btn-prim" onclick="showChemWpForm()">+ Добавить водопункт</button>' +
    '</div>' +
    '<div style="background:var(--bg-2);border:1px solid var(--line);border-radius:10px;overflow:hidden">' +
      '<table class="chem-wp-tbl">' +
        '<thead><tr>' +
          '<th>Код</th><th>Наименование</th><th>Тип</th><th>Описание местоположения</th><th>Протоколов</th><th></th>' +
        '</tr></thead>' +
        '<tbody id="chem-wp-tbody">' + _chemWpRows() + '</tbody>' +
      '</table>' +
    '</div>';
}

function _chemWpRows() {
  if (!ChemState.waterPoints.length) {
    return '<tr><td colspan="6"><div class="chem-empty" style="padding:40px">' +
      '<div class="chem-empty-ico">📍</div>' +
      '<div class="chem-empty-txt">Водопункты не добавлены</div>' +
      '<div class="chem-empty-sub">Добавьте первый водопункт для привязки протоколов анализа</div></div></td></tr>';
  }
  return ChemState.waterPoints.map(function(w) {
    var protoCount = ChemState.protocols.filter(function(p){ return p.water_point_id === w.id; }).length;
    return '<tr>' +
      '<td style="font-weight:600;color:var(--blue)">' + escHTML(w.code || '—') + '</td>' +
      '<td style="font-weight:600">' + escHTML(w.name) + '</td>' +
      '<td><span class="chem-wp-type">' + escHTML(CHEM_WP_TYPES[w.type] || w.type) + '</span></td>' +
      '<td style="color:var(--txt-2)">' + escHTML(w.location_desc || '—') + '</td>' +
      '<td style="text-align:center">' + protoCount + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
        '<button class="chem-btn chem-btn-ghost" style="padding:4px 8px;font-size:11px;margin-right:4px" onclick="showChemWpForm(\'' + w.id + '\')">✏</button>' +
        (protoCount === 0 ? '<button class="chem-btn chem-btn-danger" style="padding:4px 8px;font-size:11px" onclick="chemDeleteWp(\'' + w.id + '\')">✕</button>' : '') +
      '</td>' +
    '</tr>';
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
//  СЕКЦИЯ: АНАЛИТИКА ТРЕНДОВ
// ═══════════════════════════════════════════════════════════════
function _chemRenderAnalytics(cont) {
  var wpOpts = '<option value="">— Выберите водопункт —</option>' + ChemState.waterPoints.map(function(w) {
    return '<option value="' + w.id + '">' + escHTML(w.name) + '</option>';
  }).join('');

  var paramOpts = CHEM_PARAMS.map(function(p) {
    return '<option value="' + p.key + '">' + p.no + '. ' + p.name + ' (' + p.unit + ')</option>';
  }).join('');

  cont.innerHTML =
    '<div class="chem-hdr"><span class="chem-hdr-title">Тренды по параметрам</span></div>' +
    '<div class="chem-filters">' +
      '<span class="chem-filter-lbl">Водопункт:</span>' +
      '<select class="chem-sel" id="anl-wp" onchange="chemRenderAnlChart()">' + wpOpts + '</select>' +
      '<span class="chem-filter-lbl">Параметр:</span>' +
      '<select class="chem-sel" id="anl-param" onchange="chemRenderAnlChart()" style="min-width:220px">' + paramOpts + '</select>' +
    '</div>' +
    '<div class="chem-anl-chart" id="chem-anl-chart">' +
      '<div class="chem-empty" style="padding:40px"><div class="chem-empty-ico">📈</div>' +
      '<div class="chem-empty-txt">Выберите водопункт и параметр</div></div>' +
    '</div>';
}

function chemRenderAnlChart() {
  var wpId    = document.getElementById('anl-wp')    ? document.getElementById('anl-wp').value    : '';
  var paramKey= document.getElementById('anl-param') ? document.getElementById('anl-param').value : '';
  var chart   = document.getElementById('chem-anl-chart');
  if (!chart || !wpId || !paramKey) return;

  var param = CHEM_PARAM_MAP[paramKey];
  if (!param) return;

  // Собираем временной ряд
  var points = [];
  ChemState.protocols.filter(function(p) { return p.water_point_id === wpId; })
    .forEach(function(p) {
      var rows = ChemState.results[p.id] || [];
      var r = rows.find(function(r) { return r.param_key === paramKey; });
      if (r && r.value_num !== null && r.value_num !== undefined) {
        points.push({ date: p.sampled_at, val: parseFloat(r.value_num) });
      }
    });

  points.sort(function(a,b) { return a.date > b.date ? 1 : -1; });

  if (!points.length) {
    chart.innerHTML = '<div class="chem-empty" style="padding:40px"><div class="chem-empty-ico">🔎</div>' +
      '<div class="chem-empty-txt">Нет данных по выбранному параметру</div></div>';
    return;
  }

  // Строим SVG-график
  var W = 600, H = 180, PL = 60, PR = 16, PT = 16, PB = 36;
  var cW = W - PL - PR, cH = H - PT - PB;
  var vals = points.map(function(p) { return p.val; });
  var minV = Math.min.apply(null, vals), maxV = Math.max.apply(null, vals);
  var pdk = param.pdk_drink || param.pdk_drink_max;

  if (pdk !== null && pdk !== undefined) {
    minV = Math.min(minV, 0);
    maxV = Math.max(maxV, pdk * 1.15);
  } else {
    var span = maxV - minV || 1;
    minV = Math.max(0, minV - span * 0.1);
    maxV = maxV + span * 0.1;
  }
  var range = maxV - minV || 1;

  function px(i) { return PL + (points.length > 1 ? (i / (points.length - 1)) * cW : cW / 2); }
  function py(v)  { return PT + (1 - (v - minV) / range) * cH; }

  var pathD = points.map(function(p, i) { return (i === 0 ? 'M' : 'L') + px(i).toFixed(1) + ',' + py(p.val).toFixed(1); }).join(' ');
  var areaD = pathD + ' L' + px(points.length-1).toFixed(1) + ',' + (PT+cH) + ' L' + PL.toFixed(1) + ',' + (PT+cH) + ' Z';

  // ПДК линия
  var pdkLine = '';
  if (pdk !== null && pdk !== undefined && pdk >= minV && pdk <= maxV) {
    var pdkY = py(pdk).toFixed(1);
    pdkLine = '<line x1="' + PL + '" y1="' + pdkY + '" x2="' + (PL+cW) + '" y2="' + pdkY + '" stroke="#f87171" stroke-width="1" stroke-dasharray="4,3" opacity=".8"/>' +
      '<text x="' + (PL+cW+2) + '" y="' + (parseFloat(pdkY)+4) + '" fill="#f87171" font-size="9" font-weight="600">ПДК</text>';
  }

  // Оси Y
  var yLabels = '';
  [0, 0.25, 0.5, 0.75, 1].forEach(function(f) {
    var v = minV + f * range;
    var y = py(v).toFixed(1);
    yLabels += '<line x1="' + PL + '" y1="' + y + '" x2="' + (PL+cW) + '" y2="' + y + '" stroke="var(--line)" stroke-width="0.5"/>' +
      '<text x="' + (PL-4) + '" y="' + (parseFloat(y)+4) + '" text-anchor="end" fill="var(--txt-3)" font-size="9" font-variant-numeric="tabular-nums">' + _chemFmtNum(v) + '</text>';
  });

  // X метки
  var xLabels = '';
  var step = Math.max(1, Math.ceil(points.length / 6));
  points.forEach(function(p, i) {
    if (i % step !== 0 && i !== points.length - 1) return;
    var x = px(i).toFixed(1);
    xLabels += '<text x="' + x + '" y="' + (PT+cH+18) + '" text-anchor="middle" fill="var(--txt-3)" font-size="9">' + _chemFmtDate(p.date, true) + '</text>';
  });

  // Точки
  var dots = points.map(function(p, i) {
    var st = _chemPdkStatus(paramKey, String(p.val), false);
    var clr = st === 'exceed' ? '#f87171' : '#38bdf8';
    return '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(p.val).toFixed(1) + '" r="3.5" fill="' + clr + '" stroke="var(--bg-2)" stroke-width="1.5"/>';
  }).join('');

  chart.innerHTML =
    '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
      '<div style="font-size:13px;font-weight:600;color:var(--txt-1)">' + escHTML(param.name) + '</div>' +
      '<div style="font-size:11px;color:var(--txt-3)">' + escHTML(param.unit) + '</div>' +
    '</div>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;overflow:visible">' +
      '<defs>' +
        '<linearGradient id="chemGrad" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#38bdf8" stop-opacity=".25"/>' +
          '<stop offset="100%" stop-color="#38bdf8" stop-opacity=".02"/>' +
        '</linearGradient>' +
      '</defs>' +
      yLabels + xLabels + pdkLine +
      '<path d="' + areaD + '" fill="url(#chemGrad)"/>' +
      '<path d="' + pathD + '" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots +
    '</svg>';
}

// ═══════════════════════════════════════════════════════════════
//  ФОРМЫ: РЕЕСТР ВОДОПУНКТОВ
// ═══════════════════════════════════════════════════════════════
function showChemWpForm(wpId) {
  var wp = wpId ? ChemState.waterPoints.find(function(w){ return w.id === wpId; }) : null;
  var typeOpts = Object.keys(CHEM_WP_TYPES).map(function(k) {
    return '<option value="' + k + '"' + (wp && wp.type === k ? ' selected' : '') + '>' + CHEM_WP_TYPES[k] + '</option>';
  }).join('');

  _chemOpenModal(
    (wp ? 'Редактировать' : 'Добавить') + ' водопункт',
    '<div class="chem-form-row">' +
      '<div class="chem-fld"><label>Наименование *</label>' +
        '<input class="chem-inp" id="wf-name" placeholder="Скважина ПН-1" value="' + escHTML(wp ? wp.name : '') + '"></div>' +
      '<div class="chem-fld"><label>Код / Шифр</label>' +
        '<input class="chem-inp" id="wf-code" placeholder="ПН-1" value="' + escHTML(wp ? (wp.code||'') : '') + '"></div>' +
    '</div>' +
    '<div class="chem-form-row">' +
      '<div class="chem-fld"><label>Тип водопункта</label>' +
        '<select class="chem-inp" id="wf-type">' + typeOpts + '</select></div>' +
      '<div class="chem-fld"><label>Описание местоположения</label>' +
        '<input class="chem-inp" id="wf-loc" placeholder="Северный борт, гор. +820" value="' + escHTML(wp ? (wp.location_desc||'') : '') + '"></div>' +
    '</div>' +
    '<div class="chem-form-row-1 chem-form-row">' +
      '<div class="chem-fld"><label>Примечание</label>' +
        '<input class="chem-inp" id="wf-notes" value="' + escHTML(wp ? (wp.notes||'') : '') + '"></div>' +
    '</div>',
    '<button class="chem-btn chem-btn-ghost" onclick="_chemCloseModal()">Отмена</button>' +
    '<button class="chem-btn chem-btn-prim" onclick="_chemSaveWp(\'' + (wp ? wp.id : '') + '\')">Сохранить</button>'
  );
}

async function _chemSaveWp(existingId) {
  var name = document.getElementById('wf-name').value.trim();
  if (!name) { alert('Введите наименование водопункта'); return; }
  var row = {
    name:          name,
    code:          document.getElementById('wf-code').value.trim() || null,
    type:          document.getElementById('wf-type').value,
    location_desc: document.getElementById('wf-loc').value.trim() || null,
    notes:         document.getElementById('wf-notes').value.trim() || null,
  };
  if (existingId) row.id = existingId;
  var res = await ChemApi.upsertWaterPoint(row);
  if (res.error) { alert('Ошибка сохранения: ' + res.error.message); return; }
  var saved = res.data;
  if (existingId) {
    ChemState.waterPoints = ChemState.waterPoints.map(function(w){ return w.id === existingId ? saved : w; });
  } else {
    ChemState.waterPoints.push(saved);
  }
  _chemCloseModal();
  _chemRenderSection('waterpoints');
  if (typeof Toast !== 'undefined') Toast.ok('Водопункт сохранён');
}

async function chemDeleteWp(id) {
  if (!confirm('Удалить водопункт? Это действие нельзя отменить.')) return;
  var res = await ChemApi.deleteWaterPoint(id);
  if (res.error) { alert('Ошибка удаления: ' + res.error.message); return; }
  ChemState.waterPoints = ChemState.waterPoints.filter(function(w){ return w.id !== id; });
  _chemRenderSection('waterpoints');
}

// ═══════════════════════════════════════════════════════════════
//  ФОРМЫ: ПРОТОКОЛ (ручной ввод)
// ═══════════════════════════════════════════════════════════════
var _chemFormGroup = 'organo';

function showChemProtocolForm(protocolId) {
  _chemFormGroup = 'organo';
  var proto = protocolId ? ChemState.protocols.find(function(p){ return p.id === protocolId; }) : null;
  var existingResults = proto ? (ChemState.results[protocolId] || []) : [];

  var wpOpts = '<option value="">— Выберите водопункт —</option>' + ChemState.waterPoints.map(function(w) {
    return '<option value="' + w.id + '"' + (proto && proto.water_point_id === w.id ? ' selected' : '') + '>' + escHTML(w.name) + '</option>';
  }).join('');

  var today = new Date().toISOString().slice(0,10);

  // Шапка протокола
  var headerHtml =
    '<div class="chem-form-row">' +
      '<div class="chem-fld"><label>Водопункт *</label>' +
        '<select class="chem-inp" id="pf-wp">' + wpOpts + '</select></div>' +
      '<div class="chem-fld"><label>Дата отбора проб *</label>' +
        '<input class="chem-inp" type="date" id="pf-date" value="' + (proto ? proto.sampled_at : today) + '"></div>' +
    '</div>' +
    '<div class="chem-form-row chem-form-row-3">' +
      '<div class="chem-fld"><label>Лаборатория</label>' +
        '<input class="chem-inp" id="pf-lab" placeholder="EcoExpert" value="' + escHTML(proto ? (proto.lab_name||'') : '') + '"></div>' +
      '<div class="chem-fld"><label>№ протокола</label>' +
        '<input class="chem-inp" id="pf-proto-num" placeholder="421/2" value="' + escHTML(proto ? (proto.lab_protocol_number||'') : '') + '"></div>' +
      '<div class="chem-fld"><label>Лаб. номер пробы</label>' +
        '<input class="chem-inp" id="pf-lab-num" placeholder="977" value="' + escHTML(proto ? (proto.lab_number||'') : '') + '"></div>' +
    '</div>' +

    // Вкладки групп параметров — все группы рендерятся сразу, скрываются через display
    '<div style="border-top:1px solid var(--line);margin:16px -20px;padding:16px 20px 0">' +
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-3);margin-bottom:10px">Результаты анализа</div>' +
      '<div class="chem-gtabs" id="chem-gtabs">' +
        Object.keys(CHEM_GROUPS).map(function(g) {
          var cnt = CHEM_PARAMS.filter(function(p){ return p.group === g; }).length;
          return '<button class="chem-gtab' + (g === _chemFormGroup ? ' active' : '') + '" data-grp="' + g + '" onclick="chemSwitchFormGroup(\'' + g + '\')">' +
            CHEM_GROUPS[g].icon + ' ' + CHEM_GROUPS[g].label + ' <span style="opacity:.5;font-size:10px">(' + cnt + ')</span>' +
          '</button>';
        }).join('') +
      '</div>' +
      // Рендерим все панели сразу — данные в DOM сохраняются при переключении
      '<div id="chem-param-grid-wrap">' +
        Object.keys(CHEM_GROUPS).map(function(g) {
          return '<div id="chem-grp-' + g + '" style="display:' + (g === _chemFormGroup ? 'block' : 'none') + '">' +
            _chemParamGrid(g, existingResults) +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';

  _chemOpenModal(
    (proto ? 'Редактировать протокол' : 'Новый протокол') + (proto && proto.lab_protocol_number ? ' №' + proto.lab_protocol_number : ''),
    headerHtml,
    '<button class="chem-btn chem-btn-ghost" onclick="_chemCloseModal()">Отмена</button>' +
    '<button class="chem-btn chem-btn-prim" onclick="_chemSaveProtocol(\'' + (proto ? proto.id : '') + '\')">Сохранить протокол</button>',
    'max-width:860px'
  );
}

function chemSwitchFormGroup(grp) {
  _chemFormGroup = grp;
  // Переключаем активную вкладку
  document.querySelectorAll('.chem-gtab').forEach(function(b) {
    b.classList.toggle('active', b.dataset.grp === grp);
  });
  // Показываем нужную панель — DOM не пересоздаётся, данные сохраняются
  Object.keys(CHEM_GROUPS).forEach(function(g) {
    var panel = document.getElementById('chem-grp-' + g);
    if (panel) panel.style.display = g === grp ? 'block' : 'none';
  });
}

function _chemParamGrid(grp, existingResults) {
  var params = CHEM_PARAMS.filter(function(p) { return p.group === grp; });
  var html = '<div class="chem-param-grid">';
  params.forEach(function(p) {
    var existing = existingResults.find(function(r){ return r.param_key === p.key; });
    var val = existing ? (existing.value_raw || '') : '';
    var pdkHint = _chemPdkStr(p);
    html += '<div class="chem-param-fld">' +
      '<label class="chem-param-lbl">' + p.no + '. ' + escHTML(p.name) + '<span>' + escHTML(p.unit) + (pdkHint ? ' · ПДК: ' + pdkHint : '') + '</span></label>' +
      '<input class="chem-param-inp" id="pr-' + p.key + '" data-pkey="' + p.key + '" placeholder="например: 7,9 или <0,50" value="' + escHTML(val) + '" oninput="_chemCheckParamInput(this)">' +
    '</div>';
  });
  html += '</div>';
  return html;
}

function _chemCheckParamInput(inp) {
  var key = inp.dataset.pkey;
  var val = inp.value.trim();
  if (!val) { inp.classList.remove('exceed'); return; }
  var parsed = _chemParseValue(val);
  var status = parsed ? _chemPdkStatus(key, val, parsed.below) : 'no_norm';
  inp.classList.toggle('exceed', status === 'exceed');
}

async function _chemSaveProtocol(existingId) {
  var wpId  = document.getElementById('pf-wp').value;
  var date  = document.getElementById('pf-date').value;
  if (!wpId)  { alert('Выберите водопункт'); return; }
  if (!date)  { alert('Введите дату отбора проб'); return; }

  var protoRow = {
    water_point_id:      wpId,
    sampled_at:          date,
    lab_name:            document.getElementById('pf-lab').value.trim() || null,
    lab_protocol_number: document.getElementById('pf-proto-num').value.trim() || null,
    lab_number:          document.getElementById('pf-lab-num').value.trim() || null,
    protocol_type:       'full',
    source:              'manual',
  };
  if (existingId) protoRow.id = existingId;

  var pRes = await ChemApi.upsertProtocol(protoRow);
  if (pRes.error) { alert('Ошибка сохранения протокола: ' + pRes.error.message); return; }
  var savedProto = pRes.data;

  // Собираем все введённые значения
  var resultRows = [];
  CHEM_PARAMS.forEach(function(p) {
    var inp = document.getElementById('pr-' + p.key);
    if (!inp) return;
    var raw = inp.value.trim();
    if (!raw) return;
    var parsed = _chemParseValue(raw);
    resultRows.push({
      protocol_id:     savedProto.id,
      param_key:       p.key,
      value_raw:       raw,
      value_num:       parsed && !parsed.below && !parsed.above ? parsed.num : null,
      below_detection: parsed ? parsed.below : false,
      above_range:     parsed ? parsed.above : false,
    });
  });

  if (resultRows.length) {
    // Сначала чистим старые результаты если редактируем
    if (existingId) await ChemApi.deleteResults(existingId);
    var rRes = await ChemApi.upsertResults(resultRows);
    if (rRes.error) console.warn('[chem] results save error', rRes.error);
  }

  // Обновляем локальное состояние
  if (existingId) {
    ChemState.protocols = ChemState.protocols.map(function(p){ return p.id === existingId ? savedProto : p; });
  } else {
    ChemState.protocols.unshift(savedProto);
  }
  ChemState.results[savedProto.id] = resultRows;

  _chemCloseModal();
  _chemRenderSection('protocols');
  if (typeof Toast !== 'undefined') Toast.ok('Протокол сохранён');
}

async function chemDeleteProtocol(id) {
  if (!confirm('Удалить протокол и все его результаты?')) return;
  await ChemApi.deleteResults(id);
  var res = await ChemApi.deleteProtocol(id);
  if (res.error) { alert('Ошибка удаления: ' + res.error.message); return; }
  ChemState.protocols = ChemState.protocols.filter(function(p){ return p.id !== id; });
  delete ChemState.results[id];
  _chemRenderSection('protocols');
}

// ═══════════════════════════════════════════════════════════════
//  ИМПОРТ EXCEL
// ═══════════════════════════════════════════════════════════════
function showChemExcelImport() {
  _chemOpenModal(
    'Импорт из Excel',
    '<div style="margin-bottom:16px">' +
      '<div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:8px;padding:12px 14px;margin-bottom:14px">' +
        '<div style="font-size:12px;font-weight:600;color:var(--blue);margin-bottom:6px">📋 Формат шаблона Excel</div>' +
        '<div style="font-size:11px;color:var(--txt-2);line-height:1.6">' +
          'Файл должен содержать колонки: <b>Водопункт</b> (название или код), <b>Дата</b> (ДД.ММ.ГГГГ), ' +
          '<b>№ протокола</b>, <b>Лаборатория</b>, и затем колонки с ключами параметров.<br>' +
          'Ключи параметров: <code>ph_lab</code>, <code>turbidity</code>, <code>tds</code>, <code>no3</code>, <code>fe_total</code> и т.д.<br>' +
          'Значения: числа с точкой или запятой, знаки &lt; и &gt; поддерживаются (напр. <code>&lt;0.05</code>).' +
        '</div>' +
      '</div>' +
      '<button class="chem-btn chem-btn-ghost" style="margin-bottom:12px" onclick="_chemDownloadTemplate()">⬇ Скачать шаблон CSV</button>' +
      '<div class="chem-fld"><label>Выберите файл CSV / Excel</label>' +
        '<input type="file" id="chem-xl-file" accept=".csv,.xlsx,.xls" class="chem-inp" style="padding:6px">' +
      '</div>' +
      '<div id="chem-xl-preview" style="margin-top:12px"></div>' +
    '</div>',
    '<button class="chem-btn chem-btn-ghost" onclick="_chemCloseModal()">Отмена</button>' +
    '<button class="chem-btn chem-btn-prim" onclick="_chemImportCsv()">Импортировать</button>'
  );
  setTimeout(function() {
    var fileInp = document.getElementById('chem-xl-file');
    if (fileInp) fileInp.addEventListener('change', _chemPreviewCsv);
  }, 100);
}

function _chemDownloadTemplate() {
  var header = ['Водопункт','Дата (ДД.ММ.ГГГГ)','№ протокола','Лаборатория'].concat(
    CHEM_PARAMS.map(function(p){ return p.key + ' (' + p.name + ', ' + p.unit + ')'; })
  );
  var example = ['ПН-1 Гордеевка','11.06.2026','421/2','EcoExpert'].concat(
    CHEM_PARAMS.map(function(p){ return ''; })
  );
  var csv = header.join(';') + '\n' + example.join(';');
  var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a'); a.href = url; a.download = 'chem_template.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _chemPreviewCsv() {
  var file = document.getElementById('chem-xl-file') && document.getElementById('chem-xl-file').files[0];
  if (!file) return;
  var preview = document.getElementById('chem-xl-preview');
  if (!preview) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var text = e.target.result;
    var lines = text.split(/\r?\n/).filter(function(l){ return l.trim(); });
    preview.innerHTML = '<div style="font-size:11px;color:var(--txt-3);margin-bottom:4px">Предпросмотр (' + (lines.length-1) + ' строк данных):</div>' +
      '<div style="background:var(--bg-1);border:1px solid var(--line);border-radius:6px;padding:8px;font-size:10px;font-family:monospace;overflow-x:auto;max-height:120px;overflow-y:auto;color:var(--txt-2)">' +
      escHTML(lines.slice(0,5).join('\n')) + '</div>';
  };
  reader.readAsText(file, 'UTF-8');
}

async function _chemImportCsv() {
  var file = document.getElementById('chem-xl-file') && document.getElementById('chem-xl-file').files[0];
  if (!file) { alert('Выберите файл'); return; }
  var reader = new FileReader();
  reader.onload = async function(e) {
    try {
      var text = e.target.result;
      var lines = text.split(/\r?\n/).filter(function(l){ return l.trim(); });
      if (lines.length < 2) { alert('Файл пустой или содержит только заголовок'); return; }
      var sep = lines[0].includes(';') ? ';' : ',';
      var headers = lines[0].split(sep).map(function(h){ return h.trim().replace(/^﻿/, ''); });

      var imported = 0, errors = 0;
      for (var li = 1; li < lines.length; li++) {
        var cols = lines[li].split(sep);
        var wpName = cols[0] ? cols[0].trim() : '';
        var dateStr = cols[1] ? cols[1].trim() : '';
        var protoNum = cols[2] ? cols[2].trim() : '';
        var labName  = cols[3] ? cols[3].trim() : '';
        if (!wpName || !dateStr) continue;

        // Найти или создать водопункт
        var wp = ChemState.waterPoints.find(function(w){
          return w.name === wpName || w.code === wpName;
        });
        if (!wp) {
          var wpRes = await ChemApi.upsertWaterPoint({ name: wpName });
          if (wpRes.error) { errors++; continue; }
          wp = wpRes.data;
          ChemState.waterPoints.push(wp);
        }

        // Дата: ДД.ММ.ГГГГ → YYYY-MM-DD
        var dateParts = dateStr.split('.');
        var isoDate = dateParts.length === 3
          ? dateParts[2] + '-' + dateParts[1] + '-' + dateParts[0]
          : dateStr;

        var protoRow = {
          water_point_id: wp.id, sampled_at: isoDate,
          lab_protocol_number: protoNum || null, lab_name: labName || null,
          protocol_type: 'full', source: 'excel',
        };
        var pRes = await ChemApi.upsertProtocol(protoRow);
        if (pRes.error) { errors++; continue; }
        var proto = pRes.data;

        // Результаты
        var resultRows = [];
        for (var hi = 4; hi < headers.length; hi++) {
          var hdr = headers[hi].split(' ')[0]; // берём только ключ до скобки
          var param = CHEM_PARAM_MAP[hdr];
          if (!param) continue;
          var raw = cols[hi] ? cols[hi].trim() : '';
          if (!raw) continue;
          var parsed = _chemParseValue(raw);
          resultRows.push({
            protocol_id: proto.id, param_key: param.key,
            value_raw: raw,
            value_num: parsed && !parsed.below && !parsed.above ? parsed.num : null,
            below_detection: parsed ? parsed.below : false,
            above_range:     parsed ? parsed.above : false,
          });
        }
        if (resultRows.length) await ChemApi.upsertResults(resultRows);
        ChemState.protocols.unshift(proto);
        ChemState.results[proto.id] = resultRows;
        imported++;
      }

      _chemCloseModal();
      _chemRenderSection('protocols');
      if (typeof Toast !== 'undefined') Toast.ok('Импортировано: ' + imported + ' протоколов' + (errors ? ', ошибок: ' + errors : ''));
    } catch(err) {
      alert('Ошибка разбора файла: ' + err.message);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

// ═══════════════════════════════════════════════════════════════
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════
function _chemParseValue(str) {
  if (!str) return null;
  var s = str.trim().replace(',', '.');
  var below = s.charAt(0) === '<';
  var above = s.charAt(0) === '>';
  var numStr = s.replace(/^[<>]/, '');
  var num = parseFloat(numStr);
  if (isNaN(num)) return null;
  return { num: num, below: below, above: above };
}

function _chemPdkStatus(paramKey, valueRaw, belowDetection) {
  var p = CHEM_PARAM_MAP[paramKey];
  if (!p) return 'no_norm';
  var parsed = _chemParseValue(valueRaw);
  if (!parsed) return 'nd';

  if (belowDetection || parsed.below) {
    // Ниже предела обнаружения — в норме если ПДК существует и предел ≤ ПДК
    var pdkVal = p.pdk_drink || p.pdk_drink_max;
    if (pdkVal !== null && pdkVal !== undefined && parsed.num <= pdkVal) return 'ok';
    return 'no_norm'; // нет ПДК — не можем оценить
  }

  var v = parsed.num;

  if (p.pdk_type === 'range') {
    var lo = p.pdk_drink_min, hi = p.pdk_drink_max;
    if (lo !== undefined && hi !== undefined) {
      return (v >= lo && v <= hi) ? 'ok' : 'exceed';
    }
    return 'no_norm';
  }
  if (p.pdk_type === 'min') {
    var mn = p.pdk_drink;
    if (mn !== null && mn !== undefined) return v >= mn ? 'ok' : 'exceed';
    return 'no_norm';
  }
  // max / score
  var mx = p.pdk_drink;
  if (mx !== null && mx !== undefined) return v <= mx ? 'ok' : 'exceed';
  return 'no_norm';
}

function _chemPdkStr(p) {
  if (p.pdk_type === 'range') {
    if (p.pdk_drink_min !== undefined) return p.pdk_drink_min + '–' + p.pdk_drink_max;
  }
  if (p.pdk_type === 'min') {
    if (p.pdk_drink !== null && p.pdk_drink !== undefined) return '≥' + p.pdk_drink;
  }
  if (p.pdk_drink !== null && p.pdk_drink !== undefined) return '≤' + p.pdk_drink;
  return '—';
}

function _chemFmtDate(str, short) {
  if (!str) return '—';
  var parts = str.substring(0,10).split('-');
  if (parts.length < 3) return str;
  if (short) return parts[2] + '.' + parts[1] + '.' + parts[0].substring(2);
  return parts[2] + '.' + parts[1] + '.' + parts[0];
}

function _chemFmtNum(v) {
  if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(1);
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString('ru');
  return parseFloat(v.toPrecision(4)).toString();
}

function _chemKpi(label, val, sub, extraCls) {
  return '<div class="chem-kpi' + (extraCls ? ' ' + extraCls : '') + '">' +
    '<div class="chem-kpi-lbl">' + label + '</div>' +
    '<div class="chem-kpi-val">' + val + '</div>' +
    '<div class="chem-kpi-sub">' + sub + '</div>' +
  '</div>';
}

// ── Модальное окно ─────────────────────────────────────────────
function _chemOpenModal(title, body, footer, extraStyle) {
  _chemCloseModal();
  var ov = document.createElement('div');
  ov.className = 'chem-overlay';
  ov.id = 'chem-overlay';
  ov.innerHTML =
    '<div class="chem-modal" style="' + (extraStyle || '') + '">' +
      '<div class="chem-modal-hdr">' +
        '<span class="chem-modal-title">' + title + '</span>' +
        '<button class="chem-modal-close" onclick="_chemCloseModal()">✕</button>' +
      '</div>' +
      '<div class="chem-modal-body">' + body + '</div>' +
      '<div class="chem-modal-footer">' + (footer || '') + '</div>' +
    '</div>';
  ov.addEventListener('click', function(e) { if (e.target === ov) _chemCloseModal(); });
  document.body.appendChild(ov);
}

function _chemCloseModal() {
  var ov = document.getElementById('chem-overlay');
  if (ov) ov.remove();
}

// Экспорт в глобальный scope
window.initChemTab         = initChemTab;
window.chemFilterChange    = chemFilterChange;
window.chemToggleProto     = chemToggleProto;
window.showChemWpForm      = showChemWpForm;
window.chemDeleteWp        = chemDeleteWp;
window.showChemProtocolForm= showChemProtocolForm;
window.chemSwitchFormGroup = chemSwitchFormGroup;
window.chemDeleteProtocol  = chemDeleteProtocol;
window.showChemExcelImport = showChemExcelImport;
window.chemRenderAnlChart  = chemRenderAnlChart;
window._chemCloseModal     = _chemCloseModal;
window._chemSaveWp         = _chemSaveWp;
window._chemSaveProtocol   = _chemSaveProtocol;
window._chemImportCsv      = _chemImportCsv;
window._chemDownloadTemplate = _chemDownloadTemplate;
window._chemCheckParamInput  = _chemCheckParamInput;
