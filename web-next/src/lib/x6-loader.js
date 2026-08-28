// AntV X6 (граф/диаграммы) + dagre (авто-раскладка) — без ESM-сборки,
// грузятся как глобальные script-теги, как Leaflet/Three (см. leaflet-loader.js,
// pit3d-core.js loadThree). Те же CDN-адреса, что в hydro-monitoring/index.html.
let _promise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить ' + src));
    document.head.appendChild(s);
  });
}

export function loadX6() {
  if (window.X6 && window.dagre) return Promise.resolve();
  if (_promise) return _promise;
  _promise = loadScript('https://unpkg.com/dagre/dist/dagre.min.js')
    .then(() => loadScript('https://unpkg.com/@antv/x6/dist/x6.min.js'));
  return _promise;
}
