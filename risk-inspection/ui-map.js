/* Карта: схема участка + точки обращений по их X/Y (СК-42).
 * Проекция координат на пиксели — тот же расчёт, что и в калибровке
 * (см. xyToPixel в ui-utils.js), zoom/pan — упрощённая версия того же
 * canvas-подхода, что в проекте "Гидрогеологический мониторинг" (map.js/ui-map.js).
 */

var MapState = {
  plotId: null, plots: [], img: null, bounds: null, points: [],
  scale: 1, offX: 0, offY: 0, minScale: 0.05, maxScale: 8,
  dragging: false, dragMoved: false, lastX: 0, lastY: 0,
};

async function initMapPanel(panelEl) {
  panelEl.innerHTML =
    '<div class="ri-panel-card">' +
      '<div class="ri-panel-toolbar">' +
        '<span class="ri-panel-title">Карта</span>' +
        '<div class="ri-site-tabs" id="ri-map-tabs" style="margin-left:16px"></div>' +
      '</div>' +
      '<div class="ri-panel-body" style="padding:12px;display:flex;flex-direction:column">' +
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
        '</div>' +
      '</div>' +
    '</div>';

  MapState.plots = await RiskApi.plotNames.list();
  if (!MapState.plots.length) return;

  renderMapTabs(panelEl);
  setupMapInteraction(panelEl);
  window.addEventListener('resize', function() { sizeMapCanvas(panelEl); redrawMap(); });

  await loadMapForPlot(panelEl, MapState.plots[0].id);
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

async function loadMapForPlot(panelEl, plotId) {
  MapState.plotId = plotId;
  renderMapTabs(panelEl);
  MapState.img = null; MapState.bounds = null; MapState.points = [];

  var emptyEl = panelEl.querySelector('#ri-map-empty');
  var scheme = await RiskApi.schemes.getByPlot(plotId);

  if (!scheme) {
    emptyEl.hidden = false;
    emptyEl.innerHTML = '<p>Для этого участка ещё не загружена схема.</p>' +
      '<button type="button" class="ri-btn ri-btn-primary" onclick="openTab(\'schemes\')">Загрузить схему</button>';
    redrawMap();
    return;
  }
  if (scheme.xMin == null || scheme.xMax == null || scheme.yMin == null || scheme.yMax == null) {
    emptyEl.hidden = false;
    emptyEl.innerHTML = '<p>Схема загружена, но не откалибрована.</p>' +
      '<button type="button" class="ri-btn ri-btn-primary" onclick="openTab(\'schemes\')">Откалибровать</button>';
    redrawMap();
    return;
  }

  emptyEl.hidden = true;
  MapState.bounds = { xMin: scheme.xMin, xMax: scheme.xMax, yMin: scheme.yMin, yMax: scheme.yMax };

  var allCallLog = await RiskApi.calllog.list();
  MapState.points = allCallLog.filter(function(r) { return r.plotNameId === plotId && r.xLocal != null && r.yLocal != null; });

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

function setupMapInteraction(panelEl) {
  var canvas = panelEl.querySelector('#ri-map-canvas');
  var wrap = panelEl.querySelector('#ri-map-wrap');

  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    if (!MapState.img) return;
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
