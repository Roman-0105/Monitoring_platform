// Бизнес-логика расчёта объёмов водоотлива — точный порт из hydro-monitoring/ui-dewatering.js
// (DewateringState.computedVolume/getDistributions + _dewAnlFinalVolume), чтобы цифры в новом
// интерфейсе совпадали с прежним приложением. Работает со "снятыми" (JS-camelCase) записями.

// Последняя запись ДО date, которая реально что-то говорит о показании счётчика
// (не остановлена и есть либо reading, либо это сброс) — так дни простоя не ломают разницу.
export function lastActualReading(readings, pumpId, date) {
  const candidates = readings
    .filter((r) => r.pumpId === pumpId && r.date < date && !r.isStopped && (r.reading != null || r.isReset))
    .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : 0));
  return candidates.length ? candidates[0] : null;
}

export function getDistributions(rec) {
  if (rec.distributions && rec.distributions.length) return rec.distributions;
  if (rec.destinationId) return [{ destinationId: rec.destinationId, pct: 100 }];
  return [];
}

export function computedVolume(readings, rec) {
  if (!rec) return null;
  if (rec.isStopped) return 0;
  if (rec.isManualVolume) return parseFloat(rec.manualVolume) || 0;
  if (rec.isReset) {
    const endReading = parseFloat(rec.manualVolume);
    return Number.isNaN(endReading) ? 0 : Math.max(0, endReading - (parseFloat(rec.resetStartValue) || 0));
  }
  const prev = lastActualReading(readings, rec.pumpId, rec.date);
  if (!prev) return null;
  const baseVal = prev.isReset
    ? (prev.manualVolume != null ? parseFloat(prev.manualVolume) : (parseFloat(prev.resetStartValue) || 0))
    : parseFloat(prev.reading);
  const diff = parseFloat(rec.reading) - baseVal;
  return diff >= 0 ? diff : null;
}

// Объём, идущий ТОЛЬКО в финальные направления (не intermediate_sump) — исключает двойной
// счёт у насосов-перекачивателей между зумпфами.
export function finalVolume(readings, destinations, rec) {
  const total = computedVolume(readings, rec);
  if (!total) return 0;
  const dists = getDistributions(rec);
  if (!dists.length) return total;
  let finalPct = 0;
  dists.forEach((d) => {
    const dest = d.destinationId ? destinations.find((x) => x.id === d.destinationId) : null;
    if (!dest || dest.type !== 'intermediate_sump') finalPct += d.pct || 0;
  });
  return finalPct >= 100 ? total : total * finalPct / 100;
}

// Агрегирует объём по рёбрам "насос → куда" (терминальное направление или другой зумпф,
// если направление — intermediate_sump) — единый источник данных для схемы водного баланса.
// Точный порт _dewDiagramComputeFlows из hydro-monitoring/ui-dewatering.js: volTotal — за всё
// время (не зависит от периода, определяет толщину линии), volDate — только записи в [dateFrom;dateTo].
export function computeFlows(readings, destinations, dateFrom, dateTo) {
  const flows = {};
  readings.forEach((r) => {
    const vol = computedVolume(readings, r);
    if (!vol) return;
    const dists = getDistributions(r);
    if (!dists.length) return;
    const inRange = dateFrom && dateTo && r.date >= dateFrom && r.date <= dateTo;
    dists.forEach((d) => {
      if (!d.destinationId) return;
      const dest = destinations.find((x) => x.id === d.destinationId);
      if (!dest) return;
      const targetNodeId = dest.type === 'intermediate_sump' && dest.target_sump_id
        ? 'smp_' + dest.target_sump_id
        : 'dst_' + dest.id;
      const key = r.pumpId + '→' + targetNodeId;
      const share = vol * (d.pct || 0) / 100;
      if (!flows[key]) flows[key] = { pumpId: r.pumpId, targetNodeId, volDate: 0, volTotal: 0 };
      flows[key].volTotal += share;
      if (inRange) flows[key].volDate += share;
    });
  });
  return flows;
}

export const PUMP_STATUS = {
  working: { label: 'В работе', color: '#2F8F52', badge: 'success' },
  standby: { label: 'Резерв', color: '#2E6DAE', badge: 'info' },
  repair:  { label: 'Ремонт', color: '#C08420', badge: 'warning' },
  off:     { label: 'Отключён', color: '#857A6B', badge: 'default' },
};

export const DEST_TYPES = [
  { value: 'zif', label: 'ЗИФ', color: '#2E6DAE' },
  { value: 'settler', label: 'Отстойник', color: '#7C5CBF' },
  { value: 'reservoir', label: 'Водоём', color: '#1E9BA8' },
  { value: 'relief', label: 'Рельеф', color: '#857A6B' },
  { value: 'intermediate_sump', label: 'Промежуточный зумпф', color: '#C08420' },
  { value: 'internal', label: 'Внутреннее использование', color: '#2F8F52' },
  { value: 'reuse', label: 'Повторное использование', color: '#B5851C' },
  { value: 'outside', label: 'За пределы участка', color: '#B5301B' },
];
export function destTypeInfo(type) { return DEST_TYPES.find((t) => t.value === type) || DEST_TYPES[0]; }
export function totalVolumePump(readings, pumpId) {
  return readings.filter((r) => r.pumpId === pumpId).reduce((acc, r) => acc + (computedVolume(readings, r) || 0), 0);
}
export function distColor(sum) {
  if (sum === 0) return 'var(--text-tertiary)';
  if (Math.round(sum) === 100) return 'var(--green-600)';
  if (sum > 100) return 'var(--red-500)';
  return 'var(--amber-600)';
}
