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

// Квартал пробы: 1 из calendar-месяца даты отбора, если протокол не хранит
// свой квартал явно (p.quarter — ручная правка пользователя имеет приоритет).
function chemQuarterFromDate(dateStr) {
  if (!dateStr) return null;
  var m = parseInt(dateStr.substring(5, 7), 10);
  return m ? Math.ceil(m / 3) : null;
}
function chemQuarterOf(p) {
  if (!p) return null;
  if (p.quarter) return p.quarter;
  return chemQuarterFromDate(p.sampled_at);
}
function _chemRomanQ(q) { return ['I','II','III','IV'][q - 1] || q; }

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
  activeSection: 'protocols', // 'waterpoints' | 'protocols' | 'wpanalytics' | 'analytics' | 'heatmap'
  filterWpId:        '',
  filterProtoType:   '',
  filterType:        '',
  filterYear:        '',
  filterQuarter:     '',
  filterExceedOnly:  false,
  filterWpSearch:    '',
  compareIds:        [],   // up to 2 protocol IDs for comparison

  // Шаблоны лабораторий (мастер настройки шаблонов)
  labTemplates:       [],  // [{id, lab_name, template_name, base_type, params:[keys...]}]

  // "Хим. аналитика" — Piper/Stiff/Schoeller across every protocol of one water point
  wpaSelectedWpId:    '',  // водопункт, выбранный в разделе "Хим. аналитика"
  wpaSelectedProtoId: '',  // какая именно проба сейчас раскрыта/подсвечена
  _wpaMeqList:        [],  // [{meq, id, date}] — кэш валидных проб выбранного водопункта (пересчитывается при смене водопункта)
};

// ── API helpers ────────────────────────────────────────────────
var ChemApi = {
  _sb: function() { return Api.client(); },

  getWaterPoints: async function() {
    // Единый реестр — читаем из wp_registry
    var res = await this._sb().from('wp_registry')
      .select('id, name, code, wp_type, location_desc, coord_x, coord_y, active, default_template_id')
      .order('code', { nullsFirst: false })
      .order('name');
    if (res.error && /default_template_id/i.test(res.error.message || '')) {
      // Колонка ещё не создана (миграция wp_default_template.sql не выполнена)
      res = await this._sb().from('wp_registry')
        .select('id, name, code, wp_type, location_desc, coord_x, coord_y, active')
        .order('code', { nullsFirst: false })
        .order('name');
    }
    return res;
  },
  upsertWaterPoint: async function(row) {
    // row.type → row.wp_type для wp_registry
    var regRow = {
      name:          row.name,
      code:          row.code          || null,
      wp_type:       row.type          || row.wp_type || 'other',
      location_desc: row.location_desc || null,
      active:        row.active !== false,
      default_template_id: row.default_template_id || null,
    };
    if (row.id) regRow.id = row.id;
    var res = await this._sb().from('wp_registry').upsert(regRow, { onConflict: 'id' }).select().single();
    if (res.error && /default_template_id/i.test(res.error.message || '')) {
      // Колонка ещё не создана (миграция wp_default_template.sql не выполнена) — не блокируем сохранение
      delete regRow.default_template_id;
      res = await this._sb().from('wp_registry').upsert(regRow, { onConflict: 'id' }).select().single();
    }
    return res;
  },
  deleteWaterPoint: async function(id) {
    return this._sb().from('wp_registry').delete().eq('id', id);
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

  // CHEM-08: журнал изменений протокола
  addProtocolHistory: async function(row) {
    return this._sb().from('chem_protocol_history').insert(row);
  },
  getProtocolHistory: async function(protocolId) {
    return this._sb().from('chem_protocol_history').select('*').eq('protocol_id', protocolId).order('changed_at', { ascending: false });
  },

  // CHEM-07: скан-копия протокола (Supabase Storage, бакет chem-scans)
  uploadProtocolScan: async function(protocolId, file) {
    var path = protocolId + '/' + Date.now() + '_' + file.name;
    var up = await this._sb().storage.from('chem-scans').upload(path, file, { upsert: true, contentType: file.type || 'application/octet-stream' });
    if (up.error) return { error: up.error };
    var urlRes = this._sb().storage.from('chem-scans').getPublicUrl(path);
    return { data: { url: urlRes.data ? urlRes.data.publicUrl : path, name: file.name } };
  },

  getLabTemplates: async function() {
    return this._sb().from('chem_lab_templates').select('*').order('lab_name').order('template_name');
  },
  upsertLabTemplate: async function(row) {
    return this._sb().from('chem_lab_templates').upsert(row, { onConflict: 'id' }).select().single();
  },
  deleteLabTemplate: async function(id) {
    return this._sb().from('chem_lab_templates').delete().eq('id', id);
  },
};

// ── Загрузка данных ────────────────────────────────────────────
async function loadChemData() {
  if (!window.Api) return;
  ChemState.loading = true;
  try {
    var [wpRes, prRes, ltRes] = await Promise.all([
      ChemApi.getWaterPoints(),
      ChemApi.getProtocols(),
      ChemApi.getLabTemplates(),
    ]);
    if (!wpRes.error) {
      // wp_registry использует wp_type; нормализуем для обратной совместимости
      ChemState.waterPoints = (wpRes.data || []).map(function(w) {
        if (w.wp_type && !w.type) w.type = w.wp_type;
        return w;
      });
    }
    if (!prRes.error) ChemState.protocols = prRes.data || [];
    // Таблица шаблонов может ещё не существовать (миграция не выполнена) — не падаем
    ChemState.labTemplates = (!ltRes.error && ltRes.data) ? ltRes.data : [];

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
    '.chem-spark{display:inline-flex;align-items:center;gap:3px;vertical-align:middle}',
    '.chem-spark-trend{font-size:11px;font-weight:800}',
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
    '.chem-rtbl-sub{font-size:9.5px;color:var(--txt-3);margin-top:1px;font-weight:400}',
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

    /* Баланс ионов */
    '.chem-ion-balance-badge{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;font-weight:600;padding:5px 10px;border-radius:7px;margin-bottom:12px}',
    '.chem-ion-balance-badge.ok{background:rgba(34,197,94,.1);color:#4ade80;border:1px solid rgba(34,197,94,.25)}',
    '.chem-ion-balance-badge.bad{background:rgba(248,113,113,.1);color:#f87171;border:1px solid rgba(248,113,113,.3)}',

    /* Мастер шаблонов лабораторий */
    '.chem-wiz-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;min-height:320px}',
    '.chem-wiz-col{border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}',
    '.chem-wiz-col-hdr{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3);padding:8px 10px;border-bottom:1px solid var(--line);background:var(--bg-3);flex-shrink:0}',
    '.chem-wiz-catalog,.chem-wiz-selected{overflow-y:auto;max-height:400px;padding:6px}',
    '.chem-wiz-cat-grp{margin-bottom:8px}',
    '.chem-wiz-cat-grp-hdr{font-size:10px;font-weight:700;color:var(--txt-3);text-transform:uppercase;letter-spacing:.04em;padding:4px 6px}',
    '.chem-wiz-cat-item{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--txt-2)}',
    '.chem-wiz-cat-item:hover{background:var(--bg-3)}',
    '.chem-wiz-cat-item.checked{color:var(--txt-1);background:rgba(59,130,246,.08)}',
    '.chem-wiz-cat-item input{accent-color:var(--blue);flex-shrink:0}',
    '.chem-wiz-cat-item span:first-of-type{flex:1}',
    '.chem-wiz-cat-unit{font-size:10px;color:var(--txt-3);opacity:.8}',
    '.chem-wiz-sel-item{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;background:var(--bg-3);margin-bottom:4px}',
    '.chem-wiz-sel-no{font-size:10px;color:var(--txt-3);font-weight:700;flex-shrink:0;width:18px;text-align:center}',
    '.chem-wiz-sel-name{flex:1;font-size:12px;color:var(--txt-1);display:flex;flex-direction:column}',
    '.chem-wiz-sel-name span{font-size:10px;color:var(--txt-3)}',
    '.chem-wiz-sel-btns{display:flex;gap:2px;flex-shrink:0}',
    '.chem-wiz-sel-btns button{background:none;border:1px solid var(--line);color:var(--txt-3);border-radius:5px;width:22px;height:22px;font-size:10px;cursor:pointer;transition:all .15s}',
    '.chem-wiz-sel-btns button:hover:not(:disabled){color:var(--txt-1);border-color:rgba(255,255,255,.3)}',
    '.chem-wiz-sel-btns button:disabled{opacity:.3;cursor:default}',
    '.chem-wiz-lab-grp{margin-bottom:16px}',
    '.chem-wiz-lab-grp-hdr{font-size:13px;font-weight:700;color:var(--txt-1);margin-bottom:8px}',
    '.chem-wiz-tpl-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;margin-bottom:6px}',
    '.chem-wiz-tpl-info{display:flex;flex-direction:column;gap:2px}',
    '.chem-wiz-tpl-name{font-size:13px;font-weight:600;color:var(--txt-1)}',
    '.chem-wiz-tpl-meta{font-size:11px;color:var(--txt-3)}',
    '.chem-wiz-tpl-btns{display:flex;gap:6px;flex-shrink:0}',
    '@media(max-width:700px){.chem-wiz-cols{grid-template-columns:1fr}}',

    /* Analytics */
    '.chem-anl-sel-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
    '.chem-anl-chart{background:var(--bg-2);border:1px solid var(--line);border-radius:10px;padding:14px;overflow:hidden}',
    '.chem-anl-chart svg{width:100%;display:block}',

    /* Responsive */
    '@media(max-width:600px){.chem-kpi-row{grid-template-columns:1fr 1fr}.chem-param-grid{grid-template-columns:1fr}.chem-form-row,.chem-form-row-3{grid-template-columns:1fr}}',

    /* Protocol detail modal */
    '.chem-pm-card{background:var(--bg-2);border:1px solid var(--line);border-radius:14px;width:96vw;max-width:1200px;height:90vh;display:flex;flex-direction:column;overflow:hidden}',
    '.chem-pm-hdr{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line);flex-shrink:0}',
    '.chem-pm-body{flex:1;display:flex;overflow:hidden;min-height:0}',

    /* Hydrochem diagrams layout */
    '.chem-proto-split{display:flex;width:100%;height:100%;overflow:hidden}',
    '.chem-proto-tbl-col{flex:0 0 300px;overflow-y:auto;border-right:1px solid var(--line);padding:0}',
    '.chem-diag-col{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--bg-1)}',
    /* Компактный переключатель диаграмм — раньше 3 кнопки с полным текстом
       занимали половину ширины панели и заметно ужимали сами диаграммы;
       теперь это узкая группа кнопок-иконок (полное название — во всплывающей
       подсказке title), высота и ширина минимальны. */
    '.chem-diag-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);background:var(--bg-2);flex-shrink:0;padding:5px 6px}',
    '.chem-diag-tab{width:32px;height:28px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:14px;color:var(--txt-3);border:1px solid transparent;border-radius:6px;background:none;cursor:pointer;transition:background .15s,color .15s,border-color .15s}',
    '.chem-diag-tab.active{color:var(--gold,#22d3ee);background:rgba(34,211,238,.14);border-color:rgba(34,211,238,.3)}',
    '.chem-diag-tab:hover:not(.active){background:var(--bg-3);color:var(--txt-1)}',
    '.chem-diag-body{flex:1;overflow:auto;display:flex;align-items:flex-start;justify-content:center;padding:16px}',
    '.chem-diag-pane{display:none;flex-direction:column;align-items:center;gap:16px;width:100%}',
    '.chem-diag-pane.active{display:flex}',
    /* flex-direction здесь — только стартовое значение до первой отрисовки;
       дальше им управляет JS (_chemLayoutDiagPane), переключая row/column по
       фактически измеренной ширине контейнера. Раньше это решал сам браузер
       через flex-wrap — а он ориентируется на реальную ширину контента,
       которая чуть отличается от протокола к протоколу (разная длина текста
       типа воды/формулы Курлова), из-за чего один и тот же по размеру экран
       у одного протокола укладывался в строку, а у другого — переносился
       вниз или обрезался сбоку. flex-wrap:nowrap здесь принципиально —
       перенос по содержимому больше не должен срабатывать никогда, только
       по явному решению JS. */
    '.chem-diag-pane-piper{flex-direction:row;align-items:flex-start;justify-content:center;gap:24px;flex-wrap:nowrap}',
    '.chem-piper-info{min-width:220px;max-width:280px;display:flex;flex-direction:column}',
    '.chem-piper-info-title{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-3);margin-bottom:6px}',
    '.chem-piper-info-type{font-size:14px;font-weight:700;color:var(--txt-1);line-height:1.4;margin-bottom:2px}',
    '.chem-piper-info-hint{font-size:10.5px;color:var(--txt-3);line-height:1.55;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}',
    '.chem-kurlov-box{font-family:Georgia,serif;text-align:center;padding:32px 24px;line-height:2.6;color:var(--txt-1);max-width:560px}',
    '.chem-kurlov-formula{font-size:16px;letter-spacing:.03em;display:flex;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:6px}',
    '.chem-kurlov-frac{display:inline-flex;flex-direction:column;align-items:center;vertical-align:middle;margin:0 2px}',
    '.chem-kurlov-num{border-bottom:1px solid currentColor;padding:0 6px 2px;font-size:14px;white-space:nowrap}',
    '.chem-kurlov-den{padding:2px 6px 0;font-size:14px;white-space:nowrap}',
    '.chem-no-macro{padding:40px;color:var(--txt-3);font-size:13px;text-align:center}',

    /* "Хим. аналитика" — chips выбора пробы */
    '.chem-wpa-chips{display:flex;gap:6px;flex-wrap:wrap}',
    '.chem-wpa-chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:99px;border:1px solid var(--line);background:var(--bg-2);color:var(--txt-2);font-size:11px;cursor:pointer;transition:border-color .15s,background .15s}',
    '.chem-wpa-chip:hover{border-color:var(--txt-3)}',
    '.chem-wpa-chip-dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex-shrink:0}',
    '.chem-wpa-chip-num{opacity:.65;font-size:10px}',
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
        _chemRailItem('wpanalytics', '💧', 'Хим. аналитика') +
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
  if (sec === 'wpanalytics') _chemRenderWpAnalytics(cont);
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
      '<button class="chem-btn chem-btn-ghost" onclick="showChemExceedanceReport()">📊 Отчёт по превышениям</button>' +
      '<button class="chem-btn chem-btn-ghost" onclick="showChemLabTemplateWizard()">⚙️ Шаблоны лабораторий</button>' +
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
      '<span class="chem-filter-lbl">Квартал:</span>' +
      '<select class="chem-sel" id="chem-f-quarter" onchange="chemFilterChange()">' +
        '<option value="">Все кварталы</option>' +
        [1,2,3,4].map(function(q) {
          return '<option value="' + q + '"' + (ChemState.filterQuarter === String(q) ? ' selected' : '') + '>' + _chemRomanQ(q) + ' кв.</option>';
        }).join('') +
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
  ChemState.filterQuarter    = document.getElementById('chem-f-quarter')? document.getElementById('chem-f-quarter').value: '';
  ChemState.filterExceedOnly = document.getElementById('chem-f-exceed') ? document.getElementById('chem-f-exceed').checked : false;
  _chemRenderProtoList();
}

// Мини-график тренда минерализации скважины прямо в карточке списка (UX-03) —
// чтобы увидеть динамику по водопункту, не открывая «Аналитику» для каждой
// карточки отдельно. Использует уже загруженные ChemState.results — если для
// какого-то протокола скважины данные ещё не подгружены (ленивая загрузка
// первых 50), эта точка просто выпадает из графика, без доп. запросов.
function _chemMineralSparklineSvg(wpId, currentProtoId) {
  var pts = ChemState.protocols
    .filter(function(p) { return p.water_point_id === wpId && p.sampled_at; })
    .slice()
    .sort(function(a, b) { return a.sampled_at.localeCompare(b.sampled_at); })
    .map(function(p) {
      var meq = _chemCalcMeq(p.id);
      return { id: p.id, date: p.sampled_at, val: (meq._valid && !isNaN(meq.m_gl)) ? meq.m_gl : null };
    })
    .filter(function(p) { return p.val != null; });

  if (pts.length < 2) return '';

  var W = 80, H = 24, PAD = 3;
  var vals = pts.map(function(p) { return p.val; });
  var vMin = Math.min.apply(null, vals), vMax = Math.max.apply(null, vals);
  if (vMax - vMin < 1e-9) { vMax += 0.05; vMin -= 0.05; }
  function xAt(i) { return PAD + (i / (pts.length - 1)) * (W - PAD * 2); }
  function yAt(v) { return H - PAD - ((v - vMin) / (vMax - vMin)) * (H - PAD * 2); }

  var first = pts[0].val, last = pts[pts.length - 1].val;
  var rising = last > first * 1.03, falling = last < first * 0.97;
  var color = rising ? '#f97316' : falling ? '#22c55e' : '#64748b';
  var trendIcon = rising ? '↑' : falling ? '↓' : '→';

  var poly = pts.map(function(p, i) { return xAt(i).toFixed(1) + ',' + yAt(p.val).toFixed(1); }).join(' ');
  var dots = pts.map(function(p, i) {
    var isCur = p.id === currentProtoId;
    return '<circle cx="' + xAt(i).toFixed(1) + '" cy="' + yAt(p.val).toFixed(1) + '" r="' + (isCur ? 2.6 : 1.5) + '" fill="' + (isCur ? '#3b82f6' : color) + '"/>';
  }).join('');

  var tip = pts.map(function(p) { return _chemFmtDate(p.date, true) + '=' + p.val.toFixed(2) + ' г/л'; }).join(', ');
  return '<span class="chem-spark" title="Минерализация по истории скважины: ' + escHTML(tip) + '">' +
    '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">' +
      '<polyline points="' + poly + '" fill="none" stroke="' + color + '" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>' +
      dots +
    '</svg>' +
    '<span class="chem-spark-trend" style="color:' + color + '">' + trendIcon + '</span>' +
  '</span>';
}

function _chemRenderProtoList() {
  var list = document.getElementById('chem-proto-list');
  if (!list) return;

  var filtered = ChemState.protocols.filter(function(p) {
    if (ChemState.filterWpId && p.water_point_id !== ChemState.filterWpId) return false;
    if (ChemState.filterProtoType && (p.protocol_type || 'full') !== ChemState.filterProtoType) return false;
    if (ChemState.filterYear && (!p.sampled_at || p.sampled_at.substring(0,4) !== ChemState.filterYear)) return false;
    if (ChemState.filterQuarter && String(chemQuarterOf(p)) !== ChemState.filterQuarter) return false;
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
    var controlBadge = p.is_control
      ? '<span class="chem-badge" style="background:rgba(245,158,11,.12);color:#f59e0b;border-color:rgba(245,158,11,.3)">🔬 Контрольная</span>'
      : '';

    var inCompare = ChemState.compareIds.indexOf(p.id) !== -1;
    return '<div class="chem-proto-card" id="cpc-' + p.id + '" onclick="chemOpenProtoModal(\'' + p.id + '\')" style="cursor:pointer">' +
      '<div class="chem-proto-head">' +
        '<label onclick="event.stopPropagation()" title="Добавить в сравнение" style="display:flex;align-items:center;margin-right:6px;cursor:pointer">' +
          '<input type="checkbox" ' + (inCompare ? 'checked' : '') + ' onchange="chemToggleCompare(\'' + p.id + '\',this.checked)" style="accent-color:var(--blue);width:14px;height:14px;cursor:pointer">' +
        '</label>' +
        '<span class="chem-proto-date">' + _chemFmtDate(p.sampled_at) + '</span>' +
        (chemQuarterOf(p) ? '<span class="chem-badge chem-badge-gray" style="margin-right:6px">' + _chemRomanQ(chemQuarterOf(p)) + ' кв.</span>' : '') +
        '<div style="display:flex;flex-direction:column;gap:1px">' +
          '<div style="display:flex;align-items:center;gap:6px">' +
            '<span class="chem-proto-wp">' + escHTML(wp ? wp.name : '—') + '</span>' +
            _chemMineralSparklineSvg(p.water_point_id, p.id) +
          '</div>' +
          '<span class="chem-proto-lab">' +
            (p.lab_name ? escHTML(p.lab_name) : '') +
            (p.lab_protocol_number ? ' №' + escHTML(p.lab_protocol_number) : '') +
            (p.lab_number ? ' (проба ' + escHTML(p.lab_number) + ')' : '') +
          '</span>' +
        '</div>' +
        '<div class="chem-proto-badges">' +
          ptBadge +
          controlBadge +
          badge +
          '<span class="chem-badge chem-badge-gray">' + (rows.length || '?') + ' пар.</span>' +
          (p.scan_url ? '<a href="' + escHTML(p.scan_url) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Открыть скан протокола" style="text-decoration:none;font-size:14px;padding:0 2px">📎</a>' : '') +
          '<button class="chem-btn chem-btn-ghost" style="padding:4px 8px;font-size:11px" onclick="event.stopPropagation();showChemWpPassport(\'' + (wp ? wp.id : '') + '\')" title="Паспорт водопункта">🗒</button>' +
          '<button class="chem-btn chem-btn-ghost" style="padding:4px 8px;font-size:11px" onclick="event.stopPropagation();_chemExportCsv(\'' + p.id + '\')" title="Экспорт CSV">⬇</button>' +
          '<button class="chem-btn chem-btn-ghost" style="padding:4px 8px;font-size:11px" onclick="event.stopPropagation();showChemProtocolForm(\'' + p.id + '\')">✏</button>' +
          '<button class="chem-btn chem-btn-ghost" style="padding:4px 8px;font-size:11px" onclick="event.stopPropagation();chemDuplicateProtocol(\'' + p.id + '\')" title="Дублировать как новый протокол">⧉</button>' +
          '<button class="chem-btn chem-btn-danger" style="padding:4px 8px;font-size:11px" onclick="event.stopPropagation();chemDeleteProtocol(\'' + p.id + '\')">✕</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

// Kept for backwards-compat — now unused but harmless
function chemToggleProto(id) { chemOpenProtoModal(id); }

// CHEM-08: журнал изменений — раскрывающаяся панель в модалке протокола
async function chemToggleHistory(id) {
  var panel = document.getElementById('chem-history-' + id);
  if (!panel) return;
  var isOpen = panel.style.display !== 'none';
  if (isOpen) { panel.style.display = 'none'; return; }

  panel.style.display = 'block';
  panel.innerHTML = '<div style="font-size:12px;color:var(--txt-3)">Загрузка…</div>';
  var res = await ChemApi.getProtocolHistory(id);
  if (res.error) {
    panel.innerHTML = '<div style="font-size:12px;color:var(--txt-3)">Журнал изменений ещё не подключён — выполните миграцию migrations/chem_protocol_history.sql</div>';
    return;
  }
  var rows = res.data || [];
  if (!rows.length) {
    panel.innerHTML = '<div style="font-size:12px;color:var(--txt-3)">Записей пока нет</div>';
    return;
  }
  panel.innerHTML = rows.map(function(h) {
    var when = new Date(h.changed_at).toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    var who = h.changed_by ? escHTML(h.changed_by) : 'неизвестно';
    var actionLabel = h.action === 'created' ? 'Протокол создан' : 'Изменён';
    var changesHtml = (h.changes || []).map(function(c) {
      return '<div style="font-size:11.5px;color:var(--txt-3);padding-left:14px">' +
        escHTML(c.label) + ': ' + (c.old ? '<s>' + escHTML(String(c.old)) + '</s> → ' : '') + '<span style="color:var(--txt-2)">' + escHTML(String(c.new)) + '</span>' +
      '</div>';
    }).join('');
    return '<div style="margin-bottom:10px">' +
      '<div style="font-size:12px;color:var(--txt-1)"><b>' + when + '</b> · ' + who + ' · ' + actionLabel + '</div>' +
      changesHtml +
    '</div>';
  }).join('');
}

function chemOpenProtoModal(id) {
  // Remove existing modal if any
  var existing = document.getElementById('chem-proto-modal');
  if (existing) existing.remove();

  var p  = ChemState.protocols.find(function(x){ return x.id === id; });
  if (!p) return;
  var wp = ChemState.waterPoints.find(function(w){ return w.id === p.water_point_id; });
  var ptMeta = CHEM_PROTO_TYPE_META[p.protocol_type] || CHEM_PROTO_TYPE_META['full'];

  var overlay = document.createElement('div');
  overlay.id = 'chem-proto-modal';
  overlay.className = 'chem-overlay';
  overlay.style.cssText = 'z-index:3000';
  overlay.addEventListener('click', function(e){ if (e.target === overlay) overlay.remove(); });

  overlay.innerHTML =
    '<div class="chem-pm-card">' +
      '<div class="chem-pm-hdr">' +
        '<div style="display:flex;flex-direction:column;gap:3px">' +
          '<div style="display:flex;align-items:center;gap:8px">' +
            '<span style="font-size:16px;font-weight:700;color:var(--txt-1)">' + escHTML(wp ? wp.name : '—') + '</span>' +
            '<span class="chem-badge" style="background:' + ptMeta.color + '18;color:' + ptMeta.color + '">' + ptMeta.icon + ' ' + ptMeta.label + '</span>' +
            (p.is_control ? '<span class="chem-badge" style="background:rgba(245,158,11,.12);color:#f59e0b">🔬 Контрольная</span>' : '') +
          '</div>' +
          '<span style="font-size:12px;color:var(--txt-3)">' +
            _chemFmtDate(p.sampled_at) +
            (p.lab_name ? ' · ' + escHTML(p.lab_name) : '') +
            (p.lab_protocol_number ? ' №' + escHTML(p.lab_protocol_number) : '') +
            (p.lab_number ? ' · проба ' + escHTML(p.lab_number) : '') +
          '</span>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-left:auto;align-items:center">' +
          '<button class="chem-btn chem-btn-ghost" style="font-size:12px" onclick="_chemExportCsv(\'' + id + '\')">⬇ CSV</button>' +
          '<button class="chem-btn chem-btn-ghost" style="font-size:12px" onclick="showChemProtocolForm(\'' + id + '\')">✏ Редакт.</button>' +
          '<button class="chem-btn chem-btn-ghost" style="font-size:12px" onclick="chemToggleHistory(\'' + id + '\')" id="chem-hist-btn-' + id + '">🕓 История</button>' +
          '<button class="chem-modal-close" onclick="document.getElementById(\'chem-proto-modal\').remove()">✕</button>' +
        '</div>' +
      '</div>' +
      '<div id="chem-history-' + id + '" style="display:none;padding:14px 20px;border-bottom:1px solid var(--line);max-height:220px;overflow-y:auto"></div>' +
      '<div class="chem-pm-body" id="chem-pm-body-' + id + '">' +
        '<div style="padding:30px;text-align:center;color:var(--txt-3)">Загрузка…</div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  // Load results if needed
  function _render() {
    var pmBody = document.getElementById('chem-pm-body-' + id);
    if (!pmBody) return;
    pmBody.innerHTML = _chemRenderProtoBody(id);
    _chemInitDiagrams(id);
  }

  if (!ChemState.results[id]) {
    ChemApi.getResults(id).then(function(res) {
      ChemState.results[id] = (!res.error && res.data) ? res.data : [];
      _render();
    });
  } else {
    _render();
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

  // 4 колонки вместо прежних 6 — "Ед. изм." переехала подстрокой под
  // название параметра, а "Статус" убран как колонка: он и так виден по
  // цвету/иконке самого значения и по цветной полоске слева от строки —
  // отдельный текстовый столбец "▲ Превышение / ✓ Норма" только отъедал
  // ширину, которой и так не хватало в узкой боковой колонке.
  var html = '<table class="chem-rtbl"><thead><tr>' +
    '<th>№</th><th>Параметр</th><th>Значение</th><th>ПДК</th></tr></thead><tbody>';

  var groupOrder = ['organo','physico','macro','metals','organic','radio'];
  // Любые группы не из стандартного порядка — рендерим в конце
  Object.keys(byGroup).forEach(function(g){ if (groupOrder.indexOf(g) === -1) groupOrder.push(g); });
  groupOrder.forEach(function(grp) {
    if (!byGroup[grp] || !byGroup[grp].length) return;
    var grpInfo = CHEM_GROUPS[grp] || { label: grp, icon: '•' };
    html += '<tr class="chem-group-hdr"><td colspan="4">' + grpInfo.icon + ' ' + grpInfo.label + '</td></tr>';
    byGroup[grp].forEach(function(item) {
      var p = item.param;
      var r = item.row;
      if (!p) return;
      var status = _chemPdkStatus(r.param_key, r.value_raw, r.below_detection);
      var pdkStr = _chemPdkStr(p);
      var rowCls = status === 'exceed' ? 'chem-row-exceed' : status === 'ok' ? 'chem-row-ok' : 'chem-row-nonorm';
      var icon = status === 'exceed' ? '▲ ' : status === 'ok' ? '✓ ' : '';
      var valCls = status === 'exceed' ? 'chem-pdk-exceed' : status === 'ok' ? 'chem-pdk-ok' : '';
      var valHtml = r.below_detection
        ? '<span class="chem-val-below">' + escHTML(r.value_raw || '') + '</span>'
        : '<span class="' + valCls + '">' + icon + escHTML(r.value_raw || '—') + '</span>';

      html += '<tr class="' + rowCls + '">' +
        '<td style="color:var(--txt-3)">' + p.no + '</td>' +
        '<td>' + escHTML(p.name) + '<div class="chem-rtbl-sub">' + escHTML(p.unit) + '</div></td>' +
        '<td>' + valHtml + '</td>' +
        '<td style="color:var(--txt-3);font-variant-numeric:tabular-nums;white-space:nowrap">' + pdkStr + '</td>' +
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
    '<div class="chem-filters" style="margin-bottom:12px">' +
      '<span class="chem-filter-lbl">Поиск:</span>' +
      '<input class="chem-sel" id="chem-wp-search" placeholder="Код или наименование…" style="min-width:220px" ' +
        'oninput="chemWpSearchChange()" value="' + escHTML(ChemState.filterWpSearch || '') + '">' +
      '<span id="chem-wp-count-lbl" class="chem-filter-lbl" style="margin-left:auto"></span>' +
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

function chemWpSearchChange() {
  var inp = document.getElementById('chem-wp-search');
  ChemState.filterWpSearch = inp ? inp.value : '';
  var tbody = document.getElementById('chem-wp-tbody');
  if (tbody) tbody.innerHTML = _chemWpRows();
}

function _chemWpRows() {
  var q = (ChemState.filterWpSearch || '').toLowerCase().trim();
  var list = ChemState.waterPoints.filter(function(w) {
    if (!q) return true;
    return (w.code || '').toLowerCase().indexOf(q) !== -1 ||
           (w.name || '').toLowerCase().indexOf(q) !== -1;
  });

  var lbl = document.getElementById('chem-wp-count-lbl');
  if (lbl) lbl.textContent = q ? ('Показано: ' + list.length + ' / ' + ChemState.waterPoints.length) : '';

  if (!ChemState.waterPoints.length) {
    return '<tr><td colspan="6"><div class="chem-empty" style="padding:40px">' +
      '<div class="chem-empty-ico">📍</div>' +
      '<div class="chem-empty-txt">Водопункты не добавлены</div>' +
      '<div class="chem-empty-sub">Добавьте первый водопункт для привязки протоколов анализа</div></div></td></tr>';
  }
  if (!list.length) {
    return '<tr><td colspan="6"><div style="padding:24px;text-align:center;color:var(--txt-3);font-size:13px">Ничего не найдено</div></td></tr>';
  }
  return list.map(function(w) {
    var protoCount = ChemState.protocols.filter(function(p){ return p.water_point_id === w.id; }).length;
    var canDelete = protoCount === 0;
    var delBtn = canDelete
      ? '<button class="chem-btn chem-btn-danger" style="padding:4px 8px;font-size:11px" onclick="chemDeleteWp(\'' + w.id + '\')" title="Удалить водопункт">✕</button>'
      : '<button class="chem-btn chem-btn-ghost" style="padding:4px 8px;font-size:11px;opacity:.4;cursor:not-allowed" title="Есть привязанные протоколы — удаление невозможно" disabled>✕</button>';
    return '<tr>' +
      '<td style="font-weight:600;color:var(--blue)">' + escHTML(w.code || '—') + '</td>' +
      '<td style="font-weight:600">' + escHTML(w.name) + '</td>' +
      '<td><span class="chem-wp-type">' + escHTML(CHEM_WP_TYPES[w.wp_type || w.type] || w.wp_type || w.type) + '</span></td>' +
      '<td style="color:var(--txt-2)">' + escHTML(w.location_desc || '—') + '</td>' +
      '<td style="text-align:center">' + protoCount + '</td>' +
      '<td style="text-align:right;white-space:nowrap">' +
        '<button class="chem-btn chem-btn-ghost" style="padding:4px 8px;font-size:11px;margin-right:4px" onclick="showChemWpForm(\'' + w.id + '\')">✏</button>' +
        delBtn +
      '</td>' +
    '</tr>';
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
//  СЕКЦИЯ: ХИМ. АНАЛИТИКА (Пайпер/Стифф/Шоллер по всем протоколам одного
//  водопункта сразу — та же тройка диаграмм, что и в карточке протокола,
//  только теперь охватывает всю историю, а не только "соседей" по одному
//  открытому протоколу).
// ═══════════════════════════════════════════════════════════════
function _chemRenderWpAnalytics(cont) {
  var wpOpts = '<option value="">— Выберите водопункт —</option>' + ChemState.waterPoints.map(function(w) {
    return '<option value="' + w.id + '"' + (ChemState.wpaSelectedWpId === w.id ? ' selected' : '') + '>' + escHTML(w.name) + '</option>';
  }).join('');

  cont.innerHTML =
    '<div class="chem-hdr">' +
      '<span class="chem-hdr-title">Химическая аналитика по водопункту</span>' +
      '<span class="chem-hdr-sub">Все протоколы одного водопункта на одних диаграммах Пайпера/Стиффа/Шоллера — видно, как менялся состав со временем</span>' +
    '</div>' +
    '<div class="chem-filters" style="margin-bottom:12px">' +
      '<span class="chem-filter-lbl">Водопункт:</span>' +
      '<select class="chem-sel" id="chem-wpa-wp" onchange="chemWpaSelectWp(this.value)" style="min-width:240px">' + wpOpts + '</select>' +
    '</div>' +
    '<div id="chem-wpa-body"></div>';

  _chemRenderWpaBody();
}

function chemWpaSelectWp(wpId) {
  ChemState.wpaSelectedWpId = wpId;
  ChemState.wpaSelectedProtoId = '';
  _chemRenderWpaBody();
}

function _chemRenderWpaBody() {
  var body = document.getElementById('chem-wpa-body');
  if (!body) return;
  var wpId = ChemState.wpaSelectedWpId;
  if (!wpId) {
    body.innerHTML = '<div class="chem-empty"><div class="chem-empty-ico">💧</div>' +
      '<div class="chem-empty-txt">Выберите водопункт</div>' +
      '<div class="chem-empty-sub">Соберём диаграммы Пайпера, Стиффа и Шоллера по всем его протоколам сразу — кликом по любой точке открывается состав именно той пробы</div></div>';
    return;
  }

  var wp = ChemState.waterPoints.find(function(w){ return w.id === wpId; });
  var allProtos = ChemState.protocols.filter(function(p){ return p.water_point_id === wpId; })
    .sort(function(a,b){ return a.sampled_at < b.sampled_at ? 1 : -1; }); // новые сверху

  var meqList = [];
  allProtos.forEach(function(p) {
    var m = _chemCalcMeq(p.id);
    if (m._valid) meqList.push({ meq: m, id: p.id, date: p.sampled_at });
  });
  ChemState._wpaMeqList = meqList;

  if (!meqList.length) {
    body.innerHTML = '<div class="chem-empty"><div class="chem-empty-ico">🔬</div>' +
      '<div class="chem-empty-txt">Нет данных для построения диаграмм</div>' +
      '<div class="chem-empty-sub">' +
      (allProtos.length
        ? 'Есть ' + allProtos.length + ' протокол(а) по «' + escHTML(wp.name) + '», но ни в одном нет полного макрокомпонентного состава (Ca, Mg, Na+K, HCO₃, SO₄, Cl)'
        : 'По водопункту «' + escHTML(wp.name) + '» протоколов пока нет') +
      '</div></div>';
    return;
  }

  if (!ChemState.wpaSelectedProtoId || !meqList.some(function(m){ return m.id === ChemState.wpaSelectedProtoId; })) {
    ChemState.wpaSelectedProtoId = meqList[0].id; // самая свежая проба по умолчанию
  }

  var excludedCount = allProtos.length - meqList.length;

  // Цвет чипа = CHEM_DATE_COLORS[idx] — тот же индекс и тот же массив
  // (ChemState._wpaMeqList), что уходит в _chemDrawPiper/_chemDrawSchoeller
  // ниже, так что цвет чипа гарантированно совпадает с цветом точки/линии
  // этой же пробы на обеих диаграммах.
  var chipsHtml = '<div class="chem-wpa-chips">' +
    meqList.map(function(item, idx) {
      var p = allProtos.find(function(pp){ return pp.id === item.id; });
      var color = CHEM_DATE_COLORS[idx % CHEM_DATE_COLORS.length];
      var isActive = item.id === ChemState.wpaSelectedProtoId;
      var style = isActive
        ? 'border-color:' + color + ';background:' + color + '22;color:var(--txt-1);font-weight:600'
        : '';
      return '<button class="chem-wpa-chip" data-pid="' + item.id + '" data-color="' + color + '" style="' + style + '" onclick="chemWpaSelectProto(\'' + item.id + '\')">' +
        '<span class="chem-wpa-chip-dot" style="background:' + color + '"></span>' +
        _chemFmtDate(item.date) +
        (p && p.lab_protocol_number ? ' <span class="chem-wpa-chip-num">№' + escHTML(p.lab_protocol_number) + '</span>' : '') +
      '</button>';
    }).join('') +
  '</div>';

  var diagHtml =
    '<div class="chem-diag-tabs" id="chem-diag-tabs-wpa">' +
      '<button class="chem-diag-tab active" title="Диаграмма Пайпера" onclick="chemSwitchDiag(\'wpa\',\'piper\',this)">📐</button>' +
      '<button class="chem-diag-tab" title="Стифф · Шоллер" onclick="chemSwitchDiag(\'wpa\',\'stiff\',this)">📊</button>' +
      '<button class="chem-diag-tab" title="Квадрат Толстихина" onclick="chemSwitchDiag(\'wpa\',\'tolst\',this)">▦</button>' +
    '</div>' +
    '<div class="chem-diag-body">' +
      '<div class="chem-diag-pane active chem-diag-pane-piper" id="chem-dpane-wpa-piper">' +
        '<canvas id="chem-cv-piper-wpa" style="max-width:100%"></canvas>' +
        '<div class="chem-piper-info">' +
          '<div class="chem-piper-info-title">Тип воды по Пайперу — выбранная проба</div>' +
          '<div class="chem-piper-info-type" id="chem-wtype-wpa">—</div>' +
          '<div class="chem-kurlov-box" id="chem-kurlov-wpa" style="padding:8px 0 0;text-align:left;max-width:none;line-height:2.2"></div>' +
          '<div class="chem-piper-info-hint">ⓘ На диаграмме сразу все пробы этого водопункта — цвет точки = дата (см. легенду). Кликните по точке (в любом из трёх полей) или по дате в списке выше — ниже раскроется полный состав именно этой пробы.</div>' +
        '</div>' +
      '</div>' +
      '<div class="chem-diag-pane" id="chem-dpane-wpa-stiff">' +
        '<canvas id="chem-cv-stiff-wpa" style="max-width:100%"></canvas>' +
        '<canvas id="chem-cv-scho-wpa" style="max-width:100%"></canvas>' +
      '</div>' +
      '<div class="chem-diag-pane chem-diag-pane-piper" id="chem-dpane-wpa-tolst">' +
        '<canvas id="chem-cv-tolst-wpa" style="max-width:100%"></canvas>' +
        '<div class="chem-piper-info">' +
          '<div class="chem-piper-info-title">Квадрат Толстихина — выбранная проба</div>' +
          '<div class="chem-piper-info-type" id="chem-tolst-cell-wpa">—</div>' +
          '<div class="chem-piper-info-hint">' +
            'ⓘ Все пробы этого водопункта сразу, цвет = дата. По горизонтали доля Cl+SO₄ среди анионов, по вертикали — доля ' +
            'Ca+Mg среди катионов. Сетка 10×10 — как в методике Толстихина/Джикия; номер ячейки — её позиция (столбец-строка), ' +
            'подтверждённой исторической таблицы генетических классов по номерам не нашлось.' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  body.innerHTML =
    '<div class="chem-kpi-row" style="grid-template-columns:repeat(3,1fr);margin-bottom:12px">' +
      _chemKpi('Протоколов', allProtos.length, 'у «' + escHTML(wp.name) + '»') +
      _chemKpi('На диаграмме', meqList.length, excludedCount ? excludedCount + ' без макросостава' : 'все с полным составом') +
      _chemKpi('Период', meqList.length > 1 ? _chemFmtDate(meqList[meqList.length-1].date, true) + ' — ' + _chemFmtDate(meqList[0].date, true) : _chemFmtDate(meqList[0].date), '') +
    '</div>' +
    chipsHtml +
    '<div class="chem-pm-body" id="chem-pm-body-wpa" style="height:640px;border:1px solid var(--line);border-radius:10px;overflow:hidden;margin-top:10px">' + diagHtml + '</div>' +
    '<div id="chem-wpa-detail" style="margin-top:14px"></div>';

  _chemInitWpaDiagrams();
  _chemRenderWpaDetail();
}

// Раскладка панели "диаграмма + инфо-колонка справа" (Пайпер, квадрат
// Толстихина). Раньше решение "в строку или перенести вниз" отдавалось
// браузеру (flex-wrap) — а он ориентируется на фактическую ширину контента,
// которая чуть-чуть отличается от протокола к протоколу (разная длина
// текста типа воды/формулы Курлова), поэтому один и тот же по размеру
// экран у одного протокола укладывался в строку, а у другого — нет:
// раскладка "прыгала" не из-за окна, а из-за конкретных данных.
//
// Теперь решение принимается один раз здесь, по одному-единственному
// критерию — фактической ширине контейнера, — и одинаково для всех
// протоколов при одном и том же размере окна:
//   • если помещаются оба минимума (canvasMin + зазор + INFO_MIN) — строка,
//     колонка получает пропорционально доступное место (220–280px);
//   • если нет — столбец на всю ширину (колонка растягивается под
//     диаграмму, а не обрезается сбоку).
// Возвращает ширину canvas; сама переключает pane.style.flexDirection.
var CHEM_INFO_MIN = 220, CHEM_INFO_MAX = 280, CHEM_ROW_GAP = 24;
function _chemLayoutDiagPane(pane, canvasMin, canvasMax) {
  var avail = pane ? pane.clientWidth : canvasMax + CHEM_ROW_GAP + CHEM_INFO_MAX;
  var info = pane ? pane.querySelector('.chem-piper-info') : null;
  var fitsRow = avail >= canvasMin + CHEM_ROW_GAP + CHEM_INFO_MIN;
  if (pane) pane.style.flexDirection = fitsRow ? 'row' : 'column';
  if (info) info.style.maxWidth = fitsRow ? '' : 'none';
  if (fitsRow) {
    return Math.max(canvasMin, Math.min(canvasMax, avail - CHEM_ROW_GAP - CHEM_INFO_MAX));
  }
  return Math.max(240, Math.min(canvasMax, avail));
}

// Перерисовывает диаграмму Пайпера в разделе "Хим. аналитика" под текущую
// ширину контейнера — вызывается и при первой отрисовке, и при resize.
function _chemWpaRedrawPiper() {
  var cvP = document.getElementById('chem-cv-piper-wpa');
  if (!cvP) return false;
  var paneP = cvP.closest('.chem-diag-pane-piper');
  var piperW = _chemLayoutDiagPane(paneP, 420, 640);
  cvP._piperSelectedId = ChemState.wpaSelectedProtoId;
  _chemDrawPiper(cvP, ChemState._wpaMeqList, ChemState.wpaSelectedProtoId, piperW, function(id) {
    ChemState.wpaSelectedProtoId = id;
    _chemRedrawWpaSecondary();
    _chemWpaRedrawTolstikhin();
    _chemRenderWpaDetail();
    _chemHighlightWpaChip(id);
  });
  return true;
}

// То же самое для квадрата Толстихина — своя ширина по контейнеру, клик по
// точке синхронизирует выбор и с Пайпером/Стиффом·Шоллером, и с чипами дат.
function _chemWpaRedrawTolstikhin() {
  var cvT = document.getElementById('chem-cv-tolst-wpa');
  if (!cvT) return false;
  var paneT = cvT.closest('.chem-diag-pane-piper');
  var tolstW = _chemLayoutDiagPane(paneT, 420, 640);
  cvT._tolstSelectedId = ChemState.wpaSelectedProtoId;
  _chemDrawTolstikhin(cvT, ChemState._wpaMeqList, ChemState.wpaSelectedProtoId, tolstW, function(id) {
    ChemState.wpaSelectedProtoId = id;
    _chemRedrawWpaSecondary();
    _chemWpaRedrawPiper();
    _chemRenderWpaDetail();
    _chemHighlightWpaChip(id);
    // Раньше эта строка стояла только ниже, вне колбэка — обновлялась один
    // раз при построении диаграммы, но не при клике по точке (баг: всё
    // остальное — Пайпер, Стифф·Шоллер, карточка, чипы — обновлялось, а
    // текст "Ячейка X-Y" у самого квадрата оставался старым).
    _chemUpdateTolstCellInfo('wpa', ChemState._wpaMeqList, id);
  });
  _chemUpdateTolstCellInfo('wpa', ChemState._wpaMeqList, ChemState.wpaSelectedProtoId);
  return true;
}

// Стифф/Шоллер + формула Курлова/тип воды — всё, что зависит от того, какая
// именно проба сейчас выбрана (а не от размера контейнера).
function _chemRedrawWpaSecondary() {
  var meqList = ChemState._wpaMeqList || [];
  var sel = meqList.find(function(m){ return m.id === ChemState.wpaSelectedProtoId; }) || meqList[0];
  if (!sel) return;

  var cvS = document.getElementById('chem-cv-stiff-wpa');
  if (cvS) {
    var availS = cvS.parentElement ? cvS.parentElement.clientWidth : 500;
    _chemDrawStiff(cvS, sel.meq, Math.max(320, availS), 220);
  }
  var cvSc = document.getElementById('chem-cv-scho-wpa');
  if (cvSc) {
    var availSc = cvSc.parentElement ? cvSc.parentElement.clientWidth : 560;
    _chemDrawSchoeller(cvSc, meqList, ChemState.wpaSelectedProtoId, Math.max(320, availSc), 280);
  }
  var kurEl   = document.getElementById('chem-kurlov-wpa');
  var wtypeEl = document.getElementById('chem-wtype-wpa');
  if (kurEl)   kurEl.innerHTML   = _chemBuildKurlov(sel.meq);
  if (wtypeEl) wtypeEl.innerHTML = _chemWtypeHtml(sel.meq);
}

function _chemHighlightWpaChip(id) {
  document.querySelectorAll('.chem-wpa-chip').forEach(function(b) {
    var color = b.dataset.color || 'var(--blue)';
    if (b.dataset.pid === id) {
      b.style.borderColor = color; b.style.background = color + '22';
      b.style.color = 'var(--txt-1)'; b.style.fontWeight = '600';
    } else {
      b.style.borderColor = ''; b.style.background = ''; b.style.color = ''; b.style.fontWeight = '';
    }
  });
}

// Клик по дате в списке чипов — тот же эффект, что клик прямо по точке на
// диаграмме Пайпера, только более прицельный (полезно, когда несколько проб
// легли близко друг к другу и в них трудно попасть кликом).
function chemWpaSelectProto(id) {
  ChemState.wpaSelectedProtoId = id;
  _chemWpaRedrawPiper();
  _chemWpaRedrawTolstikhin();
  _chemRedrawWpaSecondary();
  _chemRenderWpaDetail();
  _chemHighlightWpaChip(id);
}

function _chemRenderWpaDetail() {
  var el = document.getElementById('chem-wpa-detail');
  if (!el) return;
  var meqList = ChemState._wpaMeqList || [];
  var sel = meqList.find(function(m){ return m.id === ChemState.wpaSelectedProtoId; });
  if (!sel) { el.innerHTML = ''; return; }

  if (!ChemState.results[sel.id]) {
    el.innerHTML = '<div style="padding:20px;color:var(--txt-3);font-size:12px">Загрузка результатов…</div>';
    ChemApi.getResults(sel.id).then(function(res) {
      ChemState.results[sel.id] = (!res.error && res.data) ? res.data : [];
      _chemRenderWpaDetail();
    });
    return;
  }

  var p = ChemState.protocols.find(function(pp){ return pp.id === sel.id; });
  if (!p) { el.innerHTML = ''; return; }
  var ptMeta = CHEM_PROTO_TYPE_META[p.protocol_type] || CHEM_PROTO_TYPE_META['full'];

  el.innerHTML =
    '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--line)">' +
      '<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-3)">Выбранный протокол:</span>' +
      '<span style="font-size:14px;font-weight:700;color:var(--txt-1)">' + _chemFmtDate(p.sampled_at) + '</span>' +
      '<span class="chem-badge" style="background:' + ptMeta.color + '18;color:' + ptMeta.color + '">' + ptMeta.icon + ' ' + ptMeta.label + '</span>' +
      (p.lab_name || p.lab_protocol_number ? '<span style="font-size:12px;color:var(--txt-3)">' +
        escHTML(p.lab_name || '') + (p.lab_protocol_number ? ' №' + escHTML(p.lab_protocol_number) : '') + '</span>' : '') +
      '<div style="flex:1"></div>' +
      '<button class="chem-btn chem-btn-ghost" style="font-size:11px" onclick="_chemExportCsv(\'' + sel.id + '\')">⬇ CSV</button>' +
      '<button class="chem-btn chem-btn-ghost" style="font-size:11px" onclick="showChemProtocolForm(\'' + sel.id + '\')">✏ Редакт.</button>' +
    '</div>' +
    _chemRenderResultsTable(sel.id);
}

// Первичная отрисовка + подписка на resize (само отписывается, как только
// контейнер #chem-pm-body-wpa пропадёт из DOM — то есть при уходе с вкладки).
function _chemInitWpaDiagrams() {
  _chemWpaRedrawPiper();
  _chemWpaRedrawTolstikhin();
  _chemRedrawWpaSecondary();

  var _wpaResizeTimer = null;
  function onResize() {
    clearTimeout(_wpaResizeTimer);
    _wpaResizeTimer = setTimeout(function() {
      if (!document.getElementById('chem-pm-body-wpa')) { window.removeEventListener('resize', onResize); return; }
      _chemWpaRedrawPiper();
      _chemWpaRedrawTolstikhin();
      _chemRedrawWpaSecondary();
    }, 120);
  }
  window.addEventListener('resize', onResize);
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
    return '<option value="' + k + '"' + (wp && (wp.wp_type || wp.type) === k ? ' selected' : '') + '>' + CHEM_WP_TYPES[k] + '</option>';
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
      '<div class="chem-fld"><label>Шаблон лаборатории по умолчанию</label>' +
        '<select class="chem-inp" id="wf-default-template">' +
          '<option value="">— не задан —</option>' +
          ChemState.labTemplates.map(function(t) {
            var sel = wp && wp.default_template_id === t.id ? ' selected' : '';
            return '<option value="' + t.id + '"' + sel + '>' + escHTML(t.lab_name) + ' / ' + escHTML(t.template_name) + '</option>';
          }).join('') +
        '</select>' +
        '<span style="font-size:10.5px;color:var(--txt-3);margin-top:3px;display:block">Подставится в новый протокол для этого водопункта автоматически</span>' +
      '</div>' +
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
    default_template_id: (document.getElementById('wf-default-template') && document.getElementById('wf-default-template').value) || null,
  };
  if (existingId) row.id = existingId;
  var res = await ChemApi.upsertWaterPoint(row);
  if (res.error) { alert('Ошибка сохранения: ' + res.error.message); return; }
  var saved = res.data;
  // wp_registry возвращает wp_type — нормализуем для обратной совместимости
  if (saved && saved.wp_type && !saved.type) saved.type = saved.wp_type;
  if (existingId) {
    ChemState.waterPoints = ChemState.waterPoints.map(function(w){ return w.id === existingId ? saved : w; });
  } else {
    ChemState.waterPoints.push(saved);
  }
  // Обновляем реестр если он уже загружен (единый источник)
  if (typeof RegistryState !== 'undefined' && RegistryState.loaded) {
    if (existingId) {
      RegistryState.items = RegistryState.items.map(function(w){ return w.id === existingId ? saved : w; });
    } else {
      RegistryState.items.push(saved);
    }
  }
  _chemCloseModal();
  _chemRenderSection('waterpoints');
  if (typeof Toast !== 'undefined') Toast.done('msg', 'Водопункт сохранён');
}

async function chemDeleteWp(id) {
  if (!confirm('Удалить водопункт из единого реестра? Это также удалит его с карты. Действие нельзя отменить.')) return;
  var res = await ChemApi.deleteWaterPoint(id);
  if (res.error) { alert('Ошибка удаления: ' + res.error.message); return; }
  ChemState.waterPoints = ChemState.waterPoints.filter(function(w){ return w.id !== id; });
  // Синхронизируем реестр карты
  if (typeof RegistryState !== 'undefined' && RegistryState.loaded) {
    RegistryState.items = RegistryState.items.filter(function(w){ return w.id !== id; });
  }
  _chemRenderSection('waterpoints');
}

// ═══════════════════════════════════════════════════════════════
//  МАСТЕР ШАБЛОНОВ ЛАБОРАТОРИЙ
//  Позволяет для каждой лаборатории (напр. EcoExpert) настроить свой
//  набор и порядок параметров (из существующего каталога CHEM_PARAMS) —
//  используется и в форме ручного ввода, и в загрузочном Excel-шаблоне.
// ═══════════════════════════════════════════════════════════════

function _chemDistinctLabNames() {
  var set = {};
  ChemState.labTemplates.forEach(function(t) { if (t.lab_name) set[t.lab_name] = true; });
  ChemState.protocols.forEach(function(p) { if (p.lab_name) set[p.lab_name] = true; });
  return Object.keys(set).sort();
}

// Поле "Лаборатория": текст (для новых названий) + гарантированно рабочий
// выпадающий список уже известных лабораторий рядом. Обычный <datalist>
// в некоторых браузерах/политиках безопасности не открывается по клику
// (перекрывается автозаполнением) — этот select работает всегда.
function _chemLabFieldHtml(inputId, currentValue, oninputExpr, pickFnName) {
  var labs = _chemDistinctLabNames();
  var pickOpts = labs.map(function(l) { return '<option value="' + escHTML(l) + '">' + escHTML(l) + '</option>'; }).join('');
  return (
    '<div style="display:flex;gap:4px">' +
      '<input class="chem-inp" id="' + inputId + '" placeholder="EcoExpert" autocomplete="off" value="' + escHTML(currentValue || '') + '" oninput="' + oninputExpr + '" style="flex:1;min-width:0">' +
      (labs.length
        ? '<select class="chem-inp" title="Выбрать из уже известных лабораторий" style="flex:0 0 40px;padding:7px 2px;text-align:center" onchange="' + pickFnName + '(this.value);this.value=\'\'">' +
            '<option value="">▾</option>' + pickOpts +
          '</select>'
        : '') +
    '</div>'
  );
}
function chemFormLabPick(val) {
  if (!val) return;
  var inp = document.getElementById('pf-lab');
  if (inp) inp.value = val;
  chemFormLabChanged();
}
function chemWizLabPick(val) {
  if (!val) return;
  _chemWiz.lab = val;
  var inp = document.getElementById('chem-wiz-lab');
  if (inp) inp.value = val;
}

var _chemWiz = { screen: 'list', editingId: null, lab: '', name: '', baseType: 'sha', selected: [], search: '' };

function showChemLabTemplateWizard() {
  _chemWiz = { screen: 'list', editingId: null, lab: '', name: '', baseType: 'sha', selected: [], search: '' };
  _chemWizRender();
}

function _chemWizRender() {
  if (_chemWiz.screen === 'editor') {
    _chemOpenModal(
      (_chemWiz.editingId ? 'Изменить шаблон' : 'Новый шаблон') + (_chemWiz.lab ? ' — ' + escHTML(_chemWiz.lab) : ''),
      _chemWizEditorHtml(),
      '<button class="chem-btn chem-btn-ghost" onclick="chemWizBackToList()">← Назад к списку</button>' +
      '<button class="chem-btn chem-btn-prim" onclick="chemWizSaveTemplate()">💾 Сохранить шаблон</button>',
      'max-width:920px'
    );
  } else {
    _chemOpenModal(
      '🧪 Шаблоны лабораторий',
      '<div style="margin-bottom:14px;font-size:12px;color:var(--txt-3);line-height:1.6">' +
        'Настройте под конкретную лабораторию свой набор и порядок параметров — он станет доступен при ручном вводе протокола и при скачивании загрузочного Excel-шаблона.' +
      '</div>' +
      '<div style="margin-bottom:14px"><button class="chem-btn chem-btn-prim" onclick="chemWizNewTemplate()">+ Новый шаблон</button></div>' +
      '<div id="chem-wiz-list">' + _chemWizListHtml() + '</div>',
      '<button class="chem-btn chem-btn-ghost" onclick="_chemCloseModal()">Закрыть</button>',
      'max-width:640px'
    );
  }
}

function _chemWizListHtml() {
  if (!ChemState.labTemplates.length) {
    return '<div class="chem-empty"><div class="chem-empty-ico">🧪</div>' +
      '<div class="chem-empty-txt">Шаблонов ещё нет</div>' +
      '<div class="chem-empty-sub">Создайте первый шаблон для своей лаборатории — например EcoExpert — с нужным набором и порядком параметров</div></div>';
  }
  var byLab = {};
  ChemState.labTemplates.forEach(function(t) {
    if (!byLab[t.lab_name]) byLab[t.lab_name] = [];
    byLab[t.lab_name].push(t);
  });
  var html = '';
  Object.keys(byLab).sort().forEach(function(lab) {
    html += '<div class="chem-wiz-lab-grp"><div class="chem-wiz-lab-grp-hdr">🧪 ' + escHTML(lab) + '</div>';
    byLab[lab].forEach(function(t) {
      var meta = CHEM_PROTO_TYPE_META[t.base_type] || CHEM_PROTO_TYPE_META.sha;
      html += '<div class="chem-wiz-tpl-row">' +
        '<div class="chem-wiz-tpl-info">' +
          '<span class="chem-wiz-tpl-name">' + escHTML(t.template_name) + '</span>' +
          '<span class="chem-wiz-tpl-meta">' + meta.icon + ' ' + meta.label + ' · ' + (t.params||[]).length + ' показателей</span>' +
        '</div>' +
        '<div class="chem-wiz-tpl-btns">' +
          '<button class="chem-btn chem-btn-ghost" onclick="chemWizEditTemplate(\'' + t.id + '\')">✎ Изменить</button>' +
          '<button class="chem-btn chem-btn-ghost" onclick="chemWizDuplicateTemplate(\'' + t.id + '\')">⧉ Дублировать</button>' +
          '<button class="chem-btn chem-btn-ghost" style="color:#f87171" onclick="chemWizDeleteTemplate(\'' + t.id + '\')">🗑</button>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
  });
  return html;
}

function _chemWizEditorHtml() {
  var typeOpts = Object.keys(CHEM_PROTO_TYPE_META).map(function(k) {
    var m = CHEM_PROTO_TYPE_META[k];
    return '<option value="' + k + '"' + (k === _chemWiz.baseType ? ' selected' : '') + '>' + m.icon + ' ' + m.label + '</option>';
  }).join('');
  return (
    '<div class="chem-form-row chem-form-row-3">' +
      '<div class="chem-fld"><label>Лаборатория *</label>' +
        _chemLabFieldHtml('chem-wiz-lab', _chemWiz.lab, '_chemWiz.lab=this.value', 'chemWizLabPick') +
      '</div>' +
      '<div class="chem-fld"><label>Название шаблона *</label>' +
        '<input class="chem-inp" id="chem-wiz-name" placeholder="Вариант 1" value="' + escHTML(_chemWiz.name) + '" oninput="_chemWiz.name=this.value">' +
      '</div>' +
      '<div class="chem-fld"><label>Вид протокола (по умолчанию)</label>' +
        '<select class="chem-inp" id="chem-wiz-basetype" onchange="_chemWiz.baseType=this.value">' + typeOpts + '</select>' +
      '</div>' +
    '</div>' +
    '<div class="chem-fld" style="margin-bottom:10px">' +
      '<input class="chem-inp" id="chem-wiz-search" placeholder="🔍 Поиск параметра по названию…" oninput="chemWizSearchChange(this.value)">' +
    '</div>' +
    '<div class="chem-wiz-cols">' +
      '<div class="chem-wiz-col">' +
        '<div class="chem-wiz-col-hdr">Каталог параметров — отметьте нужные</div>' +
        '<div class="chem-wiz-catalog" id="chem-wiz-catalog">' + _chemWizCatalogHtml() + '</div>' +
      '</div>' +
      '<div class="chem-wiz-col">' +
        '<div class="chem-wiz-col-hdr">Выбрано и порядок ввода (<span id="chem-wiz-sel-count">' + _chemWiz.selected.length + '</span>)</div>' +
        '<div class="chem-wiz-selected" id="chem-wiz-selected">' + _chemWizSelectedHtml() + '</div>' +
      '</div>' +
    '</div>'
  );
}

function _chemWizCatalogHtml() {
  var q = (_chemWiz.search || '').toLowerCase().trim();
  var html = '';
  Object.keys(CHEM_GROUPS).forEach(function(g) {
    var params = CHEM_PARAMS.filter(function(p) {
      if (p.group !== g) return false;
      if (!q) return true;
      return p.name.toLowerCase().indexOf(q) >= 0 || p.key.toLowerCase().indexOf(q) >= 0;
    });
    if (!params.length) return;
    html += '<div class="chem-wiz-cat-grp"><div class="chem-wiz-cat-grp-hdr">' + CHEM_GROUPS[g].icon + ' ' + CHEM_GROUPS[g].label + '</div>';
    params.forEach(function(p) {
      var checked = _chemWiz.selected.indexOf(p.key) >= 0;
      html += '<label class="chem-wiz-cat-item' + (checked ? ' checked' : '') + '">' +
        '<input type="checkbox"' + (checked ? ' checked' : '') + ' onchange="chemWizToggleParam(\'' + p.key + '\')">' +
        '<span>' + p.no + '. ' + escHTML(p.name) + '</span><span class="chem-wiz-cat-unit">' + escHTML(p.unit) + '</span>' +
      '</label>';
    });
    html += '</div>';
  });
  if (!html) html = '<div style="font-size:12px;color:var(--txt-3);padding:12px">Ничего не найдено</div>';
  return html;
}

function _chemWizSelectedHtml() {
  if (!_chemWiz.selected.length) {
    return '<div style="font-size:12px;color:var(--txt-3);padding:12px">Пока ничего не выбрано — отметьте параметры слева</div>';
  }
  return _chemWiz.selected.map(function(key, idx) {
    var p = CHEM_PARAM_MAP[key];
    if (!p) return '';
    return '<div class="chem-wiz-sel-item">' +
      '<span class="chem-wiz-sel-no">' + (idx + 1) + '</span>' +
      '<span class="chem-wiz-sel-name">' + escHTML(p.name) + '<span>' + escHTML(p.unit) + '</span></span>' +
      '<span class="chem-wiz-sel-btns">' +
        '<button type="button" title="Выше" onclick="chemWizMoveParam(\'' + key + '\',-1)"' + (idx === 0 ? ' disabled' : '') + '>▲</button>' +
        '<button type="button" title="Ниже" onclick="chemWizMoveParam(\'' + key + '\',1)"' + (idx === _chemWiz.selected.length - 1 ? ' disabled' : '') + '>▼</button>' +
        '<button type="button" title="Убрать" onclick="chemWizRemoveParam(\'' + key + '\')">✕</button>' +
      '</span>' +
    '</div>';
  }).join('');
}

function chemWizNewTemplate() {
  _chemWiz = { screen: 'editor', editingId: null, lab: '', name: '', baseType: 'sha', selected: [], search: '' };
  _chemWizRender();
}
function chemWizEditTemplate(id) {
  var t = ChemState.labTemplates.find(function(x) { return x.id === id; });
  if (!t) return;
  _chemWiz = { screen: 'editor', editingId: t.id, lab: t.lab_name, name: t.template_name, baseType: t.base_type || 'sha', selected: (t.params || []).slice(), search: '' };
  _chemWizRender();
}
function chemWizDuplicateTemplate(id) {
  var t = ChemState.labTemplates.find(function(x) { return x.id === id; });
  if (!t) return;
  _chemWiz = { screen: 'editor', editingId: null, lab: t.lab_name, name: t.template_name + ' (копия)', baseType: t.base_type || 'sha', selected: (t.params || []).slice(), search: '' };
  _chemWizRender();
}
async function chemWizDeleteTemplate(id) {
  if (!confirm('Удалить этот шаблон? Уже сохранённые протоколы не изменятся, но при их редактировании форма покажет полный каталог параметров.')) return;
  var res = await ChemApi.deleteLabTemplate(id);
  if (res.error) { _chemWizNotify('Ошибка удаления: ' + res.error.message, 'error'); return; }
  ChemState.labTemplates = ChemState.labTemplates.filter(function(t) { return t.id !== id; });
  _chemWizRender();
}
function chemWizBackToList() {
  _chemWiz.screen = 'list';
  _chemWizRender();
}

function chemWizToggleParam(key) {
  var idx = _chemWiz.selected.indexOf(key);
  if (idx >= 0) _chemWiz.selected.splice(idx, 1);
  else _chemWiz.selected.push(key);
  _chemWizRefreshPanes();
}
function chemWizRemoveParam(key) {
  var idx = _chemWiz.selected.indexOf(key);
  if (idx >= 0) _chemWiz.selected.splice(idx, 1);
  _chemWizRefreshPanes();
}
function chemWizMoveParam(key, dir) {
  var idx = _chemWiz.selected.indexOf(key);
  if (idx < 0) return;
  var newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= _chemWiz.selected.length) return;
  var tmp = _chemWiz.selected[idx];
  _chemWiz.selected[idx] = _chemWiz.selected[newIdx];
  _chemWiz.selected[newIdx] = tmp;
  _chemWizRefreshPanes();
}
function chemWizSearchChange(val) {
  _chemWiz.search = val;
  var cat = document.getElementById('chem-wiz-catalog');
  if (cat) cat.innerHTML = _chemWizCatalogHtml();
}
function _chemWizRefreshPanes() {
  var cat = document.getElementById('chem-wiz-catalog');
  if (cat) cat.innerHTML = _chemWizCatalogHtml();
  var sel = document.getElementById('chem-wiz-selected');
  if (sel) sel.innerHTML = _chemWizSelectedHtml();
  var cnt = document.getElementById('chem-wiz-sel-count');
  if (cnt) cnt.textContent = _chemWiz.selected.length;
}

function _chemWizNotify(msg, type) {
  if (typeof Toast !== 'undefined') Toast.show(msg, type);
  else alert(msg);
}

async function chemWizSaveTemplate() {
  var btn = document.querySelector('.chem-modal-footer .chem-btn-prim');
  var lab = (document.getElementById('chem-wiz-lab').value || '').trim();
  var name = (document.getElementById('chem-wiz-name').value || '').trim();
  var baseType = document.getElementById('chem-wiz-basetype').value || 'sha';
  if (!lab)  { _chemWizNotify('Укажите лабораторию', 'error'); return; }
  if (!name) { _chemWizNotify('Укажите название шаблона', 'error'); return; }
  if (!_chemWiz.selected.length) { _chemWizNotify('Выберите хотя бы один параметр', 'error'); return; }

  var row = {
    lab_name:      lab,
    template_name: name,
    base_type:     baseType,
    params:        _chemWiz.selected,
    updated_at:    new Date().toISOString(),
  };
  if (_chemWiz.editingId) row.id = _chemWiz.editingId;

  if (btn) { btn.disabled = true; btn.textContent = 'Сохранение…'; }
  var res;
  try {
    res = await ChemApi.upsertLabTemplate(row);
  } catch (ex) {
    _chemWizNotify('Ошибка сохранения шаблона: ' + ex.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Сохранить шаблон'; }
    return;
  }
  if (res.error) {
    var msg = res.error.message || '';
    if (/duplicate key|unique/i.test(msg)) {
      _chemWizNotify('У этой лаборатории уже есть шаблон с таким названием — выберите другое.', 'error');
    } else if (/row-level security/i.test(msg)) {
      _chemWizNotify('Нет прав на запись в таблицу шаблонов (RLS). Выполните миграцию migrations/chem_lab_templates.sql целиком (включая политики доступа внизу файла) в Supabase SQL Editor.', 'error');
    } else {
      _chemWizNotify('Ошибка сохранения шаблона: ' + msg, 'error');
    }
    if (btn) { btn.disabled = false; btn.textContent = '💾 Сохранить шаблон'; }
    return;
  }
  var saved = res.data;
  var existsIdx = ChemState.labTemplates.findIndex(function(t) { return t.id === saved.id; });
  if (existsIdx >= 0) ChemState.labTemplates[existsIdx] = saved;
  else ChemState.labTemplates.push(saved);

  _chemWiz.screen = 'list';
  _chemWizRender();
  _chemWizNotify('Шаблон «' + saved.template_name + '» сохранён', 'success');
}

// ═══════════════════════════════════════════════════════════════
//  ФОРМЫ: ПРОТОКОЛ (ручной ввод)
// ═══════════════════════════════════════════════════════════════
var _chemFormGroup = 'organo';
var _chemFormExistingResults = [];
var _chemFormClearScan = false; // пользователь нажал "Удалить скан"

function _chemScanExistingHtml(proto) {
  _chemFormClearScan = false;
  if (!proto || !proto.scan_url) return '';
  return '<div style="display:flex;align-items:center;gap:8px;font-size:12px">' +
    '<a href="' + escHTML(proto.scan_url) + '" target="_blank" rel="noopener" style="color:var(--blue)">📎 ' + escHTML(proto.scan_name || 'Открыть скан') + '</a>' +
    '<button type="button" class="chem-btn chem-btn-ghost" style="padding:2px 8px;font-size:11px" onclick="chemClearScan(this)">🗑 Удалить</button>' +
  '</div>';
}
function chemClearScan(btn) {
  _chemFormClearScan = true;
  var wrap = document.getElementById('pf-scan-existing');
  if (wrap) wrap.innerHTML = '<span style="font-size:11px;color:var(--txt-3)">Скан будет удалён при сохранении</span>';
}

function showChemProtocolForm(protocolId) {
  _chemFormGroup = 'organo';
  var proto = protocolId ? ChemState.protocols.find(function(p){ return p.id === protocolId; }) : null;
  var existingResults = proto ? (ChemState.results[protocolId] || []) : [];
  _chemFormExistingResults = existingResults;

  var wpOpts = '<option value="">— Выберите водопункт —</option>' + ChemState.waterPoints.map(function(w) {
    return '<option value="' + w.id + '"' + (proto && proto.water_point_id === w.id ? ' selected' : '') + '>' + escHTML(w.name) + '</option>';
  }).join('');

  var today = new Date().toISOString().slice(0,10);
  var initLab = proto ? (proto.lab_name || '') : '';
  var initTemplateId = proto ? (proto.template_id || '') : '';

  // Шапка протокола
  var initQuarter = proto ? chemQuarterOf(proto) : chemQuarterFromDate(today);
  var headerHtml =
    '<div class="chem-form-row chem-form-row-3">' +
      '<div class="chem-fld"><label>Водопункт *</label>' +
        '<select class="chem-inp" id="pf-wp" onchange="chemFormWpChanged()">' + wpOpts + '</select></div>' +
      '<div class="chem-fld"><label>Дата отбора проб *</label>' +
        '<input class="chem-inp" type="date" id="pf-date" value="' + (proto ? proto.sampled_at : today) + '" onchange="chemFormDateChanged()"></div>' +
      '<div class="chem-fld"><label title="Автоматически по дате отбора — при необходимости укажите вручную">Квартал</label>' +
        '<select class="chem-inp" id="pf-quarter">' +
          [1,2,3,4].map(function(q) {
            return '<option value="' + q + '"' + (initQuarter === q ? ' selected' : '') + '>' + _chemRomanQ(q) + ' кв.</option>';
          }).join('') +
        '</select></div>' +
    '</div>' +
    '<div class="chem-form-row chem-form-row-3">' +
      '<div class="chem-fld"><label>Лаборатория</label>' +
        _chemLabFieldHtml('pf-lab', initLab, 'chemFormLabChanged()', 'chemFormLabPick') +
      '</div>' +
      '<div class="chem-fld"><label>№ протокола</label>' +
        '<input class="chem-inp" id="pf-proto-num" placeholder="421/2" value="' + escHTML(proto ? (proto.lab_protocol_number||'') : '') + '"></div>' +
      '<div class="chem-fld"><label>Лаб. номер пробы</label>' +
        '<input class="chem-inp" id="pf-lab-num" placeholder="977" value="' + escHTML(proto ? (proto.lab_number||'') : '') + '"></div>' +
    '</div>' +
    '<div class="chem-form-row chem-form-row-3" style="align-items:flex-end">' +
      '<div class="chem-fld"><label>Вид протокола</label>' +
        '<select class="chem-inp" id="pf-proto-type">' +
          Object.keys(CHEM_PROTO_TYPE_META).map(function(k) {
            var m = CHEM_PROTO_TYPE_META[k];
            var sel = proto && proto.protocol_type === k ? ' selected' : (!proto && k === 'sha' ? ' selected' : '');
            return '<option value="' + k + '"' + sel + '>' + m.icon + ' ' + m.label + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<div class="chem-fld"><label>Шаблон ввода</label>' +
        '<select class="chem-inp" id="pf-template" onchange="chemFormTemplateChanged()">' + _chemTemplateOptionsHtml(initLab, initTemplateId) + '</select>' +
      '</div>' +
      '<div class="chem-fld" style="flex:0 0 auto">' +
        '<label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:12px;color:var(--txt-2);padding-bottom:6px;user-select:none">' +
          '<input type="checkbox" id="pf-is-control" style="accent-color:#f59e0b;width:15px;height:15px;cursor:pointer"' + (proto && proto.is_control ? ' checked' : '') + '>' +
          '🔬 Контрольная проба' +
        '</label>' +
      '</div>' +
    '</div>' +
    '<div class="chem-form-row-1 chem-form-row">' +
      '<div class="chem-fld"><label>Скан-копия протокола (PDF или изображение)</label>' +
        '<input type="file" class="chem-inp" id="pf-scan-file" accept=".pdf,image/*" style="padding:6px">' +
        '<div id="pf-scan-existing" style="margin-top:6px">' + _chemScanExistingHtml(proto) + '</div>' +
      '</div>' +
    '</div>' +

    '<div style="border-top:1px solid var(--line);margin:16px -20px;padding:16px 20px 0" id="chem-results-section">' +
      _chemResultsSectionHtml(existingResults, initTemplateId || null) +
    '</div>';

  _chemOpenModal(
    (proto ? 'Редактировать протокол' : 'Новый протокол') + (proto && proto.lab_protocol_number ? ' №' + proto.lab_protocol_number : ''),
    headerHtml,
    '<button class="chem-btn chem-btn-ghost" onclick="_chemCloseModal()">Отмена</button>' +
    '<button class="chem-btn chem-btn-prim" onclick="_chemSaveProtocol(\'' + (proto ? proto.id : '') + '\')">Сохранить протокол</button>',
    'max-width:860px'
  );
  _chemUpdateIonBalance();
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

// ── Шаблон ввода: подстановка списка/порядка полей результатов ──
function _chemTemplateOptionsHtml(labName, selectedId) {
  var opts = '<option value="">— Полный каталог (все параметры) —</option>';
  var lab = (labName || '').trim().toLowerCase();
  var matches = lab ? ChemState.labTemplates.filter(function(t) { return (t.lab_name || '').trim().toLowerCase() === lab; }) : [];
  matches.forEach(function(t) {
    opts += '<option value="' + t.id + '"' + (t.id === selectedId ? ' selected' : '') + '>' + escHTML(t.template_name) + ' (' + (t.params||[]).length + ')</option>';
  });
  return opts;
}

// Квартал подставляется по дате отбора — пользователь может после этого
// переставить его вручную в самом селекте (последнее изменение побеждает).
function chemFormDateChanged() {
  var dateInp = document.getElementById('pf-date');
  var qSel    = document.getElementById('pf-quarter');
  if (!dateInp || !qSel) return;
  var q = chemQuarterFromDate(dateInp.value);
  if (q) qSel.value = q;
}

function chemFormLabChanged() {
  var labInp = document.getElementById('pf-lab');
  var sel = document.getElementById('pf-template');
  if (!labInp || !sel) return;
  sel.innerHTML = _chemTemplateOptionsHtml(labInp.value, null);
  chemFormTemplateChanged();
}

// CHEM-04: если у выбранного водопункта задан шаблон лаборатории по
// умолчанию — подставляем лабораторию и шаблон автоматически (только
// пока поле "Лаборатория" пустое, чтобы не затирать то, что уже ввели).
function chemFormWpChanged() {
  var wpId = document.getElementById('pf-wp').value;
  var wp = ChemState.waterPoints.find(function(w) { return w.id === wpId; });
  var labInp = document.getElementById('pf-lab');
  if (!wp || !wp.default_template_id || !labInp || labInp.value.trim()) return;
  var tpl = ChemState.labTemplates.find(function(t) { return t.id === wp.default_template_id; });
  if (!tpl) return;
  labInp.value = tpl.lab_name;
  chemFormLabChanged();
  var tplSel = document.getElementById('pf-template');
  if (tplSel) { tplSel.value = tpl.id; chemFormTemplateChanged(); }
}

function chemFormTemplateChanged() {
  var sel = document.getElementById('pf-template');
  var section = document.getElementById('chem-results-section');
  if (!section) return;
  section.innerHTML = _chemResultsSectionHtml(_chemFormExistingResults, sel ? (sel.value || null) : null);
  _chemUpdateIonBalance();
}

function _chemResultsSectionHtml(existingResults, templateId) {
  var tpl = templateId ? ChemState.labTemplates.find(function(t) { return t.id === templateId; }) : null;

  if (tpl) {
    return '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-3);margin-bottom:10px">' +
        'Результаты анализа — шаблон «' + escHTML(tpl.lab_name) + ' / ' + escHTML(tpl.template_name) + '» (' + (tpl.params||[]).length + ' показателей)' +
      '</div>' +
      '<div id="chem-ion-balance"></div>' +
      _chemTemplateParamList(tpl, existingResults);
  }

  _chemFormGroup = 'organo';
  return '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-3);margin-bottom:10px">Результаты анализа — полный каталог</div>' +
    '<div id="chem-ion-balance"></div>' +
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
    '<div id="chem-param-grid-wrap">' +
      Object.keys(CHEM_GROUPS).map(function(g) {
        return '<div id="chem-grp-' + g + '" style="display:' + (g === _chemFormGroup ? 'block' : 'none') + '">' +
          _chemParamGrid(g, existingResults) +
        '</div>';
      }).join('') +
    '</div>';
}

function _chemTemplateParamList(tpl, existingResults) {
  var html = '<div class="chem-param-grid">';
  (tpl.params || []).forEach(function(key) {
    var p = CHEM_PARAM_MAP[key];
    if (!p) return; // параметр мог быть удалён из каталога — пропускаем
    var existing = existingResults.find(function(r){ return r.param_key === key; });
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
  if (!val) { inp.classList.remove('exceed'); _chemUpdateTabCounters(); _chemUpdateIonBalance(); return; }
  var parsed = _chemParseValue(val);
  var status = parsed ? _chemPdkStatus(key, val, parsed.below) : 'no_norm';
  inp.classList.toggle('exceed', status === 'exceed');
  _chemUpdateTabCounters();
  _chemUpdateIonBalance();
}

// ── Баланс ионов (контроль качества химического анализа) ────────
// Стандартная проверка: (Σкатионы − Σанионы) / (Σкатионы + Σанионы) × 100%,
// суммы в мг-экв/л. Норма — обычно в пределах ±5%; больше — вероятная
// ошибка ввода/анализа (перепутанные единицы, опечатка и т.п.).
var CHEM_ION_BALANCE_KEYS = ['ca', 'mg', 'na', 'k', 'hco3', 'co3', 'so4', 'cl'];
function _chemLiveIonSums() {
  var catSum = 0, anSum = 0;
  CHEM_ION_BALANCE_KEYS.forEach(function(key) {
    var inp = document.getElementById('pr-' + key);
    if (!inp) return;
    var raw = inp.value.trim();
    if (!raw) return;
    var parsed = _chemParseValue(raw);
    if (!parsed || parsed.below || parsed.above || !(_CHEM_EW[key] > 0)) return;
    var meq = parsed.num / _CHEM_EW[key];
    if (key === 'ca' || key === 'mg' || key === 'na' || key === 'k') catSum += meq;
    else anSum += meq;
  });
  return { catSum: catSum, anSum: anSum };
}
function _chemUpdateIonBalance() {
  var el = document.getElementById('chem-ion-balance');
  if (!el) return;
  var s = _chemLiveIonSums();
  if (s.catSum <= 0 || s.anSum <= 0) { el.innerHTML = ''; return; }
  var err = (s.catSum - s.anSum) / (s.catSum + s.anSum) * 100;
  var bad = Math.abs(err) > 5;
  el.innerHTML = '<div class="chem-ion-balance-badge' + (bad ? ' bad' : ' ok') + '">' +
    (bad ? '⚠' : '✓') + ' Баланс ионов: ' + (err > 0 ? '+' : '') + err.toFixed(1) + '%' +
    (bad ? ' — проверьте ввод (норма ±5%)' : ' (норма ±5%)') +
  '</div>';
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

// Сравнивает введённые (ещё не сохранённые) значения с последними пробами
// того же водопункта — резкий скачок (в 3+ раза) обычно означает опечатку
// или перепутанные единицы, а не реальное изменение химсостава.
async function _chemDetectAnomalies(wpId, draftResults, existingId) {
  var history = ChemState.protocols
    .filter(function(p) { return p.water_point_id === wpId && p.id !== existingId; })
    .sort(function(a, b) { return (b.sampled_at || '').localeCompare(a.sampled_at || ''); })
    .slice(0, 5);
  if (!history.length) return [];

  var needIds = history.filter(function(p) { return !ChemState.results[p.id]; }).map(function(p) { return p.id; });
  if (needIds.length) {
    var resArr = await Promise.all(needIds.map(function(id) { return ChemApi.getResults(id); }));
    resArr.forEach(function(res, i) { ChemState.results[needIds[i]] = (!res.error && res.data) ? res.data : []; });
  }

  var anomalies = [];
  draftResults.forEach(function(row) {
    if (row.value_num == null || row.value_num <= 0) return; // "<порог" / ">диапазон" — не с чем сравнивать
    var param = CHEM_PARAM_MAP[row.param_key];
    if (!param) return;
    for (var i = 0; i < history.length; i++) {
      var hRows = ChemState.results[history[i].id] || [];
      var hRow = hRows.find(function(r) { return r.param_key === row.param_key; });
      if (hRow && hRow.value_num != null && hRow.value_num > 0) {
        var ratio = row.value_num / hRow.value_num;
        if (ratio >= 3 || ratio <= 1 / 3) {
          anomalies.push({
            name: param.name, unit: param.unit,
            prev: hRow.value_num, prevDate: history[i].sampled_at, next: row.value_num,
          });
        }
        break; // сравниваем с ближайшей предыдущей пробой, где этот показатель вообще измерялся
      }
    }
  });
  return anomalies;
}

// ── CHEM-08: журнал изменений протокола ──────────────────────────
var CHEM_HISTORY_FIELDS = [
  { key: 'water_point_id',      label: 'Водопункт',          fmt: function(v) { var w = ChemState.waterPoints.find(function(x){ return x.id === v; }); return w ? w.name : (v || '—'); } },
  { key: 'sampled_at',          label: 'Дата отбора' },
  { key: 'lab_name',            label: 'Лаборатория' },
  { key: 'lab_protocol_number', label: '№ протокола' },
  { key: 'lab_number',          label: 'Лаб. номер пробы' },
  { key: 'protocol_type',       label: 'Вид протокола',      fmt: function(v) { var m = CHEM_PROTO_TYPE_META[v]; return m ? m.label : (v || '—'); } },
  { key: 'is_control',          label: 'Контрольная проба',  fmt: function(v) { return v ? 'да' : 'нет'; } },
];
function _chemBuildProtoDiff(oldRow, newRow) {
  var out = [];
  CHEM_HISTORY_FIELDS.forEach(function(f) {
    var ov = oldRow ? (oldRow[f.key] == null ? null : oldRow[f.key]) : null;
    var nv = newRow[f.key] == null ? null : newRow[f.key];
    if (String(ov) === String(nv)) return;
    out.push({
      field: f.key, label: f.label,
      old: f.fmt ? f.fmt(ov) : (ov == null ? '—' : String(ov)),
      new: f.fmt ? f.fmt(nv) : (nv == null ? '—' : String(nv)),
    });
  });
  return out;
}
function _chemCountResultChanges(oldResults, newResults) {
  var oldMap = {}; (oldResults || []).forEach(function(r) { oldMap[r.param_key] = r.value_raw || ''; });
  var newMap = {}; (newResults || []).forEach(function(r) { newMap[r.param_key] = r.value_raw || ''; });
  var allKeys = {};
  Object.keys(oldMap).forEach(function(k) { allKeys[k] = true; });
  Object.keys(newMap).forEach(function(k) { allKeys[k] = true; });
  var changed = 0;
  Object.keys(allKeys).forEach(function(k) { if ((oldMap[k] || '') !== (newMap[k] || '')) changed++; });
  return changed;
}

async function _chemSaveProtocol(existingId) {
  var wpId  = document.getElementById('pf-wp').value;
  var date  = document.getElementById('pf-date').value;
  if (!wpId)  { alert('Выберите водопункт'); return; }
  if (!date)  { alert('Введите дату отбора проб'); return; }

  // Черновик результатов из формы — нужен и для сохранения, и для проверки
  // на аномалии (последняя выполняется до записи в базу).
  var draftResults = [];
  CHEM_PARAMS.forEach(function(p) {
    var inp = document.getElementById('pr-' + p.key);
    if (!inp) return;
    var raw = inp.value.trim();
    if (!raw) return;
    var parsed = _chemParseValue(raw);
    draftResults.push({
      param_key:       p.key,
      value_raw:       raw,
      value_num:       parsed && !parsed.below && !parsed.above ? parsed.num : null,
      below_detection: parsed ? parsed.below : false,
      above_range:     parsed ? parsed.above : false,
    });
  });

  var anomalies = await _chemDetectAnomalies(wpId, draftResults, existingId);
  if (anomalies.length) {
    var msg = 'Резкое отклонение от предыдущих проб этого водопункта:\n\n' +
      anomalies.map(function(a) {
        return '• ' + a.name + ': было ' + a.prev + ' ' + a.unit + ' (' + (a.prevDate || '—') + ') → стало ' + a.next + ' ' + a.unit;
      }).join('\n') +
      '\n\nЭто может быть реальное изменение состава, а может — опечатка или перепутанные единицы измерения.\n\nСохранить как есть?';
    if (!confirm(msg)) return;
  }

  var oldProto = existingId ? ChemState.protocols.find(function(p) { return p.id === existingId; }) : null;

  var protoRow = {
    water_point_id:      wpId,
    sampled_at:          date,
    lab_name:            document.getElementById('pf-lab').value.trim() || null,
    lab_protocol_number: document.getElementById('pf-proto-num').value.trim() || null,
    lab_number:          document.getElementById('pf-lab-num').value.trim() || null,
    protocol_type:       document.getElementById('pf-proto-type').value || 'sha',
    is_control:          document.getElementById('pf-is-control') ? document.getElementById('pf-is-control').checked : false,
    source:              'manual',
    template_id:         (document.getElementById('pf-template') && document.getElementById('pf-template').value) || null,
    quarter:             (document.getElementById('pf-quarter') && parseInt(document.getElementById('pf-quarter').value, 10)) || chemQuarterFromDate(date),
  };
  if (existingId) protoRow.id = existingId;

  var pRes = await ChemApi.upsertProtocol(protoRow);
  if (pRes.error && /template_id/i.test(pRes.error.message || '')) {
    // Колонка template_id ещё не создана в базе (миграция chem_lab_templates.sql не выполнена) —
    // сохраняем протокол без неё, чтобы это не блокировало обычную работу.
    delete protoRow.template_id;
    pRes = await ChemApi.upsertProtocol(protoRow);
  }
  if (pRes.error && /quarter/i.test(pRes.error.message || '')) {
    // Колонка quarter ещё не создана в базе (миграция chem_protocol_quarter.sql не выполнена) —
    // сохраняем протокол без неё, чтобы это не блокировало обычную работу.
    delete protoRow.quarter;
    pRes = await ChemApi.upsertProtocol(protoRow);
  }
  if (pRes.error) { alert('Ошибка сохранения протокола: ' + pRes.error.message); return; }
  var savedProto = pRes.data;

  // draftResults уже собран выше (для проверки аномалий) — просто добавляем protocol_id
  var resultRows = draftResults.map(function(r) {
    return {
      protocol_id:     savedProto.id,
      param_key:       r.param_key,
      value_raw:       r.value_raw,
      value_num:       r.value_num,
      below_detection: r.below_detection,
      above_range:     r.above_range,
    };
  });

  if (resultRows.length) {
    // Сначала чистим старые результаты если редактируем
    if (existingId) await ChemApi.deleteResults(existingId);
    var rRes = await ChemApi.upsertResults(resultRows);
    if (rRes.error) console.warn('[chem] results save error', rRes.error);
  }

  // CHEM-07: скан-копия протокола — загружаем/удаляем после того, как известен ID протокола
  var scanFileInp = document.getElementById('pf-scan-file');
  var scanFile = scanFileInp && scanFileInp.files ? scanFileInp.files[0] : null;
  if (scanFile) {
    var upRes = await ChemApi.uploadProtocolScan(savedProto.id, scanFile);
    if (upRes.error) {
      if (typeof Toast !== 'undefined') Toast.show('Протокол сохранён, но скан загрузить не удалось: ' + upRes.error.message, 'error');
    } else {
      var scanUpd = await ChemApi.upsertProtocol({ id: savedProto.id, scan_url: upRes.data.url, scan_name: upRes.data.name });
      if (scanUpd.error && /scan_url|scan_name/i.test(scanUpd.error.message || '')) {
        if (typeof Toast !== 'undefined') Toast.show('Файл загружен, но для сохранения ссылки выполните миграцию migrations/chem_protocol_scan.sql', 'error');
      } else if (!scanUpd.error) {
        savedProto.scan_url = upRes.data.url; savedProto.scan_name = upRes.data.name;
      }
    }
  } else if (_chemFormClearScan) {
    var clrRes = await ChemApi.upsertProtocol({ id: savedProto.id, scan_url: null, scan_name: null });
    if (!clrRes.error) { savedProto.scan_url = null; savedProto.scan_name = null; }
  }

  // Обновляем локальное состояние
  if (existingId) {
    ChemState.protocols = ChemState.protocols.map(function(p){ return p.id === existingId ? savedProto : p; });
  } else {
    ChemState.protocols.unshift(savedProto);
  }
  ChemState.results[savedProto.id] = resultRows;

  // CHEM-08: журнал изменений — при правке логируем только реально
  // изменившиеся поля, при создании фиксируем сам факт создания.
  var histChanges = existingId ? _chemBuildProtoDiff(oldProto, protoRow) : [];
  var resultChangeCount = existingId ? _chemCountResultChanges(_chemFormExistingResults, draftResults) : 0;
  if (resultChangeCount > 0) {
    histChanges.push({ field: 'results', label: 'Результаты анализа', old: '', new: 'изменено значений: ' + resultChangeCount });
  }
  if (!existingId || histChanges.length) {
    var whoName = (typeof AppState !== 'undefined' && AppState.currentUser)
      ? (AppState.currentUser.displayName || AppState.currentUser.email || null) : null;
    ChemApi.addProtocolHistory({
      protocol_id: savedProto.id,
      changed_by:  whoName,
      action:      existingId ? 'updated' : 'created',
      changes:     histChanges,
    }).catch(function() {}); // таблица могла быть ещё не создана — не блокируем сохранение протокола
  }

  var exceeded = resultRows.filter(function(r) {
    return _chemPdkStatus(r.param_key, r.value_raw, r.below_detection) === 'exceed';
  }).map(function(r) { var p = CHEM_PARAM_MAP[r.param_key]; return p ? p.name : r.param_key; });

  _chemCloseModal();
  _chemRenderSection('protocols');
  if (typeof Toast !== 'undefined') {
    Toast.done('msg', 'Протокол сохранён');
    if (exceeded.length) {
      Toast.show('⚠ Превышение ПДК (' + exceeded.length + '): ' + exceeded.join(', '), 'warning');
    }
  }
}

// CHEM-05: открывает форму НОВОГО протокола с тем же водопунктом, лабораторией
// и шаблоном ввода, что у протокола-источника — дата и результаты остаются
// пустыми (это следующая по времени проба, а не копия старых значений).
function chemDuplicateProtocol(sourceId) {
  var proto = ChemState.protocols.find(function(p) { return p.id === sourceId; });
  if (!proto) return;

  showChemProtocolForm();

  var wpSel = document.getElementById('pf-wp');
  if (wpSel) wpSel.value = proto.water_point_id || '';

  var typeSel = document.getElementById('pf-proto-type');
  if (typeSel) typeSel.value = proto.protocol_type || 'sha';

  var labInp = document.getElementById('pf-lab');
  if (labInp && proto.lab_name) {
    labInp.value = proto.lab_name;
    chemFormLabChanged();
    if (proto.template_id) {
      var tplSel = document.getElementById('pf-template');
      if (tplSel) { tplSel.value = proto.template_id; chemFormTemplateChanged(); }
    }
  }
  if (typeof Toast !== 'undefined') Toast.show('Скважина и лаборатория подставлены — укажите дату и результаты новой пробы', 'info');
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
//  CHEM-09: ОТЧЁТ ПО ПРЕВЫШЕНИЯМ ПДК ЗА ПЕРИОД
// ═══════════════════════════════════════════════════════════════
function showChemExceedanceReport() {
  var now = new Date();
  var yearStart = now.getFullYear() + '-01-01';
  var todayStr = now.toISOString().slice(0, 10);

  _chemOpenModal(
    '📊 Отчёт по превышениям ПДК',
    '<div style="font-size:12px;color:var(--txt-3);margin-bottom:14px;line-height:1.5">' +
      'Таблица всех результатов, превышающих ПДК (питьевая), по всем водопунктам за выбранный период — в формате, готовом к отправке в контролирующие органы.' +
    '</div>' +
    '<div class="chem-form-row">' +
      '<div class="chem-fld"><label>С даты</label><input class="chem-inp" type="date" id="rep-from" value="' + yearStart + '"></div>' +
      '<div class="chem-fld"><label>По дату</label><input class="chem-inp" type="date" id="rep-to" value="' + todayStr + '"></div>' +
    '</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:2px">' +
      '<button class="chem-btn chem-btn-ghost" style="font-size:11px" onclick="chemReportQuickRange(\'quarter\')">Текущий квартал</button>' +
      '<button class="chem-btn chem-btn-ghost" style="font-size:11px" onclick="chemReportQuickRange(\'prevQuarter\')">Прошлый квартал</button>' +
      '<button class="chem-btn chem-btn-ghost" style="font-size:11px" onclick="chemReportQuickRange(\'year\')">Текущий год</button>' +
    '</div>',
    '<button class="chem-btn chem-btn-ghost" onclick="_chemCloseModal()">Отмена</button>' +
    '<button class="chem-btn chem-btn-prim" onclick="chemDownloadExceedanceReport()">⬇ Скачать Excel</button>'
  );
}

function chemReportQuickRange(kind) {
  var now = new Date();
  var y = now.getFullYear();
  var from, to;
  if (kind === 'year') {
    from = y + '-01-01';
    to = now.toISOString().slice(0, 10);
  } else if (kind === 'quarter') {
    var q = Math.floor(now.getMonth() / 3);
    from = y + '-' + String(q * 3 + 1).padStart(2, '0') + '-01';
    to = now.toISOString().slice(0, 10);
  } else if (kind === 'prevQuarter') {
    var qq = Math.floor(now.getMonth() / 3) - 1;
    if (qq < 0) { qq = 3; y -= 1; }
    var startMonth = qq * 3 + 1;
    var endMonth = startMonth + 2;
    var lastDay = new Date(y, endMonth, 0).getDate();
    from = y + '-' + String(startMonth).padStart(2, '0') + '-01';
    to = y + '-' + String(endMonth).padStart(2, '0') + '-' + String(lastDay).padStart(2, '0');
  }
  var fromInp = document.getElementById('rep-from'), toInp = document.getElementById('rep-to');
  if (fromInp) fromInp.value = from;
  if (toInp) toInp.value = to;
}

// Собирает все превышения ПДК среди протоколов с датой отбора в [fromDate, toDate].
async function _chemCollectExceedances(fromDate, toDate) {
  var protos = ChemState.protocols.filter(function(p) {
    return p.sampled_at && p.sampled_at >= fromDate && p.sampled_at <= toDate;
  });
  var needIds = protos.filter(function(p) { return !ChemState.results[p.id]; }).map(function(p) { return p.id; });
  if (needIds.length) {
    var resArr = await Promise.all(needIds.map(function(id) { return ChemApi.getResults(id); }));
    resArr.forEach(function(res, i) { ChemState.results[needIds[i]] = (!res.error && res.data) ? res.data : []; });
  }

  var rows = [];
  protos.forEach(function(p) {
    var wp = ChemState.waterPoints.find(function(w) { return w.id === p.water_point_id; });
    var results = ChemState.results[p.id] || [];
    results.forEach(function(r) {
      if (_chemPdkStatus(r.param_key, r.value_raw, r.below_detection) !== 'exceed') return;
      var param = CHEM_PARAM_MAP[r.param_key];
      if (!param) return;
      var ratio = '';
      var numVal = parseFloat(String(r.value_raw).replace(',', '.').replace(/^[<>]/, ''));
      if (param.pdk_type === 'max' && param.pdk_drink) ratio = (numVal / param.pdk_drink).toFixed(1) + '×';
      else if (param.pdk_type === 'min') ratio = 'ниже нормы';
      else if (param.pdk_type === 'range') ratio = 'вне диапазона';
      rows.push({
        date: p.sampled_at,
        wpName: wp ? wp.name : '—', wpCode: wp ? (wp.code || '') : '',
        lab: p.lab_name || '', protoNum: p.lab_protocol_number || '',
        paramName: param.name, unit: param.unit, value: r.value_raw,
        pdk: _chemPdkStr(param), ratio: ratio,
      });
    });
  });
  rows.sort(function(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return rows;
}

async function chemDownloadExceedanceReport() {
  var from = document.getElementById('rep-from').value;
  var to = document.getElementById('rep-to').value;
  if (!from || !to) { alert('Укажите период'); return; }
  if (typeof XLSX === 'undefined') { alert('Библиотека SheetJS не загружена. Проверьте соединение.'); return; }

  var rows = await _chemCollectExceedances(from, to);
  if (!rows.length) {
    if (typeof Toast !== 'undefined') Toast.show('За выбранный период превышений ПДК не найдено', 'info');
    return;
  }

  var header = ['Дата отбора', 'Водопункт', 'Код', 'Лаборатория', '№ протокола', 'Показатель', 'Значение', 'Ед. изм.', 'ПДК (питьевая)', 'Превышение'];
  var aoa = [
    ['Отчёт по превышениям ПДК за период ' + _chemFmtDate(from) + ' — ' + _chemFmtDate(to)],
    ['Сформировано: ' + _chemFmtDate(new Date().toISOString().slice(0,10)) + ' · записей: ' + rows.length],
    [],
    header,
  ].concat(rows.map(function(r) {
    return [_chemFmtDate(r.date), r.wpName, r.wpCode, r.lab, r.protoNum, r.paramName, r.value, r.unit, r.pdk, r.ratio];
  }));

  var wb = XLSX.utils.book_new();
  var ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 26 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 4, topLeftCell: 'A5', activePane: 'bottomLeft', state: 'frozen' };
  XLSX.utils.book_append_sheet(wb, ws, 'Превышения ПДК');

  var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  var blob = new Blob([wbOut], { type: 'application/octet-stream' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'exceedance_report_' + from + '_' + to + '.xlsx';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);

  _chemCloseModal();
  if (typeof Toast !== 'undefined') {
    var n = rows.length;
    Toast.show('Отчёт сформирован: ' + n + (n % 10 === 1 && n % 100 !== 11 ? ' превышение' : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? ' превышения' : ' превышений')), 'success');
  }
}

// ═══════════════════════════════════════════════════════════════
//  ИМПОРТ EXCEL
// ═══════════════════════════════════════════════════════════════
function showChemExcelImport() {
  var typeOpts = Object.keys(CHEM_TEMPLATE_TYPES).map(function(k) {
    var t = CHEM_TEMPLATE_TYPES[k];
    return '<option value="' + k + '">' + t.icon + ' ' + t.label + ' — ' + t.desc + '</option>';
  }).join('');
  var labTplOpts = ChemState.labTemplates.map(function(t) {
    return '<option value="tpl:' + t.id + '">🧪 ' + escHTML(t.lab_name) + ' — ' + escHTML(t.template_name) + ' (' + (t.params||[]).length + ')</option>';
  }).join('');
  var tplSelectHtml = '<select id="chem-tpl-type" class="chem-inp">' +
    '<optgroup label="Базовые типы">' + typeOpts + '</optgroup>' +
    (labTplOpts ? '<optgroup label="Шаблоны лабораторий">' + labTplOpts + '</optgroup>' : '') +
    '</select>';

  _chemOpenModal(
    'Шаблоны и импорт протоколов',
    // ── Секция скачивания шаблона ──────────────────────────────
    '<div style="margin-bottom:20px">' +
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--txt-3);margin-bottom:10px">① Скачать шаблон Excel</div>' +
      '<div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end">' +
        '<div class="chem-fld" style="margin:0">' +
          '<label style="font-size:11px;color:var(--txt-3);font-weight:600;text-transform:uppercase;letter-spacing:.04em;display:block;margin-bottom:4px">Тип протокола / шаблон лаборатории</label>' +
          tplSelectHtml +
        '</div>' +
        '<button class="chem-btn chem-btn-ghost" style="white-space:nowrap" onclick="_chemDownloadTemplate(document.getElementById(\'chem-tpl-type\').value)">⬇ Скачать .xlsx</button>' +
      '</div>' +
      '<div style="font-size:10px;color:var(--txt-3);margin-top:6px;line-height:1.5">' +
        'Шаблон содержит строку заголовков с ключами параметров, строку с единицами и нормами ПДК, и строку-пример. ' +
        'Нет нужного шаблона лаборатории? Настройте его в <a href="#" onclick="_chemCloseModal();showChemLabTemplateWizard();return false" style="color:var(--blue)">⚙️ Шаблоны лабораторий</a>.' +
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

// Разбирает значение комбинированного селектора "Тип протокола / шаблон лаборатории":
// либо ключ базового типа CHEM_TEMPLATE_TYPES (напр. "sha"), либо "tpl:<id>" шаблона лаборатории.
function _chemResolveTplSource(sourceVal) {
  if (sourceVal && sourceVal.indexOf('tpl:') === 0) {
    var tpl = ChemState.labTemplates.find(function(t) { return t.id === sourceVal.slice(4); });
    if (tpl) return { kind: 'lab', template: tpl, protoType: tpl.base_type || 'sha', templateId: tpl.id };
  }
  var typeKey = (CHEM_TEMPLATE_TYPES[sourceVal] ? sourceVal : 'sha');
  return { kind: 'base', typeKey: typeKey, protoType: typeKey, templateId: null };
}

function _chemDownloadTemplate(sourceVal) {
  var resolved = _chemResolveTplSource(sourceVal);
  var label, desc, icon, paramKeys, labExample, fileTag;

  if (resolved.kind === 'lab') {
    var tpl = resolved.template;
    label = tpl.lab_name + ' — ' + tpl.template_name;
    desc = 'Пользовательский шаблон лаборатории';
    icon = '🧪';
    paramKeys = tpl.params || [];
    labExample = tpl.lab_name;
    fileTag = 'lab_' + (tpl.lab_name + '_' + tpl.template_name).replace(/[^\wа-яёА-ЯЁ]+/gi, '_');
  } else {
    var tplType = CHEM_TEMPLATE_TYPES[resolved.typeKey] || CHEM_TEMPLATE_TYPES.sha;
    label = tplType.label; desc = tplType.desc; icon = tplType.icon;
    paramKeys = tplType.params;
    labExample = 'EcoExpert';
    fileTag = resolved.typeKey;
  }
  var params = paramKeys.map(function(k){ return CHEM_PARAM_MAP[k]; }).filter(Boolean);

  // Фиксированные колонки
  var fixedHeaders = ['Код водопункта','Наименование','Дата (ДД.ММ.ГГГГ)','№ протокола','Лаборатория','Лаб. номер пробы','Пробоотборщик','Примечание'];
  var fixedUnits   = ['','','','','','','',''];
  var fixedPdk     = ['','','','','','','',''];
  var fixedExample = ['ПН-1','Скважина ПН-1','11.06.2026','421/2',labExample,'977','Иванов И.И.',''];

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
    [icon + ' Шаблон протоколов: ' + label + ' — ' + desc],
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

  XLSX.utils.book_append_sheet(wb, ws, label.substring(0,31));

  var wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  var blob = new Blob([wbOut], { type: 'application/octet-stream' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'chem_template_' + fileTag + '.xlsx';
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
    var resolved = _chemResolveTplSource(tplTypeKey);
    _chemImportCache = { headers: headers, dataRows: dataRows, protoType: resolved.protoType, templateId: resolved.templateId };

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
              escHTML(u.name || u.code) + '</span>';
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
    var result = await _chemImportRows(_chemImportCache.headers, _chemImportCache.dataRows, _chemImportCache.protoType, _chemImportCache.templateId);
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
   rows — массив массивов ячеек. protoType — ключ вида протокола (sha, radio, cn, micro, radio_full).
   templateId — id шаблона лаборатории (chem_lab_templates), если файл скачан по такому шаблону. */
async function _chemImportRows(headers, rows, protoType, templateId) {
  var imported = 0, errors = 0, skipped = 0;
  var resolvedProtoType = (protoType && CHEM_PROTO_TYPE_META[protoType]) ? protoType : 'sha';
  var templateColumnMissing = false;
  var quarterColumnMissing = false;

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
      template_id:         (templateId && !templateColumnMissing) ? templateId : null,
      quarter:             quarterColumnMissing ? undefined : chemQuarterFromDate(isoDate),
    };
    if (protoRow.quarter === undefined) delete protoRow.quarter;
    var pRes = await ChemApi.upsertProtocol(protoRow);
    if (pRes.error && /template_id/i.test(pRes.error.message || '')) {
      // Колонка template_id ещё не создана в базе — не блокируем импорт остальных строк
      templateColumnMissing = true;
      delete protoRow.template_id;
      pRes = await ChemApi.upsertProtocol(protoRow);
    }
    if (pRes.error && /quarter/i.test(pRes.error.message || '')) {
      // Колонка quarter ещё не создана в базе — не блокируем импорт остальных строк
      quarterColumnMissing = true;
      delete protoRow.quarter;
      pRes = await ChemApi.upsertProtocol(protoRow);
    }
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

  function _cmpProtoHeader(p, wp) {
    var lines = [];
    lines.push('<span style="font-weight:700">' + escHTML((wp ? wp.name : '?')) + '</span>');
    lines.push('<span style="font-size:11px;opacity:.8">' + _chemFmtDate(p.sampled_at) + '</span>');
    if (p.lab_protocol_number) lines.push('<span style="font-size:10px;opacity:.65">№ ' + escHTML(p.lab_protocol_number) + '</span>');
    if (p.lab_number) lines.push('<span style="font-size:10px;opacity:.65">Проба: ' + escHTML(p.lab_number) + '</span>');
    return lines.join('<br>');
  }
  var hdr1 = _cmpProtoHeader(p1, wp1);
  var hdr2 = _cmpProtoHeader(p2, wp2);

  var rows = '';
  var groupOrder = ['organo','physico','macro','metals','organic','radio'];
  // Добавляем любые нестандартные группы из данных обоих протоколов
  r1.concat(r2).forEach(function(r) {
    var param = CHEM_PARAM_MAP[r.param_key];
    if (param && groupOrder.indexOf(param.group) === -1) groupOrder.push(param.group);
  });
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
        '<th style="text-align:right;padding:8px;color:var(--blue);font-size:12px;line-height:1.5;vertical-align:top">' + hdr1 + '</th>' +
        '<th style="text-align:right;padding:8px;color:#fb923c;font-size:12px;line-height:1.5;vertical-align:top">' + hdr2 + '</th>' +
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

  var typeLabel = CHEM_WP_TYPES[wp.wp_type || wp.type] || wp.wp_type || wp.type;
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

// ═══════════════════════════════════════════════════════════════
//  ГИДРОХИМИЧЕСКИЕ ДИАГРАММЫ
// ═══════════════════════════════════════════════════════════════

// Эквивалентные массы (мг-экв/л)
var _CHEM_EW = { ca:20.04, mg:12.15, na:23.0, k:39.1, hco3:61.0, co3:30.0, so4:48.0, cl:35.45 };

function _chemCalcMeq(protocolId) {
  var rows = ChemState.results[protocolId] || [];
  var v = {};
  rows.forEach(function(r) {
    var key = r.param_key;
    if (_CHEM_EW[key] !== undefined) {
      var num = parseFloat(r.value_raw);
      if (!isNaN(num) && num >= 0) v[key] = num;
    }
  });
  // convert mg/L → meq/L
  var meq = {};
  Object.keys(v).forEach(function(k) { meq[k] = v[k] / _CHEM_EW[k]; });
  // combined fields
  meq.nak  = (meq.na  || 0) + (meq.k   || 0);
  meq.ca   = meq.ca   || 0;
  meq.mg   = meq.mg   || 0;
  meq.hco3 = meq.hco3 || 0;
  meq.so4  = meq.so4  || 0;
  meq.cl   = meq.cl   || 0;
  meq.co3  = meq.co3  || 0;
  // also store mg/L originals for Kurlov
  meq._raw = v;
  // Check if we have enough data
  var catSum = meq.ca + meq.mg + meq.nak;
  var anSum  = meq.hco3 + meq.so4 + meq.cl + meq.co3;
  meq._valid = catSum > 0 && anSum > 0;
  meq._catSum = catSum;
  meq._anSum  = anSum;
  // percent meq
  if (catSum > 0) {
    meq.ca_pct  = meq.ca  / catSum * 100;
    meq.mg_pct  = meq.mg  / catSum * 100;
    meq.nak_pct = meq.nak / catSum * 100;
  }
  if (anSum > 0) {
    meq.hco3_pct = meq.hco3 / anSum * 100;
    meq.so4_pct  = meq.so4  / anSum * 100;
    meq.cl_pct   = meq.cl   / anSum * 100;
    meq.co3_pct  = meq.co3  / anSum * 100;
  }
  // also get ph, m (TDS)
  var phRow = rows.find(function(r){ return r.param_key === 'ph_lab' || r.param_key === 'ph_field'; });
  meq.ph = phRow ? parseFloat(phRow.value_raw) : NaN;
  var tdsRow = rows.find(function(r){ return r.param_key === 'tds' || r.param_key === 'dry_res'; });
  meq.m_gl = tdsRow ? parseFloat(tdsRow.value_raw) / 1000 : NaN;
  return meq;
}

function _chemRenderProtoBody(protocolId) {
  var meq = _chemCalcMeq(protocolId);
  var hasMacro = meq._valid;
  var tblHtml = _chemRenderResultsTable(protocolId);

  var diagContent = hasMacro
    ? '<div class="chem-diag-tabs" id="chem-diag-tabs-' + protocolId + '">' +
        '<button class="chem-diag-tab active" title="Диаграмма Пайпера" onclick="chemSwitchDiag(\'' + protocolId + '\',\'piper\',this)">📐</button>' +
        '<button class="chem-diag-tab" title="Стифф · Шоллер" onclick="chemSwitchDiag(\'' + protocolId + '\',\'stiff\',this)">📊</button>' +
        '<button class="chem-diag-tab" title="Квадрат Толстихина" onclick="chemSwitchDiag(\'' + protocolId + '\',\'tolst\',this)">▦</button>' +
      '</div>' +
      '<div class="chem-diag-body">' +
        '<div class="chem-diag-pane active chem-diag-pane-piper" id="chem-dpane-' + protocolId + '-piper">' +
          '<canvas id="chem-cv-piper-' + protocolId + '" style="max-width:100%"></canvas>' +
          '<div class="chem-piper-info">' +
            '<div class="chem-piper-info-title">Тип воды по Пайперу</div>' +
            '<div class="chem-piper-info-type" id="chem-wtype-' + protocolId + '">—</div>' +
            '<div class="chem-kurlov-box" id="chem-kurlov-' + protocolId + '" style="padding:8px 0 0;text-align:left;max-width:none;line-height:2.2"></div>' +
            '<div class="chem-piper-info-hint">' +
              'ⓘ Показаны и другие пробы этого же водопункта (приглушены) — цвет точки = дата, см. легенду; кликните по любой, чтобы раскрыть её проценты. ' +
              'Треугольники слева/справа — доли катионов и анионов пробы в %мг-экв. ' +
              'Ромб в центре — итоговый гидрохимический тип воды (пересечение проекций из обоих треугольников): ' +
              'низ — Ca,Mg–HCO₃ (гидрокарбонатные кальциево-магниевые), право — Na–HCO₃, ' +
              'лево — Ca,Mg–Cl,SO₄, верх — Na–Cl,SO₄ (наиболее минерализованные воды).' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="chem-diag-pane" id="chem-dpane-' + protocolId + '-stiff">' +
          '<canvas id="chem-cv-stiff-' + protocolId + '" style="max-width:100%"></canvas>' +
          '<canvas id="chem-cv-scho-' + protocolId + '" style="max-width:100%"></canvas>' +
        '</div>' +
        '<div class="chem-diag-pane chem-diag-pane-piper" id="chem-dpane-' + protocolId + '-tolst">' +
          '<canvas id="chem-cv-tolst-' + protocolId + '" style="max-width:100%"></canvas>' +
          '<div class="chem-piper-info">' +
            '<div class="chem-piper-info-title">Квадрат Толстихина — выбранная проба</div>' +
            '<div class="chem-piper-info-type" id="chem-tolst-cell-' + protocolId + '">—</div>' +
            '<div class="chem-piper-info-hint">' +
              'ⓘ По горизонтали — доля Cl+SO₄ среди анионов (0% слева, 100% справа). По вертикали — доля Ca+Mg среди катионов ' +
              '(0% внизу = чистые Na+K, 100% вверху). Сетка 10×10 — как в оригинальной методике Толстихина/Джикия; номер ' +
              'ячейки здесь — просто её позиция (столбец-строка), точную историческую таблицу генетических классов по номерам ' +
              'проверенным источником подтвердить не удалось.' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    : '<div class="chem-no-macro">Нет данных макрокомпонентного состава для построения диаграмм</div>';

  return '<div class="chem-proto-split">' +
    '<div class="chem-proto-tbl-col">' + tblHtml + '</div>' +
    '<div class="chem-diag-col">' + diagContent + '</div>' +
  '</div>';
}

function chemSwitchDiag(protocolId, tab, btn) {
  var tabs  = document.getElementById('chem-diag-tabs-' + protocolId);
  var body  = document.querySelector('#chem-pm-body-' + protocolId + ' .chem-diag-body');
  if (!tabs || !body) return;
  tabs.querySelectorAll('.chem-diag-tab').forEach(function(b){ b.classList.remove('active'); });
  btn.classList.add('active');
  body.querySelectorAll('.chem-diag-pane').forEach(function(p){ p.classList.remove('active'); });
  var pane = document.getElementById('chem-dpane-' + protocolId + '-' + tab);
  if (pane) pane.classList.add('active');
}
window.chemSwitchDiag = chemSwitchDiag;

function _chemInitDiagrams(protocolId) {
  var meq = _chemCalcMeq(protocolId);
  if (!meq._valid) return;

  // Collect all meqs for same water point (Piper + Schoeller multi-sample)
  var proto = ChemState.protocols.find(function(p){ return p.id === protocolId; });
  var allMeqs = [];
  if (proto) {
    ChemState.protocols.filter(function(p){ return p.water_point_id === proto.water_point_id; }).forEach(function(p) {
      var m = _chemCalcMeq(p.id);
      if (m._valid) allMeqs.push({ meq: m, id: p.id, date: p.sampled_at });
    });
  }
  if (!allMeqs.length) allMeqs = [{ meq: meq, id: protocolId, date: '' }];

  // Redraws all three diagrams sized to whatever space is actually available right
  // now — returns false once the modal has been closed, so the resize listener
  // below knows to remove itself instead of drawing into detached canvases.
  function redraw() {
    var body = document.getElementById('chem-pm-body-' + protocolId);
    if (!body) return false;

    var cvP = document.getElementById('chem-cv-piper-' + protocolId);
    if (cvP) {
      var paneP = cvP.closest('.chem-diag-pane-piper');
      var piperW = _chemLayoutDiagPane(paneP, 420, 560);
      _chemDrawPiper(cvP, allMeqs, protocolId, piperW); // height is self-computed from geometry
    }

    var cvS = document.getElementById('chem-cv-stiff-' + protocolId);
    if (cvS) {
      var availS = cvS.parentElement ? cvS.parentElement.clientWidth : 500;
      _chemDrawStiff(cvS, meq, Math.max(320, availS), 220);
    }

    var cvSc = document.getElementById('chem-cv-scho-' + protocolId);
    if (cvSc) {
      var availSc = cvSc.parentElement ? cvSc.parentElement.clientWidth : 560;
      _chemDrawSchoeller(cvSc, allMeqs, protocolId, Math.max(320, availSc), 280);
    }

    var cvT = document.getElementById('chem-cv-tolst-' + protocolId);
    if (cvT) {
      var paneT = cvT.closest('.chem-diag-pane-piper');
      var tolstW = _chemLayoutDiagPane(paneT, 420, 560);
      _chemDrawTolstikhin(cvT, allMeqs, protocolId, tolstW, function(id) {
        _chemUpdateTolstCellInfo(protocolId, allMeqs, id);
      });
    }
    return true;
  }
  redraw();

  // Build Kurlov + plain-language water type
  var kurEl = document.getElementById('chem-kurlov-' + protocolId);
  if (kurEl) kurEl.innerHTML = _chemBuildKurlov(meq);
  var wtypeEl = document.getElementById('chem-wtype-' + protocolId);
  if (wtypeEl) wtypeEl.innerHTML = _chemWtypeHtml(meq);
  _chemUpdateTolstCellInfo(protocolId, allMeqs, protocolId);

  // Keep the diagrams sized correctly if the window/modal is resized while open.
  // Self-removing: once chem-pm-body-<id> is gone (modal closed), redraw() returns
  // false and we stop listening instead of leaking a handler forever.
  var _resizeTimer = null;
  function _onResize() {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function() {
      if (!redraw()) window.removeEventListener('resize', _onResize);
    }, 120);
  }
  window.addEventListener('resize', _onResize);
}

// ── Общие утилиты canvas / классификация воды ──────────────────
// Готовит canvas к отрисовке в логических (CSS) пикселях cssW×cssH, сама
// подстраиваясь под devicePixelRatio — вызывается заново при каждой
// перерисовке (в т.ч. по resize), поэтому не нужен флаг "уже отмасштабировано".
function _chemPrepCanvas(canvas, cssW, cssH) {
  var dpr = window.devicePixelRatio || 1;
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  var ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// Ионы >10%мг-экв, отсортированные по убыванию — общая логика для формулы
// Курлова и для словесного названия типа воды.
// HCO₃ и CO₃ считаются вместе одной статьёй — так же, как на самой анионной
// вершине треугольника диаграммы и в _chemClassifyWaterType (короткий
// бейдж). Раньше здесь CO₃ шёл отдельной строкой, и при заметной его доле
// словесное название могло называть преобладающим не тот анион, что бейдж
// (расхождение). При обычном для этих проб нулевом/малом CO₃ разницы не
// видно, но для гарантии считаем одинаково везде.
function _chemMeqIons(meq) {
  var anions = [
    { sym:'HCO₃', pct: (meq.hco3_pct||0) + (meq.co3_pct||0) },
    { sym:'SO₄',  pct: meq.so4_pct||0 },
    { sym:'Cl',   pct: meq.cl_pct||0 },
  ].filter(function(x){ return x.pct > 10; }).sort(function(a,b){ return b.pct-a.pct; });

  var cations = [
    { sym:'Ca',   pct: meq.ca_pct||0 },
    { sym:'Mg',   pct: meq.mg_pct||0 },
    { sym:'Na+K', pct: meq.nak_pct||0 },
  ].filter(function(x){ return x.pct > 10; }).sort(function(a,b){ return b.pct-a.pct; });

  return { anions: anions, cations: cations };
}

var _CHEM_ION_ADJ = {
  'HCO₃': { pre:'гидрокарбонатно', full:'гидрокарбонатная' },
  'SO₄':  { pre:'сульфатно',       full:'сульфатная' },
  'Cl':   { pre:'хлоридно',        full:'хлоридная' },
  'Ca':   { pre:'кальциево',       full:'кальциевая' },
  'Mg':   { pre:'магниево',        full:'магниевая' },
  'Na+K': { pre:'натриево',        full:'натриевая' },
};
// html=true оборачивает преобладающий (последний, полная форма) ион в
// <strong> — иначе связь с коротким бейджем ("Na-Cl" и т.п.) не считывается
// с первого взгляда: интуитивно кажется, что "главное" — это первое слово,
// а на деле по правилам русской номенклатуры главное — последнее.
function _chemIonPhrase(sortedDesc, html) {
  if (!sortedDesc.length) return '';
  // Название по Курлову называет ионы в порядке возрастания доли, замыкая
  // словом на полное прилагательное (последний = преобладающий).
  var asc = sortedDesc.slice().reverse();
  return asc.map(function(x, i) {
    var adj = _CHEM_ION_ADJ[x.sym];
    if (!adj) return x.sym;
    var isLast = i === asc.length - 1;
    var word = isLast ? adj.full : adj.pre + '-';
    return (html && isLast) ? '<strong>' + word + '</strong>' : word;
  }).join('');
}
function _chemWaterTypeName(meq, html) {
  var ions = _chemMeqIons(meq);
  if (!ions.anions.length && !ions.cations.length) return 'Недостаточно данных для классификации';
  var name = (_chemIonPhrase(ions.anions, html) + ' ' + _chemIonPhrase(ions.cations, html) + ' вода').replace(/\s+/g, ' ').trim();
  // Капитализируем первую видимую букву — не первый символ строки, который
  // при html=true может оказаться символом открывающего тега <strong>.
  return name.replace(/^(<strong>)?([а-яё])/i, function(_, tag, ch) { return (tag || '') + ch.toUpperCase(); });
}

// Классификация по преобладающему катиону/аниону — короткий facies-ярлык
// (Ca-HCO3, Na-Cl и т.п.), тот что виден бейджиком рядом с полным названием.
//
// Раньше требовался порог >50% на один ион — это правило американской
// системы Пайпера (USGS, "8 типов + Mixed"), где строгая планка в половину
// действительно часто даёт "Mixed" для обычной, не экстремальной воды.
// Но для тройного деления (Ca/Mg/Na и HCO3/SO4/Cl, как здесь) принятая
// в русскоязычной гидрогеологии классификация О.А. Алёкина использует
// порог 25%мг-экв — а при трёх категориях, суммирующихся в 100%, самая
// крупная из них математически ВСЕГДА ≥33%, то есть порог 25% проходит
// всегда. Поэтому здесь просто берём наибольший катион и наибольший анион
// (без искусственного барьера в 50%) — "Mixed" по факту больше не нужен:
// с реальными лабораторными числами точной ничьей не бывает.
var _CHEM_WTYPE_COLORS = {
  'Ca-HCO3': '#4a9fe8', 'Ca-SO4': '#1e3a8a', 'Ca-Cl': '#0ea5b0',
  'Mg-HCO3': '#22c55e', 'Mg-SO4': '#f97316', 'Mg-Cl': '#84cc16',
  'Na-HCO3': '#a78bfa', 'Na-SO4': '#eab308', 'Na-Cl': '#ec4899',
};
function _chemClassifyWaterType(meq) {
  var cats = [
    { sym: 'Ca', pct: meq.ca_pct||0 },
    { sym: 'Mg', pct: meq.mg_pct||0 },
    { sym: 'Na', pct: meq.nak_pct||0 },
  ];
  var ans = [
    { sym: 'HCO3', pct: (meq.hco3_pct||0) + (meq.co3_pct||0) },
    { sym: 'SO4',  pct: meq.so4_pct||0 },
    { sym: 'Cl',   pct: meq.cl_pct||0 },
  ];
  var cat = cats.reduce(function(a, b) { return b.pct > a.pct ? b : a; });
  var an  = ans.reduce(function(a, b) { return b.pct > a.pct ? b : a; });
  var key = cat.sym + '-' + an.sym;
  var label = key.replace('HCO3', 'HCO₃').replace('SO4', 'SO₄');
  return { key: key, label: label, color: _CHEM_WTYPE_COLORS[key] || '#94a3b8' };
}

// Полное название типа (словами) + короткий бейдж-классификация (Ca-HCO₃ и
// т.п.) рядом — бейдж больше не красит точки на диаграмме (это теперь дата,
// см. CHEM_DATE_COLORS), но сама классификация всё ещё полезна как краткая
// подпись, поэтому не выбрасываем, а просто переносим её сюда.
function _chemWtypeHtml(meq) {
  var wt = _chemClassifyWaterType(meq);
  // _chemWaterTypeName(meq, true) сама вставляет <strong> вокруг преобладающих
  // слов (составлена только из фиксированных, не пользовательских строк —
  // экранировать нечего, поэтому не через escHTML, как обычный текст).
  return _chemWaterTypeName(meq, true) +
    ' <span class="chem-badge" style="background:' + wt.color + '18;color:' + wt.color + '">' + wt.label + '</span>';
}

// Палитра "один цвет = один протокол/дата" — используется и точками на
// Пайпере, и линиями Шоллера, и чипами дат в "Хим. аналитике", так что один
// и тот же протокол всегда одного цвета во всех трёх местах. Цикличная —
// при очень длинной истории (>12 проб одного водопункта) цвета начнут
// повторяться, это ожидаемо и не страшно (какая проба выбрана — всегда
// видно по крупной непрозрачной точке/подписям, не только по цвету).
var CHEM_DATE_COLORS = ['#22d3ee','#f59e0b','#10b981','#f87171','#a78bfa','#fb923c',
                         '#38bdf8','#34d399','#f472b6','#fbbf24','#818cf8','#fb7185'];

// ── Общая геометрия для подписей осей ───────────────────────────
// Точка пересечения двух прямых (p1+t*d1) и (p2+s*d2).
function _chemLineIntersect(p1, d1, p2, d2) {
  var det = d1.x*d2.y - d1.y*d2.x;
  if (Math.abs(det) < 1e-9) return null;
  var t = ((p2.x-p1.x)*d2.y - (p2.y-p1.y)*d2.x) / det;
  return { x: p1.x + t*d1.x, y: p1.y + t*d1.y };
}
// Единичная нормаль к отрезку p0-p1, направленная НАРУЖУ фигуры (в сторону,
// противоположную opp) — используется, чтобы подписи процентов уходили
// наружу от треугольника/ромба, а не внутрь на сетку.
function _chemOutwardNormal(p0, p1, opp) {
  var d = { x:p1.x-p0.x, y:p1.y-p0.y };
  var n = { x:-d.y, y:d.x };
  var len = Math.hypot(n.x, n.y) || 1;
  n.x /= len; n.y /= len;
  var mid = { x:(p0.x+p1.x)/2, y:(p0.y+p1.y)/2 };
  var toOpp = { x:opp.x-mid.x, y:opp.y-mid.y };
  if (n.x*toOpp.x + n.y*toOpp.y > 0) { n.x = -n.x; n.y = -n.y; }
  return n;
}

// ── Диаграмма Пайпера ──────────────────────────────────────────
// Стиль и поведение — по образцу референса пользователя: подписи % вдоль
// каждой оси, точки раскрашены по дате протокола (см. CHEM_DATE_COLORS) с
// легендой дат, клик по точке показывает проценты по всем трём осям и
// приглушает остальные точки.
// onSelect(id) — необязательный колбэк, вызывается после клика по точке (уже
// после того, как canvas._piperSelectedId обновлён и сама диаграмма
// перерисована) — используется разделом "Хим. аналитика", чтобы синхронно
// перерисовать Стифф/Шоллер и панель деталей выбранного протокола.
function _chemDrawPiper(canvas, allMeqs, currentId, cssW, onSelect) {
  var W = cssW || 580;

  var isDark = !document.documentElement.getAttribute('data-theme') ||
               document.documentElement.getAttribute('data-theme') === 'dark';
  var COL_LINE = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
  var COL_TXT  = isDark ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.62)';
  var COL_AXIS = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
  var COL_FILL = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
  var HALO = isDark ? 'rgba(13,17,26,0.85)' : 'rgba(255,255,255,0.85)';

  // Side margin reserved for the rotated axis tick/title/value labels, which
  // hang up to ~50px past the edge — without this reserve they clip off the
  // canvas edge on narrow (resized) canvases.
  var MARGIN = 56;
  var S  = Math.max(95, Math.min(190, (W - MARGIN*2) * 0.28));   // triangle side — scales with canvas width
  var H3 = S * Math.sqrt(3) / 2;
  // Gap between the two triangles. A too-small gap here is what used to make
  // the "Na⁺+K⁺"/"HCO₃⁻" vertex labels overlap into unreadable mush.
  var GAP = Math.max(90, S * 0.55);
  var OX = W / 2; // center x

  // Canvas height is derived from the geometry itself (not guessed by the
  // caller) — the diamond now stands a full triangle-height taller than
  // before (see D_BOT below), so a fixed aspect ratio no longer fits it.
  var TOP_PAD = 30, BOTTOM_PAD = 50;
  var H = Math.round(TOP_PAD + 3*H3 + BOTTOM_PAD);
  var ctx = _chemPrepCanvas(canvas, W, H);
  ctx.clearRect(0, 0, W, H);
  var BY = H - BOTTOM_PAD; // base y

  // Left triangle (cations): Ca=BL, Mg=TOP, NaK=BR
  var LBL = { x: OX - GAP/2 - S,   y: BY };
  var LBR = { x: OX - GAP/2,        y: BY };
  var LBT = { x: OX - GAP/2 - S/2, y: BY - H3 };

  // Right triangle (anions): HCO3=BL, SO4=TOP, Cl=BR
  var RBL = { x: OX + GAP/2,        y: BY };
  var RBR = { x: OX + GAP/2 + S,    y: BY };
  var RBT = { x: OX + GAP/2 + S/2,  y: BY - H3 };

  // Diamond vertices. Its bottom two edges must run exactly parallel to the
  // two inner triangle edges they sit above (LBT→LBR and RBL→RBT) — that
  // only holds when the diamond's height (top vertex to bottom vertex) is
  // exactly TWICE the triangle height H3 (matches slope H3/(S/2) on both).
  // The whole diamond is then raised so its bottom vertex sits a further H3
  // above the triangle baseline — i.e. 50% of the diamond's own (new,
  // doubled) height — so it floats level with the triangle tops instead of
  // resting in the gap between them.
  var DH      = H3 * 2;
  var D_BOT   = { x: OX,         y: BY - H3 };
  var D_TOP   = { x: OX,         y: D_BOT.y - DH };
  var D_LEFT  = { x: OX - S/2,   y: D_BOT.y - DH/2 };
  var D_RIGHT = { x: OX + S/2,   y: D_BOT.y - DH/2 };

  function tri(v0, v1, v2) {
    ctx.beginPath(); ctx.moveTo(v0.x, v0.y); ctx.lineTo(v1.x, v1.y); ctx.lineTo(v2.x, v2.y); ctx.closePath();
  }
  function rhombus() {
    ctx.beginPath(); ctx.moveTo(D_BOT.x, D_BOT.y); ctx.lineTo(D_RIGHT.x, D_RIGHT.y);
    ctx.lineTo(D_TOP.x, D_TOP.y); ctx.lineTo(D_LEFT.x, D_LEFT.y); ctx.closePath();
  }
  function gridLines(v0, v1, v2, steps) {
    ctx.save(); ctx.strokeStyle = COL_LINE; ctx.lineWidth = 0.8;
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      ctx.beginPath();
      ctx.moveTo(v0.x*(1-t)+v1.x*t, v0.y*(1-t)+v1.y*t);
      ctx.lineTo(v0.x*(1-t)+v2.x*t, v0.y*(1-t)+v2.y*t);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(v1.x*(1-t)+v0.x*t, v1.y*(1-t)+v0.y*t);
      ctx.lineTo(v1.x*(1-t)+v2.x*t, v1.y*(1-t)+v2.y*t);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(v2.x*(1-t)+v0.x*t, v2.y*(1-t)+v0.y*t);
      ctx.lineTo(v2.x*(1-t)+v1.x*t, v2.y*(1-t)+v1.y*t);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Draw triangles + rhombus
  ctx.fillStyle = COL_FILL; ctx.strokeStyle = COL_AXIS; ctx.lineWidth = 1.2;
  tri(LBL, LBR, LBT); ctx.fill(); ctx.stroke();
  tri(RBL, RBR, RBT); ctx.fill(); ctx.stroke();
  rhombus();            ctx.fill(); ctx.stroke();

  gridLines(LBL, LBR, LBT, 5);
  gridLines(RBL, RBR, RBT, 5);

  // Diamond grid (two families of lines, parallel to each pair of edges)
  ctx.save(); ctx.strokeStyle = COL_LINE; ctx.lineWidth = 0.8;
  for (var gi = 1; gi < 5; gi++) {
    var gt = gi/5;
    var p1 = { x: D_BOT.x + gt*(D_RIGHT.x-D_BOT.x), y: D_BOT.y + gt*(D_RIGHT.y-D_BOT.y) };
    var p2 = { x: p1.x + (D_LEFT.x-D_BOT.x), y: p1.y + (D_LEFT.y-D_BOT.y) };
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    var q1 = { x: D_BOT.x + gt*(D_LEFT.x-D_BOT.x), y: D_BOT.y + gt*(D_LEFT.y-D_BOT.y) };
    var q2 = { x: q1.x + (D_RIGHT.x-D_BOT.x), y: q1.y + (D_RIGHT.y-D_BOT.y) };
    ctx.beginPath(); ctx.moveTo(q1.x, q1.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
  }
  ctx.restore();

  // ── Подписи осей: тики 20/40/60/80% + название оси, вдоль ребра, с
  // поворотом по углу ребра — так же, как в референсе пользователя.
  function drawAxisTicks(vFrom, vTo, vOpp, label) {
    var n = _chemOutwardNormal(vFrom, vTo, vOpp);
    var angle = Math.atan2(vTo.y-vFrom.y, vTo.x-vFrom.x);
    if (angle > Math.PI/2) angle -= Math.PI;
    if (angle < -Math.PI/2) angle += Math.PI;
    ctx.save(); ctx.fillStyle = COL_TXT;
    for (var pct = 20; pct <= 80; pct += 20) {
      var t = pct/100;
      var px = vFrom.x+(vTo.x-vFrom.x)*t, py = vFrom.y+(vTo.y-vFrom.y)*t;
      ctx.save();
      ctx.translate(px+n.x*9, py+n.y*9); ctx.rotate(angle);
      ctx.font = '7px Inter,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(pct+'%', 0, 0);
      ctx.restore();
    }
    var mid = { x:(vFrom.x+vTo.x)/2, y:(vFrom.y+vTo.y)/2 };
    ctx.save();
    ctx.translate(mid.x+n.x*22, mid.y+n.y*22); ctx.rotate(angle);
    ctx.font = 'bold 10px Inter,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 0);
    ctx.restore();
    ctx.restore();
  }
  // Cation triangle: Mg вдоль левого ребра (Ca→Mg), Ca вдоль нижнего (NaK→Ca),
  // Na+K вдоль правого (Mg→NaK) — направление 0%→100% выбрано так, чтобы 100%
  // каждой оси приходилось точно на её собственную вершину.
  drawAxisTicks(LBL, LBT, LBR, 'Mg');
  drawAxisTicks(LBR, LBL, LBT, 'Ca');
  drawAxisTicks(LBT, LBR, LBL, 'Na+K');
  // Anion triangle: аналогично — SO4 вдоль левого, HCO3+CO3 вдоль нижнего, Cl вдоль правого
  drawAxisTicks(RBL, RBT, RBR, 'SO₄');
  drawAxisTicks(RBR, RBL, RBT, 'HCO₃+CO₃');
  drawAxisTicks(RBT, RBR, RBL, 'Cl');
  // Ромб: Na+K вдоль нижне-правого ребра, SO₄+Cl вдоль нижне-левого
  drawAxisTicks(D_BOT, D_RIGHT, D_LEFT, 'Na+K');
  drawAxisTicks(D_BOT, D_LEFT, D_RIGHT, 'SO₄+Cl');

  // Barycentric to pixel (triangle)
  function bary(v0, v1, v2, b0, b1, b2) {
    var s = b0 + b1 + b2 || 1;
    return { x: (v0.x*b0 + v1.x*b1 + v2.x*b2)/s, y: (v0.y*b0 + v1.y*b1 + v2.y*b2)/s };
  }
  // Diamond parallelogram mapping: u=NaK_frac ∈[0,1], v=(SO4+Cl)_frac ∈[0,1]
  function diamondPt(m) {
    var u = m._catSum > 0 ? m.nak / m._catSum : 0;
    var v = m._anSum  > 0 ? (m.so4 + m.cl) / m._anSum : 0;
    return {
      x: D_BOT.x + u*(D_RIGHT.x-D_BOT.x) + v*(D_LEFT.x-D_BOT.x),
      y: D_BOT.y + u*(D_RIGHT.y-D_BOT.y) + v*(D_LEFT.y-D_BOT.y),
    };
  }

  // ── Легенда дат: один цвет = один протокол (см. CHEM_DATE_COLORS) — тот
  // же цвет у этой пробы будет и в Шоллере, и (в "Хим. аналитике") у чипа
  // даты, чтобы её было видно везде одинаково. Верхний правый угол.
  var legX = W - 8, legY = 10;
  ctx.save();
  ctx.font = 'bold 9.5px Inter,sans-serif'; ctx.fillStyle = COL_TXT; ctx.textAlign = 'right';
  ctx.fillText('Дата пробы', legX, legY);
  legY += 14;
  ctx.font = '9px Inter,sans-serif';
  allMeqs.forEach(function(item, idx) {
    var col = CHEM_DATE_COLORS[idx % CHEM_DATE_COLORS.length];
    ctx.fillStyle = COL_TXT; ctx.textAlign = 'right';
    ctx.fillText(item.date ? _chemFmtDate(item.date) : '—', legX - 10, legY);
    ctx.beginPath(); ctx.arc(legX - 3, legY - 3, 3.5, 0, Math.PI*2);
    ctx.fillStyle = col; ctx.fill();
    legY += 13;
  });
  ctx.restore();

  // ── Точки. Выбранная (клик или текущий протокол по умолчанию) — крупнее,
  // непрозрачная; остальные пробы того же водопункта — приглушены, как в
  // референсе (нужно кликнуть, чтобы разглядеть проценты именно этой точки).
  if (canvas._piperSelectedId === undefined || !allMeqs.some(function(a){ return a.id === canvas._piperSelectedId; })) {
    canvas._piperSelectedId = currentId;
  }
  var selectedId = canvas._piperSelectedId;
  var hitPoints = [];

  allMeqs.forEach(function(item, idx) {
    var m = item.meq;
    var col = CHEM_DATE_COLORS[idx % CHEM_DATE_COLORS.length];
    var isSel = item.id === selectedId;
    var r = isSel ? 6.5 : 4.5;

    var cp = bary(LBL, LBT, LBR, m.ca, m.mg, m.nak);
    var ap = bary(RBL, RBT, RBR, m.hco3, m.so4, m.cl);
    var dp = diamondPt(m);

    [cp, ap, dp].forEach(function(pt) {
      ctx.save();
      ctx.globalAlpha = isSel ? 1 : 0.32;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, r, 0, Math.PI*2);
      ctx.fillStyle = col;
      if (isSel) { ctx.shadowColor = col; ctx.shadowBlur = 9; }
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
      hitPoints.push({ x: pt.x, y: pt.y, id: item.id });
    });
  });

  // ── Проценты по трём осям для выбранной точки — пунктирная линия до её
  // "собственного" ребра (того же, что подписано тиками выше) + подпись
  // значения прямо там, как "7.7%"/"15.4%"/"76.9%" в референсе.
  var selIdx = allMeqs.findIndex(function(a){ return a.id === selectedId; });
  var sel = selIdx !== -1 ? allMeqs[selIdx] : null;
  if (sel) {
    var m = sel.meq;
    var selColor = CHEM_DATE_COLORS[selIdx % CHEM_DATE_COLORS.length];
    var cp = bary(LBL, LBT, LBR, m.ca, m.mg, m.nak);
    var ap = bary(RBL, RBT, RBR, m.hco3, m.so4, m.cl);
    var dp = diamondPt(m);

    function axisValue(pt, vFrom, vTo, vOpp, otherDir, pctVal) {
      var hit = _chemLineIntersect(pt, otherDir, vFrom, { x: vTo.x-vFrom.x, y: vTo.y-vFrom.y });
      if (!hit) return;
      ctx.save();
      ctx.setLineDash([4,3]); ctx.lineWidth = 1; ctx.strokeStyle = selColor;
      ctx.beginPath(); ctx.moveTo(pt.x, pt.y); ctx.lineTo(hit.x, hit.y); ctx.stroke();
      ctx.restore();
      // Pushed out past both the tick marks (9px) and the axis title (22px)
      // so the value readout has its own clear band instead of landing on
      // top of the static scale — that overlap was the "kasha" before.
      var n = _chemOutwardNormal(vFrom, vTo, vOpp);
      var lx = hit.x + n.x*34, ly = hit.y + n.y*34;
      ctx.save();
      ctx.font = 'bold 9px Inter,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 3; ctx.strokeStyle = HALO; ctx.strokeText(pctVal.toFixed(1)+'%', lx, ly);
      ctx.fillStyle = selColor; ctx.fillText(pctVal.toFixed(1)+'%', lx, ly);
      ctx.restore();
    }

    axisValue(cp, LBL, LBT, LBR, { x: LBR.x-LBL.x, y: LBR.y-LBL.y }, m.mg_pct||0);
    axisValue(cp, LBR, LBL, LBT, { x: LBR.x-LBT.x, y: LBR.y-LBT.y }, m.ca_pct||0);
    axisValue(cp, LBT, LBR, LBL, { x: LBT.x-LBL.x, y: LBT.y-LBL.y }, m.nak_pct||0);

    var hco3Total = (m.hco3_pct||0) + (m.co3_pct||0);
    axisValue(ap, RBL, RBT, RBR, { x: RBR.x-RBL.x, y: RBR.y-RBL.y }, m.so4_pct||0);
    axisValue(ap, RBR, RBL, RBT, { x: RBT.x-RBR.x, y: RBT.y-RBR.y }, hco3Total);
    axisValue(ap, RBT, RBR, RBL, { x: RBL.x-RBT.x, y: RBL.y-RBT.y }, m.cl_pct||0);

    var so4ClTotal = (m.so4_pct||0) + (m.cl_pct||0);
    axisValue(dp, D_BOT, D_RIGHT, D_LEFT, { x: D_LEFT.x-D_BOT.x, y: D_LEFT.y-D_BOT.y }, m.nak_pct||0);
    axisValue(dp, D_BOT, D_LEFT, D_RIGHT, { x: D_RIGHT.x-D_BOT.x, y: D_RIGHT.y-D_BOT.y }, so4ClTotal);
  }

  // ── Клик по точке — выбрать её (перерисовывает с новым выделением).
  // Назначаем через .onclick (не addEventListener), чтобы повторные
  // перерисовки (resize) не копили дублирующиеся обработчики.
  canvas.style.cursor = 'pointer';
  canvas.onclick = function(e) {
    var mx = e.offsetX, my = e.offsetY;
    var best = null, bestD2 = 14*14;
    hitPoints.forEach(function(hp) {
      var dx = mx-hp.x, dy = my-hp.y, d2 = dx*dx+dy*dy;
      if (d2 < bestD2) { bestD2 = d2; best = hp; }
    });
    if (best) {
      canvas._piperSelectedId = best.id;
      _chemDrawPiper(canvas, allMeqs, currentId, cssW, onSelect);
      if (onSelect) onSelect(best.id);
    }
  };
}

// ── Квадрат Толстихина ─────────────────────────────────────────
// Векторный квадрат-график (модификация О.С. Джикия, 1967, по методике
// Н.И. Толстихина) — сетка 10×10 (100 ячеек по 10%-экв). Оси подтверждены
// источником: верх = Ca²⁺+Mg²⁺ 100%, низ = Na⁺+K⁺ 100% (катионы, вертикаль);
// право = Cl⁻+SO₄²⁻ 100%, лево = HCO₃⁻+CO₃²⁻ 100% (анионы, горизонталь).
// Номер ячейки здесь — её позиция (столбец-строка) в этой сетке; настоящую
// историческую таблицу генетических классов по номерам подтверждённым
// источником найти не удалось (см. предупреждение в интерфейсе), поэтому
// не выдаём её за окончательную — только проверяемая часть методики.
function _chemDrawTolstikhin(canvas, allMeqs, currentId, cssW, onSelect) {
  var W = cssW || 560;

  var isDark = !document.documentElement.getAttribute('data-theme') ||
               document.documentElement.getAttribute('data-theme') === 'dark';
  var COL_LINE  = isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.14)';
  var COL_LINE2 = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
  var COL_TXT   = isDark ? 'rgba(255,255,255,0.62)' : 'rgba(0,0,0,0.62)';
  var COL_AXIS  = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
  var HALO = isDark ? 'rgba(13,17,26,0.85)' : 'rgba(255,255,255,0.85)';

  var MARGIN_X = 60, MARGIN_TOP = 34, MARGIN_BOT = 46;
  var SIZE = Math.max(220, Math.min(420, W - MARGIN_X*2));
  var H = MARGIN_TOP + SIZE + MARGIN_BOT;
  var ctx = _chemPrepCanvas(canvas, W, H);
  ctx.clearRect(0, 0, W, H);

  var OX = Math.round((W - SIZE) / 2); // left edge of square
  var OY = MARGIN_TOP;                 // top edge of square

  // Сетка 10×10
  ctx.strokeStyle = COL_AXIS; ctx.lineWidth = 1.4;
  ctx.strokeRect(OX, OY, SIZE, SIZE);
  ctx.strokeStyle = COL_LINE2; ctx.lineWidth = 0.7;
  for (var i = 1; i < 10; i++) {
    var gx = OX + SIZE * i / 10, gy = OY + SIZE * i / 10;
    ctx.beginPath(); ctx.moveTo(gx, OY); ctx.lineTo(gx, OY + SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(OX, gy); ctx.lineTo(OX + SIZE, gy); ctx.stroke();
  }
  // Каждая 5-я линия чуть заметнее — ориентир на 50%
  ctx.strokeStyle = COL_LINE; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(OX + SIZE/2, OY); ctx.lineTo(OX + SIZE/2, OY + SIZE); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(OX, OY + SIZE/2); ctx.lineTo(OX + SIZE, OY + SIZE/2); ctx.stroke();

  // Подписи осей: тики 10..90% по обеим осям
  ctx.font = '7px Inter,sans-serif'; ctx.fillStyle = COL_TXT;
  for (var pct = 10; pct <= 90; pct += 10) {
    var tx = OX + SIZE * pct / 100;
    ctx.textAlign = 'center';
    ctx.fillText(pct, tx, OY + SIZE + 12);
    var ty = OY + SIZE - SIZE * pct / 100; // снизу вверх = 0..100
    ctx.textAlign = 'right';
    ctx.fillText(pct, OX - 6, ty + 3);
  }

  // Заголовки сторон — как в методике: верх/низ = катионы, право/лево = анионы
  ctx.font = 'bold 10px Inter,sans-serif'; ctx.fillStyle = COL_TXT;
  ctx.textAlign = 'center';
  ctx.fillText('Ca²⁺+Mg²⁺ 100%', OX + SIZE/2, OY - 18);
  ctx.fillText('Na⁺+K⁺ 100%', OX + SIZE/2, OY + SIZE + 30);
  ctx.save();
  ctx.translate(OX - 42, OY + SIZE/2); ctx.rotate(-Math.PI/2);
  ctx.fillText('HCO₃⁻+CO₃²⁻ 100%', 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(OX + SIZE + 42, OY + SIZE/2); ctx.rotate(-Math.PI/2);
  ctx.fillText('Cl⁻+SO₄²⁻ 100%', 0, 0);
  ctx.restore();

  // x = доля Cl+SO4 среди анионов (0 слева, 100 справа)
  // y = доля Ca+Mg среди катионов (0 внизу, 100 вверху)
  function coords(m) {
    var x = (m.so4_pct||0) + (m.cl_pct||0);
    var y = (m.ca_pct||0) + (m.mg_pct||0);
    return { px: OX + SIZE * x/100, py: OY + SIZE - SIZE * y/100, x: x, y: y };
  }

  if (canvas._tolstSelectedId === undefined || !allMeqs.some(function(a){ return a.id === canvas._tolstSelectedId; })) {
    canvas._tolstSelectedId = currentId;
  }
  var selectedId = canvas._tolstSelectedId;
  var hitPoints = [];

  allMeqs.forEach(function(item, idx) {
    var col = CHEM_DATE_COLORS[idx % CHEM_DATE_COLORS.length];
    var isSel = item.id === selectedId;
    var r = isSel ? 6.5 : 4.5;
    var pt = coords(item.meq);

    ctx.save();
    ctx.globalAlpha = isSel ? 1 : 0.32;
    ctx.beginPath(); ctx.arc(pt.px, pt.py, r, 0, Math.PI*2);
    ctx.fillStyle = col;
    if (isSel) { ctx.shadowColor = col; ctx.shadowBlur = 9; }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    hitPoints.push({ x: pt.px, y: pt.py, id: item.id });
  });

  var sel = allMeqs.find(function(a){ return a.id === selectedId; });
  if (sel) {
    var spt = coords(sel.meq);
    var selIdx = allMeqs.indexOf(sel);
    var selColor = CHEM_DATE_COLORS[selIdx % CHEM_DATE_COLORS.length];
    ctx.save();
    ctx.setLineDash([4,3]); ctx.lineWidth = 0.9; ctx.strokeStyle = selColor;
    ctx.beginPath(); ctx.moveTo(OX, spt.py); ctx.lineTo(OX + SIZE, spt.py); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(spt.px, OY); ctx.lineTo(spt.px, OY + SIZE); ctx.stroke();
    ctx.restore();

    var label = spt.x.toFixed(0) + '% / ' + spt.y.toFixed(0) + '%';
    ctx.save();
    ctx.font = 'bold 9px Inter,sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    var lx = Math.min(spt.px + 10, OX + SIZE - 4), ly = spt.py - 10;
    ctx.lineWidth = 3; ctx.strokeStyle = HALO; ctx.strokeText(label, lx, ly);
    ctx.fillStyle = selColor; ctx.fillText(label, lx, ly);
    ctx.restore();
  }

  canvas.style.cursor = 'pointer';
  canvas.onclick = function(e) {
    var mx = e.offsetX, my = e.offsetY;
    var best = null, bestD2 = 14*14;
    hitPoints.forEach(function(hp) {
      var dx = mx-hp.x, dy = my-hp.y, d2 = dx*dx+dy*dy;
      if (d2 < bestD2) { bestD2 = d2; best = hp; }
    });
    if (best) {
      canvas._tolstSelectedId = best.id;
      _chemDrawTolstikhin(canvas, allMeqs, currentId, cssW, onSelect);
      if (onSelect) onSelect(best.id);
    }
  };
}

// Текст под квадратом Толстихина: позиционный номер ячейки (столбец-строка
// в сетке 10×10) + сами проценты выбранной пробы.
function _chemUpdateTolstCellInfo(nsId, allMeqs, selectedId) {
  var el = document.getElementById('chem-tolst-cell-' + nsId);
  if (!el) return;
  var sel = allMeqs.find(function(a){ return a.id === selectedId; }) || allMeqs[0];
  if (!sel) { el.textContent = '—'; return; }
  var m = sel.meq;
  var x = (m.so4_pct||0) + (m.cl_pct||0);
  var y = (m.ca_pct||0) + (m.mg_pct||0);
  var col = Math.min(10, Math.max(1, Math.ceil(x/10) || 1));
  var row = Math.min(10, Math.max(1, Math.ceil(y/10) || 1));
  el.innerHTML = 'Ячейка ' + col + '-' + row +
    ' <span style="font-weight:400;color:var(--txt-3)">· Ca+Mg ' + y.toFixed(0) + '% · Cl+SO₄ ' + x.toFixed(0) + '%' +
    (sel.date ? ' · ' + escHTML(_chemFmtDate(sel.date)) : '') + '</span>';
}

// ── Диаграмма Стиффа ───────────────────────────────────────────
function _chemDrawStiff(canvas, meq, cssW, cssH) {
  var W = cssW || 500, H = cssH || 220;
  var ctx = _chemPrepCanvas(canvas, W, H);
  ctx.clearRect(0,0,W,H);
  var isDark = !document.documentElement.getAttribute('data-theme') ||
               document.documentElement.getAttribute('data-theme') === 'dark';
  var COL_TXT  = isDark ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.65)';
  var COL_GRID = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)';
  var GOLD = '#22d3ee';

  var rows = [
    { left: meq.ca,  right: meq.hco3, catLbl: 'Ca²⁺',    anLbl: 'HCO₃⁻' },
    { left: meq.mg,  right: meq.so4,  catLbl: 'Mg²⁺',    anLbl: 'SO₄²⁻' },
    { left: meq.nak, right: meq.cl,   catLbl: 'Na⁺+K⁺',  anLbl: 'Cl⁻'   },
  ];
  var maxVal = 0;
  rows.forEach(function(r){ maxVal = Math.max(maxVal, r.left, r.right); });
  if (maxVal <= 0) return;

  // Layout: labels left, diagram center, labels right
  var lblW = 56;  // left label col width
  var numW = 38;  // left value col width
  var padT = 14, padB = 28;
  var cx = W / 2;
  var areaW = cx - lblW - numW - 4; // half-diagram width
  var scale = areaW / (maxVal * 1.05);
  var rowH = (H - padT - padB) / rows.length;

  // Grid lines
  var nTicks = 4;
  for (var ti = 1; ti <= nTicks; ti++) {
    var tv = ti / nTicks * maxVal;
    var gxR = cx + tv * scale;
    var gxL = cx - tv * scale;
    ctx.strokeStyle = COL_GRID; ctx.lineWidth = 0.6;
    [gxR, gxL].forEach(function(gx) {
      ctx.beginPath(); ctx.moveTo(gx, padT); ctx.lineTo(gx, H - padB); ctx.stroke();
    });
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
    ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(tv.toFixed(tv < 1 ? 1 : 0), gxR, H - padB + 11);
    ctx.fillText(tv.toFixed(tv < 1 ? 1 : 0), gxL, H - padB + 11);
  }

  // Center axis
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(cx, padT - 4); ctx.lineTo(cx, H - padB); ctx.stroke();

  // Row separators
  rows.forEach(function(_, i) {
    if (i === 0) return;
    var y = padT + rowH * i;
    ctx.strokeStyle = COL_GRID; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(lblW, y); ctx.lineTo(W - lblW, y); ctx.stroke();
  });

  // Polygon
  var pts = [];
  rows.forEach(function(r, i) {
    var y = padT + rowH * (i + 0.5);
    pts.push({ x: cx - r.left * scale, y: y });
  });
  rows.slice().reverse().forEach(function(r, i) {
    var j = rows.length - 1 - i;
    var y = padT + rowH * (j + 0.5);
    pts.push({ x: cx + r.right * scale, y: y });
  });
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  pts.forEach(function(p){ ctx.lineTo(p.x, p.y); });
  ctx.closePath();
  ctx.fillStyle = GOLD + '28'; ctx.fill();
  ctx.strokeStyle = GOLD; ctx.lineWidth = 2; ctx.stroke();

  // Vertex dots + value labels (outside polygon)
  ctx.font = '10px Inter,sans-serif';
  rows.forEach(function(r, i) {
    var y = padT + rowH * (i + 0.5);
    var xL = cx - r.left * scale;
    var xR = cx + r.right * scale;

    // Dots
    [xL, xR].forEach(function(x) {
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2);
      ctx.fillStyle = GOLD; ctx.fill();
    });

    // Values outside polygon
    ctx.fillStyle = COL_TXT;
    ctx.textAlign = 'right'; ctx.fillText(r.left.toFixed(2),  xL - 6, y + 4);
    ctx.textAlign = 'left';  ctx.fillText(r.right.toFixed(2), xR + 6, y + 4);

    // Ion labels in far columns
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
    ctx.textAlign = 'right'; ctx.fillText(r.catLbl, cx - areaW - 8, y + 4);
    ctx.textAlign = 'left';  ctx.fillText(r.anLbl,  cx + areaW + 8, y + 4);
  });

  // Axis label
  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.3)';
  ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('мг-экв/л', cx, H - 4);

  // Title
  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)';
  ctx.font = '10px Inter,sans-serif';
  ctx.textAlign = 'left'; ctx.fillText('Катионы', 4, padT + 10);
  ctx.textAlign = 'right'; ctx.fillText('Анионы', W - 4, padT + 10);
}

// ── График Шоллера ─────────────────────────────────────────────
function _chemDrawSchoeller(canvas, allMeqs, currentId, cssW, cssH) {
  var W = cssW || 560, H = cssH || 280;
  var ctx = _chemPrepCanvas(canvas, W, H);
  ctx.clearRect(0,0,W,H);
  var isDark = !document.documentElement.getAttribute('data-theme') ||
               document.documentElement.getAttribute('data-theme') === 'dark';
  var COL_TXT  = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)';
  var COL_GRID = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  var ions = ['ca','mg','nak','hco3','so4','cl'];
  var ionLbl = ['Ca²⁺','Mg²⁺','Na⁺+K⁺','HCO₃⁻','SO₄²⁻','Cl⁻'];
  var padL=42, padR=12, padT=12, padB=30;
  var plotW = W - padL - padR, plotH = H - padT - padB;
  var logMin = Math.log10(0.05), logMax = Math.log10(30);
  function yOf(v) {
    if (!v || v <= 0) v = 0.05;
    return padT + plotH * (1 - (Math.log10(v) - logMin) / (logMax - logMin));
  }
  function xOf(i) { return padL + (i / (ions.length-1)) * plotW; }

  // Grid
  [0.1,0.2,0.5,1,2,5,10,20].forEach(function(v) {
    var y = yOf(v);
    ctx.strokeStyle = COL_GRID; ctx.lineWidth = 0.6;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W-padR, y); ctx.stroke();
    ctx.fillStyle = COL_TXT; ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(v < 1 ? v.toFixed(1) : v, padL - 3, y + 3);
  });

  // Ion labels
  ctx.fillStyle = COL_TXT; ctx.font = '10px Inter,sans-serif'; ctx.textAlign = 'center';
  ionLbl.forEach(function(l, i){ ctx.fillText(l, xOf(i), H - 6); });

  // Тот же цвет на пробу, что и на диаграмме Пайпера/в чипах дат (CHEM_DATE_COLORS) —
  // одна проба узнаётся с первого взгляда в любом из трёх видов.
  allMeqs.forEach(function(item, idx) {
    var m = item.meq;
    var isCurrent = item.id === currentId;
    var col = CHEM_DATE_COLORS[idx % CHEM_DATE_COLORS.length];
    ctx.beginPath();
    ions.forEach(function(k, i) {
      var y = yOf(m[k] || 0.05);
      if (i === 0) ctx.moveTo(xOf(i), y); else ctx.lineTo(xOf(i), y);
    });
    ctx.strokeStyle = col;
    ctx.lineWidth = isCurrent ? 2 : 1.2;
    if (!isCurrent) ctx.setLineDash([4,3]); else ctx.setLineDash([]);
    ctx.stroke(); ctx.setLineDash([]);

    if (isCurrent) {
      ions.forEach(function(k, i) {
        var y = yOf(m[k] || 0.05);
        ctx.beginPath(); ctx.arc(xOf(i), y, 3.5, 0, Math.PI*2);
        ctx.fillStyle = col; ctx.fill();
      });
    }
  });

  // Y-axis label
  ctx.save(); ctx.translate(10, padT + plotH/2); ctx.rotate(-Math.PI/2);
  ctx.fillStyle = COL_TXT; ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('мг-экв/л (log)', 0, 0); ctx.restore();
}

// ── Формула Курлова ────────────────────────────────────────────
function _chemBuildKurlov(meq) {
  function fmt1(v){ return v < 10 ? v.toFixed(1) : Math.round(v).toString(); }

  // Cations and anions > 10% meq, sorted descending
  var ions = _chemMeqIons(meq);
  var anions = ions.anions, cations = ions.cations;

  function makeFrac(num, den) {
    return '<span class="chem-kurlov-frac">' +
      '<span class="chem-kurlov-num">' + num + '</span>' +
      '<span class="chem-kurlov-den">' + den + '</span>' +
    '</span>';
  }

  var numStr = anions.map(function(x){ return x.sym + '<sup>' + fmt1(x.pct) + '</sup>'; }).join(' ');
  var denStr = cations.map(function(x){ return x.sym + '<sub>' + fmt1(x.pct) + '</sub>'; }).join(' ');

  var mStr  = isNaN(meq.m_gl)  ? '' : 'M<sub>' + meq.m_gl.toFixed(2) + '</sub> · ';
  var phStr = isNaN(meq.ph)    ? '' : '  pH ' + meq.ph.toFixed(1);
  var tdStr = isNaN(meq.m_gl)  ? '' : '<div style="font-size:11px;color:var(--txt-3);margin-top:8px">Минерализация: ' + (meq.m_gl*1000).toFixed(0) + ' мг/л</div>';

  return '<div class="chem-kurlov-formula">' +
    mStr + makeFrac(numStr || '—', denStr || '—') + phStr +
  '</div>' + tdStr;
}

// Экспорт в глобальный scope
window.initChemTab         = initChemTab;
window.chemFilterChange    = chemFilterChange;
window.chemWpSearchChange  = chemWpSearchChange;
window.chemToggleProto     = chemToggleProto;
window.showChemWpForm      = showChemWpForm;
window.chemDeleteWp        = chemDeleteWp;
window.showChemProtocolForm= showChemProtocolForm;
window.chemClearScan       = chemClearScan;
window.chemSwitchFormGroup = chemSwitchFormGroup;
window.chemDeleteProtocol  = chemDeleteProtocol;
window.showChemExcelImport = showChemExcelImport;
window.showChemExceedanceReport   = showChemExceedanceReport;
window.chemReportQuickRange       = chemReportQuickRange;
window.chemDownloadExceedanceReport = chemDownloadExceedanceReport;
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
window.chemOpenProtoModal  = chemOpenProtoModal;
window.chemToggleHistory   = chemToggleHistory;
window.chemDuplicateProtocol = chemDuplicateProtocol;
window.chemToggleProto     = chemToggleProto;
window.chemWpaSelectWp     = chemWpaSelectWp;
window.chemWpaSelectProto  = chemWpaSelectProto;

// Мастер шаблонов лабораторий
window.showChemLabTemplateWizard = showChemLabTemplateWizard;
window.chemWizNewTemplate       = chemWizNewTemplate;
window.chemWizEditTemplate      = chemWizEditTemplate;
window.chemWizDuplicateTemplate = chemWizDuplicateTemplate;
window.chemWizDeleteTemplate    = chemWizDeleteTemplate;
window.chemWizBackToList        = chemWizBackToList;
window.chemWizToggleParam       = chemWizToggleParam;
window.chemWizRemoveParam       = chemWizRemoveParam;
window.chemWizMoveParam         = chemWizMoveParam;
window.chemWizSearchChange      = chemWizSearchChange;
window.chemWizSaveTemplate      = chemWizSaveTemplate;
window.chemFormLabChanged       = chemFormLabChanged;
window.chemFormWpChanged        = chemFormWpChanged;
window.chemFormTemplateChanged  = chemFormTemplateChanged;
window.chemFormLabPick          = chemFormLabPick;
window.chemWizLabPick           = chemWizLabPick;

// Close protocol modal on Escape
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    var m = document.getElementById('chem-proto-modal');
    if (m) m.remove();
  }
});
