// Общая логика страницы «Аналитика» — порт вычислений из hydro-monitoring/ui-stats.js,
// не привязанный к DOM (в отличие от оригинала, который писал innerHTML напрямую).

export function formatMonitoringDate(dateStr) {
  if (!dateStr) return '—';
  const s = String(dateStr);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function shortMonitoringDate(dateStr) {
  return formatMonitoringDate(dateStr).replace(/\s\d{4}/, '');
}

// Как formatMonitoringDate/shortMonitoringDate, но с временем — для почасовых
// показаний (VWP-датчики). Принимает и "YYYY-MM-DD HH:MM:SS" (пробел — так его
// отдаёт Excel-импорт), и ISO с "T".
export function formatMonitoringDateTime(dtStr) {
  if (!dtStr) return '—';
  const s = String(dtStr).replace(' ', 'T');
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(dtStr);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function shortMonitoringDateTime(dtStr) {
  if (!dtStr) return '—';
  const s = String(dtStr).replace(' ', 'T');
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(dtStr);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
    + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function lpsToM3h(lps) {
  const n = parseFloat(lps);
  return Number.isNaN(n) ? null : n * 3.6;
}

// Catmull-Rom сглаженный путь по точкам [{x,y}, ...] — для спарклайнов и линий трендов.
export function smoothPath(points) {
  if (!points.length) return '';
  if (points.length === 1) return `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  let d = `M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

export function sparkPoints(values, w, h) {
  if (!values.length) return [];
  const max = Math.max(...values) || 1;
  const step = w / Math.max(values.length - 1, 1);
  return values.map((v, i) => ({ x: i * step, y: (1 - v / max) * h * 0.85 + h * 0.075 }));
}

const CSV_HEADERS = [
  'Номер точки', 'Дата мониторинга', 'Сотрудник', 'Статус', 'Интенсивность',
  'Дебит л/с', 'Дебит м³/ч', 'Цвет воды', 'Борт', 'Домен', 'Горизонт', 'Метод замера',
  'X локальный', 'Y локальный', 'Широта', 'Долгота', 'Комментарий', 'Есть фото', 'Создана',
];

function pointRow(p) {
  let monDate = p.monitoring_date || '';
  if (monDate.length >= 10 && monDate.indexOf('-') === 4) {
    monDate = monDate.slice(8, 10) + '.' + monDate.slice(5, 7) + '.' + monDate.slice(0, 4);
  }
  const flowLps = p.flow_rate != null ? String(p.flow_rate) : '';
  const flowM3h = p.flow_rate != null ? lpsToM3h(p.flow_rate).toFixed(3) : '';
  return [
    p.point_number || '', monDate, p.worker || '', p.status || '', p.intensity || '',
    flowLps, flowM3h, p.water_color || '', p.wall || '', p.domain || '', p.horizon || '', p.measure_method || '',
    p.x_local != null ? p.x_local : '', p.y_local != null ? p.y_local : '',
    p.lat != null ? p.lat : '', p.lon != null ? p.lon : '',
    p.comment || '', (p.photos && p.photos.length) ? 'Да' : 'Нет',
    p.created_at ? formatMonitoringDate(p.created_at) : '',
  ];
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /["\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function timestamp() {
  const now = new Date();
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportPointsCsv(points) {
  if (!points || !points.length) return;
  const rows = [CSV_HEADERS, ...points.map(pointRow)];
  const csv = rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }), `karyer-analytics-${timestamp()}.csv`);
}

export async function exportPointsXlsx(points) {
  if (!points || !points.length) return;
  const { loadXLSX } = await import('./xlsx-loader.js');
  const XLSX = await loadXLSX();
  const ts = timestamp();

  const data = [CSV_HEADERS, ...points.map(pointRow)];
  const ws1 = XLSX.utils.aoa_to_sheet(data);
  ws1['!cols'] = [
    { wch: 12 }, { wch: 16 }, { wch: 20 }, { wch: 14 }, { wch: 20 },
    { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 22 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 30 }, { wch: 10 }, { wch: 18 },
  ];
  CSV_HEADERS.forEach((_, ci) => {
    const addr = XLSX.utils.encode_cell({ r: 0, c: ci });
    if (ws1[addr]) ws1[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'D9E1F2' } } };
  });

  const byStatus = {}, byDomain = {};
  let totalFlow = 0, withFlow = 0, active = 0;
  points.forEach((p) => {
    const s = p.status || 'Неизвестно';
    const d = p.domain || '—';
    byStatus[s] = (byStatus[s] || 0) + 1;
    byDomain[d] = (byDomain[d] || 0) + 1;
    const f = parseFloat(p.flow_rate);
    if (!Number.isNaN(f)) { totalFlow += f; withFlow++; }
    if (p.status === 'Активная' || p.status === 'Паводковая' || p.status === 'Перелив') active++;
  });

  const summary = [
    ['Параметр', 'Значение'],
    ['Дата выгрузки', ts],
    ['Всего точек', points.length],
    ['Активных точек', active],
    ['Суммарный дебит, л/с', Math.round(totalFlow * 100) / 100],
    ['Суммарный дебит, м³/ч', Math.round(lpsToM3h(totalFlow) * 100) / 100],
    ['Средний дебит, л/с', withFlow ? Math.round(totalFlow / withFlow * 100) / 100 : '—'],
    [],
    ['Статус', 'Количество'],
    ...Object.keys(byStatus).sort().map((s) => [s, byStatus[s]]),
    [],
    ['Домен', 'Количество'],
    ...Object.keys(byDomain).sort().map((d) => [d, byDomain[d]]),
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(summary);
  ws2['!cols'] = [{ wch: 30 }, { wch: 16 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'Точки');
  XLSX.utils.book_append_sheet(wb, ws2, 'Сводка');
  XLSX.writeFile(wb, `karyer-analytics-${ts}.xlsx`);
}
