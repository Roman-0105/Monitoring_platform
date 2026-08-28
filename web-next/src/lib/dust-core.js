// Бизнес-логика журнала пылеподавления — точный порт расчётов из
// hydro-monitoring/ui-dustsuppression.js (_dustComputeVolume и т.д.), чтобы цифры
// совпадали со старым приложением. Работает напрямую со строками Supabase (snake_case).

export function computeVolume(log, vehicleById) {
  if (!log) return 0;
  if (log.is_manual_volume) return parseFloat(log.manual_volume) || 0;
  const vehicle = vehicleById[log.vehicle_id];
  if (!vehicle) return 0;
  return (parseFloat(log.trips) || 0) * (parseFloat(vehicle.capacity) || 0);
}

export function nozzleVolumeMonth(nozzleId, logs, vehicleById) {
  const now = new Date();
  const monthStart = now.toISOString().slice(0, 7) + '-01';
  const monthEnd = now.toISOString().slice(0, 10);
  return logs
    .filter((l) => l.nozzle_id === nozzleId && l.date >= monthStart && l.date <= monthEnd)
    .reduce((acc, l) => acc + computeVolume(l, vehicleById), 0);
}

// Корректное русское склонение (в отличие от старого приложения, которое не учитывало
// числа вида 11–14, 21, 111 и т.п.) — "1 запись", "2 записи", "5/11/21 записей/... ".
export function pluralRu(n, one, few, many) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

export function nozzleLabel(nozzle, sumps) {
  if (!nozzle) return '';
  const sump = nozzle.source_type === 'sump' && nozzle.source_id ? sumps.find((s) => s.id === nozzle.source_id) : null;
  return nozzle.name + (sump ? ` [${sump.name}]` : '');
}

// ── Экспорт в Excel: 3 листа (журнал, реестр машин, сводка по форсункам) ───────
export async function exportDustXLSX({ logs, orgs, vehicles, nozzles, sumps }) {
  const { loadXLSX } = await import('./xlsx-loader.js');
  const XLSX = await loadXLSX();

  const orgById = Object.fromEntries(orgs.map((o) => [o.id, o]));
  const vehicleById = Object.fromEntries(vehicles.map((v) => [v.id, v]));
  const nozzleById = Object.fromEntries(nozzles.map((n) => [n.id, n]));
  const sumpById = Object.fromEntries(sumps.map((s) => [s.id, s]));
  const ts = new Date().toISOString().slice(0, 10);

  function styleHeader(ws, headers) {
    headers.forEach((_, ci) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c: ci });
      if (ws[addr]) ws[addr].s = { font: { bold: true }, fill: { fgColor: { rgb: 'E2EFDA' } } };
    });
  }

  // Лист 1 — журнал
  const lHdrs = ['Дата', 'Организация', 'Машина', 'Гос. номер', 'Форсунка', 'Источник (зумпф)', 'Рейсов', 'Объём, м³', 'Примечание'];
  const lRows = [lHdrs];
  logs.slice().sort((a, b) => (b.date < a.date ? -1 : 1)).forEach((l) => {
    const org = orgById[l.org_id], vehicle = vehicleById[l.vehicle_id], nozzle = nozzleById[l.nozzle_id];
    const sump = nozzle && nozzle.source_type === 'sump' && nozzle.source_id ? sumpById[nozzle.source_id] : null;
    lRows.push([
      l.date, org ? org.name : '', vehicle ? vehicle.name : '', vehicle ? (vehicle.plate_number || '') : '',
      nozzle ? nozzle.name : '', sump ? sump.name : '', l.trips || '',
      Math.round(computeVolume(l, vehicleById) * 10) / 10, l.notes || '',
    ]);
  });
  const ws1 = XLSX.utils.aoa_to_sheet(lRows);
  ws1['!cols'] = [{ wch: 12 }, { wch: 20 }, { wch: 16 }, { wch: 12 }, { wch: 20 }, { wch: 18 }, { wch: 9 }, { wch: 12 }, { wch: 28 }];
  styleHeader(ws1, lHdrs);

  // Лист 2 — реестр машин
  const vHdrs = ['Машина', 'Гос. номер', 'Объём цистерны, м³', 'Организация', 'Форсунка по умолчанию'];
  const vRows = [vHdrs];
  vehicles.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).forEach((v) => {
    const org = orgById[v.org_id], nozzle = v.default_nozzle_id ? nozzleById[v.default_nozzle_id] : null;
    vRows.push([v.name, v.plate_number || '', v.capacity ?? '', org ? org.name : '', nozzle ? nozzle.name : '']);
  });
  const ws2 = XLSX.utils.aoa_to_sheet(vRows);
  ws2['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 22 }, { wch: 22 }];
  styleHeader(ws2, vHdrs);

  // Лист 3 — сводка по форсункам
  const byNozzle = {};
  logs.forEach((l) => {
    const nid = l.nozzle_id || '_none';
    if (!byNozzle[nid]) byNozzle[nid] = { trips: 0, vol: 0 };
    byNozzle[nid].trips += parseFloat(l.trips) || 0;
    byNozzle[nid].vol += computeVolume(l, vehicleById);
  });
  const sHdrs = ['Форсунка', 'Источник (зумпф)', 'Всего рейсов', 'Объём, м³'];
  const sRows = Object.keys(byNozzle).map((nid) => {
    const nozzle = nid !== '_none' ? nozzleById[nid] : null;
    const sump = nozzle && nozzle.source_type === 'sump' && nozzle.source_id ? sumpById[nozzle.source_id] : null;
    return [nozzle ? nozzle.name : 'Не указана', sump ? sump.name : '', byNozzle[nid].trips, Math.round(byNozzle[nid].vol * 10) / 10];
  }).sort((a, b) => (b[3] || 0) - (a[3] || 0));
  const ws3 = XLSX.utils.aoa_to_sheet([sHdrs, ...sRows]);
  ws3['!cols'] = [{ wch: 22 }, { wch: 18 }, { wch: 14 }, { wch: 12 }];
  styleHeader(ws3, sHdrs);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws1, 'Журнал');
  XLSX.utils.book_append_sheet(wb, ws2, 'Машины');
  XLSX.utils.book_append_sheet(wb, ws3, 'Сводка по форсункам');
  XLSX.writeFile(wb, 'pylepodavlenie-' + ts + '.xlsx');
}
