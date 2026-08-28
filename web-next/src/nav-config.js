// Новая, перегруппированная структура навигации (по доменам, а не по историческому порядку
// добавления разделов). "pilot: true" — раздел реализован в этой пилотной сборке;
// остальные показывают заглушку "скоро в новом дизайне".
export const NAV_SECTIONS = [
  {
    items: [
      { key: 'overview', label: 'Обзор', icon: 'LayoutDashboard', pilot: true },
    ],
  },
  {
    label: 'Водопроявления',
    items: [
      { key: 'map', label: 'Карта', icon: 'Map', pilot: true },
      { key: 'points', label: 'Список точек', icon: 'MapPinned', pilot: true },
      { key: 'wpmap', label: 'Карта водопунктов', icon: 'Waypoints', pilot: true },
      { key: 'stats', label: 'Аналитика', icon: 'BarChart3', pilot: true },
      { key: 'report', label: 'Отчёт', icon: 'FileText', pilot: false },
    ],
  },
  {
    label: 'Скважины и водопункты',
    items: [
      { key: 'registry', label: 'Реестр водопунктов', icon: 'Database', pilot: true },
      { key: 'wells', label: 'Гор. скважины', icon: 'GitCommitHorizontal', pilot: true },
      { key: 'well-levels', label: 'Замеры УПВ', icon: 'Droplets', pilot: true },
    ],
  },
  {
    label: 'Водоотлив и пылеподавление',
    items: [
      { key: 'dewatering', label: 'Журнал Водоотлива', icon: 'Waves', pilot: true },
      { key: 'dust', label: 'Журнал Пылеподавления', icon: 'Wind', pilot: true },
      { key: 'sump-forecast', label: 'Прогноз зумпфов', icon: 'TrendingUp', pilot: true },
    ],
  },
  {
    label: '3D-модель',
    items: [
      { key: 'pit3d', label: 'Модель карьера', icon: 'Box', pilot: true },
    ],
  },
  {
    label: 'Качество воды',
    items: [
      { key: 'chem', label: 'Хим. мониторинг', icon: 'FlaskConical', pilot: true },
    ],
  },
  {
    label: 'Риски',
    items: [
      { key: 'risks', label: 'Фиксация рисков', icon: 'ShieldAlert', external: true },
    ],
  },
  {
    label: 'Система',
    items: [
      { key: 'settings', label: 'Настройки', icon: 'Settings', pilot: true },
      { key: 'diag', label: 'Диагностика', icon: 'Activity', pilot: true },
      // Не участвует в role_permissions — видимость решается жёсткой проверкой
      // role === 'super_admin' в App.js, а не матрицей доступа.
      { key: 'roles', label: 'Роли и доступ', icon: 'ShieldCheck', pilot: true, superAdminOnly: true },
    ],
  },
];
