// ── Прогноз зумпфов ─────────────────────────────────────────────────────────

var SumpForecastState = {
  selectedSumpId:   null,
  analysisDays:     30,
  _inflowChartInst: null,
  _vhChartInst:     null,
  _levelChartInst:  null,
  _geom:            null,
  _three:           null,
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

// ── V(H) кривая — метод знаковых тетраэдров с обрезкой по горизонту ─────────
function _sfSignedTet(x0,y0,z0, x1,y1,z1, x2,y2,z2) {
  return (x0*(y1*z2-y2*z1) - x1*(y0*z2-y2*z0) + x2*(y0*z1-y1*z0)) / 6;
}

function _sfClipTriVol(x0,y0,z0, x1,y1,z1, x2,y2,z2, H) {
  var b0=z0<=H, b1=z1<=H, b2=z2<=H;
  var n = (b0?1:0)+(b1?1:0)+(b2?1:0);
  if (n===0) return 0;
  if (n===3) return _sfSignedTet(x0,y0,z0,x1,y1,z1,x2,y2,z2);

  function lerp(xa,ya,za,xb,yb,zb) {
    var t=(H-za)/(zb-za);
    return [xa+t*(xb-xa), ya+t*(yb-ya), H];
  }

  if (n===1) {
    var p,a,b;
    if(b0){p=[x0,y0,z0];a=[x1,y1,z1];b=[x2,y2,z2];}
    else if(b1){p=[x1,y1,z1];a=[x0,y0,z0];b=[x2,y2,z2];}
    else{p=[x2,y2,z2];a=[x0,y0,z0];b=[x1,y1,z1];}
    var pa=lerp(p[0],p[1],p[2],a[0],a[1],a[2]);
    var pb=lerp(p[0],p[1],p[2],b[0],b[1],b[2]);
    return _sfSignedTet(p[0],p[1],p[2],pa[0],pa[1],pa[2],pb[0],pb[1],pb[2]);
  }

  // n===2: two below, one above
  var ab,bb,cb;
  if(!b0){ab=[x0,y0,z0];bb=[x1,y1,z1];cb=[x2,y2,z2];}
  else if(!b1){ab=[x1,y1,z1];bb=[x0,y0,z0];cb=[x2,y2,z2];}
  else{ab=[x2,y2,z2];bb=[x0,y0,z0];cb=[x1,y1,z1];}
  var pab=lerp(bb[0],bb[1],bb[2],ab[0],ab[1],ab[2]);
  var pac=lerp(cb[0],cb[1],cb[2],ab[0],ab[1],ab[2]);
  return _sfSignedTet(bb[0],bb[1],bb[2],cb[0],cb[1],cb[2],pac[0],pac[1],pac[2]) +
         _sfSignedTet(bb[0],bb[1],bb[2],pac[0],pac[1],pac[2],pab[0],pab[1],pab[2]);
}

function _sfBuildVolumeCurve(xs, ys, zs, tris, zMin, zMax) {
  // Переносим X, Y и Z в локальную систему координат для численной стабильности.
  // Абсолютные координаты X~46000, Y~16000, Z~167 дают огромные тетраэдры от начала
  // до плоскости обрезки: при неполной сетке (обрезка) они не компенсируются.
  var xOff = xs[0], yOff = ys[0], zOff = zMin;
  for (var k = 1; k < xs.length; k++) {
    if (xs[k] < xOff) xOff = xs[k];
    if (ys[k] < yOff) yOff = ys[k];
  }
  var lxs = xs.map(function(v){ return v - xOff; });
  var lys = ys.map(function(v){ return v - yOff; });
  var lzs = zs.map(function(v){ return v - zOff; });

  var step = 0.1, curve = [];
  for (var H = zMin; H <= zMax + step*0.01; H += step) {
    H = Math.round(H * 10) / 10;
    var lH = H - zOff; // уровень обрезки в локальных координатах
    var vol = 0;
    for (var i = 0; i < tris.length; i++) {
      var t = tris[i];
      vol += _sfClipTriVol(lxs[t[0]],lys[t[0]],lzs[t[0]], lxs[t[1]],lys[t[1]],lzs[t[1]], lxs[t[2]],lys[t[2]],lzs[t[2]], lH);
    }
    curve.push({ h: H, v: Math.abs(vol) });
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

    // Верификация: V при zMax должен быть близок к totalVol
    var computedMax = curve[curve.length-1].v;
    var err = Math.abs(computedMax - totalVol) / totalVol;
    if (err > 0.05) {
      console.warn('[sf] V(zMax)=', computedMax.toFixed(0), '≠ totalVol=', totalVol.toFixed(0), 'err=', (err*100).toFixed(1)+'%');
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
  ['_inflowChartInst','_vhChartInst','_levelChartInst'].forEach(function(k){
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
  if (pct !== null) {
    var pc = pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e';
    html += '<span style="font-size:12px">Заполнение: <strong style="color:'+pc+'">' + pct.toFixed(1) + '%</strong></span>';
  }
  if (avgQ !== null) html += '<span style="font-size:12px">Приток Q: <strong style="color:#60a5fa">' + avgQ.toFixed(1) + ' м³/ч</strong></span>';
  html += '</div></div>';

  // ── ОСНОВНАЯ СЕТКА: левая (инфо) + правая (3D) ────────────────────────────
  html += '<div style="display:grid;grid-template-columns:1fr 400px;gap:16px;align-items:start">';

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
      var on = p.status === 'on';
      var badge = '<span style="background:'+(on?'#16a34a':'#374151')+';color:'+(on?'#fff':'#9ca3af')+';border-radius:3px;padding:1px 4px;font-size:9px">'+(on?'ON':'OFF')+'</span>';
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
  html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">';
  html += '<span class="card-title">История уровня и водоотлива</span>';
  html += '<span style="font-size:11px;color:var(--text-muted)">за '+days+' дн.</span>';
  html += '</div>';
  if (lpData.levs.length === 0) {
    html += '<p style="color:var(--text-muted);font-size:13px">Нет данных об уровне за выбранный период</p>';
  } else {
    html += '<canvas id="sf-level-chart" height="120"></canvas>';
    // Пояснение к графику
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
    html += _sfForecastCalc(sump, pumps, avgQ, latestLev, currVol, days);
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
    // Высота = 400px фиксированная, ширина 100% — без растяжения
    html += '<div id="sf-3d-container" style="width:100%;height:400px;background:#0d1117">';
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
  if (hasCurve && avgQ !== null) setTimeout(function(){ _sfUpdateForecastResult(sump, pumps, avgQ, latestLev, currVol); }, 140);

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

function _sfModelStats(sump, latestLev, currVol, pct) {
  var html = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">';
  html += _sfStat('Полный объём', sump.totalVolume ? sump.totalVolume.toFixed(0) + ' м³' : '—');
  html += _sfStat('Диапазон Z', sump.zMin ? sump.zMin.toFixed(1) + '–' + sump.zMax.toFixed(1) + ' м' : '—');
  if (latestLev !== null) {
    html += _sfStat('Тек. отметка', latestLev.toFixed(2) + ' м');
    html += _sfStat('Объём воды', currVol !== null ? currVol.toFixed(0) + ' м³' : '—');
  }
  html += '</div>';
  if (pct !== null) {
    var color = pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e';
    html += '<div style="margin-bottom:10px">';
    html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:4px">';
    html += '<span>Заполнение</span><span style="font-weight:600;color:' + color + '">' + pct.toFixed(1) + '%</span></div>';
    html += '<div style="background:var(--border-subtle);border-radius:4px;height:10px">';
    html += '<div style="background:' + color + ';border-radius:4px;height:10px;width:' + Math.min(100,pct).toFixed(0) + '%;transition:width 0.4s"></div>';
    html += '</div></div>';
  }
  return html;
}

function _sfStat(label, value) {
  return '<div style="background:var(--bg-sub);border-radius:6px;padding:8px">' +
    '<div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">' + label + '</div>' +
    '<div style="font-size:14px;font-weight:600">' + value + '</div></div>';
}

// ── Калькулятор прогноза ──────────────────────────────────────────────────────
function _sfForecastCalc(sump, pumps, avgQ, latestLev, currVol, days) {
  var activePumps = pumps.filter(function(p){ return p.status === 'on'; });
  var totalPumpQ  = activePumps.reduce(function(s,p){ return s+p.q; }, 0);

  var html = '<div class="card" style="padding:14px" id="sf-forecast-card">';
  html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px">';
  html += '<span class="card-title">Прогноз</span>';
  html += '<span style="font-size:11px;color:var(--text-muted)">Q<sub>приток</sub> = <strong style="color:#60a5fa">' + avgQ.toFixed(1) + ' м³/ч</strong> · база ' + (days||30) + ' дн.</span>';
  html += '</div>';
  // Пояснение к методу
  html += '<div style="background:var(--bg-sub);border-radius:6px;padding:7px 10px;margin-bottom:12px;font-size:10px;color:var(--text-muted)">';
  html += '<strong>Отключение:</strong> уровень H(t) = H₀ + Q<sub>пр</sub>·t / A(H₀)  — рост уровня при остановленных насосах.<br>';
  html += '<strong>Осушение:</strong> t = (V₀ − V<sub>цель</sub>) / (Q<sub>нас</sub> − Q<sub>пр</sub>)  — время при работающих насосах.';
  html += '</div>';
  html += '<div class="settings-subtabs" style="margin-bottom:14px">';
  html += '<button class="btn btn-sm btn-outline active" id="sf-tab-off" onclick="_sfSwitchFcastTab(\'off\')">⛔ Отключение насосов</button>';
  html += '<button class="btn btn-sm btn-outline" id="sf-tab-dry" onclick="_sfSwitchFcastTab(\'dry\')">💧 Осушение</button>';
  html += '</div>';

  // Панель "Отключение"
  html += '<div id="sf-panel-off">';
  html += '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">';
  html += '<label style="font-size:13px">Насосы отключены на: ';
  html += '<input type="number" id="sf-off-hours" value="6" min="0" max="168" step="0.5" style="width:70px;margin-left:6px" oninput="_sfUpdateForecastResult()"> ч</label>';
  html += '</div>';
  html += '<div id="sf-off-result" style="margin-top:12px"></div>';
  html += '</div>';

  // Панель "Осушение"
  html += '<div id="sf-panel-dry" style="display:none">';
  html += '<div style="display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap">';
  html += '<label style="font-size:13px">Целевая отметка: ';
  html += '<input type="number" id="sf-dry-level" value="' + (sump.criticalLevel || (sump.zMin ? (sump.zMin+1).toFixed(1) : 168)) + '" step="0.1" style="width:80px;margin-left:6px" oninput="_sfUpdateForecastResult()"> м</label>';
  html += '</div>';
  html += '<div style="margin-top:10px;font-size:12px;color:var(--text-muted)">Работают насосы:</div>';
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px" id="sf-pump-checks">';
  pumps.forEach(function(p) {
    var chk = p.status === 'on' ? 'checked' : '';
    html += '<label style="font-size:13px;display:flex;align-items:center;gap:4px;cursor:pointer">';
    html += '<input type="checkbox" ' + chk + ' data-pump-q="' + p.q + '" onchange="_sfUpdateForecastResult()"> ';
    html += _sfEsc(p.name) + ' <span style="color:var(--text-muted);font-size:11px">(' + p.q.toFixed(0) + ' м³/ч)</span></label>';
  });
  html += '</div>';
  html += '<div id="sf-dry-result" style="margin-top:12px"></div>';
  html += '</div>';

  html += '</div>';
  return html;
}

function _sfSwitchFcastTab(tab) {
  document.getElementById('sf-panel-off').style.display = tab==='off' ? '' : 'none';
  document.getElementById('sf-panel-dry').style.display = tab==='dry' ? '' : 'none';
  document.getElementById('sf-tab-off').classList.toggle('active', tab==='off');
  document.getElementById('sf-tab-dry').classList.toggle('active', tab==='dry');
  _sfUpdateForecastResult();
}

var _sfFcastParams = {};

function _sfUpdateForecastResult(sump, pumps, avgQ, latestLev, currVol) {
  // Может быть вызван как из таймаута с параметрами, так и из oninput без
  if (sump) { _sfFcastParams = { sump:sump, pumps:pumps, avgQ:avgQ, latestLev:latestLev, currVol:currVol }; }
  else       { sump=_sfFcastParams.sump; pumps=_sfFcastParams.pumps; avgQ=_sfFcastParams.avgQ; latestLev=_sfFcastParams.latestLev; currVol=_sfFcastParams.currVol; }
  if (!sump || !sump.volumeCurve) return;

  var panelOff = document.getElementById('sf-panel-off');
  var panelDry = document.getElementById('sf-panel-dry');
  var offActive = panelOff && panelOff.style.display !== 'none';

  if (offActive) {
    var hoursEl = document.getElementById('sf-off-hours');
    var hours = hoursEl ? parseFloat(hoursEl.value) : 6;
    if (isNaN(hours) || hours < 0) return;

    var V0      = currVol !== null ? currVol : _sfVolumeAt(sump.volumeCurve, latestLev||sump.zMin);
    var Vfinal  = V0 + avgQ * hours;
    var Hfinal  = _sfLevelAt(sump.volumeCurve, Vfinal);
    var dH      = Hfinal !== null ? (Hfinal - (latestLev||0)) : null;
    var crit    = sump.criticalLevel;

    var html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">';
    html += _sfStat('Подъём уровня', dH !== null ? '+' + dH.toFixed(2) + ' м' : '—');
    html += _sfStat('Уровень через ' + hours + ' ч', Hfinal !== null ? Hfinal.toFixed(2) + ' м' : '—');
    html += _sfStat('Объём воды', Vfinal.toFixed(0) + ' м³');
    html += '</div>';

    if (crit && Hfinal !== null && Hfinal > crit) {
      var tCrit = ((_sfVolumeAt(sump.volumeCurve, crit) || 0) - V0) / avgQ;
      html += '<div style="background:#7f1d1d;border:1px solid #ef4444;border-radius:8px;padding:10px;margin-top:10px;font-size:13px">';
      html += '⚠ Критический уровень ' + crit.toFixed(1) + ' м будет достигнут через <strong>' + tCrit.toFixed(1) + ' ч</strong></div>';
    } else if (crit && Hfinal !== null) {
      html += '<div style="background:#14532d;border:1px solid #22c55e;border-radius:8px;padding:10px;margin-top:10px;font-size:13px">✓ Критический уровень (' + crit.toFixed(1) + ' м) не будет достигнут</div>';
    }

    var resEl = document.getElementById('sf-off-result');
    if (resEl) resEl.innerHTML = html;

  } else {
    // Осушение
    var targetEl = document.getElementById('sf-dry-level');
    var target = targetEl ? parseFloat(targetEl.value) : null;
    if (target === null || isNaN(target)) return;

    var checks = document.querySelectorAll('#sf-pump-checks input[type=checkbox]');
    var totalQ = 0;
    checks.forEach(function(c){ if(c.checked) totalQ += parseFloat(c.dataset.pumpQ)||0; });

    var V0   = currVol !== null ? currVol : _sfVolumeAt(sump.volumeCurve, latestLev||sump.zMax);
    var Vt   = _sfVolumeAt(sump.volumeCurve, target);
    var net  = totalQ - avgQ;

    var html = '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">';
    html += _sfStat('Чистая откачка', net > 0 ? net.toFixed(1) + ' м³/ч' : '<span style="color:#ef4444">' + net.toFixed(1) + ' м³/ч</span>');

    if (net <= 0) {
      html += _sfStat('Время', '∞');
      html += _sfStat('Готово к', '—');
      html += '</div>';
      html += '<div style="background:#7f1d1d;border:1px solid #ef4444;border-radius:8px;padding:10px;margin-top:10px;font-size:13px">Суммарный приток превышает производительность насосов — осушение невозможно</div>';
    } else if (Vt !== null && V0 !== null && target < (latestLev||0)) {
      var dV   = V0 - Vt;
      var tH   = dV / net;
      var done = new Date(Date.now() + tH * 3600000);
      var doneStr = done.toLocaleString('ru-RU', {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
      html += _sfStat('Время осушения', tH < 1 ? (tH*60).toFixed(0) + ' мин' : tH.toFixed(1) + ' ч');
      html += _sfStat('Готово к', doneStr);
      html += '</div>';
    } else {
      html += _sfStat('Время', '—');
      html += _sfStat('Готово к', '—');
      html += '</div>';
      html += '<div style="background:#1c1f26;border:1px solid var(--border-subtle);border-radius:8px;padding:10px;margin-top:10px;font-size:13px;color:var(--text-muted)">Укажите целевую отметку ниже текущего уровня</div>';
    }
    var resEl = document.getElementById('sf-dry-result');
    if (resEl) resEl.innerHTML = html;
  }
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

  var W = container.clientWidth || 480, H3 = container.clientHeight || 500;

  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H3);
  renderer.setClearColor(0x0d1117, 1);
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

  // Камера — изометрический вид сверху-спереди, чтобы зумпф выглядел как горизонтальная чаша
  var camera = new THREE.PerspectiveCamera(40, W / H3, 0.1, 2000);
  var d = span * scale;
  camera.position.set(d * 0.8, d * 0.9, d * 1.1);
  camera.lookAt(0, 0, 0);

  // Управление
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

  // Масштабируем при изменении размеров контейнера
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

  // Уровень воды: каждая запись — точка на графике
  var levelPoints = levs.map(function(l) {
    return { x: l.date + 'T' + (l.time || '06:00'), y: parseFloat(l.elevation) };
  });

  // Объём откачки по датам (столбцы)
  var allDates = lpData.allDates;
  var volLabels = allDates;
  var volData   = allDates.map(function(d){ return (pumpsByDate[d] ? pumpsByDate[d].vol : 0); });

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
      xMin: d + 'T12:00', xMax: d + 'T12:00',
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
          data: levelPoints,
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96,165,250,0.08)',
          borderWidth: 2,
          pointRadius: levelPoints.length <= 60 ? 3 : 0,
          pointBackgroundColor: '#60a5fa',
          tension: 0.3,
          fill: false,
          yAxisID: 'yLevel',
          xAxisID: 'x',
          parsing: false,
          order: 1
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
