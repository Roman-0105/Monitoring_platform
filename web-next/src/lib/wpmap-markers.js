// SVG-маркеры карты водопунктов — порт WPM_SHAPES/_wpmMakeIcon из hydro-monitoring/ui-wpmap.js.
const SHAPES = {
  circle: (color, sz) => {
    const h = sz / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz + 8}" overflow="visible">` +
      `<circle cx="${h}" cy="${h}" r="${h - 2}" fill="${color}" stroke="rgba(255,255,255,.9)" stroke-width="2"/>` +
      `<polygon points="${h - 4},${sz - 4} ${h + 4},${sz - 4} ${h},${sz + 7}" fill="${color}"/></svg>`;
  },
  square: (color, sz) => {
    const h = sz / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz + 8}" overflow="visible">` +
      `<rect x="2" y="2" width="${sz - 4}" height="${sz - 4}" rx="3" fill="${color}" stroke="rgba(255,255,255,.9)" stroke-width="2"/>` +
      `<polygon points="${h - 4},${sz - 4} ${h + 4},${sz - 4} ${h},${sz + 7}" fill="${color}"/></svg>`;
  },
  diamond: (color, sz) => {
    const h = sz / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" overflow="visible">` +
      `<polygon points="${h},2 ${sz - 2},${h} ${h},${sz - 2} 2,${h}" fill="${color}" stroke="rgba(255,255,255,.9)" stroke-width="2"/></svg>`;
  },
  triangle: (color, sz) => {
    const h = sz / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" overflow="visible">` +
      `<polygon points="${h},2 ${sz - 2},${sz - 2} 2,${sz - 2}" fill="${color}" stroke="rgba(255,255,255,.9)" stroke-width="2"/></svg>`;
  },
  hexagon: (color, sz) => {
    const h = sz / 2, q = (sz / 4) * 1.5;
    const pts = [[h, 2], [sz - 2, h - q / 2], [sz - 2, h + q / 2], [h, sz - 2], [2, h + q / 2], [2, h - q / 2]]
      .map((p) => p.join(',')).join(' ');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}" overflow="visible">` +
      `<polygon points="${pts}" fill="${color}" stroke="rgba(255,255,255,.9)" stroke-width="2"/></svg>`;
  },
};

function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function makeWpIcon(L, type, showLabel, name, wpTypes) {
  const sz = 28;
  const t = wpTypes[type] || wpTypes.other;
  const shapeFn = SHAPES[t.shape] || SHAPES.circle;
  const svgHtml = shapeFn(t.color, sz);

  let extraH = 8;
  if (t.shape === 'diamond' || t.shape === 'triangle' || t.shape === 'hexagon') extraH = 0;

  let labelHtml = '', labelH = 0;
  if (showLabel && name) {
    const shortName = name.length > 14 ? name.slice(0, 13) + '…' : name;
    labelHtml = `<div class="wpm-lbl">${escHtml(shortName)}</div>`;
    labelH = 18;
  }

  const totalH = sz + extraH + labelH;
  const anchorY = sz + extraH;

  return L.divIcon({
    className: '',
    html: `<div class="wpm-marker-wrap">${svgHtml}${labelHtml}</div>`,
    iconSize: [sz, totalH],
    iconAnchor: [sz / 2, anchorY],
    popupAnchor: [0, -anchorY],
  });
}

export function makeClusterLayer(L) {
  if (typeof L.markerClusterGroup !== 'function') return L.layerGroup();
  return L.markerClusterGroup({
    maxClusterRadius: 55,
    disableClusteringAtZoom: 18,
    spiderfyOnMaxZoom: true,
    showCoverageOnHover: false,
    iconCreateFunction: (cluster) => {
      const n = cluster.getChildCount();
      const sz = n < 10 ? 34 : (n < 30 ? 42 : 50);
      return L.divIcon({
        html: `<div class="wpm-cluster-icon" style="width:${sz}px;height:${sz}px">${n}</div>`,
        className: 'wpm-cluster-wrap',
        iconSize: [sz, sz],
      });
    },
  });
}
