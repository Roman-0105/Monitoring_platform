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
  // Растёт на каждый новый вызов loadMapForPlot/loadMapForWeek — если
  // пользователь быстро переключает участок/неделю, более старый (но всё
  // ещё выполняющийся) вызов после своих await должен видеть, что он уже
  // не последний, и не применять устаревший результат поверх более
  // нового состояния (иначе картинка/точки могут "отстать" от того, что
  // выбрано в интерфейсе — гонка состояний в модульном синглтоне).
  requestId: 0,
  colorMode: 'status', statusFilter: 'all', levelColorMap: {}, riskColorMap: {},
  // Домены видны по умолчанию, разломы — нет: та же асимметрия умолчаний,
  // что в domens.js (_visible=true) и faults.js (_visible=false) проекта
  // "Гидрогеологический мониторинг". Разломы/домены — только просмотр
  // (вкл/выкл слоя целиком), без создания/редактирования в этой панели.
  faults: [], domains: [], showFaults: false, showDomains: true, faultColor: '#e05c5c',
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
        '<div class="ri-map-color-bar" id="ri-map-color-bar">' +
          '<label class="ri-map-color-mode-label">Раскраска точек:' +
            '<select class="ri-input" id="ri-map-color-mode" style="max-width:200px;margin-left:6px">' +
              '<option value="status">По статусу</option>' +
              '<option value="level">По уровню опасности</option>' +
              '<option value="risk">По типу риска</option>' +
            '</select>' +
          '</label>' +
          '<label class="ri-map-color-mode-label">Показывать:' +
            '<select class="ri-input" id="ri-map-status-filter" style="max-width:180px;margin-left:6px">' +
              '<option value="all">Все обращения</option>' +
              '<option value="open">Только открытые</option>' +
              '<option value="closed">Только закрытые</option>' +
            '</select>' +
          '</label>' +
        '</div>' +
        '<div class="ri-map-wrap" id="ri-map-wrap">' +
          '<canvas id="ri-map-canvas"></canvas>' +
          '<div id="ri-map-empty" class="ri-map-empty" hidden></div>' +
          '<div class="ri-map-controls">' +
            '<button type="button" class="ri-btn ri-btn-icon" id="ri-map-zoom-in" title="Приблизить">＋</button>' +
            '<button type="button" class="ri-btn ri-btn-icon" id="ri-map-zoom-out" title="Отдалить">－</button>' +
            '<button type="button" class="ri-btn ri-btn-icon" id="ri-map-fit" title="По размеру">⤢</button>' +
            '<button type="button" class="ri-btn ri-btn-icon" id="ri-map-layers-toggle" title="Разломы и домены">🧩</button>' +
            '<button type="button" class="ri-btn ri-btn-icon" id="ri-map-legend-toggle" title="Условные обозначения">📋</button>' +
          '</div>' +
          '<div class="ri-map-legend-panel" id="ri-map-legend-panel" hidden>' +
            '<div class="ri-map-legend-panel-title">Условные обозначения</div>' +
            '<div class="ri-map-legend-item"><i class="ri-map-legend-line" style="background:#ef4444"></i>Контур карьера на конец отработки по поверхности</div>' +
            '<div class="ri-map-legend-item"><i class="ri-map-legend-line ri-map-legend-line-dark"></i>Фактическое положение горных работ на дату схемы</div>' +
            '<div class="ri-map-legend-item"><i class="ri-map-legend-hatch" style="--hc:#ef4444"></i>Особо опасные участки</div>' +
            '<div class="ri-map-legend-item"><i class="ri-map-legend-hatch" style="--hc:#f59e0b"></i>Опасные участки</div>' +
            '<div class="ri-map-legend-item"><i class="ri-map-legend-hatch" style="--hc:#22c55e"></i>Неопасные участки</div>' +
            '<div class="ri-map-legend-divider"></div>' +
            '<div class="ri-map-legend-item"><i class="ri-map-dot ri-map-dot-open"></i>Обращение открыто</div>' +
            '<div class="ri-map-legend-item"><i class="ri-map-dot ri-map-dot-closed"></i>Обращение закрыто</div>' +
          '</div>' +
          '<div class="ri-map-layers-panel" id="ri-map-layers-panel" hidden>' +
            '<div class="ri-map-legend-panel-title">Слои</div>' +
            '<label class="ri-map-layers-row"><input type="checkbox" id="ri-layer-faults-toggle"> 🪨 Разломы</label>' +
            '<label class="ri-map-layers-row"><input type="checkbox" id="ri-layer-domains-toggle" checked> 🗺️ Домены</label>' +
          '</div>' +
          '<div id="ri-map-tooltip" class="ri-map-tooltip" hidden></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  MapState.plots = await RiskApi.plotNames.list();
  if (!MapState.plots.length) return;

  var levelMap = await RiskApi.colors.getLevelColorMap();
  var riskMap = await RiskApi.colors.getRiskColorMap();
  MapState.levelColorMap = levelMap;
  MapState.riskColorMap = riskMap;
  MapState.faultColor = await RiskApi.colors.getFaultColor();

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
  // вкладке без ручной перезагрузки страницы. Заодно подхватываем цвета,
  // изменённые во вкладке "Настройка цветов".
  Promise.all([
    RiskApi.plotNames.list(),
    RiskApi.colors.getLevelColorMap(),
    RiskApi.colors.getRiskColorMap(),
    RiskApi.colors.getFaultColor(),
  ]).then(function(res) {
    var plots = res[0];
    MapState.plots = plots;
    MapState.levelColorMap = res[1];
    MapState.riskColorMap = res[2];
    MapState.faultColor = res[3];
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
  var myRequest = ++MapState.requestId;
  MapState.plotId = plotId;
  renderMapTabs(panelEl);

  var weeks = await RiskApi.schemes.listWeeks(plotId);
  if (myRequest !== MapState.requestId) return; // подоспел более новый вызов — этот результат уже неактуален
  MapState.weeks = weeks;
  MapState.weekKey = weeks.length ? weeks[0].weekKey : currentWeekKey();

  // Разломы и домены привязаны к участку целиком (не к неделе) — это
  // относительно статичные геологические особенности, а не еженедельные срезы.
  var faults = await RiskApi.faults.listByPlot(plotId);
  var domains = await RiskApi.domains.listByPlot(plotId);
  if (myRequest !== MapState.requestId) return;
  MapState.faults = faults;
  MapState.domains = domains;

  await loadMapForWeek(panelEl, plotId, MapState.weekKey, myRequest);
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

async function loadMapForWeek(panelEl, plotId, weekKey, requestToken) {
  // requestToken передаётся, когда вызывающая сторона (loadMapForPlot) уже
  // застолбила номер запроса — иначе (прямой вызов из недельного чипа/
  // инпута) считаем это новым запросом и застолбливаем номер сами.
  var myRequest = requestToken != null ? requestToken : ++MapState.requestId;
  MapState.weekKey = weekKey;
  renderMapWeekBar(panelEl);

  MapState.img = null; MapState.bounds = null; MapState.points = [];
  var emptyEl = panelEl.querySelector('#ri-map-empty');
  var scheme = await RiskApi.schemes.getByPlotWeek(plotId, weekKey);
  if (myRequest !== MapState.requestId) return;

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
  if (myRequest !== MapState.requestId) return;
  MapState.points = allCallLog.filter(function(r) {
    if (r.plotNameId !== plotId || r.xLocal == null || r.yLocal == null || !r.ddate) return false;
    return weekKeyForDate(new Date(r.ddate)) === weekKey;
  });

  var img = new Image();
  img.onload = function() {
    if (myRequest !== MapState.requestId) return; // пока грузилась картинка, выбор успел устареть
    MapState.img = img;
    sizeMapCanvas(panelEl);
    fitMap(panelEl);
  };
  img.src = scheme.imageUrl;
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

/* Цвет точки обращения — три взаимоисключающих режима (переключаются
 * селектом "Раскраска точек", см. ri-map-color-mode): по статусу (открыто/
 * закрыто, как раньше), по уровню опасности или по типу зафиксированного
 * риска (оба — через настраиваемые палитры RiskApi.colors, см. вкладку
 * "Настройка цветов"). */
/* ---------------- Отрисовка сцены схемы (общая для живой карты и снимков
 * для отчётов, см. ui-reports.js) ----------------
 * "state" — любой объект формы {img, bounds, scale, points, faults, domains,
 * showFaults, showDomains, faultColor, colorMode, statusFilter,
 * levelColorMap, riskColorMap}. MapState сам является таким объектом (плюс
 * ещё поля zoom/pan, сюда не относящиеся), поэтому вызовы ниже просто
 * передают его напрямую. Отчёты передают свой отдельный, более лёгкий
 * объект той же формы — благодаря этому не пришлось заводить вторую копию
 * логики отрисовки доменов/разломов/точек.
 */

function pointColorFor(pt, state) {
  if (state.colorMode === 'level') return state.levelColorMap[pt.levelId] || '#9ca3af';
  if (state.colorMode === 'risk') return state.riskColorMap[pt.fixedRiskId] || '#9ca3af';
  return pt.closed ? '#34d399' : '#f87171';
}

function filterByStatus(points, statusFilter) {
  if (statusFilter === 'open') return points.filter(function(p) { return !p.closed; });
  if (statusFilter === 'closed') return points.filter(function(p) { return p.closed; });
  return points;
}

/* Точки, которые сейчас положено рисовать на ЖИВОЙ карте и на которые можно
 * кликать/наводиться — фильтр "Показывать" применяется здесь один раз, а
 * не в каждом месте, где перебираются точки (используется в mapPointAt). */
function visiblePoints() {
  return filterByStatus(MapState.points, MapState.statusFilter);
}

function drawFaultsLayer(ctx, state, imgW, imgH) {
  if (!state.showFaults || !state.faults.length) return;
  ctx.save();
  ctx.strokeStyle = state.faultColor;
  ctx.lineWidth = 1.5 / state.scale;
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.75;
  state.faults.forEach(function(f) {
    var pts = f.points;
    if (!pts || pts.length < 2) return;
    var first = xyToPixel(pts[0][0], pts[0][1], state.bounds, imgW, imgH);
    ctx.beginPath();
    ctx.moveTo(first.px, first.py);
    for (var i = 1; i < pts.length; i++) {
      var p = xyToPixel(pts[i][0], pts[i][1], state.bounds, imgW, imgH);
      ctx.lineTo(p.px, p.py);
    }
    ctx.stroke();
  });
  ctx.restore();
}

function drawDomainsLayer(ctx, state, imgW, imgH) {
  if (!state.showDomains || !state.domains.length) return;
  var s = state.scale;
  state.domains.forEach(function(d) {
    var pts = d.points;
    if (!pts || pts.length < 3) return;
    ctx.save();
    ctx.beginPath();
    var first = xyToPixel(pts[0][0], pts[0][1], state.bounds, imgW, imgH);
    ctx.moveTo(first.px, first.py);
    for (var i = 1; i < pts.length; i++) {
      var p = xyToPixel(pts[i][0], pts[i][1], state.bounds, imgW, imgH);
      ctx.lineTo(p.px, p.py);
    }
    ctx.closePath();
    ctx.fillStyle = hexToRgba(d.color, 0.22);
    ctx.fill();
    ctx.strokeStyle = d.color;
    ctx.lineWidth = 1.5 / s;
    ctx.setLineDash([]);
    ctx.stroke();

    var cx = 0, cy = 0;
    pts.forEach(function(pt) {
      var px = xyToPixel(pt[0], pt[1], state.bounds, imgW, imgH);
      cx += px.px; cy += px.py;
    });
    cx /= pts.length; cy /= pts.length;
    var fs = Math.round(14 / s);
    ctx.fillStyle = d.color;
    ctx.font = '700 ' + fs + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4 / s;
    ctx.strokeText(d.name, cx, cy);
    ctx.fillText(d.name, cx, cy);
    ctx.restore();
  });
}

/* Рисует схему + домены + разломы + точки в уже готовый (транслированный/
 * отмасштабированный вызывающей стороной) ctx. state.scale используется
 * только для расчёта "экранно-постоянной" толщины линий/размера точек —
 * сам ctx.scale(...) вызывающая сторона делает самостоятельно ДО этого вызова. */
function renderMapScene(ctx, state) {
  var imgW = state.img.width, imgH = state.img.height;
  ctx.drawImage(state.img, 0, 0);

  drawDomainsLayer(ctx, state, imgW, imgH);
  drawFaultsLayer(ctx, state, imgW, imgH);

  filterByStatus(state.points, state.statusFilter).forEach(function(pt) {
    var pos = xyToPixel(pt.xLocal, pt.yLocal, state.bounds, imgW, imgH);
    var r = 7 / state.scale;
    ctx.beginPath();
    ctx.arc(pos.px, pos.py, r, 0, Math.PI * 2);
    ctx.fillStyle = pointColorFor(pt, state);
    ctx.fill();
    ctx.lineWidth = 2 / state.scale;
    ctx.strokeStyle = 'rgba(255,255,255,.9)';
    ctx.stroke();
  });
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
  renderMapScene(ctx, MapState);
  ctx.restore();
}

function mapPointAt(canvasX, canvasY) {
  if (!MapState.img || !MapState.bounds) return null;
  var wx = (canvasX - MapState.offX) / MapState.scale;
  var wy = (canvasY - MapState.offY) / MapState.scale;
  var thresh = 10 / MapState.scale;
  var found = null, bestDist = Infinity;
  visiblePoints().forEach(function(pt) {
    var pos = xyToPixel(pt.xLocal, pt.yLocal, MapState.bounds, MapState.img.width, MapState.img.height);
    var d = Math.hypot(pos.px - wx, pos.py - wy);
    if (d <= thresh && d < bestDist) { bestDist = d; found = pt; }
  });
  return found;
}

/* ---------------- Всплывающая карточка точки при наведении ---------------- */

function mapTooltipHTML(pt) {
  return (pt.photo ? '<img class="ri-map-tooltip-photo" src="' + escAttr(pt.photoUrl) + '" alt="">' : '') +
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

  // Легенда — чисто по кнопке: открылась/осталась открытой, пока не
  // нажмут кнопку ещё раз (клики вне панели, по карте и т.д. её не закрывают).
  var legendToggle = panelEl.querySelector('#ri-map-legend-toggle');
  var legendPanel = panelEl.querySelector('#ri-map-legend-panel');
  legendToggle.addEventListener('click', function(e) {
    e.stopPropagation();
    legendPanel.hidden = !legendPanel.hidden;
    legendToggle.classList.toggle('ri-btn-active', !legendPanel.hidden);
  });

  // Панель "Слои" (разломы/домены) — та же логика, что у легенды: строго
  // по кнопке, не закрывается кликом мимо.
  var layersToggle = panelEl.querySelector('#ri-map-layers-toggle');
  var layersPanel = panelEl.querySelector('#ri-map-layers-panel');
  layersToggle.addEventListener('click', function(e) {
    e.stopPropagation();
    layersPanel.hidden = !layersPanel.hidden;
    layersToggle.classList.toggle('ri-btn-active', !layersPanel.hidden);
  });

  // Раскраска точек: Статус / Уровень опасности / Тип риска — три
  // взаимоисключающих режима (это <select>, поэтому смена значения сама
  // по себе сбрасывает предыдущий выбор).
  panelEl.querySelector('#ri-map-color-mode').addEventListener('change', function(e) {
    MapState.colorMode = e.target.value;
    redrawMap();
  });
  // "Показывать" — независимый от раскраски фильтр видимости точек по
  // статусу обращения (см. visiblePoints()).
  panelEl.querySelector('#ri-map-status-filter').addEventListener('change', function(e) {
    MapState.statusFilter = e.target.value;
    hideMapTooltip(panelEl);
    redrawMap();
  });

  panelEl.querySelector('#ri-layer-faults-toggle').addEventListener('change', function(e) {
    MapState.showFaults = e.target.checked;
    redrawMap();
  });
  panelEl.querySelector('#ri-layer-domains-toggle').addEventListener('change', function(e) {
    MapState.showDomains = e.target.checked;
    redrawMap();
  });
}
