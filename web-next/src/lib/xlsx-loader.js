// SheetJS — грузится динамически (как Leaflet в leaflet-loader.js), ожидает window.XLSX.
let _promise = null;

export function loadXLSX() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (_promise) return _promise;
  _promise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => resolve(window.XLSX);
    s.onerror = () => reject(new Error('Не удалось загрузить библиотеку Excel'));
    document.head.appendChild(s);
  });
  return _promise;
}
