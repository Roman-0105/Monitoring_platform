/* ui-heatmap.js — тепловая карта водопритока */

var HeatMap = (function() {
  var _enabled   = false;
  var _mode      = 'q';
  var _radius    = 0.06;   // доля от ширины схемы
  var _opacity   = 0.70;
  var _offscreen = null;   // offscreen canvas в координатах схемы
  var _dirty     = true;   // нужен ли пересчёт

  var STATUS_WEIGHT = {
    'Паводковая':1.0,'Перелив':1.0,
    'Активная':0.55,'Новая':0.20,
    'Иссякает':0.15,'Пересохла':0.05,
  };

  var STOPS = [
    [0,   [15, 30,100]],
    [0.20,[10,120,190]],
    [0.42,[25,185,105]],
    [0.62,[210,215, 20]],
    [0.80,[255,145,  0]],
    [1.0, [225, 25, 25]],
  ];

  function heatColor(v) {
    v = Math.max(0, Math.min(1, v));
    var i = 0;
    for (; i < STOPS.length - 2; i++) { if (v <= STOPS[i+1][0]) break; }
    var t = (v - STOPS[i][0]) / (STOPS[i+1][0] - STOPS[i][0]);
    t = Math.max(0, Math.min(1, t));
    var a = STOPS[i][1], b = STOPS[i+1][1];
    return [
      Math.round(a[0] + t*(b[0]-a[0])),
      Math.round(a[1] + t*(b[1]-a[1])),
      Math.round(a[2] + t*(b[2]-a[2])),
    ];
  }

  function getVal(p, maxQ, minH, maxH) {
    if (_mode === 'q')       return maxQ > 0 ? (parseFloat(p.flowRate)||0) / maxQ : 0;
    if (_mode === 'status')  return STATUS_WEIGHT[p.status] || 0.1;
    if (_mode === 'horizon') {
      var h = parseFloat(p.horizon) || 0;
      var r = maxH - minH;
      return r > 0 ? 1 - (h - minH) / r : 0.5;
    }
    return 0;
  }

  // Строим offscreen canvas в пикселях СХЕМЫ (imgW × imgH)
  // Это делается один раз при включении/смене режима
  function buildOffscreen() {
    var img = window._mapSchemeImg;
    if (!img) return;

    var points = typeof getFilteredPointsForMap === 'function'
      ? getFilteredPointsForMap()
      : (typeof Points !== 'undefined' ? Points.getList() : []);
    if (!points.length) return;

    var iW = img.width, iH = img.height;
    var radiusPx = iW * _radius;

    // Переводим точки в пиксели схемы
    var pts = [];
    var maxQ = 0, minH = Infinity, maxH = -Infinity;

    points.forEach(function(p) {
      var x = p.xLocal, y = p.yLocal;
      if ((x == null || y == null) && p.lat && p.lon &&
          typeof MapModule !== 'undefined' && MapModule.wgs84ToXY) {
        var xy = MapModule.wgs84ToXY(p.lat, p.lon);
        if (xy) { x = xy.x; y = xy.y; }
      }
      if (x == null || y == null) return;
      var pos = MapModule.xyToPixel(x, y, iW, iH);
      var q = parseFloat(p.flowRate) || 0;
      if (q > maxQ) maxQ = q;
      var h = parseFloat(p.horizon) || 0;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
      pts.push({ p: p, px: pos.px, py: pos.py });
    });

    if (!pts.length) return;

    // Создаём offscreen canvas размером схемы
    // Для производительности рисуем с уменьшением (÷4), потом растянем
    var factor = 4;
    var oW = Math.floor(iW / factor);
    var oH = Math.floor(iH / factor);
    var rPx = radiusPx / factor;

    if (!_offscreen || _offscreen.width !== oW || _offscreen.height !== oH) {
      _offscreen = document.createElement('canvas');
      _offscreen.width  = oW;
      _offscreen.height = oH;
    }

    var ctx = _offscreen.getContext('2d');
    ctx.clearRect(0, 0, oW, oH);

    var imgData = ctx.createImageData(oW, oH);
    var data = imgData.data;

    for (var py = 0; py < oH; py++) {
      for (var px = 0; px < oW; px++) {
        var val = 0;
        for (var k = 0; k < pts.length; k++) {
          var pt = pts[k];
          var dx = px - pt.px / factor;
          var dy = py - pt.py / factor;
          var d  = Math.sqrt(dx*dx + dy*dy);
          if (d < rPx) {
            var fall = 1 - d / rPx;
            val += getVal(pt.p, maxQ, minH, maxH) * fall * fall;
          }
        }
        val = Math.min(1, val * 1.5);
        if (val > 0.025) {
          var rgb = heatColor(val);
          var idx = (py * oW + px) * 4;
          data[idx]   = rgb[0];
          data[idx+1] = rgb[1];
          data[idx+2] = rgb[2];
          data[idx+3] = Math.round(val * 240);
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
    _dirty = false;
  }

  // Рисуем offscreen canvas на основной canvas с той же трансформацией что и схема
  function compositeOnMap() {
    if (!_enabled || !_offscreen) return;

    var img = window._mapSchemeImg;
    var mapCanvas = document.getElementById('map-canvas');
    if (!img || !mapCanvas) return;

    var ctx = mapCanvas.getContext('2d');
    var scale = window._mapScale || 1;
    var offX  = window._mapOffX  || 0;
    var offY  = window._mapOffY  || 0;

    // Рисуем поверх схемы с той же transform — offscreen масштабируется до imgW×imgH
    ctx.save();
    ctx.globalAlpha = _opacity;
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);
    ctx.drawImage(_offscreen, 0, 0, img.width, img.height);
    ctx.restore();
  }

  function markDirty() { _dirty = true; }

  function enable(on) {
    _enabled = on;
    if (on) { markDirty(); }
    updateButton();
    if (typeof redrawMap === 'function') redrawMap();
  }

  function toggle() { enable(!_enabled); }

  function setMode(m)    { _mode    = m; markDirty(); if (_enabled && typeof redrawMap === 'function') redrawMap(); }
  function setRadius(r)  { _radius  = r; markDirty(); if (_enabled && typeof redrawMap === 'function') redrawMap(); }
  function setOpacity(o) { _opacity = o;               if (_enabled && typeof redrawMap === 'function') redrawMap(); }

  function updateButton() {
    var btn = document.getElementById('btn-heatmap-toggle');
    if (!btn) return;
    btn.style.background  = _enabled ? 'rgba(249,171,0,.18)' : '';
    btn.style.borderColor = _enabled ? 'rgba(249,171,0,.45)' : '';
    btn.style.color       = _enabled ? '#f9ab00' : '';
    btn.textContent = _enabled ? '🌡 Тепло ВКЛ' : '🌡 Тепло';
  }

  function init() {
    renderControls();
    updateButton();
    markDirty();
  }

  function renderControls() {
    var panel = document.getElementById('heatmap-panel');
    if (!panel) return;
    panel.innerHTML =
      '<div id="hm-ctrl" style="display:none;gap:8px;flex-wrap:wrap;align-items:center;padding:7px 12px;' +
        'background:rgba(14,20,35,.93);border-radius:8px;border:1px solid rgba(249,171,0,.2);margin-top:2px">' +
        '<span style="font-size:11px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.06em">Режим:</span>' +
        '<select id="hm-mode" onchange="HeatMap.setMode(this.value)" ' +
          'style="font-size:12px;padding:4px 8px;background:rgba(255,255,255,.08);' +
          'border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#e0e4f0">' +
          '<option value="q">По Q (водоприток)</option>' +
          '<option value="status">По статусу</option>' +
          '<option value="horizon">По горизонту</option>' +
        '</select>' +
        '<div style="display:flex;align-items:center;gap:5px">' +
          '<span style="font-size:11px;color:rgba(255,255,255,.45)">Радиус</span>' +
          '<input type="range" id="hm-radius" min="2" max="15" value="6" step="1" style="width:72px"' +
            ' oninput="HeatMap.setRadius(this.value/100);document.getElementById(\'hmrv\').textContent=this.value">' +
          '<span id="hmrv" style="font-size:11px;color:rgba(255,255,255,.35);min-width:16px">6</span>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:5px">' +
          '<span style="font-size:11px;color:rgba(255,255,255,.45)">Яркость</span>' +
          '<input type="range" id="hm-opacity" min="20" max="100" value="70" step="5" style="width:72px"' +
            ' oninput="HeatMap.setOpacity(this.value/100);document.getElementById(\'hmov\').textContent=this.value+\'%\'">' +
          '<span id="hmov" style="font-size:11px;color:rgba(255,255,255,.35);min-width:28px">70%</span>' +
        '</div>' +
        '<canvas id="hm-legend" width="90" height="8" style="border-radius:3px"></canvas>' +
      '</div>';

    // Шкала цветов
    var bar = document.getElementById('hm-legend');
    if (bar) {
      var bCtx = bar.getContext('2d');
      for (var i = 0; i < 90; i++) {
        var rgb = heatColor(i / 89);
        bCtx.fillStyle = 'rgb(' + rgb.join(',') + ')';
        bCtx.fillRect(i, 0, 1, 8);
      }
    }
  }

  function showControls(on) {
    var ctrl = document.getElementById('hm-ctrl');
    if (ctrl) ctrl.style.display = on ? 'flex' : 'none';
  }

  return {
    init:          init,
    toggle:        toggle,
    enable:        enable,
    isEnabled:     function() { return _enabled; },
    setMode:       setMode,
    setRadius:     setRadius,
    setOpacity:    setOpacity,
    markDirty:     markDirty,
    showControls:  showControls,
    // Вызывается из redrawMap ПОСЛЕ ctx.restore() — рисует поверх схемы
    draw: function() {
      if (!_enabled) return;
      if (_dirty) buildOffscreen();
      compositeOnMap();
    },
  };
})();
