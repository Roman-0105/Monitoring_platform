// Точный порт стилей отрисовки из hydro-monitoring/map.js (MAP_STYLE, режим "combined"):
// цвет маркера — по статусу, размер — по интенсивности.
export const STATUS_COLORS = {
  'Новая': '#1a73e8', 'Активная': '#34a853', 'Иссякает': '#f9ab00', 'Искакает': '#f9ab00',
  'Пересохла': '#ea4335', 'Паводковая': '#7c3aed', 'Перелив': '#0891b2',
};
export const DITCH_STATUS_COLORS = {
  'Активная': '#4090e8', 'Новая': '#40b8ff', 'Иссякает': '#f9ab00', 'Пересохла': '#e8a030', 'Заилилась': '#8060c0',
};
const INTENSITY_SIZES = { 'Слабая (капёж)': 4.5, 'Умеренная': 7, 'Сильная (поток)': 10.5, 'Очень сильная': 14 };
const MIN_MARKER = 4, MAX_MARKER = 16;

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

export function markerRadius(intensity, scale) {
  const s = scale > 0 ? scale : 1;
  const screenR = clamp(INTENSITY_SIZES[intensity] || 5.5, MIN_MARKER, MAX_MARKER);
  return screenR / s;
}

export const MARKER_MODES = [
  { value: 'combined', label: 'Статус + интенс.' },
  { value: 'status', label: 'По статусу' },
  { value: 'intensity', label: 'По интенсивности' },
  { value: 'simple', label: 'Единый цвет' },
];
const SIMPLE_COLOR = '#B5851C';

// Возвращает {color, size, badgeColor} для точки в заданном режиме отображения.
export function getMarkerStyle(point, mode, scale) {
  const status = point.status || 'Новая';
  const intensity = point.intensity || '';
  if (mode === 'status') {
    return { color: STATUS_COLORS[status] || '#666', size: markerRadius('', scale), badgeColor: null };
  }
  if (mode === 'intensity') {
    return { color: SIMPLE_COLOR, size: markerRadius(intensity, scale), badgeColor: null };
  }
  if (mode === 'simple') {
    return { color: SIMPLE_COLOR, size: markerRadius('', scale), badgeColor: null };
  }
  // combined (по умолчанию)
  return { color: STATUS_COLORS[status] || '#888888', size: markerRadius(intensity, scale), badgeColor: null };
}
