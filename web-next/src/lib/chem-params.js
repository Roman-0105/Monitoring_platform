// Точный порт справочника параметров и ПДК из hydro-monitoring/ui-chem.js (CHEM_PARAMS),
// чтобы цифры/статусы совпадали со старым приложением.
export const CHEM_PARAMS = [
  { key: 'smell', no: 1, name: 'Запах при 20°C', unit: 'балл', group: 'organo', pdk_type: 'score', pdk_drink: 2 },
  { key: 'taste', no: 2, name: 'Привкус', unit: 'балл', group: 'organo', pdk_type: 'score', pdk_drink: 2 },
  { key: 'color', no: 3, name: 'Цветность', unit: 'гр. цветн.', group: 'organo', pdk_type: 'max', pdk_drink: 20 },
  { key: 'turbidity', no: 4, name: 'Мутность', unit: 'ЕМФ', group: 'organo', pdk_type: 'max', pdk_drink: 2.6 },
  { key: 'transp', no: 5, name: 'Прозрачность', unit: 'см', group: 'organo', pdk_type: 'min', pdk_drink: 30 },
  { key: 'ph_lab', no: 6, name: 'pH в лаборатории', unit: 'ед. pH', group: 'physico', pdk_type: 'range', pdk_drink_min: 6.0, pdk_drink_max: 9.0 },
  { key: 'ph_field', no: 7, name: 'pH при отборе', unit: 'ед. pH', group: 'physico', pdk_type: 'range', pdk_drink_min: 6.0, pdk_drink_max: 9.0 },
  { key: 'tds', no: 8, name: 'Общая минерализация', unit: 'мг/дм³', group: 'physico', pdk_type: 'max', pdk_drink: 1000 },
  { key: 'hardness', no: 9, name: 'Общая жёсткость', unit: 'мг-экв/дм³', group: 'physico', pdk_type: 'max', pdk_drink: 7.0 },
  { key: 'oxidability', no: 10, name: 'Окисляемость перманг.', unit: 'мгО/дм³', group: 'physico', pdk_type: 'max', pdk_drink: 5.0 },
  { key: 'apav', no: 11, name: 'АПАВ', unit: 'мг/дм³', group: 'physico', pdk_type: 'max', pdk_drink: 0.5 },
  { key: 'na', no: 12, name: 'Натрий (Na⁺)', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: 200 },
  { key: 'k', no: 13, name: 'Калий (K⁺)', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: null },
  { key: 'ca', no: 14, name: 'Кальций (Ca²⁺)', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: null },
  { key: 'mg', no: 15, name: 'Магний (Mg²⁺)', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: 50 },
  { key: 'nh4', no: 16, name: 'Аммоний (NH₄⁺)', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: 2.0 },
  { key: 'nh3', no: 17, name: 'Аммиак и ионы аммония', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: 0.05 },
  { key: 'co3', no: 18, name: 'Карбонаты (CO₃²⁻)', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: null },
  { key: 'hco3', no: 19, name: 'Гидрокарбонаты (HCO₃⁻)', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: null },
  { key: 'no3', no: 20, name: 'Нитраты (NO₃⁻)', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: 45 },
  { key: 'no2', no: 21, name: 'Нитриты (NO₂⁻)', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: 3.0 },
  { key: 'so4', no: 22, name: 'Сульфаты (SO₄²⁻)', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: 500 },
  { key: 'cl', no: 23, name: 'Хлориды (Cl⁻)', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: 350 },
  { key: 'fe2', no: 24, name: 'Железо 2+', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.3 },
  { key: 'fe3', no: 25, name: 'Железо 3+', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.3 },
  { key: 'fe_total', no: 26, name: 'Железо общее', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.3 },
  { key: 'cu', no: 27, name: 'Медь', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 1.0 },
  { key: 'mo', no: 28, name: 'Молибден', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.07 },
  { key: 'as', no: 29, name: 'Мышьяк', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.01 },
  { key: 'pb', no: 30, name: 'Свинец', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.01 },
  { key: 'se', no: 31, name: 'Селен', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.01 },
  { key: 'sr', no: 32, name: 'Стронций', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 7.0 },
  { key: 'ag', no: 33, name: 'Серебро', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.05 },
  { key: 'cn', no: 34, name: 'Цианиды (CN⁻)', unit: 'мг/дм³', group: 'organic', pdk_type: 'max', pdk_drink: 0.07 },
  { key: 'zn', no: 35, name: 'Цинк', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 5.0 },
  { key: 'tl', no: 36, name: 'Таллий', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.0001 },
  { key: 'li', no: 37, name: 'Литий', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.03 },
  { key: 'sb', no: 38, name: 'Сурьма', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.005 },
  { key: 'oil', no: 39, name: 'Нефтепродукты', unit: 'мг/дм³', group: 'organic', pdk_type: 'max', pdk_drink: 0.1 },
  { key: 'phenol', no: 40, name: 'Фенолы (C₆H₅OH)', unit: 'мг/дм³', group: 'organic', pdk_type: 'max', pdk_drink: 0.001 },
  { key: 'al', no: 41, name: 'Алюминий', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.2 },
  { key: 'ba', no: 42, name: 'Барий', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.1 },
  { key: 'be', no: 43, name: 'Бериллий', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.0002 },
  { key: 'b', no: 44, name: 'Бор', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.5 },
  { key: 'mn', no: 45, name: 'Марганец', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.1 },
  { key: 'dry_res', no: 46, name: 'Сухой остаток', unit: 'мг/дм³', group: 'physico', pdk_type: 'max', pdk_drink: 1000 },
  { key: 'cr3', no: 47, name: 'Хром 3+ (Cr³⁺)', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.5 },
  { key: 'cr6', no: 48, name: 'Хром 6+ (Cr⁶⁺)', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.05 },
  { key: 'ni', no: 49, name: 'Никель', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.02 },
  { key: 'co_metal', no: 50, name: 'Кобальт', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.1 },
  { key: 'v', no: 51, name: 'Ванадий', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.1 },
  { key: 'alkalinity', no: 52, name: 'Щёлочность', unit: 'мг-экв/дм³', group: 'physico', pdk_type: 'max', pdk_drink: null },
  { key: 'f', no: 53, name: 'Фториды (F⁻)', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: 1.5 },
  { key: 'cd', no: 54, name: 'Кадмий', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.001 },
  { key: 'hg', no: 55, name: 'Ртуть', unit: 'мг/дм³', group: 'metals', pdk_type: 'max', pdk_drink: 0.0005 },
  { key: 'si', no: 56, name: 'Кремний', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: 10 },
  { key: 'iodide', no: 57, name: 'Йодид ионы', unit: 'мг/дм³', group: 'macro', pdk_type: 'max', pdk_drink: null },
  { key: 'density', no: 58, name: 'Плотность', unit: 'г/см³', group: 'physico', pdk_type: 'max', pdk_drink: null },
  { key: 'cn_free', no: 58, name: 'Цианиды свободные', unit: 'мг/дм³', group: 'organic', pdk_type: 'max', pdk_drink: 0.035 },
  { key: 'cn_weak', no: 59, name: 'Цианиды слабосвязанные', unit: 'мг/дм³', group: 'organic', pdk_type: 'max', pdk_drink: 0.07 },
  { key: 'cn_strong', no: 60, name: 'Цианиды прочносвязанные', unit: 'мг/дм³', group: 'organic', pdk_type: 'max', pdk_drink: null },
  { key: 'cns', no: 61, name: 'Роданиды (CNS⁻)', unit: 'мг/дм³', group: 'organic', pdk_type: 'max', pdk_drink: null },
  { key: 'alpha_total', no: 62, name: 'Суммарная α-активность', unit: 'Бк/дм³', group: 'radio', pdk_type: 'max', pdk_drink: 0.1 },
  { key: 'beta_total', no: 63, name: 'Суммарная β-активность', unit: 'Бк/дм³', group: 'radio', pdk_type: 'max', pdk_drink: 1.0 },
  { key: 'ra226', no: 64, name: 'Радий-226 (Ra-226)', unit: 'Бк/дм³', group: 'radio', pdk_type: 'max', pdk_drink: 0.49 },
  { key: 'rn222', no: 65, name: 'Радон-222 (Rn-222)', unit: 'Бк/дм³', group: 'radio', pdk_type: 'max', pdk_drink: 60 },
  { key: 'u_nat', no: 66, name: 'Уран природный (U)', unit: 'мг/дм³', group: 'radio', pdk_type: 'max', pdk_drink: 0.015 },
];

export const CHEM_PARAM_MAP = Object.fromEntries(CHEM_PARAMS.map((p) => [p.key, p]));

export const CHEM_GROUPS = {
  organo: { label: 'Органолептика' },
  physico: { label: 'Физ-химия' },
  macro: { label: 'Макроэлементы' },
  metals: { label: 'Металлы' },
  organic: { label: 'Органика' },
  radio: { label: 'Радиология' },
};

// Компактный набор ключевых показателей — для формы быстрого ввода (полный список из 60+
// параметров, как в старом приложении, доступен там же, если понадобится редкий показатель).
export const CORE_PARAM_KEYS = ['ph_lab', 'tds', 'hardness', 'na', 'ca', 'mg', 'hco3', 'so4', 'cl', 'no3', 'fe_total', 'mn', 'oil', 'phenol', 'as', 'cn'];

function parseValue(str) {
  if (!str && str !== 0) return null;
  const s = String(str).trim().replace(',', '.');
  const below = s.charAt(0) === '<';
  const numStr = s.replace(/^[<>]/, '');
  const num = parseFloat(numStr);
  if (Number.isNaN(num)) return null;
  return { num, below };
}

// 'ok' | 'exceed' | 'no_norm' | 'nd' — точный порт _chemPdkStatus
export function pdkStatus(paramKey, valueRaw, belowDetection) {
  const p = CHEM_PARAM_MAP[paramKey];
  if (!p) return 'no_norm';
  const parsed = parseValue(valueRaw);
  if (!parsed) return 'nd';

  if (belowDetection || parsed.below) {
    const pdkVal = p.pdk_drink ?? p.pdk_drink_max;
    if (pdkVal != null && parsed.num <= pdkVal) return 'ok';
    return 'no_norm';
  }
  const v = parsed.num;
  if (p.pdk_type === 'range') {
    if (p.pdk_drink_min !== undefined) return (v >= p.pdk_drink_min && v <= p.pdk_drink_max) ? 'ok' : 'exceed';
    return 'no_norm';
  }
  if (p.pdk_type === 'min') {
    if (p.pdk_drink != null) return v >= p.pdk_drink ? 'ok' : 'exceed';
    return 'no_norm';
  }
  if (p.pdk_drink != null) return v <= p.pdk_drink ? 'ok' : 'exceed';
  return 'no_norm';
}

export function pdkStr(p) {
  if (p.pdk_type === 'range' && p.pdk_drink_min !== undefined) return p.pdk_drink_min + '–' + p.pdk_drink_max;
  if (p.pdk_type === 'min' && p.pdk_drink != null) return '≥' + p.pdk_drink;
  if (p.pdk_drink != null) return '≤' + p.pdk_drink;
  return '—';
}
