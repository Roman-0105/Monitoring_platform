/* Диагностика для удалённой отладки.
 *
 * Раньше баг был виден только тому, кто сидит перед экраном — необработанное
 * исключение молча падает в devtools-консоль, и о нём узнают, только если
 * кто-то догадался её открыть и прислать скриншот. Здесь два инструмента:
 *
 * 1. Баннер об ошибке — ловит window.onerror / unhandledrejection и
 *    показывает их прямо на странице, пока не закроют вручную (не тост,
 *    который сам исчезнет через 3 секунды).
 * 2. Кнопка "🩺 Диагностика" в шапке — снимок состояния приложения
 *    (RiskApi, карта, недавние ошибки) одним кликом в буфер обмена, вместо
 *    того чтобы вручную набирать код в консоли по просьбе разработчика.
 *
 * Специально не зависит от ui-utils.js (грузится раньше него в index.html,
 * чтобы ловить ошибки как можно раньше, включая сбои самого ui-utils.js) —
 * поэтому у рендеринга баннера свой минимальный escape, а не escHTML.
 */

function diagEscHTML(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

var ErrorLog = (function() {
  var entries = [];

  function add(entry) {
    entries.push(entry);
    if (entries.length > 20) entries.shift(); // не даём расти бесконечно за долгую сессию
    renderBanner();
  }
  function getAll() { return entries.slice(); }

  function renderBanner() {
    var banner = document.getElementById('ri-error-banner');
    if (!banner) return; // DOM ещё не готов (крайне ранняя ошибка) — запись всё равно попадёт в диагностику
    if (!entries.length) { banner.hidden = true; return; }
    var last = entries[entries.length - 1];
    banner.hidden = false;
    banner.innerHTML =
      '<span class="ri-error-banner-icon">⚠️</span>' +
      '<span class="ri-error-banner-text">Ошибка: ' + diagEscHTML(last.message) +
        (entries.length > 1 ? ' <b>(+' + (entries.length - 1) + ' ещё)</b>' : '') + '</span>' +
      '<button type="button" class="ri-error-banner-btn" id="ri-error-copy">📋 Скопировать всё</button>' +
      '<button type="button" class="ri-error-banner-close" id="ri-error-dismiss" title="Скрыть">✕</button>';
    banner.querySelector('#ri-error-copy').addEventListener('click', function() { copyDiagnostics(); });
    banner.querySelector('#ri-error-dismiss').addEventListener('click', function() { banner.hidden = true; });
  }

  return { add: add, getAll: getAll };
})();

window.addEventListener('error', function(e) {
  ErrorLog.add({
    type: 'error',
    message: e.message || String(e.error),
    source: e.filename ? (e.filename + ':' + e.lineno + ':' + e.colno) : '',
    stack: e.error && e.error.stack ? String(e.error.stack) : '',
    time: new Date().toISOString(),
  });
});
window.addEventListener('unhandledrejection', function(e) {
  var reason = e.reason;
  ErrorLog.add({
    type: 'unhandledrejection',
    message: reason && reason.message ? reason.message : String(reason),
    stack: reason && reason.stack ? String(reason.stack) : '',
    time: new Date().toISOString(),
  });
});

/* Снимок состояния приложения — без огромных полей (base64 фото/схем),
 * только то, что реально нужно для диагностики "почему на карте не то,
 * что должно быть". */
function collectDiagnostics() {
  var snap = {
    timestamp: new Date().toISOString(),
    url: location.href,
    userAgent: navigator.userAgent,
    activeTab: (typeof AppState !== 'undefined') ? AppState.activeTab : null,
    errors: ErrorLog.getAll(),
  };
  if (typeof RiskApi !== 'undefined' && RiskApi._debugSnapshot) {
    try { snap.db = RiskApi._debugSnapshot(); }
    catch (e) { snap.dbSnapshotError = String(e); }
  }
  if (typeof MapState !== 'undefined') {
    snap.map = {
      plotId: MapState.plotId, weekKey: MapState.weekKey, bounds: MapState.bounds,
      hasImg: !!MapState.img, imgSize: MapState.img ? (MapState.img.width + 'x' + MapState.img.height) : null,
      pointsCount: MapState.points.length,
      faultsCount: MapState.faults.length, domainsCount: MapState.domains.length,
      showFaults: MapState.showFaults, showDomains: MapState.showDomains,
      colorMode: MapState.colorMode, statusFilter: MapState.statusFilter,
    };
  }
  if (typeof SchemesState !== 'undefined') {
    snap.schemes = { activePlotId: SchemesState.activePlotId, activeWeekKey: SchemesState.activeWeekKey };
  }
  return snap;
}

async function copyDiagnostics() {
  var text = JSON.stringify(collectDiagnostics(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    if (typeof Toast !== 'undefined') Toast.show('Диагностика скопирована в буфер обмена', 'success');
  } catch (e) {
    // Clipboard API недоступен (например, не https и не localhost) —
    // показываем текст в модалке, чтобы скопировать вручную (Ctrl+A, Ctrl+C).
    if (typeof buildModal === 'function') {
      buildModal('Диагностика (выделите и скопируйте вручную)',
        '<textarea class="ri-textarea" style="min-height:340px;font-family:monospace;font-size:11px" readonly>' + diagEscHTML(text) + '</textarea>',
        { width: '640px' });
    } else {
      window.prompt('Скопируйте текст диагностики (Ctrl+C):', text);
    }
  }
}
