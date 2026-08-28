// Приглушённая «минеральная» палитра под фирменные цвета сайта (не неоновые
// веб-цвета) — расширяет тот же набор, что использовался в схематичной версии
// этой карты (см. историю WpMap.js), плюс акцентное золото для канав.
export const WP_TYPES = {
  well_obs: { label: 'Наблюдательная скважина', short: 'Набл. скважина', badge: 'info', color: '#2E6DAE', shape: 'circle' },
  well_exp: { label: 'Эксплуатационная скважина', short: 'Эксп. скважина', badge: 'success', color: '#2F8F52', shape: 'square' },
  sump:     { label: 'Зумпф', short: 'Зумпф', badge: 'warning', color: '#C08420', shape: 'diamond' },
  pond:     { label: 'Накопитель / пруд', short: 'Накопитель', badge: 'default', color: '#7C5CBF', shape: 'triangle' },
  seep:     { label: 'Водопроявление / родник', short: 'Водопроявление', badge: 'accent', color: '#1E9BA8', shape: 'hexagon' },
  ditch:    { label: 'Дренажная канава', short: 'Канава', badge: 'default', color: '#B5851C', shape: 'circle' },
  other:    { label: 'Прочее', short: 'Прочее', badge: 'default', color: '#857A6B', shape: 'circle' },
};

export const WP_SHAPE_OPTIONS = ['circle', 'square', 'diamond', 'triangle', 'hexagon'];
export const WP_SHAPE_LABELS = { circle: 'Круг', square: 'Квадрат', diamond: 'Ромб', triangle: 'Треугольник', hexagon: 'Шестиугольник' };
export const WPM_SETTINGS_KEY = 'wpm-type-settings';

export function loadWpTypeSettings() {
  try {
    const raw = localStorage.getItem(WPM_SETTINGS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.keys(saved).forEach((k) => { if (WP_TYPES[k]) Object.assign(WP_TYPES[k], saved[k]); });
  } catch (e) { /* ignore */ }
}
export function saveWpTypeSettings() {
  try {
    const out = {};
    Object.keys(WP_TYPES).forEach((k) => { out[k] = { color: WP_TYPES[k].color, shape: WP_TYPES[k].shape }; });
    localStorage.setItem(WPM_SETTINGS_KEY, JSON.stringify(out));
  } catch (e) { /* ignore */ }
}
