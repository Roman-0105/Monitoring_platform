/**
 * diagnostics.js — панель состояния приложения.
 * Отображает живые данные о синхронизации.
 */

const Diagnostics = (() => {
  const state = {
    pointsLoaded:   0,
    workersLoaded:  0,
    lastSyncAt:     null,
    queueSize:      0,
    schemeStatus:   'none',   // none|loading|loaded|error
    photoStatus:    'none',   // none|uploading|uploaded|error
    online:         navigator.onLine,
    lastError:      null,     // { type, message, occurredAt }
  };

  function set(key, value) {
    state[key] = value;
    render();
  }

  function setError(type, message) {
    state.lastError = { type, message, occurredAt: new Date().toISOString() };
    render();
  }

  function clearError() {
    state.lastError = null;
    render();
  }

  function render() {
    var el = document.getElementById('diag-panel');
    if (!el) return;

    function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString('ru-RU') : '—'; }
    var online = state.online ? '🟢 онлайн' : '🔴 офлайн';

    var h = '';
    h += '<div class="diag-row"><span>Сеть</span><span>' + online + '</span></div>';
    h += '<div class="diag-row"><span>Точек загружено</span><span>' + state.pointsLoaded + '</span></div>';
    h += '<div class="diag-row"><span>Сотрудников</span><span>' + state.workersLoaded + '</span></div>';
    h += '<div class="diag-row"><span>Последняя синхронизация</span><span>' + fmtTime(state.lastSyncAt) + '</span></div>';
    h += '<div class="diag-row"><span>Офлайн-очередь</span><span>' + state.queueSize + '</span></div>';
    h += '<div class="diag-row"><span>Схема</span><span>' + state.schemeStatus + '</span></div>';
    h += '<div class="diag-row"><span>Фото</span><span>' + state.photoStatus + '</span></div>';
    if (state.lastError) {
      h += '<div class="diag-error"><strong>' + state.lastError.type + '</strong> ' +
           fmtTime(state.lastError.occurredAt) + '<br>' + state.lastError.message + '</div>';
    }
    el.innerHTML = h;
  }

  // Отслеживаем онлайн/офлайн
  window.addEventListener('online',  () => { state.online = true;  render(); });
  window.addEventListener('offline', () => { state.online = false; render(); });

  return { state, set, setError, clearError, render };
})();
