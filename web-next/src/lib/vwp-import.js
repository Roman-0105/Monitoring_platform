// Массовая загрузка почасовых показаний датчиков VWP через Excel-шаблон.
// Тот же принцип, что и в hydro-monitoring/ui-dewatering.js (шаблон замеров
// уровня воды по зумпфам): колонка на каждую сущность (здесь — датчик конкретной
// скважины), строка на дату-время. Пустая ячейка = этот замер не трогаем.

function pad2(n) { return String(n).length < 2 ? '0' + n : String(n); }

function sensorColumns(piezoWells) {
  const cols = [];
  (piezoWells || []).forEach((w) => {
    (w.sensors || []).forEach((s) => {
      if (!s || !s.id) return;
      cols.push({ well: w, sensor: s, header: s.name || s.id });
    });
  });
  return cols;
}

export async function downloadVwpTemplate(piezoWells) {
  const cols = sensorColumns(piezoWells);
  if (!cols.length) throw new Error('Нет пьезометрических скважин с датчиками VWP');
  const { loadXLSX } = await import('./xlsx-loader.js');
  const XLSX = await loadXLSX();

  const fixedHeaders = ['Дата и время (ГГГГ-ММ-ДД ЧЧ:ММ:СС)', 'Примечание'];
  const wellRow = ['Скважина →', ''].concat(cols.map((c) => c.well.name));
  const headerRow = fixedHeaders.concat(cols.map((c) => c.header));
  const now = new Date();
  const exampleDt = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} 12:00:00`;
  const exampleRow = ['#ПРИМЕР ' + exampleDt, 'пример'].concat(cols.map((_, i) => (i === 0 ? 3.2 : '')));

  const rows = [
    ['Шаблон показаний VWP — данные собираются почасово. Одна строка = одна дата-время, один столбец = один датчик. Пустая ячейка — этот замер не трогаем.'],
    wellRow,
    headerRow,
    exampleRow,
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 24 }, { wch: 18 }].concat(cols.map(() => ({ wch: 16 })));
  ws['!freeze'] = { xSplit: 2, ySplit: 3, topLeftCell: 'C4', activePane: 'bottomRight', state: 'frozen' };

  const merges = [];
  let ci = 2;
  while (ci < wellRow.length) {
    let cj = ci;
    while (cj + 1 < wellRow.length && wellRow[cj + 1] === wellRow[ci]) cj++;
    if (cj > ci) merges.push({ s: { r: 1, c: ci }, e: { r: 1, c: cj } });
    ci = cj + 1;
  }
  if (merges.length) ws['!merges'] = merges;

  XLSX.utils.book_append_sheet(wb, ws, 'Показания VWP');
  const wbOut = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([wbOut], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'vwp_readings_template.xlsx';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// Дата-время в ячейке могла быть распознана Excel как JS Date (обычный случай
// при cellDates:true), прийти серийным числом (редко, но на всякий случай),
// или остаться текстом "ГГГГ-ММ-ДД ЧЧ:ММ:СС" / "ДД.ММ.ГГГГ ЧЧ:ММ", если ячейку
// явно ввели как текст.
function parseImportDateTime(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}T${pad2(v.getHours())}:${pad2(v.getMinutes())}:${pad2(v.getSeconds())}`;
  }
  if (typeof v === 'number') {
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  }
  const str = String(v).trim();
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`;
  m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})[ ,]+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || '00'}`;
  m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T00:00:00`;
  return null;
}

// Разбирает загруженный файл и возвращает готовые к upsert строки
// well_sensor_readings — совпадение по (скважина, датчик, дата-время) с уже
// имеющимися показаниями решает, создаём новую запись или обновляем старую.
export async function parseVwpImportFile(file, piezoWells, existingReadings) {
  const { loadXLSX } = await import('./xlsx-loader.js');
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  if (rows.length < 4) throw new Error('Файл пустой или не похож на шаблон');

  const headers = rows[2].map((h) => String(h).trim());
  const dataRows = rows.slice(3).filter((r) => r[0] && String(r[0]).trim() && String(r[0]).trim().charAt(0) !== '#');

  const cols = sensorColumns(piezoWells);
  const sensorCols = [];
  const unknownCols = [];
  for (let ci = 2; ci < headers.length; ci++) {
    const name = headers[ci];
    if (!name) continue;
    const match = cols.find((c) => c.header === name);
    if (match) sensorCols.push({ col: ci, well: match.well, sensor: match.sensor });
    else unknownCols.push(name);
  }
  if (!sensorCols.length) throw new Error('Не найдено ни одной знакомой колонки-датчика. Скачайте актуальный шаблон заново.');

  const key = (wellId, sensorId, dt) => `${wellId}__${sensorId}__${dt}`;
  const existingMap = new Map();
  (existingReadings || []).forEach((r) => existingMap.set(key(r.well_id, r.sensor_id, r.date), r));

  const outRows = [];
  let created = 0, updated = 0, errors = 0;
  dataRows.forEach((row) => {
    const dt = parseImportDateTime(row[0]);
    if (!dt) { errors++; return; }
    const notes = row[1] == null ? '' : String(row[1]).trim();
    sensorCols.forEach((sc) => {
      const raw = row[sc.col];
      if (raw === undefined || raw === null || raw === '') return;
      const val = typeof raw === 'number' ? raw : parseFloat(String(raw).trim().replace(',', '.'));
      if (Number.isNaN(val)) { errors++; return; }
      const existing = existingMap.get(key(sc.well.id, sc.sensor.id, dt));
      outRows.push({
        id: existing ? existing.id : ('wsr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + outRows.length),
        well_id: sc.well.id, sensor_id: sc.sensor.id, date: dt,
        level_above_sensor: val, notes: notes || null,
      });
      if (existing) updated++; else created++;
    });
  });

  return { rows: outRows, created, updated, errors, unknownCols };
}
