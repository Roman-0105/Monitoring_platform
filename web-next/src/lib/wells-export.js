// Экспорт реестра скважин — порт exportWellsCSV/exportWellsXLSX из hydro-monitoring/ui-wells.js.

function csvNum(v) { return v != null ? String(v).replace('.', ',') : ''; }
function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /["\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function fmtDate(d) {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
}
function timestamp() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function lastMeasurement(measByWell, wellId) {
  const arr = measByWell[wellId];
  if (!arr || !arr.length) return null;
  return arr.reduce((latest, m) => (!latest || (m.measurement_date || '') > (latest.measurement_date || '')) ? m : latest, null);
}

const CSV_HEADERS = [
  'Скважина', 'Карьер', 'Участок', 'Домен', 'Статус',
  'Глубина, м', 'Азимут, °', 'Наклон, °', 'Диаметр, мм', 'Обсадка',
  'Дата бурения', 'Q после бурения, м³/ч',
  'X лок.', 'Y лок.', 'Z лок.', 'Широта', 'Долгота',
  'Дата замера', 'Q замера, м³/ч', 'Сотрудник', 'Комментарий к замеру',
];

function wellMeasRow(w, m) {
  return [
    w.name || '', w.quarry || '', w.quarry_section || '', w.domain || '', w.status || '',
    csvNum(w.depth), csvNum(w.azimuth), csvNum(w.inclination),
    csvNum(w.drill_diameter), w.casing || '',
    fmtDate(w.drill_date), csvNum(w.flow_after_drill),
    csvNum(w.x_local), csvNum(w.y_local), csvNum(w.z_local),
    csvNum(w.lat), csvNum(w.lon),
    m ? fmtDate(m.measurement_date) : '',
    m ? csvNum(m.flow_rate) : '',
    m ? (m.worker || '') : '',
    m ? (m.comment || '') : '',
  ];
}

export function exportWellsCsv(wells, measByWell) {
  if (!wells.length) return;
  const rows = [CSV_HEADERS];
  wells.forEach((w) => {
    const meas = (measByWell[w.id] || []).slice().sort((a, b) => (b.measurement_date || '') < (a.measurement_date || '') ? -1 : 1);
    if (meas.length) meas.forEach((m) => rows.push(wellMeasRow(w, m)));
    else rows.push(wellMeasRow(w, null));
  });
  const csv = rows.map((r) => r.map(csvEscape).join(';')).join('\r\n');
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), `skvazhiny-${timestamp()}.csv`);
}

export async function exportWellsXlsx(wells, measByWell) {
  if (!wells.length) return;
  const { loadXLSX } = await import('./xlsx-loader.js');
  const XLSX = await loadXLSX();
  const ts = timestamp();

  const wHdrs = [
    'Скважина', 'Карьер', 'Участок', 'Домен', 'Статус',
    'Глубина, м', 'Азимут, °', 'Наклон, °', 'Диаметр, мм', 'Обсадка',
    'Дата бурения', 'Q после бурения, м³/ч',
    'X лок.', 'Y лок.', 'Z лок.', 'Широта', 'Долгота',
    'Последний замер', 'Q посл. замер, м³/ч', 'Всего замеров',
  ];
  const wData = [wHdrs];
  wells.forEach((w) => {
    const lastM = lastMeasurement(measByWell, w.id);
    const measCnt = (measByWell[w.id] || []).length;
    wData.push([
      w.name || '', w.quarry || '', w.quarry_section || '', w.domain || '', w.status || '',
      w.depth ?? '', w.azimuth ?? '', w.inclination ?? '', w.drill_diameter ?? '', w.casing || '',
      fmtDate(w.drill_date), w.flow_after_drill ?? '',
      w.x_local ?? '', w.y_local ?? '', w.z_local ?? '', w.lat ?? '', w.lon ?? '',
      lastM ? fmtDate(lastM.measurement_date) : '', lastM ? (lastM.flow_rate ?? '') : '', measCnt,
    ]);
  });
  const ws1 = XLSX.utils.aoa_to_sheet(wData);
  ws1['!cols'] = [
    { wch: 14 }, { wch: 12 }, { wch: 16 }, { wch: 10 }, { wch: 12 },
    { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 14 },
    { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 },
    { wch: 14 }, { wch: 14 }, { wch: 12 },
  ];
  wHdrs.forEach((_, ci) => { const addr = XLSX.utils.encode_cell({ r: 0, c: ci }); if (ws1[addr]) ws1[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'D9E1F2' } } }; });

  const mHdrs = ['Скважина', 'Домен', 'Участок', 'Статус', 'Дата замера', 'Q, м³/ч', 'Сотрудник', 'Комментарий'];
  const mData = [mHdrs];
  wells.forEach((w) => {
    const meas = (measByWell[w.id] || []).slice().sort((a, b) => (a.measurement_date || '') < (b.measurement_date || '') ? -1 : 1);
    meas.forEach((m) => mData.push([w.name || '', w.domain || '', w.quarry_section || '', w.status || '', fmtDate(m.measurement_date), m.flow_rate ?? '', m.worker || '', m.comment || '']));
  });
  const ws2 = XLSX.utils.aoa_to_sheet(mData);
  ws2['!cols'] = [{ wch: 14 }, { wch: 10 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 36 }];
  mHdrs.forEach((_, ci) => { const addr = XLSX.utils.encode_cell({ r: 0, c: ci }); if (ws2[addr]) ws2[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'D9E1F2' } } }; });

  let activeN = 0, dryN = 0, dryingN = 0, totalQ = 0, measTotal = 0;
  const byDomain = {}, bySection = {}, byStatus = {};
  const depths = [];
  wells.forEach((w) => {
    if (w.status === 'Активная') activeN++;
    else if (w.status === 'Сухая') dryN++;
    else if (w.status === 'Иссякает') dryingN++;
    byStatus[w.status || '—'] = (byStatus[w.status || '—'] || 0) + 1;
    byDomain[w.domain || '—'] = (byDomain[w.domain || '—'] || 0) + 1;
    bySection[w.quarry_section || '—'] = (bySection[w.quarry_section || '—'] || 0) + 1;
    if (w.depth > 0) depths.push(w.depth);
    const lm = lastMeasurement(measByWell, w.id);
    if (lm && lm.flow_rate != null) totalQ += parseFloat(lm.flow_rate) || 0;
    measTotal += (measByWell[w.id] || []).length;
  });
  const avgDepth = depths.length ? Math.round((depths.reduce((a, b) => a + b, 0) / depths.length) * 10) / 10 : null;

  const summary = [
    ['Параметр', 'Значение'],
    ['Дата выгрузки', ts],
    ['Всего скважин', wells.length],
    ['Активных', activeN],
    ['Иссякает', dryingN],
    ['Сухих', dryN],
    ['Суммарный Q (посл. замеры), м³/ч', Math.round(totalQ * 100) / 100],
    ['Средняя глубина, м', avgDepth != null ? avgDepth : '—'],
    ['Всего замеров в БД', measTotal],
    [],
    ['Статус', 'Скважин'],
    ...Object.keys(byStatus).sort().map((k) => [k, byStatus[k]]),
    [],
    ['Домен', 'Скважин'],
    ...Object.keys(byDomain).sort().map((k) => [k, byDomain[k]]),
    [],
    ['Участок', 'Скважин'],
    ...Object.keys(bySection).sort().map((k) => [k, bySection[k]]),
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(summary);
  ws3['!cols'] = [{ wch: 36 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'Скважины');
  XLSX.utils.book_append_sheet(wb, ws2, 'Замеры');
  XLSX.utils.book_append_sheet(wb, ws3, 'Сводка');
  XLSX.writeFile(wb, `skvazhiny-${ts}.xlsx`);
}
