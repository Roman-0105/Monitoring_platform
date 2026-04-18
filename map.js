/**
 * map.js — координаты, рендер точек, взаимодействие с картой.
 *
 * Система координат схемы карьера:
 *   X = 45850..47350  — горизонталь, растёт СЛЕВА НАПРАВО
 *   Y = 15800..17350  — вертикаль,   убывает СВЕРХУ ВНИЗ
 *
 * Привязка пикселей:
 *   Верхний левый:  X=45850, Y=17350  → px=0,    py=0
 *   Верхний правый: X=47350, Y=17350  → px=imgW, py=0
 *   Нижний правый:  X=47350, Y=15800  → px=imgW, py=imgH
 *   Нижний левый:   X=45850, Y=15800  → px=0,    py=imgH
 *
 * Связь с СК-42 (зона определяется автоматически из lon):
 *   X = sk42y - zone*1e6 - 500000  (запад-восток)
 *   Y = sk42x - 5800000             (север-юг)
 *
 * OFF_X = 5800000
 */

var MapModule = (function() {

  var OFF_X = 5800000;
  var MARKER_MODE = 'combined'; // simple | status | intensity | combined
  var _styleCache = {};

  var BOUNDS = {
    Xmin: 45850, Xmax: 47350,
    Ymin: 15800, Ymax: 17350,
  };

  var MAP_STYLE = {
    markerFill: '#ff8c00',
    markerStroke: '#111111',
    minMarkerSize: 4,
    maxMarkerSize: 16,
    baseHitPadding: 4,
    simpleColor: '#ff8c00',
    intensityColor: '#ff8c00',
    combinedBaseColor: '#ff8c00',
    zoom: { min: 0.35, max: 6 },
    labels: { showFromScale: 0.85 },
    statusColors: {
      'Новая':      '#1a73e8',
      'Активная':   '#34a853',
      'Иссякает':   '#f9ab00',
      'Искакает':   '#f9ab00', // поддержка опечатки
      'Пересохла':  '#ea4335',
      'Паводковая': '#7c3aed',
      'Перелив':    '#0891b2',
    },
    intensitySizes: {
      'Слабая (капёж)': 4.5,
      'Умеренная': 7,
      'Сильная (поток)': 10.5,
      'Очень сильная': 14,
    },
    domainColors: {
      'Domen-1': '#1a73e8',
      'Domen-2': '#34a853',
      'Domen-3': '#f9ab00',
      'Domen-4': '#ea4335',
      'Domen-5': '#7c3aed',
    },
  };

  var STATUS_COLORS = MAP_STYLE.statusColors;

  function getIntensityRadius(intensity) {
    return MAP_STYLE.intensitySizes[intensity] || 5.5;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function normalizeScale(viewScale) {
    return (typeof viewScale === 'number' && viewScale > 0) ? viewScale : 1;
  }

  function getScaleAwareSize(base, viewScale) {
    // zoom out => scale меньше => маркер больше
    var raw = base / normalizeScale(viewScale);
    return clamp(raw, MAP_STYLE.minMarkerSize, MAP_STYLE.maxMarkerSize);
  }

  function getScreenRadius(intensity, viewScale) {
    return getScaleAwareSize(getIntensityRadius(intensity), viewScale);
  }

  function getScaleBucket(viewScale) {
    var s = normalizeScale(viewScale);
    return Math.round(s * 20) / 20;
  }

  function getMarkerStyle(point, mode, viewScale) {
    var effectiveMode = mode || MARKER_MODE;
    var scaleBucket = getScaleBucket(viewScale);
    var status = point.status || 'Новая';
    var intensity = point.intensity || '';
    var key = effectiveMode + '|' + status + '|' + intensity + '|' + scaleBucket;
    if (_styleCache[key]) return _styleCache[key];

    var style = {
      size: getScaleAwareSize(7, scaleBucket),
      color: MAP_STYLE.simpleColor,
      stroke: MAP_STYLE.markerStroke,
      badgeColor: null,
      showBadge: false,
    };

    if (effectiveMode === 'status') {
      style.color = STATUS_COLORS[status] || '#666';
      style.size = getScaleAwareSize(7, scaleBucket);
    } else if (effectiveMode === 'intensity') {
      style.color = MAP_STYLE.intensityColor;
      style.size = getScreenRadius(intensity, scaleBucket);
    } else if (effectiveMode === 'combined') {
      style.color = MAP_STYLE.combinedBaseColor;
      style.size = getScreenRadius(intensity, scaleBucket);
      style.badgeColor = STATUS_COLORS[status] || '#666';
      style.showBadge = true;
    }

    _styleCache[key] = style;
    return style;
  }

  function setMarkerMode(mode) {
    MARKER_MODE = (mode || 'combined').toLowerCase();
  }
  function getMarkerMode() { return MARKER_MODE; }
  function resetMarkerStyleCache() { _styleCache = {}; }

  function setStyleConfig(nextCfg) {
    if (!nextCfg) return;
    function merge(dst, src) {
      Object.keys(src).forEach(function(k) {
        if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k])) {
          if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {};
          merge(dst[k], src[k]);
        } else if (src[k] != null) {
          dst[k] = src[k];
        }
      });
      return dst;
    }
    merge(MAP_STYLE, nextCfg);
    STATUS_COLORS = MAP_STYLE.statusColors;
    resetMarkerStyleCache();
  }

  function getStyleConfig() {
    return JSON.parse(JSON.stringify(MAP_STYLE));
  }

  // ── Пиксели → X/Y ────────────────────────────────────────
  // X растёт слева направо: Xmin=45850 при px=0, Xmax=47350 при px=W
  // Y убывает сверху вниз:  Ymax=17350 при py=0, Ymin=15800 при py=H
  function pixelToXY(px, py, imgW, imgH) {
    return {
      x: parseFloat((BOUNDS.Xmin + px / imgW * (BOUNDS.Xmax - BOUNDS.Xmin)).toFixed(4)),
      y: parseFloat((BOUNDS.Ymax - py / imgH * (BOUNDS.Ymax - BOUNDS.Ymin)).toFixed(4)),
    };
  }

  // ── X/Y → пиксели ────────────────────────────────────────
  function xyToPixel(x, y, imgW, imgH) {
    return {
      px: (x - BOUNDS.Xmin) / (BOUNDS.Xmax - BOUNDS.Xmin) * imgW,
      py: (BOUNDS.Ymax - y) / (BOUNDS.Ymax - BOUNDS.Ymin) * imgH,
    };
  }

  // ── WGS-84 → X/Y ─────────────────────────────────────────
  function wgs84ToXY(lat, lon) {
    var a = 6378245.0, b = 6356863.019;
    var e2 = (a*a - b*b) / (a*a);
    var latR = lat * Math.PI / 180;
    var lonR = lon * Math.PI / 180;
    var zone = Math.floor(lon / 6) + 1;
    var L0   = (zone * 6 - 3) * Math.PI / 180;
    var sinLat = Math.sin(latR), cosLat = Math.cos(latR), tanLat = Math.tan(latR);
    var eta2 = e2 * cosLat * cosLat / (1 - e2);
    var N    = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    var t    = tanLat * tanLat;
    var e4 = e2*e2, e6 = e4*e2, dL = lonR - L0;
    var M = a * (
      (1-e2/4-3*e4/64-5*e6/256)*latR
      -(3*e2/8+3*e4/32+45*e6/1024)*Math.sin(2*latR)
      +(15*e4/256+45*e6/1024)*Math.sin(4*latR)
      -(35*e6/3072)*Math.sin(6*latR)
    );
    var sk42x = M
      + N*sinLat*cosLat*dL*dL/2
      + N*sinLat*Math.pow(cosLat,3)*(5-t+9*eta2+4*eta2*eta2)*Math.pow(dL,4)/24
      + N*sinLat*Math.pow(cosLat,5)*(61-58*t+t*t)*Math.pow(dL,6)/720;
    var sk42y = N*cosLat*dL
      + N*Math.pow(cosLat,3)*(1-t+eta2)*Math.pow(dL,3)/6
      + N*Math.pow(cosLat,5)*(5-18*t+t*t+14*eta2-58*t*eta2)*Math.pow(dL,5)/120;
    sk42y += zone * 1000000 + 500000;

    return {
      x: parseFloat((sk42y - zone*1000000 - 500000).toFixed(4)),
      y: parseFloat((sk42x - OFF_X).toFixed(4)),
    };
  }

  // ── X/Y → WGS-84 ─────────────────────────────────────────
  function xyToWgs84(x, y) {
    var zone  = 12;  // зона для данного карьера (lon ≈ 69°)
    var sk42x = y + OFF_X;
    var sk42y_local = x;  // без смещения зоны

    var a = 6378245.0, b = 6356863.019;
    var e2 = (a*a - b*b) / (a*a);

    var lat = sk42x / (a*(1-e2/4-3*e2*e2/64-5*e2*e2*e2/256));
    for (var i = 0; i < 6; i++) {
      var M = a*(
        (1-e2/4-3*e2*e2/64-5*e2*e2*e2/256)*lat
        -(3*e2/8+3*e2*e2/32+45*e2*e2*e2/1024)*Math.sin(2*lat)
        +(15*e2*e2/256+45*e2*e2*e2/1024)*Math.sin(4*lat)
        -(35*e2*e2*e2/3072)*Math.sin(6*lat)
      );
      lat += (sk42x - M) / (a*(1 - e2*Math.sin(lat)*Math.sin(lat)));
    }
    var sinL = Math.sin(lat), cosL = Math.cos(lat), tanL = Math.tan(lat);
    var eta2 = e2*cosL*cosL/(1-e2);
    var N    = a/Math.sqrt(1-e2*sinL*sinL);
    var t    = tanL*tanL;
    var dL   = sk42y_local/(N*cosL)
      - Math.pow(sk42y_local,3)/(6*Math.pow(N,3)*cosL)*(1+2*t+eta2)
      + Math.pow(sk42y_local,5)/(120*Math.pow(N,5)*cosL)*(5+28*t+24*t*t);
    var L0 = (zone*6-3)*Math.PI/180;
    return {
      lat: parseFloat((lat * 180/Math.PI).toFixed(7)),
      lon: parseFloat(((L0+dL) * 180/Math.PI).toFixed(7)),
    };
  }

  // ── Рендер точек ─────────────────────────────────────────
  function drawPoints(ctx, points, imgW, imgH, viewScale) {
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var x = p.xLocal, y = p.yLocal;
      if ((x == null || y == null) && p.lat && p.lon) {
        var xy = wgs84ToXY(p.lat, p.lon);
        x = xy.x; y = xy.y;
      }
      if (x == null || y == null) continue;
      var pos = xyToPixel(x, y, imgW, imgH);
      var marker = getMarkerStyle(p, MARKER_MODE, viewScale);
      var radius = marker.size;
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur  = 5;
      ctx.beginPath();
      ctx.arc(pos.px, pos.py, radius, 0, Math.PI*2);
      ctx.fillStyle = marker.color;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur  = 0;
      ctx.strokeStyle = marker.stroke || MAP_STYLE.markerStroke;
      ctx.lineWidth   = 1.8;
      ctx.stroke();
      if (marker.showBadge) {
        var br = Math.max(3, Math.min(6, radius * 0.45));
        var bx = pos.px + radius * 0.55;
        var by = pos.py - radius * 0.55;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fillStyle = marker.badgeColor || '#666';
        ctx.fill();
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
      }
      var scale = normalizeScale(viewScale);
      if (scale >= (MAP_STYLE.labels.showFromScale || 1)) {
        var fs = clamp(11 / scale, 7, 14);
        ctx.fillStyle = '#0b0f14';
        ctx.font = '700 ' + fs.toFixed(1) + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        var labelText = String(p.pointNumber || '?');
        ctx.fillText(labelText, pos.px + (radius / 3), pos.py - radius - (2 / scale));
        ctx.fillStyle = '#f6f7fb';
        ctx.fillText(labelText, pos.px, pos.py - radius - (3 / scale));
      }
    }
  }

  // ── Hit-test ─────────────────────────────────────────────
  function findPointAt(imgX, imgY, points, imgW, imgH, viewScale) {
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var x = p.xLocal, y = p.yLocal;
      if ((x == null || y == null) && p.lat && p.lon) {
        var xy = wgs84ToXY(p.lat, p.lon);
        x = xy.x; y = xy.y;
      }
      if (x == null || y == null) continue;
      var pos = xyToPixel(x, y, imgW, imgH);
      var dx  = imgX - pos.px, dy = imgY - pos.py;
      var marker = getMarkerStyle(p, MARKER_MODE, viewScale);
      var hit = marker.size + MAP_STYLE.baseHitPadding;
      if (Math.sqrt(dx*dx + dy*dy) <= hit) return p;
    }
    return null;
  }

  // ── Рендер канав (квадратные маркеры) ──────────────────
  function drawDitches(ctx, ditches, imgW, imgH, viewScale) {
    if (!ditches || !ditches.length) return;
    var scale = normalizeScale(viewScale);
    var sz = clamp(14 / scale, 8, 18); // полуразмер квадрата

    var statusColors = {
      'Активная':  '#4090e8',
      'Новая':     '#40b8ff',
      'Пересохла': '#e8a030',
      'Заилилась': '#8060c0',
    };

    for (var i = 0; i < ditches.length; i++) {
      var d = ditches[i];
      // Предпочитаем локальные координаты с карты, иначе GPS
      var posX, posY;
      if (d.xLocal != null && d.yLocal != null) {
        posX = d.xLocal; posY = d.yLocal;
      } else if (d.lat != null && d.lon != null) {
        var xy = wgs84ToXY(d.lat, d.lon);
        posX = xy.x; posY = xy.y;
      } else {
        continue;
      }
      var pos = xyToPixel(posX, posY, imgW, imgH);
      var col = statusColors[d.status] || '#4090e8';

      // Тень
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur  = 6;

      // Квадрат с скруглёнными углами
      var r = Math.max(2, sz * 0.28); // радиус скругления
      var x = pos.px - sz, y = pos.py - sz, w = sz*2, h = sz*2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x+w, y, x+w, y+r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y+h, x, y+h-r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x+r, y, r);
      ctx.closePath();

      // Заливка с градиентом
      var grd = ctx.createLinearGradient(pos.px-sz, pos.py-sz, pos.px+sz, pos.py+sz);
      grd.addColorStop(0, col);
      grd.addColorStop(1, col + 'bb');
      ctx.fillStyle = grd;
      ctx.fill();

      ctx.shadowColor = 'transparent';
      ctx.shadowBlur  = 0;

      // Обводка
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 1.8;
      ctx.stroke();

      // Иконка волны внутри
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = 'bold ' + Math.round(sz * 0.95) + 'px sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('≈', pos.px, pos.py + 0.5);

      // Подпись названия
      if (scale >= 1.0) {
        var fs = clamp(10 / scale, 7, 13);
        ctx.font = '600 ' + fs.toFixed(1) + 'px sans-serif';
        ctx.textBaseline = 'bottom';
        // Тень текста
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillText(d.ditchName || '', pos.px + 1, pos.py - sz - 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(d.ditchName || '', pos.px, pos.py - sz - 3);
      }
    }
  }

  // ── Hit-test для канав ───────────────────────────────────
  function findDitchAt(imgX, imgY, ditches, imgW, imgH, viewScale) {
    if (!ditches || !ditches.length) return null;
    var scale = normalizeScale(viewScale);
    var sz    = clamp(14 / scale, 8, 18) + 4; // +4 для удобства клика
    for (var i = 0; i < ditches.length; i++) {
      var d = ditches[i];
      var fx, fy;
      if (d.xLocal != null && d.yLocal != null) {
        fx = d.xLocal; fy = d.yLocal;
      } else if (d.lat != null && d.lon != null) {
        var fxy = wgs84ToXY(d.lat, d.lon);
        fx = fxy.x; fy = fxy.y;
      } else {
        continue;
      }
      var pos = xyToPixel(fx, fy, imgW, imgH);
      if (Math.abs(imgX - pos.px) <= sz && Math.abs(imgY - pos.py) <= sz) return d;
    }
    return null;
  }

  return {
    BOUNDS:        BOUNDS,
    STATUS_COLORS: STATUS_COLORS,
    pixelToXY:     pixelToXY,
    xyToPixel:     xyToPixel,
    wgs84ToXY:     wgs84ToXY,
    xyToWgs84:     xyToWgs84,
    drawPoints:    drawPoints,
    findPointAt:   findPointAt,
    drawDitches:   drawDitches,
    findDitchAt:   findDitchAt,
    getIntensityRadius: getIntensityRadius,
    getMarkerStyle: getMarkerStyle,
    setMarkerMode: setMarkerMode,
    getMarkerMode: getMarkerMode,
    resetMarkerStyleCache: resetMarkerStyleCache,
    setStyleConfig: setStyleConfig,
    getStyleConfig: getStyleConfig,
  };
})();
