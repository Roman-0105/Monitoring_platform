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
var _mapAddMode        = false;
var _mapDragging       = false;
var _mapDragStartX     = 0;
var _mapDragStartY     = 0;
var _mapFilters        = { dates: [], worker: 'all' };
var _mapUiState        = { showFilter: true, showLegend: true };
var _mapSelectedWeekKey = 'auto';
var _tooltipEl         = null;

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
  var wrap = document.getElementById('map-scheme-wrap');
  if (!wrap) return;
  canvas.width  = wrap.clientWidth  || 400;
  canvas.height = wrap.clientHeight || 600;
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
  if (_mapSelectedWeekKey !== 'auto' && !Schemes.getByWeek(_mapSelectedWeekKey)) {
    _mapSelectedWeekKey = 'auto';
  }
  sel.value = _mapSelectedWeekKey || 'auto';
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
      if (wrap) {
        var fitScale = Math.min(wrap.clientWidth / img.width, wrap.clientHeight / img.height);
        var lim = getMapZoomLimits();
        _mapScale = Math.max(lim.min, Math.min(lim.max, fitScale > 0 ? fitScale : 1));
      } else {
        var lim2 = getMapZoomLimits();
        _mapScale = Math.max(lim2.min, Math.min(lim2.max, 1));
      }
      _mapOffX = 0;
      _mapOffY = 0;
      setupMapCanvas(canvas);
      initMapFilters();
      redrawMap();
      initMapInteraction(canvas);
      initMapZoomButtons();
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
  if (typeof Domens !== 'undefined') {
    Domens.draw(ctx, _mapSchemeImg.width, _mapSchemeImg.height);
  }
  if (typeof MapModule !== 'undefined') {
    MapModule.drawPoints(ctx, getFilteredPointsForMap(), _mapSchemeImg.width, _mapSchemeImg.height, _mapScale);
    // Рисуем маркеры канав поверх точек
    if (typeof DitchState !== 'undefined' && MapModule.drawDitches) {
      MapModule.drawDitches(ctx, getFilteredDitchesForMap(), _mapSchemeImg.width, _mapSchemeImg.height, _mapScale);
    }
  }
  ctx.restore();
  var sbScale = document.getElementById('sb-scale');
  if (sbScale) sbScale.textContent = 'x' + _mapScale.toFixed(2);
}

// ── Зум ──────────────────────────────────────────────────

function zoomMap(factor) {
  var canvas = document.getElementById('map-canvas');
  if (!canvas) return;
  var cx = canvas.width  / 2;
  var cy = canvas.height / 2;
  var limits = getMapZoomLimits();
  var newScale = Math.max(limits.min, Math.min(limits.max, _mapScale * factor));
  _mapOffX = cx - (cx - _mapOffX) * (newScale / _mapScale);
  _mapOffY = cy - (cy - _mapOffY) * (newScale / _mapScale);
  _mapScale = newScale;
  redrawMap();
}

function fitMap() {
  if (!_mapSchemeImg) return;
  var canvas = document.getElementById('map-canvas');
  if (!canvas) return;
  var fitScale = Math.min(canvas.width / _mapSchemeImg.width, canvas.height / _mapSchemeImg.height);
  var lim = getMapZoomLimits();
  _mapScale = Math.max(lim.min, Math.min(lim.max, fitScale > 0 ? fitScale : 1));
  _mapOffX  = (canvas.width  - _mapSchemeImg.width  * _mapScale) / 2;
  _mapOffY  = (canvas.height - _mapSchemeImg.height * _mapScale) / 2;
  redrawMap();
}

function initMapZoomButtons() {
  var wrap = document.getElementById('map-scheme-wrap');
  if (!wrap || wrap.querySelector('.map-zoom-controls')) return;

  var controls = document.createElement('div');
  controls.className = 'map-zoom-controls';
  controls.innerHTML =
    '<button class="map-zoom-btn" id="map-zoom-in"  title="Приблизить">+</button>' +
    '<button class="map-zoom-btn" id="map-zoom-out" title="Отдалить">−</button>' +
    '<button class="map-zoom-btn" id="map-zoom-fit" title="По размеру" style="font-size:13px">⊡</button>';
  wrap.appendChild(controls);

  document.getElementById('map-zoom-in').addEventListener('click',  function() { zoomMap(1.3); });
  document.getElementById('map-zoom-out').addEventListener('click', function() { zoomMap(0.77); });
  document.getElementById('map-zoom-fit').addEventListener('click', function() { fitMap(); });
}

// ── Взаимодействие ───────────────────────────────────────

function initMapInteraction(canvas) {
  if (canvas._mapBound) return;
  canvas._mapBound = true;

  // Колесо мыши — зум
  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    var rect   = canvas.getBoundingClientRect();
    var mouseX = e.clientX - rect.left;
    var mouseY = e.clientY - rect.top;
    var delta  = e.deltaY > 0 ? 0.85 : 1.18;
    var limits = getMapZoomLimits();
    var newScale = Math.max(limits.min, Math.min(limits.max, _mapScale * delta));
    _mapOffX = mouseX - (mouseX - _mapOffX) * (newScale / _mapScale);
    _mapOffY = mouseY - (mouseY - _mapOffY) * (newScale / _mapScale);
    _mapScale = newScale;
    redrawMap();
  }, { passive: false });

  // Touch — pinch zoom + pan
  var lastTouchDist = 0;
  var lastTouchX = 0;
  var lastTouchY = 0;

  canvas.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2) {
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist = Math.sqrt(dx*dx + dy*dy);
    } else if (e.touches.length === 1) {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
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
        var limits = getMapZoomLimits();
        var newScale = Math.max(limits.min, Math.min(limits.max, _mapScale * ratio));
        _mapOffX = mx - (mx - _mapOffX) * (newScale / _mapScale);
        _mapOffY = my - (my - _mapOffY) * (newScale / _mapScale);
        _mapScale = newScale;
        redrawMap();
      }
      lastTouchDist = dist;
    } else if (e.touches.length === 1 && _mapDragging && !_mapAddMode) {
      var ddx = e.touches[0].clientX - lastTouchX;
      var ddy = e.touches[0].clientY - lastTouchY;
      _mapOffX += ddx;
      _mapOffY += ddy;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      redrawMap();
    }
  }, { passive: false });

  canvas.addEventListener('touchend', function(e) {
    if (e.touches.length < 2) lastTouchDist = 0;
    if (e.touches.length === 0) _mapDragging = false;
  }, { passive: true });

  // Mouse drag — pan
  canvas.addEventListener('mousedown', function(e) {
    if (_mapAddMode) return;
    _mapDragging   = true;
    _mapDragStartX = e.clientX - _mapOffX;
    _mapDragStartY = e.clientY - _mapOffY;
    canvas.style.cursor = 'grabbing';
  });

  canvas.addEventListener('mousemove', function(e) {
    var rect = canvas.getBoundingClientRect();
    var cx   = e.clientX - rect.left;
    var cy   = e.clientY - rect.top;

    if (_mapDragging && !_mapAddMode) {
      _mapOffX = e.clientX - _mapDragStartX;
      _mapOffY = e.clientY - _mapDragStartY;
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
    if (!_mapAddMode && _mapSchemeImg && typeof MapModule !== 'undefined') {
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
      var local = MapModule.pixelToXY(imgX, imgY, _mapSchemeImg.width, _mapSchemeImg.height);
      openAddPointModal(local.x, local.y);
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
      // Затем точку
      var p = MapModule.findPointAt(imgX, imgY, getFilteredPointsForMap(),
                _mapSchemeImg.width, _mapSchemeImg.height, _mapScale);
      if (p) showMapPointCard(p);
    }
  });

  canvas.style.cursor = 'grab';
}

// ── Фильтры карты ─────────────────────────────────────────

function initMapFilters() {
  var workerSel = document.getElementById('map-filter-worker');
  if (!workerSel) return;

  // Виджет дат — пересобираем каждый раз
  buildDateFilterWidget('map-date-filter-wrap', _mapFilters.dates, function(newDates) {
    _mapFilters.dates = newDates;
    redrawMap();
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
      redrawMap();
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

  function statusRows() {
    var rows = '';
    ['Новая', 'Активная', 'Иссякает', 'Пересохла', 'Паводковая', 'Перелив'].forEach(function(s) {
      var c = cfg.statusColors[s] || '#777';
      rows += '<div class="map-legend-item"><span class="map-legend-dot" style="background:' + c + '"></span><span>' + s + '</span></div>';
    });
    return rows;
  }
  function intensityRows() {
    var rows = '<div class="map-legend-subtitle">Интенсивность (размер маркера)</div>';
    [['Слабая (капёж)', 'i-weak'], ['Умеренная', 'i-mid'], ['Сильная (поток)', 'i-strong'], ['Очень сильная', 'i-vstrong']].forEach(function(pair) {
      rows += '<div class="map-legend-item"><span class="map-legend-dot map-intensity-dot ' + pair[1] + '"></span><span>' + pair[0] + '</span></div>';
    });
    return rows;
  }

  if (mode === 'simple') {
    html += '<div class="map-legend-subtitle">Simple</div>';
    html += '<div class="map-legend-item"><span class="map-legend-dot" style="background:' + cfg.simpleColor + '"></span><span>Единый цвет точек</span></div>';
  } else if (mode === 'status') {
    html += '<div class="map-legend-subtitle">Status</div>' + statusRows();
  } else if (mode === 'intensity') {
    html += '<div class="map-legend-subtitle">Intensity</div>';
    html += '<div class="map-legend-item"><span class="map-legend-dot" style="background:' + cfg.intensityColor + '"></span><span>Единый цвет</span></div>';
    html += intensityRows();
  } else {
    html += '<div class="map-legend-subtitle">Combined</div>';
    html += '<div class="form-hint" style="margin-bottom:6px">Размер = интенсивность, badge = статус</div>';
    html += intensityRows();
    html += '<hr style="border:none;border-top:1px solid var(--line-2);margin:8px 0">';
    html += statusRows();
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
      '<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;' +
      'border-radius:4px;background:#4090e8;color:#fff;font-size:10px;font-weight:700">≈</span>' +
      '<span style="font-size:12px">Канава водопритока</span></div>';
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
  if (p.comment) html += '<div class="mpc-comment">' + p.comment + '</div>';
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
    var dtid = Toast.progress('del-point', 'Удаление точки...');
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
  html += '<button class="mpc-close" onclick="this.closest(\'.map-point-card\').remove()">✕</button>';
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

  // Кнопки — data-атрибуты вместо inline onclick
  html += '<div class="mpc-actions">';
  html += '<button class="btn btn-sm btn-outline dmc-edit-btn" data-did="' + escAttr(ditch.id) + '">✏️ Изменить</button>';
  html += '<button class="btn btn-sm btn-outline dmc-hist-btn" data-did="' + escAttr(ditch.id) + '" data-dname="' + escAttr(ditch.ditchName) + '">📈 История</button>';
  html += '<button class="btn btn-sm btn-outline dmc-move-btn" data-did="' + escAttr(ditch.id) + '" style="color:var(--gold);border-color:rgba(200,160,18,.35)" title="Кликните на карте чтобы уточнить позицию маркера">🎯 Позиция</button>';
  html += '<button class="btn btn-sm btn-outline dmc-del-btn" data-did="' + escAttr(ditch.id) + '" data-dname="' + escAttr(ditch.ditchName) + '" style="color:var(--red,#e05050);border-color:rgba(224,80,80,.3)">🗑 Удалить</button>';
  html += '</div>';
  html += '<div class="dmc-hist-panel" style="display:none;max-height:200px;overflow-y:auto"></div>';

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
    var dtid = Toast.progress('del-point', 'Удаление точки...');
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
  html += '<button class="mpc-close" onclick="this.closest(\'.map-point-card\').remove()">✕</button>';
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
