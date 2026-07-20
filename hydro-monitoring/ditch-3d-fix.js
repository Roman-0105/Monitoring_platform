/**
 * Правильная система координат для 3D модели канавы:
 *   X — ширина (от -B/2 до +B/2)
 *   Y — вертикаль (0 = зеркало воды, отрицательные = глубина вниз)
 *   Z — длина (от -L/2 до +L/2, поток движется в +Z)
 *
 * Ключевые исправления относительно старого кода:
 *   1. Убран rotation.y = PI/2 у основного меша
 *   2. Центрирование через position.z = -L/2 (не rotation)
 *   3. Торцы: new THREE.Vector3(p.x, p.y, zPos) — правильно
 *   4. Стрелки: cone.rotation.x = PI/2 — вдоль +Z
 *   5. Зеркало воды: PlaneGeometry(B, L) + rotation.x = -PI/2
 *   6. Грунт по бокам: position.x = ±(B/2 + offset)
 *   7. Частицы: pp[i*3+2] += dt*speed (движение по +Z)
 */

function buildDitch3D(scene, deps_cm, B, L, Q_ls) {
  var deps = deps_cm.map(function(d){ return d/100; }); // см → м
  var n = deps.length;
  var dx = B / (n - 1);

  // ── Гидравлика ───────────────────────────────────────
  var A = 0, chi = 0;
  for (var i = 0; i < n - 1; i++) {
    A += (deps[i] + deps[i+1]) / 2 * dx;
    var dh = deps[i+1] - deps[i];
    chi += Math.sqrt(dx*dx + dh*dh);
  }
  var hMax = Math.max.apply(null, deps);
  var v = A > 0 ? (Q_ls / 1000) / A : 0;

  // ── Профиль в XY плоскости ───────────────────────────
  var p2 = deps.map(function(d, i) {
    return new THREE.Vector2(-B/2 + i*dx, -d);
  });

  // ── ФОРМА для ExtrudeGeometry ────────────────────────
  var shape = new THREE.Shape();
  shape.moveTo(p2[0].x, p2[0].y);         // Тн (-B/2, 0)
  for (var i = 1; i < n; i++) shape.lineTo(p2[i].x, p2[i].y);
  shape.lineTo(-B/2, 0);                    // замыкаем по зеркалу воды

  // ── ЭКСТРУЗИЯ вдоль +Z — никаких rotation! ──────────
  var geo = new THREE.ExtrudeGeometry(shape, { depth: L, bevelEnabled: false, steps: 2 });

  // Грунт/порода
  var chan = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x4a3320, side: THREE.DoubleSide }));
  chan.position.z = -L/2;  // центрируем: 0..L → -L/2..+L/2
  scene.add(chan);

  // Вода
  var water = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
    color: 0x1565c0, transparent: true, opacity: 0.45, side: THREE.DoubleSide
  }));
  water.position.z = -L/2;
  scene.add(water);

  // ── ЗЕРКАЛО ВОДЫ (горизонтально в плоскости XZ) ─────
  // PlaneGeometry(B, L) лежит в XY → rotation.x = -PI/2 → в XZ
  var mirror = new THREE.Mesh(
    new THREE.PlaneGeometry(B, L),
    new THREE.MeshLambertMaterial({ color: 0x42a5f5, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
  );
  mirror.rotation.x = -Math.PI/2;  // горизонтально
  mirror.position.y = 0.002;        // y=0 = зеркало воды
  scene.add(mirror);

  // ── ГРУНТ ПО БОКАМ (вдоль Z, рядом с берегами по X) ─
  var gndMat = new THREE.MeshLambertMaterial({ color: 0x3d2c1e });
  [-1, 1].forEach(function(side) {
    var g = new THREE.Mesh(new THREE.PlaneGeometry(3.5, L), gndMat);
    g.rotation.x = -Math.PI/2;
    g.position.set(side * (B/2 + 1.75), 0.001, 0);  // рядом с берегом по X
    scene.add(g);
  });

  // ── ТОРЦЕВЫЕ ПРОФИЛИ ─────────────────────────────────
  // zPos = -L/2 (передний) или +L/2 (задний)
  function addEndProfile(zPos) {
    var pts = p2.map(function(p) { return new THREE.Vector3(p.x, p.y, zPos); });
    pts.push(new THREE.Vector3(-B/2, 0, zPos));
    pts.push(pts[0].clone());
    scene.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffffff })
    ));
    p2.forEach(function(p, i) {
      var isMid = i > 0 && i < n - 1;
      var sph = new THREE.Mesh(
        new THREE.SphereGeometry(isMid ? 0.055 : 0.03, 8, 8),
        new THREE.MeshLambertMaterial({ color: isMid ? 0xf9ab00 : 0xaaaaaa })
      );
      sph.position.set(p.x, p.y, zPos);
      scene.add(sph);
    });
  }
  addEndProfile(-L/2);
  addEndProfile( L/2);

  // ── СТРЕЛКИ СКОРОСТИ (направлены вдоль +Z) ──────────
  // ConeGeometry ось = +Y (вершина вверх)
  // rotation.x = PI/2 → вершина смотрит в +Z (направление потока)
  var arrowStep = L / 5;
  for (var zi = -L/2 + arrowStep; zi < L/2 - 0.1; zi += arrowStep) {
    p2.forEach(function(p, i) {
      if (i === 0 || i === n - 1) return;
      var d = Math.abs(p.y);
      if (d < 0.01) return;
      var ratio = d / hMax;
      var vLocal = v * (1.8 * ratio - 0.8 * ratio * ratio); // параболическая эпюра
      var arLen = 0.1 + (vLocal / (v || 1)) * 0.5;
      var col = vLocal > v * 0.7 ? 0xef5350 : vLocal > v * 0.4 ? 0xffa726 : 0x29b6f6;
      var cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.04, arLen, 6),
        new THREE.MeshLambertMaterial({ color: col })
      );
      cone.rotation.x = Math.PI / 2;  // ← ключевое исправление: вдоль +Z
      cone.position.set(p.x, p.y * 0.5, zi);
      scene.add(cone);
    });
  }

  // ── ЧАСТИЦЫ (движутся вдоль +Z) ─────────────────────
  var NP = 280, posArr = new Float32Array(NP * 3);
  for (var i = 0; i < NP; i++) {
    var xi = (-B/2 + Math.random() * B) * 0.88;
    var idx = Math.max(0, Math.min(n - 1, Math.round((xi + B/2) / dx)));
    posArr[i*3    ] = xi;
    posArr[i*3 + 1] = -Math.random() * deps[idx] * 0.88;
    posArr[i*3 + 2] = (Math.random() - 0.5) * L;  // по всей длине Z
  }
  var pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  var particles = new THREE.Points(pg, new THREE.PointsMaterial({
    color: 0x90caf9, size: 0.055, transparent: true, opacity: 0.8
  }));
  scene.add(particles);

  // В animate loop: posArr[i*3+2] += dt * speed (движение вдоль Z)
  return { particles: particles, posArr: posArr, speed: Math.max(0.2, v * 0.9 + 0.2) };
}

/**
 * ОШИБКИ СТАРОГО КОДА — что было не так:
 *
 * ✗ gMesh.rotation.y = Math.PI/2  ← вращало меш, путая X/Z
 * ✗ gMesh.position.set(-L/2, 0, 0) ← неверно после rotation.y
 * ✗ addProfile: Vector3(p.x, p.y, zPos) — работало СЛУЧАЙНО
 *   только потому что rotation перемешивал оси
 * ✗ cone.rotation.z = Math.PI/2  ← стрелки смотрели вдоль X, не Z
 * ✗ Грунт: position.set(side*(B/2+1.5), 0, 0) — OK случайно
 * ✗ Частицы двигались по pp[i*3+2] но после rotation ось Z≠длина
 *
 * ✓ ИСПРАВЛЕНО: нет rotation на основном меше
 *   Экструзия напрямую вдоль Z, position.z = -L/2 для центрирования
 */
