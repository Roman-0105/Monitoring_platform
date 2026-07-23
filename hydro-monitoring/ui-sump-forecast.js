// ── Прогноз зумпфов ─────────────────────────────────────────────────────────

var SumpForecastState = {
  selectedSumpId: null,
  _inflowChartInst: null,
  _vhChartInst:     null,
  _fcastChartInst:  null,
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
  var step = 0.1, curve = [];
  for (var H = zMin; H <= zMax + step*0.01; H += step) {
    H = Math.round(H * 10) / 10;
    var vol = 0;
    for (var i = 0; i < tris.length; i++) {
      var t = tris[i];
      vol += _sfClipTriVol(xs[t[0]],ys[t[0]],zs[t[0]], xs[t[1]],ys[t[1]],zs[t[1]], xs[t[2]],ys[t[2]],zs[t[2]], H);
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
function _sfComputeInflowHistory(sump) {
  var result = [];
  if (!sump.volumeCurve || sump.volumeCurve.length === 0) return result;

  // Отметки зумпфа по датам (берём первую запись за день как 06:00)
  var levByDate = {};
  var levs = DewateringState.waterLevels.filter(function(l){ return l.sumpId === sump.id; });
  levs.forEach(function(l) {
    if (!levByDate[l.date] || l.time < levByDate[l.date].time) levByDate[l.date] = l;
  });

  // Суммарный объём откаченной воды по датам со всех насосов зумпфа
  var pumpIds = DewateringState.pumps
    .filter(function(p){ return p.sumpId === sump.id && p.countInVolume !== false; })
    .map(function(p){ return p.id; });

  var pumpedByDate = {};
  DewateringState.meterReadings.forEach(function(r) {
    if (pumpIds.indexOf(r.pumpId) < 0) return;
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
    var Qin     = (Vpumped + deltaV) / 24; // м³/ч за этот день
    if (Qin < 0) Qin = 0; // не может быть отрицательным

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
  _sfRenderSelector();
  var sump = DewateringState.sumps.find(function(s){ return s.id === id; });
  if (sump) renderSumpForecastContent(sump);
}

// ── Главный рендер страницы зумпфа ───────────────────────────────────────────
function renderSumpForecastContent(sump) {
  // Уничтожаем старые графики
  ['_inflowChartInst','_vhChartInst','_fcastChartInst'].forEach(function(k){
    if (SumpForecastState[k]) { try{SumpForecastState[k].destroy();}catch(e){} SumpForecastState[k]=null; }
  });

  var hasCurve  = sump.volumeCurve && sump.volumeCurve.length > 0;
  var pumps     = _sfPumpPerformance(sump, 30);
  var inflow    = hasCurve ? _sfComputeInflowHistory(sump) : [];
  var avgQ      = inflow.length > 0 ? inflow.reduce(function(s,r){return s+r.q;},0)/inflow.length : null;
  var latestLev = _sfLatestLevel(sump);
  var currVol   = (hasCurve && latestLev !== null) ? _sfVolumeAt(sump.volumeCurve, latestLev) : null;
  var pct       = (hasCurve && currVol !== null) ? (currVol / sump.totalVolume * 100) : null;

  var html = '<div style="display:grid;grid-template-columns:340px 1fr;gap:14px;align-items:start">';

  // ── Левая колонка ────────────────────────────────────────────────────────
  html += '<div style="display:flex;flex-direction:column;gap:14px">';

  // Карточка модели
  html += '<div class="card" style="padding:14px">';
  html += '<div class="card-title" style="margin-bottom:10px">Модель зумпфа</div>';
  if (hasCurve) {
    html += _sfModelStats(sump, latestLev, currVol, pct);
  } else {
    html += '<p style="color:var(--text-muted);font-size:13px;margin-bottom:10px">Файл .tridb не загружен — объём воды и прогноз недоступны</p>';
  }
  html += '<label class="btn btn-sm btn-outline" style="cursor:pointer;display:inline-block;margin-top:6px">';
  html += '<input type="file" accept=".tridb" style="display:none" onchange="_sfOnFileInput(event,\'' + sump.id + '\')">';
  html += hasCurve ? '↺ Обновить .tridb' : '+ Загрузить .tridb';
  html += '</label>';
  html += '<div id="sf-upload-status" style="font-size:12px;margin-top:6px;color:#60a5fa;min-height:18px"></div>';
  if (hasCurve) {
    html += '<div style="margin-top:10px"><label style="font-size:12px;display:flex;align-items:center;gap:8px">Критический уровень (м):&nbsp;';
    html += '<input type="number" step="0.1" value="' + (sump.criticalLevel||'') + '" style="width:80px" ';
    html += 'onchange="_sfSaveCritical(\'' + sump.id + '\',this.value)"></label></div>';
  }
  html += '</div>';

  // Карточка насосов
  html += '<div class="card" style="padding:14px">';
  html += '<div class="card-title" style="margin-bottom:10px">Насосы зумпфа <span style="font-size:11px;color:var(--text-muted);font-weight:400">(факт. за 30 дн.)</span></div>';
  if (pumps.length === 0) {
    html += '<p style="color:var(--text-muted);font-size:13px">Насосы не привязаны к этому зумпфу</p>';
  } else {
    html += '<table style="width:100%;font-size:13px;border-collapse:collapse">';
    html += '<tr style="color:var(--text-muted);font-size:11px"><th style="text-align:left;padding:2px 6px 6px 0">Насос</th><th style="text-align:right">Q факт.</th><th style="text-align:right">Ч/р</th></tr>';
    pumps.forEach(function(p) {
      var badge = p.status === 'on'
        ? '<span style="background:#16a34a;color:#fff;border-radius:3px;padding:1px 5px;font-size:10px">ON</span>'
        : '<span style="background:#374151;color:#9ca3af;border-radius:3px;padding:1px 5px;font-size:10px">OFF</span>';
      html += '<tr style="border-top:1px solid var(--border-subtle)">';
      html += '<td style="padding:5px 6px 5px 0">' + badge + ' ' + _sfEsc(p.name) + (p.model?' <span style="color:var(--text-muted);font-size:11px">'+_sfEsc(p.model)+'</span>':'') + '</td>';
      html += '<td style="text-align:right;font-weight:600">' + (p.q > 0 ? p.q.toFixed(0) + ' м³/ч' : '—') + '</td>';
      html += '<td style="text-align:right;color:var(--text-muted)">' + (p.totalH > 0 ? p.totalH + ' ч' : '—') + '</td>';
      html += '</tr>';
    });
    html += '</table>';
  }
  html += '</div>';
  html += '</div>'; // конец левой колонки

  // ── Правая колонка ───────────────────────────────────────────────────────
  html += '<div style="display:flex;flex-direction:column;gap:14px">';

  // Карточка притока
  html += '<div class="card" style="padding:14px">';
  html += '<div class="card-title" style="margin-bottom:4px">Водоприток';
  if (avgQ !== null) html += ' <span style="font-size:14px;color:#60a5fa;font-weight:700">' + avgQ.toFixed(1) + ' м³/ч</span> <span style="font-size:11px;color:var(--text-muted)">ср. за ' + inflow.length + ' сут.</span>';
  html += '</div>';
  if (!hasCurve) {
    html += '<p style="color:var(--text-muted);font-size:13px">Загрузите .tridb для расчёта притока</p>';
  } else if (inflow.length === 0) {
    html += '<p style="color:var(--text-muted);font-size:13px">Недостаточно данных по уровням воды</p>';
  } else {
    html += '<canvas id="sf-inflow-chart" height="90"></canvas>';
  }
  html += '</div>';

  // Калькулятор прогноза
  if (hasCurve && avgQ !== null) {
    html += _sfForecastCalc(sump, pumps, avgQ, latestLev, currVol);
  } else if (hasCurve) {
    html += '<div class="card" style="padding:14px"><div class="card-title">Прогноз</div>';
    html += '<p style="color:var(--text-muted);font-size:13px">Прогноз будет доступен после накопления истории уровней воды</p></div>';
  }

  // График V(H)
  if (hasCurve) {
    html += '<div class="card" style="padding:14px">';
    html += '<div class="card-title" style="margin-bottom:4px">Кривая объём–отметка V(H)</div>';
    html += '<canvas id="sf-vh-chart" height="100"></canvas>';
    html += '</div>';
  }

  html += '</div>'; // конец правой колонки
  html += '</div>'; // конец grid

  document.getElementById('sf-content').innerHTML = html;

  // Рендерим графики
  if (inflow.length > 0) setTimeout(function(){ _sfRenderInflowChart(inflow); }, 50);
  if (hasCurve)          setTimeout(function(){ _sfRenderVhChart(sump.volumeCurve, latestLev); }, 50);
  if (hasCurve && avgQ !== null) setTimeout(function(){ _sfUpdateForecastResult(sump, pumps, avgQ, latestLev, currVol); }, 100);
}

function _sfModelStats(sump, latestLev, currVol, pct) {
  var html = '';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">';
  html += _sfStat('Полный объём', sump.totalVolume ? sump.totalVolume.toFixed(0) + ' м³' : '—');
  html += _sfStat('Диапазон Z', sump.zMin ? sump.zMin.toFixed(1) + '–' + sump.zMax.toFixed(1) + ' м' : '—');
  if (latestLev !== null) {
    html += _sfStat('Тек. отметка', latestLev.toFixed(2) + ' м');
    html += _sfStat('Объём воды', currVol !== null ? currVol.toFixed(0) + ' м³' : '—');
    if (pct !== null) {
      html += '</div>';
      html += '<div style="margin-top:4px;margin-bottom:4px">';
      html += '<div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:3px">';
      html += '<span>Заполнение</span><span>' + pct.toFixed(1) + '%</span></div>';
      var color = pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e';
      html += '<div style="background:var(--border-subtle);border-radius:4px;height:8px"><div style="background:' + color + ';border-radius:4px;height:8px;width:' + Math.min(100,pct).toFixed(0) + '%"></div></div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">';
    }
  }
  html += '</div>';
  return html;
}

function _sfStat(label, value) {
  return '<div style="background:var(--bg-sub);border-radius:6px;padding:8px">' +
    '<div style="font-size:10px;color:var(--text-muted);margin-bottom:2px">' + label + '</div>' +
    '<div style="font-size:14px;font-weight:600">' + value + '</div></div>';
}

// ── Калькулятор прогноза ──────────────────────────────────────────────────────
function _sfForecastCalc(sump, pumps, avgQ, latestLev, currVol) {
  var activePumps = pumps.filter(function(p){ return p.status === 'on'; });
  var totalPumpQ  = activePumps.reduce(function(s,p){ return s+p.q; }, 0);

  var html = '<div class="card" style="padding:14px" id="sf-forecast-card">';
  html += '<div class="card-title" style="margin-bottom:10px">Прогноз</div>';
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

// ── Графики ───────────────────────────────────────────────────────────────────
function _sfRenderInflowChart(inflow) {
  var el = document.getElementById('sf-inflow-chart');
  if (!el || typeof Chart === 'undefined') return;
  if (SumpForecastState._inflowChartInst) { SumpForecastState._inflowChartInst.destroy(); }
  var labels = inflow.slice(-30).map(function(r){ return r.date.slice(5); });
  var vals   = inflow.slice(-30).map(function(r){ return r.q; });
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
