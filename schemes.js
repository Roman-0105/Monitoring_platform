/**
 * schemes.js — загрузка и отображение схем карьера.
 *
 * Схема привязана к weekKey (напр. "2026-W13").
 * Хранится в Drive, метаданные в листе Схемы.
 * Отображается как фон на вкладке Карта.
 */

var Schemes = (function() {

  var _list      = [];   // кэш списка схем
  var _imgCache  = {};   // кэш base64 изображений по weekKey

  // ── Текущая неделя ────────────────────────────────────────

  function currentWeekKey() {
    var now  = new Date();
    var jan1 = new Date(now.getFullYear(), 0, 1);
    var week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    return now.getFullYear() + '-W' + (week < 10 ? '0' + week : week);
  }

  function formatWeekKey(weekKey) {
    // "2026-W13" → "Неделя 13, 2026"
    var parts = weekKey.split('-W');
    if (parts.length === 2) return 'Неделя ' + parts[1] + ', ' + parts[0];
    return weekKey;
  }

  // ── Сжатие схемы ─────────────────────────────────────────
  function compressScheme(file) {
    return new Promise(function(resolve, reject) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function() {
        URL.revokeObjectURL(url);
        var w = img.width;
        var h = img.height;
        var MAX = 2048; // схема крупнее фото
        if (w > MAX || h > MAX) {
          if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
          else        { w = Math.round(w * MAX / h); h = MAX; }
        }
        var canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ base64: dataUrl.split(',')[1], mime: 'image/jpeg' });
      };
      img.onerror = function() {
        URL.revokeObjectURL(url);
        // Если не удалось сжать — отдаём как есть
        var reader = new FileReader();
        reader.onload = function(e) {
          var d = e.target.result;
          resolve({ base64: d.split(',')[1], mime: d.split(';')[0].split(':')[1] });
        };
        reader.onerror = function() { reject(new Error('Ошибка чтения файла')); };
        reader.readAsDataURL(file);
      };
      img.src = url;
    });
  }

  // ── Загрузка списка с сервера ─────────────────────────────

  function load() {
    if (typeof Api === 'undefined') {
      _list = (Storage.getCachedSchemes() || []).map(normalizeScheme);
      return Promise.resolve(_list);
    }
    return Api.getSchemes().then(function(schemes) {
      _list = (schemes || []).map(normalizeScheme);
      Storage.cacheSchemes(_list);
      Diagnostics.set('schemeStatus', _list.length ? 'loaded' : 'none');
      return _list;
    }).catch(function(err) {
      _list = (Storage.getCachedSchemes() || []).map(normalizeScheme);
      Diagnostics.setError('scheme', err.message);
      Diagnostics.set('schemeStatus', _list.length ? 'loaded' : 'error');
      return _list;
    });
  }

  function getList() { return _list; }

  function getByWeek(weekKey) {
    return _list.find(function(s) { return s.weekKey === weekKey; }) || null;
  }

  function parseDriveFileId(url) {
    if (!url || typeof url !== 'string') return '';
    var m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (m && m[1]) return m[1];
    var m2 = url.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    return m2 && m2[1] ? m2[1] : '';
  }

  function normalizeScheme(scheme) {
    var item = scheme || {};
    var driveUrl = item.driveUrl || item.url || '';
    return {
      weekKey: item.weekKey || '',
      driveUrl: driveUrl,
      driveFileId: item.driveFileId || item.fileId || parseDriveFileId(driveUrl),
      uploadedAt: item.uploadedAt || item.createdAt || '',
      uploadedBy: item.uploadedBy || '',
    };
  }

  function getLatest() {
    if (!_list.length) return null;
    var withWeek = _list.filter(function(s) { return !!s.weekKey; });
    if (!withWeek.length) return null;
    var sorted = withWeek.slice().sort(function(a, b) {
      var aWeek = a.weekKey || '';
      var bWeek = b.weekKey || '';
      if (aWeek !== bWeek) return aWeek > bWeek ? -1 : 1;
      var aAt = a.uploadedAt || '';
      var bAt = b.uploadedAt || '';
      return aAt > bAt ? -1 : (aAt < bAt ? 1 : 0);
    });
    return sorted[0] || null;
  }

  function getCurrent() {
    return getByWeek(currentWeekKey()) || getLatest();
  }

  // ── Загрузка схемы на сервер ──────────────────────────────

  function upload(file, weekKey, deviceId) {
    Diagnostics.set('schemeStatus', 'loading');

    // Общий таймаут 40 сек
    var timeoutP = new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error('Таймаут загрузки схемы')); }, 40000);
    });

    var uploadP = compressScheme(file).then(function(data) {
      return Api.uploadScheme({
        weekKey:    weekKey,
        fileName:   'scheme_' + weekKey + '_' + Date.now() + '.png',
        base64:     data.base64,
        mimeType:   data.mime || 'image/png',
        uploadedBy: deviceId || Storage.getDeviceId(),
      });
    }).then(function() {
      // POST отправлен — сбрасываем кэш и сразу считаем успехом
      // Список схем обновится при следующей синхронизации (через 30 сек)
      delete _imgCache[weekKey];
      Diagnostics.set('schemeStatus', 'loaded');
      // Через 5 сек тихо обновляем список схем в фоне
      setTimeout(function() { load(); }, 5000);
    });

    return Promise.race([uploadP, timeoutP]).catch(function(err) {
      Diagnostics.setError('scheme', err.message);
      Diagnostics.set('schemeStatus', 'error');
      throw err;
    });
  }

  // ── Получение изображения через прокси ───────────────────

  function getImage(weekKey) {
    if (_imgCache[weekKey]) {
      return Promise.resolve(_imgCache[weekKey]);
    }
    var scheme = getByWeek(weekKey);
    // Если список ещё не загружен — пробуем перезагрузить один раз
    if (!scheme && _list.length === 0) {
      return load().then(function() {
        var s2 = getByWeek(weekKey);
        if (!s2 || !s2.driveFileId) return null;
        return Api.getImage(s2.driveFileId).then(function(data) {
          if (!data || !data.base64) return null;
          var dataUrl = 'data:' + data.mimeType + ';base64,' + data.base64;
          _imgCache[weekKey] = dataUrl;
          return dataUrl;
        }).catch(function() { return null; });
      });
    }
    if (!scheme || !scheme.driveFileId) {
      return Promise.resolve(null);
    }
    return Api.getImage(scheme.driveFileId).then(function(data) {
      if (!data || !data.base64) return null;
      var dataUrl = 'data:' + data.mimeType + ';base64,' + data.base64;
      _imgCache[weekKey] = dataUrl;
      return dataUrl;
    }).catch(function() { return null; });
  }

  function getCurrentImage() {
    var active = getCurrent();
    if (!active || !active.weekKey) return Promise.resolve(null);
    return getImage(active.weekKey);
  }

  function preloadCurrent() {
    var latest = getLatest ? getLatest() : getCurrent ? getCurrent() : null;
    if (latest && latest.weekKey) {
      setTimeout(function() {
        getImage(latest.weekKey).catch(function(){});
      }, 500);
    }
  }

  return {
    currentWeekKey:  currentWeekKey,
    formatWeekKey:   formatWeekKey,
    load:            load,
    getList:         getList,
    getByWeek:       getByWeek,
    getLatest:       getLatest,
    getCurrent:      getCurrent,
    upload:          upload,
    getImage:        getImage,
    preloadCurrent:  preloadCurrent,
    getCurrentImage: getCurrentImage,
  };
})();
