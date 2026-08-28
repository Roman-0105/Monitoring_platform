import { supabase } from './supabase.js';

const FALLBACK_BOUNDS = { xMin: 45850, xMax: 47350, yMin: 15800, yMax: 17350 };
let cache = null;

export async function getQuarryBounds(name) {
  if (!cache) {
    const { data, error } = await supabase.from('quarries').select('*');
    cache = error ? [] : (data || []);
  }
  const q = cache.find((r) => r.name === name);
  if (q && q.x_min != null && q.x_max != null && q.y_min != null && q.y_max != null) {
    return { xMin: q.x_min, xMax: q.x_max, yMin: q.y_min, yMax: q.y_max };
  }
  return FALLBACK_BOUNDS;
}

// Локальные координаты → проценты (0..100) внутри охвата карьера — для позиционирования
// маркеров поверх схемы без растрового фона (сама схема пока не перенесена в пилот).
export function xyToPercent(x, y, bounds) {
  return {
    left: (x - bounds.xMin) / (bounds.xMax - bounds.xMin) * 100,
    top: (bounds.yMax - y) / (bounds.yMax - bounds.yMin) * 100,
  };
}
