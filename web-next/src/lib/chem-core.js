// Прикладная логика химического мониторинга (не каталог параметров/ПДК — см.
// chem-params.js): баланс ионов, автообнаружение аномалий, журнал изменений
// протокола. Точный порт соответствующих функций из hydro-monitoring/ui-chem.js.
import { CHEM_PARAM_MAP } from './chem-params.js';

export const CHEM_PROTO_TYPE_META = {
  sha: { label: 'СХА', icon: '🧪', color: '#3b82f6' },
  radio: { label: 'Радиология', icon: '☢️', color: '#a855f7' },
  cn: { label: 'Цианиды', icon: '⚗️', color: '#f59e0b' },
  micro: { label: 'Микрокомпоненты', icon: '🔩', color: '#10b981' },
  radio_full: { label: 'Развёрнутая радиология', icon: '☢️', color: '#8b5cf6' },
  full: { label: 'Полный анализ', icon: '📋', color: '#6b7280' },
};

export function parseChemValue(str) {
  if (!str && str !== 0) return null;
  const s = String(str).trim().replace(',', '.');
  const below = s.charAt(0) === '<';
  const above = s.charAt(0) === '>';
  const num = parseFloat(s.replace(/^[<>]/, ''));
  if (Number.isNaN(num)) return null;
  return { num, below, above };
}

export function quarterFromDate(dateStr) {
  if (!dateStr) return null;
  const m = parseInt(String(dateStr).slice(5, 7), 10);
  return m ? Math.ceil(m / 3) : null;
}
export function romanQuarter(q) { return ['I', 'II', 'III', 'IV'][q - 1] || q; }

// ── Баланс ионов (контроль качества хим. анализа) ──────────────────────────
// (Σкатионы − Σанионы) / (Σкатионы + Σанионы) × 100%, суммы в мг-экв/л.
// Норма — обычно в пределах ±5%; больше — вероятная ошибка ввода/анализа.
export const CHEM_ION_BALANCE_KEYS = ['ca', 'mg', 'na', 'k', 'hco3', 'co3', 'so4', 'cl'];
const CHEM_EQUIV_WEIGHTS = { ca: 20.04, mg: 12.15, na: 23.0, k: 39.1, hco3: 61.0, co3: 30.0, so4: 48.0, cl: 35.45 };
const ION_CATIONS = new Set(['ca', 'mg', 'na', 'k']);

// valuesByKey — { paramKey: 'сырое значение из поля ввода' }
export function calcIonBalance(valuesByKey) {
  let catSum = 0, anSum = 0;
  CHEM_ION_BALANCE_KEYS.forEach((key) => {
    const raw = (valuesByKey[key] || '').trim();
    if (!raw) return;
    const parsed = parseChemValue(raw);
    if (!parsed || parsed.below || parsed.above) return;
    const meq = parsed.num / CHEM_EQUIV_WEIGHTS[key];
    if (ION_CATIONS.has(key)) catSum += meq; else anSum += meq;
  });
  if (catSum <= 0 || anSum <= 0) return null;
  const errorPct = (catSum - anSum) / (catSum + anSum) * 100;
  return { catSum, anSum, errorPct, bad: Math.abs(errorPct) > 5 };
}

// ── Автообнаружение аномалий ────────────────────────────────────────────────
// Сравнивает черновик результатов (ещё не сохранённых) с последними до 5
// протоколами того же водопункта — резкий скачок (в 3+ раза) обычно означает
// опечатку или перепутанные единицы, а не реальное изменение химсостава.
// historyProtocols — уже отсортированные по убыванию даты, без текущего протокола.
// resultsByProtocolId — { protocolId: [{param_key, value_num}, ...] }
// draftResults — [{param_key, value_num}, ...] из формы (ещё не сохранены).
export function detectAnomalies(historyProtocols, resultsByProtocolId, draftResults) {
  const anomalies = [];
  draftResults.forEach((row) => {
    if (row.value_num == null || row.value_num <= 0) return; // "<порог"/">диапазон" — не с чем сравнивать
    const param = CHEM_PARAM_MAP[row.param_key];
    if (!param) return;
    for (const hp of historyProtocols) {
      const hRows = resultsByProtocolId[hp.id] || [];
      const hRow = hRows.find((r) => r.param_key === row.param_key);
      if (hRow && hRow.value_num != null && hRow.value_num > 0) {
        const ratio = row.value_num / hRow.value_num;
        if (ratio >= 3 || ratio <= 1 / 3) {
          anomalies.push({ name: param.name, unit: param.unit, prev: hRow.value_num, prevDate: hp.sampled_at, next: row.value_num });
        }
        break; // сравниваем только с ближайшей предыдущей пробой, где показатель измерялся
      }
    }
  });
  return anomalies;
}

// ── Журнал изменений протокола ──────────────────────────────────────────────
const HISTORY_FIELDS = [
  { key: 'water_point_id', label: 'Водопункт' },
  { key: 'sampled_at', label: 'Дата отбора' },
  { key: 'lab_name', label: 'Лаборатория' },
  { key: 'lab_protocol_number', label: '№ протокола' },
  { key: 'lab_number', label: 'Лаб. номер пробы' },
  { key: 'protocol_type', label: 'Вид протокола' },
  { key: 'is_control', label: 'Контрольная проба' },
];

// ctx: { wpNameOf(id), protoTypeLabel(key) } — форматтеры для читаемого diff.
export function buildProtoDiff(oldRow, newRow, ctx) {
  const out = [];
  HISTORY_FIELDS.forEach((f) => {
    const ov = oldRow ? (oldRow[f.key] ?? null) : null;
    const nv = newRow[f.key] ?? null;
    if (String(ov) === String(nv)) return;
    let ofmt = ov, nfmt = nv;
    if (f.key === 'water_point_id') { ofmt = ov ? ctx.wpNameOf(ov) : '—'; nfmt = nv ? ctx.wpNameOf(nv) : '—'; }
    else if (f.key === 'protocol_type') { ofmt = ov ? ctx.protoTypeLabel(ov) : '—'; nfmt = nv ? ctx.protoTypeLabel(nv) : '—'; }
    else if (f.key === 'is_control') { ofmt = ov ? 'да' : 'нет'; nfmt = nv ? 'да' : 'нет'; }
    else { ofmt = ov == null ? '—' : String(ov); nfmt = nv == null ? '—' : String(nv); }
    out.push({ field: f.key, label: f.label, old: ofmt, new: nfmt });
  });
  return out;
}

export function countResultChanges(oldResults, newResults) {
  const oldMap = {}; (oldResults || []).forEach((r) => { oldMap[r.param_key] = r.value_raw || ''; });
  const newMap = {}; (newResults || []).forEach((r) => { newMap[r.param_key] = r.value_raw || ''; });
  const allKeys = new Set([...Object.keys(oldMap), ...Object.keys(newMap)]);
  let changed = 0;
  allKeys.forEach((k) => { if ((oldMap[k] || '') !== (newMap[k] || '')) changed++; });
  return changed;
}
