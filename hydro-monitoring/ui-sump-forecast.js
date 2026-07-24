// ── Прогноз зумпфов ─────────────────────────────────────────────────────────

var SumpForecastState = {
  selectedSumpId:      null,
  analysisDays:        30,
  _inflowChartInst:    null,
  _vhChartInst:        null,
  _levelChartInst:     null,
  _forecastChartInst:  null,
  _geom:               null,
  _three:              null,
  _forecastParams:     null,  // { startDt, endDt, pumpQ: {id:q}, stops: [{pumpId,startDt,durationH}] }
  _forecastResult:     null,  // [{t,H,V,Qpump}]
  _forecastSumpId:     null,
  _forecastAvgQ:       null,
  _forecastStep:       1,     // активный шаг сайдбара (1=Период, 2=Насосы, 3=Остановки)
  _forecastRenderCtx:  null,  // { result, sump, avgQ, pumps, latLev } для перерисовки
};

// ── Утилита: загрузка sql.js (WASM SQLite) ──────────────────────────────────
function _sfLoadSqlJs() {
  if (window._sfSqlJs) return Promise.resolve(window._sfSqlJs);
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js';
    s.onload = function() {
      initSqlJs({ locateFile: function(f) {
        return 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/' + f;
      }}).then(function(SQL) { window._sfSqlJs = SQL; resolve(SQL); }).catch(reject);
    };
    s.onerror = function() { reject(new Error('Не удалось загрузить sql.js')); };
    document.head.appendChild(s);
  });
}

// ── Загрузка Three.js и OrbitControls ────────────────────────────────────────
function _sfLoadThree() {
  if (window.THREE && window._sfOrbitControls) return Promise.resolve();
  return new Promise(function(resolve, reject) {
    function loadScript(src, cb) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = cb;
      s.onerror = function(){ reject(new Error('Не удалось загрузить ' + src)); };
      document.head.appendChild(s);
    }
    var base = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/';
    loadScript(base + 'three.min.js', function() {
      // OrbitControls не входит в основной бандл r128 — берём с unpkg
      loadScript('https://unpkg.com/three@0.128.0/examples/js/controls/OrbitControls.js', function() {
        window._sfOrbitControls = THREE.OrbitControls;
        resolve();
      });
    });
  });
}

// ── Парсинг Geometry BLOB из .tridb ─────────────────────────────────────────
// Формат: заголовок(60 байт) → блоки [size(4),0(4),type(4),0(4)] + данные
//   type 1 = X float64[], type 2 = Y float64[], type 3 = Z float64[], type 4 = uint32 тройки
function _sfParseGeomBlob(blob) {
  var buf = blob.buffer ? blob.buffer : blob;
  var dv  = new DataView(buf instanceof ArrayBuffer ? buf : buf.slice(0));
  var off = 60; // пропускаем заголовок с GUID

  var xs, ys, zs, tris;

  while (off < dv.byteLength - 16) {
    var blockSize = dv.getUint32(off,     true);
    var blockType = dv.getUint32(off + 8, true);
    off += 16;
    if (blockSize === 0) break;
    var count = blockSize / 8;

    if (blockType === 1 || blockType === 2 || blockType === 3) {
      var arr = new Float64Array(count);
      for (var i = 0; i < count; i++) arr[i] = dv.getFloat64(off + i * 8, true);
      if (blockType === 1) xs = arr;
      else if (blockType === 2) ys = arr;
      else zs = arr;
    } else if (blockType === 4) {
      var nTri = (blockSize / 4) / 3;
      tris = [];
      for (var j = 0; j < nTri; j++) {
        tris.push([
          dv.getUint32(off + j * 12,     true),
          dv.getUint32(off + j * 12 + 4, true),
          dv.getUint32(off + j * 12 + 8, true),
        ]);
      }
    }
    off += blockSize;
  }
  return { xs: xs, ys: ys, zs: zs, tris: tris };
}

// ── Площадь горизонтального сечения на отметке H ─────────────────────────────
//
// Алгоритм (не зависит от ориентации нормалей треугольников):
//  1. Находим все отрезки пересечения треугольников с плоскостью Z = H.
//  2. Строим граф смежности: конец отрезка → список соседних концов.
//  3. Обходим граф, собирая замкнутые контуры (каждое ребро — ровно один раз).
//  4. Площадь каждого контура — формула Шнурка (Gauss); суммируем по модулю.
//
// Ключи вершин квантуются с точностью 1 мм для стыковки близких концов.
// При несогласованных нормалях Green's theorem / shoelace суммируются
// некорректно (часть отрезков "обратная" → взаимная отмена площадей).
// Топологический обход контуров решает эту проблему полностью.

function _sfCrossSectionArea(lxs, lys, zs, tris, H) {
  var Q = 1000; // квантование 1 мм

  function ptKey(x, y) {
    // Смещение +4e6 чтобы отрицательные локальные координаты давали положительный ключ
    return (Math.round(x * Q) + 4000000) + '|' + (Math.round(y * Q) + 4000000);
  }

  // Граф: ключ → { x, y, nb: [ключи соседей] }
  var graph = {};

  for (var i = 0; i < tris.length; i++) {
    var t = tris[i];
    // Находим точки пересечения трёх рёбер треугольника с плоскостью H
    var vx = [lxs[t[0]], lxs[t[1]], lxs[t[2]]];
    var vy = [lys[t[0]], lys[t[1]], lys[t[2]]];
    var vz = [ zs[t[0]],  zs[t[1]],  zs[t[2]]];

    var pts = [];
    for (var e = 0; e < 3; e++) {
      var ne = (e + 1) % 3;
      var az = vz[e], bz = vz[ne];
      if ((az < H) === (bz < H)) continue; // оба по одну сторону
      var tt = (H - az) / (bz - az);
      pts.push([vx[e] + tt * (vx[ne] - vx[e]),
                vy[e] + tt * (vy[ne] - vy[e])]);
    }
    if (pts.length !== 2) continue; // 0 или 3 точки — пропуск

    var k0 = ptKey(pts[0][0], pts[0][1]);
    var k1 = ptKey(pts[1][0], pts[1][1]);
    if (k0 === k1) continue; // вырожденный отрезок

    if (!graph[k0]) graph[k0] = { x: pts[0][0], y: pts[0][1], nb: [] };
    if (!graph[k1]) graph[k1] = { x: pts[1][0], y: pts[1][1], nb: [] };
    graph[k0].nb.push(k1);
    graph[k1].nb.push(k0);
  }

  var keys = Object.keys(graph);
  if (keys.length < 3) return 0;

  // Обход: каждое ненаправленное ребро посещаем ровно один раз
  var usedEdge = {}; // 'k0>k1' → true
  var totalArea = 0;

  for (var si = 0; si < keys.length; si++) {
    var startKey = keys[si];
    // Ищем первое неиспользованное ребро из startKey
    var startNbs = graph[startKey].nb;
    var firstNb = null;
    for (var ni = 0; ni < startNbs.length; ni++) {
      if (!usedEdge[startKey + '>' + startNbs[ni]]) {
        firstNb = startNbs[ni]; break;
      }
    }
    if (!firstNb) continue;

    // Строим контур, следуя по графу
    var loop = [graph[startKey]];
    var prev = startKey;
    var cur  = firstNb;
    usedEdge[startKey + '>' + firstNb] = true;
    usedEdge[firstNb + '>' + startKey] = true;

    var guard = keys.length + 4;
    while (cur !== startKey && guard-- > 0) {
      var nd = graph[cur];
      if (!nd) break;
      loop.push(nd);

      // Следующий: сосед ≠ prev с неиспользованным ребром
      var nbs = nd.nb;
      var nextKey = null;
      for (var ni = 0; ni < nbs.length; ni++) {
        if (nbs[ni] !== prev && !usedEdge[cur + '>' + nbs[ni]]) {
          nextKey = nbs[ni]; break;
        }
      }
      // Если все (кроме prev) использованы — пробуем любое свободное
      if (!nextKey) {
        for (var ni = 0; ni < nbs.length; ni++) {
          if (!usedEdge[cur + '>' + nbs[ni]]) {
            nextKey = nbs[ni]; break;
          }
        }
      }
      if (!nextKey) break;

      usedEdge[cur + '>' + nextKey] = true;
      usedEdge[nextKey + '>' + cur] = true;
      prev = cur;
      cur  = nextKey;
    }

    if (loop.length < 3) continue;

    // Формула Шнурка (площадь полигона, знак = ориентация)
    var area = 0;
    for (var j = 0; j < loop.length; j++) {
      var pa = loop[j];
      var pb = loop[(j + 1) % loop.length];
      area += pa.x * pb.y - pb.x * pa.y;
    }
    totalArea += Math.abs(area) * 0.5;
  }

  return totalArea;
}

// ── Построение кривой V(H) ───────────────────────────────────────────────────
//
// Метод: интегрирование площадей горизонтальных сечений (правило средней точки).
// Координаты XY переводятся в локальную систему (центроид → 0) для
// численной устойчивости: большие абсолютные значения (x ≈ 46 000 м)
// при квантовании ключей могут давать коллизии без этого сдвига.

function _sfBuildVolumeCurve(xs, ys, zs, tris, zMin, zMax) {
  // Центрируем XY относительно центроида меша
  var xSum = 0, ySum = 0, nv = xs.length;
  for (var k = 0; k < nv; k++) { xSum += xs[k]; ySum += ys[k]; }
  var xOff = xSum / nv, yOff = ySum / nv;
  var lxs = new Float64Array(nv), lys = new Float64Array(nv);
  for (var k = 0; k < nv; k++) { lxs[k] = xs[k] - xOff; lys[k] = ys[k] - yOff; }

  var step = 0.1; // шаг интегрирования — 10 см
  var curve = [{ h: zMin, v: 0 }];
  var V = 0;
  var H = zMin + step;
  while (H <= zMax + step * 0.01) {
    H = Math.round(H * 10) / 10;
    // Площадь на средней точке слоя (правило средней точки)
    var A = _sfCrossSectionArea(lxs, lys, zs, tris, H - step * 0.5);
    V += A * step;
    curve.push({ h: H, v: V });
    H += step;
  }
  return curve;
}

// ── Интерполяция V(H) и обратная задача ─────────────────────────────────────
function _sfVolumeAt(curve, level) {
  if (!curve || curve.length === 0) return null;
  if (level <= curve[0].h) return 0;
  if (level >= curve[curve.length-1].h) return curve[curve.length-1].v;
  for (var i = 1; i < curve.length; i++) {
    if (level <= curve[i].h) {
      var t = (level - curve[i-1].h) / (curve[i].h - curve[i-1].h);
      return curve[i-1].v + t * (curve[i].v - curve[i-1].v);
    }
  }
  return null;
}

function _sfLevelAt(curve, targetV) {
  if (!curve || curve.length === 0) return null;
  if (targetV <= 0) return curve[0].h;
  if (targetV >= curve[curve.length-1].v) return curve[curve.length-1].h;
  for (var i = 1; i < curve.length; i++) {
    if (curve[i].v >= targetV) {
      var t = (targetV - curve[i-1].v) / (curve[i].v - curve[i-1].v);
      return curve[i-1].h + t * (curve[i].h - curve[i-1].h);
    }
  }
  return null;
}

// ── Расчёт среднего суточного притока по истории ─────────────────────────────
function _sfComputeInflowHistory(sump, days) {
  var result = [];
  if (!sump.volumeCurve || sump.volumeCurve.length === 0) return result;

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days || 30));
  var cutoffStr = cutoff.toISOString().slice(0,10);

  // Отметки зумпфа по датам за выбранный период
  var levByDate = {};
  var levs = DewateringState.waterLevels.filter(function(l){ return l.sumpId === sump.id && l.date >= cutoffStr; });
  levs.forEach(function(l) {
    if (!levByDate[l.date] || l.time < levByDate[l.date].time) levByDate[l.date] = l;
  });

  // Суммарный объём откаченной воды по датам со всех насосов зумпфа
  var pumpIds = DewateringState.pumps
    .filter(function(p){ return p.sumpId === sump.id && p.countInVolume !== false; })
    .map(function(p){ return p.id; });

  var pumpedByDate = {};
  DewateringState.meterReadings.forEach(function(r) {
    if (pumpIds.indexOf(r.pumpId) < 0 || r.date < cutoffStr) return;
    var v = DewateringState.computedVolume(r);
    pumpedByDate[r.date] = (pumpedByDate[r.date] || 0) + v;
  });

  // Перебираем пары дней (D-1 → D)
  var dates = Object.keys(levByDate).sort();
  for (var i = 1; i < dates.length; i++) {
    var d1 = dates[i-1], d2 = dates[i];
    var H1 = parseFloat(levByDate[d1].elevation);
    var H2 = parseFloat(levByDate[d2].elevation);
    var V1 = _sfVolumeAt(sump.volumeCurve, H1);
    var V2 = _sfVolumeAt(sump.volumeCurve, H2);
    if (V1 === null || V2 === null || isNaN(H1) || isNaN(H2)) continue;

    var Vpumped = pumpedByDate[d2] || 0;
    var deltaV  = V2 - V1;
    var Qin     = (Vpumped + deltaV) / 24;
    if (Qin < 0) Qin = 0;

    result.push({ date: d2, q: Math.round(Qin * 10) / 10, vpumped: Math.round(Vpumped), dh: Math.round((H2-H1)*100)/100 });
  }
  return result.slice(-60); // последние 60 суток
}

// ── Фактическая производительность насосов зумпфа ────────────────────────────
function _sfPumpPerformance(sump, days) {
  days = days || 30;
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  var cutoffStr = cutoff.toISOString().slice(0,10);

  return DewateringState.pumps
    .filter(function(p){ return p.sumpId === sump.id; })
    .map(function(p) {
      var recs = DewateringState.meterReadings.filter(function(r){
        return r.pumpId === p.id && r.date >= cutoffStr && !r.isStopped;
      });
      var totalVol = recs.reduce(function(s,r){ return s + (DewateringState.computedVolume(r)||0); }, 0);
      var totalH   = recs.reduce(function(s,r){ return s + (parseFloat(r.hoursWorked)||0); }, 0);
      var q = totalH > 0 ? totalVol / totalH : 0;
      return { id: p.id, name: p.name, model: p.model, status: p.status,
               q: Math.round(q * 10) / 10, totalVol: Math.round(totalVol), totalH: Math.round(totalH) };
    });
}

// ── Обработка загрузки файла .tridb пользователем ───────────────────────────
async function _sfHandleTridbUpload(file, sump) {
  var statusEl = document.getElementById('sf-upload-status');
  function setStatus(msg, err) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = err ? '#f87171' : '#60a5fa';
  }

  setStatus('Загрузка sql.js...');
  var SQL;
  try { SQL = await _sfLoadSqlJs(); }
  catch(e) { setStatus('Ошибка загрузки sql.js: ' + e.message, true); return; }

  setStatus('Чтение файла...');
  var ab = await file.arrayBuffer();
  var db;
  try { db = new SQL.Database(new Uint8Array(ab)); }
  catch(e) { setStatus('Не удалось открыть файл как SQLite. Проверь формат .tridb', true); return; }

  try {
    // Метаданные
    var infoRow = db.exec('SELECT Volume,ZMinimum,ZMaximum,Name FROM GeneralInformation LIMIT 1')[0].values[0];
    var totalVol = infoRow[0], zMin = infoRow[1], zMax = infoRow[2];

    setStatus('Парсинг геометрии (' + zMin.toFixed(1) + ' — ' + zMax.toFixed(1) + ' м)...');

    // Геометрия
    var geomBlob = db.exec('SELECT Geometry FROM Geometry LIMIT 1')[0].values[0][0];
    var geom = _sfParseGeomBlob(geomBlob);
    if (!geom.xs || !geom.tris) { setStatus('Геометрия не найдена в файле', true); return; }

    setStatus('Построение кривой V(H)...');
    var curve = _sfBuildVolumeCurve(geom.xs, geom.ys, geom.zs, geom.tris, zMin, zMax);
    // Сохраняем геометрию для 3D-рендера
    SumpForecastState._geom = { xs: geom.xs, ys: geom.ys, zs: geom.zs, tris: geom.tris, zMin: zMin, zMax: zMax };

    // Верификация: V при zMax должен быть близок к паспортному totalVol
    var computedMax = curve[curve.length-1].v;
    var errFrac = totalVol > 0 ? Math.abs(computedMax - totalVol) / totalVol : 1;
    if (errFrac > 0.10) {
      console.warn('[sf] V(zMax)=', computedMax.toFixed(0), '≠ totalVol=', totalVol.toFixed(0),
        'погрешность:', (errFrac*100).toFixed(1) + '%', '— возможны дефекты меша');
      setStatus('⚠ V(zMax)=' + _sfFmt(computedMax) + ' м³, паспорт=' + _sfFmt(totalVol)
        + ' м³ (расхождение ' + (errFrac*100).toFixed(0) + '%). Проверьте меш в Micromine.', true);
    }

    setStatus('Загрузка файла в хранилище...');
    var uploaded = false;
    if (window.Api) {
      try {
        var path = sump.id + '.tridb';
        var upRes = await Api.uploadSumpTridb(path, file);
        if (!upRes.error) { sump.tridbPath = path; uploaded = true; }
        else console.warn('[sf] storage upload failed', upRes.error);
      } catch(e) { console.warn('[sf] storage upload failed', e); }
    }

    // Сохраняем в Supabase
    sump.totalVolume   = Math.round(totalVol * 10) / 10;
    sump.zMin          = zMin;
    sump.zMax          = zMax;
    sump.volumeCurve   = curve;
    DewateringState.save();

    await Api.upsertDewSump({
      id: sump.id, name: sump.name, quarry: sump.quarry, notes: sump.notes,
      tridb_path:   uploaded ? sump.tridbPath : null,
      total_volume: sump.totalVolume,
      z_min:        sump.zMin,
      z_max:        sump.zMax,
      critical_level: sump.criticalLevel || null,
      volume_curve: sump.volumeCurve,
    });

    setStatus('✓ Готово! Объём: ' + sump.totalVolume.toFixed(0) + ' м³  ·  Z: ' + zMin.toFixed(1) + '–' + zMax.toFixed(1) + ' м');
    renderSumpForecastContent(sump);

  } catch(e) {
    setStatus('Ошибка: ' + e.message, true);
    console.error('[sf] tridb parse error', e);
  } finally {
    db.close();
  }
}

// ── Инициализация вкладки ────────────────────────────────────────────────────
function initSumpForecastTab() {
  if (!window.DewateringState) return;
  if (!DewateringState.sumps || DewateringState.sumps.length === 0) {
    document.getElementById('sf-content').innerHTML =
      '<p style="color:var(--text-muted);padding:24px">Зумпфы не настроены. Добавьте их во вкладке «Журнал водоотлива».</p>';
    return;
  }
  if (!SumpForecastState.selectedSumpId) {
    SumpForecastState.selectedSumpId = DewateringState.sumps[0].id;
  }
  _sfRenderSelector();
  var sump = DewateringState.sumps.find(function(s){ return s.id === SumpForecastState.selectedSumpId; });
  if (sump) renderSumpForecastContent(sump);
}

function _sfRenderSelector() {
  var el = document.getElementById('sf-sump-selector');
  if (!el) return;
  var quarries = {};
  var order = [];
  DewateringState.sumps.forEach(function(s) {
    var q = s.quarry || '—';
    if (!quarries[q]) { quarries[q] = []; order.push(q); }
    quarries[q].push(s);
  });

  var html = '<div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start">';
  order.forEach(function(q) {
    html += '<div style="display:flex;flex-direction:column;gap:4px">';
    html += '<span style="font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--text-muted);padding-left:2px">' + _sfEsc(q) + '</span>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:4px">';
    quarries[q].forEach(function(s) {
      var active = s.id === SumpForecastState.selectedSumpId;
      html += '<button class="btn btn-sm ' + (active ? 'btn-primary' : 'btn-outline') + '" onclick="_sfSelectSump(\'' + s.id + '\')">' + _sfEsc(s.name) + '</button>';
    });
    html += '</div></div>';
  });
  html += '</div>';
  el.innerHTML = html;
}

function _sfSelectSump(id) {
  SumpForecastState.selectedSumpId = id;
  SumpForecastState._geom = null; // сбрасываем геометрию при смене зумпфа
  _sfDestroy3D();
  _sfRenderSelector();
  var sump = DewateringState.sumps.find(function(s){ return s.id === id; });
  if (sump) renderSumpForecastContent(sump);
}

// ── Сбор данных для графика уровень+откачка ───────────────────────────────────
function _sfBuildLevelPumpData(sump, days) {
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (days || 30));
  var cutoffStr = cutoff.toISOString().slice(0,10);

  // Уровни воды — все записи за период, отсортированные по дате+времени
  var levs = DewateringState.waterLevels
    .filter(function(l){ return l.sumpId === sump.id && l.date >= cutoffStr; })
    .sort(function(a,b){ return (a.date+a.time).localeCompare(b.date+b.time); });

  // Суточная откачка и часы работы по насосам зумпфа
  var pumpIds = DewateringState.pumps
    .filter(function(p){ return p.sumpId === sump.id; })
    .map(function(p){ return p.id; });

  var pumpsByDate = {}; // { date: { vol, hours, stopped: bool } }
  DewateringState.meterReadings.forEach(function(r) {
    if (pumpIds.indexOf(r.pumpId) < 0 || r.date < cutoffStr) return;
    var e = pumpsByDate[r.date] || { vol: 0, hours: 0, stopped: false };
    e.vol   += DewateringState.computedVolume(r) || 0;
    e.hours += parseFloat(r.hoursWorked) || 0;
    if (r.isStopped) e.stopped = true;
    pumpsByDate[r.date] = e;
  });

  // Определяем даты без откачки (насосы стояли) в диапазоне с данными уровней
  var levelDates = levs.map(function(l){ return l.date; });
  var dateSet = {};
  levelDates.forEach(function(d){ dateSet[d] = true; });
  Object.keys(pumpsByDate).forEach(function(d){ dateSet[d] = true; });
  var allDates = Object.keys(dateSet).sort();

  return { levs: levs, pumpsByDate: pumpsByDate, allDates: allDates, pumpIds: pumpIds };
}

// ── Главный рендер страницы зумпфа ───────────────────────────────────────────
function renderSumpForecastContent(sump) {
  ['_inflowChartInst','_vhChartInst','_levelChartInst','_forecastChartInst'].forEach(function(k){
    if (SumpForecastState[k]) { try{SumpForecastState[k].destroy();}catch(e){} SumpForecastState[k]=null; }
  });
  _sfDestroy3D();

  var days      = SumpForecastState.analysisDays || 30;
  var hasCurve  = sump.volumeCurve && sump.volumeCurve.length > 0;
  var pumps     = _sfPumpPerformance(sump, days);
  var inflow    = hasCurve ? _sfComputeInflowHistory(sump, days) : [];
  var avgQ      = inflow.length > 0 ? inflow.reduce(function(s,r){return s+r.q;},0)/inflow.length : null;
  var latestLev = _sfLatestLevel(sump);
  var currVol   = (hasCurve && latestLev !== null) ? _sfVolumeAt(sump.volumeCurve, latestLev) : null;
  var pct       = (hasCurve && currVol !== null && sump.totalVolume) ? (currVol / sump.totalVolume * 100) : null;
  var lpData    = _sfBuildLevelPumpData(sump, days);

  // ── Панель выбора периода + ключевые метрики ──────────────────────────────
  function periodBtn(d, label) {
    var a = d === days;
    return '<button onclick="SumpForecastState.analysisDays='+d+';renderSumpForecastContent(DewateringState.sumps.find(function(s){return s.id===\''+sump.id+'\'}))" '
      + 'style="padding:4px 12px;border-radius:20px;border:1px solid '+(a?'#3b82f6':'var(--border-subtle)')+';font-size:12px;cursor:pointer;font-weight:'+(a?'700':'400')+';'
      + 'background:'+(a?'#3b82f6':'var(--bg-sub)')+';color:'+(a?'#fff':'var(--text-muted)')+'">'+label+'</button>';
  }
  var html = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:16px;flex-wrap:wrap">';
  html += '<span style="font-size:11px;color:var(--text-muted);margin-right:4px">Период анализа:</span>';
  html += periodBtn(7,'7 дн') + periodBtn(14,'14 дн') + periodBtn(30,'30 дн') + periodBtn(60,'60 дн') + periodBtn(90,'90 дн');
  // Ключевые метрики справа
  html += '<div style="margin-left:auto;display:flex;gap:12px;flex-wrap:wrap">';
  if (latestLev !== null) html += '<span style="font-size:12px">Уровень: <strong>' + latestLev.toFixed(2) + ' м</strong></span>';
  if (pct !== null && pct <= 110) {
    var pc = pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e';
    html += '<span style="font-size:12px">Заполнение: <strong style="color:'+pc+'">' + pct.toFixed(1) + '%</strong></span>';
  }
  if (avgQ !== null) html += '<span style="font-size:12px">Приток Q: <strong style="color:#60a5fa">' + avgQ.toFixed(1) + ' м³/ч</strong></span>';
  html += '</div></div>';

  // ── ОСНОВНАЯ СЕТКА: левая (инфо) + правая (3D) ────────────────────────────
  html += '<div style="display:grid;grid-template-columns:1fr 500px;gap:16px;align-items:start">';

  // ═══ ЛЕВАЯ КОЛОНКА ════════════════════════════════════════════════════════
  html += '<div style="display:flex;flex-direction:column;gap:14px;min-width:0">';

  // ─ Модель + насосы (две карточки в ряд) ──────────────────────────────────
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">';

  // Карточка: модель зумпфа
  html += '<div class="card" style="padding:14px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
  html += '<span class="card-title">Модель зумпфа</span>';
  html += '<label class="btn btn-sm btn-outline" style="cursor:pointer;font-size:11px;padding:2px 8px">';
  html += '<input type="file" accept=".tridb" style="display:none" onchange="_sfOnFileInput(event,\''+sump.id+'\')">';
  html += hasCurve ? '↺ .tridb' : '+ .tridb';
  html += '</label></div>';
  if (hasCurve) {
    html += _sfModelStats(sump, latestLev, currVol, pct);
    html += '<label style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin-top:6px">';
    html += 'Крит. уровень (м): <input type="number" step="0.1" value="'+(sump.criticalLevel||'')+'" style="width:68px;font-size:12px" onchange="_sfSaveCritical(\''+sump.id+'\',this.value)">';
    html += '</label>';
  } else {
    html += '<p style="color:var(--text-muted);font-size:13px">Файл .tridb не загружен</p>';
  }
  html += '<div id="sf-upload-status" style="font-size:11px;margin-top:5px;color:#60a5fa;min-height:14px"></div>';
  html += '</div>';

  // Карточка: насосы
  html += '<div class="card" style="padding:14px">';
  html += '<div class="card-title" style="margin-bottom:8px">Насосы <span style="font-size:11px;font-weight:400;color:var(--text-muted)">за '+days+' дн.</span></div>';
  if (pumps.length === 0) {
    html += '<p style="color:var(--text-muted);font-size:13px">Насосы не привязаны</p>';
  } else {
    var totalQ = pumps.reduce(function(s,p){ return s + p.q; }, 0);
    html += '<table style="width:100%;font-size:12px;border-collapse:collapse">';
    html += '<tr style="color:var(--text-muted);font-size:10px"><th style="text-align:left;padding:0 4px 5px 0">Насос</th><th style="text-align:right">Q, м³/ч</th><th style="text-align:right">Ч/р</th></tr>';
    pumps.forEach(function(p) {
      // Индикатор активности по реальным данным за период (а не по полю status)
      var active = p.totalH > 0;
      var badge = '<span style="color:'+(active?'#22c55e':'#6b7280')+';font-size:13px;line-height:1" title="'+(active?'Работал за период':'Нет данных за период')+'">●</span>';
      html += '<tr style="border-top:1px solid var(--border-subtle)">';
      html += '<td style="padding:4px 4px 4px 0">'+badge+' '+_sfEsc(p.name)+(p.model?'<br><span style="color:var(--text-muted);font-size:10px">'+_sfEsc(p.model)+'</span>':'')+'</td>';
      html += '<td style="text-align:right;font-weight:600">'+(p.q>0?p.q.toFixed(0):'—')+'</td>';
      html += '<td style="text-align:right;color:var(--text-muted)">'+(p.totalH>0?p.totalH:'—')+'</td>';
      html += '</tr>';
    });
    html += '</table>';
    html += '<div style="border-top:1px solid var(--border-subtle);margin-top:6px;padding-top:6px;font-size:12px;display:flex;justify-content:space-between">';
    html += '<span style="color:var(--text-muted)">Суммарно:</span><span style="font-weight:700">'+totalQ.toFixed(0)+' м³/ч</span></div>';
  }
  html += '</div>';

  html += '</div>'; // конец ряда модель+насосы

  // ─ График: уровень воды + объём откачки ─────────────────────────────────
  html += '<div class="card" style="padding:14px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">';
  html += '<span class="card-title">История уровня и водоотлива</span>';
  html += '<span style="font-size:11px;color:var(--text-muted)">за '+days+' дн.</span>';
  html += '</div>';
  // Управление масштабом оси Y (уровень)
  html += '<div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;flex-wrap:wrap">';
  html += '<span style="font-size:11px;color:var(--text-muted)">Ось Y (уровень):</span>';
  html += '<label style="font-size:11px;display:flex;align-items:center;gap:4px;color:var(--text-muted)">Мин';
  html += '<input type="number" id="sf-level-ymin" step="0.1" placeholder="авто" style="width:72px;font-size:11px;padding:2px 5px;border-radius:4px;background:var(--bg-sub);border:1px solid var(--border-subtle);color:var(--text-primary);margin-left:3px" onchange="_sfSetLevelYScale()"></label>';
  html += '<label style="font-size:11px;display:flex;align-items:center;gap:4px;color:var(--text-muted)">Макс';
  html += '<input type="number" id="sf-level-ymax" step="0.1" placeholder="авто" style="width:72px;font-size:11px;padding:2px 5px;border-radius:4px;background:var(--bg-sub);border:1px solid var(--border-subtle);color:var(--text-primary);margin-left:3px" onchange="_sfSetLevelYScale()"></label>';
  html += '<button onclick="_sfSetLevelYScaleReset()" style="font-size:10px;padding:2px 8px;border-radius:4px;background:none;border:1px solid var(--border-subtle);color:var(--text-muted);cursor:pointer">Авто</button>';
  html += '</div>';
  if (lpData.levs.length === 0) {
    html += '<p style="color:var(--text-muted);font-size:13px">Нет данных об уровне за выбранный период</p>';
  } else {
    html += '<canvas id="sf-level-chart" height="120"></canvas>';
    html += '<div style="display:flex;gap:16px;margin-top:8px;flex-wrap:wrap">';
    html += '<span style="font-size:10px;color:var(--text-muted);display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:20px;height:2px;background:#60a5fa"></span>Уровень воды (м)</span>';
    html += '<span style="font-size:10px;color:var(--text-muted);display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:12px;height:8px;background:rgba(34,197,94,0.4);border-radius:2px"></span>Объём откачки (м³/сут)</span>';
    if (sump.criticalLevel) html += '<span style="font-size:10px;color:#ef4444;display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:20px;height:1px;background:#ef4444;border-top:1px dashed #ef4444"></span>Крит. уровень</span>';
    html += '</div>';
  }
  html += '</div>';

  // ─ Водоприток (метод и значения) ─────────────────────────────────────────
  html += '<div class="card" style="padding:14px">';
  html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">';
  html += '<span class="card-title">Водоприток</span>';
  if (avgQ !== null) html += '<span style="font-size:18px;font-weight:700;color:#60a5fa">'+avgQ.toFixed(1)+' м³/ч</span>';
  html += '</div>';
  // Формула и метод
  html += '<div style="background:var(--bg-sub);border-radius:6px;padding:8px 10px;margin-bottom:10px;font-size:11px;color:var(--text-muted)">';
  html += '<div style="font-weight:600;margin-bottom:4px;color:var(--text-primary)">Метод расчёта (водный баланс):</div>';
  html += 'Q<sub>приток</sub> = (V<sub>откачано</sub> + ΔV<sub>зумпф</sub>) / 24<br>';
  html += '<span style="font-size:10px">ΔV<sub>зумпф</sub> = V(H₂) − V(H₁) по кривой V(H) · Усредняется за '+days+' сут.</span>';
  html += '</div>';
  if (!hasCurve) {
    html += '<p style="color:var(--text-muted);font-size:13px">Загрузите .tridb для расчёта</p>';
  } else if (inflow.length < 2) {
    html += '<p style="color:var(--text-muted);font-size:13px">Недостаточно пар последовательных замеров уровня за период</p>';
  } else {
    html += '<canvas id="sf-inflow-chart" height="70"></canvas>';
  }
  html += '</div>';

  // ─ Прогноз ───────────────────────────────────────────────────────────────
  if (hasCurve && avgQ !== null) {
    html += _sfForecastPanel(sump, pumps, avgQ, latestLev, currVol, days);
  } else if (hasCurve) {
    html += '<div class="card" style="padding:14px"><div class="card-title">Прогноз</div>';
    html += '<p style="color:var(--text-muted);font-size:13px;margin-top:8px">Прогноз доступен после накопления данных уровней за выбранный период</p></div>';
  }

  // ─ Кривая V(H) ───────────────────────────────────────────────────────────
  if (hasCurve) {
    html += '<div class="card" style="padding:14px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">';
    html += '<span class="card-title">Кривая V(H)</span>';
    html += '<span style="font-size:10px;color:var(--text-muted)">Зависимость объёма воды от отметки дна</span>';
    html += '</div>';
    html += '<canvas id="sf-vh-chart" height="80"></canvas>';
    html += '</div>';
  }

  html += '</div>'; // ═══ конец левой колонки ═══

  // ═══ ПРАВАЯ КОЛОНКА — 3D (sticky, фиксированная высота) ══════════════════
  html += '<div style="position:sticky;top:0;display:flex;flex-direction:column;gap:14px">';
  html += '<div class="card" style="padding:0;overflow:hidden">';
  html += '<div style="padding:10px 14px 6px;display:flex;justify-content:space-between;align-items:baseline">';
  html += '<span class="card-title">3D-модель зумпфа</span>';
  if (latestLev !== null) html += '<span style="font-size:11px;color:#3b82f6;font-weight:600">▲ '+latestLev.toFixed(2)+' м</span>';
  html += '</div>';
  if (hasCurve) {
    // Высота 800px — статичный вид без управления
    html += '<div id="sf-3d-container" style="width:100%;height:800px;background:#0d1117">';
    html += '<p style="color:var(--text-muted);font-size:12px;padding:20px;text-align:center">Загрузка Three.js...</p>';
    html += '</div>';
    html += '<div style="padding:5px 14px;font-size:10px;color:var(--text-muted);text-align:center">ЛКМ — вращение · Колёсико — масштаб · ПКМ — панорама</div>';
  } else {
    html += '<div style="height:300px;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text-muted);font-size:13px">';
    html += '<div style="font-size:40px;margin-bottom:12px;opacity:0.4">◎</div>';
    html += '<div>Загрузите .tridb для отображения 3D</div>';
    html += '</div>';
  }
  html += '</div>';
  html += '</div>'; // конец правой колонки

  html += '</div>'; // конец основной сетки

  document.getElementById('sf-content').innerHTML = html;

  // Рендеринг графиков
  if (lpData.levs.length > 0)   setTimeout(function(){ _sfRenderLevelChart(sump, lpData, days); }, 50);
  if (inflow.length >= 2)        setTimeout(function(){ _sfRenderInflowChart(inflow, days); }, 80);
  if (hasCurve)                  setTimeout(function(){ _sfRenderVhChart(sump.volumeCurve, latestLev); }, 110);
  _sfFcCurrentPumps = pumps;

  // 3D — из памяти или из Storage
  if (hasCurve) {
    var doRender = function(g) { setTimeout(function(){ _sfTryRender3D(g, latestLev); }, 60); };
    if (SumpForecastState._geom) {
      doRender(SumpForecastState._geom);
    } else if (sump.tridbPath && window.Api) {
      Api.downloadSumpTridb(sump.tridbPath).then(function(res){
        if (res.error || !res.data) return; return res.data.arrayBuffer();
      }).then(function(ab){
        if (!ab) return;
        var SQL = window._sfSqlJs; if (!SQL) return;
        var db = new SQL.Database(new Uint8Array(ab));
        try {
          var row = db.exec('SELECT Geometry FROM Geometry LIMIT 1')[0].values[0][0];
          var g = _sfParseGeomBlob(row); db.close();
          if (g.xs && g.tris) {
            SumpForecastState._geom = { xs:g.xs, ys:g.ys, zs:g.zs, tris:g.tris, zMin:sump.zMin, zMax:sump.zMax };
            doRender(SumpForecastState._geom);
          }
        } catch(e){ db.close(); }
      }).catch(function(){});
    }
  }
}

// Форматирование числа с пробелами как разделителями тысяч
function _sfFmt(n, dec) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  dec = dec === undefined ? 0 : dec;
  return n.toFixed(dec).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function _sfModelStats(sump, latestLev, currVol, pct) {
  // Проверка совпадения вычисленного объёма при zMax с паспортным
  var curveMax = sump.volumeCurve && sump.volumeCurve.length
    ? sump.volumeCurve[sump.volumeCurve.length - 1].v : null;
  var verifyOk  = curveMax !== null && sump.totalVolume
    ? Math.abs(curveMax - sump.totalVolume) / sump.totalVolume < 0.10 : null;

  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">';
  html += _sfStat('Полный объём', sump.totalVolume ? _sfFmt(sump.totalVolume) + ' м³' : '—');
  html += _sfStat('Диапазон Z', sump.zMin ? sump.zMin.toFixed(1) + '–' + sump.zMax.toFixed(1) + ' м' : '—');
  if (latestLev !== null) {
    html += _sfStat('Тек. отметка', latestLev.toFixed(2) + ' м');
    html += _sfStat('Объём воды', currVol !== null ? _sfFmt(currVol) + ' м³' : '—');
  }
  html += '</div>';

  // Индикатор точности кривой V(H)
  if (verifyOk !== null) {
    var errPct = curveMax !== null && sump.totalVolume
      ? Math.abs(curveMax - sump.totalVolume) / sump.totalVolume * 100 : null;
    if (!verifyOk) {
      html += '<div style="background:#7f1d1d33;border:1px solid #ef444466;border-radius:6px;padding:6px 10px;font-size:11px;color:#fca5a5;margin-bottom:10px">';
      html += '⚠ Расчётный V(zMax) = <strong>' + _sfFmt(curveMax) + ' м³</strong> отличается от паспортного '
        + _sfFmt(sump.totalVolume) + ' м³ на ' + (errPct ? errPct.toFixed(0) + '%' : '?')
        + '. Возможно, меш содержит дефекты.';
      html += '</div>';
    }
  }

  if (pct !== null && pct <= 110) {
    var color = pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e';
    html += '<div style="margin-bottom:10px">';
    html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:4px">';
    html += '<span>Заполнение</span><span style="font-weight:600;color:' + color + '">' + pct.toFixed(1) + '%</span></div>';
    html += '<div style="background:var(--border-subtle);border-radius:4px;height:10px">';
    html += '<div style="background:' + color + ';border-radius:4px;height:10px;width:' + Math.min(100,pct).toFixed(0) + '%;transition:width 0.4s"></div>';
    html += '</div></div>';
  } else if (pct !== null) {
    // Данные кривой V(H) некорректны — скрываем процент
    html += '<div style="font-size:11px;color:#6b7280;margin-bottom:10px">Заполнение: данные уточняются после пересчёта кривой</div>';
  }
  return html;
}

function _sfStat(label, value) {
  return '<div style="background:var(--bg-sub);border-radius:6px;padding:8px">' +
    '<div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">' + label + '</div>' +
    '<div style="font-size:14px;font-weight:600">' + value + '</div></div>';
}

// ── Калькулятор прогноза ──────────────────────────────────────────────────────
// ── Утилита: форматирование даты/времени в локальное "YYYY-MM-DDTHH:MM" ────────
function _sfDtLocal(d) {
  var pad = function(n){ return n < 10 ? '0'+n : ''+n; };
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
}

// ── Инициализация параметров прогноза ────────────────────────────────────────
function _sfFcInit(pumps) {
  var now = new Date();
  var end = new Date(now.getTime() + 7 * 86400000);
  var pumpQ = {};
  pumps.forEach(function(p){ pumpQ[p.id] = p.q; });
  SumpForecastState._forecastParams = {
    startDt:   _sfDtLocal(now),
    endDt:     _sfDtLocal(end),
    pumpQ:     pumpQ,
    stops:     []
  };
}

function _sfFcSetParam(key, val) {
  if (!SumpForecastState._forecastParams) return;
  SumpForecastState._forecastParams[key] = val;
}

function _sfFcSetPumpQ(pumpId, q) {
  if (!SumpForecastState._forecastParams) return;
  SumpForecastState._forecastParams.pumpQ[pumpId] = parseFloat(q) || 0;
}

function _sfFcAddStop(pumps) {
  var fp = SumpForecastState._forecastParams;
  if (!fp) return;
  var firstPump = pumps && pumps.length ? pumps[0] : null;
  fp.stops.push({ pumpId: firstPump ? firstPump.id : '', startDt: fp.startDt || _sfDtLocal(new Date()), durationH: 8 });
  _sfFcRerenderStops(pumps);
  _sfFcRerenderStepTabs(pumps);
}

function _sfFcRemoveStop(idx, pumps) {
  var fp = SumpForecastState._forecastParams;
  if (!fp) return;
  fp.stops.splice(idx, 1);
  _sfFcRerenderStops(pumps);
  _sfFcRerenderStepTabs(pumps);
}

function _sfFcSetStop(idx, key, val) {
  var fp = SumpForecastState._forecastParams;
  if (!fp || !fp.stops[idx]) return;
  fp.stops[idx][key] = key === 'durationH' ? (parseFloat(val)||0) : val;
}

function _sfFcRerenderStops(pumps) {
  var el = document.getElementById('sf-fc-stops-body');
  if (!el) return;
  el.innerHTML = _sfFcStopsHtmlCompact(SumpForecastState._forecastParams, pumps);
}

function _sfFcRerenderStepTabs(pumps) {
  var el = document.getElementById('sf-fc-step-tabs');
  if (!el) return;
  el.innerHTML = _sfFcStepTabsHtml(SumpForecastState._forecastParams, SumpForecastState._forecastStep || 1, pumps);
}

// Компактный список остановок для сайдбара (каждая остановка — карточка из 2 строк)
function _sfFcStopsHtmlCompact(fp, pumps) {
  if (!fp || !fp.stops.length) {
    return '<div style="color:var(--text-muted);font-size:12px;padding:8px 0;text-align:center;opacity:.6">Нет остановок</div>';
  }
  var inpSt = 'border-radius:4px;background:var(--bg-card);border:1px solid var(--border-subtle);color:var(--text-primary)';
  var h = '';
  fp.stops.forEach(function(s, i) {
    h += '<div style="background:var(--bg-sub);border:1px solid var(--border-subtle);border-radius:5px;padding:7px 8px;margin-bottom:6px">';
    // Строка 1: насос + кнопка удаления
    h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px;gap:6px">';
    h += '<select style="font-size:11px;padding:2px 5px;flex:1;min-width:0;'+inpSt+'" onchange="_sfFcSetStop('+i+',\'pumpId\',this.value)">';
    pumps.forEach(function(p){ h += '<option value="'+p.id+'"'+(s.pumpId===p.id?' selected':'')+'>'+_sfEsc(p.name)+'</option>'; });
    h += '</select>';
    h += '<button onclick="_sfFcRemoveStop('+i+',_sfFcCurrentPumps)" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:15px;line-height:1;padding:0;opacity:.7;flex-shrink:0">×</button>';
    h += '</div>';
    // Строка 2: дата/время + длительность
    h += '<div style="display:flex;align-items:center;gap:4px">';
    h += '<input type="datetime-local" value="'+s.startDt+'" style="font-size:10px;padding:2px 4px;flex:1;min-width:0;'+inpSt+'" onchange="_sfFcSetStop('+i+',\'startDt\',this.value)">';
    h += '<input type="number" value="'+s.durationH+'" min="0.5" max="720" step="0.5" style="width:38px;font-size:11px;padding:2px 4px;text-align:right;'+inpSt+'" onchange="_sfFcSetStop('+i+',\'durationH\',this.value)">';
    h += '<span style="font-size:10px;color:var(--text-muted);flex-shrink:0">ч</span>';
    h += '</div>';
    h += '</div>';
  });
  return h;
}

// ── Табы шагов для сайдбара ───────────────────────────────────────────────────
function _sfFcStepTabsHtml(fp, activeStep, pumps) {
  pumps = pumps || _sfFcCurrentPumps;
  var totalQ = pumps.reduce(function(s,p){ return s+(fp.pumpQ&&fp.pumpQ[p.id]!==undefined?fp.pumpQ[p.id]:p.q); }, 0);
  var summaries = [
    fp.startDt && fp.endDt
      ? fp.startDt.slice(5,10).replace('-','.')+' – '+fp.endDt.slice(5,10).replace('-','.')
      : 'Не задан',
    totalQ.toFixed(0)+' м³/ч суммарно',
    (fp.stops||[]).length ? ((fp.stops.length)+' запланировано') : 'Нет остановок'
  ];
  var titles = ['Период','Насосы','Остановки'];
  var h = '';
  titles.forEach(function(title, i) {
    var n = i + 1;
    var isActive = n === activeStep;
    var isDone   = n < activeStep;
    h += '<div onclick="_sfFcStep('+n+',_sfFcCurrentPumps)" style="display:flex;align-items:center;gap:9px;padding:10px 14px;cursor:pointer;'
       + 'border-left:2px solid '+(isActive?'#3b82f6':'transparent')+';'
       + 'background:'+(isActive?'var(--bg-sub)':'transparent')+';'
       + (i<2?'border-bottom:1px solid var(--border-subtle)':'')+'">';
    // Бейдж
    h += '<span style="width:20px;height:20px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;'
       + 'background:'+(isDone?'#166534':isActive?'#1d4ed8':'var(--bg-sub)')+';'
       + 'border:1px solid '+(isDone?'#22c55e':isActive?'#3b82f6':'var(--border-subtle)')+';'
       + 'color:'+(isDone||isActive?'#fff':'var(--text-muted)')+';">'
       + (isDone?'✓':n)+'</span>';
    h += '<div style="flex:1;min-width:0">';
    h += '<div style="font-size:12px;font-weight:600;color:'+(isActive?'var(--text-primary)':'var(--text-muted)')+'">'+title+'</div>';
    h += '<div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+summaries[i]+'</div>';
    h += '</div>';
    if (isActive) h += '<span style="color:var(--text-muted);font-size:12px">›</span>';
    h += '</div>';
  });
  return h;
}

// ── Содержимое активного шага ─────────────────────────────────────────────────
function _sfFcStepContentHtml(step, fp, pumps) {
  pumps = pumps || _sfFcCurrentPumps;
  var nextBtn = function(n, label) {
    return '<button onclick="_sfFcStep('+n+',_sfFcCurrentPumps)" style="width:100%;padding:6px;border-radius:5px;background:var(--bg-sub);border:1px solid var(--border-subtle);color:var(--text-primary);cursor:pointer;font-size:12px;margin-top:12px">'+label+' →</button>';
  };
  if (step === 1) {
    var h = '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:10px">Период прогноза</div>';
    h += '<label style="font-size:11px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px;margin-bottom:8px">Начало<input type="datetime-local" id="sf-fc-start" value="'+fp.startDt+'" style="margin-top:2px;font-size:12px" onchange="_sfFcSetParam(\'startDt\',this.value)"></label>';
    h += '<label style="font-size:11px;color:var(--text-muted);display:flex;flex-direction:column;gap:3px">Конец<input type="datetime-local" id="sf-fc-end" value="'+fp.endDt+'" style="margin-top:2px;font-size:12px" onchange="_sfFcSetParam(\'endDt\',this.value)"></label>';
    h += nextBtn(2, 'Далее: Насосы');
    return h;
  } else if (step === 2) {
    var h = '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);margin-bottom:10px">Производительность, м³/ч</div>';
    var totalQ = 0;
    pumps.forEach(function(p) {
      var q = fp.pumpQ&&fp.pumpQ[p.id]!==undefined?fp.pumpQ[p.id]:p.q;
      totalQ += q;
      h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">';
      h += '<span style="font-size:12px;display:flex;align-items:center;gap:5px"><span style="color:#22c55e;font-size:10px">●</span>'+_sfEsc(p.name)+'</span>';
      h += '<input type="number" value="'+q.toFixed(0)+'" min="0" step="1" style="width:68px;font-size:12px;padding:3px 6px;text-align:right" onchange="_sfFcSetPumpQ(\''+p.id+'\',this.value)">';
      h += '</div>';
    });
    h += '<div style="font-size:10px;color:var(--text-muted);border-top:1px solid var(--border-subtle);padding:6px 0 0;display:flex;justify-content:space-between">';
    h += '<span>Суммарно</span><b style="color:var(--text-primary);font-variant-numeric:tabular-nums">'+totalQ.toFixed(0)+' м³/ч</b></div>';
    h += nextBtn(3, 'Далее: Остановки');
    return h;
  } else {
    var h = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">';
    h += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)">Плановые остановки</div>';
    h += '<button onclick="_sfFcAddStop(_sfFcCurrentPumps)" style="padding:2px 7px;font-size:10px;border-radius:4px;background:var(--bg-card);border:1px solid var(--border-subtle);color:var(--text-primary);cursor:pointer">+ Добавить</button>';
    h += '</div>';
    h += '<div id="sf-fc-stops-body">'+_sfFcStopsHtmlCompact(fp, pumps)+'</div>';
    return h;
  }
}

// Переключение шага
function _sfFcStep(n, pumps) {
  SumpForecastState._forecastStep = n;
  var fp = SumpForecastState._forecastParams;
  if (!fp) return;
  pumps = pumps || _sfFcCurrentPumps;
  var tabsEl    = document.getElementById('sf-fc-step-tabs');
  var contentEl = document.getElementById('sf-fc-step-content');
  if (tabsEl)    tabsEl.innerHTML    = _sfFcStepTabsHtml(fp, n, pumps);
  if (contentEl) contentEl.innerHTML = _sfFcStepContentHtml(n, fp, pumps);
}

// ── Строка управления масштабом осей ─────────────────────────────────────────
function _sfFcScaleRowHtml() {
  var s = 'width:52px;font-size:11px;padding:2px 4px;border-radius:4px;background:var(--bg-sub);border:1px solid var(--border-subtle);color:var(--text-primary)';
  var sep = '<span style="width:1px;height:16px;background:var(--border-subtle);margin:0 2px;flex-shrink:0"></span>';
  var h = '<div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;padding:6px 12px;background:var(--bg-sub);border-bottom:1px solid var(--border-subtle)">';
  h += '<span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);padding-right:5px;border-right:1px solid var(--border-subtle);margin-right:1px">X</span>';
  h += '<span style="font-size:10px;color:var(--text-muted)">от</span><input type="number" id="sf-fc-xmin" placeholder="0" style="'+s+'" onchange="_sfUpdateFcChartScale()">';
  h += '<span style="font-size:10px;color:var(--text-muted)">до</span><input type="number" id="sf-fc-xmax" placeholder="авто" style="'+s+'" onchange="_sfUpdateFcChartScale()">';
  h += '<span style="font-size:10px;color:var(--text-muted)">меток</span><input type="number" id="sf-fc-xticks" placeholder="8" style="width:38px;font-size:11px;padding:2px 4px;border-radius:4px;background:var(--bg-sub);border:1px solid var(--border-subtle);color:var(--text-primary)" onchange="_sfUpdateFcChartScale()">';
  h += sep;
  h += '<span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#60a5fa;padding-right:5px;border-right:1px solid var(--border-subtle);margin-right:1px">Y</span>';
  h += '<span style="font-size:10px;color:var(--text-muted)">мин</span><input type="number" id="sf-fc-ylmin" step="0.1" placeholder="авто" style="'+s+'" onchange="_sfUpdateFcChartScale()">';
  h += '<span style="font-size:10px;color:var(--text-muted)">макс</span><input type="number" id="sf-fc-ylmax" step="0.1" placeholder="авто" style="'+s+'" onchange="_sfUpdateFcChartScale()">';
  h += '<span style="font-size:10px;color:var(--text-muted)">шаг</span><input type="number" id="sf-fc-ylstep" step="0.1" placeholder="авто" style="'+s+'" onchange="_sfUpdateFcChartScale()">';
  h += sep;
  h += '<span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#22c55e;padding-right:5px;border-right:1px solid var(--border-subtle);margin-right:1px">Y²</span>';
  h += '<span style="font-size:10px;color:var(--text-muted)">мин</span><input type="number" id="sf-fc-yrmin" placeholder="0" style="'+s+'" onchange="_sfUpdateFcChartScale()">';
  h += '<span style="font-size:10px;color:var(--text-muted)">макс</span><input type="number" id="sf-fc-yrmax" placeholder="авто" style="'+s+'" onchange="_sfUpdateFcChartScale()">';
  h += '<span style="font-size:10px;color:var(--text-muted)">шаг</span><input type="number" id="sf-fc-yrstep" placeholder="авто" style="'+s+'" onchange="_sfUpdateFcChartScale()">';
  h += '<button onclick="_sfResetFcChartScale()" style="font-size:10px;padding:2px 8px;border-radius:4px;background:none;border:1px solid var(--border-subtle);color:var(--text-muted);cursor:pointer;margin-left:auto;white-space:nowrap">Авто</button>';
  h += '</div>';
  return h;
}

// ── Карточка "Прогноз" — боковая панель + шаговый ввод ───────────────────────
function _sfForecastPanel(sump, pumps, avgQ, latestLev, currVol, days) {
  var fp = SumpForecastState._forecastParams;
  if (!fp || SumpForecastState._forecastSumpId !== sump.id) {
    _sfFcInit(pumps);
    fp = SumpForecastState._forecastParams;
    SumpForecastState._forecastSumpId = sump.id;
    SumpForecastState._forecastAvgQ   = avgQ;
    SumpForecastState._forecastStep   = 1;
    SumpForecastState._forecastResult = null;
  }
  var step      = SumpForecastState._forecastStep || 1;
  var hasResult = !!(SumpForecastState._forecastResult && SumpForecastState._forecastResult.length);

  var html = '<div class="card" style="padding:0;overflow:hidden" id="sf-forecast-card">';

  // Заголовок карточки
  html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-bottom:1px solid var(--border-subtle)">';
  html += '<span class="card-title">Прогноз · почасовое моделирование</span>';
  html += '<span style="font-size:11px;color:var(--text-muted)">Q<sub>пр</sub> = <b style="color:#60a5fa">'+avgQ.toFixed(1)+'</b> м³/ч · база '+days+' дн.</span>';
  html += '</div>';

  // Двухколоночная сетка
  html += '<div style="display:grid;grid-template-columns:240px 1fr;align-items:stretch;min-height:420px">';

  // ═══ ЛЕВАЯ КОЛОНКА — шаговая навигация ════════════════════════════════════
  html += '<div style="border-right:1px solid var(--border-subtle);display:flex;flex-direction:column">';

  // Табы шагов
  html += '<div id="sf-fc-step-tabs">';
  html += _sfFcStepTabsHtml(fp, step, pumps);
  html += '</div>';

  // Содержимое шага
  html += '<div id="sf-fc-step-content" style="padding:14px;flex:1;overflow-y:auto">';
  html += _sfFcStepContentHtml(step, fp, pumps);
  html += '</div>';

  // Кнопка расчёта
  html += '<div style="padding:10px 12px;border-top:1px solid var(--border-subtle)">';
  html += '<button onclick="_sfRunForecast()" class="btn btn-primary" style="width:100%;justify-content:center;padding:8px 12px;font-size:13px;font-weight:600">▶ Рассчитать прогноз</button>';
  html += '</div>';

  html += '</div>'; // конец левой колонки

  // ═══ ПРАВАЯ КОЛОНКА — масштаб + график ════════════════════════════════════
  html += '<div style="display:flex;flex-direction:column;min-height:0">';

  // Строка управления масштабом (всегда видна)
  html += _sfFcScaleRowHtml();

  // Область графика — flex:1 чтобы занять всё свободное пространство
  html += '<div id="sf-fc-chart-area" style="flex:1;min-height:0;padding:10px 14px 0;display:flex;flex-direction:column">';
  if (hasResult) {
    html += '<div style="position:relative;flex:1;min-height:0"><canvas id="sf-fc-chart" style="position:absolute;top:0;left:0;width:100%;height:100%"></canvas></div>';
  } else {
    html += '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:200px;color:var(--text-muted);font-size:12px;text-align:center;gap:10px">';
    html += '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity=".2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';
    html += '<div>Настройте параметры слева<br>и нажмите <b>▶ Рассчитать прогноз</b></div>';
    html += '</div>';
  }
  html += '</div>';

  // Легенда
  html += '<div style="display:flex;gap:14px;padding:6px 16px 8px;align-items:center;border-top:1px solid var(--border-subtle);flex-wrap:wrap">';
  html += '<span style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--text-muted)"><span style="width:20px;height:2px;background:#60a5fa;display:inline-block;border-radius:2px"></span>Уровень, м</span>';
  html += '<span style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--text-muted)"><span style="width:20px;height:2px;background:#22c55e;display:inline-block"></span>Откачка, м³/ч</span>';
  if (sump.criticalLevel) html += '<span style="display:flex;align-items:center;gap:5px;font-size:10px;color:#ef4444"><span style="width:16px;height:0;border-top:1.5px dashed #ef4444;display:inline-block"></span>Крит. '+sump.criticalLevel.toFixed(1)+' м</span>';
  html += '<span style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--text-muted)"><span style="width:12px;height:10px;background:rgba(251,146,60,0.1);border:1px solid rgba(251,146,60,0.5);display:inline-block;border-radius:2px"></span>Остановка</span>';
  html += '</div>';

  // Итоги прогноза
  html += '<div id="sf-fc-summary"></div>';

  html += '</div>'; // конец правой колонки
  html += '</div>'; // конец сетки
  html += '</div>'; // конец карточки
  return html;
}

// ── Моделирование прогноза (почасовое) ───────────────────────────────────────
function _sfSimulateForecast(sump, pumps, avgQin, H0) {
  var fp = SumpForecastState._forecastParams;
  if (!fp) return [];
  var startMs = new Date(fp.startDt).getTime();
  var endMs   = new Date(fp.endDt).getTime();
  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return [];

  var V0 = _sfVolumeAt(sump.volumeCurve, H0 !== null ? H0 : sump.zMin);
  var totalVol = sump.totalVolume || (sump.volumeCurve[sump.volumeCurve.length-1].v);
  var V = V0 !== null ? V0 : 0;
  var H = H0 !== null ? H0 : sump.zMin;

  var result = [];
  var step = 3600000; // 1 час в мс

  for (var t = startMs; t <= endMs; t += step) {
    // Суммарная откачка на этот час (с учётом остановок)
    var Qpump = 0;
    pumps.forEach(function(p) {
      var pq = (fp.pumpQ[p.id] !== undefined ? fp.pumpQ[p.id] : p.q);
      var stopped = fp.stops.some(function(s) {
        if (s.pumpId !== p.id) return false;
        var sStart = new Date(s.startDt).getTime();
        var sEnd   = sStart + s.durationH * 3600000;
        return t >= sStart && t < sEnd;
      });
      if (!stopped) Qpump += pq;
    });

    result.push({ t: t, H: H, V: V, Qpump: Qpump });

    // Шаг: dV = (Q_приток - Q_насосы) * 1ч
    var dV = (avgQin - Qpump) * 1;
    V = Math.min(Math.max(V + dV, 0), totalVol);
    H = _sfLevelAt(sump.volumeCurve, V) !== null ? _sfLevelAt(sump.volumeCurve, V) : H;
  }
  return result;
}

// ── Запуск расчёта прогноза ───────────────────────────────────────────────────
function _sfRunForecast() {
  var fp = SumpForecastState._forecastParams;
  if (!fp) return;
  // Читаем актуальные значения полей даты
  var startEl = document.getElementById('sf-fc-start');
  var endEl   = document.getElementById('sf-fc-end');
  if (startEl) fp.startDt = startEl.value;
  if (endEl)   fp.endDt   = endEl.value;

  var sumps = DewateringState.sumps;
  var sump  = sumps.find(function(s){ return s.id === SumpForecastState._forecastSumpId; });
  if (!sump || !sump.volumeCurve) return;

  var avgQ   = SumpForecastState._forecastAvgQ;
  var latLev = _sfLatestLevel(sump);
  if (avgQ === null || avgQ === undefined) { alert('Нет данных о притоке'); return; }

  var days = SumpForecastState.analysisDays || 30;
  var pumps = _sfPumpPerformance(sump, days);

  var result = _sfSimulateForecast(sump, pumps, avgQ, latLev);
  SumpForecastState._forecastResult = result;

  // Сохраняем контекст для перерисовки при изменении масштаба
  SumpForecastState._forecastRenderCtx = { result: result, sump: sump, avgQ: avgQ, pumps: pumps, latLev: latLev };

  var areaEl = document.getElementById('sf-fc-chart-area');
  if (!areaEl) return;
  if (!result.length) {
    areaEl.innerHTML = '<p style="color:#ef4444;font-size:12px;padding:20px">Проверьте даты прогноза</p>';
    return;
  }
  areaEl.innerHTML = '<div style="position:relative;flex:1;min-height:200px"><canvas id="sf-fc-chart" style="position:absolute;inset:0;width:100%;height:100%"></canvas></div>';
  setTimeout(function(){
    _sfRenderForecastChart(result, sump, avgQ, pumps);
    _sfRenderForecastSummary(result, sump, avgQ, latLev);
  }, 30);
}

// ── График прогноза ───────────────────────────────────────────────────────────
function _sfRenderForecastChart(result, sump, avgQ, pumps) {
  var el = document.getElementById('sf-fc-chart');
  if (!el || typeof Chart === 'undefined') return;
  if (SumpForecastState._forecastChartInst) { SumpForecastState._forecastChartInst.destroy(); }

  var fp = SumpForecastState._forecastParams;
  var labels    = result.map(function(r){ var d=new Date(r.t); return (d.getMonth()+1)+'/'+d.getDate()+' '+('0'+d.getHours()).slice(-2)+':00'; });
  var levelData = result.map(function(r){ return r.H; });
  var pumpData  = result.map(function(r){ return r.Qpump; });
  var volData   = result.map(function(r){ return r.V; });

  // Аннотации: остановки насосов + критический уровень
  var annotations = {};
  if (sump.criticalLevel) {
    annotations.crit = {
      type:'line', yScaleID:'yLevel',
      yMin:sump.criticalLevel, yMax:sump.criticalLevel,
      borderColor:'#ef4444', borderWidth:1.5, borderDash:[5,4],
      label:{ content:'Крит. '+sump.criticalLevel.toFixed(1)+' м', display:true, position:'start', font:{size:9}, color:'#ef4444', backgroundColor:'transparent' }
    };
  }
  if (fp && fp.stops) {
    fp.stops.forEach(function(s, i) {
      var sMs = new Date(s.startDt).getTime();
      var eMs = sMs + s.durationH * 3600000;
      var sIdx = result.findIndex(function(r){ return r.t >= sMs; });
      var eIdx = result.findIndex(function(r){ return r.t >= eMs; });
      if (sIdx < 0) sIdx = 0;
      if (eIdx < 0) eIdx = result.length - 1;
      var pumpName = pumps ? (pumps.find(function(p){return p.id===s.pumpId;})||{name:s.pumpId}).name : s.pumpId;
      annotations['stop_s'+i] = {
        type:'line', xScaleID:'x',
        xMin:sIdx, xMax:sIdx,
        borderColor:'rgba(251,146,60,0.7)', borderWidth:1.5, borderDash:[4,3],
        label:{ content:'Стоп '+_sfEsc(pumpName), display:true, position:'start', font:{size:9}, color:'#f97316', backgroundColor:'rgba(0,0,0,0.5)' }
      };
      annotations['stop_e'+i] = {
        type:'line', xScaleID:'x',
        xMin:eIdx, xMax:eIdx,
        borderColor:'rgba(251,146,60,0.4)', borderWidth:1, borderDash:[2,4]
      };
      annotations['stop_box'+i] = {
        type:'box', xScaleID:'x',
        xMin:sIdx, xMax:eIdx,
        backgroundColor:'rgba(251,146,60,0.07)', borderWidth:0
      };
    });
  }

  SumpForecastState._forecastChartInst = new Chart(el, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Уровень, м',
          data: levelData,
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96,165,250,0.08)',
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: false,
          yAxisID: 'yLevel',
          order: 1
        },
        {
          label: 'Откачка насосов, м³/ч',
          data: pumpData,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34,197,94,0.10)',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0,
          fill: true,
          yAxisID: 'yPump',
          order: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode:'index', intersect:false },
      plugins: {
        legend: { display: true, labels: { boxWidth: 12, font: { size: 10 } } },
        annotation: annotations,
        tooltip: {
          callbacks: {
            label: function(ctx) {
              var r = result[ctx.dataIndex];
              if (ctx.datasetIndex === 0) return 'Уровень: '+ctx.parsed.y.toFixed(2)+' м  |  Объём: '+_sfFmt(r.V)+' м³';
              return 'Откачка: '+ctx.parsed.y.toFixed(0)+' м³/ч  |  Приток: '+avgQ.toFixed(1)+' м³/ч';
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 12, font: { size: 9 }, maxRotation: 0 }
        },
        yLevel: {
          type: 'linear', position: 'left',
          title: { display: true, text: 'Уровень, м', font: { size: 9 } },
          ticks: { font: { size: 9 } }
        },
        yPump: {
          type: 'linear', position: 'right', grid: { drawOnChartArea: false },
          title: { display: true, text: 'Откачка, м³/ч', font: { size: 9 } },
          ticks: { font: { size: 9 } },
          min: 0
        }
      }
    }
  });
}

// ── Итоговые показатели прогноза ──────────────────────────────────────────────
function _sfRenderForecastSummary(result, sump, avgQ, H0) {
  var el = document.getElementById('sf-fc-summary');
  if (!el || !result.length) return;

  var Hstart = result[0].H;
  var Hend   = result[result.length-1].H;
  var Hmin   = result.reduce(function(m,r){ return Math.min(m,r.H); }, Hstart);
  var Hmax   = result.reduce(function(m,r){ return Math.max(m,r.H); }, Hstart);
  var totalHours = result.length;
  var totalPumped = result.reduce(function(s,r){ return s + r.Qpump; }, 0);

  // Момент достижения критического уровня
  var critHit = null;
  if (sump.criticalLevel) {
    var cr = result.find(function(r){ return r.H >= sump.criticalLevel; });
    if (cr) critHit = new Date(cr.t);
  }

  var html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:8px">';
  html += _sfStat('Уровень начало', Hstart.toFixed(2)+' м');
  html += _sfStat('Уровень конец', Hend.toFixed(2)+' м');
  html += _sfStat('Изменение уровня', (Hend-Hstart>=0?'+':'')+(Hend-Hstart).toFixed(2)+' м');
  html += _sfStat('Мин. уровень', Hmin.toFixed(2)+' м');
  html += _sfStat('Макс. уровень', Hmax.toFixed(2)+' м');
  html += _sfStat('Откачано всего', _sfFmt(totalPumped)+' м³');
  html += '</div>';

  if (critHit) {
    html += '<div style="background:#7f1d1d;border:1px solid #ef4444;border-radius:6px;padding:8px 12px;font-size:12px">';
    html += '⚠ Критический уровень '+sump.criticalLevel.toFixed(1)+' м будет достигнут: <strong>'+critHit.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})+'</strong>';
    html += '</div>';
  } else if (sump.criticalLevel) {
    html += '<div style="background:#14532d;border:1px solid #22c55e;border-radius:6px;padding:8px 12px;font-size:12px">';
    html += '✓ Критический уровень ('+sump.criticalLevel.toFixed(1)+' м) не будет достигнут в период прогноза';
    html += '</div>';
  }
}

// ── Управление масштабом осей графика прогноза ────────────────────────────────
function _sfUpdateFcChartScale() {
  var inst = SumpForecastState._forecastChartInst;
  if (!inst) return;

  function num(id) {
    var el = document.getElementById(id);
    if (!el || el.value === '') return undefined;
    var v = parseFloat(el.value);
    return isNaN(v) ? undefined : v;
  }
  function posInt(id, def) {
    var el = document.getElementById(id);
    if (!el || el.value === '') return def;
    var v = parseInt(el.value, 10);
    return isNaN(v) || v < 1 ? def : v;
  }

  var ctx = SumpForecastState._forecastRenderCtx;
  var totalPts = ctx ? ctx.result.length : 0;

  // Ось X: min/max задаются как смещение в часах от начала (индекс точки)
  var xMinH = num('sf-fc-xmin');
  var xMaxH = num('sf-fc-xmax');
  inst.options.scales.x.min = xMinH !== undefined ? Math.max(0, Math.round(xMinH)) : undefined;
  inst.options.scales.x.max = xMaxH !== undefined ? Math.min(totalPts - 1, Math.round(xMaxH)) : undefined;
  inst.options.scales.x.ticks.maxTicksLimit = posInt('sf-fc-xticks', 12);

  // Ось Y — уровень (левая)
  inst.options.scales.yLevel.min  = num('sf-fc-ylmin');
  inst.options.scales.yLevel.max  = num('sf-fc-ylmax');
  var ylStep = num('sf-fc-ylstep');
  inst.options.scales.yLevel.ticks.stepSize = ylStep !== undefined ? ylStep : undefined;

  // Ось Y² — откачка (правая)
  inst.options.scales.yPump.min  = num('sf-fc-yrmin') !== undefined ? num('sf-fc-yrmin') : 0;
  inst.options.scales.yPump.max  = num('sf-fc-yrmax');
  var yrStep = num('sf-fc-yrstep');
  inst.options.scales.yPump.ticks.stepSize = yrStep !== undefined ? yrStep : undefined;

  inst.update();
}

function _sfResetFcChartScale() {
  ['sf-fc-xmin','sf-fc-xmax','sf-fc-xticks','sf-fc-ylmin','sf-fc-ylmax','sf-fc-ylstep','sf-fc-yrmin','sf-fc-yrmax','sf-fc-yrstep'].forEach(function(id){
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  _sfUpdateFcChartScale();
}

// Глобальная переменная — список насосов для callback остановок
var _sfFcCurrentPumps = [];

// ── Управление масштабом оси Y на графике истории уровня ─────────────────────
function _sfSetLevelYScale() {
  var inst = SumpForecastState._levelChartInst;
  if (!inst) return;
  var minEl = document.getElementById('sf-level-ymin');
  var maxEl = document.getElementById('sf-level-ymax');
  var minVal = minEl && minEl.value !== '' ? parseFloat(minEl.value) : undefined;
  var maxVal = maxEl && maxEl.value !== '' ? parseFloat(maxEl.value) : undefined;
  inst.options.scales.yLevel.min = isNaN(minVal) ? undefined : minVal;
  inst.options.scales.yLevel.max = isNaN(maxVal) ? undefined : maxVal;
  inst.update();
}

function _sfSetLevelYScaleReset() {
  var minEl = document.getElementById('sf-level-ymin');
  var maxEl = document.getElementById('sf-level-ymax');
  if (minEl) minEl.value = '';
  if (maxEl) maxEl.value = '';
  _sfSetLevelYScale();
}

// ── 3D-рендер каркаса зумпфа ─────────────────────────────────────────────────
function _sfDestroy3D() {
  var t = SumpForecastState._three;
  if (!t) return;
  if (t.animId) cancelAnimationFrame(t.animId);
  if (t.renderer) { t.renderer.dispose(); t.renderer.domElement.remove(); }
  SumpForecastState._three = null;
}

function _sfInit3D(geom, currentLevel) {
  _sfDestroy3D();
  var container = document.getElementById('sf-3d-container');
  if (!container || !window.THREE) return;

  var W = container.clientWidth || 480, H3 = container.clientHeight || 800;

  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H3);
  renderer.setClearColor(0x0d1117, 1);
  container.innerHTML = '';
  container.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  var dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(1, 2, 3);
  scene.add(dirLight);

  // Вычисляем центр и масштаб модели
  var xs = geom.xs, ys = geom.ys, zs = geom.zs, tris = geom.tris;
  var xMin=xs[0],xMax=xs[0],yMin=ys[0],yMax=ys[0];
  for (var i=1;i<xs.length;i++){
    if(xs[i]<xMin)xMin=xs[i]; if(xs[i]>xMax)xMax=xs[i];
    if(ys[i]<yMin)yMin=ys[i]; if(ys[i]>yMax)yMax=ys[i];
  }
  var cx=(xMin+xMax)/2, cy=(yMin+yMax)/2, cz=(geom.zMin+geom.zMax)/2;
  var span = Math.max(xMax-xMin, yMax-yMin, geom.zMax-geom.zMin) || 1;
  var scale = 80 / span; // нормируем в куб ~80 ед.

  // Каркас — маппинг осей: Mining X→Three X, Mining Y→Three -Z, Mining Z(высота)→Three Y
  var positions = new Float32Array(tris.length * 9);
  for (var j=0;j<tris.length;j++) {
    var t=tris[j];
    positions[j*9+0]= (xs[t[0]]-cx)*scale; positions[j*9+1]= (zs[t[0]]-cz)*scale; positions[j*9+2]=-(ys[t[0]]-cy)*scale;
    positions[j*9+3]= (xs[t[1]]-cx)*scale; positions[j*9+4]= (zs[t[1]]-cz)*scale; positions[j*9+5]=-(ys[t[1]]-cy)*scale;
    positions[j*9+6]= (xs[t[2]]-cx)*scale; positions[j*9+7]= (zs[t[2]]-cz)*scale; positions[j*9+8]=-(ys[t[2]]-cy)*scale;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();

  // Сплошная поверхность (полупрозрачная серая)
  var solidMat = new THREE.MeshPhongMaterial({
    color: 0x6b7280, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false
  });
  scene.add(new THREE.Mesh(geo, solidMat));

  // Рёбра каркаса
  var edgeMat = new THREE.LineBasicMaterial({ color: 0x9ca3af, transparent: true, opacity: 0.6 });
  scene.add(new THREE.LineSegments(new THREE.WireframeGeometry(geo), edgeMat));

  // Плоскость воды
  var waterSize = span * scale * 1.2;
  var waterGeo = new THREE.PlaneGeometry(waterSize, waterSize);
  var waterMat = new THREE.MeshPhongMaterial({
    color: 0x3b82f6, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false
  });
  var waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.rotation.x = -Math.PI / 2;
  var wz = currentLevel !== null ? (currentLevel - cz) * scale : (geom.zMin - cz) * scale;
  waterMesh.position.y = wz;
  scene.add(waterMesh);

  // Изометрическая камера — горизонтальный вид сверху-спереди
  var camera = new THREE.PerspectiveCamera(40, W / H3, 0.1, 2000);
  var d = span * scale;
  camera.position.set(d * 0.8, d * 0.9, d * 1.1);
  camera.lookAt(0, 0, 0);

  // Управление вращением/масштабом
  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 10;
  controls.maxDistance = 500;

  function animate() {
    var id = requestAnimationFrame(animate);
    SumpForecastState._three.animId = id;
    controls.update();
    renderer.render(scene, camera);
  }

  SumpForecastState._three = { renderer: renderer, scene: scene, camera: camera, controls: controls, waterMesh: waterMesh, cz: cz, scale: scale, animId: null };
  animate();

  // При изменении размеров контейнера обновляем проекцию
  var ro = new ResizeObserver(function() {
    if (!SumpForecastState._three) return;
    var nw = container.clientWidth, nh = container.clientHeight || nw;
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh);
  });
  ro.observe(container);
}

function _sfUpdate3DWaterLevel(level) {
  var t = SumpForecastState._three;
  if (!t || !t.waterMesh) return;
  t.waterMesh.position.y = (level - t.cz) * t.scale;
}

async function _sfTryRender3D(geom, currentLevel) {
  try {
    await _sfLoadThree();
    _sfInit3D(geom, currentLevel);
  } catch(e) {
    console.warn('[sf] 3D рендер недоступен:', e.message);
    var c = document.getElementById('sf-3d-container');
    if (c) c.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:12px">3D-просмотр недоступен</p>';
  }
}

// ── Графики ───────────────────────────────────────────────────────────────────

// График: уровень воды + объём откачки + маркеры остановок насосов
function _sfRenderLevelChart(sump, lpData, days) {
  var el = document.getElementById('sf-level-chart');
  if (!el || typeof Chart === 'undefined') return;
  if (SumpForecastState._levelChartInst) { SumpForecastState._levelChartInst.destroy(); }

  var levs = lpData.levs;
  var pumpsByDate = lpData.pumpsByDate;

  // Средний уровень воды по дням — агрегируем к категорийной оси дат
  var levelByDate = {};
  levs.forEach(function(l) {
    if (!levelByDate[l.date]) levelByDate[l.date] = [];
    levelByDate[l.date].push(parseFloat(l.elevation));
  });

  // Объём откачки по датам (столбцы)
  var allDates = lpData.allDates;
  var volLabels = allDates;
  var volData   = allDates.map(function(d){ return (pumpsByDate[d] ? pumpsByDate[d].vol : 0); });

  // Данные уровня совпадают с категорийными метками (date-строки)
  var levelData = allDates.map(function(d) {
    if (!levelByDate[d] || !levelByDate[d].length) return null;
    return levelByDate[d].reduce(function(s,v){ return s+v; },0) / levelByDate[d].length;
  });

  // Даты, когда насосы стояли (нет откачки, но есть данные уровня)
  var stoppedDates = allDates.filter(function(d){
    return (!pumpsByDate[d] || pumpsByDate[d].vol === 0) && levs.some(function(l){ return l.date === d; });
  });

  // Аннотации
  var annotations = {};
  if (sump.criticalLevel) {
    annotations.crit = {
      type: 'line', yScaleID: 'yLevel',
      yMin: sump.criticalLevel, yMax: sump.criticalLevel,
      borderColor: '#ef4444', borderWidth: 1.5, borderDash: [5,4],
      label: { content: 'Крит. ' + sump.criticalLevel.toFixed(1) + ' м', display: true, position: 'start', font: { size: 9 }, color: '#ef4444', backgroundColor: 'transparent' }
    };
  }
  stoppedDates.forEach(function(d, i) {
    annotations['stop'+i] = {
      type: 'line', xScaleID: 'x',
      xMin: d, xMax: d,
      borderColor: 'rgba(251,146,60,0.5)', borderWidth: 1, borderDash: [3,3],
      label: { content: 'Стоп', display: stoppedDates.length <= 10, position: 'start', font: { size: 8 }, color: '#f97316', backgroundColor: 'transparent' }
    };
  });

  SumpForecastState._levelChartInst = new Chart(el, {
    type: 'bar',
    data: {
      labels: volLabels,
      datasets: [
        {
          type: 'line',
          label: 'Уровень, м',
          data: levelData,
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96,165,250,0.08)',
          borderWidth: 2,
          pointRadius: levelData.filter(function(v){return v!==null;}).length <= 60 ? 3 : 0,
          pointBackgroundColor: '#60a5fa',
          tension: 0.3,
          fill: false,
          yAxisID: 'yLevel',
          xAxisID: 'x',
          order: 1,
          spanGaps: true
        },
        {
          type: 'bar',
          label: 'Откачка, м³/сут',
          data: volData,
          backgroundColor: 'rgba(34,197,94,0.35)',
          borderColor: 'rgba(34,197,94,0.6)',
          borderWidth: 1,
          borderRadius: 2,
          yAxisID: 'yVol',
          xAxisID: 'x',
          order: 2
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: true, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        annotation: annotations,
        tooltip: {
          callbacks: {
            label: function(ctx) {
              if (ctx.datasetIndex === 0) return 'Уровень: ' + ctx.parsed.y.toFixed(2) + ' м';
              return 'Откачка: ' + ctx.parsed.y.toFixed(0) + ' м³';
            }
          }
        }
      },
      scales: {
        x: {
          type: 'category',
          ticks: { maxTicksLimit: 12, font: { size: 9 }, maxRotation: 0 }
        },
        yLevel: {
          type: 'linear', position: 'left',
          title: { display: true, text: 'Уровень, м', font: { size: 9 } },
          ticks: { font: { size: 9 } }
        },
        yVol: {
          type: 'linear', position: 'right', grid: { drawOnChartArea: false },
          title: { display: true, text: 'Откачка, м³/сут', font: { size: 9 } },
          ticks: { font: { size: 9 } }
        }
      }
    }
  });
}

function _sfRenderInflowChart(inflow, days) {
  var el = document.getElementById('sf-inflow-chart');
  if (!el || typeof Chart === 'undefined') return;
  if (SumpForecastState._inflowChartInst) { SumpForecastState._inflowChartInst.destroy(); }
  var show = inflow.slice(-(days||30));
  var labels = show.map(function(r){ return r.date.slice(5); });
  var vals   = show.map(function(r){ return r.q; });
  SumpForecastState._inflowChartInst = new Chart(el, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{ label: 'Приток м³/ч', data: vals,
        backgroundColor: 'rgba(96,165,250,0.5)', borderColor: '#60a5fa', borderWidth: 1, borderRadius: 3 }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: function(c){ return c.parsed.y.toFixed(1) + ' м³/ч'; } } } },
      scales: {
        x: { ticks: { maxTicksLimit: 10, font: { size: 10 } } },
        y: { ticks: { font: { size: 10 } }, title: { display: true, text: 'м³/ч', font: { size: 10 } } }
      }
    }
  });
}

function _sfRenderVhChart(curve, currentLevel) {
  var el = document.getElementById('sf-vh-chart');
  if (!el || typeof Chart === 'undefined') return;
  if (SumpForecastState._vhChartInst) { SumpForecastState._vhChartInst.destroy(); }
  var annotations = {};
  if (currentLevel !== null) {
    annotations.currentLine = {
      type: 'line', yMin: currentLevel, yMax: currentLevel,
      borderColor: '#f59e0b', borderWidth: 1.5, borderDash: [4,3],
      label: { content: 'Тек. ' + currentLevel.toFixed(1) + ' м', display: true, position: 'end', font: { size: 10 }, color: '#f59e0b', backgroundColor: 'transparent' }
    };
  }
  SumpForecastState._vhChartInst = new Chart(el, {
    type: 'line',
    data: {
      datasets: [{
        label: 'V(H)',
        data: curve.map(function(p){ return { x: p.v, y: p.h }; }),
        borderColor: '#818cf8', backgroundColor: 'rgba(129,140,248,0.1)', fill: true,
        borderWidth: 2, pointRadius: 0, tension: 0.3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: true,
      plugins: { legend: { display: false },
        annotation: annotations,
        tooltip: { callbacks: { label: function(c){ return 'V=' + c.parsed.x.toFixed(0) + ' м³  H=' + c.parsed.y.toFixed(1) + ' м'; } } }
      },
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Объём, м³', font: { size: 10 } }, ticks: { font: { size: 10 } } },
        y: { title: { display: true, text: 'Отметка, м', font: { size: 10 } }, ticks: { font: { size: 10 } } }
      }
    }
  });
}

// ── Вспомогательные ───────────────────────────────────────────────────────────
function _sfLatestLevel(sump) {
  var levs = DewateringState.waterLevels.filter(function(l){ return l.sumpId === sump.id; });
  if (levs.length === 0) return null;
  levs.sort(function(a,b){ return (b.date+b.time).localeCompare(a.date+a.time); });
  return parseFloat(levs[0].elevation) || null;
}

function _sfOnFileInput(event, sumpId) {
  var file = event.target.files[0];
  if (!file) return;
  var sump = DewateringState.sumps.find(function(s){ return s.id === sumpId; });
  if (sump) _sfHandleTridbUpload(file, sump);
}

function _sfSaveCritical(sumpId, val) {
  var sump = DewateringState.sumps.find(function(s){ return s.id === sumpId; });
  if (!sump) return;
  sump.criticalLevel = parseFloat(val) || null;
  DewateringState.save();
  Api.upsertDewSump({
    id: sump.id, name: sump.name, quarry: sump.quarry, notes: sump.notes,
    critical_level: sump.criticalLevel, volume_curve: sump.volumeCurve,
    total_volume: sump.totalVolume, z_min: sump.zMin, z_max: sump.zMax, tridb_path: sump.tridbPath||null
  }).catch(function(){});
}

function _sfEsc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
