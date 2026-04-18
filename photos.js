/**
 * photos.js — сжатие, загрузка и отображение фото.
 *
 * Единственный поток загрузки:
 *   1. compress(file) → base64
 *   2. Api.uploadPhotoConfirmed(pointId, ...) → driveUrl
 *      (внутри: POST uploadPhoto + polling getPoint)
 *   3. Вернуть driveUrl вызывающему коду
 *
 * При ошибке — бросаем Error, не возвращаем null.
 */

var Photos = (function() {

  // ── Сжатие ───────────────────────────────────────────────

  function compress(file, maxSize, quality) {
    maxSize = maxSize || 1200;  // уменьшено с 1600 — меньше payload
    quality = quality || 0.80;
    return new Promise(function(resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function() {
        URL.revokeObjectURL(url);
        var w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w >= h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else        { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = function() {
        URL.revokeObjectURL(url);
        reject(new Error('Ошибка чтения изображения'));
      };
      img.src = url;
    });
  }

  // ── Загрузка с подтверждением ────────────────────────────

  /**
   * Сжимает файл и загружает с подтверждением через API.
   * Возвращает Promise<string> — driveUrl.
   * При любой ошибке бросает Error.
   */
  function upload(file, pointId) {
    if (!file)    return Promise.reject(new Error('Файл не выбран'));
    if (!pointId) return Promise.reject(new Error('pointId не задан'));

    Diagnostics.set('photoStatus', 'uploading');

    var TIMEOUT_MS = 70000;  // 30 сек polling + 40 сек запас
    var timeoutP   = new Promise(function(_, reject) {
      setTimeout(function() {
        reject(new Error('Таймаут загрузки фото (40 сек)'));
      }, TIMEOUT_MS);
    });

    var uploadP = compress(file).then(function(base64) {
      var fileName = 'photo_' + pointId + '_' + Date.now() + '.jpg';
      return Api.uploadPhotoConfirmed(pointId, fileName, base64, 'image/jpeg');
    }).then(function(driveUrl) {
      Diagnostics.set('photoStatus', 'uploaded');
      return driveUrl;
    });

    return Promise.race([uploadP, timeoutP]).catch(function(err) {
      Diagnostics.set('photoStatus', 'error');
      Diagnostics.setError('photo', err.message);
      throw err; // не глотаем ошибку
    });
  }
  // Загрузка фото для КАНАВЫ — использует uploadDitchPhoto вместо uploadPhotoConfirmed
  function uploadDitch(file, ditchId) {
    if (!file)    return Promise.reject(new Error('Файл не выбран'));
    if (!ditchId) return Promise.reject(new Error('ditchId не задан'));

    Diagnostics.set('photoStatus', 'uploading');
    return compress(file).then(function(base64) {
      return Api.uploadDitchPhoto(ditchId, base64, 'image/jpeg');
    }).then(function(driveUrl) {
      Diagnostics.set('photoStatus', 'uploaded');
      return driveUrl;
    }).catch(function(err) {
      Diagnostics.set('photoStatus', 'error');
      Diagnostics.setError('photo', err && err.message || 'ошибка загрузки');
      throw err;
    });
  }

  // ── Отображение через прокси ─────────────────────────────

  // Кэш превью: url → dataUrl (живёт в памяти сессии)
  var _cache = {};

  function loadForDisplay(driveUrl) {
    if (!driveUrl) return Promise.resolve(null);
    // Возвращаем из кэша без повторной загрузки
    if (_cache[driveUrl]) return Promise.resolve(_cache[driveUrl]);
    var match = driveUrl.match(/id=([^&]+)/);
    if (!match) return Promise.resolve(driveUrl);
    return Api.getImage(match[1]).then(function(data) {
      if (!data || !data.base64) return null;
      var dataUrl = 'data:' + data.mimeType + ';base64,' + data.base64;
      _cache[driveUrl] = dataUrl;  // сохраняем в кэш
      return dataUrl;
    }).catch(function() { return null; });
  }

  function clearCache(driveUrl) {
    if (driveUrl) delete _cache[driveUrl];
    else _cache = {};
  }

  function setImageSrc(imgEl, driveUrl) {
    if (!imgEl || !driveUrl) return;
    loadForDisplay(driveUrl).then(function(src) {
      if (src && imgEl) imgEl.src = src;
    });
  }

  // ── UI: input + preview ───────────────────────────────────

  function initPhotoInput(inputId, previewId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    var newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    newInput.addEventListener('change', function() {
      var file    = newInput.files && newInput.files[0];
      var preview = document.getElementById(previewId);
      if (!preview) return;
      if (!file) { preview.innerHTML = ''; return; }
      var url = URL.createObjectURL(file);
      var img = document.createElement('img');
      img.style.cssText = 'max-width:100%;max-height:180px;border-radius:6px;display:block';
      img.onload = function() { URL.revokeObjectURL(url); };
      img.src = url;
      preview.innerHTML = '';
      preview.appendChild(img);
    });
  }

  function clearInput(inputId, previewId) {
    var input = document.getElementById(inputId);
    if (input) {
      var newInput = input.cloneNode(true);
      input.parentNode.replaceChild(newInput, input);
      initPhotoInput(inputId, previewId);
    }
    var preview = document.getElementById(previewId);
    if (preview) preview.innerHTML = '';
  }

  function getFile(inputId) {
    var input = document.getElementById(inputId);
    return (input && input.files && input.files[0]) ? input.files[0] : null;
  }

  return {
    compress:       compress,
    upload:         upload,
    uploadDitch:    uploadDitch,
    loadForDisplay: loadForDisplay,
    setImageSrc:    setImageSrc,
    initPhotoInput: initPhotoInput,
    clearInput:     clearInput,
    getFile:        getFile,
    clearCache:     clearCache,
  };
})();


// ── Модальный выбор источника фото ───────────────────────

/**
 * Показывает окно выбора: Камера / Галерея.
 * @param {string} inputId   — id скрытого <input type="file">
 * @param {string} previewId — id контейнера превью
 * @param {string} progressId — id контейнера прогресса (необязательно)
 * @param {boolean} hasPhoto — есть ли уже фото (меняет текст кнопки)
 */
function showPhotoSourceModal(inputId, previewId, progressId, hasPhoto, onFileSelected) {
  // Убираем старый модал если есть
  var old = document.getElementById('photo-source-modal');
  if (old) old.remove();

  var modal = document.createElement('div');
  modal.id = 'photo-source-modal';
  modal.style.cssText =
    'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:8000;' +
    'display:flex;align-items:flex-end;justify-content:center;' +
    'animation:fadeIn .15s ease';

  var label = hasPhoto ? 'Заменить фото' : 'Загрузить фото';

  modal.innerHTML =
    '<div style="background:#1e2530;border-radius:16px 16px 0 0;width:min(440px,100%);' +
    'padding:20px 16px 32px;border-top:1px solid rgba(255,255,255,.1)">' +
      '<div style="text-align:center;font-size:15px;font-weight:600;color:#e8eaf0;margin-bottom:18px">' + label + '</div>' +
      '<div style="display:flex;gap:10px">' +
        '<button id="psm-camera" style="flex:1;padding:14px 8px;background:rgba(26,115,232,.15);' +
          'border:1px solid rgba(26,115,232,.4);border-radius:12px;color:#7bb3f0;font-size:13px;' +
          'cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px">' +
          '<span style="font-size:28px">📷</span><span>Сделать фото</span>' +
        '</button>' +
        '<button id="psm-gallery" style="flex:1;padding:14px 8px;background:rgba(52,168,83,.15);' +
          'border:1px solid rgba(52,168,83,.4);border-radius:12px;color:#7dcf97;font-size:13px;' +
          'cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px">' +
          '<span style="font-size:28px">🖼</span><span>Из галереи</span>' +
        '</button>' +
      '</div>' +
      '<button id="psm-cancel" style="width:100%;margin-top:12px;padding:12px;' +
        'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);' +
        'border-radius:10px;color:rgba(180,190,210,.7);font-size:13px;cursor:pointer">' +
        'Отмена' +
      '</button>' +
    '</div>';

  document.body.appendChild(modal);

  function closeModal() { modal.remove(); }

  // Камера
  document.getElementById('psm-camera').addEventListener('click', function() {
    closeModal();
    triggerPhotoInput(inputId, previewId, 'environment', onFileSelected);
  });
  // Галерея
  document.getElementById('psm-gallery').addEventListener('click', function() {
    closeModal();
    triggerPhotoInput(inputId, previewId, false, onFileSelected);
  });
  // Отмена
  document.getElementById('psm-cancel').addEventListener('click', closeModal);
  modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });
}

/**
 * Запускает input[type=file] с нужным capture.
 */
function triggerPhotoInput(inputId, previewId, capture, onFileSelected) {
  var inp = document.getElementById(inputId);
  if (!inp) return;

  // Пересоздаём input чтобы сбросить предыдущий файл
  var newInp = inp.cloneNode(true);
  if (capture) {
    newInp.setAttribute('capture', capture);
  } else {
    newInp.removeAttribute('capture');
  }
  // Запрещаем вставку из буфера обмена
  newInp.onpaste = function(e) { e.preventDefault(); return false; };
  inp.parentNode.replaceChild(newInp, inp);

  // Превью при выборе
  newInp.addEventListener('change', function() {
    var file = newInp.files && newInp.files[0];
    if (!file) return;

    // Если передан callback галереи — передаём файл туда
    if (typeof onFileSelected === 'function') {
      onFileSelected(file);
      return;
    }

    // Стандартное превью одиночного фото
    var preview = document.getElementById(previewId);
    if (!preview) return;
    var sizeMb = (file.size / 1024 / 1024).toFixed(2);
    var url    = URL.createObjectURL(file);
    var img    = document.createElement('img');
    img.style.cssText = 'max-width:100%;max-height:180px;border-radius:6px;display:block';
    img.onload = function() { URL.revokeObjectURL(url); };
    img.src = url;
    preview.innerHTML = '';
    preview.appendChild(img);
    var hint = document.createElement('p');
    hint.className = 'form-hint';
    hint.textContent = 'Размер: ' + sizeMb + ' МБ · будет сжато перед отправкой';
    preview.appendChild(hint);
  });

  // Сбрасываем значение чтобы исключить автозаполнение из буфера
  newInp.value = '';
  // Запрещаем вставку из буфера обмена
  newInp.addEventListener('paste', function(e) { e.preventDefault(); });
  newInp.click();
}

/**
 * Показывает прогресс загрузки фото в контейнере progressId.
 * @param {string} progressId — id контейнера
 * @param {string} phase  — 'compressing' | 'uploading' | 'polling' | 'done' | 'error'
 * @param {string} detail — дополнительный текст (размер, ошибка)
 */
function showPhotoProgress(progressId, phase, detail) {
  var wrap = document.getElementById(progressId);
  if (!wrap) return;

  var phases = {
    compressing: { pct: 20,  color: '#1a73e8', text: 'Сжатие изображения...',   icon: '🔄' },
    uploading:   { pct: 60,  color: '#1a73e8', text: 'Загрузка на Drive...',     icon: '⬆️' },
    polling:     { pct: 85,  color: '#f9ab00', text: 'Подтверждение записи...',  icon: '⏳' },
    done:        { pct: 100, color: '#34a853', text: 'Фото загружено',           icon: '✅' },
    error:       { pct: 100, color: '#ea4335', text: 'Ошибка загрузки',          icon: '❌' },
  };

  var p = phases[phase] || phases.uploading;
  var detailHtml = detail ? '<span style="color:rgba(180,190,210,.6);margin-left:6px">' + detail + '</span>' : '';

  wrap.style.display = 'block';
  wrap.innerHTML =
    '<div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);' +
    'border-radius:8px;padding:8px 12px;margin:6px 0">' +
      '<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#c8d0de;margin-bottom:5px">' +
        '<span>' + p.icon + '</span>' +
        '<span>' + p.text + '</span>' +
        detailHtml +
      '</div>' +
      '<div style="height:4px;background:rgba(255,255,255,.08);border-radius:2px">' +
        '<div style="height:4px;border-radius:2px;background:' + p.color + ';' +
          'width:' + p.pct + '%;transition:width .4s ease"></div>' +
      '</div>' +
    '</div>';

  if (phase === 'done' || phase === 'error') {
    setTimeout(function() {
      if (wrap) wrap.style.display = 'none';
    }, 3000);
  }
}
