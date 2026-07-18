/* Общие хелперы: экранирование, тосты, модалки, поисковый select, пагинация */

function escHTML(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escAttr(s) { return escHTML(s); }

function formatDate(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  var pad = function(n) { return n < 10 ? '0' + n : '' + n; };
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/* ---------- Toast ---------- */
var Toast = (function() {
  var container = null;
  function ensureContainer() {
    if (container) return container;
    container = document.createElement('div');
    container.className = 'ri-toast-stack';
    document.body.appendChild(container);
    return container;
  }
  var ICONS = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  function show(message, type, duration) {
    type = type || 'info';
    duration = duration || (type === 'error' ? 5000 : 3000);
    var el = document.createElement('div');
    el.className = 'ri-toast ri-toast-' + type;
    el.innerHTML = '<span class="ri-toast-icon">' + (ICONS[type] || ICONS.info) + '</span>' +
      '<span class="ri-toast-msg">' + escHTML(message) + '</span>';
    ensureContainer().appendChild(el);
    requestAnimationFrame(function() { el.classList.add('ri-toast-in'); });
    setTimeout(function() {
      el.classList.remove('ri-toast-in');
      el.classList.add('ri-toast-out');
      setTimeout(function() { el.remove(); }, 220);
    }, duration);
  }
  return { show: show };
})();

/* ---------- Modal ---------- */
function openModal(overlayEl) {
  overlayEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(function() { overlayEl.classList.add('ri-modal-open'); });
}
function closeModal(overlayEl) {
  overlayEl.classList.remove('ri-modal-open');
  document.body.style.overflow = '';
  setTimeout(function() {
    overlayEl.style.display = 'none';
    if (overlayEl.dataset.transient === '1') overlayEl.remove();
  }, 180);
}

/* Строит и открывает модалку из HTML-разметки тела; возвращает overlay-элемент. */
function buildModal(title, bodyHTML, opts) {
  opts = opts || {};
  var overlay = document.createElement('div');
  overlay.className = 'ri-modal-overlay';
  overlay.dataset.transient = '1';
  overlay.innerHTML =
    '<div class="ri-modal-box" style="' + (opts.width ? 'width:' + opts.width + ';' : '') + '">' +
      '<div class="ri-modal-header">' +
        '<span class="ri-modal-title">' + escHTML(title) + '</span>' +
        '<button type="button" class="ri-modal-close" aria-label="Закрыть">✕</button>' +
      '</div>' +
      '<div class="ri-modal-body">' + bodyHTML + '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  overlay.querySelector('.ri-modal-close').addEventListener('click', function() { closeModal(overlay); });
  overlay.addEventListener('mousedown', function(e) { if (e.target === overlay) closeModal(overlay); });
  document.addEventListener('keydown', function escListener(e) {
    if (e.key === 'Escape' && overlay.isConnected) { closeModal(overlay); document.removeEventListener('keydown', escListener); }
  });
  openModal(overlay);
  return overlay;
}

function confirmDialog(message, onConfirm) {
  var overlay = buildModal('Подтверждение',
    '<p style="margin:0 0 16px;color:var(--ri-txt-1);font-size:13px">' + escHTML(message) + '</p>' +
    '<div class="ri-modal-actions">' +
      '<button type="button" class="ri-btn ri-btn-outline" data-act="cancel">Отмена</button>' +
      '<button type="button" class="ri-btn ri-btn-danger" data-act="ok">Удалить</button>' +
    '</div>', { width: '380px' });
  overlay.querySelector('[data-act="cancel"]').addEventListener('click', function() { closeModal(overlay); });
  overlay.querySelector('[data-act="ok"]').addEventListener('click', function() {
    closeModal(overlay);
    onConfirm();
  });
}

/* ---------- Поисковый select (комбобокс с фильтрацией) ---------- */
/*
 * Создаёт комбобокс поверх <div data-searchselect id="...">.
 * options: [{value, label}], onChange(value) вызывается при выборе.
 */
function initSearchSelect(containerEl, options, opts) {
  opts = opts || {};
  var value = opts.value || '';
  var placeholder = opts.placeholder || '— выберите —';
  containerEl.classList.add('ri-ssel');
  containerEl.innerHTML =
    '<div class="ri-ssel-control">' +
      '<input type="text" class="ri-ssel-input" autocomplete="off" placeholder="' + escAttr(placeholder) + '">' +
      '<button type="button" class="ri-ssel-clear" title="Очистить">✕</button>' +
      '<span class="ri-ssel-arrow">▾</span>' +
    '</div>' +
    '<div class="ri-ssel-list" hidden></div>';

  var input = containerEl.querySelector('.ri-ssel-input');
  var list = containerEl.querySelector('.ri-ssel-list');
  var clearBtn = containerEl.querySelector('.ri-ssel-clear');
  var currentOptions = options;
  var selectedValue = value;

  function labelFor(v) {
    var o = currentOptions.find(function(o) { return String(o.value) === String(v); });
    return o ? o.label : '';
  }

  function renderList(filter) {
    var f = (filter || '').toLowerCase();
    var filtered = currentOptions.filter(function(o) { return o.label.toLowerCase().indexOf(f) !== -1; });
    if (!filtered.length) {
      list.innerHTML = '<div class="ri-ssel-empty">Ничего не найдено</div>';
    } else {
      list.innerHTML = filtered.map(function(o) {
        var active = String(o.value) === String(selectedValue) ? ' ri-ssel-opt-active' : '';
        return '<div class="ri-ssel-opt' + active + '" data-value="' + escAttr(o.value) + '">' + escHTML(o.label) + '</div>';
      }).join('');
    }
  }

  function open() {
    renderList(input.value === labelFor(selectedValue) ? '' : input.value);
    list.hidden = false;
    containerEl.classList.add('ri-ssel-focus');
  }
  function close() {
    list.hidden = true;
    containerEl.classList.remove('ri-ssel-focus');
    input.value = labelFor(selectedValue);
  }

  input.addEventListener('focus', function() { input.select(); open(); });
  input.addEventListener('input', function() { open(); renderList(input.value); });
  input.addEventListener('keydown', function(e) { if (e.key === 'Escape') { close(); input.blur(); } });
  list.addEventListener('mousedown', function(e) {
    var opt = e.target.closest('.ri-ssel-opt');
    if (!opt) return;
    e.preventDefault();
    selectedValue = opt.dataset.value;
    input.value = labelFor(selectedValue);
    close();
    if (opts.onChange) opts.onChange(selectedValue);
  });
  clearBtn.addEventListener('mousedown', function(e) {
    e.preventDefault();
    selectedValue = '';
    input.value = '';
    close();
    if (opts.onChange) opts.onChange('');
  });
  document.addEventListener('mousedown', function(e) {
    if (!containerEl.contains(e.target)) close();
  });

  input.value = labelFor(selectedValue);

  return {
    getValue: function() { return selectedValue; },
    setValue: function(v) { selectedValue = v; input.value = labelFor(v); },
    setOptions: function(opts2) { currentOptions = opts2; if (!labelFor(selectedValue)) { selectedValue = ''; input.value = ''; } },
  };
}

/* ---------- Пагинация ---------- */
/* Возвращает { pageItems, pageCount, page } и рисует控制ы в footerEl */
function paginate(items, page, pageSize) {
  var pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  page = Math.min(Math.max(1, page), pageCount);
  var start = (page - 1) * pageSize;
  return { pageItems: items.slice(start, start + pageSize), pageCount: pageCount, page: page };
}

function renderPager(footerEl, page, pageCount, onGoto) {
  footerEl.innerHTML =
    '<button class="ri-pager-btn" data-go="first" ' + (page <= 1 ? 'disabled' : '') + '>⏮</button>' +
    '<button class="ri-pager-btn" data-go="prev" ' + (page <= 1 ? 'disabled' : '') + '>◀</button>' +
    '<span class="ri-pager-label">Стр. <b>' + page + '</b> из ' + pageCount + '</span>' +
    '<button class="ri-pager-btn" data-go="next" ' + (page >= pageCount ? 'disabled' : '') + '>▶</button>' +
    '<button class="ri-pager-btn" data-go="last" ' + (page >= pageCount ? 'disabled' : '') + '>⏭</button>';
  footerEl.querySelectorAll('[data-go]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var go = btn.dataset.go;
      var target = go === 'first' ? 1 : go === 'last' ? pageCount : go === 'prev' ? page - 1 : page + 1;
      onGoto(target);
    });
  });
}

/* ---------- Сжатие фото на клиенте (canvas resize + JPEG) ---------- */
function compressImage(file, maxSize, quality) {
  maxSize = maxSize || 1280; quality = quality || 0.82;
  return new Promise(function(resolve, reject) {
    var img = new Image();
    var url = URL.createObjectURL(file);
    img.onload = function() {
      var w = img.width, h = img.height;
      var scale = Math.min(1, maxSize / Math.max(w, h));
      var cw = Math.round(w * scale), ch = Math.round(h * scale);
      var canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('Не удалось прочитать изображение')); };
    img.src = url;
  });
}

/* ---------- Бейдж уровня опасности ---------- */
function levelBadge(levelLabel) {
  if (!levelLabel) return '';
  var cls = 'ri-badge-warn';
  if (levelLabel.indexOf('СТОП') !== -1) cls = 'ri-badge-bad';
  else if (levelLabel.indexOf('Опасно') !== -1) cls = 'ri-badge-danger';
  return '<span class="ri-badge ' + cls + '">' + escHTML(levelLabel) + '</span>';
}
