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

/* ---------- Зона загрузки фото: клик ИЛИ перетаскивание файла ----------
 * opts.accept — атрибут accept у <input type=file> (по умолчанию только изображения)
 * opts.validate(file) — своя проверка типа файла (по умолчанию только изображения)
 * opts.hint — текст подсказки в зоне
 */
function initPhotoDropzone(container, onFile, opts) {
  opts = opts || {};
  var validate = opts.validate || function(file) { return file.type.indexOf('image') === 0; };
  container.classList.add('ri-dropzone');
  container.innerHTML =
    '<span class="ri-dropzone-icon">📷</span>' +
    '<span>' + (opts.hint || 'Перетащите фото сюда или нажмите, чтобы выбрать файл') + '</span>' +
    '<input type="file" accept="' + (opts.accept || 'image/*') + '">';
  var input = container.querySelector('input[type="file"]');

  function handleFile(file) {
    if (!file || !validate(file)) { Toast.show('Неподходящий тип файла', 'warning'); return; }
    onFile(file);
  }

  input.addEventListener('change', function() {
    var f = input.files && input.files[0];
    if (f) handleFile(f);
  });
  ['dragenter', 'dragover'].forEach(function(evt) {
    container.addEventListener(evt, function(e) { e.preventDefault(); e.stopPropagation(); container.classList.add('ri-dropzone-drag'); });
  });
  ['dragleave', 'drop'].forEach(function(evt) {
    container.addEventListener(evt, function(e) { e.preventDefault(); e.stopPropagation(); container.classList.remove('ri-dropzone-drag'); });
  });
  container.addEventListener('drop', function(e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
}

/* ---------- Калибровка схемы: реальные координаты <-> пиксели ----------
 * Порт того же линейного (по осям, без поворота) расчёта, что
 * используется в проекте "Гидрогеологический мониторинг"
 * (map.js: xyToPixel/pixelToXY; ui-settings.js: _computeBoundsFromCalibration).
 */
function computeBoundsFromCalibration(p1, p2, imgW, imgH) {
  // p1, p2: {px, py, rx, ry} — пиксель на исходном изображении + реальные X/Y
  if (Math.abs(p2.px - p1.px) < 1 || Math.abs(p2.py - p1.py) < 1) {
    throw new Error('Точки слишком близко друг к другу. Выберите точки подальше.');
  }
  var scaleX = (p2.rx - p1.rx) / (p2.px - p1.px);
  var xMin = p1.rx - p1.px * scaleX;
  var xMax = xMin + imgW * scaleX;
  // Ось Y изображения растёт вниз, реальная Y — вверх, отсюда инверсия.
  var scaleY = (p1.ry - p2.ry) / (p2.py - p1.py);
  var yMax = p1.ry + p1.py * scaleY;
  var yMin = yMax - imgH * scaleY;
  return { xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax };
}
function xyToPixel(x, y, bounds, imgW, imgH) {
  return {
    px: (x - bounds.xMin) / (bounds.xMax - bounds.xMin) * imgW,
    py: (bounds.yMax - y) / (bounds.yMax - bounds.yMin) * imgH,
  };
}

/* ---------- Сжатие файла схемы: PDF/SVG/растр -> data-URL картинки ----------
 * Порт compressScheme() из schemes.js (проект "Гидрогеологический мониторинг"):
 * PDF рендерится первой страницей через PDF.js в PNG, SVG передаётся как есть,
 * растровые изображения — как в compressImage().
 */
function compressSchemeFile(file) {
  var isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  var isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);

  if (isPdf) {
    return new Promise(function(resolve, reject) {
      if (typeof pdfjsLib === 'undefined') { reject(new Error('PDF.js не загружен — проверьте подключение к интернету')); return; }
      var reader = new FileReader();
      reader.onload = function(e) {
        var typedArr = new Uint8Array(e.target.result);
        pdfjsLib.getDocument({ data: typedArr }).promise.then(function(pdf) {
          return pdf.getPage(1);
        }).then(function(page) {
          var vp0 = page.getViewport({ scale: 1 });
          if (!vp0 || vp0.width <= 0 || vp0.height <= 0) { reject(new Error('PDF-страница имеет нулевые размеры')); return; }
          var MAX_DIM = 4096;
          var scale = Math.max(0.5, Math.min(4, MAX_DIM / Math.max(vp0.width, vp0.height)));
          var vp = page.getViewport({ scale: scale });
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(vp.width);
          canvas.height = Math.round(vp.height);
          var ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('Не удалось создать canvas (недостаточно памяти)')); return; }
          page.render({ canvasContext: ctx, viewport: vp }).promise.then(function() {
            resolve(canvas.toDataURL('image/png'));
          }).catch(function(err) { reject(new Error('Ошибка рендеринга PDF: ' + err.message)); });
        }).catch(function(err) { reject(new Error('Ошибка чтения PDF: ' + err.message)); });
      };
      reader.onerror = function() { reject(new Error('Ошибка чтения файла')); };
      reader.readAsArrayBuffer(file);
    });
  }

  if (isSvg) {
    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function(e) { resolve(e.target.result); };
      reader.onerror = function() { reject(new Error('Ошибка чтения файла')); };
      reader.readAsDataURL(file);
    });
  }

  return compressImage(file, 2048, 0.85);
}

/* ---------- Бейдж уровня опасности ---------- */
function levelBadge(levelLabel) {
  if (!levelLabel) return '';
  var cls = 'ri-badge-warn';
  if (levelLabel.indexOf('СТОП') !== -1) cls = 'ri-badge-bad';
  else if (levelLabel.indexOf('Опасно') !== -1) cls = 'ri-badge-danger';
  return '<span class="ri-badge ' + cls + '">' + escHTML(levelLabel) + '</span>';
}
