// Утилиты для списка точек — порт логики getFilteredPoints/getLatestByPointNumber из hydro-monitoring.

// Оставляет только последний (по дате замера) замер на каждый номер точки.
// Точки должны быть предварительно отсортированы по убыванию даты — тогда
// первое вхождение номера в проходе и есть последний замер.
export function getLatestByPointNumber(points) {
  const sorted = [...points].sort((a, b) => {
    const da = a.monitoring_date || a.created_at || '';
    const db = b.monitoring_date || b.created_at || '';
    return da < db ? 1 : da > db ? -1 : 0;
  });
  const seen = new Set();
  const out = [];
  sorted.forEach((p) => {
    if (seen.has(p.point_number)) return;
    seen.add(p.point_number);
    out.push(p);
  });
  return out;
}

export function matchesSearch(p, search) {
  if (!search) return true;
  const s = search.toLowerCase();
  const hay = [p.point_number, p.worker, p.comment, p.domain, p.wall, p.status, p.water_color]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(s);
}

export function flowToM3h(flowRate) {
  const n = parseFloat(flowRate);
  return (!Number.isNaN(n) && flowRate != null) ? (n * 3.6).toFixed(2) : null;
}

export function getAllDates(points) {
  const set = new Set();
  points.forEach((p) => { const d = (p.monitoring_date || '').slice(0, 10); if (d) set.add(d); });
  return Array.from(set).sort().reverse();
}
