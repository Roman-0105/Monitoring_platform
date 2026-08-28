// 3D-сцена зумпфа (каркас меша + плоскость воды) — точный порт _sfInit3D из
// hydro-monitoring/ui-sump-forecast.js. Переиспользует loadThree() из pit3d-core.js
// (тот же Three.js r128 + OrbitControls, уже загружаемые для Модели карьера).
import { loadThree } from './pit3d-core.js';

export class SumpScene {
  constructor(container) {
    this.container = container;
    this.three = null;
  }

  async init(geom, currentLevel) {
    await loadThree();
    const THREE = window.THREE;
    const container = this.container;
    const W = container.clientWidth || 480, H3 = container.clientHeight || 390;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H3);
    renderer.setClearColor(0x0d1117, 1);
    container.innerHTML = '';
    container.style.position = 'relative';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(1, 2, 3);
    scene.add(dirLight);

    const { xs, ys, zs, tris, zMin, zMax } = geom;
    let xMin = xs[0], xMax = xs[0], yMin = ys[0], yMax = ys[0];
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] < xMin) xMin = xs[i]; if (xs[i] > xMax) xMax = xs[i];
      if (ys[i] < yMin) yMin = ys[i]; if (ys[i] > yMax) yMax = ys[i];
    }
    const cx = (xMin + xMax) / 2, cy = (yMin + yMax) / 2, cz = (zMin + zMax) / 2;
    const span = Math.max(xMax - xMin, yMax - yMin, zMax - zMin) || 1;
    const scale = 80 / span;

    // Mining X→Three X, Mining Y→Three -Z, Mining Z(высота)→Three Y
    const positions = new Float32Array(tris.length * 9);
    for (let j = 0; j < tris.length; j++) {
      const t = tris[j];
      positions[j * 9 + 0] = (xs[t[0]] - cx) * scale; positions[j * 9 + 1] = (zs[t[0]] - cz) * scale; positions[j * 9 + 2] = -(ys[t[0]] - cy) * scale;
      positions[j * 9 + 3] = (xs[t[1]] - cx) * scale; positions[j * 9 + 4] = (zs[t[1]] - cz) * scale; positions[j * 9 + 5] = -(ys[t[1]] - cy) * scale;
      positions[j * 9 + 6] = (xs[t[2]] - cx) * scale; positions[j * 9 + 7] = (zs[t[2]] - cz) * scale; positions[j * 9 + 8] = -(ys[t[2]] - cy) * scale;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();

    const solidMat = new THREE.MeshPhongMaterial({ color: 0x6b7280, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false });
    scene.add(new THREE.Mesh(geo, solidMat));
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x9ca3af, transparent: true, opacity: 0.6 });
    scene.add(new THREE.LineSegments(new THREE.WireframeGeometry(geo), edgeMat));

    const waterSize = span * scale * 1.2;
    const waterMat = new THREE.MeshPhongMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(waterSize, waterSize), waterMat);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.y = currentLevel != null ? (currentLevel - cz) * scale : (zMin - cz) * scale;
    scene.add(waterMesh);

    const camera = new THREE.PerspectiveCamera(40, W / H3, 0.1, 2000);
    const d = span * scale;
    camera.position.set(d * 0.8, d * 0.9, d * 1.1);
    camera.lookAt(0, 0, 0);

    const controls = new window._sfOrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 10;
    controls.maxDistance = 500;

    this._stopped = false;
    const animate = () => {
      if (this._stopped) return;
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const ro = new ResizeObserver(() => {
      const nw = container.clientWidth, nh = container.clientHeight || nw;
      if (!nw || !nh) return;
      camera.aspect = nw / nh; camera.updateProjectionMatrix(); renderer.setSize(nw, nh);
    });
    ro.observe(container);

    this.three = { renderer, scene, camera, controls, waterMesh, cz, scale, resizeObserver: ro, get animId() { return animId; } };
  }

  setWaterLevel(level) {
    if (!this.three) return;
    this.three.waterMesh.position.y = (level - this.three.cz) * this.three.scale;
  }

  dispose() {
    if (!this.three) return;
    if (this.three.resizeObserver) this.three.resizeObserver.disconnect();
    if (this.three.renderer) { this.three.renderer.dispose(); this.three.renderer.domElement.remove(); }
    this.three = null;
  }
}
