// Ядро 3D-сцены карьера — framework-agnostic, переиспользует ту же геометрию/математику,
// что и hydro-monitoring/ui-pit3d.js (тот же алгоритм изогипс с k-ближайшими точками,
// та же логика стволов скважин с учётом угла наклона). React-компонент (pages/Pit3D.js)
// лишь монтирует канвас и дёргает методы этого класса.

export const PIT3D_DB_NAME = 'pit3d_db';
export const PIT3D_DB_VERSION = 2;

export function loadThree() {
  if (window.THREE && window._sfOrbitControls) return Promise.resolve();
  return new Promise((resolve, reject) => {
    function loadScript(src, cb) {
      const s = document.createElement('script');
      s.src = src; s.onload = cb;
      s.onerror = () => reject(new Error('Не удалось загрузить ' + src));
      document.head.appendChild(s);
    }
    const base = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/';
    loadScript(base + 'three.min.js', () => {
      loadScript('https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js', () => {
        window._sfOrbitControls = window.THREE.OrbitControls;
        resolve();
      });
    });
  });
}

export function loadDelaunay() {
  if (window.d3 && window.d3.Delaunay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/d3-delaunay@6/dist/d3-delaunay.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не удалось загрузить d3-delaunay'));
    document.head.appendChild(s);
  });
}

export function dbLoadModel() {
  return new Promise((resolve) => {
    const req = indexedDB.open(PIT3D_DB_NAME, PIT3D_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('model')) db.createObjectStore('model', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sections')) db.createObjectStore('sections', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      try {
        const db = req.result;
        if (!db.objectStoreNames.contains('model')) { resolve(null); return; }
        const tx = db.transaction('model', 'readonly');
        const getReq = tx.objectStore('model').get('current');
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    };
    req.onerror = () => resolve(null);
  });
}

export const PIT3D_LAYER_DEFS = [
  { key: 'reg_well_obs', label: 'Наблюд. скважина', color: '#60a5fa', geometry: 'sphere', group: 'Реестр водопунктов' },
  { key: 'reg_well_exp', label: 'Эксплуат. скважина', color: '#34d399', geometry: 'sphere', group: 'Реестр водопунктов' },
  { key: 'reg_sump',     label: 'Зумпф (реестр)',      color: '#f59e0b', geometry: 'cube',   group: 'Реестр водопунктов' },
  { key: 'reg_pond',     label: 'Накопитель',           color: '#a78bfa', geometry: 'cube',   group: 'Реестр водопунктов' },
  { key: 'reg_seep',     label: 'Водопроявление',       color: '#22d3ee', geometry: 'cone',   group: 'Реестр водопунктов' },
  { key: 'reg_other',    label: 'Прочее',               color: '#9aa0a6', geometry: 'sphere', group: 'Реестр водопунктов' },
  { key: 'wells_drainage', label: 'Скважины дренажные',       color: '#4caf7d', geometry: 'sphere', isWell: true, group: 'Гор. скважины' },
  { key: 'wells_piezo',    label: 'Скважины пьезометрические', color: '#9d6bff', geometry: 'sphere', isWell: true, group: 'Гор. скважины' },
  { key: 'isohypses',    label: 'Изогипсы подземных вод', special: true, group: 'Расчётные слои' },
];

export function defaultLayerStyle() {
  const out = {};
  PIT3D_LAYER_DEFS.forEach((d) => { out[d.key] = { visible: d.key !== 'isohypses', color: d.color || null, geometry: d.geometry || null, opacity: 1, size: 1 }; });
  return out;
}

function makeGeometry(THREE, shape, r) {
  switch (shape) {
    case 'cube': return new THREE.BoxGeometry(r * 1.6, r * 1.6, r * 1.6);
    case 'cone': return new THREE.ConeGeometry(r * 1.1, r * 2.2, 10);
    default: return new THREE.SphereGeometry(r, 12, 12);
  }
}

// IDW по k ближайшим точкам — устраняет ложную просадку/подъём уровня между близкими
// точками из-за влияния далёких замеров с совсем другим уровнем воды.
const IDW_K = 6;
function idwZ(x, y, pts, power, k) {
  let candidates = pts;
  if (k && pts.length > k) {
    candidates = pts.map((p) => { const dx = p.x - x, dy = p.y - y; return { p, d2: dx * dx + dy * dy }; })
      .sort((a, b) => a.d2 - b.d2).slice(0, k).map((e) => e.p);
  }
  let wsum = 0, zsum = 0;
  for (const p of candidates) {
    const dx = p.x - x, dy = p.y - y, d2 = dx * dx + dy * dy;
    if (d2 < 1e-6) return p.z;
    const w = 1 / Math.pow(d2, power / 2);
    wsum += w; zsum += w * p.z;
  }
  return wsum > 0 ? zsum / wsum : pts[0].z;
}

function convexHull(pts) {
  const sorted = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of sorted) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) { const p = sorted[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}
function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function densifyWaterTable(wtPts) {
  if (wtPts.length < 3) return { points: wtPts, cell: 1 };
  const xs = wtPts.map((p) => p.x), ys = wtPts.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const spanX = xMax - xMin || 1, spanY = yMax - yMin || 1;
  const gridN = 45;
  const cell = Math.max(spanX, spanY) / gridN;
  const nx = Math.max(1, Math.round(spanX / cell)), ny = Math.max(1, Math.round(spanY / cell));
  const hull = convexHull(wtPts);
  const out = wtPts.slice();
  for (let i = 0; i <= nx; i++) {
    for (let j = 0; j <= ny; j++) {
      const x = xMin + spanX * i / nx, y = yMin + spanY * j / ny;
      if (!pointInPolygon(x, y, hull)) continue;
      out.push({ x, y, z: idwZ(x, y, wtPts, 2, IDW_K) });
    }
  }
  return { points: out, cell };
}

function filterLongTriangles(xs, ys, triangles, maxEdge) {
  const maxEdge2 = maxEdge * maxEdge;
  const dist2 = (i, j) => { const dx = xs[i] - xs[j], dy = ys[i] - ys[j]; return dx * dx + dy * dy; };
  const out = [];
  const numTri = triangles.length / 3;
  for (let j = 0; j < numTri; j++) {
    const ia = triangles[j * 3], ib = triangles[j * 3 + 1], ic = triangles[j * 3 + 2];
    if (dist2(ia, ib) <= maxEdge2 && dist2(ib, ic) <= maxEdge2 && dist2(ic, ia) <= maxEdge2) out.push(ia, ib, ic);
  }
  return Uint32Array.from(out);
}

function traceContourSegments(xs, ys, zs, tris, level) {
  const segs = [];
  const numTri = tris.length / 3;
  for (let j = 0; j < numTri; j++) {
    const ia = tris[j * 3], ib = tris[j * 3 + 1], ic = tris[j * 3 + 2];
    const za = zs[ia], zb = zs[ib], zc = zs[ic];
    let px = null, py = null, qx = null, qy = null, found = 0;
    if ((za - level) * (zb - level) < 0) { const t = (level - za) / (zb - za); px = xs[ia] + (xs[ib] - xs[ia]) * t; py = ys[ia] + (ys[ib] - ys[ia]) * t; found++; }
    if ((zb - level) * (zc - level) < 0) {
      const t = (level - zb) / (zc - zb); const x2 = xs[ib] + (xs[ic] - xs[ib]) * t, y2 = ys[ib] + (ys[ic] - ys[ib]) * t;
      if (found === 0) { px = x2; py = y2; } else { qx = x2; qy = y2; } found++;
    }
    if (found < 2 && (zc - level) * (za - level) < 0) {
      const t = (level - zc) / (za - zc); const x3 = xs[ic] + (xs[ia] - xs[ic]) * t, y3 = ys[ic] + (ys[ia] - ys[ic]) * t;
      if (found === 0) { px = x3; py = y3; } else { qx = x3; qy = y3; } found++;
    }
    if (found === 2) segs.push(px, py, qx, qy);
  }
  return segs;
}

function chooseContourStep(zMin, zMax) {
  const range = zMax - zMin;
  if (!(range > 0)) return 1;
  const raw = range / 10;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return norm < 1.5 ? 1 * mag : norm < 3.5 ? 2 * mag : norm < 7.5 ? 5 * mag : 10 * mag;
}

function contourColor(level, zMin, zMax) {
  const t = zMax > zMin ? (level - zMin) / (zMax - zMin) : 0.5;
  const light = { r: 0x8e, g: 0xc7, b: 0xe8 }, dark = { r: 0x13, g: 0x3a, b: 0x6b };
  const r = Math.round(light.r + (dark.r - light.r) * t), g = Math.round(light.g + (dark.g - light.g) * t), b = Math.round(light.b + (dark.b - light.b) * t);
  return (r << 16) | (g << 8) | b;
}

export class PitScene {
  constructor(container) {
    this.container = container;
    this.three = null;
    this.markerR = 1;
    this.wellTrajectories = [];
    this.waterPoints = [];
    this.contourData = null;
    this.contourGroup = null;
    this.onHover = null;
  }

  async init(model) {
    await loadThree();
    const THREE = window.THREE;
    const container = this.container;
    const W = container.clientWidth || 480, H = container.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0xf4f2ef, 1);
    container.innerHTML = '';
    container.style.position = 'relative';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(1, 2, 3);
    scene.add(dirLight);

    const { xs, ys, zs, triangles, bbox } = model;
    const b = model.robustBBox || bbox;
    const cx = (b.xMin + b.xMax) / 2, cy = (b.yMin + b.yMax) / 2, cz = (b.zMin + b.zMax) / 2;
    const span = Math.max(b.xMax - b.xMin, b.yMax - b.yMin, b.zMax - b.zMin) || 1;
    const scale = 80 / span;

    const numTri = triangles.length / 3;
    const positions = new Float32Array(numTri * 9);
    for (let j = 0; j < numTri; j++) {
      const i0 = triangles[j * 3], i1 = triangles[j * 3 + 1], i2 = triangles[j * 3 + 2];
      positions[j * 9 + 0] = (xs[i0] - cx) * scale; positions[j * 9 + 1] = (zs[i0] - cz) * scale; positions[j * 9 + 2] = -(ys[i0] - cy) * scale;
      positions[j * 9 + 3] = (xs[i1] - cx) * scale; positions[j * 9 + 4] = (zs[i1] - cz) * scale; positions[j * 9 + 5] = -(ys[i1] - cy) * scale;
      positions[j * 9 + 6] = (xs[i2] - cx) * scale; positions[j * 9 + 7] = (zs[i2] - cz) * scale; positions[j * 9 + 8] = -(ys[i2] - cy) * scale;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const solidMat = new THREE.MeshPhongMaterial({ color: 0xcbb387, side: THREE.DoubleSide, flatShading: true });
    const mesh = new THREE.Mesh(geo, solidMat);
    scene.add(mesh);

    const wireframe = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.08 }));
    wireframe.visible = false;
    scene.add(wireframe);

    this.markerR = Math.max(span * scale * 0.006, 0.6);

    const camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 5000);
    const d = span * scale;
    camera.position.set(d * 0.9, d * 0.85, d * 1.1);
    camera.lookAt(0, 0, 0);

    const controls = new window._sfOrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.panSpeed = 0.8;
    renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

    function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    const ro = new ResizeObserver(() => {
      const nw = container.clientWidth, nh = container.clientHeight || nw;
      if (!nw || !nh) return;
      camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh);
    });
    ro.observe(container);

    this.three = { renderer, scene, camera, controls, mesh, wireframe, markerGroup: null, wellsGroup: null, transform: { cx, cy, cz, scale }, resizeObserver: ro };

    // Тултип по наведению
    const tooltip = document.createElement('div');
    tooltip.style.cssText = 'position:absolute;pointer-events:none;background:rgba(33,30,25,0.94);color:#fff;font-size:11px;line-height:1.5;padding:6px 9px;border-radius:6px;display:none;z-index:5;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.2)';
    container.appendChild(tooltip);
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    renderer.domElement.addEventListener('mousemove', (e) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const mg = this.three.markerGroup;
      const hits = mg && mg.visible ? raycaster.intersectObjects(mg.children) : [];
      const wg = this.three.wellsGroup;
      const wHits = !hits.length && wg && wg.visible ? raycaster.intersectObjects(wg.children) : [];
      const hit = hits[0] || wHits[0];
      if (hit) {
        const ud = hit.object.userData;
        tooltip.style.display = 'block';
        tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
        tooltip.style.top = (e.clientY - rect.top + 14) + 'px';
        tooltip.innerHTML = `<b>${ud.name}</b><br>${ud.label}${ud.z != null ? '<br>Z ≈ ' + ud.z.toFixed(1) + ' м' : ''}`;
      } else {
        tooltip.style.display = 'none';
      }
    });

    return this;
  }

  setData({ waterPoints, wellTrajectories }) {
    this.waterPoints = waterPoints;
    this.wellTrajectories = wellTrajectories;
  }

  toLocal(p) {
    const THREE = window.THREE;
    const tr = this.three.transform;
    return new THREE.Vector3((p.x - tr.cx) * tr.scale, (p.z - tr.cz) * tr.scale, -(p.y - tr.cy) * tr.scale);
  }

  rebuildMarkers(layerStyle) {
    const THREE = window.THREE;
    const t = this.three;
    if (t.markerGroup) { t.scene.remove(t.markerGroup); t.markerGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    const group = new THREE.Group();
    this.waterPoints.forEach((p) => {
      const st = layerStyle[p.layerKey];
      if (!st || !st.visible) return;
      const color = st.color || '#999';
      const mat = new THREE.MeshBasicMaterial({ color, transparent: st.opacity < 1, opacity: st.opacity != null ? st.opacity : 1 });
      const geo = makeGeometry(THREE, st.geometry, this.markerR * (st.size || 1));
      const mesh = new THREE.Mesh(geo, mat);
      const local = this.toLocal(p);
      mesh.position.copy(local);
      mesh.userData = p;
      group.add(mesh);
    });
    t.scene.add(group);
    t.markerGroup = group;
  }

  rebuildWells(layerStyle) {
    const THREE = window.THREE;
    const t = this.three;
    if (t.wellsGroup) { t.scene.remove(t.wellsGroup); t.wellsGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    const group = new THREE.Group();
    this.wellTrajectories.forEach((w) => {
      const key = w.isPiezo ? 'wells_piezo' : 'wells_drainage';
      const st = layerStyle[key];
      if (!st || !st.visible) return;
      const color = st.color || (w.isPiezo ? '#9d6bff' : '#4caf7d');
      const opacity = st.opacity != null ? st.opacity : 1;
      const sizeMul = st.size || 1;
      const c0 = this.toLocal(w.collar), c1 = this.toLocal(w.end);
      const dir = new THREE.Vector3().subVectors(c1, c0);
      const len = dir.length();
      if (len > 1e-4) {
        const shaftGeo = new THREE.CylinderGeometry(this.markerR * 0.28 * sizeMul, this.markerR * 0.28 * sizeMul, len, 6);
        const shaftMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: opacity * (w.isPiezo ? 0.9 : 0.75) });
        const shaft = new THREE.Mesh(shaftGeo, shaftMat);
        shaft.position.copy(c0).addScaledVector(dir, 0.5);
        shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
        shaft.userData = { name: w.name, label: (w.isPiezo ? 'Пьезометрическая' : 'Дренажная') + ' скважина', z: w.collar.z };
        group.add(shaft);
      }
      const headMat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
      const head = new THREE.Mesh(makeGeometry(THREE, st.geometry, this.markerR * 0.7 * sizeMul), headMat);
      head.position.copy(c0);
      head.userData = { name: w.name, label: (w.isPiezo ? 'Пьезометрическая' : 'Дренажная') + ' скважина (устье)', z: w.collar.z };
      group.add(head);
    });
    t.scene.add(group);
    t.wellsGroup = group;
  }

  async buildContours() {
    await loadDelaunay();
    const THREE = window.THREE;
    const wtPts = this.waterPoints.filter((p) => p.z != null).map((p) => ({ x: p.x, y: p.y, z: p.z }));
    if (wtPts.length < 3) return null;
    const dense = densifyWaterTable(wtPts);
    const densePts = dense.points;
    const coords = new Float64Array(densePts.length * 2);
    densePts.forEach((p, i) => { coords[i * 2] = p.x; coords[i * 2 + 1] = p.y; });
    const delaunay = new window.d3.Delaunay(coords);
    const xs = Float64Array.from(densePts.map((p) => p.x)), ys = Float64Array.from(densePts.map((p) => p.y)), zs = Float64Array.from(densePts.map((p) => p.z));
    const triangles = filterLongTriangles(xs, ys, delaunay.triangles, dense.cell * 2.5);

    let zMin = wtPts[0].z, zMax = wtPts[0].z;
    wtPts.forEach((p) => { if (p.z < zMin) zMin = p.z; if (p.z > zMax) zMax = p.z; });
    const step = chooseContourStep(zMin, zMax);
    const levels = [];
    for (let L = Math.ceil(zMin / step) * step; L <= zMax + 1e-6; L += step) levels.push(Math.round(L * 100) /100);
    const byLevel = levels.map((level) => ({ level, segs: traceContourSegments(xs, ys, zs, triangles, level) })).filter((l) => l.segs.length > 0);
    this.contourData = { levels: byLevel, zMin, zMax, pointCount: wtPts.length };
    return this.contourData;
  }

  addContourToScene(opacity) {
    const THREE = window.THREE;
    const t = this.three;
    if (!this.contourData) return;
    const tr = t.transform;
    const group = new THREE.Group();
    const op = opacity != null ? opacity : 1;
    this.contourData.levels.forEach((lvl) => {
      const color = contourColor(lvl.level, this.contourData.zMin, this.contourData.zMax);
      const positions = new Float32Array(lvl.segs.length / 2 * 3);
      for (let i = 0, k = 0; i < lvl.segs.length; i += 2, k += 3) {
        const x = lvl.segs[i], y = lvl.segs[i + 1];
        positions[k] = (x - tr.cx) * tr.scale; positions[k + 1] = (lvl.level - tr.cz) * tr.scale; positions[k + 2] = -(y - tr.cy) * tr.scale;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({ color, linewidth: 2, transparent: op < 1, opacity: op });
      group.add(new THREE.LineSegments(geo, mat));
    });
    if (this.contourGroup) t.scene.remove(this.contourGroup);
    t.scene.add(group);
    this.contourGroup = group;
  }

  setContourVisible(visible) { if (this.contourGroup) this.contourGroup.visible = visible; }
  setWireframeVisible(visible) { if (this.three && this.three.wireframe) this.three.wireframe.visible = visible; }

  dispose() {
    if (!this.three) return;
    if (this.three.resizeObserver) this.three.resizeObserver.disconnect();
    if (this.three.renderer) { this.three.renderer.dispose(); this.three.renderer.domElement.remove(); }
    this.three = null;
  }
}
