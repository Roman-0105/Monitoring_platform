// Аналитика и отчёты по хим. протоколам — отчёт превышений ПДК (Excel), шаблоны
// и импорт Excel/CSV, экспорт CSV одного протокола. Точный порт соответствующей
// логики из hydro-monitoring/ui-chem.js (секции ЭКСПОРТ/ИМПОРТ/ОТЧЁТ).
import { CHEM_PARAMS, CHEM_PARAM_MAP, pdkStatus, pdkStr } from './chem-params.js';
import { CHEM_PROTO_TYPE_META, parseChemValue, quarterFromDate } from './chem-core.js';

// Базовые (не привязанные к конкретной лаборатории) наборы параметров — стартовые
// варианты для скачивания шаблона, когда для лаборатории ещё не настроен свой.
export const CHEM_TEMPLATE_TYPES = {
  sha: {
    label: 'СХА', desc: 'Стандартный химический анализ', icon: '🧪',
    params: ['smell', 'taste', 'color', 'turbidity', 'transp', 'ph_lab', 'ph_field', 'tds', 'hardness', 'oxidability', 'apav', 'dry_res', 'alkalinity', 'density',
      'na', 'k', 'ca', 'mg', 'nh4', 'nh3', 'co3', 'hco3', 'no3', 'no2', 'so4', 'cl', 'f', 'si', 'iodide',
      'fe2', 'fe3', 'fe_total', 'mn', 'cu', 'zn', 'al', 'ba', 'ni', 'mo', 'oil', 'phenol'],
  },
  radio: { label: 'Радиология', desc: 'Базовый радиологический анализ', icon: '☢️', params: ['alpha_total', 'beta_total', 'ra226', 'rn222', 'u_nat'] },
  cn: { label: 'Цианиды (CN)', desc: 'Полный анализ по цианидам', icon: '⚗️', params: ['cn', 'cn_free', 'cn_weak', 'cn_strong', 'cns'] },
  micro: {
    label: 'Микрокомпоненты', desc: 'Тяжёлые металлы и микроэлементы', icon: '🔩',
    params: ['as', 'pb', 'cd', 'cr3', 'cr6', 'cu', 'zn', 'ni', 'co_metal', 'hg', 'mo', 'sb', 'se', 'ba', 'be', 'v', 'al', 'b', 'li', 'tl', 'ag', 'sr', 'mn', 'fe_total'],
  },
};

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function fmtDate(s) {
  if (!s) return '—';
  const [y, m, d] = String(s).split('-');
  return d && m && y ? `${d}.${m}.${y}` : s;
}

// либо "tpl:<id>" шаблона лаборатории, либо ключ базового типа (sha/radio/cn/micro)
export function resolveTplSource(sourceVal, labTemplates) {
  if (sourceVal && sourceVal.indexOf('tpl:') === 0) {
    const tpl = labTemplates.find((t) => t.id === sourceVal.slice(4));
    if (tpl) return { kind: 'lab', template: tpl, protoType: tpl.base_type || 'sha', templateId: tpl.id };
  }
  const typeKey = CHEM_TEMPLATE_TYPES[sourceVal] ? sourceVal : 'sha';
  return { kind: 'base', typeKey, protoType: typeKey, templateId: null };
}

// ── Скачать загрузочный шаблон Excel ────────────────────────────────────────
export async function downloadChemTemplateXlsx(sourceVal, labTemplates) {
  const { loadXLSX } = await import('./xlsx-loader.js');
  const XLSX = await loadXLSX();
  const resolved = resolveTplSource(sourceVal, labTemplates);

  let label, desc, icon, paramKeys, labExample, fileTag;
  if (resolved.kind === 'lab') {
    const tpl = resolved.template;
    label = tpl.lab_name + ' — ' + tpl.template_name;
    desc = 'Пользовательский шаблон лаборатории'; icon = '🧪';
    paramKeys = tpl.params || []; labExample = tpl.lab_name;
    fileTag = 'lab_' + (tpl.lab_name + '_' + tpl.template_name).replace(/[^\wа-яёА-ЯЁ]+/gi, '_');
  } else {
    const tplType = CHEM_TEMPLATE_TYPES[resolved.typeKey] || CHEM_TEMPLATE_TYPES.sha;
    label = tplType.label; desc = tplType.desc; icon = tplType.icon;
    paramKeys = tplType.params; labExample = 'EcoExpert'; fileTag = resolved.typeKey;
  }
  const params = paramKeys.map((k) => CHEM_PARAM_MAP[k]).filter(Boolean);

  const fixedHeaders = ['Код водопункта', 'Наименование', 'Дата (ДД.ММ.ГГГГ)', '№ протокола', 'Лаборатория', 'Лаб. номер пробы', 'Пробоотборщик', 'Примечание'];
  const fixedExample = ['ПН-1', 'Скважина ПН-1', '11.06.2026', '421/2', labExample, '977', 'Иванов И.И.', ''];
  const paramHeaders = params.map((p) => p.key);
  const paramNames = params.map((p) => p.name);
  const paramUnits = params.map((p) => p.unit);
  const paramPdk = params.map((p) => (p.pdk_type === 'range' ? 'ПДК ' + (p.pdk_drink_min || '') + '–' + (p.pdk_drink_max || '') : (p.pdk_drink != null ? 'ПДК≤' + p.pdk_drink : '')));

  const rows = [
    [icon + ' Шаблон протоколов: ' + label + ' — ' + desc],
    fixedHeaders.concat(paramHeaders),
    fixedHeaders.map(() => '').concat(paramNames),
    fixedHeaders.map(() => '').concat(paramUnits.map((u, i) => u + (paramPdk[i] ? '  ' + paramPdk[i] : ''))),
    ['#ПРИМЕР'].concat(fixedExample.slice(1)).concat(params.map(() => '')),
    [], [], [], [], [],
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = fixedHeaders.map((_, i) => ({ wch: [14, 20, 16, 14, 16, 14, 18, 20][i] || 14 })).concat(params.map(() => ({ wch: 12 })));
  ws['!freeze'] = { xSplit: 2, ySplit: 4, topLeftCell: 'C5', activePane: 'bottomRight', state: 'frozen' };
  XLSX.utils.book_append_sheet(wb, ws, label.substring(0, 31));

  const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([wbOut], { type: 'application/octet-stream' }), 'chem_template_' + fileTag + '.xlsx');
}

/* Нормализует дату из любого формата в YYYY-MM-DD.
   Поддерживает: ДД.ММ.ГГГГ, ГГГГ-ММ-ДД (с временем), М/Д/ГГГГ */
function parseFlexDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) { const p = str.split('.'); return p[2] + '-' + p[1] + '-' + p[0]; }
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const yr = m[3].length === 2 ? '20' + m[3] : m[3]; return yr + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'); }
  return null;
}

// ── Разбор загруженного файла (.xlsx/.xls/.csv) в {headers, dataRows} ──────
export async function parseChemImportFile(file) {
  const isXlsx = /\.(xlsx|xls)$/i.test(file.name);
  if (isXlsx) {
    const { loadXLSX } = await import('./xlsx-loader.js');
    const XLSX = await loadXLSX();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd' });
    if (rows.length < 2) throw new Error('Файл пустой');
    const headers = rows[1].map((h) => String(h).trim());
    const dataRows = rows.slice(4).filter((r) => r[0] && String(r[0]).trim() && String(r[0]).charAt(0) !== '#');
    return { headers, dataRows };
  }
  const text = await file.text();
  const rawLines = text.split(/\r?\n/).filter((l) => l.trim() && l.trim().charAt(0) !== '#');
  if (rawLines.length < 2) throw new Error('Файл пустой');
  const sep = rawLines[0].includes(';') ? ';' : ',';
  const headers = rawLines[0].split(sep).map((h) => h.trim().replace(/^﻿/, ''));
  const dataRows = rawLines.slice(1).map((l) => l.split(sep));
  return { headers, dataRows };
}

// Предпросмотр перед импортом — сколько строк узнано/не узнано по реестру водопунктов.
export function analyzeChemImportRows(dataRows, wpOptions) {
  const unknown = [];
  const unknownSet = {};
  let knownCount = 0;
  dataRows.forEach((row) => {
    const code = String(row[0] || '').trim();
    const name = String(row[1] || '').trim();
    const key = code || name;
    if (!key) return;
    const found = wpOptions.find((w) => (name && w.name === name) || (code && !name && w.code === code));
    if (found) knownCount++;
    else if (!unknownSet[key]) { unknownSet[key] = true; unknown.push({ code, name }); }
  });
  return { knownCount, unknown };
}

// Импортирует строки в БД. supabase — клиент, wpOptions — реестр водопунктов
// (для сопоставления имени/кода), protoType/templateId — из resolveTplSource().
export async function importChemRows(supabase, headers, dataRows, protoType, templateId, wpOptions) {
  let imported = 0, errors = 0, skipped = 0;
  const resolvedProtoType = (protoType && CHEM_PROTO_TYPE_META[protoType]) ? protoType : 'sha';
  let templateColumnMissing = false, quarterColumnMissing = false;

  for (const cols of dataRows) {
    const getCell = (i) => (cols[i] !== undefined ? String(cols[i]).trim() : '');
    const wpCode = getCell(0), wpName = getCell(1), dateStr = getCell(2), protoNum = getCell(3), labName = getCell(4), labNum = getCell(5);
    if (!wpCode && !wpName) continue;
    if (!dateStr) continue;

    const wp = wpOptions.find((w) => (wpName && w.name === wpName) || (wpCode && wpName && w.code === wpCode && w.name === wpName) || (wpCode && !wpName && w.code === wpCode));
    if (!wp) { skipped++; continue; }

    const isoDate = parseFlexDate(dateStr);
    if (!isoDate) { errors++; continue; }

    let protoRow = {
      water_point_id: wp.id, sampled_at: isoDate, lab_protocol_number: protoNum || null,
      lab_name: labName || null, lab_number: labNum || null, protocol_type: resolvedProtoType, source: 'excel',
      template_id: (templateId && !templateColumnMissing) ? templateId : null,
      quarter: quarterColumnMissing ? undefined : quarterFromDate(isoDate),
    };
    if (protoRow.quarter === undefined) delete protoRow.quarter;

    let pRes = await supabase.from('chem_protocols').insert(protoRow).select().single();
    if (pRes.error && /template_id/i.test(pRes.error.message || '')) { templateColumnMissing = true; delete protoRow.template_id; pRes = await supabase.from('chem_protocols').insert(protoRow).select().single(); }
    if (pRes.error && /quarter/i.test(pRes.error.message || '')) { quarterColumnMissing = true; delete protoRow.quarter; pRes = await supabase.from('chem_protocols').insert(protoRow).select().single(); }
    if (pRes.error) { errors++; continue; }
    const proto = pRes.data;

    const resultRows = [];
    for (let hi = 8; hi < headers.length; hi++) {
      const paramKey = headers[hi].trim();
      const param = CHEM_PARAM_MAP[paramKey];
      if (!param) continue;
      const raw = getCell(hi);
      if (!raw) continue;
      const parsed = parseChemValue(raw);
      if (!parsed) continue;
      resultRows.push({ protocol_id: proto.id, param_key: param.key, value_raw: raw, value_num: (!parsed.below && !parsed.above) ? parsed.num : null, below_detection: parsed.below, above_range: parsed.above });
    }
    if (resultRows.length) await supabase.from('chem_results').insert(resultRows);
    imported++;
  }
  return { imported, errors, skipped };
}

// ── Отчёт по превышениям ПДК за период (Excel) ──────────────────────────────
export function collectExceedances(protocols, resultsByProtocol, wpNames, fromDate, toDate) {
  const rows = [];
  protocols
    .filter((p) => p.sampled_at && p.sampled_at >= fromDate && p.sampled_at <= toDate)
    .forEach((p) => {
      (resultsByProtocol[p.id] || []).forEach((r) => {
        if (pdkStatus(r.param_key, r.value_raw, r.below_detection) !== 'exceed') return;
        const param = CHEM_PARAM_MAP[r.param_key];
        if (!param) return;
        let ratio = '';
        const numVal = parseFloat(String(r.value_raw).replace(',', '.').replace(/^[<>]/, ''));
        if (param.pdk_type === 'max' && param.pdk_drink) ratio = (numVal / param.pdk_drink).toFixed(1) + '×';
        else if (param.pdk_type === 'min') ratio = 'ниже нормы';
        else if (param.pdk_type === 'range') ratio = 'вне диапазона';
        rows.push({
          date: p.sampled_at, wpName: wpNames[p.water_point_id] || '—', lab: p.lab_name || '', protoNum: p.lab_protocol_number || '',
          paramName: param.name, unit: param.unit, value: r.value_raw, pdk: pdkStr(param), ratio,
        });
      });
    });
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

export async function downloadExceedanceReportXlsx(rows, fromDate, toDate) {
  const { loadXLSX } = await import('./xlsx-loader.js');
  const XLSX = await loadXLSX();
  const header = ['Дата отбора', 'Водопункт', 'Лаборатория', '№ протокола', 'Показатель', 'Значение', 'Ед. изм.', 'ПДК (питьевая)', 'Превышение'];
  const aoa = [
    ['Отчёт по превышениям ПДК за период ' + fmtDate(fromDate) + ' — ' + fmtDate(toDate)],
    ['Сформировано: ' + fmtDate(new Date().toISOString().slice(0, 10)) + ' · записей: ' + rows.length],
    [], header,
  ].concat(rows.map((r) => [fmtDate(r.date), r.wpName, r.lab, r.protoNum, r.paramName, r.value, r.unit, r.pdk, r.ratio]));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 26 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 12 }];
  ws['!freeze'] = { xSplit: 0, ySplit: 4, topLeftCell: 'A5', activePane: 'bottomLeft', state: 'frozen' };
  XLSX.utils.book_append_sheet(wb, ws, 'Превышения ПДК');
  const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(new Blob([wbOut], { type: 'application/octet-stream' }), 'exceedance_report_' + fromDate + '_' + toDate + '.xlsx');
}

// ── Экспорт CSV одного протокола ────────────────────────────────────────────
export function exportProtocolCsv(proto, wpName, results) {
  if (!results || !results.length) return;
  const rmap = {}; results.forEach((r) => { rmap[r.param_key] = r; });
  const lines = [
    ['Водопункт', wpName || '?'], ['Дата отбора', fmtDate(proto.sampled_at)], ['Лаборатория', proto.lab_name || ''],
    ['№ протокола', proto.lab_protocol_number || ''], ['Лаб. номер', proto.lab_number || ''], [],
    ['№', 'Параметр', 'Значение', 'Ед. изм.', 'ПДК питьевая', 'Статус'],
  ];
  CHEM_PARAMS.forEach((p) => {
    const r = rmap[p.key];
    if (!r) return;
    const st = pdkStatus(p.key, r.value_raw, r.below_detection);
    const statusTxt = st === 'exceed' ? 'Превышение ПДК' : st === 'ok' ? 'Норма' : 'Нет нормы';
    lines.push([p.no, p.name, r.value_raw, p.unit, pdkStr(p), statusTxt]);
  });
  const csv = '﻿' + lines.map((row) => row.map((v) => '"' + String(v || '').replace(/"/g, '""') + '"').join(';')).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'protocol_' + (proto.lab_protocol_number || proto.id.slice(0, 8)) + '_' + (proto.sampled_at || 'date') + '.csv');
}
