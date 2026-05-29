/**
 * ui-map.js — карта: рендер, зум, панорамирование, добавление точек.
 * Извлечено из app.js.
 * Зависит от: ui-utils.js, MapModule, Domens, Schemes, Points, Photos
 */

// ── Состояние карты ───────────────────────────────────────
var _mapSchemeImg      = null;   // ВАЖНО: объявлено здесь, используется в ui-points.js через проверку typeof
var _mapScale          = 1.0;
var _mapOffX           = 0;
var _mapOffY           = 0;
// Анимация зума
var _mapScaleT         = 1.0;   // целевое значение
var _mapOffXT          = 0;
var _mapOffYT          = 0;
var _mapAnimId         = null;
var _mapAddMode        = false;
var _mapDragging       = false;
var _mapDragStartX     = 0;
var _mapDragStartY     = 0;
var _mapFilters        = { dates: [], worker: 'all' };
var _poiEnabled        = false;   // Точки интереса включены
var _mapPointsVisible  = true;    // Видимость точек замеров
var _poiDate           = '';      // Выбранная дата для ТИ
var _mapUiState        = { showFilter: true, showLegend: true };
var _mapSelectedWeekKey = 'auto';
var _tooltipEl         = null;
var _mapZoomPctEl      = null;

// ── Вспомогательные ──────────────────────────────────────

function getMapActiveScheme() {
  if (_mapSelectedWeekKey && _mapSelectedWeekKey !== 'auto') {
    return Schemes.getByWeek(_mapSelectedWeekKey);
  }
  return Schemes.getCurrent();
}

function getMapZoomLimits() {
  if (typeof MapModule === 'undefined' || !MapModule.getStyleConfig) return { min: 0.3, max: 6 };
  var cfg = MapModule.getStyleConfig();
  var z = cfg.zoom || {};
  return { min: z.min || 0.3, max: z.max || 6 };
}

function getFilteredPointsForMap() {
  var points = getFilteredPoints(_mapFilters);

  // Если выбрана конкретная схема — показываем только точки этой недели
  if (_mapSelectedWeekKey && _mapSelectedWeekKey !== 'auto') {
    var range = (typeof getWeekDateRange === 'function')
      ? getWeekDateRange(_mapSelectedWeekKey)
      : null;
    if (range) {
      points = points.filter(function(p) {
        var d = (p.monitoringDate || '').slice(0, 10);
        if (!d) return false;
        return d >= range.start && d <= range.end;
      });
    }
  }

  return points;
}

// ── Фильтрация канав — по аналогии с точками ─────────────
function getFilteredDitchesForMap() {
  if (typeof DitchState === 'undefined' || !DitchState.list) return [];
  var ditches = DitchState.list;

  // Приоритет: если выбрана конкретная схема/неделя — только она
  if (_mapSelectedWeekKey && _mapSelectedWeekKey !== 'auto') {
    var range = (typeof getWeekDateRange === 'function')
      ? getWeekDateRange(_mapSelectedWeekKey)
      : null;
    if (range) {
      ditches = ditches.filter(function(d) {
        var date = (d.monitoringDate || '').slice(0, 10);
        if (!date) return false;
        return date >= range.start && date <= range.end;
      });
    }
    // Фильтр по сотруднику применяем всегда
    if (_mapFilters.worker && _mapFilters.worker !== 'all') {
      ditches = ditches.filter(function(d) {
        return (d.worker || '') === _mapFilters.worker;
      });
    }
    return ditches;
  }

  // Авто-режим: фильтруем по выбранным датам
  if (_mapFilters.dates && _mapFilters.dates.length > 0) {
    ditches = ditches.filter(function(d) {
      var date = (d.monitoringDate || '').slice(0, 10);
      return _mapFilters.dates.indexOf(date) >= 0;
    });
  } else {
    // Нет фильтра дат — показываем канавы последней даты мониторинга
    var allDates = DitchState.list
      .map(function(d) { return (d.monitoringDate || '').slice(0, 10); })
      .filter(Boolean)
      .sort();
    if (allDates.length > 0) {
      var lastDate = allDates[allDates.length - 1];
      ditches = ditches.filter(function(d) {
        return (d.monitoringDate || '').slice(0, 10) === lastDate;
      });
    }
  }

  // Фильтр по сотруднику
  if (_mapFilters.worker && _mapFilters.worker !== 'all') {
    ditches = ditches.filter(function(d) {
      return (d.worker || '') === _mapFilters.worker;
    });
  }

  return ditches;
}

/**
 * Возвращает дату понедельника выбранной недели для предзаполнения формы.
 * Если схема 'auto' — возвращает сегодня.
 */
function getActiveSchemeDate() {
  // Всегда возвращаем сегодня — дата ставится день в день
  return (typeof todayISO === 'function') ? todayISO() : '';
}

function setupMapCanvas(canvas) {
  if (!canvas) return;
  var wrap = document.getElementById('map-scheme-wrap');
  if (!wrap) return;
  canvas.width  = wrap.clientWidth  || 800;
  canvas.height = wrap.clientHeight || 600;
  // Sync targets after resize so clamp works correctly
  _mapOffXT = _mapOffX; _mapOffYT = _mapOffY; _mapScaleT = _mapScale;
}

// ── Схема — селектор ─────────────────────────────────────

function renderMapSchemeSelector() {
  var sel = document.getElementById('map-scheme-select');
  if (!sel) return;
  var list = Schemes.getList().filter(function(s) { return !!s.weekKey; }).slice().sort(function(a, b) {
    return (a.weekKey || '') > (b.weekKey || '') ? -1 : 1;
  });
  var html = '<option value="auto">Авто: текущая / последняя</option>';
  list.forEach(function(s) {
    html += '<option value="' + escAttr(s.weekKey) + '">' + Schemes.formatWeekKey(s.weekKey) + '</option>';
  });
  sel.innerHTML = html;
  if (_mapSelectedWeekKey === 'auto') {
    // Первый запуск: автоматически выбираем последнюю загруженную схему
    _mapSelectedWeekKey = list.length ? list[0].weekKey : 'auto';
  } else if (_mapSelectedWeekKey !== 'auto' && !Schemes.getByWeek(_mapSelectedWeekKey)) {
    // Ранее выбранная схема удалена — переключаемся на последнюю
    _mapSelectedWeekKey = list.length ? list[0].weekKey : 'auto';
  }
  sel.value = _mapSelectedWeekKey;
  if (!sel._bound) {
    sel._bound = true;
    sel.addEventListener('change', function() {
      _mapSelectedWeekKey = sel.value || 'auto';
      _mapSchemeImg = null;

      // Предзаполняем дату мониторинга в форме новой точки
      var fDate = document.getElementById('f-monitoring-date');
      if (fDate) {
        fDate.value = getActiveSchemeDate();
      }
      var eDate = document.getElementById('e-monitoring-date');
      if (eDate && !eDate.value) {
        eDate.value = getActiveSchemeDate();
      }

      renderMap();
      updateMapLegendPoints();
    });
  }
}

// ── Рендер карты ─────────────────────────────────────────

function renderMap() {
  var canvas   = document.getElementById('map-canvas');
  var noScheme = document.getElementById('map-no-scheme');
  if (!canvas) return;
  renderMapSchemeSelector();

  var scheme = getMapActiveScheme();
  if (!scheme) {
    canvas.style.display = 'none';
    if (noScheme) noScheme.style.display = 'block';
    return;
  }
  if (noScheme) noScheme.style.display = 'none';
  canvas.style.display = 'block';

  if (_mapSchemeImg) {
    initExtraMapButtons();
    redrawMap();
    return;
  }

  Schemes.getImage(scheme.weekKey).then(function(dataUrl) {
    if (!dataUrl) {
      canvas.style.display = 'none';
      if (noScheme) noScheme.style.display = 'block';
      return;
    }
    var img = new Image();
    img.onload = function() {
      _mapSchemeImg = img;
      // Инициализируем тепловую карту после загрузки схемы
      if (typeof HeatMap !== 'undefined') {
        setTimeout(function() { HeatMap.init(); }, 100);
      }
      var wrap = document.getElementById('map-scheme-wrap');
      var lim  = getMapZoomLimits();
      if (wrap) {
        var fitScale = Math.min(wrap.clientWidth / img.width, wrap.clientHeight / img.height);
        _mapScale = Math.min(lim.max, fitScale > 0 ? fitScale : 1); // no min clamp on fit
      } else {
        _mapScale = 1;
      }
      _mapOffX = 0; _mapOffY = 0;
      _mapScaleT = _mapScale; _mapOffXT = 0; _mapOffYT = 0;
      setupMapCanvas(canvas);
      initMapFilters();
      initExtraMapButtons();
      redrawMap();
      initMapInteraction(canvas);
      initMapZoomButtons();
      // Запускаем анимацию пульсации точек
      if (typeof MapModule !== 'undefined' && MapModule.startPulse) {
        MapModule.startPulse(redrawMap);
      }
    };
    img.src = dataUrl;
  });
}

function clampMapTransform() {
  var canvas = document.getElementById('map-canvas');
  if (!canvas || !_mapSchemeImg) return;
  var minX = canvas.width  - (_mapSchemeImg.width  * _mapScale);
  var minY = canvas.height - (_mapSchemeImg.height * _mapScale);
  if (_mapSchemeImg.width * _mapScale <= canvas.width) {
    _mapOffX = (canvas.width - _mapSchemeImg.width * _mapScale) / 2;
  } else {
    _mapOffX = Math.min(0, Math.max(minX, _mapOffX));
  }
  if (_mapSchemeImg.height * _mapScale <= canvas.height) {
    _mapOffY = (canvas.height - _mapSchemeImg.height * _mapScale) / 2;
  } else {
    _mapOffY = Math.min(0, Math.max(minY, _mapOffY));
  }
  // Do NOT sync targets here — that would break zoom-to-pivot animation
}

function redrawMap() {
  var canvas = document.getElementById('map-canvas');
  if (!canvas || !_mapSchemeImg) return;
  clampMapTransform();
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(_mapOffX, _mapOffY);
  ctx.scale(_mapScale, _mapScale);
  ctx.drawImage(_mapSchemeImg, 0, 0);
  // Тепловая карта рисуется в координатах схемы — масштабируется вместе с картой
  if (typeof HeatMap !== 'undefined') HeatMap.draw();
  if (typeof Domens !== 'undefined') {
    Domens.draw(ctx, _mapSchemeImg.width, _mapSchemeImg.height, _mapScale);
  }
  if (typeof Faults !== 'undefined') {
    Faults.draw(ctx, _mapSchemeImg.width, _mapSchemeImg.height);
  }
  if (typeof MapModule !== 'undefined') {
    if (_mapPointsVisible) MapModule.drawPoints(ctx, getFilteredPointsForMap(), _mapSchemeImg.width, _mapSchemeImg.height, _mapScale);
    // Рисуем маркеры канав поверх точек
    if (typeof DitchState !== 'undefined' && MapModule.drawDitches) {
      MapModule.drawDitches(ctx, getFilteredDitchesForMap(), _mapSchemeImg.width, _mapSchemeImg.height, _mapScale);
    }
  }
  // Точки интереса — серые маркеры прошлых замеров
  if (_poiEnabled && _poiDate && typeof MapModule !== 'undefined') {
    drawPoiPoints(ctx, _mapSchemeImg.width, _mapSchemeImg.height, _mapScale);
  }
  ctx.restore();
  var sbScale = document.getElementById('sb-scale');
  if (sbScale) sbScale.textContent = 'x' + _mapScale.toFixed(2);
  if (!_mapZoomPctEl) _mapZoomPctEl = document.getElementById('map-zoom-pct');
  if (_mapZoomPctEl) _mapZoomPctEl.textContent = Math.round(_mapScale * 100) + '%';
}

// ── Анимация зума (rAF lerp) ──────────────────────────────

function _startMapAnim() {
  if (_mapAnimId) return;
  function tick() {
    var LERP = 0.16;
    var EPS_S = 0.0005;
    var EPS_O = 0.3;

    _mapScale += (_mapScaleT - _mapScale) * LERP;
    _mapOffX  += (_mapOffXT  - _mapOffX)  * LERP;
    _mapOffY  += (_mapOffYT  - _mapOffY)  * LERP;

    redrawMap(); // clampMapTransform adjusts current offsets for display only

    var done = Math.abs(_mapScaleT - _mapScale) < EPS_S &&
               Math.abs(_mapOffXT  - _mapOffX)  < EPS_O &&
               Math.abs(_mapOffYT  - _mapOffY)  < EPS_O;
    if (!done) {
      _mapAnimId = requestAnimationFrame(tick);
    } else {
      _mapScale = _mapScaleT; _mapOffX = _mapOffXT; _mapOffY = _mapOffYT;
      redrawMap();
      _mapAnimId = null;
    }
  }
  _mapAnimId = requestAnimationFrame(tick);
}

function _setMapTarget(newScale, newOffX, newOffY) {
  var lim = getMapZoomLimits();
  var s = Math.max(lim.min, Math.min(lim.max, newScale));
  // Pre-clamp target offsets for the target scale
  var canvas = document.getElementById('map-canvas');
  if (canvas && _mapSchemeImg) {
    var minX = canvas.width  - (_mapSchemeImg.width  * s);
    var minY = canvas.height - (_mapSchemeImg.height * s);
    if (_mapSchemeImg.width * s <= canvas.width) {
      newOffX = (canvas.width  - _mapSchemeImg.width  * s) / 2;
    } else {
      newOffX = Math.min(0, Math.max(minX, newOffX));
    }
    if (_mapSchemeImg.height * s <= canvas.height) {
      newOffY = (canvas.height - _mapSchemeImg.height * s) / 2;
    } else {
      newOffY = Math.min(0, Math.max(minY, newOffY));
    }
  }
  _mapScaleT = s;
  _mapOffXT  = newOffX;
  _mapOffYT  = newOffY;
  _startMapAnim();
}

// ── Зум ──────────────────────────────────────────────────

function zoomMap(factor, pivotX, pivotY) {
  var canvas = document.getElementById('map-canvas');
  if (!canvas) return;
  var cx = pivotX != null ? pivotX : canvas.width  / 2;
  var cy = pivotY != null ? pivotY : canvas.height / 2;
  var lim = getMapZoomLimits();
  var newScale = Math.max(lim.min, Math.min(lim.max, _mapScaleT * factor));
  var newOffX  = cx - (cx - _mapOffXT) * (newScale / _mapScaleT);
  var newOffY  = cy - (cy - _mapOffYT) * (newScale / _mapScaleT);
  _setMapTarget(newScale, newOffX, newOffY);
}

function fitMap() {
  if (!_mapSchemeImg) return;
  var canvas = document.getElementById('map-canvas');
  if (!canvas) return;
  // No min clamp — fit always shows the full image regardless of zoom limits
  var s  = Math.min(canvas.width / _mapSchemeImg.width, canvas.height / _mapSchemeImg.height);
  if (s <= 0) s = 1;
  var lim = getMapZoomLimits();
  s = Math.min(s, lim.max);
  var ox = (canvas.width  - _mapSchemeImg.width  * s) / 2;
  var oy = (canvas.height - _mapSchemeImg.height * s) / 2;
  // Bypass _setMapTarget min-clamp for fit
  _mapScaleT = s; _mapOffXT = ox; _mapOffYT = oy;
  _startMapAnim();
}

function initMapZoomButtons() {
  var wrap = document.getElementById('map-scheme-wrap');
  if (!wrap || wrap.querySelector('.map-zoom-controls')) return;

  var controls = document.createElement('div');
  controls.className = 'map-zoom-controls';
  controls.innerHTML =
    '<button class="map-zoom-btn" id="map-zoom-in"  title="Приблизить">+</button>' +
    '<button class="map-zoom-btn map-zoom-label" id="map-zoom-pct" title="По размеру">100%</button>' +
    '<button class="map-zoom-btn" id="map-zoom-out" title="Отдалить">−</button>' +
    '<button class="map-zoom-btn" id="map-zoom-fit" title="По размеру">⊡</button>';
  wrap.appendChild(controls);

  document.getElementById('map-zoom-in').addEventListener('click',  function() { zoomMap(1.3); });
  document.getElementById('map-zoom-out').addEventListener('click', function() { zoomMap(0.77); });
  document.getElementById('map-zoom-fit').addEventListener('click', function() { fitMap(); });
  document.getElementById('map-zoom-pct').addEventListener('click', function() { fitMap(); });

  _mapZoomPctEl = document.getElementById('map-zoom-pct');
}

// ── Взаимодействие ───────────────────────────────────────

function initMapInteraction(canvas) {
  if (canvas._mapBound) return;
  canvas._mapBound = true;

  // Колесо мыши — плавный зум к курсору
  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    var rect   = canvas.getBoundingClientRect();
    var mouseX = e.clientX - rect.left;
    var mouseY = e.clientY - rect.top;
    var delta  = e.deltaY > 0 ? 0.85 : 1.18;
    var lim    = getMapZoomLimits();
    var newScale = Math.max(lim.min, Math.min(lim.max, _mapScaleT * delta));
    var newOffX  = mouseX - (mouseX - _mapOffXT) * (newScale / _mapScaleT);
    var newOffY  = mouseY - (mouseY - _mapOffYT) * (newScale / _mapScaleT);
    _setMapTarget(newScale, newOffX, newOffY);
  }, { passive: false });

  // Touch — pinch zoom + pan + tap
  var lastTouchDist = 0;
  var lastTouchX = 0;
  var lastTouchY = 0;
  var _tapStartX = 0;
  var _tapStartY = 0;

  canvas.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2) {
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist = Math.sqrt(dx*dx + dy*dy);
    } else if (e.touches.length === 1) {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      _tapStartX = e.touches[0].clientX;
      _tapStartY = e.touches[0].clientY;
      _mapDragging = true;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', function(e) {
    e.preventDefault();
    if (e.touches.length === 2) {
      var dx   = e.touches[0].clientX - e.touches[1].clientX;
      var dy   = e.touches[0].clientY - e.touches[1].clientY;
      var dist = Math.sqrt(dx*dx + dy*dy);
      if (lastTouchDist > 0) {
        var ratio  = dist / lastTouchDist;
        var midX   = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        var midY   = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        var rect   = canvas.getBoundingClientRect();
        var mx     = midX - rect.left;
        var my     = midY - rect.top;
        var lim    = getMapZoomLimits();
        var newScale = Math.max(lim.min, Math.min(lim.max, _mapScaleT * ratio));
        var newOffX  = mx - (mx - _mapOffXT) * (newScale / _mapScaleT);
        var newOffY  = my - (my - _mapOffYT) * (newScale / _mapScaleT);
        _setMapTarget(newScale, newOffX, newOffY);
      }
      lastTouchDist = dist;
    } else if (e.touches.length === 1 && _mapDragging && !_mapAddMode) {
      var ddx = e.touches[0].clientX - lastTouchX;
      var ddy = e.touches[0].clientY - lastTouchY;
      _mapOffX  += ddx; _mapOffXT  += ddx;
      _mapOffY  += ddy; _mapOffYT  += ddy;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      redrawMap();
    }
  }, { passive: false });

  canvas.addEventListener('touchend', function(e) {
    if (e.touches.length < 2) lastTouchDist = 0;
    if (e.touches.length === 0) {
      _mapDragging = false;
      // Tap detection: если палец почти не двигался — это тап, открываем карточку
      var t = e.changedTouches[0];
      var dx = t.clientX - _tapStartX;
      var dy = t.clientY - _tapStartY;
      if (Math.sqrt(dx*dx + dy*dy) < 10 && _mapSchemeImg && typeof MapModule !== 'undefined') {
        var rect = canvas.getBoundingClientRect();
        var cx   = t.clientX - rect.left;
        var cy   = t.clientY - rect.top;
        var imgX = (cx - _mapOffX) / _mapScale;
        var imgY = (cy - _mapOffY) / _mapScale;
        var ditch = (typeof DitchState !== 'undefined' && MapModule.findDitchAt)
          ? MapModule.findDitchAt(imgX, imgY, getFilteredDitchesForMap(), _mapSchemeImg.width, _mapSchemeImg.height, _mapScale)
          : null;
        if (ditch) { showDitchMapCard(ditch); return; }
        var p = MapModule.findPointAt(imgX, imgY, getFilteredPointsForMap(),
                  _mapSchemeImg.width, _mapSchemeImg.height, _mapScale);
        if (p) showMapPointCard(p);
      }
    }
  }, { passive: true });

  // Mouse drag — pan
  canvas.addEventListener('mousedown', function(e) {
    if (_mapAddMode) return;
    _mapDragging   = true;
    // Snap current to target so drag starts from visual position
    _mapOffX = _mapOffXT; _mapOffY = _mapOffYT; _mapScale = _mapScaleT;
    _mapDragStartX = e.clientX - _mapOffX;
    _mapDragStartY = e.clientY - _mapOffY;
    if (_mapAnimId) { cancelAnimationFrame(_mapAnimId); _mapAnimId = null; }
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('mousemove', function(e) {
    var rect = canvas.getBoundingClientRect();
    var cx   = e.clientX - rect.left;
    var cy   = e.clientY - rect.top;

    if (_mapDragging && !_mapAddMode) {
      _mapOffX  = e.clientX - _mapDragStartX;
      _mapOffY  = e.clientY - _mapDragStartY;
      _mapOffXT = _mapOffX;
      _mapOffYT = _mapOffY;
      redrawMap();
      hideMapTooltip();
      return;
    }

    // Статус-бар: координаты курсора
    if (_mapSchemeImg && typeof MapModule !== 'undefined') {
      var imgX2 = (cx - _mapOffX) / _mapScale;
      var imgY2 = (cy - _mapOffY) / _mapScale;
      if (imgX2 >= 0 && imgX2 <= _mapSchemeImg.width &&
          imgY2 >= 0 && imgY2 <= _mapSchemeImg.height) {
        var loc = MapModule.pixelToXY(imgX2, imgY2, _mapSchemeImg.width, _mapSchemeImg.height);
        var wgs = MapModule.xyToWgs84(loc.x, loc.y);
        var sbEl = document.getElementById('sb-coords');
        if (sbEl) {
          sbEl.textContent =
            'X: ' + loc.x.toFixed(4) + '  Y: ' + loc.y.toFixed(4) +
            '  |  ' + wgs.lat.toFixed(5) + '°N  ' + wgs.lon.toFixed(5) + '°E';
        }
      }
    }

    // Tooltip при наведении на точку или канаву
    if (!_mapAddMode && !_mapDragging && _mapSchemeImg && typeof MapModule !== 'undefined') {
      var imgX = (cx - _mapOffX) / _mapScale;
      var imgY = (cy - _mapOffY) / _mapScale;
      // Сначала проверяем канавы (они поверх)
      var ditch = (typeof DitchState !== 'undefined' && MapModule.findDitchAt)
        ? MapModule.findDitchAt(imgX, imgY, getFilteredDitchesForMap(), _mapSchemeImg.width, _mapSchemeImg.height, _mapScale)
        : null;
      if (ditch) {
        showDitchMapTooltip(ditch, e.clientX, e.clientY);
      } else {
        var p = MapModule.findPointAt(imgX, imgY, getFilteredPointsForMap(),
                  _mapSchemeImg.width, _mapSchemeImg.height, _mapScale);
        if (p) showMapTooltip(p, e.clientX, e.clientY);
        else   hideMapTooltip();
      }
    }
  });

  canvas.addEventListener('dblclick',   function() { fitMap(); });
  canvas.addEventListener('mouseup',    function() { _mapDragging = false; canvas.style.cursor = _mapAddMode ? 'crosshair' : 'grab'; });
  canvas.addEventListener('mouseleave', function() {
    _mapDragging = false;
    hideMapTooltip();
    // Принудительно скрываем тултип напрямую
    var t = document.getElementById('map-tooltip');
    if (t) t.style.display = 'none';
    // Карточку канавы НЕ скрываем при mouseleave — она кликабельная
  });

  // Скрываем тултип при уходе мыши с page-map
  var pageMap = document.getElementById('page-map');
  if (pageMap && !pageMap._tooltipBound) {
    pageMap._tooltipBound = true;
    pageMap.addEventListener('mouseleave', function() {
      var t = document.getElementById('map-tooltip');
      if (t) t.style.display = 'none';
    });
  }

  // Клик — добавить точку или открыть карточку
  canvas.addEventListener('click', function(e) {
    if (_mapDragging) return;
    hideMapTooltip();
    var rect = canvas.getBoundingClientRect();
    var cx   = e.clientX - rect.left;
    var cy   = e.clientY - rect.top;
    var imgX = (cx - _mapOffX) / _mapScale;
    var imgY = (cy - _mapOffY) / _mapScale;

    // Режим выбора позиции для канавы
    if (window._ditchPickMode && typeof MapModule !== 'undefined') {
      var local = MapModule.pixelToXY(imgX, imgY, _mapSchemeImg.width, _mapSchemeImg.height);
      var wgs   = MapModule.xyToWgs84 ? MapModule.xyToWgs84(local.x, local.y) : null;
      if (typeof onDitchMapPicked === 'function') {
        onDitchMapPicked(local.x, local.y,
          wgs ? wgs.lat : null, wgs ? wgs.lon : null);
      }
      return;
    }

    if (_mapAddMode && typeof MapModule !== 'undefined') {
      var localAdd = MapModule.pixelToXY(imgX, imgY, _mapSchemeImg.width, _mapSchemeImg.height);
      openAddPointModal(localAdd.x, localAdd.y);
      return;
    }

    if (typeof MapModule !== 'undefined') {
      // Сначала ищем канаву (квадратный маркер поверх)
      var ditch = (typeof DitchState !== 'undefined' && MapModule.findDitchAt)
        ? MapModule.findDitchAt(imgX, imgY, getFilteredDitchesForMap(), _mapSchemeImg.width, _mapSchemeImg.height, _mapScale)
        : null;
      if (ditch) {
        showDitchMapCard(ditch);
        return;
      }
      // Проверяем точки интереса (серые) если включены
      if (_poiEnabled && _poiDate) {
        var poi = findPoiAt(imgX, imgY, _mapSchemeImg.width, _mapSchemeImg.height, _mapScale);
        if (poi) {
          showPoiCard(poi, e.clientX, e.clientY);
          return;
        }
      }
      // Затем обычную точку
      var p = MapModule.findPointAt(imgX, imgY, getFilteredPointsForMap(),
                _mapSchemeImg.width, _mapSchemeImg.height, _mapScale);
      if (p) showMapPointCard(p);
    }
  });

  canvas.style.cursor = 'grab';

  // Resize canvas when wrapper changes size (e.g. window resize, legend collapse)
  if (typeof ResizeObserver !== 'undefined') {
    var _mapRO = new ResizeObserver(function() {
      if (!_mapSchemeImg) return;
      var wrap2 = document.getElementById('map-scheme-wrap');
      if (!wrap2) return;
      canvas.width  = wrap2.clientWidth;
      canvas.height = wrap2.clientHeight;
      // Re-clamp and redraw; targets stay valid
      clampMapTransform();
      redrawMap();
    });
    _mapRO.observe(document.getElementById('map-scheme-wrap'));
  }
}

// ── Фильтры карты ─────────────────────────────────────────

function initMapFilters() {
  var workerSel = document.getElementById('map-filter-worker');
  if (!workerSel) return;

  // Виджет дат — пересобираем каждый раз
  buildDateFilterWidget('map-date-filter-wrap', _mapFilters.dates, function(newDates) {
    _mapFilters.dates = newDates;
    if(typeof HeatMap!=="undefined")HeatMap.markDirty();redrawMap();
    updateMapLegendPoints();
  });

  // Список сотрудников
  var workerSet = {};
  Points.getList().forEach(function(p) { if (p.worker) workerSet[p.worker] = true; });
  Workers.getList().forEach(function(w) { if (w.name) workerSet[w.name] = true; });
  var workers = Object.keys(workerSet).sort().map(function(w) { return { value: w, label: w }; });
  fillSelectOptions(workerSel, workers, _mapFilters.worker, 'Все сотрудники');

  if (!workerSel._bound) {
    workerSel._bound = true;
    workerSel.addEventListener('change', function() {
      _mapFilters.worker = workerSel.value || 'all';
      if(typeof HeatMap!=="undefined")HeatMap.markDirty();redrawMap();
      updateMapLegendPoints();
    });
  }
}

// ── Легенда карты ─────────────────────────────────────────

function initMapLegend() {
  var btn = document.getElementById('btn-legend-toggle');
  if (btn && !btn._bound) {
    btn._bound = true;
    btn.addEventListener('click', function() {
      var panel = document.getElementById('map-legend-panel');
      if (!panel) return;
      var collapsed = panel.classList.toggle('collapsed');
      btn.textContent = collapsed ? '+' : '−';
    });
  }

  var dBtn = document.getElementById('btn-domens-toggle');
  if (dBtn && !dBtn._bound) {
    dBtn._bound = true;
    dBtn.addEventListener('click', function() {
      if (typeof Domens === 'undefined') return;
      var visible = Domens.toggle();
      dBtn.style.background  = visible ? 'var(--blue)' : '';
      dBtn.style.color       = visible ? '#fff'        : '';
      dBtn.style.borderColor = visible ? 'var(--blue)' : '';
      if (_mapSchemeImg) redrawMap();
    });
    dBtn.style.background  = 'var(--blue)';
    dBtn.style.color       = '#fff';
    dBtn.style.borderColor = 'var(--blue)';
  }

  var fBtn = document.getElementById('btn-faults-toggle');
  if (fBtn && !fBtn._bound) {
    fBtn._bound = true;
    fBtn.addEventListener('click', function() {
      if (typeof Faults === 'undefined') return;
      var visible = Faults.toggle();
      fBtn.style.background  = visible ? 'var(--bad)' : '';
      fBtn.style.color       = visible ? '#fff'       : '';
      fBtn.style.borderColor = visible ? 'var(--bad)' : '';
      if (_mapSchemeImg) redrawMap();
    });
  }

  var modeWrap = document.getElementById('map-mode-switch');
  if (modeWrap && !modeWrap._bound) {
    modeWrap._bound = true;
    modeWrap.querySelectorAll('input[name="map-marker-mode"]').forEach(function(input) {
      input.checked = (typeof MapModule !== 'undefined' && MapModule.getMarkerMode() === input.value);
      input.addEventListener('change', function() {
        if (!this.checked || typeof MapModule === 'undefined') return;
        MapModule.setMarkerMode(this.value);
        MapModule.resetMarkerStyleCache();
        renderMapModeLegend();
        redrawMap();
      });
    });
  }

  var filterBtn = document.getElementById('btn-map-filter-toggle');
  if (filterBtn && !filterBtn._bound) {
    filterBtn._bound = true;
    filterBtn.addEventListener('click', function() {
      _mapUiState.showFilter = !_mapUiState.showFilter;
      applyMapSectionVisibility();
    });
  }
  var legendBtn = document.getElementById('btn-map-legend-section-toggle');
  if (legendBtn && !legendBtn._bound) {
    legendBtn._bound = true;
    legendBtn.addEventListener('click', function() {
      _mapUiState.showLegend = !_mapUiState.showLegend;
      applyMapSectionVisibility();
    });
  }

  renderMapModeLegend();
  applyMapSectionVisibility();
}

function applyMapSectionVisibility() {
  ['map-filter-week-section', 'map-filter-worker-section'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.style.display = _mapUiState.showFilter ? '' : 'none';
  });
  var modeSection   = document.getElementById('map-mode-section');
  var legendSection = document.getElementById('map-legend-section');
  var legendPoints  = document.getElementById('map-legend-points');
  if (modeSection)   modeSection.style.display   = _mapUiState.showLegend ? '' : 'none';
  if (legendSection) legendSection.style.display  = _mapUiState.showLegend ? '' : 'none';
  if (legendPoints)  legendPoints.style.display   = _mapUiState.showLegend ? '' : 'none';

  var filterBtn = document.getElementById('btn-map-filter-toggle');
  if (filterBtn) {
    filterBtn.style.background  = _mapUiState.showFilter ? 'var(--blue)' : '';
    filterBtn.style.color       = _mapUiState.showFilter ? '#fff' : '';
    filterBtn.style.borderColor = _mapUiState.showFilter ? 'var(--blue)' : '';
  }
  var legendBtn = document.getElementById('btn-map-legend-section-toggle');
  if (legendBtn) {
    legendBtn.style.background  = _mapUiState.showLegend ? 'var(--blue)' : '';
    legendBtn.style.color       = _mapUiState.showLegend ? '#fff' : '';
    legendBtn.style.borderColor = _mapUiState.showLegend ? 'var(--blue)' : '';
  }
}

function renderMapModeLegend() {
  var container = document.getElementById('map-mode-legend');
  if (!container || typeof MapModule === 'undefined') return;
  var cfg  = MapModule.getStyleConfig();
  var mode = MapModule.getMarkerMode();
  var html = '';

  function statusCards() {
    var cards = '<div class="map-legend-cards">';
    ['Новая', 'Активная', 'Иссякает', 'Пересохла', 'Паводковая', 'Перелив'].forEach(function(s) {
      var c = cfg.statusColors[s] || '#777';
      cards += '<div class="map-legend-card" style="border-color:' + c + '44">' +
               '<span class="map-legend-card-dot" style="background:' + c + '"></span>' +
               '<span class="map-legend-card-name" style="color:' + c + '">' + s + '</span>' +
               '</div>';
    });
    cards += '</div>';
    return cards;
  }

  function intensityCards() {
    var cards = '<div class="map-legend-cards">';
    [['Слабая (капёж)', 'i-weak'], ['Умеренная', 'i-mid'], ['Сильная (поток)', 'i-strong'], ['Очень сильная', 'i-vstrong']].forEach(function(pair) {
      cards += '<div class="map-legend-card">' +
               '<span class="map-legend-dot map-intensity-dot ' + pair[1] + '" style="flex-shrink:0"></span>' +
               '<span class="map-legend-card-name">' + pair[0] + '</span>' +
               '</div>';
    });
    cards += '</div>';
    return cards;
  }

  if (mode === 'simple') {
    html += '<div class="map-legend-subtitle">Цвет точек</div>';
    html += '<div class="map-legend-cards"><div class="map-legend-card">' +
            '<span class="map-legend-card-dot" style="background:' + cfg.simpleColor + '"></span>' +
            '<span class="map-legend-card-name">Единый цвет</span></div></div>';
  } else if (mode === 'status') {
    html += '<div class="map-legend-subtitle">Статус точки</div>' + statusCards();
  } else if (mode === 'intensity') {
    html += '<div class="map-legend-subtitle">Интенсивность (размер)</div>' + intensityCards();
  } else {
    // combined — показываем оба
    html += '<div class="map-legend-subtitle">Статус точки</div>' + statusCards();
    html += '<div class="map-legend-subtitle" style="margin-top:8px">Интенсивность (размер)</div>' + intensityCards();
  }
  container.innerHTML = html;
}

function updateMapLegendPoints() {
  var container = document.getElementById('map-legend-points');
  if (!container) return;
  var points = getFilteredPointsForMap();
  var byStatus    = {};
  var byIntensity = {};
  points.forEach(function(p) {
    var s  = p.status    || 'Неизвестно';
    var it = p.intensity || 'Не указана';
    byStatus[s]    = (byStatus[s]    || 0) + 1;
    byIntensity[it] = (byIntensity[it] || 0) + 1;
  });

  var html = '<div style="margin-bottom:8px">Показано точек: <b>' + points.length + '</b></div>';
  var datesLabel = '';
  if (_mapSelectedWeekKey && _mapSelectedWeekKey !== 'auto') {
    var range = (typeof getWeekDateRange === 'function') ? getWeekDateRange(_mapSelectedWeekKey) : null;
    if (range) {
      datesLabel = (typeof Schemes !== 'undefined') ? Schemes.formatWeekKey(_mapSelectedWeekKey) : _mapSelectedWeekKey;
    }
  } else if (_mapFilters.dates.length > 0) {
    datesLabel = _mapFilters.dates.length === 1
      ? formatMonitoringDate(_mapFilters.dates[0])
      : _mapFilters.dates.length + ' дат';
  } else {
    datesLabel = 'все даты';
  }
  html += '<div style="margin-bottom:8px;font-size:10px;color:var(--txt-3)">Фильтр: ' +
          datesLabel + ' • ' +
          (_mapFilters.worker === 'all' ? 'все сотрудники' : _mapFilters.worker) + '</div>';
  html += '<div style="display:grid;gap:4px">';
  ['Новая', 'Активная', 'Иссякает', 'Пересохла', 'Паводковая', 'Перелив'].forEach(function(s) {
    if ((byStatus[s] || 0) > 0) {
      html += '<div style="display:flex;justify-content:space-between"><span>' + s + '</span><b>' + byStatus[s] + '</b></div>';
    }
  });
  html += '</div><br><b>По интенсивности</b><br>';
  ['Слабая (капёж)', 'Умеренная', 'Сильная (поток)', 'Очень сильная', 'Не указана'].forEach(function(it) {
    if (byIntensity[it]) {
      html += '<div style="display:flex;justify-content:space-between"><span>' + it + '</span><b>' + byIntensity[it] + '</b></div>';
    }
  });

  if (typeof Domens !== 'undefined') {
    html += '<br><b>По доменам</b><br>';
    var byDomen = {};
    points.forEach(function(p) {
      var d = p.domain || '—';
      byDomen[d] = (byDomen[d] || 0) + 1;
    });
    Object.keys(byDomen).sort(function(a, b) { return byDomen[b] - byDomen[a]; }).forEach(function(d) {
      html += '<div style="display:flex;justify-content:space-between"><span>' + d + '</span><b>' + byDomen[d] + '</b></div>';
    });
  }

  // Канавы — учитываем фильтр
  var filteredDitches = getFilteredDitchesForMap();
  if (filteredDitches.length > 0) {
    html += '<br><hr style="border:none;border-top:1px solid var(--line-2);margin:6px 0">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<b>Канавы</b><b>' + filteredDitches.length + '</b></div>';
    html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
      '<span style="display:inline-flex;align-items:center;gap:3px;padding:2px 8px 2px 5px;border-radius:20px;' +
      'background:linear-gradient(90deg,#4090e8,#4090e8cc);color:#fff;font-size:10px;font-weight:700;' +
      'border:1px solid rgba(255,255,255,0.25)">≈ <span style="font-size:9px">канава</span></span>' +
      '<span style="font-size:12px">Водоприток</span></div>';
    var byDitchStatus = {};
    filteredDitches.forEach(function(d){
      var s = d.status || 'Активная';
      byDitchStatus[s] = (byDitchStatus[s] || 0) + 1;
    });
    Object.keys(byDitchStatus).forEach(function(s){
      html += '<div style="display:flex;justify-content:space-between;font-size:11px">' +
        '<span style="color:var(--txt-3)">' + s + '</span><b>' + byDitchStatus[s] + '</b></div>';
    });
  }

  container.innerHTML = html;
}

// ── Режим добавления точки ────────────────────────────────

function toggleMapAddMode() {
  _mapAddMode = !_mapAddMode;
  var canvas = document.getElementById('map-canvas');
  var btn    = document.getElementById('btn-map-add-point');
  var hint   = document.getElementById('map-add-hint');
  if (canvas) {
    canvas.classList.toggle('adding-mode', _mapAddMode);
    canvas.style.cursor = _mapAddMode ? 'crosshair' : 'grab';
  }
  if (btn) {
    btn.style.background  = _mapAddMode ? 'var(--blue)' : '';
    btn.style.color       = _mapAddMode ? '#fff'        : '';
    btn.style.borderColor = _mapAddMode ? 'var(--blue)' : '';
    btn.style.fontWeight  = _mapAddMode ? '700'         : '';
    btn.textContent       = _mapAddMode ? '🎯 Выберите место...' : '➕ Добавить точку';
  }
  if (hint) hint.style.display = _mapAddMode ? 'inline' : 'none';
}

function openAddPointModal(xLocal, yLocal) {
  _mapAddMode = false;
  var canvas = document.getElementById('map-canvas');
  var btn    = document.getElementById('btn-map-add-point');
  var hint   = document.getElementById('map-add-hint');
  if (canvas) { canvas.classList.remove('adding-mode'); canvas.style.cursor = 'grab'; }
  if (btn)    { btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; btn.style.fontWeight = ''; btn.textContent = '➕ Добавить точку'; }
  if (hint)   hint.style.display = 'none';

  AppState.editingPointId = null;
  ['e-num', 'e-intensity', 'e-flowrate', 'e-color', 'e-wall', 'e-comment'].forEach(function(id) { setField(id, ''); });
  updateFlowHint('e');
  setField('e-status', 'Новая');
  updateWorkerSelects();

  if (typeof MapModule !== 'undefined') {
    setField('e-xlocal', xLocal.toFixed(4));
    setField('e-ylocal', yLocal.toFixed(4));
    var wgs = MapModule.xyToWgs84(xLocal, yLocal);
    if (wgs && wgs.lat) {
      setField('e-lat', wgs.lat.toFixed(7));
      setField('e-lon', wgs.lon.toFixed(7));
    }
    var coordInfo = document.getElementById('e-map-coord-info');
    if (coordInfo) coordInfo.textContent = 'X: ' + xLocal.toFixed(4) + '  Y: ' + yLocal.toFixed(4) + ' (из карты)';
  }

  var preview = document.getElementById('e-photo-preview');
  if (preview) preview.innerHTML = '';
  Photos.clearInput('e-photo', 'e-new-photo-preview');
  var delBtn = document.getElementById('e-delete-photo-btn');
  if (delBtn) delBtn.style.display = 'none';

  var form = document.getElementById('edit-form');
  form._mapCoords = { xLocal: xLocal, yLocal: yLocal };

  document.getElementById('edit-modal-title').textContent = 'Новая точка на карте';
  var submitBtn = document.querySelector('#edit-form [type=submit]');
  if (submitBtn) submitBtn.textContent = 'Сохранить точку';

  // Предзаполняем дату из активной схемы
  var eDateMap = document.getElementById('e-monitoring-date');
  if (eDateMap) {
    var schemeDate = (typeof getActiveSchemeDate === 'function') ? getActiveSchemeDate() : '';
    if (schemeDate) eDateMap.value = schemeDate;
  }

  // Автоопределяем домен
  var domainEl = document.getElementById('e-domain');
  if (domainEl && typeof Domens !== 'undefined') {
    var autoDomen = Domens.findDomenAt(xLocal, yLocal);
    if (autoDomen) domainEl.value = autoDomen;
  }

  document.getElementById('edit-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  setTimeout(function() {
    var f = document.getElementById('e-num');
    if (f) f.focus();
  }, 150);
}

// ── Tooltip ───────────────────────────────────────────────

function showMapTooltip(p, clientX, clientY) {
  if (!_tooltipEl) {
    _tooltipEl = document.createElement('div');
    _tooltipEl.className = 'map-tooltip';
    document.body.appendChild(_tooltipEl);
  }
  var color = (typeof MapModule !== 'undefined') ? (MapModule.STATUS_COLORS[p.status] || '#666') : '#666';
  _tooltipEl.innerHTML =
    '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
    '<span style="width:10px;height:10px;border-radius:50%;background:' + color +
    ';border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3);flex-shrink:0"></span>' +
    '<strong>#' + (p.pointNumber || '?') + '</strong>' +
    '<span style="color:' + color + ';font-size:11px">' + (p.status || '') + '</span>' +
    '</div>' +
    (p.worker    ? '<div>👤 ' + p.worker + '</div>' : '') +
    (p.flowRate != null ? '<div>💧 ' + formatFlowBothUnits(p.flowRate) + '</div>' : '') +
    (p.intensity ? '<div>' + p.intensity + '</div>' : '') +
    '<div style="color:var(--gray-600);font-size:11px">' + formatDate(p.createdAt) + '</div>';

  var tw = 180, th = 90;
  var left = clientX + 12;
  var top  = clientY - 10;
  if (left + tw > window.innerWidth)  left = clientX - tw - 12;
  if (top  + th > window.innerHeight) top  = clientY - th - 10;
  _tooltipEl.style.left    = left + 'px';
  _tooltipEl.style.top     = top  + 'px';
  _tooltipEl.style.display = 'block';
}

function hideMapTooltip() {
  if (_tooltipEl) _tooltipEl.style.display = 'none';
}

// ── Карточка точки на карте ──────────────────────────────

function showMapPointCard(p) {
  var existing = document.getElementById('map-point-card');
  if (existing) existing.remove();

  var statusColors = (typeof MapModule !== 'undefined') ? MapModule.STATUS_COLORS : {};
  var statusColor  = statusColors[p.status] || 'var(--gray-400)';
  var hasPhoto     = p.photoUrls && p.photoUrls[0];

  var html =
    '<div class="mpc-header">' +
      '<div class="mpc-title">' +
        '<span class="mpc-num">#' + (p.pointNumber || '—') + '</span>' +
        '<span class="mpc-status" style="background:' + statusColor + '">' + (p.status || '') + '</span>' +
      '</div>' +
      '<button class="mpc-close" id="map-card-close">✕</button>' +
    '</div>';

  if (hasPhoto) {
    html += '<div class="mpc-photo-wrap"><img class="mpc-photo" id="mpc-photo-img" src="" alt="фото"></div>';
  }

  html += '<div class="mpc-body">';
  html += '<div class="mpc-row"><span class="mpc-label">Сотрудник</span><span>' + (p.worker || '—') + '</span></div>';
  html += '<div class="mpc-row"><span class="mpc-label">Дата мониторинга</span><span>' + formatMonitoringDate(p.monitoringDate) + '</span></div>';
  html += '<div class="mpc-row"><span class="mpc-label">Зафиксирована</span><span>' + formatDate(p.createdAt) + '</span></div>';
  if (p.domain)     html += '<div class="mpc-row"><span class="mpc-label">Домен</span><span>' + p.domain + '</span></div>';
  if (p.wall)       html += '<div class="mpc-row"><span class="mpc-label">Борт</span><span>' + p.wall + '</span></div>';
  if (p.intensity)  html += '<div class="mpc-row"><span class="mpc-label">Интенсивность</span><span>' + p.intensity + '</span></div>';
  if (p.flowRate != null) html += '<div class="mpc-row"><span class="mpc-label">Дебит</span><span>' + formatFlowBothUnits(p.flowRate) + '</span></div>';
  if (p.waterColor) html += '<div class="mpc-row"><span class="mpc-label">Цвет воды</span><span>' + p.waterColor + '</span></div>';
  if (p.xLocal != null) {
    html += '<div class="mpc-row"><span class="mpc-label">X / Y</span><span>' +
      Number(p.xLocal).toFixed(2) + ' / ' + Number(p.yLocal).toFixed(2) + '</span></div>';
  }
  if (p.horizon) html += '<div class="mpc-row"><span class="mpc-label">Горизонт</span><span>' + escAttr(p.horizon) + '</span></div>';
  if (p.measureMethod) html += '<div class="mpc-row"><span class="mpc-label">Метод замера</span><span>' + escAttr(p.measureMethod) + '</span></div>';
  if (p.comment) html += '<div class="mpc-comment">' + escHTML(p.comment) + '</div>';
  html += '</div>';

  html +=
    '<div class="mpc-actions">' +
      '<button class="btn btn-sm btn-outline mpc-edit"  data-pid="' + p.id + '">✏️ Изменить</button>' +
      '<button class="btn btn-sm btn-danger  mpc-del"   data-pid="' + p.id + '">🗑 Удалить</button>' +
      '<button class="btn btn-sm btn-outline mpc-chart"  data-pnum="' + escAttr(String(p.pointNumber)) + '" data-pid="' + p.id + '" title="График дебита">📈</button>' +
      '<button class="btn btn-sm btn-outline mpc-print"  data-pid="' + p.id + '" title="Печать">🖨️</button>' +
    '</div>' +
    '<div class="point-chart-wrap" id="mpc-chart-' + p.id + '" style="display:none"></div>';

  var card = document.createElement('div');
  card.id = 'map-point-card';
  card.className = 'map-point-card';
  card.innerHTML = html;

  var mapWrap = document.getElementById('map-scheme-wrap');
  if (!mapWrap) mapWrap = document.getElementById('page-map');
  mapWrap.appendChild(card);

  if (hasPhoto) {
    var imgEl = document.getElementById('mpc-photo-img');
    if (imgEl) Photos.setImageSrc(imgEl, p.photoUrls[0]);
  }

  document.getElementById('map-card-close').addEventListener('click', function() { card.remove(); });
  card.querySelector('.mpc-edit').addEventListener('click', function() {
    card.remove();
    openEditModal(this.dataset.pid);
  });
  card.querySelector('.mpc-chart').addEventListener('click', function() {
    toggleMapPointChart(this.dataset.pid, this.dataset.pnum, this);
  });
  card.querySelector('.mpc-print').addEventListener('click', function() {
    printPointCard(this.dataset.pid);
  });
  card.querySelector('.mpc-del').addEventListener('click', function() {
    var pid = this.dataset.pid;
    if (!confirm('Удалить точку #' + (p.pointNumber || pid) + '?')) return;
    card.remove();
    AppState.syncing = true;
    Toast.progress('del-point', 'Удаление точки...');
    Points.remove(pid).then(function() {
      return Points.load();
    }).then(function() {
      renderPointsList();
      if (_mapSchemeImg) redrawMap();
      AppState.syncing = false;
      Toast.done('del-point', 'Точка удалена');
    }).catch(function(err) {
      Toast.fail('del-point', 'Ошибка: ' + err.message);
      AppState.syncing = false;
    });
  });
}

// ── График на карточке карты ──────────────────────────────

function toggleMapPointChart(pointId, pointNumber, btn) {
  var wrap = document.getElementById('mpc-chart-' + pointId);
  if (!wrap) return;

  if (wrap.style.display !== 'none') {
    wrap.style.display = 'none';
    btn.style.background = '';
    btn.style.color = '';
    btn.style.borderColor = '';
    return;
  }

  wrap.style.display = 'block';
  btn.style.background = 'var(--blue, #1a73e8)';
  btn.style.color = '#fff';
  btn.style.borderColor = 'var(--blue, #1a73e8)';
  wrap.innerHTML = '<p style="font-size:11px;color:rgba(180,190,210,.6);padding:8px 14px">⏳ Загрузка...</p>';

  Api.getHistory(pointNumber).then(function(history) {
    if (!history || !history.length) {
      wrap.innerHTML = '<p style="font-size:11px;color:rgba(180,190,210,.5);padding:8px 14px">Нет истории замеров</p>';
      return;
    }
    // Переиспользуем renderPointChart из ui-points.js
    if (typeof renderPointChart === 'function') {
      renderPointChart(wrap, history, pointNumber);
    }
  }).catch(function(err) {
    wrap.innerHTML = '<p style="font-size:11px;color:#ea4335;padding:8px 14px">Ошибка: ' + err.message + '</p>';
  });
}

// ── Тултип канавы ─────────────────────────────────────────

function showDitchMapTooltip(d, clientX, clientY) {
  var el = document.getElementById('map-tooltip');
  if (!el) return;
  el.innerHTML =
    '<b style="color:#4090e8">🌊 ' + escAttr(d.ditchName) + '</b>' +
    (d.status ? ' · ' + escAttr(d.status) : '') + '<br>' +
    (d.flowM3h != null ? '<span style="color:#f9ab00">' + d.flowM3h.toFixed(3) + ' м³/ч</span>' : '');
  el.style.display = '';

  var canvas = document.getElementById('map-canvas');
  var rect = canvas ? canvas.getBoundingClientRect() : { left:0, top:0 };
  var lx = clientX - rect.left + 12;
  var ly = clientY - rect.top  - 10;
  el.style.left = lx + 'px';
  el.style.top  = ly + 'px';
}

// ── Карточка канавы на карте ──────────────────────────────

function showDitchMapCard(ditch) {
  var mapWrap = document.getElementById('map-scheme-wrap');
  if (!mapWrap) return;

  // Убираем старую карточку точки если открыта
  var old = mapWrap.querySelector('.map-point-card');
  if (old) old.remove();
  hideMapTooltip();

  var card = document.createElement('div');
  card.className = 'map-point-card ditch-map-card';
  card.style.cssText = 'border-left:3px solid #4090e8';

  var statusColors = {
    'Активная':'#4090e8','Новая':'#40b8ff','Пересохла':'#e8a030','Заилилась':'#8060c0'
  };
  var col = statusColors[ditch.status] || '#4090e8';

  var html = '<div class="mpc-header">';
  html += '<div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0">';
  html += '<span style="font-size:16px">🌊</span>';
  html += '<span class="mpc-num" style="color:#4090e8">' + escAttr(ditch.ditchName) + '</span>';
  if (ditch.pointNumber) {
    html += '<span style="font-size:10px;color:var(--txt-3)">· T' + escAttr(ditch.pointNumber) + '</span>';
  }
  html += '</div>';
  html += '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:' + col + '22;color:' + col + ';border:1px solid ' + col + '44">' + escAttr(ditch.status || 'Активная') + '</span>';
  html += '<button class="mpc-close">✕</button>';
  html += '</div>';

  html += '<div class="mpc-body">';
  html += '<div class="mpc-row"><span class="mpc-label">Дата</span><span>' + escAttr(ditch.monitoringDate || '—') + '</span></div>';
  html += '<div class="mpc-row"><span class="mpc-label">Сотрудник</span><span>' + escAttr(ditch.worker || '—') + '</span></div>';
  if (ditch.width != null) {
    html += '<div class="mpc-row"><span class="mpc-label">Ширина</span><span>' + ditch.width.toFixed(2) + ' м</span></div>';
  }
  if (ditch.area != null) {
    html += '<div class="mpc-row"><span class="mpc-label">Площадь S</span><span>' + ditch.area.toFixed(3) + ' м²</span></div>';
  }
  if (ditch.flowM3h != null) {
    html += '<div class="mpc-row" style="color:#f9ab00;font-weight:600"><span class="mpc-label" style="color:var(--txt-2)">Водоприток Q</span><span>' + ditch.flowM3h.toFixed(3) + ' м³/ч</span></div>';
  }
  if (ditch.comment) {
    html += '<div class="mpc-row"><span class="mpc-label">Комментарий</span><span>' + escAttr(ditch.comment) + '</span></div>';
  }
  html += '</div>';

  // Фото
  if (ditch.photoUrls && ditch.photoUrls[0]) {
    html += '<div class="mpc-photo-wrap">';
    html += '<img class="mpc-photo" id="dmc-photo-' + escAttr(ditch.id) + '" src="" alt="фото">';
    html += '</div>';
  }

  // Кнопки через data-атрибуты (без inline onclick с кавычками)
  html += '<div class="mpc-actions">';
  html += '<button class="btn btn-sm btn-outline dmc-edit-btn" data-did="' + escAttr(ditch.id) + '">✏️ Изменить</button>';
  html += '<button class="btn btn-sm btn-outline dmc-hist-btn" data-did="' + escAttr(ditch.id) + '" data-dname="' + escAttr(ditch.ditchName) + '">📈 История</button>';
  html += '<button class="btn btn-sm btn-outline dmc-move-btn" data-did="' + escAttr(ditch.id) + '" style="color:var(--gold);border-color:rgba(200,160,18,.35)" title="Кликните на карте чтобы уточнить позицию маркера">🎯 Позиция</button>';
  html += '<button class="btn btn-sm btn-outline dmc-del-btn" data-did="' + escAttr(ditch.id) + '" data-dname="' + escAttr(ditch.ditchName) + '" style="color:var(--red,#e05050);border-color:rgba(224,80,80,.3)">🗑 Удалить</button>';
  html += '</div>';
  html += '<div class="dmc-hist-panel" style="display:none;max-height:200px;overflow-y:auto"></div>';

  card.innerHTML = html;
  mapWrap.appendChild(card);

  // Навешиваем обработчики
  var closeBtn = card.querySelector('.mpc-close');
  if (closeBtn) closeBtn.addEventListener('click', function() { card.remove(); });
  var editBtn = card.querySelector('.dmc-edit-btn');
  if (editBtn) {
    editBtn.addEventListener('click', function() {
      var did = this.dataset.did;
      var d2  = DitchState.list.find(function(x){ return x.id === did; });
      if (d2) openEditDitchForm(d2);
    });
  }
  var moveBtn = card.querySelector('.dmc-move-btn');
  if (moveBtn) {
    moveBtn.addEventListener('click', function() {
      var did = this.dataset.did;
      card.remove();
      hideMapTooltip();
      window._ditchPickMode  = true;
      window._ditchPickIsNew = false;
      window._ditchPickId    = did;
      Toast.show('Кликните на карте для уточнения позиции канавы', 'info');
    });
  }
  var delBtn = card.querySelector('.dmc-del-btn');
  if (delBtn) {
    delBtn.addEventListener('click', function() {
      var did   = this.dataset.did;
      var dname = this.dataset.dname;
      card.remove();
      hideMapTooltip();
      if (typeof deleteDitch === 'function') deleteDitch(did, dname);
    });
  }
  var histBtn = card.querySelector('.dmc-hist-btn');
  if (histBtn) {
    histBtn.addEventListener('click', function() {
      var did   = this.dataset.did;
      var dname = this.dataset.dname;
      var panel = card.querySelector('.dmc-hist-panel');
      if (panel.style.display === 'none') {
        panel.style.display = '';
        showDitchHistoryInPanel(dname, panel);
      } else {
        panel.style.display = 'none';
      }
    });
  }

  // Загружаем фото
  if (ditch.photoUrls && ditch.photoUrls[0]) {
    var img = document.getElementById('dmc-photo-' + ditch.id);
    if (img) Photos.setImageSrc(img, ditch.photoUrls[0]);
  }
}

function showDitchHistoryInPanel(ditchName, panelEl) {
  panelEl.innerHTML = '<div style="padding:8px;color:var(--txt-3);font-size:11px">Загрузка...</div>';
  Api.getDitchHistory(ditchName).then(function(resp) {
    var hist = (resp && resp.history) ? resp.history : [];
    if (!hist.length) {
      panelEl.innerHTML = '<div style="padding:10px;color:var(--txt-3);font-size:11px">История пуста</div>';
      return;
    }
    var html = '<table style="width:100%;border-collapse:collapse;font-size:11px;padding:4px">';
    html += '<tr><th style="padding:4px 8px;color:var(--txt-3);text-align:left;border-bottom:1px solid var(--line)">Дата</th>';
    html += '<th style="padding:4px 8px;color:var(--txt-3);text-align:right;border-bottom:1px solid var(--line)">S, м²</th>';
    html += '<th style="padding:4px 8px;color:var(--txt-3);text-align:right;border-bottom:1px solid var(--line)">Q, м³/ч</th></tr>';
    hist.forEach(function(h) {
      // Форматируем дату: YYYY-MM-DD → ДД.ММ.ГГ, убираем время если есть
      var dateStr = String(h.monitoringDate || '').split('T')[0].split(' ')[0];
      if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
        var dp = dateStr.split('-');
        dateStr = dp[2] + '.' + dp[1] + '.' + dp[0].slice(2);
      }
      html += '<tr>';
      html += '<td style="padding:4px 8px;border-bottom:1px solid rgba(255,255,255,.04)">' + escAttr(dateStr) + '</td>';
      html += '<td style="padding:4px 8px;text-align:right;border-bottom:1px solid rgba(255,255,255,.04)">' + (h.area != null ? h.area.toFixed(3) : '—') + '</td>';
      html += '<td style="padding:4px 8px;text-align:right;color:var(--gold);font-weight:600;border-bottom:1px solid rgba(255,255,255,.04)">' + (h.flowM3h != null ? h.flowM3h.toFixed(3) : '—') + '</td>';
      html += '</tr>';
    });
    html += '</table>';
    panelEl.innerHTML = html;
  }).catch(function() {
    panelEl.innerHTML = '<div style="padding:10px;color:var(--red);font-size:11px">Ошибка загрузки</div>';
  });
}

// ── Кнопки тулбара карты (инициализируются при загрузке схемы) ──

function initExtraMapButtons() {
  // Кнопка «● Точки» — показать/скрыть точки замеров
  var pvBtn = document.getElementById('btn-points-visible');
  if (pvBtn && !pvBtn._bound) {
    pvBtn._bound = true;
    pvBtn.addEventListener('click', function() {
      _mapPointsVisible = !_mapPointsVisible;
      pvBtn.style.background  = _mapPointsVisible ? '' : 'rgba(139,148,158,.15)';
      pvBtn.style.color       = _mapPointsVisible ? '' : 'var(--txt-3)';
      pvBtn.style.borderColor = _mapPointsVisible ? '' : 'rgba(139,148,158,.4)';
      pvBtn.innerHTML         = _mapPointsVisible ? '&#9679; Точки' : '&#9675; Точки';
      pvBtn.title             = _mapPointsVisible ? 'Скрыть точки' : 'Показать точки';
      if (_mapSchemeImg) redrawMap();
    });
  }

  // Точки интереса (POI)
  initPoiControls();
}

// ============================================================
// ТОЧКИ ИНТЕРЕСА (POI)
// Серые маркеры прошлых замеров для навигации на местности
// ============================================================

// Инициализация кнопки и select
function initPoiControls() {
  var poiBtn    = document.getElementById('btn-poi-toggle');
  var poiSelect = document.getElementById('poi-date-select');
  var poiProg   = document.getElementById('poi-progress');
  if (!poiBtn || poiBtn._bound) return;
  poiBtn._bound = true;

  poiBtn.addEventListener('click', function() {
    _poiEnabled = !_poiEnabled;

    if (_poiEnabled) {
      // Заполняем список дат
      fillPoiDateSelect(poiSelect);
      poiSelect.style.display = '';
      if (poiProg) poiProg.style.display = '';
      poiBtn.style.background  = 'rgba(139,148,158,.18)';
      poiBtn.style.color       = 'var(--txt-1)';
      poiBtn.style.borderColor = 'rgba(139,148,158,.6)';
      // Автоматически выбираем предыдущую дату
      if (poiSelect.options.length > 1 && !_poiDate) {
        poiSelect.selectedIndex = 1;
        _poiDate = poiSelect.value;
      }
    } else {
      _poiDate = '';
      poiSelect.style.display = 'none';
      if (poiProg) poiProg.style.display = 'none';
      poiBtn.style.background  = '';
      poiBtn.style.color       = '';
      poiBtn.style.borderColor = '';
      closePoiCard();
    }

    updatePoiProgress();
    if (_mapSchemeImg) redrawMap();
  });

  poiSelect.addEventListener('change', function() {
    _poiDate = poiSelect.value;
    closePoiCard();
    updatePoiProgress();
    if (_mapSchemeImg) redrawMap();
  });
}

// Заполняем дропдаун датами
function fillPoiDateSelect(sel) {
  var dates = getAllMonitoringDates(); // из ui-utils.js
  var current = sel.value;
  sel.innerHTML = '<option value="">— выберите неделю —</option>';
  dates.forEach(function(d) {
    var opt = document.createElement('option');
    opt.value = d;
    opt.textContent = formatMonitoringDate(d);
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

// Получаем точки для ТИ (по выбранной дате, исключая уже замеренные сегодня)
function getPoiPoints() {
  if (!_poiDate) return [];
  var all = Points.getList();
  // Берём все точки с выбранной датой
  var byDate = all.filter(function(p) {
    return (p.monitoringDate || '').slice(0, 10) === _poiDate;
  });
  // Дедуплицируем по pointNumber — оставляем одну на номер
  var seen = {};
  var result = [];
  byDate.forEach(function(p) {
    if (!seen[p.pointNumber]) {
      seen[p.pointNumber] = true;
      result.push(p);
    }
  });
  return result;
}

// Получаем номера точек уже замеренных в текущую неделю
function getCurrentWeekNumbers() {
  if (!_poiDate) return {};
  var nums = {};
  Points.getList().forEach(function(p) {
    var d = (p.monitoringDate || '').slice(0, 10);
    // Point is "done this period" only if measured AFTER the reference date
    // d > _poiDate works correctly for ISO strings (YYYY-MM-DD)
    if (d && d > _poiDate) {
      nums[p.pointNumber] = true;
    }
  });
  return nums;
}

// Прогресс замеров
function updatePoiProgress() {
  var prog = document.getElementById('poi-progress');
  if (!prog || !_poiEnabled || !_poiDate) {
    if (prog) prog.style.display = 'none';
    return;
  }
  var poiPts    = getPoiPoints();
  var doneNums  = getCurrentWeekNumbers();
  var done      = poiPts.filter(function(p) { return doneNums[p.pointNumber]; }).length;
  prog.style.display   = '';
  prog.style.color     = done === poiPts.length ? 'var(--ok)' : 'var(--txt-3)';
  prog.textContent     = '✓ ' + done + ' / ' + poiPts.length;
  prog.title           = 'Замерено ' + done + ' из ' + poiPts.length + ' точек';
}

// Отрисовка серых маркеров ТИ на canvas
function drawPoiPoints(ctx, imgW, imgH, scale) {
  var pts      = getPoiPoints();
  var doneNums = getCurrentWeekNumbers();
  var R        = Math.max(8, 10 / scale);  // радиус адаптивный
  var fontSize = Math.max(7, 9 / scale);

  pts.forEach(function(p) {
    if (p.xLocal == null || p.yLocal == null) return;
    var px = MapModule.xyToPixel(p.xLocal, p.yLocal, imgW, imgH);
    if (!px) return;

    var alreadyDone = doneNums[p.pointNumber];

    ctx.save();

    // Тень для читаемости
    ctx.shadowColor   = 'rgba(0,0,0,.5)';
    ctx.shadowBlur    = 3;

    if (alreadyDone) {
      // Уже замерена в текущую неделю — зелёная галочка с обводкой
      ctx.strokeStyle = 'rgba(63,185,80,.6)';
      ctx.fillStyle   = 'rgba(13,17,23,.7)';
      ctx.lineWidth   = 1.2 / scale;
    } else {
      // Не замерена — серый маркер
      ctx.strokeStyle = 'rgba(139,148,158,.65)';
      ctx.fillStyle   = 'rgba(13,17,23,.7)';
      ctx.lineWidth   = 1.5 / scale;
    }

    // Кружок
    ctx.beginPath();
    ctx.arc(px.px, px.py, R, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Номер точки
    ctx.shadowBlur  = 0;
    ctx.fillStyle   = alreadyDone ? 'rgba(63,185,80,.7)' : 'rgba(139,148,158,.85)';
    ctx.font        = 'bold ' + fontSize + 'px Inter, sans-serif';
    ctx.textAlign   = 'center';
    ctx.textBaseline= 'middle';
    ctx.fillText(String(p.pointNumber), px.px, px.py);

    ctx.restore();
  });
}

// Поиск ТИ по клику
function findPoiAt(imgX, imgY, imgW, imgH, scale) {
  var pts = getPoiPoints();
  var R   = Math.max(10, 12 / scale);
  for (var i = 0; i < pts.length; i++) {
    var p = pts[i];
    if (p.xLocal == null) continue;
    var px = MapModule.xyToPixel(p.xLocal, p.yLocal, imgW, imgH);
    if (!px) continue;
    var dx = imgX - px.px, dy = imgY - px.py;
    if (dx*dx + dy*dy <= R*R) return p;
  }
  return null;
}

// Попап точки интереса
function showPoiCard(p, clientX, clientY) {
  closePoiCard();

  var doneNums  = getCurrentWeekNumbers();
  var isDone    = doneNums[p.pointNumber];
  var m3h       = p.flowRate != null ? (p.flowRate * 3.6).toFixed(2) + ' м³/ч' : '—';
  var date      = formatMonitoringDate(p.monitoringDate);

  var card = document.createElement('div');
  card.id  = 'poi-card';

  // Позиционируем рядом с курсором
  var wrap = document.getElementById('map-scheme-wrap');
  var wRect= wrap ? wrap.getBoundingClientRect() : { left:0, top:0 };
  var left = Math.min(clientX - wRect.left + 10, (wrap ? wrap.offsetWidth : 600) - 220);
  var top  = Math.min(clientY - wRect.top  + 10, (wrap ? wrap.offsetHeight: 400) - 200);

  card.style.cssText =
    'position:absolute;z-index:200;left:' + left + 'px;top:' + top + 'px;' +
    'width:210px;background:var(--bg-1);border:1px solid rgba(88,166,255,.4);' +
    'border-radius:6px;box-shadow:0 8px 24px rgba(0,0,0,.5);overflow:hidden';

  function row(label, val, color) {
    return '<div style="display:flex;justify-content:space-between;gap:6px;' +
      'padding:4px 10px;border-bottom:1px solid rgba(48,54,61,.4);font-size:10px">' +
      '<span style="color:var(--txt-3)">' + label + '</span>' +
      '<span style="color:' + (color || 'var(--txt-2)') + ';font-weight:500;text-align:right">' + escAttr(String(val)) + '</span>' +
      '</div>';
  }

  card.innerHTML =
    // Шапка
    '<div style="display:flex;align-items:center;justify-content:space-between;' +
    'padding:7px 10px;background:var(--bg-0);border-bottom:1px solid rgba(48,54,61,.6)">' +
      '<div style="display:flex;align-items:center;gap:7px">' +
        '<span style="width:7px;height:7px;border-radius:50%;flex-shrink:0;display:inline-block;background:' +
        (isDone ? 'var(--ok)' : 'rgba(139,148,158,.6)') + '"></span>' +
        '<span style="font-size:13px;font-weight:700;color:var(--gold)">№' + escAttr(p.pointNumber) + '</span>' +
        '<span style="font-size:11px;color:var(--txt-2)">' + escAttr(p.wall || p.domain || '') + '</span>' +
      '</div>' +
      '<button id="poi-card-close" style="width:20px;height:20px;border-radius:3px;border:1px solid var(--line);' +
      'background:transparent;color:var(--txt-2);font-size:12px;cursor:pointer;' +
      'display:flex;align-items:center;justify-content:center">✕</button>' +
    '</div>' +

    // Данные прошлого замера
    '<div style="padding:4px 0;">' +
      row('Замер', date, 'var(--txt-2)') +
      row('Дебит', m3h, 'var(--ok)') +
      (p.horizon    ? row('Горизонт',   p.horizon)       : '') +
      (p.domain     ? row('Домен',      p.domain)        : '') +
      (p.status     ? row('Статус',     p.status)        : '') +
      (p.intensity  ? row('Интенс.',    p.intensity)     : '') +
      (p.worker     ? row('Замерщик',   p.worker)        : '') +
    '</div>' +

    // Статус и кнопка
    '<div style="padding:8px 10px;border-top:1px solid rgba(48,54,61,.4)">' +
      (isDone
        ? '<div style="font-size:10px;color:var(--ok);text-align:center;padding:2px 0">✓ Замерена в текущую неделю</div>'
        : '<button id="poi-new-measure" data-pid="' + p.id + '" ' +
          'style="width:100%;height:28px;border-radius:4px;border:1px solid rgba(88,166,255,.5);' +
          'background:rgba(88,166,255,.12);color:var(--gold);font-size:11px;font-weight:600;' +
          'cursor:pointer;font-family:inherit">+ Новый замер по этой точке</button>'
      ) +
    '</div>';

  wrap.appendChild(card);

  // Закрытие
  card.querySelector('#poi-card-close').addEventListener('click', closePoiCard);

  // Кнопка нового замера
  var newBtn = card.querySelector('#poi-new-measure');
  if (newBtn) {
    newBtn.addEventListener('click', function() {
      closePoiCard();
      openAddFormFromPoi(p);
    });
  }
}

function closePoiCard() {
  var card = document.getElementById('poi-card');
  if (card) card.remove();
}

(function() {
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    // poi-card (точки интереса)
    var poiCard = document.getElementById('poi-card');
    if (poiCard) { poiCard.remove(); return; }
    // map-card (карточка точки на карте)
    var mapCard = document.getElementById('map-point-card');
    if (mapCard) { mapCard.remove(); return; }
  });
})();

// Открываем модальное окно добавления замера для точки интереса
function openAddFormFromPoi(p) {
  var old = document.getElementById('poi-add-meas-modal');
  if (old) old.remove();

  var workers = (typeof Workers !== 'undefined') ? Workers.getList() : [];
  var currentWorker = AppState.currentUser ? (AppState.currentUser.displayName || '') : '';
  var workerOpts = workers.map(function(w) {
    return '<option value="' + escAttr(w.name) + '"' + (w.name === currentWorker ? ' selected' : '') + '>' + escHTML(w.name) + '</option>';
  }).join('') || '<option value="">— выберите —</option>';

  function cloneOpts(id) {
    var el = document.getElementById(id);
    return el ? el.innerHTML : '<option value="">—</option>';
  }

  var CS = 'width:100%;box-sizing:border-box';  // common input style shortcut

  var modal = document.createElement('div');
  modal.id = 'poi-add-meas-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:8500;' +
    'display:flex;align-items:flex-start;justify-content:center;overflow-y:auto;padding:20px 10px';

  modal.innerHTML = [
    '<div style="background:var(--card-bg,#1e2530);border-radius:14px;padding:20px;',
      'width:min(720px,95vw);border:1px solid rgba(255,255,255,.08);margin:auto">',

    // ── Заголовок
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">',
      '<span style="font-size:15px;font-weight:600">+ Замер · Точка №' + escHTML(String(p.pointNumber || '?')) + '</span>',
      '<button id="pam-close" style="background:none;border:none;color:var(--txt-2);font-size:20px;cursor:pointer;line-height:1">✕</button>',
    '</div>',

    // ── Двухпанельный layout: форма | фото
    '<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">',

    // ── Левая панель: поля формы
    '<div style="flex:1;min-width:260px">',

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">',
      '<div class="form-group" style="margin:0"><label class="form-label">Дата замера</label>',
        '<input id="pm-monitoring-date" type="date" class="form-control" value="' + todayISO() + '" style="' + CS + '"></div>',
      '<div class="form-group" style="margin:0"><label class="form-label">Сотрудник</label>',
        '<select id="pm-worker" class="form-control" style="' + CS + '">' + workerOpts + '</select></div>',
    '</div>',

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">',
      '<div class="form-group" style="margin:0"><label class="form-label">Статус</label>',
        '<select id="pm-status" class="form-control" style="' + CS + '">' + cloneOpts('e-status') + '</select></div>',
      '<div class="form-group" style="margin:0"><label class="form-label">Интенсивность</label>',
        '<select id="pm-intensity" class="form-control" style="' + CS + '">' + cloneOpts('e-intensity') + '</select></div>',
    '</div>',

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">',
      '<div class="form-group" style="margin:0"><label class="form-label">Дебит, л/с</label>',
        '<input id="pm-flowrate" type="number" step="any" min="0" class="form-control" placeholder="0.00"' +
          (p.flowRate != null ? ' value="' + escAttr(String(p.flowRate)) + '"' : '') + ' style="' + CS + '"></div>',
      '<div class="form-group" style="margin:0"><label class="form-label">Метод замера</label>',
        '<select id="pm-measure" class="form-control" style="' + CS + '">' + cloneOpts('e-measure') + '</select></div>',
    '</div>',

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">',
      '<div class="form-group" style="margin:0"><label class="form-label">Домен</label>',
        '<select id="pm-domain" class="form-control" style="' + CS + '">' + cloneOpts('e-domain') + '</select></div>',
      '<div class="form-group" style="margin:0"><label class="form-label">Борт</label>',
        '<select id="pm-wall" class="form-control" style="' + CS + '">' + cloneOpts('e-wall') + '</select></div>',
    '</div>',

    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">',
      '<div class="form-group" style="margin:0"><label class="form-label">Горизонт</label>',
        '<input id="pm-horizon" type="text" class="form-control" value="' + escAttr(p.horizon || '') + '"',
          ' list="horizons-datalist" style="' + CS + '"></div>',
      '<div class="form-group" style="margin:0"><label class="form-label">Цвет воды</label>',
        '<select id="pm-color" class="form-control" style="' + CS + '">' + cloneOpts('e-color') + '</select></div>',
    '</div>',

    '<div class="form-group" style="margin-bottom:0"><label class="form-label">Комментарий</label>',
      '<textarea id="pm-comment" class="form-control" rows="2" style="' + CS + ';resize:vertical"></textarea></div>',

    '</div>', // конец левой панели

    // ── Правая панель: фото
    '<div class="photo-panel" style="flex:0 0 185px">',
      '<div class="form-label">Фото</div>',

      // Область превью
      '<div class="photo-panel-preview" id="pm-photo-preview">',
        '<span style="font-size:11px;color:rgba(180,190,210,.35);text-align:center;padding:8px">Нет фото</span>',
      '</div>',

      // Кнопка-ярлык: камера
      '<button type="button" id="pm-photo-cam-btn" class="photo-pick-btn btn btn-sm btn-outline"',
        ' style="justify-content:center;width:100%;box-sizing:border-box">',
        '📷 Сделать фото',
      '</button>',
      '<input type="file" id="pm-photo-cam" accept="image/*" class="photo-file-input">',

      // Кнопка-ярлык: галерея
      '<label for="pm-photo-gal" class="photo-pick-btn btn btn-sm btn-outline"',
        ' style="justify-content:center;width:100%;box-sizing:border-box">',
        '🖼 Из галереи',
      '</label>',
      '<input type="file" id="pm-photo-gal" accept="image/*" class="photo-file-input">',

      '<div id="pm-photo-progress" style="display:none"></div>',
    '</div>',

    '</div>', // конец flex-wrap

    // Скрытые поля координат / идентификатора
    '<input type="hidden" id="pm-num"    value="' + escAttr(String(p.pointNumber || '')) + '">',
    '<input type="hidden" id="pm-lat"    value="' + (p.lat    != null ? p.lat    : '') + '">',
    '<input type="hidden" id="pm-lon"    value="' + (p.lon    != null ? p.lon    : '') + '">',
    '<input type="hidden" id="pm-xlocal" value="' + (p.xLocal != null ? p.xLocal : '') + '">',
    '<input type="hidden" id="pm-ylocal" value="' + (p.yLocal != null ? p.yLocal : '') + '">',

    '<p id="pam-err" style="color:var(--red,#ea4335);font-size:13px;margin:12px 0 6px;display:none"></p>',
    '<button id="pam-save" class="btn btn-primary btn-full" style="margin-top:14px">Сохранить замер</button>',
    '</div>',
  ].join('');

  document.body.appendChild(modal);

  // Заполняем все поля последними данными точки (после вставки в DOM)
  var domSel    = document.getElementById('pm-domain');    if (domSel    && p.domain)        domSel.value    = p.domain;
  var wallSel   = document.getElementById('pm-wall');      if (wallSel   && p.wall)          wallSel.value   = p.wall;
  var colorSel  = document.getElementById('pm-color');     if (colorSel  && p.waterColor)    colorSel.value  = p.waterColor;
  var statusSel = document.getElementById('pm-status');    if (statusSel && p.status)        statusSel.value = p.status;
  var intensSel = document.getElementById('pm-intensity'); if (intensSel && p.intensity)     intensSel.value = p.intensity;
  var measSel   = document.getElementById('pm-measure');   if (measSel   && p.measureMethod) measSel.value   = p.measureMethod;
  var commentEl = document.getElementById('pm-comment');   if (commentEl && p.comment)       commentEl.value = p.comment;

  // Превью при выборе фото (оба input-а обновляют одну область)
  Photos.initPreview('pm-photo-cam', 'pm-photo-preview');
  Photos.initPreview('pm-photo-gal', 'pm-photo-preview');

  // Камера — открываем через getUserMedia (работает на Windows-планшетах)
  document.getElementById('pm-photo-cam-btn').addEventListener('click', function() {
    Photos.openCamera('pm-photo-preview', 'pm-photo-cam');
  });

  // Закрытие
  document.getElementById('pam-close').addEventListener('click', function() { Photos.clearCaptured(); modal.remove(); });
  modal.addEventListener('click', function(e) { if (e.target === modal) { Photos.clearCaptured(); modal.remove(); } });

  // Сохранение
  document.getElementById('pam-save').addEventListener('click', function() {
    var saveBtn = document.getElementById('pam-save');
    var errEl   = document.getElementById('pam-err');
    var data    = readFormFields('pm');

    errEl.style.display = 'none';
    if (!data.pointNumber) {
      errEl.textContent = 'Номер точки не определён'; errEl.style.display = ''; return;
    }

    saveBtn.disabled = true; saveBtn.textContent = 'Сохранение...';

    var photoFile = Photos.getFileAny(['pm-photo-cam', 'pm-photo-gal']);
    Toast.progress('save-poi-meas', 'Сохранение замера...');

    Points.create(data).then(function(savedPoint) {
      if (!photoFile || !savedPoint || !savedPoint.id) return null;
      Toast.progress('save-poi-meas', 'Загрузка фото...', 50);
      showPhotoProgress('pm-photo-progress', 'compressing', (photoFile.size / 1024 / 1024).toFixed(2) + ' МБ');
      var _extra = { pointNumber: data.pointNumber, monitoringDate: data.monitoringDate, flowRate: data.flowRate };
      return Photos.upload(photoFile, savedPoint.id, _extra).then(function(driveUrl) {
        showPhotoProgress('pm-photo-progress', 'done');
        var pt = Points.getById(savedPoint.id);
        if (pt) { pt.photoUrls = [driveUrl]; Storage.cachePoints(Points.getList()); }
      }).catch(function(photoErr) {
        showPhotoProgress('pm-photo-progress', 'error', photoErr.message);
        Toast.show('Замер сохранён, фото не загрузилось', 'warning');
      });
    }).then(function() {
      Photos.clearCaptured();
      modal.remove();
      return Points.load();
    }).then(function() {
      if (typeof renderPointsList === 'function') renderPointsList();
      updatePoiProgress();
      if (typeof _mapSchemeImg !== 'undefined' && _mapSchemeImg) {
        if (typeof HeatMap !== 'undefined') HeatMap.markDirty();
        redrawMap();
      }
      Toast.done('save-poi-meas', 'Замер добавлен');
    }).catch(function(err) {
      errEl.textContent = 'Ошибка: ' + err.message; errEl.style.display = '';
      saveBtn.disabled = false; saveBtn.textContent = 'Сохранить замер';
      Toast.fail('save-poi-meas', 'Ошибка: ' + err.message);
    });
  });

  setTimeout(function() {
    var fl = document.getElementById('pm-flowrate');
    if (fl) fl.focus();
  }, 100);
}
