/**
 * ui-toast.js — единая система уведомлений и прогресса.
 *
 * Toast.show(message, type)          — быстрое уведомление (success|error|info|warning)
 * Toast.progress(id, message, pct)   — прогресс-бар (0–100, null = спиннер)
 * Toast.done(id, message)            — завершить прогресс (зелёный)
 * Toast.fail(id, message)            — завершить с ошибкой (красный)
 * Toast.hide(id)                     — скрыть конкретный toast
 */

var Toast = (function() {

  var _container = null;
  var _toasts    = {};   // id → { el, timer }
  var _seq       = 0;

  // ── Контейнер ─────────────────────────────────────────────
  function getContainer() {
    if (_container && document.body.contains(_container)) return _container;
    _container = document.createElement('div');
    _container.id = 'toast-container';
    _container.style.cssText =
      'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
      'z-index:9000;display:flex;flex-direction:column;align-items:center;' +
      'gap:8px;pointer-events:none;width:min(420px,90vw)';
    document.body.appendChild(_container);
    return _container;
  }

  // ── Создать элемент toast ─────────────────────────────────
  function makeEl(id) {
    var el = document.createElement('div');
    el.id  = 'toast-' + id;
    el.style.cssText =
      'background:rgba(24,28,36,.97);backdrop-filter:blur(8px);' +
      'border:1px solid rgba(255,255,255,.1);border-radius:12px;' +
      'padding:10px 14px;color:#e8eaf0;font-size:13px;' +
      'display:flex;align-items:center;gap:10px;' +
      'width:100%;box-sizing:border-box;pointer-events:auto;' +
      'animation:toast-in .2s ease;min-height:42px';
    return el;
  }

  // ── CSS анимации (вставляем один раз) ─────────────────────
  function ensureStyles() {
    if (document.getElementById('toast-styles')) return;
    var s = document.createElement('style');
    s.id  = 'toast-styles';
    s.textContent =
      '@keyframes toast-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}' +
      '@keyframes toast-out{from{opacity:1}to{opacity:0;transform:translateY(4px)}}' +
      '@keyframes toast-spin{to{transform:rotate(360deg)}}' +
      '.toast-spinner{width:16px;height:16px;border:2px solid rgba(255,255,255,.2);' +
        'border-top-color:#1a73e8;border-radius:50%;flex-shrink:0;' +
        'animation:toast-spin .7s linear infinite}' +
      '.toast-icon{font-size:15px;flex-shrink:0;line-height:1}' +
      '.toast-body{flex:1;min-width:0}' +
      '.toast-msg{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '.toast-bar-wrap{height:3px;background:rgba(255,255,255,.1);border-radius:2px;margin-top:5px}' +
      '.toast-bar{height:3px;border-radius:2px;transition:width .3s ease}';
    document.head.appendChild(s);
  }

  // ── Скрыть ────────────────────────────────────────────────
  function hide(id) {
    var t = _toasts[id];
    if (!t) return;
    clearTimeout(t.timer);
    t.el.style.animation = 'toast-out .2s ease forwards';
    setTimeout(function() {
      if (t.el.parentNode) t.el.parentNode.removeChild(t.el);
      delete _toasts[id];
    }, 200);
  }

  // ── Быстрое уведомление ───────────────────────────────────
  function show(message, type, duration) {
    ensureStyles();
    var id   = 'n' + (++_seq);
    var el   = makeEl(id);
    var icons = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
    var colors = { success:'#34a853', error:'#ea4335', warning:'#f9ab00', info:'#1a73e8' };
    var t = type || 'info';

    el.innerHTML =
      '<span class="toast-icon">' + (icons[t] || icons.info) + '</span>' +
      '<span class="toast-body"><div class="toast-msg">' + (message || '') + '</div></span>';
    el.style.borderColor = (colors[t] || colors.info) + '55';

    getContainer().appendChild(el);
    _toasts[id] = { el: el, timer: null };

    var ms = duration != null ? duration : (t === 'error' ? 5000 : 3000);
    if (ms > 0) {
      _toasts[id].timer = setTimeout(function() { hide(id); }, ms);
    }
    return id;
  }

  // ── Прогресс-бар ─────────────────────────────────────────
  function progress(id, message, pct) {
    ensureStyles();
    var existing = _toasts[id];
    var el;

    if (existing) {
      el = existing.el;
    } else {
      el = makeEl(id);
      getContainer().appendChild(el);
      _toasts[id] = { el: el, timer: null };
    }

    var showBar     = pct != null;
    var barWidth    = showBar ? Math.max(0, Math.min(100, pct)) : 0;
    var barColor    = '#1a73e8';
    var spinnerHTML = showBar ? '' : '<div class="toast-spinner"></div>';
    var barHTML     = showBar
      ? '<div class="toast-bar-wrap"><div class="toast-bar" style="width:' + barWidth + '%;background:' + barColor + '"></div></div>'
      : '';

    el.innerHTML =
      spinnerHTML +
      '<span class="toast-body">' +
        '<div class="toast-msg">' + (message || '') + '</div>' +
        barHTML +
      '</span>';

    return id;
  }

  // ── Завершить успешно ─────────────────────────────────────
  function done(id, message, duration) {
    var t = _toasts[id];
    if (!t) { show(message || 'Готово', 'success', duration); return; }
    clearTimeout(t.timer);
    t.el.innerHTML =
      '<span class="toast-icon">✅</span>' +
      '<span class="toast-body"><div class="toast-msg">' + (message || 'Готово') + '</div></span>';
    t.el.style.borderColor = '#34a85355';
    var ms = duration != null ? duration : 2500;
    t.timer = setTimeout(function() { hide(id); }, ms);
  }

  // ── Завершить с ошибкой ───────────────────────────────────
  function fail(id, message, duration) {
    var t = _toasts[id];
    if (!t) { show(message || 'Ошибка', 'error', duration); return; }
    clearTimeout(t.timer);
    t.el.innerHTML =
      '<span class="toast-icon">❌</span>' +
      '<span class="toast-body"><div class="toast-msg">' + (message || 'Ошибка') + '</div></span>';
    t.el.style.borderColor = '#ea433555';
    var ms = duration != null ? duration : 4000;
    t.timer = setTimeout(function() { hide(id); }, ms);
  }

  return { show: show, progress: progress, done: done, fail: fail, hide: hide };
})();
