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

  var _capturedFile = null;  // file from getUserMedia camera capture

  // ── Камера (getUserMedia) ────────────────────────────────

  function openCamera(previewId, inputId) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      var inp = document.getElementById(inputId);
      if (inp) inp.click();
      return;
    }

    var currentFacing = 'environment';
    var currentStream = null;
    var switching = false;

    // Build overlay once
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:#000;z-index:10000;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px';

    var video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.style.cssText = 'max-width:100%;max-height:calc(100dvh - 100px);border-radius:8px;object-fit:contain';

    var btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;margin-top:16px;align-items:center';

    var captureBtn = document.createElement('button');
    captureBtn.type = 'button';
    captureBtn.style.cssText = 'flex:1;max-width:200px;padding:14px 24px;font-size:16px;background:#1a73e8;color:#fff;border:none;border-radius:12px;cursor:pointer;font-weight:600';
    captureBtn.textContent = '📷 Снять';

    var flipBtn = document.createElement('button');
    flipBtn.type = 'button';
    flipBtn.title = 'Переключить камеру';
    flipBtn.style.cssText = 'padding:14px 16px;font-size:20px;background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:12px;cursor:pointer;line-height:1';
    flipBtn.textContent = '🔄';

    var cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.style.cssText = 'padding:14px 20px;font-size:14px;background:rgba(255,255,255,.08);color:#ccc;border:1px solid rgba(255,255,255,.15);border-radius:12px;cursor:pointer';
    cancelBtn.textContent = 'Отмена';

    function stopCurrentStream() {
      if (currentStream) {
        currentStream.getTracks().forEach(function(t) { t.stop(); });
        currentStream = null;
      }
    }

    function closeOverlay() {
      stopCurrentStream();
      overlay.remove();
    }

    function startStream(facing) {
      switching = true;
      flipBtn.disabled = true;
      stopCurrentStream();
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false
      }).then(function(stream) {
        currentStream = stream;
        video.srcObject = stream;
        switching = false;
        flipBtn.disabled = false;
      }).catch(function() {
        switching = false;
        flipBtn.disabled = false;
      });
    }

    captureBtn.addEventListener('click', function() {
      if (!currentStream) return;
      var canvas = document.createElement('canvas');
      canvas.width  = video.videoWidth  || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext('2d').drawImage(video, 0, 0);
      closeOverlay();
      canvas.toBlob(function(blob) {
        var file = new File([blob], 'photo_' + Date.now() + '.jpg', { type: 'image/jpeg' });
        var stored = false;
        var inp = document.getElementById(inputId);
        if (inp && typeof DataTransfer !== 'undefined') {
          try {
            var dt = new DataTransfer();
            dt.items.add(file);
            inp.files = dt.files;
            inp.dispatchEvent(new Event('change', { bubbles: true }));
            stored = true;
          } catch(e) {}
        }
        if (!stored) {
          _capturedFile = file;
          _showPreview(previewId, file);
        }
      }, 'image/jpeg', 0.92);
    });

    flipBtn.addEventListener('click', function() {
      if (switching) return;
      currentFacing = currentFacing === 'environment' ? 'user' : 'environment';
      startStream(currentFacing);
    });

    cancelBtn.addEventListener('click', closeOverlay);

    btnRow.appendChild(captureBtn);
    btnRow.appendChild(flipBtn);
    btnRow.appendChild(cancelBtn);
    overlay.appendChild(video);
    overlay.appendChild(btnRow);
    document.body.appendChild(overlay);

    // Check camera count — hide flip button if only one camera available
    if (navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then(function(devices) {
        var videoInputs = devices.filter(function(d) { return d.kind === 'videoinput'; });
        if (videoInputs.length < 2) flipBtn.style.display = 'none';
      }).catch(function() {});
    }

    startStream(currentFacing);
  }

  function clearCaptured() { _capturedFile = null; }

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
  function upload(file, pointId, extra) {
    // extra: { pointNumber, monitoringDate, flowRate } — для листа «Фото»
    if (!file)    return Promise.reject(new Error('Файл не выбран'));
    if (!pointId) return Promise.reject(new Error('pointId не задан'));

    extra = extra || {};
    Diagnostics.set('photoStatus', 'uploading');

    var TIMEOUT_MS = 70000;  // 30 сек polling + 40 сек запас
    var timeoutP   = new Promise(function(_, reject) {
      setTimeout(function() {
        reject(new Error('Таймаут загрузки фото (40 сек)'));
      }, TIMEOUT_MS);
    });

    var uploadP = compress(file).then(function(base64) {
      // Имя файла: "17_2026-04-02.jpg" — читаемое и осмысленное
      var dateStr  = (extra.monitoringDate || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
      var numStr   = extra.pointNumber || pointId.slice(0, 8);
      var fileName = numStr + '_' + dateStr + '.jpg';
      return Api.uploadPhotoConfirmed(pointId, fileName, base64, 'image/jpeg', extra);
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

  // ── Отображение ───────────────────────────────────────────
  // Фото хранятся в Supabase Storage и доступны по прямым URL.

  function loadForDisplay(url) {
    if (!url) return Promise.resolve(null);
    return Promise.resolve(url);
  }

  function clearCache() {
    // Кэш не нужен — URL постоянные
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

  function initPreview(inputId, previewId) {
    var input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('change', function() {
      if (input.files && input.files[0]) _capturedFile = null;
      _showPreview(previewId, input.files && input.files[0]);
    });
  }

  function _showPreview(previewId, file) {
    var preview = document.getElementById(previewId);
    if (!preview || !file) return;
    var url = URL.createObjectURL(file);
    var img = document.createElement('img');
    img.style.cssText = 'max-width:100%;max-height:180px;border-radius:6px;display:block;margin-bottom:4px';
    img.onload = function() { URL.revokeObjectURL(url); };
    img.src = url;
    preview.innerHTML = '';
    preview.appendChild(img);
    var hint = document.createElement('p');
    hint.className = 'form-hint';
    hint.textContent = (file.size / 1024 / 1024).toFixed(2) + ' МБ · будет сжато';
    preview.appendChild(hint);
  }

  function getFileAny(ids) {
    if (_capturedFile) return _capturedFile;
    for (var i = 0; i < ids.length; i++) {
      var f = getFile(ids[i]);
      if (f) return f;
    }
    return null;
  }

  return {
    compress:       compress,
    upload:         upload,
    loadForDisplay: loadForDisplay,
    setImageSrc:    setImageSrc,
    initPhotoInput: initPhotoInput,
    initPreview:    initPreview,
    getFileAny:     getFileAny,
    clearInput:     clearInput,
    getFile:        getFile,
    clearCache:     clearCache,
    openCamera:     openCamera,
    clearCaptured:  clearCaptured,
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
  // Визуально скрываем, но НЕ через display:none — iOS блокирует .click() на hidden-элементах
  newInp.style.cssText = 'position:fixed;top:-200px;left:-200px;opacity:0;width:1px;height:1px;overflow:hidden';
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

  newInp.value = '';
  newInp.addEventListener('paste', function(e) { e.preventDefault(); });

  if (capture === 'environment' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    Photos.openCamera(previewId, inputId);
  } else {
    newInp.click();
  }
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
    uploading:   { pct: 60,  color: '#1a73e8', text: 'Загрузка на сервер...',    icon: '⬆️' },
    polling:     { pct: 85,  color: '#f9ab00', text: 'Сохранение записи...',     icon: '⏳' },
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
