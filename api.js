/**
 * api.js — единственный модуль для общения с Apps Script.
 *
 * GET:  JSONP (обход CORS)
 * POST: fetch no-cors
 *
 * JSONP: window[cbName] живёт до получения ответа.
 * Удаляется только после вызова — не по таймауту, не по onerror.
 */

var Api = (function() {

  function scriptUrl() {
    return window.APP_CONFIG && window.APP_CONFIG.SCRIPT_URL;
  }

  // ── JSONP GET ─────────────────────────────────────────────

  function jsonpGet(params, timeoutMs) {
    timeoutMs = timeoutMs || 20000;
    return new Promise(function(resolve, reject) {
      var url = scriptUrl();
      if (!url) return reject(new Error('SCRIPT_URL не задан'));

      var cbName  = '_cb_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
      var settled = false;

      var timer = setTimeout(function() {
        if (!settled) {
          settled = true;
          reject(new Error('JSONP timeout'));
        }
        // callback остаётся — поглотит запоздалый ответ
      }, timeoutMs);

      window[cbName] = function(data) {
        clearTimeout(timer);
        var el = document.getElementById(cbName);
        if (el) el.remove();
        delete window[cbName];
        if (settled) return;
        settled = true;
        if (data && data.error) return reject(new Error(data.error));
        resolve(data);
      };

      var parts = Object.keys(params).map(function(k) {
        return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
      });
      parts.push('callback=' + encodeURIComponent(cbName));

      var script   = document.createElement('script');
      script.id    = cbName;
      script.src   = url + '?' + parts.join('&');
      script.onerror = function() {
        var el = document.getElementById(cbName);
        if (el) el.remove();
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('JSONP load error'));
        }
      };
      document.head.appendChild(script);
    });
  }

  // ── POST no-cors ─────────────────────────────────────────

  function post(body) {
    var url = scriptUrl();
    if (!url) return Promise.reject(new Error('SCRIPT_URL не задан'));
    return fetch(url, {
      method:  'POST',
      mode:    'no-cors',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  }

  // POST + polling подтверждения
  function postWithConfirm(body, checkFn, retryMs, maxRetries) {
    retryMs    = retryMs    || 2000;
    maxRetries = maxRetries || 6;
    return post(body).then(function() {
      return poll(checkFn, retryMs, maxRetries);
    });
  }

  function poll(fn, intervalMs, maxAttempts) {
    return new Promise(function(resolve, reject) {
      var attempt = 0;
      function next() {
        attempt++;
        fn().then(function(ok) {
          if (ok) return resolve(true);
          if (attempt >= maxAttempts) return reject(new Error('Не подтверждено за ' + maxAttempts + ' попыток'));
          setTimeout(next, intervalMs);
        }).catch(function() {
          if (attempt >= maxAttempts) return reject(new Error('Polling error'));
          setTimeout(next, intervalMs);
        });
      }
      setTimeout(next, intervalMs);
    });
  }

  // ── Чтение ───────────────────────────────────────────────

  function getPoints() {
    return jsonpGet({ action: 'getPoints' }).then(function(d) { return d.points || []; });
  }
  function getPoint(id) {
    return jsonpGet({ action: 'getPoint', id: id }).then(function(d) { return d.point || null; });
  }
  function getWorkers() {
    return jsonpGet({ action: 'getWorkers' }).then(function(d) { return d.workers || []; });
  }
  function getSchemes() {
    return jsonpGet({ action: 'getSchemes' }).then(function(d) { return d.schemes || []; });
  }
  function getImage(fileId) {
    return jsonpGet({ action: 'getImage', fileId: fileId }, 30000);
  }
  function ping() {
    return jsonpGet({ action: 'ping' }).then(function(d) { return d.ok === true; });
  }

  function getHistory(pointNumber) {
    return jsonpGet({ action: 'getHistory', pointNumber: pointNumber }, 15000)
      .then(function(d) { return d.history || []; });
  }

  // ── Фото канав ─────────────────────
  function uploadDitchPhoto(ditchId, base64, mimeType) {
    // no-cors POST — Apps Script обрабатывает асинхронно
    // Ждём 4 сек и перезагружаем список канав
    return post({
      action:   'uploadDitchPhoto',
      ditchId:  ditchId,
      fileData: base64,
      mimeType: mimeType || 'image/jpeg',
    }).then(function() {
      return new Promise(function(resolve){ setTimeout(resolve, 4000); });
    }).then(function() {
      return getDitches('').then(function(resp) {
        var list = (resp && resp.ditches) ? resp.ditches : [];
        var d = list.find(function(x){ return x.id === ditchId; });
        return (d && d.photoUrls && d.photoUrls[0]) ? d.photoUrls[0] : null;
      });
    });
  }

  // ── Запись точек ─────────────────────────────────────────

  function createPoint(point) {
    return postWithConfirm(
      { action: 'createPoint', point: point },
      function() { return getPoint(point.id).then(function(p) { return !!p; }); }
    );
  }
  function updatePoint(point) {
    return postWithConfirm(
      { action: 'updatePoint', point: point },
      function() { return getPoint(point.id).then(function(p) { return !!p; }); }
    );
  }
  function deletePoint(id) {
    return postWithConfirm(
      { action: 'deletePoint', id: id },
      function() { return getPoint(id).then(function(p) { return !p; }); }
    );
  }

  // ── Сотрудники ───────────────────────────────────────────

  function saveWorker(worker)  { return post({ action: 'saveWorker', worker: worker }); }
  function deleteWorker(id)    { return post({ action: 'deleteWorker', id: id }); }

  // ── Фото — с подтверждением ──────────────────────────────

  /**
   * Загружает фото и подтверждает через getPoint что URL записан.
   * Возвращает Promise<string> — новый driveUrl.
   * При ошибке бросает Error (не возвращает null).
   */
  function uploadPhotoConfirmed(pointId, fileName, base64, mimeType) {
    // POST — Apps Script загружает файл в Drive и пишет URL в Sheets.
    // fetch no-cors завершается при отправке, независимо от Apps Script.
    return post({
      action:   'uploadPhoto',
      pointId:  pointId,
      fileName: fileName,
      base64:   base64,
      mimeType: mimeType || 'image/jpeg',
    }).then(function() {
      // Ждём Apps Script: polling каждые 3 сек, до 10 попыток (30 сек)
      return poll(function() {
        return getPoint(pointId).then(function(p) {
          return !!(p && p.photoUrls && p.photoUrls[0]);
        });
      }, 3000, 10);
    }).then(function() {
      return getPoint(pointId).then(function(p) {
        if (!p || !p.photoUrls || !p.photoUrls[0]) {
          throw new Error('URL фото не записан в Sheets после ожидания');
        }
        return p.photoUrls[0];
      });
    });
  }

  function deletePhoto(pointId) { return post({ action: 'deletePhoto', pointId: pointId }); }
  function uploadScheme(params) {
    return post({
      action:      'uploadScheme',
      weekKey:     params.weekKey,
      fileName:    params.fileName,
      base64:      params.base64,
      mimeType:    params.mimeType,
      uploadedBy:  params.uploadedBy,
    });
  }

  function getDitches(pointNumber) {
    return jsonpGet({ action: 'getDitches', pointNumber: pointNumber||'' })
      .then(function(d){ return d || { ditches:[] }; });
  }

  return {
    getPoints: getPoints, getPoint: getPoint,
    getWorkers: getWorkers, getSchemes: getSchemes,
    getHistory:  getHistory,
    getDitches:  getDitches,
    getDitchHistory: function(ditchName) {
      return jsonpGet({ action: 'getDitchHistory', ditchName: ditchName })
        .then(function(d){ return d || { history:[] }; });
    },
    post: post,
    getImage: getImage, ping: ping,
    createPoint: createPoint, updatePoint: updatePoint, deletePoint: deletePoint,
    saveWorker: saveWorker, deleteWorker: deleteWorker,
    uploadPhotoConfirmed: uploadPhotoConfirmed,
    uploadDitchPhoto:      uploadDitchPhoto,
    deletePhoto: deletePhoto, uploadScheme: uploadScheme,
  };
})();
