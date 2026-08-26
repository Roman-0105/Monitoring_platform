// Массовая загрузка замеров УПВ (глубина до воды) через Excel-шаблон.
// Тот же принцип, что в hydro-monitoring/ui-dewatering.js (шаблон уровней
// воды по зумпфам) и в vwp-import.js: даты сверху вниз (строки), скважины
// слева направо (столбцы). Пустая ячейка = этот замер не трогаем.

function pad2(n) { return String(n).length < 2 ? '0' + n : String(n); }

export async function downloadWellLevelsTemplate(wells) {
  if (!wells || !wells.length) throw new Error('Нет скважин для шаблона');
  const { loadXLSX } = await import('./xlsx-loader.js');
  const XLSX = await loadXLSX();

  const sorted = wells.slice().sort((a, b) => (a.name || a.code || '').localeCompare(b.name || b.code || '', 'ru'));
  const headerRow = ['Дата (ГГГГ-ММ-ДД)'].concat(sorted.map((w) => w.name || w.code));
  const codeRow = ['Код →'].concat(sorted.map((w) => w.code || ''));
  const now = new Date();
  const exampleDate = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const exampleRow = ['#ПРИМЕР ' + exampleDate].concat(sorted.map((_, i) => (i === 0 ? 12.34 : '')));

  const rows = [
    ['Шаблон замеров УПВ (глубина до воды, м) — одна строка = одна дата, один столбец = одна скважина. Пустая ячейка — этот замер не трогаем.'],
    codeRow,
    headerRow,
    exampleRow,
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 16 }].concat(sorted.map(() => ({ wch: 14 })));
  ws['!freeze'] = { xSplit: 1, ySplit: 3, topLeftCell: 'B4', activePane: 'bottomRight', state: 'frozen' };
  XLSX.utils.book_append_sheet(wb, ws, 'Замеры УПВ');

  const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbOut], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'well_levels_template.xlsx';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// Дата могла прийти как JS Date (Excel сам распознал), серийное число или
// текст "ГГГГ-ММ-ДД" / "ДД.ММ.ГГГГ" — тот же разбор, что в старом приложении
// (_dewParseImportDate из ui-dewatering.js).
function parseImportDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  const str = String(v).trim();
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(str)) {
    const p = str.split('.');
    return `${p[2]}-${p[1]}-${p[0]}`;
  }
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// Возвращает готовые к upsert строки wp_well_levels — совпадение по
// (скважина, дата) с уже имеющимися замерами решает, обновляем или создаём.
export async function parseWellLevelsImportFile(file, wells, byWellDate) {
  const { loadXLSX } = await import('./xlsx-loader.js');
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  if (rows.length < 4) throw new Error('Файл пустой или не похож на шаблон');

  const headers = rows[2].map((h) => String(h).trim());
  const dataRows = rows.slice(3).filter((r) => r[0] && String(r[0]).trim() && String(r[0]).trim().charAt(0) !== '#');

  const wellCols = [];
  const unknownCols = [];
  for (let ci = 1; ci < headers.length; ci++) {
    const name = headers[ci];
    if (!name) continue;
    const well = wells.find((w) => (w.name || w.code) === name);
    if (well) wellCols.push({ col: ci, well });
    else unknownCols.push(name);
  }
  if (!wellCols.length) throw new Error('Не найдено ни одной знакомой колонки-скважины. Скачайте актуальный шаблон заново.');

  const outRows = [];
  let created = 0, updated = 0, errors = 0;
  dataRows.forEach((row) => {
    const isoDate = parseImportDate(row[0]);
    if (!isoDate) { errors++; return; }
    wellCols.forEach((wc) => {
      const raw = row[wc.col];
      if (raw === undefined || raw === null || raw === '') return;
      const val = typeof raw === 'number' ? raw : parseFloat(String(raw).trim().replace(',', '.'));
      if (Number.isNaN(val)) { errors++; return; }
      const existing = (byWellDate[wc.well.id] || {})[isoDate];
      // Все объекты в одном bulk-запросе к PostgREST обязаны иметь одинаковый
      // набор ключей (иначе "All object keys must match" — PGRST102), поэтому
      // id проставляем всегда, а не только для обновляемых строк.
      const id = existing ? existing.id : crypto.randomUUID();
      outRows.push({ id, well_id: wc.well.id, date: isoDate, depth_to_water: val });
      if (existing) updated++; else created++;
    });
  });

  return { rows: outRows, created, updated, errors, unknownCols };
}
