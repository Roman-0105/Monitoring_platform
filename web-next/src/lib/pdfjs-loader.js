// pdf.js — грузится динамически, как X6/Leaflet/Three (см. x6-loader.js, leaflet-loader.js).
// Используется только для растеризации первой страницы PDF при загрузке плана участка
// (dewatering-diagram-core.js) — сам PDF не рендерится, картинка нужна только как фон схемы.
const PDFJS_VERSION = '3.11.174';
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

export function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (_promise) return _promise;
  _promise = loadScript(`https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.js`).then(() => {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.js`;
    return window.pdfjsLib;
  });
  return _promise;
}
