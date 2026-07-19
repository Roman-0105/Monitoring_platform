/* Карта: схема участка + точки обращений по их X/Y (СК-42), обе — с
 * фильтром по неделе (та же неделя, что и у схемы в "Схемы участков").
 * Проекция координат на пиксели — тот же расчёт, что и в калибровке
 * (см. xyToPixel в ui-utils.js), zoom/pan — упрощённая версия того же
 * canvas-подхода, что в проекте "Гидрогеологический мониторинг" (map.js/ui-map.js).
 */

var MapState = {
  plotId: null, weekKey: null, weeks: [], plots: [], img: null, bounds: null, points: [],
  scale: 1, offX: 0, offY: 0, minScale: 0.05, maxScale: 8,
  dragging: false, dragMoved: false, lastX: 0, lastY: 0,
  hoveredPointId: null,
};

async function initMapPanel(panelEl) {
  panelEl.innerHTML =
    '<div class="ri-panel-card">' +
      '<div class="ri-panel-toolbar">' +
        '<span class="ri-panel-title">Карта</span>' +
        '<div class="ri-site-tabs" id="ri-map-tabs" style="margin-left:16px"></div>' +
        '<button class="ri-btn ri-btn-icon" id="ri-map-refresh" title="Обновить (подхватить новую схему/границы)" style="margin-left:auto">🔄</button>' +
      '</div>' +
      '<div class="ri-panel-body" style="padding:12px;display:flex;flex-direction:column">' +
        '<div class="ri-week-bar" id="ri-map-week-bar"></div>' +
        '<div class="ri-map-wrap" id="ri-map-wrap">' +
          '<canvas id="ri-map-canvas"></canvas>' +
          '<div id="ri-map-empty" class="ri-map-empty" hidden></div>' +
          '<div class="ri-map-controls">' +
            '<button type="button" class="ri-btn ri-btn-icon" id="ri-map-zoom-in" title="Приблизить">＋</button>' +
            '<button type="button" class="ri-btn ri-btn-icon" id="ri-map-zoom-out" title="Отдалить">－</button>' +
            '<button type="button" class="ri-btn ri-btn-icon" id="ri-map-fit" title="По размеру">⤢</button>' +
          '</div>' +
          '<div class="ri-map-legend">' +
            '<span><i class="ri-map-dot ri-map-dot-open"></i>Открыто</span>' +
            '<span><i class="ri-map-dot ri-map-dot-closed"></i>Закрыто</span>' +
          '</div>' +
          '<div id="ri-map-tooltip" class="ri-map-tooltip" hidden></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  MapState.plots = await RiskApi.plotNames.list();
  if (!MapState.plots.length) return;

  renderMapTabs(panelEl);
  setupMapInteraction(panelEl);
  window.addEventListener('resize', function() { sizeMapCanvas(panelEl); redrawMap(); });
  panelEl.querySelector('#ri-map-refresh').addEventListener('click', reloadActiveMapTab);

  await loadMapForPlot(panelEl, MapState.plots[0].id);
}

/* Вызывается из app.js при каждом переключении на вкладку "Карта" —
 * так подхватывается схема/границы, загруженные позже во вкладке
 * "Схемы участков" (initMapPanel выполняется только один раз при
 * первом открытии вкладки, а не при каждой активации). */
function reloadActiveMapTab() {
  var panelEl = document.getElementById('ri-panel-map');
  if (!panelEl || MapState.plotId == null) return;
  // Список участков тоже подгружаем заново — не только текущую схему —
  // чтобы новые участки (или переименования/удаления) появлялись на
  // вкладке без ручной перезагрузки страницы.
  RiskApi.plotNames.list().then(function(plots) {
    MapState.plots = plots;
    if (!plots.length) { renderMapTabs(panelEl); return; }
    var stillExists = plots.some(function(p) { return p.id === MapState.plotId; });
    loadMapForPlot(panelEl, stillExists ? MapState.plotId : plots[0].id);
  });
}

function renderMapTabs(panelEl) {
  var tabsEl = panelEl.querySelector('#ri-map-tabs');
  tabsEl.innerHTML = MapState.plots.map(function(p) {
    var active = p.id === MapState.plotId ? ' active' : '';
    return '<button type="button" class="ri-site-tab' + active + '" data-plot="' + p.id + '">' + escHTML(p.plotName) + '</button>';
  }).join('');
  tabsEl.querySelectorAll('.ri-site-tab').forEach(function(btn) {
    btn.addEventListener('click', function() { loadMapForPlot(panelEl, Number(btn.dataset.plot)); });
  });
}

/* Загружает список недель для участка и открывает самую свежую
 * (или текущую календарную неделю, если для участка ещё нет ни одной схемы). */
async function loadMapForPlot(panelEl, plotId) {
  MapState.plotId = plotId;
  renderMapTabs(panelEl);

  MapState.weeks = await RiskApi.schemes.listWeeks(plotId);
  MapState.weekKey = MapState.weeks.length ? MapState.weeks[0].weekKey : currentWeekKey();

  await loadMapForWeek(panelEl, plotId, MapState.weekKey);
}

function renderMapWeekBar(panelEl) {
  var bar = panelEl.querySelector('#ri-map-week-bar');
  bar.innerHTML =
    '<input type="week" class="ri-input" id="ri-map-week-input" value="' + escAttr(MapState.weekKey) + '" style="max-width:180px">' +
    (MapState.weeks.length ? '<div class="ri-week-chips">' + MapState.weeks.map(function(w) {
      var active = w.weekKey === MapState.weekKey ? ' active' : '';
      return '<button type="button" class="ri-week-chip' + active + '" data-week="' + escAttr(w.weekKey) + '">' + formatWeekKey(w.weekKey) + '</button>';
    }).join('') + '</div>' : '<span class="ri-form-hint">Для этого участка ещё нет ни одной загруженной недели</span>');

  bar.querySelector('#ri-map-week-input').addEventListener('change', function(e) {
    if (!e.target.value) return;
    loadMapForWeek(panelEl, MapState.plotId, e.target.value);
  });
  bar.querySelectorAll('.ri-week-chip').forEach(function(chip) {
    chip.addEventListener('click', function() { loadMapForWeek(panelEl, MapState.plotId, chip.dataset.week); });
  });
}

async function loadMapForWeek(panelEl, plotId, weekKey) {
  MapState.weekKey = weekKey;
  renderMapWeekBar(panelEl);

  MapState.img = null; MapState.bounds = null; MapState.points = [];
  var emptyEl = panelEl.querySelector('#ri-map-empty');
  var scheme = await RiskApi.schemes.getByPlotWeek(plotId, weekKey);

  if (!scheme) {
    emptyEl.hidden = false;
    emptyEl.innerHTML = '<p>Для «' + formatWeekKey(weekKey) + '» на этом участке ещё не загружена схема.</p>' +
      '<button type="button" class="ri-btn ri-btn-primary" onclick="openTab(\'schemes\')">Загрузить схему</button>';
    redrawMap();
    return;
  }
  if (scheme.xMin == null || scheme.xMax == null || scheme.yMin == null || scheme.yMax == null) {
    emptyEl.hidden = false;
    emptyEl.innerHTML = '<p>Схема этой недели загружена, но не откалибрована.</p>' +
      '<button type="button" class="ri-btn ri-btn-primary" onclick="openTab(\'schemes\')">Откалибровать</button>';
    redrawMap();
    return;
  }

  emptyEl.hidden = true;
  MapState.bounds = { xMin: scheme.xMin, xMax: scheme.xMax, yMin: scheme.yMin, yMax: scheme.yMax };

  var allCallLog = await RiskApi.calllog.list();
  MapState.points = allCallLog.filter(function(r) {
    if (r.plotNameId !== plotId || r.xLocal == null || r.yLocal == null || !r.ddate) return false;
    return weekKeyForDate(new Date(r.ddate)) === weekKey;
  });

  var img = new Image();
  img.onload = function() {
    MapState.img = img;
    sizeMapCanvas(panelEl);
    fitMap(panelEl);
  };
  img.src = scheme.image;
}

function sizeMapCanvas(panelEl) {
  var wrap = panelEl.querySelector('#ri-map-wrap');
  var canvas = panelEl.querySelector('#ri-map-canvas');
  if (!wrap || !canvas) return;
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
}

function fitMap(panelEl) {
  var canvas = panelEl.querySelector('#ri-map-canvas');
  if (!canvas || !MapState.img) return;
  var fitScale = Math.min(canvas.width / MapState.img.width, canvas.height / MapState.img.height) * 0.94;
  MapState.scale = Math.min(MapState.maxScale, fitScale > 0 ? fitScale : 1);
  MapState.offX = (canvas.width - MapState.img.width * MapState.scale) / 2;
  MapState.offY = (canvas.height - MapState.img.height * MapState.scale) / 2;
  redrawMap();
}

function redrawMap() {
  var canvas = document.getElementById('ri-map-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!MapState.img || !MapState.bounds) return;

  ctx.save();
  ctx.translate(MapState.offX, MapState.offY);
  ctx.scale(MapState.scale, MapState.scale);
  ctx.drawImage(MapState.img, 0, 0);

  MapState.points.forEach(function(pt) {
    var pos = xyToPixel(pt.xLocal, pt.yLocal, MapState.bounds, MapState.img.width, MapState.img.height);
    var r = 7 / MapState.scale;
    ctx.beginPath();
    ctx.arc(pos.px, pos.py, r, 0, Math.PI * 2);
    ctx.fillStyle = pt.closed ? '#34d399' : '#f87171';
    ctx.fill();
    ctx.lineWidth = 2 / MapState.scale;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.stroke();
  });

  ctx.restore();
}

function mapPointAt(canvasX, canvasY) {
  if (!MapState.img || !MapState.bounds) return null;
  var wx = (canvasX - MapState.offX) / MapState.scale;
  var wy = (canvasY - MapState.offY) / MapState.scale;
  var thresh = 10 / MapState.scale;
  var found = null, bestDist = Infinity;
  MapState.points.forEach(function(pt) {
    var pos = xyToPixel(pt.xLocal, pt.yLocal, MapState.bounds, MapState.img.width, MapState.img.height);
    var d = Math.hypot(pos.px - wx, pos.py - wy);
    if (d <= thresh && d < bestDist) { bestDist = d; found = pt; }
  });
  return found;
}

/* ---------------- Всплывающая карточка точки при наведении ---------------- */

function mapTooltipHTML(pt) {
  return (pt.photo ? '<img class="ri-map-tooltip-photo" src="' + pt.photoUrl + '" alt="">' : '') +
    '<div class="ri-map-tooltip-body">' +
      '<div class="ri-map-tooltip-title">' + escHTML(pt.fname) + '</div>' +
      '<div class="ri-map-tooltip-row">' + escHTML(pt.fixedRisk) + '</div>' +
      (pt.level ? '<div class="ri-map-tooltip-row">' + levelBadge(pt.level) + '</div>' : '') +
      '<div class="ri-map-tooltip-date">' + formatDate(pt.ddate) + '</div>' +
    '</div>';
}

function showMapTooltip(panelEl, pt, x, y) {
  var tip = panelEl.querySelector('#ri-map-tooltip');
  if (!tip) return;
  if (MapState.hoveredPointId !== pt.id) {
    tip.innerHTML = mapTooltipHTML(pt);
    MapState.hoveredPointId = pt.id;
  }
  tip.hidden = false;
  var wrap = panelEl.querySelector('#ri-map-wrap');
  var left = Math.min(x + 16, Math.max(8, wrap.clientWidth - tip.offsetWidth - 8));
  var top = Math.min(y + 16, Math.max(8, wrap.clientHeight - tip.offsetHeight - 8));
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

function hideMapTooltip(panelEl) {
  var tip = panelEl.querySelector('#ri-map-tooltip');
  if (tip) tip.hidden = true;
  MapState.hoveredPointId = null;
}

function setupMapInteraction(panelEl) {
  var canvas = panelEl.querySelector('#ri-map-canvas');
  var wrap = panelEl.querySelector('#ri-map-wrap');

  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    if (!MapState.img) return;
    hideMapTooltip(panelEl);
    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;
    var wx = (mx - MapState.offX) / MapState.scale, wy = (my - MapState.offY) / MapState.scale;
    var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    MapState.scale = Math.min(MapState.maxScale, Math.max(MapState.minScale, MapState.scale * factor));
    MapState.offX = mx - wx * MapState.scale;
    MapState.offY = my - wy * MapState.scale;
    redrawMap();
  }, { passive: false });

  canvas.addEventListener('mousedown', function(e) {
    MapState.dragging = true; MapState.dragMoved = false;
    MapState.lastX = e.clientX; MapState.lastY = e.clientY;
    canvas.style.cursor = 'grabbing';
    hideMapTooltip(panelEl);
  });
  window.addEventListener('mousemove', function(e) {
    if (!MapState.dragging) return;
    var dx = e.clientX - MapState.lastX, dy = e.clientY - MapState.lastY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) MapState.dragMoved = true;
    MapState.offX += dx; MapState.offY += dy;
    MapState.lastX = e.clientX; MapState.lastY = e.clientY;
    redrawMap();
  });
  window.addEventListener('mouseup', function() {
    if (MapState.dragging) canvas.style.cursor = 'grab';
    MapState.dragging = false;
  });

  canvas.addEventListener('mousemove', function(e) {
    if (MapState.dragging) return;
    var rect = canvas.getBoundingClientRect();
    var x = e.clientX - rect.left, y = e.clientY - rect.top;
    var pt = mapPointAt(x, y);
    if (pt) { canvas.style.cursor = 'pointer'; showMapTooltip(panelEl, pt, x, y); }
    else { canvas.style.cursor = 'grab'; hideMapTooltip(panelEl); }
  });
  canvas.addEventListener('mouseleave', function() { hideMapTooltip(panelEl); });

  canvas.addEventListener('click', function(e) {
    if (MapState.dragMoved) return;
    var rect = canvas.getBoundingClientRect();
    var pt = mapPointAt(e.clientX - rect.left, e.clientY - rect.top);
    if (pt) openJournalDetail(pt.id);
  });
  canvas.style.cursor = 'grab';

  panelEl.querySelector('#ri-map-zoom-in').addEventListener('click', function() {
    MapState.scale = Math.min(MapState.maxScale, MapState.scale * 1.3); redrawMap();
  });
  panelEl.querySelector('#ri-map-zoom-out').addEventListener('click', function() {
    MapState.scale = Math.max(MapState.minScale, MapState.scale / 1.3); redrawMap();
  });
  panelEl.querySelector('#ri-map-fit').addEventListener('click', function() { fitMap(panelEl); });
}
