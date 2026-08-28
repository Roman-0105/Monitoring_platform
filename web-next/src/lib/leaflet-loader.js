// Leaflet + marker-cluster — грузится динамически, как Three.js для pit3d
// (см. pit3d-core.js loadThree) — библиотека без ESM-сборки, ожидает
// глобальный window.L и собственные CSS-файлы.
let _promise = null;

function loadCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить ' + src));
    document.head.appendChild(s);
  });
}

export function loadLeaflet() {
  if (window.L && window.L.markerClusterGroup) return Promise.resolve();
  if (_promise) return _promise;

  loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css');
  loadCss('https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css');
  loadCss('https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css');

  _promise = loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js')
    .then(() => loadScript('https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js'));
  return _promise;
}
