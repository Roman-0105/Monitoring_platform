/* ui-heatmap.js — тепловая карта водопритока поверх схемы карьера */

var HeatMap = (function() {
  var _enabled  = false;
  var _mode     = 'q';      // 'q' | 'status' | 'horizon'
  var _radius   = 0.06;     // доля от ширины схемы
  var _opacity  = 0.70;
  var _canvas   = null;
  var _animReq  = null;

  // Статусы → вес для режима status
  var STATUS_WEIGHT = {
    'Паводковая': 1.0, 'Перелив': 1.0,
    'Активная':   0.55, 'Новая': 0.20,
    'Иссякает':   0.15, 'Пересохла': 0.05,
  };

  // ── Цветовая шкала: синий → голубой → зелёный → жёлтый → оранжевый → красный
  var STOPS = [
    [0,    [15,  30, 100]],
    [0.20, [10, 120, 190]],
    [0.42, [25, 185, 105]],
    [0.62, [210, 215,  20]],
    [0.80, [255, 145,   0]],
    [1.0,  [225,  25,  25]],
  ];

  function heatColor(v) {
    v = Math.max(0, Math.min(1, v));
    var i = 0;
    for (; i < STOPS.length - 2; i++) { if (v <= STOPS[i + 1][0]) break; }
    var t = (v - STOPS[i][0]) / (STOPS[i + 1][0] - STOPS[i][0]);
    t = Math.max(0, Math.min(1, t));
    var a = STOPS[i][1], b = STOPS[i + 1][1];
    return [
      Math.round(a[0] + t * (b[0] - a[0])),
      Math.round(a[1] + t * (b[1] - a[1])),
      Math.round(a[2] + t * (b[2] - a[2])),
    ];
  }

  function getPointValue(p, maxQ, minH, maxH) {
    if (_mode === 'q') {
      return maxQ > 0 ? (parseFloat(p.flowRate) || 0) / maxQ : 0;
    }
    if (_mode === 'status') {
      return STATUS_WEIGHT[p.status] || 0.1;
    }
    if (_mode === 'horizon') {
      var h = parseFloat(p.horizon) || 0;
      var range = maxH - minH;
      return range > 0 ? 1 - (h - minH) / range : 0.5;
    }
    return 0;
  }

  function draw() {
    if (!_canvas || !_enabled) return;

    // Берём схему и точки из глобального состояния
    var img    = window._mapSchemeImg;
    var scale  = window._mapScale  || 1;
    var offX   = window._mapOffX   || 0;
    var offY   = window._mapOffY   || 0;
    var points = typeof getFilteredPointsForMap === 'function'
      ? getFilteredPointsForMap()
      : (typeof Points !== 'undefined' ? Points.getList() : []);

    if (!img || !points.length) { clear(); return; }

    var cW = _canvas.width;
    var cH = _canvas.height;
    var ctx = _canvas.getContext('2d');
    ctx.clearRect(0, 0, cW, cH);

    // Реальные размеры схемы на экране после трансформации
    var imgScreenW = img.width  * scale;
    var imgScreenH = img.height * scale;
    var radiusPx   = img.width  * _radius * scale;

    // Фильтруем точки с координатами
    var pts = [];
    var maxQ = 0, minH = Infinity, maxH = -Infinity;

    points.forEach(function(p) {
      var x = p.xLocal, y = p.yLocal;
      if ((x == null || y == null) && p.lat && p.lon &&
          typeof MapModule !== 'undefined') {
        var xy = MapModule.wgs84ToXY ? MapModule.wgs84ToXY(p.lat, p.lon) : null;
        if (xy) { x = xy.x; y = xy.y; }
      }
      if (x == null || y == null) return;

      // Переводим в пиксели схемы, потом в экранные через transform
      var pos = MapModule.xyToPixel(x, y, img.width, img.height);
      var sx  = offX + pos.px * scale;
      var sy  = offY + pos.py * scale;

      var q = parseFloat(p.flowRate) || 0;
      if (q > maxQ) maxQ = q;
      var h = parseFloat(p.horizon) || 0;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;

      pts.push({ p: p, sx: sx, sy: sy, q: q });
    });

    if (!pts.length) { clear(); return; }

    // Рисуем попиксельно через ImageData (быстрее OffscreenCanvas)
    var imgData = ctx.createImageData(cW, cH);
    var data    = imgData.data;

    for (var py = 0; py < cH; py++) {
      for (var px = 0; px < cW; px++) {
        var val = 0;
        for (var k = 0; k < pts.length; k++) {
          var pt  = pts[k];
          var dx  = px - pt.sx;
          var dy  = py - pt.sy;
          var d   = Math.sqrt(dx * dx + dy * dy);
          if (d < radiusPx) {
            var falloff = 1 - d / radiusPx;
            falloff = falloff * falloff; // квадратичное затухание
            val += getPointValue(pt.p, maxQ, minH, maxH) * falloff;
          }
        }
        val = Math.min(1, val * 1.4);
        if (val > 0.025) {
          var rgb = heatColor(val);
          var idx = (py * cW + px) * 4;
          data[idx]     = rgb[0];
          data[idx + 1] = rgb[1];
          data[idx + 2] = rgb[2];
          data[idx + 3] = Math.round(val * 235 * _opacity);
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  function clear() {
    if (!_canvas) return;
    _canvas.getContext('2d').clearRect(0, 0, _canvas.width, _canvas.height);
  }

  function enable(on) {
    _enabled = on;
    if (_canvas) _canvas.style.display = on ? 'block' : 'none';
    if (on) draw();
    else clear();
    updateButton();
  }

  function toggle() { enable(!_enabled); }

  function setMode(m) { _mode = m; if (_enabled) draw(); }
  function setRadius(r) { _radius = r; if (_enabled) draw(); }
  function setOpacity(o) { _opacity = o; if (_canvas) _canvas.style.opacity = o; if (_enabled) draw(); }

  function updateButton() {
    var btn = document.getElementById('btn-heatmap-toggle');
    if (!btn) return;
    btn.style.background = _enabled ? 'rgba(249,171,0,.2)' : '';
    btn.style.borderColor = _enabled ? 'rgba(249,171,0,.5)' : '';
    btn.style.color = _enabled ? '#f9ab00' : '';
    btn.textContent = _enabled ? '🌡 Тепло ВКЛ' : '🌡 Тепло';
  }

  function init() {
    // Создаём canvas поверх map-canvas
    var mapCanvas = document.getElementById('map-canvas');
    if (!mapCanvas) return;

    // Удаляем старый если есть
    var old = document.getElementById('heatmap-canvas');
    if (old) old.remove();

    _canvas = document.createElement('canvas');
    _canvas.id = 'heatmap-canvas';
    _canvas.width  = mapCanvas.width;
    _canvas.height = mapCanvas.height;
    _canvas.style.cssText =
      'position:absolute;top:0;left:0;pointer-events:none;' +
      'width:100%;height:100%;border-radius:inherit;display:none;';

    mapCanvas.parentNode.style.position = 'relative';
    mapCanvas.parentNode.appendChild(_canvas);

    // Панель настроек тепловой карты
    renderControls();
    updateButton();
  }

  function renderControls() {
    var panel = document.getElementById('heatmap-panel');
    if (!panel) return;

    panel.innerHTML =
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:8px 12px;' +
        'background:rgba(18,24,40,.92);border-radius:8px;border:1px solid rgba(249,171,0,.2)">' +

        '<span style="font-size:11px;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.06em">Тепловая карта:</span>' +

        '<select id="hm-mode" onchange="HeatMap.setMode(this.value)" ' +
          'style="font-size:12px;padding:4px 8px;background:rgba(255,255,255,.08);' +
          'border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#e0e4f0">' +
          '<option value="q">По Q (водоприток)</option>' +
          '<option value="status">По статусу</option>' +
          '<option value="horizon">По горизонту</option>' +
        '</select>' +

        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span style="font-size:11px;color:rgba(255,255,255,.5)">Радиус</span>' +
          '<input type="range" id="hm-radius" min="2" max="15" value="6" step="1" ' +
            'style="width:70px" ' +
            'oninput="HeatMap.setRadius(this.value/100);document.getElementById(\'hm-radius-v\').textContent=this.value">' +
          '<span id="hm-radius-v" style="font-size:11px;color:rgba(255,255,255,.4);min-width:16px">6</span>' +
        '</div>' +

        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span style="font-size:11px;color:rgba(255,255,255,.5)">Яркость</span>' +
          '<input type="range" id="hm-opacity" min="20" max="100" value="70" step="5" ' +
            'style="width:70px" ' +
            'oninput="HeatMap.setOpacity(this.value/100);document.getElementById(\'hm-opacity-v\').textContent=this.value+\'%\'">' +
          '<span id="hm-opacity-v" style="font-size:11px;color:rgba(255,255,255,.4);min-width:28px">70%</span>' +
        '</div>' +

        // Шкала цветов
        '<div style="display:flex;align-items:center;gap:5px;margin-left:4px">' +
          '<span style="font-size:10px;color:rgba(255,255,255,.4)">0</span>' +
          '<canvas id="hm-legend-bar" width="80" height="8" style="border-radius:3px"></canvas>' +
          '<span style="font-size:10px;color:rgba(255,255,255,.4)">max</span>' +
        '</div>' +
      '</div>';

    // Рисуем шкалу цветов
    var bar = document.getElementById('hm-legend-bar');
    if (bar) {
      var bCtx = bar.getContext('2d');
      for (var i = 0; i < 80; i++) {
        var rgb = heatColor(i / 79);
        bCtx.fillStyle = 'rgb(' + rgb.join(',') + ')';
        bCtx.fillRect(i, 0, 1, 8);
      }
    }
  }

  return {
    init:       init,
    toggle:     toggle,
    enable:     enable,
    draw:       draw,
    clear:      clear,
    setMode:    setMode,
    setRadius:  setRadius,
    setOpacity: setOpacity,
    isEnabled:  function() { return _enabled; },
    resize:     function() {
      var mc = document.getElementById('map-canvas');
      if (_canvas && mc) {
        _canvas.width  = mc.width;
        _canvas.height = mc.height;
        if (_enabled) draw();
      }
    },
  };
})();
