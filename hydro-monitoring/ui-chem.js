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
  { key:'density',     no:58, name:'Плотность',                   unit:'г/см³',           group:'physico', pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  // Цианиды — расширенные
  { key:'cn_free',    no:58, name:'Цианиды свободные',           unit:'мг/дм³',         group:'organic', pdk_type:'max',   pdk_drink:0.035,  pdk_tech:null },
  { key:'cn_weak',    no:59, name:'Цианиды слабосвязанные',      unit:'мг/дм³',         group:'organic', pdk_type:'max',   pdk_drink:0.07,   pdk_tech:null },
  { key:'cn_strong',  no:60, name:'Цианиды прочносвязанные',     unit:'мг/дм³',         group:'organic', pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'cns',        no:61, name:'Роданиды (CNS⁻)',             unit:'мг/дм³',         group:'organic', pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  // Радиология — базовая
  { key:'alpha_total',no:62, name:'Суммарная α-активность',      unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:0.1,    pdk_tech:null },
  { key:'beta_total', no:63, name:'Суммарная β-активность',      unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:1.0,    pdk_tech:null },
  { key:'ra226',      no:64, name:'Радий-226 (Ra-226)',           unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:0.49,   pdk_tech:null },
  { key:'rn222',      no:65, name:'Радон-222 (Rn-222)',           unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:60,     pdk_tech:null },
  { key:'u_nat',      no:66, name:'Уран природный (U)',           unit:'мг/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:0.015,  pdk_tech:null },
  // Радиология — расширенная
  { key:'cs137',      no:67, name:'Цезий-137 (Cs-137)',           unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'sr90',       no:68, name:'Стронций-90 (Sr-90)',          unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:0.49,   pdk_tech:null },
  { key:'pu239',      no:69, name:'Плутоний-239 (Pu-239)',        unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'pu240',      no:70, name:'Плутоний-240 (Pu-240)',        unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'am241',      no:71, name:'Америций-241 (Am-241)',         unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'th232',      no:72, name:'Торий-232 (Th-232)',            unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'u234',       no:73, name:'Уран-234 (U-234)',              unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'u235',       no:74, name:'Уран-235 (U-235)',              unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'u238',       no:75, name:'Уран-238 (U-238)',              unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'ra228',      no:76, name:'Радий-228 (Ra-228)',            unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
  { key:'k40',        no:77, name:'Калий-40 (K-40)',              unit:'Бк/дм³',         group:'radio',   pdk_type:'max',   pdk_drink:null,   pdk_tech:null },
];

var CHEM_PARAM_MAP = {};
CHEM_PARAMS.forEach(function(p) { CHEM_PARAM_MAP[p.key] = p; });

var CHEM_GROUPS = {
  organo:  { label:'Органолептика',    icon:'🫧' },
  physico: { label:'Физ-химия',        icon:'⚗️' },
  macro:   { label:'Макроэлементы',    icon:'🧪' },
  metals:  { label:'Металлы',          icon:'🔩' },
  organic: { label:'Органика',         icon:'🛢️' },
  radio:   { label:'Радиология',       icon:'☢️' },
};

/* ── Типы шаблонов протоколов ───────────────────────────────────*/
var CHEM_TEMPLATE_TYPES = {
  sha: {
    label: 'СХА',
    desc:  'Стандартный химический анализ',
    icon:  '🧪',
    params: ['smell','taste','color','turbidity','transp',
             'ph_lab','ph_field','tds','hardness','oxidability','apav','dry_res','alkalinity','density',
             'na','k','ca','mg','nh4','nh3','co3','hco3','no3','no2','so4','cl','f','si','iodide',
             'fe2','fe3','fe_total','mn','cu','zn','al','ba','ni','mo','oil','phenol'],
  },
  radio: {
    label: 'Радиология',
    desc:  'Базовый радиологический анализ',
    icon:  '☢️',
    params: ['alpha_total','beta_total','ra226','rn222','u_nat'],
  },
  cn: {
    label: 'Цианиды (CN)',
    desc:  'Полный анализ по цианидам',
    icon:  '⚗️',
    params: ['cn','cn_free','cn_weak','cn_strong','cns'],
  },
  micro: {
    label: 'Микрокомпоненты',
    desc:  'Тяжёлые металлы и микроэлементы',
    icon:  '🔩',
    params: ['as','pb','cd','cr3','cr6','cu','zn','ni','co_metal','hg',
             'mo','sb','se','ba','be','v','al','b','li','tl','ag','sr','mn','fe_total'],
  },
  radio_full: {
    label: 'Развёрнутая радиология',
    desc:  'Полный спектр радионуклидов',
    icon:  '☢️',
    params: ['alpha_total','beta_total','cs137','sr90','pu239','pu240',
             'am241','th232','u234','u235','u238','ra226','ra228','rn222','k40'],
  },
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
/* ── Подписи и цвета для видов протоколов ──────────────────────*/
var CHEM_PROTO_TYPE_META = {
  sha:        { label: 'СХА',                   icon: '🧪', color: '#3b82f6' },
  radio:      { label: 'Радиология',             icon: '☢️', color: '#a855f7' },
  cn:         { label: 'Цианиды',                icon: '⚗️', color: '#f59e0b' },
  micro:      { label: 'Микрокомпоненты',        icon: '🔩', color: '#10b981' },
  radio_full: { label: 'Развёрнутая радиология', icon: '☢️', color: '#8b5cf6' },
  full:       { label: 'Полный анализ',          icon: '📋', color: '#6b7280' },
};

var ChemState = {
  waterPoints: [],    // [{id, name, code, type, ...}]
  protocols:   [],    // [{id, water_point_id, sampled_at, ...}]
  results:     {},    // { protocol_id: [{param_key, value_raw, value_num, below_detection}] }
  loading:     false,
  loaded:      false,
  activeSection: 'protocols', // 'waterpoints' | 'protocols' | 'analytics' | 'heatmap'
  filterWpId:        '',
  filterProtoType:   '',
  filterType:        '',
  filterYear:        '',
  filterExceedOnly:  false,
  compareIds:        [],   // up to 2 protocol IDs for comparison
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
        _chemRailItem('analytics',   '📈', 'Тренды') +
        _chemRailItem('heatmap',     '🌡️', 'Тепловая карта') +
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
  if (sec === 'heatmap')     _chemRenderHeatmap(cont);
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
      '<span class="chem-filter-lbl">Вид:</span>' +
      '<select class="chem-sel" id="chem-f-ptype" onchange="chemFilterChange()">' +
        '<option value="">Все виды</option>' +
        Object.keys(CHEM_PROTO_TYPE_META).map(function(k) {
          var m = CHEM_PROTO_TYPE_META[k];
          return '<option value="' + k + '"' + (ChemState.filterProtoType === k ? ' selected' : '') + '>' + m.icon + ' ' + m.label + '</option>';
        }).join('') +
      '</select>' +
      '<span class="chem-filter-lbl">Год:</span>' +
      '<select class="chem-sel" id="chem-f-year" onchange="chemFilterChange()">' +
        '<option value="">Все годы</option>' + yearOpts +
      '</select>' +
      '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--txt-2);user-select:none">' +
        '<input type="checkbox" id="chem-f-exceed"' + (ChemState.filterExceedOnly ? ' checked' : '') + ' onchange="chemFilterChange()" style="accent-color:#f87171;width:14px;height:14px;cursor:pointer">' +
        'Только превышения ПДК' +
      '</label>' +
      '<div style="flex:1"></div>' +
      '<div id="chem-compare-bar" style="display:none;align-items:center;gap:8px">' +
        '<span id="chem-compare-lbl" style="font-size:11px;color:var(--txt-3)"></span>' +
        '<button class="chem-btn chem-btn-ghost" style="padding:5px 10px;font-size:11px" onclick="showChemCompare()">≈ Сравнить</button>' +
        '<button class="chem-btn chem-btn-danger" style="padding:5px 8px;font-size:11px" onclick="chemClearCompare()">✕</button>' +
      '</div>' +
      '<span class="chem-filter-lbl" id="chem-count-lbl"></span>' +
    '</div>' +

    '<div class="chem-proto-list" id="chem-proto-list"></div>';

  _chemRenderProtoList();
}

function chemFilterChange() {
  ChemState.filterWpId       = document.getElementById('chem-f-wp')     ? document.getElementById('chem-f-wp').value     : '';
  ChemState.filterProtoType  = document.getElementById('chem-f-ptype')  ? document.getElementById('chem-f-ptype').value  : '';
  ChemState.filterYear       = document.getElementById('chem-f-year')   ? document.getElementById('chem-f-year').value   : '';
  ChemState.filterExceedOnly = document.getElementById('chem-f-exceed') ? document.getElementById('chem-f-exceed').checked : false;
  _chemRenderProtoList();
}

function _chemRenderProtoList() {
  var list = document.getElementById('chem-proto-list');
  if (!list) return;

  var filtered = ChemState.protocols.filter(function(p) {
    if (ChemState.filterWpId && p.water_point_id !== ChemState.filterWpId) return false;
    if (ChemState.filterProtoType && (p.protocol_type || 'full') !== ChemState.filterProtoType) return false;
    if (ChemState.filterYear && (!p.sampled_at || p.sampled_at.substring(0,4) !== ChemState.filterYear)) return false;
    if (ChemState.filterExceedOnly) {
      var rows = ChemState.results[p.id] || [];
      var hasExceed = rows.some(function(r) {
        return _chemPdkStatus(r.param_key, r.value_raw, r.below_detection) === 'exceed';
      });
      if (!hasExceed) return false;
    }
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

    var ptMeta = CHEM_PROTO_TYPE_META[p.protocol_type] || CHEM_PROTO_TYPE_META['full'];
    var ptBadge = '<span class="chem-badge" style="background:' + ptMeta.color + '18;color:' + ptMeta.color + ';border-color:' + ptMeta.color + '40">' + ptMeta.icon + ' ' + ptMeta.label + '</span>';

    var inCompare = ChemState.compareIds.indexOf(p.id) !== -1;
    return '<div class="chem-proto-card" id="cpc-' + p.id + '">' +
      '<div class="chem-proto-head" onclick="chemToggleProto(\'' + p.id + '\')">' +
        '<label onclick="event.stopPropagation()" title="Добавить в сравнение" style="display:flex;align-items:center;margin-right:6px;cursor:pointer">' +
          '<input type="checkbox" ' + (inCompare ? 'checked' : '') + ' onchange="chemToggleCompare(\'' + p.id + '\',this.checked)" style="accent-color:var(--blue);width:14px;height:14px;cursor:pointer">' +
        '</label>' +
        '<span class="chem-proto-date">' + _chemFmtDate(p.sampled_at) + '</span>' +
        '<div style="display:flex;flex-direction:column;gap:1px">' +
          '<span class="chem-proto-wp">' + escHTML(wp ? wp.name : '—') + '</span>' +
          '<span class="chem-proto-lab">' +
            (p.lab_name ? escHTML(p.lab_name) : '') +
            (p.lab_protocol_number ? ' №' + escHTML(p.lab_protocol_number) : '') +
            (p.lab_number ? ' (проба ' + escHTML(p.lab_number) + ')' : '') +
          '</span>' +
        '</div>' +
        '<div class="chem-proto-badges">' +
          ptBadge +
          badge +
          '<span class="chem-badge chem-badge-gray">' + (rows.length || '?') + ' пар.</span>' +
          '<button class="chem-btn chem-btn-ghost" style="padding:4px 8px;font-size:11px" onclick="event.stopPropagation();showChemWpPassport(\'' + (wp ? wp.id : '') + '\')" title="Паспорт водопункта">🗒</button>' +
          '<button class="chem-btn chem-btn-ghost" style="padding:4px 8px;font-size:11px" onclick="event.stopPropagation();_chemExportCsv(\'' + p.id + '\')" title="Экспорт CSV">⬇</button>' +
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
    '<div class="chem-hdr"><span class="chem-hdr-title">Тренды по параметрам</span>' +
      '<span class="chem-hdr-sub">Удерживайте Ctrl для выбора нескольких параметров</span>' +
    '</div>' +
    '<div class="chem-filters">' +
      '<span class="chem-filter-lbl">Водопункт:</span>' +
      '<select class="chem-sel" id="anl-wp" onchange="chemRenderAnlChart()">' + wpOpts + '</select>' +
      '<span class="chem-filter-lbl">Параметры:</span>' +
      '<select class="chem-sel" id="anl-param" multiple onchange="chemRenderAnlChart()" style="min-width:240px;height:80px">' + paramOpts + '</select>' +
    '</div>' +
    '<div id="chem-anl-charts"></div>';
}

var CHEM_SERIES_COLORS = ['#38bdf8','#34d399','#fb923c','#a78bfa','#f472b6','#fbbf24'];

function chemRenderAnlChart() {
  var wpSel   = document.getElementById('anl-wp');
  var pSel    = document.getElementById('anl-param');
  var wrap    = document.getElementById('chem-anl-charts');
  if (!wpSel || !pSel || !wrap) return;

  var wpId = wpSel.value;
  var selectedKeys = Array.from(pSel.selectedOptions || []).map(function(o){ return o.value; });

  if (!wpId || !selectedKeys.length) {
    wrap.innerHTML = '<div class="chem-anl-chart"><div class="chem-empty" style="padding:40px"><div class="chem-empty-ico">📈</div>' +
      '<div class="chem-empty-txt">Выберите водопункт и параметры</div></div></div>';
    return;
  }

  // Collect all dates for this waterpoint
  var protos = ChemState.protocols.filter(function(p){ return p.water_point_id === wpId; })
    .sort(function(a,b){ return a.sampled_at > b.sampled_at ? 1 : -1; });

  if (!protos.length) {
    wrap.innerHTML = '<div class="chem-anl-chart"><div class="chem-empty" style="padding:40px"><div class="chem-empty-ico">🔎</div>' +
      '<div class="chem-empty-txt">Нет протоколов по этому водопункту</div></div></div>';
    return;
  }

  // Render one chart per selected parameter
  wrap.innerHTML = selectedKeys.map(function(paramKey, ci) {
    var param = CHEM_PARAM_MAP[paramKey];
    if (!param) return '';
    var color = CHEM_SERIES_COLORS[ci % CHEM_SERIES_COLORS.length];

    var points = [];
    protos.forEach(function(p) {
      var rows = ChemState.results[p.id] || [];
      var r = rows.find(function(r) { return r.param_key === paramKey; });
      if (r && r.value_num !== null && r.value_num !== undefined) {
        points.push({ date: p.sampled_at, val: parseFloat(r.value_num), raw: r.value_raw, below: r.below_detection });
      }
    });

    if (!points.length) {
      return '<div class="chem-anl-chart" style="margin-bottom:8px">' +
        '<div style="font-size:12px;font-weight:600;color:var(--txt-2);margin-bottom:6px">' + escHTML(param.name) + '</div>' +
        '<div style="color:var(--txt-3);font-size:12px;padding:10px 0">Нет числовых данных</div>' +
      '</div>';
    }

    var W = 600, H = 160, PL = 60, PR = 20, PT = 14, PB = 32;
    var cW = W - PL - PR, cH = H - PT - PB;
    var vals = points.map(function(p){ return p.val; });
    var minV = Math.min.apply(null, vals), maxV = Math.max.apply(null, vals);
    var pdk = (param.pdk_drink !== null && param.pdk_drink !== undefined) ? param.pdk_drink : param.pdk_drink_max;

    if (pdk !== null && pdk !== undefined) {
      minV = Math.min(minV, 0);
      maxV = Math.max(maxV, pdk * 1.15);
    } else {
      var sp = maxV - minV || 1;
      minV = Math.max(0, minV - sp * 0.1);
      maxV = maxV + sp * 0.1;
    }
    var range = maxV - minV || 1;

    function px(i) { return PL + (points.length > 1 ? (i / (points.length - 1)) * cW : cW / 2); }
    function py(v)  { return PT + (1 - (v - minV) / range) * cH; }

    var pathD = points.map(function(p, i){ return (i === 0 ? 'M' : 'L') + px(i).toFixed(1) + ',' + py(p.val).toFixed(1); }).join(' ');
    var areaD = pathD + ' L' + px(points.length-1).toFixed(1) + ',' + (PT+cH) + ' L' + PL.toFixed(1) + ',' + (PT+cH) + ' Z';

    var pdkLine = '';
    if (pdk !== null && pdk !== undefined) {
      var pdkY = py(pdk).toFixed(1);
      if (parseFloat(pdkY) >= PT && parseFloat(pdkY) <= PT+cH) {
        pdkLine = '<line x1="' + PL + '" y1="' + pdkY + '" x2="' + (PL+cW) + '" y2="' + pdkY + '" stroke="#f87171" stroke-width="1" stroke-dasharray="4,3" opacity=".8"/>' +
          '<text x="' + (PL+cW+2) + '" y="' + (parseFloat(pdkY)+4) + '" fill="#f87171" font-size="9" font-weight="600">ПДК</text>';
      }
    }

    var yLabels = '';
    [0, 0.25, 0.5, 0.75, 1].forEach(function(f) {
      var v = minV + f * range;
      var y = py(v).toFixed(1);
      yLabels += '<line x1="' + PL + '" y1="' + y + '" x2="' + (PL+cW) + '" y2="' + y + '" stroke="var(--line)" stroke-width="0.5"/>' +
        '<text x="' + (PL-4) + '" y="' + (parseFloat(y)+4) + '" text-anchor="end" fill="var(--txt-3)" font-size="9" font-variant-numeric="tabular-nums">' + _chemFmtNum(v) + '</text>';
    });

    var xLabels = '';
    var step = Math.max(1, Math.ceil(points.length / 6));
    points.forEach(function(p, i) {
      if (i % step !== 0 && i !== points.length - 1) return;
      xLabels += '<text x="' + px(i).toFixed(1) + '" y="' + (PT+cH+18) + '" text-anchor="middle" fill="var(--txt-3)" font-size="9">' + _chemFmtDate(p.date, true) + '</text>';
    });

    var dots = points.map(function(p, i) {
      var st = _chemPdkStatus(paramKey, String(p.val), p.below);
      var clr = st === 'exceed' ? '#f87171' : color;
      var title = _chemFmtDate(p.date) + ': ' + p.val + ' ' + param.unit;
      return '<circle cx="' + px(i).toFixed(1) + '" cy="' + py(p.val).toFixed(1) + '" r="3.5" fill="' + clr + '" stroke="var(--bg-2)" stroke-width="1.5"><title>' + escHTML(title) + '</title></circle>';
    }).join('');

    var gradId = 'chemGrad' + ci;
    return '<div class="chem-anl-chart" style="margin-bottom:10px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:' + color + '"></span>' +
          '<span style="font-size:13px;font-weight:600;color:var(--txt-1)">' + escHTML(param.name) + '</span>' +
        '</div>' +
        '<span style="font-size:11px;color:var(--txt-3)">' + escHTML(param.unit) + '</span>' +
      '</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;overflow:visible">' +
        '<defs>' +
          '<linearGradient id="' + gradId + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0%" stop-color="' + color + '" stop-opacity=".22"/>' +
            '<stop offset="100%" stop-color="' + color + '" stop-opacity=".02"/>' +
          '</linearGradient>' +
        '</defs>' +
        yLabels + xLabels + pdkLine +
        '<path d="' + areaD + '" fill="url(#' + gradId + ')"/>' +
        '<path d="' + pathD + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
        dots +
      '</svg>' +
    '</div>';
  }).join('');
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
  if (typeof Toast !== 'undefined') Toast.done('msg', 'Водопункт сохранён');
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
    '<div class="chem-form-row">' +
      '<div class="chem-fld"><label>Вид протокола</label>' +
        '<select class="chem-inp" id="pf-proto-type">' +
          Object.keys(CHEM_PROTO_TYPE_META).map(function(k) {
            var m = CHEM_PROTO_TYPE_META[k];
            var sel = proto && proto.protocol_type === k ? ' selected' : (!proto && k === 'sha' ? ' selected' : '');
            return '<option value="' + k + '"' + sel + '>' + m.icon + ' ' + m.label + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
    '</div>' +

    // Вкладки групп параметров — все группы рендерятся сразу, скрываются через display
    '<div style="border-top:1px solid var(--line);margin:16px -20px;padding:16px 20px 0">' +
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-3);margin-bottom:10px">Результаты анализа</div>' +
      '<div class="chem-gtabs" id="chem-gtabs">' +
        Object.keys(CHEM_GROUPS).map(function(g) {
          var existFilled = existingResults.filter(function(r){
            var p2 = CHEM_PARAM_MAP[r.param_key];
            return p2 && p2.group === g && r.value_raw;
          }).length;
          var total = CHEM_PARAMS.filter(function(p){ return p.group === g; }).length;
          var initExceed = existingResults.some(function(r) {
            var p2 = CHEM_PARAM_MAP[r.param_key];
            return p2 && p2.group === g && _chemPdkStatus(r.param_key, r.value_raw, r.below_detection) === 'exceed';
          });
          var cntTxt = '(' + existFilled + '/' + total + ')' + (initExceed ? ' ⚠' : '');
          var exceedStyle = initExceed ? 'border-color:rgba(248,113,113,.5);' : '';
          return '<button class="chem-gtab' + (g === _chemFormGroup ? ' active' : '') + '" data-grp="' + g + '" style="' + exceedStyle + '" onclick="chemSwitchFormGroup(\'' + g + '\')">' +
            CHEM_GROUPS[g].icon + ' ' + CHEM_GROUPS[g].label +
            ' <span id="chem-tab-cnt-' + g + '" style="font-size:10px;opacity:.7;margin-left:2px">' + cntTxt + '</span>' +
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
  if (!val) { inp.classList.remove('exceed'); _chemUpdateTabCounters(); return; }
  var parsed = _chemParseValue(val);
  var status = parsed ? _chemPdkStatus(key, val, parsed.below) : 'no_norm';
  inp.classList.toggle('exceed', status === 'exceed');
  _chemUpdateTabCounters();
}

function _chemUpdateTabCounters() {
  Object.keys(CHEM_GROUPS).forEach(function(g) {
    var params = CHEM_PARAMS.filter(function(p){ return p.group === g; });
    var filled = 0, exceeded = 0;
    params.forEach(function(p) {
      var inp = document.getElementById('pr-' + p.key);
      if (!inp || !inp.value.trim()) return;
      filled++;
      var parsed = _chemParseValue(inp.value.trim());
      if (parsed && _chemPdkStatus(p.key, inp.value.trim(), parsed.below) === 'exceed') exceeded++;
    });
    var span = document.getElementById('chem-tab-cnt-' + g);
    if (!span) return;
    var total = params.length;
    span.textContent = '(' + filled + '/' + total + ')' + (exceeded > 0 ? ' ⚠' : '');
    var btn = span.closest ? span.closest('.chem-gtab') : null;
    if (btn) {
      btn.style.borderColor = exceeded > 0 ? 'rgba(248,113,113,.6)' : '';
      if (!btn.classList.contains('active')) {
        btn.style.color = exceeded > 0 ? '#f87171' : '';
      }
    }
  });
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
    protocol_type:       document.getElementById('pf-proto-type').value || 'sha',
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
  if (typeof Toast !== 'undefined') Toast.done('msg', 'Протокол сохранён');
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
  var typeOpts = Object.keys(CHEM_TEMPLATE_TYPES).map(function(k) {
    var t = CHEM_TEMPLATE_TYPES[k];
    return '<option value="' + k + '">' + t.icon + ' ' + t.label + ' — ' + t.desc + '</option>';
  }).join('');

  _chemOpenModal(
    'Шаблоны и импорт протоколов',
    // ── Секция скачивания шаблона ──────────────────────────────
    '<div style="margin-bottom:20px">' +
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--txt-3);margin-bottom:10px">① Скачать шаблон Excel</div>' +
      '<div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">' +
        '<div class="chem-fld" style="margin:0">' +
          '<label style="font-size:11px;color:var(--txt-3);font-weight:600;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px">Тип протокола</label>' +
          '<select id="chem-tpl-type" class="chem-inp">' + typeOpts + '</select>' +
        '</div>' +
        '<button class="chem-btn chem-btn-ghost" style="white-space:nowrap" onclick="_chemDownloadTemplate(document.getElementById(\'chem-tpl-type\').value)">⬇ Скачать .xlsx</button>' +
      '</div>' +
      '<div style="font-size:10px;color:var(--txt-3);margin-top:6px;line-height:1.5">' +
        'Шаблон содержит строку заголовков с ключами параметров, строку с единицами и нормами ПДК, и строку-пример.' +
      '</div>' +
    '</div>' +

    '<div style="border-top:1px solid var(--line);margin:0 -20px 20px;padding-top:20px;padding-left:20px;padding-right:20px">' +
    // ── Секция импорта ─────────────────────────────────────────
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--txt-3);margin-bottom:10px">② Загрузить заполненный файл</div>' +
      '<div style="background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.18);border-radius:8px;padding:10px 12px;margin-bottom:12px;font-size:11px;color:var(--txt-2);line-height:1.6">' +
        '• Файл должен быть скачан как шаблон этой системы (.xlsx или .csv)<br>' +
        '• Колонка <b>Код водопункта</b> — код из реестра (ищется по коду, затем по названию)<br>' +
        '• Дата в формате <b>ДД.ММ.ГГГГ</b> или <b>ГГГГ-ММ-ДД</b><br>' +
        '• Значения: число, или со знаком <code>&lt;</code> (ниже порога обнаружения)' +
      '</div>' +
      '<div class="chem-fld">' +
        '<label style="font-size:11px;color:var(--txt-3);font-weight:600;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px">Файл (.xlsx или .csv)</label>' +
        '<input type="file" id="chem-xl-file" accept=".csv,.xlsx,.xls" class="chem-inp" style="padding:6px">' +
      '</div>' +
      '<div id="chem-xl-preview" style="margin-top:10px"></div>' +
    '</div>',
    '<button class="chem-btn chem-btn-ghost" onclick="_chemCloseModal()">Отмена</button>' +
    '<button class="chem-btn chem-btn-prim" onclick="_chemImportFile()">Импортировать</button>'
  );

  setTimeout(function() {
    var fileInp = document.getElementById('chem-xl-file');
    if (fileInp) fileInp.addEventListener('change', _chemPreviewUpload);
  }, 100);
}

function _chemDownloadTemplate(typeKey) {
  var tplType = CHEM_TEMPLATE_TYPES[typeKey] || CHEM_TEMPLATE_TYPES.sha;
  var params = tplType.params.map(function(k){ return CHEM_PARAM_MAP[k]; }).filter(Boolean);

  // Фиксированные колонки
  var fixedHeaders = ['Код водопункта','Наименование','Дата (ДД.ММ.ГГГГ)','№ протокола','Лаборатория','Лаб. номер пробы','Пробоотборщик','Примечание'];
  var fixedUnits   = ['','','','','','','',''];
  var fixedPdk     = ['','','','','','','',''];
  var fixedExample = ['ПН-1','Скважина ПН-1','11.06.2026','421/2','EcoExpert','977','Иванов И.И.',''];

  var paramHeaders = params.map(function(p){ return p.key; });
  var paramNames   = params.map(function(p){ return p.name; });
  var paramUnits   = params.map(function(p){ return p.unit; });
  var paramPdk     = params.map(function(p){
    if (p.pdk_type === 'range') return 'ПДК ' + (p.pdk_drink_min||'') + '–' + (p.pdk_drink_max||'');
    return p.pdk_drink != null ? 'ПДК≤' + p.pdk_drink : '';
  });

  // Строки листа
  var rows = [
    // 0: название шаблона
    [tplType.icon + ' Шаблон протоколов: ' + tplType.label + ' — ' + tplType.desc],
    // 1: ключи (эта строка используется при импорте)
    fixedHeaders.concat(paramHeaders),
    // 2: названия параметров
    fixedUnits.concat(paramNames),
    // 3: единицы и ПДК
    fixedPdk.concat(paramUnits.map(function(u,i){ return u + (paramPdk[i] ? '  ' + paramPdk[i] : ''); })),
    // 4: строка-пример (серым — не импортируется, начинается с #)
    ['#ПРИМЕР'].concat(fixedExample.slice(1)).concat(params.map(function(){ return ''; })),
    // 5-9: пустые строки для заполнения
    [], [], [], [], [],
  ];

  if (typeof XLSX === 'undefined') {
    alert('Библиотека SheetJS не загружена. Проверьте соединение.');
    return;
  }

  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet(rows);

  // Ширина колонок
  var colWidths = fixedHeaders.map(function(h,i){
    return { wch: [14,20,16,14,16,14,18,20][i] || 14 };
  }).concat(params.map(function(){ return { wch: 12 }; }));
  ws['!cols'] = colWidths;

  // Заморозить первые 4 строки и 2 колонки
  ws['!freeze'] = { xSplit: 2, ySplit: 4, topLeftCell: 'C5', activePane: 'bottomRight', state: 'frozen' };

  XLSX.utils.book_append_sheet(wb, ws, tplType.label.substring(0,31));

  var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  var blob = new Blob([wbOut], { type: 'application/octet-stream' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'chem_template_' + typeKey + '.xlsx';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Хранит данные после предпросмотра — чтобы не парсить файл дважды
var _chemImportCache = null;

function _chemPreviewUpload() {
  _chemImportCache = null;
  var file = document.getElementById('chem-xl-file') && document.getElementById('chem-xl-file').files[0];
  if (!file) return;
  var preview = document.getElementById('chem-xl-preview');
  if (!preview) return;
  preview.innerHTML = '<div style="font-size:11px;color:var(--txt-3)">Анализ файла…</div>';

  var isXlsx = /\.(xlsx|xls)$/i.test(file.name);

  function _analyze(headers, dataRows) {
    // Проверяем каждую строку: известен ли водопункт
    var unknown = [];   // { code, name, rows }
    var knownCount = 0;
    var unknownSet = {};

    dataRows.forEach(function(row) {
      var code = String(row[0] || '').trim();
      var name = String(row[1] || '').trim();
      var key  = code || name;
      if (!key) return;
      var found = ChemState.waterPoints.find(function(w){
        if (name && w.name === name) return true;
        if (code && !name && w.code === code) return true;
        return false;
      });
      if (found) {
        knownCount++;
      } else {
        if (!unknownSet[key]) {
          unknownSet[key] = true;
          unknown.push({ code: code, name: name });
        }
      }
    });

    var tplTypeKey = document.getElementById('chem-tpl-type') ? document.getElementById('chem-tpl-type').value : 'sha';
    _chemImportCache = { headers: headers, dataRows: dataRows, protoType: tplTypeKey };

    var html = '';
    if (knownCount > 0) {
      html += '<div style="font-size:11px;color:var(--ok);margin-bottom:6px">✓ Распознано строк: <b>' + knownCount + '</b></div>';
    }
    if (unknown.length) {
      html += '<div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);border-radius:8px;padding:10px 12px;">' +
        '<div style="font-size:11px;font-weight:700;color:#fbbf24;margin-bottom:6px">⚠ Не найдены в реестре (' + unknown.length + ' водопункта/ов) — строки будут пропущены:</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:4px">' +
          unknown.map(function(u){
            return '<span style="background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.2);border-radius:5px;padding:2px 8px;font-size:11px;font-family:monospace;color:#fbbf24">' +
              escHTML(u.code || u.name) + '</span>';
          }).join('') +
        '</div>' +
        '<div style="font-size:10px;color:var(--txt-3);margin-top:6px">Сначала добавьте эти водопункты в реестр, затем повторите импорт</div>' +
      '</div>';
    }
    if (knownCount === 0 && unknown.length === 0) {
      html = '<div style="font-size:11px;color:var(--txt-3)">Строк с данными не найдено</div>';
    }
    if (preview) preview.innerHTML = html;
  }

  if (isXlsx && typeof XLSX !== 'undefined') {
    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
        var ws = wb.Sheets[wb.SheetNames[0]];
        var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
        if (rows.length < 2) { preview.innerHTML = '<div style="color:#f87171;font-size:11px">Файл пустой</div>'; return; }
        var headers = rows[1].map(function(h){ return String(h).trim(); });
        var dataRows = rows.slice(4).filter(function(r){ return r[0] && String(r[0]).trim() && String(r[0]).charAt(0) !== '#'; });
        _analyze(headers, dataRows);
      } catch(ex) {
        preview.innerHTML = '<div style="font-size:11px;color:#f87171">Ошибка чтения: ' + escHTML(ex.message) + '</div>';
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    var reader2 = new FileReader();
    reader2.onload = function(e) {
      try {
        var text = e.target.result;
        var rawLines = text.split(/\r?\n/).filter(function(l){ return l.trim() && l.trim().charAt(0) !== '#'; });
        if (rawLines.length < 2) { preview.innerHTML = '<div style="font-size:11px;color:#f87171">Файл пустой</div>'; return; }
        var sep = rawLines[0].includes(';') ? ';' : ',';
        var headers = rawLines[0].split(sep).map(function(h){ return h.trim().replace(/^﻿/, ''); });
        var dataRows = rawLines.slice(1).map(function(l){ return l.split(sep); });
        _analyze(headers, dataRows);
      } catch(ex) {
        preview.innerHTML = '<div style="font-size:11px;color:#f87171">Ошибка чтения: ' + escHTML(ex.message) + '</div>';
      }
    };
    reader2.readAsText(file, 'UTF-8');
  }
}

async function _chemImportFile() {
  var file = document.getElementById('chem-xl-file') && document.getElementById('chem-xl-file').files[0];
  if (!file) { alert('Выберите файл'); return; }

  // Используем уже разобранные данные из предпросмотра
  if (_chemImportCache && _chemImportCache.headers && _chemImportCache.dataRows) {
    var result = await _chemImportRows(_chemImportCache.headers, _chemImportCache.dataRows, _chemImportCache.protoType);
    _chemImportDone(result.imported, result.errors, result.skipped);
    _chemImportCache = null;
    return;
  }

  // Запасной путь — если предпросмотр не был выполнен
  var isXlsx = /\.(xlsx|xls)$/i.test(file.name);
  if (isXlsx && typeof XLSX !== 'undefined') {
    _chemImportXlsx(file);
  } else {
    _chemImportCsv(file);
  }
}

async function _chemImportXlsx(file) {
  var reader = new FileReader();
  reader.onload = async function(e) {
    try {
      var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });

      // Строка 1 (индекс 1) — заголовки (ключи), строки 2-3 — метаданные, 4+ — данные
      if (rows.length < 2) { alert('Файл пустой'); return; }
      var headers = rows[1].map(function(h){ return String(h).trim(); });
      var dataRows = rows.slice(4).filter(function(r){
        return r[0] && String(r[0]).trim() && String(r[0]).charAt(0) !== '#';
      });

      var result = await _chemImportRows(headers, dataRows);
      _chemImportDone(result.imported, result.errors);
    } catch(ex) {
      alert('Ошибка чтения Excel: ' + ex.message);
      console.error('[xlsx import]', ex);
    }
  };
  reader.readAsArrayBuffer(file);
}

async function _chemImportCsv(file) {
  var reader = new FileReader();
  reader.onload = async function(e) {
    try {
      var text = e.target.result;
      var rawLines = text.split(/\r?\n/);
      // пропускаем строки-комментарии (#) и пустые
      var lines = rawLines.filter(function(l){ return l.trim() && l.trim().charAt(0) !== '#'; });
      if (lines.length < 2) { alert('Файл пустой или содержит только заголовок'); return; }
      var sep = lines[0].includes(';') ? ';' : ',';
      var headers = lines[0].split(sep).map(function(h){ return h.trim().replace(/^﻿/, ''); });
      var dataRows = lines.slice(1).map(function(l){ return l.split(sep); });
      var result = await _chemImportRows(headers, dataRows);
      _chemImportDone(result.imported, result.errors);
    } catch(err) {
      alert('Ошибка разбора файла: ' + err.message);
    }
  };
  reader.readAsText(file, 'UTF-8');
}

/* Общая логика импорта строк. headers — массив строк (первые 8: фиксированные, далее param_key).
   rows — массив массивов ячеек. protoType — ключ вида протокола (sha, radio, cn, micro, radio_full). */
async function _chemImportRows(headers, rows, protoType) {
  var imported = 0, errors = 0, skipped = 0;
  var resolvedProtoType = (protoType && CHEM_PROTO_TYPE_META[protoType]) ? protoType : 'sha';

  for (var ri = 0; ri < rows.length; ri++) {
    var cols = rows[ri];
    var getCel = function(i){ return cols[i] !== undefined ? String(cols[i]).trim() : ''; };

    // Фиксированные колонки: Код ВП | Наименование | Дата | № протокола | Лаборатория | Лаб. номер пробы | Пробоотборщик | Примечание
    var wpCode   = getCel(0);
    var wpName2  = getCel(1);
    var dateStr  = getCel(2);
    var protoNum = getCel(3);
    var labName  = getCel(4);
    var labNum   = getCel(5);
    var sampler  = getCel(6);
    var notes    = getCel(7);

    if (!wpCode && !wpName2) continue;
    if (!dateStr) continue;

    // Поиск водопункта: приоритет — точное совпадение имени (колонка B),
    // затем код+имя, затем только код (если имя не заполнено)
    var wp = ChemState.waterPoints.find(function(w){
      if (wpName2 && w.name === wpName2) return true;
      if (wpCode && wpName2 && w.code === wpCode && w.name === wpName2) return true;
      if (wpCode && !wpName2 && w.code === wpCode) return true;
      return false;
    });
    if (!wp) { skipped++; continue; }

    // Дата: нормализуем любой формат в YYYY-MM-DD
    var isoDate = _chemParseDate(dateStr);
    if (!isoDate) {
      console.warn('[chem import] unparseable date at row', ri, ':', JSON.stringify(dateStr));
      errors++;
      continue;
    }

    var protoRow = {
      water_point_id:      wp.id,
      sampled_at:          isoDate,
      lab_protocol_number: protoNum || null,
      lab_name:            labName  || null,
      lab_number:          labNum   || null,
      protocol_type:       resolvedProtoType,
      source:              'excel',
    };
    var pRes = await ChemApi.upsertProtocol(protoRow);
    if (pRes.error) {
      console.error('[chem import] protocol upsert error row', ri, ':', pRes.error.message, pRes.error);
      errors++;
      continue;
    }
    var proto = pRes.data;

    // Результаты — колонки с 8-й и далее
    var resultRows = [];
    for (var hi = 8; hi < headers.length; hi++) {
      var paramKey = headers[hi].trim();
      var param = CHEM_PARAM_MAP[paramKey];
      if (!param) continue;
      var raw = getCel(hi);
      if (!raw) continue;
      var parsed = _chemParseValue(raw);
      if (!parsed) continue;
      resultRows.push({
        protocol_id: proto.id,
        param_key: param.key,
        value_raw: raw,
        value_num: (!parsed.below && !parsed.above) ? parsed.num : null,
        below_detection: parsed.below,
        above_range:     parsed.above,
      });
    }
    if (resultRows.length) await ChemApi.upsertResults(resultRows);
    ChemState.protocols.unshift(proto);
    ChemState.results[proto.id] = resultRows;
    imported++;
  }
  return { imported: imported, errors: errors, skipped: skipped };
}

function _chemImportDone(imported, errors, skipped) {
  _chemCloseModal();
  _chemRenderSection('protocols');
  if (typeof Toast !== 'undefined') {
    var msg = 'Импортировано ' + imported + ' протоколов';
    if (skipped) msg += ', пропущено ' + skipped + ' (нет в реестре)';
    if (errors)  msg += ', ошибок: ' + errors;
    Toast.done('import', msg);
  }
}

// ═══════════════════════════════════════════════════════════════
//  ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ═══════════════════════════════════════════════════════════════
/* Нормализует дату из любого формата в YYYY-MM-DD.
   Поддерживает: ДД.ММ.ГГГГ, ГГГГ-ММ-ДД, ГГГГ-ММ-ДД HH:MM:SS (SheetJS), М/Д/ГГГГ */
function _chemParseDate(s) {
  if (!s) return null;
  var str = String(s).trim();
  // ДД.ММ.ГГГГ
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    var p = str.split('.');
    return p[2] + '-' + p[1] + '-' + p[0];
  }
  // ГГГГ-ММ-ДД (с возможным временем)
  var m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  // М/Д/ГГГГ или ММ/ДД/ГГГГ или М/Д/ГГ (SheetJS raw:false, dateNF не всегда даёт 4-значный год)
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    var yr = m[3].length === 2 ? '20' + m[3] : m[3];
    return yr + '-' + m[1].padStart(2,'0') + '-' + m[2].padStart(2,'0');
  }
  return null;
}

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

// ═══════════════════════════════════════════════════════════════
//  ТЕПЛОВАЯ КАРТА (водопункты × параметры)
// ═══════════════════════════════════════════════════════════════
function _chemRenderHeatmap(cont) {
  // Ключевые параметры для тепловой карты (выбираем наиболее нормируемые)
  var hmKeys = ['ph_lab','tds','hardness','no3','no2','fe_total','mn','cl','so4','cu','pb','as','cr6','ni','cd','hg','cn'];
  var hmParams = hmKeys.map(function(k){ return CHEM_PARAM_MAP[k]; }).filter(Boolean);

  // Для каждого водопункта находим последний протокол с данными
  var wps = ChemState.waterPoints;
  if (!wps.length) {
    cont.innerHTML = '<div class="chem-hdr"><span class="chem-hdr-title">Тепловая карта</span></div>' +
      '<div class="chem-empty"><div class="chem-empty-ico">🌡️</div><div class="chem-empty-txt">Нет водопунктов</div></div>';
    return;
  }

  // For each wp, get latest protocol results
  var wpData = wps.map(function(wp) {
    var protos = ChemState.protocols.filter(function(p){ return p.water_point_id === wp.id; })
      .sort(function(a,b){ return a.sampled_at < b.sampled_at ? 1 : -1; });
    var results = {};
    protos.forEach(function(p) {
      var rows = ChemState.results[p.id] || [];
      rows.forEach(function(r) {
        if (!results[r.param_key]) results[r.param_key] = r; // first = latest
      });
    });
    return { wp: wp, results: results, latestDate: protos.length ? protos[0].sampled_at : null };
  });

  // Legend
  var legendHtml =
    '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--txt-2);margin-bottom:12px">' +
      '<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;height:14px;border-radius:3px;background:rgba(248,113,113,.7);display:inline-block"></span>Превышение ПДК</span>' +
      '<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;height:14px;border-radius:3px;background:rgba(52,211,153,.55);display:inline-block"></span>В норме</span>' +
      '<span style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;height:14px;border-radius:3px;background:rgba(139,148,158,.12);border:1px solid var(--line);display:inline-block"></span>Нет данных</span>' +
    '</div>';

  var tableHtml = '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:11px;white-space:nowrap">';
  // Header row
  tableHtml += '<thead><tr><th style="text-align:left;padding:6px 10px;color:var(--txt-3);position:sticky;left:0;background:var(--bg-1);z-index:2;min-width:140px;border-bottom:2px solid var(--line)">Водопункт</th>';
  hmParams.forEach(function(p) {
    tableHtml += '<th style="padding:6px 5px;color:var(--txt-3);font-size:10px;font-weight:600;text-align:center;border-bottom:2px solid var(--line);min-width:54px;max-width:70px" title="' + escHTML(p.name) + ' (' + escHTML(p.unit) + ')">' +
      escHTML(p.key.toUpperCase().replace('_',' ').substring(0,8)) + '</th>';
  });
  tableHtml += '</tr></thead><tbody>';

  wpData.forEach(function(item, ri) {
    var bgRow = ri % 2 === 0 ? '' : 'background:rgba(255,255,255,.02)';
    tableHtml += '<tr style="' + bgRow + '">';
    tableHtml += '<td style="padding:6px 10px;font-weight:600;color:var(--txt-1);position:sticky;left:0;background:var(--bg-1);' + bgRow + 'z-index:1;border-right:1px solid var(--line)">' +
      escHTML(item.wp.name) +
      (item.latestDate ? '<div style="font-size:9px;color:var(--txt-3);font-weight:400">' + _chemFmtDate(item.latestDate) + '</div>' : '') +
    '</td>';

    hmParams.forEach(function(p) {
      var r = item.results[p.key];
      if (!r || !r.value_raw) {
        tableHtml += '<td style="text-align:center;padding:5px;color:var(--txt-3);background:rgba(139,148,158,.08);font-size:10px">—</td>';
        return;
      }
      var st = _chemPdkStatus(p.key, r.value_raw, r.below_detection);
      var bg = st === 'exceed' ? 'rgba(248,113,113,.18)' :
               st === 'ok'     ? 'rgba(52,211,153,.14)' : 'rgba(139,148,158,.08)';
      var clr = st === 'exceed' ? '#f87171' : st === 'ok' ? 'var(--ok)' : 'var(--txt-2)';
      tableHtml += '<td style="text-align:center;padding:5px;background:' + bg + ';color:' + clr + ';font-weight:' + (st==='exceed'?'700':'400') + ';font-size:10px;font-variant-numeric:tabular-nums" title="' + escHTML(p.name + ': ' + r.value_raw + ' ' + p.unit) + '">' +
        escHTML(r.value_raw) + '</td>';
    });
    tableHtml += '</tr>';
  });
  tableHtml += '</tbody></table></div>';

  cont.innerHTML =
    '<div class="chem-hdr"><span class="chem-hdr-title">Тепловая карта ПДК</span>' +
      '<span class="chem-hdr-sub">По последнему протоколу каждого водопункта</span>' +
    '</div>' +
    legendHtml +
    '<div style="background:var(--bg-2);border:1px solid var(--line);border-radius:10px;overflow:hidden;padding:14px">' +
      tableHtml +
    '</div>';
}

// ═══════════════════════════════════════════════════════════════
//  СРАВНЕНИЕ ПРОТОКОЛОВ
// ═══════════════════════════════════════════════════════════════
function chemToggleCompare(id, checked) {
  if (checked) {
    if (ChemState.compareIds.indexOf(id) === -1) {
      if (ChemState.compareIds.length >= 2) {
        ChemState.compareIds.shift(); // drop oldest
      }
      ChemState.compareIds.push(id);
    }
  } else {
    ChemState.compareIds = ChemState.compareIds.filter(function(x){ return x !== id; });
  }
  _chemUpdateCompareBar();
}

function _chemUpdateCompareBar() {
  var bar = document.getElementById('chem-compare-bar');
  var lbl = document.getElementById('chem-compare-lbl');
  if (!bar) return;
  var n = ChemState.compareIds.length;
  if (n === 0) {
    bar.style.display = 'none';
  } else {
    bar.style.display = 'flex';
    lbl.textContent = 'Выбрано: ' + n + '/2';
    var compareBtn = bar.querySelector('button');
    if (compareBtn) compareBtn.disabled = n < 2;
  }
}

function chemClearCompare() {
  ChemState.compareIds = [];
  _chemRenderProtoList();
}

function showChemCompare() {
  var ids = ChemState.compareIds;
  if (ids.length < 2) return;
  var p1 = ChemState.protocols.find(function(p){ return p.id === ids[0]; });
  var p2 = ChemState.protocols.find(function(p){ return p.id === ids[1]; });
  if (!p1 || !p2) return;

  var wp1 = ChemState.waterPoints.find(function(w){ return w.id === p1.water_point_id; });
  var wp2 = ChemState.waterPoints.find(function(w){ return w.id === p2.water_point_id; });
  var r1  = ChemState.results[p1.id] || [];
  var r2  = ChemState.results[p2.id] || [];

  var r1map = {}, r2map = {};
  r1.forEach(function(r){ r1map[r.param_key] = r; });
  r2.forEach(function(r){ r2map[r.param_key] = r; });

  var hdr1 = escHTML((wp1 ? wp1.name : '?') + '  ' + _chemFmtDate(p1.sampled_at));
  var hdr2 = escHTML((wp2 ? wp2.name : '?') + '  ' + _chemFmtDate(p2.sampled_at));

  var rows = '';
  var groupOrder = ['organo','physico','macro','metals','organic'];
  groupOrder.forEach(function(g) {
    var params = CHEM_PARAMS.filter(function(p){ return p.group === g; });
    var hasData = params.some(function(p){ return r1map[p.key] || r2map[p.key]; });
    if (!hasData) return;
    var grpInfo = CHEM_GROUPS[g];
    rows += '<tr style="background:rgba(255,255,255,.03)"><td colspan="4" style="padding:6px 8px;font-size:11px;font-weight:700;color:var(--txt-2)">' + grpInfo.icon + ' ' + grpInfo.label + '</td></tr>';
    params.forEach(function(p) {
      var v1 = r1map[p.key], v2 = r2map[p.key];
      if (!v1 && !v2) return;
      var s1 = v1 ? _chemPdkStatus(p.key, v1.value_raw, v1.below_detection) : 'nd';
      var s2 = v2 ? _chemPdkStatus(p.key, v2.value_raw, v2.below_detection) : 'nd';
      function cellStyle(st) {
        if (st === 'exceed') return 'color:#f87171;font-weight:700';
        if (st === 'ok')     return 'color:var(--ok)';
        return 'color:var(--txt-3)';
      }
      rows += '<tr>' +
        '<td style="padding:5px 8px;color:var(--txt-3);font-size:11px">' + p.no + '. ' + escHTML(p.name) + '</td>' +
        '<td style="padding:5px 8px;text-align:right;font-size:12px;' + cellStyle(s1) + '">' + (v1 ? escHTML(v1.value_raw) : '—') + '</td>' +
        '<td style="padding:5px 8px;text-align:right;font-size:12px;' + cellStyle(s2) + '">' + (v2 ? escHTML(v2.value_raw) : '—') + '</td>' +
        '<td style="padding:5px 8px;text-align:center;font-size:10px;color:var(--txt-3)">' + escHTML(p.unit) + '</td>' +
      '</tr>';
    });
  });

  _chemOpenModal(
    'Сравнение протоколов',
    '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr style="border-bottom:2px solid var(--line)">' +
        '<th style="text-align:left;padding:8px;color:var(--txt-3);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Параметр</th>' +
        '<th style="text-align:right;padding:8px;color:var(--blue);font-size:12px;font-weight:700">' + hdr1 + '</th>' +
        '<th style="text-align:right;padding:8px;color:#fb923c;font-size:12px;font-weight:700">' + hdr2 + '</th>' +
        '<th style="text-align:center;padding:8px;color:var(--txt-3);font-size:10px">Ед.</th>' +
      '</tr></thead><tbody>' + rows + '</tbody>' +
    '</table>',
    '<button class="chem-btn chem-btn-ghost" onclick="_chemCloseModal()">Закрыть</button>',
    'max-width:780px'
  );
}

// ═══════════════════════════════════════════════════════════════
//  ПАСПОРТ ВОДОПУНКТА
// ═══════════════════════════════════════════════════════════════
function showChemWpPassport(wpId) {
  if (!wpId) return;
  var wp = ChemState.waterPoints.find(function(w){ return w.id === wpId; });
  if (!wp) return;

  var protos = ChemState.protocols.filter(function(p){ return p.water_point_id === wpId; })
    .sort(function(a,b){ return a.sampled_at < b.sampled_at ? 1 : -1; });

  // Сводка по параметрам (мин/макс/последнее)
  var paramStats = {};
  protos.forEach(function(p) {
    var rows = ChemState.results[p.id] || [];
    rows.forEach(function(r) {
      if (!paramStats[r.param_key]) paramStats[r.param_key] = { vals: [], lastDate: '', lastVal: '', exceedCount: 0 };
      var st = paramStats[r.param_key];
      if (r.value_num !== null && r.value_num !== undefined) st.vals.push(r.value_num);
      if (!st.lastDate || p.sampled_at > st.lastDate) {
        st.lastDate = p.sampled_at;
        st.lastVal  = r.value_raw;
        st.lastBelow = r.below_detection;
      }
      if (_chemPdkStatus(r.param_key, r.value_raw, r.below_detection) === 'exceed') st.exceedCount++;
    });
  });

  // Protocol history table
  var histHtml = '<div style="margin-bottom:16px">' +
    '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-3);margin-bottom:8px">История протоколов</div>';
  if (!protos.length) {
    histHtml += '<div style="color:var(--txt-3);font-size:12px">Протоколов нет</div>';
  } else {
    histHtml += '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr><th style="text-align:left;padding:5px 8px;color:var(--txt-3);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)">Дата</th>' +
      '<th style="text-align:left;padding:5px 8px;color:var(--txt-3);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)">Лаборатория / №</th>' +
      '<th style="text-align:center;padding:5px 8px;color:var(--txt-3);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)">Параметров</th>' +
      '<th style="text-align:center;padding:5px 8px;color:var(--txt-3);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)">Превышений</th>' +
      '</tr></thead><tbody>' +
      protos.map(function(p) {
        var rows = ChemState.results[p.id] || [];
        var exc = rows.filter(function(r){ return _chemPdkStatus(r.param_key, r.value_raw, r.below_detection) === 'exceed'; }).length;
        return '<tr>' +
          '<td style="padding:5px 8px;font-weight:600;color:var(--blue)">' + _chemFmtDate(p.sampled_at) + '</td>' +
          '<td style="padding:5px 8px;color:var(--txt-2)">' + escHTML((p.lab_name || '') + (p.lab_protocol_number ? ' №' + p.lab_protocol_number : '')) + '</td>' +
          '<td style="padding:5px 8px;text-align:center">' + rows.length + '</td>' +
          '<td style="padding:5px 8px;text-align:center;' + (exc > 0 ? 'color:#f87171;font-weight:700' : 'color:var(--ok)') + '">' + (exc > 0 ? '⚠ ' + exc : '✓') + '</td>' +
        '</tr>';
      }).join('') +
    '</tbody></table>';
  }
  histHtml += '</div>';

  // Param summary (only params with data)
  var paramHtml = '<div>' +
    '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-3);margin-bottom:8px">Сводка по параметрам</div>';
  var paramKeys = Object.keys(paramStats);
  if (!paramKeys.length) {
    paramHtml += '<div style="color:var(--txt-3);font-size:12px">Нет данных</div>';
  } else {
    paramHtml += '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
      '<thead><tr>' +
        '<th style="text-align:left;padding:5px 8px;color:var(--txt-3);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)">Параметр</th>' +
        '<th style="text-align:right;padding:5px 8px;color:var(--txt-3);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)">Последнее</th>' +
        '<th style="text-align:right;padding:5px 8px;color:var(--txt-3);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)">Мин</th>' +
        '<th style="text-align:right;padding:5px 8px;color:var(--txt-3);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)">Макс</th>' +
        '<th style="text-align:center;padding:5px 8px;color:var(--txt-3);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--line)">Превыш.</th>' +
      '</tr></thead><tbody>' +
      paramKeys.map(function(key) {
        var p = CHEM_PARAM_MAP[key];
        if (!p) return '';
        var st = paramStats[key];
        var lastStatus = _chemPdkStatus(key, st.lastVal, st.lastBelow);
        var hasVals = st.vals.length > 0;
        var minVal = hasVals ? Math.min.apply(null, st.vals) : null;
        var maxVal = hasVals ? Math.max.apply(null, st.vals) : null;
        return '<tr style="border-bottom:1px solid rgba(255,255,255,.04)">' +
          '<td style="padding:5px 8px;color:var(--txt-1)">' + p.no + '. ' + escHTML(p.name) + '<span style="color:var(--txt-3);font-size:10px;margin-left:4px">' + escHTML(p.unit) + '</span></td>' +
          '<td style="padding:5px 8px;text-align:right;font-weight:600;' + (lastStatus==='exceed'?'color:#f87171':lastStatus==='ok'?'color:var(--ok)':'color:var(--txt-2)') + '">' + escHTML(st.lastVal || '—') + '</td>' +
          '<td style="padding:5px 8px;text-align:right;color:var(--txt-2);font-variant-numeric:tabular-nums">' + (minVal !== null ? _chemFmtNum(minVal) : '—') + '</td>' +
          '<td style="padding:5px 8px;text-align:right;color:var(--txt-2);font-variant-numeric:tabular-nums">' + (maxVal !== null ? _chemFmtNum(maxVal) : '—') + '</td>' +
          '<td style="padding:5px 8px;text-align:center;' + (st.exceedCount > 0 ? 'color:#f87171;font-weight:700' : 'color:var(--ok)') + '">' + (st.exceedCount > 0 ? st.exceedCount : '✓') + '</td>' +
        '</tr>';
      }).join('') +
    '</tbody></table>';
  }
  paramHtml += '</div>';

  var typeLabel = CHEM_WP_TYPES[wp.type] || wp.type;
  _chemOpenModal(
    '📋 Паспорт: ' + escHTML(wp.name),
    '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--line)">' +
      '<div style="flex:1;min-width:160px"><div style="font-size:10px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Тип</div><div style="font-size:13px;color:var(--txt-1)">' + escHTML(typeLabel) + '</div></div>' +
      '<div style="flex:1;min-width:120px"><div style="font-size:10px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Код</div><div style="font-size:13px;color:var(--blue);font-weight:600">' + escHTML(wp.code || '—') + '</div></div>' +
      '<div style="flex:2;min-width:200px"><div style="font-size:10px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Местоположение</div><div style="font-size:13px;color:var(--txt-2)">' + escHTML(wp.location_desc || '—') + '</div></div>' +
      '<div style="flex:1;min-width:100px"><div style="font-size:10px;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">Протоколов</div><div style="font-size:20px;font-weight:700;color:var(--txt-1)">' + protos.length + '</div></div>' +
    '</div>' +
    histHtml + paramHtml,
    '<button class="chem-btn chem-btn-ghost" onclick="_chemCloseModal()">Закрыть</button>',
    'max-width:860px'
  );
}

// ═══════════════════════════════════════════════════════════════
//  ЭКСПОРТ ПРОТОКОЛА В CSV
// ═══════════════════════════════════════════════════════════════
function _chemExportCsv(protocolId) {
  var proto = ChemState.protocols.find(function(p){ return p.id === protocolId; });
  if (!proto) return;
  var wp = ChemState.waterPoints.find(function(w){ return w.id === proto.water_point_id; });
  var rows = ChemState.results[protocolId];
  if (!rows || !rows.length) { alert('Нет данных для экспорта'); return; }

  var rmap = {};
  rows.forEach(function(r){ rmap[r.param_key] = r; });

  var lines = [
    ['Водопункт', wp ? wp.name : '?'],
    ['Дата отбора', _chemFmtDate(proto.sampled_at)],
    ['Лаборатория', proto.lab_name || ''],
    ['№ протокола', proto.lab_protocol_number || ''],
    ['Лаб. номер', proto.lab_number || ''],
    [],
    ['№', 'Параметр', 'Группа', 'Значение', 'Ед. изм.', 'ПДК питьевая', 'Статус'],
  ];

  CHEM_PARAMS.forEach(function(p) {
    var r = rmap[p.key];
    if (!r) return;
    var st = _chemPdkStatus(p.key, r.value_raw, r.below_detection);
    var statusTxt = st === 'exceed' ? 'Превышение ПДК' : st === 'ok' ? 'Норма' : 'Нет нормы';
    lines.push([p.no, p.name, CHEM_GROUPS[p.group] ? CHEM_GROUPS[p.group].label : p.group, r.value_raw, p.unit, _chemPdkStr(p), statusTxt]);
  });

  var csv = '﻿' + lines.map(function(row) {
    return row.map(function(v){ return '"' + String(v || '').replace(/"/g, '""') + '"'; }).join(';');
  }).join('\r\n');

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'protocol_' + (proto.lab_protocol_number || proto.id.substring(0,8)) + '_' + (proto.sampled_at || 'date') + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
window._chemImportCsv        = _chemImportCsv;
window._chemImportFile       = _chemImportFile;
window._chemImportXlsx       = _chemImportXlsx;
window._chemDownloadTemplate = _chemDownloadTemplate;
window._chemCheckParamInput  = _chemCheckParamInput;
window._chemUpdateTabCounters= _chemUpdateTabCounters;
window.chemToggleCompare   = chemToggleCompare;
window.chemClearCompare    = chemClearCompare;
window.showChemCompare     = showChemCompare;
window.showChemWpPassport  = showChemWpPassport;
window._chemExportCsv      = _chemExportCsv;
