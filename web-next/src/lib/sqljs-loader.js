// sql.js (WASM SQLite) — грузится динамически, как X6/PDF.js/Three (см. x6-loader.js,
// pdfjs-loader.js, pit3d-core.js). Нужен только для чтения .tridb-файлов (Micromine),
// которые физически являются файлами SQLite с BLOB-геометрией меша.
const SQLJS_VERSION = '1.10.3';
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

export function loadSqlJs() {
  if (window._sqlJsInstance) return Promise.resolve(window._sqlJsInstance);
  if (_promise) return _promise;
  const base = `https://cdnjs.cloudflare.com/ajax/libs/sql.js/${SQLJS_VERSION}/`;
  _promise = loadScript(base + 'sql-wasm.js').then(() =>
    window.initSqlJs({ locateFile: (f) => base + f }).then((SQL) => {
      window._sqlJsInstance = SQL;
      return SQL;
    })
  );
  return _promise;
}
