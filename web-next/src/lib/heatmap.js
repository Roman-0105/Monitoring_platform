// Тепловая карта водопритока — порт из hydro-monitoring/ui-heatmap.js.
const STATUS_WEIGHT = {
  'Паводковая': 1.0, 'Перелив': 1.0,
  'Активная': 0.55, 'Новая': 0.20,
  'Иссякает': 0.15, 'Пересохла': 0.05,
};

const STOPS = [
  [0, [15, 30, 100]],
  [0.20, [10, 120, 190]],
  [0.42, [25, 185, 105]],
  [0.62, [210, 215, 20]],
  [0.80, [255, 145, 0]],
  [1.0, [225, 25, 25]],
];

export function heatColor(v) {
  v = Math.max(0, Math.min(1, v));
  let i = 0;
  for (; i < STOPS.length - 2; i++) { if (v <= STOPS[i + 1][0]) break; }
  let t = (v - STOPS[i][0]) / (STOPS[i + 1][0] - STOPS[i][0]);
  t = Math.max(0, Math.min(1, t));
  const a = STOPS[i][1], b = STOPS[i + 1][1];
  return [
    Math.round(a[0] + t * (b[0] - a[0])),
    Math.round(a[1] + t * (b[1] - a[1])),
    Math.round(a[2] + t * (b[2] - a[2])),
  ];
}

function getVal(p, mode, gamma, maxQ, minH, maxH) {
  if (mode === 'q') {
    const q = parseFloat(p.flow_rate) || 0;
    if (maxQ > 0) return Math.max(0.08, Math.pow(q / maxQ, gamma));
    return 0.08;
  }
  if (mode === 'status') return STATUS_WEIGHT[p.status] || 0.1;
  if (mode === 'horizon') {
    const h = parseFloat(p.horizon) || 0;
    const r = maxH - minH;
    return r > 0 ? 1 - (h - minH) / r : 0.5;
  }
  return 0;
}

function xyToPixel(x, y, bounds, imgW, imgH) {
  return {
    px: (x - bounds.xMin) / (bounds.xMax - bounds.xMin) * imgW,
    py: (bounds.yMax - y) / (bounds.yMax - bounds.yMin) * imgH,
  };
}

// Строит offscreen canvas в координатах схемы (уменьшенный ÷4 для скорости).
export function buildHeatmapCanvas(points, bounds, imgW, imgH, opts) {
  const { mode = 'q', radius = 0.06, gamma = 1.0 } = opts || {};
  const pts = [];
  let maxQ = 0, minH = Infinity, maxH = -Infinity;
  points.forEach((p) => {
    if (p.x_local == null || p.y_local == null) return;
    const pos = xyToPixel(p.x_local, p.y_local, bounds, imgW, imgH);
    const q = parseFloat(p.flow_rate) || 0;
    if (q > maxQ) maxQ = q;
    const h = parseFloat(p.horizon) || 0;
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
    pts.push({ p, px: pos.px, py: pos.py });
  });
  if (!pts.length) return null;

  const factor = 4;
  const oW = Math.max(1, Math.floor(imgW / factor));
  const oH = Math.max(1, Math.floor(imgH / factor));
  const rPx = (imgW * radius) / factor;

  const canvas = document.createElement('canvas');
  canvas.width = oW; canvas.height = oH;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(oW, oH);
  const data = imgData.data;

  for (let py = 0; py < oH; py++) {
    for (let px = 0; px < oW; px++) {
      let val = 0;
      for (let k = 0; k < pts.length; k++) {
        const pt = pts[k];
        const dx = px - pt.px / factor, dy = py - pt.py / factor;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < rPx) {
          const fall = 1 - d / rPx;
          val += getVal(pt.p, mode, gamma, maxQ, minH, maxH) * fall * fall;
        }
      }
      val = Math.min(1, val * 1.2);
      if (val > 0.012) {
        const rgb = heatColor(val);
        const idx = (py * oW + px) * 4;
        data[idx] = rgb[0]; data[idx + 1] = rgb[1]; data[idx + 2] = rgb[2];
        data[idx + 3] = Math.round(val * 240);
      }
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

export function drawHeatmapLegendBar(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  for (let i = 0; i < w; i++) {
    const rgb = heatColor(i / (w - 1));
    ctx.fillStyle = `rgb(${rgb.join(',')})`;
    ctx.fillRect(i, 0, 1, canvas.height);
  }
}
